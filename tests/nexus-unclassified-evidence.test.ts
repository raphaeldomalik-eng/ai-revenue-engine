import assert from "node:assert/strict";
import test from "node:test";
import { getGooglePlaceDetails, searchGooglePlaces } from "../src/ai-sales-team/google-places.ts";
import { CONTRACTS, stageResearchResult, validateResearchRequest, validateSourceDiscoveryRequest } from "../src/nexus/contracts.ts";
import { executeResearchRequest, executeSourceDiscoveryRequest } from "../src/nexus/executor.ts";
import { createPublicWebProvider } from "../src/nexus/public-web.ts";

const ids = { requestId: "11111111-1111-4111-8111-111111111111", idempotencyKey: "22222222-2222-4222-8222-222222222222", correlationId: "33333333-3333-4333-8333-333333333333", discoveryRequestId: "44444444-4444-4444-8444-444444444444" };
const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

function research(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: CONTRACTS.RESEARCH_REQUEST,
    requestId: ids.requestId,
    idempotencyKey: ids.idempotencyKey,
    correlationId: ids.correlationId,
    originatingProduct: "prestige_nexus",
    subject: { canonicalEntityId: null, candidateReference: { sourceSystem: "event_suite_resources", sourceRecordId: "unknown-candidate" }, entityType: "UNKNOWN" },
    researchPurpose: "OFFICIAL_WEBSITE",
    requestedFactTypes: ["official_website", "entity_type"],
    providerAllowances: ["GOOGLE_PLACES"],
    costCeiling: { currency: "USD", amount: 10 },
    freshnessRequirements: { maxAgeHours: 24 },
    existingEvidenceRefs: [],
    requestedBy: { actorType: "PRODUCT", actorId: "prestige-nexus" },
    createdAt: "2026-09-29T00:00:00.000Z",
    ...overrides,
  };
}

test("UNKNOWN is a valid research subject and is not a venue", () => {
  const validated = validateResearchRequest(research());
  assert.equal(validated.subject.entityType, "UNKNOWN");
  assert.notEqual(validated.subject.entityType, "VENUE");
  assert.equal(validateSourceDiscoveryRequest({
    contractVersion: CONTRACTS.SOURCE_DISCOVERY_REQUEST,
    discoveryRequestId: ids.discoveryRequestId,
    idempotencyKey: ids.idempotencyKey,
    correlationId: ids.correlationId,
    originatingProduct: "prestige_nexus",
    subjectReference: research().subject,
    verifiedSourceUrl: "https://example.test/",
    requestedExtractors: ["IDENTITY", "SOURCE_CLASSIFICATION"],
    freshnessRequirements: { maxAgeHours: 24 },
    crawlBudget: { maxPages: 1, maxRequests: 4, maxBytesPerResponse: 100000, maxRedirects: 1, maxRetries: 0, timeoutMs: 1000, minRequestDelayMs: 0 },
    existingEvidenceRefs: [],
    requestedBy: { actorType: "PRODUCT", actorId: "prestige-nexus" },
    createdAt: "2026-09-29T00:00:00.000Z",
  }).requestedExtractors.includes("SOURCE_CLASSIFICATION"), true);
});

test("UNKNOWN with a retained Place ID uses exact details and keeps provider types neutral", async () => {
  let searches = 0;
  const result = await executeResearchRequest(research({ researchPurpose: "SOURCE_ENTITY_CLASSIFICATION" }), {
    targetName: "Example Hall",
    locality: "Bristol",
    existingFacts: [{ fieldName: "google_place_id", value: "places/example-hall", evidenceRef: "frozen:place" }],
  }, {
    googlePlaces: async () => { searches += 1; throw new Error("must not text search"); },
    googlePlaceDetails: async (input) => {
      assert.equal(input.lane, "EXACT_ID");
      assert.equal(input.targetType, "UNCLASSIFIED");
      assert.equal(input.googlePlaceId, "places/example-hall");
      return { result: { provider: "GOOGLE_PLACES" as const, googlePlaceId: input.googlePlaceId, displayName: "Example Hall", formattedAddress: "1 High Street, Bristol", types: ["event_venue"], websiteUri: "https://example-hall.test/", websiteDomain: "example-hall.test", businessStatus: "OPERATIONAL", retrievedAt: "2026-09-29T00:00:00.000Z", queryContext: { targetName: "Example Hall", targetWebsite: null, locality: "Bristol", lane: "EXACT_ID" as const, targetType: "UNCLASSIFIED" as const }, identityConfidence: "MEDIUM" as const, matchStatus: "REVIEW_REQUIRED" as const, rejectionReasons: [], sourceUrl: "https://places.googleapis.com/v1/places/example-hall" }, telemetry: { endpointCategory: "PLACE_DETAILS" as const, mode: "details_selected" as const, fieldMask: null, candidateCount: 1, matchStatus: "REVIEW_REQUIRED" as const, httpStatus: 200, errorCategory: null, retryCount: 0 as const } };
    },
  }) as any;
  assert.equal(searches, 0);
  assert.equal(result.facts.every((item: { subjectEntityType: string }) => item.subjectEntityType === "UNKNOWN"), true);
  assert.equal(result.facts.some((item: { fieldName: string; subjectEntityType: string }) => item.fieldName === "providerTypes" && item.subjectEntityType !== "VENUE"), true);
  const staged = stageResearchResult(result);
  assert.equal(staged.proposedFactRows.length, 0);
  assert.ok(staged.classificationEvidenceRows.length > 0);
  assert.equal(staged.canonicalMutations, 0);
});

test("UNKNOWN without a Place ID does not run venue-first Google search", async () => {
  let searches = 0;
  const result = await executeResearchRequest(research({ researchPurpose: "OFFICIAL_WEBSITE", providerAllowances: ["GOOGLE_PLACES"] }), { targetName: "Example Hall" }, {
    googlePlaces: async () => { searches += 1; throw new Error("must not text search"); },
    googlePlaceDetails: async () => { throw new Error("must not call details"); },
  }) as any;
  assert.equal(searches, 0);
  assert.equal(result.facts.length, 0);
  assert.match(result.unknowns.join(" "), /public-web|Place ID|unresolved/i);
});

test("UNKNOWN source discovery extracts classification evidence without a venue subject", async () => {
  const body = `<html><head><title>Example Collective</title><meta name="description" content="A promoter presenting concerts."><script type="application/ld+json">{"@type":"Organization","name":"Example Collective"}</script></head><body><h1>Example Collective</h1><p>We promote concerts across several venues.</p></body></html>`;
  const result = await executeSourceDiscoveryRequest({
    contractVersion: CONTRACTS.SOURCE_DISCOVERY_REQUEST,
    discoveryRequestId: ids.discoveryRequestId,
    idempotencyKey: ids.idempotencyKey,
    correlationId: ids.correlationId,
    originatingProduct: "prestige_nexus",
    subjectReference: { canonicalEntityId: null, candidateReference: { sourceSystem: "event_suite_resources", sourceRecordId: "unknown-candidate" }, entityType: "UNKNOWN" },
    verifiedSourceUrl: "https://example.test/",
    requestedExtractors: ["IDENTITY", "SOURCE_CLASSIFICATION"],
    freshnessRequirements: { maxAgeHours: 24 },
    crawlBudget: { maxPages: 1, maxRequests: 4, maxBytesPerResponse: 100000, maxRedirects: 1, maxRetries: 0, timeoutMs: 1000, minRequestDelayMs: 0 },
    existingEvidenceRefs: [],
    requestedBy: { actorType: "PRODUCT", actorId: "prestige-nexus" },
    createdAt: "2026-09-29T00:00:00.000Z",
  }, {
    resolveHost: publicResolver,
    fetchImpl: async (input) => String(input).endsWith("/robots.txt") ? new Response("User-agent: *\nAllow: /") : new Response(body, { headers: { "content-type": "text/html" } }),
  }) as any;
  assert.equal(result.identityFacts.every((item: { subjectEntityType: string }) => item.subjectEntityType === "UNKNOWN"), true);
  assert.equal(result.identityFacts.some((item: { fieldName: string; value: string[] }) => item.fieldName === "schemaOrgTypes" && item.value.includes("Organization")), true);
  assert.equal(result.identityFacts.some((item: { fieldName: string; value: string[] }) => item.fieldName === "classificationSignals" && item.value.includes("PROMOTER_LANGUAGE")), true);
  assert.equal(result.venueFacts.length, 0);
});

test("UNKNOWN public-web verification returns sourced evidence without venue facts", async () => {
  const body = `<html><head><title>Example Hall</title><meta name="description" content="A room for hire."></head><body><h1>Example Hall</h1></body></html>`;
  const provider = createPublicWebProvider({
    resolveHost: publicResolver,
    fetchImpl: async (input) => String(input).endsWith("/robots.txt") ? new Response("User-agent: *\nAllow: /") : new Response(body, { headers: { "content-type": "text/html" } }),
  });
  const request = validateResearchRequest(research({ providerAllowances: ["PUBLIC_WEB"], researchPurpose: "OFFICIAL_WEBSITE" }));
  const result = await provider({ request, context: { targetName: "Example Hall", targetWebsite: "https://example.test/" } });
  assert.equal(result.facts.every((item) => item.subjectEntityType === "UNKNOWN"), true);
  assert.equal(result.facts.some((item) => item.fieldName === "officialWebsite"), true);
  assert.equal(result.facts.some((item) => item.subjectEntityType === "VENUE"), false);
});

test("typed venue conflict evidence does not become a canonical confirmation", async () => {
  const result = await executeResearchRequest(research({
    subject: { canonicalEntityId: null, candidateReference: { sourceSystem: "event_suite_resources", sourceRecordId: "venue-candidate" }, entityType: "VENUE" },
    researchPurpose: "CONFLICT_RESOLUTION",
    providerAllowances: ["PUBLIC_WEB"],
  }), {}, {
    publicWeb: async () => ({
      provider: "PUBLIC_WEB",
      purpose: "CONFLICT_RESOLUTION",
      facts: [{ subjectEntityType: "VENUE", canonicalEntityId: null, fieldName: "classificationSignals", value: ["ORGANISATION_VENUE_CONFLICT"], evidenceRef: null, confidence: 0.7, observedAt: "2026-09-29T00:00:00.000Z" }],
      evidence: [],
      unknowns: ["Organisation language conflicts with the current venue hypothesis."],
      conflicts: [{ code: "ORGANISATION_VENUE_CONFLICT" }],
      cost: { currency: "USD", amount: 0 },
    }),
  }) as any;
  assert.equal(result.status === "COMPLETED", false);
  assert.equal(result.recommendation.advisory.includes("Nexus review") || result.unknowns.length > 0, true);
  assert.equal(stageResearchResult(result).autoPromotions, 0);
});

test("Google text search rejects an unclassified target and exact details do not require a venue type", async () => {
  await assert.rejects(() => searchGooglePlaces({ targetName: "Example", lane: "VENUE_FIRST", targetType: "UNCLASSIFIED" } as any, { mode: "search_only", apiKey: "test", fetchImpl: async () => { throw new Error("must not search"); } }));
  let called = "";
  const details = await getGooglePlaceDetails({
    googlePlaceId: "places/example",
    targetName: "Example Hall",
    lane: "EXACT_ID",
    targetType: "UNCLASSIFIED",
  }, {
    mode: "details_selected",
    apiKey: "test",
    fetchImpl: async (url) => {
      called = String(url);
      return new Response(JSON.stringify({ id: "places/example", displayName: { text: "Example Hall" }, formattedAddress: "1 High Street", types: ["event_venue"], businessStatus: "OPERATIONAL", websiteUri: "https://example.test/" }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.match(called, /places\/places%2Fexample|places\/example/);
  assert.equal(details.result?.types.includes("event_venue"), true);
  assert.equal(details.result?.queryContext.targetType, "UNCLASSIFIED");
  assert.equal(details.result?.queryContext.lane, "EXACT_ID");
});
