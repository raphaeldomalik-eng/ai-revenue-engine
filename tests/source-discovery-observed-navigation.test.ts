import assert from "node:assert/strict";
import test from "node:test";
import { crawlVerifiedSource } from "../src/nexus/source-discovery/crawler.ts";
import { executeSourceDiscoveryRequest, InMemoryNexusResultStore } from "../src/nexus/executor.ts";
import { CONTRACTS, validateSourceDiscoveryResult } from "../src/nexus/contracts.ts";

const budget = { maxPages: 3, maxRequests: 10, maxBytesPerResponse: 100000, maxRedirects: 2, maxRetries: 0, timeoutMs: 1000, minRequestDelayMs: 0 };
const resolveHost = async () => [{ address: "93.184.216.34", family: 4 }];
const html = (body: string) => new Response(body, { headers: { "content-type": "text/html" } });
const refresh = (url: string) => `<html><head><title>HTML Meta Tag</title><meta http-equiv = "refresh" content = "1; url = ${url}" /></head><body>Redirecting to another URL</body></html>`;
const request = (url: string) => ({
  contractVersion: CONTRACTS.SOURCE_DISCOVERY_REQUEST,
  discoveryRequestId: "44444444-4444-4444-8444-444444444444", idempotencyKey: "22222222-2222-4222-8222-222222222222", correlationId: "33333333-3333-4333-8333-333333333333",
  originatingProduct: "event_suite_resources", subjectReference: { canonicalEntityId: null, candidateReference: { sourceSystem: "event_suite_resources", sourceRecordId: "East to West" }, entityType: "VENUE" },
  verifiedSourceUrl: url, venueName: "East to West", acquisitionGoal: "VENUE_EMAIL", requestedExtractors: ["IDENTITY", "PUBLIC_CONTACT", "VENUE_FACTS"],
  freshnessRequirements: { maxAgeHours: 24 }, crawlBudget: budget, existingEvidenceRefs: [], requestedBy: { actorType: "PRODUCT", actorId: "resources" }, createdAt: "2026-11-02T00:00:00Z",
});

test("the observed East to West meta navigation reaches contact/footer mailto through normal bounded retrieval", async () => {
  const calls: string[] = [];
  const result = await executeSourceDiscoveryRequest(request("https://easttowest.co.za/"), { resolveHost, fetchImpl: async input => {
    const url = String(input); calls.push(url);
    if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /");
    if (url === "https://easttowest.co.za/") return html(refresh("https://www.easttowest.co.za/en"));
    if (url === "https://www.easttowest.co.za/en") return html('<title>East to West Events & Conferences</title><a href="/en/contact/">Contact</a>');
    if (url === "https://www.easttowest.co.za/en/contact/") return html('<title>Contact East to West</title><footer><a href="mailto:marisa@easttowest.co.za?Subject=Contact%20from%20website" aria-label="Envelope"><span>Envelope</span></a><a href="mailto:info@easttowest.co.za">info@easttowest.co.za</a></footer>');
    return new Response(null, { status: 404 });
  } }, new InMemoryNexusResultStore()) as ReturnType<typeof validateSourceDiscoveryResult>;
  assert(calls.includes("https://www.easttowest.co.za/en/contact/"));
  assert(result.publicContacts.some(c => c.type === "EMAIL" && c.value === "info@easttowest.co.za" && !c.reviewRequired));
  assert.equal(result.crawl.redirects, 1);
  assert(result.crawl.requestCount <= budget.maxRequests);
  assert.equal(result.source.finalUrl, "https://www.easttowest.co.za/en");
});

test("HTML navigation cannot bypass redirect, SSRF, scheme, robots, or HTTP ceilings", async () => {
  for (const target of ["http://venue.org/contact", "https://other.org/contact", "https://127.0.0.1/contact", "https://user:pass@venue.org/contact"]) {
    const calls: string[] = [];
    const result = await crawlVerifiedSource({ verifiedUrl: "https://venue.org/", requestedExtractors: ["PUBLIC_CONTACT"], budget, resolveHost, fetchImpl: async input => {
      const url = String(input); calls.push(url); return url.endsWith("/robots.txt") ? new Response("User-agent: *\nAllow: /") : html(refresh(target));
    } });
    assert.equal(result.documents.length, 0, target);
    assert.equal(result.stats.status, "BLOCKED", target);
    assert.deepEqual(calls, ["https://venue.org/robots.txt", "https://venue.org/"]);
  }
  for (const disallow of [true, false]) {
    const calls: string[] = [];
    const result = await crawlVerifiedSource({ verifiedUrl: "https://venue.org/", requestedExtractors: ["PUBLIC_CONTACT"], budget: { ...budget, maxRequests: 4 }, resolveHost, fetchImpl: async input => {
      const url = String(input); calls.push(url);
      if (url.endsWith("/robots.txt")) return new Response(`User-agent: *\n${disallow ? "Disallow: /contact" : "Allow: /"}`);
      return html(refresh(url.endsWith("/contact") ? "/" : "/contact"));
    } });
    assert.equal(result.documents.length, 0);
    assert(result.stats.requestCount <= 4);
    assert(result.stats.redirects <= 2);
    if (disallow) assert(!calls.includes("https://venue.org/contact"));
  }
});

test("refused migrated-site destination survives the result contract as observation, never an accepted identity or contact", async () => {
  let calls = 0;
  const result = await executeSourceDiscoveryRequest(request("https://vivaldivenue.co.za/"), { resolveHost, fetchImpl: async input => {
    calls++;
    return String(input).endsWith("/robots.txt") ? new Response("User-agent: *\nAllow: /") : new Response(null, { status: 301, headers: { location: "https://vivaldivenue9.wixsite.com/vivaldi-venue/contact" } });
  } }, new InMemoryNexusResultStore()) as ReturnType<typeof validateSourceDiscoveryResult>;
  assert.equal(calls, 2, "refused Wix target is not fetched under the old scope");
  assert.equal(result.crawl.status, "BLOCKED");
  const candidate = result.identityFacts.find(f => f.fieldName === "websiteRedirectCandidate");
  assert.deepEqual(candidate?.value, { from: "https://vivaldivenue.co.za/", url: "https://vivaldivenue9.wixsite.com/vivaldi-venue/contact", status: 301, reason: "CROSS_SITE" });
  assert.equal(candidate?.confidence, null);
  assert(result.evidenceRefs.includes(candidate!.evidenceRef!));
  assert.equal(result.publicContacts.length, 0);
  assert.equal(result.guideEmailReady, false);
});

test("all seven owner-observed enquiry mailto values extract from their official page/footer, including off-domain email", async () => {
  const fixtures = [
    ["Vivaldi Venue", "https://vivaldivenue9.wixsite.com/vivaldi-venue/contact", "vivaldivenue@gmail.com"],
    ["Faraway Tree", "https://farawaytree.co.za/Pages/Contact-Us.asp", "info@farawaytree.co.za"],
    ["Hildenbrand Estate", "https://hildenbrand.co.za/contact-us/", "info@wine-estate-hildenbrand.co.za"],
    ["Johannesdal 1207", "https://www.johannesdal1207.co.za/contact", "manager@johannesdal1207.co.za"],
    ["East to West", "https://www.easttowest.co.za/en/contact/", "info@easttowest.co.za"],
    ["Glenburn Lodge & Spa", "https://guvonhotels.co.za/glenburn-lodge-spa/glenburn-accommodation/", "reservations@glenburn.co.za"],
    ["Domaine Brahms", "https://www.brahms.co.za/", "brahms@iafrica.com"],
  ];
  for (const [name, url, email] of fixtures) {
    // Faraway's live browser proof is HTTP; this HTTPS-only mock tests the
    // extractor, not live reachability or a permission to downgrade transport.
    const result = await executeSourceDiscoveryRequest({ ...request(url!), venueName: name }, { resolveHost, fetchImpl: async input => String(input).endsWith("/robots.txt")
      ? new Response("User-agent: *\nAllow: /")
      : html(`<html><head><title>${name}</title></head><body>Venue enquiries<footer><a href="mailto:${email}?subject=Website%20enquiry">${email}</a></footer></body></html>`) }, new InMemoryNexusResultStore()) as ReturnType<typeof validateSourceDiscoveryResult>;
    assert(result.publicContacts.some(c => c.type === "EMAIL" && c.value === email && !c.reviewRequired), name);
    assert(result.publicContacts.every(c => c.sourceUrl === url), name);
  }
});
