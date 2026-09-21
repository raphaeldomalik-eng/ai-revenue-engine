import assert from "node:assert/strict";
import test from "node:test";
import { executeResearchRequest, executeSourceDiscoveryRequest, InMemoryNexusResultStore } from "../src/nexus/executor.ts";
import { CONTRACTS, validateResearchRequest, validateSourceDiscoveryRequest, validateSourceDiscoveryResult } from "../src/nexus/contracts.ts";
import { assertPublicNetworkTarget, crawlVerifiedSource, isPublicHttpsUrl, robotsAllows } from "../src/nexus/source-discovery/crawler.ts";
import { buildNexusEnvelope, parseNexusEnvelope, verifyNexusSignature } from "../src/nexus/transport.ts";

const ids = { requestId: "11111111-1111-4111-8111-111111111111", idempotencyKey: "22222222-2222-4222-8222-222222222222", correlationId: "33333333-3333-4333-8333-333333333333", discoveryRequestId: "44444444-4444-4444-8444-444444444444" };
function research(overrides: Record<string, unknown> = {}) { return { contractVersion: CONTRACTS.RESEARCH_REQUEST, requestId: ids.requestId, idempotencyKey: ids.idempotencyKey, correlationId: ids.correlationId, originatingProduct: "event_suite_resources", subject: { canonicalEntityId: null, candidateReference: { sourceSystem: "event_suite_resources", sourceRecordId: "Example Venue" }, entityType: "VENUE" }, researchPurpose: "VENUE_IDENTITY", requestedFactTypes: ["placeId", "officialWebsite"], providerAllowances: ["GOOGLE_PLACES"], costCeiling: { currency: "USD", amount: 10 }, freshnessRequirements: { maxAgeHours: 24 }, existingEvidenceRefs: [], requestedBy: { actorType: "PRODUCT", actorId: "resources" }, createdAt: "2026-09-21T00:00:00Z", ...overrides }; }
function discovery(overrides: Record<string, unknown> = {}) { return { contractVersion: CONTRACTS.SOURCE_DISCOVERY_REQUEST, discoveryRequestId: ids.discoveryRequestId, idempotencyKey: ids.idempotencyKey, correlationId: ids.correlationId, originatingProduct: "event_suite_resources", subjectReference: { canonicalEntityId: null, candidateReference: { sourceSystem: "event_suite_resources", sourceRecordId: "Example Venue" }, entityType: "VENUE" }, verifiedSourceUrl: "https://venue.example/", requestedExtractors: ["IDENTITY", "PUBLIC_CONTACT", "VENUE_FACTS", "IMAGE_CANDIDATES", "EVENTS"], freshnessRequirements: { maxAgeHours: 24 }, crawlBudget: { maxPages: 1, maxRequests: 4, maxBytesPerResponse: 100000, maxRedirects: 2, maxRetries: 0, timeoutMs: 1000, minRequestDelayMs: 0 }, existingEvidenceRefs: [], requestedBy: { actorType: "PRODUCT", actorId: "resources" }, createdAt: "2026-09-21T00:00:00Z", ...overrides }; }
const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

test("Nexus research request validator accepts V1 and fails closed on unknown enums", () => {
  assert.equal(validateResearchRequest(research()).contractVersion, CONTRACTS.RESEARCH_REQUEST);
  assert.throws(() => validateResearchRequest(research({ contractVersion: "nexus.research-request.v2" })), /INVALID_CONTRACT_VERSION/);
  assert.throws(() => validateResearchRequest(research({ researchPurpose: "GUESSING" })), /INVALID_RESEARCH_PURPOSE/);
  assert.throws(() => validateResearchRequest(research({ providerAllowances: ["SEARCH_ENGINE"] })), /INVALID_PROVIDER_ALLOWANCES/);
});

test("research execution never calls an unallowed provider and preserves safe unresolved state", async () => {
  let calls = 0;
  const result = await executeResearchRequest(research({ providerAllowances: ["PUBLIC_WEB"] }), {}, { googlePlaces: async () => { calls += 1; throw new Error("must not run"); } }) as any;
  assert.equal(calls, 0);
  assert.equal(result.status, "UNRESOLVED");
  assert.match(result.unknowns.join(" "), /GOOGLE_PLACES/);
});

test("research execution enforces the request cost ceiling before provider calls", async () => {
  let calls = 0;
  const result = await executeResearchRequest(research({ costCeiling: { currency: "USD", amount: 1 } }), {}, { estimatedCosts: { GOOGLE_PLACES: 2 }, googlePlaces: async () => { calls += 1; throw new Error("must not run"); } }) as any;
  assert.equal(calls, 0);
  assert.equal(result.providerUsage.length, 0);
  assert.match(result.researchErrors.map((error: any) => error.code).join(" "), /COST_CEILING_EXCEEDED/);
});

test("existing evidence prevents unnecessary venue provider execution", async () => {
  let calls = 0;
  const result = await executeResearchRequest(research(), { existingFacts: [{ fieldName: "placeId", value: "places/known" }] }, { googlePlaces: async () => { calls += 1; throw new Error("must not run"); } }) as any;
  assert.equal(calls, 0);
  assert.equal(result.providerUsage.length, 0);
});

test("research result preserves contract correlation, evidence separation, and idempotency", async () => {
  let calls = 0;
  const store = new InMemoryNexusResultStore();
  const result = await executeResearchRequest(research(), {}, { googlePlaces: (async () => { calls += 1; return { results: [{ provider: "GOOGLE_PLACES", googlePlaceId: "places/example", displayName: "Example Venue", formattedAddress: "1 High Street", types: ["event_venue"], websiteUri: null, websiteDomain: null, businessStatus: "OPERATIONAL", retrievedAt: "2026-09-21T00:00:00.000Z", queryContext: { targetName: "Example Venue", targetWebsite: null, locality: null, lane: "VENUE_FIRST", targetType: "VENUE" }, identityConfidence: "HIGH", matchStatus: "EXACT_OR_STRONG", rejectionReasons: [], sourceUrl: "https://places.googleapis.com/v1/places/example" }], telemetry: {} }; }) as any }, store) as any;
  const duplicate = await executeResearchRequest(research(), {}, { googlePlaces: async () => { calls += 1; throw new Error("duplicate must not run"); } }, store) as any;
  assert.equal(calls, 1);
  assert.equal(duplicate.requestId, ids.requestId);
  assert.equal(duplicate.idempotencyKey, ids.idempotencyKey);
  assert.ok(duplicate.facts.length > 0);
  assert.ok(duplicate.evidence.length > 0);
  assert.equal(duplicate.status, "COMPLETED");
});

test("source discovery validates HTTPS and blocks private targets", async () => {
  assert.equal(isPublicHttpsUrl("http://venue.example"), false);
  assert.equal(isPublicHttpsUrl("https://127.0.0.1"), false);
  await assert.rejects(() => assertPublicNetworkTarget("https://venue.example", async () => [{ address: "10.0.0.7", family: 4 }]));
  assert.throws(() => validateSourceDiscoveryRequest(discovery({ verifiedSourceUrl: "http://venue.example/" })), /INVALID_VERIFIED_SOURCE_URL/);
  assert.throws(() => validateSourceDiscoveryRequest(discovery({ requestedExtractors: ["UNKNOWN"] })), /INVALID_SOURCE_EXTRACTORS/);
});

test("source discovery request accepts known originating products and rejects unknown products", () => {
  assert.equal(
    validateSourceDiscoveryRequest(discovery({ originatingProduct: "event_suite_resources" })).originatingProduct,
    "event_suite_resources",
  );
  assert.throws(
    () => validateSourceDiscoveryRequest(discovery({ originatingProduct: "unknown_product" })),
    /INVALID_ORIGINATING_PRODUCT/,
  );
});

test("source discovery revalidates redirects and respects robots and finite page budget", async () => {
  const requested: string[] = [];
  const response = async (input: RequestInfo | URL) => { const url = String(input); requested.push(url); if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /private\nAllow: /", { status: 200 }); if (url.endsWith("/")) return new Response('<a href="/private">Private</a><a href="/events">Events</a>', { status: 200 }); return new Response("", { status: 200 }); };
  const result = await crawlVerifiedSource({ verifiedUrl: "https://venue.example/", requestedExtractors: ["IDENTITY", "EVENTS"], budget: { maxPages: 1, maxRequests: 3, maxBytesPerResponse: 10000, maxRedirects: 1, maxRetries: 0, timeoutMs: 1000, minRequestDelayMs: 0 }, resolveHost: publicResolver, fetchImpl: response });
  assert.equal(result.stats.pageCount, 1);
  assert.ok(result.stats.warnings.some((warning) => /budget/i.test(warning)));
  assert.equal(robotsAllows("User-agent: *\nDisallow: /private", "https://venue.example/private", "AiRevenueEngineNexusSourceDiscovery"), false);
  const redirected = await crawlVerifiedSource({ verifiedUrl: "https://venue.example/", requestedExtractors: ["IDENTITY"], budget: { maxPages: 1, maxRequests: 3, maxBytesPerResponse: 10000, maxRedirects: 1, maxRetries: 0, timeoutMs: 1000, minRequestDelayMs: 0 }, resolveHost: async (host) => host === "private.example" ? [{ address: "10.0.0.4", family: 4 }] : [{ address: "93.184.216.34", family: 4 }], fetchImpl: async (input) => String(input).endsWith("/robots.txt") ? new Response("User-agent: *\nAllow: /") : new Response(null, { status: 302, headers: { location: "https://private.example/" } }) });
  assert.equal(redirected.stats.blockedCount > 0, true);
  assert.equal(requested.includes("https://private.example/"), false);
});

test("one fetched document fans out deterministic extractors with zero model calls", async () => {
  const body = '<html><head><title>Example Venue</title><script type="application/ld+json">{"@type":"MusicEvent","name":"Example Show","startDate":"2026-10-22T19:30:00Z","url":"/events/example","location":{"name":"Example Venue"},"performer":{"name":"Example Band"},"offers":{"url":"https://tickets.example/show"}}</script></head><body><h1>Example Venue</h1><address>1 High Street</address><a href="mailto:events@example.com">events@example.com</a><form action="/contact"></form><img src="/images/venue.jpg" alt="Main hall"><p>Grand Hall — 500 standing. Step-free access and Wi-Fi available.</p></body></html>';
  let calls = 0;
  const result = await executeSourceDiscoveryRequest(discovery(), { resolveHost: publicResolver, fetchImpl: async (input) => { calls += 1; return String(input).endsWith("/robots.txt") ? new Response("User-agent: *\nAllow: /") : new Response(body, { headers: { "content-type": "text/html" } }); } }) as any;
  assert.ok(["COMPLETED", "PARTIAL"].includes(result.crawl.status));
  assert.equal(result.identityFacts.length > 0, true);
  assert.equal(result.publicContacts.some((contact: any) => contact.type === "EMAIL" && contact.value === "events@example.com"), true);
  assert.equal(result.venueFacts.some((fact: any) => String(fact.value).includes("500")), true);
  assert.equal(result.imageCandidates[0]?.rightsState, "PERMISSION_REQUIRED");
  assert.equal(result.eventCandidates[0]?.title, "Example Show");
  assert.equal(result.eventCandidates[0]?.ticketUrl, "https://tickets.example/show");
  assert.equal(calls, 2);
  assert.equal(validateSourceDiscoveryResult(result).contractVersion, CONTRACTS.SOURCE_DISCOVERY_RESULT);
});

test("transport adapter signs and verifies the existing server-to-server HMAC pattern", () => {
  const envelope = buildNexusEnvelope({ contractVersion: CONTRACTS.RESEARCH_REQUEST }, "secret", "1000");
  assert.equal(verifyNexusSignature(envelope.signature, envelope.timestamp, envelope.body, "secret", 1000 * 1000), true);
  assert.deepEqual(parseNexusEnvelope(envelope.body), { contractVersion: CONTRACTS.RESEARCH_REQUEST });
  assert.equal(verifyNexusSignature(envelope.signature, envelope.timestamp, envelope.body, "wrong", 1000 * 1000), false);
});
