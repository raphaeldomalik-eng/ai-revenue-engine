import { createHash } from "node:crypto";
import { tags } from "../html.ts";
import { canonicalHttpsUrl } from "../network.ts";
import type { FetchedDocument } from "../types.ts";
import { extractHtmlCardEvents, extractHtmlEventFacts, type HtmlEventFacts } from "./event-html.ts";
import { parseCalendarDocument, type CalendarEventFacts } from "./event-ics.ts";

function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim().replace(/\s+/g, " ") || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function names(value: unknown): string[] {
  return (Array.isArray(value) ? value : value ? [value] : [])
    .map((item) => typeof item === "string" ? text(item) : text(record(item).name))
    .filter((item): item is string => Boolean(item));
}

function jsonUrl(value: unknown, base: string): string | null {
  const item = Array.isArray(value) ? value[0] : value;
  const candidate = typeof item === "string" ? text(item) : text(record(item).url);
  return candidate ? canonicalHttpsUrl(candidate, base) : null;
}

function collectJsonLdNodes(value: unknown, output: Record<string, unknown>[]) {
  if (Array.isArray(value)) return value.forEach((item) => collectJsonLdNodes(item, output));
  if (!value || typeof value !== "object") return;
  const item = value as Record<string, unknown>;
  const types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
  if (types.some((type) => ["event", "musicevent"].includes(String(type).toLowerCase()))) output.push(item);
  Object.values(item).forEach((nested) => {
    if (nested && typeof nested === "object") collectJsonLdNodes(nested, output);
  });
}

function normalizeComparable(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function validInstant(value: string | null): value is string {
  return value !== null && Number.isFinite(new Date(value).getTime());
}

export type EventEvidence = {
  title: string;
  sourceEventUrl: string;
  sourcePageUrl: string;
  venueText: string | null;
  startAt: string;
  endAt: string | null;
  timezone: string | null;
  eventStatus: string | null;
  description: string | null;
  organiser: string | null;
  performers: string[];
  sourceCategory: string | null;
  ticketUrl: string | null;
  ticketDomain: string | null;
  priceText: string | null;
  ageRestriction: string | null;
  eventImageUrl: string | null;
  sourceFingerprint: string;
  observedAt: string;
  state: "DISCOVERED" | "REVIEW_REQUIRED";
  confidence: number | null;
  sourceExternalId?: string;
  sourceIdentityEvidenceRef?: string;
};

type NormalizedEvent = { event: EventEvidence; identity: string };

function normalizeEvent(node: Record<string, unknown>, document: FetchedDocument): NormalizedEvent | null {
  const title = text(node.name);
  const startAt = text(node.startDate);
  if (!title || !validInstant(startAt)) return null;
  const rawEndAt = text(node.endDate);
  const endAt = validInstant(rawEndAt) ? rawEndAt : null;
  const location = record(node.location);
  const offers = Array.isArray(node.offers) ? record(node.offers[0]) : record(node.offers);
  const explicitEventUrl = jsonUrl(node.url ?? node["@id"], document.url);
  const sourceEventUrl = explicitEventUrl ?? document.url;
  const ticketUrl = jsonUrl(offers.url, document.url);
  const stable = {
    title,
    startAt,
    endAt,
    canonicalUrl: explicitEventUrl,
    ticketUrl,
    eventStatus: text(node.eventStatus),
    venueText: text(location.name),
    performers: [...new Set([...names(node.performer), ...names(node.performers)])],
    eventImageUrl: jsonUrl(node.image, document.url),
  };
  const event: EventEvidence = {
    title,
    sourceEventUrl,
    sourcePageUrl: document.url,
    venueText: stable.venueText,
    startAt,
    endAt: stable.endAt,
    timezone: text(node.timezone),
    eventStatus: stable.eventStatus,
    description: text(node.description)?.slice(0, 10_000) ?? null,
    organiser: text(record(node.organizer).name) ?? text(node.organizer),
    performers: stable.performers,
    sourceCategory: text(node.eventType),
    ticketUrl,
    ticketDomain: ticketUrl ? new URL(ticketUrl).hostname : null,
    priceText: text(record(offers.price).price) ?? text(offers.price),
    ageRestriction: text(node.typicalAgeRange) ?? text(node.ageRange),
    eventImageUrl: stable.eventImageUrl,
    sourceFingerprint: createHash("sha256").update(JSON.stringify(stable)).digest("hex"),
    observedAt: document.observedAt,
    state: "DISCOVERED",
    confidence: null,
  };
  const identity = explicitEventUrl ?? [normalizeComparable(title), startAt.slice(0, 10), normalizeComparable(event.venueText)].join("|");
  return { event, identity };
}

export function extractEventsFromDocuments(documents: FetchedDocument[]): { eventCandidates: EventEvidence[]; warnings: string[]; evidenceRefs: string[] } {
  const candidates: EventEvidence[] = [];
  const warnings: string[] = [];
  const evidenceRefs: string[] = [];
  const htmlFacts = new Map<string, { facts: HtmlEventFacts; document: FetchedDocument }>();
  const calendarFacts: CalendarEventFacts[] = [];
  for (const document of documents) {
    if (/text\/calendar|\.ics(?:$|\?)/i.test(document.contentType ?? "") || /(?:\.ics|[?&]format=ical)(?:$|&)/i.test(document.url)) {
      const calendar = parseCalendarDocument(document);
      calendarFacts.push(...calendar.events);
      if (calendar.warning) warnings.push(calendar.warning);
      for (const event of calendar.events) evidenceRefs.push(identityRef(event.sourceHash, "ics", event.sourceExternalId));
      continue;
    }
    const html = extractHtmlEventFacts(document);
    if (html) htmlFacts.set(html.sourceEventUrl, { facts: html, document });
    for (const card of extractHtmlCardEvents(document)) {
      htmlFacts.set(card.sourceEventUrl, { facts: card, document });
    }
    const nodes: Record<string, unknown>[] = [];
    for (const script of tags(document.body, "script")) {
      if ((script.attrs.type ?? "").toLowerCase() !== "application/ld+json" || !script.inner.trim()) continue;
      try {
        collectJsonLdNodes(JSON.parse(script.inner.trim()), nodes);
      } catch {
        warnings.push(`${document.url}: malformed JSON-LD was ignored.`);
      }
    }
    for (const node of nodes) {
      const structuredStart = text(node.startDate);
      const structuredEnd = text(node.endDate);
      if ((structuredStart && !validInstant(structuredStart)) || (structuredEnd && !validInstant(structuredEnd))) {
        warnings.push(`${document.url}: invalid structured event date was ignored.`);
      }
      const normalized = normalizeEvent(node, document);
      if (!normalized) continue;
      candidates.push(normalized.event);
    }
  }
  for (const facts of calendarFacts) {
    const calendarInstant = new Date(facts.startAt).getTime();
    let candidate = candidates.find((event) =>
      (event.sourceEventUrl === facts.sourceEventUrl || (facts.sourceEventUrl === facts.sourcePageUrl && event.sourcePageUrl === facts.sourcePageUrl))
      && new Date(event.startAt).getTime() === calendarInstant
      && (!event.sourceIdentityEvidenceRef?.includes(":ics:") || event.sourceExternalId === facts.sourceExternalId));
    if (!candidate) {
      const source = documents.find((document) => document.url === facts.sourcePageUrl) ?? documents.find((document) => document.sourceHash === facts.sourceHash);
      if (!source) continue;
      candidate = blankEvent(facts.title, facts.startAt, facts.sourceEventUrl, source);
      candidate.sourcePageUrl = facts.sourcePageUrl;
      candidates.push(candidate);
    }
    candidate.title ||= facts.title;
    candidate.startAt ||= facts.startAt;
    candidate.endAt ??= facts.endAt;
    candidate.timezone ??= facts.timezone;
    candidate.venueText ??= facts.venueText;
    candidate.description ??= facts.description;
    candidate.sourceExternalId = facts.sourceExternalId;
    candidate.sourceIdentityEvidenceRef = identityRef(facts.sourceHash, "ics", facts.sourceExternalId);
  }
  for (const [eventUrl, { facts, document }] of htmlFacts) {
    let candidate = candidates.find((event) => event.sourceEventUrl === eventUrl && event.sourcePageUrl === document.url);
    if (!candidate && facts.startAt) {
      candidate = blankEvent(facts.title, facts.startAt, eventUrl, document);
      candidates.push(candidate);
    }
    if (!candidate) continue;
    const siteName = document.body.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i)?.[1] ?? null;
    if (siteName && candidate.title !== facts.title && candidate.title.toLowerCase() === `${facts.title} — ${siteName}`.toLowerCase()) candidate.title = facts.title;
    candidate.startAt ||= facts.startAt ?? "";
    candidate.endAt ??= facts.endAt;
    candidate.timezone ??= facts.timezone;
    candidate.venueText ??= facts.venueText;
    candidate.description ??= facts.description;
    if (!candidate.performers.length) candidate.performers = facts.performers;
    candidate.ticketUrl ??= facts.ticketUrl;
    candidate.ticketDomain ??= candidate.ticketUrl ? new URL(candidate.ticketUrl).hostname : null;
    candidate.eventImageUrl ??= facts.eventImageUrl;
    if (facts.sourceExternalId && !candidate.sourceExternalId) {
      candidate.sourceExternalId = facts.sourceExternalId;
      candidate.sourceIdentityEvidenceRef = identityRef(document.sourceHash, "html", facts.sourceExternalId);
      evidenceRefs.push(candidate.sourceIdentityEvidenceRef);
    }
    evidenceRefs.push(`source:${document.sourceHash}:html:${createHash("sha256").update(eventUrl).digest("hex").slice(0, 16)}`);
  }
  const unique = new Map<string, EventEvidence>();
  for (const candidate of candidates) {
    if (!validInstant(candidate.startAt)) {
      warnings.push(`${candidate.sourcePageUrl}: invalid event start date was ignored.`);
      continue;
    }
    if (candidate.endAt && !validInstant(candidate.endAt)) {
      warnings.push(`${candidate.sourcePageUrl}: invalid event end date was ignored.`);
      candidate.endAt = null;
    }
    const instant = new Date(candidate.startAt);
    const isoStart = Number.isNaN(instant.getTime()) ? candidate.startAt : instant.toISOString();
    const identity = `${candidate.sourceEventUrl}|${isoStart}`;
    const fallbackIdentity = `${normalizeComparable(candidate.title)}|${isoStart}|${normalizeComparable(candidate.venueText)}`;
    const prior = unique.get(identity) ?? unique.get(fallbackIdentity);
    if (prior) {
      prior.sourceExternalId ??= candidate.sourceExternalId;
      prior.sourceIdentityEvidenceRef ??= candidate.sourceIdentityEvidenceRef;
      prior.timezone ??= candidate.timezone;
      prior.endAt ??= candidate.endAt;
      prior.venueText ??= candidate.venueText;
      if (!prior.performers.length) prior.performers = candidate.performers;
      prior.ticketUrl ??= candidate.ticketUrl;
      prior.ticketDomain ??= candidate.ticketDomain;
      prior.eventImageUrl ??= candidate.eventImageUrl;
      continue;
    }
    unique.set(candidate.sourceEventUrl === candidate.sourcePageUrl ? fallbackIdentity : identity, candidate);
  }
  for (const event of unique.values()) {
    event.sourceFingerprint = createHash("sha256").update(JSON.stringify({
      sourceEventUrl: event.sourceEventUrl, sourceExternalId: event.sourceExternalId ?? null,
      title: normalizeComparable(event.title), startAt: new Date(event.startAt).toISOString(),
      endAt: event.endAt ? new Date(event.endAt).toISOString() : null, timezone: event.timezone,
      venue: normalizeComparable(event.venueText), performers: event.performers.map(normalizeComparable),
      ticketUrl: event.ticketUrl, eventImageUrl: event.eventImageUrl,
    })).digest("hex");
    const source = documents.find((document) => document.url === event.sourcePageUrl);
    if (source) evidenceRefs.push(`source:${source.sourceHash}:event:${event.sourceFingerprint.slice(0, 16)}`);
  }
  return { eventCandidates: [...unique.values()], warnings: [...new Set(warnings)], evidenceRefs: [...new Set(evidenceRefs)] };
}

function blankEvent(title: string, startAt: string, eventUrl: string, document: FetchedDocument): EventEvidence {
  return {
    title, sourceEventUrl: eventUrl, sourcePageUrl: document.url, venueText: null,
    startAt, endAt: null, timezone: null, eventStatus: null, description: null,
    organiser: null, performers: [], sourceCategory: null, ticketUrl: null,
    ticketDomain: null, priceText: null, ageRestriction: null, eventImageUrl: null,
    sourceFingerprint: "", observedAt: document.observedAt, state: "DISCOVERED", confidence: null,
  };
}

function identityRef(sourceHash: string, kind: "html" | "ics", identity: string) {
  return `source:${sourceHash}:${kind}:${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`;
}
