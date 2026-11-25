import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  PHASE3B_HARD_LIMITS,
  runBoundedEmergingArtistDiscoveryLoop,
} from "../src/nexus/source-discovery/emerging-artist-expansion.ts";
import { extractFromFetchedDocuments } from "../src/nexus/source-discovery/crawler.ts";
import type { FetchedDocument } from "../src/nexus/source-discovery/types.ts";

function makeSyntheticDoc(url: string, body: string, observedAt = "2026-11-25T10:00:00.000Z"): FetchedDocument {
  const buf = Buffer.from(body, "utf8");
  return {
    url,
    finalUrl: url,
    status: 200,
    contentType: "text/html; charset=UTF-8",
    bytes: buf.length,
    sourceHash: createHash("sha256").update(buf).digest("hex"),
    observedAt,
    kind: "HTML",
    body,
  };
}

const SYNTHETIC_HOP0_VENUE_DOC = makeSyntheticDoc(
  "https://leith-lockup.example.uk/2026/11/27/kestrel-echo/",
  `<!doctype html><html><body><article class="post">
    <h2 class="entry-title">Kestrel Echo</h2>
    <time>Friday 27th November 2026</time>
    <p>Kestrel Echo are an Edinburgh indie duo.</p>
    <p><a class="tickets" href="https://forth-circuit.example.uk/kestrel-echo/">Buy Tickets</a></p>
  </article></body></html>`,
);

const SYNTHETIC_HOP1_PROMOTER_DOC = makeSyntheticDoc(
  "https://forth-circuit.example.uk/kestrel-echo/",
  `<!doctype html><html><head><meta property="og:site_name" content="Forth Circuit" /></head><body><article>
    <h1>Kestrel Echo</h1>
    <p><strong>20 NOVEMBER 2026 – LEEDS AIRE HALL</strong></p>
    <p><a href="https://blocked-tickets.example.uk/event/123">BUY TICKETS</a></p>
    <p><strong>27 NOVEMBER 2026 – EDINBURGH LEITH LOCKUP</strong></p>
    <p><a href="https://www.seetickets.com/event/kestrel-echo/999">BUY TICKETS</a></p>
    <iframe src="https://open.spotify.com/embed/artist/1vY8fuL3kdwvvfdoMHwvsX" title="Spotify Embed: Kestrel Echo"></iframe>
  </article></body></html>`,
);

const SYNTHETIC_HOP2_CONCRETE5_DOC = makeSyntheticDoc(
  "https://aire-hall.example.uk/whats-on/copper-lane",
  `<!doctype html><html><body>
    <section id="event">
      <div class="row columns-2">
        <div class="column">
          <header>
            <p>Northern Wave Presents...</p>
            <h1>Copper Lane</h1>
            <h2>+ Velvet Wire + Northbound</h2>
          </header>
          <div id="event_main">
            <p>Copper Lane are a Leeds-based original indie trio with their debut EP arriving in early 2027.</p>
            <div id="event_main_fade"><p class="read_more"><a href="#">Click here to read more...</a></p></div>
          </div>
          <div id="event_listen">
            <h2>Have a listen...</h2>
            <iframe src="https://www.youtube.com/embed/abcDEF12345" title="YouTube video player"></iframe>
          </div>
        </div>
        <div id="event_details" class="column">
          <p class="date">Wednesday 25th November 2026</p>
          <p class="times">Doors: 19:30</p>
          <ul id="event_tickets"><li><a href="https://northernwave.seetickets.com/event/copper-lane/aire-hall/1001">See Tickets</a></li></ul>
          <ul id="event_links"><li><a href="https://www.copperlane.example.uk">Artist Website</a></li></ul>
        </div>
      </div>
    </section>
  </body></html>`,
);

const SYNTHETIC_HOP2_EXTERNAL_VENUE_DOC = makeSyntheticDoc(
  "https://aire-hall.example.uk/whats-on/evening-harbour-light",
  `<!doctype html><html><body>
    <section id="event">
      <div class="row columns-2">
        <div class="column">
          <header>
            <p>Aire Hall Presents...</p>
            <h1>An Evening with Harbour Light</h1>
            <h2>+ Glass Lantern @ Sheffield Guildhall</h2>
          </header>
          <div id="event_main"><p>Intimate northern tour date.</p><div id="event_main_fade"></div></div>
        </div>
        <div id="event_details" class="column">
          <p class="date">Thursday 26th November 2026</p>
          <p class="times">Doors: 19:00</p>
          <ul id="event_tickets"><li><a href="https://airehall.seetickets.com/event/harbour-light/1002">See Tickets</a></li></ul>
        </div>
      </div>
    </section>
  </body></html>`,
);

test("Concrete5 venue extractor parses headline, explicit support, external @ venue, doors time, and YouTube embeds", () => {
  const res = extractFromFetchedDocuments([SYNTHETIC_HOP2_CONCRETE5_DOC, SYNTHETIC_HOP2_EXTERNAL_VENUE_DOC], ["EVENTS"]);
  assert.equal(res.eventCandidates.length, 2);

  const copper = res.eventCandidates.find((e) => e.sourceEventUrl.includes("copper-lane"));
  assert.ok(copper);
  assert.equal(copper.organiser, "Northern Wave");
  assert.equal(copper.venueText, null);
  assert.equal(copper.timePrecision, "EXPLICIT_INSTANT");
  assert.equal(copper.timeMeaning, "DOORS_OPEN");
  assert.equal(copper.startAt, "2026-11-25T19:30:00.000Z");
  assert.deepEqual(copper.performers, ["Copper Lane", "Velvet Wire", "Northbound"]);
  assert.equal(copper.performerBillings?.[0]?.role, "HEADLINE");
  assert.equal(copper.performerBillings?.[1]?.role, "SUPPORT");
  assert.equal(copper.performerBillings?.[2]?.role, "SUPPORT");
  assert.ok(copper.outboundArtistUrls?.includes("https://www.youtube.com/watch?v=abcDEF12345"));
  assert.ok(copper.outboundArtistUrls?.includes("https://www.copperlane.example.uk/"));

  const harbour = res.eventCandidates.find((e) => e.sourceEventUrl.includes("evening-harbour-light"));
  assert.ok(harbour);
  assert.equal(harbour.venueText, "Sheffield Guildhall");
  assert.deepEqual(harbour.performers, ["Harbour Light", "Glass Lantern"]);
});

test("Phase 3B bounded 2-hop loop follows operator-approved Hop 2 and blocks ToS-prohibited domains with zero fetches", async () => {
  const offlineDocs = new Map<string, FetchedDocument[]>([
    ["leith-lockup.example.uk", [SYNTHETIC_HOP0_VENUE_DOC]],
    ["forth-circuit.example.uk", [SYNTHETIC_HOP1_PROMOTER_DOC]],
    ["aire-hall.example.uk", [SYNTHETIC_HOP2_CONCRETE5_DOC, SYNTHETIC_HOP2_EXTERNAL_VENUE_DOC]],
  ]);

  const approvedDomains = new Set(["leith-lockup.example.uk", "forth-circuit.example.uk", "aire-hall.example.uk"]);
  const result = await runBoundedEmergingArtistDiscoveryLoop({
    phaseBudgetMode: "PHASE3B",
    rootSeeds: [{ verifiedUrl: "https://leith-lockup.example.uk/2026/11/27/kestrel-echo/", subjectEntityType: "VENUE" }],
    maxRootDomains: 3,
    maxTotalHtmlPages: 30,
    maxExpansionHops: 2,
    maxPagesPerHop: 12,
    offlineDocumentsByDomain: offlineDocs,
    explicitHopCandidates: [
      {
        parentDomain: "forth-circuit.example.uk",
        candidateUrl: "https://aire-hall.example.uk/whats-on",
        discoveredFromSourceUrl: "https://forth-circuit.example.uk/kestrel-echo/",
        discoveredFromEventUrl: "https://forth-circuit.example.uk/kestrel-echo/#tour-2026-11-20-leeds-aire-hall",
        relatedPerformers: ["Kestrel Echo"],
        subjectEntityType: "VENUE",
      },
    ],
    evaluateOriginPermission: (rawUrl) => {
      const host = new URL(rawUrl).hostname.replace(/^www\./, "");
      if (host === "blocked-tickets.example.uk") {
        return { permitted: false, reasonCode: "ANTI_SCRAPING_AND_DATABASE_TOS_PROHIBITED" };
      }
      if (approvedDomains.has(host)) {
        return {
          permitted: true,
          reasonCode: "OPERATOR_APPROVED_SOURCE",
          sourceRole: host === "forth-circuit.example.uk" ? "PROMOTER_OR_SHOWCASE_WEBSITE" : "VENUE_OR_EVENT_WEBSITE",
          subjectEntityType: host === "forth-circuit.example.uk" ? "ORGANISATION" : "VENUE",
        };
      }
      return { permitted: false, reasonCode: "UNREGISTERED_SOURCE_BLOCKED" };
    },
  });

  assert.equal(result.steps.length, 3);
  assert.deepEqual(result.steps.map((s) => s.hopDepth), [0, 1, 2]);
  assert.equal(result.totals.expansionHopsExecuted, 2);
  assert.equal(result.totals.totalHtmlPagesCaptured, 4);
  assert.ok(result.totals.totalHtmlPagesCaptured <= PHASE3B_HARD_LIMITS.MAX_TOTAL_HTML_PAGES);

  const blockedEntry = result.candidateLedger.find((c) => c.registrableDomain === "blocked-tickets.example.uk");
  assert.ok(blockedEntry);
  assert.equal(blockedEntry.disposition, "BLOCKED_BY_SOURCE_POLICY");
  assert.equal(blockedEntry.reasonCode, "ANTI_SCRAPING_AND_DATABASE_TOS_PROHIBITED");

  const hop3Held = result.candidateLedger.find((c) => c.registrableDomain === "copperlane.example.uk");
  assert.ok(hop3Held);
  assert.equal(hop3Held.disposition, "HELD_HOP_DEPTH_LIMIT");
});

test("Phase 3B hard ceilings reject > 30 HTML pages or > 2 hops", async () => {
  await assert.rejects(
    () =>
      runBoundedEmergingArtistDiscoveryLoop({
        phaseBudgetMode: "PHASE3B",
        rootSeeds: [{ verifiedUrl: "https://leith-lockup.example.uk/", subjectEntityType: "VENUE" }],
        maxTotalHtmlPages: 31,
        evaluateOriginPermission: () => ({ permitted: true, reasonCode: "OK" }),
      }),
    (err: { code?: string }) => err.code === "DISCOVERY_HTML_PAGE_BUDGET_EXCEEDED",
  );

  await assert.rejects(
    () =>
      runBoundedEmergingArtistDiscoveryLoop({
        phaseBudgetMode: "PHASE3B",
        rootSeeds: [{ verifiedUrl: "https://leith-lockup.example.uk/", subjectEntityType: "VENUE" }],
        maxExpansionHops: 3,
        evaluateOriginPermission: () => ({ permitted: true, reasonCode: "OK" }),
      }),
    (err: { code?: string }) => err.code === "DISCOVERY_HOP_BUDGET_EXCEEDED",
  );
});
