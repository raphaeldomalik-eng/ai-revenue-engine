import { createHash } from "node:crypto";
import { tags } from "../html.ts";
import { canonicalHttpsUrl } from "../network.ts";
import type { FetchedDocument } from "../types.ts";

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
};

type NormalizedEvent = { event: EventEvidence; identity: string };

function normalizeEvent(node: Record<string, unknown>, document: FetchedDocument): NormalizedEvent | null {
  const title = text(node.name);
  const startAt = text(node.startDate);
  if (!title || !startAt) return null;
  const location = record(node.location);
  const offers = Array.isArray(node.offers) ? record(node.offers[0]) : record(node.offers);
  const explicitEventUrl = jsonUrl(node.url ?? node["@id"], document.url);
  const sourceEventUrl = explicitEventUrl ?? document.url;
  const ticketUrl = jsonUrl(offers.url, document.url);
  const stable = {
    title,
    startAt,
    endAt: text(node.endDate),
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
  const unique = new Map<string, EventEvidence>();
  const warnings: string[] = [];
  const evidenceRefs: string[] = [];
  for (const document of documents) {
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
      const normalized = normalizeEvent(node, document);
      if (!normalized || unique.has(normalized.identity)) continue;
      unique.set(normalized.identity, normalized.event);
      evidenceRefs.push(`source:${document.sourceHash}:event:${normalized.event.sourceFingerprint.slice(0, 16)}`);
    }
  }
  return { eventCandidates: [...unique.values()], warnings: [...new Set(warnings)], evidenceRefs: [...new Set(evidenceRefs)] };
}
