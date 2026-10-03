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
  type VENUE_EMAIL_RELATIONSHIPS,
  type WEBSITE_STATUSES,
} from "./contracts.ts";
import { executeSourceDiscoveryRequest, InMemoryNexusResultStore, type NexusResultStore } from "./executor.ts";
import { verifyFirstPartyIdentity } from "./public-web.ts";
import { crawlVerifiedSource, extractFromFetchedDocuments, type CrawlBudget, type FetchLike, type ResolveHost } from "./source-discovery/crawler.ts";
import type { CachedDocument, DocumentCache, FetchedDocument } from "./source-discovery/types.ts";
import { createSerperPublicWebSearchProvider, isPublicWebSearchBudgetExhausted, serperApiKeyFromEnv } from "./search/serper-public-web-search.ts";
import { acceptHeldVenueEmail, acceptVenueEmail, candidateRejection, distinctiveNameTokens, isGenericVenueName, isLabelSplitFragment, registrableDomain } from "./venue-email.ts";

export {
  acceptHeldVenueEmail,
  acceptVenueEmail,
  candidateRejection,
  distinctiveNameTokens,
  isGenericVenueName,
  isLabelSplitFragment,
  registrableDomain,
} from "./venue-email.ts";

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
 * Serper Google Search when SERPER_API_KEY is present. A missing key leaves the provider unavailable.
 * Google Places is not substituted. OpenAI web_search is not used.
 */
export function configuredPublicWebSearchProvider(): PublicWebSearchProvider | null {
  if (!serperApiKeyFromEnv()) return null;
  return createSerperPublicWebSearchProvider();
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

// v3 follows the v4 source-discovery extraction. A stored v2 result embeds the old footer-stripped contacts.
export const OFFICIAL_WEBSITE_DISCOVERY_EXECUTION_VERSION = "official-website-discovery-v3";

// robots.txt and same-site redirects count against maxRequests, and many venue homepages exceed 500 KB;
// the tighter values left verifiable sites with no page to verify.
const VERIFICATION_BUDGET: CrawlBudget = { maxPages: 2, maxRequests: 6, maxBytesPerResponse: 1_000_000, maxRedirects: 2, maxRetries: 1, timeoutMs: 8_000, minRequestDelayMs: 0 };
const SOURCE_DISCOVERY_BUDGET: CrawlBudget = { maxPages: 6, maxRequests: 12, maxBytesPerResponse: 1_000_000, maxRedirects: 3, maxRetries: 1, timeoutMs: 10_000, minRequestDelayMs: 250 };
const HANDOFF_EXTRACTORS: SourceExtractor[] = ["IDENTITY", "PUBLIC_CONTACT", "VENUE_FACTS", "IMAGE_CANDIDATES"];

const EVENT_DETAIL_PATH = /\/(?:events?|tickets?|whats-?on|gigs?|shows?|listings?|e)\/[^/]+/i;
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

const CONTACT_PRIORITY: string[] = ["EMAIL", "PHONE", "CONTACT_FORM"];

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

type CrawledContact = { type: "EMAIL" | "PHONE" | "CONTACT_FORM"; value: string; sourceUrl: string; evidenceRef: string; relationship: typeof VENUE_EMAIL_RELATIONSHIPS[number] | null };

// Only contacts published on the verified site's registrable domain count, in EMAIL > PHONE > CONTACT_FORM order;
// an email must also pass venue-mailbox acceptance.
export function acceptCrawledContacts(result: Pick<ReturnType<typeof validateSourceDiscoveryResult>, "source" | "publicContacts">, venueName: string, fallbackEvidenceRef: string) {
  const siteDomain = registrableDomain(new URL(result.source.finalUrl).hostname);
  const onVerifiedSite = (value: string | null | undefined) => { try { return registrableDomain(new URL(value!).hostname) === siteDomain; } catch { return false; } };
  const contacts: CrawledContact[] = [];
  let rejectedEmails = 0;
  const pageEmails = result.publicContacts.filter((item) => item.type === "EMAIL").map((item) => ({ value: item.value.toLowerCase(), sourceUrl: item.sourceUrl }));
  const ordered = [...result.publicContacts].sort((left, right) => CONTACT_PRIORITY.indexOf(left.type) - CONTACT_PRIORITY.indexOf(right.type));
  for (const contact of ordered) {
    if (!CONTACT_PRIORITY.includes(contact.type) || !onVerifiedSite(contact.sourceUrl)) continue;
    if (contact.reviewRequired) { if (contact.type === "EMAIL") rejectedEmails += 1; continue; }
    let value = contact.value;
    let relationship: CrawledContact["relationship"] = null;
    if (contact.type === "EMAIL") {
      if (isLabelSplitFragment(contact.value, pageEmails.filter((item) => item.sourceUrl === contact.sourceUrl).map((item) => item.value))) { rejectedEmails += 1; continue; }
      const verdict = acceptVenueEmail(contact.value, result.source.finalUrl, venueName);
      if (!verdict.accepted) { rejectedEmails += 1; continue; }
      value = verdict.email;
      relationship = verdict.relationship;
    }
    if (contact.type === "CONTACT_FORM" && !onVerifiedSite(contact.value)) continue;
    if (contacts.some((item) => item.type === contact.type && item.value === value)) continue;
    contacts.push({ type: contact.type as CrawledContact["type"], value, sourceUrl: contact.sourceUrl, evidenceRef: contact.evidenceRef ?? fallbackEvidenceRef, relationship });
  }
  return { contacts, rejectedEmails };
}

type IdentityContext = Parameters<typeof verifyFirstPartyIdentity>[1];

// A site that states the full venue name and the held locality in its own title or heading identifies itself
// as that venue even without a structured address. Description text is not enough.
function namedLocalityOnSite(venueName: string, locality: string | null, identityFacts: Array<{ fieldName: string; value: unknown }>) {
  const place = locality ? normalise(locality) : "";
  const nameTokens = normalise(venueName).split(/\s+/).filter((token) => token.length > 2);
  if (!place || !nameTokens.length) return false;
  const headings = identityFacts.filter((item) => ["siteName", "explicitVenueName"].includes(item.fieldName) && typeof item.value === "string").map((item) => ` ${normalise(item.value as string)} `);
  const named = headings.some((value) => nameTokens.every((token) => value.includes(` ${token} `)));
  return named && headings.some((value) => value.includes(` ${place} `));
}

export function assessWebsiteIdentity(input: { venueName: string; country: "GB" | "ZA"; heldAddress: string | null; context: IdentityContext; finalUrl: string; identityFacts: Array<{ fieldName: string; value: unknown; sourceUrl?: string }> }) {
  if (candidateRejection(input.finalUrl)) return { verified: false, state: "REJECTED" as const, reason: "REDIRECTED_TO_NON_FIRST_PARTY_HOST", path: null, signals: [] as string[], nameSignal: false };
  let verification = verifyFirstPartyIdentity(input.venueName, input.context, input.identityFacts);
  if (!verification.verified && namedLocalityOnSite(input.venueName, input.context.locality ?? null, input.identityFacts)) {
    verification = { verified: true, path: "DIRECT", signals: ["direct venue name", "locality named in first-party title or heading"], nameSignal: true, locationSignal: true };
  }
  if (!verification.verified) {
    return verification.nameSignal
      ? { verified: false, state: "UNVERIFIED" as const, reason: "NAME_ALIGNED_WITHOUT_LOCATION_OR_IDENTITY_PROOF", path: null, signals: [] as string[], nameSignal: true }
      : { verified: false, state: "REJECTED" as const, reason: "NO_SAME_ENTITY_IDENTITY_EVIDENCE", path: null, signals: [] as string[], nameSignal: false };
  }
  if (isGenericVenueName(input.venueName) && !addressCorroborated(input.identityFacts, input.heldAddress, input.country)) {
    return { verified: false, state: "UNVERIFIED" as const, reason: "GENERIC_NAME_REQUIRES_ADDRESS_CORROBORATION", path: null, signals: [] as string[], nameSignal: true };
  }
  return { verified: true, state: "SELECTED" as const, reason: `VERIFIED_${verification.path}`, path: verification.path, signals: verification.signals, nameSignal: verification.nameSignal };
}

// The crawler is HTTPS-only; a held http:// website is tried at the same host over HTTPS, never downgraded.
function heldCandidateOrigin(value: string) {
  return `${new URL(heldCrawlUrl(value)).origin}/`;
}

/** Keep the held path. Collapsing to the origin hid contact pages that only the path linked to. */
function heldCrawlUrl(value: string) {
  const parsed = new URL(value);
  parsed.protocol = "https:";
  parsed.hash = "";
  parsed.username = "";
  parsed.password = "";
  return parsed.toString();
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

type Candidate = { url: string; origin: string | null; source: "RESOURCES_HELD" | "PUBLIC_WEB_SEARCH" | "STORED_GOOGLE_EVIDENCE"; rank: number; state: "SELECTED" | "REJECTED" | "UNVERIFIED" | "NOT_EVALUATED"; reasons: string[]; score: number };

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
  const publicContacts: Array<{ type: "EMAIL" | "PHONE" | "CONTACT_FORM" | "WHATSAPP" | "BUSINESS_MESSAGING"; value: string; source: "RESOURCES_HELD" | "NEXUS_VERIFIED" | "STORED_GOOGLE_EVIDENCE" | "VERIFIED_FIRST_PARTY_SITE"; sourceUrl: string | null; evidenceRef: string; relationship: typeof VENUE_EMAIL_RELATIONSHIPS[number] | null }> = [];
  let sourceDiscovery: ReturnType<typeof validateSourceDiscoveryResult> | null = null;
  let websiteStatus: typeof WEBSITE_STATUSES[number] = "NOT_REQUIRED";
  let contactStatus: typeof CONTACT_STATUSES[number] = "NOT_ATTEMPTED";
  let retryable = false;

  const finish = async () => {
    const contactCrawled = ["VERIFIED_SITE_PUBLIC_CONTACT_FOUND", "VERIFIED_SITE_NO_PUBLIC_CONTACT", "CRAWL_BLOCKED", "CRAWL_UNAVAILABLE"].includes(contactStatus);
    const status: OfficialWebsiteDiscoveryStatus = contactCrawled
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
      guideEmailReady: publicContacts.some((item) => item.type === "EMAIL" && item.relationship !== null),
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

  // 1. Only a genuine venue email already held ends the waterfall. Held websites, phones, forms,
  //    and relay addresses are carried forward as inputs, never as a terminal outcome.
  const heldEmails = [[nexus.publicEmail, "NEXUS_VERIFIED", nexus.evidenceRef], [resources.publicEmail, "RESOURCES_HELD", resources.evidenceRef]] as const;
  for (const [email, source, ref] of heldEmails) {
    if (!email || !ref) continue;
    const verdict = acceptHeldVenueEmail(email);
    if (!verdict.accepted) { unknowns.push(`A held email was not accepted as a venue mailbox (${verdict.reason}).`); continue; }
    if (publicContacts.some((item) => item.type === "EMAIL" && item.value === verdict.email)) continue;
    publicContacts.push({ type: "EMAIL", value: verdict.email, source, sourceUrl: null, evidenceRef: ref, relationship: "HELD_VENUE_EVIDENCE" });
    evidenceRefs.push(ref);
  }
  const heldRoutes = [
    ["PHONE", resources.phone, "RESOURCES_HELD", resources.evidenceRef ?? (resources.phone ? `resources:${hash(resources.phone)}` : null), null],
    ["CONTACT_FORM", resources.enquiryRoute, "RESOURCES_HELD", resources.evidenceRef ?? (resources.enquiryRoute ? `resources:${hash(resources.enquiryRoute)}` : null), resources.enquiryRoute],
    ["PHONE", nexus.publicPhone, "NEXUS_VERIFIED", nexus.evidenceRef, null],
    ["PHONE", storedGoogle.phone, "STORED_GOOGLE_EVIDENCE", storedGoogle.evidenceRef, null],
  ] as const;
  for (const [type, value, source, ref, sourceUrl] of heldRoutes) {
    if (!value || !ref || publicContacts.some((item) => item.type === type && item.value === value)) continue;
    publicContacts.push({ type, value, source, sourceUrl, evidenceRef: ref, relationship: null });
    evidenceRefs.push(ref);
  }
  if (publicContacts.length) contactStatus = "HELD_CONTACT_REUSED";
  if (publicContacts.some((item) => item.type === "EMAIL")) return finish();

  const verificationContext = {
    locality: identity.locality,
    existingFacts: [
      ...(identity.placeId && identity.placeIdEvidenceRef ? [{ fieldName: "placeId", value: identity.placeId, evidenceRef: identity.placeIdEvidenceRef }] : []),
      ...(storedGoogle.displayName ? [{ fieldName: "placeName", value: storedGoogle.displayName, evidenceRef: storedGoogle.evidenceRef }] : []),
      ...(heldAddress ? [{ fieldName: "formattedAddress", value: heldAddress, evidenceRef: identity.formattedAddress ? null : storedGoogle.evidenceRef }] : []),
    ],
  };
  const crawlAllowed = request.providerAllowances.includes("PUBLIC_WEB");
  const verified: Verification[] = [];
  let nameAligned = 0;
  let evaluated = 0;

  const verifyCandidate = async (candidate: Candidate) => {
    if (!crawlAllowed) { candidate.reasons.push("PUBLIC_WEB_NOT_AUTHORISED"); return; }
    crawl.verificationCrawls += 1;
    let output;
    try {
      output = await crawlVerifiedSource({ verifiedUrl: candidate.source === "PUBLIC_WEB_SEARCH" ? candidate.origin! : heldCrawlUrl(candidate.url), requestedExtractors: ["IDENTITY"], budget: { ...VERIFICATION_BUDGET, ...options.verificationBudget }, subjectType: request.subject.entityType, fetchImpl: options.fetchImpl, resolveHost: options.resolveHost });
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
    const extracted = extractFromFetchedDocuments(output.documents, ["IDENTITY"]);
    const assessment = assessWebsiteIdentity({ venueName: identity.venueName, country: identity.country, heldAddress, context: verificationContext, finalUrl: output.finalUrl, identityFacts: extracted.identityFacts });
    if (assessment.nameSignal) nameAligned += 1;
    candidate.reasons.push(assessment.reason);
    if (!assessment.verified) { candidate.state = assessment.state; return; }
    verified.push({ candidate, finalUrl: output.finalUrl, documents: output.documents, path: assessment.path, signals: assessment.signals });
  };

  // 2. A Nexus/AIRE-verified first-party website skips identity verification and goes to contact discovery.
  let selected: Verification | null = null;
  if (nexus.verifiedOfficialWebsite) {
    const candidate: Candidate = { url: nexus.verifiedOfficialWebsite, origin: `${new URL(nexus.verifiedOfficialWebsite).origin}/`, source: "RESOURCES_HELD", rank: 0, state: "SELECTED", reasons: ["NEXUS_VERIFIED_FIRST_PARTY"], score: 0 };
    selected = { candidate, finalUrl: nexus.verifiedOfficialWebsite, documents: [], path: null, signals: [] };
  }

  // 3. A Resources-held website and a stored Google websiteUri are candidates only: each is identity-
  //    verified against the known venue before any contact crawl. Google is never refreshed.
  const heldCandidates: Candidate[] = [];
  if (!selected) {
    for (const [value, source] of [[resources.website, "RESOURCES_HELD"], [storedGoogle.websiteUri, "STORED_GOOGLE_EVIDENCE"]] as const) {
      if (!value) continue;
      const rejection = candidateRejection(value);
      const origin = rejection ? null : heldCandidateOrigin(value);
      if (origin && heldCandidates.some((item) => item.origin === origin)) continue;
      const candidate: Candidate = { url: value, origin, source, rank: 0, state: rejection ? "REJECTED" : "NOT_EVALUATED", reasons: rejection ? [rejection] : [], score: 0 };
      heldCandidates.push(candidate);
      candidates.push(candidate);
    }
    for (const candidate of heldCandidates) if (candidate.state === "NOT_EVALUATED") await verifyCandidate(candidate);
  }
  const heldResourcesWebsite = heldCandidates.some((item) => item.source === "RESOURCES_HELD");

  // 4. Official website search, only when no website is held and any stored candidate failed.
  //    A held Resources website that fails identity returns for review; it is not replaced by search.
  if (!selected && !verified.length && !heldResourcesWebsite) {
    const provider = request.providerAllowances.includes("PUBLIC_WEB_SEARCH") ? options.searchProvider ?? null : null;
    if (!request.providerAllowances.includes("PUBLIC_WEB_SEARCH")) unknowns.push("PUBLIC_WEB_SEARCH is not authorised for this request; no search was run and no other provider substituted.");
    else if (!provider) unknowns.push("No approved public web search provider is configured; no search was run and Google Places was not used as a fallback.");
    if (provider) {
      search.provider = provider.id;
      search.costModel = provider.costModel.kind;
      const maxCalls = Math.max(0, Math.min(2, options.maxSearchCalls ?? 2));
      const maxCandidates = Math.max(1, Math.min(5, options.maxCandidates ?? 3));
      const seen = new Set(candidates.map((item) => item.origin).filter(Boolean));
      let providerFailed = false;
      let budgetExhausted = false;
      for (const query of searchQueries(request, heldAddress).slice(0, maxCalls)) {
        const perCall = provider.costModel.kind === "ZERO_INCREMENTAL" ? 0 : provider.costModel.amountPerCall;
        if (search.cost.amount + perCall > request.costCeiling.amount) { unknowns.push("The next search call would exceed the request cost ceiling; it was not made."); break; }
        search.queries.push(query);
        search.callCount += 1;
        search.cost.amount += perCall;
        let results: PublicWebSearchResult[];
        try {
          results = (await provider.search({ query, country: identity.country, maxResults: Math.max(1, Math.min(10, options.maxResultsPerQuery ?? 8)) })).slice(0, 10);
        } catch (error) {
          if (isPublicWebSearchBudgetExhausted(error)) {
            search.callCount -= 1;
            search.cost.amount = Math.max(0, search.cost.amount - perCall);
            search.queries.pop();
            budgetExhausted = true;
            unknowns.push("PUBLIC_WEB_SEARCH_BUDGET_EXHAUSTED");
            break;
          }
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
        if (verified.length) break;
      }
      if (budgetExhausted && !verified.length && !search.returnedCandidateUrls.length) { websiteStatus = "PUBLIC_WEB_SEARCH_BUDGET_EXHAUSTED"; retryable = false; return finish(); }
      if (providerFailed && !search.returnedCandidateUrls.length) { websiteStatus = "SEARCH_PROVIDER_UNAVAILABLE"; retryable = true; return finish(); }
    } else if (!candidates.length || !evaluated) {
      websiteStatus = "SEARCH_PROVIDER_UNAVAILABLE";
      retryable = request.providerAllowances.includes("PUBLIC_WEB_SEARCH");
      return finish();
    }
  }

  // 5-6. Only a single verified first-party origin becomes the official website.
  if (!selected) {
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
      if (heldResourcesWebsite && websiteStatus === "NO_CREDIBLE_WEBSITE_FOUND") unknowns.push("The held Resources website did not verify as this venue; it needs identity review and was not contact-crawled.");
      return finish();
    }
    selected = verified[0]!;
  }

  selected.candidate.state = "SELECTED";
  const websiteRef = nexus.verifiedOfficialWebsite ? nexus.evidenceRef! : `owd:${request.requestId}:website:${hash(`${selected.finalUrl}:${selected.documents.map((item) => item.sourceHash).join(":")}`, 24)}`;
  const websiteSource = nexus.verifiedOfficialWebsite ? "NEXUS_VERIFIED" : selected.candidate.source === "RESOURCES_HELD" ? "RESOURCES_HELD" : selected.candidate.source === "STORED_GOOGLE_EVIDENCE" ? "STORED_GOOGLE_EVIDENCE_VERIFIED" : "PUBLIC_WEB_SEARCH_VERIFIED";
  officialWebsite = { url: selected.finalUrl, source: websiteSource, verificationPath: selected.path, verificationSignals: selected.signals, evidenceRef: websiteRef };
  evidenceRefs.push(websiteRef);
  websiteStatus = websiteSource === "NEXUS_VERIFIED" || websiteSource === "RESOURCES_HELD" ? "HELD_WEBSITE_REUSED" : "OFFICIAL_WEBSITE_DISCOVERED_AND_VERIFIED";

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
    acquisitionGoal: "VENUE_EMAIL",
    venueName: identity.venueName,
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

  const accepted = acceptCrawledContacts(sourceDiscovery, identity.venueName, websiteRef);
  let crawledContacts = 0;
  const rejectedEmails = accepted.rejectedEmails;
  for (const contact of accepted.contacts) {
    if (publicContacts.some((item) => item.type === contact.type && item.value === contact.value)) continue;
    publicContacts.push({ ...contact, source: "VERIFIED_FIRST_PARTY_SITE" });
    crawledContacts += 1;
  }
  if (rejectedEmails) unknowns.push(`${rejectedEmails} published email(s) were not accepted as evidenced venue mailboxes.`);
  contactStatus = crawledContacts ? "VERIFIED_SITE_PUBLIC_CONTACT_FOUND" : "VERIFIED_SITE_NO_PUBLIC_CONTACT";
  if (!crawledContacts) unknowns.push("The verified first-party site published no bounded business email, phone, or same-site contact form.");
  return finish();
}
