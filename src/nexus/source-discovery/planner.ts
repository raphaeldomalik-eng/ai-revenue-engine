import type { SourceExtractor } from "../contracts.ts";
import type { FetchedDocument } from "./types.ts";

/** A dimension is an extractor-owned evidence need, e.g. "VENUE_FACTS:CAPACITY"; the core never interprets it. */
export type Dimension = string;

export type ProfileCandidate = { url: string; kind: "PAGE" | "CALENDAR"; dims: Dimension[]; source: "LINK" | "EVENT_DETAIL" | "CALENDAR" };

/**
 * Extractor profile: page prioritisation, document relevance, and sufficiency for one requested extractor.
 * The generic crawler core only schedules, fetches and accounts; profiles decide what evidence is worth fetching.
 */
export type ExtractorProfile = {
  extractor: SourceExtractor;
  dimensions: Dimension[];
  /** Dimensions whose absence justifies sitemap discovery and linked first-party subdomain admission. */
  priorityDimensions: Dimension[];
  /** Relative link strength (default 1) for candidates this extractor recognises. */
  linkStrength?(url: string, label: string): number;
  /** "LINK_FOLLOWING" keeps the established ranked link traversal when only such profiles are requested. */
  strategy: "GAP_PLANNED" | "LINK_FOLLOWING";
  linkDimensions(url: string, label: string): Dimension[];
  /** PDF relevance for this extractor; null means the extractor does not read PDFs. */
  pdfDimensions(url: string, label: string): Dimension[] | null;
  /** Additional candidates only this extractor can recognise (event details, calendars). */
  followUps?(document: FetchedDocument, observation: DocumentObservation, open: Set<Dimension>): ProfileCandidate[];
  /** Updates this extractor's satisfied dimensions from accumulated deterministic evidence. */
  satisfied(state: ProfileState): Dimension[];
  observe(document: FetchedDocument, observation: DocumentObservation, state: ProfileState, selectedFor: Dimension[]): void;
};

export type ProfileState = Record<string, number | boolean | string[]>;

/** Lazily computed, memoised extraction for one document, shared by every profile. */
export type DocumentObservation = {
  resources(): import("./extractors/resources.ts").ResourceExtraction;
  eventCount(): number;
};

const EXCLUDED_PATH = /(?:^|\/)(?:privacy|cookies?|cookie-policy|terms|legal|login|log-in|signin|sign-in|register|account|my-account|cart|basket|checkout|wp-admin|wp-login|feed|rss|tag|tags|category|categories|author|search|careers?|jobs|vacancies|newsletter|unsubscribe|sitemap)(?:\/|$|\.)|\/page\/\d+|\/(?:19|20)\d{2}\/\d{2}\//i;
const NON_DOCUMENT = /\.(?:jpe?g|png|gif|webp|avif|svg|ico|mp4|mov|webm|mp3|wav|zip|rar|7z|gz|tar|exe|dmg|docx?|xlsx?|pptx?|css|js|json|woff2?|ttf)$/i;

export function planableUrl(url: string): boolean {
  const parsed = new URL(url);
  return !EXCLUDED_PATH.test(parsed.pathname) && !NON_DOCUMENT.test(parsed.pathname) && !/[?&](?:s|q|replytocom|share|print|add-to-cart)=/i.test(parsed.search);
}

export function pathWords(url: string): string {
  let path = new URL(url).pathname;
  try { path = decodeURIComponent(path); } catch { /* keep encoded path */ }
  return path.replace(/[\/_.-]+/g, " ");
}

export function isPdfUrl(url: string, typeAttr?: string) {
  return /\.pdf$/i.test(new URL(url).pathname) || /application\/pdf/i.test(typeAttr ?? "");
}

export type Candidate = {
  url: string;
  kind: "PAGE" | "PDF" | "CALENDAR";
  dims: Dimension[];
  source: "ENTRY" | "LINK" | "SITEMAP" | "EVENT_DETAIL" | "CALENDAR";
  discoveredFrom: string | null;
  label: string;
  order: number;
  strength: number;
};

/** `/a` and `/a/` are one page on virtually every site; planning them twice only buys a redirect to a fetched page. */
export function planKey(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString();
}

/** A gap that has had this many pages spent on it without evidence stops competing for budget. */
export const DEFAULT_ATTEMPTS_PER_DIMENSION = 4;

export class GapPlanner {
  readonly requested: Dimension[];
  readonly satisfied = new Set<Dimension>();
  private readonly roundRobin: Dimension[];
  private readonly candidates = new Map<string, Candidate>();
  private readonly done = new Set<string>();
  private readonly attempts = new Map<Dimension, number>();
  private readonly maxAttempts: number;
  private order = 0;
  private pointer = 0;
  readonly selections: Array<{ url: string; kind: Candidate["kind"]; reason: string }> = [];

  constructor(requested: Dimension[], roundRobin: Dimension[] = requested, maxAttempts = DEFAULT_ATTEMPTS_PER_DIMENSION) {
    this.requested = requested;
    this.roundRobin = roundRobin.filter((dim) => requested.includes(dim));
    this.maxAttempts = maxAttempts;
  }

  add(candidate: Omit<Candidate, "order">) {
    const key = planKey(candidate.url);
    if (this.done.has(key) || !candidate.dims.length) return;
    const existing = this.candidates.get(key);
    if (existing) {
      existing.dims = [...new Set([...existing.dims, ...candidate.dims])];
      existing.strength = Math.max(existing.strength, candidate.strength);
      return;
    }
    this.candidates.set(key, { ...candidate, order: this.order++ });
  }

  has(url: string) {
    const key = planKey(url);
    return this.done.has(key) || this.candidates.has(key);
  }

  markDone(url: string) {
    const key = planKey(url);
    this.done.add(key);
    this.candidates.delete(key);
  }

  setSatisfied(dims: Dimension[]) {
    for (const dim of dims) if (this.requested.includes(dim)) this.satisfied.add(dim);
  }

  unsatisfied(): Dimension[] {
    return this.requested.filter((dim) => !this.satisfied.has(dim));
  }

  /** Unsatisfied gaps that may still spend budget (the entry page is not an attempt). */
  open(): Dimension[] {
    return this.unsatisfied().filter((dim) => (this.attempts.get(dim) ?? 0) < this.maxAttempts);
  }

  exhausted(): Dimension[] {
    return this.unsatisfied().filter((dim) => (this.attempts.get(dim) ?? 0) >= this.maxAttempts);
  }

  allSatisfied() {
    return this.unsatisfied().length === 0;
  }

  pending(kind?: Candidate["kind"]): Candidate[] {
    return [...this.candidates.values()].filter((item) => !kind || item.kind === kind);
  }

  uncoveredGaps(dims: Dimension[]): Dimension[] {
    const pending = this.pending();
    return this.open().filter((dim) => dims.includes(dim) && !pending.some((item) => item.dims.includes(dim)));
  }

  gapServingCount(): number {
    const open = new Set(this.open());
    return this.pending().filter((item) => item.dims.some((dim) => open.has(dim))).length;
  }

  private rank(item: Candidate, open: Set<Dimension>) {
    const served = item.dims.filter((dim) => open.has(dim)).length;
    const depth = new URL(item.url).pathname.split("/").filter(Boolean).length;
    return item.strength * 10 + served * 4 - Math.min(depth, 6) + (item.source === "LINK" ? 2 : 0);
  }

  /** Round-robin across open dimensions so one extractor's gap cannot starve another's; ties keep discovery order. */
  next(allowPdf: boolean): Candidate | null {
    const open = new Set(this.open());
    const eligible = this.pending().filter((item) => (allowPdf || item.kind !== "PDF") && item.dims.some((dim) => open.has(dim)));
    if (!eligible.length) return null;
    for (let step = 0; step < this.roundRobin.length; step += 1) {
      const dim = this.roundRobin[(this.pointer + step) % this.roundRobin.length]!;
      if (!open.has(dim)) continue;
      const serving = eligible.filter((item) => item.dims.includes(dim));
      if (!serving.length) continue;
      serving.sort((a, b) => this.rank(b, open) - this.rank(a, open) || a.order - b.order || a.url.localeCompare(b.url));
      const chosen = serving[0]!;
      if (chosen.source !== "ENTRY") {
        this.pointer = (this.pointer + step + 1) % this.roundRobin.length;
        this.attempts.set(dim, (this.attempts.get(dim) ?? 0) + 1);
      }
      const others = chosen.dims.filter((item) => item !== dim && open.has(item));
      this.selections.push({ url: chosen.url, kind: chosen.kind, reason: `${chosen.source}:${dim}${others.length ? `+${others.join("+")}` : ""}` });
      return chosen;
    }
    const fallback = eligible.sort((a, b) => this.rank(b, open) - this.rank(a, open) || a.order - b.order)[0]!;
    this.selections.push({ url: fallback.url, kind: fallback.kind, reason: `${fallback.source}:${fallback.dims.filter((dim) => open.has(dim)).join("+")}` });
    return fallback;
  }
}
