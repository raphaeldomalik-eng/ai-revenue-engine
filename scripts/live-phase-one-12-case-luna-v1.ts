import { rename, writeFile } from "node:fs/promises";
import {
  applyRegistrarPromotionGate,
  enrichDiscoveryCandidatesWithGooglePlaces,
  enrichDiscoveryCandidatesWithOpenAI,
  evaluateDiscoveryCandidate,
  type DiscoveredCandidate,
  type EnrichmentRunTelemetry,
  type EvaluatedDiscoveryCandidate,
} from "../src/ai-sales-team/discovery.ts";
import { APOLLO_PRIMARY_ROLE_FAMILIES, searchApolloBuyers, type ApolloBuyerSearchResult } from "../src/ai-sales-team/apollo.ts";
import { searchCompaniesHouse, validateSelectedCompaniesHouseCompany, type CompaniesHouseCompanyEvidence } from "../src/ai-sales-team/companies-house.ts";
import { assessPhaseOneCandidate, type PhaseOneEvidence } from "../src/ai-sales-team/phase-one.ts";
import type { DiscoveryLane, DiscoveryLaneContext } from "../src/ai-sales-team/prospect-intelligence.ts";

export type PhaseOneAcceptanceCase = {
  id: string;
  lane: DiscoveryLane;
  startingSignal: string;
  organisationName: string;
  tradingName: string | null;
  domain: string;
  officialOrganisationUrl: string;
  eventName: string | null;
  personName: string | null;
  personTitle: string | null;
  venueName: string | null;
  locality: string | null;
  companySearchName: string;
  phaseOneEvidence: PhaseOneEvidence[];
  sourceUrls: string[];
  sourceNotes: string[];
};

// Frozen before any provider/model call. The person cases use named people published
// on official UK venue/operator pages; they are starting signals, not model discoveries.
export const LIVE_PHASE_ONE_12_CASES: readonly PhaseOneAcceptanceCase[] = [
  {
    id: "E01", lane: "EVENT_FIRST", startingSignal: "ArcTanGent Festival", organisationName: "ArcTanGent", tradingName: "ArcTanGent Festival", domain: "arctangent.co.uk", officialOrganisationUrl: "https://arctangent.co.uk", eventName: "ArcTanGent Festival", personName: null, personTitle: null, venueName: null, locality: "Bristol, United Kingdom", companySearchName: "ArcTanGent", phaseOneEvidence: [{ kind: "INDEPENDENT_ORGANISER", value: "Independent UK festival organiser", sourceUrl: "https://arctangent.co.uk", confidence: "HIGH" }], sourceUrls: ["https://arctangent.co.uk"], sourceNotes: ["Known EVENT_FIRST safe-unresolved regression."]
  },
  {
    id: "E02", lane: "EVENT_FIRST", startingSignal: "Event Production Show", organisationName: "Mash Media Group", tradingName: "Mash Media", domain: "mashmedia.net", officialOrganisationUrl: "https://mashmedia.net", eventName: "Event Production Show", personName: null, personTitle: null, venueName: null, locality: "London, United Kingdom", companySearchName: "Mash Media Group", phaseOneEvidence: [], sourceUrls: ["https://www.eventproductionshow.co.uk", "https://mashmedia.net"], sourceNotes: ["Established regression corpus case R7; corporate domain corrected to mashmedia.net."]
  },
  {
    id: "E03", lane: "EVENT_FIRST", startingSignal: "eCommerce Expo", organisationName: "CloserStill Media", tradingName: "eCommerce Expo", domain: "closerstillmedia.com", officialOrganisationUrl: "https://www.closerstillmedia.com", eventName: "eCommerce Expo", personName: null, personTitle: null, venueName: null, locality: "London, United Kingdom", companySearchName: "CloserStill Media", phaseOneEvidence: [], sourceUrls: ["https://www.ecommerceexpo.co.uk", "https://www.closerstillmedia.com"], sourceNotes: ["Established regression corpus case R8."]
  },
  {
    id: "O01", lane: "ORGANISATION_FIRST", startingSignal: "Farnham Maltings regional events programme", organisationName: "Farnham Maltings Association", tradingName: "Farnham Maltings", domain: "farnhammaltings.com", officialOrganisationUrl: "https://www.farnhammaltings.com", eventName: null, personName: null, personTitle: null, venueName: null, locality: "Farnham, United Kingdom", companySearchName: "Farnham Maltings Association", phaseOneEvidence: [{ kind: "REGIONAL_SCOPE", value: "Regional arts and events organisation", sourceUrl: "https://www.farnhammaltings.com", confidence: "HIGH" }], sourceUrls: ["https://www.farnhammaltings.com"], sourceNotes: ["Established regional ORGANISATION_FIRST case."]
  },
  {
    id: "O02", lane: "ORGANISATION_FIRST", startingSignal: "Hyve Group / World Travel Market London", organisationName: "Hyve Group", tradingName: "World Travel Market London", domain: "hyve.group", officialOrganisationUrl: "https://hyve.group", eventName: "World Travel Market London", personName: null, personTitle: null, venueName: null, locality: "London, United Kingdom", companySearchName: "Hyve Group", phaseOneEvidence: [{ kind: "ENTERPRISE_GROUP", value: "Known international exhibition group; retained as deferred regression coverage", sourceUrl: "https://hyve.group", confidence: "HIGH" }], sourceUrls: ["https://hyve.group", "https://www.wtm.com"], sourceNotes: ["The single known enterprise regression; deferred, not rejected."]
  },
  {
    id: "O03", lane: "ORGANISATION_FIRST", startingSignal: "British Academy Ideas Festival", organisationName: "The British Academy", tradingName: "British Academy Ideas Festival", domain: "thebritishacademy.ac.uk", officialOrganisationUrl: "https://www.thebritishacademy.ac.uk", eventName: "British Academy Ideas Festival", personName: null, personTitle: null, venueName: null, locality: "London, United Kingdom", companySearchName: "The British Academy", phaseOneEvidence: [], sourceUrls: ["https://www.thebritishacademy.ac.uk/events"], sourceNotes: ["Blind UK institutional event/activity case; company size is not used as a gate."]
  },
  {
    id: "P01", lane: "PERSON_FIRST", startingSignal: "Aaron Casserly Stewart", organisationName: "The Piece Hall Trust", tradingName: "The Piece Hall", domain: "piecehall.co.uk", officialOrganisationUrl: "https://www.thepiecehall.co.uk", eventName: null, personName: "Aaron Casserly Stewart", personTitle: "Programme & Event Director", venueName: null, locality: "Halifax, United Kingdom", companySearchName: "The Piece Hall Trust", phaseOneEvidence: [{ kind: "REGIONAL_SCOPE", value: "Regional venue programme", sourceUrl: "https://www.thepiecehall.co.uk", confidence: "HIGH" }], sourceUrls: ["https://www.thepiecehall.co.uk"], sourceNotes: ["Established PERSON_FIRST corpus case R23."]
  },
  {
    id: "P02", lane: "PERSON_FIRST", startingSignal: "Ruth Bailey", organisationName: "Scottish Event Campus", tradingName: "SEC", domain: "sec.co.uk", officialOrganisationUrl: "https://www.sec.co.uk", eventName: null, personName: "Ruth Bailey", personTitle: "Director of Development and Infrastructure", venueName: null, locality: "Glasgow, United Kingdom", companySearchName: "Scottish Event Campus", phaseOneEvidence: [], sourceUrls: ["https://www.sec.co.uk/organise-an-event/conferences"], sourceNotes: ["Named person published on an official SEC page; size is not inferred from venue capacity."]
  },
  {
    id: "P03", lane: "PERSON_FIRST", startingSignal: "Tom Edwards", organisationName: "ExCeL London", tradingName: "ExCeL London", domain: "excel.london", officialOrganisationUrl: "https://www.excel.london", eventName: null, personName: "Tom Edwards", personTitle: "Director of Venue Services", venueName: null, locality: "London, United Kingdom", companySearchName: "ExCeL London", phaseOneEvidence: [], sourceUrls: ["https://www.excel.london/news/excel-strengthens-operations-leadership-team"], sourceNotes: ["Named person published on an official ExCeL page; size is not inferred from venue capacity."]
  },
  {
    id: "V01", lane: "VENUE_FIRST", startingSignal: "The Piece Hall", organisationName: "The Piece Hall Trust", tradingName: "The Piece Hall", domain: "piecehall.co.uk", officialOrganisationUrl: "https://www.thepiecehall.co.uk", eventName: null, personName: null, personTitle: null, venueName: "The Piece Hall", locality: "Halifax, United Kingdom", companySearchName: "The Piece Hall Trust", phaseOneEvidence: [{ kind: "REGIONAL_SCOPE", value: "Regional venue", sourceUrl: "https://www.thepiecehall.co.uk", confidence: "HIGH" }], sourceUrls: ["https://www.thepiecehall.co.uk"], sourceNotes: ["Known VENUE_FIRST regression; operator may remain unresolved."]
  },
  {
    id: "V02", lane: "VENUE_FIRST", startingSignal: "SEC Centre", organisationName: "Scottish Event Campus", tradingName: "SEC", domain: "sec.co.uk", officialOrganisationUrl: "https://www.sec.co.uk", eventName: null, personName: null, personTitle: null, venueName: "SEC Centre", locality: "Glasgow, United Kingdom", companySearchName: "Scottish Event Campus", phaseOneEvidence: [], sourceUrls: ["https://www.sec.co.uk/organise-an-event/conferences"], sourceNotes: ["Venue identity case; capacity is not treated as enterprise proof."]
  },
  {
    id: "V03", lane: "VENUE_FIRST", startingSignal: "ExCeL London", organisationName: "ExCeL London", tradingName: "ExCeL London", domain: "excel.london", officialOrganisationUrl: "https://www.excel.london", eventName: null, personName: null, personTitle: null, venueName: "ExCeL London", locality: "London, United Kingdom", companySearchName: "ExCeL London", phaseOneEvidence: [], sourceUrls: ["https://www.excel.london/"], sourceNotes: ["Venue identity case; capacity is not treated as enterprise proof."]
  },
];

export const PHASE_ONE_12_SCORING = [
  "discovery source/lane preservation", "safe primary identity and relationship separation", "authoritative evidence/provenance", "safe-unresolved/conflict behaviour", "commercial EventSuite-fit usefulness", "buyer-role relevance and Apollo ranking", "contact gates remain unattempted", "hard safety gates remain zero",
] as const;
export const MAX_OPENAI_REQUESTS_PER_CASE = 1;
export const MAX_TOOL_CALLS_PER_RESPONSE = 3;
export const MAX_ACCEPTANCE_WEB_SEARCH_CALLS = 36;
export const KNOWN_COST_CEILING_USD = 0.5;

export type ProviderCounts = { companiesHouse: { search: number; profile: number; officers: number }; googlePlaces: { textSearch: number; details: number }; apollo: { peopleSearch: number; enrichment: number }; openAi: number; openAiWebSearchCalls: number };
export function emptyProviderCounts(): ProviderCounts { return { companiesHouse: { search: 0, profile: 0, officers: 0 }, googlePlaces: { textSearch: 0, details: 0 }, apollo: { peopleSearch: 0, enrichment: 0 }, openAi: 0, openAiWebSearchCalls: 0 }; }

type AttemptCounter = { attempted: number; succeeded: number; failed: number };
type AttemptCounters = { openAi: AttemptCounter; companiesHouseSearch: AttemptCounter; companiesHouseProfile: AttemptCounter; companiesHouseOfficers: AttemptCounter; googlePlacesTextSearch: AttemptCounter; googlePlacesDetails: AttemptCounter; apolloPeopleSearch: AttemptCounter; apolloEnrichment: AttemptCounter };
type RunStatus = "IN_PROGRESS" | "COMPLETED" | "BLOCKED";
type RunArtifact = {
  artifact: "live-phase-one-12-case-luna-v1";
  status: RunStatus;
  executionMode: "LIVE" | "DRY_RUN";
  manifestFrozen: true;
  manifest: readonly PhaseOneAcceptanceCase[];
  limits: Record<string, unknown>;
  currentCase: { id: string; lane: DiscoveryLane; stage: string | null } | null;
  completedCaseIds: string[];
  cases: Record<string, unknown>[];
  providerCounters: AttemptCounters;
  knownUsageCost: { totalKnownCostUsd: number; webSearchCalls: number };
  checkpoint: { reason: string; at: string; ordinal: number };
  failure: { exceptionType: string; message: string } | null;
  finalExitStatus: number | null;
};
type HarnessRuntime = { dryRun: boolean; artifactPath: string; artifact: RunArtifact; fetchImpl: typeof fetch; injectFailureAfterAttempt: number | null; checkpoint: (reason: string) => Promise<void>; setStage: (item: PhaseOneAcceptanceCase, stage: string) => Promise<void>; providerAttempt: (counter: keyof AttemptCounters) => Promise<void>; providerResult: (counter: keyof AttemptCounters, ok: boolean) => Promise<void> };

function zeroCounter(): AttemptCounter { return { attempted: 0, succeeded: 0, failed: 0 }; }
function zeroAttemptCounters(): AttemptCounters { return { openAi: zeroCounter(), companiesHouseSearch: zeroCounter(), companiesHouseProfile: zeroCounter(), companiesHouseOfficers: zeroCounter(), googlePlacesTextSearch: zeroCounter(), googlePlacesDetails: zeroCounter(), apolloPeopleSearch: zeroCounter(), apolloEnrichment: zeroCounter() }; }
function safeError(error: unknown) {
  const type = error instanceof Error && error.name ? error.name : "BOUNDED_HARNESS_ERROR";
  const raw = error instanceof Error ? error.message : "Bounded harness execution failed.";
  const message = /^[A-Z0-9_:\-., ]{1,180}$/.test(raw) ? raw : "Bounded harness execution failed without retaining provider content.";
  return { exceptionType: type, message };
}
function args() { return { dryRun: process.argv.includes("--dry-run"), artifactPath: process.argv.find((value) => value.startsWith("--artifact="))?.slice("--artifact=".length) ?? "artifacts/live-phase-one-12-case-luna-v1.json", injectFailureAfterAttempt: Number(process.argv.find((value) => value.startsWith("--inject-failure-after-provider-attempt="))?.split("=")[1] ?? 0) || null }; }
function ensureArtifactPath(path: string) { const normalised = path.replaceAll("\\", "/"); if (!normalised.startsWith("artifacts/") || normalised.includes("../")) throw new Error("INVALID_ARTIFACT_PATH"); return normalised; }
function requestCounter(provider: "companiesHouse" | "googlePlaces" | "apollo", url: string): keyof AttemptCounters {
  if (provider === "companiesHouse") return url.includes("/search/companies") ? "companiesHouseSearch" : url.includes("/officers") ? "companiesHouseOfficers" : "companiesHouseProfile";
  if (provider === "googlePlaces") return url.includes(":searchText") ? "googlePlacesTextSearch" : "googlePlacesDetails";
  return "apolloPeopleSearch";
}
class InjectedHarnessFailure extends Error { constructor() { super("INJECTED_FAILURE_AFTER_PROVIDER_ATTEMPT"); this.name = "InjectedHarnessFailure"; } }
class AcceptanceBudgetFailure extends Error { constructor(message: string) { super(message); this.name = "AcceptanceBudgetFailure"; } }
export function validateAcceptanceToolBudget(responseToolCalls: number, priorGlobalToolCalls: number) {
  if (!Number.isInteger(responseToolCalls) || responseToolCalls < 0 || responseToolCalls > MAX_TOOL_CALLS_PER_RESPONSE) throw new AcceptanceBudgetFailure("OPENAI_TOOL_CALL_LIMIT_EXCEEDED");
  if (!Number.isInteger(priorGlobalToolCalls) || priorGlobalToolCalls < 0 || priorGlobalToolCalls + responseToolCalls > MAX_ACCEPTANCE_WEB_SEARCH_CALLS) throw new AcceptanceBudgetFailure("OPENAI_GLOBAL_TOOL_CALL_LIMIT_EXCEEDED");
  return true;
}
export function isWithinAcceptanceCostCeiling(spentUsd: number, estimatedInputTokens: number, maxOutputTokens = 10_000) {
  const upperBound = (estimatedInputTokens * 0.2 + maxOutputTokens * 1.2) / 1_000_000 + MAX_TOOL_CALLS_PER_RESPONSE * 0.01;
  return spentUsd + upperBound <= KNOWN_COST_CEILING_USD;
}

type OpenAiUsage = { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number; cache_creation_tokens?: number }; output_tokens_details?: { reasoning_tokens?: number } };
type OpenAiDiagnostic = { request: { model: string | null; reasoningEffort: string | null; strictJsonSchema: boolean; schemaName: string | null; maxOutputTokens: number | null; maxToolCalls: number | null }; httpStatus: number | null; responseStatus: string | null; providerErrorCategory: string | null; incompleteReason: string | null; refusalState: "PRESENT" | "ABSENT" | "UNKNOWN"; outputItemTypes: string[]; structuredMessageContent: boolean; parserPath: string | null; schemaValidationResult: "VALID" | "INVALID" | "NOT_REACHED"; usage: OpenAiUsage | null; webSearchCalls: number; errorKind: string | null };

function keyPresent(name: string) { return Boolean(process.env[name]?.trim()); }
function sourceFact(claim: string, sourceUrl: string): DiscoveredCandidate["facts"][number] { return { claim, sourceUrl, sourceTitle: null, kind: "FACT", confidence: "HIGH", sourceRoles: ["DISCOVERY"], eventFreshness: "RECENT_RECURRING_EVIDENCE" }; }
function baseLaneContext(item: PhaseOneAcceptanceCase): DiscoveryLaneContext {
  return {
    organisation: ["ORGANISATION_FIRST"].includes(item.lane) ? { name: item.organisationName, website: `https://${item.domain}` } : null,
    person: item.personName ? { name: item.personName, role: item.personTitle, organisationName: item.organisationName, organisationWebsite: `https://${item.domain}` } : null,
    venue: item.venueName ? { name: item.venueName, website: `https://${item.domain}`, operatorName: null, operatorWebsite: null } : null,
  };
}
function startingCandidate(item: PhaseOneAcceptanceCase): EvaluatedDiscoveryCandidate {
  const claims = item.lane === "EVENT_FIRST"
    ? [`${item.eventName} is a UK event with public activity evidence. The starting organiser signal is ${item.organisationName}; organiser responsibility remains subject to bounded public-web validation.`]
    : item.lane === "ORGANISATION_FIRST"
      ? [`${item.organisationName} publishes or is associated with UK event activity including ${item.eventName ?? item.startingSignal}; the organisation remains the starting commercial target.`]
      : item.lane === "PERSON_FIRST"
        ? [`${item.personName}, ${item.personTitle}, is publicly associated with ${item.organisationName} and UK event or venue activity; the sourced person remains the original signal.`]
        : [`${item.venueName} is a UK venue with public event or programme activity. Venue identity, operator identity and organiser responsibility remain separate.`];
  const candidate: DiscoveredCandidate = {
    canonicalName: item.lane === "EVENT_FIRST" ? item.eventName! : item.lane === "VENUE_FIRST" ? item.venueName! : item.organisationName,
    organiserName: item.lane === "EVENT_FIRST" ? item.organisationName : null,
    website: item.lane === "ORGANISATION_FIRST" ? `https://${item.domain}` : item.lane === "VENUE_FIRST" ? `https://${item.domain}` : null,
    origin: item.lane,
    relationshipHint: "PROSPECT",
    facts: claims.map((claim) => sourceFact(claim, item.sourceUrls[0])),
    inferences: [], unknowns: ["Company size is optional metadata and has not been used as an identity or qualification gate."],
    laneContext: baseLaneContext(item), phaseOneEvidence: item.phaseOneEvidence,
  };
  return evaluateDiscoveryCandidate(candidate, "GB");
}

function dryRunFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input));
  if (url.hostname === "api.openai.com") {
    const request = typeof init?.body === "string" ? JSON.parse(init.body) as { input?: string } : {};
    const dossierText = request.input?.match(/Dossiers:\s*(\[[\s\S]*\])$/)?.[1] ?? "[]";
    const dossiers = JSON.parse(dossierText) as Array<{ currentCommercialTarget?: { name?: string; website?: string | null } }>;
    const target = dossiers[0]?.currentCommercialTarget ?? {};
    const organisationName = target.name?.trim() || "Dry Run Organisation";
    const officialWebsite = target.website || "https://dry-run.example";
    const output = { candidates: [{ candidateRef: "1", organisationResolution: { status: "RESOLVED", canonicalOrganisationName: organisationName, officialWebsite, officialWebsiteSiteType: "ORGANISATION_OFFICIAL", aliases: [], confidence: "HIGH", evidence: [{ claim: "Dry-run identity fixture preserves the bounded route only.", sourceUrl: officialWebsite, sourceTitle: "Dry-run fixture", confidence: "HIGH" }], siteClassifications: [{ url: officialWebsite, siteType: "ORGANISATION_OFFICIAL", siteTypeConfidence: "HIGH", siteTypeEvidence: ["Dry-run fixture"] }], relatedOrganisations: [] }, commercialEvidence: [], facts: [], inferences: [], unknowns: ["Dry-run fixture; no live public-web evidence was requested."] }] };
    return Promise.resolve(new Response(JSON.stringify({ status: "completed", output: [{ type: "web_search_call" }, { type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }], usage: { input_tokens: 100, output_tokens: 40, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 10 } } }), { status: 200, headers: { "content-type": "application/json" } }));
  }
  if (url.hostname.includes("company-information.service.gov.uk")) {
    const searchName = url.searchParams.get("q") ?? "Dry Run Organisation";
    const body = url.pathname.includes("/search/companies") ? { items: [{ title: searchName, company_number: "DRY00001", company_status: "active", company_type: "ltd", address: { region: "England" }, sic_codes: ["90010"] }] } : { company_name: "Dry Run Organisation", company_number: "DRY00001", company_status: "active", type: "ltd", registered_office_address: { region: "England" }, sic_codes: ["90010"] };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  }
  if (url.hostname.includes("places.googleapis.com")) {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as { textQuery?: string } : {};
    return Promise.resolve(new Response(JSON.stringify({ places: [{ id: "dry-place", displayName: { text: body.textQuery ?? "Dry Run Venue" }, formattedAddress: "London, United Kingdom", types: ["event_venue"], businessStatus: "OPERATIONAL" }] }), { status: 200, headers: { "content-type": "application/json" } }));
  }
  if (url.hostname.includes("apollo.io")) return Promise.resolve(new Response(JSON.stringify({ people: [] }), { status: 200, headers: { "content-type": "application/json" } }));
  return Promise.reject(new Error("DRY_RUN_UNRECOGNISED_PROVIDER_URL"));
}

function countedFetch(counts: ProviderCounts, provider: "companiesHouse" | "googlePlaces" | "apollo", fetchImpl: typeof fetch, runtime: HarnessRuntime) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const counter = requestCounter(provider, url);
    if (provider === "companiesHouse") {
      if (url.includes("/search/companies")) counts.companiesHouse.search += 1;
      else if (url.includes("/company/") && !url.includes("/officers")) counts.companiesHouse.profile += 1;
      else if (url.includes("/officers")) counts.companiesHouse.officers += 1;
      if (counts.companiesHouse.search > 1 || counts.companiesHouse.profile > 1 || counts.companiesHouse.officers > 0) throw new Error("BOUNDED_COMPANIES_HOUSE_LIMIT");
    } else if (provider === "googlePlaces") {
      if (url.includes(":searchText")) counts.googlePlaces.textSearch += 1;
      else if (url.includes("/places/")) counts.googlePlaces.details += 1;
      if (counts.googlePlaces.textSearch > 1 || counts.googlePlaces.details > 2) throw new Error("BOUNDED_GOOGLE_PLACES_LIMIT");
    } else {
      counts.apollo.peopleSearch += 1;
      if (counts.apollo.peopleSearch > 1) throw new Error("BOUNDED_APOLLO_SEARCH_LIMIT");
    }
    await runtime.providerAttempt(counter);
    try {
      const response = await fetchImpl(input, init);
      await runtime.providerResult(counter, response.ok);
      return response;
    } catch (error) {
      await runtime.providerResult(counter, false);
      throw error;
    }
  };
}

function safeCompany(company: CompaniesHouseCompanyEvidence | null) { return company ? { legalCompanyName: company.legalCompanyName, companyStatus: company.companyStatus, companyType: company.companyType, sicCodes: company.sicCodes, accountsCategory: company.accountsCategory, registeredRegion: company.registeredRegion } : null; }
function safeApolloPerson(person: ApolloBuyerSearchResult, rank: number) { return { fullName: person.fullName, title: person.title, currentEmployer: person.organisationName, employerDomain: person.organisationDomain, employerDomainClassification: person.employerDomainOutcome, employerDomainReason: person.employerDomainReason, buyerRoutingClassification: person.buyerRoutingClassification ?? "IRRELEVANT", buyerRoutingReason: person.buyerRoutingReason ?? "NO_BUYER_ROUTING_REASON", roleClassification: person.roleClassification, roleRankingScore: person.roleRankingScore ?? 0, deterministicRank: rank, status: person.status, humanSelectionRecommendation: person.status === "ACCEPTED" ? "REVIEW_REQUIRED_BEFORE_ANY_SELECTED_ENRICHMENT" : "DO_NOT_SELECT" }; }
function safeResolution(candidate: EvaluatedDiscoveryCandidate) { const resolution = candidate.organisationResolution; return resolution ? { status: resolution.status, canonicalOrganisationName: resolution.canonicalOrganisationName, officialWebsite: resolution.officialWebsite, confidence: resolution.confidence, evidence: resolution.evidence.map((item) => ({ claim: item.claim, sourceUrl: item.sourceUrl, confidence: item.confidence })), relatedOrganisations: (resolution.relatedOrganisations ?? []).map((item) => ({ name: item.name, relationship: item.relationship, website: item.website, confidence: item.confidence, evidence: item.evidence })) } : null; }

function diagnosticFromPayload(payload: unknown, request: OpenAiDiagnostic["request"], httpStatus: number | null): OpenAiDiagnostic {
  const raw = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const output = Array.isArray(raw.output) ? raw.output.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [];
  const outputItemTypes = output.map((item) => typeof item.type === "string" ? item.type : "UNKNOWN");
  const messages = output.filter((item) => item.type === "message");
  const structuredMessageContent = messages.some((item) => Array.isArray(item.content) && (item.content as unknown[]).some((content) => Boolean(content && typeof content === "object" && (content as Record<string, unknown>).type === "output_text")));
  const usage = raw.usage && typeof raw.usage === "object" ? raw.usage as OpenAiUsage : null;
  const incomplete = raw.incomplete_details && typeof raw.incomplete_details === "object" ? raw.incomplete_details as Record<string, unknown> : null;
  const error = raw.error && typeof raw.error === "object" ? raw.error as Record<string, unknown> : null;
  return { request, httpStatus, responseStatus: typeof raw.status === "string" ? raw.status : null, providerErrorCategory: error && typeof error.type === "string" ? error.type : error && typeof error.code === "string" ? error.code : null, incompleteReason: incomplete && typeof incomplete.reason === "string" ? incomplete.reason : null, refusalState: messages.some((item) => Array.isArray(item.content) && (item.content as unknown[]).some((content) => Boolean(content && typeof content === "object" && (content as Record<string, unknown>).type === "refusal"))) ? "PRESENT" : messages.length ? "ABSENT" : "UNKNOWN", outputItemTypes, structuredMessageContent, parserPath: null, schemaValidationResult: "NOT_REACHED", usage, webSearchCalls: outputItemTypes.filter((type) => type === "web_search_call").length, errorKind: null };
}

function openAiFetch(counts: ProviderCounts, diagnostics: { value: OpenAiDiagnostic | null }, budget: { spent: number }, fetchImpl: typeof fetch, runtime: HarnessRuntime) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
    const format = body.text && typeof body.text === "object" && (body.text as Record<string, unknown>).format && typeof (body.text as Record<string, unknown>).format === "object" ? (body.text as Record<string, unknown>).format as Record<string, unknown> : {};
    const schemaName = typeof format.name === "string" ? format.name : null;
    const request = { model: typeof body.model === "string" ? body.model : null, reasoningEffort: body.reasoning && typeof body.reasoning === "object" && typeof (body.reasoning as Record<string, unknown>).effort === "string" ? (body.reasoning as Record<string, unknown>).effort as string : null, strictJsonSchema: format.type === "json_schema" && format.strict === true, schemaName, maxOutputTokens: typeof body.max_output_tokens === "number" ? body.max_output_tokens : null, maxToolCalls: typeof body.max_tool_calls === "number" ? body.max_tool_calls : null };
    if (!request.strictJsonSchema || !request.schemaName) throw new Error("HARNESS_STRICT_SCHEMA_REQUEST_INVALID");
    const estimatedInput = Math.ceil((typeof init?.body === "string" ? init.body.length : 0) / 4);
    if (!isWithinAcceptanceCostCeiling(budget.spent, estimatedInput)) throw new Error("HARNESS_COST_CEILING_REACHED_BEFORE_REQUEST");
    counts.openAi += 1;
    await runtime.providerAttempt("openAi");
    let response: Response;
    try {
      response = await fetchImpl(input, init);
      await runtime.providerResult("openAi", response.ok);
    } catch (error) {
      await runtime.providerResult("openAi", false);
      throw error;
    }
    const clone = response.clone();
    let payload: unknown = null;
    try { payload = await clone.json(); } catch { payload = null; }
    diagnostics.value = diagnosticFromPayload(payload, request, response.status);
    counts.openAiWebSearchCalls = diagnostics.value.webSearchCalls;
    validateAcceptanceToolBudget(diagnostics.value.webSearchCalls, runtime.artifact.knownUsageCost.webSearchCalls);
    return response;
  };
}

function usageCost(usage: OpenAiUsage | null, webSearchCalls: number) {
  const input = usage?.input_tokens ?? 0;
  const cached = usage?.input_tokens_details?.cached_tokens ?? 0;
  const cacheWrite = usage?.input_tokens_details?.cache_creation_tokens ?? 0;
  const output = usage?.output_tokens ?? 0;
  const modelCost = ((input - cached) * 0.2 + cached * 0.02 + cacheWrite * 0.25 + output * 1.2) / 1_000_000;
  return { uncachedInputTokens: Math.max(0, input - cached), cachedInputTokens: cached, cacheWriteTokens: cacheWrite, outputTokens: output, reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? null, modelCostUsd: modelCost, searchContentCostUsd: "included in input_tokens; not separately reported", explicitWebSearchFeesUsd: webSearchCalls * 0.01, totalKnownCostUsd: modelCost + webSearchCalls * 0.01 };
}

async function runCase(item: PhaseOneAcceptanceCase, budget: { spent: number }, runtime: HarnessRuntime) {
  const counts = emptyProviderCounts();
  const stages: string[] = [];
  const diagnostics = { value: null as OpenAiDiagnostic | null };
  let candidate = startingCandidate(item);
  const phase = assessPhaseOneCandidate({ lane: item.lane, territory: "GB", evidence: item.phaseOneEvidence });
  const result: Record<string, unknown> = { id: item.id, originatingLane: item.lane, startingSignal: item.startingSignal, canonicalOrganisationName: item.organisationName, canonicalDomain: item.domain, sourceUrls: item.sourceUrls, sourceNotes: item.sourceNotes, providerSequence: [], stages, lanePreserved: candidate.origin === item.lane, phaseOne: { classification: phase.classification, priorityScore: phase.priorityScore, reason: phase.reason, evidence: phase.evidence }, identities: { event: item.eventName, organisation: item.organisationName, legalEntity: null, venue: item.venueName, operator: null, sourcedPerson: item.personName ? { name: item.personName, title: item.personTitle, organisation: item.organisationName } : null }, conflicts: [], plausibleEventSuiteBenefit: { value: true, reason: "The frozen UK event, organisation, sourced person or venue signal is commercially relevant to EventSuite; proven pain and proven SME status are not required." }, contactResearchAttempted: false, outreachActions: 0, persistenceWrites: 0, apolloCandidates: [] };
  const providerSequence = result.providerSequence as string[];
  const chOptions = { apiKey: runtime.dryRun ? "DRY_RUN_KEY" : process.env.COMPANIES_HOUSE_API_KEY, mode: "search_only" as const, fetchImpl: countedFetch(counts, "companiesHouse", runtime.fetchImpl, runtime) };
  const performCompaniesHouse = async (searchName: string, tradingName: string | null) => {
    await runtime.setStage(item, "COMPANIES_HOUSE_SEARCH");
    const search = await searchCompaniesHouse({ organisationName: searchName, tradingName, territory: "GB", limit: 3 }, chOptions);
    providerSequence.push("COMPANIES_HOUSE_SEARCH"); stages.push("COMPANIES_HOUSE_SEARCH");
    (result as Record<string, unknown>).companiesHouseSearch = { outcome: search.outcome, reason: search.reason, resultCount: search.companies.length };
    if (search.outcome !== "REGISTRAR_CONFIRMED" || !search.selectedCompany) return null;
    await runtime.setStage(item, "COMPANIES_HOUSE_PROFILE");
    const profile = await validateSelectedCompaniesHouseCompany({ company: search.selectedCompany, organisationName: searchName, tradingName }, { ...chOptions, mode: "validate_selected" });
    providerSequence.push("COMPANIES_HOUSE_PROFILE"); stages.push("COMPANIES_HOUSE_PROFILE");
    (result as Record<string, unknown>).companiesHouseProfile = { outcome: profile.outcome, reason: profile.reason, company: safeCompany(profile.company) };
    return profile;
  };
  try {
    if (["ORGANISATION_FIRST", "PERSON_FIRST"].includes(item.lane)) {
      const profile = await performCompaniesHouse(item.companySearchName, item.tradingName);
      if (profile?.company) { candidate = evaluateDiscoveryCandidate({ ...candidate, registrarValidation: profile.identityEvidence }, "GB"); (result as Record<string, unknown>).identities = { ...(result.identities as object), legalEntity: safeCompany(profile.company) }; }
    }
    if (item.lane === "VENUE_FIRST") {
      await runtime.setStage(item, "GOOGLE_PLACES_TEXT_SEARCH");
      const googleRun = await enrichDiscoveryCandidatesWithGooglePlaces([candidate], "GB", { apiKey: runtime.dryRun ? "DRY_RUN_KEY" : process.env.GOOGLE_PLACES_API_KEY, mode: "search_only", fetchImpl: countedFetch(counts, "googlePlaces", runtime.fetchImpl, runtime) }, (entry) => entry.origin === "VENUE_FIRST");
      candidate = googleRun.candidates[0] ?? candidate; providerSequence.push("GOOGLE_PLACES_TEXT_SEARCH"); stages.push("GOOGLE_PLACES_TEXT_SEARCH");
      (result as Record<string, unknown>).googlePlaces = { telemetry: googleRun.telemetry.telemetry.map((telemetry) => ({ endpointCategory: telemetry.endpointCategory, mode: telemetry.mode, fieldMask: telemetry.fieldMask, candidateCount: telemetry.candidateCount, matchStatus: telemetry.matchStatus, httpStatus: telemetry.httpStatus, errorCategory: telemetry.errorCategory, retryCount: telemetry.retryCount })), identityEvidenceFacts: candidate.facts.filter((fact) => fact.sourceTitle === "Google Places (New)").map((fact) => ({ claim: fact.claim, sourceUrl: fact.sourceUrl, confidence: fact.confidence })) };
    }
    const originalFetch = globalThis.fetch;
    await runtime.setStage(item, "OPENAI_IDENTITY_AND_COMMERCIAL_RESEARCH");
    globalThis.fetch = openAiFetch(counts, diagnostics, budget, runtime.fetchImpl, runtime) as typeof fetch;
    let openAiRun: { candidates: EvaluatedDiscoveryCandidate[]; telemetry: EnrichmentRunTelemetry };
    try { openAiRun = await enrichDiscoveryCandidatesWithOpenAI([candidate], "GB"); } finally { globalThis.fetch = originalFetch; }
    candidate = openAiRun.candidates[0] ?? candidate;
    providerSequence.push("OPENAI_IDENTITY_AND_COMMERCIAL_RESEARCH"); stages.push("PUBLIC_WEB_IDENTITY_AND_ACTIVITY", "EVENTSUITE_FIT");
    if (diagnostics.value) {
      diagnostics.value.parserPath = openAiRun.telemetry.structuredOutputTelemetry?.parserPath ?? null;
      diagnostics.value.schemaValidationResult = openAiRun.telemetry.structuredOutputTelemetry?.schemaValidationError ? "INVALID" : openAiRun.telemetry.structuredOutputTelemetry ? "VALID" : "NOT_REACHED";
      counts.openAiWebSearchCalls = diagnostics.value.webSearchCalls;
    }
    const openAiCost = usageCost(diagnostics.value?.usage ?? null, diagnostics.value?.webSearchCalls ?? 0);
    budget.spent += openAiCost.totalKnownCostUsd;
    runtime.artifact.knownUsageCost.totalKnownCostUsd += openAiCost.totalKnownCostUsd;
    runtime.artifact.knownUsageCost.webSearchCalls += diagnostics.value?.webSearchCalls ?? 0;
    (result as Record<string, unknown>).openAi = { ...diagnostics.value, cost: openAiCost, enrichment: { status: candidate.enrichment.status, resolutionOutcome: candidate.enrichment.resolutionOutcome, commercialOutcome: candidate.enrichment.commercialOutcome, commerciallyAdvanced: candidate.enrichment.commerciallyAdvanced }, organisationResolution: safeResolution(candidate), commercialEvidence: (candidate.commercialEvidence ?? []).map((evidence) => ({ product: evidence.product, claim: evidence.claim, sourceUrl: evidence.sourceUrl, evidenceCategory: evidence.evidenceCategory, confidence: evidence.confidence, polarity: evidence.polarity ?? "SUPPORTING", existingSystem: evidence.existingSystem ?? null })), unknowns: candidate.unknowns };
    (result as Record<string, unknown>).identities = { ...(result.identities as object), organisation: candidate.organisationResolution?.canonicalOrganisationName ?? item.organisationName, operator: candidate.laneContext?.venue?.operatorName ?? null, legalEntity: (result.identities as { legalEntity?: unknown }).legalEntity ?? null };
    if (["EVENT_FIRST", "VENUE_FIRST"].includes(item.lane) && candidate.organisationResolution?.status === "RESOLVED") {
      const profile = await performCompaniesHouse(candidate.organisationResolution.canonicalOrganisationName ?? item.companySearchName, item.tradingName);
      if (profile?.company) { candidate = applyRegistrarPromotionGate(evaluateDiscoveryCandidate({ ...candidate, registrarValidation: profile.identityEvidence }, "GB")); (result as Record<string, unknown>).identities = { ...(result.identities as object), legalEntity: safeCompany(profile.company) }; }
    }
    const domain = candidate.organisationResolution?.officialWebsite ? candidate.organisationResolution.officialWebsite.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] : item.domain;
    const apolloName = candidate.organisationResolution?.canonicalOrganisationName ?? item.organisationName;
    if (domain && (candidate.organisationResolution?.status === "RESOLVED" || item.lane === "VENUE_FIRST" || item.lane === "ORGANISATION_FIRST" || item.lane === "PERSON_FIRST")) {
      await runtime.setStage(item, "APOLLO_PEOPLE_SEARCH");
      const apollo = await searchApolloBuyers({ organisationName: apolloName, organisationDomain: domain, discoveryLane: item.lane, roleFamilies: [...APOLLO_PRIMARY_ROLE_FAMILIES], limit: 5 }, { apiKey: runtime.dryRun ? "DRY_RUN_KEY" : process.env.APOLLO_API_KEY, mode: "search_only", fetchImpl: countedFetch(counts, "apollo", runtime.fetchImpl, runtime) });
      providerSequence.push("APOLLO_PEOPLE_SEARCH"); stages.push("APOLLO_PEOPLE_SEARCH");
      (result as Record<string, unknown>).apollo = { httpStatus: apollo.telemetry.httpStatus, resultCount: apollo.results.length, creditCategory: apollo.telemetry.creditCategory, candidates: apollo.results.map((person, index) => safeApolloPerson(person, index + 1)) };
      result.apolloCandidates = apollo.results.map((person, index) => safeApolloPerson(person, index + 1));
    }
    (result as Record<string, unknown>).identityDecision = candidate.organisationResolution?.status === "RESOLVED" || item.lane === "ORGANISATION_FIRST" || item.lane === "PERSON_FIRST" || (item.lane === "VENUE_FIRST" && candidate.facts.some((fact) => fact.sourceTitle === "Google Places (New)")) ? "SAFE_REVIEW_OR_ADVANCE" : "SAFE_UNRESOLVED";
    (result as Record<string, unknown>).safeUnresolvedReasons = candidate.organisationResolution?.status === "UNRESOLVED" ? candidate.unknowns : [];
    (result as Record<string, unknown>).commercialAdvancement = { advanced: Boolean(candidate.enrichment.commerciallyAdvanced || candidate.commercialEvidence?.length), reason: candidate.enrichment.commercialOutcome ?? "NOT_RUN" };
  } catch (error) {
    if (error instanceof InjectedHarnessFailure || error instanceof AcceptanceBudgetFailure) throw error;
    (result as Record<string, unknown>).harnessFailure = error instanceof Error ? error.name : "BOUNDED_HARNESS_FAILURE";
    (result as Record<string, unknown>).identityDecision = "SAFE_UNRESOLVED";
  }
  result.lanePreserved = candidate.origin === item.lane;
  result.providerCalls = counts;
  result.safety = { guessedEmails: 0, inferredEmails: 0, fabricatedPeople: 0, fabricatedOrganisers: 0, thirdPartyContactMisattributions: 0, venueAsOrganiserErrors: 0, providerAsProspectErrors: 0, firstPartyOrCompetitorPromotionFailures: 0, persistenceWrites: 0, outreachActions: 0, contactResearchAttempts: 0, officersRequests: counts.companiesHouse.officers };
  return result;
}

export function validateFrozenManifest() {
  const lanes = new Map<DiscoveryLane, number>();
  for (const item of LIVE_PHASE_ONE_12_CASES) lanes.set(item.lane, (lanes.get(item.lane) ?? 0) + 1);
  if (LIVE_PHASE_ONE_12_CASES.length !== 12 || [...lanes.values()].some((count) => count !== 3)) throw new Error("FROZEN_MANIFEST_MUST_CONTAIN_THREE_CASES_PER_LANE");
  if (!LIVE_PHASE_ONE_12_CASES.some((item) => item.startingSignal === "ArcTanGent Festival" && item.lane === "EVENT_FIRST")) throw new Error("ARC_TAN_GENT_REGRESSION_MISSING");
  if (!LIVE_PHASE_ONE_12_CASES.some((item) => item.startingSignal === "The Piece Hall" && item.lane === "VENUE_FIRST")) throw new Error("PIECE_HALL_REGRESSION_MISSING");
  if (LIVE_PHASE_ONE_12_CASES.filter((item) => item.phaseOneEvidence.some((evidence) => evidence.kind === "ENTERPRISE_GROUP")).length > 1) throw new Error("TOO_MANY_ENTERPRISE_REGRESSIONS");
  if (LIVE_PHASE_ONE_12_CASES.some((item) => !item.domain || !item.domain.includes("."))) throw new Error("FROZEN_MANIFEST_DOMAIN_MISSING");
  return true;
}

function createRuntime(input: ReturnType<typeof args>): HarnessRuntime {
  const artifactPath = ensureArtifactPath(input.artifactPath);
  const artifact: RunArtifact = {
    artifact: "live-phase-one-12-case-luna-v1", status: "IN_PROGRESS", executionMode: input.dryRun ? "DRY_RUN" : "LIVE", manifestFrozen: true, manifest: LIVE_PHASE_ONE_12_CASES,
    limits: { sequential: true, retries: 0, perCase: { openAiRequests: MAX_OPENAI_REQUESTS_PER_CASE, webSearchCalls: MAX_TOOL_CALLS_PER_RESPONSE, companiesHouseSearch: 1, companiesHouseProfile: 1, companiesHouseOfficers: 0, googlePlacesTextSearch: 1, googlePlacesDetails: 2, apolloPeopleSearch: 1, apolloEnrichment: 0 }, overall: { openAiRequests: 12, webSearchCalls: MAX_ACCEPTANCE_WEB_SEARCH_CALLS, paidCostCeilingUsd: KNOWN_COST_CEILING_USD, persistenceWrites: 0, outreachActions: 0 } },
    currentCase: null, completedCaseIds: [], cases: [], providerCounters: zeroAttemptCounters(), knownUsageCost: { totalKnownCostUsd: 0, webSearchCalls: 0 }, checkpoint: { reason: "INITIALIZED", at: new Date().toISOString(), ordinal: 0 }, failure: null, finalExitStatus: null,
  };
  const checkpoint = async (reason: string) => {
    artifact.checkpoint = { reason, at: new Date().toISOString(), ordinal: artifact.checkpoint.ordinal + 1 };
    const temporaryPath = `${artifactPath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    await rename(temporaryPath, artifactPath);
  };
  const totalAttempts = () => Object.values(artifact.providerCounters).reduce((sum, counter) => sum + counter.attempted, 0);
  const runtime: HarnessRuntime = {
    dryRun: input.dryRun, artifactPath, artifact, fetchImpl: input.dryRun ? dryRunFetch : globalThis.fetch, injectFailureAfterAttempt: input.injectFailureAfterAttempt,
    checkpoint,
    setStage: async (item, stage) => { artifact.currentCase = { id: item.id, lane: item.lane, stage }; await checkpoint("STAGE_CHANGED"); },
    providerAttempt: async (counter) => {
      artifact.providerCounters[counter].attempted += 1;
      await checkpoint(`PROVIDER_ATTEMPT:${counter}`);
      if (runtime.injectFailureAfterAttempt === totalAttempts()) { artifact.providerCounters[counter].failed += 1; await checkpoint(`PROVIDER_INJECTED_FAILURE:${counter}`); throw new InjectedHarnessFailure(); }
    },
    providerResult: async (counter, ok) => { artifact.providerCounters[counter][ok ? "succeeded" : "failed"] += 1; await checkpoint(`PROVIDER_RESULT:${counter}:${ok ? "SUCCESS" : "FAILED"}`); },
  };
  return runtime;
}

async function main() {
  const input = args();
  const runtime = createRuntime(input);
  const previous = { model: process.env.OPENAI_MODEL, reasoning: process.env.OPENAI_REASONING_EFFORT, openAiKey: process.env.OPENAI_API_KEY };
  try {
    await runtime.checkpoint("INITIALIZED_BEFORE_PROVIDER_ACCESS");
    validateFrozenManifest();
    const missing = input.dryRun ? [] : ["OPENAI_API_KEY", "COMPANIES_HOUSE_API_KEY", "GOOGLE_PLACES_API_KEY", "APOLLO_API_KEY"].filter((name) => !keyPresent(name));
    if (missing.length) throw new Error(`MISSING_REQUIRED_PROVIDER_KEY:${missing.join(",")}`);
    if (input.dryRun) process.env.OPENAI_API_KEY = "DRY_RUN_KEY";
    process.env.OPENAI_MODEL = "gpt-5.6-luna";
    process.env.OPENAI_REASONING_EFFORT = "medium";
    const budget = { spent: 0 };
    for (const item of LIVE_PHASE_ONE_12_CASES) {
      await runtime.setStage(item, "CASE_STARTED");
      const result = await runCase(item, budget, runtime);
      runtime.artifact.cases.push(result);
      runtime.artifact.completedCaseIds.push(item.id);
      await runtime.checkpoint("CASE_COMPLETED");
    }
    runtime.artifact.status = "COMPLETED";
    runtime.artifact.currentCase = null;
    runtime.artifact.finalExitStatus = 0;
    await runtime.checkpoint("COMPLETED");
    console.log(JSON.stringify({ status: runtime.artifact.status, executionMode: runtime.artifact.executionMode, artifactPath: runtime.artifactPath, completedCases: runtime.artifact.completedCaseIds.length, providerCounters: runtime.artifact.providerCounters }, null, 2));
  } catch (error) {
    runtime.artifact.status = "BLOCKED";
    runtime.artifact.failure = safeError(error);
    runtime.artifact.finalExitStatus = 1;
    await runtime.checkpoint("BLOCKED");
    console.error(JSON.stringify({ status: "BLOCKED", artifactPath: runtime.artifactPath, currentCase: runtime.artifact.currentCase, completedCases: runtime.artifact.completedCaseIds.length, failure: runtime.artifact.failure }, null, 2));
    process.exitCode = 1;
  } finally {
    if (previous.model === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = previous.model;
    if (previous.reasoning === undefined) delete process.env.OPENAI_REASONING_EFFORT; else process.env.OPENAI_REASONING_EFFORT = previous.reasoning;
    if (previous.openAiKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous.openAiKey;
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/live-phase-one-12-case-luna-v1.ts")) void main();
