/**
 * Pure helpers for the venue crawler wave.
 * Classification, scheduling, and result normalisation never fetch and never invent URLs.
 */
import { planVenueHttpsTarget, sameAuthorisedVenueSite } from "../src/nexus/source-discovery/venue/http-authority.ts";
import type { VenueEvidencePackage } from "../src/nexus/source-discovery/venue/evidence.ts";
import type { CrawlStats, CrawlStopReason } from "../src/nexus/source-discovery/types.ts";

export const WAVE_OUTCOMES = [
  "CRAWL_SUCCESS_USEFUL",
  "CRAWL_SUCCESS_THIN",
  "ROBOTS_BLOCKED",
  "STATIC_RENDER_REQUIRED",
  "TRANSIENT_NETWORK",
  "DEAD_OR_UNREACHABLE",
  "AUTHORITY_DRIFT",
  "CROSS_SITE_REFUSED",
  "OTHER_SAFE_FAILURE",
] as const;

export type WaveOutcome = (typeof WAVE_OUTCOMES)[number];

export type WaveVenueInput = {
  listingId: string;
  venueName: string;
  authorisedOfficialUrl: string;
  authorityProvenance: string;
  country: string;
  countryCode: string;
  publicationState: string;
  contentState: string;
};

export type ClassifiedCrawl = {
  refusal: string | null;
  sameSite: boolean;
  status: CrawlStats["status"] | null;
  failureClass?: "TERMINAL" | "RETRYABLE" | null;
  stopReason: CrawlStopReason | string | null;
  warnings: string[];
  htmlPages: number;
  pdfDocuments: number;
  renderNeeded: number;
  useful: boolean;
};

const TRANSIENT_WARNING = /timeout|timed out|ECONNRESET|EAI_AGAIN|ETIMEDOUT|socket hang up|HTTP 429|HTTP 5\d\d|Retries exhausted|Retry-After|ECONNABORTED/i;
const DEAD_WARNING = /HTTP 404|HTTP 410|ENOTFOUND|ECONNREFUSED|certificate|CERT_|getaddrinfo|ENOTFOUND|no such host|UNPARSEABLE/i;
const GENERIC_CONFIRMED_SPACE = /^(?:the |our |your )?(?:newsletter|contact|what'?s on|whats on|latest news|conference venue|wedding venue|corporate venue|home|gallery|events|venue|space|spaces|guest accommodation|accommodation|facilities|amenities|our venue|outdoor space|private events|meeting rooms)$/i;

export function evidenceIsUseful(evidence: VenueEvidencePackage | null): boolean {
  if (!evidence) return false;
  const description = evidence.descriptionEvidence.some((item) => {
    const text = item.text.trim();
    if (text.length < 40) return false;
    if (item.kind !== "character" && item.kind !== "event-use" && item.kind !== "facility" && item.kind !== "setting") return false;
    return !/\b(?:versatile venue|perfect for any event|premier destination|ideal setting|world-class experience)\b/i.test(text);
  });
  return description
    || evidence.spaces.length > 0
    || evidence.capacities.length > 0
    || evidence.practicalFacts.length > 0
    || evidence.suitability.length > 0;
}

export function confirmedSpaceLooksGeneric(name: string): boolean {
  return GENERIC_CONFIRMED_SPACE.test(name.trim());
}

export function classifyWaveOutcome(input: ClassifiedCrawl): WaveOutcome {
  if (input.refusal === "CROSS_SITE_FINAL_URL" || (input.status !== null && !input.sameSite)) return "CROSS_SITE_REFUSED";
  const warnings = input.warnings.join("\n");
  const robots = input.stopReason === "ROBOTS_BLOCKED"
    || input.stopReason === "ROBOTS_UNAVAILABLE"
    || input.status === "BLOCKED"
    || /robots\.txt disallows the verified source path/i.test(warnings);
  if (robots && input.htmlPages === 0) return "ROBOTS_BLOCKED";
  if (input.useful && input.sameSite) return "CRAWL_SUCCESS_USEFUL";
  if (input.renderNeeded > 0 && !input.useful) return "STATIC_RENDER_REQUIRED";
  if ((input.status === "COMPLETED" || input.status === "PARTIAL") && input.sameSite && (input.htmlPages > 0 || input.pdfDocuments > 0)) {
    return "CRAWL_SUCCESS_THIN";
  }
  const retryable = input.failureClass === "RETRYABLE" || TRANSIENT_WARNING.test(warnings);
  if (input.status === "FAILED" && retryable && !DEAD_WARNING.test(warnings)) return "TRANSIENT_NETWORK";
  if (input.status === "FAILED" && DEAD_WARNING.test(warnings)) return "DEAD_OR_UNREACHABLE";
  if (input.status === "FAILED" && retryable) return "TRANSIENT_NETWORK";
  if (input.status === null && input.refusal) return "OTHER_SAFE_FAILURE";
  if (input.status === "FAILED" || input.status === null) return input.status === null ? "OTHER_SAFE_FAILURE" : "DEAD_OR_UNREACHABLE";
  return "OTHER_SAFE_FAILURE";
}

export function crawlUrlKey(authorisedUrl: string): string | null {
  const plan = planVenueHttpsTarget(authorisedUrl);
  if (!plan.crawlUrl) return null;
  const url = new URL(plan.crawlUrl);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  if (url.pathname !== "/" && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
  return url.toString();
}

export function authorisedHost(authorisedUrl: string): string | null {
  try {
    return new URL(authorisedUrl).hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Same authorised crawl URL may reuse one fetch. A different path on the same host must be crawled on its own. */
export function canReuseCrawl(leftUrl: string, rightUrl: string): boolean {
  const left = crawlUrlKey(leftUrl);
  const right = crawlUrlKey(rightUrl);
  return Boolean(left && right && left === right);
}

export function documentStaysOnAuthorisedSite(authorisedUrl: string, documentUrl: string): boolean {
  return sameAuthorisedVenueSite(authorisedUrl, documentUrl);
}

const IMAGE_NOISE = /(?:^|[/_.-])(?:logo|icon|favicon|sprite|placeholder|pixel|spacer|blank)(?:[/_.-]|$)/i;

export function keepImageCandidate(image: { likelyRole: string; sourceImageUrl: string; filename: string | null; width: number | null; height: number | null }): boolean {
  if (image.likelyRole === "LOGO") return false;
  if ((image.width !== null && image.width < 80) || (image.height !== null && image.height < 80)) return false;
  const name = `${image.filename ?? ""} ${image.sourceImageUrl}`;
  if (IMAGE_NOISE.test(name)) return false;
  if (/\.svg(?:$|\?)/i.test(image.sourceImageUrl)) return false;
  return true;
}

export type WaveResultRow = {
  listingId: string;
  venueName: string;
  authorisedOfficialUrl: string;
  authorityProvenance: string;
  country: string;
  countryCode: string;
  publicationState: string;
  outcome: WaveOutcome;
  outcomeReason: string;
  reusedSharedCrawl: boolean;
  crawlUrl: string | null;
  finalUrl: string | null;
  sameSite: boolean;
  pages: number;
  requests: number;
  bytes: number;
  pdfCount: number;
  pdfs: Array<{ url: string }>;
  pageUrls: string[];
  descriptionEvidence: Array<{ kind: string; text: string; sourceUrl: string }>;
  contacts: Array<{ type: string; value: string; purpose: string; sourceUrl: string; routingAuthority: "not_operator_confirmed" }>;
  spaces: Array<{ name: string; sourceUrl: string }>;
  reviewSpaces: Array<{ name: string; sourceUrl: string }>;
  capacities: Array<{ space: string | null; layout: string; count: number; statement: string; sourceUrl: string; reviewRequired: boolean }>;
  practicalFacts: Array<{ fieldName: string; value: string; sourceUrl: string }>;
  suitability: Array<{ value: string; sourceUrl: string }>;
  images: Array<{ sourceImageUrl: string; sourcePageUrl: string; likelyRole: string; rightsState: string; alt: string | null }>;
  routingAuthority: "not_operator_confirmed";
  stopReason: string | null;
  warnings: string[];
  elapsedMs: number;
};

export function completedListingIds(jsonl: string): Set<string> {
  const ids = new Set<string>();
  for (const line of jsonl.split(/\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as { listingId?: string };
      if (row.listingId) ids.add(row.listingId);
    } catch {
      // A crashed append can leave one partial line. Resume ignores it and crawls that venue again.
    }
  }
  return ids;
}

export type WaveSummary = {
  queueCount: number;
  eligible: number;
  excluded: number;
  attempts: number;
  outcomes: Record<WaveOutcome, number>;
  successes: number;
  withDescription: number;
  withContact: number;
  withSpaces: number;
  withCapacities: number;
  withFacts: number;
  withSuitability: number;
  withImages: number;
  withPdfs: number;
  averagePages: number;
  averageRequests: number;
  totalBytes: number;
  paidProviderCostUsd: 0;
};

export function summarizeWave(args: {
  queueCount: number;
  eligible: number;
  excluded: number;
  rows: WaveResultRow[];
}): WaveSummary {
  const outcomes = Object.fromEntries(WAVE_OUTCOMES.map((outcome) => [outcome, 0])) as Record<WaveOutcome, number>;
  for (const row of args.rows) outcomes[row.outcome] += 1;
  const successes = args.rows.filter((row) => row.outcome === "CRAWL_SUCCESS_USEFUL" || row.outcome === "CRAWL_SUCCESS_THIN");
  const average = (pick: (row: WaveResultRow) => number) => successes.length
    ? Math.round((successes.reduce((sum, row) => sum + pick(row), 0) / successes.length) * 10) / 10
    : 0;
  return {
    queueCount: args.queueCount,
    eligible: args.eligible,
    excluded: args.excluded,
    attempts: args.rows.length,
    outcomes,
    successes: successes.length,
    withDescription: successes.filter((row) => row.descriptionEvidence.length > 0).length,
    withContact: successes.filter((row) => row.contacts.length > 0).length,
    withSpaces: successes.filter((row) => row.spaces.length > 0).length,
    withCapacities: successes.filter((row) => row.capacities.length > 0).length,
    withFacts: successes.filter((row) => row.practicalFacts.length > 0).length,
    withSuitability: successes.filter((row) => row.suitability.length > 0).length,
    withImages: successes.filter((row) => row.images.length > 0).length,
    withPdfs: successes.filter((row) => row.pdfCount > 0).length,
    averagePages: average((row) => row.pages),
    averageRequests: average((row) => row.requests),
    totalBytes: args.rows.reduce((sum, row) => sum + (row.reusedSharedCrawl ? 0 : row.bytes), 0),
    paidProviderCostUsd: 0,
  };
}

/**
 * Stop only for a defect this runner introduced.
 * Ordinary robots, dead hosts, and thin sites are venue outcomes, not a crawler defect.
 */
export function systemicDefect(rows: WaveResultRow[], sampleSize = 50): string | null {
  const sample = rows.slice(0, sampleSize);
  if (sample.length < sampleSize) return null;
  const crossSiteLeak = sample.find((row) => row.outcome !== "CROSS_SITE_REFUSED" && row.sameSite === false && (row.spaces.length || row.descriptionEvidence.length));
  if (crossSiteLeak) return `CROSS_SITE_EVIDENCE_LEAK:${crossSiteLeak.listingId}`;
  const offsitePage = sample.find((row) => row.pageUrls.some((url) => !documentStaysOnAuthorisedSite(row.authorisedOfficialUrl, url)));
  if (offsitePage) return `OFFSITE_DOCUMENT:${offsitePage.listingId}`;
  const generic = sample.filter((row) => row.spaces.some((space) => confirmedSpaceLooksGeneric(space.name)));
  if (generic.length / sample.length > 0.2) return "WIDESPREAD_GENERIC_SPACES";
  const absurdCapacity = sample.filter((row) => row.capacities.some((item) => !item.reviewRequired && (item.count < 1 || item.count > 20000 || !item.statement.trim())));
  if (absurdCapacity.length / sample.length > 0.2) return "WIDESPREAD_FALSE_CAPACITIES";
  const defects = new Map<string, number>();
  for (const row of sample) {
    if (row.outcome !== "OTHER_SAFE_FAILURE") continue;
    const key = row.outcomeReason.slice(0, 180) || "OTHER_SAFE_FAILURE";
    defects.set(key, (defects.get(key) ?? 0) + 1);
  }
  for (const [key, count] of defects) {
    if (count / sample.length > 0.2) return `REPEATED_CRAWLER_DEFECT:${key}`;
  }
  return null;
}

export class VenueCrawlScheduler {
  private active = 0;
  private readonly hosts = new Set<string>();
  private readonly queue: Array<{ host: string; start: () => void }> = [];
  private readonly limit: number;

  constructor(limit: number) {
    if (limit < 1) throw new Error("CONCURRENCY_LIMIT");
    this.limit = limit;
  }

  acquire(host: string): Promise<() => void> {
    return new Promise((resolve) => {
      const start = () => {
        this.active += 1;
        this.hosts.add(host);
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.active -= 1;
          this.hosts.delete(host);
          this.pump();
        });
      };
      this.queue.push({ host, start });
      this.pump();
    });
  }

  private pump() {
    while (this.active < this.limit) {
      const index = this.queue.findIndex((item) => !this.hosts.has(item.host));
      if (index < 0) return;
      const job = this.queue.splice(index, 1)[0];
      if (!job) return;
      job.start();
    }
  }
}

export function forbidPaidProvider(url: string): void {
  const host = new URL(url).hostname.toLowerCase();
  if (host.endsWith(".openai.com") || host === "api.openai.com") throw new Error("OPENAI_CALL_FORBIDDEN");
  if (host.endsWith(".googleapis.com") || host === "maps.googleapis.com") throw new Error("GOOGLE_CALL_FORBIDDEN");
  if (host.endsWith(".apollo.io")) throw new Error("APOLLO_CALL_FORBIDDEN");
  if (host.endsWith("companieshouse.gov.uk")) throw new Error("COMPANIES_HOUSE_CALL_FORBIDDEN");
  if (/(browserless|scrapingbee|browserbase|zenrows)/i.test(host)) throw new Error("RENDER_VENDOR_FORBIDDEN");
}
