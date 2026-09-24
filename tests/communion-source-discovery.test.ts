import assert from "node:assert/strict";
import test from "node:test";
import {
  crawlVerifiedSource,
  extractFromFetchedDocuments,
  type CrawlBudget,
  type ResolveHost,
} from "../src/nexus/source-discovery/crawler.ts";

const publicResolver: ResolveHost = async () => [{ address: "93.184.216.34", family: 4 }];

function budget(overrides: Partial<CrawlBudget> = {}): CrawlBudget {
  return {
    maxPages: 10,
    maxRequests: 20,
    maxBytesPerResponse: 1_000_000,
    maxRedirects: 2,
    maxRetries: 1,
    timeoutMs: 5_000,
    minRequestDelayMs: 0,
    ...overrides,
  };
}

const COMMUNION_SAMPLE_HTML = `
<!DOCTYPE html>
<html>
<head><title>Tickets - Communion Music</title></head>
<body>
<main>
  <div class="grid_item event" data-artist="pacific-avenue" data-date="2026-09-24">
    <div class="image_holder">
      <a class="event_link" href="https://communionmusic.seetickets.com/event/pacific-avenue/the-garage/3552527?aff=id1communionmusic" target="_blank">
        <img src="/content/images/2026/08/pacific-avenue.jpg" alt="Photo: Pacific Avenue">
      </a>
    </div>
    <div class="text_holder">
      <p class="date">7:00PM Thu, 24 Sep 2026</p>
      <h2>Pacific Avenue</h2>
      <p class="location">The Garage, London</p>
    </div>
  </div>
  <div class="grid_item event" data-artist="the-heavy-heavy" data-date="2026-10-15">
    <div class="image_holder">
      <a class="event_link" href="https://www.eventim.co.uk/event/the-heavy-heavy-electric-ballroom-1892341/?affiliate=CM1" target="_blank">
        <img src="https://images.communionmusic.co.uk/heavy-heavy.jpg" alt="Photo: The Heavy Heavy">
      </a>
    </div>
    <div class="text_holder">
      <p class="date">7:30PM Thu, 15 Oct 2026</p>
      <h2>The Heavy Heavy</h2>
      <p class="location">Electric Ballroom, Camden, London</p>
    </div>
  </div>
  <div class="grid_item event" data-artist="michael-kiwanuka" data-date="2026-11-20">
    <div class="image_holder">
      <a class="event_link" href="https://www.livenation.co.uk/artist-michael-kiwanuka-12345" target="_blank">
        <img src="/content/images/kiwanuka.jpg" alt="Photo: Michael Kiwanuka">
      </a>
    </div>
    <div class="text_holder">
      <p class="date">6:30PM Fri, 20 Nov 2026</p>
      <h2>Michael Kiwanuka</h2>
      <p class="location">Roundhouse, London</p>
    </div>
  </div>
</main>
</body>
</html>
`;

test("Communion source crawl fetches only robots and tickets page with zero external ticket requests", async () => {
  const requested: string[] = [];
  const result = await crawlVerifiedSource({
    verifiedUrl: "https://www.communionmusic.co.uk/tickets",
    requestedExtractors: ["EVENTS"],
    budget: budget(),
    resolveHost: publicResolver,
    fetchImpl: async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: *\nAllow: /\n", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      }
      if (url === "https://www.communionmusic.co.uk/tickets") {
        return new Response(COMMUNION_SAMPLE_HTML, {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      }
      return new Response("Not found", { status: 404 });
    },
  });

  // Exactly 2 requests: robots.txt and /tickets
  assert.equal(requested.length, 2);
  assert.equal(requested[0], "https://www.communionmusic.co.uk/robots.txt");
  assert.equal(requested[1], "https://www.communionmusic.co.uk/tickets");
  assert.equal(result.stats.requestCount, 2);
  assert.equal(result.stats.pageCount, 1);
  assert.equal(result.stats.status, "COMPLETED");
  assert.equal(result.stats.blockedCount, 0);

  // Crucial check: ZERO requests to external ticket hosts
  const externalTicketRequests = requested.filter((url) =>
    url.includes("seetickets.com") || url.includes("eventim.co.uk") || url.includes("livenation.co.uk"),
  );
  assert.equal(externalTicketRequests.length, 0);

  // Extract events
  const extraction = extractFromFetchedDocuments(result.documents, ["EVENTS"]);
  assert.equal(extraction.eventCandidates.length, 3);

  // Check Pacific Avenue candidate
  const pacific = extraction.eventCandidates.find((e) => e.title === "Pacific Avenue");
  assert.ok(pacific);
  assert.equal(pacific.title, "Pacific Avenue");
  assert.equal(pacific.venueText, "The Garage, London");
  assert.equal(pacific.timezone, "Europe/London");
  assert.equal(pacific.startAt, "2026-09-24T18:00:00.000Z"); // 7:00 PM BST = 18:00 UTC
  assert.equal(
    pacific.ticketUrl,
    "https://communionmusic.seetickets.com/event/pacific-avenue/the-garage/3552527?aff=id1communionmusic",
  );
  assert.equal(
    pacific.eventImageUrl,
    "https://www.communionmusic.co.uk/content/images/2026/08/pacific-avenue.jpg",
  );
  assert.deepEqual(pacific.performers, ["Pacific Avenue"]);
  assert.ok(pacific.sourceFingerprint.length > 0);

  // Check Heavy Heavy candidate
  const heavy = extraction.eventCandidates.find((e) => e.title === "The Heavy Heavy");
  assert.ok(heavy);
  assert.equal(heavy.title, "The Heavy Heavy");
  assert.equal(heavy.venueText, "Electric Ballroom, Camden, London");
  assert.equal(
    heavy.ticketUrl,
    "https://www.eventim.co.uk/event/the-heavy-heavy-electric-ballroom-1892341/?affiliate=CM1",
  );
  assert.equal(heavy.eventImageUrl, "https://images.communionmusic.co.uk/heavy-heavy.jpg");

  // Check Michael Kiwanuka candidate
  const kiwanuka = extraction.eventCandidates.find((e) => e.title === "Michael Kiwanuka");
  assert.ok(kiwanuka);
  assert.equal(kiwanuka.title, "Michael Kiwanuka");
  assert.equal(kiwanuka.venueText, "Roundhouse, London");
  assert.equal(kiwanuka.ticketUrl, "https://www.livenation.co.uk/artist-michael-kiwanuka-12345");
});

test("Communion source crawl fails closed when robots disallows the tickets path", async () => {
  const result = await crawlVerifiedSource({
    verifiedUrl: "https://www.communionmusic.co.uk/tickets",
    requestedExtractors: ["EVENTS"],
    budget: budget(),
    resolveHost: publicResolver,
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: *\nDisallow: /tickets\n", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      }
      return new Response(COMMUNION_SAMPLE_HTML, { status: 200 });
    },
  });

  assert.equal(result.stats.status, "BLOCKED");
  assert.equal(result.stats.blockedCount, 1);
  assert.equal(result.documents.length, 0);

  const extraction = extractFromFetchedDocuments(result.documents, ["EVENTS"]);
  assert.equal(extraction.eventCandidates.length, 0);
});

test("Communion source crawl fails closed when tickets page returns HTTP 500", async () => {
  const result = await crawlVerifiedSource({
    verifiedUrl: "https://www.communionmusic.co.uk/tickets",
    requestedExtractors: ["EVENTS"],
    budget: budget({ maxRetries: 0 }),
    resolveHost: publicResolver,
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: *\nAllow: /\n", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      }
      return new Response("Internal Server Error", { status: 500 });
    },
  });

  assert.equal(result.stats.status, "FAILED");
  assert.equal(result.documents.length, 0);
  const extraction = extractFromFetchedDocuments(result.documents, ["EVENTS"]);
  assert.equal(extraction.eventCandidates.length, 0);
});
