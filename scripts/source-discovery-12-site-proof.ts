/**
 * Cold 12-site proof of deterministic source discovery.
 * Real first-party HTTP only. No Google, OpenAI, Apollo, Companies House,
 * rendering vendor, database, or commercial writes.
 *
 * Selection is frozen:
 * - the 11 official sites in docs/quality/2026-09-28-master-crawler-quality-pilot.md, in that table order;
 * - Communion Music, the existing first-party source-discovery fixture in tests/communion-source-discovery.test.ts.
 * Nothing is chosen from the 18,507-place estate.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { executeSourceDiscoveryRequest, InMemoryNexusResultStore } from "../src/nexus/executor.ts";
import type { CrawlObservability } from "../src/nexus/source-discovery/types.ts";

const SITES = [
  { id: "beach-blanket-bohemia", name: "Beach Blanket Bohemia", hostname: "beachblanketbohemia.co.za", url: "https://beachblanketbohemia.co.za/", why: "Quality-pilot row 1. Small HTML venue." },
  { id: "artscape", name: "Artscape", hostname: "www.artscape.co.za", url: "https://www.artscape.co.za/", why: "Quality-pilot row 2. Multi-page venue with event pages." },
  { id: "cticc", name: "CTICC", hostname: "www.cticc.co.za", url: "https://www.cticc.co.za/", why: "Quality-pilot row 3. Multi-page convention venue." },
  { id: "events-at-ncg", name: "Events at NCG", hostname: "www.eventsatncg.co.za", url: "https://www.eventsatncg.co.za/index.html", why: "Quality-pilot row 4. Multi-page venue." },
  { id: "johannesburg-expo-centre", name: "Johannesburg Expo Centre", hostname: "expocentre.co.za", url: "https://expocentre.co.za/", why: "Quality-pilot row 5. Multi-page expo venue." },
  { id: "southbank-centre", name: "Southbank Centre", hostname: "www.southbankcentre.co.uk", url: "https://www.southbankcentre.co.uk/", why: "Quality-pilot row 6. Previously HTTP 403." },
  { id: "barbican", name: "Barbican", hostname: "www.barbican.org.uk", url: "https://www.barbican.org.uk/", why: "Quality-pilot row 7. Large multi-page venue." },
  { id: "roundhouse", name: "Roundhouse", hostname: "www.roundhouse.org.uk", url: "https://www.roundhouse.org.uk/", why: "Quality-pilot row 8. Multi-page venue." },
  { id: "national-theatre", name: "National Theatre", hostname: "www.nationaltheatre.org.uk", url: "https://www.nationaltheatre.org.uk/", why: "Quality-pilot row 9. Previously robots fetch HTTP 403." },
  { id: "troxy", name: "Troxy", hostname: "troxy.co.uk", url: "https://troxy.co.uk/", why: "Quality-pilot row 10. Venue site." },
  { id: "the-brewery", name: "The Brewery", hostname: "www.thebrewery.co.uk", url: "https://www.thebrewery.co.uk/", why: "Quality-pilot row 11. Multi-room venue." },
  { id: "communion-music", name: "Communion Music", hostname: "www.communionmusic.co.uk", url: "https://www.communionmusic.co.uk/tickets", why: "Existing source-discovery fixture, not a Resources venue row. Event-source page with a known first-party image subdomain." },
] as const;

const BUDGET = {
  maxPages: 20,
  maxRequests: 40,
  maxBytesPerResponse: 15_000_000,
  maxRedirects: 5,
  maxRetries: 2,
  timeoutMs: 20_000,
  minRequestDelayMs: 250,
};

const EXTRACTORS = ["IDENTITY", "PUBLIC_CONTACT", "VENUE_FACTS", "IMAGE_CANDIDATES", "EVENTS", "SOURCE_CLASSIFICATION"] as const;

const calls = { google: 0, openai: 0, apollo: 0, companiesHouse: 0, renderVendor: 0 };

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function forbid(url: string) {
  const host = new URL(url).hostname.toLowerCase();
  if (host === "api.openai.com" || host.endsWith(".openai.com")) { calls.openai += 1; throw new Error("OPENAI_CALL_FORBIDDEN"); }
  if (host === "places.googleapis.com" || host === "maps.googleapis.com" || host.endsWith(".googleapis.com")) { calls.google += 1; throw new Error("GOOGLE_CALL_FORBIDDEN"); }
  if (host === "api.apollo.io" || host.endsWith(".apollo.io")) { calls.apollo += 1; throw new Error("APOLLO_CALL_FORBIDDEN"); }
  if (host.endsWith("companieshouse.gov.uk") || host.endsWith("company-information.service.gov.uk")) { calls.companiesHouse += 1; throw new Error("COMPANIES_HOUSE_CALL_FORBIDDEN"); }
  if (/(browserless|scrapingbee|browserbase|zenrows)/i.test(host)) { calls.renderVendor += 1; throw new Error("RENDER_VENDOR_FORBIDDEN"); }
}

type FetchNote = { url: string; status: number; bytes: number; contentType: string; pdf: boolean };

function guardedFetch(notes: FetchNote[]): typeof fetch {
  return async (input, init) => {
    const url = requestUrl(input);
    forbid(url);
    const response = await fetch(input, init);
    const contentType = response.headers.get("content-type") ?? "";
    const pdf = /application\/pdf/i.test(contentType) || /\.pdf(?:$|\?)/i.test(url);
    const clone = response.clone();
    const bytes = (await clone.arrayBuffer()).byteLength;
    notes.push({ url, status: response.status, bytes, contentType: contentType.split(";")[0] ?? "", pdf });
    return response;
  };
}

function sum(values: number[]) { return values.reduce((total, value) => total + value, 0); }
function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
function percentile(values: number[], ratio: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(ratio * sorted.length) - 1)]!;
}

function contactTotal(yields: CrawlObservability["extractorYields"] | null) {
  if (!yields) return 0;
  return yields.contacts.email + yields.contacts.phone + yields.contacts.form + yields.contacts.other;
}
function venueTotal(yields: CrawlObservability["extractorYields"] | null) {
  if (!yields) return 0;
  const venue = yields.venueFacts;
  return venue.spaces + venue.namedSpaceCapacities + venue.venueCapacities + venue.facilities + venue.accessibility;
}

type SiteRecord = {
  id: string;
  name: string;
  hostname: string;
  url: string;
  why: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  requests: number;
  bytes: number;
  pages: number;
  htmlCount: number;
  pdfCount: number;
  sitemapFetched: string[];
  sitemapUrlsSeen: number;
  hydrationPages: number;
  renderNeededButUnavailable: string[];
  materiallyBlockedByRendering: boolean;
  retries: number;
  redirects: number;
  robots: CrawlObservability["robots"] | null;
  cacheFreshHits: number;
  revalidatedNotModified: number;
  dimensionsSatisfied: string[];
  dimensionsMissing: string[];
  stopReason: string | null;
  crawlStatus: string;
  disposition: "success" | "partial" | "blocked" | "review";
  yields: CrawlObservability["extractorYields"] | null;
  pdfs: FetchNote[];
  skippedContent: CrawlObservability["skippedContent"];
  warnings: string[];
};

function disposition(status: string, useful: boolean, robotsBlocked: boolean): SiteRecord["disposition"] {
  if (robotsBlocked || status === "BLOCKED") return "blocked";
  if (status === "COMPLETED" && useful) return "success";
  if (status === "PARTIAL") return "partial";
  if (status === "FAILED" || !useful) return "review";
  return "review";
}

async function crawlSite(site: typeof SITES[number]): Promise<SiteRecord> {
  const notes: FetchNote[] = [];
  const captured: { observed: CrawlObservability | null } = { observed: null };
  const started = new Date();
  const store = new InMemoryNexusResultStore();
  const result = await executeSourceDiscoveryRequest({
    contractVersion: "nexus.source-discovery-request.v1",
    discoveryRequestId: randomUUID(),
    idempotencyKey: randomUUID(),
    correlationId: randomUUID(),
    originatingProduct: "event_suite_resources",
    subjectReference: {
      canonicalEntityId: null,
      candidateReference: { sourceSystem: "quality_pilot_2026_09_28", sourceRecordId: site.id },
      entityType: site.id === "communion-music" ? "UNKNOWN" : "VENUE",
    },
    verifiedSourceUrl: site.url,
    requestedExtractors: [...EXTRACTORS],
    freshnessRequirements: { maxAgeHours: 24 },
    crawlBudget: BUDGET,
    existingEvidenceRefs: [],
    requestedBy: { actorType: "SYSTEM", actorId: "source-discovery-12-site-proof" },
    createdAt: started.toISOString(),
  }, { fetchImpl: guardedFetch(notes), onCrawlObservability: (value) => { captured.observed = value; } }, store);
  const observed = captured.observed;
  const ended = new Date();
  if (!result) throw new Error(`SOURCE_DISCOVERY_RESULT_MISSING:${site.id}`);
  const crawl = result.crawl as { status?: string; warnings?: string[]; requestCount?: number; pageCount?: number; bytesRead?: number; redirects?: number };
  const yields = observed?.extractorYields ?? null;
  const useful = (yields?.identityFacts ?? 0) + contactTotal(yields) + venueTotal(yields) + (yields?.images.total ?? 0) + (yields?.events ?? 0) > 0;
  const renderNeeded = observed?.renderNeededButUnavailable ?? [];
  const robotsBlocked = observed?.stopReason === "ROBOTS_BLOCKED" || observed?.stopReason === "ROBOTS_UNAVAILABLE";
  return {
    id: site.id,
    name: site.name,
    hostname: site.hostname,
    url: site.url,
    why: site.why,
    startedAt: started.toISOString(),
    endedAt: ended.toISOString(),
    durationMs: ended.getTime() - started.getTime(),
    requests: observed?.requests ?? crawl.requestCount ?? notes.length,
    bytes: observed?.bytes ?? crawl.bytesRead ?? sum(notes.map((note) => note.bytes)),
    pages: observed ? observed.staticPages + observed.pdfDocuments : crawl.pageCount ?? 0,
    htmlCount: observed?.staticPages ?? 0,
    pdfCount: observed?.pdfDocuments ?? notes.filter((note) => note.pdf && note.status < 400).length,
    sitemapFetched: observed?.sitemap.fetched ?? [],
    sitemapUrlsSeen: observed?.sitemap.urlsSeen ?? 0,
    hydrationPages: observed?.hydrationPages ?? 0,
    renderNeededButUnavailable: renderNeeded,
    materiallyBlockedByRendering: renderNeeded.length > 0 && !useful,
    retries: observed?.retries ?? 0,
    redirects: observed?.redirects ?? crawl.redirects ?? 0,
    robots: observed?.robots ?? null,
    cacheFreshHits: observed?.cacheFreshHits ?? 0,
    revalidatedNotModified: observed?.revalidatedNotModified ?? 0,
    dimensionsSatisfied: observed?.dimensionsSatisfied ?? [],
    dimensionsMissing: observed?.dimensionsMissing ?? [],
    stopReason: observed?.stopReason ?? null,
    crawlStatus: crawl.status ?? "FAILED",
    disposition: disposition(crawl.status ?? "FAILED", useful, robotsBlocked),
    yields,
    pdfs: notes.filter((note) => note.pdf),
    skippedContent: observed?.skippedContent ?? [],
    warnings: crawl.warnings ?? [],
  };
}

function markdown(report: Record<string, unknown>, sites: SiteRecord[]) {
  const lines = [
    "# Source-discovery 12-site execution proof",
    "",
    `Label: PREVIEW_EXECUTION_PROVEN. Run at ${report.startedAt}. Candidate code, in-memory store, no production deployment. Node was started with --use-system-ca, the same certificate requirement recorded by the 28 September quality pilot.`,
    "",
    "Selection: the 11 sites in `docs/quality/2026-09-28-master-crawler-quality-pilot.md`, in table order, plus Communion Music from `tests/communion-source-discovery.test.ts`. No site was taken from the 18,507-place estate. No HTTP-only candidate exists in that frozen cohort, so no scheme-upgrade pass was run.",
    "",
    `Budget per site: ${JSON.stringify(BUDGET)}. Extractors: ${EXTRACTORS.join(", ")}.`,
    "",
    "## Sites",
    "",
    "| Site | Disposition | Duration ms | Requests | Bytes | HTML | PDF | Stop | Render needed |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |",
    ...sites.map((site) => `| ${site.name} | ${site.disposition} | ${site.durationMs} | ${site.requests} | ${site.bytes} | ${site.htmlCount} | ${site.pdfCount} | ${site.stopReason ?? ""} | ${site.renderNeededButUnavailable.length} |`),
    "",
    "## Aggregate",
    "",
    "```json",
    JSON.stringify(report.aggregate, null, 2),
    "```",
    "",
    `Rendering decision: ${report.renderingDecision}`,
    "",
    "Provider calls are in the JSON report. This sample does not estimate an 18,507 completion time: Nexus has not yet said which records need a crawl.",
    "",
  ];
  return lines.join("\n");
}

function failedSite(site: typeof SITES[number], error: unknown): SiteRecord {
  const now = new Date().toISOString();
  const message = error instanceof Error ? error.message : "Source discovery failed.";
  return {
    id: site.id, name: site.name, hostname: site.hostname, url: site.url, why: site.why,
    startedAt: now, endedAt: now, durationMs: 0, requests: 0, bytes: 0, pages: 0, htmlCount: 0, pdfCount: 0,
    sitemapFetched: [], sitemapUrlsSeen: 0, hydrationPages: 0, renderNeededButUnavailable: [], materiallyBlockedByRendering: false,
    retries: 0, redirects: 0, robots: null, cacheFreshHits: 0, revalidatedNotModified: 0, dimensionsSatisfied: [], dimensionsMissing: [],
    stopReason: "ENTRY_FAILED", crawlStatus: "FAILED", disposition: "review", yields: null, pdfs: [], skippedContent: [],
    warnings: [message.slice(0, 500)],
  };
}

const startedAt = new Date().toISOString();
const sites: SiteRecord[] = [];
for (const site of SITES) {
  process.stderr.write(`crawling ${site.id}\n`);
  try {
    sites.push(await crawlSite(site));
  } catch (error) {
    process.stderr.write(`failed ${site.id}: ${error instanceof Error ? error.message : "unknown"}\n`);
    sites.push(failedSite(site, error));
  }
}

const durations = sites.map((site) => site.durationMs);
const requests = sites.map((site) => site.requests);
const bytes = sites.map((site) => site.bytes);
const usefulSites = sites.filter((site) => site.disposition === "success" || site.disposition === "partial").length;
const renderMaterial = sites.filter((site) => site.materiallyBlockedByRendering);
const renderingDecision = renderMaterial.length >= 2
  ? "BULK_CRAWL_BLOCKED_RENDERING_MATERIAL"
  : renderMaterial.length === 1
    ? "ISOLATE_ONE_RENDER_BLOCKED_SITE"
    : "RENDERING_NOT_A_BLOCKER";

const report = {
  label: "PREVIEW_EXECUTION_PROVEN",
  startedAt,
  endedAt: new Date().toISOString(),
  selection: "quality-pilot-2026-09-28 table order, then communion-source-discovery fixture",
  databaseWrites: 0,
  resourcesMutations: 0,
  nexusCanonicalMutations: 0,
  commercialProspectCreates: 0,
  providerCalls: calls,
  httpToHttpsRecovery: "NOT_RUN_NO_HTTP_ONLY_CANDIDATE_IN_FROZEN_COHORT",
  renderingDecision,
  renderMaterialSiteIds: renderMaterial.map((site) => site.id),
  aggregate: {
    sites: sites.length,
    medianDurationMs: median(durations),
    p90DurationMs: percentile(durations, 0.9),
    maxDurationMs: Math.max(...durations),
    averageRequests: sum(requests) / sites.length,
    medianRequests: median(requests),
    averageBytes: sum(bytes) / sites.length,
    totalBytes: sum(bytes),
    usefulEvidenceYield: usefulSites / sites.length,
    pdfSiteFrequency: sites.filter((site) => site.pdfCount > 0).length / sites.length,
    pdfDocuments: sum(sites.map((site) => site.pdfCount)),
    robotsBlockedRate: sites.filter((site) => site.stopReason === "ROBOTS_BLOCKED" || site.stopReason === "ROBOTS_UNAVAILABLE").length / sites.length,
    retryRate: sites.filter((site) => site.retries > 0).length / sites.length,
    totalRetries: sum(sites.map((site) => site.retries)),
    renderRequiredRate: sites.filter((site) => site.renderNeededButUnavailable.length > 0).length / sites.length,
    sourceInsufficientRate: sites.filter((site) => site.dimensionsMissing.length > 0).length / sites.length,
    cacheFreshHits: sum(sites.map((site) => site.cacheFreshHits)),
    revalidatedNotModified: sum(sites.map((site) => site.revalidatedNotModified)),
    dispositions: {
      success: sites.filter((site) => site.disposition === "success").length,
      partial: sites.filter((site) => site.disposition === "partial").length,
      blocked: sites.filter((site) => site.disposition === "blocked").length,
      review: sites.filter((site) => site.disposition === "review").length,
    },
  },
  sites,
};

if (calls.google || calls.openai || calls.apollo || calls.companiesHouse || calls.renderVendor) {
  throw new Error(`FORBIDDEN_PROVIDER_CALL ${JSON.stringify(calls)}`);
}

mkdirSync(new URL("../docs/quality/", import.meta.url), { recursive: true });
const jsonPath = new URL("../docs/quality/2026-09-30-source-discovery-12-site-proof.json", import.meta.url);
const mdPath = new URL("../docs/quality/2026-09-30-source-discovery-12-site-proof.md", import.meta.url);
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(mdPath, markdown(report, sites));
process.stdout.write(`${renderingDecision} sites=${sites.length} google=${calls.google} openai=${calls.openai} apollo=${calls.apollo} companiesHouse=${calls.companiesHouse}\n`);
