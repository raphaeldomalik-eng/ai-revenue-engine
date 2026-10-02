import assert from "node:assert/strict";
import test from "node:test";
import { extractFromFetchedDocuments } from "../src/nexus/source-discovery/crawler.ts";
import type { FetchedDocument } from "../src/nexus/source-discovery/types.ts";
import { assertVenueCrawlerDispatch, VenueCrawlerDispatchRefusal } from "../src/nexus/venue-crawler/dispatch.ts";
import { crawlVenue } from "../src/nexus/venue-crawler/crawl.ts";
import { imageDimensions, imagePublication } from "../src/nexus/venue-crawler/images.ts";
import { suitabilityFromText } from "../src/nexus/venue-crawler/facts.ts";
import { synthesiseVenueCopy } from "../src/nexus/venue-crawler/synthesis.ts";
import type { ImageCandidate } from "../src/nexus/source-discovery/extractors/resources.ts";

const origin = "https://venue.org";
const classification = {
  subjectEntityType: "VENUE",
  sourceType: "OFFICIAL_ENTITY_WEBSITE",
  classificationState: "CONFIRMED",
  verifiedOfficialUrl: `${origin}/`,
  venueName: "Harbour Hall",
  candidateReference: { sourceSystem: "event_suite_resources", sourceRecordId: "harbour-hall" },
  locality: "Cape Town",
  region: "Western Cape",
  country: "South Africa",
};

test("Nexus classification gates venue dispatch and leaves other entity types alone", () => {
  assert.doesNotThrow(() => assertVenueCrawlerDispatch(classification));
  assert.throws(() => assertVenueCrawlerDispatch({ ...classification, subjectEntityType: "UNKNOWN" }), VenueCrawlerDispatchRefusal);
  assert.throws(() => assertVenueCrawlerDispatch({ ...classification, subjectEntityType: "EVENT" }), /not dispatched/);
  assert.throws(() => assertVenueCrawlerDispatch({ ...classification, subjectEntityType: "PROMOTER" }), VenueCrawlerDispatchRefusal);
  assert.throws(() => assertVenueCrawlerDispatch({ ...classification, sourceType: "DIRECTORY" }), /official/);
  assert.throws(() => assertVenueCrawlerDispatch({ ...classification, candidateReference: null, canonicalEntityId: null }), /governed/);
});

test("a weddings path is not suitability, and an explicit hosting sentence is", () => {
  assert.deepEqual(suitabilityFromText("Weddings", `${origin}/weddings`), []);
  const found = suitabilityFromText("We host conferences and corporate events in the hall.", `${origin}/conferences`);
  assert.deepEqual(found.map((item) => item.key), ["conference", "corporate_event"]);
});

test("editorial copy uses human wording and drops internal language", () => {
  const copy = synthesiseVenueCopy({
    venueName: "Harbour Hall",
    locality: "Cape Town",
    region: "Western Cape",
    country: "South Africa",
    spaces: ["Grand Hall"],
    capacities: [{ space: "Grand Hall", layout: "banquet", count: 180, statement: "Grand Hall banquet 180", sourceUrl: `${origin}/spaces` }],
    suitability: [{ key: "corporate_event", label: "corporate events", statement: "We host corporate events.", sourceUrl: `${origin}/hire` }],
    practical: [{ key: "parking", statement: "on-site parking", sourceUrl: `${origin}/facilities` }],
  });
  assert.match(copy.summary, /Harbour Hall in Cape Town, Western Cape, South Africa includes Grand Hall/);
  assert.doesNotMatch(copy.description, /corporate_event|discovered|acquisition|inventory|Western Cape\/Gauteng|a event/);
  assert.match(copy.description, /corporate events/);
  assert.match(copy.description, /banquet capacity 180/);
  assert.ok(copy.support.every((item) => item.evidenceRefs.length > 0));
});

test("missing facts stay unknown in the copy", () => {
  const copy = synthesiseVenueCopy({
    venueName: "Scout Hall", locality: null, region: null, country: null, spaces: [], capacities: [], suitability: [], practical: [],
  });
  assert.equal(copy.description.includes("parking"), false);
  assert.equal(copy.description.includes("corporate"), false);
  assert.equal(copy.description.includes("region"), false);
  assert.match(copy.summary, /Scout Hall is listed from its official website/);
});

test("css background, lazy src and srcset images are discovered from a gallery page", () => {
  const document: FetchedDocument = {
    url: `${origin}/gallery`, body: `<div style="background-image:url('/photos/hall-room.jpg')"></div>
      <img src="/blank.gif" data-src="/photos/lazy-terrace.jpg" alt="Terrace">
      <img srcset="/photos/small.jpg 100w, /photos/auditorium.jpg 1600w" alt="Auditorium">
      <img src="/photos/logo.png" alt="Logo">`,
    contentType: "text/html", bytes: 10, sourceHash: "abc", observedAt: "2026-10-02T12:00:00.000Z",
  };
  const images = extractFromFetchedDocuments([document], ["IMAGE_CANDIDATES"]).imageCandidates.map((item) => item.sourceImageUrl);
  assert.ok(images.includes(`${origin}/photos/hall-room.jpg`));
  assert.ok(images.includes(`${origin}/photos/lazy-terrace.jpg`));
  assert.ok(images.includes(`${origin}/photos/auditorium.jpg`));
  assert.equal(images.includes(`${origin}/photos/small.jpg`), false);
});

test("binary dimensions are read from the image bytes", () => {
  const png = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x03, 0x00,
  ]);
  assert.deepEqual(imageDimensions(png), { width: 1024, height: 768 });
});

test("no explicit restriction is publishable and an explicit restriction stays private", () => {
  const base = { sourceImageUrl: `${origin}/a.jpg`, sourcePageUrl: `${origin}/gallery`, filename: "a.jpg", alt: "Hall", title: null, caption: null, width: 1200, height: 800, mime: "image/jpeg", likelyRole: "GALLERY", exactVenue: true, discoveredAt: "2026-10-02T12:00:00.000Z", originDomain: "venue.example", operatorConfirmed: false as const };
  const open = imagePublication({ ...base, rightsState: "UNKNOWN_RIGHTS", rightsEvidence: null });
  assert.equal(open.publication, "PUBLISHABLE");
  assert.equal(open.rightsRecord, "NO_EXPLICIT_RESTRICTION_FOUND");
  const closed = imagePublication({ ...base, rightsState: "RIGHTS_RESERVED", rightsEvidence: { basis: "EXPLICIT_RIGHTS_RESERVED", sourceUrl: `${origin}/gallery`, evidenceRef: "rights:1", statement: "All rights reserved" } });
  assert.equal(closed.publication, "PRIVATE_OWNER_REVIEW");
});

test("the venue crawl prefers gallery and space pages and does not invent parking or a default event use", async () => {
  const pages: Record<string, string> = {
    "/": `<a href="/gallery">Gallery</a><a href="/spaces">Our spaces</a><a href="/weddings">Weddings</a><a href="/blog">Blog</a><a href="/contact">Contact</a><h1>Harbour Hall</h1>`,
    "/gallery": `<img src="/photos/hall.jpg" alt="Grand Hall interior">`,
    "/spaces": `<h2>Grand Hall</h2><p>Banquet capacity 180.</p><p>We host conferences in the Grand Hall.</p>`,
    "/weddings": `<h1>Weddings</h1>`,
    "/blog": `<p>News</p>`,
    "/contact": `<p>Bookings email: bookings@venue.org</p><footer>Website by Pixel Studio. hello@pixelstudio.org</footer>`,
    "/sitemap.xml": `<urlset><url><loc>${origin}/gallery</loc></url></urlset>`,
  };
  const result = await crawlVenue(classification, {
    probeImages: false,
    knownDimensions: { [`${origin}/photos/hall.jpg`]: { width: 1600, height: 900 } },
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    budget: { ...{ maxPages: 8, maxRequests: 12, maxBytesPerResponse: 100000, maxRedirects: 1, maxRetries: 0, timeoutMs: 1000, minRequestDelayMs: 0, maxPdfDocuments: 1, maxSitemapFetches: 2 } },
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /\n", { status: 200 });
      const body = pages[url.pathname];
      return new Response(body ?? "missing", { status: body ? 200 : 404, headers: { "content-type": "text/html" } });
    },
  });
  assert.ok(result.pagesFetched.some((url) => url.endsWith("/gallery")));
  assert.ok(result.pagesFetched.some((url) => url.endsWith("/spaces")));
  assert.equal(result.pagesFetched.some((url) => url.endsWith("/blog")), false);
  assert.deepEqual(result.spaces, ["Grand Hall"]);
  assert.equal(result.capacities.some((item) => item.count === 180 && item.layout === "banquet"), true);
  assert.deepEqual(result.suitability.map((item) => item.key), ["conference"]);
  assert.equal(result.practical.some((item) => item.key === "parking"), false);
  assert.equal(result.contacts.some((item) => item.value === "bookings@venue.org" && !item.reviewRequired), true);
  assert.equal(result.contacts.some((item) => item.value === "hello@pixelstudio.org" && item.reviewRequired), true);
  assert.equal(result.images.hero?.sourceImageUrl, `${origin}/photos/hall.jpg`);
  assert.equal(result.images.hero?.rightsRecord, "NO_EXPLICIT_RESTRICTION_FOUND");
  assert.doesNotMatch(`${result.summary} ${result.description}`, /corporate_event|discovered|acquisition|inventory|Western Cape\/Gauteng|parking/);
});

test("sitemap discovery supplies a gallery the homepage does not link", async () => {
  const pages: Record<string, string> = {
    "/": `<h1>Harbour Hall</h1><a href="/about">About the venue</a>`,
    "/about": `<p>Harbour Hall is a hall.</p>`,
    "/gallery": `<img src="/photos/garden.jpg" alt="Garden">`,
    "/sitemap.xml": `<urlset><url><loc>${origin}/gallery</loc></url></urlset>`,
  };
  const result = await crawlVenue(classification, {
    probeImages: false,
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    budget: { maxPages: 6, maxRequests: 10, maxBytesPerResponse: 100000, maxRedirects: 1, maxRetries: 0, timeoutMs: 1000, minRequestDelayMs: 0, maxSitemapFetches: 2 },
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /", { status: 200 });
      const body = pages[url.pathname];
      return new Response(body ?? "missing", { status: body ? 200 : 404, headers: { "content-type": "text/html" } });
    },
  });
  assert.equal(result.sitemapConsulted, true);
  assert.ok(result.pagesFetched.some((url) => url.endsWith("/gallery")));
});

test("an image candidate type stays compatible with the rights helper", () => {
  const candidate = { rightsState: "VERIFIED_REUSABLE", rightsEvidence: { basis: "CC_BY", sourceUrl: origin, evidenceRef: "r", statement: "CC BY 4.0" } } as ImageCandidate;
  assert.equal(imagePublication(candidate).rightsRecord, "CC_BY");
});
