import { APOLLO_PRIMARY_ROLE_FAMILIES, searchApolloBuyers } from "../src/ai-sales-team/apollo.ts";
import { LIVE_MODEL_COMPARISON_CASES } from "./live-model-comparison-v1.ts";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_CASES = 4;
const MAX_RESULTS_PER_CASE = 5;
const APOLLO_SEARCH_URL = "https://api.apollo.io/api/v1/mixed_people/api_search";

const identityByCase = {
  M01: { organisationName: "Mash Media Group", organisationDomain: "https://www.mashmedia.co.uk/" },
  M02: { organisationName: "Hyve Group", organisationDomain: "https://hyve.group/" },
  M03: { organisationName: "Durban ICC", organisationDomain: "https://icc.co.za/" },
  M04: { organisationName: "Convenco", organisationDomain: "https://www.cticc.co.za/" },
} as const;

function safeError(error: unknown) { return error instanceof Error ? error.message : "Apollo people search failed safely."; }

export async function runApolloPeopleRoutingAcceptance() {
  if (!process.env.APOLLO_API_KEY?.trim()) throw new Error("APOLLO_API_KEY is required; load .env.local without printing it.");
  if (LIVE_MODEL_COMPARISON_CASES.length !== MAX_CASES) throw new Error("The frozen four-case manifest must remain exactly four cases.");

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
    for (const frozen of LIVE_MODEL_COMPARISON_CASES) {
      const identity = identityByCase[frozen.id as keyof typeof identityByCase];
      if (!identity) throw new Error(`Missing frozen canonical identity for ${frozen.id}.`);
      try {
        const response = await searchApolloBuyers({ organisationName: identity.organisationName, organisationDomain: identity.organisationDomain, discoveryLane: frozen.lane, roleFamilies: [...APOLLO_PRIMARY_ROLE_FAMILIES], limit: MAX_RESULTS_PER_CASE }, { mode: "search_only" });
        cases.push({
          caseId: frozen.id,
          caseName: frozen.name,
          discoveryLane: frozen.lane,
          canonicalIdentity: identity,
          identityHandoff: "RESOLVED_CANONICAL_ORGANISATION_AND_DOMAIN",
          resultCount: response.results.length,
          candidates: response.results.map((person) => ({ fullName: person.fullName, title: person.title, currentEmployer: person.organisationName, employerDomainOutcome: person.employerDomainOutcome, employerDomainReason: person.employerDomainReason, status: person.status, roleClassification: person.roleClassification, buyerRoutingClassification: person.buyerRoutingClassification, buyerRoutingReason: person.buyerRoutingReason, lanePreserved: person.provenance.discoveryLane === frozen.lane })),
          telemetry: { httpStatus: response.telemetry.httpStatus, resultCount: response.telemetry.resultCount, acceptedCount: response.telemetry.acceptedCount, rejectedCount: response.telemetry.rejectedCount, reviewRequiredCount: response.telemetry.reviewRequiredCount, rejectionReasons: response.telemetry.rejectionReasons, creditCategory: response.telemetry.creditCategory },
          enrichmentAttempted: false,
          emailsRequested: false,
          phonesRequested: false,
        });
      } catch (error) {
        cases.push({ caseId: frozen.id, caseName: frozen.name, discoveryLane: frozen.lane, canonicalIdentity: identity, identityHandoff: "RESOLVED_CANONICAL_ORGANISATION_AND_DOMAIN", callStatus: "FAILED_SAFE", error: safeError(error), enrichmentAttempted: false, emailsRequested: false, phonesRequested: false });
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  return {
    acceptanceVersion: "apollo-primary-people-routing-v1",
    manifest: LIVE_MODEL_COMPARISON_CASES.map(({ id, name, lane, territory }) => ({ id, name, lane, territory })),
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
    forbiddenNetworkCalls: ["OpenAI", "Apollo enrichment/people match", "production API routes", "Supabase"],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runApolloPeopleRoutingAcceptance().then((value) => console.log(JSON.stringify(value))).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
