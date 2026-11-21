import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { extractEventsFromDocuments } from "../src/nexus/source-discovery/extractors/events.ts";
import { discoverLikelyEventDetailUrls } from "../src/nexus/source-discovery/links.ts";
import { CONTRACTS, validateSourceDiscoveryResult } from "../src/nexus/contracts.ts";
import type { FetchedDocument } from "../src/nexus/source-discovery/types.ts";

function makeDoc(url: string, body: string, observedAt = "2026-11-20T18:45:00.000Z"): FetchedDocument {
  const bytes = Buffer.byteLength(body, "utf8");
  const sourceHash = createHash("sha256").update(body, "utf8").digest("hex");
  return {
    url,
    contentType: "text/html; charset=UTF-8",
    body,
    bytes,
    sourceHash,
    observedAt,
  };
}

describe("UK Emerging Artist HTML Extraction & Shared v2 Contract Compatibility (100% Synthetic First-Party Fixtures)", () => {
  test("discoverLikelyEventDetailUrls discovers dated permalinks from /gigs/ hub while ignoring dated blog links from non-event pages", () => {
    const gigsHub = makeDoc(
      "https://leith-lockup.example.uk/gigs/",
      `<main>
        <a href="https://leith-lockup.example.uk/2026/11/20/kestrel-ward-solway-drift/">Kestrel Ward + Solway Drift</a>
        <a href="https://leith-lockup.example.uk/2026/11/21/the-harbour-session/">The Harbour Session</a>
        <a href="https://leith-lockup.example.uk/about/">About Venue</a>
      </main>`,
    );
    const blogHub = makeDoc(
      "https://leith-lockup.example.uk/news/",
      `<main>
        <a href="https://leith-lockup.example.uk/2026/11/20/new-sound-system-installed/">New Sound System Installed</a>
      </main>`,
    );

    assert.deepEqual(discoverLikelyEventDetailUrls(gigsHub), [
      "https://leith-lockup.example.uk/2026/11/20/kestrel-ward-solway-drift/",
      "https://leith-lockup.example.uk/2026/11/21/the-harbour-session/",
    ]);
    assert.deepEqual(discoverLikelyEventDetailUrls(blogHub), []);
  });

  test("extractEventsFromDocuments handles dated permalinks, hCalendar pairing, shortlinks, unknown vs explicit billing, sentence-scoped artist claims, and order invariance", () => {
    const indexDoc = makeDoc(
      "https://leith-lockup.example.uk/gigs/",
      `<!doctype html><html><head><meta property="og:site_name" content="Leith Lockup"></head><body>
        <div id="hcalendar-event-90001" class="vevent">
          <abbr class="dtstart" title="2026-11-20T19:00:00">Fri 20 Nov</abbr>
          <h3 class="summary"><a href="https://leith-lockup.example.uk/2026/11/20/kestrel-ward-solway-drift/">Kestrel Ward</a></h3>
        </div>
        <div id="hcalendar-event-90002" class="vevent">
          <abbr class="dtstart" title="2026-11-21T19:00:00">Sat 21 Nov</abbr>
          <h3 class="summary"><a href="https://leith-lockup.example.uk/2026/11/21/the-harbour-session/">The Harbour Session</a></h3>
        </div>
        <div id="hcalendar-event-90006" class="vevent">
          <abbr class="dtstart" title="2026-11-25T19:00:00">Wed 25 Nov</abbr>
          <h3 class="summary"><a href="https://leith-lockup.example.uk/2026/11/25/canal-circuit-heather-lock/">Canal Circuit</a></h3>
        </div>
      </body></html>`,
    );

    const detailExplicit = makeDoc(
      "https://leith-lockup.example.uk/2026/11/20/kestrel-ward-solway-drift/",
      `<!doctype html><html><head>
        <meta property="og:site_name" content="Leith Lockup">
        <meta property="og:url" content="https://leith-lockup.example.uk/?p=90001">
      </head><body>
        <header><h1>Leith Lockup</h1></header>
        <article class="post">
          <h2 class="entry-title">Kestrel Ward<br>Solway Drift<br>For fans of Sonic Youth, PJ Harvey</h2>
          <time>Friday 20th November 2026</time>
          <p>Leith Lockup Presents</p>
          <p>Kestrel Ward are an indie four-piece hailing from Aberdeen. With the release of their debut EP imminent, the band headline tonight.</p>
          <p>Support comes from Glasgow outfit Solway Drift.</p>
          <p>For fans of: Sonic Youth, PJ Harvey.</p>
          <p><a class="tickets" href="https://www.seetickets.com/event/kestrel-ward/990001">Buy Tickets</a></p>
        </article>
      </body></html>`,
    );

    const detailUnrankedShowcase = makeDoc(
      "https://leith-lockup.example.uk/2026/11/21/the-harbour-session/",
      `<!doctype html><html><head>
        <meta property="og:site_name" content="Leith Lockup">
        <meta property="og:url" content="https://leith-lockup.example.uk/2026/11/21/the-harbour-session/">
      </head><body>
        <header><h1>Leith Lockup</h1></header>
        <article class="post">
          <h2 class="entry-title">The Harbour Session<br>Mairi Linn<br>Calum Reid<br>Sorcha Bell<br>Ewan Kerr</h2>
          <time>Saturday 21st November 2026</time>
          <p>The Harbour Session is a new showcase series spotlighting emerging songwriters.</p>
          <p>Doors 7pm curfew 10pm. 18+.</p>
          <p>Mairi Linn is a songwriter based between Edinburgh and Glasgow.</p>
          <p><a class="tickets" href="https://www.citizenticket.co.uk/events/leith-lockup/harbour-session/">Tickets</a></p>
        </article>
      </body></html>`,
    );

    const detailPromoterAndLinks = makeDoc(
      "https://leith-lockup.example.uk/2026/11/25/canal-circuit-heather-lock/",
      `<!doctype html><html><head>
        <meta property="og:site_name" content="Leith Lockup">
      </head><body>
        <header><h1>Leith Lockup</h1></header>
        <article class="post">
          <h2 class="entry-title">Postponed: Canal Circuit<br>Heather Lock</h2>
          <time>Wednesday 25th November 2026</time>
          <p>Northbridge Live Presents</p>
          <p>Dutch trio Canal Circuit bring synth grooves alongside Fife six-piece Heather Lock.</p>
          <p><a href="https://open.spotify.com/artist/1111111111111111111111">Spotify</a></p>
          <p><a href="https://open.spotify.com/user/leithlockup/playlist/0000000000000000000000">Venue Playlist</a></p>
          <p><a class="tickets" href="https://www.seetickets.com/event/canal-circuit/990006">Buy Tickets</a></p>
        </article>
      </body></html>`,
    );

    const forward = extractEventsFromDocuments([indexDoc, detailExplicit, detailUnrankedShowcase, detailPromoterAndLinks]);
    const reversed = extractEventsFromDocuments([detailPromoterAndLinks, detailUnrankedShowcase, detailExplicit, indexDoc]);

    assert.equal(forward.eventCandidates.length, 3);
    assert.equal(reversed.eventCandidates.length, 3);

    // Order-invariant fingerprint & candidate parity
    const byUrlForward = new Map(forward.eventCandidates.map((e) => [e.sourceEventUrl, e]));
    const byUrlReversed = new Map(reversed.eventCandidates.map((e) => [e.sourceEventUrl, e]));
    for (const [u, ev] of byUrlForward) {
      assert.equal(ev.sourceFingerprint, byUrlReversed.get(u)?.sourceFingerprint);
    }

    // 1. Explicit headline/support bill + root ?p= shortlink ignored + self-venue presenter ignored + no support leakage
    const ev1 = byUrlForward.get("https://leith-lockup.example.uk/2026/11/20/kestrel-ward-solway-drift/")!;
    assert.ok(ev1);
    assert.equal(ev1.sourceExternalId, "hcalendar-event-90001");
    assert.equal(ev1.startAt, "2026-11-20T19:00:00.000Z");
    assert.equal(ev1.organiser, null, "Venue self-presenter 'Leith Lockup Presents' must not become external organiser");
    assert.deepEqual(ev1.performers, ["Kestrel Ward", "Solway Drift"]);
    assert.deepEqual(ev1.performerBillings, [
      { billedName: "Kestrel Ward", listedPosition: 1, role: "HEADLINE", billingRank: 1, billingOrderBasis: "EXPLICIT" },
      { billedName: "Solway Drift", listedPosition: 2, role: "SUPPORT", billingRank: 2, billingOrderBasis: "EXPLICIT" },
    ]);
    const kestrelObs = ev1.artistObservations?.find((o) => o.billedName === "Kestrel Ward")!;
    const solwayObs = ev1.artistObservations?.find((o) => o.billedName === "Solway Drift")!;
    assert.deepEqual(kestrelObs.baseLocalities, ["Aberdeen"]);
    assert.equal(kestrelObs.ukNation, "SCT");
    assert.equal(kestrelObs.repertoireOriginality, "ORIGINAL");
    assert.equal(kestrelObs.emergingSignals[0]?.signalType, "DEBUT_RELEASE_IMMINENT");
    assert.deepEqual(solwayObs.baseLocalities, ["Glasgow"]);
    assert.equal(solwayObs.repertoireOriginality, "UNKNOWN", "Support act must not inherit headliner debut EP claim");

    // 2. Unranked 4-act showcase preserves billingRank: null + LIST_ORDER_ONLY + seriesTitle + DOORS_OPEN curfew
    const ev2 = byUrlForward.get("https://leith-lockup.example.uk/2026/11/21/the-harbour-session/")!;
    assert.ok(ev2);
    assert.equal(ev2.seriesTitle, "The Harbour Session");
    assert.equal(ev2.startAt, "2026-11-21T19:00:00.000Z");
    assert.equal(ev2.endAt, "2026-11-21T22:00:00.000Z");
    assert.equal(ev2.timePrecision, "EXPLICIT_INSTANT");
    assert.equal(ev2.timeMeaning, "DOORS_OPEN");
    assert.equal(ev2.ageRestriction, "18+");
    assert.deepEqual(
      ev2.performerBillings?.map((b) => [b.billedName, b.role, b.billingRank, b.billingOrderBasis]),
      [
        ["Mairi Linn", "PERFORMER", null, "LIST_ORDER_ONLY"],
        ["Calum Reid", "PERFORMER", null, "LIST_ORDER_ONLY"],
        ["Sorcha Bell", "PERFORMER", null, "LIST_ORDER_ONLY"],
        ["Ewan Kerr", "PERFORMER", null, "LIST_ORDER_ONLY"],
      ],
    );
    const mairiObs = ev2.artistObservations?.find((o) => o.billedName === "Mairi Linn")!;
    assert.deepEqual(mairiObs.baseLocalities, ["Edinburgh", "Glasgow"]);

    // 3. External presenter + POSTPONED status + Dutch origin vs Scottish Fife base + Spotify link filtering on multi-act bill
    const ev3 = byUrlForward.get("https://leith-lockup.example.uk/2026/11/25/canal-circuit-heather-lock/")!;
    assert.ok(ev3);
    assert.equal(ev3.eventStatus, "POSTPONED");
    assert.equal(ev3.organiser, "Northbridge Live");
    assert.deepEqual(ev3.outboundArtistUrls, ["https://open.spotify.com/artist/1111111111111111111111"]);
    const canalObs = ev3.artistObservations?.find((o) => o.billedName === "Canal Circuit")!;
    const heatherObs = ev3.artistObservations?.find((o) => o.billedName === "Heather Lock")!;
    assert.equal(canalObs.originCountryCode, "NL");
    assert.equal(canalObs.spotifyArtistUri, null, "Multi-act Spotify link must not auto-attach to a single performer without disambiguation");
    assert.deepEqual(heatherObs.baseLocalities, ["Fife"]);
  });

  test("Shared contract compatibility: existing <article><h1> callers and legacy v1/v2 payloads preserve exact shape while malformed nested fields fail closed", () => {
    // 1. Existing <article><h1> page keeps exact h1 title and description: null when unstructured
    const legacyDoc = makeDoc(
      "https://venue-example.co.uk/events/autumn-jazz",
      `<article data-event-id="evt-42">
        <h1>Autumn Jazz Quartet</h1>
        <time datetime="2026-11-25T20:00:00Z"></time>
        <p>Unstructured note outside itemprop description</p>
        <a href="https://www.seetickets.com/event/autumn-jazz/42">Tickets</a>
      </article>`,
    );
    const legacyExtracted = extractEventsFromDocuments([legacyDoc]);
    assert.equal(legacyExtracted.eventCandidates.length, 1);
    assert.equal(legacyExtracted.eventCandidates[0]?.title, "Autumn Jazz Quartet");
    assert.equal(legacyExtracted.eventCandidates[0]?.description, null);
    assert.equal("seriesTitle" in legacyExtracted.eventCandidates[0]!, false);

    // 2. Minimal legacy caller payload (without any new emerging-artist fields) validates cleanly with zero added optional keys
    const baseCandidate = {
      title: "Autumn Jazz Quartet",
      sourceEventUrl: "https://venue-example.co.uk/events/autumn-jazz",
      sourcePageUrl: "https://venue-example.co.uk/events/autumn-jazz",
      venueText: "Example Hall",
      startAt: "2026-11-25T20:00:00.000Z",
      endAt: null,
      timezone: "Europe/London",
      eventStatus: null,
      description: null,
      organiser: null,
      performers: ["Autumn Jazz Quartet"],
      sourceCategory: null,
      ticketUrl: "https://www.seetickets.com/event/autumn-jazz/42",
      ticketDomain: "www.seetickets.com",
      priceText: null,
      ageRestriction: null,
      eventImageUrl: null,
      sourceFingerprint: "a".repeat(64),
      observedAt: "2026-11-20T18:45:00.000Z",
      state: "DISCOVERED",
      confidence: 0.9,
    };

    const baseEnvelope = {
      contractVersion: CONTRACTS.SOURCE_DISCOVERY_RESULT,
      discoveryRequestId: "70100000-0000-4000-8000-000000000100",
      idempotencyKey: "70100000-0000-4000-8000-000000000101",
      subjectReference: {
        canonicalEntityId: "70100000-0000-4000-8000-000000000001",
        candidateReference: null,
        entityType: "VENUE",
      },
      source: {
        verifiedUrl: "https://venue-example.co.uk/events",
        finalUrl: "https://venue-example.co.uk/events",
        observedAt: "2026-11-20T18:45:00.000Z",
        sourceHash: "b".repeat(64),
      },
      crawl: {
        status: "COMPLETED",
        warnings: [],
        requestCount: 1,
        pageCount: 1,
        bytesRead: 512,
        redirects: 0,
        blockedCount: 0,
        retryable: false,
        evidenceManifest: {
          version: 1,
          attemptedRequests: 1,
          requestsOmitted: 0,
          unrecordedRequests: 0,
          requests: [{ url: "https://venue-example.co.uk/events", status: 200, contentType: "text/html", bytes: 512, responseHash: "b".repeat(64) }],
          pages: [{ url: "https://venue-example.co.uk/events", sourceHash: "b".repeat(64), contentType: "text/html", bytes: 512, kind: "HTML", publisherType: "VERIFIED_FIRST_PARTY", subjectAssignment: "TARGET", evidenceRefs: [] }],
        },
      },
      identityFacts: [],
      publicContacts: [],
      venueFacts: [],
      imageCandidates: [],
      eventCandidates: [baseCandidate],
      evidenceRefs: [],
    };

    const validatedLegacy = validateSourceDiscoveryResult(baseEnvelope);
    const validatedEv = validatedLegacy.eventCandidates[0]!;
    for (const optionalKey of ["timePrecision", "timeMeaning", "seriesTitle", "performerBillings", "outboundArtistUrls", "artistObservations"]) {
      assert.equal(optionalKey in validatedEv, false, `Legacy eventCandidate must omit ${optionalKey}`);
    }

    // 3. Fail-closed validation of malformed nested performerBillings and artistObservations
    assert.throws(
      () => validateSourceDiscoveryResult({
        ...baseEnvelope,
        eventCandidates: [{
          ...baseCandidate,
          performerBillings: [{ billedName: "Act", listedPosition: 1, role: "PERFORMER", billingRank: 0, billingOrderBasis: "LIST_ORDER_ONLY" }],
        }],
      }),
      (err: any) => err.code === "INVALID_EVENT_PERFORMER_BILLING_RANK",
    );

    assert.throws(
      () => validateSourceDiscoveryResult({
        ...baseEnvelope,
        eventCandidates: [{
          ...baseCandidate,
          performerBillings: [{ billedName: "Act", listedPosition: 1, role: "PERFORMER", billingRank: null, billingOrderBasis: "LIST_ORDER_ONLY", extraKey: true }],
        }],
      }),
      (err: any) => err.code === "INVALID_EVENT_PERFORMER_BILLING_FIELDS",
    );

    assert.throws(
      () => validateSourceDiscoveryResult({
        ...baseEnvelope,
        eventCandidates: [{
          ...baseCandidate,
          artistObservations: [{
            billedName: "Act",
            baseLocalities: ["Edinburgh"],
            baseCountryCode: "GB",
            ukNation: "SCT",
            originText: null,
            originCountryCode: null,
            repertoireOriginality: "ORIGINAL",
            emergingSignals: [],
            musicEvidence: [],
            spotifyArtistUri: "spotify:user:not-an-artist",
            excerpt: "short excerpt",
          }],
        }],
      }),
      (err: any) => err.code === "INVALID_EVENT_SPOTIFY_ARTIST_URI",
    );

    assert.throws(
      () => validateSourceDiscoveryResult({
        ...baseEnvelope,
        eventCandidates: [{
          ...baseCandidate,
          artistObservations: [{
            billedName: "Act",
            baseLocalities: [],
            baseCountryCode: null,
            ukNation: null,
            originText: null,
            originCountryCode: null,
            repertoireOriginality: "UNKNOWN",
            emergingSignals: [],
            musicEvidence: [],
            spotifyArtistUri: null,
            excerpt: "x".repeat(281),
          }],
        }],
      }),
      (err: any) => err.code === "INVALID_EVENT_ARTIST_EXCERPT",
    );
  });
});
