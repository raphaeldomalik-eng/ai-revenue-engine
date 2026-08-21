import { APOLLO_PRIMARY_ROLE_FAMILIES, searchApolloBuyers, type ApolloOperationalEmployerAlias } from "../src/ai-sales-team/apollo.ts";
import { LIVE_MODEL_COMPARISON_CASES } from "./live-model-comparison-v1.ts";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const FOCUSED_CASE_IDS = ["M01", "M04"] as const;
const MAX_CASES = FOCUSED_CASE_IDS.length;
const MAX_RESULTS_PER_CASE = 5;
const APOLLO_SEARCH_URL = "https://api.apollo.io/api/v1/mixed_people/api_search";
export const CTICC_OPERATIONAL_EMPLOYER: ApolloOperationalEmployerAlias = { name: "Cape Town International Convention Centre", canonicalOrganisationName: "Convenco", relationship: "EXPLICIT_IDENTITY_EVIDENCE", evidenceUrls: ["https://www.cticc.co.za/about-cticc/history-and-ownership/"] };
const identityByCase: Record<typeof FOCUSED_CASE_IDS[number], { organisationName: string; organisationDomain: string; peopleSearchOrganisation?: ApolloOperationalEmployerAlias }> = {
  M01: { organisationName: "Mash Media Group", organisationDomain: "https://mashmedia.net/" },
  M04: { organisationName: "Convenco", organisationDomain: "https://www.cticc.co.za/", peopleSearchOrganisation: CTICC_OPERATIONAL_EMPLOYER },
} as const;

function humanSelectionRecommendation(caseId: string, rank: number, status: string, routing: string | undefined) {
  if (status === "REJECTED" || routing === "IRRELEVANT") return "DO_NOT_SELECT_REJECTED_OR_IRRELEVANT";
  if (caseId === "M04") return "REVIEW_ONLY_CONFIRM_CTICC_EMPLOYER_AND_CONVENCO_RELATIONSHIP_BEFORE_ANY_ENRICHMENT";
  return rank === 1 ? "RECOMMENDED_FOR_HUMAN_REVIEW_ONLY" : "LOWER_RANK_THAN_TOP_CANDIDATE";
}
function displayDomain(value: string) { try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return value; } }

export async function runApolloPeopleRoutingAcceptance() {
  if (!process.env.APOLLO_API_KEY?.trim()) throw new Error("APOLLO_API_KEY is required; load .env.local without printing it.");
  const frozenCases = FOCUSED_CASE_IDS.map((id) => LIVE_MODEL_COMPARISON_CASES.find((item) => item.id === id));
  if (frozenCases.some((item) => !item) || frozenCases.length !== MAX_CASES) throw new Error("The focused M01/M04 manifest is incomplete.");

  const originalFetch = globalThis.fetch;
  let peopleSearchRequests = 0;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url !== APOLLO_SEARCH_URL) throw new Error("LIVE_APOLLO_ROUTING_UNEXPECTED_NETWORK_CALL");
    peopleSearchRequests += 1;
    if (peopleSearchRequests > MAX_CASES) throw new Error("LIVE_APOLLO_ROUTING_SEARCH_BOUND_EXCEEDED");
    return originalFetch(input, init);
  };

  const cases: unknown[] = [];
  try {
    for (const frozen of frozenCases) {
      if (!frozen) throw new Error("Focused frozen case is missing.");
      const identity = identityByCase[frozen.id as keyof typeof identityByCase];
      if (!identity) throw new Error(`Missing focused canonical identity for ${frozen.id}.`);
      const response = await searchApolloBuyers({ organisationName: identity.organisationName, organisationDomain: identity.organisationDomain, peopleSearchOrganisation: identity.peopleSearchOrganisation, discoveryLane: frozen.lane, roleFamilies: [...APOLLO_PRIMARY_ROLE_FAMILIES], limit: MAX_RESULTS_PER_CASE }, { mode: "search_only" });
      cases.push({
        caseId: frozen.id,
        caseName: frozen.name,
        discoveryLane: frozen.lane,
        canonicalIdentity: { organisationName: identity.organisationName, canonicalDomain: displayDomain(identity.organisationDomain) },
        peopleSearchOrganisation: identity.peopleSearchOrganisation?.name ?? identity.organisationName,
        identityHandoff: identity.peopleSearchOrganisation ? "RESOLVED_CANONICAL_ORGANISATION_AND_EXPLICIT_OPERATIONAL_EMPLOYER_ALIAS" : "RESOLVED_CANONICAL_ORGANISATION_AND_DOMAIN",
        resultCount: response.results.length,
        candidates: response.results.map((person, index) => ({ fullName: person.fullName, title: person.title, currentEmployer: person.organisationName, employerDomainClassification: person.employerDomainOutcome, employerDomainReason: person.employerDomainReason, buyerRoutingClassification: person.buyerRoutingClassification, buyerRoutingReason: person.buyerRoutingReason, roleRankingScore: person.roleRankingScore, deterministicRank: index + 1, humanSelectionRecommendation: humanSelectionRecommendation(frozen.id, index + 1, person.status, person.buyerRoutingClassification), status: person.status, lanePreserved: person.provenance.discoveryLane === frozen.lane })),
        telemetry: { httpStatus: response.telemetry.httpStatus, resultCount: response.telemetry.resultCount, acceptedCount: response.telemetry.acceptedCount, rejectedCount: response.telemetry.rejectedCount, reviewRequiredCount: response.telemetry.reviewRequiredCount, rejectionReasons: response.telemetry.rejectionReasons, creditCategory: response.telemetry.creditCategory },
        enrichmentAttempted: false,
        emailsRequested: false,
        phonesRequested: false,
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  return {
    acceptanceVersion: "apollo-primary-people-routing-focused-v1",
    manifest: frozenCases.map((item) => ({ id: item!.id, name: item!.name, lane: item!.lane, territory: item!.territory })),
    roleFamilies: [...APOLLO_PRIMARY_ROLE_FAMILIES],
    searchMode: "search_only",
    maxResultsPerCase: MAX_RESULTS_PER_CASE,
    retryCount: 0,
    peopleSearchRequests,
    maxPeopleSearchRequests: MAX_CASES,
    cases,
    noPersistence: true,
    noOutreach: true,
    noEnrichment: true,
    noEmailOrPhoneRequests: true,
    directAdapterCallsOnly: true,
    forbiddenNetworkCalls: ["OpenAI", "Google Places", "Apollo enrichment/people match", "production API routes", "Supabase"],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runApolloPeopleRoutingAcceptance().then((value) => console.log(JSON.stringify(value))).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
