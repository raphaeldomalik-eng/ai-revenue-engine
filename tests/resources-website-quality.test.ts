import assert from "node:assert/strict";
import test from "node:test";
import { consumeDirectorySearchEvidence } from "../src/nexus/search/directory-held-search.ts";
import { assessWebsiteIdentity, siteOperatedBySubject } from "../src/nexus/official-website-discovery.ts";
import { crawlVerifiedSource } from "../src/nexus/source-discovery/crawler.ts";
import { articleLikePath, GapPlanner } from "../src/nexus/source-discovery/planner.ts";
import { rankChildSitemaps } from "../src/nexus/source-discovery/sitemap.ts";

// Fixtures are shortened retained Production observations from 2026-11-10 (AIRE nexus_directory_search_receipt
// and nexus_executor_results). Each names the third-party page that was "verified" instead of the venue's site.
const now = "2026-11-10T16:00:00Z", id = "11111111-1111-4111-8111-111111111111";
const request = (venueName: string, locality: string, country: "GB" | "ZA" = "GB") => ({ contractVersion: "aire.official-website-discovery-request.v1", requestId: id, idempotencyKey: id, correlationId: id, originatingProduct: "event_suite_resources", subject: { entityType: "UNKNOWN", canonicalEntityId: null, candidateReference: { sourceSystem: "test", sourceRecordId: "1" } }, identity: { venueName, locality, country }, providerAllowances: ["PUBLIC_WEB_SEARCH"], costCeiling: { currency: "USD", amount: 0 }, requestedBy: { actorType: "SYSTEM", actorId: "directory" }, createdAt: now });
const receipt = (venueName: string, locality: string, results: Array<{ url: string; title: string }>, country: "GB" | "ZA" = "GB") => ({ query: `"${venueName}" "${locality}" "${country === "GB" ? "United Kingdom" : "South Africa"}" official website`, country, observedAt: now, evidenceRef: "serper:1", mechanism: "serper-google-search", paidProviderCostUsd: 0, results });

test("a venue-named domain in the results is the only candidate prepared, not the listings that mention the venue", async () => {
  const r = await consumeDirectorySearchEvidence(request("Ambassadors Clubhouse", "London"), [receipt("Ambassadors Clubhouse", "London", [
    { url: "https://ambassadorsclubhouse.com/our-story/", title: "Our Story" },
    { url: "https://guide.michelin.com/gb/en/greater-london/london/restaurant/ambassadors-clubhouse", title: "Ambassadors Clubhouse – London" },
    { url: "https://www.myrsvp.com/london/restaurants/ambassadors-clubhouse-london/", title: "Ambassadors Clubhouse London" },
    { url: "https://www.andyhayler.com/restaurant/ambassadors-clubhouse", title: "review of Indian restaurant Ambassadors Clubhouse" },
  ])], { now });
  assert.deepEqual(r.candidates.map((c) => c.websiteSeed), ["https://ambassadorsclubhouse.com/our-story/"]);
  assert.equal(r.candidates[0]!.searchRank, 1);
  assert(r.candidates[0]!.rankingReasons.includes("DOMAIN_NAME_ALIGNMENT"));
});

test("without a venue-named domain only a site homepage is prepared, never a deep listing page", async () => {
  const r = await consumeDirectorySearchEvidence(request("Health Foundry", "London"), [receipt("Health Foundry", "London", [
    { url: "https://workin.space/en/united-kingdom/london/health-foundry", title: "Health Foundry London" },
    { url: "https://neutralhost.example/", title: "Health Foundry London" },
    { url: "https://www.completeofficesearch.com/office-space/health-foundry", title: "Health Foundry serviced offices" },
  ])], { now });
  assert.deepEqual(r.candidates.map((c) => c.websiteSeed), ["https://neutralhost.example/"]);
});

test("a search with only directory pages prepares no candidate", async () => {
  const r = await consumeDirectorySearchEvidence(request("Ebury by Fat Macy's", "London"), [receipt("Ebury by Fat Macy's", "London", [
    { url: "https://hirespace.vercel.app/Spaces/London/188787/Ebury-By-Fat-Macys/Courtyard/Weddings", title: "Ebury By Fat Macy's Courtyard weddings" },
    { url: "https://uk.linkedin.com/company/ebury-by-fat-macys", title: "Ebury by Fat Macy's" },
  ])], { now });
  assert.equal(r.candidates.length, 0);
});

test("siteOperatedBySubject separates venue-operated sites from the pages verified in Production", () => {
  const verifiedInProduction: Array<[string, string]> = [
    ["Impact Factory", "https://leadiq.com/c/impact-factory/5a1da4ef23000054009795f0"],
    ["Health Foundry", "https://workin.space/en/united-kingdom/london/health-foundry"],
    ["Piazza Italiana", "https://tripreporter.co.uk/piazza-italiana-city-of-london/"],
    ["Cottons Vauxhall", "https://alt-africa.com/2017/11/13/food-news-cottons-comes-to-vauxhall/"],
    ["The Colonnade Hotel", "https://www.hotel-scoop.com/the-colonnade-hotel-in-little-venice-london/"],
    ["Shoreditch Balls", "https://uk.tortoisepath.com/place/shoreditch-balls/"],
    ["Excellent Guest House", "https://www.places.co.za/accommodation/excellent-guest-house.html"],
    ["Monkey Valley Resort", "https://www.capepointroute.co.za/moreinfoAccommodation.php?aID=35"],
    ["Port Edward Country Club", "https://www.allsquaregolf.com/golf-courses/south-africa/port-edward-country-club"],
  ];
  for (const [name, url] of verifiedInProduction) assert.equal(siteOperatedBySubject(name, url, []).operated, false, `${name} ${url}`);
  const operated: Array<[string, string]> = [
    ["Piazza Italiana", "https://piazzaitaliana.co.uk/private-dining/"],
    ["Impact Factory", "https://www.impactfactory.com/"],
    ["The Capetonian", "https://capetonian.co.za/"],
    ["Cellar 1848", "https://cellar1848.co.za/ourstory/"],
    ["The Round Chapel", "https://theroundchapel.org.uk/about-us/"],
    ["National Portrait Gallery", "https://www.npg.org.uk/about/organisation/"],
  ];
  for (const [name, url] of operated) assert.equal(siteOperatedBySubject(name, url, []).operated, true, `${name} ${url}`);
});

test("a homepage that names the venue as the site is venue-operated even when the domain is unrelated", () => {
  const facts = [{ fieldName: "siteName", value: "Saint Luke's", sourceUrl: "https://glasgowvenues.example/" }];
  assert.equal(siteOperatedBySubject("Saint Luke's", "https://glasgowvenues.example/", facts).operated, true);
  const deep = [{ fieldName: "siteName", value: "Saint Luke's", sourceUrl: "https://glasgowvenues.example/listings/saint-lukes" }];
  assert.equal(siteOperatedBySubject("Saint Luke's", "https://glasgowvenues.example/listings/saint-lukes", deep).operated, false);
});

test("a search-derived page that merely names the venue and locality is not verified; a held website keeps its evidence path", () => {
  const facts = [
    { fieldName: "siteName", value: "Health Foundry London | Workin.space", sourceUrl: "https://workin.space/en/united-kingdom/london/health-foundry" },
    { fieldName: "pageTitle", value: "Health Foundry London", sourceUrl: "https://workin.space/en/united-kingdom/london/health-foundry" },
    { fieldName: "explicitVenueName", value: "Health Foundry", sourceUrl: "https://workin.space/en/united-kingdom/london/health-foundry" },
    { fieldName: "address", value: "Health Foundry, 5 Mint Street, London SE1 1AB", sourceUrl: "https://workin.space/en/united-kingdom/london/health-foundry" },
  ];
  const input = { venueName: "Health Foundry", country: "GB" as const, heldAddress: null, context: { locality: "London", existingFacts: [], targetWebsite: "https://workin.space/en/united-kingdom/london/health-foundry" }, finalUrl: "https://workin.space/en/united-kingdom/london/health-foundry", identityFacts: facts };
  const held = assessWebsiteIdentity(input);
  assert.equal(held.verified, true, "existing evidence path is unchanged for held websites");
  const searched = assessWebsiteIdentity({ ...input, requireOperatedSite: true });
  assert.equal(searched.verified, false);
  assert.equal(searched.reason, "THIRD_PARTY_PAGE_NOT_VENUE_OPERATED");
});

test("a venue-operated search result still verifies and records why", () => {
  const url = "https://piazzaitaliana.co.uk/";
  const facts = [
    { fieldName: "siteName", value: "Piazza Italiana", sourceUrl: url },
    { fieldName: "explicitVenueName", value: "Piazza Italiana London", sourceUrl: url },
    { fieldName: "address", value: "Piazza Italiana, 1 Gresham Street, London EC2V 7BX", sourceUrl: url },
  ];
  const verdict = assessWebsiteIdentity({ venueName: "Piazza Italiana", country: "GB", heldAddress: null, context: { locality: "London", existingFacts: [], targetWebsite: url }, finalUrl: url, identityFacts: facts, requireOperatedSite: true });
  assert.equal(verdict.verified, true);
  assert(verdict.signals.includes("venue name in site domain"));
});

test("articleLikePath marks news, blog, inspiration, dated and headline slugs and gallery items, not hire or contact pages", () => {
  for (const url of [
    "https://www.dgb.co.za/a-better-map-of-the-casino-how-clear-layouts-make-browsing-feel-like-discovery/",
    "https://www.stlukesglasgow.com/free-entry-venue-launch-night-announced-for-saint-lukes-on-sept-19th/",
    "https://www.stlukesglasgow.com/saint-lukes-to-take-part-in-glasgows-doors-open-day-2015/",
    "https://www.toca.social/blog/football-stadium-tours-in-london-what-to-do-after-your-visit",
    "https://www.yeswedocaterers.co.za/wedding-inspiration-tasneem-muhammed/wedding-inspiration-food/",
    "https://www.museeventartistry.com/gallery/item-id-5dd680bf46a43",
    "https://www.stlukesglasgow.com/saint-lukes/newspress/".replace("newspress", "news"),
  ]) assert.equal(articleLikePath(url), true, url);
  for (const url of [
    "https://www.revolution-bars.co.uk/parties-and-events/private-hire/",
    "https://www.theothers.uk.com/venue-hire-specs",
    "https://rockingthedaisies.com/ct/contact/",
    "https://www.toca.social/info/contact-us",
    "https://veldandsea.com/venue-hire/",
    "https://www.stlukesglasgow.com/special-events/weddings/",
    "https://www.example.org/",
  ]) assert.equal(articleLikePath(url), false, url);
});

test("a news post cannot outrank a venue-hire or contact page for the same gap, but is still read when nothing else is left", () => {
  const planner = new GapPlanner(["VENUE_FACTS:SPACES"]);
  const add = (url: string) => planner.add({ url, kind: "PAGE", dims: ["VENUE_FACTS:SPACES"], source: "LINK", discoveredFrom: "https://v.example/", label: "", strength: 1 });
  add("https://v.example/news/wedding-fair-this-weekend");
  add("https://v.example/venue-hire");
  assert.equal(planner.next(false)?.url, "https://v.example/venue-hire");
  planner.markDone("https://v.example/venue-hire");
  assert.equal(planner.next(false)?.url, "https://v.example/news/wedding-fair-this-weekend");
});

test("a market-prefixed twin of a page already planned is not planned again", () => {
  const planner = new GapPlanner(["PUBLIC_CONTACT:DIRECT"]);
  const add = (url: string) => planner.add({ url, kind: "PAGE", dims: ["PUBLIC_CONTACT:DIRECT"], source: "LINK", discoveredFrom: "https://t.example/", label: "", strength: 1 });
  add("https://t.example/info/contact-us");
  add("https://t.example/us/info/contact-us");
  add("https://t.example/en-us/info/contact-us");
  assert.deepEqual(planner.pending().map((item) => item.url), ["https://t.example/info/contact-us"]);
});

test("only the best sitemap tier is fetched: page sitemaps, never author, template or post archives", () => {
  assert.deepEqual(rankChildSitemaps(["https://r.example/ct/author-sitemap.xml", "https://r.example/ct/wpr_templates-sitemap.xml", "https://r.example/ct/page-sitemap.xml", "https://r.example/ct/post-sitemap.xml"]), ["https://r.example/ct/page-sitemap.xml"]);
  assert.deepEqual(rankChildSitemaps(["https://r.example/a-sitemap.xml", "https://r.example/b-sitemap.xml"]), ["https://r.example/a-sitemap.xml", "https://r.example/b-sitemap.xml"]);
  assert.deepEqual(rankChildSitemaps(["https://r.example/post-sitemap.xml", "https://r.example/author-sitemap.xml"]), ["https://r.example/author-sitemap.xml"]);
});

test("an apex that redirects to www buys robots.txt once, not once per origin", async () => {
  const requested: string[] = [];
  const budget = { maxPages: 1, maxRequests: 8, maxBytesPerResponse: 100000, maxRedirects: 3, maxRetries: 0, timeoutMs: 1000, minRequestDelayMs: 0 };
  const result = await crawlVerifiedSource({
    verifiedUrl: "https://venue.example/",
    requestedExtractors: ["SOURCE_CLASSIFICATION"],
    budget,
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (input) => {
      const url = String(input);
      requested.push(url);
      if (url === "https://venue.example/robots.txt") return new Response(null, { status: 301, headers: { location: "https://www.venue.example/robots.txt" } });
      if (url === "https://www.venue.example/robots.txt") return new Response("User-agent: *\nAllow: /\n");
      if (url === "https://venue.example/") return new Response(null, { status: 301, headers: { location: "https://www.venue.example/" } });
      if (url === "https://www.venue.example/") return new Response("<html><title>Example Venue</title></html>", { status: 200, headers: { "content-type": "text/html" } });
      return new Response("no", { status: 404 });
    },
  });
  assert.equal(requested.filter((url) => url.endsWith("/robots.txt") && url.startsWith("https://www.venue.example")).length, 1, requested.join(" "));
  assert.equal(result.documents.length, 1);
});
