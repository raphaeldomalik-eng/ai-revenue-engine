import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync, gzipSync } from "node:zlib";
import { crawlVerifiedSource, extractFromFetchedDocuments } from "../src/nexus/source-discovery/crawler.ts";
import { classifyContent, inflateBoundedDocument } from "../src/nexus/source-discovery/content.ts";

const url = "https://venue.org/";
const html = Buffer.from("<!doctype html><html><body><h2>Grand Hall</h2><p>Grand Hall — theatre capacity 250</p></body></html>");
const budget = { maxPages: 1, maxRequests: 4, maxBytesPerResponse: 100_000, maxRedirects: 1, maxRetries: 0, timeoutMs: 1000, minRequestDelayMs: 0 };
const publicHost = async () => [{ address: "93.184.216.34", family: 4 as const }];

test("a stale gzip header on already decoded HTML is classified as HTML", () => {
  const decoded = inflateBoundedDocument(html, "gzip", "text/html; charset=UTF-8", url, 1_000_000);
  assert.equal(Buffer.from(decoded).toString("utf8"), html.toString("utf8"));
  assert.notEqual(decoded, html);
  assert.equal(classifyContent("text/html; charset=UTF-8", decoded, url, "PAGE").kind, "HTML");
});

test("venue facts read theatre capacity from a page whose gzip header is stale", async () => {
  const result = await crawlVerifiedSource({
    verifiedUrl: url,
    requestedExtractors: ["IDENTITY", "VENUE_FACTS"],
    budget,
    resolveHost: publicHost,
    fetchImpl: async (input) => String(input).endsWith("/robots.txt")
      ? new Response("User-agent: *\nAllow: /")
      : new Response(html, { headers: { "content-type": "text/html; charset=UTF-8", "content-encoding": "gzip" } }),
  });
  const extraction = extractFromFetchedDocuments(result.documents, ["VENUE_FACTS"]);
  const capacity = extraction.venueFacts.find((item) => item.fieldName === "capacity" && JSON.stringify(item.value).includes('"count":250'));
  assert.equal(JSON.stringify(capacity?.value).includes('"layout":"theatre"'), true);
  assert.equal(JSON.stringify(capacity?.value).includes('"count":250'), true);
});

test("a gzip body that expands past the discovery ceiling is refused", () => {
  const packed = gzipSync(Buffer.from("Grand Hall theatre capacity 250 ".repeat(400)));
  assert.ok(packed.length < 500);
  let retained: Uint8Array | null = null;
  assert.throws(() => {
    retained = inflateBoundedDocument(packed, "gzip", "text/html", url, 500);
  }, /Response exceeded the discovery size limit/);
  assert.equal(retained, null);
});

test("a corrupt gzip body fails closed", () => {
  const corrupt = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0x01, 0x02]);
  assert.throws(() => inflateBoundedDocument(corrupt, "gzip", "text/html", url, 1_000_000), /Compressed document could not be decoded within bounds/);
  assert.throws(() => inflateBoundedDocument(new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe]), "gzip", "text/html", url, 1_000_000), /Compressed document could not be decoded within bounds/);
});

test("gzip archive resources stay outside document parsing", () => {
  const packed = gzipSync(Buffer.from("not a page"));
  const archiveUrl = "https://venue.org/pack.gz";
  const kept = inflateBoundedDocument(packed, "gzip", "application/gzip", archiveUrl, 1_000_000);
  assert.deepEqual(Buffer.from(kept), packed);
  assert.equal(classifyContent("application/gzip", kept, archiveUrl, "PAGE").kind, null);
  const pathKept = inflateBoundedDocument(packed, null, "application/octet-stream", "https://venue.org/files/venue.tgz", 1_000_000);
  assert.equal(classifyContent("application/octet-stream", pathKept, "https://venue.org/files/venue.tgz", "PAGE").kind, null);
});

test("uncompressed HTML is left unchanged", () => {
  const decoded = inflateBoundedDocument(html, null, "text/html", url, 1_000_000);
  assert.equal(decoded, html);
  assert.equal(classifyContent("text/html", decoded, url, "PAGE").kind, "HTML");
});

test("a real gzip document still decodes", () => {
  const decoded = inflateBoundedDocument(gzipSync(html), "gzip", "text/html", url, 1_000_000);
  assert.equal(Buffer.from(decoded).toString("utf8"), html.toString("utf8"));
});

test("a real deflate document still decodes", () => {
  const decoded = inflateBoundedDocument(deflateSync(html), "deflate", "text/html", url, 1_000_000);
  assert.equal(Buffer.from(decoded).toString("utf8"), html.toString("utf8"));
});

test("a stale gzip header does not bypass robots", async () => {
  const requested: string[] = [];
  const result = await crawlVerifiedSource({
    verifiedUrl: url,
    requestedExtractors: ["VENUE_FACTS"],
    budget,
    resolveHost: publicHost,
    fetchImpl: async (input) => {
      requested.push(String(input));
      if (String(input).endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /");
      return new Response(html, { headers: { "content-type": "text/html", "content-encoding": "gzip" } });
    },
  });
  assert.equal(result.stats.status, "BLOCKED");
  assert.equal(result.documents.length, 0);
  assert.deepEqual(requested, ["https://venue.org/robots.txt"]);
});

test("compressed-document handling does not fetch a private redirect target", async () => {
  const requested: string[] = [];
  const result = await crawlVerifiedSource({
    verifiedUrl: url,
    requestedExtractors: ["VENUE_FACTS"],
    budget,
    resolveHost: async (hostname) => hostname === "private.org"
      ? [{ address: "10.0.0.4", family: 4 }]
      : [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (input) => {
      requested.push(String(input));
      if (String(input).endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /");
      return new Response(null, { status: 302, headers: { location: "https://private.org/events" } });
    },
  });
  assert.equal(result.stats.blockedCount, 1);
  assert.equal(requested.includes("https://private.org/events"), false);
});
