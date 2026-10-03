/**
 * Current-generation Venue Crawler backfill for official sites Wave 1 did not crawl.
 *
 * Uses only crawlVenueOfficialSite. No Google, search, Apollo, Companies House,
 * or rendering vendor. No EventSuite writes. No raw HTML in the result file.
 *
 * Run:
 * `node --use-system-ca --experimental-strip-types scripts/venue-crawler-backfill.ts`
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { crawlVenueOfficialSite } from "../src/nexus/source-discovery/venue/crawl.ts";
import type { VenueEvidencePackage } from "../src/nexus/source-discovery/venue/evidence.ts";
import {
  authorisedHost,
  backfillSystemicDefect,
  canReuseCrawl,
  classifyWaveOutcome,
  completedListingIds,
  crawlUrlKey,
  descriptionRecallSuspect,
  documentStaysOnAuthorisedSite,
  evidenceIsUseful,
  forbidPaidProvider,
  imageRecallSuspect,
  keepImageCandidate,
  summarizeWave,
  VenueCrawlScheduler,
  type WaveOutcome,
  type WaveResultRow,
  type WaveVenueInput,
} from "./venue-crawler-wave1-lib.ts";

type InputFile = {
  kind: "venue-crawler-backfill-input";
  eventProjectSha: string;
  queueChecksum: string;
  queueCount: number;
  excluded: Array<{ listingId: string; reason: string }>;
  venues: WaveVenueInput[];
};

const inputPath = new URL("../docs/quality/2026-10-03-venue-crawler-backfill-input.json", import.meta.url);
const resultsPath = new URL("../docs/quality/2026-10-03-venue-crawler-backfill-results.jsonl", import.meta.url);
const summaryPath = new URL("../docs/quality/2026-10-03-venue-crawler-backfill-summary.json", import.meta.url);
const CONCURRENCY = 5;

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
  const projected = projectEvidence(crawlResult.evidence);
  const htmlBodies = html.map((item) => item.body);
  const pageUrls = html.map((item) => item.url);
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
    pageUrls,
    ...projected,
    imageRecallSuspect: imageRecallSuspect({ htmlBodies, imageCount: projected.images.length }),
    descriptionRecallSuspect: descriptionRecallSuspect({
      pageUrls,
      htmlBodies,
      descriptionTexts: projected.descriptionEvidence.map((item) => item.text),
    }),
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
    imageRecallSuspect: false,
    descriptionRecallSuspect: false,
  };
}

const input = JSON.parse(readFileSync(inputPath, "utf8")) as InputFile;
if (input.kind !== "venue-crawler-backfill-input") throw new Error("INPUT_KIND");
if (input.venues.length + input.excluded.length !== input.queueCount) throw new Error("INPUT_COUNT");

let existing = "";
try {
  existing = readFileSync(resultsPath, "utf8");
} catch {
  existing = "";
}
const done = completedListingIds(existing);
const pending = input.venues.filter((venue) => !done.has(venue.listingId));
const rows: WaveResultRow[] = existing.split(/\n/).flatMap((line) => {
  if (!line.trim()) return [];
  try {
    return [JSON.parse(line) as WaveResultRow];
  } catch {
    return [];
  }
});

mkdirSync(dirname(fileURLToPath(resultsPath)), { recursive: true });
const scheduler = new VenueCrawlScheduler(CONCURRENCY);
const reuse = new Map<string, WaveResultRow>();
let writeChain = Promise.resolve();
let stopped: string | null = backfillSystemicDefect(rows);

function remember(row: WaveResultRow) {
  rows.push(row);
  writeChain = writeChain.then(() => {
    appendFileSync(resultsPath, `${JSON.stringify(row)}\n`);
  });
  if (!stopped) stopped = backfillSystemicDefect(rows);
  if (rows.length % 25 === 0 || stopped) {
    const summary = summarizeWave({ queueCount: input.queueCount, eligible: input.venues.length, excluded: input.excluded.length, rows });
    writeFileSync(summaryPath, JSON.stringify({ ...summary, stopped, updatedAt: new Date().toISOString() }, null, 2));
    process.stderr.write(`progress attempts=${summary.attempts} useful=${summary.outcomes.CRAWL_SUCCESS_USEFUL} thin=${summary.outcomes.CRAWL_SUCCESS_THIN}\n`);
  }
}

process.stderr.write(`wave eligible=${input.venues.length} already=${done.size} pending=${pending.length} excluded=${input.excluded.length}\n`);

await Promise.all(pending.map(async (venue) => {
  if (stopped) return;
  const host = authorisedHost(venue.authorisedOfficialUrl) ?? venue.listingId;
  const release = await scheduler.acquire(host);
  try {
    if (stopped) return;
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
      });
      const row = rowFromCrawl(venue, started, false, result);
      if (key && (row.outcome === "CRAWL_SUCCESS_USEFUL" || row.outcome === "CRAWL_SUCCESS_THIN" || row.outcome === "ROBOTS_BLOCKED" || row.outcome === "STATIC_RENDER_REQUIRED" || row.outcome === "CROSS_SITE_REFUSED")) {
        reuse.set(key, row);
      }
      remember(row);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      if (message.startsWith("OFFSITE_DOCUMENT") || message.startsWith("CROSS_SITE_EVIDENCE_LEAK") || message.endsWith("_CALL_FORBIDDEN")) {
        stopped = message;
      }
      const outcome: WaveOutcome = /timeout|ECONNRESET|ETIMEDOUT|socket hang up|429|503|502/i.test(message) ? "TRANSIENT_NETWORK" : "OTHER_SAFE_FAILURE";
      remember(failureRow(venue, started, outcome, message));
    }
  } finally {
    release();
  }
}));

await writeChain;
const summary = {
  ...summarizeWave({ queueCount: input.queueCount, eligible: input.venues.length, excluded: input.excluded.length, rows }),
  excludedReasons: input.excluded.reduce<Record<string, number>>((counts, item) => {
    counts[item.reason] = (counts[item.reason] ?? 0) + 1;
    return counts;
  }, {}),
  eventProjectSha: input.eventProjectSha,
  queueChecksum: input.queueChecksum,
  stopped,
  finishedAt: new Date().toISOString(),
};
writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
process.stdout.write(`${JSON.stringify(summary)}\n`);
if (stopped) process.exitCode = 2;
const have = new Set(rows.map((row) => row.listingId));
if (!stopped && input.venues.some((venue) => !have.has(venue.listingId))) process.exitCode = 2;
