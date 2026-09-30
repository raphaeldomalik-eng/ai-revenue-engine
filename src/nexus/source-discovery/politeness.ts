export type ResponseSnapshot = { status: number; headers: Headers; bytes: Uint8Array };

type OriginState = { active: number; waiters: Array<() => void>; nextStartAt: number; cooldownUntil: number };

export function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isFinite(date) ? Math.max(0, date - nowMs) : null;
}

/**
 * Shared across concurrent crawls in one process so a bulk run never exceeds the per-origin concurrency cap or
 * minimum spacing, honours a Retry-After cooldown seen by any crawl, and collapses identical in-flight GETs.
 */
export class OriginPoliteness {
  readonly maxConcurrentPerOrigin: number;
  private readonly states = new Map<string, OriginState>();
  private readonly inflight = new Map<string, Promise<ResponseSnapshot>>();
  private readonly clock: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  singleFlightHits = 0;

  constructor(options: { maxConcurrentPerOrigin?: number; clock?: () => number; sleep?: (ms: number) => Promise<void> } = {}) {
    this.maxConcurrentPerOrigin = Math.max(1, options.maxConcurrentPerOrigin ?? 1);
    this.clock = options.clock ?? (() => Date.now());
    this.sleep = options.sleep ?? ((ms) => (ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve()));
  }

  private state(origin: string): OriginState {
    let state = this.states.get(origin);
    if (!state) {
      state = { active: 0, waiters: [], nextStartAt: 0, cooldownUntil: 0 };
      this.states.set(origin, state);
    }
    return state;
  }

  cooldownRemaining(origin: string): number {
    return Math.max(0, this.state(origin).cooldownUntil - this.clock());
  }

  noteRetryAfter(origin: string, delayMs: number) {
    const state = this.state(origin);
    state.cooldownUntil = Math.max(state.cooldownUntil, this.clock() + delayMs);
  }

  async run<T>(origin: string, minDelayMs: number, task: () => Promise<T>): Promise<T> {
    const state = this.state(origin);
    while (state.active >= this.maxConcurrentPerOrigin) await new Promise<void>((resolve) => state.waiters.push(resolve));
    state.active += 1;
    try {
      const wait = Math.max(state.nextStartAt, state.cooldownUntil) - this.clock();
      if (wait > 0) await this.sleep(wait);
      state.nextStartAt = this.clock() + Math.max(0, minDelayMs);
      return await task();
    } finally {
      state.active -= 1;
      state.waiters.shift()?.();
    }
  }

  /** Identical concurrent GETs (same URL, same headers) share one network response snapshot. */
  singleFlight(key: string, task: () => Promise<ResponseSnapshot>): Promise<ResponseSnapshot> {
    const existing = this.inflight.get(key);
    if (existing) {
      this.singleFlightHits += 1;
      return existing;
    }
    const promise = task().finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }
}

export const sharedOriginPoliteness = new OriginPoliteness();
