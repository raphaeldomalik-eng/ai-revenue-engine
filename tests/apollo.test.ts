import assert from "node:assert/strict";
import test from "node:test";
import { APOLLO_PRIMARY_ROLE_FAMILIES, ApolloProviderError, apolloAuthenticationHealth, apolloUsageStats, buildApolloHeaders, enrichSelectedApolloBuyer, resolveApolloMode, searchApolloBuyers, searchEligibleApolloBuyers, searchPrimaryApolloBuyers, type ApolloBuyerSearchResult } from "../src/ai-sales-team/apollo.ts";

function response(status: number, body: unknown, headers: Record<string, string> = {}) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } }); }
function fetchMock(body: unknown, status = 200, headers: Record<string, string> = {}, seen: Request[] = []) { return async (input: RequestInfo | URL, init?: RequestInit) => { seen.push(new Request(input, init)); return response(status, body, headers); }; }
const searchInput = { organisationName: "Mash Media Group", organisationDomain: "https://mashmedia.net/", discoveryLane: "EVENT_FIRST" as const, roleFamilies: ["event leadership", "marketing or audience growth"], limit: 3 };
const acceptedPerson = { id: "apollo-person-1", name: "Alex Buyer", title: "Event Director", seniority: "director", linkedin_url: "https://www.linkedin.com/in/alex-buyer", email_status: "verified", organization: { name: "Mash Media Group", primary_domain: "mashmedia.net" } };

test("Apollo is disabled by default even when a key is supplied", async () => {
  assert.equal(resolveApolloMode(undefined), "disabled");
  let calls = 0;
  const result = await searchApolloBuyers(searchInput, { apiKey: "test-key", fetchImpl: async () => { calls += 1; return response(200, { people: [] }); } });
  assert.equal(result.mode, "disabled"); assert.equal(result.telemetry.rejectionReasons[0], "APOLLO_DISABLED"); assert.equal(calls, 0);
});

test("zero Apollo results preserve the originally sourced person signal", async () => {
  const candidate = { status: "QUALIFIED", relationship: "PROSPECT", account_id: null, candidate_name: "ABC Events", organiser_name: "ABC Events", website: "https://abc-events.example", laneContext: { person: { name: "Alex Person", role: "Event Director", organisationName: "ABC Events" } }, prospect_intelligence: { eventConnection: { state: "CONFIRMED" }, accountCreationEligible: true, primaryEntryOpportunity: "EGS", organisationResolution: { status: "RESOLVED" } } };
  const result = await searchPrimaryApolloBuyers({ candidate, identity: { accountName: "ABC Events", accountWebsite: "https://abc-events.example" }, discoveryLane: "PERSON_FIRST", mode: "search_only" }, { apiKey: "test-key", mode: "search_only", fetchImpl: fetchMock({ people: [] }) });
  assert.equal(result.blocked, false);
  if (!result.blocked) assert.equal(result.result.results.length, 0);
  assert.deepEqual(candidate.laneContext.person, { name: "Alex Person", role: "Event Director", organisationName: "ABC Events" });
});

test("Apollo classifies all four employer-domain outcomes deterministically", async () => {
  const run = async (person: Record<string, unknown>) => (await searchApolloBuyers(searchInput, { apiKey: "test-key", mode: "search_only", fetchImpl: fetchMock({ people: [person] }) })).results[0];
  const confirmed = await run(acceptedPerson);
  const queryScoped = await run({ ...acceptedPerson, organization: { name: "Mash Media Group" } });
  const missing = await run({ ...acceptedPerson, organization: null });
  const conflict = await run({ ...acceptedPerson, organization: { name: "Mash Media Group", primary_domain: "other.example" } });
  assert.equal(confirmed.employerDomainOutcome, "DOMAIN_CONFIRMED");
  assert.equal(confirmed.status, "ACCEPTED");
  assert.equal(queryScoped.employerDomainOutcome, "DOMAIN_QUERY_SCOPED");
  assert.equal(queryScoped.status, "REVIEW_REQUIRED");
  assert.equal(queryScoped.rejectionReason, "EMPLOYER_DOMAIN_QUERY_SCOPED_REQUIRES_REVIEW");
  assert.equal(missing.employerDomainOutcome, "DOMAIN_MISSING");
  assert.equal(missing.status, "REVIEW_REQUIRED");
  assert.equal(conflict.employerDomainOutcome, "DOMAIN_CONFLICT");
  assert.equal(conflict.status, "REJECTED");
  assert.equal(conflict.rejectionReason, "EMPLOYER_DOMAIN_CONFLICT");
  for (const result of [confirmed, queryScoped, missing, conflict]) {
    assert.equal(typeof result.employerDomainReason, "string");
    assert.equal(result.provenance.organisationDomain, "mashmedia.net");
  }
});

test("query-scoped employer evidence remains review-only and cannot enrich implicitly", async () => {
  let calls = 0;
  const selected = { provider: "apollo", providerPersonId: "p1", fullName: "Alex Buyer", title: "Event Director", seniority: "director", organisationName: "Mash Media Group", organisationDomain: null, linkedinUrl: null, emailAvailability: null, employerDomainOutcome: "DOMAIN_QUERY_SCOPED", employerDomainReason: "CANONICAL_DOMAIN_FILTERED_SEARCH_AND_CURRENT_EMPLOYER_NAME_MATCHED_BUT_PROVIDER_DOMAIN_WAS_OMITTED", retrievedAt: "2026-08-21T00:00:00.000Z", status: "REVIEW_REQUIRED", roleClassification: "event leadership", rejectionReason: "EMPLOYER_DOMAIN_QUERY_SCOPED_REQUIRES_REVIEW", provenance: { provider: "apollo", endpointCategory: "PEOPLE_SEARCH", sourceUrl: "https://api.apollo.io/api/v1/mixed_people/api_search", organisationDomain: "mashmedia.net", discoveryLane: "EVENT_FIRST", currentEmployerValidated: true, targetOwnershipValidated: false } } satisfies ApolloBuyerSearchResult;
  const result = await enrichSelectedApolloBuyer({ selected, identity: { accountName: "Mash Media Group", accountWebsite: "https://www.mashmedia.net" } }, { apiKey: "test-key", mode: "enrich_selected", fetchImpl: async () => { calls += 1; return response(200, {}); } });
  assert.equal(result.result, null);
  assert.equal(result.blockedReason, "DOMAIN_QUERY_SCOPED_REQUIRES_EXPLICIT_HUMAN_APPROVAL");
  assert.equal(calls, 0);
});

test("explicitly approved query-scoped candidate may request only a verified matching business email", async () => {
  const seen: Request[] = [];
  const selected = { provider: "apollo", providerPersonId: "p1", fullName: "Alex Buyer", title: "Event Director", seniority: "director", organisationName: "Mash Media Group", organisationDomain: null, linkedinUrl: null, emailAvailability: null, employerDomainOutcome: "DOMAIN_QUERY_SCOPED", employerDomainReason: "CANONICAL_DOMAIN_FILTERED_SEARCH_AND_CURRENT_EMPLOYER_NAME_MATCHED_BUT_PROVIDER_DOMAIN_WAS_OMITTED", retrievedAt: "2026-08-21T00:00:00.000Z", status: "REVIEW_REQUIRED", roleClassification: "event leadership", rejectionReason: "EMPLOYER_DOMAIN_QUERY_SCOPED_REQUIRES_REVIEW", provenance: { provider: "apollo", endpointCategory: "PEOPLE_SEARCH", sourceUrl: "https://api.apollo.io/api/v1/mixed_people/api_search", organisationDomain: "mashmedia.net", discoveryLane: "EVENT_FIRST", currentEmployerValidated: true, targetOwnershipValidated: false } } satisfies ApolloBuyerSearchResult;
  const result = await enrichSelectedApolloBuyer({ selected, explicitHumanApproval: true, identity: { accountName: "Mash Media Group", accountWebsite: "https://mashmedia.net" } }, { apiKey: "test-key", mode: "enrich_selected", fetchImpl: fetchMock({ person: { id: "p1", name: "Alex Buyer", title: "Event Director", email: "alex@mashmedia.net", email_status: "verified" } }, 200, {}, seen) });
  const body = await seen[0].clone().json() as Record<string, unknown>;
  assert.equal(result.result?.emailReady, true);
  assert.equal(body.domain, "mashmedia.net");
  assert.equal(body.reveal_personal_emails, false);
  assert.equal(body.reveal_phone_number, false);
  assert.equal(body.run_waterfall_email, false);
  assert.equal(body.run_waterfall_phone, false);
  assert.equal(seen.length, 1);
});

test("explicit approval can never override a conflicting employer domain", async () => {
  let calls = 0;
  const selected = { provider: "apollo", providerPersonId: "p1", fullName: "Alex Buyer", title: "Event Director", seniority: "director", organisationName: "Mash Media Group", organisationDomain: "other.example", linkedinUrl: null, emailAvailability: null, employerDomainOutcome: "DOMAIN_CONFLICT", employerDomainReason: "RETURNED_EMPLOYER_DOMAIN_DIFFERS_FROM_CANONICAL_DOMAIN", retrievedAt: "2026-08-21T00:00:00.000Z", status: "REJECTED", roleClassification: "event leadership", rejectionReason: "EMPLOYER_DOMAIN_CONFLICT", provenance: { provider: "apollo", endpointCategory: "PEOPLE_SEARCH", sourceUrl: "https://api.apollo.io/api/v1/mixed_people/api_search", organisationDomain: "mashmedia.net", discoveryLane: "EVENT_FIRST", currentEmployerValidated: true, targetOwnershipValidated: false } } satisfies ApolloBuyerSearchResult;
  const result = await enrichSelectedApolloBuyer({ selected, explicitHumanApproval: true, identity: { accountName: "Mash Media Group", accountWebsite: "https://mashmedia.net" } }, { apiKey: "test-key", mode: "enrich_selected", fetchImpl: async () => { calls += 1; return response(200, {}); } });
  assert.equal(result.result, null);
  assert.equal(result.blockedReason, "DOMAIN_CONFLICT_NOT_ELIGIBLE");
  assert.equal(calls, 0);
});

test("Apollo final headers retain one trimmed key and never carry Bearer authorization", async () => {
  const seen: Request[] = [];
  const configuredKey = " configured-apollo-key ";
  await apolloAuthenticationHealth({ apiKey: configuredKey, mode: "search_only", fetchImpl: fetchMock({ people: [] }, 200, {}, seen) });
  await searchApolloBuyers(searchInput, { apiKey: configuredKey, mode: "search_only", fetchImpl: fetchMock({ people: [] }, 200, {}, seen) });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].method, "GET");
  assert.equal(seen[1].method, "POST");
  for (const request of seen) {
    assert.equal(request.headers.get("x-api-key"), configuredKey.trim());
    assert.equal(request.headers.has("authorization"), false);
    assert.equal(request.headers.get("cache-control"), "no-cache");
    assert.equal(JSON.stringify(request).includes(configuredKey.trim()), false);
  }
});

test("later header merging cannot overwrite or reintroduce Apollo authorization", () => {
  const headers = buildApolloHeaders("configured-apollo-key", { "x-api-key": "wrong-key", authorization: "Bearer wrong-token", "content-type": "text/plain" });
  assert.equal(headers.get("x-api-key"), "configured-apollo-key");
  assert.equal(headers.has("authorization"), false);
  assert.equal(headers.get("content-type"), "application/json");
});

test("Apollo search is bounded, domain-filtered and has zero-credit telemetry", async () => {
  const seen: Request[] = [];
  const result = await searchApolloBuyers(searchInput, { apiKey: "test-key", mode: "search_only", fetchImpl: fetchMock({ people: [acceptedPerson] }, 200, { "x-ratelimit-remaining": "49" }, seen), now: () => "2026-08-21T00:00:00.000Z" });
  const body = await seen[0].clone().json() as Record<string, unknown>;
  assert.equal(result.results[0].status, "ACCEPTED"); assert.equal(result.telemetry.creditCategory, "ZERO_CREDIT_SEARCH"); assert.equal(result.telemetry.acceptedCount, 1); assert.equal(body.q_organization_domains_list instanceof Array && body.q_organization_domains_list[0], "mashmedia.net"); assert.equal(body.per_page, 3); assert.equal("email" in body, false); assert.equal("phone" in body, false); assert.equal(result.results[0].emailAvailability, "verified");
});

test("Apollo validates current employer domain, target ownership and role relevance", async () => {
  const people = [acceptedPerson, { ...acceptedPerson, id: "wrong-domain", organization: { name: "Other Organisation", primary_domain: "other.example" } }, { ...acceptedPerson, id: "irrelevant", title: "Accountant" }, { ...acceptedPerson, id: "missing-employer", organization: null }];
  const result = await searchApolloBuyers({ ...searchInput, limit: 10 }, { apiKey: "test-key", mode: "search_only", fetchImpl: fetchMock({ people }) });
  assert.deepEqual(result.results.map((item) => item.status), ["ACCEPTED", "REJECTED", "REVIEW_REQUIRED", "REJECTED"]);
  assert.deepEqual(result.results.map((item) => item.rejectionReason), [null, "EMPLOYER_DOMAIN_CONFLICT", "EMPLOYER_DOMAIN_MISSING", "IRRELEVANT_ROLE"]);
});

test("Apollo preserves every originating discovery lane, including Hyve organisation-first", async () => {
  for (const discoveryLane of ["EVENT_FIRST", "ORGANISATION_FIRST", "PERSON_FIRST", "VENUE_FIRST"] as const) {
    const result = await searchApolloBuyers({ ...searchInput, organisationName: discoveryLane === "ORGANISATION_FIRST" ? "Hyve Group" : searchInput.organisationName, organisationDomain: discoveryLane === "ORGANISATION_FIRST" ? "hyve.group" : searchInput.organisationDomain, discoveryLane, roleFamilies: [...APOLLO_PRIMARY_ROLE_FAMILIES], limit: 5 }, { apiKey: "test-key", mode: "search_only", fetchImpl: fetchMock({ people: [{ ...acceptedPerson, organization: { name: discoveryLane === "ORGANISATION_FIRST" ? "Hyve Group" : searchInput.organisationName, primary_domain: discoveryLane === "ORGANISATION_FIRST" ? "hyve.group" : "mashmedia.net" } }] }) });
    assert.equal(result.results[0].provenance.discoveryLane, discoveryLane);
  }
});

test("Apollo accepts only the explicit CTICC operational-employer alias for Convenco", async () => {
  const run = async (peopleSearchOrganisation?: Record<string, unknown>) => (await searchApolloBuyers({ organisationName: "Convenco", organisationDomain: "https://www.cticc.co.za", peopleSearchOrganisation: peopleSearchOrganisation as never, discoveryLane: "VENUE_FIRST", roleFamilies: [...APOLLO_PRIMARY_ROLE_FAMILIES], limit: 5 }, { apiKey: "test-key", mode: "search_only", fetchImpl: fetchMock({ people: [{ id: "cticc-person", name: "Venue Operator", title: "Operations Manager", organization: { name: "Cape Town International Convention Centre" } }] }) })).results[0];
  const alias = { name: "Cape Town International Convention Centre", canonicalOrganisationName: "Convenco", relationship: "EXPLICIT_IDENTITY_EVIDENCE", evidenceUrls: ["https://www.cticc.co.za/about-cticc/history-and-ownership/"] };
  const accepted = await run(alias);
  const arbitrary = await run({ ...alias, name: "Unrelated Venue Holdings" });
  assert.equal(accepted.employerDomainOutcome, "DOMAIN_QUERY_SCOPED");
  assert.equal(accepted.status, "REVIEW_REQUIRED");
  assert.equal(accepted.employerDomainReason, "CANONICAL_DOMAIN_FILTERED_SEARCH_AND_EXPLICIT_OPERATIONAL_EMPLOYER_NAME_MATCHED_BUT_PROVIDER_DOMAIN_WAS_OMITTED");
  assert.equal(arbitrary.employerDomainOutcome, "DOMAIN_MISSING");
  assert.equal(arbitrary.status, "REVIEW_REQUIRED");
});

test("explicit CTICC operational-employer alias never permits implicit enrichment", async () => {
  let calls = 0;
  const selected = (await searchApolloBuyers({ organisationName: "Convenco", organisationDomain: "https://www.cticc.co.za", peopleSearchOrganisation: { name: "Cape Town International Convention Centre", canonicalOrganisationName: "Convenco", relationship: "EXPLICIT_IDENTITY_EVIDENCE", evidenceUrls: ["https://www.cticc.co.za/about-cticc/history-and-ownership/"] }, discoveryLane: "VENUE_FIRST", roleFamilies: [...APOLLO_PRIMARY_ROLE_FAMILIES], limit: 1 }, { apiKey: "test-key", mode: "search_only", fetchImpl: fetchMock({ people: [{ id: "cticc-person", name: "Venue Operator", title: "Operations Manager", organization: { name: "Cape Town International Convention Centre" } }] }) })).results[0];
  const result = await enrichSelectedApolloBuyer({ selected, identity: { accountName: "Convenco", accountWebsite: "https://www.cticc.co.za" } }, { apiKey: "test-key", mode: "enrich_selected", fetchImpl: async () => { calls += 1; return response(200, {}); } });
  assert.equal(selected.employerDomainOutcome, "DOMAIN_QUERY_SCOPED");
  assert.equal(result.blockedReason, "DOMAIN_QUERY_SCOPED_REQUIRES_EXPLICIT_HUMAN_APPROVAL");
  assert.equal(calls, 0);
});

test("explicit CTICC alias cannot override a conflicting employer domain", async () => {
  const result = await searchApolloBuyers({ organisationName: "Convenco", organisationDomain: "https://www.cticc.co.za", peopleSearchOrganisation: { name: "Cape Town International Convention Centre", canonicalOrganisationName: "Convenco", relationship: "EXPLICIT_IDENTITY_EVIDENCE", evidenceUrls: ["https://www.cticc.co.za/about-cticc/history-and-ownership/"] }, discoveryLane: "VENUE_FIRST", roleFamilies: [...APOLLO_PRIMARY_ROLE_FAMILIES], limit: 1 }, { apiKey: "test-key", mode: "search_only", fetchImpl: fetchMock({ people: [{ id: "cticc-conflict", name: "Venue Operator", title: "Operations Manager", organization: { name: "Cape Town International Convention Centre", primary_domain: "other.example" } }] }) });
  assert.equal(result.results[0].employerDomainOutcome, "DOMAIN_CONFLICT");
  assert.equal(result.results[0].status, "REJECTED");
});

test("Apollo primary people search ranks bounded role families and never opens a web-contact path", async () => {
  const candidate = { status: "QUALIFIED", relationship: "PROSPECT", account_id: null, candidate_name: "Hyve Group", organiser_name: "Hyve Group", website: "https://hyve.group", prospect_intelligence: { eventConnection: { state: "CONFIRMED" }, accountCreationEligible: true, primaryEntryOpportunity: "EGS", organisationResolution: { status: "RESOLVED" } } };
  const result = await searchPrimaryApolloBuyers({ candidate, identity: { accountName: "Hyve Group", accountWebsite: "https://hyve.group" }, discoveryLane: "ORGANISATION_FIRST", mode: "search_only" }, { apiKey: "test-key", mode: "search_only", fetchImpl: fetchMock({ people: [
    { ...acceptedPerson, id: "hyve-low", title: "Project Manager", organization: { name: "Hyve Group", primary_domain: "hyve.group" } },
    { ...acceptedPerson, id: "hyve-high", title: "Managing Director", organization: { name: "Hyve Group", primary_domain: "hyve.group" } },
    { ...acceptedPerson, id: "hyve-irrelevant", title: "Accountant", organization: { name: "Hyve Group", primary_domain: "hyve.group" } },
  ] }) });
  assert.equal(result.blocked, false);
  if (!result.blocked) {
    assert.equal(result.result.results.length, 3);
    assert.equal(result.result.results[0].title, "Managing Director");
    assert.equal(result.result.results[0].buyerRoutingClassification, "LIKELY_BUYER");
    assert.equal(result.result.results[1].buyerRoutingClassification, "INFLUENCER_OR_ROUTE_TO_BUYER");
    assert.equal(result.result.results[2].buyerRoutingClassification, "IRRELEVANT");
  }
});

test("Apollo primary people search blocks unresolved canonical identity before provider access", async () => {
  let calls = 0;
  const result = await searchPrimaryApolloBuyers({ candidate: { status: "QUALIFIED", relationship: "PROSPECT", account_id: null, prospect_intelligence: { eventConnection: { state: "CONFIRMED" }, accountCreationEligible: true, primaryEntryOpportunity: "EGS", organisationResolution: { status: "RESOLVED" } } }, identity: { accountName: "Unresolved Organisation", accountWebsite: null }, discoveryLane: "EVENT_FIRST", mode: "search_only" }, { apiKey: "test-key", mode: "search_only", fetchImpl: async () => { calls += 1; return response(200, { people: [] }); } });
  assert.deepEqual(result, { blocked: true, reason: "CANONICAL_ORGANISATION_DOMAIN_REQUIRED", result: null });
  assert.equal(calls, 0);
});

test("confirmed venue identity may run one official-domain search without implicit enrichment", async () => {
  const seen: Request[] = [];
  const result = await searchApolloBuyers({ organisationName: "The Piece Hall", organisationDomain: "https://piecehall.co.uk", discoveryLane: "VENUE_FIRST", roleFamilies: [...APOLLO_PRIMARY_ROLE_FAMILIES], limit: 5 }, { apiKey: "test-key", mode: "search_only", fetchImpl: fetchMock({ people: [] }, 200, {}, seen) });
  assert.equal(seen.length, 1);
  const body = await seen[0].clone().json() as Record<string, unknown>;
  assert.deepEqual(body.q_organization_domains_list, ["piecehall.co.uk"]);
  assert.equal(body.email, undefined);
  assert.equal(body.phone, undefined);
});

test("missing key, authentication failure, rate limiting, provider error and malformed response are safe", async () => {
  await assert.rejects(() => searchApolloBuyers(searchInput, { mode: "search_only", fetchImpl: fetchMock({ people: [] }) }), (error: unknown) => error instanceof ApolloProviderError && error.telemetry.rejectionReasons[0] === "MISSING_API_KEY");
  await assert.rejects(() => apolloAuthenticationHealth({ apiKey: "test-key", mode: "search_only", fetchImpl: fetchMock({ error: "unauthorized" }, 401) }), (error: unknown) => error instanceof ApolloProviderError && error.telemetry.rejectionReasons[0] === "AUTHENTICATION_FAILED");
  let calls = 0;
  await assert.rejects(() => searchApolloBuyers(searchInput, { apiKey: "test-key", mode: "search_only", fetchImpl: async () => { calls += 1; return response(429, { error: "rate limited" }, { "retry-after": "60" }); } }), (error: unknown) => error instanceof ApolloProviderError && error.telemetry.rejectionReasons[0] === "RATE_LIMITED" && error.telemetry.rateLimit.retryAfter === "60");
  assert.equal(calls, 1);
  await assert.rejects(() => searchApolloBuyers(searchInput, { apiKey: "test-key", mode: "search_only", fetchImpl: fetchMock({ error: "server" }, 500) }), (error: unknown) => error instanceof ApolloProviderError && error.telemetry.rejectionReasons[0] === "PROVIDER_ERROR");
  await assert.rejects(() => searchApolloBuyers(searchInput, { apiKey: "test-key", mode: "search_only", fetchImpl: async () => new Response("not-json", { status: 200 }) }), (error: unknown) => error instanceof ApolloProviderError && error.message.includes("malformed JSON"));
});

test("usage stats is explicitly zero-credit and never exposes response data", async () => {
  const result = await apolloUsageStats({ apiKey: "test-key", mode: "search_only", fetchImpl: fetchMock({ credits_used: 999, secret: "should-not-return" }) });
  assert.equal(result.available, true); assert.equal(result.telemetry.creditCategory, "ZERO_CREDIT_USAGE_STATS"); assert.equal("secret" in result, false);
});

test("Apollo enrichment is blocked outside explicit enrich_selected mode", async () => {
  const selected = { provider: "apollo", providerPersonId: "p1", fullName: "Alex Buyer", title: "Event Director", seniority: "director", organisationName: "Mash Media Group", organisationDomain: "mashmedia.net", linkedinUrl: null, emailAvailability: "verified", employerDomainOutcome: "DOMAIN_CONFIRMED", employerDomainReason: "RETURNED_EMPLOYER_DOMAIN_MATCHES_CANONICAL_DOMAIN", retrievedAt: "2026-08-21T00:00:00.000Z", status: "ACCEPTED", roleClassification: "event leadership", rejectionReason: null, provenance: { provider: "apollo", endpointCategory: "PEOPLE_SEARCH", sourceUrl: "https://api.apollo.io/api/v1/mixed_people/api_search", organisationDomain: "mashmedia.net", discoveryLane: "EVENT_FIRST", currentEmployerValidated: true, targetOwnershipValidated: true } } satisfies ApolloBuyerSearchResult;
  const result = await enrichSelectedApolloBuyer({ selected, identity: { accountName: "Mash Media Group", accountWebsite: "https://mashmedia.net" } }, { apiKey: "test-key", mode: "search_only", fetchImpl: fetchMock({}) });
  assert.equal(result.result, null); assert.equal(result.telemetry.rejectionReasons[0], "ENRICHMENT_MODE_NOT_SELECTED");
});

test("selected Apollo enrichment sends all no-personal/no-phone/no-waterfall flags and accepts only verified target business email", async () => {
  const seen: Request[] = [];
  const selected = { provider: "apollo", providerPersonId: "p1", fullName: "Alex Buyer", title: "Event Director", seniority: "director", organisationName: "Mash Media Group", organisationDomain: "mashmedia.net", linkedinUrl: null, emailAvailability: "verified", employerDomainOutcome: "DOMAIN_CONFIRMED", employerDomainReason: "RETURNED_EMPLOYER_DOMAIN_MATCHES_CANONICAL_DOMAIN", retrievedAt: "2026-08-21T00:00:00.000Z", status: "ACCEPTED", roleClassification: "event leadership", rejectionReason: null, provenance: { provider: "apollo", endpointCategory: "PEOPLE_SEARCH", sourceUrl: "https://api.apollo.io/api/v1/mixed_people/api_search", organisationDomain: "mashmedia.net", discoveryLane: "EVENT_FIRST", currentEmployerValidated: true, targetOwnershipValidated: true } } satisfies ApolloBuyerSearchResult;
  const result = await enrichSelectedApolloBuyer({ selected, identity: { accountName: "Mash Media Group", accountWebsite: "https://mashmedia.net" } }, { apiKey: "test-key", mode: "enrich_selected", fetchImpl: fetchMock({ person: { id: "p1", name: "Alex Buyer", title: "Event Director", email: "alex@mashmedia.net", email_status: "verified" } }, 200, {}, seen) });
  const body = await seen[0].clone().json() as Record<string, unknown>;
  assert.equal(result.result?.emailReady, true); assert.equal(body.reveal_personal_emails, false); assert.equal(body.reveal_phone_number, false); assert.equal(body.run_waterfall_email, false); assert.equal(body.run_waterfall_phone, false); assert.equal(result.telemetry.creditCategory, "POTENTIALLY_CHARGEABLE_ENRICHMENT");
});

test("personal, mismatched-domain and unverified Apollo email results are rejected without retries", async () => {
  const selected = { provider: "apollo", providerPersonId: "p1", fullName: "Alex Buyer", title: "Event Director", seniority: "director", organisationName: "Mash Media Group", organisationDomain: "mashmedia.net", linkedinUrl: null, emailAvailability: "verified", employerDomainOutcome: "DOMAIN_CONFIRMED", employerDomainReason: "RETURNED_EMPLOYER_DOMAIN_MATCHES_CANONICAL_DOMAIN", retrievedAt: "2026-08-21T00:00:00.000Z", status: "ACCEPTED", roleClassification: "event leadership", rejectionReason: null, provenance: { provider: "apollo", endpointCategory: "PEOPLE_SEARCH", sourceUrl: "https://api.apollo.io/api/v1/mixed_people/api_search", organisationDomain: "mashmedia.net", discoveryLane: "EVENT_FIRST", currentEmployerValidated: true, targetOwnershipValidated: true } } satisfies ApolloBuyerSearchResult;
  for (const person of [{ email: "alex@gmail.com", email_status: "verified" }, { email: "alex@mashmedia.net", email_status: "unverified" }]) {
    const result = await enrichSelectedApolloBuyer({ selected, identity: { accountName: "Mash Media Group", accountWebsite: "https://mashmedia.net" } }, { apiKey: "test-key", mode: "enrich_selected", fetchImpl: fetchMock({ person }) });
    assert.equal(result.result, null); assert.ok(result.blockedReason === "EMAIL_DOMAIN_MISMATCH" || result.blockedReason === "UNACCEPTABLE_EMAIL_STATUS");
  }
});

test("Apollo buyer search is downstream-gated by existing contact eligibility", async () => {
  let calls = 0;
  const result = await searchEligibleApolloBuyers({ candidate: { status: "REVIEW_REQUIRED", relationship: "PROSPECT", account_id: null, candidate_name: "Mash Media Group", website: "https://mashmedia.net", prospect_intelligence: { eventConnection: { state: "NONE" }, accountCreationEligible: false, primaryEntryOpportunity: "UNKNOWN", organisationResolution: { status: "RESOLVED" } } }, identity: { accountName: "Mash Media Group", accountWebsite: "https://mashmedia.net" }, ...searchInput, mode: "search_only" }, { apiKey: "test-key", mode: "search_only", fetchImpl: async () => { calls += 1; return response(200, { people: [] }); } });
  assert.equal(result.blocked, true); assert.equal(calls, 0);
});
