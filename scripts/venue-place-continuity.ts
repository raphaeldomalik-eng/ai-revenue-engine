/**
 * Place ID continuity for the READY cohort.
 * Field mask is exactly id,movedPlace,movedPlaceId. IDs Only. No websiteUri.
 * No EventSuite or Nexus writes.
 *
 * `node --use-system-ca --experimental-strip-types scripts/venue-place-continuity.ts`
 */
import { readFileSync, writeFileSync } from "node:fs";
import { assertGooglePlacesContinuityMask } from "../src/ai-sales-team/google-places-evidence.ts";
import { createPlaceContinuityFetcher, followPlaceContinuity, normaliseProviderPlaceId, type PlaceContinuityInstrumentation, type PlaceContinuityResult } from "../src/nexus/source-discovery/venue/place-continuity.ts";
import type { AuthorityPreflightRow } from "../src/nexus/source-discovery/venue/authority-preflight.ts";

type ReadyRecord = { candidateId: string; providerPlaceId: string };
type CombinedRow = AuthorityPreflightRow & PlaceContinuityResult;

const cohortPath = new URL("../docs/quality/2026-10-03-venue-authority-ready-cohort.json", import.meta.url);
const rowsPath = new URL("../docs/quality/2026-10-03-venue-authority-preflight.jsonl", import.meta.url);
const reportPath = new URL("../docs/quality/2026-10-03-venue-authority-preflight-report.json", import.meta.url);
const summaryPath = new URL("../docs/quality/2026-10-03-venue-authority-preflight.md", import.meta.url);

if (process.env.PLACE_CONTINUITY_ENV_FILE && !process.env.GOOGLE_PLACES_API_KEY) {
  const text = readFileSync(process.env.PLACE_CONTINUITY_ENV_FILE, "utf8");
  const match = text.match(/^GOOGLE_PLACES_API_KEY=["']?(.*?)["']?\s*$/m);
  if (match?.[1]) process.env.GOOGLE_PLACES_API_KEY = match[1];
}

const classification = assertGooglePlacesContinuityMask();
if (!classification.idsOnly || classification.estimatedCostUsd !== 0 || classification.sku !== "Place Details Essentials (IDs Only)") {
  throw new Error("GOOGLE_PLACES_CONTINUITY_ABOVE_IDS_ONLY");
}
const reportOnly = process.argv.includes("--report-only");
const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
if (!reportOnly && !apiKey) throw new Error("GOOGLE_PLACES_API_KEY is not set.");

const cohort = JSON.parse(readFileSync(cohortPath, "utf8")) as ReadyRecord[];
const rows = readFileSync(rowsPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as AuthorityPreflightRow);
if (rows.length !== cohort.length) throw new Error(`Cohort ${cohort.length} does not match preflight rows ${rows.length}.`);
const byCandidate = new Map(cohort.map((record) => [record.candidateId, record.providerPlaceId]));
const originalPlaceIds = new Set(cohort.map((record) => normaliseProviderPlaceId(record.providerPlaceId)).filter((id): id is string => Boolean(id)));
const fetcher = reportOnly || !apiKey ? null : createPlaceContinuityFetcher({ apiKey, originalPlaceIds });
const retryRateLimits = process.argv.includes("--retry-rate-limits");
const continuity = new Map<string, PlaceContinuityResult>();
if (retryRateLimits || reportOnly) {
  for (const row of rows) {
    const stored = row as AuthorityPreflightRow & Partial<PlaceContinuityResult>;
    const placeMoveStatus = stored.placeMoveStatus;
    if (!placeMoveStatus) continue;
    if (!reportOnly && stored.failureReason === "HTTP 429") continue;
    continuity.set(row.candidateId, {
      providerPlaceId: stored.providerPlaceId,
      terminalProviderPlaceId: stored.terminalProviderPlaceId ?? null,
      placeMoveStatus,
      placeMoveChain: stored.placeMoveChain ?? [],
      placeMoveHopCount: stored.placeMoveHopCount ?? 0,
      failureReason: stored.failureReason ?? null,
      observedAt: stored.observedAt,
    });
  }
}
let index = 0;
const pending = rows.filter((row) => !continuity.has(row.candidateId));
async function lookupContinuity(placeId: string): Promise<PlaceContinuityResult> {
  if (!fetcher) throw new Error("Place continuity fetcher is not available.");
  let result = await followPlaceContinuity(placeId, fetcher.lookup, new Date().toISOString());
  for (let attempt = 1; result.failureReason === "HTTP 429" && attempt <= 5; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
    result = await followPlaceContinuity(placeId, fetcher.lookup, new Date().toISOString());
  }
  return result;
}
async function pool(limit: number, delayMs: number) {
  const workers = Array.from({ length: Math.min(limit, pending.length) }, async () => {
    while (index < pending.length) {
      const row = pending[index];
      index += 1;
      if (!row) continue;
      const placeId = byCandidate.get(row.candidateId) ?? row.providerPlaceId;
      const result = await lookupContinuity(placeId);
      continuity.set(row.candidateId, result);
      if (continuity.size % 50 === 0) process.stderr.write(`continuity ${continuity.size}/${rows.length} ${result.placeMoveStatus}\n`);
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  });
  await Promise.all(workers);
}
await pool(retryRateLimits ? 1 : 2, retryRateLimits ? 250 : 120);
const combined: CombinedRow[] = rows.map((row) => {
  const place = continuity.get(row.candidateId);
  if (!place) throw new Error(`Missing continuity for ${row.candidateId}`);
  return { ...row, ...place, providerPlaceId: row.providerPlaceId };
});
writeFileSync(rowsPath, `${combined.map((row) => JSON.stringify(row)).join("\n")}\n`);

const dispositions: Record<string, number> = {};
const moves: Record<string, number> = {};
const recoveryMethods: Record<string, number> = {};
const failureClasses: Record<string, number> = {};
const provenance: Record<string, number> = {};
const countryDisposition: Record<string, Record<string, number>> = {};
let httpStored = 0;
let httpsStored = 0;
let listingBacked = 0;
let candidateOnly = 0;
const placeFailureReasons: Record<string, number> = {};
let withPlaceId = 0;
let withoutPlaceId = 0;
let multiHopMoves = 0;
let placeIdReplaced = 0;
for (const row of combined) {
  dispositions[row.disposition] = (dispositions[row.disposition] ?? 0) + 1;
  moves[row.placeMoveStatus] = (moves[row.placeMoveStatus] ?? 0) + 1;
  if (row.recoveryMethod) recoveryMethods[row.recoveryMethod] = (recoveryMethods[row.recoveryMethod] ?? 0) + 1;
  if (row.networkFailureClass) failureClasses[row.networkFailureClass] = (failureClasses[row.networkFailureClass] ?? 0) + 1;
  provenance[row.authorityProvenance] = (provenance[row.authorityProvenance] ?? 0) + 1;
  const country = row.country ?? "unknown";
  countryDisposition[country] ??= {};
  countryDisposition[country][row.disposition] = (countryDisposition[country][row.disposition] ?? 0) + 1;
  if (row.authorisedUrl.startsWith("https://")) httpsStored += 1;
  else if (row.authorisedUrl.startsWith("http://")) httpStored += 1;
  if (row.listingId) listingBacked += 1;
  else candidateOnly += 1;
  if (normaliseProviderPlaceId(row.providerPlaceId)) withPlaceId += 1;
  else withoutPlaceId += 1;
  if (row.failureReason) placeFailureReasons[row.failureReason] = (placeFailureReasons[row.failureReason] ?? 0) + 1;
  if (row.placeMoveHopCount >= 2) multiHopMoves += 1;
  if (row.placeMoveStatus === "MOVED_PLACE_RESOLVED" && row.terminalProviderPlaceId && row.terminalProviderPlaceId !== normaliseProviderPlaceId(row.providerPlaceId)) placeIdReplaced += 1;
}
const authorityProjectionRequired = dispositions.SAFE_RECOVERY_AVAILABLE ?? 0;
const fresh = fetcher?.instrumentation() ?? { requestCount: 0, uniquePlaceIds: 0, followUpRequests: 0, fieldMask: classification.fields.join(","), sku: classification.sku, estimatedPaidCostUsd: 0 };
const previous = retryRateLimits || reportOnly ? JSON.parse(readFileSync(reportPath, "utf8")) as { placeContinuity?: PlaceContinuityInstrumentation & { includesMaskValidationProbe?: boolean } } : null;
const prev = previous?.placeContinuity;
const instrumentation = reportOnly && prev ? prev : {
  requestCount: fresh.requestCount + (prev?.requestCount ?? 0) + (prev?.includesMaskValidationProbe ? 0 : 1),
  uniquePlaceIds: (prev?.uniquePlaceIds ?? fresh.uniquePlaceIds) + (prev ? fresh.followUpRequests : 0),
  followUpRequests: fresh.followUpRequests + (prev?.followUpRequests ?? 0),
  fieldMask: fresh.fieldMask,
  sku: fresh.sku,
  estimatedPaidCostUsd: 0,
  includesMaskValidationProbe: true,
};
if (instrumentation.estimatedPaidCostUsd !== 0 || instrumentation.sku !== "Place Details Essentials (IDs Only)" || instrumentation.fieldMask !== "id,movedPlace,movedPlaceId") {
  throw new Error("GOOGLE_PLACES_CONTINUITY_ABOVE_IDS_ONLY");
}
const report = {
  input: combined.length,
  dispositions,
  immediatelyCrawlable: (dispositions.HEALTHY ?? 0) + (dispositions.SAFE_RECOVERY_AVAILABLE ?? 0),
  authorityProjectionRequired,
  authorityReviewRequired: (dispositions.CROSS_DOMAIN_REVIEW ?? 0) + (dispositions.AUTHORITY_MISMATCH ?? 0) + (dispositions.STALE_PATH_UNRECOVERED ?? 0) + (dispositions.DEAD_HOST ?? 0),
  googlePlaceIdUpdateCandidates: placeIdReplaced,
  robotsBlocked: dispositions.ROBOTS_BLOCKED ?? 0,
  staticRenderingCandidates: dispositions.STATIC_SHELL ?? 0,
  transientRetry: dispositions.TRANSIENT_NETWORK ?? 0,
  withPlaceId,
  withoutPlaceId,
  multiHopMoves,
  placeIdReplaced,
  recoveryMethods,
  failureClasses,
  provenance,
  countryDisposition,
  listingBacked,
  candidateOnly,
  httpStored,
  httpsStored,
  placeFailureReasons,
  placeMove: moves,
  placeContinuity: instrumentation,
  eventSuiteProductionWrites: 0,
  safeToBulkCrawl: false,
};
const dispositionTotal = Object.values(dispositions).reduce((sum, count) => sum + count, 0);
const moveTotal = Object.values(moves).reduce((sum, count) => sum + count, 0);
if (dispositionTotal !== combined.length || moveTotal !== combined.length) {
  throw new Error(`Totals do not reconcile: dispositions ${dispositionTotal}, moves ${moveTotal}, rows ${combined.length}`);
}
writeFileSync(reportPath, JSON.stringify(report, null, 2));
const lines = [
  "# Venue authority preflight",
  "",
  `READY input: ${combined.length}`,
  "",
  "## Website dispositions",
  ...Object.entries(dispositions).map(([key, count]) => `- ${key}: ${count}`),
  "",
  `Immediately crawlable (healthy + safe recovery): ${report.immediatelyCrawlable}`,
  `Authority review (cross-domain + mismatch + stale + dead host): ${report.authorityReviewRequired}`,
  `Robots blocked: ${dispositions.ROBOTS_BLOCKED ?? 0}`,
  `Static rendering candidates: ${dispositions.STATIC_SHELL ?? 0}`,
  `Transient retry: ${dispositions.TRANSIENT_NETWORK ?? 0}`,
  "",
  "## Place continuity",
  ...Object.entries(moves).map(([key, count]) => `- ${key}: ${count}`),
  ...Object.entries(placeFailureReasons).map(([key, count]) => `- Lookup failure ${key}: ${count}`),
  "",
  `- Field mask: ${instrumentation.fieldMask}`,
  `- SKU: ${instrumentation.sku}`,
  `- Requests: ${instrumentation.requestCount}`,
  `- Unique Place IDs: ${instrumentation.uniquePlaceIds}`,
  `- Follow-up requests: ${instrumentation.followUpRequests}`,
  `- Estimated paid cost USD: ${instrumentation.estimatedPaidCostUsd}`,
  "- EventSuite production writes: 0",
  "- NO_MOVE_SIGNAL means Google returned no successor Place ID. It is not a business-status result.",
  "- Certificate failures are counted inside STALE_PATH_UNRECOVERED.",
  "- An HTTP or host recovery that still ends as a static shell, robots block, or transient response is not an authority projection.",
  "- Safe to bulk crawl now: NO",
  "",
  "## Breakdowns",
  `- With Place ID: ${withPlaceId}`,
  `- Without Place ID: ${withoutPlaceId}`,
  `- Place IDs replaced by a successor: ${placeIdReplaced}`,
  `- Multi-hop moves: ${multiHopMoves}`,
  `- Listing-backed: ${listingBacked}`,
  `- Candidate-only: ${candidateOnly}`,
  `- Stored HTTP: ${httpStored}`,
  `- Stored HTTPS: ${httpsStored}`,
  ...Object.entries(countryDisposition).map(([country, counts]) => `- ${country}: ${Object.entries(counts).map(([key, count]) => `${key} ${count}`).join(", ")}`),
  ...Object.entries(provenance).map(([key, count]) => `- Provenance ${key}: ${count}`),
  ...Object.entries(recoveryMethods).map(([key, count]) => `- Recovery ${key}: ${count}`),
  ...Object.entries(failureClasses).map(([key, count]) => `- Failure ${key}: ${count}`),
  "",
  "## Known cases",
  ...combined.filter((row) => {
    const name = row.venueName.toLowerCase();
    const url = row.authorisedUrl.toLowerCase();
    return name.includes("country sjiek") || name.includes("dassie") || name.includes("prinschurch") || name.includes("tshwane north") || name.includes("alexandra palace") || name.includes("ssisa") || name.includes("rose shed") || name.includes("shepstone") || name.includes("pavilion conference") || url.includes("theempirevenue.co.za");
  }).map((row) => `- ${row.venueName}: ${row.disposition}; recovery ${row.recoveryMethod ?? "none"}; place ${row.placeMoveStatus}; url ${row.authorisedUrl}; recovered ${row.recoveredUrl ?? "none"}`),
  "",
  `Authority projection required: ${authorityProjectionRequired}`,
  "",
];
writeFileSync(summaryPath, lines.join("\n"));
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
