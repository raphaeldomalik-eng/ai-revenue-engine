import type { EntityType, SourceExtractor } from "../contracts.ts";
import type { Dimension, ExtractorProfile } from "./planner.ts";
import type { OriginPoliteness } from "./politeness.ts";
import type { RenderAdapter, RenderPolicy } from "./render.ts";
import type { OriginGrant, RedirectHop } from "./site-identity.ts";

export type ResolveHost = (hostname: string) => Promise<Array<{ address: string; family: number }>>;
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type CrawlBudget = {
  maxPages: number;
  maxRequests: number;
  maxBytesPerResponse: number;
  maxRedirects: number;
  maxRetries: number;
  timeoutMs: number;
  minRequestDelayMs: number;
  /** Optional internal ceilings; V1 requests omit them and receive the defaults. */
  maxPdfDocuments?: number;
  maxSitemapFetches?: number;
  maxRetryAfterMs?: number;
  /**
   * Venue crawls only. A ranked first-party venue PDF may use this ceiling
   * instead of maxBytesPerResponse. The venue PDF policy still caps it.
   * HTML and unrelated PDFs stay on maxBytesPerResponse.
   */
  maxRelevantPdfBytes?: number;
};
export type DocumentKind = "HTML" | "PDF" | "CALENDAR";
export type FetchedDocument = {
  url: string;
  body: string;
  contentType: string | null;
  bytes: number;
  sourceHash: string;
  observedAt: string;
  kind?: DocumentKind;
  /** PDF text per page (1-based page N is index N-1); absent for HTML. */
  pdfPages?: string[];
  etag?: string | null;
  lastModified?: string | null;
  retrieval?: "STATIC" | "RENDERED" | "CACHE_FRESH" | "REVALIDATED";
  /** Deterministic markup derived from embedded hydration data in this same response. */
  derivedMarkup?: string;
  shellSignals?: string[];
};
export type CrawlStats = {
  requestCount: number;
  pageCount: number;
  bytesRead: number;
  redirects: number;
  blockedCount: number;
  retries: number;
  warnings: string[];
  status: "COMPLETED" | "PARTIAL" | "BLOCKED" | "FAILED";
  failureClass?: "TERMINAL" | "RETRYABLE";
};
export type CrawlStopReason =
  | "DIMENSIONS_SATISFIED" | "GAPS_EXHAUSTED" | "NO_GAP_CANDIDATES" | "QUEUE_EXHAUSTED" | "PAGE_BUDGET" | "REQUEST_BUDGET"
  | "ROBOTS_BLOCKED" | "ROBOTS_UNAVAILABLE" | "ENTRY_FAILED";
export type CrawlObservability = {
  verifiedUrl: string;
  canonicalOrigin: string;
  grantedOrigins: Array<{ origin: string; grant: OriginGrant }>;
  redirectChain: RedirectHop[];
  robots: Array<{ origin: string; status: "FETCHED" | "ABSENT" | "UNAVAILABLE"; sitemapDirectives: number }>;
  sitemap: { consulted: boolean; fetched: string[]; urlsSeen: number; candidatesAdded: number; reason: string | null };
  mode: "GAP_PLANNER" | "LINK_FOLLOWING";
  staticPages: number;
  renderedPages: number;
  renderNeededButUnavailable: string[];
  hydrationPages: number;
  pdfDocuments: number;
  pdfPagesWithText: number;
  requests: number;
  bytes: number;
  redirects: number;
  retries: number;
  retryAfterWaits: number;
  cacheFreshHits: number;
  revalidatedNotModified: number;
  singleFlightHits: number;
  blockedPages: Array<{ url: string; reason: string }>;
  skippedContent: Array<{ url: string; reason: string }>;
  selections: Array<{ url: string; kind: string; reason: string }>;
  dimensionsRequested: Dimension[];
  dimensionsSatisfied: Dimension[];
  dimensionsMissing: Dimension[];
  stopReason: CrawlStopReason;
  /** Contact-page candidates still queued when the crawl stopped. Zero means none remained. */
  contactPathsRemaining: number;
  finalStatus: CrawlStats["status"];
  subjectType: EntityType;
  extractors: SourceExtractor[];
  /** Filled after extraction by the caller that ran the extractors (see observability.ts). */
  extractorYields?: ExtractorYields;
};
export type ExtractorYields = {
  identityFacts: number;
  contacts: { email: number; phone: number; form: number; other: number; reviewRequired: number };
  venueFacts: { spaces: number; namedSpaceCapacities: number; venueCapacities: number; facilities: number; accessibility: number; conflicts: number; reviewRequired: number };
  images: { total: number; restricted: number; unknownRights: number; exactVenue: number };
  events: number;
  evidenceRefs: number;
  pdfEvidence: number;
};
export type CrawlOutput = {
  verifiedUrl: string;
  finalUrl: string;
  documents: FetchedDocument[];
  stats: CrawlStats;
  canonicalOrigin?: string;
  observability?: CrawlObservability;
};

/** Prior observation of one URL; supplied by the caller's existing evidence store, not a crawler-owned cache. */
export type CachedDocument = FetchedDocument & { etag: string | null; lastModified: string | null };
export type DocumentCache = {
  get(url: string): Promise<CachedDocument | null>;
  set(document: CachedDocument): Promise<void>;
};

export type CrawlInput = {
  verifiedUrl: string;
  requestedExtractors: SourceExtractor[];
  budget: CrawlBudget;
  /** Recorded for telemetry only; the core never branches on subject type. */
  subjectType?: EntityType;
  /** Extractor profiles that prioritise pages and judge sufficiency; defaults to the registry for requestedExtractors. */
  profiles?: ExtractorProfile[];
  fetchImpl?: FetchLike;
  resolveHost?: ResolveHost;
  userAgent?: string;
  politeness?: OriginPoliteness;
  documentCache?: DocumentCache;
  /** Documents observed within this window are reused without a request; older ones are revalidated. */
  freshnessMaxAgeHours?: number;
  renderAdapter?: RenderAdapter;
  renderPolicy?: RenderPolicy;
  /** When set, PUBLIC_CONTACT:EMAIL stays open until an accepted venue email is evidenced. */
  emailGoal?: boolean;
  venueName?: string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};
