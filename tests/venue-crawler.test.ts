import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { extractFromFetchedDocuments } from "../src/nexus/source-discovery/crawler.ts";
import type { FetchedDocument } from "../src/nexus/source-discovery/types.ts";
import { crawlVenueOfficialSite, VENUE_CRAWL_BUDGET } from "../src/nexus/source-discovery/venue/crawl.ts";
import { buildVenueEvidencePackage, namedSpacesInText } from "../src/nexus/source-discovery/venue/evidence.ts";
import { planVenueHttpsTarget, sameAuthorisedVenueSite } from "../src/nexus/source-discovery/venue/http-authority.ts";
import { assessVenueLink, rankVenueLinks } from "../src/nexus/source-discovery/venue/selection.ts";

const origin = "https://venue.org";
function page(path: string, body: string): FetchedDocument {
  return {
    url: `${origin}${path}`, body, contentType: "text/html", bytes: Buffer.byteLength(body),
    sourceHash: createHash("sha256").update(body).digest("hex"), observedAt: "2026-10-02T12:00:00.000Z", kind: "HTML",
  };
}

test("venue ranking prefers hire, spaces, gallery and a venue PDF over what's-on", () => {
  const ranked = rankVenueLinks([
    { href: "/whats-on", label: "nav What's on" },
    { href: "/venue-hire", label: "nav Venue hire" },
    { href: "/spaces", label: "Our spaces" },
    { href: "/gallery", label: "nav Gallery" },
    { href: "/downloads/venue-pack.pdf", label: "Venue brochure" },
    { href: "/privacy", label: "Privacy" },
    { href: "https://supplier.example/contact", label: "Supplier" },
  ], `${origin}/`);
  assert.deepEqual(ranked.map((item) => new URL(item.url).pathname), [
    "/venue-hire", "/gallery", "/downloads/venue-pack.pdf", "/spaces",
  ]);
  assert.equal(ranked.some((item) => item.url.includes("whats-on")), false);
  assert.equal(ranked.some((item) => item.url.includes("supplier.example")), false);
  assert.ok(ranked.find((item) => item.url.endsWith(".pdf"))?.dims.includes("VENUE_FACTS:CAPACITY"));
});

test("airport direction variants and menus do not consume the venue budget", () => {
  assert.equal(assessVenueLink(`${origin}/directions-from-the-airport`, "Directions from the airport"), null);
  assert.equal(assessVenueLink(`${origin}/menu/`, "Menu"), null);
  assert.ok(assessVenueLink(`${origin}/directions`, "nav Directions"));
});

test("navigation and path together outrank a bare keyword in the footer", () => {
  const nav = assessVenueLink(`${origin}/venue-hire`, "nav Hire");
  const footer = assessVenueLink(`${origin}/blog/hire-tips`, "Hire tips");
  assert.ok(nav && footer && nav.strength > footer.strength);
});

test("stored HTTP authority upgrades to the same host and refuses another site", () => {
  const planned = planVenueHttpsTarget("http://www.countrysjiek.co.za/weddings");
  assert.equal(planned.upgradedFromHttp, true);
  assert.equal(planned.crawlUrl, "https://www.countrysjiek.co.za/weddings");
  assert.equal(planned.refusal, null);
  assert.equal(sameAuthorisedVenueSite("http://countrysjiek.co.za/", "https://www.countrysjiek.co.za/"), true);
  assert.equal(sameAuthorisedVenueSite("https://theempirevenue.co.za/", "https://theempire.co.za/"), false);
  assert.equal(planVenueHttpsTarget("http://user:pass@venue.example/").refusal, "CREDENTIALS_IN_AUTHORITY");
  assert.equal(planVenueHttpsTarget("http://localhost/venue").refusal, "NON_PUBLIC_HOST");
});

test("named spaces, explicit capacities and conflicts stay review-required", () => {
  const rooms = page("/spaces", `<h1>Spaces</h1><h2>Grand Hall</h2><p>Banquet capacity 180.</p><h2>Newsletter</h2><p>Sign up.</p>`);
  const other = page("/hire", `<h2>Grand Hall</h2><p>Banquet capacity 200.</p><p>Step-free access and on-site parking.</p>`);
  const extracted = extractFromFetchedDocuments([rooms, other], ["VENUE_FACTS"]);
  const evidence = buildVenueEvidencePackage(extracted);
  assert.deepEqual(evidence.spaces.map((item) => item.name), ["Grand Hall"]);
  assert.equal(evidence.capacities.every((item) => item.reviewRequired), true);
  assert.deepEqual([...new Set(evidence.capacities.map((item) => item.count))].sort(), [180, 200]);
  assert.ok(evidence.practicalFacts.some((item) => item.fieldName === "parking" || item.fieldName === "accessibility"));
  assert.ok(evidence.capacities.every((item) => item.sourceUrl.startsWith(origin) && item.evidenceRef.includes("source:")));
});

test("room captions on a rooms page become named spaces", () => {
  assert.deepEqual(namedSpacesInText("Jakkalsbessie Chalet met dubbelbed, privaat badkamer", `${origin}/rooms/`), ["Jakkalsbessie Chalet"]);
  assert.deepEqual(namedSpacesInText("Rooms Gallery Menu Jakkalsbessie Chalet", `${origin}/rooms/`), ["Jakkalsbessie Chalet"]);
  assert.deepEqual(namedSpacesInText("Jakkalsbessie Chalet met dubbelbed", `${origin}/news/`), []);
});

test("venue contacts keep hire email and drop newsletter and hotel addresses", () => {
  const contact = page("/contact", `<main>    <a href="mailto:hire@venue.org">Venue hire</a>
    <a href="mailto:newsletter@venue.org">Newsletter</a></main>`);
  const hotels = page("/accommodation", `<h1>Nearby hotels</h1><a href="mailto:reservations@hotel.org">Hotel</a>`);
  const evidence = buildVenueEvidencePackage(extractFromFetchedDocuments([contact, hotels], ["PUBLIC_CONTACT"]));
  assert.deepEqual(evidence.contacts.map((item) => item.value), ["hire@venue.org"]);
  assert.equal(evidence.routingAuthority, "not_operator_confirmed");
  assert.ok(evidence.excludedContacts.some((item) => item.value === "reservations@hotel.org"));
});

test("a theme body class containing logo does not turn venue photos into logos", () => {
  const gallery = page("/photo-gallery", `<body class="wp-custom-logo">
    <img class="custom-logo" src="/logo.png" alt="Venue logo" width="200" height="80">
    <img class="attachment-full" src="/photos/hall.jpg" alt="Grand Hall" width="900" height="700">
  </body>`);
  const images = extractFromFetchedDocuments([gallery], ["IMAGE_CANDIDATES"]).imageCandidates;
  assert.equal(images.find((item) => item.filename === "logo.png")?.likelyRole, "LOGO");
  assert.notEqual(images.find((item) => item.filename === "hall.jpg")?.likelyRole, "LOGO");
});

test("image candidates keep source page, role and unknown rights", () => {
  const gallery = page("/gallery", `<figure><img src="/photos/hall.jpg" alt="Grand Hall interior" width="1200" height="800"></figure>`);
  const evidence = buildVenueEvidencePackage(extractFromFetchedDocuments([gallery], ["IMAGE_CANDIDATES"]));
  const image = evidence.imagesByRole.SPACE?.[0] ?? evidence.imagesByRole.GALLERY?.[0] ?? evidence.imagesByRole.INTERIOR?.[0];
  assert.ok(image);
  assert.equal(image?.sourcePageUrl, `${origin}/gallery`);
  assert.equal(image?.rightsState, "UNKNOWN_RIGHTS");
  assert.equal(image?.operatorConfirmed, false);
});

test("a venue crawl spends its budget on hire and spaces, not what's on", async () => {
  const pages: Record<string, string> = {
    "/": `<nav><a href="/whats-on">What's on</a><a href="/venue-hire">Venue hire</a><a href="/spaces">Spaces</a><a href="/gallery">Gallery</a></nav>
      <p>${"The Lantern is a riverside hall used for conferences and weddings. ".repeat(8)}</p>`,
    "/venue-hire": `<h1>Venue hire</h1><p>Email: hire@venue.org</p><p>Available for weddings and conferences.</p>`,
    "/spaces": `<h2>Grand Hall</h2><p>Banquet capacity 180.</p><img src="/photos/hall.jpg" alt="Grand Hall interior" width="800" height="600">`,
    "/gallery": `<img src="/photos/exterior.jpg" alt="Exterior of the hall" width="800" height="600">`,
    "/whats-on": `<h1>Jazz Night</h1>`,
  };
  const result = await crawlVenueOfficialSite({
    authorisedUrl: "http://venue.org/",
    venueName: "The Lantern",
    budget: { ...VENUE_CRAWL_BUDGET, maxPages: 4, maxRequests: 6, minRequestDelayMs: 0, timeoutMs: 1000, maxRetries: 0 },
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("robots.txt")) return new Response("User-agent: *\nAllow: /");
      const body = pages[url.pathname];
      return new Response(body ?? "missing", { status: body ? 200 : 404, headers: { "content-type": "text/html" } });
    },
  });
  assert.equal(result.authority.upgradedFromHttp, true);
  assert.equal(result.refusal, null);
  const paths = result.crawl?.documents.map((item) => new URL(item.url).pathname) ?? [];
  assert.equal(paths.includes("/whats-on"), false);
  assert.ok(paths.includes("/venue-hire"));
  assert.ok(paths.includes("/spaces"));
  assert.ok(result.evidence?.spaces.some((item) => item.name === "Grand Hall"));
  assert.ok(result.evidence?.contacts.some((item) => item.value === "hire@venue.org"));
  assert.ok((result.crawl?.stats.pageCount ?? 0) <= 4);
});
