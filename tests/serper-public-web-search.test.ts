import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CONTRACTS } from "../src/nexus/contracts.ts";
import { candidateRejection, configuredPublicWebSearchProvider, executeOfficialWebsiteDiscovery, type PublicWebSearchProvider } from "../src/nexus/official-website-discovery.ts";
import { crawlVenueOfficialSite } from "../src/nexus/source-discovery/venue/crawl.ts";
import {
  PUBLIC_WEB_SEARCH_REQUEST_CAP,
  PublicWebSearchBudgetExhaustedError,
  PublicWebSearchProviderFailure,
  SERPER_PUBLIC_WEB_SEARCH_PROVIDER_ID,
  SERPER_SEARCH_URL,
  createPublicWebSearchBudget,
  createSerperPublicWebSearchProvider,
  mapSerperOrganicResults,
  programmePublicWebSearchBudget,
  recordPublicWebSearchVerification,
  setPublicWebSearchVenue,
} from "../src/nexus/search/serper-public-web-search.ts";

const NOW = "2026-10-03T12:00:00.000Z";
const resolver = async () => [{ address: "93.184.216.34", family: 4 }];
const CORNEX_HOME = "<html><head><title>Cornex Hall | Events venue in Bristol</title></head><body><h1>Cornex Hall</h1><address>12 Mill Lane, Bristol BS1 4AA</address><a href=\"mailto:events@cornexhall.co.uk\">events@cornexhall.co.uk</a><a href=\"/venue-hire\">Venue hire</a></body></html>";
const WRONG_CITY = "<html><head><title>Cornex Hall | Leeds</title></head><body><h1>Cornex Hall</h1><address>4 Dock Road, Leeds LS1 1AA</address></body></html>";

function discoveryRequest(overrides: Record<string, unknown> = {}, identity: Record<string, unknown> = {}) {
  return {
    contractVersion: CONTRACTS.OFFICIAL_WEBSITE_DISCOVERY_REQUEST,
    requestId: "11111111-1111-4111-8111-111111111111",
    idempotencyKey: "22222222-2222-4222-8222-222222222222",
    correlationId: "33333333-3333-4333-8333-333333333333",
    originatingProduct: "event_suite_resources",
    subject: { canonicalEntityId: "44444444-4444-4444-8444-444444444444", candidateReference: null, entityType: "VENUE" },
    identity: { venueName: "Cornex Hall", locality: "Bristol", administrativeRegion: "England", country: "GB", formattedAddress: "12 Mill Lane, Bristol BS1 4AA, UK", placeId: "places/cornex", placeIdEvidenceRef: "external_reference:cornex", ...identity },
    providerAllowances: ["PUBLIC_WEB_SEARCH", "PUBLIC_WEB"],
    costCeiling: { currency: "USD", amount: 0 },
    requestedBy: { actorType: "SYSTEM", actorId: "aire-official-website-discovery" },
    createdAt: NOW,
    ...overrides,
  };
}

function siteFetch(sites: Record<string, string>) {
  const seen: string[] = [];
  const fetchImpl = async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    if (/googleapis|places\.google|google\.com\/maps/.test(url)) throw new Error("GOOGLE_MUST_NOT_BE_CALLED");
    const parsed = new URL(url);
    if (parsed.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /", { status: 200 });
    const body = sites[url];
    if (body == null) return new Response("", { status: 404, headers: { "content-type": "text/html" } });
    return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
  };
  return { fetchImpl, seen };
}

function serperFetch(payload: unknown, capture?: { body?: unknown; url?: string; headers?: Headers }) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    if (capture) {
      capture.url = String(input);
      capture.body = JSON.parse(String(init?.body ?? "{}"));
      capture.headers = new Headers(init?.headers);
    }
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };
}

test("Serper organic results map to URL, title, and snippet only", () => {
  const mapped = mapSerperOrganicResults({
    searchParameters: { q: "ignored" },
    knowledgeGraph: { website: "https://kg.example/should-not-be-used" },
    organic: [
      { title: "Cornex Hall", link: "https://www.cornexhall.co.uk/", snippet: "Events in Bristol", position: 1, sitelinks: [{ link: "https://www.cornexhall.co.uk/secret" }] },
    ],
    credits: 2499,
  }, 8);
  assert.deepEqual(mapped, [{ url: "https://www.cornexhall.co.uk/", title: "Cornex Hall", snippet: "Events in Bristol" }]);
  assert.deepEqual(Object.keys(mapped[0]!), ["url", "title", "snippet"]);
});

test("ZA search uses South African Serper localisation and keeps the query text", async () => {
  const capture: { body?: any } = {};
  const provider = createSerperPublicWebSearchProvider({ apiKey: "test-serper-key", budget: createPublicWebSearchBudget(), fetchImpl: serperFetch({ organic: [] }, capture) });
  await provider.search({ query: "\"Cape Hall\" \"Cape Town\" \"South Africa\" official website", country: "ZA", maxResults: 8 });
  assert.equal(capture.body.q, "\"Cape Hall\" \"Cape Town\" \"South Africa\" official website");
  assert.equal(capture.body.gl, "za");
  assert.equal(capture.body.hl, "en");
  assert.equal(capture.body.location, "South Africa");
  assert.equal(capture.body.num, 8);
});

test("GB search uses UK Serper localisation and keeps the query text", async () => {
  const capture: { body?: any; url?: string } = {};
  const provider = createSerperPublicWebSearchProvider({ apiKey: "test-serper-key", budget: createPublicWebSearchBudget(), fetchImpl: serperFetch({ organic: [] }, capture) });
  await provider.search({ query: "\"Cornex Hall\" \"Bristol\" \"United Kingdom\" official website", country: "GB", maxResults: 8 });
  assert.equal(capture.url, SERPER_SEARCH_URL);
  assert.equal(capture.body.q, "\"Cornex Hall\" \"Bristol\" \"United Kingdom\" official website");
  assert.equal(capture.body.gl, "uk");
  assert.equal(capture.body.hl, "en");
  assert.equal(capture.body.location, "United Kingdom");
});

test("malformed Serper results are ignored", () => {
  const mapped = mapSerperOrganicResults({
    organic: [
      null,
      "nope",
      { title: "Missing link" },
      { link: "javascript:alert(1)", title: "Bad" },
      { link: "https://user:pass@example.com/", title: "Credentials" },
      { link: "not a url" },
      { link: "https://www.cornexhall.co.uk/about", title: 12, snippet: { html: "no" } },
    ],
  }, 8);
  assert.deepEqual(mapped, [{ url: "https://www.cornexhall.co.uk/about", title: null, snippet: null }]);
  assert.deepEqual(mapSerperOrganicResults({ knowledgeGraph: { website: "https://example.com" } }, 8), []);
  assert.deepEqual(mapSerperOrganicResults(null, 8), []);
});

test("a Serper API or network error is a retryable provider failure and does not fall back to Google Places", async () => {
  const key = "test-serper-key";
  let fetches = 0;
  const budget = createPublicWebSearchBudget();
  const provider = createSerperPublicWebSearchProvider({
    apiKey: key,
    budget,
    fetchImpl: async () => {
      fetches += 1;
      return new Response("unavailable", { status: 503 });
    },
  });
  await assert.rejects(() => provider.search({ query: "Cornex Hall", country: "GB", maxResults: 5 }), (error: unknown) => {
    assert.ok(error instanceof PublicWebSearchProviderFailure);
    assert.equal(error.retryable, true);
    assert.equal(error.status, 503);
    assert.equal(error.message.includes(key), false);
    return true;
  });
  assert.equal(fetches, 1);
  assert.equal(budget.used, 1);

  let networkFetches = 0;
  const network = createSerperPublicWebSearchProvider({
    apiKey: key,
    budget: createPublicWebSearchBudget(),
    fetchImpl: async () => {
      networkFetches += 1;
      throw new Error("socket hang up");
    },
  });
  await assert.rejects(() => network.search({ query: "Cornex Hall", country: "ZA", maxResults: 5 }), (error: unknown) => error instanceof PublicWebSearchProviderFailure && error.retryable === true && error.status === null);
  assert.equal(networkFetches, 1);

  let googleCalls = 0;
  const google = async () => { googleCalls += 1; throw new Error("GOOGLE_MUST_NOT_BE_CALLED"); };
  const { fetchImpl, seen } = siteFetch({});
  const result = await executeOfficialWebsiteDiscovery(discoveryRequest({ idempotencyKey: "88888888-8888-4888-8888-888888888888" }), {
    searchProvider: provider,
    fetchImpl,
    resolveHost: resolver,
    now: () => NOW,
    googlePlaceDetails: google,
    googlePlaces: google,
  } as Parameters<typeof executeOfficialWebsiteDiscovery>[1]) as any;
  assert.equal(result.status, "SEARCH_PROVIDER_UNAVAILABLE");
  assert.equal(result.retryable, true);
  assert.equal(result.googlePlacesCalls, 0);
  assert.equal(result.officialWebsite, null);
  assert.equal(googleCalls, 0);
  assert.equal(seen.some((url) => /google/.test(url)), false);
  assert.equal(result.providerUsage.find((item: any) => item.provider === "GOOGLE_PLACES").callCount, 0);
});

test("a missing SERPER_API_KEY leaves the public web search provider unavailable", async () => {
  const saved = process.env.SERPER_API_KEY;
  delete process.env.SERPER_API_KEY;
  let fetches = 0;
  try {
    assert.equal(configuredPublicWebSearchProvider(), null);
    const provider = createSerperPublicWebSearchProvider({ budget: createPublicWebSearchBudget(), fetchImpl: async () => { fetches += 1; return new Response("{}"); } });
    await assert.rejects(() => provider.search({ query: "Cornex Hall", country: "GB", maxResults: 5 }), (error: unknown) => error instanceof PublicWebSearchProviderFailure && error.retryable === true);
    assert.equal(fetches, 0);
    const { fetchImpl, seen } = siteFetch({});
    const result = await executeOfficialWebsiteDiscovery(discoveryRequest({ idempotencyKey: "99999999-9999-4999-8999-999999999999" }), { searchProvider: configuredPublicWebSearchProvider(), fetchImpl, resolveHost: resolver, now: () => NOW }) as any;
    assert.equal(result.status, "SEARCH_PROVIDER_UNAVAILABLE");
    assert.equal(result.googlePlacesCalls, 0);
    assert.equal(result.search.callCount, 0);
    assert.match(result.unknowns.join(" "), /Google Places was not used/);
    assert.equal(seen.length, 0);
  } finally {
    if (saved === undefined) delete process.env.SERPER_API_KEY;
    else process.env.SERPER_API_KEY = saved;
  }
});

test("the venue search budget cannot exceed 2,500 requests", async () => {
  assert.equal(PUBLIC_WEB_SEARCH_REQUEST_CAP, 2500);
  const budget = createPublicWebSearchBudget(9_000);
  let fetches = 0;
  const provider = createSerperPublicWebSearchProvider({
    apiKey: "test-serper-key",
    budget,
    fetchImpl: async () => {
      fetches += 1;
      return new Response(JSON.stringify({ organic: [] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  for (let index = 0; index < PUBLIC_WEB_SEARCH_REQUEST_CAP; index += 1) {
    await provider.search({ query: `venue ${index}`, country: index % 2 === 0 ? "ZA" : "GB", maxResults: 1 });
  }
  assert.equal(budget.used, 2500);
  assert.equal(budget.cap, 2500);
  assert.equal(fetches, 2500);
  await assert.rejects(() => provider.search({ query: "one more", country: "GB", maxResults: 1 }), (error: unknown) => error instanceof PublicWebSearchBudgetExhaustedError);
  assert.equal(fetches, 2500);
  assert.equal(budget.used, 2500);

  let blockedFetches = 0;
  const blocked = createSerperPublicWebSearchProvider({
    apiKey: "test-serper-key",
    budget,
    fetchImpl: async () => { blockedFetches += 1; return new Response("{}"); },
  });
  const result = await executeOfficialWebsiteDiscovery(discoveryRequest({ idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }), { searchProvider: blocked, fetchImpl: siteFetch({}).fetchImpl, resolveHost: resolver, now: () => NOW }) as any;
  assert.equal(blockedFetches, 0);
  assert.equal(result.status, "PUBLIC_WEB_SEARCH_BUDGET_EXHAUSTED");
  assert.equal(result.retryable, false);
  assert.equal(result.search.callCount, 0);
  assert.equal(result.googlePlacesCalls, 0);
  assert.match(result.unknowns.join(" "), /PUBLIC_WEB_SEARCH_BUDGET_EXHAUSTED/);
});

test("returned social, directory, ticketing, maps, and booking URLs stay rejected, and a verified first-party site is crawled", async () => {
  const organic = [
    { title: "Cornex Hall | Events venue in Bristol", link: "https://www.cornexhall.co.uk/about", snippet: "Official" },
    { title: "Cornex Hall | Facebook", link: "https://www.facebook.com/cornexhall", snippet: "Social" },
    { title: "Cornex Hall Instagram", link: "https://www.instagram.com/cornexhall/", snippet: "Social" },
    { title: "Cornex Hall TikTok", link: "https://www.tiktok.com/@cornexhall", snippet: "Social" },
    { title: "Cornex Hall LinkedIn", link: "https://www.linkedin.com/company/cornex-hall", snippet: "Social" },
    { title: "Cornex Hall YouTube", link: "https://www.youtube.com/watch?v=cornex", snippet: "Social" },
    { title: "Cornex Hall links", link: "https://linktr.ee/cornexhall", snippet: "Link in bio" },
    { title: "Cornex Hall directory", link: "https://www.hitched.co.uk/wedding-venues/cornex-hall", snippet: "Directory" },
    { title: "Cornex Hall tickets", link: "https://www.eventbrite.co.uk/e/cornex-hall-tickets", snippet: "Tickets" },
    { title: "Cornex Hall maps", link: "https://www.google.com/maps/place/Cornex+Hall", snippet: "Maps" },
  ];
  assert.equal(candidateRejection(mapSerperOrganicResults({ organic: [{ link: "https://www.booking.com/hotel/gb/cornex.html", title: "Cornex" }] }, 1)[0]!.url), "TRAVEL_OR_BOOKING_PLATFORM");
  const budget = createPublicWebSearchBudget();
  setPublicWebSearchVenue(budget, "44444444-4444-4444-8444-444444444444");
  const provider = createSerperPublicWebSearchProvider({ apiKey: "test-serper-key", budget, fetchImpl: serperFetch({ organic, knowledgeGraph: { website: "https://www.facebook.com/cornexhall" } }) });
  const { fetchImpl, seen } = siteFetch({ "https://www.cornexhall.co.uk/": CORNEX_HOME, "https://www.cornexhall.co.uk/about": CORNEX_HOME, "https://www.cornexhall.co.uk/venue-hire": CORNEX_HOME });
  const result = await executeOfficialWebsiteDiscovery(discoveryRequest({ idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }), { searchProvider: provider, fetchImpl, resolveHost: resolver, now: () => NOW, maxResultsPerQuery: 10 }) as any;
  const reasons = Object.fromEntries(result.candidates.map((item: any) => [new URL(item.url).hostname.replace(/^www\./, ""), item.reasons[0]]));
  assert.equal(reasons["facebook.com"], "SOCIAL_PROFILE");
  assert.equal(reasons["instagram.com"], "SOCIAL_PROFILE");
  assert.equal(reasons["tiktok.com"], "SOCIAL_PROFILE");
  assert.equal(reasons["linkedin.com"], "SOCIAL_PROFILE");
  assert.equal(reasons["youtube.com"], "SOCIAL_PROFILE");
  assert.equal(reasons["linktr.ee"], "SOCIAL_PROFILE");
  assert.equal(reasons["hitched.co.uk"], "DIRECTORY");
  assert.equal(reasons["eventbrite.co.uk"], "TICKETING");
  assert.equal(reasons["google.com"], "MAPS_OR_SEARCH_ENGINE");
  assert.equal(result.websiteStatus, "OFFICIAL_WEBSITE_DISCOVERED_AND_VERIFIED");
  assert.equal(result.officialWebsite.source, "PUBLIC_WEB_SEARCH_VERIFIED");
  assert.equal(result.officialWebsite.url, "https://www.cornexhall.co.uk/");
  assert.equal(result.sourceDiscovery.contractVersion, CONTRACTS.SOURCE_DISCOVERY_RESULT);
  assert.equal(result.crawl.sourceDiscoveryCrawls, 1);
  assert.equal(result.googlePlacesCalls, 0);
  assert.equal(seen.some((url) => /facebook|instagram|tiktok|linkedin|youtube|linktr|hitched|eventbrite|booking/.test(url)), false);
  assert.equal(provider.id, SERPER_PUBLIC_WEB_SEARCH_PROVIDER_ID);
  assert.deepEqual(provider.costModel, { kind: "METERED", currency: "USD", amountPerCall: 0 });
  recordPublicWebSearchVerification(budget, "44444444-4444-4444-8444-444444444444", "OFFICIAL_SITE_VERIFIED");
  assert.equal(budget.entries[0]?.verificationOutcome, "OFFICIAL_SITE_VERIFIED");
  assert.deepEqual(budget.entries[0]?.candidateUrls.includes("https://www.facebook.com/cornexhall"), true);
  assert.equal(JSON.stringify(budget.entries[0]).includes("knowledgeGraph"), false);

  const crawled = await crawlVenueOfficialSite({ authorisedUrl: result.officialWebsite.url, venueName: "Cornex Hall", fetchImpl, resolveHost: resolver, now: () => new Date(NOW) });
  assert.equal(crawled.refusal, null);
  assert.equal(crawled.sameSite, true);
  assert.equal(crawled.crawl?.finalUrl.startsWith("https://www.cornexhall.co.uk/"), true);
  assert.ok((crawled.crawl?.documents.length ?? 0) > 0);
});

test("a second search runs only when the first query does not verify a candidate", async () => {
  const queries: string[] = [];
  const provider: PublicWebSearchProvider = {
    id: "fixture-search",
    costModel: { kind: "ZERO_INCREMENTAL", currency: "USD", amountPerCall: 0 },
    async search({ query }) {
      queries.push(query);
      if (queries.length === 1) return [{ url: "https://www.cornexhall-leeds.co.uk/", title: "Cornex Hall" }];
      return [{ url: "https://www.cornexhall.co.uk/", title: "Cornex Hall | Events venue in Bristol" }];
    },
  };
  const { fetchImpl } = siteFetch({ "https://www.cornexhall-leeds.co.uk/": WRONG_CITY, "https://www.cornexhall.co.uk/": CORNEX_HOME });
  const recovered = await executeOfficialWebsiteDiscovery(discoveryRequest({ idempotencyKey: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }), { searchProvider: provider, fetchImpl, resolveHost: resolver, now: () => NOW }) as any;
  assert.equal(queries.length, 2);
  assert.match(queries[0]!, /"Cornex Hall" "Bristol" "United Kingdom" official website/);
  assert.match(queries[1]!, /"Cornex Hall" "BS1 4AA"/);
  assert.equal(recovered.officialWebsite.url, "https://www.cornexhall.co.uk/");
  assert.equal(recovered.googlePlacesCalls, 0);

  const once: string[] = [];
  const verifiedFirst: PublicWebSearchProvider = {
    id: "fixture-search",
    costModel: { kind: "ZERO_INCREMENTAL", currency: "USD", amountPerCall: 0 },
    async search({ query }) { once.push(query); return [{ url: "https://www.cornexhall.co.uk/", title: "Cornex Hall | Events venue in Bristol" }]; },
  };
  const first = await executeOfficialWebsiteDiscovery(discoveryRequest({ idempotencyKey: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }), { searchProvider: verifiedFirst, fetchImpl, resolveHost: resolver, now: () => NOW }) as any;
  assert.equal(once.length, 1);
  assert.equal(first.officialWebsite.url, "https://www.cornexhall.co.uk/");
});

test("the Serper adapter does not reference Google Places", () => {
  const source = readFileSync(new URL("../src/nexus/search/serper-public-web-search.ts", import.meta.url), "utf8");
  assert.equal(/google-places|getGooglePlaceDetails|searchGooglePlaces|places\.googleapis/.test(source), false);
  assert.equal(programmePublicWebSearchBudget().cap, PUBLIC_WEB_SEARCH_REQUEST_CAP);
});
