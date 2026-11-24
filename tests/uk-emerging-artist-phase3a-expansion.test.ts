import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { discoverUsefulSourceUrls } from "../src/nexus/source-discovery/links.ts";
import { extractEventsFromDocuments } from "../src/nexus/source-discovery/extractors/events.ts";
import {
  evaluateFollowUpUrlsFromDiscoveryResult,
  runBoundedEmergingArtistDiscoveryLoop,
  type OriginPermissionEvaluator,
} from "../src/nexus/source-discovery/emerging-artist-expansion.ts";
import type { FetchedDocument } from "../src/nexus/source-discovery/types.ts";

function makeDoc(url: string, body: string, observedAt = "2026-11-24T22:00:00.000Z"): FetchedDocument {
  const bytes = Buffer.byteLength(body, "utf8");
  const sourceHash = createHash("sha256").update(body, "utf8").digest("hex");
  return {
    url,
    contentType: "text/html; charset=UTF-8",
    body,
    bytes,
    sourceHash,
    observedAt,
    kind: "HTML",
  };
}

const SYNTHETIC_PERMISSION_EVALUATOR: OriginPermissionEvaluator = (url: string) => {
  const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  if (host === "leith-lockup.example.uk") {
    return { permitted: true, reasonCode: "APPROVED_PRIMARY_VENUE_FIXTURE", sourceRole: "VENUE_OR_EVENT_WEBSITE", subjectEntityType: "VENUE" };
  }
  if (host === "forth-circuit.example.uk") {
    return { permitted: true, reasonCode: "APPROVED_PROMOTER_SHOWCASE_FIXTURE", sourceRole: "PROMOTER_OR_SHOWCASE_WEBSITE", subjectEntityType: "ORGANISATION" };
  }
  if (host === "nikos-lyras.example.uk") {
    return { permitted: false, reasonCode: "ANTI_SCRAPING_TOS_CLAUSE_I", sourceRole: "ARTIST_CONTROLLED_WEBSITE" };
  }
  return { permitted: false, reasonCode: "UNREGISTERED_SOURCE_BLOCKED" };
};

describe("UK Emerging Artist Phase 3A — Bounded 1-Hop Follow-Up Discovery & Promoter Tour Extraction (Synthetic)", () => {
  test("extractHtmlTourScheduleEvents extracts single-act and multi-stop tour schedules, embedded Spotify/YouTube media, UK towns, and strips FFO comparisons", () => {
    const singleStopShowcase = makeDoc(
      "https://forth-circuit.example.uk/cairn-echo/",
      `<!doctype html><html><head><meta property="og:site_name" content="Forth Circuit"></head><body>
        <article class="page type-page">
          <header class="entry-header"><h1>CAIRN ECHO</h1></header>
          <div class="entry-content">
            <p>One of the sharpest voices in Scottish rock working with UK songwriters.</p>
            <p>For fans of Bruce Springsteen, The Killers</p>
            <p><strong>27 NOVEMBER 2026 &#8211; EDINBURGH LEITH LOCKUP</strong></p>
            <div><a href="https://www.skiddle.com/e/9900001">BUY TICKETS</a></div>
            <figure><iframe title="Spotify Embed: CAIRN ECHO" src="https://open.spotify.com/embed/artist/2NbyIZAQVzXrRvginTgz33?utm_source=oembed"></iframe></figure>
          </div>
        </article>
        <aside class="widget widget_block widget_media_image">
          <figure><a href="https://forth-circuit.example.uk/millgate-tones/"><img src="https://forth-circuit.example.uk/img/millgate.png" alt=""/></a></figure>
        </aside>
        <aside class="widget widget_block widget_media_image">
          <figure><a href="https://forth-circuit.example.uk/applytoplay/"><img src="https://forth-circuit.example.uk/img/apply.png" alt=""/></a></figure>
        </aside>
      </body></html>`,
    );

    const multiStopShowcase = makeDoc(
      "https://forth-circuit.example.uk/millgate-tones/",
      `<!doctype html><html><head><meta property="og:site_name" content="Forth Circuit"></head><body>
        <article class="page type-page">
          <header class="entry-header"><h1>MILLGATE TONES</h1></header>
          <div class="entry-content">
            <p>Wigan’s newest buzz band make it a hat-trick of quality releases.</p>
            <p>For fans of The Libertines, The Lathums</p>
            <p><strong>19 NOVEMBER 2026 &#8211; BRISTOL HARBOUR EXCHANGE</strong></p>
            <div><a href="https://bristol-tickets.example.uk/whats-on/millgate-tones">BUY TICKETS</a></div>
            <p><strong>12 FEBRUARY 2027 &#8211; SHEFFIELD STEELWORKS ROOM</strong></p>
            <div><a href="https://www.skiddle.com/e/9900002">BUY TICKETS</a></div>
            <p><strong>13 FEBRUARY 2027 &#8211; LIVERPOOL MERSEY CELLAR</strong></p>
            <div><a href="https://www.skiddle.com/e/9900003">BUY TICKETS</a></div>
            <figure><iframe title="Night Shift - Official Video" src="https://www.youtube.com/embed/Atvs-yfolsE?feature=oembed"></iframe></figure>
          </div>
        </article>
      </body></html>`,
    );

    // 1. Sibling showcase widget links are discovered while /applytoplay/ utility slug is excluded
    const links = discoverUsefulSourceUrls(singleStopShowcase, ["EVENTS"]);
    assert.ok(links.includes("https://forth-circuit.example.uk/millgate-tones/"));
    assert.ok(!links.includes("https://forth-circuit.example.uk/applytoplay/"));

    // 2. Tour schedule extraction produces 4 dated occurrences across the two pages
    const extracted = extractEventsFromDocuments([singleStopShowcase, multiStopShowcase]);
    assert.equal(extracted.eventCandidates.length, 4);

    const cairnStop = extracted.eventCandidates.find((e) => e.sourcePageUrl === "https://forth-circuit.example.uk/cairn-echo/")!;
    assert.ok(cairnStop);
    assert.equal(cairnStop.startAt, "2026-11-27T00:00:00.000Z");
    assert.equal(cairnStop.timePrecision, "DATE_ONLY");
    assert.equal(cairnStop.venueText, "EDINBURGH LEITH LOCKUP");
    assert.equal(cairnStop.organiser, "Forth Circuit");
    assert.deepEqual(cairnStop.performers, ["CAIRN ECHO"]);
    assert.equal(cairnStop.artistObservations?.[0]?.spotifyArtistUri, "spotify:artist:2NbyIZAQVzXrRvginTgz33");

    const millgateStops = extracted.eventCandidates.filter((e) => e.sourcePageUrl === "https://forth-circuit.example.uk/millgate-tones/");
    assert.equal(millgateStops.length, 3);
    const millgateObs = millgateStops[0]!.artistObservations?.[0]!;
    assert.deepEqual(millgateObs.baseLocalities, ["Wigan"]);
    assert.equal(millgateObs.ukNation, "ENG");
    assert.equal(millgateObs.repertoireOriginality, "ORIGINAL");
    assert.equal(millgateObs.musicEvidence[0]?.releaseKind, "MUSIC_VIDEO");
  });

  test("runBoundedEmergingArtistDiscoveryLoop enforces 1-hop limit, <=20 HTML page budget, ToS rejection, ticket/streaming filtering, and cycle prevention", async () => {
    const hop0Index = makeDoc(
      "https://leith-lockup.example.uk/gigs/",
      `<main>
        <a href="https://leith-lockup.example.uk/2026/11/27/cairn-echo-2/">Cairn Echo</a>
        <a href="https://leith-lockup.example.uk/2026/11/29/nikos-lyras/">Nikos Lyras</a>
      </main>`,
    );
    const hop0Cairn = makeDoc(
      "https://leith-lockup.example.uk/2026/11/27/cairn-echo-2/",
      `<!doctype html><html><head><meta property="og:site_name" content="Leith Lockup"></head><body>
        <article class="post">
          <h2 class="entry-title">CAIRN ECHO</h2>
          <time>Friday 27th November 2026</time>
          <p>Rising guitar rock in Edinburgh.</p>
          <p><a href="https://open.spotify.com/artist/2NbyIZAQVzXrRvginTgz33">Spotify</a></p>
          <p><a class="tickets" href="https://forth-circuit.example.uk/cairn-echo/">Buy Tickets</a></p>
        </article>
      </body></html>`,
    );
    const hop0Nikos = makeDoc(
      "https://leith-lockup.example.uk/2026/11/29/nikos-lyras/",
      `<!doctype html><html><head><meta property="og:site_name" content="Leith Lockup"></head><body>
        <article class="post">
          <h2 class="entry-title">Nikos Lyras</h2>
          <time>Sunday 29th November 2026</time>
          <p>Touring songwriter live in Leith.</p>
          <p><a class="tickets" href="https://www.nikos-lyras.example.uk/product/uk-tour-edinburgh/">Buy Tickets</a></p>
        </article>
      </body></html>`,
    );

    const hop1Cairn = makeDoc(
      "https://forth-circuit.example.uk/cairn-echo/",
      `<!doctype html><html><head><meta property="og:site_name" content="Forth Circuit"></head><body>
        <article class="page type-page">
          <header class="entry-header"><h1>CAIRN ECHO</h1></header>
          <div class="entry-content">
            <p><strong>27 NOVEMBER 2026 &#8211; EDINBURGH LEITH LOCKUP</strong></p>
            <div><a href="https://leith-lockup.example.uk/2026/11/27/cairn-echo-2/">BUY TICKETS</a></div>
            <p><strong>12 FEBRUARY 2027 &#8211; SHEFFIELD STEELWORKS ROOM</strong></p>
            <div><a href="https://unregistered-venue.example.uk/shows/cairn-echo">BUY TICKETS</a></div>
          </div>
        </article>
      </body></html>`,
    );

    const offlineMap = new Map<string, FetchedDocument[]>([
      ["leith-lockup.example.uk", [hop0Index, hop0Cairn, hop0Nikos]],
      ["forth-circuit.example.uk", [hop1Cairn]],
    ]);

    const loopResult = await runBoundedEmergingArtistDiscoveryLoop({
      rootSeeds: [{ verifiedUrl: "https://leith-lockup.example.uk/gigs/", subjectEntityType: "VENUE" }],
      maxRootDomains: 2,
      maxTotalHtmlPages: 20,
      maxExpansionHops: 1,
      evaluateOriginPermission: SYNTHETIC_PERMISSION_EVALUATOR,
      offlineDocumentsByDomain: offlineMap,
    });

    assert.equal(loopResult.steps.length, 2, "Must execute Hop 0 + exactly 1 eligible Hop 1");
    assert.equal(loopResult.totals.expansionHopsExecuted, 1);
    assert.equal(loopResult.totals.totalHtmlPagesCaptured, 4);

    const byDomain = new Map(loopResult.candidateLedger.map((c) => [c.registrableDomain, c]));
    assert.equal(byDomain.get("spotify.com")?.disposition, "REJECTED_STREAMING_OR_SOCIAL_PLATFORM");
    assert.equal(byDomain.get("nikos-lyras.example.uk")?.disposition, "BLOCKED_BY_SOURCE_POLICY");
    assert.equal(byDomain.get("nikos-lyras.example.uk")?.reasonCode, "ANTI_SCRAPING_TOS_CLAUSE_I");
    assert.equal(byDomain.get("forth-circuit.example.uk")?.disposition, "ELIGIBLE_FOLLOW_UP");
    // Cycle prevention back to Hop-0 origin + hop-depth stop at Hop 1 -> Hop 2
    assert.equal(byDomain.get("leith-lockup.example.uk")?.disposition, "SKIPPED_SAME_OR_VISITED_ORIGIN");
    assert.equal(byDomain.get("unregistered-venue.example.uk")?.disposition, "HELD_HOP_DEPTH_LIMIT");

    // Hard ceiling rejections fail closed
    await assert.rejects(
      () => runBoundedEmergingArtistDiscoveryLoop({
        rootSeeds: [{ verifiedUrl: "https://leith-lockup.example.uk/gigs/" }],
        maxTotalHtmlPages: 21,
        evaluateOriginPermission: SYNTHETIC_PERMISSION_EVALUATOR,
        offlineDocumentsByDomain: offlineMap,
      }),
      (err: any) => err.code === "DISCOVERY_HTML_PAGE_BUDGET_EXCEEDED",
    );
    await assert.rejects(
      () => runBoundedEmergingArtistDiscoveryLoop({
        rootSeeds: [{ verifiedUrl: "https://leith-lockup.example.uk/gigs/" }],
        maxExpansionHops: 2,
        evaluateOriginPermission: SYNTHETIC_PERMISSION_EVALUATOR,
        offlineDocumentsByDomain: offlineMap,
      }),
      (err: any) => err.code === "DISCOVERY_HOP_BUDGET_EXCEEDED",
    );
  });
});
