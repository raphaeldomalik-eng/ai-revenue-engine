import assert from "node:assert/strict";
import test from "node:test";
import {
  authorisedHost,
  canReuseCrawl,
  classifyWaveOutcome,
  completedListingIds,
  confirmedSpaceLooksGeneric,
  documentStaysOnAuthorisedSite,
  evidenceIsUseful,
  keepImageCandidate,
  summarizeWave,
  systemicDefect,
  VenueCrawlScheduler,
  type WaveResultRow,
} from "../scripts/venue-crawler-wave1-lib.ts";
import type { VenueEvidencePackage } from "../src/nexus/source-discovery/venue/evidence.ts";

function evidence(overrides: Partial<VenueEvidencePackage> = {}): VenueEvidencePackage {
  return {
    identity: [],
    descriptionEvidence: [],
    contacts: [],
    excludedContacts: [],
    spaces: [],
    reviewSpaces: [],
    capacities: [],
    practicalFacts: [],
    suitability: [],
    imagesByRole: {},
    routingAuthority: "not_operator_confirmed",
    ...overrides,
  };
}

test("useful evidence needs a real description, space, capacity, fact, or suitability", () => {
  assert.equal(evidenceIsUseful(evidence()), false);
  assert.equal(evidenceIsUseful(evidence({
    descriptionEvidence: [{ kind: "character", text: "A stone barn with a licensed kitchen and a covered courtyard for dinners.", sourceUrl: "https://venue.test/", evidenceRef: "e" }],
  })), true);
  assert.equal(evidenceIsUseful(evidence({
    descriptionEvidence: [{ kind: "quoted-claim", text: "The premier destination and world-class experience for every celebration.", sourceUrl: "https://venue.test/", evidenceRef: "e" }],
  })), false);
  assert.equal(evidenceIsUseful(evidence({ spaces: [{ name: "Oak Barn", sourceUrl: "https://venue.test/spaces", evidenceRef: "e", status: "confirmed" }] })), true);
});

test("transport failures are not recorded as thin venue content", () => {
  assert.equal(classifyWaveOutcome({
    refusal: null, sameSite: true, status: "FAILED", failureClass: "RETRYABLE", stopReason: "ENTRY_FAILED",
    warnings: ["Required HTML source unavailable: https://venue.test/: The operation was aborted due to timeout"],
    htmlPages: 0, pdfDocuments: 0, renderNeeded: 0, useful: false,
  }), "TRANSIENT_NETWORK");
  assert.equal(classifyWaveOutcome({
    refusal: null, sameSite: true, status: "FAILED", failureClass: "TERMINAL", stopReason: "ENTRY_FAILED",
    warnings: ["Required HTML source unavailable: https://venue.test/: HTTP 404"],
    htmlPages: 0, pdfDocuments: 0, renderNeeded: 0, useful: false,
  }), "DEAD_OR_UNREACHABLE");
  assert.equal(classifyWaveOutcome({
    refusal: null, sameSite: true, status: "BLOCKED", failureClass: "TERMINAL", stopReason: "ROBOTS_BLOCKED",
    warnings: ["robots.txt disallows the verified source path."],
    htmlPages: 0, pdfDocuments: 0, renderNeeded: 0, useful: false,
  }), "ROBOTS_BLOCKED");
  assert.equal(classifyWaveOutcome({
    refusal: "CROSS_SITE_FINAL_URL", sameSite: false, status: "COMPLETED", failureClass: null, stopReason: "QUEUE_EXHAUSTED",
    warnings: [], htmlPages: 1, pdfDocuments: 0, renderNeeded: 0, useful: false,
  }), "CROSS_SITE_REFUSED");
  assert.equal(classifyWaveOutcome({
    refusal: null, sameSite: true, status: "COMPLETED", failureClass: null, stopReason: "GAPS_EXHAUSTED",
    warnings: [], htmlPages: 2, pdfDocuments: 0, renderNeeded: 3, useful: false,
  }), "STATIC_RENDER_REQUIRED");
  assert.equal(classifyWaveOutcome({
    refusal: null, sameSite: true, status: "PARTIAL", failureClass: null, stopReason: "PAGE_BUDGET",
    warnings: [], htmlPages: 2, pdfDocuments: 0, renderNeeded: 0, useful: false,
  }), "CRAWL_SUCCESS_THIN");
  assert.equal(classifyWaveOutcome({
    refusal: null, sameSite: true, status: "COMPLETED", failureClass: null, stopReason: "DIMENSIONS_SATISFIED",
    warnings: [], htmlPages: 3, pdfDocuments: 1, renderNeeded: 0, useful: true,
  }), "CRAWL_SUCCESS_USEFUL");
});

test("shared crawl reuse requires the same authorised URL, not merely the same host", () => {
  assert.equal(canReuseCrawl("https://www.venue.test/hire", "http://venue.test/hire"), true);
  assert.equal(canReuseCrawl("https://venue.test/hire", "https://venue.test/weddings"), false);
  assert.equal(authorisedHost("https://www.venue.test/hire"), "venue.test");
  assert.equal(documentStaysOnAuthorisedSite("https://venue.test/hire", "https://www.venue.test/spaces"), true);
  assert.equal(documentStaysOnAuthorisedSite("https://venue.test/hire", "https://other.test/spaces"), false);
});

test("logos, icons, and placeholders are not image candidates", () => {
  assert.equal(keepImageCandidate({ likelyRole: "LOGO", sourceImageUrl: "https://venue.test/a.jpg", filename: "a.jpg", width: 400, height: 400 }), false);
  assert.equal(keepImageCandidate({ likelyRole: "GALLERY", sourceImageUrl: "https://venue.test/icon-set.png", filename: "icon-set.png", width: 400, height: 400 }), false);
  assert.equal(keepImageCandidate({ likelyRole: "SPACE", sourceImageUrl: "https://venue.test/oak-barn.jpg", filename: "oak-barn.jpg", width: 1200, height: 800 }), true);
});

test("generic marketing headings are not acceptable confirmed spaces", () => {
  assert.equal(confirmedSpaceLooksGeneric("Wedding venue"), true);
  assert.equal(confirmedSpaceLooksGeneric("Oak Barn"), false);
});

test("resume skips listings that already have a result row", () => {
  const ids = completedListingIds('{"listingId":"a"}\n{"listingId":"b"}\n');
  assert.equal(ids.has("a"), true);
  assert.equal(ids.has("c"), false);
});

test("the same host is never crawled concurrently and global concurrency stays bounded", async () => {
  const scheduler = new VenueCrawlScheduler(2);
  let active = 0;
  let maxActive = 0;
  const hosts = new Map<string, number>();
  async function job(host: string) {
    const release = await scheduler.acquire(host);
    active += 1;
    hosts.set(host, (hosts.get(host) ?? 0) + 1);
    assert.equal(hosts.get(host), 1);
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    hosts.set(host, (hosts.get(host) ?? 1) - 1);
    release();
  }
  await Promise.all([
    job("a.test"), job("a.test"), job("b.test"), job("c.test"), job("b.test"),
  ]);
  assert.ok(maxActive <= 2);
  assert.equal(active, 0);
});

function row(overrides: Partial<WaveResultRow> = {}): WaveResultRow {
  return {
    listingId: "1", venueName: "Oak", authorisedOfficialUrl: "https://oak.test/", authorityProvenance: "resources_listing_official_website",
    country: "United Kingdom", countryCode: "GB", publicationState: "published", outcome: "CRAWL_SUCCESS_USEFUL", outcomeReason: "DIMENSIONS_SATISFIED",
    reusedSharedCrawl: false, crawlUrl: "https://oak.test/", finalUrl: "https://oak.test/", sameSite: true, pages: 3, requests: 5, bytes: 1000, pdfCount: 1,
    pdfs: [{ url: "https://oak.test/pack.pdf" }], pageUrls: ["https://oak.test/"], descriptionEvidence: [{ kind: "character", text: "Stone barn.", sourceUrl: "https://oak.test/" }],
    contacts: [{ type: "email", value: "hello@oak.test", purpose: "ENQUIRIES", sourceUrl: "https://oak.test/contact", routingAuthority: "not_operator_confirmed" }],
    spaces: [{ name: "Oak Barn", sourceUrl: "https://oak.test/spaces" }], reviewSpaces: [],
    capacities: [{ space: "Oak Barn", layout: "banquet", count: 80, statement: "Banquet for 80", sourceUrl: "https://oak.test/spaces", reviewRequired: false }],
    practicalFacts: [{ fieldName: "parking", value: "On-site parking", sourceUrl: "https://oak.test/" }],
    suitability: [{ value: "Weddings", sourceUrl: "https://oak.test/weddings" }],
    images: [{ sourceImageUrl: "https://oak.test/barn.jpg", sourcePageUrl: "https://oak.test/", likelyRole: "SPACE", rightsState: "UNKNOWN_RIGHTS", alt: "Barn" }],
    routingAuthority: "not_operator_confirmed", stopReason: "DIMENSIONS_SATISFIED", warnings: [], elapsedMs: 10,
    ...overrides,
  };
}

test("summary counts outcomes and success coverage without double-counting reused bytes", () => {
  const summary = summarizeWave({
    queueCount: 3,
    eligible: 2,
    excluded: 1,
    rows: [row(), row({ listingId: "2", outcome: "ROBOTS_BLOCKED", reusedSharedCrawl: true, bytes: 9999, pages: 0, requests: 0, descriptionEvidence: [], contacts: [], spaces: [], capacities: [], practicalFacts: [], suitability: [], images: [], pdfCount: 0 })],
  });
  assert.equal(summary.outcomes.CRAWL_SUCCESS_USEFUL, 1);
  assert.equal(summary.outcomes.ROBOTS_BLOCKED, 1);
  assert.equal(summary.withSpaces, 1);
  assert.equal(summary.totalBytes, 1000);
  assert.equal(summary.paidProviderCostUsd, 0);
});

test("a repeated new crawler defect in the first fifty venues stops the wave", () => {
  const rows = Array.from({ length: 50 }, (_, index) => row({
    listingId: String(index),
    outcome: index < 11 ? "OTHER_SAFE_FAILURE" : "CRAWL_SUCCESS_THIN",
    outcomeReason: index < 11 ? "TypeError: fetch is not a function" : "PAGE_BUDGET",
    spaces: [],
    capacities: [],
    descriptionEvidence: [],
    pageUrls: ["https://oak.test/"],
  }));
  assert.match(systemicDefect(rows) ?? "", /REPEATED_CRAWLER_DEFECT/);
  assert.equal(systemicDefect(rows.slice(0, 10)), null);
});

test("ordinary mixed site failures are not a systemic crawler defect", () => {
  const outcomes = ["ROBOTS_BLOCKED", "DEAD_OR_UNREACHABLE", "TRANSIENT_NETWORK", "CRAWL_SUCCESS_THIN", "STATIC_RENDER_REQUIRED"] as const;
  const rows = Array.from({ length: 50 }, (_, index) => row({
    listingId: String(index),
    outcome: outcomes[index % outcomes.length],
    spaces: [],
    capacities: [],
    descriptionEvidence: [],
    pageUrls: ["https://oak.test/"],
    sameSite: true,
  }));
  assert.equal(systemicDefect(rows), null);
});
