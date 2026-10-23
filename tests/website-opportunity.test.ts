import assert from "node:assert/strict";
import test from "node:test";
import { crawlVerifiedSource } from "../src/nexus/source-discovery/crawler.ts";
import { executeSourceDiscoveryRequest, InMemoryNexusResultStore, sourceDiscoveryExecutionKey } from "../src/nexus/executor.ts";
import { CONTRACTS, validateSourceDiscoveryResult } from "../src/nexus/contracts.ts";
import { assessWebsiteOpportunity } from "../src/nexus/source-discovery/website-opportunity.ts";
import type { FetchedDocument } from "../src/nexus/source-discovery/types.ts";

const html = "<html><head><title>Example Venue</title></head><body><h1>Example Venue</h1><p>A local venue hosting events and conferences with meeting rooms and catering.</p></body></html>";
const budget = { maxPages: 1, maxRequests: 2, maxBytesPerResponse: 100000, maxRedirects: 0, maxRetries: 0, timeoutMs: 1000, minRequestDelayMs: 0 };
const resolver = async () => [{ address: "93.184.216.34", family: 4 }];
function fixture() {
  const urls: string[] = [];
  const fetchImpl = async (input: RequestInfo | URL) => {
    const url = String(input); urls.push(url);
    return new Response(url.endsWith("robots.txt") ? "User-agent: *\nAllow: /" : html, { headers: { "content-type": url.endsWith("robots.txt") ? "text/plain" : "text/html" } });
  };
  return { urls, fetchImpl };
}
function request() {
  return { contractVersion: CONTRACTS.SOURCE_DISCOVERY_REQUEST, discoveryRequestId: "44444444-4444-4444-8444-444444444444", idempotencyKey: "22222222-2222-4222-8222-222222222222", correlationId: "33333333-3333-4333-8333-333333333333", originatingProduct: "event_suite_resources", subjectReference: { canonicalEntityId: null, candidateReference: { sourceSystem: "event_suite_resources", sourceRecordId: "Example Venue" }, entityType: "VENUE" }, verifiedSourceUrl: "https://venue.org/", requestedExtractors: ["IDENTITY"], freshnessRequirements: { maxAgeHours: 24 }, crawlBudget: budget, existingEvidenceRefs: [], requestedBy: { actorType: "PRODUCT", actorId: "resources" }, createdAt: "2026-10-23T00:00:00Z" };
}

test("passive assessment uses collected documents without spending additional crawl requests", async () => {
  const f = fixture();
  const crawl = await crawlVerifiedSource({ verifiedUrl: "https://venue.org/", requestedExtractors: ["IDENTITY"], budget, fetchImpl: f.fetchImpl, resolveHost: resolver });
  assert.equal(crawl.websiteOpportunity?.classification, "ImprovementObserved");
  assert.deepEqual(crawl.websiteOpportunity?.evidence.map(e => e.signal), ["MISSING_META_DESCRIPTION", "MISSING_DEVICE_WIDTH_VIEWPORT"]);
  assert.equal(crawl.websiteOpportunity?.evidence[0]?.sourceHash, crawl.documents[0]?.sourceHash);
  assert.equal(f.urls.length, 2);
  assert.equal(crawl.stats.requestCount, 2);
});

test("existing replay JSON stores local intelligence while the cross-product result stays unchanged", async () => {
  const f = fixture(); const store = new InMemoryNexusResultStore();
  const result = await executeSourceDiscoveryRequest(request(), { fetchImpl: f.fetchImpl, resolveHost: resolver }, store);
  const stored = await store.get(sourceDiscoveryExecutionKey(request().idempotencyKey));
  assert.equal((stored?.crawlIntelligence as { websiteOpportunity: { classification: string } })?.websiteOpportunity.classification, "ImprovementObserved");
  assert.equal("crawlIntelligence" in result, false);
  assert.deepEqual(result, validateSourceDiscoveryResult(result));
  assert.deepEqual(await executeSourceDiscoveryRequest(request(), { fetchImpl: f.fetchImpl, resolveHost: resolver }, store), result);
  assert.equal(f.urls.length, 2);
});

test("optional intelligence write rejection falls back to the original replay payload", async () => {
  const f = fixture(); const writes: Record<string, unknown>[] = [];
  const result = await executeSourceDiscoveryRequest(request(), { fetchImpl: f.fetchImpl, resolveHost: resolver }, {
    get: async () => null,
    set: async (_key, value) => { writes.push(value); if ("crawlIntelligence" in value) throw new Error("optional metadata unavailable"); },
  });
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1], result);
  assert.equal(validateSourceDiscoveryResult(result).crawl.status, "COMPLETED");
  assert.equal(f.urls.length, 2);
});

function document(overrides: Partial<FetchedDocument> = {}): FetchedDocument {
  return { url: "https://venue.org/", body: html, kind: "HTML", contentType: "text/html", bytes: html.length, sourceHash: "fixture-sha256", observedAt: "2026-10-23T00:00:00Z", retrieval: "STATIC", ...overrides };
}

test("unsupported evidence and markup with no supported issues return Unknown", () => {
  const healthy = html.replace("</head>", '<meta name="description" content="A venue"><meta name="viewport" content="width=device-width, initial-scale=1"></head>');
  for (const documents of [[], [document({ body: healthy })], [document({ kind: "PDF" })], [document({ kind: "CALENDAR" })],
    [document({ retrieval: "RENDERED" })], [document({ shellSignals: ["NEXT_ROOT"] })],
    [document({ body: html.replace("</html>", "") })], [document({ body: "<h1>Venue</h1>" })],
    [document({ sourceHash: "" })], [document({ observedAt: "invalid" })],
    [document({ body: html.replace("Example Venue", "Access denied") })],
    [document({ body: html.replace("Example Venue", "Coming soon") })],
    [document({ body: " ".repeat(1_500_001) })]]) {
    assert.deepEqual(assessWebsiteOpportunity(documents), { version: "passive-html-v1", classification: "Unknown", evidence: [] });
  }
});

test("scoring errors return Unknown without escaping to the crawler", () => {
  const broken = document();
  Object.defineProperty(broken, "body", { get() { throw new Error("bad cached document"); } });
  assert.equal(assessWebsiteOpportunity([broken]).classification, "Unknown");
});

test("quoted angle brackets in valid metadata are not evidence of missing metadata", () => {
  const healthy = html.replace("</head>", '<meta content="Rooms > 20 square metres" name="description"><meta name="viewport" content="width=device-width"></head>');
  assert.equal(assessWebsiteOpportunity([document({ body: healthy })]).classification, "Unknown");
});

test("metadata and framesets are observed only in actual markup, with bounded evidence", () => {
  const missing = document({ body: html.replace("<title>Example Venue</title>", '<!-- <title>Fake</title> --><script>"<meta name=description content=fake>"</script>') });
  assert.deepEqual(assessWebsiteOpportunity([missing]).evidence.map(e => e.signal), ["MISSING_TITLE", "MISSING_META_DESCRIPTION", "MISSING_DEVICE_WIDTH_VIEWPORT"]);
  const frames = document({ body: '<html><head><title>Venue</title></head><frameset><frame src="main.html"></frameset></html>' });
  assert.deepEqual(assessWebsiteOpportunity([frames]).evidence.map(e => e.signal), ["LEGACY_FRAMESET"]);
  const result = assessWebsiteOpportunity(Array.from({ length: 20 }, (_, i) => document({ url: `https://venue.org/${i}` })));
  assert.equal(result.evidence.length, 8);
  assert.ok(result.evidence.every(e => e.observedAt === "2026-10-23T00:00:00Z" && e.sourceHash === "fixture-sha256"));
  const healthy = document({ body: html.replace("</head>", '<meta name="description" content="A venue"><meta name="viewport" content="width=device-width"></head>') });
  assert.equal(assessWebsiteOpportunity([...Array(8).fill(healthy), missing]).classification, "Unknown");
});

test("a blocked authorised crawl returns Unknown without changing the block outcome", async () => {
  let requests = 0;
  const crawl = await crawlVerifiedSource({ verifiedUrl: "https://venue.org/", requestedExtractors: ["IDENTITY"], budget, resolveHost: resolver,
    fetchImpl: async () => { requests++; return new Response("User-agent: *\nDisallow: /", { headers: { "content-type": "text/plain" } }); } });
  assert.equal(crawl.websiteOpportunity?.classification, "Unknown");
  assert.equal(crawl.stats.status, "BLOCKED");
  assert.equal(requests, 1);
});
