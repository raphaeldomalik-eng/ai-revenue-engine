import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { extractFromFetchedDocuments } from "../src/nexus/source-discovery/crawler.ts";
import type { FetchedDocument } from "../src/nexus/source-discovery/types.ts";
import { crawlVenueOfficialSite, VENUE_CRAWL_BUDGET } from "../src/nexus/source-discovery/venue/crawl.ts";

const evidenceDirectory = process.env.UK20_RETAINED_RECEIPTS;
const hashes: Record<string, string> = {
  "04": "0c2388f6c7aaeffbfb5bb385089d20568ac565db898cb4871917ec5034da6096",
  "06": "da19d4a1dee2fa6d320df67b5d135222eaa26e45604660157eb4692b5bf35b1d",
  "07": "e29a32f24a15f1bcedbfc8a60f556164d01a2491bb5ca6d055b78e4478d0bd78",
  "13": "abfb349541ad101c177caafbacea5d2bce0919b74b64eedeaede9b9a84b544c2",
  "14": "f7cde303c8ea7e92998a93c7bdbd8a64d53624e73b1e9aad2cfbcb58a2aea753",
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
