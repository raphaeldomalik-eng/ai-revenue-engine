import assert from "node:assert/strict";
import test from "node:test";
import { enrichDiscoveryCandidatesWithGooglePlaces, evaluateDiscoveryCandidate } from "../src/ai-sales-team/discovery.ts";
import { GOOGLE_PLACES_DETAILS_FIELD_MASK, GOOGLE_PLACES_TEXT_SEARCH_FIELD_MASK, GooglePlacesProviderError, getGooglePlaceDetails, searchGooglePlaces } from "../src/ai-sales-team/google-places.ts";

const searchInput = { targetName: "CTICC", targetWebsite: "https://www.cticc.co.za", locality: "Cape Town", lane: "VENUE_FIRST" as const, targetType: "VENUE" as const, limit: 3 };
const organisationInput = { targetName: "Hyve Group", targetWebsite: null, locality: "London", lane: "ORGANISATION_FIRST" as const, targetType: "ORGANISATION" as const, limit: 3 };
const place = (overrides: Record<string, unknown> = {}) => ({ id: "place-1", displayName: { text: "CTICC" }, formattedAddress: "Convention Square, Cape Town", types: ["convention_center"], websiteUri: "https://www.cticc.co.za", businessStatus: "OPERATIONAL", ...overrides });
const response = (payload: unknown, status = 200) => new Response(typeof payload === "string" ? payload : JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
const fetchMock = (payload: unknown, status = 200, calls: Array<{ url: string; init?: RequestInit }> = []) => async (url: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(url), init }); return response(payload, status); };
const candidate = (overrides: Record<string, unknown> = {}) => evaluateDiscoveryCandidate({ canonicalName: "CTICC", organiserName: null, website: null, origin: "VENUE_FIRST", relationshipHint: "PROSPECT", laneContext: { organisation: null, person: null, venue: { name: "CTICC", website: null, operatorName: "Convenco", operatorWebsite: null } }, facts: [{ claim: "CTICC hosts an annual conference and exhibition programme.", sourceUrl: "https://cticc.co.za/events", sourceTitle: "Venue events", kind: "FACT", confidence: "HIGH" }], inferences: [], unknowns: [], ...overrides }, "ZA");

test("Google Places is disabled by default and does not fetch", async () => {
  let calls = 0;
  const result = await searchGooglePlaces(searchInput, { mode: "disabled", apiKey: "test-key", fetchImpl: async () => { calls += 1; return response({ places: [] }); } });
  assert.equal(calls, 0);
  assert.equal(result.results.length, 0);
  assert.equal(result.telemetry.errorCategory, "MODE_NOT_ALLOWED");
});

test("enabled Google Places without a key fails safely", async () => {
  await assert.rejects(() => searchGooglePlaces(searchInput, { mode: "search_only", apiKey: "" }), (error: unknown) => error instanceof GooglePlacesProviderError && error.telemetry.errorCategory === "MISSING_API_KEY");
});

test("Text Search uses the New endpoint, API-key header and JSON content type", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  await searchGooglePlaces(searchInput, { mode: "search_only", apiKey: "test-key", fetchImpl: fetchMock({ places: [place()] }, 200, calls) });
  assert.equal(calls[0].url, "https://places.googleapis.com/v1/places:searchText");
  const headers = new Headers(calls[0].init?.headers);
  assert.equal(headers.get("x-goog-api-key"), "test-key");
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("x-goog-fieldmask"), GOOGLE_PLACES_TEXT_SEARCH_FIELD_MASK);
  assert.equal(calls[0].init?.method, "POST");
});

test("Place Details uses the selected-place endpoint and details field mask", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const result = await getGooglePlaceDetails({ ...searchInput, googlePlaceId: "place-1" }, { mode: "details_selected", apiKey: "test-key", fetchImpl: fetchMock(place(), 200, calls) });
  assert.equal(calls[0].url, "https://places.googleapis.com/v1/places/place-1");
  assert.equal(calls[0].init?.method, "GET");
  const headers = new Headers(calls[0].init?.headers);
  assert.equal(headers.get("x-goog-api-key"), "test-key");
  assert.equal(headers.get("x-goog-fieldmask"), GOOGLE_PLACES_DETAILS_FIELD_MASK);
  assert.equal(result.result?.provider, "GOOGLE_PLACES");
});

test("field masks remain the exact minimal contract", () => {
  assert.equal(GOOGLE_PLACES_TEXT_SEARCH_FIELD_MASK, "places.id,places.displayName,places.formattedAddress,places.types,places.websiteUri,places.businessStatus");
  assert.equal(GOOGLE_PLACES_DETAILS_FIELD_MASK, "id,displayName,formattedAddress,types,websiteUri,businessStatus");
  assert.doesNotMatch(GOOGLE_PLACES_TEXT_SEARCH_FIELD_MASK, /phone|review|photo|rating|opening|editorial|location|accessibility/i);
  assert.doesNotMatch(GOOGLE_PLACES_DETAILS_FIELD_MASK, /phone|review|photo|rating|opening|editorial|location|accessibility/i);
});

test("the API key is neither returned nor present in normalized telemetry", async () => {
  const result = await searchGooglePlaces(searchInput, { mode: "search_only", apiKey: "test-key", fetchImpl: fetchMock({ places: [place()] }) });
  assert.equal(JSON.stringify(result).includes("test-key"), false);
  assert.equal(JSON.stringify(result).includes("x-goog-api-key"), false);
});

test("website-domain alignment is strong identity evidence", async () => {
  const result = await searchGooglePlaces(searchInput, { mode: "search_only", apiKey: "test-key", fetchImpl: fetchMock({ places: [place({ websiteUri: "https://cticc.co.za/" })] }) });
  assert.equal(result.telemetry.matchStatus, "EXACT_OR_STRONG");
  assert.equal(result.results[0].identityConfidence, "HIGH");
  assert.equal(result.results[0].websiteDomain, "cticc.co.za");
});

test("name and locality alignment can produce a strong match without a target website", async () => {
  const result = await searchGooglePlaces({ ...organisationInput, targetName: "Convenco" }, { mode: "search_only", apiKey: "test-key", fetchImpl: fetchMock({ places: [place({ id: "place-2", displayName: { text: "Convenco Events" }, formattedAddress: "12 London Road, London", websiteUri: null, types: ["establishment"] })] }) });
  assert.equal(result.telemetry.matchStatus, "EXACT_OR_STRONG");
  assert.equal(result.results[0].rejectionReasons.includes("WEBSITE_DOMAIN_CONFLICT"), false);
});

test("multiple plausible places remain review-required", async () => {
  const result = await searchGooglePlaces({ ...searchInput, targetWebsite: null }, { mode: "search_only", apiKey: "test-key", fetchImpl: fetchMock({ places: [place({ id: "place-1" }), place({ id: "place-2", websiteUri: "https://other.example" })] }) });
  assert.equal(result.telemetry.matchStatus, "REVIEW_REQUIRED");
  assert.equal(result.results.every((item) => item.matchStatus === "REVIEW_REQUIRED"), true);
  assert.equal(result.results.every((item) => item.rejectionReasons.includes("MULTIPLE_PLAUSIBLE_MATCHES")), true);
});

test("conflicting website domains are rejected", async () => {
  const result = await searchGooglePlaces(searchInput, { mode: "search_only", apiKey: "test-key", fetchImpl: fetchMock({ places: [place({ websiteUri: "https://unrelated.example" })] }) });
  assert.equal(result.telemetry.matchStatus, "CONFLICTING");
  assert.equal(result.results[0].matchStatus, "CONFLICTING");
  assert.equal(result.results[0].rejectionReasons.includes("WEBSITE_DOMAIN_CONFLICT"), true);
});

test("permanently closed places remain counter-evidence and require review", async () => {
  const result = await searchGooglePlaces(searchInput, { mode: "search_only", apiKey: "test-key", fetchImpl: fetchMock({ places: [place({ businessStatus: "CLOSED_PERMANENTLY" })] }) });
  assert.equal(result.telemetry.matchStatus, "REVIEW_REQUIRED");
  assert.equal(result.results[0].matchStatus, "REVIEW_REQUIRED");
  assert.equal(result.results[0].rejectionReasons.includes("CLOSED_PLACE_COUNTER_EVIDENCE"), true);
});

test("Venue-first Places evidence does not promote the venue into an organiser", async () => {
  const result = await enrichDiscoveryCandidatesWithGooglePlaces([candidate()], "ZA", { mode: "search_only", apiKey: "test-key", fetchImpl: fetchMock({ places: [place({ displayName: { text: "Cape Town International Convention Centre" } })] }) });
  const enriched = result.candidates[0];
  assert.equal(enriched.origin, "VENUE_FIRST");
  assert.equal(enriched.canonicalName, "CTICC");
  assert.equal(enriched.organiserName, null);
  assert.equal(enriched.prospectIntelligence.accountCreationEligible, false);
  assert.equal(enriched.facts.some((item) => item.sourceTitle === "Google Places (New)"), true);
  assert.equal(result.telemetry.attemptedCount, 1);
});

test("Organisation-first Places evidence can fill a missing official website without changing the lane", async () => {
  const initial = evaluateDiscoveryCandidate({ canonicalName: "Hyve Group", organiserName: "Hyve Group", website: null, origin: "ORGANISATION_FIRST", relationshipHint: "PROSPECT", laneContext: { organisation: { name: "Hyve Group", website: null }, person: null, venue: null }, facts: [{ claim: "Hyve Group operates an annual portfolio of public events.", sourceUrl: "https://hyve.group/events", sourceTitle: "Portfolio", kind: "FACT", confidence: "HIGH" }], inferences: [], unknowns: [] }, "GB");
  const result = await enrichDiscoveryCandidatesWithGooglePlaces([initial], "GB", { mode: "search_only", apiKey: "test-key", fetchImpl: fetchMock({ places: [place({ displayName: { text: "Hyve Group" }, formattedAddress: "London, United Kingdom", types: ["corporate_office"], websiteUri: "https://hyve.group" })] }) });
  const enriched = result.candidates[0];
  assert.equal(enriched.origin, "ORGANISATION_FIRST");
  assert.equal(enriched.website, "https://hyve.group");
  assert.equal(enriched.laneContext?.organisation?.website, "https://hyve.group");
});

test("an organisation with no Places result is not penalized", async () => {
  const initial = evaluateDiscoveryCandidate({ canonicalName: "Unlisted Organiser", organiserName: "Unlisted Organiser", website: "https://unlisted.example", origin: "ORGANISATION_FIRST", relationshipHint: "PROSPECT", laneContext: { organisation: { name: "Unlisted Organiser", website: "https://unlisted.example" }, person: null, venue: null }, facts: [{ claim: "Unlisted Organiser operates an annual portfolio of public events.", sourceUrl: "https://unlisted.example/events", sourceTitle: "Portfolio", kind: "FACT", confidence: "HIGH" }], inferences: [], unknowns: [] }, "GB");
  const result = await enrichDiscoveryCandidatesWithGooglePlaces([initial], "GB", { mode: "search_only", apiKey: "test-key", fetchImpl: fetchMock({ places: [] }) });
  assert.equal(result.candidates[0].prospectIntelligence.accountCreationEligible, initial.prospectIntelligence.accountCreationEligible);
  assert.equal(result.candidates[0].facts.length, initial.facts.length);
  assert.equal(result.telemetry.telemetry[0].matchStatus, "NO_MATCH");
});

test("provider errors are classified safely without exposing response bodies", async () => {
  await assert.rejects(() => searchGooglePlaces(searchInput, { mode: "search_only", apiKey: "test-key", fetchImpl: fetchMock({ error: "server-secret" }, 500) }), (error: unknown) => error instanceof GooglePlacesProviderError && error.telemetry.errorCategory === "HTTP_ERROR");
  await assert.rejects(() => searchGooglePlaces(searchInput, { mode: "search_only", apiKey: "test-key", fetchImpl: fetchMock({ error: "rate-secret" }, 429) }), (error: unknown) => error instanceof GooglePlacesProviderError && error.telemetry.errorCategory === "RATE_LIMITED");
  await assert.rejects(() => searchGooglePlaces(searchInput, { mode: "search_only", apiKey: "test-key", fetchImpl: fetchMock("not-json") }), (error: unknown) => error instanceof GooglePlacesProviderError && error.telemetry.errorCategory === "MALFORMED_RESPONSE");
});

test("timeouts are safe and do not retry", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; const error = new Error("timeout"); error.name = "AbortError"; throw error; };
  await assert.rejects(() => searchGooglePlaces(searchInput, { mode: "search_only", apiKey: "test-key", fetchImpl, timeoutMs: 1 }), (error: unknown) => error instanceof GooglePlacesProviderError && error.telemetry.errorCategory === "TIMEOUT" && error.telemetry.retryCount === 0);
  assert.equal(calls, 1);
});

test("details mode is explicit and never invokes Apollo, persistence or outreach", async () => {
  const calls: string[] = [];
  const result = await getGooglePlaceDetails({ ...searchInput, googlePlaceId: "place-1" }, { mode: "details_selected", apiKey: "test-key", fetchImpl: async (url) => { calls.push(String(url)); return response(place()); } });
  assert.deepEqual(calls, ["https://places.googleapis.com/v1/places/place-1"]);
  assert.equal(result.telemetry.endpointCategory, "PLACE_DETAILS");
  assert.equal(calls.some((url) => /apollo|supabase|outreach|people\/match/i.test(url)), false);
});
