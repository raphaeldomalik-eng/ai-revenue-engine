const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const CONTRACTS = Object.freeze({
  RESEARCH_REQUEST: "nexus.research-request.v1",
  RESEARCH_RESULT: "nexus.research-result.v1",
  SOURCE_DISCOVERY_REQUEST: "nexus.source-discovery-request.v1",
  SOURCE_DISCOVERY_RESULT: "nexus.source-discovery-result.v1",
});

export const ENTITY_TYPES = ["ORGANISATION", "PLACE", "VENUE", "EVENT", "CREATIVE_ENTITY"] as const;
export type EntityType = typeof ENTITY_TYPES[number];
export const RESEARCH_PURPOSES = ["VENUE_IDENTITY", "OFFICIAL_WEBSITE", "VENUE_OPERATOR", "LEGAL_ORGANISATION", "PUBLIC_CONTACT", "COMMERCIAL_CONTACT", "CONFLICT_RESOLUTION"] as const;
export type ResearchPurpose = typeof RESEARCH_PURPOSES[number];
export const PROVIDER_ALLOWANCES = ["GOOGLE_PLACES", "PUBLIC_WEB", "COMPANIES_HOUSE", "APOLLO", "OPENAI"] as const;
export type ProviderAllowance = typeof PROVIDER_ALLOWANCES[number];
export const ORIGINATING_PRODUCTS = ["prestige_nexus", "event_suite_resources", "last_train_home", "ticket_report", "ai_revenue_engine"] as const;
export const SOURCE_EXTRACTORS = ["IDENTITY", "PUBLIC_CONTACT", "VENUE_FACTS", "IMAGE_CANDIDATES", "EVENTS"] as const;
export type SourceExtractor = typeof SOURCE_EXTRACTORS[number];

const PUBLIC_CONTACT_TYPES = ["EMAIL", "PHONE", "CONTACT_FORM", "WHATSAPP", "BUSINESS_MESSAGING"] as const;
const IMAGE_ROLES = ["HERO", "GALLERY", "SPACE", "EXTERIOR", "INTERIOR", "LOGO", "OTHER"] as const;
const IMAGE_RIGHTS_STATES = ["PERMISSION_REQUIRED", "EXPLICITLY_LICENSED", "OPERATOR_PERMISSION_GRANTED", "UNKNOWN"] as const;
const EVENT_REVIEW_STATES = ["DISCOVERED", "REVIEW_REQUIRED"] as const;
const RESULT_STATUSES = ["COMPLETED", "PARTIAL", "UNRESOLVED", "FAILED"] as const;
const CRAWL_STATUSES = ["COMPLETED", "PARTIAL", "BLOCKED", "FAILED"] as const;

function fail(code: string, detail?: string): never {
  const error = new Error(detail ? `${code}: ${detail}` : code) as Error & { code?: string };
  error.code = code;
  throw error;
}
function object(value: unknown, code: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, any>;
}
function text(value: unknown, code: string, options: { max?: number; optional?: boolean } = {}): string | null {
  if (value == null && options.optional) return null;
  if (typeof value !== "string" || !value.trim()) fail(code);
  const trimmed = value.trim();
  if (trimmed.length > (options.max ?? 2048)) fail(code);
  return trimmed;
}
function uuid(value: unknown, code: string, optional = false): string | null {
  if (value == null && optional) return null;
  const normalized = text(value, code, { max: 64 })!;
  if (!UUID_RE.test(normalized)) fail(code);
  return normalized;
}
function iso(value: unknown, code: string): string {
  const normalized = text(value, code, { max: 64 })!;
  if (!Number.isFinite(Date.parse(normalized))) fail(code);
  return new Date(normalized).toISOString();
}
function url(value: unknown, code: string, options: { httpsOnly?: boolean; optional?: boolean } = {}): string | null {
  if (value == null && options.optional) return null;
  const normalized = text(value, code, { max: 4096 })!;
  let parsed: URL;
  try { parsed = new URL(normalized); } catch { fail(code); }
  if (!["http:", "https:"].includes(parsed!.protocol) || (options.httpsOnly && parsed!.protocol !== "https:")) fail(code);
  return parsed!.toString();
}
function enumValue<T extends readonly string[]>(value: unknown, allowed: T, code: string): T[number] {
  const normalized = text(value, code, { max: 128 })!;
  if (!allowed.includes(normalized)) fail(code, normalized);
  return normalized as T[number];
}
function stringArray(value: unknown, code: string, options: { allowed?: readonly string[]; maxItems?: number; required?: boolean } = {}): any[] {
  if (value == null && !options.required) return [];
  if (!Array.isArray(value) || (options.required && value.length === 0) || value.length > (options.maxItems ?? 100)) fail(code);
  const normalized = value.map((item) => text(item, code, { max: 256 })!);
  if (new Set(normalized).size !== normalized.length) fail(code, "duplicate values");
  if (options.allowed && normalized.some((item) => !options.allowed!.includes(item))) fail(code);
  return normalized;
}
function nonNegativeNumber(value: unknown, code: string, options: { max?: number; positive?: boolean } = {}): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (options.positive ? value <= 0 : value < 0) || value > (options.max ?? Number.MAX_SAFE_INTEGER)) fail(code);
  return value;
}
function candidateReference(value: unknown) {
  const v = object(value, "INVALID_CANDIDATE_REFERENCE");
  return { sourceSystem: text(v.sourceSystem, "INVALID_CANDIDATE_SOURCE_SYSTEM", { max: 128 })!, sourceRecordId: text(v.sourceRecordId, "INVALID_CANDIDATE_SOURCE_RECORD_ID", { max: 512 })! };
}
function subject(value: unknown) {
  const v = object(value, "INVALID_SUBJECT");
  const canonicalEntityId = uuid(v.canonicalEntityId, "INVALID_CANONICAL_ENTITY_ID", true);
  const candidate = v.candidateReference == null ? null : candidateReference(v.candidateReference);
  if (!canonicalEntityId && !candidate) fail("SUBJECT_REFERENCE_REQUIRED");
  return { canonicalEntityId, candidateReference: candidate, entityType: enumValue(v.entityType, ENTITY_TYPES, "INVALID_ENTITY_TYPE") };
}
function freshnessRequirements(value: unknown) {
  const v = object(value, "INVALID_FRESHNESS_REQUIREMENTS");
  return { maxAgeHours: nonNegativeNumber(v.maxAgeHours, "INVALID_MAX_AGE_HOURS", { max: 24 * 365, positive: true }) };
}
function costCeiling(value: unknown) {
  const v = object(value, "INVALID_COST_CEILING");
  const currency = text(v.currency, "INVALID_COST_CURRENCY", { max: 3 })!.toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) fail("INVALID_COST_CURRENCY");
  return { currency, amount: nonNegativeNumber(v.amount, "INVALID_COST_AMOUNT", { max: 1_000_000 }) };
}
function requestedBy(value: unknown) {
  const v = object(value, "INVALID_REQUESTED_BY");
  return { actorType: enumValue(v.actorType, ["SYSTEM", "PRODUCT", "OPERATOR"] as const, "INVALID_REQUESTED_BY_TYPE"), actorId: text(v.actorId, "INVALID_REQUESTED_BY_ID", { max: 256 })! };
}

function assertOnlyFields(value: Record<string, any>, allowed: ReadonlySet<string>, code: string) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(code, key);
}

function boundedResearchValue(value: unknown, depth = 0, maxString = 2048): unknown {
  if (depth > 5) fail("INVALID_RESEARCH_CONTEXT_FACT_VALUE", "maximum depth exceeded");
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("INVALID_RESEARCH_CONTEXT_FACT_VALUE");
    return value;
  }
  if (typeof value === "string") return value.slice(0, maxString);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => boundedResearchValue(item, depth + 1, 512));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, item]) => [
      key.slice(0, 256),
      boundedResearchValue(item, depth + 1, 512),
    ]));
  }
  fail("INVALID_RESEARCH_CONTEXT_FACT_VALUE");
}

export type ResearchContext = {
  targetName?: string | null;
  targetWebsite?: string | null;
  locality?: string | null;
  territory?: "GB" | "ZA";
  existingFacts?: Array<{ fieldName: string; value: unknown; evidenceRef?: string | null }>;
};

function researchContextFact(value: unknown) {
  const v = object(value, "INVALID_RESEARCH_CONTEXT_FACT");
  assertOnlyFields(v, new Set(["fieldName", "value", "evidenceRef"]), "INVALID_RESEARCH_CONTEXT_FACT_FIELDS");
  if (!Object.prototype.hasOwnProperty.call(v, "value")) fail("RESEARCH_CONTEXT_FACT_VALUE_REQUIRED");
  return {
    fieldName: text(v.fieldName, "INVALID_RESEARCH_CONTEXT_FACT_FIELD", { max: 256 })!,
    value: boundedResearchValue(v.value),
    evidenceRef: v.evidenceRef == null ? null : text(v.evidenceRef, "INVALID_RESEARCH_CONTEXT_FACT_EVIDENCE_REF", { max: 512 }),
  };
}

function researchContext(value: unknown): ResearchContext {
  const v = object(value, "INVALID_RESEARCH_CONTEXT");
  assertOnlyFields(v, new Set(["targetName", "targetWebsite", "locality", "territory", "existingFacts"]), "INVALID_RESEARCH_CONTEXT_FIELDS");
  const normalized: ResearchContext = {};
  if (Object.prototype.hasOwnProperty.call(v, "targetName")) normalized.targetName = text(v.targetName, "INVALID_RESEARCH_CONTEXT_TARGET_NAME", { max: 512, optional: true });
  if (Object.prototype.hasOwnProperty.call(v, "targetWebsite")) {
    const website = url(v.targetWebsite, "INVALID_RESEARCH_CONTEXT_WEBSITE", { httpsOnly: true, optional: true });
    if (website) {
      const parsed = new URL(website);
      if (parsed.username || parsed.password) fail("INVALID_RESEARCH_CONTEXT_WEBSITE");
    }
    normalized.targetWebsite = website;
  }
  if (Object.prototype.hasOwnProperty.call(v, "locality")) normalized.locality = text(v.locality, "INVALID_RESEARCH_CONTEXT_LOCALITY", { max: 512, optional: true });
  if (Object.prototype.hasOwnProperty.call(v, "territory")) normalized.territory = enumValue(v.territory, ["GB", "ZA"] as const, "INVALID_RESEARCH_CONTEXT_TERRITORY");
  if (Object.prototype.hasOwnProperty.call(v, "existingFacts")) {
    if (!Array.isArray(v.existingFacts) || v.existingFacts.length > 100) fail("INVALID_RESEARCH_CONTEXT_FACTS");
    normalized.existingFacts = v.existingFacts.map(researchContextFact);
  }
  return normalized;
}

export type ResearchRequest = ReturnType<typeof validateResearchRequest>;
export function validateResearchRequest(input: unknown) {
  const v = object(input, "INVALID_RESEARCH_REQUEST");
  return Object.freeze({
    contractVersion: enumValue(v.contractVersion, [CONTRACTS.RESEARCH_REQUEST] as const, "INVALID_CONTRACT_VERSION"),
    requestId: uuid(v.requestId, "INVALID_REQUEST_ID")!,
    idempotencyKey: uuid(v.idempotencyKey, "INVALID_IDEMPOTENCY_KEY")!,
    correlationId: uuid(v.correlationId, "INVALID_CORRELATION_ID")!,
    originatingProduct: enumValue(v.originatingProduct, ORIGINATING_PRODUCTS, "INVALID_ORIGINATING_PRODUCT"),
    subject: subject(v.subject),
    researchPurpose: enumValue(v.researchPurpose, RESEARCH_PURPOSES, "INVALID_RESEARCH_PURPOSE"),
    requestedFactTypes: stringArray(v.requestedFactTypes, "INVALID_REQUESTED_FACT_TYPES", { maxItems: 100, required: true }),
    providerAllowances: stringArray(v.providerAllowances, "INVALID_PROVIDER_ALLOWANCES", { allowed: PROVIDER_ALLOWANCES, maxItems: PROVIDER_ALLOWANCES.length, required: true }),
    costCeiling: costCeiling(v.costCeiling),
    freshnessRequirements: freshnessRequirements(v.freshnessRequirements),
    existingEvidenceRefs: stringArray(v.existingEvidenceRefs, "INVALID_EVIDENCE_REFS", { maxItems: 200 }),
    requestedBy: requestedBy(v.requestedBy),
    createdAt: iso(v.createdAt, "INVALID_CREATED_AT"),
    ...(Object.prototype.hasOwnProperty.call(v, "researchContext") ? { researchContext: researchContext(v.researchContext) } : {}),
  });
}

function evidenceRecord(value: unknown) {
  const v = object(value, "INVALID_EVIDENCE");
  return { evidenceRef: text(v.evidenceRef, "INVALID_EVIDENCE_REF", { max: 512 })!, provider: enumValue(v.provider, PROVIDER_ALLOWANCES, "INVALID_EVIDENCE_PROVIDER"), externalRecordId: text(v.externalRecordId, "INVALID_EXTERNAL_RECORD_ID", { max: 512 })!, sourceUrl: url(v.sourceUrl, "INVALID_EVIDENCE_SOURCE_URL", { optional: true }), observedAt: iso(v.observedAt, "INVALID_EVIDENCE_OBSERVED_AT"), dataClassification: enumValue(v.dataClassification ?? "INTERNAL", ["PUBLIC", "INTERNAL", "RESTRICTED", "CONFIDENTIAL", "PII"] as const, "INVALID_DATA_CLASSIFICATION"), licenceType: text(v.licenceType ?? "PROPRIETARY", "INVALID_LICENCE_TYPE", { max: 128 })!, payload: v.payload ?? null };
}
function proposedFact(value: unknown) {
  const v = object(value, "INVALID_FACT");
  if (!Object.prototype.hasOwnProperty.call(v, "value")) fail("FACT_VALUE_REQUIRED");
  return { subjectEntityType: enumValue(v.subjectEntityType, ENTITY_TYPES, "INVALID_FACT_ENTITY_TYPE"), canonicalEntityId: uuid(v.canonicalEntityId, "INVALID_FACT_CANONICAL_ENTITY_ID", true), fieldName: text(v.fieldName, "INVALID_FACT_FIELD_NAME", { max: 256 })!, value: v.value, evidenceRef: v.evidenceRef == null ? null : text(v.evidenceRef, "INVALID_FACT_EVIDENCE_REF", { max: 512 }), confidence: v.confidence == null ? null : nonNegativeNumber(v.confidence, "INVALID_FACT_CONFIDENCE", { max: 1 }), observedAt: v.observedAt == null ? null : iso(v.observedAt, "INVALID_FACT_OBSERVED_AT") };
}
function providerUsage(value: unknown) {
  const v = object(value, "INVALID_PROVIDER_USAGE");
  return { provider: enumValue(v.provider, PROVIDER_ALLOWANCES, "INVALID_PROVIDER_USAGE_PROVIDER"), callCount: nonNegativeNumber(v.callCount, "INVALID_PROVIDER_CALL_COUNT", { max: 1_000_000 }), purpose: text(v.purpose, "INVALID_PROVIDER_USAGE_PURPOSE", { max: 256 })!, cost: v.cost == null ? null : costCeiling(v.cost) };
}
function researchError(value: unknown) {
  const v = object(value, "INVALID_RESEARCH_ERROR");
  return { code: text(v.code, "INVALID_RESEARCH_ERROR_CODE", { max: 128 })!, message: text(v.message, "INVALID_RESEARCH_ERROR_MESSAGE", { max: 2048 })!, retryable: Boolean(v.retryable) };
}
export function validateResearchResult(input: unknown) {
  const v = object(input, "INVALID_RESEARCH_RESULT");
  return Object.freeze({ contractVersion: enumValue(v.contractVersion, [CONTRACTS.RESEARCH_RESULT] as const, "INVALID_CONTRACT_VERSION"), requestId: uuid(v.requestId, "INVALID_REQUEST_ID")!, idempotencyKey: uuid(v.idempotencyKey, "INVALID_IDEMPOTENCY_KEY")!, status: enumValue(v.status, RESULT_STATUSES, "INVALID_RESEARCH_RESULT_STATUS"), facts: Array.isArray(v.facts) ? v.facts.map(proposedFact) : [], evidence: Array.isArray(v.evidence) ? v.evidence.map(evidenceRecord) : [], unknowns: stringArray(v.unknowns, "INVALID_UNKNOWNS", { maxItems: 200 }), conflicts: Array.isArray(v.conflicts) ? v.conflicts.map((item) => object(item, "INVALID_CONFLICT")) : [], providerUsage: Array.isArray(v.providerUsage) ? v.providerUsage.map(providerUsage) : [], costSummary: costCeiling(v.costSummary ?? { currency: "USD", amount: 0 }), observedAt: iso(v.observedAt, "INVALID_OBSERVED_AT"), researchErrors: Array.isArray(v.researchErrors) ? v.researchErrors.map(researchError) : [], recommendation: v.recommendation == null ? null : object(v.recommendation, "INVALID_RECOMMENDATION") });
}

function crawlBudget(value: unknown) {
  const v = object(value, "INVALID_CRAWL_BUDGET");
  return { maxPages: nonNegativeNumber(v.maxPages, "INVALID_CRAWL_MAX_PAGES", { max: 500, positive: true }), maxRequests: nonNegativeNumber(v.maxRequests, "INVALID_CRAWL_MAX_REQUESTS", { max: 1000, positive: true }), maxBytesPerResponse: nonNegativeNumber(v.maxBytesPerResponse, "INVALID_CRAWL_MAX_BYTES", { max: 20_000_000, positive: true }), maxRedirects: nonNegativeNumber(v.maxRedirects, "INVALID_CRAWL_MAX_REDIRECTS", { max: 20 }), maxRetries: nonNegativeNumber(v.maxRetries, "INVALID_CRAWL_MAX_RETRIES", { max: 10 }), timeoutMs: nonNegativeNumber(v.timeoutMs, "INVALID_CRAWL_TIMEOUT", { max: 120_000, positive: true }), minRequestDelayMs: v.minRequestDelayMs == null ? 0 : nonNegativeNumber(v.minRequestDelayMs, "INVALID_CRAWL_DELAY", { max: 60_000 }) };
}
export type SourceDiscoveryRequest = ReturnType<typeof validateSourceDiscoveryRequest>;
export function validateSourceDiscoveryRequest(input: unknown) {
  const v = object(input, "INVALID_SOURCE_DISCOVERY_REQUEST");
  if ("model" in v || "ai" in v || "allowModel" in v || "allowAi" in v) fail("MODEL_PERMISSION_NOT_ALLOWED");
  return Object.freeze({ contractVersion: enumValue(v.contractVersion, [CONTRACTS.SOURCE_DISCOVERY_REQUEST] as const, "INVALID_CONTRACT_VERSION"), discoveryRequestId: uuid(v.discoveryRequestId, "INVALID_DISCOVERY_REQUEST_ID")!, idempotencyKey: uuid(v.idempotencyKey, "INVALID_IDEMPOTENCY_KEY")!, correlationId: uuid(v.correlationId, "INVALID_CORRELATION_ID")!, originatingProduct: enumValue(v.originatingProduct, ORIGINATING_PRODUCTS, "INVALID_ORIGINATING_PRODUCT"), subjectReference: subject(v.subjectReference), verifiedSourceUrl: url(v.verifiedSourceUrl, "INVALID_VERIFIED_SOURCE_URL", { httpsOnly: true })!, requestedExtractors: stringArray(v.requestedExtractors, "INVALID_SOURCE_EXTRACTORS", { allowed: SOURCE_EXTRACTORS, maxItems: SOURCE_EXTRACTORS.length, required: true }), freshnessRequirements: freshnessRequirements(v.freshnessRequirements), crawlBudget: crawlBudget(v.crawlBudget), existingEvidenceRefs: stringArray(v.existingEvidenceRefs, "INVALID_EVIDENCE_REFS", { maxItems: 200 }), requestedBy: requestedBy(v.requestedBy), createdAt: iso(v.createdAt, "INVALID_CREATED_AT") });
}

function sourceDescriptor(value: unknown) { const v = object(value, "INVALID_SOURCE_DESCRIPTOR"); return { verifiedUrl: url(v.verifiedUrl, "INVALID_VERIFIED_SOURCE_URL", { httpsOnly: true })!, finalUrl: url(v.finalUrl, "INVALID_FINAL_SOURCE_URL", { httpsOnly: true })!, observedAt: iso(v.observedAt, "INVALID_SOURCE_OBSERVED_AT"), sourceHash: text(v.sourceHash, "INVALID_SOURCE_HASH", { max: 256 })! }; }
function crawlSummary(value: unknown) { const v = object(value, "INVALID_CRAWL_SUMMARY"); return { status: enumValue(v.status, CRAWL_STATUSES, "INVALID_CRAWL_STATUS"), warnings: stringArray(v.warnings, "INVALID_CRAWL_WARNINGS", { maxItems: 200 }), requestCount: nonNegativeNumber(v.requestCount, "INVALID_REQUEST_COUNT", { max: 1_000_000 }), pageCount: nonNegativeNumber(v.pageCount, "INVALID_PAGE_COUNT", { max: 1_000_000 }), bytesRead: v.bytesRead == null ? null : nonNegativeNumber(v.bytesRead, "INVALID_BYTES_READ", { max: Number.MAX_SAFE_INTEGER }), redirects: v.redirects == null ? 0 : nonNegativeNumber(v.redirects, "INVALID_REDIRECT_COUNT", { max: 10_000 }), blockedCount: v.blockedCount == null ? 0 : nonNegativeNumber(v.blockedCount, "INVALID_BLOCKED_COUNT", { max: 10_000 }) }; }
function publicContact(value: unknown) { const v = object(value, "INVALID_PUBLIC_CONTACT"); return { type: enumValue(v.type, PUBLIC_CONTACT_TYPES, "INVALID_PUBLIC_CONTACT_TYPE"), value: text(v.value, "INVALID_PUBLIC_CONTACT_VALUE", { max: 4096 })!, sourceUrl: url(v.sourceUrl, "INVALID_PUBLIC_CONTACT_SOURCE_URL", { httpsOnly: true })!, observedAt: iso(v.observedAt, "INVALID_PUBLIC_CONTACT_OBSERVED_AT"), evidenceRef: v.evidenceRef == null ? null : text(v.evidenceRef, "INVALID_PUBLIC_CONTACT_EVIDENCE_REF", { max: 512 }), confidence: v.confidence == null ? null : nonNegativeNumber(v.confidence, "INVALID_PUBLIC_CONTACT_CONFIDENCE", { max: 1 }), reviewRequired: Boolean(v.reviewRequired) }; }
function venueFact(value: unknown) { const v = object(value, "INVALID_VENUE_FACT"); if (!Object.prototype.hasOwnProperty.call(v, "value")) fail("VENUE_FACT_VALUE_REQUIRED"); return { fieldName: text(v.fieldName, "INVALID_VENUE_FACT_FIELD", { max: 256 })!, value: v.value, sourceUrl: url(v.sourceUrl, "INVALID_VENUE_FACT_SOURCE_URL", { httpsOnly: true })!, observedAt: iso(v.observedAt, "INVALID_VENUE_FACT_OBSERVED_AT"), evidenceRef: v.evidenceRef == null ? null : text(v.evidenceRef, "INVALID_VENUE_FACT_EVIDENCE_REF", { max: 512 }), confidence: v.confidence == null ? null : nonNegativeNumber(v.confidence, "INVALID_VENUE_FACT_CONFIDENCE", { max: 1 }), reviewRequired: Boolean(v.reviewRequired) }; }
function imageCandidate(value: unknown) { const v = object(value, "INVALID_IMAGE_CANDIDATE"); return { sourceImageUrl: url(v.sourceImageUrl, "INVALID_IMAGE_SOURCE_URL", { httpsOnly: true })!, sourcePageUrl: url(v.sourcePageUrl, "INVALID_IMAGE_PAGE_URL", { httpsOnly: true })!, filename: v.filename == null ? null : text(v.filename, "INVALID_IMAGE_FILENAME", { max: 512 }), alt: v.alt == null ? null : text(v.alt, "INVALID_IMAGE_ALT", { max: 2048 }), title: v.title == null ? null : text(v.title, "INVALID_IMAGE_TITLE", { max: 2048 }), caption: v.caption == null ? null : text(v.caption, "INVALID_IMAGE_CAPTION", { max: 4096 }), width: v.width == null ? null : nonNegativeNumber(v.width, "INVALID_IMAGE_WIDTH", { max: 100_000, positive: true }), height: v.height == null ? null : nonNegativeNumber(v.height, "INVALID_IMAGE_HEIGHT", { max: 100_000, positive: true }), mime: v.mime == null ? null : text(v.mime, "INVALID_IMAGE_MIME", { max: 128 }), likelyRole: enumValue(v.likelyRole ?? "OTHER", IMAGE_ROLES, "INVALID_IMAGE_ROLE"), exactVenue: v.exactVenue === true ? true : v.exactVenue === false ? false : null, discoveredAt: iso(v.discoveredAt, "INVALID_IMAGE_DISCOVERED_AT"), originDomain: text(v.originDomain, "INVALID_IMAGE_ORIGIN_DOMAIN", { max: 512 })!, rightsState: enumValue(v.rightsState ?? "PERMISSION_REQUIRED", IMAGE_RIGHTS_STATES, "INVALID_IMAGE_RIGHTS_STATE") }; }
function eventCandidate(value: unknown) { const v = object(value, "INVALID_EVENT_CANDIDATE"); return { title: text(v.title, "INVALID_EVENT_TITLE", { max: 1024 })!, sourceEventUrl: url(v.sourceEventUrl, "INVALID_EVENT_SOURCE_URL", { httpsOnly: true })!, sourcePageUrl: url(v.sourcePageUrl, "INVALID_EVENT_PAGE_URL", { httpsOnly: true })!, venueText: v.venueText == null ? null : text(v.venueText, "INVALID_EVENT_VENUE_TEXT", { max: 1024 }), startAt: v.startAt == null ? null : iso(v.startAt, "INVALID_EVENT_START_AT"), endAt: v.endAt == null ? null : iso(v.endAt, "INVALID_EVENT_END_AT"), timezone: v.timezone == null ? null : text(v.timezone, "INVALID_EVENT_TIMEZONE", { max: 128 }), eventStatus: v.eventStatus == null ? null : text(v.eventStatus, "INVALID_EVENT_STATUS", { max: 128 }), description: v.description == null ? null : text(v.description, "INVALID_EVENT_DESCRIPTION", { max: 10000 }), organiser: v.organiser == null ? null : text(v.organiser, "INVALID_EVENT_ORGANISER", { max: 1024 }), performers: stringArray(v.performers, "INVALID_EVENT_PERFORMERS", { maxItems: 100 }), sourceCategory: v.sourceCategory == null ? null : text(v.sourceCategory, "INVALID_EVENT_CATEGORY", { max: 256 }), ticketUrl: url(v.ticketUrl, "INVALID_EVENT_TICKET_URL", { optional: true }), ticketDomain: v.ticketDomain == null ? null : text(v.ticketDomain, "INVALID_EVENT_TICKET_DOMAIN", { max: 512 }), priceText: v.priceText == null ? null : text(v.priceText, "INVALID_EVENT_PRICE_TEXT", { max: 1024 }), ageRestriction: v.ageRestriction == null ? null : text(v.ageRestriction, "INVALID_EVENT_AGE_RESTRICTION", { max: 512 }), eventImageUrl: url(v.eventImageUrl, "INVALID_EVENT_IMAGE_URL", { optional: true }), sourceFingerprint: text(v.sourceFingerprint, "INVALID_EVENT_FINGERPRINT", { max: 512 })!, observedAt: iso(v.observedAt, "INVALID_EVENT_OBSERVED_AT"), state: enumValue(v.state ?? "DISCOVERED", EVENT_REVIEW_STATES, "INVALID_EVENT_REVIEW_STATE"), confidence: v.confidence == null ? null : nonNegativeNumber(v.confidence, "INVALID_EVENT_CONFIDENCE", { max: 1 }), ...(v.sourceExternalId == null ? {} : { sourceExternalId: text(v.sourceExternalId, "INVALID_EVENT_SOURCE_EXTERNAL_ID", { max: 256 })! }), ...(v.sourceIdentityEvidenceRef == null ? {} : { sourceIdentityEvidenceRef: text(v.sourceIdentityEvidenceRef, "INVALID_EVENT_SOURCE_IDENTITY_EVIDENCE_REF", { max: 512 })! }) }; }
export function validateSourceDiscoveryResult(input: unknown) { const v = object(input, "INVALID_SOURCE_DISCOVERY_RESULT"); return Object.freeze({ contractVersion: enumValue(v.contractVersion, [CONTRACTS.SOURCE_DISCOVERY_RESULT] as const, "INVALID_CONTRACT_VERSION"), discoveryRequestId: uuid(v.discoveryRequestId, "INVALID_DISCOVERY_REQUEST_ID")!, idempotencyKey: uuid(v.idempotencyKey, "INVALID_IDEMPOTENCY_KEY")!, subjectReference: subject(v.subjectReference), source: sourceDescriptor(v.source), crawl: crawlSummary(v.crawl), identityFacts: Array.isArray(v.identityFacts) ? v.identityFacts.map(proposedFact) : [], publicContacts: Array.isArray(v.publicContacts) ? v.publicContacts.map(publicContact) : [], venueFacts: Array.isArray(v.venueFacts) ? v.venueFacts.map(venueFact) : [], imageCandidates: Array.isArray(v.imageCandidates) ? v.imageCandidates.map(imageCandidate) : [], eventCandidates: Array.isArray(v.eventCandidates) ? v.eventCandidates.map(eventCandidate) : [], evidenceRefs: stringArray(v.evidenceRefs, "INVALID_EVIDENCE_REFS", { maxItems: 1000 }) }); }

export function outboxArgs(contract: Record<string, any>) { const version = text(contract.contractVersion, "INVALID_CONTRACT_VERSION", { max: 128 })!; const idempotencyKey = uuid(contract.idempotencyKey, "INVALID_IDEMPOTENCY_KEY")!; const sourceRecordId = contract.requestId ?? contract.discoveryRequestId; if (!sourceRecordId) fail("SOURCE_RECORD_ID_REQUIRED"); return { schemaVersion: version, sourceSystem: "prestige_nexus", sourceRecordId: String(sourceRecordId), idempotencyKey, payload: contract, canonicalEntityId: contract.subject?.canonicalEntityId ?? contract.subjectReference?.canonicalEntityId ?? null }; }

export function stageResearchResult(result: unknown) {
  const validated = validateResearchResult(result);
  const evidenceRefs = new Set(validated.evidence.map((item) => item.evidenceRef));
  return { contractVersion: validated.contractVersion, requestId: validated.requestId, idempotencyKey: validated.idempotencyKey, rawEvidenceRows: validated.evidence.map((item) => ({ provider_key: item.provider.toLowerCase(), external_record_id: item.externalRecordId, source_url: item.sourceUrl, data_classification: item.dataClassification, licence_type: item.licenceType, observed_at: item.observedAt, raw_payload: item.payload ?? { evidenceRef: item.evidenceRef } })), proposedFactRows: validated.facts.map((item) => { if (item.evidenceRef && !evidenceRefs.has(item.evidenceRef)) fail("FACT_EVIDENCE_REF_NOT_FOUND", item.evidenceRef); return { target_entity_type: item.subjectEntityType, canonical_entity_id: item.canonicalEntityId, field_name: item.fieldName, proposed_value: item.value, confidence: item.confidence ?? 0, review_status: "PROPOSED", evidence_ref: item.evidenceRef }; }), canonicalMutations: 0, autoPromotions: 0 };
}
export function stageSourceDiscoveryResult(result: unknown) { const validated = validateSourceDiscoveryResult(result); return { contractVersion: validated.contractVersion, discoveryRequestId: validated.discoveryRequestId, idempotencyKey: validated.idempotencyKey, evidenceRefs: validated.evidenceRefs, identityFacts: validated.identityFacts, publicContacts: validated.publicContacts, venueFacts: validated.venueFacts, imageCandidates: validated.imageCandidates, eventCandidates: validated.eventCandidates, canonicalMutations: 0, mediaCreates: 0, eventCreates: 0, publicationActions: 0 }; }
