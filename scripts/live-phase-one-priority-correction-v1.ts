import { writeFile } from "node:fs/promises";
import { searchApolloBuyers, APOLLO_PRIMARY_ROLE_FAMILIES } from "../src/ai-sales-team/apollo.ts";
import { applyRegistrarPromotionGate, enrichDiscoveryCandidatesWithOpenAI, evaluateDiscoveryCandidate, type EvaluatedDiscoveryCandidate } from "../src/ai-sales-team/discovery.ts";
import { searchCompaniesHouse, validateSelectedCompaniesHouseCompany } from "../src/ai-sales-team/companies-house.ts";
import { FROZEN_CASES, countedFetch, emptyCounts, type Counts, type FrozenCase } from "./live-phase-one-four-lane-v1.ts";
import { assessPhaseOneCandidate } from "../src/ai-sales-team/phase-one.ts";

type Usage = { input_tokens?: number; input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number }; output_tokens?: number; output_tokens_details?: { reasoning_tokens?: number } };
type TargetCase = FrozenCase & { id: "P1" | "P4" };
const CASES = FROZEN_CASES.filter((item): item is TargetCase => item.id === "P1" || item.id === "P4");
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const MODEL_PRICES = { input: 0.4, cached: 0.1, output: 1.6 };
const WEB_SEARCH_CALL_FEE_USD = 0.01;
const KNOWN_COST_CEILING_USD = 0.25;

function fact(claim: string, sourceUrl: string) { return { claim, sourceUrl, sourceTitle: "Frozen official source input", kind: "FACT" as const, confidence: "HIGH" as const, sourceRoles: ["DISCOVERY" as const], eventFreshness: "ACTIVE_UPCOMING" as const }; }
function safeUsage(value: unknown): Usage | null { return value && typeof value === "object" && (value as { usage?: Usage }).usage ? (value as { usage: Usage }).usage! : null; }
function safeTelemetry(error: unknown) {
  const value = error && typeof error === "object" && "telemetry" in error ? (error as { telemetry?: Record<string, unknown> }).telemetry : null;
  return value ? { responseStatus: value.responseStatus ?? null, incompleteReason: value.incompleteReason ?? null, refusalStatus: value.refusalStatus ?? null, outputItemTypes: value.outputItemTypes ?? [], schemaValidationError: value.schemaValidationError ?? null, truncation: value.truncation ?? false, parserPath: value.parserPath ?? null } : null;
}
function safeCompany(value: { legalCompanyName: string; companyStatus: string | null; companyType: string | null; sicCodes: string[]; accountsCategory?: string | null; registeredRegion: string | null } | null | undefined) { return value ? { legalCompanyName: value.legalCompanyName, companyStatus: value.companyStatus, companyType: value.companyType, sicCodes: value.sicCodes, accountsCategory: value.accountsCategory ?? null, registeredRegion: value.registeredRegion } : null; }
function candidateFor(item: TargetCase): EvaluatedDiscoveryCandidate {
  const venue = item.id === "P4" ? { name: item.venueName!, website: "https://piecehall.co.uk", operatorName: null, operatorWebsite: null } : null;
  const claim = item.id === "P1" ? `${item.eventName} is a current recurring event and ${item.organisationName} organises it.` : "Google Places identity evidence lists The Piece Hall as the target venue at Blackledge, Halifax HX1 1RE, UK with website domain piecehall.co.uk. Business status: OPERATIONAL. This supports venue identity only and does not establish commercial responsibility.";
  return evaluateDiscoveryCandidate({ canonicalName: item.id === "P1" ? item.eventName! : item.venueName!, organiserName: item.id === "P1" ? item.organisationName : null, website: item.id === "P1" ? null : "https://piecehall.co.uk", origin: item.lane, relationshipHint: "PROSPECT", laneContext: { organisation: null, person: null, venue }, facts: [fact(claim, item.officialOrganisationUrl)], inferences: [], unknowns: ["Current canonical legal entity requires bounded validation."], phaseOneEvidence: item.phaseOneEvidence }, "GB");
}
function resultCase(item: TargetCase, counts: Counts, current: EvaluatedDiscoveryCandidate, providerSequence: string[]) {
  return { id: item.id, lane: item.lane, startingSignal: item.startingSignal, phaseOne: assessPhaseOneCandidate({ lane: item.lane, territory: "GB", evidence: item.phaseOneEvidence }), lanePreserved: current.origin === item.lane, providerSequence, identity: { event: item.eventName, venue: item.venueName, organisation: current.organisationResolution?.canonicalOrganisationName ?? null, officialDomain: current.organisationResolution?.officialWebsite ?? (item.id === "P4" ? "https://piecehall.co.uk" : null), legalCompany: safeCompany(current.registrarValidation?.company) }, counts, contactResearchAttempted: false, enrichmentAttempted: false, persistenceWrites: 0, outreachActions: 0 };
}
function modelCost(usage: Usage | null) {
  if (!usage) return 0;
  const input = usage.input_tokens ?? 0; const cached = usage.input_tokens_details?.cached_tokens ?? 0; const writes = usage.input_tokens_details?.cache_write_tokens ?? 0; const output = usage.output_tokens ?? 0;
  return ((input - cached) * MODEL_PRICES.input + cached * MODEL_PRICES.cached + writes * MODEL_PRICES.input * 1.25 + output * MODEL_PRICES.output) / 1_000_000;
}

async function runArcTanGent(item: TargetCase, originalFetch: typeof fetch, projectedCost: { value: number }) {
  const counts = emptyCounts(); const providerSequence: string[] = []; const candidate = candidateFor(item); let responsePayload: unknown = null;
  const originalModel = process.env.OPENAI_MODEL; process.env.OPENAI_MODEL = MODEL; delete process.env.OPENAI_REASONING_EFFORT;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.includes("api.openai.com/v1/responses")) return originalFetch(input, init);
    if (counts.openAi >= 1) throw new Error("BOUNDED_OPENAI_REQUEST_LIMIT");
    counts.openAi += 1;
    const response = await originalFetch(input, init);
    responsePayload = await response.clone().json().catch(() => null);
    return response;
  };
  let current = candidate;
  try {
    const run = await enrichDiscoveryCandidatesWithOpenAI([current], "GB");
    if (run.candidates[0]?.enrichment.status === "FAILED") {
      const failure = Object.assign(new Error("OPENAI_STRUCTURED_OUTPUT_FAILED"), { telemetry: run.telemetry.structuredOutputTelemetry });
      throw failure;
    }
    current = run.candidates[0]; providerSequence.push("OPENAI_PUBLIC_WEB_IDENTITY");
    const usage = safeUsage(responsePayload);
    projectedCost.value += modelCost(usage) + (run.telemetry.structuredOutputTelemetry ? WEB_SEARCH_CALL_FEE_USD : 0);
    if (projectedCost.value > KNOWN_COST_CEILING_USD) throw new Error("KNOWN_COST_CEILING_EXCEEDED");
    const resolution = current.organisationResolution?.status === "RESOLVED" ? current.organisationResolution : null;
    if (resolution?.canonicalOrganisationName) {
      const ch = await searchCompaniesHouse({ organisationName: resolution.canonicalOrganisationName, tradingName: item.tradingName, territory: "GB", limit: 5 }, { apiKey: process.env.COMPANIES_HOUSE_API_KEY, mode: "search_only", fetchImpl: countedFetch(counts, "companiesHouse", originalFetch) });
      providerSequence.push("COMPANIES_HOUSE_SEARCH");
      if (ch.outcome === "REGISTRAR_CONFIRMED" && ch.selectedCompany) {
        const profile = await validateSelectedCompaniesHouseCompany({ company: ch.selectedCompany, organisationName: resolution.canonicalOrganisationName, tradingName: item.tradingName }, { apiKey: process.env.COMPANIES_HOUSE_API_KEY, mode: "validate_selected", fetchImpl: countedFetch(counts, "companiesHouse", originalFetch) });
        providerSequence.push("COMPANIES_HOUSE_PROFILE"); current = applyRegistrarPromotionGate({ ...current, registrarValidation: profile.identityEvidence });
      } else current = applyRegistrarPromotionGate({ ...current, registrarValidation: ch.identityEvidence });
      const legal = current.registrarValidation?.company;
      const result = resultCase(item, counts, current, providerSequence);
      return { ...result, openAi: { calls: counts.openAi, model: MODEL, usage, webSearchCalls: Array.isArray((responsePayload as { output?: unknown[] } | null)?.output) ? ((responsePayload as { output: Array<{ type?: string }> }).output.filter((entry) => entry.type === "web_search_call").length) : 0, structuredOutputTelemetry: run.telemetry.structuredOutputTelemetry ?? null }, companiesHouse: { search: counts.companiesHouse.search, profile: counts.companiesHouse.profile, outcome: current.registrarValidation?.outcome ?? null, reason: current.registrarValidation?.reason ?? null }, legalCompany: safeCompany(legal), identityDecision: current.registrarValidation?.outcome === "REGISTRAR_CONFIRMED" ? "REGISTRAR_CONFIRMED" : "PUBLIC_IDENTITY_RETAINED_LEGAL_PROMOTION_BLOCKED", commerciallyAdvanced: current.registrarValidation?.outcome === "REGISTRAR_CONFIRMED" };
    }
    const result = resultCase(item, counts, current, providerSequence);
    return { ...result, openAi: { calls: counts.openAi, model: MODEL, usage, webSearchCalls: Array.isArray((responsePayload as { output?: unknown[] } | null)?.output) ? ((responsePayload as { output: Array<{ type?: string }> }).output.filter((entry) => entry.type === "web_search_call").length) : 0, structuredOutputTelemetry: run.telemetry.structuredOutputTelemetry ?? null }, companiesHouse: { search: 0, profile: 0, outcome: null, reason: null }, identityDecision: "SAFE_UNRESOLVED", commerciallyAdvanced: false };
  } finally {
    globalThis.fetch = previousFetch; if (originalModel === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = originalModel;
  }
}

async function runPieceHall(item: TargetCase, originalFetch: typeof fetch) {
  const counts = emptyCounts(); const candidate = candidateFor(item); const providerSequence = ["APOLLO_PEOPLE_SEARCH"];
  const apollo = await searchApolloBuyers({ organisationName: "The Piece Hall", organisationDomain: "piecehall.co.uk", discoveryLane: "VENUE_FIRST", roleFamilies: [...APOLLO_PRIMARY_ROLE_FAMILIES], limit: 5 }, { apiKey: process.env.APOLLO_API_KEY, mode: "search_only", fetchImpl: countedFetch(counts, "apollo", originalFetch) });
  return { ...resultCase(item, counts, candidate, providerSequence), openAi: { calls: 0, model: null, usage: null, webSearchCalls: 0, structuredOutputTelemetry: null }, companiesHouse: { search: 0, profile: 0, outcome: null, reason: null }, apollo: { httpStatus: apollo.telemetry.httpStatus, resultCount: apollo.results.length, candidates: apollo.results.map((person, index) => ({ name: person.fullName, title: person.title, employer: person.organisationName, domainClassification: person.employerDomainOutcome, domainReason: person.employerDomainReason, buyerClassification: person.buyerRoutingClassification, buyerRoutingReason: person.buyerRoutingReason, rankingScore: person.roleRankingScore ?? 0, deterministicRank: index + 1, humanSelectionRecommendation: person.status === "ACCEPTED" ? "REVIEW_REQUIRED_SELECT_EXPLICITLY_BEFORE_ENRICHMENT" : "DO_NOT_SELECT" })), creditCategory: apollo.telemetry.creditCategory }, identityDecision: "VENUE_IDENTITY_RETAINED_OPERATOR_UNRESOLVED", commerciallyAdvanced: false };
}

async function main() {
  if (CASES.length !== 2 || CASES[0].id !== "P1" || CASES[1].id !== "P4") throw new Error("Frozen manifest must contain ArcTanGent and The Piece Hall only.");
  if (!process.env.OPENAI_API_KEY?.trim() || !process.env.APOLLO_API_KEY?.trim() || !process.env.COMPANIES_HOUSE_API_KEY?.trim()) throw new Error("MISSING_REQUIRED_PROVIDER_KEY");
  const originalFetch = globalThis.fetch; const projectedCost = { value: 0 }; const cases: unknown[] = [];
  let arc: unknown;
  try { arc = await runArcTanGent(CASES[0], originalFetch, projectedCost); cases.push(arc); } catch (error) {
    const failure = { id: "P1", lane: "EVENT_FIRST", liveFailure: { category: error instanceof Error ? error.name : "LIVE_CASE_FAILED", message: error instanceof Error ? error.message : "SAFE_FAILURE", telemetry: safeTelemetry(error) }, noRetryPerformed: true, counts: { openAi: 1, companiesHouse: { search: 0, profile: 0 }, apollo: { peopleSearch: 0, enrichment: 0 } }, persistenceWrites: 0, outreachActions: 0 };
    cases.push(failure);
    const summary = { artifact: "live-phase-one-priority-correction-v1", model: MODEL, cases, stopRule: "ArcTanGent strict structured-output failure stops before The Piece Hall.", knownCostUsd: projectedCost.value, costCeilingUsd: KNOWN_COST_CEILING_USD };
    await writeFile("artifacts/live-phase-one-priority-correction-v1.json", `${JSON.stringify(summary, null, 2)}\n`, "utf8"); console.log(JSON.stringify(summary, null, 2)); return;
  }
  cases.push(await runPieceHall(CASES[1], originalFetch));
  const openAiUsage = (arc as { openAi?: { usage?: Usage | null } }).openAi?.usage ?? null;
  const openAiSearchCalls = (arc as { openAi?: { webSearchCalls?: number } }).openAi?.webSearchCalls ?? 0;
  const summary = { artifact: "live-phase-one-priority-correction-v1", manifest: CASES.map(({ id, lane, startingSignal, organisationName, domain }) => ({ id, lane, startingSignal, organisationName, domain })), sequencePolicy: { arcTanGent: ["OPENAI_PUBLIC_WEB_IDENTITY", "COMPANIES_HOUSE_SEARCH", "COMPANIES_HOUSE_PROFILE", "APOLLO_PEOPLE_SEARCH"], pieceHall: ["APOLLO_PEOPLE_SEARCH"], maxOpenAiCallsPerCase: 1, maxCompaniesHouseSearchesPerCase: 1, maxCompaniesHouseProfilesPerCase: 1, maxApolloSearchesPerCase: 1, maxApolloEnrichment: 0, googlePlacesCalls: 0, retries: 0, persistenceWrites: 0, outreachActions: 0 }, cases, cost: { model: MODEL, measuredModelTokenCostUsd: modelCost(openAiUsage), explicitWebSearchFeesUsd: openAiSearchCalls * WEB_SEARCH_CALL_FEE_USD, knownTotalUsd: projectedCost.value, unreportedProviderContentCost: "not separately reported by the response usage payload", ceilingUsd: KNOWN_COST_CEILING_USD } };
  await writeFile("artifacts/live-phase-one-priority-correction-v1.json", `${JSON.stringify(summary, null, 2)}\n`, "utf8"); console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "BOUNDED_PRIORITY_CORRECTION_FAILED"); process.exitCode = 1; });
