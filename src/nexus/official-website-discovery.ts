import { createHash } from "node:crypto";
import {
  CONTRACTS,
  validateOfficialWebsiteDiscoveryRequest,
  validateOfficialWebsiteDiscoveryResult,
  validateSourceDiscoveryResult,
  type CONTACT_STATUSES,
  type OfficialWebsiteDiscoveryRequest,
  type OfficialWebsiteDiscoveryStatus,
  type SourceExtractor,
  type WEBSITE_STATUSES,
} from "./contracts.ts";
import { executeSourceDiscoveryRequest, InMemoryNexusResultStore, type NexusResultStore } from "./executor.ts";
import { businessEmail, isSocialUrl, verifyFirstPartyIdentity } from "./public-web.ts";
import { crawlVerifiedSource, extractFromFetchedDocuments, type CrawlBudget, type FetchLike, type ResolveHost } from "./source-discovery/crawler.ts";
import type { CachedDocument, DocumentCache, FetchedDocument } from "./source-discovery/types.ts";

/**
 * OFFICIAL_WEBSITE_DISCOVERY runs ahead of the first-party crawler.
 * It has no Google Places dependency by construction: a held Place ID is identity context only.
 * A search result is never an official website until first-party identity verification proves it.
 */

export type PublicWebSearchResult = { url: string; title?: string | null; snippet?: string | null };
export type PublicWebSearchCostModel = { kind: "ZERO_INCREMENTAL" | "METERED"; currency: string; amountPerCall: number };
export type PublicWebSearchProvider = {
  id: string;
  costModel: PublicWebSearchCostModel;
  search(input: { query: string; country: "GB" | "ZA"; maxResults: number }): Promise<PublicWebSearchResult[]>;
};

/**
 * No web-search provider is approved at zero incremental cost. The only search capability in this
 * repository is the metered OpenAI web_search tool, which this lane must not use as a substitute.
 */
export function configuredPublicWebSearchProvider(): PublicWebSearchProvider | null {
  return null;
}

export type OfficialWebsiteDiscoveryOptions = {
  searchProvider?: PublicWebSearchProvider | null;
  fetchImpl?: FetchLike;
  resolveHost?: ResolveHost;
  now?: () => string;
  verificationBudget?: Partial<CrawlBudget>;
  sourceDiscoveryBudget?: Partial<CrawlBudget>;
  maxSearchCalls?: number;
  maxCandidates?: number;
  maxResultsPerQuery?: number;
};

export const OFFICIAL_WEBSITE_DISCOVERY_EXECUTION_VERSION = "official-website-discovery-v1";

const VERIFICATION_BUDGET: CrawlBudget = { maxPages: 2, maxRequests: 4, maxBytesPerResponse: 500_000, maxRedirects: 2, maxRetries: 1, timeoutMs: 8_000, minRequestDelayMs: 0 };
const SOURCE_DISCOVERY_BUDGET: CrawlBudget = { maxPages: 6, maxRequests: 12, maxBytesPerResponse: 1_000_000, maxRedirects: 3, maxRetries: 1, timeoutMs: 10_000, minRequestDelayMs: 250 };
const HANDOFF_EXTRACTORS: SourceExtractor[] = ["IDENTITY", "PUBLIC_CONTACT", "VENUE_FACTS", "IMAGE_CANDIDATES"];

type RejectionCategory = "SOCIAL_PROFILE" | "MAPS_OR_SEARCH_ENGINE" | "DIRECTORY" | "TICKETING" | "TRAVEL_OR_BOOKING_PLATFORM" | "REVIEW_SITE" | "AGGREGATOR" | "CACHED_OR_MIRRORED";
const REJECTED_HOSTS: Record<RejectionCategory, string[]> = {
  SOCIAL_PROFILE: ["facebook.com", "fb.com", "instagram.com", "tiktok.com", "linkedin.com", "twitter.com", "x.com", "youtube.com", "youtu.be", "linktr.ee", "pinterest.com", "threads.net", "snapchat.com", "wa.me", "whatsapp.com"],
  MAPS_OR_SEARCH_ENGINE: ["goo.gl", "g.page", "bing.com", "duckduckgo.com", "yahoo.com", "apple.com", "waze.com", "here.com", "openstreetmap.org", "mapquest.com"],
  DIRECTORY: ["yell.com", "thomsonlocal.com", "192.com", "cylex-uk.co.uk", "cylex.co.za", "hotfrog.co.uk", "hotfrog.co.za", "scoot.co.uk", "freeindex.co.uk", "brownbook.net", "foursquare.com", "yelp.com", "yelp.co.uk", "brabys.com", "yellowpages.co.za", "sa-venues.com", "snupit.co.za", "localbusinesses.co.za", "bizcommunity.com", "infobel.com", "cybo.com", "companieshouse.gov.uk", "find-and-update.company-information.service.gov.uk", "endole.co.uk", "opencorporates.com", "bark.com", "hireaspace.co.uk", "tagvenue.com", "venuedirectory.com", "venuescanner.com", "headbox.com", "coolplaces.co.uk", "hitched.co.uk", "bridebook.com", "confetti.co.uk", "venuefinder.com", "hirespace.com", "venuelist.co.za", "weddingvenues.co.za", "conference-venues.co.za", "eventective.com", "partyvenues.co.za", "uniquevenues.co.uk", "squaremeal.co.uk", "designmynight.com", "zomato.com", "opentable.co.uk", "opentable.com", "dineplan.com"],
  TICKETING: ["eventbrite.com", "eventbrite.co.uk", "eventbrite.co.za", "ticketmaster.co.uk", "ticketmaster.com", "seetickets.com", "skiddle.com", "dice.fm", "ticketweb.uk", "gigantic.com", "fatsoma.com", "ents24.com", "songkick.com", "bandsintown.com", "quicket.co.za", "computicket.com", "webtickets.co.za", "howler.co.za", "tixsa.co.za", "plankton.mobi", "ticketpro.co.za", "stubhub.com", "stubhub.co.uk", "viagogo.com", "twickets.live", "allevents.in", "meetup.com", "residentadvisor.net", "ra.co", "wegottickets.com", "ticketsource.co.uk"],
  TRAVEL_OR_BOOKING_PLATFORM: ["booking.com", "expedia.com", "expedia.co.uk", "hotels.com", "airbnb.com", "airbnb.co.uk", "airbnb.co.za", "agoda.com", "trivago.com", "trivago.co.uk", "lastminute.com", "laterooms.com", "kayak.com", "kayak.co.uk", "lekkeslaap.co.za", "travelground.com", "safarinow.com", "hostelworld.com", "trip.com"],
  REVIEW_SITE: ["tripadvisor.com", "tripadvisor.co.uk", "tripadvisor.co.za", "trustpilot.com", "reviews.io", "hellopeter.com", "feefo.com"],
  AGGREGATOR: ["wikipedia.org", "wikiwand.com", "wikidata.org", "timeout.com", "visitlondon.com", "visitbritain.com", "southafrica.net", "whatsonstage.com", "list.co.uk", "designmynight.com", "happyfresh.co.za", "medium.com", "blogspot.com", "wordpress.com", "reddit.com", "quora.com"],
  CACHED_OR_MIRRORED: ["webcache.googleusercontent.com", "cc.bingj.com", "archive.org", "archive.ph", "archive.today", "translate.goog"],
};
const EVENT_DETAIL_PATH = /\/(?:events?|tickets?|whats-?on|gigs?|shows?|listings?|e)\/[^/]+/i;
const GENERIC_NAME_TOKENS = new Set(["the", "and", "venue", "venues", "grand", "hall", "halls", "club", "barn", "hotel", "hotels", "conference", "conferences", "centre", "center", "room", "rooms", "house", "lodge", "manor", "estate", "farm", "inn", "arms", "bar", "lounge", "studio", "studios", "event", "events", "function", "functions", "park", "gardens", "garden", "court", "place", "spa", "country", "city", "town", "village", "community", "church", "theatre", "theater", "arena", "pavilion", "suite", "suites", "space", "spaces", "loft", "warehouse", "boutique", "guest", "guesthouse", "resort", "retreat", "restaurant", "cafe", "social", "sports", "golf", "cricket", "rugby", "football", "bowls", "royal", "old", "new"]);
const COUNTRY_NAMES = { GB: "United Kingdom", ZA: "South Africa" } as const;

function nowOf(options: OfficialWebsiteDiscoveryOptions) { return options.now?.() ?? new Date().toISOString(); }
function normalise(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function hash(value: string, length = 16) { return createHash("sha256").update(value).digest("hex").slice(0, length); }
function versionedUuid(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16]!, 16) % 4]!;
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}
function bareHost(value: string) { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); }
function hostMatches(host: string, domain: string) { return host === domain || host.endsWith(`.${domain}`); }

export function distinctiveNameTokens(name: string) {
  return normalise(name).split(/\s+/).filter((token) => token.length > 2 && !GENERIC_NAME_TOKENS.has(token));
}
export function isGenericVenueName(name: string) { return distinctiveNameTokens(name).length === 0; }

export function candidateRejection(value: string): RejectionCategory | "INVALID_URL" | null {
  let parsed: URL;
  try { parsed = new URL(value); } catch { return "INVALID_URL"; }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return "INVALID_URL";
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":") || !host.includes(".")) return "INVALID_URL";
  if (/(?:^|\.)google\.[a-z.]+$/.test(host) || host.endsWith(".googleusercontent.com") || host === "maps.app.goo.gl") return host.startsWith("webcache.") ? "CACHED_OR_MIRRORED" : "MAPS_OR_SEARCH_ENGINE";
  if (isSocialUrl(parsed.toString())) return "SOCIAL_PROFILE";
  for (const [category, domains] of Object.entries(REJECTED_HOSTS) as Array<[RejectionCategory, string[]]>) {
    if (domains.some((domain) => hostMatches(host, domain))) return category;
  }
  return null;
}

function rawPostcodeOf(address: string | null, country: "GB" | "ZA") {
  if (!address) return null;
  const match = country === "GB" ? address.match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i) : address.match(/\b\d{4}\b(?=[^\d]*(?:south africa)?\s*$)/i);
  return match ? match[0] : null;
}
function postcodeOf(address: string | null, country: "GB" | "ZA") {
  const raw = rawPostcodeOf(address, country);
  return raw ? normalise(raw).replace(/\s+/g, "") : null;
}
function streetLineOf(address: string | null) {
  const first = address?.split(",")[0]?.trim();
  return first && /\d/.test(first) && /[a-z]{3,}/i.test(first) ? normalise(first) : null;
}
function addressCorroborated(identityFacts: Array<{ fieldName: string; value: unknown }>, heldAddress: string | null, country: "GB" | "ZA") {
  const siteAddresses = identityFacts.filter((item) => item.fieldName === "address" && typeof item.value === "string").map((item) => normalise(item.value as string));
  if (!siteAddresses.length || !heldAddress) return false;
  const postcode = postcodeOf(heldAddress, country);
  const street = streetLineOf(heldAddress);
  return siteAddresses.some((value) => (postcode && value.replace(/\s+/g, "").includes(postcode)) || (street && value.includes(street)));
}

function searchQueries(request: OfficialWebsiteDiscoveryRequest, heldAddress: string | null) {
  const { venueName, locality, administrativeRegion, country } = request.identity;
  const queries = [`"${venueName}" "${locality}" "${COUNTRY_NAMES[country]}" official website`];
  const postcode = rawPostcodeOf(heldAddress, country);
  const street = heldAddress?.split(",")[0]?.trim();
  if (postcode) queries.push(`"${venueName}" "${postcode}"`);
  else if (street && /\d/.test(street)) queries.push(`"${venueName}" "${street}" "${locality}"`);
  else if (administrativeRegion) queries.push(`"${venueName}" "${locality}" "${administrativeRegion}"`);
  return queries;
}

type Candidate = { url: string; origin: string | null; source: "PUBLIC_WEB_SEARCH" | "STORED_GOOGLE_EVIDENCE"; rank: number; state: "SELECTED" | "REJECTED" | "UNVERIFIED" | "NOT_EVALUATED"; reasons: string[]; score: number };

function candidateFrom(result: PublicWebSearchResult, rank: number, name: string): Candidate {
  const rejection = candidateRejection(result.url);
  if (rejection) return { url: result.url.slice(0, 4096), origin: null, source: "PUBLIC_WEB_SEARCH", rank, state: "REJECTED", reasons: [rejection], score: 0 };
  const parsed = new URL(result.url);
  parsed.protocol = "https:";
  const origin = `${parsed.origin}/`;
  const reasons: string[] = [];
  let score = 0;
  const host = normalise(bareHost(origin)).replace(/\s+/g, "");
  if (distinctiveNameTokens(name).some((token) => token.length >= 4 && host.includes(token))) { score += 2; reasons.push("DOMAIN_NAME_ALIGNMENT"); }
  if (result.title && distinctiveNameTokens(name).every((token) => normalise(result.title!).includes(token))) { score += 1; reasons.push("TITLE_NAME_ALIGNMENT"); }
  if (EVENT_DETAIL_PATH.test(parsed.pathname)) { score -= 2; reasons.push("EVENT_DETAIL_PATH_DEPRIORITISED"); }
  return { url: result.url.slice(0, 4096), origin, source: "PUBLIC_WEB_SEARCH", rank, state: "NOT_EVALUATED", reasons, score };
}

function memoryDocumentCache(documents: FetchedDocument[]): DocumentCache {
  const values = new Map<string, CachedDocument>(documents.map((document) => [document.url, { ...document, etag: document.etag ?? null, lastModified: document.lastModified ?? null }]));
  return { async get(url) { return values.get(url) ?? null; }, async set(document) { values.set(document.url, document); } };
}

type Verification = { candidate: Candidate; finalUrl: string; documents: FetchedDocument[]; path: string | null; signals: string[] };

export async function executeOfficialWebsiteDiscovery(input: unknown, options: OfficialWebsiteDiscoveryOptions = {}, store: NexusResultStore = new InMemoryNexusResultStore()) {
  const request = validateOfficialWebsiteDiscoveryRequest(input);
  const storeKey = versionedUuid(`nexus-official-website-discovery:${OFFICIAL_WEBSITE_DISCOVERY_EXECUTION_VERSION}:${request.idempotencyKey}`);
  const prior = await store.get(storeKey);
  if (prior && prior.retryable !== true) return prior;

  const observedAt = nowOf(options);
  const { identity, heldEvidence } = request;
  const { resources, nexus, storedGoogle } = heldEvidence;
  const heldAddress = identity.formattedAddress ?? storedGoogle.formattedAddress;
  const unknowns: string[] = [];
  const evidenceRefs: string[] = [];
  const candidates: Candidate[] = [];
  const search = { provider: null as string | null, costModel: null as PublicWebSearchCostModel["kind"] | null, queries: [] as string[], callCount: 0, returnedCandidateUrls: [] as string[], cost: { currency: request.costCeiling.currency, amount: 0 } };
  const crawl = { verificationCrawls: 0, sourceDiscoveryCrawls: 0, requestCount: 0, blocked: 0, unavailable: 0 };
  let officialWebsite: { url: string; source: "RESOURCES_HELD" | "NEXUS_VERIFIED" | "STORED_GOOGLE_EVIDENCE_VERIFIED" | "PUBLIC_WEB_SEARCH_VERIFIED"; verificationPath: string | null; verificationSignals: string[]; evidenceRef: string } | null = null;
  const publicContacts: Array<{ type: "EMAIL" | "PHONE" | "CONTACT_FORM" | "WHATSAPP" | "BUSINESS_MESSAGING"; value: string; source: "RESOURCES_HELD" | "NEXUS_VERIFIED" | "STORED_GOOGLE_EVIDENCE" | "VERIFIED_FIRST_PARTY_SITE"; sourceUrl: string | null; evidenceRef: string }> = [];
  let sourceDiscovery: ReturnType<typeof validateSourceDiscoveryResult> | null = null;
  let websiteStatus: typeof WEBSITE_STATUSES[number] = "NOT_REQUIRED";
  let contactStatus: typeof CONTACT_STATUSES[number] = "NOT_ATTEMPTED";
  let retryable = false;

  const finish = async () => {
    const status: OfficialWebsiteDiscoveryStatus = websiteStatus === "OFFICIAL_WEBSITE_DISCOVERED_AND_VERIFIED" && contactStatus !== "NOT_ATTEMPTED"
      ? contactStatus as OfficialWebsiteDiscoveryStatus
      : websiteStatus === "NOT_REQUIRED" ? "HELD_CONTACT_REUSED" : websiteStatus;
    const result = validateOfficialWebsiteDiscoveryResult({
      contractVersion: CONTRACTS.OFFICIAL_WEBSITE_DISCOVERY_RESULT,
      requestId: request.requestId,
      idempotencyKey: request.idempotencyKey,
      subject: request.subject,
      status,
      websiteStatus,
      contactStatus,
      officialWebsite,
      publicContacts,
      candidates: candidates.map(({ score: _score, ...item }) => item),
      search,
      crawl,
      googlePlacesCalls: 0,
      providerUsage: [
        { provider: "PUBLIC_WEB_SEARCH", callCount: search.callCount, purpose: "OFFICIAL_WEBSITE_DISCOVERY_SEARCH", cost: search.cost },
        { provider: "PUBLIC_WEB", callCount: crawl.verificationCrawls + crawl.sourceDiscoveryCrawls, purpose: "OFFICIAL_WEBSITE_VERIFICATION_AND_SOURCE_DISCOVERY", cost: { currency: request.costCeiling.currency, amount: 0 } },
        { provider: "GOOGLE_PLACES", callCount: 0, purpose: "NOT_AUTHORISED_FOR_OFFICIAL_WEBSITE_DISCOVERY", cost: null },
      ],
      costSummary: search.cost,
      sourceDiscovery,
      unknowns: [...new Set(unknowns)],
      evidenceRefs: [...new Set(evidenceRefs)],
      retryable,
      observedAt,
    });
    await store.set(storeKey, result as unknown as Record<string, unknown>);
    return result;
  };

  // 1. Resources already holds a usable route.
  if (resources.website && !isSocialUrl(resources.website)) {
    const ref = resources.evidenceRef ?? `resources:${hash(resources.website)}`;
    officialWebsite = { url: resources.website, source: "RESOURCES_HELD", verificationPath: null, verificationSignals: [], evidenceRef: ref };
    evidenceRefs.push(ref);
    websiteStatus = "HELD_WEBSITE_REUSED";
  }
  if (resources.phone || resources.enquiryRoute) {
    const ref = resources.evidenceRef ?? `resources:${hash(`${resources.phone}:${resources.enquiryRoute}`)}`;
    if (resources.phone) publicContacts.push({ type: "PHONE", value: resources.phone, source: "RESOURCES_HELD", sourceUrl: null, evidenceRef: ref });
    if (resources.enquiryRoute) publicContacts.push({ type: "CONTACT_FORM", value: resources.enquiryRoute, source: "RESOURCES_HELD", sourceUrl: resources.enquiryRoute, evidenceRef: ref });
    evidenceRefs.push(ref);
    contactStatus = "HELD_CONTACT_REUSED";
  }
  if (officialWebsite || publicContacts.length) return finish();

  // 2. Nexus/AIRE already holds verified first-party evidence. No re-crawl of stored evidence.
  if (nexus.verifiedOfficialWebsite) {
    officialWebsite = { url: nexus.verifiedOfficialWebsite, source: "NEXUS_VERIFIED", verificationPath: null, verificationSignals: [], evidenceRef: nexus.evidenceRef! };
    websiteStatus = "HELD_WEBSITE_REUSED";
    evidenceRefs.push(nexus.evidenceRef!);
  }
  if (nexus.publicPhone) publicContacts.push({ type: "PHONE", value: nexus.publicPhone, source: "NEXUS_VERIFIED", sourceUrl: null, evidenceRef: nexus.evidenceRef! });
  if (nexus.publicEmail) publicContacts.push({ type: "EMAIL", value: nexus.publicEmail, source: "NEXUS_VERIFIED", sourceUrl: null, evidenceRef: nexus.evidenceRef! });
  if (publicContacts.length) { contactStatus = "HELD_CONTACT_REUSED"; evidenceRefs.push(nexus.evidenceRef!); }
  if (officialWebsite || publicContacts.length) return finish();

  // 3. Stored Google evidence is read, never refreshed. A stored phone is a held route; a stored
  //    websiteUri is only a candidate and still needs first-party verification.
  if (storedGoogle.phone) {
    publicContacts.push({ type: "PHONE", value: storedGoogle.phone, source: "STORED_GOOGLE_EVIDENCE", sourceUrl: null, evidenceRef: storedGoogle.evidenceRef! });
    evidenceRefs.push(storedGoogle.evidenceRef!);
    contactStatus = "HELD_CONTACT_REUSED";
    return finish();
  }

  const verificationContext = {
    locality: identity.locality,
    existingFacts: [
      ...(identity.placeId && identity.placeIdEvidenceRef ? [{ fieldName: "placeId", value: identity.placeId, evidenceRef: identity.placeIdEvidenceRef }] : []),
      ...(storedGoogle.displayName ? [{ fieldName: "placeName", value: storedGoogle.displayName, evidenceRef: storedGoogle.evidenceRef }] : []),
      ...(heldAddress ? [{ fieldName: "formattedAddress", value: heldAddress, evidenceRef: identity.formattedAddress ? null : storedGoogle.evidenceRef }] : []),
    ],
  };
  const genericName = isGenericVenueName(identity.venueName);
  const crawlAllowed = request.providerAllowances.includes("PUBLIC_WEB");
  const verified: Verification[] = [];
  let nameAligned = 0;
  let evaluated = 0;

  const verifyCandidate = async (candidate: Candidate) => {
    if (!crawlAllowed) { candidate.reasons.push("PUBLIC_WEB_NOT_AUTHORISED"); return; }
    crawl.verificationCrawls += 1;
    let output;
    try {
      output = await crawlVerifiedSource({ verifiedUrl: candidate.origin!, requestedExtractors: ["IDENTITY"], budget: { ...VERIFICATION_BUDGET, ...options.verificationBudget }, subjectType: request.subject.entityType, fetchImpl: options.fetchImpl, resolveHost: options.resolveHost });
    } catch {
      crawl.unavailable += 1;
      candidate.state = "UNVERIFIED";
      candidate.reasons.push("CRAWL_UNAVAILABLE");
      return;
    }
    crawl.requestCount += output.stats.requestCount;
    if (!output.documents.length) {
      if (output.stats.status === "BLOCKED") { crawl.blocked += 1; candidate.reasons.push("CRAWL_BLOCKED"); }
      else { crawl.unavailable += 1; candidate.reasons.push("CRAWL_UNAVAILABLE"); }
      candidate.state = "UNVERIFIED";
      return;
    }
    evaluated += 1;
    if (candidateRejection(output.finalUrl)) { candidate.state = "REJECTED"; candidate.reasons.push("REDIRECTED_TO_NON_FIRST_PARTY_HOST"); return; }
    const extracted = extractFromFetchedDocuments(output.documents, ["IDENTITY"]);
    const verification = verifyFirstPartyIdentity(identity.venueName, verificationContext, extracted.identityFacts);
    if (verification.nameSignal) nameAligned += 1;
    if (!verification.verified) {
      candidate.state = verification.nameSignal ? "UNVERIFIED" : "REJECTED";
      candidate.reasons.push(verification.nameSignal ? "NAME_ALIGNED_WITHOUT_LOCATION_OR_IDENTITY_PROOF" : "NO_SAME_ENTITY_IDENTITY_EVIDENCE");
      return;
    }
    if (genericName && !addressCorroborated(extracted.identityFacts, heldAddress, identity.country)) {
      candidate.state = "UNVERIFIED";
      candidate.reasons.push("GENERIC_NAME_REQUIRES_ADDRESS_CORROBORATION");
      return;
    }
    candidate.reasons.push(`VERIFIED_${verification.path}`);
    verified.push({ candidate, finalUrl: output.finalUrl, documents: output.documents, path: verification.path, signals: verification.signals });
  };

  if (storedGoogle.websiteUri) {
    const rejection = candidateRejection(storedGoogle.websiteUri);
    const candidate: Candidate = rejection
      ? { url: storedGoogle.websiteUri, origin: null, source: "STORED_GOOGLE_EVIDENCE", rank: 0, state: "REJECTED", reasons: [rejection], score: 0 }
      : { url: storedGoogle.websiteUri, origin: `${new URL(storedGoogle.websiteUri).origin}/`, source: "STORED_GOOGLE_EVIDENCE", rank: 0, state: "NOT_EVALUATED", reasons: [], score: 0 };
    candidates.push(candidate);
    if (!rejection) await verifyCandidate(candidate);
  }

  // 4. Official website search, only when nothing is held or the stored candidate failed.
  if (!verified.length) {
    const provider = request.providerAllowances.includes("PUBLIC_WEB_SEARCH") ? options.searchProvider ?? null : null;
    if (!request.providerAllowances.includes("PUBLIC_WEB_SEARCH")) unknowns.push("PUBLIC_WEB_SEARCH is not authorised for this request; no search was run and no other provider substituted.");
    else if (!provider) unknowns.push("No approved public web search provider is configured; no search was run and Google Places was not used as a fallback.");
    if (provider) {
      search.provider = provider.id;
      search.costModel = provider.costModel.kind;
      const maxCalls = Math.max(0, Math.min(3, options.maxSearchCalls ?? 2));
      const maxCandidates = Math.max(1, Math.min(5, options.maxCandidates ?? 3));
      const seen = new Set(candidates.map((item) => item.origin).filter(Boolean));
      let providerFailed = false;
      for (const query of searchQueries(request, heldAddress).slice(0, maxCalls)) {
        const perCall = provider.costModel.kind === "ZERO_INCREMENTAL" ? 0 : provider.costModel.amountPerCall;
        if (search.cost.amount + perCall > request.costCeiling.amount) { unknowns.push("The next search call would exceed the request cost ceiling; it was not made."); break; }
        search.queries.push(query);
        search.callCount += 1;
        search.cost.amount += perCall;
        let results: PublicWebSearchResult[];
        try {
          results = (await provider.search({ query, country: identity.country, maxResults: Math.max(1, Math.min(20, options.maxResultsPerQuery ?? 10)) })).slice(0, 20);
        } catch {
          providerFailed = true;
          unknowns.push("The public web search provider failed safely; no candidate was retained from it.");
          break;
        }
        const fresh: Candidate[] = [];
        results.forEach((item, index) => {
          if (typeof item?.url !== "string") return;
          search.returnedCandidateUrls.push(item.url.slice(0, 4096));
          const candidate = candidateFrom(item, index + 1, identity.venueName);
          if (candidate.origin && seen.has(candidate.origin)) return;
          if (candidate.origin) seen.add(candidate.origin);
          candidates.push(candidate);
          if (candidate.state === "NOT_EVALUATED") fresh.push(candidate);
        });
        const ranked = fresh.sort((left, right) => right.score - left.score || left.rank - right.rank).slice(0, maxCandidates);
        for (const candidate of ranked) await verifyCandidate(candidate);
        if (ranked.length) break;
      }
      if (providerFailed && !search.returnedCandidateUrls.length) { websiteStatus = "SEARCH_PROVIDER_UNAVAILABLE"; retryable = true; return finish(); }
    } else if (!candidates.length || !evaluated) {
      websiteStatus = "SEARCH_PROVIDER_UNAVAILABLE";
      retryable = request.providerAllowances.includes("PUBLIC_WEB_SEARCH");
      return finish();
    }
  }

  // 5-6. Only a single verified first-party origin becomes the official website.
  const verifiedOrigins = [...new Set(verified.map((item) => new URL(item.finalUrl).origin))];
  if (verifiedOrigins.length > 1) {
    for (const item of verified) item.candidate.state = "UNVERIFIED";
    websiteStatus = "WEBSITE_CANDIDATES_AMBIGUOUS";
    unknowns.push("More than one candidate site verified for this identity; none was selected.");
    return finish();
  }
  if (!verified.length) {
    if (!crawlAllowed && candidates.some((item) => item.state === "NOT_EVALUATED")) { websiteStatus = "CRAWL_UNAVAILABLE"; unknowns.push("PUBLIC_WEB is not authorised; candidates cannot be verified and none is treated as official."); }
    else if (nameAligned > 0) { websiteStatus = "WEBSITE_CANDIDATES_AMBIGUOUS"; unknowns.push("A candidate aligned by name but lacked location or identity proof; it stays unresolved."); }
    else if (!evaluated && crawl.blocked) websiteStatus = "CRAWL_BLOCKED";
    else if (!evaluated && crawl.unavailable) { websiteStatus = "CRAWL_UNAVAILABLE"; retryable = true; }
    else websiteStatus = "NO_CREDIBLE_WEBSITE_FOUND";
    return finish();
  }

  const selected = verified[0]!;
  selected.candidate.state = "SELECTED";
  const websiteRef = `owd:${request.requestId}:website:${hash(`${selected.finalUrl}:${selected.documents.map((item) => item.sourceHash).join(":")}`, 24)}`;
  officialWebsite = { url: selected.finalUrl, source: selected.candidate.source === "STORED_GOOGLE_EVIDENCE" ? "STORED_GOOGLE_EVIDENCE_VERIFIED" : "PUBLIC_WEB_SEARCH_VERIFIED", verificationPath: selected.path, verificationSignals: selected.signals, evidenceRef: websiteRef };
  evidenceRefs.push(websiteRef);
  websiteStatus = "OFFICIAL_WEBSITE_DISCOVERED_AND_VERIFIED";

  // 7. Hand the verified URL to the existing source-discovery crawler, reusing verification documents.
  crawl.sourceDiscoveryCrawls += 1;
  const handoffSeed = `${request.idempotencyKey}:${selected.finalUrl}`;
  const handoff = await executeSourceDiscoveryRequest({
    contractVersion: CONTRACTS.SOURCE_DISCOVERY_REQUEST,
    discoveryRequestId: versionedUuid(`owd-source-discovery-request:${handoffSeed}`),
    idempotencyKey: versionedUuid(`owd-source-discovery-idempotency:${handoffSeed}`),
    correlationId: request.correlationId,
    originatingProduct: request.originatingProduct,
    subjectReference: request.subject,
    verifiedSourceUrl: selected.finalUrl,
    requestedExtractors: HANDOFF_EXTRACTORS,
    freshnessRequirements: { maxAgeHours: 24 },
    crawlBudget: { ...SOURCE_DISCOVERY_BUDGET, ...options.sourceDiscoveryBudget },
    existingEvidenceRefs: [websiteRef],
    requestedBy: request.requestedBy,
    createdAt: observedAt,
  }, { fetchImpl: options.fetchImpl, resolveHost: options.resolveHost, now: options.now, documentCache: memoryDocumentCache(selected.documents), onCrawlObservability: () => undefined }, store);
  sourceDiscovery = validateSourceDiscoveryResult(handoff);
  crawl.requestCount += sourceDiscovery.crawl.requestCount;
  evidenceRefs.push(...sourceDiscovery.evidenceRefs);
  if (sourceDiscovery.crawl.status === "BLOCKED") { crawl.blocked += 1; contactStatus = "CRAWL_BLOCKED"; return finish(); }
  if (sourceDiscovery.crawl.status === "FAILED") { crawl.unavailable += 1; contactStatus = "CRAWL_UNAVAILABLE"; retryable = sourceDiscovery.crawl.retryable; return finish(); }

  const origin = new URL(sourceDiscovery.source.finalUrl).origin;
  for (const contact of sourceDiscovery.publicContacts) {
    let sameOrigin = false;
    try { sameOrigin = new URL(contact.sourceUrl).origin === origin; } catch { sameOrigin = false; }
    if (!sameOrigin) continue;
    if (contact.type === "EMAIL" && !businessEmail(contact.value)) continue;
    if (contact.type === "CONTACT_FORM") { try { if (new URL(contact.value).origin !== origin) continue; } catch { continue; } }
    if (!["EMAIL", "PHONE", "CONTACT_FORM"].includes(contact.type)) continue;
    if (publicContacts.some((item) => item.type === contact.type && item.value === contact.value)) continue;
    publicContacts.push({ type: contact.type, value: contact.value, source: "VERIFIED_FIRST_PARTY_SITE", sourceUrl: contact.sourceUrl, evidenceRef: contact.evidenceRef ?? websiteRef });
  }
  contactStatus = publicContacts.length ? "VERIFIED_SITE_PUBLIC_CONTACT_FOUND" : "VERIFIED_SITE_NO_PUBLIC_CONTACT";
  if (!publicContacts.length) unknowns.push("The verified first-party site published no bounded business email, phone, or same-origin contact form.");
  return finish();
}
