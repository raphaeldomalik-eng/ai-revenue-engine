/**
 * Read-only authority preflight for the current READY cohort.
 * First-party public web only. No Google, OpenAI, Apollo, Companies House,
 * search, or rendering vendor. No EventSuite writes.
 *
 * Build the cohort, then preflight it:
 * `node --use-system-ca --experimental-strip-types scripts/venue-authority-preflight.ts`
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { classifyProbeError, preflightAuthorisedVenue, PREFLIGHT_USER_AGENT, type AuthorityPreflightRow, type PreflightProbeResult } from "../src/nexus/source-discovery/venue/authority-preflight.ts";
import { resolveOfficialSiteAuthority, type OfficialWebsiteEvidenceInput } from "../src/nexus/source-discovery/venue/authority-contract.ts";
import { defaultResolveHost, fetchPinned } from "../src/nexus/source-discovery/network.ts";
import { OriginPoliteness } from "../src/nexus/source-discovery/politeness.ts";

type EvidenceItem = { url: string; verified: boolean; provider: string | null; source_type: string | null; field_key: string };
type SourceRow = {
  candidate_id: string;
  provider_place_id: string;
  discovered_name: string | null;
  discovered_country: string | null;
  source_market: string | null;
  classification_status: string;
  candidate_status: string;
  promoted_listing_id: string | null;
  listing_name: string | null;
  country: string | null;
  country_code: string | null;
  listing_place_id: string | null;
  public_website: string | null;
  place_ids: string[] | null;
  evidence?: EvidenceItem[] | null;
};

export type ReadyRecord = {
  candidateId: string;
  providerPlaceId: string;
  listingId: string | null;
  venueName: string;
  country: string | null;
  authorisedUrl: string;
  authorityProvenance: string;
};

const calls = { google: 0, openai: 0, apollo: 0, companiesHouse: 0, renderVendor: 0, eventSuiteWrite: 0 };

function forbid(url: string) {
  const host = new URL(url).hostname.toLowerCase();
  if (host.endsWith(".openai.com") || host === "api.openai.com") { calls.openai += 1; throw new Error("OPENAI_CALL_FORBIDDEN"); }
  if (host.endsWith(".googleapis.com") || host === "maps.googleapis.com") { calls.google += 1; throw new Error("GOOGLE_CALL_FORBIDDEN"); }
  if (host.endsWith(".apollo.io")) { calls.apollo += 1; throw new Error("APOLLO_CALL_FORBIDDEN"); }
  if (host.endsWith("companieshouse.gov.uk")) { calls.companiesHouse += 1; throw new Error("COMPANIES_HOUSE_CALL_FORBIDDEN"); }
  if (/(browserless|scrapingbee|browserbase|zenrows)/i.test(host)) { calls.renderVendor += 1; throw new Error("RENDER_VENDOR_FORBIDDEN"); }
}

export function marketOf(row: { country_code?: string | null; country?: string | null; discovered_country?: string | null; source_market?: string | null }): string | null {
  const raw = `${row.country_code ?? ""} ${row.country ?? ""} ${row.discovered_country ?? ""} ${row.source_market ?? ""}`.toLowerCase();
  if (/\bza\b|south africa/.test(raw)) return "ZA";
  if (/\bgb\b|uk\b|united kingdom|england|scotland|wales/.test(raw)) return "GB";
  return row.country_code ?? row.country ?? row.discovered_country ?? row.source_market ?? null;
}

function authorityInputs(row: SourceRow): { evidence: OfficialWebsiteEvidenceInput[]; googleWebsiteUri: string | null; nexusOfficialWebsite: string | null } {
  const evidence: OfficialWebsiteEvidenceInput[] = [];
  let googleWebsiteUri: string | null = null;
  let nexusOfficialWebsite: string | null = null;
  for (const item of row.evidence ?? []) {
    if (item.provider === "google_places" && item.field_key === "website_uri") {
      googleWebsiteUri ??= item.url;
      continue;
    }
    if (item.source_type === "nexus") {
      nexusOfficialWebsite ??= item.url;
      continue;
    }
    if (item.verified) evidence.push({ url: item.url, verified: true });
  }
  return { evidence, googleWebsiteUri, nexusOfficialWebsite };
}

export function readyRecords(rows: SourceRow[]): ReadyRecord[] {
  const ready: ReadyRecord[] = [];
  for (const row of rows) {
    const fallbacks = authorityInputs(row);
    const authority = resolveOfficialSiteAuthority({
      providerPlaceId: row.provider_place_id,
      classificationStatus: row.classification_status,
      candidateStatus: row.candidate_status,
      listingId: row.promoted_listing_id,
      listingPlaceId: row.listing_place_id,
      promotedPlaceIds: row.place_ids ?? [],
      listingPublicWebsite: row.public_website,
      ...fallbacks,
    });
    if (authority.status !== "READY" || !authority.url || !authority.provenance) continue;
    ready.push({
      candidateId: row.candidate_id,
      providerPlaceId: row.provider_place_id,
      listingId: authority.listingId,
      venueName: row.listing_name || row.discovered_name || row.provider_place_id,
      country: marketOf(row),
      authorisedUrl: authority.url,
      authorityProvenance: authority.provenance,
    });
  }
  return ready;
}

function unwrap(path: string): SourceRow[] {
  const raw = readFileSync(path, "utf8");
  const envelope = JSON.parse(raw) as { result?: string };
  const text = envelope.result ?? raw;
  const start = text.indexOf("[{");
  const end = text.lastIndexOf("}]");
  if (start < 0 || end < start) throw new Error(`No JSON array in ${path}`);
  return JSON.parse(text.slice(start, end + 2)) as SourceRow[];
}

function liveProbe(politeness: OriginPoliteness): (url: string) => Promise<PreflightProbeResult | ReturnType<typeof classifyProbeError>> {
  return async (url) => {
    forbid(url);
    const attempt = async () => politeness.run(new URL(url).origin, 200, async () => {
      const response = await fetchPinned({
        url,
        resolveHost: defaultResolveHost,
        userAgent: PREFLIGHT_USER_AGENT,
        accept: url.endsWith("/robots.txt") ? "text/plain,*/*;q=0.1" : "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        maxBytes: url.endsWith("/robots.txt") ? 100_000 : 400_000,
        timeoutMs: 12_000,
        allowInsecureHttp: url.startsWith("http://"),
        statusOnOversize: true,
      });
      const textual = response.status >= 200 && response.status < 300 && response.status !== 204;
      return {
        status: response.status,
        location: response.headers.get("location"),
        body: textual ? await response.text() : "",
        contentType: response.headers.get("content-type"),
      };
    });
    try {
      return await attempt();
    } catch (error) {
      const classified = classifyProbeError(error);
      if (classified.failure !== "TRANSIENT_NETWORK") return classified;
      try {
        return await attempt();
      } catch (retryError) {
        return classifyProbeError(retryError);
      }
    }
  };
}

function tally(rows: AuthorityPreflightRow[]) {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.disposition] = (counts[row.disposition] ?? 0) + 1;
  const by = (pick: (row: AuthorityPreflightRow) => string) => {
    const result: Record<string, number> = {};
    for (const row of rows) {
      const key = pick(row);
      result[key] = (result[key] ?? 0) + 1;
    }
    return result;
  };
  return {
    input: rows.length,
    dispositions: counts,
    immediatelyCrawlable: (counts.HEALTHY ?? 0) + (counts.SAFE_RECOVERY_AVAILABLE ?? 0),
    authorityReviewRequired: (counts.CROSS_DOMAIN_REVIEW ?? 0) + (counts.AUTHORITY_MISMATCH ?? 0) + (counts.STALE_PATH_UNRECOVERED ?? 0) + (counts.DEAD_HOST ?? 0),
    byCountry: by((row) => row.country ?? "UNKNOWN"),
    byScheme: by((row) => { try { return new URL(row.authorisedUrl).protocol; } catch { return "invalid"; } }),
    byBacking: by((row) => row.listingId ? "listing" : "candidate_only"),
    byProvenance: by((row) => row.authorityProvenance),
    paidProviderCalls: calls,
  };
}

async function pool<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      if (current) await task(current);
    }
  });
  await Promise.all(workers);
}

const cohortPath = new URL("../docs/quality/2026-10-03-venue-authority-ready-cohort.json", import.meta.url);
const outputPath = new URL("../docs/quality/2026-10-03-venue-authority-preflight.jsonl", import.meta.url);
const reportPath = new URL("../docs/quality/2026-10-03-venue-authority-preflight-report.json", import.meta.url);

if (process.argv.includes("--build-cohort")) {
  const listingPath = process.argv[process.argv.indexOf("--listing-export") + 1];
  const evidencePath = process.argv[process.argv.indexOf("--evidence-export") + 1];
  if (!listingPath || !evidencePath) throw new Error("Pass --listing-export and --evidence-export");
  const ready = readyRecords([...unwrap(listingPath), ...unwrap(evidencePath)]);
  writeFileSync(cohortPath, JSON.stringify(ready, null, 2));
  const markets: Record<string, number> = {};
  const schemes: Record<string, number> = {};
  const backing: Record<string, number> = {};
  const provenance: Record<string, number> = {};
  for (const record of ready) {
    const market = record.country ?? "UNKNOWN";
    markets[market] = (markets[market] ?? 0) + 1;
    const scheme = new URL(record.authorisedUrl).protocol;
    schemes[scheme] = (schemes[scheme] ?? 0) + 1;
    const kind = record.listingId ? "listing" : "candidate_only";
    backing[kind] = (backing[kind] ?? 0) + 1;
    provenance[record.authorityProvenance] = (provenance[record.authorityProvenance] ?? 0) + 1;
  }
  process.stdout.write(`${JSON.stringify({ ready: ready.length, markets, schemes, backing, provenance })}\n`);
} else {
  const cohort = JSON.parse(readFileSync(cohortPath, "utf8")) as ReadyRecord[];
  const done = new Set<string>();
  try {
    for (const line of readFileSync(outputPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      done.add((JSON.parse(line) as AuthorityPreflightRow).candidateId);
    }
  } catch { /* first run */ }
  writeFileSync(outputPath, done.size ? readFileSync(outputPath, "utf8") : "");
  const politeness = new OriginPoliteness();
  const probe = liveProbe(politeness);
  const pending = cohort.filter((record) => !done.has(record.candidateId));
  let finished = done.size;
  let writeChain = Promise.resolve();
  await pool(pending, 6, async (record) => {
    const row = await preflightAuthorisedVenue(record, probe, new Date().toISOString());
    writeChain = writeChain.then(() => appendFileSync(outputPath, `${JSON.stringify(row)}\n`));
    await writeChain;
    finished += 1;
    if (finished % 25 === 0) process.stderr.write(`preflight ${finished}/${cohort.length} ${row.disposition}\n`);
  });
  const rows = readFileSync(outputPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as AuthorityPreflightRow);
  const summary = { ...tally(rows), eventSuiteProductionWrites: calls.eventSuiteWrite };
  writeFileSync(reportPath, JSON.stringify(summary, null, 2));
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
