import { createHash } from "node:crypto";
import { getGooglePlaceDetails, type GooglePlacesDetailsInput } from "../ai-sales-team/google-places.ts";
import { validateResearchRequest, type ResearchRequest } from "./contracts.ts";
import { crawlVerifiedSource, extractFromFetchedDocuments, type CrawlBudget, type FetchLike, type ResolveHost } from "./source-discovery/crawler.ts";
import type { ProviderResult, ResearchContext } from "./executor.ts";

export type PublicWebProviderOptions = {
  fetchImpl?: FetchLike;
  resolveHost?: ResolveHost;
  now?: () => string;
  budget?: Partial<CrawlBudget>;
  placeDetails?: typeof getGooglePlaceDetails;
};

export function researchContextFromPayload(input: Record<string, unknown>): ResearchContext {
  return validateResearchRequest(input).researchContext ?? {};
}

const DEFAULT_BUDGET: CrawlBudget = {
  maxPages: 2,
  maxRequests: 4,
  maxBytesPerResponse: 500_000,
  maxRedirects: 2,
  maxRetries: 0,
  timeoutMs: 5_000,
  minRequestDelayMs: 0,
};

const SOCIAL_HOSTS = new Set([
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "tiktok.com",
  "linktr.ee",
]);
const BUSINESS_MAILBOXES = new Set([
  "admin",
  "bookings",
  "contact",
  "enquiries",
  "enquiry",
  "events",
  "hello",
  "hire",
  "info",
  "inquiries",
  "marketing",
  "office",
  "reservations",
  "sales",
  "support",
  "venue",
]);

function nowOf(options: PublicWebProviderOptions) { return options.now?.() ?? new Date().toISOString(); }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function normalise(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function tokens(value: string) { return new Set(normalise(value).split(/\s+/).filter((item) => item.length > 2)); }
function nameMatches(target: string, candidate: string) {
  const targetTokens = tokens(target);
  const candidateTokens = tokens(candidate);
  return targetTokens.size > 0 && [...targetTokens].every((token) => candidateTokens.has(token));
}
function tokenOverlap(left: string, right: string) { const rightTokens = tokens(right); return [...tokens(left)].filter((token) => rightTokens.has(token)); }
function hostOf(value: string) { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); }
function isSocialUrl(value: string) {
  const host = hostOf(value);
  return [...SOCIAL_HOSTS].some((socialHost) => host === socialHost || host.endsWith(`.${socialHost}`));
}
function sourceRecordUrl(request: ResearchRequest) {
  const sourceRecordId = request.subject.candidateReference?.sourceRecordId;
  return sourceRecordId && /^https:\/\//i.test(sourceRecordId) ? sourceRecordId : null;
}
function targetName(request: ResearchRequest, context: ResearchContext) {
  return context.targetName?.trim()
    || text(context.existingFacts?.find((item) => item.fieldName === "placeName")?.value)
    || (request.subject.candidateReference?.sourceRecordId && !/^https?:\/\//i.test(request.subject.candidateReference.sourceRecordId) ? request.subject.candidateReference.sourceRecordId : null)
    || request.subject.canonicalEntityId
    || null;
}
function targetWebsite(request: ResearchRequest, context: ResearchContext) {
  const candidate = context.targetWebsite?.trim() || sourceRecordUrl(request);
  if (!candidate || isSocialUrl(candidate)) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch { return null; }
}
function evidenceRef(request: ResearchRequest, fingerprint: string) { return `research:${request.requestId}:public_web:${fingerprint}`; }
function bounded(value: unknown, max = 2048): unknown {
  if (typeof value === "string") return value.slice(0, max);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => bounded(item, 512));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, item]) => [key, bounded(item, 512)]));
  return value;
}
function businessEmail(value: string) {
  const [mailbox, domain] = value.toLowerCase().split("@");
  return Boolean(mailbox && domain && BUSINESS_MAILBOXES.has(mailbox) && domain.includes("."));
}

function verifyIdentity(request: ResearchRequest, context: ResearchContext, identityFacts: Array<{ fieldName: string; value: unknown; sourceUrl?: string }>) {
  const name = targetName(request, context);
  if (!name) return { verified: false, path: null, signals: [] as string[] };
  const values = identityFacts.filter((item) => ["siteName", "explicitVenueName"].includes(item.fieldName)).map((item) => text(item.value)).filter((item): item is string => Boolean(item));
  const nameSignal = values.some((value) => nameMatches(name, value));

  const addressValues = identityFacts.filter((item) => item.fieldName === "address").map((item) => text(item.value)).filter((item): item is string => Boolean(item));
  const existingAddress = text(context.existingFacts?.find((item) => ["address", "formattedAddress"].includes(item.fieldName))?.value);
  const locality = context.locality?.trim();
  const locationRequired = Boolean(locality || existingAddress);
  const locationSignal = Boolean(
    (locality && addressValues.some((value) => normalise(value).includes(normalise(locality))))
      || (existingAddress && addressValues.some((value) => normalise(value).includes(normalise(existingAddress))))
  );

  const hasTitle = identityFacts.some((item) => item.fieldName === "siteName" && text(item.value) && nameMatches(name, text(item.value)!));
  const hasHeading = identityFacts.some((item) => item.fieldName === "explicitVenueName" && text(item.value) && nameMatches(name, text(item.value)!));
  const existingPlaceEvidence = Boolean(
    context.existingFacts?.some((item) => item.fieldName === "placeId")
      && context.existingFacts?.some((item) => item.fieldName === "placeName" && nameMatches(name, text(item.value) ?? "")),
  );
  if (nameSignal && (!locationRequired || locationSignal) && (locationSignal || (hasTitle && hasHeading) || existingPlaceEvidence)) {
    return { verified: true, path: "DIRECT" as const, signals: ["direct venue name", ...(locationSignal ? ["location alignment"] : []), ...(existingPlaceEvidence ? ["known Place identity"] : [])] };
  }

  const siteNames = identityFacts.filter((item) => item.fieldName === "siteName").map((item) => text(item.value)).filter((item): item is string => Boolean(item));
  const relationshipFacts = identityFacts.filter((item) => ["siteDescription", "explicitVenueName"].includes(item.fieldName));
  const organisationSignal = siteNames.some((value) => tokenOverlap(name, value).some((token) => token.length >= 4));
  const facilitySignal = relationshipFacts.some((item) => {
    const value = text(item.value);
    return Boolean(value && tokenOverlap(name, value).length >= 2 && /\b(?:facility|facilities|venue|conference|centre|center|operator|offers?)\b/i.test(value));
  });
  const relationshipPageSignal = relationshipFacts.some((item) => {
    try { return Boolean(item.sourceUrl && new URL(item.sourceUrl).pathname !== "/"); } catch { return false; }
  });
  if (existingPlaceEvidence && organisationSignal && facilitySignal && relationshipPageSignal && locationSignal) {
    return { verified: true, path: "FACILITY_OPERATOR" as const, signals: ["known Place identity", "first-party organisation alignment", "explicit facility relationship", "linked facility page", "location alignment"] };
  }
  return { verified: false, path: null, signals: [] as string[] };
}

function unresolved(request: ResearchRequest, purpose: string, message: string, options: { error?: ProviderResult["error"]; evidence?: ProviderResult["evidence"]; facts?: ProviderResult["facts"]; providerUsage?: ProviderResult["providerUsage"] } = {}): ProviderResult {
  return { provider: "PUBLIC_WEB", purpose, facts: options.facts ?? [], evidence: options.evidence ?? [], unknowns: [message], conflicts: [], cost: { currency: "USD", amount: 0 }, ...(options.providerUsage ? { providerUsage: options.providerUsage } : {}), ...(options.error ? { error: options.error } : {}) };
}

function httpsCandidate(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.protocol === "http:") url.protocol = "https:";
    if (url.protocol !== "https:") return null;
    const candidate = url.toString();
    return isSocialUrl(candidate) ? null : candidate;
  } catch { return null; }
}

function evidencedPlaceId(context: ResearchContext) {
  const fact = context.existingFacts?.find((item) => (item.fieldName === "placeId" || item.fieldName === "google_place_id") && text(item.value) && text(item.evidenceRef));
  return fact ? text(fact.value) : null;
}

function detailsInput(request: ResearchRequest, context: ResearchContext, googlePlaceId: string): GooglePlacesDetailsInput | null {
  const name = targetName(request, context);
  if (!name) return null;
  if (request.subject.entityType === "UNKNOWN") return { googlePlaceId, targetName: name, targetWebsite: null, locality: context.locality ?? null, lane: "EXACT_ID", targetType: "UNCLASSIFIED", limit: 1 };
  if (!context.locality?.trim()) return null;
  return { googlePlaceId, targetName: name, targetWebsite: null, locality: context.locality.trim(), lane: request.subject.entityType === "ORGANISATION" ? "ORGANISATION_FIRST" : "VENUE_FIRST", targetType: request.subject.entityType === "ORGANISATION" ? "ORGANISATION" : "VENUE", limit: 1 };
}

export function createPublicWebProvider(options: PublicWebProviderOptions = {}) {
  return async ({ request, context }: { request: ResearchRequest; context: ResearchContext }): Promise<ProviderResult> => {
    const purpose = request.researchPurpose;
    if (!["OFFICIAL_WEBSITE", "PUBLIC_CONTACT", "CONFLICT_RESOLUTION", "SOURCE_ENTITY_CLASSIFICATION"].includes(purpose)) return unresolved(request, purpose, "This bounded public-web adapter is limited to official website, public business contact, conflict, and classification evidence.");
    const suppliedWebsite = targetWebsite(request, context);
    let website = suppliedWebsite;
    let verificationContext = context;
    const seedEvidence: ProviderResult["evidence"] = [];
    let seededPlaceFacts: ProviderResult["facts"] = [];
    const providerUsage: NonNullable<ProviderResult["providerUsage"]> = [];
    if (!website) {
      const placeId = evidencedPlaceId(context);
      const input = placeId ? detailsInput(request, context, placeId) : null;
      if (!input) return unresolved(request, purpose, "No evidenced public first-party HTTPS website or complete evidence-backed Place identity was available for bounded discovery.");
      try {
        const details = await (options.placeDetails ?? getGooglePlaceDetails)(input, { mode: "details_selected", evidenceStore: context.googlePlacesEvidenceStore ?? null, requestingApplication: request.originatingProduct, workflow: `nexus_public_web_seed:${purpose}` });
        providerUsage.push({ provider: "GOOGLE_PLACES", callCount: details.googleCalls ?? 1, purpose: "OFFICIAL_WEBSITE_SEED_PLACE_DETAILS", cost: null });
        if (details.result) {
          const observedAt = details.result.retrievedAt;
          const ref = evidenceRef(request, `google-place-${createHash("sha256").update(details.result.googlePlaceId).digest("hex").slice(0, 16)}`);
          seedEvidence.push({ evidenceRef: ref, provider: "GOOGLE_PLACES", externalRecordId: details.result.googlePlaceId, sourceUrl: details.result.sourceUrl, observedAt, dataClassification: "PUBLIC", licenceType: "PROPRIETARY", payload: bounded({ ...details.result, telemetry: details.telemetry }) });
          const placeFact = (fieldName: string, value: unknown) => ({ fieldName, value, evidenceRef: ref, confidence: 0.8, observedAt, subjectEntityType: request.subject.entityType, canonicalEntityId: request.subject.canonicalEntityId });
          seededPlaceFacts = [
            ...(details.result.displayName ? [placeFact("placeName", details.result.displayName)] : []),
            ...(details.result.formattedAddress ? [placeFact("formattedAddress", details.result.formattedAddress)] : []),
            placeFact("placeId", details.result.googlePlaceId),
            ...(details.result.types.length ? [placeFact("providerTypes", details.result.types)] : []),
            ...(details.result.businessStatus ? [placeFact("businessStatus", details.result.businessStatus)] : []),
          ];
          const venueProviderTypes = new Set(["event_venue", "convention_center", "stadium", "auditorium", "performing_arts_theater"]);
          const organisationProviderTypes = new Set(["association_or_organization", "corporate_office"]);
          if (details.result.types.some((type) => venueProviderTypes.has(type)) && details.result.types.some((type) => organisationProviderTypes.has(type))) {
            seededPlaceFacts.push(placeFact("classificationSignals", ["ORGANISATION_VENUE_CONFLICT"]));
          }
          if (["EXACT_OR_STRONG", "REVIEW_REQUIRED"].includes(details.result.matchStatus)) website = httpsCandidate(details.result.websiteUri);
          verificationContext = { ...context, existingFacts: [...(context.existingFacts ?? []), ...(details.result.displayName ? [{ fieldName: "placeName", value: details.result.displayName, evidenceRef: ref }] : []), ...(details.result.formattedAddress ? [{ fieldName: "formattedAddress", value: details.result.formattedAddress, evidenceRef: ref }] : [])] };
        }
      } catch (error) {
        providerUsage.push({ provider: "GOOGLE_PLACES", callCount: 1, purpose: "OFFICIAL_WEBSITE_SEED_PLACE_DETAILS", cost: null });
        return unresolved(request, purpose, "Place Details could not safely acquire a website seed.", { evidence: seedEvidence, providerUsage, error: { code: "GOOGLE_PLACE_DETAILS_UNAVAILABLE", message: error instanceof Error ? error.message : "Place Details failed safely.", retryable: true } });
      }
    }
    if (!website) return unresolved(request, purpose, "Place Details returned no safe HTTPS website candidate. Place evidence was retained for Nexus classification.", { facts: seededPlaceFacts, evidence: seedEvidence, providerUsage });

    try {
      providerUsage.push({ provider: "PUBLIC_WEB", callCount: 1, purpose, cost: { currency: "USD", amount: 0 } });
      const extractors = request.subject.entityType === "UNKNOWN" || purpose === "CONFLICT_RESOLUTION" || purpose === "SOURCE_ENTITY_CLASSIFICATION"
        ? ["IDENTITY", "PUBLIC_CONTACT", "SOURCE_CLASSIFICATION"] as const
        : ["IDENTITY", "PUBLIC_CONTACT"] as const;
      const crawl = await crawlVerifiedSource({
        verifiedUrl: website,
        requestedExtractors: [...extractors],
        budget: { ...DEFAULT_BUDGET, ...options.budget },
        fetchImpl: options.fetchImpl,
        resolveHost: options.resolveHost,
      });
      const extracted = extractFromFetchedDocuments(crawl.documents, [...extractors]);
      if (!crawl.documents.length) {
        return unresolved(request, purpose, "Public-web discovery produced no safe first-party document.", { facts: seededPlaceFacts, evidence: seedEvidence, providerUsage, error: { code: "PUBLIC_WEB_UNAVAILABLE", message: crawl.stats.warnings.join(" ") || "No safe public-web document was fetched.", retryable: true } });
      }
      const verification = verifyIdentity(request, verificationContext, extracted.identityFacts);
      const neutralEvidence = request.subject.entityType === "UNKNOWN" || purpose === "CONFLICT_RESOLUTION" || purpose === "SOURCE_ENTITY_CLASSIFICATION";
      if (!verification.verified && (!neutralEvidence || !suppliedWebsite)) {
        return unresolved(request, purpose, "The candidate site did not provide strong same-entity identity evidence.", { facts: seededPlaceFacts, evidence: seedEvidence, providerUsage });
      }

      const observedAt = nowOf(options);
      const finalUrl = crawl.finalUrl;
      const origin = new URL(finalUrl).origin;
      const contacts = extracted.publicContacts.filter((item) => {
        if (new URL(item.sourceUrl).origin !== origin) return false;
        if (item.type === "EMAIL") return businessEmail(item.value);
        if (item.type === "CONTACT_FORM") {
          try { return new URL(item.value).origin === origin; } catch { return false; }
        }
        return item.type === "PHONE";
      });
      const fingerprint = createHash("sha256").update(`${finalUrl}:${crawl.documents.map((item) => item.sourceHash).join(":")}`).digest("hex").slice(0, 24);
      const ref = evidenceRef(request, fingerprint);
      const evidence = [...seedEvidence, {
        evidenceRef: ref,
        provider: "PUBLIC_WEB" as const,
        externalRecordId: `public-web:${fingerprint}`,
        sourceUrl: finalUrl,
        observedAt,
        dataClassification: "PUBLIC" as const,
        licenceType: "PUBLIC_SOURCE",
        payload: bounded({
          kind: "FIRST_PARTY_WEBSITE",
          verifiedUrl: website,
          finalUrl,
          identityFacts: extracted.identityFacts,
           contacts: contacts.map((item) => ({ type: item.type, value: item.value, sourceUrl: item.sourceUrl })),
          verificationPath: verification.path,
          verificationSignals: verification.signals,
          sourceHashes: crawl.documents.map((item) => item.sourceHash),
        }),
      }];
      const facts: ProviderResult["facts"] = [...seededPlaceFacts, { fieldName: "officialWebsite", value: finalUrl, evidenceRef: ref, confidence: verification.verified ? 0.95 : 0.6, observedAt, subjectEntityType: request.subject.entityType, canonicalEntityId: request.subject.canonicalEntityId }];
      if (neutralEvidence) {
        for (const item of extracted.identityFacts) {
          if (["schemaOrgTypes", "pageTitle", "metaDescription", "classificationSignals", "siteName", "address"].includes(item.fieldName)) {
            facts.push({ fieldName: item.fieldName, value: item.value, evidenceRef: item.evidenceRef, confidence: 0.7, observedAt, subjectEntityType: request.subject.entityType, canonicalEntityId: request.subject.canonicalEntityId });
          }
        }
      }
      if (purpose === "PUBLIC_CONTACT") {
        for (const contact of contacts) {
          const fieldName = contact.type === "EMAIL" ? "publicContactEmail" : contact.type === "PHONE" ? "publicContactPhone" : contact.type === "CONTACT_FORM" ? "contactFormUrl" : null;
          if (fieldName) facts.push({ fieldName, value: contact.value, evidenceRef: ref, confidence: contact.confidence, observedAt, subjectEntityType: request.subject.entityType, canonicalEntityId: request.subject.canonicalEntityId });
        }
        if (!contacts.length) return { provider: "PUBLIC_WEB", purpose, facts: [facts[0]!], evidence, unknowns: ["The verified first-party site published no bounded business email, phone, or same-origin contact form."], conflicts: [], cost: { currency: "USD", amount: 0 }, providerUsage };
      }
      return { provider: "PUBLIC_WEB", purpose, facts, evidence, unknowns: [], conflicts: [], cost: { currency: "USD", amount: 0 }, providerUsage };
    } catch (error) {
      return unresolved(request, purpose, "Public-web discovery failed safely without retaining unverified facts.", { facts: seededPlaceFacts, evidence: seedEvidence, providerUsage, error: { code: "PUBLIC_WEB_UNAVAILABLE", message: error instanceof Error ? error.message : "Public-web provider failed safely.", retryable: true } });
    }
  };
}
