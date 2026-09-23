import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPublicNetworkTarget,
  crawlVerifiedSource,
  extractFromFetchedDocuments,
  isPublicHttpsUrl,
  isPublicNetworkAddress,
  type CrawlBudget,
  type ResolveHost,
} from "../src/nexus/source-discovery/crawler.ts";
import { discoverLikelyEventDetailUrls, discoverUsefulSourceUrls } from "../src/nexus/source-discovery/links.ts";
import type { FetchedDocument } from "../src/nexus/source-discovery/types.ts";

const publicResolver: ResolveHost = async () => [{ address: "93.184.216.34", family: 4 }];

function budget(overrides: Partial<CrawlBudget> = {}): CrawlBudget {
  return {
    maxPages: 2,
    maxRequests: 4,
    maxBytesPerResponse: 10_000,
    maxRedirects: 1,
    maxRetries: 1,
    timeoutMs: 1_000,
    minRequestDelayMs: 0,
    ...overrides,
  };
}

function document(body: string, url = "https://venue.example/"): FetchedDocument {
  return { url, body, contentType: "text/html", bytes: Buffer.byteLength(body), sourceHash: "fixture", observedAt: "2026-09-22T09:00:00.000Z" };
}

test("shared crawl safety rejects credentials, reserved addresses, mixed DNS, and unsafe redirects", async () => {
  assert.equal(isPublicHttpsUrl("https://user:pass@venue.example/events"), false);
  assert.equal(isPublicNetworkAddress("10.0.0.1"), false);
  assert.equal(isPublicNetworkAddress("::1"), false);
  assert.equal(isPublicNetworkAddress("::ffff:192.168.0.8"), false);
  await assert.rejects(
    () => assertPublicNetworkTarget("https://venue.example/", async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.9", family: 4 },
    ]),
    /private or reserved network address/,
  );

  const requested: string[] = [];
  const redirected = await crawlVerifiedSource({
    verifiedUrl: "https://venue.example/",
    requestedExtractors: ["EVENTS"],
    budget: budget(),
    resolveHost: async (hostname) => hostname === "private.example"
      ? [{ address: "10.0.0.4", family: 4 }]
      : [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (input) => {
      requested.push(String(input));
      if (String(input).endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /");
      return new Response(null, { status: 302, headers: { location: "https://private.example/events" } });
    },
  });
  assert.equal(redirected.stats.blockedCount, 1);
  assert.equal(requested.includes("https://private.example/events"), false);
});

test("shared crawl budgets count robots, retries, and every attempted request", async () => {
  const requested: string[] = [];
  let homepageAttempts = 0;
  const result = await crawlVerifiedSource({
    verifiedUrl: "https://venue.example/",
    requestedExtractors: ["EVENTS"],
    budget: budget({ maxPages: 1, maxRequests: 3 }),
    resolveHost: publicResolver,
    fetchImpl: async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /");
      homepageAttempts += 1;
      if (homepageAttempts === 1) return new Response("retry", { status: 503 });
      return new Response("<html><body>ok</body></html>");
    },
  });

  assert.equal(requested.length, 3);
  assert.equal(result.stats.requestCount, 3);
  assert.equal(result.stats.retries, 1);
  assert.equal(result.stats.pageCount, 1);
});

test("shared crawl budgets include robots in the finite request ceiling", async () => {
  const requested: string[] = [];
  const result = await crawlVerifiedSource({
    verifiedUrl: "https://venue.example/",
    requestedExtractors: ["EVENTS"],
    budget: budget({ maxPages: 2, maxRequests: 2, maxRetries: 0 }),
    resolveHost: publicResolver,
    fetchImpl: async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /");
      return new Response('<a href="/events">Events</a>');
    },
  });

  assert.deepEqual(requested, ["https://venue.example/robots.txt", "https://venue.example/"]);
  assert.equal(result.stats.requestCount, 2);
  assert.equal(result.stats.pageCount, 1);
  assert.match(result.stats.warnings.join(" "), /budget/i);
});

test("shared crawl budgets count a robots denial as one blocked request", async () => {
  const result = await crawlVerifiedSource({
    verifiedUrl: "https://venue.example/private",
    requestedExtractors: ["IDENTITY"],
    budget: budget(),
    resolveHost: publicResolver,
    fetchImpl: async () => new Response("User-agent: *\nDisallow: /private"),
  });

  assert.equal(result.stats.requestCount, 1);
  assert.equal(result.stats.pageCount, 0);
  assert.equal(result.stats.blockedCount, 1);
  assert.equal(result.stats.status, "BLOCKED");
});

test("shared source planning ranks strong first-party event links deterministically", () => {
  const page = document(`
    <a href="/about">About</a>
    <a href="https://tickets.example/events">External events</a>
    <a href="/calendar">What's on</a>
    <a href="/events/spring">Spring programme</a>
    <a href="/events">Events</a>
    <a href="/events#duplicate">Events duplicate</a>
  `);

  assert.deepEqual(discoverUsefulSourceUrls(page, ["EVENTS"]), [
    "https://venue.example/calendar",
    "https://venue.example/events",
    "https://venue.example/events/spring",
  ]);
});

test("shared detail planning keeps same-origin event detail candidates in stable score order", () => {
  const page = document(`
    <a href="/events">Same page</a>
    <a href="/events/archive">Archive</a>
    <a href="/events/2026-10-12/jazz-night">Jazz Night — 12 Oct 2026</a>
    <a href="/events/jazz-night">Jazz Night</a>
    <a href="/contact/2026">Dated but irrelevant</a>
    <a href="https://other.example/events/2026/show">External</a>
    <a href="/events/jazz-night#duplicate">Duplicate</a>
  `, "https://venue.example/events");

  assert.deepEqual(discoverLikelyEventDetailUrls(page), [
    "https://venue.example/events/2026-10-12/jazz-night",
    "https://venue.example/events/archive",
    "https://venue.example/events/jazz-night",
  ]);
});

test("a source page without structured events can enqueue a bounded event detail page", async () => {
  const requested: string[] = [];
  const result = await crawlVerifiedSource({
    verifiedUrl: "https://venue.example/",
    requestedExtractors: ["EVENTS"],
    budget: budget({ maxPages: 3, maxRequests: 4, maxRetries: 0 }),
    resolveHost: publicResolver,
    fetchImpl: async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /");
      if (url === "https://venue.example/") return new Response('<a href="/events">Events</a>');
      if (url === "https://venue.example/events") return new Response('<a href="/events/2026/jazz-night">Jazz Night 2026</a>');
      return new Response("<html>detail</html>");
    },
  });

  assert.deepEqual(requested, [
    "https://venue.example/robots.txt",
    "https://venue.example/",
    "https://venue.example/events",
    "https://venue.example/events/2026/jazz-night",
  ]);
  assert.equal(result.stats.pageCount, 3);
});

test("shared event extraction normalizes nested Event and MusicEvent data without inventing optional facts", () => {
  const extracted = extractFromFetchedDocuments([document(`
    <script type="application/ld+json">{
      "@graph": [
        {"@type":"WebSite","name":"Venue"},
        {"@type":["Thing","MusicEvent"],"name":"  Autumn Jazz  ","startDate":"2026-10-22T19:30:00Z",
         "endDate":"2026-10-22T22:00:00Z","url":"/events/autumn-jazz","eventStatus":"EventScheduled",
         "description":"Live quartet.","organizer":{"name":"Venue Music"},
         "performer":[{"name":"The Quartet"},"Guest Artist"],"eventType":"Concert",
         "location":{"name":"Grand Hall"},"offers":{"url":"https://tickets.example/autumn","price":25},
         "image":{"url":"/images/autumn.jpg"}}
      ]
    }</script>
    <script type="application/ld+json">{"@type":"Event", malformed}</script>
  `)], ["EVENTS"]);

  assert.equal(extracted.eventCandidates.length, 1);
  assert.deepEqual(extracted.eventCandidates[0], {
    title: "Autumn Jazz",
    sourceEventUrl: "https://venue.example/events/autumn-jazz",
    sourcePageUrl: "https://venue.example/",
    venueText: "Grand Hall",
    startAt: "2026-10-22T19:30:00Z",
    endAt: "2026-10-22T22:00:00Z",
    timezone: null,
    eventStatus: "EventScheduled",
    description: "Live quartet.",
    organiser: "Venue Music",
    performers: ["The Quartet", "Guest Artist"],
    sourceCategory: "Concert",
    ticketUrl: "https://tickets.example/autumn",
    ticketDomain: "tickets.example",
    priceText: "25",
    ageRestriction: null,
    eventImageUrl: "https://venue.example/images/autumn.jpg",
    sourceFingerprint: extracted.eventCandidates[0]!.sourceFingerprint,
    observedAt: "2026-09-22T09:00:00.000Z",
    state: "DISCOVERED",
    confidence: null,
  });
  assert.match(extracted.warnings.join(" "), /malformed JSON-LD/i);
});

test("event fingerprints ignore observation time and semantic deduplication prefers canonical URL", () => {
  const body = `<script type="application/ld+json">{"@type":"Event","name":"Autumn Jazz","startDate":"2026-10-22T19:30:00Z","url":"/events/autumn-jazz","location":{"name":"Grand Hall"}}</script>`;
  const first = document(body);
  const second = { ...document(body, "https://venue.example/calendar"), observedAt: "2026-09-23T09:00:00.000Z" };
  const extracted = extractFromFetchedDocuments([first, second], ["EVENTS"]);

  assert.equal(extracted.eventCandidates.length, 1);
  assert.equal(
    extractFromFetchedDocuments([first], ["EVENTS"]).eventCandidates[0]!.sourceFingerprint,
    extractFromFetchedDocuments([second], ["EVENTS"]).eventCandidates[0]!.sourceFingerprint,
  );
});

test("event semantic deduplication falls back to normalized title date and venue and requires a start date", () => {
  const first = document(`<script type="application/ld+json">[
    {"@type":"Event","name":" Autumn   Jazz ","startDate":"2026-10-22T19:30:00Z","location":{"name":"Grand Hall"}},
    {"@type":"Event","name":"No Date","location":{"name":"Grand Hall"}}
  ]</script>`, "https://venue.example/events");
  const second = document(`<script type="application/ld+json">{"@type":"MusicEvent","name":"autumn jazz","startDate":"2026-10-22T20:30:00+01:00","location":{"name":" grand hall "}}</script>`, "https://venue.example/calendar");
  const extracted = extractFromFetchedDocuments([first, second], ["EVENTS"]);

  assert.equal(extracted.eventCandidates.length, 1);
  assert.equal(extracted.eventCandidates[0]?.title, "Autumn Jazz");
});

test("each extracted Resource fact carries its own deterministic evidence reference", () => {
  const extracted = extractFromFetchedDocuments([document(`
    <title>Example Venue</title><h1>Grand Hall</h1>
    <a href="mailto:events@example.com">Email</a><a href="tel:+441234567890">Phone</a>
    <p>Capacity: 500 standing. Step-free access.</p>
  `)], ["IDENTITY", "PUBLIC_CONTACT", "VENUE_FACTS"]);

  const refs = [
    ...extracted.identityFacts.map((item) => item.evidenceRef),
    ...extracted.publicContacts.map((item) => item.evidenceRef),
    ...extracted.venueFacts.map((item) => item.evidenceRef),
  ];
  assert.equal(refs.every(Boolean), true);
  assert.equal(new Set(refs).size, refs.length);
  assert.equal(refs.every((ref) => extracted.evidenceRefs.includes(ref)), true);
});

test("complete required HTML traversal returns COMPLETED", async () => {
  const result = await crawlVerifiedSource({
    verifiedUrl: "https://venue.example/events",
    requestedExtractors: ["EVENTS"],
    budget: budget({ maxPages: 5, maxRequests: 10 }),
    resolveHost: publicResolver,
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /");
      if (url === "https://venue.example/events") {
        return new Response(`
          <a href="/events/2026/gig-1">Gig 1</a>
          <a href="/events/2026/gig-2">Gig 2</a>
        `);
      }
      return new Response(`
        <html>
          <head>
            <script type="application/ld+json">
              {"@type":"MusicEvent","name":"Gig","startDate":"2026-10-01T19:00:00Z","url":"${url}"}
            </script>
          </head>
          <body>Detail</body>
        </html>
      `);
    },
  });

  assert.equal(result.stats.status, "COMPLETED");
  assert.equal(result.stats.pageCount, 3);
  assert.equal(result.stats.warnings.length, 0);
});

test("real required HTML left unfetched triggers PARTIAL", async () => {
  const result = await crawlVerifiedSource({
    verifiedUrl: "https://venue.example/events",
    requestedExtractors: ["EVENTS"],
    budget: budget({ maxPages: 2, maxRequests: 5 }),
    resolveHost: publicResolver,
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /");
      if (url === "https://venue.example/events") {
        return new Response(`
          <a href="/events/2026/gig-1">Gig 1</a>
          <a href="/events/2026/gig-2">Gig 2</a>
          <a href="/events/2026/gig-3">Gig 3</a>
        `);
      }
      return new Response("<html>Detail</html>");
    },
  });

  assert.equal(result.stats.status, "PARTIAL");
  assert.equal(result.stats.pageCount, 2);
  assert.match(result.stats.warnings.join(" "), /Required HTML pages remain beyond the finite crawl budget/i);
});

test("optional calendar omission alone does not trigger PARTIAL", async () => {
  const result = await crawlVerifiedSource({
    verifiedUrl: "https://venue.example/events",
    requestedExtractors: ["EVENTS"],
    budget: budget({ maxPages: 3, maxRequests: 3 }),
    resolveHost: publicResolver,
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /");
      if (url === "https://venue.example/events") {
        return new Response(`
          <a href="/events/2026/gig-1">Gig 1</a>
          <a href="/events/2026/gig-1?format=ical">iCal</a>
        `);
      }
      return new Response(`
        <html>
          <head>
            <script type="application/ld+json">
              {"@type":"MusicEvent","name":"Gig 1","startDate":"2026-10-01T19:00:00Z","url":"${url}"}
            </script>
          </head>
          <body><a href="${url}?format=ical">iCal</a></body>
        </html>
      `);
    },
  });

  assert.equal(result.stats.status, "COMPLETED");
  assert.equal(result.stats.pageCount, 2);
  assert.match(result.stats.warnings.join(" "), /Optional calendar evidence was omitted/i);
});

test("discoverLikelyEventDetailUrls ignores optional calendar export links", () => {
  const page = document(`
    <a href="/events/2026-10-12/jazz-night">Jazz Night — 12 Oct 2026</a>
    <a href="/events/2026-10-12/jazz-night?format=ical">iCal</a>
    <a href="/events/2026-10-12/jazz-night.ics">ICS</a>
  `, "https://venue.example/events");

  assert.deepEqual(discoverLikelyEventDetailUrls(page), [
    "https://venue.example/events/2026-10-12/jazz-night",
  ]);
});

