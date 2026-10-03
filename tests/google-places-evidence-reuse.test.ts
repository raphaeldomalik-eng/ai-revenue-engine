import assert from "node:assert/strict";
import test from "node:test";
import { getGooglePlaceDetails, resolveGooglePlacesVenueComplex, type GooglePlacesOptions } from "../src/ai-sales-team/google-places.ts";
import {
  assertGooglePlacesContinuityMask,
  classifyGooglePlacesFieldMask,
  GOOGLE_PLACES_CONTINUITY_FIELD_MASK,
  createInMemoryGooglePlacesEvidenceStore,
  GOOGLE_PLACES_ENTERPRISE_REQUEST_MASK,
  GOOGLE_PLACES_PRO_CLASSIFICATION_FIELDS,
  GOOGLE_PLACES_PRO_CLASSIFICATION_MASK,
  googlePlacesEvidenceRowId,
  mergeGooglePlacesEvidence,
  planGooglePlaceDetailsFetch,
  validateGooglePlacesEvidenceRecord,
  type GooglePlacesCallTelemetry,
  type GooglePlacesDetailsAuthorization,
} from "../src/ai-sales-team/google-places-evidence.ts";

const WEBSITE: GooglePlacesDetailsAuthorization = { purpose: "OFFICIAL_WEBSITE", venueEligible: true, eligibilityRef: "test:venue-eligible" };
import { executeResearchRequest } from "../src/nexus/executor.ts";

// Any attempt to reach real Google fails the suite.
const liveGoogleAttempts: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const target = String(url instanceof Request ? url.url : url);
  if (/(^|\/\/)(places|maps)\.googleapis\.com/i.test(target)) { liveGoogleAttempts.push(target); throw new Error("LIVE_GOOGLE_CALL_BLOCKED_IN_TESTS"); }
  return realFetch(url, init);
}) as typeof fetch;
test.after(() => { globalThis.fetch = realFetch; });

test("network guard blocks real Google hosts", async () => {
  await assert.rejects(fetch("https://places.googleapis.com/v1/places/guard-probe"), /LIVE_GOOGLE_CALL_BLOCKED_IN_TESTS/);
  await assert.rejects(fetch("https://maps.googleapis.com/maps/api/place/details/json"), /LIVE_GOOGLE_CALL_BLOCKED_IN_TESTS/);
  assert.equal(liveGoogleAttempts.length, 2);
  liveGoogleAttempts.length = 0;
});

const PLACE_DATA: Record<string, Record<string, unknown>> = {
  "venue-a": { id: "venue-a", displayName: { text: "Grand Hall" }, primaryType: "event_venue", types: ["event_venue", "point_of_interest"], formattedAddress: "1 Long St, Cape Town, South Africa", addressComponents: [{ longText: "Cape Town", types: ["locality"] }], location: { latitude: -33.92, longitude: 18.42 }, businessStatus: "OPERATIONAL", websiteUri: "https://grandhall.example", internationalPhoneNumber: "+27 21 000 0000", reviews: [{ text: "must never be stored" }], rating: 4.9 },
  "venue-b": { id: "venue-b", displayName: { text: "Grand Hall 2" }, primaryType: "event_venue", types: ["event_venue"], formattedAddress: "3 Long St, Cape Town, South Africa", businessStatus: "OPERATIONAL", websiteUri: "https://grandhall.example" },
};

type Call = { url: string; fieldMask: string };
function mockGoogle(calls: Call[]) {
  return async (url: RequestInfo | URL, init?: RequestInit) => {
    const fieldMask = new Headers(init?.headers).get("x-goog-fieldmask") ?? "";
    calls.push({ url: String(url), fieldMask });
    if (String(url).includes(":searchText")) return Response.json({ places: [PLACE_DATA["venue-a"], PLACE_DATA["venue-b"]].map((item) => ({ id: item.id, displayName: item.displayName, formattedAddress: item.formattedAddress, types: item.types, businessStatus: item.businessStatus })) });
    const id = decodeURIComponent(String(url).split("/").pop() ?? "");
    const source = PLACE_DATA[id] ?? {};
    const masked = Object.fromEntries(fieldMask.split(",").filter((field) => field in source).map((field) => [field, source[field]]));
    return Response.json(masked);
  };
}

let clock = Date.parse("2026-09-01T10:00:00.000Z");
const now = () => new Date(clock).toISOString();
const input = { targetName: "Grand Hall", targetWebsite: null, locality: "Cape Town", lane: "VENUE_FIRST" as const, targetType: "VENUE" as const, limit: 3 };
const details = (placeId: string, fields: readonly string[], options: GooglePlacesOptions) => getGooglePlaceDetails({ ...input, googlePlaceId: placeId }, { mode: "details_selected", apiKey: "test-key", now, requestedDetailsFields: fields, ...options });

test("single-pass reuse: Pro, subset, Enterprise, repeat, later Pro", async (t) => {
  const calls: Call[] = [];
  const telemetry: GooglePlacesCallTelemetry[] = [];
  const store = createInMemoryGooglePlacesEvidenceStore([], now);
  const options: GooglePlacesOptions = { fetchImpl: mockGoogle(calls), evidenceStore: store, requestingApplication: "event_suite_resources", workflow: "resources_census_hydration", onCallTelemetry: (item) => { telemetry.push(item); } };

  await t.test("1 Pro first request → 1 call", async () => {
    const run = await details("venue-a", GOOGLE_PLACES_PRO_CLASSIFICATION_FIELDS, options);
    assert.equal(calls.length, 1);
    assert.equal(run.googleCalls, 1);
    assert.equal(calls[0].fieldMask, GOOGLE_PLACES_PRO_CLASSIFICATION_MASK);
    assert.equal(telemetry.at(-1)?.billingTier, "PRO");
    assert.equal(telemetry.at(-1)?.evidenceReuse, "MISS");
    assert.equal(run.result?.displayName, "Grand Hall");
  });

  await t.test("2 identical Pro rerun → 0 calls", async () => {
    clock += 60_000;
    const run = await details("venue-a", GOOGLE_PLACES_PRO_CLASSIFICATION_FIELDS, options);
    assert.equal(calls.length, 1);
    assert.equal(run.googleCalls, 0);
    assert.equal(telemetry.at(-1)?.suppressed, true);
    assert.equal(telemetry.at(-1)?.evidenceReuse, "FULL_HIT");
    assert.equal(telemetry.at(-1)?.estimatedCostUsd, 0);
    assert.equal(run.result?.formattedAddress, "1 Long St, Cape Town, South Africa");
  });

  await t.test("3 subset Pro rerun → 0 calls", async () => {
    const run = await details("venue-a", ["id", "displayName", "types"], options);
    assert.equal(calls.length, 1);
    assert.equal(run.googleCalls, 0);
  });

  await t.test("4 Enterprise required after Pro → exactly 1 Enterprise call", async () => {
    clock += 60_000;
    const run = await details("venue-a", ["id", "displayName", "websiteUri"], { ...options, detailsAuthorization: WEBSITE });
    assert.equal(calls.length, 2);
    assert.equal(run.googleCalls, 1);
    assert.equal(telemetry.at(-1)?.billingTier, "ENTERPRISE");
    assert.equal(telemetry.at(-1)?.evidenceReuse, "PARTIAL_HIT");
    assert.equal(run.result?.websiteUri, "https://grandhall.example");
  });

  await t.test("5 Enterprise request contains the complete approved Enterprise bundle", () => {
    assert.equal(calls[1].fieldMask, GOOGLE_PLACES_ENTERPRISE_REQUEST_MASK);
    assert.equal(GOOGLE_PLACES_ENTERPRISE_REQUEST_MASK, "id,displayName,primaryType,types,formattedAddress,addressComponents,location,businessStatus,websiteUri,internationalPhoneNumber");
    assert.doesNotMatch(calls[1].fieldMask, /reviews|photos|editorialSummary|parkingOptions|liveMusic|outdoorSeating|paymentOptions|rating|userRatingCount|OpeningHours/);
  });

  await t.test("6 Enterprise rerun → 0 calls", async () => {
    clock += 60_000;
    const run = await details("venue-a", ["websiteUri", "internationalPhoneNumber"], { ...options, detailsAuthorization: WEBSITE });
    assert.equal(calls.length, 2);
    assert.equal(run.googleCalls, 0);
  });

  await t.test("7 later Pro after fresh Enterprise superset → 0 calls", async () => {
    const run = await details("venue-a", GOOGLE_PLACES_PRO_CLASSIFICATION_FIELDS, options);
    assert.equal(calls.length, 2);
    assert.equal(run.googleCalls, 0);
    assert.equal(run.result?.websiteUri, null, "a Pro view does not surface Enterprise fields");
  });

  await t.test("stale evidence beyond 30 days triggers one refresh", async () => {
    clock += 31 * 24 * 60 * 60 * 1000;
    const run = await details("venue-a", GOOGLE_PLACES_PRO_CLASSIFICATION_FIELDS, options);
    assert.equal(calls.length, 3);
    assert.equal(run.googleCalls, 1);
    clock -= 31 * 24 * 60 * 60 * 1000;
  });

  await t.test("10 one evidence record per Place ID; forbidden provider fields never persisted", async () => {
    assert.equal(store.size(), 1);
    const record = await store.get("venue-a");
    assert.ok(record);
    assert.equal(record.place.reviews, undefined);
    assert.equal(record.place.rating, undefined);
    assert.ok(record.requests.length >= 3);
    assert.equal(googlePlacesEvidenceRowId("venue-a"), googlePlacesEvidenceRowId(" venue-a "));
  });
});

test("known-empty Enterprise fields count as obtained (no repeat Enterprise call)", async () => {
  const calls: Call[] = [];
  const store = createInMemoryGooglePlacesEvidenceStore([], now);
  const options: GooglePlacesOptions = { fetchImpl: mockGoogle(calls), evidenceStore: store, detailsAuthorization: WEBSITE };
  await details("venue-b", ["id", "internationalPhoneNumber"], options);
  const second = await details("venue-b", ["id", "internationalPhoneNumber"], options);
  assert.equal(calls.length, 1);
  assert.equal(second.googleCalls, 0);
});

test("concurrent requests for one Place ID make a single call", async () => {
  const calls: Call[] = [];
  const store = createInMemoryGooglePlacesEvidenceStore([], now);
  const options: GooglePlacesOptions = { fetchImpl: mockGoogle(calls), evidenceStore: store };
  const runs = await Promise.all([1, 2, 3, 4].map(() => details("venue-a", GOOGLE_PLACES_PRO_CLASSIFICATION_FIELDS, options)));
  assert.equal(calls.length, 1);
  assert.deepEqual(runs.map((run) => run.googleCalls).sort(), [0, 0, 0, 1]);
  assert.equal(store.size(), 1);
});

test("8 known Place ID bypasses Text Search and reuses shared evidence via the Nexus contract", async () => {
  const calls: Call[] = [];
  const proRecord = mergeGooglePlacesEvidence({ record: null, providerPlaceId: "venue-a", fetchFields: GOOGLE_PLACES_PRO_CLASSIFICATION_FIELDS, response: PLACE_DATA["venue-a"], observedAt: now(), requestingApplication: "event_suite_resources", workflow: "resources_census_hydration", statusCode: 200 });
  const request = (idempotencyKey: string, evidence: unknown, researchPurpose = "OFFICIAL_WEBSITE") => ({
    contractVersion: "nexus.research-request.v1", requestId: "11111111-1111-4111-8111-111111111111", idempotencyKey, correlationId: "33333333-3333-4333-8333-333333333333", originatingProduct: "event_suite_resources",
    subject: { canonicalEntityId: "44444444-4444-4444-8444-444444444444", candidateReference: { sourceSystem: "event_suite_resources", sourceRecordId: "cand-1" }, entityType: "VENUE" }, researchPurpose, requestedFactTypes: ["placeId"], providerAllowances: ["GOOGLE_PLACES"], costCeiling: { currency: "USD", amount: 1 }, freshnessRequirements: { maxAgeHours: 720 }, existingEvidenceRefs: [],
    researchContext: { targetName: "Grand Hall", locality: "Cape Town", existingFacts: [{ fieldName: "placeId", value: "venue-a" }, { fieldName: "resourcesVenueEligibility", value: "ELIGIBLE", evidenceRef: "classification:venue-a" }], googlePlacesEvidence: evidence },
    requestedBy: { actorType: "PRODUCT", actorId: "event_suite_resources" }, createdAt: now(),
  });
  const executorOptions = {
    now,
    googlePlaces: async () => { throw new Error("TEXT_SEARCH_MUST_NOT_RUN_FOR_KNOWN_PLACE_ID"); },
    googlePlaceDetails: ((detailsInput, detailsOptions) => getGooglePlaceDetails(detailsInput, { ...detailsOptions, apiKey: "test-key", fetchImpl: mockGoogle(calls) })) as typeof getGooglePlaceDetails,
  };
  const { validateResearchRequest } = await import("../src/nexus/contracts.ts");
  const identity = validateResearchRequest(request("22222222-2222-4222-8222-222222222220", proRecord, "VENUE_IDENTITY"));
  const identityResult = await executeResearchRequest(identity, identity.researchContext, executorOptions) as Record<string, any>;
  assert.equal(calls.length, 0, "identity research reuses fresh Pro evidence and never upgrades to Enterprise");
  assert.equal(identityResult.providerUsage[0].callCount, 0);
  const first = validateResearchRequest(request("22222222-2222-4222-8222-222222222221", proRecord));
  const firstResult = await executeResearchRequest(first, first.researchContext, executorOptions) as Record<string, any>;
  assert.equal(calls.filter((call) => call.url.includes(":searchText")).length, 0);
  assert.equal(calls.length, 1, "Pro census evidence exists; exactly one Enterprise call fills the website for an eligible venue");
  assert.equal(classifyGooglePlacesFieldMask(calls[0].fieldMask).tier, "ENTERPRISE");
  assert.equal(firstResult.providerUsage[0].callCount, 1);
  const returned = validateGooglePlacesEvidenceRecord(firstResult.evidence[0].payload.googlePlacesEvidence);
  assert.equal(returned.fields.websiteUri?.tier, "ENTERPRISE");
  assert.equal(returned.place.websiteUri, "https://grandhall.example");

  const second = validateResearchRequest(request("22222222-2222-4222-8222-222222222222", returned));
  const secondResult = await executeResearchRequest(second, second.researchContext, executorOptions) as Record<string, any>;
  assert.equal(calls.length, 1, "Enterprise evidence returned to Nexus suppresses every later call");
  assert.equal(secondResult.providerUsage[0].callCount, 0);
  assert.equal(secondResult.providerUsage[0].cost, null);
  assert.ok(secondResult.facts.some((fact: { fieldName: string }) => fact.fieldName === "officialWebsite"));
});

test("9 two facility Place IDs each receive one required Details call", async () => {
  const calls: Call[] = [];
  const store = createInMemoryGooglePlacesEvidenceStore([], now);
  const venueInput = { ...input, targetWebsite: "https://grandhall.example" };
  const options: GooglePlacesOptions = { mode: "details_selected", apiKey: "test-key", now, fetchImpl: mockGoogle(calls), evidenceStore: store };
  await resolveGooglePlacesVenueComplex(venueInput, options);
  const detailCalls = () => calls.filter((call) => !call.url.includes(":searchText"));
  assert.deepEqual(detailCalls().map((call) => call.url.split("/").pop()).sort(), ["venue-a", "venue-b"]);
  await resolveGooglePlacesVenueComplex(venueInput, options);
  assert.equal(detailCalls().length, 2, "second pass reuses both facilities' evidence");
  assert.equal(store.size(), 2);
});

test("11 SKU telemetry classifies masks by the highest tier present", () => {
  assert.equal(classifyGooglePlacesFieldMask(GOOGLE_PLACES_PRO_CLASSIFICATION_MASK).tier, "PRO");
  const enterprise = classifyGooglePlacesFieldMask("id,displayName,primaryType,types,formattedAddress,addressComponents,location,businessStatus,websiteUri");
  assert.equal(enterprise.tier, "ENTERPRISE", "one Enterprise field outranks eight Pro/Essentials fields");
  assert.deepEqual(enterprise.tierDrivingFields, ["websiteUri"]);
  assert.equal(enterprise.sku, "Place Details Enterprise");
  assert.equal(classifyGooglePlacesFieldMask("id,displayName,reviews").tier, "ENTERPRISE_ATMOSPHERE");
  assert.equal(classifyGooglePlacesFieldMask("id,someFutureField").tier, "ENTERPRISE_ATMOSPHERE", "unknown fields fail high");
  assert.equal(classifyGooglePlacesFieldMask("*").tier, "ENTERPRISE_ATMOSPHERE");
  const idsOnly = classifyGooglePlacesFieldMask("id");
  assert.equal(idsOnly.tier, "ESSENTIALS");
  assert.equal(idsOnly.idsOnly, true);
  assert.equal(idsOnly.estimatedCostUsd, 0);
  assert.equal(classifyGooglePlacesFieldMask("id,formattedAddress,location").sku, "Place Details Essentials");
  assert.equal(classifyGooglePlacesFieldMask("places.id,nextPageToken", "TEXT_SEARCH").sku, "Text Search Essentials (IDs Only)");
  assert.equal(classifyGooglePlacesFieldMask("places.id,places.displayName,places.formattedAddress,places.types,places.businessStatus", "TEXT_SEARCH").tier, "PRO");
  assert.equal(classifyGooglePlacesFieldMask(GOOGLE_PLACES_PRO_CLASSIFICATION_MASK).estimatedCostUsd, 0.017);
  assert.equal(classifyGooglePlacesFieldMask(GOOGLE_PLACES_ENTERPRISE_REQUEST_MASK).estimatedCostUsd, 0.02);
  const continuity = assertGooglePlacesContinuityMask();
  assert.equal(continuity.sku, "Place Details Essentials (IDs Only)");
  assert.equal(continuity.idsOnly, true);
  assert.equal(continuity.estimatedCostUsd, 0);
  assert.equal(GOOGLE_PLACES_CONTINUITY_FIELD_MASK, "id,movedPlace,movedPlaceId");
  assert.throws(() => assertGooglePlacesContinuityMask("id,movedPlace,movedPlaceId,websiteUri"), /GOOGLE_PLACES_CONTINUITY_MASK_REFUSED/);
  assert.throws(() => planGooglePlaceDetailsFetch({ record: null, requestedFields: ["id", "movedPlace", "movedPlaceId"], now: now() }), /GOOGLE_PLACES_FIELD_NOT_APPROVED:movedPlace/);
  assert.throws(() => planGooglePlaceDetailsFetch({ record: null, requestedFields: ["id", "reviews"], now: now() }), /GOOGLE_PLACES_FIELD_NOT_APPROVED:reviews/);
  assert.throws(() => planGooglePlaceDetailsFetch({ record: null, requestedFields: ["regularOpeningHours"], now: now() }), /NOT_APPROVED/);
});

test("September incident pattern: census Pro, later Enterprise enrichment, repeat Pro", async () => {
  const ids = ["venue-a", "venue-b"];
  const pass = async (options: GooglePlacesOptions) => {
    for (const id of ids) await details(id, GOOGLE_PLACES_PRO_CLASSIFICATION_FIELDS, { ...options, workflow: "resources_census_hydration" });
    for (const id of ids) await details(id, GOOGLE_PLACES_ENTERPRISE_REQUEST_MASK.split(","), { ...options, workflow: "nexus_research:OFFICIAL_WEBSITE", detailsAuthorization: WEBSITE });
    for (const id of ids) await details(id, GOOGLE_PLACES_PRO_CLASSIFICATION_FIELDS, { ...options, workflow: "resources_census_hydration" });
  };
  const before: Call[] = [];
  await pass({ fetchImpl: mockGoogle(before), evidenceStore: null });
  const after: Call[] = [];
  const telemetry: GooglePlacesCallTelemetry[] = [];
  await pass({ fetchImpl: mockGoogle(after), evidenceStore: createInMemoryGooglePlacesEvidenceStore([], now), onCallTelemetry: (item) => { telemetry.push(item); } });
  const tiers = (calls: Call[]) => calls.map((call) => classifyGooglePlacesFieldMask(call.fieldMask).tier);
  assert.deepEqual(tiers(before), ["PRO", "PRO", "ENTERPRISE", "ENTERPRISE", "PRO", "PRO"]);
  assert.deepEqual(tiers(after), ["PRO", "PRO", "ENTERPRISE", "ENTERPRISE"]);
  assert.equal(telemetry.length, 6, "suppressed calls are still recorded");
  assert.equal(telemetry.filter((item) => item.suppressed).length, 2);
});

test("12 zero real Google calls during the suite", () => {
  assert.deepEqual(liveGoogleAttempts, []);
});
