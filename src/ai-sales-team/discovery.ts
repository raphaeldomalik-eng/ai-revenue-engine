import type { AiSalesEvidence } from "./model.ts";
import { classifyAccountRelationship, type AccountRelationship } from "./outreach-model.ts";
import { evaluateProspectIntelligence, type CommercialEvidenceCategory, type CommercialEvidenceItem, type OrganisationResolution, type ProspectIntelligence, type SourceSiteClassification, type SourceSiteType } from "./prospect-intelligence.ts";
import { FIRST_PARTY_SELF, isEventSuiteFirstPartyIdentity } from "./first-party.ts";

export type DiscoveryTerritory = "ZA" | "GB";
export type DiscoveryFocus = "ALL" | "EGS" | "TICKETING" | "ECC";
export type DiscoveryOrigin = "EVENT_FIRST" | "ORGANISATION_FIRST";
export type DiscoveryCandidateStatus = "QUALIFIED" | "REVIEW_REQUIRED" | "BLOCKED" | "REJECTED" | "DUPLICATE";
export type DiscoverySourceRole = "DISCOVERY" | "VALIDATION" | "COMMERCIAL_EVIDENCE" | "CONTACT" | "SIGNAL";
export type EventFreshness = NonNullable<AiSalesEvidence["eventFreshness"]>;
export type DiscoveryEvidence = AiSalesEvidence & { sourceRoles?: DiscoverySourceRole[]; eventFreshness?: EventFreshness };
export type EnrichmentEvidence = DiscoveryEvidence;
export type EnrichmentSkipReason = "BLOCKED" | "REJECTED" | "DUPLICATE" | "FIRST_PARTY_SELF" | "NONE_EVENT_CONNECTION" | "NOT_PLAUSIBLE" | "BUDGET_LIMIT" | "OTHER_SAFE_REASON";
export type EnrichmentCandidateTelemetry = { status: "SKIPPED" | "ATTEMPTED" | "SUCCEEDED" | "FAILED"; attempted: boolean; succeeded: boolean; materiallyChanged: boolean; skipReason?: EnrichmentSkipReason; organisationResolution?: OrganisationResolution; commercialEvidence?: CommercialEvidenceItem[]; resolutionOutcome?: "NOT_REQUIRED" | "RESOLVED" | "UNRESOLVED"; commercialOutcome?: "PRODUCT_SIGNAL_FOUND" | "VALIDATION_ONLY" | "NO_COMMERCIAL_SIGNAL" | "NOT_RUN"; commerciallyAdvanced?: boolean };
export type EnrichmentRunTelemetry = { firstPassCandidateCount: number; enrichmentEligibleCount: number; enrichmentAttemptedCount: number; enrichmentSucceededCount: number; enrichmentFailedCount: number; enrichmentSkippedCount: number; enrichmentMateriallyChangedCount: number };

export type DiscoveredCandidate = { canonicalName: string; organiserName: string | null; website: string | null; origin: DiscoveryOrigin; relationshipHint: AccountRelationship; facts: DiscoveryEvidence[]; inferences: AiSalesEvidence[]; unknowns: string[]; organisationResolution?: OrganisationResolution; commercialEvidence?: CommercialEvidenceItem[]; siteClassifications?: SourceSiteClassification[] };
export type EvaluatedDiscoveryCandidate = DiscoveredCandidate & { canonicalKey: string; relationship: AccountRelationship; status: DiscoveryCandidateStatus; prospectIntelligence: ProspectIntelligence & { firstPartyStatus?: typeof FIRST_PARTY_SELF }; sourceUrls: string[]; firstPartyStatus?: typeof FIRST_PARTY_SELF; enrichment: EnrichmentCandidateTelemetry };

export function isFirstPartyCandidate(candidate: Pick<EvaluatedDiscoveryCandidate, "website" | "sourceUrls" | "firstPartyStatus" | "canonicalName" | "organiserName">) {
  return candidate.firstPartyStatus === FIRST_PARTY_SELF || isEventSuiteFirstPartyIdentity({ website: candidate.website, identityName: candidate.organiserName || candidate.canonicalName, sourceUrls: candidate.sourceUrls });
}

export function canPersistCommercialMemory(candidate: Pick<EvaluatedDiscoveryCandidate, "prospectIntelligence" | "website" | "sourceUrls" | "firstPartyStatus" | "canonicalName" | "organiserName">) {
  return !isFirstPartyCandidate(candidate) && candidate.prospectIntelligence.accountCreationEligible;
}

const sourceRoles = ["DISCOVERY", "VALIDATION", "COMMERCIAL_EVIDENCE", "CONTACT", "SIGNAL"] as const;
const freshnessStates = ["ACTIVE_UPCOMING", "RECENT_RECURRING_EVIDENCE", "HISTORICAL", "CANCELLED_DEAD_UNSUPPORTED", "UNKNOWN"] as const;
const SERVICE_NOISE_PATTERN = /\b(?:ticketing platform|ticketing software|ticketing provider|event technology|event[- ]tech|recruitment solutions?|recruitment business)\b/i;
const PROVIDER_HOST_PATTERN = /(?:^|\.)(?:ticketsza|tixsa)\.(?:co\.za|co\.uk|com|org)(?:$|\.)/i;
const SITE_TYPES = ["ORGANISATION_OFFICIAL", "EVENT_OFFICIAL", "TICKETING_PROVIDER", "EVENT_LISTING_DIRECTORY", "VENUE_OFFICIAL", "VENUE_CALENDAR", "ARTIST_OFFICIAL", "NEWS_EDITORIAL", "SOCIAL_COMMUNITY", "UNKNOWN"] as const;
const EVENT_CONTEXT_PATTERN = /\b(?:event|conference|symposium|festival|programme|tournament|exhibition|performance|summit|workshop|concert)\w*\b/i;
const ORGANISER_PATTERN = /\b(?:organis(?:e|es|ed|er|ers|ing)|promotes?|operat(?:e|es|ed|ing)|produces?|presents?|runs?|owns?|host(?:s|ed|ing)|is\s+(?:the\s+)?organis(?:er|or)|organis(?:ed|zed)\s+by|promoted\s+by|produced\s+by|operated\s+by)\b/i;
const DIGITAL_GAP_PATTERN = /\b(?:no meaningful owned|weak owned|poor owned|fragmented|thin|social[- ]first|ticket(?:ing| provider)? page (?:as|is) (?:the )?primary|missing .*programme|weak .*digital|poor .*presence|discoverab(?:ility|le)|public information .*spread)\b/i;
const TICKETING_PROBLEM_PATTERN = /\b(?:multiple (?:ticket|registration|sales) arrangements|manual (?:registration|reconciliation|ticket)|switch(?:ing|ed)?(?: provider)?|procurement|evaluation|settlement|fragmented (?:purchasing|registration)|admission scanning|ticket tiers?|box office|reconciliation|paid (?:tickets?|registration)|registration|workflow complexity)\b/i;
const COMPLEXITY_PATTERN = /\b(?:multi-day|multi-stage|multi-zone|multiple venues?|multiple locations?|concurrent|simultaneous|suppliers?|exhibitors?|vendors?|workforce|volunteers?|accreditation|production schedule|technical dependencies|guest operations|complex programme|operational coordination)\b/i;
const EGS_CATEGORIES = new Set<CommercialEvidenceCategory>(["WEAK_OWNED_PRESENCE", "FRAGMENTED_DIGITAL", "DISCOVERY_GAP", "DISCONNECTED_EVENT_PAGES"]);
const TICKETING_CATEGORIES = new Set<CommercialEvidenceCategory>(["PROVIDER_FRAGMENTATION", "MANUAL_OPERATIONS", "WORKFLOW_COMPLEXITY", "MIGRATION_CHANGE", "PROCUREMENT_CHANGE"]);
const ECC_CATEGORIES = new Set<CommercialEvidenceCategory>(["MULTI_STAGE", "MULTI_ZONE", "MULTI_VENUE", "CONCURRENCY", "ACCREDITATION", "WORKFORCE", "VENDOR_COORDINATION", "PRODUCTION_SCHEDULING", "OPERATIONAL_COORDINATION"]);
const candidateSchema = {
  type: "object", additionalProperties: false, required: ["candidates"], properties: {
    candidates: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, required: ["canonicalName", "organiserName", "website", "origin", "relationshipHint", "facts", "inferences", "unknowns", "siteClassifications"], properties: {
      canonicalName: { type: "string" }, organiserName: { type: ["string", "null"] }, website: { type: ["string", "null"] }, origin: { type: "string", enum: ["EVENT_FIRST", "ORGANISATION_FIRST"] }, relationshipHint: { type: "string", enum: ["PROSPECT", "CUSTOMER", "PARTNER", "COMPETITOR", "UNKNOWN"] },
      siteClassifications: { type: "array", items: { type: "object", additionalProperties: false, required: ["url", "siteType", "siteTypeConfidence", "siteTypeEvidence"], properties: { url: { type: "string" }, siteType: { type: "string", enum: SITE_TYPES }, siteTypeConfidence: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] }, siteTypeEvidence: { type: "array", items: { type: "string" } } } } },
      facts: { type: "array", items: { type: "object", additionalProperties: false, required: ["claim", "sourceUrl", "sourceTitle", "kind", "confidence", "sourceRoles", "eventFreshness"], properties: { claim: { type: "string" }, sourceUrl: { type: ["string", "null"] }, sourceTitle: { type: ["string", "null"] }, kind: { type: "string", const: "FACT" }, confidence: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] }, sourceRoles: { type: "array", items: { type: "string", enum: sourceRoles } }, eventFreshness: { type: "string", enum: freshnessStates } } } },
      inferences: { type: "array", items: { type: "object", additionalProperties: false, required: ["claim", "sourceUrl", "sourceTitle", "kind", "confidence"], properties: { claim: { type: "string" }, sourceUrl: { type: ["string", "null"] }, sourceTitle: { type: ["string", "null"] }, kind: { type: "string", const: "INFERENCE" }, confidence: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] } } } }, unknowns: { type: "array", items: { type: "string" } },
    } } },
  },
} as const;

const enrichmentSchema = {
  type: "object", additionalProperties: false, required: ["candidates"], properties: {
    candidates: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, required: ["candidateRef", "organisationResolution", "commercialEvidence", "facts", "inferences", "unknowns"], properties: {
      candidateRef: { type: "string" },
      organisationResolution: { type: "object", additionalProperties: false, required: ["status", "canonicalOrganisationName", "officialWebsite", "officialWebsiteSiteType", "aliases", "confidence", "evidence", "siteClassifications"], properties: {
        status: { type: "string", enum: ["RESOLVED", "UNRESOLVED", "NOT_REQUIRED"] }, canonicalOrganisationName: { type: ["string", "null"] }, officialWebsite: { type: ["string", "null"] }, officialWebsiteSiteType: { type: "string", enum: SITE_TYPES }, aliases: { type: "array", items: { type: "string" } }, confidence: { type: "string", enum: ["NONE", "LOW", "MEDIUM", "HIGH"] }, evidence: { type: "array", items: { type: "object", additionalProperties: false, required: ["claim", "sourceUrl", "sourceTitle", "confidence"], properties: { claim: { type: "string" }, sourceUrl: { type: "string" }, sourceTitle: { type: ["string", "null"] }, confidence: { type: "string", enum: ["NONE", "LOW", "MEDIUM", "HIGH"] } } } }, siteClassifications: { type: "array", items: { type: "object", additionalProperties: false, required: ["url", "siteType", "siteTypeConfidence", "siteTypeEvidence"], properties: { url: { type: "string" }, siteType: { type: "string", enum: SITE_TYPES }, siteTypeConfidence: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] }, siteTypeEvidence: { type: "array", items: { type: "string" } } } } },
      } },
      commercialEvidence: { type: "array", items: { type: "object", additionalProperties: false, required: ["product", "claim", "sourceUrl", "evidenceCategory", "confidence"], properties: { product: { type: "string", enum: ["EGS", "TICKETING", "ECC"] }, claim: { type: "string" }, sourceUrl: { type: "string" }, evidenceCategory: { type: "string", enum: [...EGS_CATEGORIES, ...TICKETING_CATEGORIES, ...ECC_CATEGORIES] }, confidence: { type: "string", enum: ["NONE", "LOW", "MEDIUM", "HIGH"] } } } },
      facts: { type: "array", items: { type: "object", additionalProperties: false, required: ["claim", "sourceUrl", "sourceTitle", "kind", "confidence", "sourceRoles", "eventFreshness"], properties: { claim: { type: "string" }, sourceUrl: { type: ["string", "null"] }, sourceTitle: { type: ["string", "null"] }, kind: { type: "string", const: "FACT" }, confidence: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] }, sourceRoles: { type: "array", items: { type: "string", enum: sourceRoles } }, eventFreshness: { type: "string", enum: freshnessStates } } } },
      inferences: { type: "array", items: { type: "object", additionalProperties: false, required: ["claim", "sourceUrl", "sourceTitle", "kind", "confidence"], properties: { claim: { type: "string" }, sourceUrl: { type: ["string", "null"] }, sourceTitle: { type: ["string", "null"] }, kind: { type: "string", const: "INFERENCE" }, confidence: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] } } } },
      unknowns: { type: "array", items: { type: "string" } },
    } } },
  },
} as const;

const normaliseName = (value: string) => value.trim().toLowerCase().replace(/\b(?:festival|events?)\b/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const rawName = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function domainOf(website?: string | null) { return website?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "") || null; }
export function canonicalDiscoveryKey(name: string, website?: string | null) { const domain = domainOf(website); return `${domain ? normaliseName(name) : rawName(name)}|${domain || "no-domain"}`; }

function inferFreshness(claim: string, supplied?: EventFreshness): EventFreshness {
  if (supplied && freshnessStates.includes(supplied)) return supplied;
  if (/\b(?:cancelled|canceled|postponed indefinitely|closed down|defunct|no longer operating)\b/i.test(claim)) return "CANCELLED_DEAD_UNSUPPORTED";
  const year = new Date().getUTCFullYear();
  const years = [...claim.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1]));
  if (/\b(?:upcoming|next edition|tickets? on sale|this year|current|announced|opens? on)\b/i.test(claim) || years.some((value) => value >= year)) return "ACTIVE_UPCOMING";
  if (/\b(?:annual|recurring|returns?|returning|edition)\b/i.test(claim)) return "RECENT_RECURRING_EVIDENCE";
  if (/\b(?:historic|historical|archive|archived|took place|was held)\b/i.test(claim) || years.some((value) => value < year)) return "HISTORICAL";
  return "UNKNOWN";
}
function calibrateConfidence(value: DiscoveryEvidence, roles: DiscoverySourceRole[]): DiscoveryEvidence["confidence"] {
  if (!value.sourceUrl && value.confidence === "HIGH") return "MEDIUM";
  if (roles.length === 1 && roles[0] === "DISCOVERY" && value.confidence === "HIGH") return "MEDIUM";
  return value.confidence;
}
function commercialClaimSupportsProduct(claim: string) { return DIGITAL_GAP_PATTERN.test(claim) || TICKETING_PROBLEM_PATTERN.test(claim) || COMPLEXITY_PATTERN.test(claim); }
function normaliseFact(value: DiscoveryEvidence): DiscoveryEvidence {
  const supplied = Array.isArray(value.sourceRoles) ? value.sourceRoles.filter((role): role is DiscoverySourceRole => sourceRoles.includes(role)) : [];
  const roles = supplied.filter((role) => role !== "COMMERCIAL_EVIDENCE" || commercialClaimSupportsProduct(value.claim));
  const inferred: DiscoverySourceRole = ORGANISER_PATTERN.test(value.claim) ? "VALIDATION" : commercialClaimSupportsProduct(value.claim) ? "COMMERCIAL_EVIDENCE" : "DISCOVERY";
  const resolvedRoles: DiscoverySourceRole[] = [...new Set([...(roles.length ? roles : [inferred]), ...(ORGANISER_PATTERN.test(value.claim) ? ["VALIDATION" as const] : []), ...(commercialClaimSupportsProduct(value.claim) ? ["COMMERCIAL_EVIDENCE" as const] : [])])];
  return { ...value, confidence: calibrateConfidence(value, resolvedRoles), sourceRoles: resolvedRoles, eventFreshness: inferFreshness(value.claim, value.eventFreshness) };
}

function validUrl(value: unknown): value is string { return typeof value === "string" && /^https?:\/\/[^\s]+$/i.test(value.trim()); }
const SITE_SIGNAL_PATTERNS: Array<[SourceSiteType, RegExp]> = [
  ["VENUE_CALENDAR", /\b(?:venue calendar|what's on at|what.s on at|events at the venue)\b/i],
  ["VENUE_OFFICIAL", /\b(?:official venue|venue website|venue operator|the venue presents)\b/i],
  ["EVENT_LISTING_DIRECTORY", /\b(?:directory|event listing|lists? events|calendar of events|events from multiple|multiple unrelated organisers)\b/i],
  ["ARTIST_OFFICIAL", /\b(?:official artist|artist website|band website|performer website)\b/i],
  ["NEWS_EDITORIAL", /\b(?:news report|editorial|journalist|press article|news outlet)\b/i],
  ["SOCIAL_COMMUNITY", /\b(?:social page|community page|facebook event|instagram|social media)\b/i],
  ["EVENT_OFFICIAL", /\b(?:official event website|official event site|event domain|event.s own website|about the event|event contact)\b/i],
  ["ORGANISATION_OFFICIAL", /\b(?:official organisation|official organization|company website|organiser.s website|organisation.s website|organisation official|organizer.s website)\b/i],
];

export function classifySourceSite(input: { url: string; claims?: string[]; sourceTitle?: string | null; candidateOrigin?: DiscoveryOrigin; }): SourceSiteClassification {
  const claims = [...(input.claims ?? []), input.sourceTitle ?? ""].filter(Boolean);
  const evidence = claims.find((claim) => PROVIDER_HOST_PATTERN.test(domainOf(input.url) ?? "") && /\b(?:ticket|provider|checkout|platform|multiple events?)\b/i.test(claim))
    ? "The URL is identified as a ticketing provider or ticket platform."
    : null;
  if (PROVIDER_HOST_PATTERN.test(domainOf(input.url) ?? "") || evidence) return { url: input.url, siteType: "TICKETING_PROVIDER", siteTypeConfidence: "HIGH", siteTypeEvidence: [evidence ?? "The host matches a known ticketing-provider pattern and is retained as discovery evidence."] };
  for (const [siteType, pattern] of SITE_SIGNAL_PATTERNS) {
    const claim = claims.find((value) => pattern.test(value));
    if (claim) return { url: input.url, siteType, siteTypeConfidence: "HIGH", siteTypeEvidence: [claim] };
  }
  return { url: input.url, siteType: "UNKNOWN", siteTypeConfidence: "LOW", siteTypeEvidence: ["The available page evidence does not establish an authoritative site role."] };
}

function normaliseSiteClassifications(value: unknown, candidate: DiscoveredCandidate): SourceSiteClassification[] {
  const supplied = Array.isArray(value) ? value.filter((item): item is Partial<SourceSiteClassification> => Boolean(item && typeof item === "object" && validUrl((item as { url?: unknown }).url))) : [];
  return supplied.map((item) => {
    const url = String(item.url).trim();
    const siteType = SITE_TYPES.includes(item.siteType as SourceSiteType) ? item.siteType as SourceSiteType : classifySourceSite({ url, candidateOrigin: candidate.origin }).siteType;
    const confidence = ["LOW", "MEDIUM", "HIGH"].includes(item.siteTypeConfidence as string) ? item.siteTypeConfidence as SourceSiteClassification["siteTypeConfidence"] : "LOW";
    const evidence = Array.isArray(item.siteTypeEvidence) ? item.siteTypeEvidence.filter((text): text is string => typeof text === "string" && Boolean(text.trim())).slice(0, 3) : [];
    return { url, siteType, siteTypeConfidence: confidence, siteTypeEvidence: evidence.length ? evidence : classifySourceSite({ url, candidateOrigin: candidate.origin }).siteTypeEvidence };
  }).slice(0, 24);
}
function normaliseOrganisationResolution(value: unknown, candidate: DiscoveredCandidate): OrganisationResolution {
  const raw = value && typeof value === "object" ? value as Partial<OrganisationResolution> : {};
  const status = raw.status === "RESOLVED" || raw.status === "NOT_REQUIRED" ? raw.status : "UNRESOLVED";
  const evidence = Array.isArray(raw.evidence) ? raw.evidence.filter((item): item is OrganisationResolution["evidence"][number] => Boolean(item && typeof item === "object" && typeof item.claim === "string" && validUrl(item.sourceUrl) && ORGANISER_PATTERN.test(item.claim) && ["LOW", "MEDIUM", "HIGH"].includes(item.confidence))) : [];
  const canonicalOrganisationName = typeof raw.canonicalOrganisationName === "string" && raw.canonicalOrganisationName.trim() ? raw.canonicalOrganisationName.trim() : null;
  const officialWebsite = validUrl(raw.officialWebsite) && !PROVIDER_HOST_PATTERN.test(domainOf(raw.officialWebsite) ?? "") ? raw.officialWebsite.trim() : null;
  const siteClassifications = normaliseSiteClassifications(raw.siteClassifications, candidate);
  const officialWebsiteSiteType = SITE_TYPES.includes(raw.officialWebsiteSiteType as SourceSiteType) ? raw.officialWebsiteSiteType as SourceSiteType : siteClassifications.find((item) => item.url === officialWebsite)?.siteType ?? (candidate.origin === "EVENT_FIRST" && officialWebsite === candidate.website ? "UNKNOWN" : "ORGANISATION_OFFICIAL");
  const targetIsAuthoritative = officialWebsiteSiteType === "ORGANISATION_OFFICIAL" || (officialWebsiteSiteType === "EVENT_OFFICIAL" && evidence.some((item) => /\b(?:event brand|event itself|operating entity|organising entity|organizer is the event|organiser is the event)\b/i.test(item.claim)));
  const resolved = status === "RESOLVED" && Boolean(canonicalOrganisationName && officialWebsite && evidence.length && raw.confidence && raw.confidence !== "NONE" && targetIsAuthoritative);
  const finalStatus = resolved ? "RESOLVED" : candidate.origin === "ORGANISATION_FIRST" ? "NOT_REQUIRED" : "UNRESOLVED";
  return { status: finalStatus, canonicalOrganisationName: resolved ? canonicalOrganisationName : null, officialWebsite: resolved ? officialWebsite : null, aliases: Array.isArray(raw.aliases) ? raw.aliases.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()).slice(0, 8) : [], confidence: ["LOW", "MEDIUM", "HIGH"].includes(raw.confidence as string) ? raw.confidence as OrganisationResolution["confidence"] : "NONE", evidence, officialWebsiteSiteType, siteClassifications };
}

function validCommercialEvidence(value: unknown): value is CommercialEvidenceItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CommercialEvidenceItem>;
  if (!(Boolean(item.product) && typeof item.claim === "string" && validUrl(item.sourceUrl) && typeof item.evidenceCategory === "string" && ["LOW", "MEDIUM", "HIGH"].includes(item.confidence as string))) return false;
  const category = item.evidenceCategory as CommercialEvidenceCategory;
  const claim = item.claim as string;
  const categoryFitsProduct = item.product === "EGS" ? EGS_CATEGORIES.has(category) : item.product === "TICKETING" ? TICKETING_CATEGORIES.has(category) : ECC_CATEGORIES.has(category);
  if (!categoryFitsProduct) return false;
  if (item.product === "EGS") return DIGITAL_GAP_PATTERN.test(claim);
  if (item.product === "TICKETING") return category === "PROVIDER_FRAGMENTATION" ? /(?:multiple|fragmented|different|several).{0,50}(?:provider|platform|ticket|registration)/i.test(claim) : TICKETING_PROBLEM_PATTERN.test(claim) && !/own(?:s|ed)?\s+(?:ticketing|ticket)\s+system/i.test(claim);
  return COMPLEXITY_PATTERN.test(claim);
}

function normaliseCommercialEvidence(value: unknown): CommercialEvidenceItem[] { return Array.isArray(value) ? value.filter(validCommercialEvidence).slice(0, 24) : []; }

function parseProviderText(payload: { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> }) {
  const text = (payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("") ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  if (!text) throw new Error("AI discovery provider returned no structured output.");
  return JSON.parse(text) as { candidates?: Array<{ candidateRef: string; organisationResolution: unknown; commercialEvidence: unknown; facts: EnrichmentEvidence[]; inferences: AiSalesEvidence[]; unknowns: string[] }> };
}

export function applyDiscoveryEnrichment(candidate: EvaluatedDiscoveryCandidate, update: { organisationResolution?: unknown; commercialEvidence?: unknown; facts: EnrichmentEvidence[]; inferences: AiSalesEvidence[]; unknowns: string[] }, territory: DiscoveryTerritory) {
  const organisationResolution = normaliseOrganisationResolution(update.organisationResolution, candidate);
  const commercialEvidence = normaliseCommercialEvidence(update.commercialEvidence);
  const currentSite = candidate.siteClassifications?.find((item) => item.url === candidate.website);
  const promoted = organisationResolution.status === "RESOLVED" ? { ...candidate, canonicalName: organisationResolution.canonicalOrganisationName ?? candidate.canonicalName, organiserName: organisationResolution.canonicalOrganisationName ?? candidate.organiserName, website: organisationResolution.officialWebsite } : { ...candidate, website: candidate.origin === "EVENT_FIRST" && (!currentSite || currentSite.siteType !== "ORGANISATION_OFFICIAL") ? null : candidate.website };
  const factKeys = new Set(candidate.facts.map((item) => `${item.claim}::${item.sourceUrl ?? ""}`));
  const resolutionFacts: DiscoveryEvidence[] = organisationResolution.evidence.map((item) => ({ claim: item.claim, sourceUrl: item.sourceUrl, sourceTitle: item.sourceTitle, kind: "FACT", confidence: item.confidence, sourceRoles: ["VALIDATION"], eventFreshness: inferFreshness(item.claim) }));
  const commercialFacts: DiscoveryEvidence[] = commercialEvidence.map((item) => ({ claim: item.claim, sourceUrl: item.sourceUrl, sourceTitle: null, kind: "FACT", confidence: item.confidence, sourceRoles: ["COMMERCIAL_EVIDENCE"], eventFreshness: inferFreshness(item.claim) }));
  const facts = [...candidate.facts, ...resolutionFacts, ...commercialFacts, ...update.facts.filter((item) => item.kind === "FACT" && item.claim.trim() && (item.sourceUrl || item.sourceTitle) && !factKeys.has(`${item.claim}::${item.sourceUrl ?? ""}`))];
  const inferenceKeys = new Set(candidate.inferences.map((item) => item.claim));
  const inferences = [...candidate.inferences, ...update.inferences.filter((item) => item.kind === "INFERENCE" && item.claim.trim() && !inferenceKeys.has(item.claim))];
  return evaluateDiscoveryCandidate({ ...promoted, facts, inferences, commercialEvidence, organisationResolution, siteClassifications: [...(candidate.siteClassifications ?? []), ...(organisationResolution.siteClassifications ?? [])], unknowns: [...new Set([...candidate.unknowns, ...update.unknowns.filter((item) => item.trim())])] }, territory);
}

function materialSnapshot(candidate: EvaluatedDiscoveryCandidate) {
  return JSON.stringify({ name: candidate.canonicalName, organiser: candidate.organiserName, website: candidate.website, resolution: candidate.organisationResolution, commercialEvidence: candidate.commercialEvidence, eventConnection: candidate.prospectIntelligence.eventConnection, roles: candidate.facts.map((item) => ({ claim: item.claim, sourceRoles: item.sourceRoles ?? [], confidence: item.confidence })).sort((a, b) => a.claim.localeCompare(b.claim)), products: { egs: candidate.prospectIntelligence.egs, ticketing: candidate.prospectIntelligence.ticketing, ecc: candidate.prospectIntelligence.ecc }, primaryEntryOpportunity: candidate.prospectIntelligence.primaryEntryOpportunity, inferences: candidate.inferences.map((item) => item.claim).sort(), unknowns: [...candidate.unknowns].sort(), status: candidate.status, accountCreationEligible: candidate.prospectIntelligence.accountCreationEligible });
}

function commercialOutcome(before: EvaluatedDiscoveryCandidate, after: EvaluatedDiscoveryCandidate, resolution: OrganisationResolution, commercialEvidence: CommercialEvidenceItem[]) {
  const productSignal = commercialEvidence.length > 0 && after.prospectIntelligence.primaryEntryOpportunity !== "UNKNOWN";
  const resolvedNow = resolution.status === "RESOLVED" && before.organisationResolution?.status !== "RESOLVED";
  const buyerNow = after.prospectIntelligence.buyerProblemOwner.likelyRoles.length > 0 && before.prospectIntelligence.buyerProblemOwner.likelyRoles.length === 0;
  const qualifiedNow = after.prospectIntelligence.accountCreationEligible && !before.prospectIntelligence.accountCreationEligible;
  return { outcome: productSignal ? "PRODUCT_SIGNAL_FOUND" as const : resolution.status === "UNRESOLVED" ? "NO_COMMERCIAL_SIGNAL" as const : "VALIDATION_ONLY" as const, advanced: resolvedNow || productSignal || buyerNow || qualifiedNow };
}

function skipReason(candidate: EvaluatedDiscoveryCandidate): EnrichmentSkipReason {
  if (candidate.firstPartyStatus === FIRST_PARTY_SELF) return "FIRST_PARTY_SELF";
  if (candidate.status === "BLOCKED") return "BLOCKED";
  if (candidate.status === "REJECTED") return "REJECTED";
  if (candidate.status === "DUPLICATE") return "DUPLICATE";
  if (candidate.prospectIntelligence.eventConnection.state === "NONE") return "NONE_EVENT_CONNECTION";
  return "NOT_PLAUSIBLE";
}

function telemetryFor(candidates: EvaluatedDiscoveryCandidate[], eligibleCount: number, attemptedCount: number, successCount: number, failedCount: number, materialCount: number): EnrichmentRunTelemetry {
  return { firstPassCandidateCount: candidates.length, enrichmentEligibleCount: eligibleCount, enrichmentAttemptedCount: attemptedCount, enrichmentSucceededCount: successCount, enrichmentFailedCount: failedCount, enrichmentSkippedCount: candidates.length - attemptedCount, enrichmentMateriallyChangedCount: materialCount };
}

export async function enrichDiscoveryCandidates(candidates: EvaluatedDiscoveryCandidate[], territory: DiscoveryTerritory): Promise<{ candidates: EvaluatedDiscoveryCandidate[]; telemetry: EnrichmentRunTelemetry }> {
  const eligible = candidates.filter((candidate) => candidate.status === "REVIEW_REQUIRED" && candidate.relationship === "PROSPECT" && candidate.prospectIntelligence.eventConnection.state !== "NONE" && candidate.firstPartyStatus !== FIRST_PARTY_SELF);
  const targets = eligible.slice(0, 4);
  const targetKeys = new Set(targets.map((candidate) => candidate.canonicalKey));
  let prepared: EvaluatedDiscoveryCandidate[] = candidates.map((candidate) => targetKeys.has(candidate.canonicalKey) ? { ...candidate, enrichment: { status: "ATTEMPTED" as const, attempted: true, succeeded: false, materiallyChanged: false } } : { ...candidate, enrichment: { status: "SKIPPED" as const, attempted: false, succeeded: false, materiallyChanged: false, resolutionOutcome: candidate.organisationResolution?.status ?? (candidate.origin === "EVENT_FIRST" ? "UNRESOLVED" : "NOT_REQUIRED"), commercialOutcome: "NOT_RUN" as const, commerciallyAdvanced: false, skipReason: (eligible.includes(candidate) ? "BUDGET_LIMIT" : skipReason(candidate)) as EnrichmentSkipReason } });
  if (!targets.length) return { candidates: prepared, telemetry: telemetryFor(prepared, eligible.length, 0, 0, 0, 0) };
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const failed = () => ({ candidates: prepared.map((candidate) => targetKeys.has(candidate.canonicalKey) ? { ...candidate, enrichment: { status: "FAILED" as const, attempted: true, succeeded: false, materiallyChanged: false, skipReason: "OTHER_SAFE_REASON" as const } } : candidate), telemetry: telemetryFor(prepared, eligible.length, targets.length, 0, targets.length, 0) });
  if (!apiKey) return failed();
  const dossier = targets.map((candidate, index) => ({ candidateRef: String(index + 1), discoverySignal: candidate.canonicalName, currentCommercialTarget: { name: candidate.organiserName, website: candidate.website }, origin: candidate.origin, facts: candidate.facts.map((item) => ({ claim: item.claim, sourceUrl: item.sourceUrl, roles: item.sourceRoles, confidence: item.confidence })), unresolved: candidate.prospectIntelligence.accountCreationReason }));
  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, tools: [{ type: "web_search" }], max_output_tokens: 10000, input: `Perform one bounded second-stage public-web enrichment pass for these plausible ${territory === "ZA" ? "South African" : "UK"} EventSuite candidates. First resolve the commercial organisation when the candidate is EVENT_FIRST: a ticketing, directory, venue, artist or event-listing URL is discovery evidence, not automatically the prospect website. Return RESOLVED only when public evidence proves organiser/commercial responsibility and an authoritative official organisation website is supported; otherwise return UNRESOLVED. For ORGANISATION_FIRST, use NOT_REQUIRED only when the supplied identity and website are already organisation-centric. Once resolved or already organisation-centric, research THAT organisation and its event portfolio, not merely the original listing. Deliberately seek official organiser/event/portfolio validation, current or recurring activity, owned digital presence for EGS, concrete ticketing or registration operations for Ticketing, and observable event complexity for ECC. Use only public web evidence. A fact is FACT only when directly supported by its URL. Return commercialEvidence only when a claim supports one approved product and category: EGS requires weak/fragmented owned digital presence; Ticketing requires provider fragmentation, manual/workflow pain, migration/change or procurement evidence (provider presence or an owned ticketing system alone is not enough); ECC requires observed stages, zones, venues, concurrency, accreditation, workforce, vendors or production coordination. Assign VALIDATION to identity/responsibility evidence, SIGNAL to timing/change/growth, CONTACT only for a clearly public route, and DISCOVERY only for existence. Do not invent providers, dissatisfaction, switching intent, people, emails or operational tools. If identity or commercial evidence is not established, return the specific unknown and leave the candidate unqualified. Never approve or send outreach. Dossiers: ${JSON.stringify(dossier)}`, text: { format: { type: "json_schema", name: "prospecting_evidence_enrichment", strict: true, schema: enrichmentSchema } } }) });
  if (!response.ok) return failed();
  const parsed = parseProviderText(await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> });
  const updates = new Map((parsed.candidates ?? []).filter((item) => targets[Number(item.candidateRef) - 1]).map((item) => [item.candidateRef, item]));
  let succeeded = 0;
  let materiallyChanged = 0;
  prepared = prepared.map((candidate) => {
    const index = targets.findIndex((target) => target.canonicalKey === candidate.canonicalKey);
    const update = updates.get(String(index + 1));
    if (!update) return targetKeys.has(candidate.canonicalKey) ? { ...candidate, enrichment: { status: "FAILED" as const, attempted: true, succeeded: false, materiallyChanged: false, skipReason: "OTHER_SAFE_REASON" as const } } : candidate;
    const enriched = applyDiscoveryEnrichment(candidate, update, territory);
    const changed = materialSnapshot(candidate) !== materialSnapshot(enriched);
    const resolution = enriched.organisationResolution ?? { status: "UNRESOLVED" as const, canonicalOrganisationName: null, officialWebsite: null, aliases: [], confidence: "NONE" as const, evidence: [] };
    const evidence = enriched.commercialEvidence ?? [];
    const outcome = commercialOutcome(candidate, enriched, resolution, evidence);
    succeeded += 1;
    if (changed) materiallyChanged += 1;
    return { ...enriched, enrichment: { status: "SUCCEEDED" as const, attempted: true, succeeded: true, materiallyChanged: changed, organisationResolution: resolution, commercialEvidence: evidence, resolutionOutcome: resolution.status, commercialOutcome: outcome.outcome, commerciallyAdvanced: outcome.advanced } };
  });
  return { candidates: prepared, telemetry: telemetryFor(prepared, eligible.length, targets.length, succeeded, targets.length - succeeded, materiallyChanged) };
}

export function evaluateDiscoveryCandidate(candidate: DiscoveredCandidate, territory: DiscoveryTerritory): EvaluatedDiscoveryCandidate {
  const facts = candidate.facts.filter((item) => item.kind === "FACT").map(normaliseFact);
  const firstPartyStatus = isEventSuiteFirstPartyIdentity({ website: candidate.website, identityName: candidate.organiserName || candidate.canonicalName, sourceUrls: facts.map((item) => item.sourceUrl) }) ? FIRST_PARTY_SELF : undefined;
  const relationship = firstPartyStatus ? "UNKNOWN" : classifyAccountRelationship({ name: candidate.organiserName || candidate.canonicalName, website: candidate.website, summary: [...facts, ...candidate.inferences].map((item) => item.claim).join(" "), qualificationFit: facts.length ? "MEDIUM" : "UNKNOWN", relationship: candidate.relationshipHint }).relationship;
  const evaluated = evaluateProspectIntelligence({ relationship, territory, facts, inferences: candidate.inferences.filter((item) => item.kind === "INFERENCE"), unknowns: candidate.unknowns, commercialEvidence: candidate.commercialEvidence });
  const prospectIntelligence = firstPartyStatus ? { ...evaluated, primaryEntryOpportunity: "UNKNOWN" as const, commercialPriority: "LOW" as const, accountCreationEligible: false, accountCreationReason: "EventSuite first-party identity is not a prospect.", outreachEligibility: "BLOCKED" as const, outreachBlockOrReviewReason: "FIRST_PARTY_SELF — EventSuite first-party identity is not eligible for commercial memory or outreach.", firstPartyStatus } : evaluated;
  const freshness = prospectIntelligence.eventFreshness.state;
  const hasOrganiserEvidence = facts.some((item) => EVENT_CONTEXT_PATTERN.test(item.claim) && ORGANISER_PATTERN.test(item.claim));
  const providerNoise = relationship !== "COMPETITOR" && facts.some((item) => SERVICE_NOISE_PATTERN.test(item.claim)) && !hasOrganiserEvidence;
  const status: DiscoveryCandidateStatus = firstPartyStatus ? "REJECTED" : relationship === "COMPETITOR" ? "BLOCKED" : providerNoise ? "REJECTED" : freshness === "HISTORICAL" || freshness === "CANCELLED_DEAD_UNSUPPORTED" || prospectIntelligence.eventConnection.state === "NONE" ? "REJECTED" : prospectIntelligence.accountCreationEligible ? "QUALIFIED" : "REVIEW_REQUIRED";
  const organisationResolution = candidate.organisationResolution ?? { status: candidate.origin === "ORGANISATION_FIRST" ? "NOT_REQUIRED" as const : "UNRESOLVED" as const, canonicalOrganisationName: null, officialWebsite: null, aliases: [], confidence: "NONE" as const, evidence: [] };
  const sourceUrls = [...new Set(facts.map((item) => item.sourceUrl).filter((url): url is string => Boolean(url)))];
  const siteClassifications = [...(candidate.siteClassifications ?? []), ...(candidate.website ? [classifySourceSite({ url: candidate.website, claims: facts.map((item) => item.claim), candidateOrigin: candidate.origin })] : []), ...facts.filter((item) => item.sourceUrl).map((item) => classifySourceSite({ url: item.sourceUrl as string, claims: [item.claim], sourceTitle: item.sourceTitle, candidateOrigin: candidate.origin }))].filter((item, index, all) => all.findIndex((other) => other.url === item.url) === index);
  const persistedResolution = { ...organisationResolution, siteClassifications: [...(organisationResolution.siteClassifications ?? []), ...siteClassifications].filter((item, index, all) => all.findIndex((other) => other.url === item.url) === index) };
  return { ...candidate, facts, canonicalKey: canonicalDiscoveryKey(candidate.organiserName || candidate.canonicalName, candidate.website), relationship, status, prospectIntelligence, organisationResolution: persistedResolution, commercialEvidence: candidate.commercialEvidence ?? [], firstPartyStatus, siteClassifications, sourceUrls, enrichment: { status: "SKIPPED", attempted: false, succeeded: false, materiallyChanged: false, resolutionOutcome: persistedResolution.status, commercialOutcome: "NOT_RUN" as const, commerciallyAdvanced: false, skipReason: firstPartyStatus ? "FIRST_PARTY_SELF" : "OTHER_SAFE_REASON" } };
}

export function parseDiscovery(value: unknown, territory: DiscoveryTerritory) {
  if (!value || typeof value !== "object" || !Array.isArray((value as { candidates?: unknown }).candidates)) throw new Error("Discovery returned no candidate list.");
  const seen = new Set<string>();
  return (value as { candidates: DiscoveredCandidate[] }).candidates.filter((candidate) => candidate?.canonicalName?.trim() && candidate.facts?.some((fact) => fact.kind === "FACT" && fact.sourceUrl)).map((candidate) => { const website = candidate.website?.trim() || null; const providerSignal = candidate.origin === "EVENT_FIRST" && PROVIDER_HOST_PATTERN.test(domainOf(website) ?? ""); return evaluateDiscoveryCandidate({ ...candidate, organiserName: candidate.organiserName?.trim() || null, website: providerSignal ? null : website }, territory); }).filter((candidate) => { if (seen.has(candidate.canonicalKey)) return false; seen.add(candidate.canonicalKey); return true; });
}

export async function discoverProspects(input: { territory: DiscoveryTerritory; focus: DiscoveryFocus }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  if (!apiKey) throw new Error("AI_RESEARCH_NOT_CONFIGURED: OPENAI_API_KEY is required for real public discovery.");
  const territory = input.territory === "ZA" ? "South Africa" : "United Kingdom";
  const focus = input.focus === "ALL" ? "EGS, Ticketing and ECC" : input.focus;
  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, tools: [{ type: "web_search" }], max_output_tokens: 12000, input: `Find up to eight current public EventSuite sales candidates in ${territory}, focused on ${focus}. Today is ${new Date().toISOString().slice(0, 10)}. Discover commercially responsible organisations, not event lists. Use either EVENT_FIRST (event then responsible organisation) or ORGANISATION_FIRST (organiser/promoter/venue then its active event portfolio) only when public evidence supports that origin. Every FACT needs an authoritative URL, one or more source roles (DISCOVERY, VALIDATION, COMMERCIAL_EVIDENCE, CONTACT, SIGNAL), source confidence, and freshness (ACTIVE_UPCOMING, RECENT_RECURRING_EVIDENCE, HISTORICAL, CANCELLED_DEAD_UNSUPPORTED or UNKNOWN). Confirm organiser responsibility explicitly; a listing or artist appearance is not sufficient. Historical one-off or cancelled events are discovery memory, not live prospects. Diagnose EGS only from observable weak/fragmented owned digital presence; Ticketing only from a specific commercial problem, not provider use alone; ECC only from observed operational complexity. A ticketing provider is a COMPETITOR only when the organisation itself provides the product; an organiser using it remains a PROSPECT. Return FACTS, separate cautious INFERENCES and commercially relevant UNKNOWNs. Do not invent people, emails, dissatisfaction, recurrence, provider relationships or operational tools. No outreach, contact, scraping or crawling beyond this bounded web search.`, text: { format: { type: "json_schema", name: "prospecting_quality_foundation", strict: true, schema: candidateSchema } } } ) });
  if (!response.ok) throw new Error(`AI discovery provider failed with HTTP ${response.status}.`);
  const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const text = payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("");
  if (!text) throw new Error("AI discovery provider returned no structured output.");
  const initial = parseDiscovery(JSON.parse(text), input.territory);
  const enrichment = await enrichDiscoveryCandidates(initial, input.territory);
  return { candidates: enrichment.candidates, provider: "openai", model, enrichment: enrichment.telemetry };
}
