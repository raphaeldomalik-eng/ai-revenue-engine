import { createHash } from 'node:crypto';
import { canonicalHttpsUrl } from './network.ts';
import type { TerminalUrlHistory, TerminalUrlObservation } from './types.ts';

type Store = { get(key: string): Promise<Record<string, unknown> | null>; set(key: string, value: Record<string, unknown>): Promise<void> };
const VERSION = 'aire.terminal-url-observation.v1';
/** URL-scoped technical evidence, not a venue or host disposition. No TTL or policy/request identity. */
export function terminalUrlKey(value: string): string {
 const url = canonicalHttpsUrl(value);
 if (!url) throw new Error('TERMINAL_URL_INVALID');
 return 'terminal-url:' + createHash('sha256').update(url).digest('hex');
}
export function resultStoreTerminalUrlHistory(store: Store): TerminalUrlHistory {
 return {
  async get(url) {
   const canonical = canonicalHttpsUrl(url);
   const record = await store.get(terminalUrlKey(url));
   if (!record) return null;
   if (record.contractVersion !== VERSION || record.url !== canonical || (record.status !== 404 && record.status !== 410) || record.source !== 'DIRECT_HTTP_RESPONSE' || typeof record.observedAt !== 'string' || !Number.isFinite(Date.parse(record.observedAt))) throw new Error('TERMINAL_URL_HISTORY_INVALID');
   return { url: canonical!, status: record.status as 404 | 410, observedAt: record.observedAt, source: 'DIRECT_HTTP_RESPONSE' };
  },
  async set(observation: TerminalUrlObservation) {
   if (![404, 410].includes(observation.status) || observation.source !== 'DIRECT_HTTP_RESPONSE' || !Number.isFinite(Date.parse(observation.observedAt))) throw new Error('TERMINAL_URL_OBSERVATION_INVALID');
   const key = terminalUrlKey(observation.url);
   if (await store.get(key)) return; // retain the original observed status/date
   await store.set(key, { ...observation, url: canonicalHttpsUrl(observation.url), contractVersion: VERSION, requestId: key });
  },
 };
}
