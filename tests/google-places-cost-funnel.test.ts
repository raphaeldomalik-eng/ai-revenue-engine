import assert from "node:assert/strict";
import test from "node:test";
import { getGooglePlaceDetails, GooglePlacesProviderError } from "../src/ai-sales-team/google-places.ts";
import {
  classifyGooglePlacesFieldMask,
  GOOGLE_PLACES_ENTERPRISE_REQUEST_MASK,
  GOOGLE_PLACES_PRO_CLASSIFICATION_MASK,
  resolveGooglePlaceDetailsWithEvidence,
  validateGooglePlacesEvidenceRecord,
  type GooglePlacesDetailsAuthorization,
  type GooglePlacesEvidenceRecordV1,
} from "../src/ai-sales-team/google-places-evidence.ts";
import { CONTRACTS, validateResearchRequest } from "../src/nexus/contracts.ts";
import { executeResearchRequest } from "../src/nexus/executor.ts";
import { createPublicWebProvider } from "../src/nexus/public-web.ts";

const liveGoogleAttempts: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const target = String(url instanceof Request ? url.url : url);
  if (/(^|\/\/)(places|maps)\.googleapis\.com/i.test(target)) { liveGoogleAttempts.push(target); throw new Error("LIVE_GOOGLE_CALL_BLOCKED_IN_TESTS"); }
  return realFetch(url, init);
}) as typeof fetch;
test.after(() => { globalThis.fetch = realFetch; });

const NOW = "2026-09-30T08:00:00.000Z";
const PLACES: Record<string, Record<string, unknown>> = {
  "hall-web": { id: "hall-web", displayName: { text: "Grand Hall" }, primaryType: "event_venue", types: ["event_venue"], formattedAddress: "1 Long St, Cape Town", location: { latitude: -33.9, longitude: 18.4 }, businessStatus: "OPERATIONAL", websiteUri: "https://grandhall.example/", internationalPhoneNumber: "+27 21 000 0000", rating: 4.9, reviews: [{ text: "never" }] },
  "hall-noweb": { id: "hall-noweb", displayName: { text: "Quiet Hall" }, primaryType: "event_venue", types: ["event_venue"], formattedAddress: "2 Long St, Cape Town", businessStatus: "OPERATIONAL" },
};

type Call = { placeId: string; mask: string };
function mockGoogle() {
  const calls: Call[] = [];
  const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
    const mask = new Headers(init?.headers).get("x-goog-fieldmask") ?? "";
    const placeId = decodeURIComponent(String(url).split("/").pop() ?? "");
    calls.push({ placeId, mask });
    const source = PLACES[placeId] ?? {};
    return Response.json(Object.fromEntries(mask.split(",").filter((field) => field in source).map((field) => [field, source[field]])));
  };
  return { calls, fetchImpl };
}

const crawled: string[] = [];
const page = '<html><head><title>Grand Hall</title></head><body><h1>Grand Hall</h1><address>1 Long St, Cape Town</address></body></html>';
const crawlFetch = async (input: RequestInfo | URL) => {
  crawled.push(String(input));
  return String(input).endsWith("/robots.txt") ? new Response("User-agent: *\nAllow: /") : new Response(page, { headers: { "content-type": "text/html" } });
};

const ELIGIBLE = { fieldName: "resourcesVenueEligibility", value: "ELIGIBLE", evidenceRef: "classification:confirmed-venue" };
const CANONICAL = "44444444-4444-4444-8444-444444444444";

function research(input: { placeId: string; name?: string; purpose?: string; entityType?: "VENUE" | "UNKNOWN"; canonicalEntityId?: string | null; facts?: Array<Record<string, unknown>>; website?: string; evidence?: GooglePlacesEvidenceRecordV1 | null }) {
  return validateResearchRequest({
    contractVersion: CONTRACTS.RESEARCH_REQUEST,
    requestId: "11111111-1111-4111-8111-111111111111",
    idempotencyKey: "22222222-2222-4222-8222-222222222222",
    correlationId: "33333333-3333-4333-8333-333333333333",
    originatingProduct: "event_suite_resources",
    subject: { canonicalEntityId: input.canonicalEntityId === undefined ? CANONICAL : input.canonicalEntityId, candidateReference: { sourceSystem: "event_suite_resources", sourceRecordId: input.placeId }, entityType: input.entityType ?? "VENUE" },
    researchPurpose: input.purpose ?? "OFFICIAL_WEBSITE",
    requestedFactTypes: ["officialWebsite"],
    providerAllowances: ["PUBLIC_WEB"],
    costCeiling: { currency: "USD", amount: 0 },
    freshnessRequirements: { maxAgeHours: 720 },
    existingEvidenceRefs: [],
    researchContext: {
      targetName: input.name ?? "Grand Hall",
      locality: "Cape Town",
      ...(input.website ? { targetWebsite: input.website } : {}),
      existingFacts: [{ fieldName: "placeId", value: input.placeId, evidenceRef: `place:${input.placeId}` }, ...(input.facts ?? [])],
      ...(input.evidence ? { googlePlacesEvidence: input.evidence } : {}),
    },
    requestedBy: { actorType: "PRODUCT", actorId: "event_suite_resources" },
    createdAt: NOW,
  });
}

async function run(google: ReturnType<typeof mockGoogle>, request: ReturnType<typeof research>) {
  const provider = createPublicWebProvider({
    fetchImpl: crawlFetch,
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    now: () => NOW,
    placeDetails: (input, options) => getGooglePlaceDetails(input, { ...options, apiKey: "test-key", now: () => NOW, fetchImpl: google.fetchImpl }),
  });
  const result = await executeResearchRequest(request, request.researchContext, { now: () => NOW, publicWeb: provider }) as Record<string, any>;
  const returned = result.evidence.find((item: any) => item.payload?.googlePlacesEvidence)?.payload.googlePlacesEvidence;
  return { result, evidence: returned ? validateGooglePlacesEvidenceRecord(returned) : null };
}

const tiers = (calls: Call[]) => calls.map((call) => classifyGooglePlacesFieldMask(call.mask).tier);

test("1 unclassified Place ID → at most one Pro call, never Enterprise", async () => {
  const google = mockGoogle();
  const first = await run(google, research({ placeId: "hall-web", purpose: "SOURCE_ENTITY_CLASSIFICATION", entityType: "UNKNOWN", canonicalEntityId: null, facts: [ELIGIBLE] }));
  assert.deepEqual(google.calls.map((call) => call.mask), [GOOGLE_PLACES_PRO_CLASSIFICATION_MASK]);
  assert.equal(first.evidence?.fields.websiteUri, undefined);
  await run(google, research({ placeId: "hall-web", purpose: "SOURCE_ENTITY_CLASSIFICATION", entityType: "UNKNOWN", canonicalEntityId: null, evidence: first.evidence }));
  assert.equal(google.calls.length, 1, "Pro evidence is reused on rerun");
});

test("2+8 venue without eligibility (rejected / not promoted) → zero Enterprise calls and no website crawl", async () => {
  const google = mockGoogle();
  crawled.length = 0;
  const rejected = await run(google, research({ placeId: "hall-web" }));
  const unpromoted = await run(google, research({ placeId: "hall-web", canonicalEntityId: null, facts: [ELIGIBLE] }));
  assert.deepEqual(tiers(google.calls), ["PRO", "PRO"]);
  assert.equal(crawled.length, 0);
  assert.match(rejected.result.unknowns.join(" "), /venue eligibility/);
  assert.equal(unpromoted.result.facts.some((fact: any) => fact.fieldName === "officialWebsite"), false);
});

test("3 eligible venue with a stored website → zero Google calls, routed straight to first-party discovery", async () => {
  const google = mockGoogle();
  crawled.length = 0;
  await run(google, research({ placeId: "hall-web", facts: [ELIGIBLE], website: "https://grandhall.example/" }));
  assert.equal(google.calls.length, 0);
  assert.ok(crawled.some((url) => url.startsWith("https://grandhall.example/")));
});

test("4+5 eligible venue with no website evidence → exactly one Enterprise call; website stored and crawled", async () => {
  const google = mockGoogle();
  crawled.length = 0;
  const { evidence } = await run(google, research({ placeId: "hall-web", facts: [ELIGIBLE] }));
  assert.deepEqual(google.calls.map((call) => call.mask), [GOOGLE_PLACES_ENTERPRISE_REQUEST_MASK]);
  assert.equal(evidence?.place.websiteUri, "https://grandhall.example/");
  assert.equal(evidence?.fields.websiteUri?.tier, "ENTERPRISE");
  assert.equal(JSON.stringify(evidence).match(/rating|reviews/), null);
  assert.ok(crawled.some((url) => url.startsWith("https://grandhall.example/")));
});

test("6 Enterprise returns no website → negative result persisted; rerun makes zero calls", async () => {
  const google = mockGoogle();
  const first = await run(google, research({ placeId: "hall-noweb", name: "Quiet Hall", facts: [ELIGIBLE] }));
  assert.deepEqual(tiers(google.calls), ["ENTERPRISE"]);
  assert.ok(first.evidence?.fields.websiteUri, "websiteUri is recorded as obtained");
  assert.equal(first.evidence?.place.websiteUri, undefined);
  await run(google, research({ placeId: "hall-noweb", name: "Quiet Hall", facts: [ELIGIBLE], evidence: first.evidence }));
  assert.equal(google.calls.length, 1);
});

test("7 eligible venue with fresh prior Enterprise evidence → zero calls", async () => {
  const google = mockGoogle();
  const prior = await run(mockGoogle(), research({ placeId: "hall-web", facts: [ELIGIBLE] }));
  await run(google, research({ placeId: "hall-web", facts: [ELIGIBLE], evidence: prior.evidence }));
  assert.equal(google.calls.length, 0);
});

test("8 forged or incomplete eligibility never reaches Enterprise", async () => {
  const google = mockGoogle();
  await run(google, research({ placeId: "hall-web", facts: [{ ...ELIGIBLE, evidenceRef: null }] }));
  await run(google, research({ placeId: "hall-web", facts: [{ ...ELIGIBLE, value: "REJECTED" }] }));
  await run(google, research({ placeId: "hall-web", purpose: "PUBLIC_CONTACT", facts: [ELIGIBLE] }));
  assert.equal(tiers(google.calls).includes("ENTERPRISE"), false);
});

test("9 VENUE_IDENTITY cannot use the Enterprise mask", async () => {
  const google = mockGoogle();
  const input = { googlePlaceId: "hall-web", targetName: "Grand Hall", locality: "Cape Town", lane: "VENUE_FIRST" as const, targetType: "VENUE" as const };
  const identity = await getGooglePlaceDetails(input, { mode: "details_selected", apiKey: "test-key", fetchImpl: google.fetchImpl });
  assert.equal(identity.result?.websiteUri, null);
  await assert.rejects(
    () => getGooglePlaceDetails(input, { mode: "details_selected", apiKey: "test-key", fetchImpl: google.fetchImpl, requestedDetailsFields: GOOGLE_PLACES_ENTERPRISE_REQUEST_MASK.split(",") }),
    (error: unknown) => error instanceof GooglePlacesProviderError && error.telemetry.errorCategory === "ENTERPRISE_NOT_AUTHORIZED",
  );
  await assert.rejects(
    () => getGooglePlaceDetails(input, { mode: "details_selected", apiKey: "test-key", fetchImpl: google.fetchImpl, requestedDetailsFields: ["id", "websiteUri"], detailsAuthorization: { purpose: "VENUE_IDENTITY" } }),
    (error: unknown) => error instanceof GooglePlacesProviderError && error.telemetry.errorCategory === "ENTERPRISE_NOT_AUTHORIZED",
  );
  assert.deepEqual(google.calls.map((call) => call.mask), [GOOGLE_PLACES_PRO_CLASSIFICATION_MASK]);
});

test("10 OFFICIAL_WEBSITE cannot run before venue eligibility", async () => {
  let fetched = 0;
  const attempt = (authorization: unknown) => resolveGooglePlaceDetailsWithEvidence({
    providerPlaceId: "hall-web",
    requestedFields: GOOGLE_PLACES_ENTERPRISE_REQUEST_MASK,
    authorization: authorization as GooglePlacesDetailsAuthorization,
    store: null,
    requestingApplication: "test",
    workflow: "test",
    fetchDetails: async () => { fetched += 1; return { ok: true, statusCode: 200, payload: {} }; },
  });
  await assert.rejects(() => attempt(undefined), /REQUIRES_OFFICIAL_WEBSITE_PURPOSE/);
  await assert.rejects(() => attempt({ purpose: "OFFICIAL_WEBSITE", venueEligible: false, eligibilityRef: "x" }), /REQUIRES_VENUE_ELIGIBILITY/);
  await assert.rejects(() => attempt({ purpose: "OFFICIAL_WEBSITE", venueEligible: true, eligibilityRef: " " }), /REQUIRES_VENUE_ELIGIBILITY/);
  assert.equal(fetched, 0);
});

test("11 zero real Google endpoints contacted", async () => {
  await assert.rejects(fetch("https://places.googleapis.com/v1/places/probe"), /LIVE_GOOGLE_CALL_BLOCKED_IN_TESTS/);
  await assert.rejects(fetch("https://maps.googleapis.com/maps/api/place/details/json"), /LIVE_GOOGLE_CALL_BLOCKED_IN_TESTS/);
  assert.equal(liveGoogleAttempts.length, 2, "only the two guard probes reached the guard");
});
