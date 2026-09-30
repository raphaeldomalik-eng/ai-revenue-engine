import { createHash } from "node:crypto";
import type { SourceExtractor } from "../contracts.ts";
import { classifyContent, decodeText, refuseByHeaders, TYPE_BYTE_LIMITS, type ContentKind } from "./content.ts";
import { extractEventsFromDocuments } from "./extractors/events.ts";
import { createObservation, profilesFor } from "./extractors/profiles.ts";
import { extractResourcesFromDocuments } from "./extractors/resources.ts";
import { hrefTags, visibleText } from "./html.ts";
import { calendarFallbackUrl, discoverCalendarUrls, discoverLikelyEventDetailUrls, discoverUsefulSourceUrls } from "./links.ts";
import { assertPublicNetworkTarget, canonicalHttpsUrl, classifyTransportFailure, defaultResolveHost, DiscoveryTimeout, fetchPinned, NetworkRefusal, UnsupportedContent } from "./network.ts";
import { extractPdfText } from "./pdf.ts";
import { GapPlanner, isPdfUrl, planableUrl, planKey, type Dimension, type DocumentObservation, type ExtractorProfile, type ProfileState } from "./planner.ts";
import { parseRetryAfter, sharedOriginPoliteness, type OriginPoliteness, type ResponseSnapshot } from "./politeness.ts";
import { DEFAULT_RENDER_POLICY, guardedRender } from "./render.ts";
import { SiteIdentity } from "./site-identity.ts";
import { conventionalSitemapUrls, inflateSitemap, parseSitemap, rankChildSitemaps, robotsSitemapDirectives, SITEMAP_LIMITS } from "./sitemap.ts";
import { assessStaticRetrieval, hydrationMarkup } from "./spa.ts";
import type { CachedDocument, CrawlBudget, CrawlInput, CrawlObservability, CrawlOutput, CrawlStats, CrawlStopReason, FetchLike, FetchedDocument, ResolveHost } from "./types.ts";

export { assertPublicNetworkTarget, canonicalHttpsUrl, isPublicHttpsUrl, isPublicNetworkAddress } from "./network.ts";
export type { CrawlBudget, CrawlInput, CrawlObservability, CrawlOutput, CrawlStats, FetchLike, FetchedDocument, ResolveHost } from "./types.ts";

const DEFAULT_MAX_PDFS = 3;
const DEFAULT_MAX_RETRY_AFTER_MS = 30_000;
const PAGE_ACCEPT = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1";
const CALENDAR_ACCEPT = "text/calendar,*/*;q=0.1";
const PDF_ACCEPT = "application/pdf,*/*;q=0.1";
const SITEMAP_ACCEPT = "application/xml,text/xml;q=0.9,text/plain;q=0.5,*/*;q=0.1";

function realSleep(ms: number) {
  return ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export function robotsAllows(robotsText: string, targetUrl: string, token: string): boolean {
  if (!robotsText.trim()) return true;
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = [];
  let agents: string[] = [];
  let rules: Array<{ allow: boolean; path: string }> = [];
  const flush = () => {
    if (agents.length || rules.length) groups.push({ agents, rules });
    agents = [];
    rules = [];
  };
  for (const raw of robotsText.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const index = line.indexOf(":");
    if (!line || index < 0) continue;
    const key = line.slice(0, index).toLowerCase().trim();
    const value = line.slice(index + 1).trim();
    if (key === "user-agent") {
      if (rules.length) flush();
      agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && agents.length && value) {
      rules.push({ allow: key === "allow", path: value });
    }
  }
  flush();
  const normalized = token.toLowerCase();
  const specific = groups.filter((group) => group.agents.some((agent) => agent !== "*" && normalized.includes(agent)));
  const applicable = specific.length ? specific : groups.filter((group) => group.agents.includes("*"));
  const target = new URL(targetUrl);
  const path = `${target.pathname || "/"}${target.search}`;
  const matching = applicable.flatMap((group) => group.rules)
    .filter((rule) => {
      const anchored = rule.path.endsWith("$");
      const body = anchored ? rule.path.slice(0, -1) : rule.path;
      const pattern = body.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
      return new RegExp(`^${pattern}${anchored ? "$" : ""}`).test(path);
    })
    .sort((a, b) => b.path.replace(/\*/g, "").length - a.path.replace(/\*/g, "").length || Number(b.allow) - Number(a.allow));
  return matching[0]?.allow ?? true;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

class CrawlRefusal extends Error {
  failureClass: "TERMINAL" | "RETRYABLE";
  /** A transport failure that a bounded in-crawl retry may resolve. */
  transient: boolean;

  constructor(message: string, failureClass: "TERMINAL" | "RETRYABLE", transient = false) {
    super(message);
    this.name = "CrawlRefusal";
    this.failureClass = failureClass;
    this.transient = transient;
  }
}

function transportRefusal(error: unknown): CrawlRefusal {
  const failure = classifyTransportFailure(error);
  return new CrawlRefusal(refusalMessage(error, "Discovery request failed."), failure === "CERTIFICATE" ? "TERMINAL" : "RETRYABLE", failure === "TRANSIENT");
}

/** A transient transport retry is taken only inside maxRetries and only while the request budget has room. */
function canRetryTransient(ctx: Ctx, error: unknown, attempt: number): error is CrawlRefusal {
  return error instanceof CrawlRefusal && error.transient && attempt < ctx.budget.maxRetries && ctx.stats.requestCount < ctx.budget.maxRequests;
}

function backoff(ctx: Ctx, attempt: number) {
  return ctx.sleep(Math.min(250 * 2 ** attempt, 2000));
}

function redirectRefusal(from: string, location: string | null, reason: string): CrawlRefusal {
  let host = "";
  try { host = location ? new URL(location, from).hostname.toLowerCase() : ""; } catch { /* invalid location has no host */ }
  return new CrawlRefusal(`Redirect target is not an allowed same-site public HTTPS URL (${reason}${host ? `; refused host ${host}` : ""}).`, "TERMINAL");
}

class ContentSkipped extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentSkipped";
  }
}

function refusalMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function rememberFailure(stats: CrawlStats, error: unknown) {
  if (!(error instanceof CrawlRefusal)) return;
  if (error.failureClass === "TERMINAL" || stats.failureClass !== "TERMINAL") stats.failureClass = error.failureClass;
}

type RobotsRecord = { text: string; status: "FETCHED" | "ABSENT" | "UNAVAILABLE"; error?: CrawlRefusal };

type Ctx = {
  budget: CrawlBudget;
  stats: CrawlStats;
  obs: CrawlObservability;
  site: SiteIdentity;
  fetchImpl?: FetchLike;
  resolveHost: ResolveHost;
  userAgent: string;
  politeness: OriginPoliteness;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  robots: Map<string, RobotsRecord>;
  input: CrawlInput;
  singleFlightBase: number;
};

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new DiscoveryTimeout()), timeoutMs); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** One network request: public-network check, budget accounting, per-origin politeness, single-flight, size ceiling. */
async function networkRequest(ctx: Ctx, url: string, accept: string, maxBytes: number, headers: Record<string, string> = {}): Promise<ResponseSnapshot> {
  try {
    if (ctx.fetchImpl) await assertPublicNetworkTarget(url, ctx.resolveHost);
  } catch (error) {
    if (!(error instanceof NetworkRefusal)) {
      // A resolver failure is a transport attempt, counted exactly as the pinned production path counts it.
      ctx.stats.requestCount += 1;
      throw transportRefusal(error);
    }
    ctx.stats.blockedCount += 1;
    ctx.obs.blockedPages.push({ url, reason: "NON_PUBLIC_NETWORK_TARGET" });
    throw new CrawlRefusal(refusalMessage(error, "Refused a non-public HTTPS URL."), "TERMINAL");
  }
  ctx.stats.requestCount += 1;
  const origin = new URL(url).origin;
  const key = `${url}\n${accept}\n${JSON.stringify(headers)}`;
  try {
    return await ctx.politeness.singleFlight(key, () => ctx.politeness.run(origin, ctx.budget.minRequestDelayMs, async () => {
      if (!ctx.fetchImpl) {
        const response = await fetchPinned({ url, resolveHost: ctx.resolveHost, userAgent: ctx.userAgent, accept, maxBytes, timeoutMs: ctx.budget.timeoutMs, headers, refuseContentType: refuseByHeaders });
        return { status: response.status, headers: response.headers, bytes: new Uint8Array(await response.arrayBuffer()) };
      }
      const fetchImpl = ctx.fetchImpl;
      return withTimeout((async () => {
        const response = await fetchImpl(url, { redirect: "manual", headers: { "User-Agent": ctx.userAgent, Accept: accept, ...headers } });
        const contentType = response.headers.get("content-type");
        const refusal = response.status >= 200 && response.status < 300 ? refuseByHeaders(contentType) : null;
        if (refusal) {
          await response.body?.cancel().catch(() => undefined);
          throw new UnsupportedContent(refusal);
        }
        const contentLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > maxBytes) {
          await response.body?.cancel().catch(() => undefined);
          throw new Error("Response exceeded the discovery size limit.");
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > maxBytes) throw new Error("Response exceeded the discovery size limit.");
        return { status: response.status, headers: response.headers, bytes };
      })(), ctx.budget.timeoutMs);
    }));
  } catch (error) {
    if (error instanceof CrawlRefusal) throw error;
    if (error instanceof UnsupportedContent) throw new ContentSkipped(error.message);
    if (error instanceof NetworkRefusal) throw new CrawlRefusal(error.message, "TERMINAL");
    if (error instanceof Error && error.message === "Response exceeded the discovery size limit.") throw error;
    throw transportRefusal(error);
  }
}

/** Backoff honours Retry-After (bounded) and shares the cooldown with every crawl of the same origin. */
async function retryDelay(ctx: Ctx, snapshot: ResponseSnapshot, url: string, attempt: number): Promise<"RETRY" | "DEFER"> {
  const origin = new URL(url).origin;
  const retryAfter = parseRetryAfter(snapshot.headers.get("retry-after"), ctx.now().getTime());
  if (retryAfter !== null) {
    ctx.politeness.noteRetryAfter(origin, retryAfter);
    if (retryAfter > (ctx.budget.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS)) return "DEFER";
    ctx.obs.retryAfterWaits += 1;
    return "RETRY";
  }
  await backoff(ctx, attempt);
  return "RETRY";
}

async function fetchRobots(ctx: Ctx, origin: string): Promise<string> {
  let current = `${origin}/robots.txt`;
  let redirects = 0;
  let attempt = 0;
  const maxBytes = Math.min(ctx.budget.maxBytesPerResponse, 500_000);
  for (;;) {
    if (ctx.stats.requestCount >= ctx.budget.maxRequests) {
      throw new CrawlRefusal("Crawl request budget exhausted before robots.txt could be checked.", "TERMINAL");
    }
    let snapshot: ResponseSnapshot;
    try {
      snapshot = await networkRequest(ctx, current, "text/plain,*/*;q=0.1", maxBytes);
    } catch (error) {
      if (error instanceof ContentSkipped) return "";
      if (canRetryTransient(ctx, error, attempt)) {
        await backoff(ctx, attempt);
        ctx.stats.retries += 1;
        attempt += 1;
        continue;
      }
      if (error instanceof CrawlRefusal) throw error;
      throw new CrawlRefusal(refusalMessage(error, "robots.txt request failed."), "TERMINAL");
    }
    if (REDIRECT_STATUSES.has(snapshot.status)) {
      const location = snapshot.headers.get("location");
      const decision = ctx.site.decideRedirect(current, location, snapshot.status, "ROBOTS");
      if (!decision.next) {
        ctx.stats.blockedCount += 1;
        throw redirectRefusal(current, location, decision.reason);
      }
      if (redirects >= ctx.budget.maxRedirects) throw new CrawlRefusal("Redirect budget exhausted.", "TERMINAL");
      current = decision.next;
      redirects += 1;
      ctx.stats.redirects += 1;
      attempt = 0;
      continue;
    }
    if ((snapshot.status === 429 || snapshot.status >= 500) && attempt < ctx.budget.maxRetries) {
      if (await retryDelay(ctx, snapshot, current, attempt) === "DEFER") throw new CrawlRefusal(`robots.txt returned HTTP ${snapshot.status} with a Retry-After beyond the crawl bound.`, "RETRYABLE");
      ctx.stats.retries += 1;
      attempt += 1;
      continue;
    }
    if (snapshot.status === 429 || snapshot.status >= 500) throw new CrawlRefusal(`robots.txt returned HTTP ${snapshot.status}`, "RETRYABLE");
    if (snapshot.status === 404 || snapshot.status === 410) return "";
    if (snapshot.status < 200 || snapshot.status >= 300) throw new CrawlRefusal(`robots.txt returned HTTP ${snapshot.status}`, "TERMINAL");
    if (snapshot.bytes.length > maxBytes) throw new CrawlRefusal("robots.txt exceeded the discovery size limit.", "TERMINAL");
    return decodeText(snapshot.bytes, snapshot.headers.get("content-type"));
  }
}

async function ensureRobots(ctx: Ctx, origin: string): Promise<RobotsRecord> {
  const existing = ctx.robots.get(origin);
  if (existing) return existing;
  let record: RobotsRecord;
  try {
    const text = await fetchRobots(ctx, origin);
    record = { text, status: text ? "FETCHED" : "ABSENT" };
  } catch (error) {
    record = { text: "", status: "UNAVAILABLE", error: error instanceof CrawlRefusal ? error : new CrawlRefusal(refusalMessage(error, "robots.txt unavailable"), "RETRYABLE") };
  }
  ctx.robots.set(origin, record);
  ctx.obs.robots.push({ origin, status: record.status, sitemapDirectives: robotsSitemapDirectives(record.text).length });
  return record;
}

async function robotsFor(ctx: Ctx, url: string): Promise<string> {
  const record = await ensureRobots(ctx, new URL(url).origin);
  if (record.status === "UNAVAILABLE") {
    ctx.stats.blockedCount += 1;
    throw new CrawlRefusal(`robots.txt for ${new URL(url).origin} could not be checked: ${record.error?.message ?? "unavailable"}`, record.error?.failureClass ?? "RETRYABLE");
  }
  return record.text;
}

type FetchMode = { expected: "PAGE" | "CALENDAR" | "PDF" | "SITEMAP"; entry: boolean };

/** Fetch with redirect, robots, retry, revalidation, and content-type safety. */
async function fetchResource(ctx: Ctx, url: string, mode: FetchMode): Promise<{ url: string; snapshot: ResponseSnapshot; kind: ContentKind; cached?: CachedDocument; notModified?: boolean }> {
  let current = url;
  let redirects = 0;
  const accept = mode.expected === "CALENDAR" ? CALENDAR_ACCEPT : mode.expected === "PDF" ? PDF_ACCEPT : mode.expected === "SITEMAP" ? SITEMAP_ACCEPT : PAGE_ACCEPT;
  const cache = mode.expected === "SITEMAP" ? undefined : ctx.input.documentCache;
  for (let attempt = 0; attempt <= ctx.budget.maxRetries; attempt += 1) {
    const robotsText = await robotsFor(ctx, current);
    if (!robotsAllows(robotsText, current, ctx.userAgent)) {
      ctx.stats.blockedCount += 1;
      ctx.obs.blockedPages.push({ url: current, reason: "ROBOTS_DISALLOW" });
      throw new Error(`robots.txt disallows ${current}`);
    }
    const cached = cache ? await cache.get(current) : null;
    if (cached && ctx.input.freshnessMaxAgeHours && ctx.now().getTime() - Date.parse(cached.observedAt) <= ctx.input.freshnessMaxAgeHours * 3_600_000) {
      ctx.obs.cacheFreshHits += 1;
      return { url: current, snapshot: { status: 200, headers: new Headers(), bytes: new Uint8Array() }, kind: cached.kind ?? "HTML", cached };
    }
    if (ctx.stats.requestCount >= ctx.budget.maxRequests) throw new Error("Crawl request budget exhausted.");
    const conditional: Record<string, string> = {};
    if (cached?.etag) conditional["If-None-Match"] = cached.etag;
    if (cached?.lastModified) conditional["If-Modified-Since"] = cached.lastModified;
    const typeCeiling = mode.expected === "PDF" ? TYPE_BYTE_LIMITS.PDF : mode.expected === "SITEMAP" ? TYPE_BYTE_LIMITS.XML : TYPE_BYTE_LIMITS.HTML;
    let snapshot: ResponseSnapshot;
    try {
      snapshot = await networkRequest(ctx, current, accept, Math.min(ctx.budget.maxBytesPerResponse, typeCeiling), conditional);
    } catch (error) {
      if (!canRetryTransient(ctx, error, attempt)) throw error;
      await backoff(ctx, attempt);
      ctx.stats.retries += 1;
      continue;
    }
    if (snapshot.status === 304 && cached) {
      ctx.obs.revalidatedNotModified += 1;
      return { url: current, snapshot, kind: cached.kind ?? "HTML", cached, notModified: true };
    }
    if (REDIRECT_STATUSES.has(snapshot.status)) {
      const location = snapshot.headers.get("location");
      const decision = ctx.site.decideRedirect(current, location, snapshot.status, mode.entry && redirects < ctx.budget.maxRedirects ? "ENTRY" : "PAGE");
      if (!decision.next) {
        ctx.stats.blockedCount += 1;
        ctx.stats.failureClass = "TERMINAL";
        ctx.obs.blockedPages.push({ url: current, reason: `REDIRECT_${decision.reason}` });
        throw redirectRefusal(current, location, decision.reason);
      }
      if (redirects >= ctx.budget.maxRedirects) throw new CrawlRefusal("Redirect budget exhausted.", "TERMINAL");
      current = decision.next;
      redirects += 1;
      ctx.stats.redirects += 1;
      attempt -= 1;
      continue;
    }
    if ((snapshot.status === 429 || snapshot.status >= 500) && attempt < ctx.budget.maxRetries) {
      if (await retryDelay(ctx, snapshot, current, attempt) === "DEFER") throw new CrawlRefusal(`HTTP ${snapshot.status} from ${current} with a Retry-After beyond the crawl bound; deferred.`, "RETRYABLE");
      ctx.stats.retries += 1;
      continue;
    }
    if (snapshot.status === 429 || snapshot.status >= 500) throw new CrawlRefusal(`HTTP ${snapshot.status} from ${current}`, "RETRYABLE");
    if (snapshot.status < 200 || snapshot.status >= 300) throw new CrawlRefusal(`HTTP ${snapshot.status} from ${current}`, "TERMINAL");
    const decision = classifyContent(snapshot.headers.get("content-type"), snapshot.bytes, current, mode.expected);
    if (!decision.kind) throw new ContentSkipped(decision.reason);
    if (snapshot.bytes.length > Math.min(ctx.budget.maxBytesPerResponse, TYPE_BYTE_LIMITS[decision.kind])) throw new ContentSkipped(`${decision.kind} body exceeded its size limit.`);
    return { url: current, snapshot, kind: decision.kind };
  }
  throw new CrawlRefusal(`Retries exhausted for ${current}`, "RETRYABLE");
}

async function fetchDocument(ctx: Ctx, url: string, mode: FetchMode): Promise<FetchedDocument> {
  const result = await fetchResource(ctx, url, mode);
  const observedAt = ctx.now().toISOString();
  if (result.cached) {
    return { ...result.cached, url: result.url, observedAt: result.notModified ? observedAt : result.cached.observedAt, retrieval: result.notModified ? "REVALIDATED" : "CACHE_FRESH" };
  }
  const contentType = result.snapshot.headers.get("content-type");
  const etag = result.snapshot.headers.get("etag");
  const lastModified = result.snapshot.headers.get("last-modified");
  let document: FetchedDocument;
  if (result.kind === "PDF") {
    const pdf = extractPdfText(result.snapshot.bytes);
    for (const warning of pdf.warnings) ctx.stats.warnings.push(`PDF ${result.url}: ${warning}`);
    document = {
      url: result.url, body: pdf.pages.join("\n\f\n"), contentType, bytes: result.snapshot.bytes.length,
      sourceHash: createHash("sha256").update(result.snapshot.bytes).digest("hex"), observedAt, kind: "PDF", pdfPages: pdf.pages,
      etag, lastModified, retrieval: "STATIC",
    };
  } else {
    const body = decodeText(result.snapshot.bytes, contentType);
    document = { url: result.url, body, bytes: result.snapshot.bytes.length, contentType, sourceHash: hashText(body), observedAt, kind: result.kind === "CALENDAR" ? "CALENDAR" : "HTML", etag, lastModified, retrieval: "STATIC" };
  }
  if (ctx.input.documentCache && mode.expected !== "SITEMAP") await ctx.input.documentCache.set({ ...document, etag, lastModified });
  return document;
}

function emptyObservability(verifiedUrl: string, site: SiteIdentity, args: CrawlInput, profiles: ExtractorProfile[]): CrawlObservability {
  return {
    verifiedUrl, canonicalOrigin: site.canonicalOrigin, grantedOrigins: [], redirectChain: [], robots: [],
    sitemap: { consulted: false, fetched: [], urlsSeen: 0, candidatesAdded: 0, reason: null },
    mode: gapPlanned(profiles) ? "GAP_PLANNER" : "LINK_FOLLOWING",
    subjectType: args.subjectType ?? "UNKNOWN", extractors: [...args.requestedExtractors],
    staticPages: 0, renderedPages: 0, renderNeededButUnavailable: [], hydrationPages: 0, pdfDocuments: 0, pdfPagesWithText: 0,
    requests: 0, bytes: 0, redirects: 0, retries: 0, retryAfterWaits: 0, cacheFreshHits: 0, revalidatedNotModified: 0, singleFlightHits: 0,
    blockedPages: [], skippedContent: [], selections: [], dimensionsRequested: [...new Set(profiles.flatMap((profile) => profile.dimensions))], dimensionsSatisfied: [], dimensionsMissing: [],
    stopReason: "QUEUE_EXHAUSTED", finalStatus: "COMPLETED",
  };
}

function finish(ctx: Ctx, output: { verifiedUrl: string; finalUrl: string; documents: FetchedDocument[] }, stopReason: CrawlStopReason, satisfied: Dimension[] = []): CrawlOutput {
  const obs = ctx.obs;
  obs.canonicalOrigin = ctx.site.canonicalOrigin;
  obs.grantedOrigins = ctx.site.grantedOrigins();
  obs.redirectChain = [...ctx.site.redirectChain];
  obs.requests = ctx.stats.requestCount;
  obs.bytes = ctx.stats.bytesRead;
  obs.redirects = ctx.stats.redirects;
  obs.retries = ctx.stats.retries;
  obs.singleFlightHits = ctx.politeness.singleFlightHits - ctx.singleFlightBase;
  obs.stopReason = stopReason;
  obs.finalStatus = ctx.stats.status;
  obs.dimensionsSatisfied = obs.dimensionsRequested.filter((dim) => satisfied.includes(dim));
  obs.dimensionsMissing = obs.dimensionsRequested.filter((dim) => !satisfied.includes(dim));
  return { ...output, stats: ctx.stats, canonicalOrigin: ctx.site.canonicalOrigin, observability: obs };
}

/** Thin static shells are first read through embedded hydration data, then (only if still inadequate) rendered. */
async function completeStaticRetrieval(ctx: Ctx, document: FetchedDocument, renderedSoFar: { count: number }): Promise<FetchedDocument> {
  if (document.kind !== "HTML") return document;
  const assessment = assessStaticRetrieval(document.body);
  const derived = hydrationMarkup(assessment);
  const enriched: FetchedDocument = derived ? { ...document, derivedMarkup: derived, shellSignals: assessment.signals } : assessment.shell ? { ...document, shellSignals: assessment.signals } : document;
  if (derived) ctx.obs.hydrationPages += 1;
  const hydrationAdequate = visibleText(derived).length >= 400;
  if (!assessment.shell || hydrationAdequate) return enriched;
  const adapter = ctx.input.renderAdapter;
  const policy = ctx.input.renderPolicy ?? DEFAULT_RENDER_POLICY;
  if (!adapter || renderedSoFar.count >= policy.maxRenderedPages) {
    ctx.obs.renderNeededButUnavailable.push(document.url);
    ctx.stats.warnings.push(adapter
      ? `Static retrieval of ${document.url} is a client-rendered shell (${assessment.signals.join(", ")}); the rendered-page bound was reached.`
      : `Static retrieval of ${document.url} is a client-rendered shell (${assessment.signals.join(", ")}); no rendering adapter is available in this runtime.`);
    return enriched;
  }
  try {
    renderedSoFar.count += 1;
    const robotsText = ctx.robots.get(new URL(document.url).origin)?.text ?? "";
    const rendered = await guardedRender({
      adapter, url: document.url, policy, maxBytes: Math.min(ctx.budget.maxBytesPerResponse, TYPE_BYTE_LIMITS.HTML), userAgent: ctx.userAgent,
      resolveHost: ctx.resolveHost, isAllowedOrigin: (origin) => ctx.site.isAllowedOrigin(origin), robotsAllows: (url) => robotsAllows(robotsText, url, ctx.userAgent),
    });
    ctx.stats.requestCount += 1;
    ctx.obs.renderedPages += 1;
    return { ...document, url: rendered.finalUrl, body: rendered.html, bytes: Buffer.byteLength(rendered.html, "utf8"), sourceHash: hashText(rendered.html), retrieval: "RENDERED", shellSignals: assessment.signals, derivedMarkup: derived || undefined };
  } catch (error) {
    ctx.stats.warnings.push(`Rendered fallback for ${document.url} failed safely: ${refusalMessage(error, "unknown error")}`);
    return enriched;
  }
}

async function legacyLinkFollowing(ctx: Ctx, args: CrawlInput, verifiedUrl: string): Promise<CrawlOutput> {
  const documents: FetchedDocument[] = [];
  const queue: Array<{ url: string; calendar: boolean }> = [{ url: verifiedUrl, calendar: false }];
  const queuedPages = new Set([verifiedUrl]);
  const queuedCalendars = new Set<string>();
  let calendarBudgetTruncated = false;
  let requiredTraversalIncomplete = false;
  const rendered = { count: 0 };
  while (queue.length && ctx.stats.requestCount < args.budget.maxRequests) {
    const item = queue.shift()!;
    const next = item.url;
    const robotsText = ctx.robots.get(new URL(next).origin)?.text ?? "";
    if (ctx.robots.has(new URL(next).origin) && !robotsAllows(robotsText, next, ctx.userAgent)) {
      ctx.stats.blockedCount += 1;
      if (item.calendar) ctx.stats.warnings.push(`Optional calendar skipped by robots.txt: ${next}`);
      else {
        ctx.stats.warnings.push(`robots.txt disallows required HTML source: ${next}`);
        requiredTraversalIncomplete = true;
      }
      continue;
    }
    try {
      let document = await fetchDocument(ctx, next, { expected: item.calendar ? "CALENDAR" : "PAGE", entry: next === verifiedUrl && documents.length === 0 });
      if (document.url !== next) queuedPages.add(document.url);
      if (!item.calendar) document = await completeStaticRetrieval(ctx, document, rendered);
      documents.push(document);
      ctx.stats.bytesRead += document.bytes;
      if (item.calendar) continue;
      ctx.stats.pageCount += 1;
      if (document.kind === "PDF") { ctx.obs.pdfDocuments += 1; continue; }
      if (document.retrieval !== "RENDERED") ctx.obs.staticPages += 1;
      const sourceLinks = discoverUsefulSourceUrls(document, args.requestedExtractors, ctx.site);
      const detailLinks = args.requestedExtractors.includes("EVENTS") && !extractEventsFromDocuments([document]).eventCandidates.length
        ? discoverLikelyEventDetailUrls(document, ctx.site)
        : [];
      for (const link of [...new Set([...sourceLinks, ...detailLinks])]) {
        if (/\.ics(?:$|\?)|[?&]format=ical(?:&|$)/i.test(link)) continue;
        if (!queuedPages.has(link) && ctx.site.isAllowedOrigin(new URL(link).origin) && queuedPages.size < args.budget.maxPages) {
          queuedPages.add(link);
          queue.push({ url: link, calendar: false });
        }
      }
      if (args.requestedExtractors.includes("EVENTS")) {
        const explicit = discoverCalendarUrls(document, ctx.site);
        const fallback = explicit.length || extractEventsFromDocuments([document]).eventCandidates.length ? [] : [calendarFallbackUrl(document)].filter((url): url is string => Boolean(url));
        for (const url of [...explicit, ...fallback]) {
          if (queuedCalendars.has(url) || queuedPages.has(url)) continue;
          if (queuedPages.size + queuedCalendars.size >= args.budget.maxRequests - 1) {
            calendarBudgetTruncated = true;
            continue;
          }
          queuedCalendars.add(url);
          queue.push({ url, calendar: true });
        }
      }
    } catch (error) {
      rememberFailure(ctx.stats, error);
      if (error instanceof ContentSkipped) ctx.obs.skippedContent.push({ url: next, reason: error.message });
      if (item.calendar) ctx.stats.warnings.push(`Optional calendar unavailable: ${next}: ${error instanceof Error ? error.message : "unknown error"}`);
      else {
        ctx.stats.warnings.push(`Required HTML source unavailable: ${next}: ${error instanceof Error ? error.message : "unknown error"}`);
        requiredTraversalIncomplete = true;
      }
      if (ctx.stats.requestCount >= args.budget.maxRequests) break;
    }
  }
  const pendingRequiredHtml = queue.some((item) => !item.calendar);
  if (pendingRequiredHtml) {
    requiredTraversalIncomplete = true;
    ctx.stats.warnings.push("Required HTML pages remain beyond the finite crawl budget.");
  }
  if (queue.some((item) => item.calendar) || calendarBudgetTruncated) ctx.stats.warnings.push("Optional calendar evidence was omitted at the finite crawl budget.");
  if (!documents.length) ctx.stats.status = ctx.stats.blockedCount ? "BLOCKED" : "FAILED";
  else if (requiredTraversalIncomplete) ctx.stats.status = "PARTIAL";
  if (ctx.stats.status === "COMPLETED" || ctx.stats.status === "PARTIAL") ctx.stats.failureClass = undefined;
  const stop: CrawlStopReason = !documents.length ? "ENTRY_FAILED" : pendingRequiredHtml ? "REQUEST_BUDGET" : "QUEUE_EXHAUSTED";
  return finish(ctx, { verifiedUrl, finalUrl: documents[0]?.url ?? verifiedUrl, documents }, stop, documents.length ? ctx.obs.dimensionsRequested : []);
}

const ICS_URL = /\.ics(?:$|\?)|[?&]format=ical(?:&|$)/i;
const TRACKING_PARAM = /^(?:tracking|utm_[a-z_]+|fbclid|gclid|mc_[a-z]+)$/i;

/** Aggregates extractor profiles; the core only combines their answers, it never interprets a dimension. */
class ProfileSet {
  readonly profiles: ExtractorProfile[];
  readonly requested: Dimension[];
  readonly priority: Dimension[];
  private readonly states = new Map<string, ProfileState>();

  constructor(profiles: ExtractorProfile[]) {
    this.profiles = profiles;
    this.requested = [...new Set(profiles.flatMap((profile) => profile.dimensions))];
    this.priority = [...new Set(profiles.flatMap((profile) => profile.priorityDimensions))];
    for (const profile of profiles) this.states.set(profile.extractor, {});
  }

  linkDimensions(url: string, label: string): Dimension[] {
    return [...new Set(this.profiles.flatMap((profile) => profile.linkDimensions(url, label)))];
  }

  pdfDimensions(url: string, label: string): Dimension[] | null {
    const dims = this.profiles.flatMap((profile) => profile.pdfDimensions(url, label) ?? []);
    return dims.length ? [...new Set(dims)] : null;
  }

  strength(url: string, label: string): number {
    return Math.max(1, ...this.profiles.map((profile) => profile.linkStrength?.(url, label) ?? 1));
  }

  observe(document: FetchedDocument, observation: DocumentObservation, selectedFor: Dimension[]): Dimension[] {
    for (const profile of this.profiles) profile.observe(document, observation, this.states.get(profile.extractor)!, selectedFor);
    return this.profiles.flatMap((profile) => profile.satisfied(this.states.get(profile.extractor)!));
  }

  followUps(document: FetchedDocument, observation: DocumentObservation, open: Set<Dimension>) {
    return this.profiles.flatMap((profile) => profile.followUps?.(document, observation, open) ?? []);
  }
}

function anchorLinks(document: FetchedDocument): Array<{ href: string; label: string; type: string }> {
  return hrefTags(`${document.body}${document.derivedMarkup ?? ""}`).map((anchor) => ({ href: anchor.attrs.href ?? "", label: visibleText(anchor.inner).slice(0, 200) || (anchor.attrs.title ?? anchor.attrs["aria-label"] ?? ""), type: anchor.attrs.type ?? "" }));
}

async function consultSitemaps(ctx: Ctx, planner: GapPlanner, set: ProfileSet, reason: string) {
  const obs = ctx.obs.sitemap;
  obs.consulted = true;
  obs.reason = reason;
  const origin = ctx.site.canonicalOrigin;
  const robots = await ensureRobots(ctx, origin).catch(() => null);
  const declared = robotsSitemapDirectives(robots?.text ?? "").map((url) => ctx.site.canonicalize(url, `${origin}/`)).filter((url): url is string => Boolean(url) && ctx.site.isAllowedOrigin(new URL(url!).origin));
  const queue: Array<{ url: string; depth: number }> = (declared.length ? declared : conventionalSitemapUrls(origin)).map((url) => ({ url, depth: 0 }));
  const seen = new Set<string>();
  const maxFetches = ctx.budget.maxSitemapFetches ?? SITEMAP_LIMITS.maxFetches;
  const open = new Set(planner.unsatisfied());
  let foundUrlset = false;
  while (queue.length && obs.fetched.length < maxFetches && ctx.stats.requestCount < ctx.budget.maxRequests - 1) {
    const item = queue.shift()!;
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    if (foundUrlset && item.depth === 0 && !declared.length) break;
    try {
      const result = await fetchResource(ctx, item.url, { expected: "SITEMAP", entry: false });
      obs.fetched.push(result.url);
      const bytes = result.kind === "GZIP" ? inflateSitemap(result.snapshot.bytes) : result.snapshot.bytes;
      if (!bytes) { ctx.stats.warnings.push(`Sitemap ${item.url} could not be decompressed within bounds.`); continue; }
      const parsed = parseSitemap(decodeText(bytes, result.snapshot.headers.get("content-type")));
      obs.urlsSeen += parsed.urls.length;
      if (parsed.kind === "INDEX") {
        if (item.depth + 1 > SITEMAP_LIMITS.maxDepth) continue;
        const children = rankChildSitemaps(parsed.urls.map((entry) => ctx.site.canonicalize(entry.loc, result.url)).filter((url): url is string => Boolean(url) && ctx.site.isAllowedOrigin(new URL(url!).origin)));
        queue.unshift(...children.slice(0, maxFetches).map((url) => ({ url, depth: item.depth + 1 })));
        continue;
      }
      foundUrlset = true;
      for (const entry of parsed.urls) {
        const url = ctx.site.canonicalize(entry.loc, result.url);
        if (!url || !ctx.site.isAllowedOrigin(new URL(url).origin) || planner.has(url) || !planableUrl(url)) continue;
        const pdf = isPdfUrl(url);
        const dims = pdf ? set.pdfDimensions(url, "") : set.linkDimensions(url, "");
        if (!dims || !dims.some((dim) => open.has(dim))) continue;
        planner.add({ url, kind: pdf ? "PDF" : "PAGE", dims, source: "SITEMAP", discoveredFrom: result.url, label: "", strength: set.strength(url, "") });
        obs.candidatesAdded += 1;
      }
    } catch (error) {
      if (error instanceof ContentSkipped) ctx.obs.skippedContent.push({ url: item.url, reason: error.message });
      if (!(error instanceof CrawlRefusal && /HTTP 404|HTTP 410/.test(error.message))) ctx.stats.warnings.push(`Sitemap unavailable: ${item.url}: ${refusalMessage(error, "unknown error")}`);
    }
  }
}

async function gapPlannedCrawl(ctx: Ctx, args: CrawlInput, verifiedUrl: string, set: ProfileSet): Promise<CrawlOutput> {
  const planner = new GapPlanner(set.requested);
  const documents: FetchedDocument[] = [];
  const rendered = { count: 0 };
  const maxPdfs = args.budget.maxPdfDocuments ?? DEFAULT_MAX_PDFS;
  let pdfs = 0;
  let pages = 0;
  let retryableCandidateFailure = false;
  let stop: CrawlStopReason = "QUEUE_EXHAUSTED";
  const fetchedKeys = new Set<string>();
  planner.add({ url: verifiedUrl, kind: "PAGE", dims: set.requested, source: "ENTRY", discoveredFrom: null, label: "", strength: 100 });

  const admit = (href: string, label: string, type: string, from: FetchedDocument) => {
    const url = ctx.site.canonicalize(href, from.url);
    if (!url || planner.has(url) || url === from.url) return;
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) if (TRACKING_PARAM.test(key)) parsed.searchParams.delete(key);
    const clean = parsed.toString();
    if (planner.has(clean) || ICS_URL.test(clean) || !planableUrl(clean)) return;
    if (!ctx.site.isAllowedOrigin(parsed.origin)) {
      const dims = set.linkDimensions(clean, label).filter((dim) => set.priority.includes(dim));
      if (!dims.length || !ctx.site.admitLinkedSubdomain(clean, from.url)) return;
    }
    if (isPdfUrl(clean, type)) {
      const dims = set.pdfDimensions(clean, label);
      if (dims) planner.add({ url: clean, kind: "PDF", dims, source: "LINK", discoveredFrom: from.url, label, strength: set.strength(clean, label) });
      return;
    }
    const dims = set.linkDimensions(clean, label);
    if (dims.length) planner.add({ url: clean, kind: "PAGE", dims, source: "LINK", discoveredFrom: from.url, label, strength: set.strength(clean, label) });
  };

  let sitemapTried = false;
  for (;;) {
    if (documents.length && planner.allSatisfied()) { stop = "DIMENSIONS_SATISFIED"; break; }
    if (documents.length && !planner.open().length) { stop = "GAPS_EXHAUSTED"; break; }
    if (pages >= args.budget.maxPages) { stop = "PAGE_BUDGET"; break; }
    if (ctx.stats.requestCount >= args.budget.maxRequests) { stop = "REQUEST_BUDGET"; break; }
    if (documents.length && !sitemapTried) {
      const uncovered = planner.uncoveredGaps(set.priority);
      const spare = (args.budget.maxRequests - ctx.stats.requestCount) - Math.min(args.budget.maxPages - pages, planner.gapServingCount());
      if (uncovered.length && spare >= 1) {
        sitemapTried = true;
        await consultSitemaps(ctx, planner, set, `No linked candidate for ${uncovered.join(", ")}`);
        continue;
      }
    }
    const candidate = planner.next(pdfs < maxPdfs);
    if (!candidate) {
      if (documents.length && !sitemapTried && planner.open().some((dim) => set.priority.includes(dim)) && ctx.stats.requestCount < args.budget.maxRequests - 1) {
        sitemapTried = true;
        await consultSitemaps(ctx, planner, set, "Linked candidates exhausted with open gaps");
        continue;
      }
      stop = documents.length ? "NO_GAP_CANDIDATES" : "ENTRY_FAILED";
      break;
    }
    planner.markDone(candidate.url);
    const entry = candidate.source === "ENTRY";
    try {
      let document = await fetchDocument(ctx, candidate.url, { expected: candidate.kind, entry });
      planner.markDone(document.url);
      if (fetchedKeys.has(planKey(document.url))) continue;
      fetchedKeys.add(planKey(document.url));
      documents.push(document);
      ctx.stats.bytesRead += document.bytes;
      if (document.kind !== "CALENDAR") {
        document = await completeStaticRetrieval(ctx, document, rendered);
        documents[documents.length - 1] = document;
        ctx.stats.pageCount += 1;
        pages += 1;
        if (document.kind === "PDF") {
          pdfs += 1;
          ctx.obs.pdfDocuments += 1;
          ctx.obs.pdfPagesWithText += (document.pdfPages ?? []).filter((page) => page.trim()).length;
        } else if (document.retrieval !== "RENDERED") ctx.obs.staticPages += 1;
      }
      if (candidate.kind === "PAGE" && document.kind === "CALENDAR") continue;
      const observation = createObservation(document, args.requestedExtractors);
      planner.setSatisfied(set.observe(document, observation, candidate.dims));
      if (document.kind !== "HTML") continue;
      for (const link of anchorLinks(document)) admit(link.href, link.label, link.type, document);
      for (const followUp of set.followUps(document, observation, new Set(planner.unsatisfied()))) {
        if (planner.has(followUp.url) || (followUp.kind === "PAGE" && ICS_URL.test(followUp.url))) continue;
        planner.add({ ...followUp, discoveredFrom: document.url, label: "", strength: followUp.kind === "CALENDAR" ? 0 : 1 });
      }
    } catch (error) {
      rememberFailure(ctx.stats, error);
      if (error instanceof ContentSkipped) ctx.obs.skippedContent.push({ url: candidate.url, reason: error.message });
      const message = error instanceof Error ? error.message : "unknown error";
      if (entry) {
        ctx.stats.warnings.push(`Required HTML source unavailable: ${candidate.url}: ${message}`);
        stop = "ENTRY_FAILED";
        break;
      }
      if (error instanceof CrawlRefusal && error.failureClass === "RETRYABLE") retryableCandidateFailure = true;
      ctx.stats.warnings.push(`${candidate.kind === "CALENDAR" ? "Optional calendar" : candidate.kind === "PDF" ? "Optional PDF" : "Candidate page"} unavailable: ${candidate.url}: ${message}`);
    }
  }
  const gapsLeft = planner.unsatisfied().filter((dim) => set.priority.includes(dim));
  const budgetStopped = stop === "PAGE_BUDGET" || stop === "REQUEST_BUDGET";
  const pendingGapCandidates = budgetStopped && planner.gapServingCount() > 0;
  if (pendingGapCandidates) ctx.stats.warnings.push(`Evidence gaps (${planner.unsatisfied().join(", ")}) remain beyond the finite crawl budget.`);
  const htmlDocuments = documents.filter((item) => item.kind !== "CALENDAR");
  if (!htmlDocuments.length) ctx.stats.status = ctx.stats.blockedCount ? "BLOCKED" : "FAILED";
  else if ((pendingGapCandidates && gapsLeft.length) || retryableCandidateFailure) ctx.stats.status = "PARTIAL";
  if (ctx.stats.status === "COMPLETED" || ctx.stats.status === "PARTIAL") ctx.stats.failureClass = undefined;
  ctx.obs.selections = planner.selections;
  return finish(ctx, { verifiedUrl, finalUrl: htmlDocuments[0]?.url ?? verifiedUrl, documents }, stop, [...planner.satisfied]);
}

export async function crawlVerifiedSource(args: CrawlInput): Promise<CrawlOutput> {
  const verifiedUrl = canonicalHttpsUrl(args.verifiedUrl);
  if (!verifiedUrl) throw new Error("Verified source URL must be public HTTPS.");
  const site = new SiteIdentity(verifiedUrl);
  const profiles = args.profiles ?? profilesFor(args.requestedExtractors, site);
  const stats: CrawlStats = { requestCount: 0, pageCount: 0, bytesRead: 0, redirects: 0, blockedCount: 0, retries: 0, warnings: [], status: "COMPLETED" };
  const ctx: Ctx = {
    budget: args.budget, stats, obs: emptyObservability(verifiedUrl, site, args, profiles), site, fetchImpl: args.fetchImpl,
    resolveHost: args.resolveHost ?? defaultResolveHost, userAgent: args.userAgent ?? "AiRevenueEngineNexusSourceDiscovery/1.0",
    politeness: args.politeness ?? sharedOriginPoliteness, sleep: args.sleep ?? realSleep, now: args.now ?? (() => new Date()), robots: new Map(), input: args,
    singleFlightBase: (args.politeness ?? sharedOriginPoliteness).singleFlightHits,
  };
  const origin = new URL(verifiedUrl).origin;
  const robots = await ensureRobots(ctx, origin);
  if (robots.status === "UNAVAILABLE") {
    const failureClass = robots.error?.failureClass ?? "RETRYABLE";
    stats.warnings.push(`robots.txt could not be checked: ${robots.error?.message ?? "unknown error"}`);
    stats.status = failureClass === "RETRYABLE" ? "FAILED" : "BLOCKED";
    stats.failureClass = failureClass;
    if (failureClass === "TERMINAL") stats.blockedCount = Math.max(stats.blockedCount, 1);
    else stats.blockedCount += 1;
    return finish(ctx, { verifiedUrl, finalUrl: verifiedUrl, documents: [] }, "ROBOTS_UNAVAILABLE");
  }
  if (!robotsAllows(robots.text, verifiedUrl, ctx.userAgent)) {
    stats.status = "BLOCKED";
    stats.blockedCount += 1;
    stats.warnings.push("robots.txt disallows the verified source path.");
    stats.failureClass = "TERMINAL";
    ctx.obs.blockedPages.push({ url: verifiedUrl, reason: "ROBOTS_DISALLOW" });
    return finish(ctx, { verifiedUrl, finalUrl: verifiedUrl, documents: [] }, "ROBOTS_BLOCKED");
  }
  return gapPlanned(profiles) ? gapPlannedCrawl(ctx, args, verifiedUrl, new ProfileSet(profiles)) : legacyLinkFollowing(ctx, args, verifiedUrl);
}

/** Established ranked link-following is kept whenever no requested profile asks for gap planning (e.g. EVENTS-only). */
function gapPlanned(profiles: ExtractorProfile[]) {
  return profiles.some((profile) => profile.strategy === "GAP_PLANNED");
}

export function extractFromFetchedDocuments(documents: FetchedDocument[], requestedExtractors: SourceExtractor[]) {
  const isCalendar = (document: FetchedDocument) => document.kind === "CALENDAR" || /text\/calendar/i.test(document.contentType ?? "") || /(?:\.ics|[?&]format=ical)(?:$|&)/i.test(document.url);
  const resources = extractResourcesFromDocuments(documents.filter((document) => !isCalendar(document)), requestedExtractors);
  const events = requestedExtractors.includes("EVENTS")
    ? extractEventsFromDocuments(documents.filter((document) => document.kind !== "PDF"))
    : { eventCandidates: [], warnings: [], evidenceRefs: [] };
  return {
    ...resources,
    eventCandidates: events.eventCandidates,
    evidenceRefs: [...new Set([...resources.evidenceRefs, ...events.evidenceRefs])],
    warnings: [...resources.warnings, ...events.warnings],
  };
}
