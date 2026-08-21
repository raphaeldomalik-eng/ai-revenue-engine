import { contactResearchEligibility, normaliseApolloBusinessEmail, type ContactResearchCandidateState, type ContactResearchTargetIdentity, type ContactResearchResult } from "./contact-research.ts";
import type { DiscoveryLane } from "./prospect-intelligence.ts";

export const APOLLO_MODES = ["disabled", "search_only", "enrich_selected"] as const;
export type ApolloMode = typeof APOLLO_MODES[number];
export type ApolloEndpointCategory = "AUTH_HEALTH" | "USAGE_STATS" | "PEOPLE_SEARCH" | "PERSON_ENRICHMENT";
export type ApolloStatus = "ACCEPTED" | "REJECTED" | "REVIEW_REQUIRED";
export type ApolloEmployerDomainOutcome = "DOMAIN_CONFIRMED" | "DOMAIN_QUERY_SCOPED" | "DOMAIN_MISSING" | "DOMAIN_CONFLICT";
export type ApolloTelemetry = {
  endpointCategory: ApolloEndpointCategory;
  mode: ApolloMode;
  resultCount: number;
  acceptedCount: number;
  rejectedCount: number;
  reviewRequiredCount: number;
  rejectionReasons: string[];
  httpStatus: number | null;
  rateLimit: { retryAfter: string | null; limit: string | null; remaining: string | null; reset: string | null };
  creditCategory: "ZERO_CREDIT_HEALTH" | "ZERO_CREDIT_SEARCH" | "ZERO_CREDIT_USAGE_STATS" | "POTENTIALLY_CHARGEABLE_ENRICHMENT" | "UNKNOWN";
};

export type ApolloBuyerSearchInput = {
  organisationName: string;
  organisationDomain: string;
  peopleSearchOrganisation?: ApolloOperationalEmployerAlias;
  discoveryLane: DiscoveryLane;
  roleFamilies: string[];
  limit?: number;
};

export type ApolloOperationalEmployerAlias = {
  name: string;
  canonicalOrganisationName: string;
  relationship: "EXPLICIT_IDENTITY_EVIDENCE";
  evidenceUrls: string[];
};

export type ApolloBuyerSearchResult = {
  provider: "apollo";
  providerPersonId: string | null;
  fullName: string | null;
  title: string | null;
  seniority: string | null;
  organisationName: string | null;
  organisationDomain: string | null;
  linkedinUrl: string | null;
  emailAvailability: string | null;
  employerDomainOutcome: ApolloEmployerDomainOutcome;
  employerDomainReason: string;
  retrievedAt: string;
  status: ApolloStatus;
  roleClassification: string | null;
  buyerRoutingClassification?: "LIKELY_BUYER" | "INFLUENCER_OR_ROUTE_TO_BUYER" | "IRRELEVANT";
  buyerRoutingReason?: string;
  roleRankingScore?: number;
  rejectionReason: string | null;
  provenance: { provider: "apollo"; endpointCategory: "PEOPLE_SEARCH"; sourceUrl: string; organisationDomain: string; discoveryLane: DiscoveryLane; currentEmployerValidated: boolean; targetOwnershipValidated: boolean };
};

export type ApolloSearchResponse = { mode: ApolloMode; results: ApolloBuyerSearchResult[]; telemetry: ApolloTelemetry };
export type ApolloEnrichmentResponse = { mode: ApolloMode; result: ContactResearchResult | null; telemetry: ApolloTelemetry; blockedReason?: string };

type ApolloFetch = typeof fetch;
type ApolloOptions = { apiKey?: string; mode?: ApolloMode; fetchImpl?: ApolloFetch; now?: () => string };
type ApolloRawPerson = { id?: unknown; person_id?: unknown; name?: unknown; first_name?: unknown; last_name?: unknown; title?: unknown; seniority?: unknown; linkedin_url?: unknown; email_status?: unknown; contact_email_status?: unknown; organization?: { name?: unknown; domain?: unknown; primary_domain?: unknown; website_url?: unknown } | null; employment_history?: Array<{ current?: unknown; organization_name?: unknown; organization?: { name?: unknown; domain?: unknown; primary_domain?: unknown } | null }> };
type ApolloRawSearch = { people?: unknown; contacts?: unknown; total_entries?: unknown; total_count?: unknown };
type ApolloRawEnrichment = { person?: ApolloRawPerson & { email?: unknown; work_email?: unknown; email_status?: unknown } };

const PEOPLE_SEARCH_URL = "https://api.apollo.io/api/v1/mixed_people/api_search";
const AUTH_HEALTH_URL = "https://api.apollo.io/api/v1/auth/health";
const USAGE_STATS_URL = "https://api.apollo.io/api/v1/usage_stats/api_usage_stats";
const PERSON_ENRICHMENT_URL = "https://api.apollo.io/api/v1/people/match";
const APPROVED_OPERATIONAL_EMPLOYER_RELATIONSHIPS = [{ canonicalOrganisationName: "convenco", organisationDomain: "cticc.co.za", peopleSearchOrganisation: "cape town international convention centre", evidenceUrl: "https://www.cticc.co.za/about-cticc/history-and-ownership/" }] as const;
export const APOLLO_PRIMARY_ROLE_FAMILIES = [
  "event leadership",
  "event operations",
  "venue operations",
  "commercial leadership",
  "ticketing or box office",
  "marketing or audience growth",
  "digital, technology or product",
  "procurement or supplier management",
  "managing director, founder or owner",
  "event manager, producer or project manager",
  "freelance event professional",
] as const;
const ROLE_FAMILY_TITLES: Record<string, string[]> = {
  "event leadership": ["event director", "head of events", "director of events", "event portfolio director", "organiser", "organizer"],
  "event operations": ["event operations", "operations director", "operations manager", "head of operations", "event producer"],
  "venue operations": ["venue director", "venue manager", "venue operations", "general manager"],
  "commercial leadership": ["commercial director", "commercial manager", "revenue director", "business development"],
  "ticketing or box office": ["ticketing", "box office", "registration manager", "admissions manager"],
  "marketing or audience growth": ["marketing director", "marketing manager", "audience development", "audience growth"],
  "digital, technology or product": ["digital director", "digital manager", "technology director", "technology manager", "product director", "product manager", "head of digital", "head of technology"],
  "procurement or supplier management": ["procurement", "supplier manager", "vendor manager", "purchasing manager"],
  "managing director, founder or owner": ["managing director", "founder", "owner", "chief executive officer", "ceo"],
  "event manager, producer or project manager": ["event manager", "event producer", "project manager", "programme manager", "program manager"],
  "freelance event professional": ["freelance event", "freelance producer", "independent event"],
};
const ROLE_TOKENS = [...new Set(Object.values(ROLE_FAMILY_TITLES).flat().map((item) => item.toLowerCase()))];

function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function host(value: string | null | undefined) { try { return new URL(/^https?:\/\//i.test(value ?? "") ? value! : `https://${value}`).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, ""); } catch { return ""; } }
function canonicalDomain(value: string) { return host(value); }
function normalisedName(value: string | null | undefined) { return text(value)?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ?? ""; }
function validExplicitOperationalEmployer(input: ApolloBuyerSearchInput) {
  const alias = input.peopleSearchOrganisation;
  if (!alias || alias.relationship !== "EXPLICIT_IDENTITY_EVIDENCE" || !alias.evidenceUrls.length) return null;
  if (!sameOrganisationName(input.organisationName, alias.canonicalOrganisationName)) return null;
  if (!alias.evidenceUrls.every((url) => /^https:\/\/[^\s]+$/i.test(url))) return null;
  const approved = APPROVED_OPERATIONAL_EMPLOYER_RELATIONSHIPS.find((item) => item.canonicalOrganisationName === normalisedName(input.organisationName) && item.organisationDomain === canonicalDomain(input.organisationDomain) && item.peopleSearchOrganisation === normalisedName(alias.name));
  if (!approved || !alias.evidenceUrls.includes(approved.evidenceUrl)) return null;
  return alias;
}
function sameOrganisationName(target: string, actual: string | null, alias?: ApolloOperationalEmployerAlias | null) {
  const expected = [target, alias?.name].map(normalisedName).filter(Boolean);
  const received = normalisedName(actual);
  return Boolean(received && expected.some((item) => item === received || item.includes(received) || received.includes(item)));
}
function sameDomain(target: string, actual: string | null) { const expected = canonicalDomain(target); const received = canonicalDomain(actual ?? ""); return Boolean(expected && received && (expected === received || received.endsWith(`.${expected}`))); }
function employerDomainAssessment(input: ApolloBuyerSearchInput, organisationName: string | null, organisationDomain: string | null, queryScoped: boolean) {
  if (organisationDomain) return sameDomain(input.organisationDomain, organisationDomain) ? { outcome: "DOMAIN_CONFIRMED" as const, reason: "RETURNED_EMPLOYER_DOMAIN_MATCHES_CANONICAL_DOMAIN" } : { outcome: "DOMAIN_CONFLICT" as const, reason: "RETURNED_EMPLOYER_DOMAIN_DIFFERS_FROM_CANONICAL_DOMAIN" };
  const explicitAlias = validExplicitOperationalEmployer(input);
  if (queryScoped && canonicalDomain(input.organisationDomain) && sameOrganisationName(input.organisationName, organisationName, explicitAlias)) return { outcome: "DOMAIN_QUERY_SCOPED" as const, reason: explicitAlias && normalisedName(explicitAlias.name) === normalisedName(organisationName) ? "CANONICAL_DOMAIN_FILTERED_SEARCH_AND_EXPLICIT_OPERATIONAL_EMPLOYER_NAME_MATCHED_BUT_PROVIDER_DOMAIN_WAS_OMITTED" : "CANONICAL_DOMAIN_FILTERED_SEARCH_AND_CURRENT_EMPLOYER_NAME_MATCHED_BUT_PROVIDER_DOMAIN_WAS_OMITTED" };
  return { outcome: "DOMAIN_MISSING" as const, reason: "PROVIDER_EMPLOYER_DOMAIN_OMITTED_WITHOUT_TRUSTWORTHY_QUERY_SCOPING" };
}
function roleClassification(title: string | null, roleFamilies: string[]) { const value = title?.toLowerCase() ?? ""; const family = roleFamilies.find((item) => (ROLE_FAMILY_TITLES[item.toLowerCase()] ?? [item]).some((token) => value.includes(token.toLowerCase()))); return family ?? (ROLE_TOKENS.find((token) => value.includes(token)) ? "RELEVANT_ROLE_FAMILY" : null); }
function roleRanking(title: string | null, family: string | null) {
  const value = title?.toLowerCase() ?? "";
  if (!family) return { classification: "IRRELEVANT" as const, reason: "TITLE_DID_NOT_MATCH_A_CONFIGURED_EVENTSUITE_ROLE_FAMILY", score: 0 };
  const likelyBuyerFamilies = new Set(["event leadership", "event operations", "venue operations", "commercial leadership", "ticketing or box office", "marketing or audience growth", "managing director, founder or owner"]);
  if (likelyBuyerFamilies.has(family)) return { classification: "LIKELY_BUYER" as const, reason: `TITLE_MATCHED_${family.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_")}`, score: value.includes("director") || value.includes("head") || value.includes("chief") || value.includes("owner") || value.includes("founder") ? 100 : 80 };
  if (family === "freelance event professional") return { classification: "INFLUENCER_OR_ROUTE_TO_BUYER" as const, reason: "FREELANCE_EVENT_ROLE_REQUIRES_ORGANISATION_AND_BUYING_AUTHORITY_REVIEW", score: 45 };
  return { classification: "INFLUENCER_OR_ROUTE_TO_BUYER" as const, reason: `TITLE_MATCHED_${family.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_")}_REQUIRES_BUYING_AUTHORITY_REVIEW`, score: 55 };
}
function roleTitles(roleFamilies: string[]) { return [...new Set(roleFamilies.flatMap((family) => ROLE_FAMILY_TITLES[family.toLowerCase()] ?? [family]).map((item) => item.trim()).filter(Boolean))].slice(0, 24); }
function boundedLimit(limit: number | undefined) { return Math.max(1, Math.min(5, Math.floor(limit ?? 5))); }
function modeOf(value: string | undefined) { return APOLLO_MODES.includes(value as ApolloMode) ? value as ApolloMode : "disabled"; }
function telemetry(endpointCategory: ApolloEndpointCategory, mode: ApolloMode, httpStatus: number | null, creditCategory: ApolloTelemetry["creditCategory"], counts?: Partial<Pick<ApolloTelemetry, "resultCount" | "acceptedCount" | "rejectedCount" | "reviewRequiredCount">>, rejectionReasons: string[] = [], headers?: Headers) { return { endpointCategory, mode, resultCount: counts?.resultCount ?? 0, acceptedCount: counts?.acceptedCount ?? 0, rejectedCount: counts?.rejectedCount ?? 0, reviewRequiredCount: counts?.reviewRequiredCount ?? 0, rejectionReasons: [...new Set(rejectionReasons)].slice(0, 12), httpStatus, rateLimit: { retryAfter: headers?.get("retry-after") ?? null, limit: headers?.get("x-ratelimit-limit") ?? null, remaining: headers?.get("x-ratelimit-remaining") ?? null, reset: headers?.get("x-ratelimit-reset") ?? null }, creditCategory }; }
function configuredApiKey(value: string | undefined) { const trimmed = value?.trim(); return trimmed || undefined; }
function optionsOf(options: ApolloOptions = {}) { return { apiKey: configuredApiKey(options.apiKey ?? process.env.APOLLO_API_KEY), mode: options.mode ?? modeOf(process.env.APOLLO_MODE), fetchImpl: options.fetchImpl ?? fetch, now: options.now ?? (() => new Date().toISOString()) }; }

export function buildApolloHeaders(apiKey: string, additionalHeaders?: HeadersInit) {
  const headers = new Headers(additionalHeaders);
  headers.set("accept", "application/json");
  headers.set("content-type", "application/json");
  headers.set("cache-control", "no-cache");
  headers.delete("authorization");
  headers.set("x-api-key", apiKey);
  return headers;
}

export class ApolloProviderError extends Error {
  readonly telemetry: ApolloTelemetry;
  constructor(message: string, telemetryValue: ApolloTelemetry) { super(message); this.name = "ApolloProviderError"; this.telemetry = telemetryValue; }
}

async function safeJson(response: Response, endpoint: ApolloEndpointCategory, mode: ApolloMode, creditCategory: ApolloTelemetry["creditCategory"]) { try { return await response.json() as unknown; } catch { throw new ApolloProviderError("Apollo returned malformed JSON.", telemetry(endpoint, mode, response.status, creditCategory, undefined, ["MALFORMED_RESPONSE"], response.headers)); } }
async function request(options: ReturnType<typeof optionsOf>, endpoint: ApolloEndpointCategory, url: string, init: RequestInit, creditCategory: ApolloTelemetry["creditCategory"]) {
  if (!options.apiKey) throw new ApolloProviderError("APOLLO_NOT_CONFIGURED", telemetry(endpoint, options.mode, null, creditCategory, undefined, ["MISSING_API_KEY"]));
  const response = await options.fetchImpl(url, { ...init, headers: buildApolloHeaders(options.apiKey, init.headers) });
  if (!response.ok) {
    const reason = response.status === 401 ? "AUTHENTICATION_FAILED" : response.status === 429 ? "RATE_LIMITED" : response.status >= 500 ? "PROVIDER_ERROR" : `HTTP_${response.status}`;
    throw new ApolloProviderError(`Apollo ${endpoint.toLowerCase()} failed safely.`, telemetry(endpoint, options.mode, response.status, creditCategory, undefined, [reason], response.headers));
  }
  return { payload: await safeJson(response, endpoint, options.mode, creditCategory), response };
}

export function resolveApolloMode(value = process.env.APOLLO_MODE) { return modeOf(value); }

export async function apolloAuthenticationHealth(options: ApolloOptions = {}) {
  const configured = optionsOf(options);
  const response = await request(configured, "AUTH_HEALTH", AUTH_HEALTH_URL, { method: "GET" }, "ZERO_CREDIT_HEALTH");
  return { ok: true, telemetry: telemetry("AUTH_HEALTH", configured.mode, response.response.status, "ZERO_CREDIT_HEALTH", { resultCount: 1 }, [], response.response.headers) };
}

export async function apolloUsageStats(options: ApolloOptions = {}) {
  const configured = optionsOf(options);
  const response = await request(configured, "USAGE_STATS", USAGE_STATS_URL, { method: "POST", body: JSON.stringify({}) }, "ZERO_CREDIT_USAGE_STATS");
  return { available: Boolean(response.payload && typeof response.payload === "object"), telemetry: telemetry("USAGE_STATS", configured.mode, response.response.status, "ZERO_CREDIT_USAGE_STATS", { resultCount: 1 }, [], response.response.headers) };
}

function normalizePerson(raw: ApolloRawPerson, input: ApolloBuyerSearchInput, retrievedAt: string, queryScoped: boolean): ApolloBuyerSearchResult {
  const organisation = raw.organization ?? null;
  const personId = text(raw.id) ?? text(raw.person_id);
  const fullName = text(raw.name) ?? ([text(raw.first_name), text(raw.last_name)].filter(Boolean).join(" ") || null);
  const title = text(raw.title);
  const organisationName = text(organisation?.name);
  const organisationDomain = canonicalDomain(text(organisation?.primary_domain) ?? text(organisation?.domain) ?? text(organisation?.website_url) ?? "") || null;
  const domainAssessment = employerDomainAssessment(input, organisationName, organisationDomain, queryScoped);
  const currentEmployerValidated = Boolean(organisationName && (organisationDomain || domainAssessment.outcome === "DOMAIN_QUERY_SCOPED"));
  const domainAligned = domainAssessment.outcome === "DOMAIN_CONFIRMED";
  const organisationAligned = sameOrganisationName(input.organisationName, organisationName, validExplicitOperationalEmployer(input));
  const classifiedRole = roleClassification(title, input.roleFamilies);
  const rejectionReason = !personId ? "MISSING_PROVIDER_PERSON_ID" : domainAssessment.outcome === "DOMAIN_CONFLICT" ? "EMPLOYER_DOMAIN_CONFLICT" : domainAssessment.outcome === "DOMAIN_QUERY_SCOPED" ? "EMPLOYER_DOMAIN_QUERY_SCOPED_REQUIRES_REVIEW" : domainAssessment.outcome === "DOMAIN_MISSING" ? "EMPLOYER_DOMAIN_MISSING" : !organisationAligned ? "TARGET_ORGANISATION_MISMATCH" : !classifiedRole ? "IRRELEVANT_ROLE" : null;
  const status: ApolloStatus = domainAssessment.outcome === "DOMAIN_CONFLICT" || rejectionReason === "IRRELEVANT_ROLE" ? "REJECTED" : domainAssessment.outcome === "DOMAIN_QUERY_SCOPED" || Boolean(rejectionReason) ? "REVIEW_REQUIRED" : "ACCEPTED";
  const role = roleRanking(title, classifiedRole);
  return { provider: "apollo", providerPersonId: personId, fullName, title, seniority: text(raw.seniority), organisationName, organisationDomain, linkedinUrl: text(raw.linkedin_url), emailAvailability: text(raw.email_status) ?? text(raw.contact_email_status), employerDomainOutcome: domainAssessment.outcome, employerDomainReason: domainAssessment.reason, retrievedAt, status, roleClassification: classifiedRole, buyerRoutingClassification: role.classification, buyerRoutingReason: role.reason, roleRankingScore: role.score, rejectionReason, provenance: { provider: "apollo", endpointCategory: "PEOPLE_SEARCH", sourceUrl: PEOPLE_SEARCH_URL, organisationDomain: canonicalDomain(input.organisationDomain), discoveryLane: input.discoveryLane, currentEmployerValidated, targetOwnershipValidated: domainAligned && organisationAligned } };
}

export async function searchApolloBuyers(input: ApolloBuyerSearchInput, options: ApolloOptions = {}): Promise<ApolloSearchResponse> {
  const configured = optionsOf(options);
  if (configured.mode === "disabled") return { mode: configured.mode, results: [], telemetry: telemetry("PEOPLE_SEARCH", configured.mode, null, "ZERO_CREDIT_SEARCH", undefined, ["APOLLO_DISABLED"]) };
  const domain = canonicalDomain(input.organisationDomain);
  if (!input.organisationName.trim() || !domain || !input.discoveryLane || !input.roleFamilies.length) throw new ApolloProviderError("APOLLO_SEARCH_INPUT_INVALID", telemetry("PEOPLE_SEARCH", configured.mode, null, "ZERO_CREDIT_SEARCH", undefined, ["INVALID_BOUNDED_SEARCH_INPUT"]));
  const body = { person_titles: roleTitles(input.roleFamilies), person_seniorities: ["owner", "founder", "c_suite", "vp", "head", "director", "manager"], include_similar_titles: false, q_organization_domains_list: [domain], page: 1, per_page: boundedLimit(input.limit) };
  const response = await request(configured, "PEOPLE_SEARCH", PEOPLE_SEARCH_URL, { method: "POST", body: JSON.stringify(body) }, "ZERO_CREDIT_SEARCH");
  const raw = response.payload && typeof response.payload === "object" ? response.payload as ApolloRawSearch : {};
  const people = Array.isArray(raw.people) ? raw.people : Array.isArray(raw.contacts) ? raw.contacts : null;
  if (!people) throw new ApolloProviderError("Apollo people search response was malformed.", telemetry("PEOPLE_SEARCH", configured.mode, response.response.status, "ZERO_CREDIT_SEARCH", undefined, ["MALFORMED_RESPONSE"], response.response.headers));
  const results = people.filter((item): item is ApolloRawPerson => Boolean(item && typeof item === "object")).map((item) => normalizePerson(item, { ...input, organisationDomain: domain }, configured.now!(), true)).sort((a, b) => (b.roleRankingScore ?? 0) - (a.roleRankingScore ?? 0)).slice(0, boundedLimit(input.limit));
  const reasons = results.map((item) => item.rejectionReason).filter((item): item is string => Boolean(item));
  return { mode: configured.mode, results, telemetry: telemetry("PEOPLE_SEARCH", configured.mode, response.response.status, "ZERO_CREDIT_SEARCH", { resultCount: results.length, acceptedCount: results.filter((item) => item.status === "ACCEPTED").length, rejectedCount: results.filter((item) => item.status === "REJECTED").length, reviewRequiredCount: results.filter((item) => item.status === "REVIEW_REQUIRED").length }, reasons, response.response.headers) };
}

export async function enrichSelectedApolloBuyer(input: { selected: ApolloBuyerSearchResult; identity: ContactResearchTargetIdentity; explicitHumanApproval?: boolean }, options: ApolloOptions = {}): Promise<ApolloEnrichmentResponse> {
  const configured = optionsOf(options);
  if (configured.mode !== "enrich_selected") return { mode: configured.mode, result: null, blockedReason: "APOLLO_ENRICHMENT_REQUIRES_EXPLICIT_ENRICH_SELECTED_MODE", telemetry: telemetry("PERSON_ENRICHMENT", configured.mode, null, "POTENTIALLY_CHARGEABLE_ENRICHMENT", undefined, ["ENRICHMENT_MODE_NOT_SELECTED"]) };
  if (input.selected.employerDomainOutcome === "DOMAIN_CONFLICT") return { mode: configured.mode, result: null, blockedReason: "DOMAIN_CONFLICT_NOT_ELIGIBLE", telemetry: telemetry("PERSON_ENRICHMENT", configured.mode, null, "POTENTIALLY_CHARGEABLE_ENRICHMENT", undefined, ["DOMAIN_CONFLICT_NOT_ELIGIBLE"]) };
  const queryScopedApproval = input.selected.employerDomainOutcome === "DOMAIN_QUERY_SCOPED" && input.explicitHumanApproval === true;
  if (input.selected.employerDomainOutcome === "DOMAIN_QUERY_SCOPED" && !queryScopedApproval) return { mode: configured.mode, result: null, blockedReason: "DOMAIN_QUERY_SCOPED_REQUIRES_EXPLICIT_HUMAN_APPROVAL", telemetry: telemetry("PERSON_ENRICHMENT", configured.mode, null, "POTENTIALLY_CHARGEABLE_ENRICHMENT", undefined, ["DOMAIN_QUERY_SCOPED_REQUIRES_EXPLICIT_HUMAN_APPROVAL"]) };
  const approvedDomain = canonicalDomain(input.identity.accountWebsite ?? "");
  const selectedCanonicalDomain = input.selected.provenance.organisationDomain;
  if (queryScopedApproval && (!approvedDomain || approvedDomain !== selectedCanonicalDomain)) return { mode: configured.mode, result: null, blockedReason: "EXPLICIT_APPROVAL_DOMAIN_MISMATCH", telemetry: telemetry("PERSON_ENRICHMENT", configured.mode, null, "POTENTIALLY_CHARGEABLE_ENRICHMENT", undefined, ["EXPLICIT_APPROVAL_DOMAIN_MISMATCH"]) };
  if ((input.selected.status !== "ACCEPTED" && !queryScopedApproval) || !input.selected.providerPersonId || !input.selected.fullName) return { mode: configured.mode, result: null, blockedReason: "SELECTED_PERSON_DID_NOT_PASS_SEARCH_GATES", telemetry: telemetry("PERSON_ENRICHMENT", configured.mode, null, "POTENTIALLY_CHARGEABLE_ENRICHMENT", undefined, ["SELECTED_PERSON_NOT_ACCEPTED"]) };
  const researchDomain = input.selected.organisationDomain ?? selectedCanonicalDomain;
  if (!researchDomain) return { mode: configured.mode, result: null, blockedReason: "APPROVED_EMPLOYER_DOMAIN_MISSING", telemetry: telemetry("PERSON_ENRICHMENT", configured.mode, null, "POTENTIALLY_CHARGEABLE_ENRICHMENT", undefined, ["APPROVED_EMPLOYER_DOMAIN_MISSING"]) };
  const response = await request(configured, "PERSON_ENRICHMENT", PERSON_ENRICHMENT_URL, { method: "POST", body: JSON.stringify({ id: input.selected.providerPersonId, domain: researchDomain, organization_name: input.selected.organisationName, reveal_personal_emails: false, reveal_phone_number: false, run_waterfall_email: false, run_waterfall_phone: false }) }, "POTENTIALLY_CHARGEABLE_ENRICHMENT");
  const payload = response.payload && typeof response.payload === "object" ? response.payload as ApolloRawEnrichment : {};
  if (!payload.person || typeof payload.person !== "object") throw new ApolloProviderError("Apollo person enrichment response was malformed.", telemetry("PERSON_ENRICHMENT", configured.mode, response.response.status, "POTENTIALLY_CHARGEABLE_ENRICHMENT", undefined, ["MALFORMED_RESPONSE"], response.response.headers));
  const email = text(payload.person.work_email) ?? text(payload.person.email);
  const status = text(payload.person.email_status);
  const emailDomain = email?.split("@")[1] ?? null;
  const emailAllowed = Boolean(email && emailDomain && sameDomain(researchDomain, emailDomain) && status?.toLowerCase() === "verified");
  const result = emailAllowed ? normaliseApolloBusinessEmail({ fullName: input.selected.fullName, roleTitle: input.selected.title, email: email!, targetIdentity: input.identity, providerPersonId: input.selected.providerPersonId, providerStatus: status!, sourceUrl: PERSON_ENRICHMENT_URL }) : null;
  const rejectionReasons = result ? [] : [email ? !emailDomain || !sameDomain(input.selected.organisationDomain ?? "", emailDomain) ? "EMAIL_DOMAIN_MISMATCH" : status?.toLowerCase() !== "verified" ? "UNACCEPTABLE_EMAIL_STATUS" : "EMAIL_TARGET_OWNERSHIP_UNVERIFIED" : "NO_BUSINESS_EMAIL_RETURNED"];
  return { mode: configured.mode, result, blockedReason: result ? undefined : rejectionReasons[0], telemetry: telemetry("PERSON_ENRICHMENT", configured.mode, response.response.status, "POTENTIALLY_CHARGEABLE_ENRICHMENT", { resultCount: 1, acceptedCount: result ? 1 : 0, rejectedCount: result ? 0 : 1 }, rejectionReasons, response.response.headers) };
}

export async function searchEligibleApolloBuyers(input: { candidate: ContactResearchCandidateState; identity: ContactResearchTargetIdentity; organisationName: string; organisationDomain: string; discoveryLane: DiscoveryLane; roleFamilies: string[]; limit?: number; mode?: ApolloMode }, options: ApolloOptions = {}) {
  const eligibility = contactResearchEligibility(input.candidate, input.identity);
  if (!eligibility.eligible) return { blocked: true as const, reason: eligibility.reason, result: null };
  return { blocked: false as const, result: await searchApolloBuyers(input, { ...options, mode: input.mode ?? options.mode }) };
}

export async function searchPrimaryApolloBuyers(input: { candidate: ContactResearchCandidateState; identity: ContactResearchTargetIdentity; peopleSearchOrganisation?: ApolloOperationalEmployerAlias; discoveryLane: DiscoveryLane; mode?: ApolloMode }, options: ApolloOptions = {}) {
  const eligibility = contactResearchEligibility(input.candidate, input.identity);
  if (!eligibility.eligible) return { blocked: true as const, reason: eligibility.reason, result: null };
  const organisationName = input.identity.accountName?.trim();
  const organisationDomain = canonicalDomain(input.identity.accountWebsite ?? "");
  if (!organisationName || !organisationDomain) return { blocked: true as const, reason: "CANONICAL_ORGANISATION_DOMAIN_REQUIRED", result: null };
  return { blocked: false as const, result: await searchApolloBuyers({ organisationName, organisationDomain, peopleSearchOrganisation: input.peopleSearchOrganisation, discoveryLane: input.discoveryLane, roleFamilies: [...APOLLO_PRIMARY_ROLE_FAMILIES], limit: 5 }, { ...options, mode: input.mode ?? options.mode }) };
}
