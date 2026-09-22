import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPublicNetworkTarget,
  crawlVerifiedSource,
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
