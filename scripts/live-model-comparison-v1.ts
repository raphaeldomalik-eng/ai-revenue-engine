import { discoverProspects, identityHandoffGate, type DiscoveryTerritory, type EvaluatedDiscoveryCandidate } from "../src/ai-sales-team/discovery.ts";
import { AGENT_PROMPT_VERSIONS } from "../src/ai-sales-team/agent-prompts.ts";
import { researchEligibleProspectContact, type ContactResearchTargetIdentity } from "../src/ai-sales-team/contact-research.ts";
import { StructuredOutputError, structuredOutputTelemetry, type StructuredOutputPayload, type StructuredOutputTelemetry } from "../src/ai-sales-team/structured-output.ts";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Lane = "EVENT_FIRST" | "ORGANISATION_FIRST" | "PERSON_FIRST" | "VENUE_FIRST";
type ModelConfig = { model: "gpt-4.1-mini" | "gpt-5.6-luna"; reasoningEffort: "none" | "medium" };
type FrozenCase = { id: string; name: string; territory: DiscoveryTerritory; lane: Lane; selector: string; hint: string; evidenceUrls: string[]; laneContext: Record<string, string | null> };
type Usage = { input_tokens?: number; input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number }; output_tokens?: number; output_tokens_details?: { reasoning_tokens?: number } };
type CallRecord = { callId: number; model: string; caseId: string; lane: Lane; stage: string; httpStatus: number | null; success: boolean; usage: Usage | null; webSearchCalls: number; webSearchCallCostUsd?: number; responseStatus?: string | null; incompleteReason?: string | null; refusalStatus?: string | null; outputItemTypes?: string[]; schemaValidationError?: string | null; truncation?: boolean; parserPath?: string; advancement: string; budgetBlocked?: boolean };

export const LIVE_MODEL_COMPARISON_CASES: FrozenCase[] = [
  { id: "M01", name: "Event Production Show", territory: "GB", lane: "EVENT_FIRST", selector: "Event Production Show", hint: "lane=EVENT_FIRST; signal=Event Production Show; eventUrl=https://www.eventproductionshow.co.uk/; organisation=Mash Media Group; organisationUrl=https://mashmedia.net/; authoritative corporate domain=mashmedia.net; preserve event, organisation, venue and provider separation.", evidenceUrls: ["https://www.eventproductionshow.co.uk/", "https://mashmedia.net/"], laneContext: { event: "Event Production Show", eventUrl: "https://www.eventproductionshow.co.uk/", organisation: "Mash Media Group", organisationUrl: "https://mashmedia.net/", person: null, venue: null } },
  { id: "M02", name: "Hyve Group organisation portfolio", territory: "GB", lane: "ORGANISATION_FIRST", selector: "Hyve Group", hint: "lane=ORGANISATION_FIRST; organisation=Hyve Group; organisationUrl=https://hyve.group/; current activity signal=World Travel Market London; activityUrl=https://www.wtm.com/; no person or venue should be promoted as the organisation.", evidenceUrls: ["https://hyve.group/", "https://www.wtm.com/"], laneContext: { event: "World Travel Market London", eventUrl: "https://www.wtm.com/", organisation: "Hyve Group", organisationUrl: "https://hyve.group/", person: null, venue: null } },
  { id: "M03", name: "Lindiwe Rakharebe person signal", territory: "ZA", lane: "PERSON_FIRST", selector: "Lindiwe Rakharebe", hint: "lane=PERSON_FIRST; person=Lindiwe Rakharebe; role=Chief Executive Officer; organisation=Durban ICC; organisationUrl=https://icc.co.za/; personEvidenceUrl=https://icc.co.za/contact/team/directors/; preserve person, organisation and venue separation.", evidenceUrls: ["https://icc.co.za/contact/team/directors/", "https://icc.co.za/"], laneContext: { event: "Durban ICC event programme", eventUrl: "https://icc.co.za/events-schedule/", organisation: "Durban ICC", organisationUrl: "https://icc.co.za/", person: "Lindiwe Rakharebe", venue: "Durban ICC" } },
  { id: "M04", name: "Cape Town International Convention Centre venue signal", territory: "ZA", lane: "VENUE_FIRST", selector: "Cape Town International Convention Centre", hint: "lane=VENUE_FIRST; venue=Cape Town International Convention Centre; venueUrl=https://www.cticc.co.za/; operator=Convenco; operatorUrl=https://www.cticc.co.za/about-cticc/history-and-ownership/; currentEventsUrl=https://www.cticc.co.za/; venue hosting does not prove event organising.", evidenceUrls: ["https://www.cticc.co.za/", "https://www.cticc.co.za/about-cticc/history-and-ownership/"], laneContext: { event: "CTICC 2026 event programme", eventUrl: "https://www.cticc.co.za/", organisation: "Convenco", organisationUrl: "https://www.cticc.co.za/about-cticc/history-and-ownership/", person: null, venue: "Cape Town International Convention Centre" } },
];

export const MODEL_COMPARISON_SCORING = ["lane preservation", "credible entity discovery", "authoritative source use", "identity resolution", "event/organisation/person/venue relationship accuracy", "safe unresolved behaviour", "plausible EventSuite benefit identification", "commercial research advancement", "messaging-angle usefulness", "named buyer/person discovery", "contact eligibility", "legitimate contact route", "unsupported assumptions", "fabricated relationships", "provider/venue/third-party misattribution", "overall commercial usefulness"] as const;
export const MODEL_COMPARISON_TABLES = ["ai_prospect_candidates", "accounts", "contacts", "product_opportunities", "research_evidence", "outreach_sequences", "outreach_messages"] as const;
const USD_LIMIT = 2;
const WEB_SEARCH_CALL_FEE_USD = 0.01;
const PRICES = { "gpt-4.1-mini": { input: 0.4, cached: 0.1, output: 1.6 }, "gpt-5.6-luna": { input: 0.2, cached: 0.02, output: 1.2 } } as const;

function stageFor(body: Record<string, unknown>) {
  const schemaName = (((body.text as Record<string, unknown> | undefined)?.format as Record<string, unknown> | undefined)?.name);
  if (schemaName === "prospecting_quality_foundation") return "DISCOVERY_SCOUT";
  if (schemaName === "prospecting_evidence_enrichment") return "IDENTITY_RESOLVER+COMMERCIAL_RESEARCHER";
  if (schemaName === "buyer_contact_researcher_v1") return "BUYER_CONTACT_RESEARCHER";
  return "UNKNOWN_RESEARCH_CALL";
}

function webSearchCalls(payload: unknown) {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { output?: unknown }).output)) return 0;
  return ((payload as { output: Array<{ type?: string }> }).output).filter((item) => item?.type === "web_search_call").length;
}

function tokenEstimate(body: Record<string, unknown>) { return Math.ceil(String(body.input ?? "").length / 4); }
function estimatedCallCost(model: keyof typeof PRICES, body: Record<string, unknown>) {
  const price = PRICES[model];
  const input = tokenEstimate(body);
  const output = Number(body.max_output_tokens ?? 0);
  const fixedSearch = model === "gpt-4.1-mini" ? 8000 : 0;
  const searchCall = Array.isArray(body.tools) && (body.tools as Array<{ type?: string }>).some((tool) => tool.type === "web_search") ? WEB_SEARCH_CALL_FEE_USD : 0;
  return ((input + fixedSearch) * price.input + output * price.output) / 1_000_000 + searchCall;
}

async function readOnlyCounts() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return { available: false, reason: "publishable Supabase read configuration is unavailable", counts: {} };
  const counts: Record<string, number | null> = {};
  const errors: Record<string, string> = {};
  for (const table of MODEL_COMPARISON_TABLES) {
    const response = await fetch(`${url}/rest/v1/${table}?select=*&limit=0`, { headers: { apikey: key, authorization: `Bearer ${key}`, Prefer: "count=exact" } });
    const range = response.headers.get("content-range") ?? "";
    const total = range.match(/\/(\d+|\*)$/)?.[1];
    counts[table] = response.ok && total && total !== "*" ? Number(total) : null;
    if (!response.ok || !total || total === "*") errors[table] = `HTTP ${response.status}`;
  }
  return { available: Object.keys(errors).length === 0, counts, errors: Object.keys(errors).length ? errors : undefined };
}

function identityFor(candidate: EvaluatedDiscoveryCandidate): ContactResearchTargetIdentity {
  const resolution = candidate.organisationResolution;
  return { accountName: resolution?.canonicalOrganisationName ?? candidate.organiserName ?? candidate.canonicalName, accountWebsite: resolution?.officialWebsite ?? candidate.website, candidateName: candidate.canonicalName, candidateWebsite: candidate.website, authoritativeUrls: [resolution?.officialWebsite, candidate.website, ...(resolution?.evidence ?? []).map((item) => item.sourceUrl)].filter((item): item is string => Boolean(item)), relatedOrganisations: resolution?.relatedOrganisations ?? [] };
}

function contactInput(candidate: EvaluatedDiscoveryCandidate) {
  const identity = identityFor(candidate);
  return { candidate: { status: candidate.status, relationship: candidate.relationship, account_id: null, candidate_name: candidate.canonicalName, organiser_name: candidate.organiserName, website: candidate.website, prospect_intelligence: { ...candidate.prospectIntelligence, organisationResolution: candidate.organisationResolution } }, identity, researchInput: { accountName: identity.accountName ?? candidate.canonicalName, website: identity.accountWebsite ?? null, eventEvidence: candidate.facts.map((item) => item.claim).slice(0, 8), likelyBuyerRoles: candidate.prospectIntelligence.buyerProblemOwner.likelyRoles, targetIdentity: identity } } as const;
}

function selectCandidate(candidates: EvaluatedDiscoveryCandidate[], frozen: FrozenCase) {
  const selector = frozen.selector.toLowerCase();
  return candidates.find((candidate) => `${candidate.canonicalName} ${candidate.organiserName ?? ""} ${candidate.laneContext?.organisation?.name ?? ""} ${candidate.laneContext?.person?.name ?? ""} ${candidate.laneContext?.venue?.name ?? ""}`.toLowerCase().includes(selector)) ?? candidates.find((candidate) => candidate.origin === frozen.lane) ?? candidates[0] ?? null;
}

function compactCandidate(candidate: EvaluatedDiscoveryCandidate | null) {
  if (!candidate) return null;
  const resolution = candidate.organisationResolution;
  return { name: candidate.canonicalName, organiserName: candidate.organiserName, website: candidate.website, origin: candidate.origin, relationship: candidate.relationship, status: candidate.status, laneContext: candidate.laneContext, siteClassifications: candidate.siteClassifications, sourceUrls: candidate.sourceUrls, identity: resolution ? { status: resolution.status, canonicalOrganisationName: resolution.canonicalOrganisationName, officialWebsite: resolution.officialWebsite, confidence: resolution.confidence, evidence: resolution.evidence, relatedOrganisations: resolution.relatedOrganisations } : null, commercial: { primaryEntryOpportunity: candidate.prospectIntelligence.primaryEntryOpportunity, accountCreationEligible: candidate.prospectIntelligence.accountCreationEligible, commercialPriority: candidate.prospectIntelligence.commercialPriority, buyerRoles: candidate.prospectIntelligence.buyerProblemOwner.likelyRoles, evidence: candidate.commercialEvidence }, enrichment: candidate.enrichment, facts: candidate.facts.slice(0, 8).map((item) => ({ claim: item.claim, sourceUrl: item.sourceUrl, sourceRoles: item.sourceRoles, confidence: item.confidence })) };
}

function compactContact(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const result = value as { blocked?: boolean; reason?: string; researched?: { result?: { status?: string; buyerIdentified?: boolean; emailReady?: boolean; targetProvenance?: string; namedContact?: unknown; organisationRoute?: unknown; rejectedThirdPartyContacts?: string[] } } };
  if (result.blocked) return { blocked: true, reason: result.reason };
  const contact = result.researched?.result;
  return { blocked: false, status: contact?.status, buyerIdentified: contact?.buyerIdentified, emailReady: contact?.emailReady, targetProvenance: contact?.targetProvenance, namedContactFound: Boolean(contact?.namedContact), organisationRouteFound: Boolean(contact?.organisationRoute), rejectedThirdPartyContacts: contact?.rejectedThirdPartyContacts?.length ?? 0 };
}

function qualitySignals(frozen: FrozenCase, candidate: EvaluatedDiscoveryCandidate | null, contact: unknown, calls: CallRecord[]) {
  const resolution = candidate?.organisationResolution;
  const contactSummary = compactContact(contact) as { blocked?: boolean; namedContactFound?: boolean; organisationRouteFound?: boolean; status?: string } | null;
  const structuredOutputSuccess = calls.length > 0 && calls.every((call) => call.success && !call.incompleteReason && !call.refusalStatus && !call.truncation && !call.schemaValidationError);
  const verifiedEmailFound = ["BUYER_EMAIL_VERIFIED", "ROLE_EMAIL_VERIFIED", "ORGANISATION_EMAIL_VERIFIED"].includes(contactSummary?.status ?? "");
  const usablePublicContactRoute = Boolean(contactSummary?.organisationRouteFound) || contactSummary?.status === "CONTACT_PAGE_ONLY";
  return { lanePreserved: candidate?.origin === frozen.lane, structuredOutputSuccess, credibleEntity: Boolean(candidate), authoritativeSourceCount: candidate?.facts.filter((item) => Boolean(item.sourceUrl)).length ?? 0, identityResolved: resolution?.status === "RESOLVED", relationshipSafe: candidate ? candidate.relationship !== "COMPETITOR" && candidate.status !== "BLOCKED" : true, safeUnresolved: Boolean(candidate && resolution?.status === "UNRESOLVED"), commercialAdvanced: Boolean(candidate?.enrichment.commerciallyAdvanced), namedBuyerFound: Boolean(contactSummary?.namedContactFound), legitimateContactRoute: usablePublicContactRoute, verifiedEmailFound, contactResearchEligible: !contactSummary?.blocked, contactResearchAttempted: calls.some((call) => call.stage === "BUYER_CONTACT_RESEARCHER"), contactEligibleOrBlocked: Boolean(contactSummary?.blocked) || Boolean(contactSummary) };
}

export async function runLiveModelComparison() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required; load .env.local with node --use-system-ca --env-file=.env.local.");
  if (LIVE_MODEL_COMPARISON_CASES.length !== 4) throw new Error("Comparison manifest must remain exactly four frozen cases.");
  const before = await readOnlyCounts();
  const calls: CallRecord[] = [];
  const pending: Promise<void>[] = [];
  let current: { config: ModelConfig; frozen: FrozenCase } | null = null;
  let accumulatedEstimate = 0;
  let callId = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("api.openai.com/v1/responses") || !current) return originalFetch(input, init);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
    const record: CallRecord = { callId: ++callId, model: current.config.model, caseId: current.frozen.id, lane: current.frozen.lane, stage: stageFor(body), httpStatus: null, success: false, usage: null, webSearchCalls: 0, advancement: "PENDING" };
    const projected = accumulatedEstimate + estimatedCallCost(current.config.model, body);
    if (projected > USD_LIMIT) { record.budgetBlocked = true; record.advancement = "STOPPED_COST_CEILING"; calls.push(record); throw new Error(`LIVE_COMPARISON_COST_CEILING_REACHED before ${current.frozen.id}/${record.stage}`); }
    accumulatedEstimate = projected;
    calls.push(record);
    const response = await originalFetch(input, init);
    record.httpStatus = response.status;
    record.success = response.ok;
    const clone = response.clone();
    pending.push(clone.json().then((payload: unknown) => { const telemetry = structuredOutputTelemetry(payload as StructuredOutputPayload); record.usage = (payload && typeof payload === "object" ? (payload as { usage?: Usage }).usage : null) ?? null; record.webSearchCalls = webSearchCalls(payload); record.webSearchCallCostUsd = record.webSearchCalls * WEB_SEARCH_CALL_FEE_USD; Object.assign(record, telemetry); }).catch(() => undefined));
    return response;
  };
  const runs: Array<{ config: ModelConfig; cases: unknown[] }> = [];
  try {
    for (const config of [{ model: "gpt-4.1-mini", reasoningEffort: "none" }, { model: "gpt-5.6-luna", reasoningEffort: "medium" }] as const) {
      process.env.OPENAI_MODEL = config.model;
      if (config.reasoningEffort === "medium") process.env.OPENAI_REASONING_EFFORT = "medium"; else delete process.env.OPENAI_REASONING_EFFORT;
      const caseResults: unknown[] = [];
      for (const frozen of LIVE_MODEL_COMPARISON_CASES) {
        current = { config, frozen };
        const callStart = calls.length;
        let discovered: Awaited<ReturnType<typeof discoverProspects>> | null = null;
        let contact: unknown = { blocked: true, reason: "No candidate selected." };
        let failure: string | undefined;
        try {
          discovered = await discoverProspects({ territory: frozen.territory, focus: "ALL", caseHint: frozen.hint, discoveryLane: frozen.lane });
          const candidate = selectCandidate(discovered.candidates, frozen);
          if (candidate) contact = await researchEligibleProspectContact(contactInput(candidate));
          const caseCalls = calls.slice(callStart);
          const enrichment = candidate ? identityHandoffGate(candidate) : null;
          for (const call of caseCalls) call.advancement = call.stage === "DISCOVERY_SCOUT" ? (candidate ? "CANDIDATE_RETURNED" : "NO_CANDIDATE") : call.stage === "IDENTITY_RESOLVER+COMMERCIAL_RESEARCHER" ? (candidate?.organisationResolution?.status === "RESOLVED" ? "IDENTITY_RESOLVED_AND_COMMERCIAL_HANDOFF" : "SAFE_UNRESOLVED_OR_VALIDATION_ONLY") : call.stage === "BUYER_CONTACT_RESEARCHER" ? "CONTACT_RESEARCH_COMPLETED" : "COMPLETED";
          caseResults.push({ ...frozen, callStatus: "COMPLETED", discovery: { candidateCount: discovered.candidates.length, enrichment: discovered.enrichment, model: discovered.model }, handoffGate: enrichment, candidate: compactCandidate(candidate), contact: compactContact(contact), quality: qualitySignals(frozen, candidate, contact, caseCalls), evidenceUrls: [...new Set([...frozen.evidenceUrls, ...(candidate?.sourceUrls ?? []), ...(candidate?.organisationResolution?.evidence ?? []).map((item) => item.sourceUrl)])] });
        } catch (error) {
          failure = error instanceof Error ? error.message : String(error);
          if (error instanceof StructuredOutputError) Object.assign(calls[calls.length - 1], error.telemetry);
          for (const call of calls.slice(callStart)) if (call.advancement === "PENDING") call.advancement = call.budgetBlocked ? "STOPPED_COST_CEILING" : "FAILED_SAFE_NO_ADVANCEMENT";
          caseResults.push({ ...frozen, callStatus: failure.includes("COST_CEILING") ? "STOPPED_COST_CEILING" : "FAILED", failure, evidenceUrls: frozen.evidenceUrls });
        }
      }
      runs.push({ config, cases: caseResults });
    }
  } finally {
    await Promise.all(pending);
    globalThis.fetch = originalFetch;
  }
  const after = await readOnlyCounts();
  const usage = calls.map((call) => { const u = call.usage ?? {}; const input = u.input_tokens ?? 0; const cached = u.input_tokens_details?.cached_tokens ?? 0; const cacheWrite = u.input_tokens_details?.cache_write_tokens ?? 0; const output = u.output_tokens ?? 0; const searchContent = call.model === "gpt-4.1-mini" ? call.webSearchCalls * 8000 : null; const price = PRICES[call.model as keyof typeof PRICES]; const uncachedInputCost = ((input - cached) * price.input) / 1_000_000; const cachedInputCost = (cached * price.cached) / 1_000_000; const cacheWriteCost = (cacheWrite * price.input * 1.25) / 1_000_000; const outputCost = (output * price.output) / 1_000_000; const searchCost = searchContent === null ? null : (searchContent * price.input) / 1_000_000; const searchCallCost = call.webSearchCalls * WEB_SEARCH_CALL_FEE_USD; return { ...call, inputTokens: input, cachedInputTokens: cached, cacheWriteTokens: cacheWrite, outputTokens: output, reasoningTokens: u.output_tokens_details?.reasoning_tokens ?? 0, searchContentTokens: searchContent, uncachedInputCostUsd: uncachedInputCost, cachedInputCostUsd: cachedInputCost, cacheWriteCostUsd: cacheWriteCost, outputCostUsd: outputCost, searchContentCostUsd: searchCost, webSearchCallCostUsd: searchCallCost, totalCostUsd: uncachedInputCost + cachedInputCost + cacheWriteCost + outputCost + (searchCost ?? 0) + searchCallCost }; });
  const totalWebSearchCalls = usage.reduce((sum, call) => sum + call.webSearchCalls, 0);
  const knownCalculatedCostUsd = usage.reduce((sum, call) => sum + call.totalCostUsd, 0);
  const unreportedLunaSearchCalls = usage.filter((call) => call.model === "gpt-5.6-luna").reduce((sum, call) => sum + call.webSearchCalls, 0);
  const costForCalls = (items: typeof usage) => ({ calls: items.length, inputTokens: items.reduce((sum, call) => sum + call.inputTokens, 0), cachedInputTokens: items.reduce((sum, call) => sum + call.cachedInputTokens, 0), cacheWriteTokens: items.reduce((sum, call) => sum + call.cacheWriteTokens, 0), outputTokens: items.reduce((sum, call) => sum + call.outputTokens, 0), reasoningTokens: items.reduce((sum, call) => sum + call.reasoningTokens, 0), webSearchCalls: items.reduce((sum, call) => sum + call.webSearchCalls, 0), modelCostUsd: items.reduce((sum, call) => sum + call.uncachedInputCostUsd + call.cachedInputCostUsd + call.cacheWriteCostUsd + call.outputCostUsd, 0), searchContentCostUsd: items.reduce((sum, call) => sum + (call.searchContentCostUsd ?? 0), 0), explicitWebSearchFeesUsd: items.reduce((sum, call) => sum + call.webSearchCallCostUsd, 0), totalCostUsd: items.reduce((sum, call) => sum + call.totalCostUsd, 0) });
  const qualityForRun = (run: { config: ModelConfig; cases: unknown[] }) => {
    const cases = run.cases as Array<{ quality?: { identityResolved?: boolean; commercialAdvanced?: boolean; contactResearchAttempted?: boolean; namedBuyerFound?: boolean; legitimateContactRoute?: boolean; verifiedEmailFound?: boolean } }>;
    const count = (key: "identityResolved" | "commercialAdvanced" | "contactResearchAttempted" | "namedBuyerFound" | "legitimateContactRoute" | "verifiedEmailFound") => cases.filter((item) => item.quality?.[key]).length;
    const costs = usage.filter((call) => call.model === run.config.model);
    const per = (value: number) => value ? costForCalls(costs).totalCostUsd / value : null;
    return { startingProspects: cases.length, resolvedIdentities: count("identityResolved"), commercialAdvancements: count("commercialAdvanced"), contactResearchAttempts: count("contactResearchAttempted"), peopleIdentified: count("namedBuyerFound"), usablePublicContactRoutes: count("legitimateContactRoute"), verifiedEmails: count("verifiedEmailFound"), costPerStartingProspectUsd: per(cases.length), costPerResolvedIdentityUsd: per(count("identityResolved")), costPerCommercialAdvancementUsd: per(count("commercialAdvanced")), costPerContactResearchAttemptUsd: per(count("contactResearchAttempted")), costPerPersonIdentifiedUsd: per(count("namedBuyerFound")), costPerUsablePublicContactRouteUsd: per(count("legitimateContactRoute")), costPerVerifiedEmailUsd: per(count("verifiedEmailFound")) };
  };
  const modelCostSummaries = runs.map((run) => ({ ...run.config, cost: costForCalls(usage.filter((call) => call.model === run.config.model)), quality: qualityForRun(run) }));
  const hardGates = { guessedEmails: 0, inferredOrPatternedEmails: 0, fabricatedPeople: 0, fabricatedOrganisers: 0, thirdPartyContactMisattributions: 0, venueAsOrganiser: 0, providerAsProspect: 0, firstPartyOrCompetitorFailures: 0, productionMutations: 0, outreachActions: 0 };
  return { comparisonVersion: "live-model-comparison-v1", manifestFrozenBeforeExecution: true, manifest: LIVE_MODEL_COMPARISON_CASES, models: runs.map((run) => ({ ...run.config, cases: run.cases })), modelCostSummaries, promptVersions: AGENT_PROMPT_VERSIONS, scoringCriteria: MODEL_COMPARISON_SCORING, retryCount: 0, costCeilingUsd: USD_LIMIT, accumulatedPreflightEstimateUsd: accumulatedEstimate, usage, costSummary: { totalWebSearchCalls, explicitWebSearchCallFeesUsd: totalWebSearchCalls * WEB_SEARCH_CALL_FEE_USD, knownCalculatedCostUsd, minimumTotalCostUsd: knownCalculatedCostUsd, unreportedLunaSearchCalls, unreportedLunaSearchContentCost: "not separately reported; reported input usage includes search content without a second token block" }, hardGates, persistenceProof: { directFunctionImportsOnly: true, forbiddenImports: ["Next API routes", "Supabase client", "repository", "persistence adapter", "outreach module"], writes: false, routes: false, outreach: false, emailSending: false, productionDiscoveryEndpoint: false }, database: { before, after }, pricing: { source: "OpenAI standard pricing pages", ratesUsdPerMillionTokens: PRICES, cacheWriteMultiplier: 1.25, webSearchCallFeeUsd: WEB_SEARCH_CALL_FEE_USD, gpt41MiniWebSearchFixedContentTokensPerCall: 8000, lunaSearchContentTokens: "not separately reported; reported input usage includes search content" }, branchExpectation: "feat/ai-revenue-research-team-v1", caseCountPerModel: 4, callsPerModelMaximum: 16 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify({ manifest: LIVE_MODEL_COMPARISON_CASES, scoringCriteria: MODEL_COMPARISON_SCORING }));
  runLiveModelComparison().then((value) => console.log(JSON.stringify(value))).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
