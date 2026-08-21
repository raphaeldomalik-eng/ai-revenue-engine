import { writeFile } from "node:fs/promises";
import { searchApolloBuyers, APOLLO_PRIMARY_ROLE_FAMILIES } from "../src/ai-sales-team/apollo.ts";
import { applyRegistrarPromotionGate, enrichDiscoveryCandidatesWithGooglePlaces, enrichDiscoveryCandidatesWithOpenAI, evaluateDiscoveryCandidate, type EvaluatedDiscoveryCandidate } from "../src/ai-sales-team/discovery.ts";
import { searchCompaniesHouse, validateSelectedCompaniesHouseCompany } from "../src/ai-sales-team/companies-house.ts";
import { FROZEN_CASES, countedFetch, emptyCounts, type Counts, type FrozenCase } from "./live-phase-one-four-lane-v1.ts";

type Usage = { input_tokens?: number; input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number }; output_tokens?: number; output_tokens_details?: { reasoning_tokens?: number } };
type LiveCase = FrozenCase & { id: "P1" | "P4" };
const selectedCaseIds = new Set((process.env.PHASE_ONE_ROUTING_CASE_IDS || "P1,P4").split(",").map((item) => item.trim()).filter(Boolean));
const CASES = FROZEN_CASES.filter((item): item is LiveCase => (item.id === "P1" || item.id === "P4") && selectedCaseIds.has(item.id));
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const MODEL_PRICES = { input: 0.4, cached: 0.1, output: 1.6 };
const WEB_SEARCH_CALL_FEE_USD = 0.01;
const KNOWN_COST_CEILING_USD = 0.25;

function keyPresent(name: string) { return Boolean(process.env[name]?.trim()); }
function fact(claim: string, sourceUrl: string) { return { claim, sourceUrl, sourceTitle: "Frozen official source input", kind: "FACT" as const, confidence: "HIGH" as const, sourceRoles: ["DISCOVERY" as const], eventFreshness: "ACTIVE_UPCOMING" as const }; }
function candidateFor(item: LiveCase): EvaluatedDiscoveryCandidate {
  const venue = item.lane === "VENUE_FIRST" ? { name: item.venueName!, website: null, operatorName: null, operatorWebsite: null } : null;
  return evaluateDiscoveryCandidate({ canonicalName: item.lane === "EVENT_FIRST" ? item.eventName! : item.venueName!, organiserName: item.lane === "EVENT_FIRST" ? item.organisationName : null, website: null, origin: item.lane, relationshipHint: "PROSPECT", laneContext: { organisation: null, person: null, venue }, facts: [fact(item.lane === "EVENT_FIRST" ? `${item.eventName} is a current recurring event and ${item.organisationName} organises it.` : `${item.venueName} hosts an upcoming events programme.`, item.officialOrganisationUrl)], inferences: [], unknowns: ["Current canonical legal entity requires bounded validation."] }, "GB");
}
function responseUsage(payload: unknown): Usage | null { return payload && typeof payload === "object" && (payload as { usage?: Usage }).usage ? (payload as { usage: Usage }).usage : null; }
function webSearchCalls(payload: unknown) { return payload && typeof payload === "object" && Array.isArray((payload as { output?: unknown }).output) ? (payload as { output: Array<{ type?: string }> }).output.filter((item) => item.type === "web_search_call").length : 0; }
function estimateCost(body: Record<string, unknown>) { const input = Math.ceil(String(body.input ?? "").length / 4); const output = Number(body.max_output_tokens ?? 0); const searchContent = Array.isArray(body.tools) && (body.tools as Array<{ type?: string }>).some((item) => item.type === "web_search") ? 8000 : 0; return ((input - 0) * MODEL_PRICES.input + output * MODEL_PRICES.output + searchContent * MODEL_PRICES.input) / 1_000_000 + (searchContent ? WEB_SEARCH_CALL_FEE_USD : 0); }
function safeCompany(company: { legalCompanyName: string; companyStatus: string | null; companyType: string | null; sicCodes: string[]; accountsCategory?: string | null; registeredRegion: string | null } | null | undefined) { return company ? { legalCompanyName: company.legalCompanyName, companyStatus: company.companyStatus, companyType: company.companyType, sicCodes: company.sicCodes, accountsCategory: company.accountsCategory, registeredRegion: company.registeredRegion } : null; }
function safeError(error: unknown) { const telemetry = error && typeof error === "object" && "telemetry" in error ? (error as { telemetry?: { errorCategory?: string | null; httpStatus?: number | null } }).telemetry : null; return { category: telemetry?.errorCategory ?? "PROVIDER_ERROR", httpStatus: telemetry?.httpStatus ?? null }; }

async function runCase(item: LiveCase, originalFetch: typeof fetch, projectedCost: { value: number }) {
  const counts: Counts = emptyCounts();
  const candidate = candidateFor(item);
  const providerSequence: string[] = [];
  const result: Record<string, unknown> = { id: item.id, lane: item.lane, signal: item.startingSignal, phaseOne: { classification: "PHASE_ONE_SME", reason: "Frozen official-source evidence identifies a UK independent or regional event-sector target; SME priority is applied without guessing from capacity or account category." }, lanePreserved: true, providerSequence, openAi: { calls: 0, model: MODEL, usage: null, webSearchCalls: 0 }, companiesHouse: { search: 0, profile: 0, outcome: null, reason: null, company: null }, googlePlaces: null, apollo: null, identities: { event: item.eventName, venue: item.venueName, operator: null, organisation: null, legalCompany: null }, conflicts: [], contactResearchAttempted: false, enrichmentAttempted: false, persistenceWrites: 0, outreachActions: 0 };
  let current = candidate;
  if (item.lane === "VENUE_FIRST") {
    const places = await enrichDiscoveryCandidatesWithGooglePlaces([current], "GB", { apiKey: process.env.GOOGLE_PLACES_API_KEY, mode: "details_selected", fetchImpl: countedFetch(counts, "googlePlaces", originalFetch) }, () => true);
    current = places.candidates[0];
    providerSequence.push("GOOGLE_PLACES");
    result.googlePlaces = { telemetry: places.telemetry.telemetry, identity: { venueName: current.laneContext?.venue?.name ?? null, address: current.facts.find((item) => item.sourceRoles?.includes("VALIDATION"))?.claim ?? null, operator: null }, detailsCalls: counts.googlePlaces.details };
  }
  const originalModel = process.env.OPENAI_MODEL;
  const originalReasoning = process.env.OPENAI_REASONING_EFFORT;
  process.env.OPENAI_MODEL = MODEL;
  delete process.env.OPENAI_REASONING_EFFORT;
  let aiPayload: unknown = null;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("api.openai.com/v1/responses")) return originalFetch(input, init);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
    const estimate = estimateCost(body);
    if (projectedCost.value + estimate > KNOWN_COST_CEILING_USD) throw new Error("KNOWN_COST_CEILING_REACHED_BEFORE_OPENAI_REQUEST");
    projectedCost.value += estimate;
    counts.openAi += 1;
    if (counts.openAi > 1) throw new Error("OPENAI_CASE_REQUEST_LIMIT");
    const response = await originalFetch(input, init);
    const clone = response.clone();
    aiPayload = await clone.json().catch(() => null);
    return response;
  };
  try {
    const ai = await enrichDiscoveryCandidatesWithOpenAI([current], "GB");
    current = ai.candidates[0];
    providerSequence.push("OPENAI_PUBLIC_WEB_IDENTITY");
    result.openAi = { calls: counts.openAi, model: MODEL, usage: responseUsage(aiPayload), webSearchCalls: webSearchCalls(aiPayload), structuredOutputTelemetry: ai.telemetry.structuredOutputTelemetry ?? null };
  } finally {
    globalThis.fetch = originalFetch;
    if (originalModel === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = originalModel;
    if (originalReasoning === undefined) delete process.env.OPENAI_REASONING_EFFORT; else process.env.OPENAI_REASONING_EFFORT = originalReasoning;
  }
  const resolution = current.organisationResolution?.status === "RESOLVED" ? current.organisationResolution : null;
  if (resolution?.canonicalOrganisationName && resolution.officialWebsite) {
    const ch = await searchCompaniesHouse({ organisationName: resolution.canonicalOrganisationName, tradingName: item.tradingName, territory: "GB", limit: 5 }, { apiKey: process.env.COMPANIES_HOUSE_API_KEY, mode: "search_only", fetchImpl: countedFetch(counts, "companiesHouse", originalFetch) });
    providerSequence.push("COMPANIES_HOUSE_SEARCH");
    result.companiesHouse = { search: counts.companiesHouse.search, profile: 0, outcome: ch.outcome, reason: ch.reason, company: null };
    if (ch.outcome === "REGISTRAR_CONFIRMED" && ch.selectedCompany) {
      const profile = await validateSelectedCompaniesHouseCompany({ company: ch.selectedCompany, organisationName: resolution.canonicalOrganisationName, tradingName: item.tradingName }, { apiKey: process.env.COMPANIES_HOUSE_API_KEY, mode: "validate_selected", fetchImpl: countedFetch(counts, "companiesHouse", originalFetch) });
      providerSequence.push("COMPANIES_HOUSE_PROFILE");
      result.companiesHouse = { search: counts.companiesHouse.search, profile: counts.companiesHouse.profile, outcome: profile.outcome, reason: profile.reason, company: safeCompany(profile.company) };
      current = { ...current, registrarValidation: profile.identityEvidence };
    } else {
      current = { ...current, registrarValidation: ch.identityEvidence };
    }
    current = applyRegistrarPromotionGate(current);
    const registrar = current.registrarValidation;
    const legal = registrar?.company;
    result.identities = { event: item.eventName, venue: item.venueName, operator: resolution.canonicalOrganisationName, organisation: { name: resolution.canonicalOrganisationName, domain: new URL(resolution.officialWebsite).hostname.replace(/^www\./, "") }, legalCompany: safeCompany(legal) };
    if (registrar && registrar.outcome !== "REGISTRAR_CONFIRMED") result.conflicts = [registrar.reason];
  }
  if (current.registrarValidation?.outcome === "REGISTRAR_CONFIRMED" && resolution?.canonicalOrganisationName && resolution.officialWebsite) {
    const apollo = await searchApolloBuyers({ organisationName: resolution.canonicalOrganisationName, organisationDomain: resolution.officialWebsite, discoveryLane: item.lane, roleFamilies: [...APOLLO_PRIMARY_ROLE_FAMILIES], limit: 5 }, { apiKey: process.env.APOLLO_API_KEY, mode: "search_only", fetchImpl: countedFetch(counts, "apollo", originalFetch) });
    providerSequence.push("APOLLO_PEOPLE_SEARCH");
    result.apollo = { httpStatus: apollo.telemetry.httpStatus, resultCount: apollo.results.length, candidates: apollo.results.map((person, index) => ({ name: person.fullName, title: person.title, employer: person.organisationName, domainClassification: person.employerDomainOutcome, domainReason: person.employerDomainReason, buyerClassification: person.buyerRoutingClassification, rank: index + 1, status: person.status })), creditCategory: apollo.telemetry.creditCategory };
  }
  result.identityDecision = current.registrarValidation?.outcome === "REGISTRAR_CONFIRMED" ? "REGISTRAR_CONFIRMED" : current.organisationResolution?.status === "RESOLVED" ? "PUBLIC_IDENTITY_RETAINED_LEGAL_PROMOTION_BLOCKED" : "SAFE_UNRESOLVED";
  result.commerciallyAdvanced = Boolean(current.organisationResolution?.status === "RESOLVED" && current.registrarValidation?.outcome === "REGISTRAR_CONFIRMED");
  result.counts = counts;
  result.identities = result.identities ?? { event: item.eventName, venue: item.venueName, operator: null, organisation: null, legalCompany: null };
  return result;
}

async function main() {
  if (!CASES.length || CASES.some((item) => item.id !== "P1" && item.id !== "P4")) throw new Error("Routing rerun manifest must contain only ArcTanGent and The Piece Hall.");
  const missing = ["OPENAI_API_KEY", "COMPANIES_HOUSE_API_KEY", "GOOGLE_PLACES_API_KEY", "APOLLO_API_KEY"].filter((name) => !keyPresent(name));
  if (missing.length) throw new Error(`MISSING_REQUIRED_PROVIDER_KEY:${missing.join(",")}`);
  const originalFetch = globalThis.fetch;
  const projectedCost = { value: Number(process.env.PHASE_ONE_PRIOR_ESTIMATE_USD || "0") };
  const cases = [];
  for (const item of CASES) {
    try {
      cases.push(await runCase(item, originalFetch, projectedCost));
    } catch (error) {
      const telemetry = error && typeof error === "object" && "telemetry" in error ? (error as { telemetry?: { responseStatus?: string | null; incompleteReason?: string | null; refusalStatus?: string | null; outputItemTypes?: string[]; schemaValidationError?: string | null; truncation?: boolean; parserPath?: string } }).telemetry : null;
      cases.push({ id: item.id, lane: item.lane, signal: item.startingSignal, liveFailure: { category: error instanceof Error ? error.name : "LIVE_CASE_FAILED", telemetry: telemetry ? { responseStatus: telemetry.responseStatus ?? null, incompleteReason: telemetry.incompleteReason ?? null, refusalStatus: telemetry.refusalStatus ?? null, outputItemTypes: telemetry.outputItemTypes ?? [], schemaValidationError: telemetry.schemaValidationError ?? null, truncation: telemetry.truncation ?? false, parserPath: telemetry.parserPath ?? null } : null }, noRetryPerformed: true, persistenceWrites: 0, outreachActions: 0 });
    }
  }
  const usage = cases.map((item) => (item as { openAi: { usage: Usage | null } }).openAi.usage).filter((item): item is Usage => Boolean(item));
  const modelCost = usage.reduce((sum, item) => { const input = item.input_tokens ?? 0; const cached = item.input_tokens_details?.cached_tokens ?? 0; const writes = item.input_tokens_details?.cache_write_tokens ?? 0; const output = item.output_tokens ?? 0; return sum + ((input - cached) * MODEL_PRICES.input + cached * MODEL_PRICES.cached + writes * MODEL_PRICES.input * 1.25 + output * MODEL_PRICES.output) / 1_000_000; }, 0);
  const searchCalls = cases.reduce((sum, item) => sum + (item as { openAi: { webSearchCalls: number } }).openAi.webSearchCalls, 0);
  const summary = { artifact: "live-phase-one-routing-rerun-v1", manifest: CASES.map(({ id, lane, startingSignal, organisationName, domain }) => ({ id, lane, startingSignal, organisationName, domain })), sequencePolicy: { eventFirst: ["OPENAI_PUBLIC_WEB_IDENTITY", "COMPANIES_HOUSE_SEARCH", "COMPANIES_HOUSE_PROFILE", "APOLLO_PEOPLE_SEARCH"], venueFirst: ["GOOGLE_PLACES_TEXT_SEARCH", "GOOGLE_PLACES_SELECTED_DETAILS", "OPENAI_PUBLIC_WEB_IDENTITY", "COMPANIES_HOUSE_SEARCH", "COMPANIES_HOUSE_PROFILE", "APOLLO_PEOPLE_SEARCH"], maxOpenAiCallsPerCase: 1, maxApolloSearchesPerOrganisation: 1, maxApolloEnrichment: 0, retries: 0, persistenceWrites: 0, outreachActions: 0 }, cases, cost: { model: MODEL, preflightProjectedUsd: projectedCost.value, measuredModelTokenCostUsd: modelCost, explicitWebSearchFeesUsd: searchCalls * WEB_SEARCH_CALL_FEE_USD, knownTotalUsd: modelCost + searchCalls * WEB_SEARCH_CALL_FEE_USD, ceilingUsd: KNOWN_COST_CEILING_USD, unreportedProviderContentCost: "not separately reported by the response usage payload" } };
  await writeFile("artifacts/live-phase-one-routing-rerun-v1.json", `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "BOUNDED_ROUTING_RERUN_FAILED"); process.exitCode = 1; });
