import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync, gzipSync } from "node:zlib";
import { crawlVerifiedSource, extractFromFetchedDocuments, type CrawlBudget, type CrawlInput } from "../src/nexus/source-discovery/crawler.ts";
import { parseHtml, textContent } from "../src/nexus/source-discovery/dom.ts";
import type { ExtractorProfile } from "../src/nexus/source-discovery/planner.ts";
import { extractPdfText } from "../src/nexus/source-discovery/pdf.ts";
import { OriginPoliteness } from "../src/nexus/source-discovery/politeness.ts";
import { guardedRender, type RenderAdapter } from "../src/nexus/source-discovery/render.ts";
import type { CachedDocument, DocumentCache } from "../src/nexus/source-discovery/types.ts";

const origin = "https://venue.org";
const RESOURCES = ["IDENTITY", "PUBLIC_CONTACT", "VENUE_FACTS", "IMAGE_CANDIDATES", "EVENTS"] as const;
const budget: CrawlBudget = { maxPages: 20, maxRequests: 40, maxBytesPerResponse: 2_000_000, maxRedirects: 5, maxRetries: 2, timeoutMs: 2_000, minRequestDelayMs: 0 };
const resolveHost = async () => [{ address: "93.184.216.34", family: 4 }];

type Reply = { status?: number; body?: string | Uint8Array; headers?: Record<string, string> };
type Route = Reply | ((init: RequestInit | undefined) => Reply | Promise<Reply>);

function fixture(routes: Record<string, Route>) {
  const log: string[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    log.push(url);
    const route = routes[url];
    const reply = typeof route === "function" ? await route(init) : route;
    if (!reply) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
    const status = reply.status ?? 200;
    const nullBody = status === 204 || status === 304 || (status >= 300 && status < 400);
    return new Response(nullBody ? null : (reply.body ?? "") as BodyInit, { status, headers: { "content-type": "text/html; charset=utf-8", ...reply.headers } });
  };
  return { fetchImpl, log };
}

function crawl(routes: Record<string, Route>, overrides: Partial<CrawlInput> = {}) {
  const site = fixture(routes);
  const input: CrawlInput = {
    verifiedUrl: `${origin}/`, requestedExtractors: [...RESOURCES], budget, subjectType: "VENUE", fetchImpl: site.fetchImpl, resolveHost,
    politeness: new OriginPoliteness({ sleep: async () => undefined }), sleep: async () => undefined, now: () => new Date("2026-09-30T12:00:00Z"),
    ...overrides,
  };
  return crawlVerifiedSource(input).then((result) => ({ result, log: site.log, extracted: extractFromFetchedDocuments(result.documents, input.requestedExtractors) }));
}

const paths = (urls: string[]) => urls.map((url) => new URL(url).host === "venue.org" ? new URL(url).pathname + new URL(url).search : url);
const ALLOW = { body: "User-agent: *\nAllow: /", headers: { "content-type": "text/plain" } };
const capacities = (facts: Array<{ fieldName: string; value: unknown }>) => facts.filter((fact) => fact.fieldName === "capacity").map((fact) => fact.value as { space: string | null; layout: string; count: number });

function pdfFixture(pages: string[][]): Uint8Array {
  const objects: string[] = [];
  const kids = pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ");
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  const streams: Array<{ id: number; data: Buffer }> = [];
  pages.forEach((lines, index) => {
    const pageId = 4 + index * 2;
    const contentId = pageId + 1;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    const ops = ["BT", "/F1 12 Tf", "72 780 Td", ...lines.flatMap((line, lineIndex) => [lineIndex ? "0 -16 Td" : "", `(${line.replace(/[()\\]/g, "\\$&")}) Tj`]).filter(Boolean), "ET"].join("\n");
    streams.push({ id: contentId, data: deflateSync(Buffer.from(ops, "latin1")) });
  });
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const offsets: number[] = [];
  let length = chunks[0]!.length;
  const push = (chunk: Buffer) => { chunks.push(chunk); length += chunk.length; };
  const total = 3 + pages.length * 2;
  for (let id = 1; id <= total; id += 1) {
    offsets[id] = length;
    const stream = streams.find((item) => item.id === id);
    if (stream) {
      push(Buffer.from(`${id} 0 obj\n<< /Length ${stream.data.length} /Filter /FlateDecode >>\nstream\n`, "latin1"));
      push(stream.data);
      push(Buffer.from("\nendstream\nendobj\n", "latin1"));
    } else push(Buffer.from(`${id} 0 obj\n${objects[id]}\nendobj\n`, "latin1"));
  }
  const xref = length;
  push(Buffer.from(`xref\n0 ${total + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`, "latin1"));
  return new Uint8Array(Buffer.concat(chunks));
}

// ─── Generic core: identity, redirects, subdomains ─────────────────────────────────────────────

test("apex entry settles on www, links are canonicalised, and the apex host is never crawled twice", async () => {
  const www = "https://www.venue.org";
  const { result, log } = await crawl({
    [`${origin}/robots.txt`]: ALLOW,
    [`${origin}/`]: { status: 301, headers: { location: `${www}/` } },
    [`${www}/robots.txt`]: ALLOW,
    [`${www}/`]: { body: `<title>The Lantern</title><a href="https://venue.org/contact">Contact</a><a href="/spaces">Spaces</a>` },
    [`${www}/contact`]: { body: "<h1>Contact</h1><p>Venue hire enquiries: hire@venue.org</p>" },
    [`${www}/spaces`]: { body: "<h2>Grand Hall</h2><p>Theatre capacity 250</p>" },
  });
  assert.equal(result.canonicalOrigin, www);
  assert.equal(result.finalUrl, `${www}/`);
  assert.ok(result.documents.some((doc) => doc.url === `${www}/contact`));
  assert.equal(log.filter((url) => url === `${origin}/contact`).length, 0);
  assert.deepEqual(result.observability?.grantedOrigins.map((item) => item.grant).sort(), ["CANONICAL_REDIRECT", "VERIFIED"]);
  assert.equal(result.observability?.redirectChain[0]?.reason, "WWW_APEX_CANONICAL");
});

test("a linked first-party subdomain is admitted with its own robots check; cross-site and unevidenced redirects are refused", async () => {
  const hire = "https://hire.venue.org";
  const { result, log } = await crawl({
    [`${origin}/robots.txt`]: ALLOW,
    [`${origin}/`]: { body: `<a href="${hire}/spaces">Venue hire spaces</a><a href="/access">Accessibility</a><a href="/facilities">Facilities</a>` },
    [`${hire}/robots.txt`]: ALLOW,
    [`${hire}/spaces`]: { body: "<h2>Riverside Room</h2><p>Banquet capacity 120</p>" },
    [`${origin}/access`]: { status: 302, headers: { location: "https://evil.org/access" } },
    [`${origin}/facilities`]: { status: 302, headers: { location: "https://tickets.venue.org/facilities" } },
  });
  assert.ok(result.documents.some((doc) => doc.url === `${hire}/spaces`));
  assert.ok(log.includes(`${hire}/robots.txt`));
  assert.ok(!log.some((url) => url.startsWith("https://evil.org") || url.startsWith("https://tickets.venue.org")));
  const reasons = result.observability!.blockedPages.map((item) => item.reason);
  assert.ok(reasons.includes("REDIRECT_CROSS_SITE"));
  assert.ok(reasons.includes("REDIRECT_UNEVIDENCED_SUBDOMAIN"));
  assert.ok(result.observability!.grantedOrigins.some((item) => item.origin === hire && item.grant === "LINKED_FIRST_PARTY_SUBDOMAIN"));
});

test("robots disallow of a planned page is honoured and recorded without a request", async () => {
  const { result, log } = await crawl({
    [`${origin}/robots.txt`]: { body: "User-agent: *\nDisallow: /spaces", headers: { "content-type": "text/plain" } },
    [`${origin}/`]: { body: `<a href="/spaces">Spaces</a><a href="/contact">Contact</a>` },
    [`${origin}/contact`]: { body: "<p>Email: info@venue.org</p>" },
  });
  assert.ok(!log.includes(`${origin}/spaces`));
  assert.ok(result.observability!.blockedPages.some((item) => item.url === `${origin}/spaces` && item.reason === "ROBOTS_DISALLOW"));
});

// ─── Sitemaps ─────────────────────────────────────────────────────────────────────────────────

test("robots Sitemap directives lead through a sitemap index to a gzipped child sitemap, bounded and gap-driven", async () => {
  const child = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/venue-hire/capacity</loc></url><url><loc>${origin}/blog/2024/01/news</loc></url><url><loc>https://other.org/capacity</loc></url></urlset>`;
  const { result, log } = await crawl({
    [`${origin}/robots.txt`]: { body: `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap_index.xml`, headers: { "content-type": "text/plain" } },
    [`${origin}/`]: { body: "<title>The Lantern</title><p>Welcome.</p><a href='/contact'>Contact</a>" },
    [`${origin}/contact`]: { body: "<p>Bookings: bookings@venue.org</p>" },
    [`${origin}/sitemap_index.xml`]: { body: `<?xml version="1.0"?><sitemapindex><sitemap><loc>${origin}/post-sitemap.xml</loc></sitemap><sitemap><loc>${origin}/page-sitemap.xml.gz</loc></sitemap></sitemapindex>`, headers: { "content-type": "application/xml" } },
    [`${origin}/page-sitemap.xml.gz`]: { body: new Uint8Array(gzipSync(child)), headers: { "content-type": "application/x-gzip" } },
    [`${origin}/venue-hire/capacity`]: { body: "<h2>Main Hall</h2><p>Standing capacity 400</p>" },
  });
  assert.equal(result.observability!.sitemap.consulted, true);
  assert.ok(result.observability!.sitemap.fetched.includes(`${origin}/page-sitemap.xml.gz`));
  assert.ok(log.indexOf(`${origin}/page-sitemap.xml.gz`) < log.indexOf(`${origin}/post-sitemap.xml`) || !log.includes(`${origin}/post-sitemap.xml`));
  assert.ok(result.documents.some((doc) => doc.url === `${origin}/venue-hire/capacity`));
  assert.ok(!log.includes("https://other.org/capacity") && !log.includes(`${origin}/blog/2024/01/news`));
  assert.ok(result.observability!.selections.some((item) => item.reason.startsWith("SITEMAP:")));
});

test("without directives the conventional sitemap.xml is used, and an EVENTS-only crawl never consults sitemaps", async () => {
  const routes: Record<string, Route> = {
    [`${origin}/robots.txt`]: ALLOW,
    [`${origin}/`]: { body: "<title>The Lantern</title>" },
    [`${origin}/sitemap.xml`]: { body: `<urlset><url><loc>${origin}/spaces</loc></url></urlset>`, headers: { "content-type": "text/xml" } },
    [`${origin}/spaces`]: { body: "<h2>Studio</h2><p>Seated capacity 60</p>" },
  };
  const venue = await crawl(routes);
  assert.ok(venue.log.includes(`${origin}/sitemap.xml`));
  assert.ok(venue.result.documents.some((doc) => doc.url === `${origin}/spaces`));
  const events = await crawl(routes, { requestedExtractors: ["EVENTS"], subjectType: "EVENT" });
  assert.ok(!events.log.some((url) => url.includes("sitemap")));
  assert.equal(events.result.observability!.mode, "LINK_FOLLOWING");
});

// ─── Planner and extractor profiles ───────────────────────────────────────────────────────────

test("the gap planner stops early once every requested dimension has evidence", async () => {
  const { result, log } = await crawl({
    [`${origin}/robots.txt`]: ALLOW,
    [`${origin}/`]: { body: `<title>The Lantern</title><address>4 River Road, Bristol BS1 2AB</address>
      <a href="/contact">Contact</a><a href="/spaces">Spaces</a><a href="/facilities">Facilities</a><a href="/access">Accessibility</a><a href="/gallery">Gallery</a><a href="/events">Events</a>
      <a href="/weddings">Weddings</a><a href="/conferences">Conferences</a><a href="/meetings">Meetings</a>` },
    [`${origin}/contact`]: { body: "<h1>Contact</h1><p>Venue hire: hire@venue.org</p>" },
    [`${origin}/spaces`]: { body: "<h2>Grand Hall</h2><p>Theatre capacity 250</p><p>Catering by our in-house team. Full PA and lighting rig.</p>" },
    [`${origin}/facilities`]: { body: "<p>Wi-Fi throughout. Cloakroom. Bar.</p>" },
    [`${origin}/access`]: { body: "<h1>Accessibility</h1><p>Step-free access to all floors and an accessible toilet.</p>" },
    [`${origin}/gallery`]: { body: ["hall", "bar", "stage", "foyer"].map((name) => `<img src="/img/${name}.jpg" width="800" height="600" alt="${name}">`).join("") },
    [`${origin}/events`]: { body: '<script type="application/ld+json">{"@type":"Event","name":"Jazz Night","startDate":"2026-10-22T19:30:00Z"}</script>' },
  });
  assert.equal(result.observability!.stopReason, "DIMENSIONS_SATISFIED");
  for (const skipped of ["/weddings", "/conferences", "/meetings"]) assert.ok(!log.includes(`${origin}${skipped}`), skipped);
  assert.deepEqual(result.observability!.dimensionsMissing, []);
  assert.equal(result.observability!.subjectType, "VENUE");
});

test("non-venue subjects use only their own profiles: an organisation identity/contact crawl never plans venue dimensions", async () => {
  const { result, log } = await crawl({
    [`${origin}/robots.txt`]: ALLOW,
    [`${origin}/`]: { body: `<title>Acme Promotions</title><a href="/about">About</a><a href="/contact">Contact</a><a href="/spaces">Spaces</a><a href="/gallery">Gallery</a>` },
    [`${origin}/about`]: { body: "<h1>About Acme</h1>" },
    [`${origin}/contact`]: { body: "<p>Email: hello@venue.org</p>" },
  }, { requestedExtractors: ["IDENTITY", "PUBLIC_CONTACT"], subjectType: "ORGANISATION" });
  assert.equal(result.observability!.mode, "LINK_FOLLOWING");
  assert.equal(result.observability!.subjectType, "ORGANISATION");
  assert.ok(result.observability!.dimensionsRequested.every((dim) => dim.startsWith("IDENTITY:") || dim.startsWith("PUBLIC_CONTACT:")));
  assert.ok(!log.includes(`${origin}/gallery`));
});

test("the core is profile-driven: an injected profile decides which pages are worth fetching", async () => {
  const pressProfile: ExtractorProfile = {
    extractor: "IMAGE_CANDIDATES", dimensions: ["TEST:PRESS"], priorityDimensions: [], strategy: "GAP_PLANNED",
    linkDimensions: (url) => (/\/press\b/.test(url) ? ["TEST:PRESS"] : []), pdfDimensions: () => null,
    observe: (document, _observation, state) => { if (document.url.endsWith("/press")) state.done = true; },
    satisfied: (state) => (state.done ? ["TEST:PRESS"] : []),
  };
  const { result, log } = await crawl({
    [`${origin}/robots.txt`]: ALLOW,
    [`${origin}/`]: { body: `<a href="/contact">Contact</a><a href="/press">Press</a><a href="/spaces">Spaces</a>` },
    [`${origin}/press`]: { body: "<p>Press kit</p>" },
  }, { requestedExtractors: ["IMAGE_CANDIDATES"], subjectType: "CREATIVE_ENTITY", profiles: [pressProfile] });
  assert.deepEqual(paths(log), ["/robots.txt", "/", "/press"]);
  assert.equal(result.observability!.stopReason, "DIMENSIONS_SATISFIED");
});

test("events remain first-class inside a Resources crawl: event pages and calendars are still followed", async () => {
  const { extracted, result } = await crawl({
    [`${origin}/robots.txt`]: ALLOW,
    [`${origin}/`]: { body: `<title>The Lantern</title><a href="/whats-on">What's on</a><a href="/contact">Contact</a>` },
    [`${origin}/contact`]: { body: "<p>Venue hire: hire@venue.org</p>" },
    [`${origin}/whats-on`]: { body: '<script type="application/ld+json">{"@type":"MusicEvent","name":"Jazz Night","startDate":"2026-10-22T19:30:00Z","location":{"@type":"Place","name":"The Lantern"}}</script>' },
  });
  assert.equal(extracted.eventCandidates[0]?.title, "Jazz Night");
  assert.ok(result.observability!.dimensionsSatisfied.includes("EVENTS:LISTINGS"));
});

// ─── PDFs ─────────────────────────────────────────────────────────────────────────────────────

test("a first-party specification PDF yields named capacities with per-page provenance", async () => {
  const pdf = pdfFixture([["Venue Specification", "Grand Hall", "Theatre capacity: 250", "Banquet capacity: 180"], ["Riverside Room", "Reception capacity: 90"]]);
  const parsed = extractPdfText(pdf);
  assert.equal(parsed.pageCount, 2);
  assert.ok(parsed.interpretable);
  assert.match(parsed.pages[1]!, /Reception capacity: 90/);
  const { result, extracted } = await crawl({
    [`${origin}/robots.txt`]: ALLOW,
    [`${origin}/`]: { body: `<title>The Lantern</title><a href="/downloads/venue-spec.pdf">Download our venue specification (PDF)</a><a href="/contact">Contact</a>` },
    [`${origin}/contact`]: { body: "<p>Venue hire: hire@venue.org</p>" },
    [`${origin}/downloads/venue-spec.pdf`]: { body: pdf, headers: { "content-type": "application/pdf" } },
  });
  assert.equal(result.observability!.pdfDocuments, 1);
  const refs = extracted.venueFacts.filter((fact) => fact.fieldName === "capacity").map((fact) => [(fact.value as { count: number }).count, fact.evidenceRef, fact.sourceUrl]);
  const hall = refs.find(([count]) => count === 250);
  const riverside = refs.find(([count]) => count === 90);
  assert.ok(hall && String(hall[1]).includes("#page=1:"), JSON.stringify(refs));
  assert.ok(riverside && String(riverside[1]).includes("#page=2:"), JSON.stringify(refs));
  assert.equal(riverside![2], `${origin}/downloads/venue-spec.pdf#page=2`);
});

test("live regression: PDF fragments on one baseline are joined, so a spec-sheet capacity survives", () => {
  const chunks = (ops: string) => {
    const data = deflateSync(Buffer.from(ops, "latin1"));
    const parts = [
      "%PDF-1.4\n", "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n", "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
      "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n",
    ].map((part) => Buffer.from(part, "latin1"));
    return new Uint8Array(Buffer.concat([...parts, Buffer.from(`5 0 obj\n<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`, "latin1"), data, Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1")]));
  };
  const pdf = chunks([
    "BT /F1 10 Tf 1 0 0 1 72 700 Tm (CAPACITY) Tj ET",
    "BT /F1 10 Tf 1 0 0 1 72 686 Tm (Upstairs Venue) Tj ET",
    "BT /F1 10 Tf 1 0 0 1 150 686 Tm (-) Tj ET",
    "BT /F1 10 Tf 1 0 0 1 158 686 Tm (200) Tj ET",
    "BT /F1 10 Tf 1 0 0 1 72 672 Tm (Version 2.9 February 202) Tj ET",
    "BT /F1 10 Tf 1 0 0 1 192 672 Tm (5) Tj ET",
  ].join("\n"));
  const text = extractPdfText(pdf).pages[0]!;
  assert.match(text, /^CAPACITY\nUpstairs Venue - 200\nVersion 2\.9 February 2025$/m);
  const extracted = extractFromFetchedDocuments([{ url: `${origin}/spec.pdf`, body: text, contentType: "application/pdf", bytes: pdf.length, sourceHash: "pdf", observedAt: "2026-09-30T12:00:00Z", kind: "PDF", pdfPages: [text] }], ["VENUE_FACTS"]);
  assert.deepEqual(capacities(extracted.venueFacts).map((item) => `${item.space}:${item.count}`), ["Upstairs Venue:200"]);
});

test("encrypted or uninterpretable PDFs produce a warning and no facts, and menus are never fetched as venue PDFs", async () => {
  const encrypted = new Uint8Array(Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R /Encrypt 5 0 R >>\n%%EOF", "latin1"));
  assert.equal(extractPdfText(encrypted).interpretable, false);
  const { result, log, extracted } = await crawl({
    [`${origin}/robots.txt`]: ALLOW,
    [`${origin}/`]: { body: `<a href="/files/floor-plans.pdf">Floor plans</a><a href="/files/dinner-menu.pdf">Dinner menu</a>` },
    [`${origin}/files/floor-plans.pdf`]: { body: encrypted, headers: { "content-type": "application/pdf" } },
  });
  assert.ok(!log.includes(`${origin}/files/dinner-menu.pdf`));
  assert.ok(result.stats.warnings.some((warning) => /PDF .*floor-plans/.test(warning)));
  assert.equal(extracted.venueFacts.filter((fact) => fact.sourceUrl.includes(".pdf")).length, 0);
});

// ─── SPA / hydration / rendering ──────────────────────────────────────────────────────────────

test("a Next.js shell is read through its hydration payload without executing scripts", async () => {
  const data = { props: { pageProps: { venue: { name: "The Lantern", description: "The Grand Hall hosts up to 300 guests standing. Theatre capacity 220 for conferences and product launches in central Bristol, with step-free access throughout and in-house catering for every event we host." } } } };
  const { result, extracted } = await crawl({
    [`${origin}/robots.txt`]: ALLOW,
    [`${origin}/`]: { body: `<html><head><title>The Lantern</title></head><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>` },
  });
  assert.equal(result.observability!.hydrationPages, 1);
  assert.ok(result.documents[0]!.derivedMarkup?.includes("data-nexus-derived"));
  assert.ok(capacities(extracted.venueFacts).some((item) => item.count === 220), JSON.stringify(extracted.venueFacts));
});

test("a client-rendered shell without hydration reports the runtime rendering blocker instead of pretending", async () => {
  const { result } = await crawl({
    [`${origin}/robots.txt`]: ALLOW,
    [`${origin}/`]: { body: `<html><head><title>Venue</title></head><body><div id="root"></div><noscript>You need to enable JavaScript to run this app.</noscript><script src="/static/js/main.js"></script></body></html>` },
  });
  assert.deepEqual(result.observability!.renderNeededButUnavailable, [`${origin}/`]);
  assert.equal(result.observability!.renderedPages, 0);
  assert.ok(result.stats.warnings.some((warning) => /no rendering adapter is available in this runtime/.test(warning)));
});

test("an injected render adapter is guarded: off-site sub-requests are blocked and off-site navigation is refused", async () => {
  const seen: Array<[string, boolean]> = [];
  const adapter: RenderAdapter = {
    name: "fake",
    render: async ({ url, allowRequest }) => {
      for (const [target, type] of [[`${origin}/app.js`, "script"], ["https://evil.org/x.js", "script"], [`${origin}/font.woff2`, "font"], ["http://venue.org/a.css", "stylesheet"]] as const) seen.push([target, await allowRequest(target, type)]);
      return { finalUrl: url, html: "<main><h2>Main Hall</h2><p>Standing capacity 500</p></main>" };
    },
  };
  const { result, extracted } = await crawl({
    [`${origin}/robots.txt`]: ALLOW,
    [`${origin}/`]: { body: `<html><body><div id="root"></div><noscript>Please enable JavaScript</noscript></body></html>` },
  }, { renderAdapter: adapter });
  assert.deepEqual(seen.map(([, allowed]) => allowed), [true, false, false, false]);
  assert.equal(result.observability!.renderedPages, 1);
  assert.equal(result.documents[0]!.retrieval, "RENDERED");
  assert.ok(capacities(extracted.venueFacts).some((item) => item.count === 500));
  await assert.rejects(guardedRender({
    adapter: { name: "escape", render: async () => ({ finalUrl: "https://evil.org/", html: "<p>x</p>" }) },
    url: `${origin}/`, policy: { maxRenderedPages: 1, timeoutMs: 500 }, maxBytes: 10_000, userAgent: "test", resolveHost,
    isAllowedOrigin: (value) => value === origin, robotsAllows: () => true,
  }), /left the verified site/);
});

// ─── Extraction quality ───────────────────────────────────────────────────────────────────────

test("an HTML capacity matrix retains named rooms and layouts, ignoring size columns", async () => {
  const { extracted } = await crawl({
    [`${origin}/robots.txt`]: ALLOW,
    [`${origin}/`]: { body: `<h1>Our spaces</h1><table><tr><th>Room</th><th>Size (sqm)</th><th>Theatre</th><th>Banquet</th><th>Reception</th></tr>
      <tr><td>Grand Hall</td><td>420</td><td>300</td><td>220</td><td>450</td></tr>
      <tr><td>Library</td><td>80</td><td>60</td><td>40</td><td>–</td></tr></table>` },
  }, { requestedExtractors: ["VENUE_FACTS"] });
  const found = capacities(extracted.venueFacts).map((item) => `${item.space}:${item.layout}:${item.count}`).sort();
  assert.deepEqual(found, ["Grand Hall:banquet:220", "Grand Hall:reception:450", "Grand Hall:theatre:300", "Library:banquet:40", "Library:theatre:60"]);
  assert.ok(!found.some((item) => item.endsWith(":420") || item.endsWith(":80")));
});

test("JSON-LD EventVenue containsPlace capacities belong to named spaces, not the whole venue", async () => {
  const graph = { "@context": "https://schema.org", "@type": "EventVenue", name: "The Lantern", url: `${origin}/`, maximumAttendeeCapacity: 800,
    containsPlace: [{ "@type": "Place", name: "Main Room", maximumAttendeeCapacity: 600 }, { "@type": "Place", name: "Upstairs Bar", maximumAttendeeCapacity: 120 }] };
  const { extracted } = await crawl({
    [`${origin}/robots.txt`]: ALLOW,
    [`${origin}/`]: { body: `<script type="application/ld+json">${JSON.stringify(graph)}</script>` },
  }, { requestedExtractors: ["VENUE_FACTS"] });
  const found = capacities(extracted.venueFacts).map((item) => `${item.space ?? "VENUE"}:${item.count}`).sort();
  assert.deepEqual(found, ["Main Room:600", "Upstairs Bar:120", "VENUE:800"]);
});

test("definition lists and multiple rooms keep separate capacities without false conflicts", async () => {
  const { extracted } = await crawl({
    [`${origin}/robots.txt`]: ALLOW,
    [`${origin}/`]: { body: `<h2>The Studio</h2><dl><dt>Seated</dt><dd>80</dd><dt>Standing</dt><dd>150</dd></dl>
      <h2>The Loft</h2><dl><dt>Seated</dt><dd>40</dd><dt>Standing</dt><dd>70</dd></dl>` },
  }, { requestedExtractors: ["VENUE_FACTS"] });
  const found = capacities(extracted.venueFacts).map((item) => `${item.space}:${item.layout}:${item.count}`).sort();
  assert.deepEqual(found, ["The Loft:seated:40", "The Loft:standing:70", "The Studio:seated:80", "The Studio:standing:150"]);
  assert.ok(!extracted.warnings.some((warning) => /conflict/i.test(warning)));
  assert.ok(extracted.venueFacts.filter((fact) => fact.fieldName === "capacity").every((fact) => !fact.reviewRequired));
});

test("conflicting capacities for the same named room and layout across pages require review", () => {
  const doc = (path: string, body: string) => ({ url: `${origin}${path}`, body, contentType: "text/html", bytes: body.length, sourceHash: `hash-${path}`, observedAt: "2026-09-30T12:00:00Z", kind: "HTML" as const });
  const extracted = extractFromFetchedDocuments([doc("/spaces", "<h2>Grand Hall</h2><p>Banquet capacity 180</p>"), doc("/hire", "<h2>Grand Hall</h2><p>Banquet capacity 200</p>")], ["VENUE_FACTS"]);
  const hall = extracted.venueFacts.filter((fact) => fact.fieldName === "capacity" && (fact.value as { space: string }).space === "Grand Hall");
  assert.deepEqual(hall.map((fact) => [(fact.value as { layout: string }).layout, (fact.value as { count: number }).count, fact.reviewRequired]), [["banquet", 180, true], ["banquet", 200, true]]);
  assert.ok(extracted.warnings.some((warning) => /grand hall:banquet requires review/.test(warning)));
});

test("contact purposes rank sales/hire first, normalise phones, and exclude ticketing, newsletter and no-reply addresses", async () => {
  const { extracted } = await crawl({
    [`${origin}/robots.txt`]: ALLOW,
    [`${origin}/`]: { body: `<a href="/contact">Contact</a>` },
    [`${origin}/contact`]: { body: `<h1>Contact us</h1>
      <p>General enquiries: <a href="mailto:info@venue.org">info@venue.org</a></p>
      <p>Box office: 0117 496 0000</p>
      <p>Venue hire and private events: <a href="mailto:events@venue.org">events@venue.org</a> or call 0117 496 0123</p>
      <p>Tickets support: help@ticketmaster.co.uk</p><p>Newsletter: newsletter@venue.org</p><p>noreply@venue.org</p>` },
  }, { requestedExtractors: ["PUBLIC_CONTACT"] });
  const emailContacts = extracted.publicContacts.filter((item) => item.type === "EMAIL");
  const emails = emailContacts.filter((item) => !item.reviewRequired).map((item) => item.value);
  assert.equal(emails[0], "events@venue.org");
  assert.ok(emails.includes("info@venue.org"));
  assert.ok(!emails.some((value) => /ticketmaster|newsletter|noreply/.test(value)));
  assert.ok(emailContacts.some((item) => item.value === "help@ticketmaster.co.uk" && item.reviewRequired));
  assert.ok(emailContacts.some((item) => item.value === "newsletter@venue.org" && item.reviewRequired));
  assert.ok(emailContacts.some((item) => item.value === "noreply@venue.org" && item.reviewRequired));
  const phones = extracted.publicContacts.filter((item) => item.type === "PHONE");
  assert.ok(phones.some((item) => item.normalized === "01174960123" && item.purpose === "SALES_HIRE"), JSON.stringify(phones));
  assert.ok(phones.some((item) => item.normalized === "01174960000" && item.purpose === "BOX_OFFICE"), JSON.stringify(phones));
  const uk = extractFromFetchedDocuments([{ url: "https://venue.co.uk/contact", body: "<p>Call us: 0117 496 0123</p>", contentType: "text/html", bytes: 30, sourceHash: "uk", observedAt: "2026-09-30T12:00:00Z", kind: "HTML" }], ["PUBLIC_CONTACT"]);
  assert.equal(uk.publicContacts[0]?.normalized, "+441174960123");
});

test("images: srcset, picture and lazy attributes are discovered; rights stay unknown unless a first-party notice restricts them", async () => {
  const { extracted } = await crawl({
    [`${origin}/robots.txt`]: ALLOW,
    [`${origin}/`]: { body: `<a href="/gallery">Gallery</a>` },
    [`${origin}/gallery`]: { body: `<h1>Gallery</h1>
      <img src="/img/placeholder.gif" data-src="/img/hall.jpg" width="1200" height="800" alt="Grand Hall set for dinner">
      <picture><source srcset="/img/bar-800.webp 800w, /img/bar-1600.webp 1600w" type="image/webp"><img src="/img/bar.jpg" alt="Bar"></picture>
      <img srcset="/img/stage-400.jpg 400w, /img/stage-1200.jpg 1200w" alt="Stage">
      <img src="/img/pixel.gif" width="1" height="1">` },
  }, { requestedExtractors: ["IMAGE_CANDIDATES"] });
  const urls = extracted.imageCandidates.map((item) => new URL(item.sourceImageUrl).pathname);
  assert.ok(urls.includes("/img/hall.jpg"), urls.join());
  assert.ok(urls.some((url) => url.startsWith("/img/bar")), urls.join());
  assert.ok(urls.some((url) => url.startsWith("/img/stage")), urls.join());
  assert.ok(!urls.includes("/img/pixel.gif") && !urls.includes("/img/placeholder.gif"));
  assert.ok(extracted.imageCandidates.every((item) => item.rightsState === "UNKNOWN_RIGHTS" && item.operatorConfirmed === false));
  const restricted = await crawl({
    [`${origin}/robots.txt`]: ALLOW,
    [`${origin}/`]: { body: `<img src="/img/hall.jpg" width="1200" height="800" alt="Hall"><p>© The Lantern. All rights reserved. Images may not be reproduced without permission.</p>` },
  }, { requestedExtractors: ["IMAGE_CANDIDATES"] });
  assert.ok(restricted.extracted.imageCandidates.every((item) => item.rightsState !== "VERIFIED_REUSABLE"));
  assert.ok(restricted.extracted.imageCandidates.some((item) => item.rightsState === "RIGHTS_RESERVED" || item.rightsState === "PERMISSION_REQUIRED"));
});

// ─── Politeness, retries, safety ──────────────────────────────────────────────────────────────

test("Retry-After within the bound cools the whole origin down; beyond the bound it defers as retryable", async () => {
  const waits: number[] = [];
  let clock = 0;
  const politeness = new OriginPoliteness({ clock: () => clock, sleep: async (ms) => { waits.push(ms); clock += ms; } });
  let attempts = 0;
  const { result } = await crawl({
    [`${origin}/robots.txt`]: ALLOW,
    [`${origin}/`]: { body: `<a href="/contact">Contact</a>` },
    [`${origin}/contact`]: () => (++attempts === 1 ? { status: 429, headers: { "retry-after": "2" } } : { body: "<p>Venue hire: hire@venue.org</p>" }),
  }, { politeness });
  assert.equal(attempts, 2);
  assert.ok(waits.includes(2000), JSON.stringify(waits));
  assert.equal(result.observability!.retryAfterWaits, 1);
  const deferred = await crawl({
    [`${origin}/robots.txt`]: ALLOW,
    [`${origin}/`]: { body: `<a href="/contact">Contact</a>` },
    [`${origin}/contact`]: { status: 503, headers: { "retry-after": "3600" } },
  });
  assert.equal(deferred.result.stats.status, "PARTIAL");
  assert.ok(deferred.result.stats.warnings.some((warning) => /Retry-After beyond the crawl bound; deferred/.test(warning)));
  assert.equal(deferred.log.filter((url) => url.endsWith("/contact")).length, 1);
});

test("a hanging page times out safely and the crawl continues", async () => {
  const { result } = await crawl({
    [`${origin}/robots.txt`]: ALLOW,
    [`${origin}/`]: { body: `<a href="/spaces">Spaces</a><a href="/contact">Contact</a>` },
    [`${origin}/spaces`]: () => new Promise<Reply>(() => undefined),
    [`${origin}/contact`]: { body: "<p>Email: hire@venue.org</p>" },
  }, { budget: { ...budget, timeoutMs: 30, maxRetries: 0 } });
  assert.ok(result.documents.some((doc) => doc.url === `${origin}/contact`));
  assert.ok(result.stats.warnings.some((warning) => /spaces.*timed out/.test(warning)));
});

test("duplicate URL spellings are fetched once and identical concurrent GETs share one response", async () => {
  const { log } = await crawl({
    [`${origin}/robots.txt`]: ALLOW,
    [`${origin}/`]: { body: `<a href="/contact">Contact</a><a href="/contact?utm_source=nav">Contact us</a><a href="https://venue.org/contact#form">Enquire</a><a href="/contact?fbclid=1">Get in touch</a>` },
    [`${origin}/contact`]: { body: "<p>Venue hire: hire@venue.org</p>" },
  });
  assert.equal(log.filter((url) => url.includes("/contact")).length, 1);
  const politeness = new OriginPoliteness({ maxConcurrentPerOrigin: 2, sleep: async () => undefined });
  let calls = 0;
  const task = async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return { status: 200, headers: new Headers(), bytes: new Uint8Array() }; };
  await Promise.all([politeness.singleFlight("k", task), politeness.singleFlight("k", task), politeness.singleFlight("k", task)]);
  assert.equal(calls, 1);
  assert.equal(politeness.singleFlightHits, 2);
});

test("per-origin concurrency is capped at one and minimum spacing is applied between requests", async () => {
  let clock = 0;
  const waits: number[] = [];
  const politeness = new OriginPoliteness({ clock: () => clock, sleep: async (ms) => { waits.push(ms); clock += ms; } });
  let active = 0;
  let peak = 0;
  const job = () => politeness.run(origin, 250, async () => { active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 2)); active -= 1; });
  await Promise.all([job(), job(), job()]);
  assert.equal(peak, 1);
  assert.deepEqual(waits, [250, 250]);
});

test("revalidation: fresh cache entries cost no request, stale ones are revalidated with ETag and reused on 304", async () => {
  const store = new Map<string, CachedDocument>();
  const cache: DocumentCache = { get: async (url) => store.get(url) ?? null, set: async (doc) => { store.set(doc.url, doc); } };
  const routes: Record<string, Route> = {
    [`${origin}/robots.txt`]: ALLOW,
    [`${origin}/`]: (init) => (new Headers(init?.headers).get("if-none-match") === '"v1"' ? { status: 304 } : { body: "<title>The Lantern</title><p>Theatre capacity 250</p>", headers: { etag: '"v1"' } }),
  };
  const first = await crawl(routes, { requestedExtractors: ["VENUE_FACTS"], documentCache: cache, freshnessMaxAgeHours: 24 });
  assert.equal(first.result.documents[0]!.retrieval, "STATIC");
  const fresh = await crawl(routes, { requestedExtractors: ["VENUE_FACTS"], documentCache: cache, freshnessMaxAgeHours: 24, now: () => new Date("2026-09-30T13:00:00Z") });
  assert.ok(!fresh.log.includes(`${origin}/`), fresh.log.join());
  assert.equal(fresh.result.observability!.cacheFreshHits, 1);
  const stale = await crawl(routes, { requestedExtractors: ["VENUE_FACTS"], documentCache: cache, freshnessMaxAgeHours: 24, now: () => new Date("2026-10-03T12:00:00Z") });
  assert.equal(stale.result.documents[0]!.retrieval, "REVALIDATED");
  assert.equal(stale.result.observability!.revalidatedNotModified, 1);
  assert.equal(stale.result.documents[0]!.sourceHash, first.result.documents[0]!.sourceHash);
  assert.ok(capacities(stale.extracted.venueFacts).some((item) => item.count === 250));
});

test("malformed and deeply nested HTML is parsed within bounds and still yields evidence", async () => {
  const deep = "<div>".repeat(5_000) + "deep" + "</span>".repeat(10);
  const root = parseHtml(`<p>unclosed <b>bold <table><tr><td>Hall<td>200</table></div></div>${deep}`);
  assert.ok(textContent(root).includes("Hall"));
  const { extracted } = await crawl({
    [`${origin}/robots.txt`]: ALLOW,
    [`${origin}/`]: { body: `<html><body><h2>Grand Hall<p>Standing capacity 350<p><div><span>Email: hire@venue.org</div></span></li></ul>${deep}` },
  }, { requestedExtractors: ["VENUE_FACTS", "PUBLIC_CONTACT"] });
  assert.ok(capacities(extracted.venueFacts).some((item) => item.count === 350));
  assert.ok(extracted.publicContacts.some((item) => item.value === "hire@venue.org"));
});

test("oversized and unsupported responses are skipped without aborting the crawl", async () => {
  const { result, extracted } = await crawl({
    [`${origin}/robots.txt`]: ALLOW,
    [`${origin}/`]: { body: `<a href="/spaces">Spaces</a><a href="/facilities">Facilities</a><a href="/contact">Contact</a><a href="/capacity">Capacity</a>` },
    [`${origin}/spaces`]: { body: "x".repeat(3_000), headers: { "content-length": "3000" } },
    [`${origin}/facilities`]: { body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), headers: { "content-type": "image/jpeg" } },
    [`${origin}/capacity`]: { body: '{"capacity": 900}', headers: { "content-type": "application/json" } },
    [`${origin}/contact`]: { body: "<p>Venue hire: hire@venue.org</p>" },
  }, { budget: { ...budget, maxBytesPerResponse: 2_000 } });
  assert.ok(result.documents.some((doc) => doc.url === `${origin}/contact`));
  assert.ok(result.observability!.skippedContent.some((item) => item.url === `${origin}/facilities`));
  assert.ok(result.observability!.skippedContent.some((item) => item.url === `${origin}/capacity`));
  assert.ok(result.stats.warnings.some((warning) => /spaces.*size limit/.test(warning)));
  assert.ok(!capacities(extracted.venueFacts).some((item) => item.count === 900));
});

test("replay is deterministic: identical inputs give identical documents, hashes, evidence refs and ordering", async () => {
  const routes: Record<string, Route> = {
    [`${origin}/robots.txt`]: ALLOW,
    [`${origin}/`]: { body: `<title>The Lantern</title><a href="/contact">Contact</a><a href="/spaces">Spaces</a><a href="/gallery">Gallery</a>` },
    [`${origin}/contact`]: { body: "<p>Venue hire: hire@venue.org. General: info@venue.org. Tel 0117 496 0123</p>" },
    [`${origin}/spaces`]: { body: "<h2>Grand Hall</h2><p>Theatre capacity 250</p><h2>Library</h2><p>Boardroom capacity 20</p>" },
    [`${origin}/gallery`]: { body: `<img src="/a.jpg" width="900" height="600"><img src="/b.jpg" width="900" height="600">` },
  };
  const a = await crawl(routes);
  const b = await crawl(routes);
  const snapshot = (run: typeof a) => JSON.stringify({ docs: run.result.documents.map((doc) => [doc.url, doc.sourceHash]), extracted: run.extracted, log: run.log, selections: run.result.observability!.selections });
  assert.equal(snapshot(a), snapshot(b));
});

test("live regression: trailing-slash variants are planned once and a redirect to a fetched page is not re-counted", async () => {
  const { result, log } = await crawl({
    [`${origin}/robots.txt`]: ALLOW,
    [`${origin}/`]: { body: `<a href="/venue-hire/">Venue hire</a><a href="/venue-hire">Hire our spaces</a><a href="/access">Access</a>` },
    [`${origin}/venue-hire/`]: { body: `<h2>Main Space</h2><p>Standing capacity 1,700</p><a href="/venue-hire">Hire</a>` },
    [`${origin}/venue-hire`]: { status: 301, headers: { location: `${origin}/venue-hire/` } },
    [`${origin}/access`]: { status: 301, headers: { location: `${origin}/venue-hire/` } },
  }, { requestedExtractors: ["VENUE_FACTS"] });
  assert.equal(log.filter((url) => url === `${origin}/venue-hire`).length, 0);
  assert.equal(result.documents.filter((doc) => doc.url === `${origin}/venue-hire/`).length, 1);
});

test("live regression: an unsatisfiable gap stops spending budget after a bounded number of attempts", async () => {
  const links = Array.from({ length: 12 }, (_, index) => `<a href="/visit/accessibility/page-${index}">Visit accessibility ${index}</a>`).join("");
  const routes: Record<string, Route> = { [`${origin}/robots.txt`]: ALLOW, [`${origin}/`]: { body: `<title>The Roundhouse</title>${links}` } };
  for (let index = 0; index < 12; index += 1) routes[`${origin}/visit/accessibility/page-${index}`] = { body: "<p>Information for visitors.</p>" };
  const { result } = await crawl(routes, { requestedExtractors: ["IDENTITY", "VENUE_FACTS"] });
  assert.ok(result.stats.pageCount <= 1 + 4 * 2, `pages ${result.stats.pageCount}`);
  assert.ok(["GAPS_EXHAUSTED", "NO_GAP_CANDIDATES"].includes(result.observability!.stopReason), result.observability!.stopReason);
  assert.ok(result.observability!.dimensionsMissing.includes("IDENTITY:ADDRESS"));
  assert.ok(result.observability!.selections.filter((item) => item.reason.startsWith("LINK:IDENTITY:ADDRESS")).length <= 4);
});

test("live regression: event detail slugs are not planned as venue space pages", async () => {
  const { log } = await crawl({
    [`${origin}/robots.txt`]: ALLOW,
    [`${origin}/`]: { body: `<a href="/events/karaoke-night-in-room-2/">Karaoke night in Room 2</a><a href="/venue-hire/">Venue hire</a>` },
    [`${origin}/venue-hire/`]: { body: "<h2>Room 2</h2><p>Standing capacity 150</p>" },
  }, { requestedExtractors: ["VENUE_FACTS"] });
  assert.ok(!log.includes(`${origin}/events/karaoke-night-in-room-2/`));
  assert.ok(log.includes(`${origin}/venue-hire/`));
});

test("live regression: access-information phrases are not named spaces or venue capacities", () => {
  const body = `<h2>Main Space Wheelchair Access</h2><p>We have 1 seated wheelchair space per booking.</p><h2>Step-free Access</h2><p>2 seated companion places and 1 standing.</p><h2>Main Space</h2><p>Standing capacity 1,700</p>`;
  const extracted = extractFromFetchedDocuments([{ url: `${origin}/visit/access`, body, contentType: "text/html", bytes: body.length, sourceHash: "a", observedAt: "2026-09-30T12:00:00Z", kind: "HTML" }], ["VENUE_FACTS"]);
  assert.deepEqual(capacities(extracted.venueFacts).map((item) => `${item.space}:${item.layout}:${item.count}`), ["Main Space:standing:1700"]);
});

test("automated crawls make zero requests outside the fixture site (no Google, API or model hosts)", async () => {
  const { log } = await crawl({
    [`${origin}/robots.txt`]: ALLOW,
    [`${origin}/`]: { body: `<a href="https://maps.google.com/?q=venue">Map</a><a href="https://www.facebook.com/venue">Facebook</a><a href="https://api.openai.com/">x</a><a href="/contact">Contact</a>` },
    [`${origin}/contact`]: { body: "<p>hire@venue.org</p>" },
  });
  assert.ok(log.every((url) => new URL(url).host === "venue.org"), log.join());
});
