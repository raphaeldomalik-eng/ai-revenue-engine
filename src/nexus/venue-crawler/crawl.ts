import { defaultResolveHost } from "../source-discovery/network.ts";
import { identityProfile, publicContactProfile } from "../source-discovery/extractors/profiles.ts";
import { crawlVerifiedSource, extractFromFetchedDocuments } from "../source-discovery/crawler.ts";
import type { RenderAdapter } from "../source-discovery/render.ts";
import type { CrawlBudget, FetchLike, ResolveHost } from "../source-discovery/types.ts";
import { assertVenueCrawlerDispatch, type VenueCrawlerClassification } from "./dispatch.ts";
import { pageText, structuredVenueFacts, suitabilityFromText, type SuitabilityFact } from "./facts.ts";
import { rankVenueImages, type RankedVenueImage } from "./images.ts";
import { venueResearchProfile } from "./profile.ts";
import { synthesiseVenueCopy, type SupportedSentence } from "./synthesis.ts";

/** Inside the shared crawler's proven 20-page / 40-request envelope, and stops earlier when venue evidence is enough. */
export const VENUE_CRAWLER_BUDGET: CrawlBudget = {
  maxPages: 12,
  maxRequests: 28,
  maxBytesPerResponse: 5_000_000,
  maxRedirects: 5,
  maxRetries: 1,
  timeoutMs: 15_000,
  minRequestDelayMs: 250,
  maxPdfDocuments: 2,
  maxSitemapFetches: 4,
};

const EXTRACTORS = ["IDENTITY", "PUBLIC_CONTACT", "VENUE_FACTS", "IMAGE_CANDIDATES"] as const;

export type VenueCrawlerResult = {
  venueName: string;
  verifiedOfficialUrl: string;
  pagesFetched: string[];
  pageTypes: string[];
  sitemapConsulted: boolean;
  stopReason: string | null;
  renderedPages: number;
  renderNeededButUnavailable: string[];
  spaces: string[];
  capacities: ReturnType<typeof structuredVenueFacts>["capacities"];
  suitability: SuitabilityFact[];
  practical: ReturnType<typeof structuredVenueFacts>["practical"];
  contacts: Array<{ type: string; value: string; reviewRequired: boolean; sourceUrl: string }>;
  images: { hero: RankedVenueImage | null; gallery: RankedVenueImage[]; ownerReviewHero: RankedVenueImage | null; candidates: number; rejected: number; rights: Record<string, number> };
  summary: string;
  description: string;
  support: SupportedSentence[];
  rejectedSentences: string[];
};

function keepSpace(space: string, venueName: string, capacitySpaces: Set<string>) {
  const value = space.trim();
  const lower = value.toLowerCase();
  const venue = venueName.trim().toLowerCase();
  if (!value || lower === venue || venue.includes(lower)) return false;
  if (/^(?:our|the|welcome|amenities|faq'?s?|gallery|weddings?|contact|home|about|customer love)\b/i.test(value)) return false;
  if (capacitySpaces.has(lower)) return true;
  return /\b(?:room|hall|suite|studio|theatre|theater|auditorium|ballroom|boma|terrace|garden|courtyard|boardroom|lounge|barn|chapel|marquee|deck|loft|rooftop)\b/i.test(value);
}

function pageType(url: string): string {
  const path = new URL(url).pathname.toLowerCase();
  if (/\.pdf$/.test(path)) return "document";
  if (/galler|photo|image/.test(path)) return "gallery";
  if (/space|room|hall|suite|studio/.test(path)) return "spaces";
  if (/wedd|confer|meeting|function|party|exhibition|launch/.test(path)) return "event-use";
  if (/facilit|access|cater|park|technical|production/.test(path)) return "practical";
  if (/contact|enquir|book/.test(path)) return "contact";
  if (/about|hire|venue/.test(path)) return "core";
  if (path === "/") return "homepage";
  return "other";
}

export async function crawlVenue(classification: VenueCrawlerClassification, options: {
  budget?: CrawlBudget;
  fetchImpl?: FetchLike;
  resolveHost?: ResolveHost;
  renderAdapter?: RenderAdapter;
  probeImages?: boolean;
  knownDimensions?: Record<string, { width: number; height: number } | null>;
} = {}): Promise<VenueCrawlerResult> {
  assertVenueCrawlerDispatch(classification);
  const official = new URL(classification.verifiedOfficialUrl);
  if (official.protocol === "http:") official.protocol = "https:";
  const crawled = await crawlVerifiedSource({
    verifiedUrl: official.toString(),
    requestedExtractors: [...EXTRACTORS],
    budget: options.budget ?? VENUE_CRAWLER_BUDGET,
    subjectType: "VENUE",
    profiles: [venueResearchProfile(classification.venueName), publicContactProfile({ venueName: classification.venueName }), identityProfile],
    fetchImpl: options.fetchImpl,
    resolveHost: options.resolveHost,
    renderAdapter: options.renderAdapter,
    venueName: classification.venueName,
    emailGoal: false,
  });
  const extracted = extractFromFetchedDocuments(crawled.documents, [...EXTRACTORS]);
  const suitability = crawled.documents.flatMap((document) => document.kind === "PDF" ? [] : suitabilityFromText(pageText(document.body), document.url));
  const uniqueSuitability = suitability.filter((item, index) => suitability.findIndex((other) => other.key === item.key) === index);
  const structured = structuredVenueFacts(extracted.venueFacts);
  const capacitySpaces = new Set(structured.capacities.map((item) => item.space?.trim().toLowerCase()).filter((item): item is string => Boolean(item)));
  structured.spaces = structured.spaces.filter((space) => keepSpace(space, classification.venueName, capacitySpaces));
  const images = await rankVenueImages(extracted.imageCandidates, {
    resolveHost: options.probeImages === false ? undefined : options.resolveHost ?? defaultResolveHost,
    probeLimit: options.probeImages === false ? 0 : 8,
    knownDimensions: options.knownDimensions,
  });
  const copy = synthesiseVenueCopy({
    venueName: classification.venueName,
    locality: classification.locality ?? null,
    region: classification.region ?? null,
    country: classification.country ?? null,
    spaces: structured.spaces,
    capacities: structured.capacities,
    suitability: uniqueSuitability,
    practical: structured.practical,
  });
  const rights: Record<string, number> = {};
  for (const candidate of extracted.imageCandidates) rights[candidate.rightsState] = (rights[candidate.rightsState] ?? 0) + 1;
  return {
    venueName: classification.venueName,
    verifiedOfficialUrl: classification.verifiedOfficialUrl,
    pagesFetched: crawled.documents.map((document) => document.url),
    pageTypes: [...new Set(crawled.documents.map((document) => pageType(document.url)))],
    sitemapConsulted: crawled.observability?.sitemap.consulted ?? false,
    stopReason: crawled.observability?.stopReason ?? null,
    renderedPages: crawled.observability?.renderedPages ?? 0,
    renderNeededButUnavailable: crawled.observability?.renderNeededButUnavailable ?? [],
    spaces: structured.spaces,
    capacities: structured.capacities,
    suitability: uniqueSuitability,
    practical: structured.practical,
    contacts: extracted.publicContacts.map((item) => ({ type: item.type, value: item.value, reviewRequired: item.reviewRequired, sourceUrl: item.sourceUrl })),
    images: { hero: images.hero, gallery: images.gallery, ownerReviewHero: images.ownerReviewHero, candidates: extracted.imageCandidates.length, rejected: images.rejected, rights },
    summary: copy.summary,
    description: copy.description,
    support: copy.support,
    rejectedSentences: copy.rejectedSentences,
  };
}
