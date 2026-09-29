import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { crawlVerifiedSource, extractFromFetchedDocuments } from "../src/nexus/source-discovery/crawler.ts";
import { discoverUsefulSourceUrls } from "../src/nexus/source-discovery/links.ts";
import { validateSourceDiscoveryResult } from "../src/nexus/contracts.ts";
import type { FetchedDocument } from "../src/nexus/source-discovery/types.ts";

const origin = "https://venue.example";
function page(path: string, body: string): FetchedDocument {
  return { url: `${origin}${path}`, body, contentType: "text/html", bytes: Buffer.byteLength(body),
    sourceHash: createHash("sha256").update(body).digest("hex"), observedAt: "2026-09-28T10:00:00.000Z" };
}
const all = ["IDENTITY", "PUBLIC_CONTACT", "VENUE_FACTS", "IMAGE_CANDIDATES", "EVENTS"] as const;

test("balanced link planning spends a finite page budget across contact, hire and event evidence", async () => {
  const home = `<a href="/contact">Contact us</a><a href="/contact/bookings">Bookings</a>
    <a href="/weddings">Weddings</a><a href="/spaces">Spaces and capacities</a>
    <a href="/events">What's on</a><a href="/privacy">Privacy</a>`;
  const planned = discoverUsefulSourceUrls(page("/", home), [...all]);
  assert.deepEqual(planned.slice(0, 3), [`${origin}/contact`, `${origin}/events`, `${origin}/spaces`]);
  const pages: Record<string, string> = { "/": home, "/contact": "<p>Email: hello@venue.example</p>",
    "/spaces": "<p>Grand Hall — banquet capacity 180.</p>",
    "/events": '<script type="application/ld+json">{"@type":"Event","name":"Jazz Night","startDate":"2026-10-22T19:30:00Z"}</script>' };
  const result = await crawlVerifiedSource({ verifiedUrl: `${origin}/`, requestedExtractors: [...all],
    budget: { maxPages: 4, maxRequests: 5, maxBytesPerResponse: 10000, maxRedirects: 0, maxRetries: 0, timeoutMs: 1000, minRequestDelayMs: 0 },
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (input) => String(input).endsWith("robots.txt") ? new Response("User-agent: *\nAllow: /")
      : new Response(pages[new URL(String(input)).pathname] ?? "not found", { status: pages[new URL(String(input)).pathname] ? 200 : 404 }) });
  assert.deepEqual(result.documents.map((item) => new URL(item.url).pathname), ["/", "/contact", "/events", "/spaces"]);
  assert.equal(result.stats.requestCount, 5);
  const extraction = extractFromFetchedDocuments(result.documents, [...all]);
  assert.ok(extraction.publicContacts.some((item) => item.value === "hello@venue.example"));
  assert.ok(extraction.venueFacts.some((item) => item.fieldName === "capacity"));
  assert.equal(extraction.eventCandidates[0]?.title, "Jazz Night");
});

test("JSON-LD Organization and ContactPoint supply evidence-backed business contacts and identity", () => {
  const source = page("/", `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"LocalBusiness","name":"The Lantern","url":"https://venue.example/","address":{"@type":"PostalAddress","streetAddress":"4 River Road","addressLocality":"Bristol","postalCode":"BS1 2AB"},"contactPoint":{"@type":"ContactPoint","contactType":"bookings","telephone":"+44 117 555 0101","email":"bookings@venue.example"},"geo":{"latitude":51.45,"longitude":-2.59},"sameAs":["https://www.instagram.com/lantern"]}]}</script>`);
  const result = extractFromFetchedDocuments([source], ["IDENTITY", "PUBLIC_CONTACT", "VENUE_FACTS"]);
  assert.ok(result.identityFacts.some((item) => item.fieldName === "siteName" && item.value === "The Lantern"));
  assert.ok(result.identityFacts.some((item) => item.fieldName === "address" && String(item.value).includes("BS1 2AB")));
  assert.ok(result.identityFacts.some((item) => item.fieldName === "sameAs" && String(item.value).includes("instagram")));
  assert.deepEqual(result.publicContacts.map((item) => [item.type, item.value]), [["PHONE", "+44 117 555 0101"], ["EMAIL", "bookings@venue.example"]]);
  assert.ok(result.venueFacts.some((item) => item.fieldName === "geo"));
  assert.ok(result.publicContacts.every((item) => item.sourceUrl === source.url && item.evidenceRef.includes(source.sourceHash) && item.confidence !== null));
});

test("contact page visible labels and obfuscation are found without footer vendor or privacy contacts", () => {
  const home = page("/", `<footer>Website by Pixel Studio. hello@pixelstudio.example. Privacy officer: privacy@venue.example.</footer>`);
  const contact = page("/contact", `<main><h1>Contact us</h1><p>Bookings email: bookings [at] venue.example</p>
    <p>Call us: +44 (0)20 7946 0123</p><p>WhatsApp: +44 7700 900123</p>
    <form action="/enquiry"><input name="email"></form></main>`);
  const result = extractFromFetchedDocuments([home, contact], ["PUBLIC_CONTACT"]);
  assert.ok(result.publicContacts.some((item) => item.type === "EMAIL" && item.value === "bookings@venue.example"));
  assert.ok(result.publicContacts.some((item) => item.type === "PHONE" && item.value.includes("7946 0123")));
  assert.ok(result.publicContacts.some((item) => item.type === "WHATSAPP" && item.value.includes("900123")));
  assert.ok(result.publicContacts.some((item) => item.type === "CONTACT_FORM" && item.value === `${origin}/enquiry`));
  assert.ok(result.publicContacts.every((item) => !/pixelstudio|privacy@/.test(item.value)));
});

test("named rooms retain explicit layout capacities and conflicting page values require review", () => {
  const rooms = page("/spaces", `<h1>Our spaces</h1><h2>Grand Hall</h2><p>Banquet capacity 180. Standing capacity 240.</p>
    <h2>Garden Room</h2><p>Theatre capacity 60. Step-free access, Wi-Fi and a loading bay.</p>`);
  const hire = page("/hire", `<h1>Grand Hall hire</h1><p>Banquet capacity 200.</p>`);
  const result = extractFromFetchedDocuments([rooms, hire], ["VENUE_FACTS"]);
  const capacities = result.venueFacts.filter((item) => item.fieldName === "capacity");
  assert.ok(capacities.some((item) => JSON.stringify(item.value).includes('"layout":"banquet"') && JSON.stringify(item.value).includes('"count":180')));
  assert.ok(capacities.some((item) => JSON.stringify(item.value).includes('"layout":"theatre"') && JSON.stringify(item.value).includes('"count":60')));
  assert.ok(capacities.some((item) => JSON.stringify(item.value).includes('"count":200') && item.reviewRequired));
  assert.ok(capacities.some((item) => JSON.stringify(item.value).includes('"count":180') && item.reviewRequired));
  assert.equal(capacities.some((item) => JSON.stringify(item.value).includes('"layout":"reception"')), false);
  assert.ok(result.venueFacts.some((item) => item.fieldName === "wifi"));
  assert.ok(result.venueFacts.some((item) => item.fieldName === "loadingAccess"));
});

test("image rights default unknown and explicit restrictive or reusable terms retain evidence", () => {
  const unknown = page("/gallery", `<img src="/images/a.jpg" alt="Hall">`);
  const reserved = page("/gallery-rights", `<img src="/images/b.jpg"><footer>© 2026 The Lantern. All rights reserved.</footer>`);
  const permission = page("/press", `<img src="/images/c.jpg"><p>Photo use requires written permission from The Lantern.</p>`);
  const reusable = page("/open-media", `<figure><img src="/images/d.jpg"></figure><p>Images on this page are licensed CC BY 4.0 for commercial reuse.</p>`);
  for (const [document, expected] of [[unknown, "UNKNOWN_RIGHTS"], [reserved, "RIGHTS_RESERVED"],
    [permission, "PERMISSION_REQUIRED"], [reusable, "VERIFIED_REUSABLE"]] as const) {
    const candidate = extractFromFetchedDocuments([document], ["IMAGE_CANDIDATES"]).imageCandidates[0]!;
    assert.equal(candidate.rightsState, expected);
    if (expected === "UNKNOWN_RIGHTS") assert.equal(candidate.rightsEvidence, null);
    else {
      assert.equal(candidate.rightsEvidence?.sourceUrl, document.url);
      assert.ok(candidate.rightsEvidence?.statement);
      assert.ok(candidate.rightsEvidence?.evidenceRef);
    }
  }
});

test("footer vendor and privacy mailto links do not displace public booking contacts", () => {
  const source = page("/contact", `<main><h1>Contact us</h1><a href="mailto:bookings@venue.example">Book the venue</a></main>
    <footer>Website by Pixel Studio <a href="mailto:hello@pixelstudio.example">Email the designer</a>
    <a href="mailto:privacy@venue.example">Privacy officer</a></footer>`);
  const found = extractFromFetchedDocuments([source], ["PUBLIC_CONTACT"]).publicContacts.filter((item) => item.type === "EMAIL");
  assert.deepEqual(found.map((item) => item.value), ["bookings@venue.example"]);
});

test("Nexus V1 validation retains explicit rights evidence and rejects unsupported rights certainty", () => {
  const base = { sourceImageUrl: `${origin}/photo.jpg`, sourcePageUrl: `${origin}/`, filename: "photo.jpg", alt: null, title: null,
    caption: null, width: null, height: null, mime: null, likelyRole: "OTHER", exactVenue: null,
    discoveredAt: "2026-09-28T10:00:00.000Z", originDomain: "venue.example" };
  const request = { contractVersion: "nexus.source-discovery-result.v1", discoveryRequestId: "58c8b124-2e1a-46c7-a95a-2c49bf4a82ac",
    idempotencyKey: "bfc05681-87a6-4b68-a49d-353b7f35f7be", subjectReference: { canonicalEntityId: null,
      candidateReference: { sourceSystem: "test", sourceRecordId: "venue" }, entityType: "VENUE" },
    source: { verifiedUrl: `${origin}/`, finalUrl: `${origin}/`, observedAt: "2026-09-28T10:00:00.000Z", sourceHash: "hash" },
    crawl: { status: "COMPLETED", warnings: [], requestCount: 2, pageCount: 1 }, identityFacts: [], publicContacts: [], venueFacts: [],
    eventCandidates: [], evidenceRefs: [] };
  const evidence = { basis: "EXPLICIT_RIGHTS_RESERVED", sourceUrl: `${origin}/`, evidenceRef: "rights:123", statement: "All rights reserved" };
  const result = validateSourceDiscoveryResult({ ...request, imageCandidates: [{ ...base, rightsState: "RIGHTS_RESERVED", rightsEvidence: evidence }] });
  assert.equal(result.imageCandidates[0]?.rightsState, "RIGHTS_RESERVED");
  assert.deepEqual(result.imageCandidates[0]?.rightsEvidence, evidence);
  assert.throws(() => validateSourceDiscoveryResult({ ...request, imageCandidates: [{ ...base, rightsState: "VERIFIED_REUSABLE" }] }), /VERIFIED_REUSABLE_EVIDENCE_REQUIRED/);
});

test("embedded external ticketing Organization contacts are not attributed to the venue", () => {
  const source = page("/", `<script type="application/ld+json">{"@graph":[
    {"@type":"Organization","name":"Ticket Seller","url":"https://tickets.example","contactPoint":{"@type":"ContactPoint","email":"support@tickets.example"}},
    {"@type":"LocalBusiness","name":"The Lantern","url":"https://venue.example/","contactPoint":{"@type":"ContactPoint","email":"hello@venue.example"}}
  ]}</script>`);
  const result = extractFromFetchedDocuments([source], ["IDENTITY", "PUBLIC_CONTACT"]);
  assert.deepEqual(result.publicContacts.filter((item) => item.type === "EMAIL").map((item) => item.value), ["hello@venue.example"]);
  assert.equal(result.identityFacts.some((item) => item.value === "Ticket Seller"), false);
});

test("search and comments forms are not public contact forms, and repeated navigation links collapse", () => {
  const home = page("/", `<a href="/contact">Contact us</a><form action="/search"><input name="query"></form>
    <form action="/wp-comments-post.php"><textarea name="comment"></textarea></form>`);
  const hire = page("/hire", `<a href="/contact">Contact us</a><form action="/enquiry"><input name="email"><textarea name="message"></textarea></form>`);
  const result = extractFromFetchedDocuments([home, hire], ["PUBLIC_CONTACT"]);
  assert.deepEqual(result.publicContacts.filter((item) => item.type === "CONTACT_FORM").map((item) => item.value),
    [`${origin}/contact`, `${origin}/enquiry`]);
});

test("comma-separated capacities keep the full number and generic headings do not invent spaces", () => {
  const source = page("/hire", `<h1>Ideal for</h1><p>With a capacity of 1,800 in our Main Space, host a party.</p>
    <h2>Capacities</h2><p>45 standing in the foyer.</p>`);
  const facts = extractFromFetchedDocuments([source], ["VENUE_FACTS"]).venueFacts;
  assert.ok(facts.some((item) => item.fieldName === "capacity" && (item.value as { count: number }).count === 1800));
  assert.equal(facts.some((item) => item.fieldName === "capacity" && (item.value as { count: number }).count === 1), false);
  assert.equal(facts.some((item) => item.fieldName === "spaces" && item.value === "Capacities"), false);
});

test("ordinary contact and events page titles do not create venue-name conflicts", () => {
  const pages = [page("/", "<title>The Lantern</title><h1>The Lantern</h1>"),
    page("/contact", "<title>Contact | The Lantern</title><h1>Contact us</h1>"),
    page("/events", "<title>Events | The Lantern</title><h1>What's on</h1>")];
  const result = extractFromFetchedDocuments(pages, ["IDENTITY"]);
  assert.equal(result.warnings.some((warning) => /siteName|explicitVenueName/.test(warning)), false);
});

test("a short named space heading without room or hall is retained when capacity follows", () => {
  const source = page("/hire", "<h2>Balcony</h2><p>200 standing.</p>");
  const facts = extractFromFetchedDocuments([source], ["VENUE_FACTS"]).venueFacts;
  assert.ok(facts.some((item) => item.fieldName === "spaces" && item.value === "Balcony"));
  assert.ok(facts.some((item) => item.fieldName === "capacity" && (item.value as { space: string }).space === "Balcony"));
});

test("two capacities on one page do not create a cross-page conflict warning", () => {
  const source = page("/hire", "<h1>Capacities</h1><p>45 standing in the foyer. 120 standing in the garden.</p>");
  const result = extractFromFetchedDocuments([source], ["VENUE_FACTS"]);
  assert.equal(result.warnings.some((warning) => /Conflicting.*capacity/.test(warning)), false);
});

test("site accessibility policy does not outrank venue facilities", () => {
  const source = page("/", `<a href="/accessibility-statement-for-our-websites">Accessibility statement</a>
    <a href="/venue-hire/spaces">Venue hire spaces</a><a href="/facilities">Facilities</a>`);
  assert.equal(discoverUsefulSourceUrls(source, ["VENUE_FACTS"])[0], `${origin}/venue-hire/spaces`);
  assert.equal(discoverUsefulSourceUrls(source, ["VENUE_FACTS"]).includes(`${origin}/accessibility-statement-for-our-websites`), false);
});

test("accommodation directory vendor contacts and WhatsApp share links are not venue contacts", () => {
  const home = page("/", `<a href="mailto:hello@venue.example">Email venue</a>
    <a href="whatsapp://send?text=https://venue.example/">Share this page</a>`);
  const hotels = page("/accommodation/", `<h1>Nearby hotels</h1><a href="mailto:reservations@hotel.example">Hotel bookings</a>
    <a href="tel:+441234567890">Hotel phone</a>`);
  const found = extractFromFetchedDocuments([home, hotels], ["PUBLIC_CONTACT"]).publicContacts;
  assert.deepEqual(found.map((item) => `${item.type}:${item.value}`), ["EMAIL:hello@venue.example"]);
});

test("several labelled departments on one page do not become a cross-page contact conflict", () => {
  const source = page("/contact", `<h1>Contact us</h1><a href="mailto:sales@venue.example">Sales</a>
    <a href="mailto:info@venue.example">General enquiries</a>`);
  const result = extractFromFetchedDocuments([source], ["PUBLIC_CONTACT"]);
  assert.equal(result.warnings.some((warning) => /Conflicting.*email/.test(warning)), false);
  assert.ok(result.publicContacts.every((item) => !item.reviewRequired));
});

test("different sole business emails on separate pages require review with both evidence refs", () => {
  const pages = [page("/contact", `<a href="mailto:bookings@venue.example">Bookings</a>`),
    page("/hire", `<a href="mailto:events@venue.example">Events hire</a>`)];
  const result = extractFromFetchedDocuments(pages, ["PUBLIC_CONTACT"]);
  assert.equal(result.publicContacts.length, 2);
  assert.ok(result.publicContacts.every((item) => item.reviewRequired && item.evidenceRef.includes("source:")));
  assert.ok(result.warnings.some((warning) => /Conflicting.*email/.test(warning)));
});

test("named room capacities in a published capacity list retain names without inventing layouts", () => {
  const source = page("/meeting-rooms/", `<h1>Meeting rooms</h1><p>Room Capacity Porter Tun – 1000 Smeaton Vaults – 110 Sugar Rooms – 120</p>`);
  const capacities = extractFromFetchedDocuments([source], ["VENUE_FACTS"]).venueFacts.filter((item) => item.fieldName === "capacity");
  assert.ok(capacities.some((item) => JSON.stringify(item.value).includes('"space":"Porter Tun"') && (item.value as { count: number }).count === 1000));
  assert.ok(capacities.some((item) => JSON.stringify(item.value).includes('"space":"Sugar Rooms"') && (item.value as { count: number }).count === 120));
  assert.ok(capacities.every((item) => (item.value as { layout: string }).layout === "unspecified"));
});

test("venue specification pages rank ahead of generic accessibility information", () => {
  const source = page("/", `<a href="/accessibility/">Accessibility</a>
    <a href="/venue-hire/venue-specifications/">Venue specifications</a><a href="/whats-on/">What's on</a>`);
  const planned = discoverUsefulSourceUrls(source, ["VENUE_FACTS", "EVENTS"]);
  assert.equal(planned[0], `${origin}/whats-on/`);
  assert.ok(planned.indexOf(`${origin}/venue-hire/venue-specifications/`) < planned.indexOf(`${origin}/accessibility/`));
});

test("marketing, newsletter and page-navigation headings are not named rooms", () => {
  const source = page("/venue-hire/", `<h2>A space where history is made</h2><p>Capacity of 1800.</p>
    <h2>Newsletter Signup</h2><p>Our next event is tomorrow.</p>
    <h2>Venue Spaces</h2><p>Explore the venue.</p><h2>Conference Venue</h2><p>Capacity 500.</p>
    <h2>Barbican Hall</h2><p>The hall is available for hire.</p>`);
  const names = extractFromFetchedDocuments([source], ["VENUE_FACTS"]).venueFacts.filter((item) => item.fieldName === "spaces").map((item) => item.value);
  assert.deepEqual(names, ["Barbican Hall"]);
});

test("nested Place name remains evidence without replacing the organisation site name", () => {
  const source = page("/", `<title>Homepage</title><script type="application/ld+json">{"@graph":[
    {"@type":"Organization","name":"Artscape","url":"https://venue.example/"},
    {"@type":"Place","name":"iSibaya Room"}]}</script>`);
  const facts = extractFromFetchedDocuments([source], ["IDENTITY"]).identityFacts;
  assert.deepEqual(facts.filter((item) => item.fieldName === "siteName").map((item) => item.value), ["Artscape"]);
  assert.ok(facts.some((item) => item.fieldName === "placeName" && item.value === "iSibaya Room"));
});

test("standalone booking ContactPoint on an explicit contact page retains contact type evidence", () => {
  const source = page("/contact", `<script type="application/ld+json">{"@type":"ContactPoint",
    "contactType":"venue bookings","telephone":"+44 20 7000 1111","email":"hire@venue.example"}</script>`);
  const result = extractFromFetchedDocuments([source], ["IDENTITY", "PUBLIC_CONTACT"]);
  assert.ok(result.publicContacts.some((item) => item.type === "EMAIL" && item.value === "hire@venue.example"));
  assert.ok(result.identityFacts.some((item) => item.fieldName === "contactType" && item.value === "venue bookings"));
});

test("labelled visible contacts on a homepage are retained without mailto or tel links", () => {
  const source = page("/", `<section><h2>Visit Us</h2><p>Email: info@venue.example</p>
    <p>Tel: +44 20 7000 1234</p></section>`);
  const contacts = extractFromFetchedDocuments([source], ["PUBLIC_CONTACT"]).publicContacts;
  assert.ok(contacts.some((item) => item.type === "EMAIL" && item.value === "info@venue.example"));
  assert.ok(contacts.some((item) => item.type === "PHONE" && item.value === "+44 20 7000 1234"));
});

test("a short crawl reaches events after contact before general space pages", () => {
  const source = page("/", `<a href="/contact">Contact</a><a href="/spaces">Spaces</a><a href="/events">Events</a>`);
  assert.deepEqual(discoverUsefulSourceUrls(source, [...all]).slice(0, 2), [`${origin}/contact`, `${origin}/events`]);
});

test("labelled booking contacts on event and wedding pages are retained", () => {
  const result = extractFromFetchedDocuments([
    page("/events", `<p>Bookings email: events@venue.example</p>`),
    page("/weddings", `<p>Call us: +44 20 7000 9999</p>`),
  ], ["PUBLIC_CONTACT"]);
  assert.ok(result.publicContacts.some((item) => item.value === "events@venue.example"));
  assert.ok(result.publicContacts.some((item) => item.value === "+44 20 7000 9999"));
});

test("standalone booking ContactPoint on homepage retains its contact and type", () => {
  const source = page("/", `<script type="application/ld+json">{"@type":"ContactPoint","contactType":"bookings","email":"bookings@venue.example"}</script>`);
  const result = extractFromFetchedDocuments([source], ["IDENTITY", "PUBLIC_CONTACT"]);
  assert.ok(result.publicContacts.some((item) => item.value === "bookings@venue.example"));
  assert.ok(result.identityFacts.some((item) => item.fieldName === "contactType" && item.value === "bookings"));
});

test("ticketing-provider support contact is not attributed to the venue", () => {
  const source = page("/contact", `<main><p>Bookings email: bookings@venue.example</p>
    <section class="ticketing-provider"><h2>Ticketing provider support</h2><p>Email: support@tickets.example</p></section></main>`);
  const found = extractFromFetchedDocuments([source], ["PUBLIC_CONTACT"]).publicContacts;
  assert.deepEqual(found.filter((item) => item.type === "EMAIL").map((item) => item.value), ["bookings@venue.example"]);
});

test("marketing invitation is not staging evidence", () => {
  const source = page("/hire", `<p>Take the stage at our next event.</p><p>Our hall has a built-in stage.</p>`);
  const facts = extractFromFetchedDocuments([source], ["VENUE_FACTS"]).venueFacts.filter((item) => item.fieldName === "staging");
  assert.equal(facts.length, 1);
  assert.match(String(facts[0]?.value), /built-in stage/i);
});

test("image licence is not applied to a logo and a reserved notice wins over generic reuse", () => {
  const source = page("/gallery", `<img src="/brand-logo.png" alt="Brand logo"><img src="/gallery-photo.jpg" alt="Gallery photo">
    <p>Gallery photos are licensed CC BY 4.0.</p><footer>All rights reserved.</footer>`);
  const images = extractFromFetchedDocuments([source], ["IMAGE_CANDIDATES"]).imageCandidates;
  assert.notEqual(images.find((item) => item.filename === "brand-logo.png")?.rightsState, "VERIFIED_REUSABLE");
  assert.equal(images.find((item) => item.filename === "gallery-photo.jpg")?.rightsState, "RIGHTS_RESERVED");
});

test("an explicit restrictive statement survives later unlabelled reuse of the image URL", () => {
  const result = extractFromFetchedDocuments([
    page("/gallery", `<img src="/shared.jpg"><p>All rights reserved.</p>`),
    page("/about", `<img src="/shared.jpg">`),
  ], ["IMAGE_CANDIDATES"]);
  assert.equal(result.imageCandidates.length, 1);
  assert.equal(result.imageCandidates[0]?.rightsState, "RIGHTS_RESERVED");
  assert.equal(result.imageCandidates[0]?.rightsEvidence?.sourceUrl, `${origin}/gallery`);
});

test("image planning discovers first-party permissions pages", () => {
  const source = page("/", `<a href="/gallery">Gallery</a><a href="/media-terms">Media usage terms</a>
    <a href="/photo-permissions">Photo permissions</a>`);
  const urls = discoverUsefulSourceUrls(source, ["IMAGE_CANDIDATES"]);
  assert.ok(urls.includes(`${origin}/media-terms`));
  assert.ok(urls.includes(`${origin}/photo-permissions`));
});

test("operator and venue names in the same graph do not conflict", () => {
  const source = page("/", `<script type="application/ld+json">{"@graph":[
    {"@type":"Organization","name":"Operator Holdings","url":"https://venue.example/"},
    {"@type":"LocalBusiness","name":"Grand Hall","url":"https://venue.example/"}
  ]}</script>`);
  const result = extractFromFetchedDocuments([source], ["IDENTITY"]);
  assert.equal(result.warnings.some((item) => /Conflicting first-party siteName/.test(item)), false);
  assert.ok(result.identityFacts.some((item) => item.value === "Grand Hall"));
  assert.ok(result.identityFacts.some((item) => item.value === "Operator Holdings"));
});

test("a fetched first-party photo permissions page restricts images with its own evidence", () => {
  const result = extractFromFetchedDocuments([
    page("/gallery", `<img src="/room.jpg"><img src="/brand-logo.svg">`),
    page("/photo-permissions", `<h1>Photo permissions</h1><p>All photos on this website require written permission for reuse.</p>`),
  ], ["IMAGE_CANDIDATES"]);
  const room = result.imageCandidates.find((item) => item.filename === "room.jpg");
  assert.equal(room?.rightsState, "PERMISSION_REQUIRED");
  assert.equal(room?.rightsEvidence?.sourceUrl, `${origin}/photo-permissions`);
  assert.equal(result.imageCandidates.find((item) => item.filename === "brand-logo.svg")?.rightsState, "UNKNOWN_RIGHTS");
});

test("explicit copyright notice is restrictive image evidence", () => {
  const result = extractFromFetchedDocuments([page("/gallery", `<img src="/room.jpg"><footer>© 2026 The Venue.</footer>`)], ["IMAGE_CANDIDATES"]);
  assert.equal(result.imageCandidates[0]?.rightsState, "RIGHTS_RESERVED");
  assert.equal(result.imageCandidates[0]?.rightsEvidence?.basis, "EXPLICIT_RIGHTS_RESERVED");
});

test("hire suitability requires an explicit statement rather than the page path", () => {
  const weak = extractFromFetchedDocuments([page("/weddings", `<h1>Weddings</h1><p>Discover our venue.</p>`)], ["VENUE_FACTS"]);
  const explicit = extractFromFetchedDocuments([page("/hire", `<p>The Garden Room is available for wedding receptions and corporate events.</p>`)], ["VENUE_FACTS"]);
  assert.equal(weak.venueFacts.some((item) => item.fieldName === "hireSuitability"), false);
  assert.ok(explicit.venueFacts.some((item) => item.fieldName === "hireSuitability" && /wedding receptions/.test(String(item.value))));
});

test("structured maximumAttendeeCapacity on a same-origin venue is a venue-wide capacity without an invented space", () => {
  const venue = page("/", `<script type="application/ld+json">{"@context":"https://schema.org","@type":"EventVenue","name":"The Studio","maximumAttendeeCapacity":40}</script>`);
  const capacities = extractFromFetchedDocuments([venue], ["VENUE_FACTS"]).venueFacts.filter((item) => item.fieldName === "capacity");
  assert.deepEqual(capacities.map((item) => item.value), [{ space: null, layout: "unspecified", count: 40, statement: "maximumAttendeeCapacity 40" }]);
  assert.equal(capacities[0]?.reviewRequired, false);
  assert.equal(extractFromFetchedDocuments([venue], ["VENUE_FACTS"]).venueFacts.some((item) => item.fieldName === "spaces"), false);
  const foreign = page("/", `<script type="application/ld+json">{"@type":"EventVenue","url":"https://other.example/","maximumAttendeeCapacity":400}</script>`);
  const organisation = page("/", `<script type="application/ld+json">{"@type":"Organization","maximumAttendeeCapacity":400}</script>`);
  const invalid = page("/", `<script type="application/ld+json">{"@type":"Place","maximumAttendeeCapacity":"about 40"}</script>`);
  for (const doc of [foreign, organisation, invalid]) {
    assert.equal(extractFromFetchedDocuments([doc], ["VENUE_FACTS"]).venueFacts.some((item) => item.fieldName === "capacity"), false);
  }
});
