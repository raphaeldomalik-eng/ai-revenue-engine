import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { mock } from "node:test";
import { CONTRACTS, validateOfficialWebsiteDiscoveryRequest } from "../src/nexus/contracts.ts";
import { InMemoryNexusResultStore } from "../src/nexus/executor.ts";
import { handleNexusExecuteRequest } from "../src/nexus/http.ts";
import { buildNexusEnvelope } from "../src/nexus/transport.ts";
import { candidateRejection, configuredPublicWebSearchProvider, executeOfficialWebsiteDiscovery, isGenericVenueName, type PublicWebSearchProvider, type PublicWebSearchResult } from "../src/nexus/official-website-discovery.ts";
import { createPublicWebProvider } from "../src/nexus/public-web.ts";
import type { ResearchRequest } from "../src/nexus/contracts.ts";

const NOW = "2026-09-30T12:00:00.000Z";
const resolver = async () => [{ address: "93.184.216.34", family: 4 }];

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

type Sites = Record<string, string | { status: number; body?: string; headers?: Record<string, string> }>;
function siteFetch(sites: Sites, robots: Record<string, string> = {}) {
  const seen: string[] = [];
  const fetchImpl = async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    if (/googleapis|google\.com/.test(url)) throw new Error("GOOGLE_MUST_NOT_BE_CALLED");
    const parsed = new URL(url);
    if (parsed.pathname === "/robots.txt") return new Response(robots[parsed.origin] ?? "User-agent: *\nAllow: /", { status: 200 });
    const site = sites[url];
    if (site == null) return new Response("", { status: 404, headers: { "content-type": "text/html" } });
    if (typeof site === "string") return new Response(site, { status: 200, headers: { "content-type": "text/html" } });
    return new Response(site.body ?? "", { status: site.status, headers: { "content-type": "text/html", ...site.headers } });
  };
  return { fetchImpl, seen };
}

function fakeSearch(results: PublicWebSearchResult[] | ((query: string) => PublicWebSearchResult[]), costModel: PublicWebSearchProvider["costModel"] = { kind: "ZERO_INCREMENTAL", currency: "USD", amountPerCall: 0 }) {
  const queries: string[] = [];
  const provider: PublicWebSearchProvider = {
    id: "fixture-search",
    costModel,
    async search({ query }) { queries.push(query); return typeof results === "function" ? results(query) : results; },
  };
  return { provider, queries };
}

const CORNEX_HOME = '<html><head><title>Cornex Hall | Events venue in Bristol</title></head><body><h1>Cornex Hall</h1><address>12 Mill Lane, Bristol BS1 4AA</address><a href="mailto:events@cornexhall.co.uk">events@cornexhall.co.uk</a><a href="tel:+441179000000">0117 900 0000</a><form action="/contact"></form></body></html>';
const NOISY_RESULTS: PublicWebSearchResult[] = [
  { url: "https://www.facebook.com/cornexhall", title: "Cornex Hall | Facebook" },
  { url: "https://www.tripadvisor.co.uk/Attraction-cornex", title: "Cornex Hall - Tripadvisor" },
  { url: "https://www.yell.com/biz/cornex-hall-bristol", title: "Cornex Hall, Bristol | Yell" },
  { url: "https://www.skiddle.com/whats-on/Bristol/Cornex-Hall/", title: "Cornex Hall events | Skiddle" },
  { url: "https://www.eventbrite.co.uk/e/gig-at-cornex-hall-tickets-1", title: "Gig at Cornex Hall" },
  { url: "https://www.google.com/maps/place/Cornex+Hall", title: "Cornex Hall - Google Maps" },
  { url: "https://www.hireaspace.co.uk/venues/cornex-hall", title: "Cornex Hall venue hire" },
  { url: "https://www.booking.com/hotel/gb/cornex.html", title: "Cornex" },
  { url: "https://www.cornexhall.co.uk/about", title: "Cornex Hall | Events venue in Bristol" },
];

function googleTraps() {
  let calls = 0;
  const trap = async () => { calls += 1; throw new Error("GOOGLE_MUST_NOT_BE_CALLED"); };
  return { trap, get calls() { return calls; } };
}

test("HARD GATE: the discovery contract refuses GOOGLE_PLACES and non-authorised markets", () => {
  assert.throws(() => validateOfficialWebsiteDiscoveryRequest(discoveryRequest({ providerAllowances: ["PUBLIC_WEB_SEARCH", "PUBLIC_WEB", "GOOGLE_PLACES"] })), /GOOGLE_PLACES_NOT_AUTHORISED_FOR_OFFICIAL_WEBSITE_DISCOVERY/);
  assert.throws(() => validateOfficialWebsiteDiscoveryRequest(discoveryRequest({ providerAllowances: ["GOOGLE_PLACES"] })), /GOOGLE_PLACES_NOT_AUTHORISED/);
  for (const country of ["CA", "AU", "FR", "DE", "IE"]) {
    assert.throws(() => validateOfficialWebsiteDiscoveryRequest(discoveryRequest({}, { country })), /DISCOVERY_MARKET_NOT_AUTHORISED/);
  }
  const accepted = validateOfficialWebsiteDiscoveryRequest(discoveryRequest());
  assert.deepEqual(accepted.providerAllowances, ["PUBLIC_WEB_SEARCH", "PUBLIC_WEB"]);
});

test("HARD GATE: discovery with a held Place ID and a configured Google adapter makes 0 Google calls", async () => {
  const saved = { key: process.env.GOOGLE_PLACES_API_KEY, mode: process.env.GOOGLE_PLACES_MODE };
  process.env.GOOGLE_PLACES_API_KEY = "configured-test-key";
  process.env.GOOGLE_PLACES_MODE = "details_selected";
  const originalFetch = globalThis.fetch;
  let globalFetches = 0;
  globalThis.fetch = (async () => { globalFetches += 1; throw new Error("GLOBAL_FETCH_MUST_NOT_BE_USED"); }) as typeof fetch;
  const google = googleTraps();
  try {
    const { fetchImpl, seen } = siteFetch({ "https://www.cornexhall.co.uk/": CORNEX_HOME });
    const { provider } = fakeSearch(NOISY_RESULTS);
    const options = { searchProvider: provider, fetchImpl, resolveHost: resolver, now: () => NOW, googlePlaceDetails: google.trap, googlePlaces: google.trap, placeDetails: google.trap } as Parameters<typeof executeOfficialWebsiteDiscovery>[1];
    const result = await executeOfficialWebsiteDiscovery(discoveryRequest(), options) as any;
    assert.equal(result.googlePlacesCalls, 0);
    assert.equal(google.calls, 0);
    assert.equal(globalFetches, 0);
    assert.equal(seen.some((url) => /google/.test(url)), false);
    assert.deepEqual(result.providerUsage.find((item: any) => item.provider === "GOOGLE_PLACES"), { provider: "GOOGLE_PLACES", callCount: 0, purpose: "NOT_AUTHORISED_FOR_OFFICIAL_WEBSITE_DISCOVERY", cost: null });
    assert.equal(result.websiteStatus, "OFFICIAL_WEBSITE_DISCOVERED_AND_VERIFIED");
  } finally {
    globalThis.fetch = originalFetch;
    if (saved.key === undefined) delete process.env.GOOGLE_PLACES_API_KEY; else process.env.GOOGLE_PLACES_API_KEY = saved.key;
    if (saved.mode === undefined) delete process.env.GOOGLE_PLACES_MODE; else process.env.GOOGLE_PLACES_MODE = saved.mode;
  }
});

test("HARD GATE: a new calendar month does not enable Google", async () => {
  for (const instant of ["2026-10-01T00:00:01.000Z", "2026-11-01T09:00:00.000Z", "2027-01-01T00:00:00.000Z"]) {
    mock.timers.enable({ apis: ["Date"], now: new Date(instant) });
    try {
      const google = googleTraps();
      const { fetchImpl, seen } = siteFetch({});
      const result = await executeOfficialWebsiteDiscovery(discoveryRequest({ createdAt: instant }), { searchProvider: null, fetchImpl, resolveHost: resolver, googlePlaceDetails: google.trap } as Parameters<typeof executeOfficialWebsiteDiscovery>[1]) as any;
      assert.equal(result.googlePlacesCalls, 0);
      assert.equal(google.calls, 0);
      assert.equal(seen.length, 0);
      assert.equal(result.status, "SEARCH_PROVIDER_UNAVAILABLE");
    } finally {
      mock.timers.reset();
    }
  }
});

test("HARD GATE: a missing search provider returns safely without Google fallback or any network call", async () => {
  const google = googleTraps();
  const { fetchImpl, seen } = siteFetch({});
  const result = await executeOfficialWebsiteDiscovery(discoveryRequest(), { fetchImpl, resolveHost: resolver, now: () => NOW, googlePlaceDetails: google.trap } as Parameters<typeof executeOfficialWebsiteDiscovery>[1]) as any;
  assert.equal(result.status, "SEARCH_PROVIDER_UNAVAILABLE");
  assert.equal(result.officialWebsite, null);
  assert.equal(result.search.callCount, 0);
  assert.equal(result.crawl.verificationCrawls, 0);
  assert.equal(result.googlePlacesCalls, 0);
  assert.equal(result.retryable, true);
  assert.equal(google.calls, 0);
  assert.equal(seen.length, 0);
  assert.match(result.unknowns.join(" "), /Google Places was not used/);
  assert.equal(configuredPublicWebSearchProvider(), null);
});

test("HARD GATE: the discovery module has no Google Places dependency", () => {
  const source = readFileSync(new URL("../src/nexus/official-website-discovery.ts", import.meta.url), "utf8");
  assert.equal(/google-places/.test(source), false);
  assert.equal(/getGooglePlaceDetails|searchGooglePlaces/.test(source), false);
});

test("HARD GATE: PUBLIC_WEB alone never seeds a website from a Place ID via Google", async () => {
  const google = googleTraps();
  const provider = createPublicWebProvider({ fetchImpl: siteFetch({}).fetchImpl, resolveHost: resolver, placeDetails: google.trap as any });
  const request = {
    contractVersion: CONTRACTS.RESEARCH_REQUEST, requestId: "11111111-1111-4111-8111-111111111111", idempotencyKey: "22222222-2222-4222-8222-222222222222", correlationId: "33333333-3333-4333-8333-333333333333",
    originatingProduct: "event_suite_resources", subject: { canonicalEntityId: "44444444-4444-4444-8444-444444444444", candidateReference: null, entityType: "VENUE" },
    researchPurpose: "OFFICIAL_WEBSITE", requestedFactTypes: ["officialWebsite"], providerAllowances: ["PUBLIC_WEB"], costCeiling: { currency: "USD", amount: 0 }, freshnessRequirements: { maxAgeHours: 24 }, existingEvidenceRefs: [], requestedBy: { actorType: "PRODUCT", actorId: "resources" }, createdAt: NOW,
  } as unknown as ResearchRequest;
  const result = await provider({ request, context: { targetName: "Cornex Hall", locality: "Bristol", existingFacts: [{ fieldName: "placeId", value: "places/cornex", evidenceRef: "place:cornex" }, { fieldName: "resourcesVenueEligibility", value: "ELIGIBLE", evidenceRef: "classification:venue" }] } });
  assert.equal(google.calls, 0);
  assert.equal(result.facts.length, 0);
  assert.equal(result.providerUsage?.some((item) => item.provider === "GOOGLE_PLACES") ?? false, false);
  assert.match(result.unknowns.join(" "), /Google Places is not authorised/);
});

test("candidate discovery selects the first-party site and rejects social, directory, ticketing, maps, OTA, and review results", async () => {
  const { fetchImpl, seen } = siteFetch({ "https://www.cornexhall.co.uk/": CORNEX_HOME });
  const { provider, queries } = fakeSearch(NOISY_RESULTS);
  const result = await executeOfficialWebsiteDiscovery(discoveryRequest(), { searchProvider: provider, fetchImpl, resolveHost: resolver, now: () => NOW }) as any;
  assert.equal(result.websiteStatus, "OFFICIAL_WEBSITE_DISCOVERED_AND_VERIFIED");
  assert.equal(result.officialWebsite.url, "https://www.cornexhall.co.uk/");
  assert.equal(result.officialWebsite.source, "PUBLIC_WEB_SEARCH_VERIFIED");
  const reasons = Object.fromEntries(result.candidates.map((item: any) => [new URL(item.url).hostname, item.reasons[0]]));
  assert.equal(reasons["www.facebook.com"], "SOCIAL_PROFILE");
  assert.equal(reasons["www.tripadvisor.co.uk"], "REVIEW_SITE");
  assert.equal(reasons["www.yell.com"], "DIRECTORY");
  assert.equal(reasons["www.hireaspace.co.uk"], "DIRECTORY");
  assert.equal(reasons["www.skiddle.com"], "TICKETING");
  assert.equal(reasons["www.eventbrite.co.uk"], "TICKETING");
  assert.equal(reasons["www.google.com"], "MAPS_OR_SEARCH_ENGINE");
  assert.equal(reasons["www.booking.com"], "TRAVEL_OR_BOOKING_PLATFORM");
  assert.equal(result.candidates.find((item: any) => item.state === "SELECTED").origin, "https://www.cornexhall.co.uk/");
  assert.equal(queries.length, 1);
  assert.match(queries[0]!, /"Cornex Hall" "Bristol" "United Kingdom" official/);
  assert.equal(seen.some((url) => /facebook|tripadvisor|yell|skiddle|eventbrite|booking|hireaspace/.test(url)), false);
});

test("multiple plausible venues produce ambiguity, not a guess", async () => {
  const other = CORNEX_HOME.replaceAll("cornexhall.co.uk", "cornex-bristol.co.uk");
  const { fetchImpl } = siteFetch({ "https://www.cornexhall.co.uk/": CORNEX_HOME, "https://cornex-bristol.co.uk/": other });
  const { provider } = fakeSearch([{ url: "https://www.cornexhall.co.uk/", title: "Cornex Hall" }, { url: "https://cornex-bristol.co.uk/", title: "Cornex Hall" }]);
  const result = await executeOfficialWebsiteDiscovery(discoveryRequest(), { searchProvider: provider, fetchImpl, resolveHost: resolver, now: () => NOW }) as any;
  assert.equal(result.status, "WEBSITE_CANDIDATES_AMBIGUOUS");
  assert.equal(result.officialWebsite, null);
  assert.equal(result.crawl.sourceDiscoveryCrawls, 0);
});

test("verification rejects a same-name site in the wrong city and accepts name plus location", async () => {
  const wrongCity = CORNEX_HOME.replace("12 Mill Lane, Bristol BS1 4AA", "4 Dock Road, Leeds LS1 1AA").replace("in Bristol", "in Leeds");
  const { fetchImpl } = siteFetch({ "https://www.cornexhall-leeds.co.uk/": wrongCity });
  const { provider } = fakeSearch([{ url: "https://www.cornexhall-leeds.co.uk/", title: "Cornex Hall" }]);
  const rejected = await executeOfficialWebsiteDiscovery(discoveryRequest(), { searchProvider: provider, fetchImpl, resolveHost: resolver, now: () => NOW }) as any;
  assert.equal(rejected.officialWebsite, null);
  assert.equal(rejected.status, "WEBSITE_CANDIDATES_AMBIGUOUS");
  assert.deepEqual(rejected.candidates.map((item: any) => item.reasons.at(-1)), ["NAME_ALIGNED_WITHOUT_LOCATION_OR_IDENTITY_PROOF"]);

  const unrelated = siteFetch({ "https://www.other.co.uk/": "<title>Other Business</title><h1>Other Business</h1><address>1 High Street, Bristol</address>" });
  const none = await executeOfficialWebsiteDiscovery(discoveryRequest(), { searchProvider: fakeSearch([{ url: "https://www.other.co.uk/" }]).provider, fetchImpl: unrelated.fetchImpl, resolveHost: resolver, now: () => NOW }) as any;
  assert.equal(none.status, "NO_CREDIBLE_WEBSITE_FOUND");
});

test("generic names need address corroboration beyond the city", async () => {
  assert.equal(isGenericVenueName("The Barn"), true);
  assert.equal(isGenericVenueName("The Grand Hotel"), true);
  assert.equal(isGenericVenueName("Cornex Hall"), false);
  const cityOnly = '<html><head><title>The Barn</title></head><body><h1>The Barn</h1><address>Farm Road, Bristol</address></body></html>';
  const withPostcode = '<html><head><title>The Barn</title></head><body><h1>The Barn</h1><address>7 Farm Road, Bristol BS9 2XY</address></body></html>';
  const identity = { venueName: "The Barn", formattedAddress: "7 Farm Road, Bristol BS9 2XY, UK" };
  const weak = await executeOfficialWebsiteDiscovery(discoveryRequest({}, identity), { searchProvider: fakeSearch([{ url: "https://thebarn.example.co.uk/" }]).provider, fetchImpl: siteFetch({ "https://thebarn.example.co.uk/": cityOnly }).fetchImpl, resolveHost: resolver, now: () => NOW }) as any;
  assert.equal(weak.officialWebsite, null);
  assert.equal(weak.candidates[0].reasons.at(-1), "GENERIC_NAME_REQUIRES_ADDRESS_CORROBORATION");
  const strong = await executeOfficialWebsiteDiscovery(discoveryRequest({}, identity), { searchProvider: fakeSearch([{ url: "https://thebarn.example.co.uk/" }]).provider, fetchImpl: siteFetch({ "https://thebarn.example.co.uk/": withPostcode }).fetchImpl, resolveHost: resolver, now: () => NOW }) as any;
  assert.equal(strong.websiteStatus, "OFFICIAL_WEBSITE_DISCOVERED_AND_VERIFIED");
});

test("a facility on an operator site verifies only with strong relationship evidence", async () => {
  const pages = {
    "https://www.ssisa.test/": '<html><head><title>Sports Science Institute of South Africa | SSISA</title></head><body><h1>Sports Science Institute of South Africa</h1><a href="/facilities">Facilities</a><footer><h5>ADDRESS</h5><p>Boundary Road,<br>Newlands, Cape Town,<br>7700</p></footer></body></html>',
    "https://www.ssisa.test/facilities": '<html><head><title>Facilities | SSISA</title><meta name="description" content="SSISA offers a Modern Gym, Indoor Swimming pool, High Performance Centre and Multifunctional Conference Centre"></head><body><h1>Facilities</h1><footer><h5>ADDRESS</h5><p>Boundary Road,<br>Newlands, Cape Town,<br>7700</p></footer></body></html>',
  };
  const identity = { venueName: "SSISA Conference Centre", locality: "Cape Town", administrativeRegion: "Western Cape", country: "ZA", formattedAddress: "Boundary Road, Newlands, Cape Town, 7700, South Africa", placeId: "places/ssisa", placeIdEvidenceRef: "external_reference:ssisa" };
  const storedGoogle = { displayName: "SSISA Conference Centre", evidenceRef: "google_places_evidence:ssisa" };
  const strong = await executeOfficialWebsiteDiscovery(discoveryRequest({ heldEvidence: { storedGoogle } }, identity), { searchProvider: fakeSearch([{ url: "https://www.ssisa.test/" }]).provider, fetchImpl: siteFetch(pages).fetchImpl, resolveHost: resolver, now: () => NOW }) as any;
  assert.equal(strong.websiteStatus, "OFFICIAL_WEBSITE_DISCOVERED_AND_VERIFIED");
  assert.equal(strong.officialWebsite.verificationPath, "FACILITY_OPERATOR");
  assert.equal(strong.googlePlacesCalls, 0);
  const weak = await executeOfficialWebsiteDiscovery(discoveryRequest({}, { ...identity, placeId: null, placeIdEvidenceRef: null }), { searchProvider: fakeSearch([{ url: "https://www.ssisa.test/" }]).provider, fetchImpl: siteFetch(pages).fetchImpl, resolveHost: resolver, now: () => NOW }) as any;
  assert.equal(weak.officialWebsite, null);
});

test("a search result cannot become official without first-party verification", async () => {
  const { fetchImpl, seen } = siteFetch({ "https://www.cornexhall.co.uk/": CORNEX_HOME });
  const result = await executeOfficialWebsiteDiscovery(discoveryRequest({ providerAllowances: ["PUBLIC_WEB_SEARCH"] }), { searchProvider: fakeSearch([{ url: "https://www.cornexhall.co.uk/", title: "Cornex Hall | Official site" }]).provider, fetchImpl, resolveHost: resolver, now: () => NOW }) as any;
  assert.equal(result.officialWebsite, null);
  assert.equal(result.status, "CRAWL_UNAVAILABLE");
  assert.equal(seen.length, 0);
  assert.equal(result.candidates[0].state, "NOT_EVALUATED");
});

test("a verified candidate enters existing source discovery and yields email, phone, and same-origin form", async () => {
  const { fetchImpl } = siteFetch({ "https://www.cornexhall.co.uk/": CORNEX_HOME });
  const result = await executeOfficialWebsiteDiscovery(discoveryRequest(), { searchProvider: fakeSearch(NOISY_RESULTS).provider, fetchImpl, resolveHost: resolver, now: () => NOW }) as any;
  assert.equal(result.status, "VERIFIED_SITE_PUBLIC_CONTACT_FOUND");
  assert.equal(result.sourceDiscovery.contractVersion, CONTRACTS.SOURCE_DISCOVERY_RESULT);
  assert.equal(result.crawl.sourceDiscoveryCrawls, 1);
  const byType = Object.fromEntries(result.publicContacts.map((item: any) => [item.type, item.value]));
  assert.equal(byType.EMAIL, "events@cornexhall.co.uk");
  assert.ok(byType.PHONE);
  assert.equal(new URL(byType.CONTACT_FORM).origin, "https://www.cornexhall.co.uk");
  assert.equal(result.publicContacts.every((item: any) => item.source === "VERIFIED_FIRST_PARTY_SITE" && item.evidenceRef), true);
});

test("a verified site without contact stays unknown and crawler refusal stays safe", async () => {
  const bare = '<html><head><title>Cornex Hall</title></head><body><h1>Cornex Hall</h1><address>12 Mill Lane, Bristol BS1 4AA</address></body></html>';
  const noContact = await executeOfficialWebsiteDiscovery(discoveryRequest(), { searchProvider: fakeSearch([{ url: "https://www.cornexhall.co.uk/" }]).provider, fetchImpl: siteFetch({ "https://www.cornexhall.co.uk/": bare }).fetchImpl, resolveHost: resolver, now: () => NOW }) as any;
  assert.equal(noContact.status, "VERIFIED_SITE_NO_PUBLIC_CONTACT");
  assert.deepEqual(noContact.publicContacts, []);

  const blocked = siteFetch({ "https://www.cornexhall.co.uk/": CORNEX_HOME }, { "https://www.cornexhall.co.uk": "User-agent: *\nDisallow: /" });
  const refused = await executeOfficialWebsiteDiscovery(discoveryRequest(), { searchProvider: fakeSearch([{ url: "https://www.cornexhall.co.uk/" }]).provider, fetchImpl: blocked.fetchImpl, resolveHost: resolver, now: () => NOW }) as any;
  assert.equal(refused.status, "CRAWL_BLOCKED");
  assert.equal(refused.officialWebsite, null);
  assert.equal(blocked.seen.includes("https://www.cornexhall.co.uk/"), false);

  const privateHost = await executeOfficialWebsiteDiscovery(discoveryRequest(), { searchProvider: fakeSearch([{ url: "https://www.cornexhall.co.uk/" }]).provider, fetchImpl: siteFetch({ "https://www.cornexhall.co.uk/": CORNEX_HOME }).fetchImpl, resolveHost: async () => [{ address: "10.0.0.5", family: 4 }], now: () => NOW }) as any;
  assert.equal(privateHost.officialWebsite, null);
  assert.ok(["CRAWL_BLOCKED", "CRAWL_UNAVAILABLE"].includes(privateHost.status));
});

test("observability records search and crawl separately, monetary cost, and 0 Google calls", async () => {
  const { fetchImpl } = siteFetch({ "https://www.cornexhall.co.uk/": CORNEX_HOME });
  const zero = await executeOfficialWebsiteDiscovery(discoveryRequest(), { searchProvider: fakeSearch(NOISY_RESULTS).provider, fetchImpl, resolveHost: resolver, now: () => NOW }) as any;
  assert.equal(zero.search.provider, "fixture-search");
  assert.equal(zero.search.costModel, "ZERO_INCREMENTAL");
  assert.equal(zero.search.callCount, 1);
  assert.equal(zero.search.returnedCandidateUrls.length, NOISY_RESULTS.length);
  assert.deepEqual(zero.search.cost, { currency: "USD", amount: 0 });
  assert.equal(zero.crawl.verificationCrawls, 1);
  assert.equal(zero.crawl.sourceDiscoveryCrawls, 1);
  assert.ok(zero.crawl.requestCount > 0);
  assert.deepEqual(zero.providerUsage.map((item: any) => [item.provider, item.callCount]), [["PUBLIC_WEB_SEARCH", 1], ["PUBLIC_WEB", 2], ["GOOGLE_PLACES", 0]]);
  assert.equal(zero.googlePlacesCalls, 0);

  const metered = fakeSearch([{ url: "https://www.cornexhall.co.uk/" }], { kind: "METERED", currency: "USD", amountPerCall: 0.005 });
  const capped = await executeOfficialWebsiteDiscovery(discoveryRequest({ idempotencyKey: "55555555-5555-4555-8555-555555555555" }), { searchProvider: metered.provider, fetchImpl, resolveHost: resolver, now: () => NOW }) as any;
  assert.equal(metered.queries.length, 0);
  assert.equal(capped.search.callCount, 0);
  assert.match(capped.unknowns.join(" "), /cost ceiling/);
  const funded = await executeOfficialWebsiteDiscovery(discoveryRequest({ idempotencyKey: "66666666-6666-4666-8666-666666666666", costCeiling: { currency: "USD", amount: 0.01 } }), { searchProvider: metered.provider, fetchImpl, resolveHost: resolver, now: () => NOW }) as any;
  assert.deepEqual(funded.search.cost, { currency: "USD", amount: 0.005 });
  assert.deepEqual(funded.costSummary, { currency: "USD", amount: 0.005 });
});

test("held Resources, Nexus, and stored Google evidence are reused before any search or crawl", async () => {
  const { provider, queries } = fakeSearch(NOISY_RESULTS);
  const { fetchImpl, seen } = siteFetch({ "https://www.cornexhall.co.uk/": CORNEX_HOME });
  const opts = { searchProvider: provider, fetchImpl, resolveHost: resolver, now: () => NOW };
  const resources = await executeOfficialWebsiteDiscovery(discoveryRequest({ heldEvidence: { resources: { website: "https://www.cornexhall.co.uk/", evidenceRef: "resources:listing:1" } } }), opts) as any;
  assert.equal(resources.status, "HELD_WEBSITE_REUSED");
  const nexus = await executeOfficialWebsiteDiscovery(discoveryRequest({ idempotencyKey: "77777777-7777-4777-8777-777777777777", heldEvidence: { nexus: { verifiedOfficialWebsite: "https://www.cornexhall.co.uk/", publicPhone: "+441179000000", evidenceRef: "entity:fact:1" } } }), opts) as any;
  assert.equal(nexus.websiteStatus, "HELD_WEBSITE_REUSED");
  assert.equal(nexus.contactStatus, "HELD_CONTACT_REUSED");
  const googlePhone = await executeOfficialWebsiteDiscovery(discoveryRequest({ idempotencyKey: "88888888-8888-4888-8888-888888888888", heldEvidence: { storedGoogle: { phone: "+441179000000", evidenceRef: "google_places_evidence:1" } } }), opts) as any;
  assert.equal(googlePhone.status, "HELD_CONTACT_REUSED");
  assert.equal(queries.length, 0);
  assert.equal(seen.length, 0);

  const storedSite = await executeOfficialWebsiteDiscovery(discoveryRequest({ idempotencyKey: "99999999-9999-4999-8999-999999999999", heldEvidence: { storedGoogle: { websiteUri: "http://www.cornexhall.co.uk/", evidenceRef: "google_places_evidence:2" } } }), opts) as any;
  assert.equal(storedSite.officialWebsite.source, "STORED_GOOGLE_EVIDENCE_VERIFIED");
  assert.equal(storedSite.search.callCount, 0);
  assert.equal(storedSite.googlePlacesCalls, 0);
  assert.equal(queries.length, 0);
});

test("results replay idempotently while retryable dispositions are re-attempted", async () => {
  const store = new InMemoryNexusResultStore();
  const { fetchImpl } = siteFetch({ "https://www.cornexhall.co.uk/": CORNEX_HOME });
  const missing = await executeOfficialWebsiteDiscovery(discoveryRequest(), { fetchImpl, resolveHost: resolver, now: () => NOW }, store) as any;
  assert.equal(missing.status, "SEARCH_PROVIDER_UNAVAILABLE");
  const first = await executeOfficialWebsiteDiscovery(discoveryRequest(), { searchProvider: fakeSearch(NOISY_RESULTS).provider, fetchImpl, resolveHost: resolver, now: () => NOW }, store) as any;
  assert.equal(first.status, "VERIFIED_SITE_PUBLIC_CONTACT_FOUND");
  const replay = await executeOfficialWebsiteDiscovery(discoveryRequest(), { searchProvider: { id: "boom", costModel: { kind: "ZERO_INCREMENTAL", currency: "USD", amountPerCall: 0 }, search: async () => { throw new Error("replay must not search"); } }, fetchImpl: async () => { throw new Error("replay must not fetch"); }, resolveHost: resolver, now: () => NOW }, store);
  assert.deepEqual(replay, first);
});

test("the AIRE-internal stage contract is not exposed on the cross-product Nexus route", async () => {
  const secret = "test-secret";
  const timestamp = String(Math.floor(Date.parse(NOW) / 1000));
  const envelope = buildNexusEnvelope(discoveryRequest(), secret, timestamp);
  const request = new Request("https://preview.example/api/integrations/nexus/execute", { method: "POST", headers: { "content-type": "application/json", "x-nexus-timestamp": timestamp, "x-nexus-signature": envelope.signature }, body: envelope.body });
  const response = await handleNexusExecuteRequest(request, { secret, store: new InMemoryNexusResultStore(), now: () => Date.parse(NOW), allowResearch: true });
  assert.equal(response.status, 422);
  assert.equal((await response.json() as any).code, "NEXUS_CONTRACT_UNSUPPORTED");
});

test("candidate host filter classifies prohibited sources", () => {
  assert.equal(candidateRejection("https://linktr.ee/venue"), "SOCIAL_PROFILE");
  assert.equal(candidateRejection("https://maps.app.goo.gl/abc"), "MAPS_OR_SEARCH_ENGINE");
  assert.equal(candidateRejection("https://webcache.googleusercontent.com/search?q=cache:x"), "CACHED_OR_MIRRORED");
  assert.equal(candidateRejection("https://www.quicket.co.za/events/1"), "TICKETING");
  assert.equal(candidateRejection("https://www.sa-venues.com/venue"), "DIRECTORY");
  assert.equal(candidateRejection("https://en.wikipedia.org/wiki/Venue"), "AGGREGATOR");
  assert.equal(candidateRejection("https://127.0.0.1/"), "INVALID_URL");
  assert.equal(candidateRejection("https://www.cornexhall.co.uk/"), null);
});
