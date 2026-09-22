import type { SourceExtractor } from "../contracts.ts";
import { hrefTags, visibleText } from "./html.ts";
import { canonicalHttpsUrl } from "./network.ts";
import type { FetchedDocument } from "./types.ts";

const EVENT_PATH = /(^|\/)(events?|gigs?|shows?|tour|live|whats[-_]?on|calendar|concerts?)(\/|$)/i;
const EVENT_TEXT = /\b(events?|gigs?|shows?|tour dates?|live dates?|what'?s on|calendar|concerts?)\b/i;
const DATE_SIGNAL = /\b(20\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|mon|tue|wed|thu|fri|sat|sun)\b/i;

function sameOrigin(value: string, base: string): string | null {
  const normalized = canonicalHttpsUrl(value, base);
  return normalized && new URL(normalized).origin === new URL(base).origin ? normalized : null;
}

function extractorTerms(extractors: SourceExtractor[]): string[] {
  return extractors.flatMap((item) => item === "PUBLIC_CONTACT"
    ? ["contact", "booking", "hire", "venue", "event", "facility", "facilities", "conference"]
    : item === "VENUE_FACTS"
      ? ["venue", "space", "capacity", "facility", "facilities", "access"]
      : item === "EVENTS"
        ? ["event", "what", "calendar", "show", "live"]
        : item === "IMAGE_CANDIDATES"
          ? ["gallery", "space", "venue", "about"]
          : ["about", "venue", "facility", "facilities", "conference", "home"]);
}

export function discoverUsefulSourceUrls(document: FetchedDocument, extractors: SourceExtractor[]): string[] {
  const terms = extractorTerms(extractors);
  const scored = new Map<string, number>();
  for (const anchor of hrefTags(document.body)) {
    const normalized = sameOrigin(anchor.attrs.href ?? "", document.url);
    if (!normalized || normalized === document.url) continue;
    const url = new URL(normalized);
    const label = visibleText(anchor.inner);
    const searchable = `${label} ${url.pathname}`.toLowerCase();
    let score = terms.reduce((sum, term) => sum + (searchable.includes(term) ? 1 : 0), 0);
    if (extractors.includes("EVENTS")) {
      if (EVENT_PATH.test(url.pathname)) score += 4;
      if (EVENT_TEXT.test(label)) score += 3;
      if (/\/events?\//i.test(url.pathname)) score += 1;
    }
    if (score > 0) scored.set(normalized, Math.max(score, scored.get(normalized) ?? 0));
  }
  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([url]) => url);
}

export function discoverLikelyEventDetailUrls(document: FetchedDocument): string[] {
  const source = new URL(document.url);
  const sourceDepth = source.pathname.split("/").filter(Boolean).length;
  const scored = new Map<string, number>();
  for (const anchor of hrefTags(document.body)) {
    const normalized = sameOrigin(anchor.attrs.href ?? "", document.url);
    if (!normalized || normalized === document.url) continue;
    const url = new URL(normalized);
    const label = visibleText(anchor.inner);
    const isDeeper = url.pathname.split("/").filter(Boolean).length > sourceDepth;
    const hasDateSignal = DATE_SIGNAL.test(`${label} ${url.pathname}`);
    if (!EVENT_PATH.test(url.pathname) || (!isDeeper && !hasDateSignal)) continue;
    const score = Number(isDeeper) + Number(hasDateSignal) * 2;
    scored.set(normalized, Math.max(score, scored.get(normalized) ?? 0));
  }
  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([url]) => url);
}
