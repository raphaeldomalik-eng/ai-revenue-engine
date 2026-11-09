import assert from "node:assert/strict";
import test from "node:test";
import type { SourceExtractor } from "../src/nexus/contracts.ts";
import { contentCoverage } from "../src/nexus/source-discovery/content-coverage.ts";
import { crawlVerifiedSource, extractFromFetchedDocuments } from "../src/nexus/source-discovery/crawler.ts";
import type { CrawlBudget } from "../src/nexus/source-discovery/types.ts";
import { VENUE_EXTRACTORS, venueCrawlProfiles } from "../src/nexus/source-discovery/venue/profiles.ts";

const origin = "https://venue.org";
const imageDimension = "IMAGE_CANDIDATES:IMAGES";
const home = '<title>Alpha Hall</title><h1>Alpha Hall</h1><p>Alpha Hall is a restored riverside venue with original brickwork.</p><a href="/gallery">Gallery</a>';
const gallery = '<title>Alpha Hall</title><h1>Gallery</h1><p>View our official venue photographs.</p><a href="/photos">Venue photos</a>';
const photos = '<title>Alpha Hall</title><img src="/room.jpg" alt="Alpha Hall">';
const routes = { "/": home, "/gallery": gallery, "/photos": photos };
const budget: CrawlBudget = {
  maxPages: 5, maxRequests: 10, maxBytesPerResponse: 100_000,
  maxRedirects: 2, maxRetries: 0, timeoutMs: 1_000, minRequestDelayMs: 0,
  maxSitemapFetches: 0,
};

async function crawl(pages: Record<string, string> = routes, options: {
  completeContent?: boolean;
  budget?: Partial<CrawlBudget>;
  extractors?: SourceExtractor[];
} = {}) {
  const requestedExtractors = options.extractors ?? [...VENUE_EXTRACTORS];
  const requestedPaths: string[] = [];
  const result = await crawlVerifiedSource({
    verifiedUrl: `${origin}/`, venueName: "Alpha Hall", emailGoal: true,
    requestedExtractors, subjectType: "VENUE", budget: { ...budget, ...options.budget },
    profiles: venueCrawlProfiles(undefined, {
      venueName: "Alpha Hall", emailGoal: true, completeContent: options.completeContent,
    }).filter(profile => requestedExtractors.includes(profile.extractor)),
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async input => {
      const url = new URL(String(input));
      assert.equal(url.origin, origin, "The fixture must never request another site");
      requestedPaths.push(url.pathname);
      if (url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } });
      const body = pages[url.pathname];
      return new Response(body ?? "not found", { status: body === undefined ? 404 : 200, headers: { "content-type": "text/html" } });
    },
  });
  const extracted = extractFromFetchedDocuments(result.documents, requestedExtractors, "Alpha Hall");
  const coverage = contentCoverage(extracted, {
    requestedExtractors, stopReason: result.observability?.stopReason,
    retrievalStatus: result.stats.status, documentCount: result.documents.length,
  });
  return { result, extracted, coverage, requestedPaths };
}

test("complete-content crawl follows an empty gallery to linked venue photos", async () => {
  const { result, extracted, coverage, requestedPaths } = await crawl(routes, { completeContent: true });
  assert.deepEqual(requestedPaths, ["/robots.txt", "/", "/gallery", "/photos"]);
  assert.equal(result.stats.pageCount, 3);
  assert.equal(result.stats.requestCount, 4);
  assert.equal(extracted.imageCandidates.length, 1);
  assert.equal(extracted.imageCandidates[0]?.sourceImageUrl, `${origin}/room.jpg`);
  assert.equal(extracted.imageCandidates[0]?.sourcePageUrl, `${origin}/photos`);
  assert.equal(extracted.imageCandidates[0]?.rightsState, "UNKNOWN_RIGHTS");
  assert.ok(result.observability?.dimensionsMissing.includes(imageDimension));
  assert.equal(result.observability?.stopReason, "NO_GAP_CANDIDATES");
  assert.equal(coverage.fields.images?.count, 1);
  assert.equal(coverage.fields.images?.status, "REVIEW_REQUIRED");
  assert.deepEqual(coverage.fields.images?.sourceUrls, [`${origin}/photos`]);
  assert.ok(coverage.gaps.includes("images"));
});

for (const [stopReason, limits] of [
  ["PAGE_BUDGET", { maxPages: 2 }],
  ["REQUEST_BUDGET", { maxRequests: 3 }],
] as const) {
  test(`complete-content image gap remains truthful when ${stopReason} stops before linked photos`, async () => {
    const { result, extracted, coverage, requestedPaths } = await crawl(routes, { completeContent: true, budget: limits });
    assert.deepEqual(requestedPaths, ["/robots.txt", "/", "/gallery"]);
    assert.equal(result.stats.pageCount, 2);
    assert.equal(result.stats.requestCount, 3);
    assert.equal(result.stats.status, "PARTIAL");
    assert.equal(result.observability?.stopReason, stopReason);
    assert.ok(result.observability?.dimensionsMissing.includes(imageDimension));
    assert.equal(result.observability?.dimensionsSatisfied.includes(imageDimension), false);
    assert.equal(extracted.imageCandidates.length, 0);
    assert.equal(coverage.fields.images?.status, "BUDGET_LIMITED");
    assert.equal(coverage.fields.images?.count, 0);
    assert.ok(coverage.gaps.includes("images"));
  });
}

for (const completeContent of [undefined, false]) {
  test(`legacy venue crawl preserves the gallery-visit stop when completeContent is ${completeContent}`, async () => {
    const { result, extracted, coverage, requestedPaths } = await crawl(routes, { completeContent });
    assert.deepEqual(requestedPaths, ["/robots.txt", "/", "/gallery"]);
    assert.equal(result.stats.requestCount, 3);
    assert.ok(result.observability?.dimensionsSatisfied.includes(imageDimension));
    assert.equal(result.observability?.stopReason, "NO_GAP_CANDIDATES");
    assert.equal(extracted.imageCandidates.length, 0);
    assert.equal(coverage.fields.images?.status, "NOT_OBSERVED");
  });
}

test("complete-content image discovery stops after eight candidates without fetching another gallery link", async () => {
  const sevenImages = Array.from({ length: 7 }, (_, i) => `<img src="/hall-${i}.jpg" alt="Alpha Hall interior ${i}">`).join("");
  const { result, extracted, requestedPaths } = await crawl({
    ...routes,
    "/gallery": gallery + sevenImages,
    "/photos": photos + '<a href="/more-photos">More photos</a>',
    "/more-photos": '<img src="/ninth.jpg" alt="Alpha Hall exterior">',
  }, { completeContent: true, extractors: ["IMAGE_CANDIDATES"] });
  assert.deepEqual(requestedPaths, ["/robots.txt", "/", "/gallery", "/photos"]);
  assert.equal(result.stats.pageCount, 3);
  assert.equal(result.stats.requestCount, 4);
  assert.equal(extracted.imageCandidates.length, 8);
  assert.equal(result.observability?.stopReason, "DIMENSIONS_SATISFIED");
  assert.deepEqual(result.observability?.dimensionsMissing, []);
  assert.ok(extracted.imageCandidates.every(image => image.rightsState === "UNKNOWN_RIGHTS"));
});
