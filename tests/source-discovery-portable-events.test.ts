import assert from "node:assert/strict";
import test from "node:test";
import { crawlVerifiedSource, extractFromFetchedDocuments, robotsAllows } from "../src/nexus/source-discovery/crawler.ts";
import type { FetchedDocument } from "../src/nexus/source-discovery/types.ts";
import { discoverLikelyEventDetailUrls } from "../src/nexus/source-discovery/links.ts";

const detailUrl = "https://venue.example/events/2026/10/22/autumn-jazz";
const calendarUrl = `${detailUrl}?format=ical`;

function document(url: string, body: string, contentType = "text/html", observedAt = "2026-09-23T12:00:00.000Z"): FetchedDocument {
  return { url, body, contentType, bytes: Buffer.byteLength(body), sourceHash: `hash:${url}`, observedAt };
}

const html = `<article class="eventitem">
  <h1 class="eventitem-title">Autumn Jazz</h1>
  <time datetime="2026-10-22T19:30:00+01:00">7:30pm</time>
  <div itemprop="location">Grand Hall</div>
  <div itemprop="description"><p>Line-up: The Quartet, Guest Artist</p></div>
  <a href="https://tickets.example/autumn">Buy tickets</a>
  <a href="?format=ical">ICS</a>
</article>
<meta property="og:site_name" content="Venue Example">
<meta property="og:image" content="https://images.example/autumn.jpg">`;

const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:autumn-123@calendar.example\r\nDTSTART;TZID=Europe/London:20261022T193000\r\nDTEND;TZID=Europe/London:20261022T220000\r\nSUMMARY:Autumn Jazz\r\nLOCATION:Grand Hall\r\nURL:${detailUrl}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

test("HTML-only event extracts explicit date, lineup, ticket and page-specific image without JSON-LD", () => {
  const result = extractFromFetchedDocuments([document(detailUrl, html)], ["EVENTS"]);
  assert.equal(result.eventCandidates.length, 1);
  const event = result.eventCandidates[0]!;
  assert.equal(event.title, "Autumn Jazz");
  assert.equal(event.startAt, "2026-10-22T18:30:00.000Z");
  assert.equal(event.venueText, "Grand Hall");
  assert.deepEqual(event.performers, ["The Quartet", "Guest Artist"]);
  assert.equal(event.ticketUrl, "https://tickets.example/autumn");
  assert.equal(event.eventImageUrl, "https://images.example/autumn.jpg");
});

test("portable HTML extraction also accepts a dated what's-on detail path", () => {
  const url = "https://venue.example/whats-on/autumn-jazz";
  const event = extractFromFetchedDocuments([document(url, html)], ["EVENTS"]).eventCandidates[0];
  assert.equal(event?.title, "Autumn Jazz");
  assert.equal(event?.sourceEventUrl, url);
});

test("HTML plus ICS retains UID, Europe/London TZID, end time and calendar provenance", () => {
  const result = extractFromFetchedDocuments([document(detailUrl, html), document(calendarUrl, ics, "text/calendar")], ["EVENTS"]);
  assert.equal(result.eventCandidates.length, 1);
  const event = result.eventCandidates[0]!;
  assert.equal(event.sourceEventUrl, detailUrl);
  assert.equal(event.sourceExternalId, "autumn-123@calendar.example");
  assert.match(event.sourceIdentityEvidenceRef ?? "", /:ics:/);
  assert.equal(event.startAt, "2026-10-22T18:30:00.000Z");
  assert.equal(event.endAt, "2026-10-22T21:00:00.000Z");
  assert.equal(event.timezone, "Europe/London");
  assert.ok(result.evidenceRefs.some((ref) => ref.includes("hash:") && ref.includes("ical")));
});

test("date-less first-party HTML contributes title, lineup and ticket after ICS supplies the date", () => {
  const dateless = `<article><h1>Autumn Jazz</h1><div itemprop="location">Grand Hall</div>
    <div itemprop="description"><p>Line-up: The Quartet, Guest Artist</p></div>
    <a href="https://tickets.example/autumn">Buy tickets</a></article>
    <meta property="og:image" content="https://images.example/autumn.jpg">`;
  const result = extractFromFetchedDocuments([document(detailUrl, dateless), document(calendarUrl, ics, "text/calendar")], ["EVENTS"]);
  assert.equal(result.eventCandidates.length, 1);
  assert.deepEqual(result.eventCandidates[0]?.performers, ["The Quartet", "Guest Artist"]);
  assert.equal(result.eventCandidates[0]?.ticketUrl, "https://tickets.example/autumn");
  assert.equal(result.eventCandidates[0]?.eventImageUrl, "https://images.example/autumn.jpg");
});

test("ICS-only evidence may create an event only with UID, summary, date and first-party detail URL", () => {
  const result = extractFromFetchedDocuments([document(calendarUrl, ics, "text/calendar")], ["EVENTS"]);
  assert.equal(result.eventCandidates.length, 1);
  assert.equal(result.eventCandidates[0]?.title, "Autumn Jazz");
  assert.equal(result.eventCandidates[0]?.sourceExternalId, "autumn-123@calendar.example");
});

test("malformed ICS produces one bounded warning and cannot fabricate an event", () => {
  const malformed = document(calendarUrl, "not a calendar".repeat(100), "text/calendar");
  const result = extractFromFetchedDocuments([malformed], ["EVENTS"]);
  assert.equal(result.eventCandidates.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0]!, /malformed ICS/i);
  assert.ok(result.warnings[0]!.length < 300);
});

test("calendar extraction caps a large VEVENT feed and reports truncation", () => {
  const many = `BEGIN:VCALENDAR\n${Array.from({ length: 101 }, (_, index) => `BEGIN:VEVENT\nUID:${index}@calendar.example\nDTSTART:20261022T183000Z\nSUMMARY:Show ${index}\nURL:${detailUrl}/${index}\nEND:VEVENT`).join("\n")}\nEND:VCALENDAR`;
  const result = extractFromFetchedDocuments([document(calendarUrl, many, "text/calendar")], ["EVENTS"]);
  assert.equal(result.eventCandidates.length, 100);
  assert.match(result.warnings.join(" "), /limit|truncat/i);
});

test("event-specific HTML heading replaces JSON-LD site-title boilerplate", () => {
  const body = `${html}<script type="application/ld+json">{"@type":"Event","name":"Autumn Jazz — Venue Example","startDate":"2026-10-22T19:30:00+01:00","url":"${detailUrl}"}</script>`;
  const result = extractFromFetchedDocuments([document(detailUrl, body)], ["EVENTS"]);
  assert.equal(result.eventCandidates.length, 1);
  assert.equal(result.eventCandidates[0]?.title, "Autumn Jazz");
  assert.deepEqual(result.eventCandidates[0]?.performers, ["The Quartet", "Guest Artist"]);
});

test("first-party event article retains a stable neutral source item ID without fabricating an ICS UID", () => {
  const source = html.replace('<article class="eventitem">', '<article class="eventitem" data-item-id="stable-item-123">');
  const event = extractFromFetchedDocuments([document(detailUrl, source)], ["EVENTS"]).eventCandidates[0]!;
  assert.equal(event.sourceExternalId, "stable-item-123");
  assert.match(event.sourceIdentityEvidenceRef ?? "", /:html:/);
});

test("explicit source timeZone is retained; no system-locale timezone is invented", () => {
  const withContext = `${html}<script>window.siteContext={"timeZone":"Europe/London"};</script>`;
  assert.equal(extractFromFetchedDocuments([document(detailUrl, withContext)], ["EVENTS"]).eventCandidates[0]?.timezone, "Europe/London");
  assert.equal(extractFromFetchedDocuments([document(detailUrl, html)], ["EVENTS"]).eventCandidates[0]?.timezone, null);
});

test("site logo and global navigation links are not promoted to event image or ticket evidence", () => {
  const body = `<nav><a href="https://tickets.example/all">Tickets</a></nav>
    <meta property="og:image" content="https://venue.example/logo.png">
    <script type="application/ld+json">{"@type":"WebSite","image":"https://venue.example/logo.png"}</script>
    <article><h1>Autumn Jazz</h1><time datetime="2026-10-22T19:30:00+01:00"></time></article>`;
  const event = extractFromFetchedDocuments([document(detailUrl, body)], ["EVENTS"]).eventCandidates[0]!;
  assert.equal(event.ticketUrl, null);
  assert.equal(event.eventImageUrl, null);
});

test("structured, HTML and ICS variants dedupe with stable fingerprint across observation times", () => {
  const body = `${html}<script type="application/ld+json">{"@type":"MusicEvent","name":"Autumn Jazz","startDate":"2026-10-22T19:30:00+01:00","url":"${detailUrl}"}</script>`;
  const first = extractFromFetchedDocuments([document(detailUrl, body), document(calendarUrl, ics, "text/calendar")], ["EVENTS"]);
  const second = extractFromFetchedDocuments([document(detailUrl, body, "text/html", "2026-09-24T12:00:00.000Z"), document(calendarUrl, ics, "text/calendar", "2026-09-24T12:00:00.000Z")], ["EVENTS"]);
  assert.equal(first.eventCandidates.length, 1);
  assert.equal(second.eventCandidates.length, 1);
  assert.equal(first.eventCandidates[0]?.sourceFingerprint, second.eventCandidates[0]?.sourceFingerprint);
});

test("distinct performances with one title and venue remain distinct", () => {
  const secondUrl = "https://venue.example/events/2026/10/23/autumn-jazz";
  const second = html.replace(detailUrl, secondUrl).replace("2026-10-22T19:30:00+01:00", "2026-10-23T19:30:00+01:00");
  const result = extractFromFetchedDocuments([document(detailUrl, html), document(secondUrl, second)], ["EVENTS"]);
  assert.equal(result.eventCandidates.length, 2);
});

test("calendar performances sharing one canonical URL retain distinct starts and UIDs", () => {
  const calendar = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:first@venue.example\nDTSTART:20261022T183000Z\nSUMMARY:Autumn Jazz\nURL:${detailUrl}\nEND:VEVENT\nBEGIN:VEVENT\nUID:second@venue.example\nDTSTART:20261023T183000Z\nSUMMARY:Autumn Jazz\nURL:${detailUrl}\nEND:VEVENT\nEND:VCALENDAR`;
  const result = extractFromFetchedDocuments([document(calendarUrl, calendar, "text/calendar")], ["EVENTS"]);
  assert.deepEqual(result.eventCandidates.map((event) => [event.startAt, event.sourceExternalId]), [
    ["2026-10-22T18:30:00.000Z", "first@venue.example"],
    ["2026-10-23T18:30:00.000Z", "second@venue.example"],
  ]);
});

test("malformed structured dates cannot abort extraction of other fetched events", () => {
  const bad = `<script type="application/ld+json">{"@type":"Event","name":"Broken","startDate":"not-a-date","url":"${detailUrl}"}</script>`;
  const good = `${html}<script type="application/ld+json">{"@type":"Event","name":"Autumn Jazz","startDate":"2026-10-22T19:30:00+01:00","endDate":"also-not-a-date","url":"${detailUrl}"}</script>`;
  const result = extractFromFetchedDocuments([document(`${detailUrl}/broken`, bad), document(detailUrl, good)], ["EVENTS"]);
  assert.equal(result.eventCandidates.length, 1);
  assert.equal(result.eventCandidates[0]?.title, "Autumn Jazz");
  assert.equal(result.eventCandidates[0]?.endAt, null);
  assert.match(result.warnings.join(" "), /invalid structured event date/i);
});

test("four HTML pages and three same-origin calendars complete within eight requests", async () => {
  const origin = "https://venue.example";
  const urls = ["autumn-jazz", "winter-jazz", "spring-jazz"].map((slug) => `${origin}/events/2026/${slug}`);
  const responses = new Map<string, string>([
    [`${origin}/robots.txt`, "User-agent: *\nAllow: /"],
    [`${origin}/events`, urls.map((url) => `<a href="${url}">${url}</a>`).join("\n")],
  ]);
  urls.forEach((url, index) => {
    responses.set(url, `<article><h1>Show ${index + 1}</h1><time datetime="2026-10-${22 + index}T19:30:00+01:00"></time><a href="?format=ical">ICS</a></article>`);
    responses.set(`${url}?format=ical`, `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:show-${index + 1}@venue.example\nDTSTART:202610${22 + index}T183000Z\nSUMMARY:Show ${index + 1}\nURL:${url}\nEND:VEVENT\nEND:VCALENDAR`);
  });
  const requested: string[] = [];
  const crawl = await crawlVerifiedSource({
    verifiedUrl: `${origin}/events`, requestedExtractors: ["EVENTS"],
    budget: { maxPages: 4, maxRequests: 8, maxBytesPerResponse: 10_000, maxRedirects: 1, maxRetries: 0, timeoutMs: 1_000, minRequestDelayMs: 0 },
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (input) => {
      const url = String(input);
      requested.push(url);
      const body = responses.get(url);
      return body === undefined ? new Response("not found", { status: 404 }) : new Response(body, { headers: { "content-type": url.includes("ical") ? "text/calendar" : "text/html" } });
    },
  });
  const events = extractFromFetchedDocuments(crawl.documents, ["EVENTS"]).eventCandidates;
  assert.equal(crawl.stats.status, "COMPLETED");
  assert.equal(crawl.stats.pageCount, 4);
  assert.equal(crawl.stats.requestCount, 8);
  assert.equal(crawl.documents.length, 7);
  assert.equal(events.length, 3);
  assert.deepEqual(events.map((event) => event.sourceExternalId).sort(), ["show-1@venue.example", "show-2@venue.example", "show-3@venue.example"]);
  assert.equal(requested.some((url) => !responses.has(url)), false);
});

test("calendar candidates dropped by the request bound leave a partial crawl", async () => {
  const listing = "https://venue.example/events";
  const first = `${listing}/first`;
  const second = `${listing}/second`;
  const crawl = await crawlVerifiedSource({
    verifiedUrl: listing, requestedExtractors: ["EVENTS"],
    budget: { maxPages: 3, maxRequests: 4, maxBytesPerResponse: 10_000, maxRedirects: 0, maxRetries: 0, timeoutMs: 1_000, minRequestDelayMs: 0 },
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.endsWith("robots.txt")) return new Response("User-agent: *\nAllow: /");
      if (url === listing) return new Response(`<a href="${first}">First</a><a href="${second}">Second</a>`);
      return new Response('<article><h1>Show</h1><time datetime="2026-10-22T19:30:00+01:00"></time><a href="?format=ical">ICS</a></article>');
    },
  });
  assert.equal(crawl.stats.pageCount, 3);
  assert.equal(crawl.stats.status, "PARTIAL");
  assert.match(crawl.stats.warnings.join(" "), /budget/i);
});

test("calendar discovery is bounded, same-origin, and refuses robots-disallowed query paths", async () => {
  assert.equal(robotsAllows("User-agent: *\nDisallow: /*?format=ical", calendarUrl, "TestBot"), false);
  const external = html.replace('href="?format=ical"', 'href="https://other.example/show.ics"');
  const requested: string[] = [];
  await crawlVerifiedSource({
    verifiedUrl: detailUrl, requestedExtractors: ["EVENTS"],
    budget: { maxPages: 1, maxRequests: 3, maxBytesPerResponse: 10_000, maxRedirects: 0, maxRetries: 0, timeoutMs: 1_000, minRequestDelayMs: 0 },
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (input) => { requested.push(String(input)); return new Response(String(input).endsWith("robots.txt") ? "User-agent: *\nAllow: /" : external); },
  });
  assert.deepEqual(requested, ["https://venue.example/robots.txt", detailUrl]);
});

test("date-less first-party event detail probes one conventional calendar URL within request budget", async () => {
  const requested: string[] = [];
  const crawl = await crawlVerifiedSource({
    verifiedUrl: detailUrl, requestedExtractors: ["EVENTS"],
    budget: { maxPages: 1, maxRequests: 3, maxBytesPerResponse: 10_000, maxRedirects: 0, maxRetries: 0, timeoutMs: 1_000, minRequestDelayMs: 0 },
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (input) => {
      const url = String(input);
      requested.push(url);
      return new Response(url.endsWith("robots.txt") ? "User-agent: *\nAllow: /" : url.includes("ical") ? ics : "<article><h1>Autumn Jazz</h1><div itemprop=\"location\">Grand Hall</div></article>", { headers: { "content-type": url.includes("ical") ? "text/calendar" : "text/html" } });
    },
  });
  assert.deepEqual(requested, ["https://venue.example/robots.txt", detailUrl, calendarUrl]);
  assert.equal(crawl.stats.status, "COMPLETED");
  assert.equal(extractFromFetchedDocuments(crawl.documents, ["EVENTS"]).eventCandidates.length, 1);
});

test("event discovery removes tracking-only query parameters before fetching a detail", () => {
  const listing = document("https://venue.example/events", '<a href="/events/normal-night?tracking=ignored&utm_source=listing">Normal Night</a>');
  assert.deepEqual(discoverLikelyEventDetailUrls(listing), ["https://venue.example/events/normal-night"]);
});

test("a calendar redirect cannot bypass robots on its same-origin destination", async () => {
  const requested: string[] = [];
  const crawl = await crawlVerifiedSource({
    verifiedUrl: detailUrl, requestedExtractors: ["EVENTS"],
    budget: { maxPages: 1, maxRequests: 4, maxBytesPerResponse: 10_000, maxRedirects: 1, maxRetries: 0, timeoutMs: 1_000, minRequestDelayMs: 0 },
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith("robots.txt")) return new Response("User-agent: *\nDisallow: /private.ics");
      if (url === calendarUrl) return new Response(null, { status: 302, headers: { location: "/private.ics" } });
      return new Response(html);
    },
  });
  assert.equal(requested.includes("https://venue.example/private.ics"), false);
  assert.equal(crawl.stats.blockedCount > 0, true);
  assert.equal(crawl.stats.status, "PARTIAL");
});

test("a robots server failure blocks all source and calendar requests", async () => {
  const requested: string[] = [];
  const crawl = await crawlVerifiedSource({
    verifiedUrl: detailUrl, requestedExtractors: ["EVENTS"],
    budget: { maxPages: 1, maxRequests: 4, maxBytesPerResponse: 10_000, maxRedirects: 1, maxRetries: 0, timeoutMs: 1_000, minRequestDelayMs: 0 },
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (input) => { requested.push(String(input)); return new Response("unavailable", { status: 503 }); },
  });
  assert.deepEqual(requested, ["https://venue.example/robots.txt"]);
  assert.equal(crawl.stats.status, "BLOCKED");
});
