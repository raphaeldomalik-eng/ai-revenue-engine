import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { extractFromFetchedDocuments } from "../src/nexus/source-discovery/crawler.ts";
import { executeSourceDiscoveryRequest } from "../src/nexus/executor.ts";
import { CONTRACTS, validateSourceDiscoveryResult } from "../src/nexus/contracts.ts";
import type { FetchedDocument } from "../src/nexus/source-discovery/types.ts";
import { crawlVenueOfficialSite, VENUE_CRAWL_BUDGET } from "../src/nexus/source-discovery/venue/crawl.ts";

const evidenceDirectory = process.env.UK20_RETAINED_RECEIPTS;
const hashes: Record<string, string> = {
  "04": "0c2388f6c7aaeffbfb5bb385089d20568ac565db898cb4871917ec5034da6096",
  "06": "da19d4a1dee2fa6d320df67b5d135222eaa26e45604660157eb4692b5bf35b1d",
  "07": "e29a32f24a15f1bcedbfc8a60f556164d01a2491bb5ca6d055b78e4478d0bd78",
  "13": "abfb349541ad101c177caafbacea5d2bce0919b74b64eedeaede9b9a84b544c2",
  "14": "f7cde303c8ea7e92998a93c7bdbd8a64d53624e73b1e9aad2cfbcb58a2aea753",
  "18": "61379e7ea9226fa1fdb4fa679f74fb19c5f6f675fed324f0891d0001c0424371",
};

function receipt(number: string): { venueName: string; source: { documents: FetchedDocument[] } } {
  assert.ok(evidenceDirectory, "UK20_RETAINED_RECEIPTS must point to the authenticated receipt directory");
  const bytes = readFileSync(join(evidenceDirectory, `${number}.json`));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), hashes[number], `receipt ${number} hash`);
  const result = JSON.parse(bytes.toString("utf8")) as { venueName: string; source: { documents: FetchedDocument[] } };
  for (const document of result.source.documents) {
    assert.equal(createHash("sha256").update(document.body).digest("hex"), document.sourceHash, document.url);
  }
  return result;
}

const retained = { skip: evidenceDirectory ? false : "Set UK20_RETAINED_RECEIPTS to the private frozen evidence directory" };

test("UK-20 BALLIN' retained hire page yields explicit suitability", retained, () => {
  const row = receipt("04");
  const result = extractFromFetchedDocuments(row.source.documents, ["VENUE_FACTS"], row.venueName);
  assert.ok(result.venueFacts.some((fact) => fact.fieldName === "hireSuitability"
    && /corporate/i.test(String(fact.value))
    && fact.sourceUrl.endsWith("/corporateevents")));
});

test("UK-20 The Canteen retained meetup page yields its space", retained, () => {
  const row = receipt("13");
  const result = extractFromFetchedDocuments(row.source.documents, ["VENUE_FACTS"], row.venueName);
  assert.ok(result.venueFacts.some((fact) => fact.fieldName === "spaces"
    && /community meet\s*up space/i.test(String(fact.value))
    && fact.sourceUrl.includes("/community-meetup-space/")));
});

test("UK-20 Casino Rooms retained hire page yields substantive source description", retained, () => {
  const row = receipt("14");
  const result = extractFromFetchedDocuments(row.source.documents, ["IDENTITY"], row.venueName);
  assert.ok(result.identityFacts.some((fact) => fact.fieldName === "siteDescription"
    && /nightclub/i.test(String(fact.value))
    && fact.sourceUrl.endsWith("/private-hire")));
});

async function plannedRequests(number: string, maxRequests: number): Promise<string[]> {
  const row = receipt(number);
  const pages = new Map(row.source.documents.map((document) => [document.url, document.body]));
  const requests: string[] = [];
  await crawlVenueOfficialSite({
    authorisedUrl: row.source.documents[0]!.url,
    venueName: row.venueName,
    budget: { ...VENUE_CRAWL_BUDGET, maxPages: 4, maxRequests, maxBytesPerResponse: 1_500_000,
      maxRedirects: 0, maxRetries: 0, maxSitemapFetches: 0, minRequestDelayMs: 0, timeoutMs: 1000 },
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /");
      const body = pages.get(url);
      return new Response(body ?? "Not in retained evidence", {
        status: body ? 200 : 404, headers: { "content-type": "text/html" },
      });
    },
  });
  assert.ok(requests.length <= maxRequests);
  return requests;
}

test("UK-20 Freight Island planner schedules its linked FAQ within the request cap", retained, async () => {
  const requests = await plannedRequests("07", 5);
  assert.ok(requests.some((url) => new URL(url).pathname === "/faqs"));
});

test("UK-20 Portsmouth Guildhall planner schedules a linked room page within the request cap", retained, async () => {
  const requests = await plannedRequests("06", 7);
  assert.ok(requests.some((url) => /\/conferencing\/spaces\/[^/]+\/?$/.test(new URL(url).pathname)));
});

test("UK-20 frozen cohort retains all 74 pages and exercises every field family", retained, () => {
  assert.ok(evidenceDirectory);
  const manifest = readFileSync(join(dirname(evidenceDirectory), "SHA256SUMS.txt"), "utf8");
  for (const line of manifest.trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+(.+)$/.exec(line);
    if (!match) continue;
    const file: Buffer = readFileSync(join(dirname(evidenceDirectory), match[2]!.replaceAll("/", "\\")));
    assert.equal(createHash("sha256").update(file).digest("hex"), match[1], match[2]);
  }
  const totals = { pages: 0, identity: 0, addresses: 0, descriptions: 0, contacts: 0, spaces: 0, facilities: 0, images: 0, exactVenueImages: 0, reusableImages: 0 };
  let described = 0;
  let contactable = 0;
  for (let index = 1; index <= 20; index += 1) {
    const number = String(index).padStart(2, "0");
    const row = JSON.parse(readFileSync(join(evidenceDirectory, `${number}.json`), "utf8")) as { venueName: string; source: { documents: FetchedDocument[] } };
    const extracted = extractFromFetchedDocuments(row.source.documents,
      ["IDENTITY", "PUBLIC_CONTACT", "VENUE_FACTS", "IMAGE_CANDIDATES"], row.venueName);
    const descriptions = extracted.identityFacts.filter((fact) => ["siteDescription", "metaDescription"].includes(fact.fieldName));
    if (descriptions.length) described += 1;
    if (extracted.publicContacts.some((fact) => !fact.reviewRequired)) contactable += 1;
    totals.pages += row.source.documents.length;
    totals.identity += extracted.identityFacts.length;
    totals.addresses += extracted.identityFacts.filter((fact) => fact.fieldName === "address").length;
    totals.descriptions += descriptions.length;
    totals.contacts += extracted.publicContacts.length;
    totals.spaces += extracted.venueFacts.filter((fact) => fact.fieldName === "spaces" || fact.fieldName === "capacity").length;
    totals.facilities += extracted.venueFacts.filter((fact) => !["spaces", "capacity"].includes(fact.fieldName)).length;
    totals.images += extracted.imageCandidates.length;
    totals.exactVenueImages += extracted.imageCandidates.filter((fact) => fact.exactVenue === true).length;
    totals.reusableImages += extracted.imageCandidates.filter((fact) => fact.rightsState === "VERIFIED_REUSABLE").length;
  }
  assert.equal(totals.pages, 74);
  assert.equal(described, 20);
  assert.equal(contactable, 18);
  assert.ok(totals.identity > 0 && totals.addresses > 0 && totals.descriptions > 0 && totals.contacts > 0
    && totals.spaces > 0 && totals.facilities > 0 && totals.images > 0);
  assert.equal(totals.exactVenueImages, 1);
  assert.equal(totals.reusableImages, 0);
});

test("UK-20 Marine Hall retained source preserves full description, both named rooms, seated+standing capacities, clean facilities and BOX_OFFICE hold", retained, async () => {
  const row = receipt("18");
  const extracted = extractFromFetchedDocuments(
    row.source.documents,
    ["IDENTITY", "PUBLIC_CONTACT", "VENUE_FACTS", "IMAGE_CANDIDATES"],
    row.venueName,
  );
  assert.ok(extracted.identityFacts.some((fact) => fact.fieldName === "siteDescription"
    && fact.value === "Marine Hall is available to hire for any type of occasion. The beachfront setting is perfect for larger celebrations with its art deco ballroom and two on-site bars."
    && fact.sourceUrl === "https://www.marinehall.co.uk/wyre-theatres/private-hire-1"));
  assert.ok(extracted.venueFacts.some((fact) => fact.fieldName === "spaces" && fact.value === "Main Theatre"));
  assert.ok(extracted.venueFacts.some((fact) => fact.fieldName === "spaces" && fact.value === "Waterfront Café Bar"));
  assert.ok(!extracted.venueFacts.some((fact) => fact.fieldName === "spaces" && fact.value === "Menu"));
  assert.ok(extracted.venueFacts.some((fact) => fact.fieldName === "capacity"
    && (fact.value as { space: string | null; layout: string; count: number }).space === "Main Theatre"
    && (fact.value as { layout: string }).layout === "seated"
    && (fact.value as { count: number }).count === 650));
  assert.ok(extracted.venueFacts.some((fact) => fact.fieldName === "capacity"
    && (fact.value as { space: string | null; layout: string; count: number }).space === "Main Theatre"
    && (fact.value as { layout: string }).layout === "standing"
    && (fact.value as { count: number }).count === 950));
  assert.ok(extracted.venueFacts.some((fact) => fact.fieldName === "capacity"
    && (fact.value as { space: string | null; layout: string; count: number }).space === "Waterfront Café Bar"
    && (fact.value as { count: number }).count === 80));
  assert.ok(extracted.venueFacts.some((fact) => fact.fieldName === "bar" && fact.value === "Licensed bar"));
  assert.ok(extracted.venueFacts.some((fact) => fact.fieldName === "avProduction"
    && /technical officer - to operate sound\/lights/i.test(String(fact.value))));
  assert.ok(extracted.venueFacts.some((fact) => fact.fieldName === "catering"
    && /choice of caterers, menus and drinks/i.test(String(fact.value))));
  const boxOfficeEmail = extracted.publicContacts.find((c) => c.type === "EMAIL" && c.value === "marinehall@wyre.gov.uk");
  assert.equal(boxOfficeEmail?.purpose, "BOX_OFFICE");
});

test("Marine Hall synthetic fixture holds BOX_OFFICE email from venue-hire routing and preserves per-page observedAt timestamps", async () => {
  const homeUrl = "https://www.marinehall.co.uk/";
  const hireUrl = "https://www.marinehall.co.uk/wyre-theatres/private-hire-1";
  const contactUrl = "https://www.marinehall.co.uk/wyre-theatres/contact-us/1";
  const roomsUrl = "https://www.marinehall.co.uk/wyre-theatres/private-hire-1/2";
  const docs = new Map<string, { body: string; observedAt: string }>([
    [homeUrl, {
      observedAt: "2026-11-20T13:27:26.347Z",
      body: `<html><head><title>Marine Hall</title></head><body><h2>Menu</h2><h1>Marine Hall</h1><a href="/wyre-theatres/private-hire-1">Private hire</a><a href="/wyre-theatres/contact-us/1">Contact us</a></body></html>`,
    }],
    [hireUrl, {
      observedAt: "2026-11-20T13:27:29.329Z",
      body: `<html><head><title>Private hire - Marine Hall</title></head><body><h1>Private hire</h1><p>Marine Hall is available to hire for any type of occasion. The beachfront setting is perfect for larger celebrations with its art deco ballroom and two on-site bars.</p><p>We offer bespoke packages to suit your budget and have a choice of caterers, menus and drinks for you to choose from.</p><a href="/wyre-theatres/private-hire-1/2">Spaces and charges</a></body></html>`,
    }],
    [contactUrl, {
      observedAt: "2026-11-20T13:27:30.857Z",
      body: `<html><head><title>Contact us - Marine Hall</title></head><body><h1>Contact us</h1><p>For enquiries or to buy tickets for all our venues call our centralised box office on 01253 887693. E-mail: marinehall@wyre.gov.uk</p></body></html>`,
    }],
    [roomsUrl, {
      observedAt: "2026-11-20T13:27:32.367Z",
      body: `<html><head><title>Hire spaces - Marine Hall</title></head><body><h3>Main Theatre</h3><p>The Main Theatre's maximum seating capacity is 650 and 950 standing</p><ul><li>The hire Includes a technical officer - to operate sound/lights</li><li>Licensed bar</li><li>Full Box Office facilities (commission charged)</li></ul><h3>Waterfront Caf&eacute; Bar</h3><p>Suitable for meetings of up to 80 people.</p></body></html>`,
    }],
  ]);
  const documentCache = {
    async get(url: string) {
      const hit = docs.get(url);
      if (!hit) return null;
      return {
        url,
        finalUrl: url,
        status: 200,
        contentType: "text/html",
        body: hit.body,
        bytes: Buffer.byteLength(hit.body),
        sourceHash: createHash("sha256").update(hit.body).digest("hex"),
        observedAt: hit.observedAt,
        kind: "HTML" as const,
        etag: null,
        lastModified: null,
      };
    },
    async set() { /* read-only test fixture */ },
  };
  const result = validateSourceDiscoveryResult(await executeSourceDiscoveryRequest({
    contractVersion: CONTRACTS.SOURCE_DISCOVERY_REQUEST,
    discoveryRequestId: "11111111-1111-4111-8111-111111111118",
    idempotencyKey: "22222222-2222-4222-8222-222222222218",
    correlationId: "33333333-3333-4333-8333-333333333318",
    originatingProduct: "event_suite_resources",
    acquisitionGoal: "VENUE_FACTS",
    subjectReference: { entityType: "VENUE", canonicalEntityId: "d0e8474d-3cb1-5d6d-ae2b-7f76fda61792", candidateReference: null },
    verifiedSourceUrl: homeUrl,
    venueName: "Marine Hall",
    requestedExtractors: ["IDENTITY", "PUBLIC_CONTACT", "VENUE_FACTS"],
    crawlBudget: { maxRequests: 8, maxPages: 4, maxDepth: 2, maxBytesPerResponse: 500_000, maxRedirects: 0, maxRetries: 0, maxSitemapFetches: 0, minRequestDelayMs: 0, timeoutMs: 1000 },
    freshnessRequirements: { maxAgeHours: 8760, forceRefresh: false },
    existingEvidenceRefs: ["test:marine-hall:official"],
    requestedBy: { system: "prestige_nexus", actorType: "SYSTEM", actorId: "uk20-marine-hall-test" },
    createdAt: "2026-11-25T21:30:00.000Z",
  }, {
    now: () => "2026-11-25T21:30:00.000Z",
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    documentCache,
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /");
      const hit = docs.get(url);
      return new Response(hit?.body ?? "Not found", { status: hit ? 200 : 404, headers: { "content-type": "text/html" } });
    },
  }));
  const email = result.publicContacts.find((c) => c.type === "EMAIL" && c.value === "marinehall@wyre.gov.uk");
  assert.equal(email?.purpose, "BOX_OFFICE");
  assert.equal(email?.reviewRequired, true);
  assert.equal(email?.reviewReason, "BOX_OFFICE_PURPOSE_NOT_VENUE_ENQUIRY");
  assert.equal(email?.observedAt, "2026-11-20T13:27:30.857Z");
  assert.equal(result.guideEmailReady, false);

  const desc = result.identityFacts.find((f) => f.fieldName === "siteDescription"
    && f.value === "Marine Hall is available to hire for any type of occasion. The beachfront setting is perfect for larger celebrations with its art deco ballroom and two on-site bars.");
  assert.equal(desc?.observedAt, "2026-11-20T13:27:29.329Z");

  const seated = result.venueFacts.find((f) => f.fieldName === "capacity" && (f.value as { layout?: string }).layout === "seated");
  assert.equal(seated?.observedAt, "2026-11-20T13:27:32.367Z");
  assert.deepEqual(seated?.value, { space: "Main Theatre", layout: "seated", count: 650, statement: "seating capacity is 650" });

  const standing = result.venueFacts.find((f) => f.fieldName === "capacity" && (f.value as { layout?: string }).layout === "standing");
  assert.deepEqual(standing?.value, { space: "Main Theatre", layout: "standing", count: 950, statement: "950 standing" });

  const bar = result.venueFacts.find((f) => f.fieldName === "bar");
  assert.equal(bar?.value, "Licensed bar");
  assert.equal(bar?.observedAt, "2026-11-20T13:27:32.367Z");

  assert.ok(result.venueFacts.some((f) => f.fieldName === "spaces" && f.value === "Waterfront Café Bar"));
  assert.ok(!result.venueFacts.some((f) => f.fieldName === "spaces" && f.value === "Menu"));
});
