import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crawlVenueOfficialSite } from "../src/nexus/source-discovery/venue/crawl.ts";
import { closeSharedBrowser, createPlaywrightRenderAdapter } from "../src/nexus/source-discovery/render-playwright.ts";
import type { VenueEvidencePackage } from "../src/nexus/source-discovery/venue/evidence.ts";
import {
  authorisedHost,
  canReuseCrawl,
  classifyWaveOutcome,
  completedListingIds,
  crawlUrlKey,
  documentStaysOnAuthorisedSite,
  evidenceIsUseful,
  forbidPaidProvider,
  keepImageCandidate,
  summarizeWave,
  VenueCrawlScheduler,
  type WaveOutcome,
  type WaveResultRow,
  type WaveVenueInput,
} from "./venue-crawler-wave1-lib.ts";

const CONCURRENCY = 6;
const resultsPath = new URL("../docs/quality/2026-10-15-venue-crawler-recovery-results.jsonl", import.meta.url);
const summaryPath = new URL("../docs/quality/2026-10-15-venue-crawler-recovery-summary.json", import.meta.url);
const manifestPath = resolve(process.cwd(), "../Event-project/scripts/ops/manifest-next-crawl-programme.json");

function guardedFetch(): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    forbidPaidProvider(url);
    return fetch(input, init);
  };
}

function textFact(value: unknown): string | null {
  if (typeof value === "string") {
    const text = value.replace(/\s+/g, " ").trim();
    return text ? text.slice(0, 800) : null;
  }
  return null;
}

function projectEvidence(evidence: VenueEvidencePackage | null) {
  const images = evidence
    ? Object.values(evidence.imagesByRole).flat().filter(keepImageCandidate).slice(0, 12).map((image) => ({
      sourceImageUrl: image.sourceImageUrl,
      sourcePageUrl: image.sourcePageUrl,
      likelyRole: image.likelyRole,
      rightsState: image.rightsState,
      alt: image.alt,
    }))
    : [];
  return {
    descriptionEvidence: (evidence?.descriptionEvidence ?? []).slice(0, 8).map((item) => ({
      kind: item.kind,
      text: item.text.replace(/\s+/g, " ").trim().slice(0, 800),
      sourceUrl: item.sourceUrl,
    })),
    contacts: (evidence?.contacts ?? []).slice(0, 8).map((item) => ({
      type: item.type,
      value: item.value,
      purpose: item.purpose,
      sourceUrl: item.sourceUrl,
      routingAuthority: "not_operator_confirmed" as const,
    })),
    spaces: (evidence?.spaces ?? []).map((item) => ({ name: item.name, sourceUrl: item.sourceUrl })),
    reviewSpaces: (evidence?.reviewSpaces ?? []).map((item) => ({ name: item.name, sourceUrl: item.sourceUrl })),
    capacities: (evidence?.capacities ?? []).map((item) => ({
      space: item.space,
      layout: item.layout,
      count: item.count,
      statement: item.statement,
      sourceUrl: item.sourceUrl,
      reviewRequired: item.reviewRequired,
    })),
    practicalFacts: (evidence?.practicalFacts ?? []).flatMap((item) => {
      const value = textFact(item.value);
      return value ? [{ fieldName: item.fieldName, value, sourceUrl: item.sourceUrl }] : [];
    }),
    suitability: (evidence?.suitability ?? []).flatMap((item) => {
      const value = textFact(item.value);
      return value ? [{ value, sourceUrl: item.sourceUrl }] : [];
    }),
    images,
    routingAuthority: "not_operator_confirmed" as const,
  };
}

function rowFromCrawl(venue: WaveVenueInput, started: number, reusedSharedCrawl: boolean, crawlResult: Awaited<ReturnType<typeof crawlVenueOfficialSite>>): WaveResultRow {
  const crawl = crawlResult.crawl;
  const documents = crawl?.documents ?? [];
  const html = documents.filter((item) => item.kind !== "PDF");
  const pdfs = documents.filter((item) => item.kind === "PDF");
  const offsite = documents.find((item) => !documentStaysOnAuthorisedSite(venue.authorisedOfficialUrl, item.url));
  if (offsite) {
    throw new Error(`OFFSITE_DOCUMENT:${venue.listingId}:${offsite.url}`);
  }
  if (!crawlResult.sameSite && crawlResult.evidence) {
    throw new Error(`CROSS_SITE_EVIDENCE_LEAK:${venue.listingId}`);
  }
  const useful = evidenceIsUseful(crawlResult.evidence);
  const outcome = classifyWaveOutcome({
    refusal: crawlResult.refusal,
    sameSite: crawlResult.sameSite,
    status: crawl?.stats.status ?? null,
    failureClass: crawl?.stats.failureClass ?? null,
    stopReason: crawl?.observability?.stopReason ?? crawlResult.refusal,
    warnings: crawl?.stats.warnings ?? [],
    htmlPages: html.length,
    pdfDocuments: pdfs.length,
    renderNeeded: crawl?.observability?.renderNeededButUnavailable.length ?? 0,
    useful,
  });
  return {
    listingId: venue.listingId,
    venueName: venue.venueName,
    authorisedOfficialUrl: venue.authorisedOfficialUrl,
    authorityProvenance: venue.authorityProvenance,
    country: venue.country,
    countryCode: venue.countryCode,
    publicationState: venue.publicationState,
    outcome,
    outcomeReason: crawlResult.refusal ?? crawl?.observability?.stopReason ?? crawl?.stats.status ?? "completed",
    reusedSharedCrawl,
    crawlUrl: crawlResult.authority.crawlUrl,
    finalUrl: crawl?.finalUrl ?? null,
    sameSite: crawlResult.sameSite,
    pages: html.length,
    requests: reusedSharedCrawl ? 0 : crawl?.stats.requestCount ?? 0,
    bytes: reusedSharedCrawl ? 0 : crawl?.stats.bytesRead ?? 0,
    pdfCount: pdfs.length,
    pdfs: pdfs.map((item) => ({ url: item.url })),
    pageUrls: html.map((item) => item.url),
    ...projectEvidence(crawlResult.evidence),
    stopReason: crawl?.observability?.stopReason ?? null,
    warnings: (crawl?.stats.warnings ?? []).slice(0, 12),
    elapsedMs: Date.now() - started,
  };
}

function failureRow(venue: WaveVenueInput, started: number, outcome: WaveOutcome, reason: string): WaveResultRow {
  return {
    listingId: venue.listingId,
    venueName: venue.venueName,
    authorisedOfficialUrl: venue.authorisedOfficialUrl,
    authorityProvenance: venue.authorityProvenance,
    country: venue.country,
    countryCode: venue.countryCode,
    publicationState: venue.publicationState,
    outcome,
    outcomeReason: reason.slice(0, 300),
    reusedSharedCrawl: false,
    crawlUrl: null,
    finalUrl: null,
    sameSite: false,
    pages: 0,
    requests: 0,
    bytes: 0,
    pdfCount: 0,
    pdfs: [],
    pageUrls: [],
    descriptionEvidence: [],
    contacts: [],
    spaces: [],
    reviewSpaces: [],
    capacities: [],
    practicalFacts: [],
    suitability: [],
    images: [],
    routingAuthority: "not_operator_confirmed",
    stopReason: null,
    warnings: [],
    elapsedMs: Date.now() - started,
  };
}

async function main() {
  console.log("=== STARTING RESOURCES V2 VENUE INTERNAL CRAWL RECOVERY ===");

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const q1 = manifest.queues.websiteKnownNeverCrawled || [];
  const q2 = manifest.queues.technicalFailuresRetry || [];
  const q3 = manifest.queues.thinCrawlsExpand || [];

  console.log(`Input queues from manifest:`);
  console.log(`- Never crawled:       ${q1.length}`);
  console.log(`- Technical failures:  ${q2.length}`);
  console.log(`- Thin crawls:         ${q3.length}`);
  console.log(`- Total cohort:        ${q1.length + q2.length + q3.length}`);

  // Separate crawlable venues with verified official websites from social-only entries
  const eligibleVenues: WaveVenueInput[] = [];
  const excludedVenues: Array<{ listingId: string; venueName: string; reason: string }> = [];

  for (const item of [...q1, ...q2, ...q3]) {
    if (!item.website || item.website.trim() === "") {
      excludedVenues.push({
        listingId: item.listingId,
        venueName: item.venueName,
        reason: "NO_STANDALONE_WEBSITE_SOCIAL_OR_UNRESOLVED",
      });
      continue;
    }

    eligibleVenues.push({
      listingId: item.listingId,
      venueName: item.venueName,
      authorisedOfficialUrl: item.website,
      authorityProvenance: item.placeId ? `google_place:${item.placeId}` : "resources_v2_manifest",
      country: item.country || "South Africa",
      countryCode: "ZA",
      publicationState: "in_review",
      contentState: "draft",
    });
  }

  console.log(`\nFiltered cohort:`);
  console.log(`- Eligible crawl targets (standalone website): ${eligibleVenues.length}`);
  console.log(`- Excluded targets (social-only / unresolved):  ${excludedVenues.length}`);

  // Initialize results file
  mkdirSync(dirname(fileURLToPath(resultsPath)), { recursive: true });

  let existing = "";
  try {
    existing = readFileSync(resultsPath, "utf8");
  } catch {
    existing = "";
  }
  const done = completedListingIds(existing);
  const pending = eligibleVenues.filter((venue) => !done.has(venue.listingId));
  const rows: WaveResultRow[] = existing.split(/\n/).flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line) as WaveResultRow];
    } catch {
      return [];
    }
  });

  console.log(`Already completed: ${done.size}, Pending to crawl: ${pending.length}`);

  const renderAdapter = createPlaywrightRenderAdapter();
  const scheduler = new VenueCrawlScheduler(CONCURRENCY);
  const reuse = new Map<string, WaveResultRow>();
  let writeChain = Promise.resolve();

  function remember(row: WaveResultRow) {
    rows.push(row);
    writeChain = writeChain.then(() => {
      appendFileSync(resultsPath, `${JSON.stringify(row)}\n`);
    });
    if (rows.length % 25 === 0) {
      const summary = summarizeWave({
        queueCount: eligibleVenues.length,
        eligible: eligibleVenues.length,
        excluded: excludedVenues.length,
        rows,
      });
      writeFileSync(summaryPath, JSON.stringify({ ...summary, updatedAt: new Date().toISOString() }, null, 2));
      console.log(`Progress: ${rows.length}/${eligibleVenues.length} | useful=${summary.outcomes.CRAWL_SUCCESS_USEFUL} thin=${summary.outcomes.CRAWL_SUCCESS_THIN} blocked=${summary.outcomes.ROBOTS_BLOCKED} dead=${summary.outcomes.DEAD_OR_UNREACHABLE} transient=${summary.outcomes.TRANSIENT_NETWORK}`);
    }
  }

  try {
    await Promise.all(pending.map(async (venue) => {
      const host = authorisedHost(venue.authorisedOfficialUrl) ?? venue.listingId;
      const release = await scheduler.acquire(host);
      try {
        const started = Date.now();
        const key = crawlUrlKey(venue.authorisedOfficialUrl);
        const shared = key ? reuse.get(key) : undefined;
        if (shared && canReuseCrawl(shared.authorisedOfficialUrl, venue.authorisedOfficialUrl)) {
          remember({
            ...shared,
            listingId: venue.listingId,
            venueName: venue.venueName,
            authorisedOfficialUrl: venue.authorisedOfficialUrl,
            authorityProvenance: venue.authorityProvenance,
            country: venue.country,
            countryCode: venue.countryCode,
            publicationState: venue.publicationState,
            reusedSharedCrawl: true,
            requests: 0,
            bytes: 0,
            elapsedMs: Date.now() - started,
          });
          return;
        }

        try {
          const result = await crawlVenueOfficialSite({
            authorisedUrl: venue.authorisedOfficialUrl,
            venueName: venue.venueName,
            fetchImpl: guardedFetch(),
            renderAdapter,
          });

          const row = rowFromCrawl(venue, started, false, result);
          if (key && (row.outcome === "CRAWL_SUCCESS_USEFUL" || row.outcome === "CRAWL_SUCCESS_THIN" || row.outcome === "ROBOTS_BLOCKED" || row.outcome === "STATIC_RENDER_REQUIRED" || row.outcome === "CROSS_SITE_REFUSED")) {
            reuse.set(key, row);
          }
          remember(row);
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown";
          const outcome: WaveOutcome = /timeout|ECONNRESET|ETIMEDOUT|socket hang up|429|503|502/i.test(message) ? "TRANSIENT_NETWORK" : "OTHER_SAFE_FAILURE";
          remember(failureRow(venue, started, outcome, message));
        }
      } finally {
        release();
      }
    }));
  } finally {
    await closeSharedBrowser();
  }

  await writeChain;

  const finalSummary = {
    ...summarizeWave({
      queueCount: eligibleVenues.length + excludedVenues.length,
      eligible: eligibleVenues.length,
      excluded: excludedVenues.length,
      rows,
    }),
    excludedItems: excludedVenues,
    finishedAt: new Date().toISOString(),
  };

  writeFileSync(summaryPath, JSON.stringify(finalSummary, null, 2));

  // Copy summary to Event-project ops directory
  const destSummaryPath = resolve(process.cwd(), "../Event-project/scripts/ops/recovery-crawl-results-summary.json");
  writeFileSync(destSummaryPath, JSON.stringify(finalSummary, null, 2));

  console.log("\n=== RECOVERY CRAWL COMPLETED ===");
  console.log(`Total listings processed: ${rows.length}`);
  console.log(`Useful crawls:            ${finalSummary.outcomes.CRAWL_SUCCESS_USEFUL}`);
  console.log(`Thin crawls:              ${finalSummary.outcomes.CRAWL_SUCCESS_THIN}`);
  console.log(`Robots blocked:           ${finalSummary.outcomes.ROBOTS_BLOCKED}`);
  console.log(`Dead / unreachable:       ${finalSummary.outcomes.DEAD_OR_UNREACHABLE}`);
  console.log(`Transient network:        ${finalSummary.outcomes.TRANSIENT_NETWORK}`);
  console.log(`SPA static render:        ${finalSummary.outcomes.STATIC_RENDER_REQUIRED}`);
  console.log(`Total emails discovered:  ${rows.reduce((acc, r) => acc + (r.contacts?.filter((c) => c.type === "email").length ?? 0), 0)}`);
  console.log(`Summary written to: ${summaryPath.pathname} and ${destSummaryPath}`);
}

main().catch((err) => {
  console.error("Recovery crawl failed:", err);
  process.exit(1);
});
