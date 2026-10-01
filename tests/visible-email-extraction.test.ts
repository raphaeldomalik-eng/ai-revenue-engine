import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { executeSourceDiscoveryRequest, InMemoryNexusResultStore, sourceDiscoveryExecutionKey } from "../src/nexus/executor.ts";
import { extractFromFetchedDocuments } from "../src/nexus/source-discovery/crawler.ts";
import type { FetchedDocument } from "../src/nexus/source-discovery/types.ts";
import { acceptVenueEmail } from "../src/nexus/venue-email.ts";

const origin = "https://venue.org";
function page(path: string, body: string): FetchedDocument {
  const html = `<html><body>${body}</body></html>`;
  return { url: `${origin}${path}`, body: html, contentType: "text/html", bytes: Buffer.byteLength(html),
    sourceHash: createHash("sha256").update(html).digest("hex"), observedAt: "2026-10-01T00:00:00.000Z" };
}
const emails = (body: string) => extractFromFetchedDocuments([page("/", body)], ["PUBLIC_CONTACT"]).publicContacts.filter((item) => item.type === "EMAIL");
const usable = (body: string) => emails(body).filter((item) => !item.reviewRequired).map((item) => item.value);

test("footer same-domain email is extracted", () => {
  assert.deepEqual(usable(`<footer><p>info@venue.org</p></footer>`), ["info@venue.org"]);
});

test("footer free-mail address is kept as a candidate", () => {
  const found = emails(`<footer>venuebookings@gmail.com</footer>`);
  assert.ok(found.some((item) => item.value === "venuebookings@gmail.com"));
});

test("a footer designer address does not discard the venue address", () => {
  const found = emails(`<footer><p>Venue contact: info@venue.org</p><p>Website by Agency — studio@agency.org</p></footer>`);
  assert.deepEqual(found.filter((item) => !item.reviewRequired).map((item) => item.value), ["info@venue.org"]);
  assert.ok(found.some((item) => item.value === "studio@agency.org" && item.reviewRequired));
});

test("an explicitly published off-domain bookings address stays usable", () => {
  const found = emails(`<main><h1>Contact</h1><p>Bookings: reservations@operator.org</p></main>`);
  assert.deepEqual(found.filter((item) => !item.reviewRequired).map((item) => item.value), ["reservations@operator.org"]);
  assert.deepEqual(acceptVenueEmail("hello@webdesignstudio.co.uk", origin, "Example Venue"), { accepted: false, reason: "OFF_DOMAIN_WITHOUT_VENUE_RELATIONSHIP" });
  assert.equal(acceptVenueEmail("reservations@operator.org", origin, "Example Venue", "Bookings: reservations@operator.org").accepted, true);
});

test("a privacy address is retained and does not satisfy venue email", () => {
  const found = emails(`<p>Data protection: privacy@legal-provider.org</p>`);
  assert.equal(found.length, 1);
  assert.equal(found[0]?.reviewRequired, true);
  assert.equal(acceptVenueEmail("privacy@legal-provider.org", origin, "Example Venue", "Data protection: privacy@legal-provider.org").accepted, false);
});

test("an address split across inline elements is extracted", () => {
  assert.deepEqual(usable(`<p><span>events</span><span>@venue.org</span></p>`), ["events@venue.org"]);
});

test("a Cloudflare-protected address is extracted", () => {
  const key = 0x42;
  const encoded = `42${[..."info@venue.org"].map((char) => (char.charCodeAt(0) ^ key).toString(16).padStart(2, "0")).join("")}`;
  assert.deepEqual(usable(`<a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="${encoded}">[email protected]</a>`), ["info@venue.org"]);
});

test("an HTML-entity address is extracted", () => {
  assert.deepEqual(usable(`<p>hello&#64;venue.org</p>`), ["hello@venue.org"]);
});

function pageAt(url: string, body: string): FetchedDocument {
  const html = `<html><body>${body}</body></html>`;
  return { url, body: html, contentType: "text/html", bytes: Buffer.byteLength(html),
    sourceHash: createHash("sha256").update(html).digest("hex"), observedAt: "2026-10-01T00:00:00.000Z" };
}
const addressesOn = (url: string, body: string) => extractFromFetchedDocuments([pageAt(url, body)], ["PUBLIC_CONTACT"]).publicContacts.filter((item) => item.type === "EMAIL");

test("an accommodation page still yields its visible email", () => {
  const found = addressesOn("https://venue.test/accommodation/", "<p>info@venue.org</p>");
  assert.ok(found.some((item) => item.value === "info@venue.org"));
});

test("a hotel contact path still yields its visible email", () => {
  const found = addressesOn("https://venue.org/hotel/contact/", "<p>info@venue.org</p>");
  assert.deepEqual(found.filter((item) => !item.reviewRequired).map((item) => item.value), ["info@venue.org"]);
});

test("a privacy page keeps the address and does not treat it as a venue email", () => {
  const found = addressesOn("https://venue.org/privacy/", "<p>privacy@legal-provider.com</p>");
  assert.equal(found.length, 1);
  assert.equal(found[0]?.reviewRequired, true);
  assert.equal(acceptVenueEmail("privacy@legal-provider.com", "https://venue.org/privacy/", "Example Venue", found[0]?.label ?? "").accepted, false);
});

test("a partner page keeps an unrelated address out of the usable venue contacts", () => {
  const found = addressesOn("https://venue.org/partners/", "<p>accounts@northwind-partners.com</p>");
  assert.equal(found.length, 1);
  assert.equal(found[0]?.value, "accounts@northwind-partners.com");
  assert.equal(found[0]?.reviewRequired, true);
});

test("an unrecognised public suffix is not an email candidate", () => {
  const found = addressesOn("https://venue.org/contact/", "<p>hello@venue.zzzz</p><p>info@venue.org</p>");
  assert.equal(found.some((item) => item.value === "hello@venue.zzzz"), false);
  assert.ok(found.some((item) => item.value === "info@venue.org"));
});

test("recognised multi-label and generic suffixes are extracted", () => {
  const found = addressesOn("https://venue.org/contact/", "<p>info@venue.co.za events@venue.co.uk bookings@venue.com.au hello@venue.org</p>").map((item) => item.value);
  for (const email of ["info@venue.co.za", "events@venue.co.uk", "bookings@venue.com.au", "hello@venue.org"]) assert.ok(found.includes(email), email);
});

test("a contact form does not fabricate an email from its input", () => {
  const result = extractFromFetchedDocuments([page("/contact", `<form action="/enquiry"><input type="email" name="email" placeholder="you@venue.org" value="visitor@venue.org"><textarea name="message"></textarea></form>`)], ["PUBLIC_CONTACT"]);
  assert.equal(result.publicContacts.some((item) => item.type === "EMAIL"), false);
  assert.ok(result.publicContacts.some((item) => item.type === "CONTACT_FORM"));
});

test("a contact form and a published address are both returned", () => {
  const result = extractFromFetchedDocuments([page("/contact", `<form action="/enquiry"><input type="email" name="email"><textarea></textarea></form><p>events@venue.org</p>`)], ["PUBLIC_CONTACT"]);
  assert.ok(result.publicContacts.some((item) => item.type === "CONTACT_FORM"));
  assert.ok(result.publicContacts.some((item) => item.type === "EMAIL" && item.value === "events@venue.org" && !item.reviewRequired));
});

test("a v3 exhausted result is not replayed into v4 extraction", async () => {
  const store = new InMemoryNexusResultStore();
  const idempotencyKey = "22222222-2222-4222-8222-22222222222e";
  const exhausted = { crawl: { status: "COMPLETED", retryable: false, emailOutcome: "EMAIL_SEARCH_EXHAUSTED", pageCount: 1, warnings: [] }, idempotencyKey, publicContacts: [] };
  const v3Key = sourceDiscoveryExecutionKey(idempotencyKey, "resources-v2-source-discovery-v3");
  await store.set(v3Key, exhausted);
  const requested: string[] = [];
  const fresh = await executeSourceDiscoveryRequest({
    contractVersion: "nexus.source-discovery-request.v1",
    discoveryRequestId: "44444444-4444-4444-8444-44444444444e",
    idempotencyKey,
    correlationId: "33333333-3333-4333-8333-33333333333e",
    originatingProduct: "event_suite_resources",
    subjectReference: { canonicalEntityId: null, candidateReference: { sourceSystem: "event_suite_resources", sourceRecordId: "Example Venue" }, entityType: "VENUE" },
    verifiedSourceUrl: `${origin}/`,
    requestedExtractors: ["IDENTITY"],
    acquisitionGoal: "VENUE_EMAIL",
    venueName: "Example Venue",
    freshnessRequirements: { maxAgeHours: 24 },
    crawlBudget: { maxPages: 2, maxRequests: 4, maxBytesPerResponse: 100000, maxRedirects: 1, maxRetries: 0, timeoutMs: 1000, minRequestDelayMs: 0 },
    existingEvidenceRefs: [],
    requestedBy: { actorType: "PRODUCT", actorId: "resources" },
    createdAt: "2026-10-01T00:00:00.000Z",
  }, {
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      requested.push(url.pathname);
      if (url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /");
      return new Response(`<html><body><footer>info@venue.org</footer></body></html>`, { headers: { "content-type": "text/html" } });
    },
  }, store) as any;
  assert.equal(requested.some((path) => path !== "/robots.txt"), true);
  assert.equal(fresh.publicContacts.some((item: { type: string; value: string }) => item.type === "EMAIL" && item.value === "info@venue.org"), true);
  assert.equal(fresh.crawl.emailOutcome, "EMAIL_FOUND");
  assert.equal(await store.get(v3Key), exhausted);
});
