import { createHash } from "node:crypto";
import { searchCompaniesHouse, type CompaniesHouseSearchResult } from "../ai-sales-team/companies-house.ts";
import { getGooglePlaceDetails, searchGooglePlaces, type GooglePlacesDetailsInput, type GooglePlacesEvidence, type GooglePlacesSearchInput } from "../ai-sales-team/google-places.ts";
import { createInMemoryGooglePlacesEvidenceStore, type GooglePlacesCallTelemetry, type GooglePlacesEvidenceStore } from "../ai-sales-team/google-places-evidence.ts";
import { researchCompany } from "../ai-sales-team/research.ts";
import { CONTRACTS, officialWebsiteDetailsAuthorization, type ProviderAllowance, type ResearchContext as ContractResearchContext, type ResearchRequest, type SourceDiscoveryRequest, type SourceExtractor, validateResearchRequest, validateResearchResult, validateSourceDiscoveryRequest, validateSourceDiscoveryResult } from "./contracts.ts";
import { crawlVerifiedSource, extractFromFetchedDocuments, type CrawlBudget, type CrawlObservability, type FetchLike, type ResolveHost } from "./source-discovery/crawler.ts";
import { deriveEmailAcquisitionOutcome } from "./source-discovery/email-outcome.ts";
import { acceptVenueEmail } from "./venue-email.ts";
import { crawlLogLine, extractorYields } from "./source-discovery/observability.ts";
import type { DocumentCache } from "./source-discovery/types.ts";

export type ProposedFact = { subjectEntityType: ResearchRequest["subject"]["entityType"]; canonicalEntityId: string | null; fieldName: string; value: unknown; evidenceRef: string | null; confidence: number | null; observedAt: string | null };
export type ResearchContext = ContractResearchContext & { googlePlacesEvidenceStore?: GooglePlacesEvidenceStore; publicWeb?: { facts?: Array<{ fieldName: string; value: unknown; sourceUrl?: string | null; evidenceRef?: string | null }>; evidence?: Array<{ externalRecordId: string; sourceUrl?: string | null; payload?: unknown }> } };
type Cost = { currency: string; amount: number } | null;
export type ProviderResult = { provider: ProviderAllowance; purpose: string; facts: ProposedFact[]; evidence: Array<{ evidenceRef: string; provider: ProviderAllowance; externalRecordId: string; sourceUrl: string | null; observedAt: string; dataClassification: "PUBLIC" | "INTERNAL" | "RESTRICTED" | "CONFIDENTIAL" | "PII"; licenceType: string; payload: unknown }>; unknowns: string[]; conflicts: Array<Record<string, unknown>>; cost: Cost; providerUsage?: Array<{ provider: ProviderAllowance; callCount: number; purpose: string; cost: Cost }>; error?: { code: string; message: string; retryable: boolean } };
export type ResearchExecutorOptions = { estimatedCosts?: Partial<Record<ProviderAllowance, number>>; now?: () => string; googlePlaces?: typeof searchGooglePlaces; googlePlaceDetails?: typeof getGooglePlaceDetails; googlePlacesEvidenceStore?: GooglePlacesEvidenceStore; onGooglePlacesCallTelemetry?: (telemetry: GooglePlacesCallTelemetry) => void | Promise<void>; companiesHouse?: typeof searchCompaniesHouse; publicWeb?: (input: { request: ResearchRequest; context: ResearchContext }) => Promise<ProviderResult>; openAI?: typeof researchCompany };
export type SourceDiscoveryExecutorOptions = { fetchImpl?: FetchLike; resolveHost?: ResolveHost; now?: () => string; documentCache?: DocumentCache; onCrawlObservability?: (observability: CrawlObservability) => void | Promise<void> };

export interface NexusResultStore { get(key: string): Promise<Record<string, unknown> | null>; set(key: string, result: Record<string, unknown>): Promise<void>; }
export class InMemoryNexusResultStore implements NexusResultStore { private readonly values = new Map<string, Record<string, unknown>>(); async get(key: string) { return this.values.get(key) ?? null; } async set(key: string, result: Record<string, unknown>) { this.values.set(key, result); } }

function nowOf(options: { now?: () => string }) { return options.now?.() ?? new Date().toISOString(); }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function subjectEntity(request: ResearchRequest) { return request.subject.entityType; }
function targetName(request: ResearchRequest, context: ResearchContext) { return context.targetName?.trim() || request.subject.candidateReference?.sourceRecordId || request.subject.canonicalEntityId || null; }
function evidenceRef(request: ResearchRequest, provider: ProviderAllowance, id: string) { return `research:${request.requestId}:${provider.toLowerCase()}:${id}`; }
function fact(request: ResearchRequest, fieldName: string, value: unknown, ref: string | null, confidence: number | null, observedAt: string): ProposedFact { return { subjectEntityType: subjectEntity(request), canonicalEntityId: request.subject.canonicalEntityId, fieldName, value, evidenceRef: ref, confidence, observedAt }; }
function baseEvidence(request: ResearchRequest, provider: ProviderAllowance, id: string, sourceUrl: string | null, payload: unknown, observedAt: string) { return { evidenceRef: evidenceRef(request, provider, id), provider, externalRecordId: id, sourceUrl, observedAt, dataClassification: "PUBLIC" as const, licenceType: "PUBLIC_SOURCE", payload }; }
function existingFact(context: ResearchContext, requested: string) { return context.existingFacts?.find((item) => item.fieldName === requested); }
function retainedPlaceId(context: ResearchContext) { const fact = context.existingFacts?.find((item) => (item.fieldName === "google_place_id" || item.fieldName === "placeId") && text(item.value)); return fact ? text(fact.value) : null; }
function googleFacts(request: ResearchRequest, item: GooglePlacesEvidence, ref: string, observedAt: string) { const facts: ProposedFact[] = []; if (item.displayName) facts.push(fact(request, "placeName", item.displayName, ref, item.identityConfidence === "HIGH" ? 0.95 : 0.7, observedAt)); if (item.formattedAddress) facts.push(fact(request, "formattedAddress", item.formattedAddress, ref, 0.9, observedAt)); facts.push(fact(request, "placeId", item.googlePlaceId, ref, item.identityConfidence === "HIGH" ? 0.95 : 0.7, observedAt)); if (item.types.length) facts.push(fact(request, "providerTypes", item.types, ref, 0.8, observedAt)); if (item.businessStatus) facts.push(fact(request, "businessStatus", item.businessStatus, ref, 0.8, observedAt)); if (item.websiteUri) facts.push(fact(request, "officialWebsite", item.websiteUri, ref, 0.9, observedAt)); return facts; }

function usageCost(provider: ProviderAllowance, options: ResearchExecutorOptions): Cost { const amount = options.estimatedCosts?.[provider]; return typeof amount === "number" && Number.isFinite(amount) && amount >= 0 ? { currency: "USD", amount } : null; }
function canSpend(provider: ProviderAllowance, request: ResearchRequest, options: ResearchExecutorOptions, spent: number) { const estimate = options.estimatedCosts?.[provider]; return typeof estimate !== "number" || spent + estimate <= request.costCeiling.amount; }
function notAllowed(provider: ProviderAllowance, purpose: string): ProviderResult { return { provider, purpose, facts: [], evidence: [], unknowns: [`${provider} is not allowed for this request.`], conflicts: [], cost: null }; }

// One evidence store per research execution, seeded from the shared evidence Event-project supplied,
// so the Details path and the public-web seed path never pay for the same Place ID twice.
export function googlePlacesEvidenceStoreFor(context: ResearchContext, options: ResearchExecutorOptions): GooglePlacesEvidenceStore {
  return options.googlePlacesEvidenceStore ?? createInMemoryGooglePlacesEvidenceStore(context.googlePlacesEvidence ? [context.googlePlacesEvidence] : [], () => nowOf(options));
}

async function runGoogleDetails(request: ResearchRequest, context: ResearchContext, options: ResearchExecutorOptions, placeId: string): Promise<ProviderResult> {
  const purpose = request.researchPurpose;
  const name = targetName(request, context);
  if (!name) return { provider: "GOOGLE_PLACES", purpose, facts: [], evidence: [], unknowns: ["Exact Place Details requires an evidenced target name."], conflicts: [], cost: null };
  const unclassified = request.subject.entityType === "UNKNOWN";
  const input: GooglePlacesDetailsInput = { googlePlaceId: placeId, targetName: name, targetWebsite: context.targetWebsite ?? null, locality: context.locality ?? null, lane: unclassified ? "EXACT_ID" : request.subject.entityType === "ORGANISATION" ? "ORGANISATION_FIRST" : "VENUE_FIRST", targetType: unclassified ? "UNCLASSIFIED" : request.subject.entityType === "ORGANISATION" ? "ORGANISATION" : "VENUE", limit: 1 };
  const evidenceStore = context.googlePlacesEvidenceStore ?? googlePlacesEvidenceStoreFor(context, options);
  let calls: number | null = null;
  const usage = (callCount: number) => { const cost = callCount > 0 ? usageCost("GOOGLE_PLACES", options) : null; return { cost, providerUsage: [{ provider: "GOOGLE_PLACES" as const, callCount, purpose, cost }] }; };
  try {
    const details = await (options.googlePlaceDetails ?? getGooglePlaceDetails)(input, { mode: "details_selected", detailsAuthorization: officialWebsiteDetailsAuthorization(request, context), evidenceStore, requestingApplication: request.originatingProduct, workflow: `nexus_research:${purpose}`, now: options.now, onCallTelemetry: async (telemetry) => { calls = (calls ?? 0) + telemetry.googleCalls; await options.onGooglePlacesCallTelemetry?.(telemetry); } });
    const callCount = details.googleCalls ?? calls ?? 1;
    const item = details.result;
    if (!item) return { provider: "GOOGLE_PLACES", purpose, facts: [], evidence: [], unknowns: ["Google Place Details returned no provider evidence for the retained Place ID."], conflicts: [], ...usage(callCount) };
    const observedAt = nowOf(options);
    const ref = evidenceRef(request, "GOOGLE_PLACES", item.googlePlaceId);
    return { provider: "GOOGLE_PLACES", purpose, facts: googleFacts(request, item, ref, observedAt), evidence: [baseEvidence(request, "GOOGLE_PLACES", item.googlePlaceId, item.sourceUrl, { ...item, providerTypesAreNotCanonical: true, ...(details.evidence ? { googlePlacesEvidence: details.evidence } : {}) }, observedAt)], unknowns: [], conflicts: [], ...usage(callCount) };
  } catch (error) { return { provider: "GOOGLE_PLACES", purpose, facts: [], evidence: [], unknowns: ["Google Place Details could not safely return provider evidence."], conflicts: [], ...usage(calls ?? 1), error: { code: "GOOGLE_PLACES_UNAVAILABLE", message: error instanceof Error ? error.message : "Provider failed safely.", retryable: true } }; }
}

async function runGoogle(request: ResearchRequest, context: ResearchContext, options: ResearchExecutorOptions): Promise<ProviderResult> {
  const purpose = request.researchPurpose;
  if (request.subject.entityType !== "VENUE" && request.subject.entityType !== "ORGANISATION") return { provider: "GOOGLE_PLACES", purpose, facts: [], evidence: [], unknowns: ["Unclassified Google research does not run a venue-first text search. An evidenced Place ID is required for exact Place Details."], conflicts: [], cost: null };
  const input: GooglePlacesSearchInput = { targetName: targetName(request, context) ?? "", targetWebsite: context.targetWebsite ?? null, locality: context.locality ?? null, lane: request.subject.entityType === "ORGANISATION" ? "ORGANISATION_FIRST" : "VENUE_FIRST", targetType: request.subject.entityType === "ORGANISATION" ? "ORGANISATION" : "VENUE", limit: 3 };
  if (!input.targetName) return { provider: "GOOGLE_PLACES", purpose, facts: [], evidence: [], unknowns: ["Venue identity cannot be researched without an evidenced target name."], conflicts: [], cost: null };
  try { const result = await (options.googlePlaces ?? searchGooglePlaces)(input, { mode: "search_only" }); const observedAt = nowOf(options); const facts: ProposedFact[] = []; const evidence = result.results.map((item: GooglePlacesEvidence) => { const ref = evidenceRef(request, "GOOGLE_PLACES", item.googlePlaceId); facts.push(...googleFacts(request, item, ref, observedAt)); return baseEvidence(request, "GOOGLE_PLACES", item.googlePlaceId, item.sourceUrl, item, observedAt); }); const plausible = result.results.filter((item) => ["EXACT_OR_STRONG", "REVIEW_REQUIRED"].includes(item.matchStatus)); const conflicts = plausible.length > 1 ? [{ code: "MULTIPLE_PLAUSIBLE_PLACE_MATCHES", placeIds: plausible.map((item) => item.googlePlaceId) }] : []; return { provider: "GOOGLE_PLACES", purpose, facts, evidence, unknowns: facts.length ? [] : ["Google Places returned no evidence-backed venue match."], conflicts, cost: usageCost("GOOGLE_PLACES", options) }; } catch (error) { return { provider: "GOOGLE_PLACES", purpose, facts: [], evidence: [], unknowns: ["Google Places could not safely resolve the venue identity."], conflicts: [], cost: usageCost("GOOGLE_PLACES", options), error: { code: "GOOGLE_PLACES_UNAVAILABLE", message: error instanceof Error ? error.message : "Provider failed safely.", retryable: true } }; }
}

async function runCompaniesHouse(request: ResearchRequest, context: ResearchContext, options: ResearchExecutorOptions): Promise<ProviderResult> {
  const purpose = request.researchPurpose; const name = targetName(request, context); if (!name) return { provider: "COMPANIES_HOUSE", purpose, facts: [], evidence: [], unknowns: ["Legal organisation research cannot proceed without an evidenced organisation name."], conflicts: [], cost: null }; if (context.territory !== "GB") return { provider: "COMPANIES_HOUSE", purpose, facts: [], evidence: [], unknowns: ["Companies House is not applicable outside the UK."], conflicts: [], cost: null };
  try { const result: CompaniesHouseSearchResult = await (options.companiesHouse ?? searchCompaniesHouse)({ organisationName: name, tradingName: name, territory: "GB", limit: 5 }, { mode: "search_only" }); const observedAt = nowOf(options); const company = result.selectedCompany; if (!company) return { provider: "COMPANIES_HOUSE", purpose, facts: [], evidence: [], unknowns: [result.reason], conflicts: result.companies.length > 1 ? [{ code: "AMBIGUOUS_LEGAL_ORGANISATION", candidates: result.companies.map((item) => item.companyNumber) }] : [], cost: usageCost("COMPANIES_HOUSE", options) }; const ref = evidenceRef(request, "COMPANIES_HOUSE", company.companyNumber); const evidence = [baseEvidence(request, "COMPANIES_HOUSE", company.companyNumber, company.recordUrl, company, observedAt)]; const facts = [fact(request, "legalCompanyName", company.legalCompanyName, ref, 0.98, observedAt), fact(request, "companyNumber", company.companyNumber, ref, 0.99, observedAt), fact(request, "companyStatus", company.companyStatus, ref, 0.98, observedAt), fact(request, "companyType", company.companyType, ref, 0.9, observedAt), fact(request, "sicCodes", company.sicCodes, ref, 0.95, observedAt)]; return { provider: "COMPANIES_HOUSE", purpose, facts, evidence, unknowns: [], conflicts: [], cost: usageCost("COMPANIES_HOUSE", options) }; } catch (error) { return { provider: "COMPANIES_HOUSE", purpose, facts: [], evidence: [], unknowns: ["Companies House could not safely resolve the legal organisation."], conflicts: [], cost: usageCost("COMPANIES_HOUSE", options), error: { code: "COMPANIES_HOUSE_UNAVAILABLE", message: error instanceof Error ? error.message : "Provider failed safely.", retryable: true } }; }
}

async function runOpenAI(request: ResearchRequest, context: ResearchContext, options: ResearchExecutorOptions): Promise<ProviderResult> { const name = targetName(request, context); if (!name) return { provider: "OPENAI", purpose: request.researchPurpose, facts: [], evidence: [], unknowns: ["AI interpretation requires an evidenced target name."], conflicts: [], cost: null }; try { const result = await (options.openAI ?? researchCompany)({ companyName: name, website: context.targetWebsite ?? undefined }); const observedAt = nowOf(options); const evidence = result.brief.facts.filter((item) => item.sourceUrl).map((item, index) => baseEvidence(request, "OPENAI", `brief-${index}`, item.sourceUrl ?? null, item, observedAt)); const facts = result.brief.facts.filter((item) => item.kind === "FACT" && Boolean(item.sourceUrl)).map((item, index) => fact(request, item.claim, item.claim, evidence[index]?.evidenceRef ?? null, item.confidence === "HIGH" ? 0.9 : item.confidence === "MEDIUM" ? 0.7 : 0.4, observedAt)); return { provider: "OPENAI", purpose: request.researchPurpose, facts, evidence, unknowns: result.brief.unknowns ?? [], conflicts: [], cost: usageCost("OPENAI", options) }; } catch (error) { return { provider: "OPENAI", purpose: request.researchPurpose, facts: [], evidence: [], unknowns: ["AI research was unavailable; no inferred fact was retained."], conflicts: [], cost: usageCost("OPENAI", options), error: { code: "OPENAI_RESEARCH_UNAVAILABLE", message: error instanceof Error ? error.message : "Provider failed safely.", retryable: true } }; } }

export function retryableProviderFailure(result: Record<string, unknown> | null) {
  if (!result || result.status !== "UNRESOLVED") return false;
  const errors = Array.isArray(result.researchErrors) ? result.researchErrors : [];
  return errors.length > 0 && errors.every((error) => Boolean(error) && typeof error === "object" && (error as { retryable?: unknown }).retryable === true);
}

// Source discovery has its own execution generation. Research stays on
// resources-v2-unclassified-evidence-v6. v1 was the unversioned client-key cache,
// which replayed repairable crawl failures such as the robots.txt HTTP 301 block.
export const SOURCE_DISCOVERY_EXECUTION_VERSION = "resources-v2-source-discovery-v4";

/** Resources venue acquisition always searches for an evidenced email. Other callers must ask for VENUE_EMAIL. */
export function venueEmailAcquisitionRequested(request: { acquisitionGoal?: string | null; originatingProduct: string; subjectReference: { entityType: string } }) {
  return request.acquisitionGoal === "VENUE_EMAIL" || (request.originatingProduct === "event_suite_resources" && request.subjectReference.entityType === "VENUE");
}

function versionedUuid(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16]!, 16) % 4]!;
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

export function sourceDiscoveryExecutionKey(idempotencyKey: string, version = SOURCE_DISCOVERY_EXECUTION_VERSION) {
  return versionedUuid(`nexus-source-discovery:${version}:${idempotencyKey}`);
}

export function sourceDiscoveryReplayable(result: Record<string, unknown> | null) {
  if (!result || typeof result !== "object") return false;
  const crawl = result.crawl;
  if (!crawl || typeof crawl !== "object") return false;
  const summary = crawl as { status?: unknown; retryable?: unknown };
  if (summary.retryable === true) return false;
  if (summary.status === "COMPLETED" || summary.status === "PARTIAL") return true;
  if (summary.retryable === false && (summary.status === "BLOCKED" || summary.status === "FAILED")) return true;
  return false;
}

export async function executeResearchRequest(input: unknown, suppliedContext: ResearchContext = {}, options: ResearchExecutorOptions = {}, store: NexusResultStore = new InMemoryNexusResultStore()) {
  const request = validateResearchRequest(input); const prior = await store.get(request.idempotencyKey); if (prior && !retryableProviderFailure(prior)) return prior;
  const context: ResearchContext = { ...suppliedContext, googlePlacesEvidenceStore: suppliedContext.googlePlacesEvidenceStore ?? googlePlacesEvidenceStoreFor(suppliedContext, options) };
  const now = nowOf(options); const facts: ProposedFact[] = []; const evidence: ProviderResult["evidence"] = []; const unknowns: string[] = []; const conflicts: Array<Record<string, unknown>> = []; const errors: Array<{ code: string; message: string; retryable: boolean }> = []; const usage: Array<{ provider: ProviderAllowance; callCount: number; purpose: string; cost: Cost }> = []; let spent = 0; const allowed = new Set(request.providerAllowances); const run = async (provider: ProviderAllowance, operation: () => Promise<ProviderResult>) => { if (!allowed.has(provider)) { unknowns.push(`${provider} is not allowed for this request.`); return; } if (!canSpend(provider, request, options, spent)) { unknowns.push(`The ${provider} execution was skipped because its projected cost exceeds the request ceiling.`); errors.push({ code: "COST_CEILING_EXCEEDED", message: `${provider} was not called because its projected bounded execution exceeds the request cost ceiling.`, retryable: false }); return; } const result = await operation(); const resultUsage = result.providerUsage ?? [{ provider, callCount: 1, purpose: result.purpose, cost: result.cost }]; for (const item of resultUsage) { const cost = item.cost ? { ...item.cost, currency: request.costCeiling.currency } : null; usage.push({ ...item, cost }); if (cost) spent += cost.amount; } facts.push(...result.facts); evidence.push(...result.evidence); unknowns.push(...result.unknowns); conflicts.push(...result.conflicts); if (result.error) errors.push(result.error); };
  const purpose = request.researchPurpose;
  const placeId = retainedPlaceId(context);
  if (placeId && allowed.has("GOOGLE_PLACES")) await run("GOOGLE_PLACES", () => runGoogleDetails(request, context, options, placeId));
  if (purpose === "VENUE_IDENTITY") { if (!placeId && (request.subject.entityType === "VENUE" || request.subject.entityType === "ORGANISATION")) await run("GOOGLE_PLACES", () => runGoogle(request, context, options)); else if (!placeId) unknowns.push("Unclassified venue-identity research requires an evidenced Google Place ID; no venue-first text search was run."); }
  else if (purpose === "LEGAL_ORGANISATION") await run("COMPANIES_HOUSE", () => runCompaniesHouse(request, context, options));
  else if (purpose === "VENUE_OPERATOR") { if (context.publicWeb?.facts?.length) { const result: ProviderResult = { provider: "PUBLIC_WEB", purpose, facts: context.publicWeb.facts.map((item) => fact(request, item.fieldName, item.value, item.evidenceRef ?? null, 0.75, now)), evidence: (context.publicWeb.evidence ?? []).map((item) => baseEvidence(request, "PUBLIC_WEB", item.externalRecordId, item.sourceUrl ?? null, item.payload ?? null, now)), unknowns: [], conflicts: [], cost: null }; await run("PUBLIC_WEB", async () => result); } else { await run("PUBLIC_WEB", async () => ({ provider: "PUBLIC_WEB", purpose, facts: [], evidence: [], unknowns: ["No direct official-site relationship evidence was supplied; the operator remains unresolved."], conflicts: [], cost: null })); } if (allowed.has("COMPANIES_HOUSE") && context.territory === "GB") await run("COMPANIES_HOUSE", () => runCompaniesHouse(request, context, options)); }
  else if (purpose === "OFFICIAL_WEBSITE" || purpose === "PUBLIC_CONTACT" || purpose === "CONFLICT_RESOLUTION" || purpose === "SOURCE_ENTITY_CLASSIFICATION") { if (context.publicWeb?.facts?.length || context.publicWeb?.evidence?.length) await run("PUBLIC_WEB", async () => ({ provider: "PUBLIC_WEB", purpose, facts: (context.publicWeb?.facts ?? []).map((item) => fact(request, item.fieldName, item.value, item.evidenceRef ?? null, 0.8, now)), evidence: (context.publicWeb?.evidence ?? []).map((item) => baseEvidence(request, "PUBLIC_WEB", item.externalRecordId, item.sourceUrl ?? null, item.payload ?? null, now)), unknowns: [], conflicts: [], cost: null })); else if (allowed.has("PUBLIC_WEB") && options.publicWeb) await run("PUBLIC_WEB", () => options.publicWeb!({ request, context })); else if (!placeId) unknowns.push("No bounded public-web evidence was available; the requested fact remains unresolved."); if (purpose === "CONFLICT_RESOLUTION" && !placeId && request.subject.entityType === "VENUE") await run("GOOGLE_PLACES", () => runGoogle(request, context, options)); else if (purpose === "CONFLICT_RESOLUTION" && !placeId && request.subject.entityType === "UNKNOWN" && allowed.has("GOOGLE_PLACES")) unknowns.push("Unclassified conflict research does not run a venue-first Google text search."); }
  else if (purpose === "COMMERCIAL_CONTACT") { if (allowed.has("APOLLO")) unknowns.push("Apollo commercial-contact execution requires an explicit selected target and is not automatic for Resources acquisition."); else unknowns.push("Apollo is not allowed for this request."); }
  if (allowed.has("OPENAI") && ["VENUE_OPERATOR", "OFFICIAL_WEBSITE", "CONFLICT_RESOLUTION"].includes(purpose) && !facts.length) await run("OPENAI", () => runOpenAI(request, context, options));
  const uniqueUnknowns = [...new Set(unknowns)]; const status = facts.length && !uniqueUnknowns.length ? "COMPLETED" : facts.length ? "PARTIAL" : errors.some((error) => !error.retryable) ? "UNRESOLVED" : "UNRESOLVED"; const result = validateResearchResult({ contractVersion: CONTRACTS.RESEARCH_RESULT, requestId: request.requestId, idempotencyKey: request.idempotencyKey, status, facts, evidence, unknowns: uniqueUnknowns, conflicts, providerUsage: usage.map((item) => ({ ...item, cost: item.cost ? { currency: item.cost.currency, amount: item.cost.amount } : null })), costSummary: { currency: request.costCeiling.currency, amount: spent }, observedAt: now, researchErrors: errors, recommendation: { advisory: status === "COMPLETED" ? "Proposed facts are ready for Nexus review." : "Keep the subject unresolved until additional allowed evidence is available.", unreportedProviderCosts: usage.filter((item) => !item.cost).map((item) => item.provider) } }); await store.set(request.idempotencyKey, result); return result;
}

function sourceFact(request: SourceDiscoveryRequest, fieldName: string, value: unknown, sourceUrl: string, evidenceRef: string, observedAt: string) { return { subjectEntityType: request.subjectReference.entityType, canonicalEntityId: request.subjectReference.canonicalEntityId, fieldName, value, evidenceRef, confidence: 0.8, observedAt }; }

/** Contract warnings are limited to 256 characters. A longer crawler note must not reject an otherwise valid result. */
export function boundCrawlWarnings(warnings: string[]) {
  return [...new Set(warnings.map((warning) => warning.length <= 256 ? warning : `${warning.slice(0, 253)}...`))];
}
export async function executeSourceDiscoveryRequest(input: unknown, options: SourceDiscoveryExecutorOptions = {}, store: NexusResultStore = new InMemoryNexusResultStore()) {
  const request = validateSourceDiscoveryRequest(input);
  const emailGoal = venueEmailAcquisitionRequested(request);
  const versionedKey = sourceDiscoveryExecutionKey(request.idempotencyKey);
  const versioned = await store.get(versionedKey);
  if (sourceDiscoveryReplayable(versioned)) return versioned;
  // v1 stored the client idempotency key with no email outcome. An email acquisition must not reuse it.
  if (!emailGoal && !versioned) {
    const legacy = await store.get(request.idempotencyKey);
    if (legacy && sourceDiscoveryReplayable(legacy)) return legacy;
  }
  const requestedExtractors = emailGoal && !request.requestedExtractors.includes("PUBLIC_CONTACT")
    ? [...request.requestedExtractors, "PUBLIC_CONTACT" as SourceExtractor]
    : request.requestedExtractors as SourceExtractor[];
  const venueName = request.venueName ?? "";
  const now = nowOf(options);
  let crawl;
  try {
    crawl = await crawlVerifiedSource({
      verifiedUrl: request.verifiedSourceUrl,
      requestedExtractors,
      budget: request.crawlBudget as CrawlBudget,
      subjectType: request.subjectReference.entityType,
      fetchImpl: options.fetchImpl,
      resolveHost: options.resolveHost,
      documentCache: options.documentCache,
      freshnessMaxAgeHours: request.freshnessRequirements.maxAgeHours ?? undefined,
      emailGoal,
      venueName,
    });
  } catch (error) {
    const result = validateSourceDiscoveryResult({
      contractVersion: CONTRACTS.SOURCE_DISCOVERY_RESULT,
      discoveryRequestId: request.discoveryRequestId,
      idempotencyKey: request.idempotencyKey,
      subjectReference: request.subjectReference,
      source: { verifiedUrl: request.verifiedSourceUrl, finalUrl: request.verifiedSourceUrl, observedAt: now, sourceHash: createHash("sha256").update(request.verifiedSourceUrl).digest("hex") },
      crawl: { status: "FAILED", warnings: boundCrawlWarnings([error instanceof Error ? error.message : "Source discovery failed safely."]), requestCount: 0, pageCount: 0, bytesRead: 0, redirects: 0, blockedCount: 1, retryable: true, emailOutcome: emailGoal ? "TRANSIENT_FAILURE" : "EMAIL_NOT_REQUESTED" },
      identityFacts: [], publicContacts: [], venueFacts: [], imageCandidates: [], eventCandidates: [], evidenceRefs: [], guideEmailReady: false,
    });
    await store.set(versionedKey, result);
    return result;
  }
  const extracted = extractFromFetchedDocuments(crawl.documents, requestedExtractors);
  const sourceHash = createHash("sha256").update(crawl.documents.map((document) => `${document.url}:${document.sourceHash}`).join("\n")).digest("hex");
  const identityFacts = extracted.identityFacts.map((item) => sourceFact(request, item.fieldName, item.value, item.sourceUrl, item.evidenceRef, now));
  const publicContacts = extracted.publicContacts.map((item) => {
    const verdict = item.type === "EMAIL" ? acceptVenueEmail(item.value, item.sourceUrl, venueName, item.label ?? "") : null;
    return { type: item.type, value: item.value, sourceUrl: item.sourceUrl, observedAt: now, evidenceRef: item.evidenceRef, confidence: item.confidence, reviewRequired: item.type === "EMAIL" ? item.reviewRequired || !verdict!.accepted : item.reviewRequired };
  });
  const venueFacts = extracted.venueFacts.map((item) => ({ fieldName: item.fieldName, value: item.value, sourceUrl: item.sourceUrl, observedAt: now, evidenceRef: item.evidenceRef, confidence: item.confidence, reviewRequired: item.reviewRequired }));
  const warnings = boundCrawlWarnings([...crawl.stats.warnings, ...extracted.warnings]);
  const crawlStatus = crawl.stats.status === "COMPLETED" && warnings.length ? "PARTIAL" : crawl.stats.status;
  const retryable = crawlStatus !== "COMPLETED" && crawlStatus !== "PARTIAL" && crawl.stats.failureClass === "RETRYABLE";
  const emailFound = emailGoal && publicContacts.some((contact) => contact.type === "EMAIL" && !contact.reviewRequired);
  const emailOutcome = deriveEmailAcquisitionOutcome({
    emailGoal,
    emailFound,
    status: crawlStatus,
    retryable,
    stopReason: crawl.observability?.stopReason ?? null,
    renderNeeded: (crawl.observability?.renderNeededButUnavailable.length ?? 0) > 0,
    contactPathsRemaining: crawl.observability?.contactPathsRemaining ?? 0,
  });
  const result = validateSourceDiscoveryResult({
    contractVersion: CONTRACTS.SOURCE_DISCOVERY_RESULT,
    discoveryRequestId: request.discoveryRequestId,
    idempotencyKey: request.idempotencyKey,
    subjectReference: request.subjectReference,
    source: { verifiedUrl: request.verifiedSourceUrl, finalUrl: crawl.finalUrl, observedAt: now, sourceHash },
    crawl: { status: crawlStatus, warnings, requestCount: crawl.stats.requestCount, pageCount: crawl.stats.pageCount, bytesRead: crawl.stats.bytesRead, redirects: crawl.stats.redirects, blockedCount: crawl.stats.blockedCount, retryable, emailOutcome },
    identityFacts, publicContacts, venueFacts,
    imageCandidates: extracted.imageCandidates.map((item) => ({ ...item, discoveredAt: now })),
    eventCandidates: extracted.eventCandidates,
    evidenceRefs: extracted.evidenceRefs,
    guideEmailReady: emailFound,
  });
  if (crawl.observability) await reportCrawlObservability({ ...crawl.observability, extractorYields: extractorYields(extracted) }, options);
  await store.set(versionedKey, result);
  return result;
}

async function reportCrawlObservability(observability: CrawlObservability, options: SourceDiscoveryExecutorOptions) {
  try {
    if (options.onCrawlObservability) await options.onCrawlObservability(observability);
    else if (process.env.NEXUS_CRAWL_LOG === "1" || process.env.VERCEL) console.info(crawlLogLine(observability));
  } catch { /* telemetry must never change a crawl result */ }
}
