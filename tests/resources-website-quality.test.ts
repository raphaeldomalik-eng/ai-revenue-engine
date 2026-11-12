﻿import assert from "node:assert/strict";
import test from "node:test";
import { consumeDirectorySearchEvidence } from "../src/nexus/search/directory-held-search.ts";
import { assessWebsiteIdentity, siteOperatedBySubject } from "../src/nexus/official-website-discovery.ts";
import { crawlVerifiedSource, extractFromFetchedDocuments } from "../src/nexus/source-discovery/crawler.ts";
import { articleLikePath, GapPlanner } from "../src/nexus/source-discovery/planner.ts";
import { venuePageTier } from "../src/nexus/source-discovery/venue/page-tier.ts";
import { venueCrawlProfiles } from "../src/nexus/source-discovery/venue/profiles.ts";
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
  // The seed keeps the result's own path: the Nexus consumer rejects any seed whose pathname differs from its sourceUrl (DIRECTORY_SEARCH_SEED_EVIDENCE).
  assert.deepEqual(r.candidates.map((c) => c.websiteSeed), ["https://ambassadorsclubhouse.com/our-story/"]);
  assert.equal(r.candidates[0]!.sourceUrl, "https://ambassadorsclubhouse.com/our-story/");
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

test("retained group-B searches: listings and platform subdomains never win, the venue's own site does", async () => {
  // Shoreditch Balls: the only title match with a homepage is a directory subdomain; the venue's own site is an event page at rank 5.
  const balls = await consumeDirectorySearchEvidence(request("Shoreditch Balls", "London"), [receipt("Shoreditch Balls", "London", [
    { url: "https://uk.tortoisepath.com/place/shoreditch-balls/", title: "Shoreditch Balls" },
    { url: "https://www.shoreditchballs.com/events/adlibretto", title: "AdLibretto" },
    { url: "https://shoreditch-balls.wheree.com/", title: "SHOREDITCH BALLS - Reviews, Photos & Phone Number" },
  ])], { now });
  assert.deepEqual(balls.candidates.map((c) => c.websiteSeed), ["https://www.shoreditchballs.com/events/adlibretto"]);
  assert(!balls.candidates[0]!.rankingReasons.includes("EVENT_DETAIL_PATH_DEPRIORITISED"), "the venue-named event page is not deprioritised");
  assert.equal(siteOperatedBySubject("Shoreditch Balls", "https://shoreditch-balls.wheree.com/", []).operated, false);
  assert.equal(siteOperatedBySubject("Monkey Valley Resort", "https://monkeyvalley.wixsite.com/resort", []).operated, true, "site-builder tenants keep their subdomain signal");
  // National Portrait Gallery: "gallery" in onlinegallery.art is a generic word; the venue's initials identify npg.org.uk.
  const npg = await consumeDirectorySearchEvidence(request("National Portrait Gallery", "London"), [receipt("National Portrait Gallery", "London", [
    { url: "https://npgshop.org.uk/", title: "National Portrait Gallery Shop" },
    { url: "https://onlinegallery.art/en/museums/national-portrait-gallery", title: "National Portrait Gallery — London, United Kingdom" },
    { url: "https://www.npg.org.uk/about/organisation/", title: "Organisation" },
  ])], { now });
  assert.deepEqual(npg.candidates.map((c) => c.websiteSeed), ["https://www.npg.org.uk/about/organisation/"]);
  assert.equal(siteOperatedBySubject("National Portrait Gallery", "https://onlinegallery.art/", []).operated, false);
  // A group site that only shows the property on a deep page is not promoted to an official site.
  const pivot = await consumeDirectorySearchEvidence(request("The Pivot Hotel Montecasino", "Johannesburg", "ZA"), [receipt("The Pivot Hotel Montecasino", "Johannesburg", [
    { url: "https://www.tsogosun.com/hotel/the-pivot-hotel/", title: "The Pivot Hotel Montecasino Fourways, Johannesburg" },
    { url: "https://bnbfinder.co.za/places/the-pivot-hotel-montecasino/", title: "The Pivot Hotel Montecasino - BNB Finder" },
  ], "ZA")], { now });
  assert.deepEqual(pivot.candidates.map((c) => c.websiteSeed), []);
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
    "https://revolution-bars.co.uk/bar/Aberdeen/menus/food-menu/",
    "https://revolution-bars.co.uk/bar/aberdeen/menus/drinks-menu/",
  ]) assert.equal(articleLikePath(url), true, url);
  for (const url of [
    "https://www.revolution-bars.co.uk/parties-and-events/private-hire/",
    "https://www.theothers.uk.com/venue-hire-specs",
    "https://rockingthedaisies.com/ct/contact/",
    "https://www.toca.social/info/contact-us",
    "https://veldandsea.com/venue-hire/",
    "https://www.stlukesglasgow.com/special-events/weddings/",
    "https://www.example.org/",
    "https://revolution-bars.co.uk/parties-and-events/corporate-events/",
    "https://revolution-bars.co.uk/bar/aberdeen/",
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

test("item-picker variants of a page already planned or read are not planned again", () => {
  const planner = new GapPlanner(["VENUE_FACTS:SPACES"]);
  const add = (url: string) => planner.add({ url, kind: "PAGE", dims: ["VENUE_FACTS:SPACES"], source: "LINK", discoveredFrom: "https://g.example/", label: "", strength: 1 });
  add("https://g.example/meeting-space-photos");
  add("https://g.example/meeting-space-photos?itemId=abc");
  add("https://g.example/rooms?page=2");
  add("https://g.example/hire?type=wedding");
  assert.deepEqual(planner.pending().map((item) => item.url).sort(), ["https://g.example/hire?type=wedding", "https://g.example/meeting-space-photos", "https://g.example/rooms?page=2"]);
  planner.markDone("https://g.example/rooms");
  add("https://g.example/rooms?page=3");
  assert.equal(planner.pending().some((item) => item.url.includes("page=3")), false);
});

test("a case-variant of a page already planned or read is not planned again", () => {
  const planner = new GapPlanner(["VENUE_FACTS:SPACES"]);
  const add = (url: string) => planner.add({ url, kind: "PAGE", dims: ["VENUE_FACTS:SPACES"], source: "LINK", discoveredFrom: "https://r.example/", label: "", strength: 1 });
  add("https://r.example/bar/Aberdeen/menus/food-menu/");
  add("https://r.example/bar/aberdeen/menus/food-menu/");
  assert.equal(planner.pending().length, 1);
  planner.markDone("https://r.example/bar/aberdeen/menus/food-menu/");
  add("https://r.example/bar/Aberdeen/menus/food-menu");
  assert.equal(planner.pending().length, 0);
});

test("only the best sitemap tier is fetched: page sitemaps, never author, template or post archives", () => {
  assert.deepEqual(rankChildSitemaps(["https://r.example/ct/author-sitemap.xml", "https://r.example/ct/wpr_templates-sitemap.xml", "https://r.example/ct/page-sitemap.xml", "https://r.example/ct/post-sitemap.xml"]), ["https://r.example/ct/page-sitemap.xml"]);
  assert.deepEqual(rankChildSitemaps(["https://r.example/a-sitemap.xml", "https://r.example/b-sitemap.xml"]), ["https://r.example/a-sitemap.xml", "https://r.example/b-sitemap.xml"]);
  assert.deepEqual(rankChildSitemaps(["https://r.example/post-sitemap.xml", "https://r.example/author-sitemap.xml"]), ["https://r.example/author-sitemap.xml"]);
});

test("an on-page enquiry form that posts to a booking provider is recorded at the venue page; newsletter forms are not", () => {
  const doc = (body: string) => ({ url: "https://www.toca.social/events/large-bookings", body, kind: "HTML" as const, contentType: "text/html", bytes: body.length, observedAt: now, sourceHash: "b".repeat(64) });
  const enquiry = '<form action="https://bookings.designmynight.com/book" id="contactForm" method="POST"><textarea name="notes"></textarea><input name="email"></form>';
  const newsletter = '<form id="wf-footer-signup" method="get"><input name="email"></form>';
  const forms = (body: string) => extractFromFetchedDocuments([doc(body)], ["PUBLIC_CONTACT"], "TOCA Social").publicContacts.filter((item) => item.type === "CONTACT_FORM");
  assert.deepEqual(forms(enquiry).map((item) => item.value), ["https://www.toca.social/events/large-bookings"]);
  assert.equal(forms(newsletter).length, 0);
  assert.equal(forms('<form action="/search" id="searchContact"><input name="q"></form>').length, 0);
});

test("venue page tiers: contact and identity first, hire and spaces next, galleries after, menus and news never", () => {
  const tier = (url: string, label = "", name = "") => venuePageTier(url, label, name);
  for (const url of ["https://v.example/", "https://v.example/contact-us/", "https://v.example/get-in-touch", "https://v.example/enquiries", "https://v.example/about-us", "https://v.example/find-us"]) assert.equal(tier(url), 1, url);
  for (const url of ["https://v.example/venue-hire/", "https://v.example/private-hire", "https://v.example/functions", "https://v.example/weddings", "https://v.example/celebrations", "https://v.example/corporate-events", "https://v.example/conferences-and-meetings", "https://v.example/spaces", "https://v.example/rooms/ballroom", "https://v.example/facilities", "https://v.example/events/kids-parties"]) assert.equal(tier(url), 2, url);
  for (const url of ["https://v.example/gallery/", "https://v.example/photos", "https://v.example/virtual-tour", "https://v.example/floor-plans", "https://v.example/downloads/venue-brochure.pdf"]) assert.equal(tier(url), 3, url);
  for (const url of ["https://v.example/bar/aberdeen/menus/food-menu/", "https://v.example/info/food-and-drinks", "https://v.example/wedding-menus", "https://v.example/news/launch", "https://v.example/blog/post", "https://v.example/offers/christmas", "https://v.example/shop/gift-cards", "https://v.example/whats-on", "https://v.example/tickets"]) assert.equal(tier(url), 4, url);
  assert.equal(tier("https://group.example/bar/aberdeen/", "", "Revolution Aberdeen"), 1, "property landing page on a group site");
  assert.equal(tier("https://group.example/menus/contact-us"), 1, "a contact route is never demoted");
  for (const url of ["https://v.example/special-events/", "https://v.example/special-events/weddings/", "https://v.example/conferencing/", "https://v.example/private-experiences/", "https://v.example/venues/"]) assert.equal(tier(url), 2, url);
  assert.equal(tier("https://v.example/special-offers"), 4, "special offers remain a promotion");
  assert.equal(tier("https://saint.example/saint-lukes/", "About", "Saint Luke's Glasgow"), 1, "the property's own landing page");
  assert.equal(tier("https://saint.example/saint-lukes/newspress/", "News & Press", "Saint Luke's Glasgow"), 3, "a sub-page that merely sits under the venue name is not an identity page");
});

test("with tiers, a property-named menu path cannot outrank contact or hire pages, and tier 4 is not planned for a venue crawl", () => {
  const profiles = venueCrawlProfiles(undefined, { emailGoal: true, venueName: "Revolution Aberdeen" });
  const dims = (url: string) => [...new Set(profiles.flatMap((profile) => profile.linkDimensions(url, "")))];
  assert.deepEqual(dims("https://r.example/bar/Aberdeen/menus/food-menu/"), []);
  assert(dims("https://r.example/parties-and-events/corporate-events/").length > 0);
  const planner = new GapPlanner(["PUBLIC_CONTACT:EMAIL", "VENUE_FACTS:SPACES"], undefined, undefined, { tierOf: (url, label) => venuePageTier(url, label, "Revolution Aberdeen") });
  const add = (url: string, strength: number, dim: string) => planner.add({ url, kind: "PAGE", dims: [dim], source: "LINK", discoveredFrom: "https://r.example/", label: "", strength });
  add("https://r.example/gallery/photos", 9, "VENUE_FACTS:SPACES");
  add("https://r.example/bar/aberdeen/rooms", 9, "VENUE_FACTS:SPACES");
  add("https://r.example/contact-us", 1, "PUBLIC_CONTACT:EMAIL");
  assert.equal(planner.next(false)?.url, "https://r.example/contact-us");
  planner.markDone("https://r.example/contact-us");
  assert.equal(planner.next(false)?.url, "https://r.example/bar/aberdeen/rooms");
  planner.markDone("https://r.example/bar/aberdeen/rooms");
  assert.equal(planner.next(false)?.url, "https://r.example/gallery/photos");
});

test("a group's property directory page cannot assert the mailboxes of sibling properties", () => {
  const body = '<main><h1>Our properties</h1><p>Emperors Palace <a href="mailto:info@emperorspalace.com">info@emperorspalace.com</a></p><p>Graceland <a href="mailto:info@graceland.co.za">info@graceland.co.za</a></p><p>Rio <a href="mailto:info@riocasino.co.za">info@riocasino.co.za</a></p><p>Group <a href="mailto:info@peermont.com">info@peermont.com</a></p></main>';
  const doc = { url: "https://www.peermont.com/our-properties/", body, kind: "HTML" as const, contentType: "text/html", bytes: body.length, observedAt: now, sourceHash: "c".repeat(64) };
  const mail = extractFromFetchedDocuments([doc], ["PUBLIC_CONTACT"], "Peermont D'oreale Grande Hotel").publicContacts.filter((item) => item.type === "EMAIL");
  const flags = Object.fromEntries(mail.map((item) => [item.value, item.reviewRequired]));
  assert.equal(flags["info@peermont.com"], false);
  for (const sibling of ["info@emperorspalace.com", "info@graceland.co.za", "info@riocasino.co.za"]) assert.equal(flags[sibling], true, sibling);
  const single = extractFromFetchedDocuments([{ ...doc, url: "https://www.example-hotel.com/contact/", body: '<a href="mailto:events@sister-brand.com">events@sister-brand.com</a> <a href="mailto:info@example-hotel.com">info@example-hotel.com</a>' }], ["PUBLIC_CONTACT"], "Example Hotel").publicContacts;
  assert(single.every((item) => item.reviewRequired === false), "a single operator-domain mailbox keeps the existing acceptance policy");
  const staff = ["anna", "olga", "hakan", "nook", "amy", "daiana"].map((name) => `<a href="mailto:${name}@group-world.com">${name}@group-world.com</a>`).join(" ");
  const directory = extractFromFetchedDocuments([{ ...doc, url: "https://www.school-london.co.uk/contact-us/", body: `<main>${staff}</main>` }], ["PUBLIC_CONTACT"], "School London").publicContacts.filter((item) => item.type === "EMAIL");
  assert.equal(directory.length, 6);
  assert(directory.every((item) => item.reviewRequired === true), "a staff directory on one off-domain host is retained for review, not asserted");
  const group = ["pivot", "palazzo", "piazza"].map((name) => `<a href="mailto:${name}.reservations@groupco.com">${name}.reservations@groupco.com</a>`).join(" ");
  const sameDomain = Object.fromEntries(extractFromFetchedDocuments([{ ...doc, url: "https://www.groupco.com/hotel/the-pivot-hotel/", body: `<main>${group}</main>` }], ["PUBLIC_CONTACT"], "The Pivot Hotel").publicContacts.filter((item) => item.type === "EMAIL").map((item) => [item.value, item.reviewRequired]));
  assert.equal(sameDomain["pivot.reservations@groupco.com"], false);
  assert.equal(sameDomain["palazzo.reservations@groupco.com"], true);
  assert.equal(sameDomain["piazza.reservations@groupco.com"], true);
  const only = extractFromFetchedDocuments([{ ...doc, url: "https://www.groupco.com/hotel/the-pivot-hotel/", body: '<a href="mailto:pivot.reservations@groupco.com">pivot.reservations@groupco.com</a>' }], ["PUBLIC_CONTACT"], "The Pivot Hotel").publicContacts;
  assert(only.every((item) => item.reviewRequired === false), "a lone property mailbox is unaffected");
  const mailFor = (url: string, body: string, name = "The Pivot Hotel") => extractFromFetchedDocuments([{ ...doc, url, body }], ["PUBLIC_CONTACT"], name).publicContacts.filter((item) => item.type === "EMAIL");
  const bird = '<a href="mailto:reception@sister-gardens.co.za">reception@sister-gardens.co.za</a>';
  assert(mailFor("https://www.groupco.com/casino/bird-gardens/", bird).every((item) => item.reviewRequired === true), "an off-domain mailbox on an unrelated page of a group site is retained for review");
  assert(mailFor("https://www.groupco.com/contact-us/", bird).every((item) => item.reviewRequired === false), "the same mailbox on a contact page keeps the existing policy");
  assert(mailFor("https://www.groupco.com/", bird).every((item) => item.reviewRequired === false), "and on the homepage");
  assert(mailFor("https://www.groupco.com/casino/montecasino-bird-gardens/", bird, "The Pivot Hotel Montecasino").every((item) => item.reviewRequired === true), "sharing one word with the venue name does not make another attraction's page the venue's");
  assert(mailFor("https://www.groupco.com/hotel/the-pivot-hotel/", bird, "The Pivot Hotel Montecasino").every((item) => item.reviewRequired === false), "the venue's own landing page keeps the existing policy");
});

test("a WordPress author link is page metadata, not a venue mailbox", () => {
  const body = '<main><p>Welcome</p><span class="vcard rich-snippet-hidden"><span class="fn"><a href="https://venue-site.com/author/jo-builder-co-uk/" rel="author">jo@builder.co.uk</a></span></span><a href="mailto:hello@venue-site.com">hello@venue-site.com</a></main>';
  const emails = extractFromFetchedDocuments([{ url: "https://venue-site.com/", body, kind: "HTML" as const, contentType: "text/html", bytes: body.length, observedAt: now, sourceHash: "f".repeat(64) }], ["PUBLIC_CONTACT"], "V").publicContacts.filter((item) => item.type === "EMAIL").map((item) => item.value);
  assert.deepEqual(emails, ["hello@venue-site.com"]);
});

test("capacity is read from the ways venues state it, and overnight beds are not event capacity", () => {
  const page = (body: string) => ({ url: "https://v.example/events/", body: `<main><p>${body}</p></main>`, kind: "HTML" as const, contentType: "text/html", bytes: body.length, observedAt: now, sourceHash: "d".repeat(64) });
  const counts = (body: string) => extractFromFetchedDocuments([page(body)], ["VENUE_FACTS"], "V").venueFacts.filter((fact) => fact.fieldName === "capacity").map((fact) => (fact.value as { count: number; layout: string }).count);
  assert.deepEqual(counts("Saint Luke’s can accommodate intimate meetings from 10 guests to larger reception sets up to 450. Get in touch."), [450]);
  assert.deepEqual(counts("There you have enough space to host 80 people comfortably, with a projector screen."), [80]);
  assert.deepEqual(counts("We are located in a valley and can cater for 100 – 120 Guests in the historic family cellar."), [120]);
  assert.deepEqual(counts("We offer accommodation for 22 guests in self-catering cottages and glamping tents. The cottages hold 22 guests overnight."), []);
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

test("every emitted seed keeps its source pathname, as the Nexus consumer requires", async () => {
  const r = await consumeDirectorySearchEvidence(request("Shoreditch Balls", "London"), [receipt("Shoreditch Balls", "London", [
    { url: "https://www.shoreditchballs.com/events/adlibretto", title: "AdLibretto" },
  ])], { now });
  assert(r.candidates.length > 0);
  for (const c of r.candidates) assert.equal(new URL(c.websiteSeed).pathname, new URL(c.sourceUrl).pathname);
});
