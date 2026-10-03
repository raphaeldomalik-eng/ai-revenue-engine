/**
 * Builds the current-generation backfill queue from a production website export
 * and the completed Wave 1 input/results. No network and no provider calls.
 *
 * Export files are the Supabase result wrappers for current public_website listings.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { planVenueHttpsTarget } from "../src/nexus/source-discovery/venue/http-authority.ts";

const LISTING_COUNT = 3142;
const NON_OFFICIAL = [
  "facebook.com", "fb.com", "fb.me", "instagram.com", "tiktok.com", "twitter.com", "x.com",
  "linkedin.com", "youtube.com", "youtu.be", "linktr.ee", "linkin.bio", "wa.me", "whatsapp.com",
  "calendar.google.com", "maps.google.com", "goo.gl", "g.page",
];

type ExportRow = {
  listing_id: string;
  name: string;
  public_website: string;
  country: string;
  country_code: string;
  publication_state: string;
  promoted_place_count: number;
  has_place_id: boolean;
  has_wave1: boolean;
  has_old: boolean;
};

type WaveRow = { listingId: string; authorisedOfficialUrl: string; outcome: string };

const exportPaths = process.argv.slice(2);
if (exportPaths.length === 0) throw new Error("EXPORT_PATHS_REQUIRED");

function unwrap(path: string): ExportRow[] {
  const text = readFileSync(path, "utf8");
  const wrapper = JSON.parse(text) as { result?: string };
  const body = wrapper.result ?? text;
  const start = body.indexOf("[{");
  const end = body.lastIndexOf("}]");
  if (start < 0 || end < start) throw new Error(`EXPORT_JSON:${path}`);
  return JSON.parse(body.slice(start, end + 2)) as ExportRow[];
}

function hostOf(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    return new URL(value.trim()).hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  } catch {
    return null;
  }
}

function blockedHost(host: string): boolean {
  if (NON_OFFICIAL.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return true;
  const google = host === "google.com" || host.endsWith(".google.com") || host === "google.co.za" || host.endsWith(".google.co.za");
  if (google && host !== "sites.google.com" && host !== "docs.google.com") return true;
  return false;
}

const rows = exportPaths.flatMap(unwrap);
const byId = new Map<string, ExportRow>();
for (const row of rows) byId.set(row.listing_id, row);
if (byId.size !== rows.length) throw new Error("DUPLICATE_EXPORT_ROW");

const waveInput = JSON.parse(readFileSync(new URL("../docs/quality/2026-10-03-venue-crawler-wave1-input.json", import.meta.url), "utf8")) as {
  venues: Array<{ listingId: string; authorisedOfficialUrl: string }>;
};
const waveResults = readFileSync(new URL("../docs/quality/2026-10-03-venue-crawler-wave1-results.jsonl", import.meta.url), "utf8")
  .trim()
  .split(/\n/)
  .map((line) => JSON.parse(line) as WaveRow);
const waveById = new Map(waveResults.map((row) => [row.listingId, row]));
const waveInputIds = new Set(waveInput.venues.map((venue) => venue.listingId));

function improvedState(outcome: string): string {
  if (outcome === "CRAWL_SUCCESS_USEFUL") return "IMPROVED_CRAWLER_SUCCESS";
  if (outcome === "CRAWL_SUCCESS_THIN") return "IMPROVED_CRAWLER_THIN";
  if (["ROBOTS_BLOCKED", "STATIC_RENDER_REQUIRED", "DEAD_OR_UNREACHABLE", "CROSS_SITE_REFUSED", "AUTHORITY_DRIFT"].includes(outcome)) {
    return "IMPROVED_CRAWLER_ATTEMPTED_BLOCKED";
  }
  return "IMPROVED_CRAWLER_ATTEMPTED_OTHER_FAILURE";
}

const counts: Record<string, number> = {
  IMPROVED_CRAWLER_SUCCESS: 0,
  IMPROVED_CRAWLER_THIN: 0,
  IMPROVED_CRAWLER_ATTEMPTED_BLOCKED: 0,
  IMPROVED_CRAWLER_ATTEMPTED_OTHER_FAILURE: 0,
  OLD_CRAWLER_ONLY: 0,
  NEVER_CRAWLED: 0,
  NO_VERIFIED_OFFICIAL_SITE: 0,
};
const bump = (state: string) => { counts[state] = (counts[state] ?? 0) + 1; };
const venues: Array<Record<string, string>> = [];
const gapOutcomes: Record<string, number> = {};
const exclusions: Record<string, number> = {};
let sameHostWave = 0;
let driftedWave = 0;

for (const row of byId.values()) {
  const wave = waveById.get(row.listing_id);
  const currentHost = hostOf(row.public_website);
  const waveHost = wave ? hostOf(wave.authorisedOfficialUrl) : null;
  const sameSite = Boolean(wave && currentHost && waveHost && currentHost === waveHost);
  if (wave && sameSite) {
    sameHostWave += 1;
    if (!row.has_wave1) gapOutcomes[wave.outcome] = (gapOutcomes[wave.outcome] ?? 0) + 1;
    bump(improvedState(wave.outcome));
    continue;
  }
  if (wave && !sameSite) driftedWave += 1;
  const unresolved = row.promoted_place_count >= 2 && !row.has_place_id;
  const plan = planVenueHttpsTarget(row.public_website);
  let exclusion = "";
  if (!currentHost) exclusion = "unparseable";
  else if (blockedHost(currentHost)) exclusion = "non_official_host";
  else if (unresolved) exclusion = "unresolved_identity";
  else if (!plan.crawlUrl) exclusion = plan.refusal ?? "unsafe_transport";
  if (exclusion) {
    exclusions[exclusion] = (exclusions[exclusion] ?? 0) + 1;
    bump("NO_VERIFIED_OFFICIAL_SITE");
    continue;
  }
  const state = row.has_old ? "OLD_CRAWLER_ONLY" : "NEVER_CRAWLED";
  bump(state);
  venues.push({
    listingId: row.listing_id,
    venueName: row.name,
    authorisedOfficialUrl: row.public_website.trim(),
    authorityProvenance: "resources_listing_official_website",
    country: row.country,
    countryCode: row.country_code,
    publicationState: row.publication_state,
    contentState: `publication:${row.publication_state}`,
  });
}

counts.NO_VERIFIED_OFFICIAL_SITE += LISTING_COUNT - byId.size;
const stateTotal = Object.values(counts).reduce((sum, value) => sum + value, 0);
if (stateTotal !== LISTING_COUNT) throw new Error(`STATE_TOTAL:${stateTotal}`);

venues.sort((left, right) => left.listingId.localeCompare(right.listingId));
const queueChecksum = createHash("sha256").update(venues.map((venue) => venue.listingId).join("\n")).digest("hex");
const input = {
  kind: "venue-crawler-backfill-input",
  eventProjectSha: "1806ed99f7ff49fbffb47102282dcdfde49224af",
  queueChecksum,
  queueCount: venues.length,
  excluded: [],
  liveHostVerification: "production sbmcrnpdilmpybomxwox public_website, official-host and unresolved-identity gate",
  venues,
};
writeFileSync(new URL("../docs/quality/2026-10-03-venue-crawler-backfill-input.json", import.meta.url), `${JSON.stringify(input, null, 2)}\n`);
const provenance = {
  kind: "venue-crawler-provenance-before-backfill",
  listings: LISTING_COUNT,
  websiteRows: byId.size,
  waveInput: waveInputIds.size,
  waveResults: waveResults.length,
  sameHostWave,
  driftedWave,
  gapWithoutProjectedEvidence: gapOutcomes,
  currentWebsiteExclusions: exclusions,
  states: counts,
  safeCohort: venues.length,
  paidProviderCalls: 0,
};
writeFileSync(new URL("../docs/quality/2026-10-03-venue-crawler-provenance-before.json", import.meta.url), `${JSON.stringify(provenance, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(provenance)}\n`);
