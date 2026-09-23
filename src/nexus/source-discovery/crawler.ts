import { createHash } from "node:crypto";
import type { SourceExtractor } from "../contracts.ts";
import { extractEventsFromDocuments } from "./extractors/events.ts";
import { extractResourcesFromDocuments } from "./extractors/resources.ts";
import { calendarFallbackUrl, discoverCalendarUrls, discoverLikelyEventDetailUrls, discoverUsefulSourceUrls } from "./links.ts";
import { assertPublicNetworkTarget, canonicalHttpsUrl, defaultResolveHost, fetchPinned } from "./network.ts";
import type { CrawlBudget, CrawlInput, CrawlOutput, CrawlStats, FetchLike, FetchedDocument, ResolveHost } from "./types.ts";

export { assertPublicNetworkTarget, canonicalHttpsUrl, isPublicHttpsUrl, isPublicNetworkAddress } from "./network.ts";
export type { CrawlBudget, CrawlInput, CrawlOutput, CrawlStats, FetchLike, FetchedDocument, ResolveHost } from "./types.ts";

function sleep(ms: number) {
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

async function fetchDocument(args: {
  url: string;
  origin: string;
  budget: CrawlBudget;
  stats: CrawlStats;
  fetchImpl?: FetchLike;
  resolveHost: ResolveHost;
  userAgent: string;
  calendar?: boolean;
  robotsText: string;
}): Promise<FetchedDocument | null> {
  let current = args.url;
  let redirects = 0;
  for (let attempt = 0; attempt <= args.budget.maxRetries; attempt += 1) {
    if (args.stats.requestCount >= args.budget.maxRequests) throw new Error("Crawl request budget exhausted.");
    if (!robotsAllows(args.robotsText, current, args.userAgent)) {
      args.stats.blockedCount += 1;
      throw new Error(`robots.txt disallows ${current}`);
    }
    try {
      await assertPublicNetworkTarget(current, args.resolveHost);
    } catch (error) {
      args.stats.blockedCount += 1;
      throw error;
    }
    args.stats.requestCount += 1;
    const accept = args.calendar ? "text/calendar,*/*;q=0.1" : "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1";
    const response = args.fetchImpl
      ? await args.fetchImpl(current, { redirect: "manual", headers: { "User-Agent": args.userAgent, Accept: accept } })
      : await fetchPinned({ url: current, resolveHost: args.resolveHost, userAgent: args.userAgent, accept, maxBytes: args.budget.maxBytesPerResponse, timeoutMs: args.budget.timeoutMs });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      const next = location ? canonicalHttpsUrl(location, current) : null;
      if (!next || new URL(next).origin !== args.origin) {
        args.stats.blockedCount += 1;
        throw new Error("Redirect target is not an allowed same-origin public HTTPS URL.");
      }
      if (redirects >= args.budget.maxRedirects) throw new Error("Redirect budget exhausted.");
      current = next;
      redirects += 1;
      args.stats.redirects += 1;
      attempt -= 1;
      continue;
    }
    if ((response.status === 429 || response.status >= 500) && attempt < args.budget.maxRetries) {
      args.stats.retries += 1;
      await sleep(Math.min(250 * 2 ** attempt, 2000));
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${current}`);
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > args.budget.maxBytesPerResponse) throw new Error("Response exceeded the discovery size limit.");
    const body = await response.text();
    const bytes = Buffer.byteLength(body, "utf8");
    if (bytes > args.budget.maxBytesPerResponse) throw new Error("Response exceeded the discovery size limit.");
    await sleep(args.budget.minRequestDelayMs);
    return { url: current, body, bytes, contentType: response.headers.get("content-type"), sourceHash: createHash("sha256").update(body).digest("hex"), observedAt: new Date().toISOString() };
  }
  return null;
}

export async function crawlVerifiedSource(args: CrawlInput): Promise<CrawlOutput> {
  const verifiedUrl = canonicalHttpsUrl(args.verifiedUrl);
  if (!verifiedUrl) throw new Error("Verified source URL must be public HTTPS.");
  const origin = new URL(verifiedUrl).origin;
  const stats: CrawlStats = { requestCount: 0, pageCount: 0, bytesRead: 0, redirects: 0, blockedCount: 0, retries: 0, warnings: [], status: "COMPLETED" };
  const resolveHost = args.resolveHost ?? defaultResolveHost;
  const userAgent = args.userAgent ?? "AiRevenueEngineNexusSourceDiscovery/1.0";
  let robotsText = "";
  let requiredTraversalIncomplete = false;
  try {
    if (stats.requestCount >= args.budget.maxRequests) throw new Error("Crawl request budget exhausted before robots.txt could be checked.");
    const robotsUrl = `${origin}/robots.txt`;
    await assertPublicNetworkTarget(robotsUrl, resolveHost);
    stats.requestCount += 1;
    const response = args.fetchImpl
      ? await args.fetchImpl(robotsUrl, { redirect: "manual", headers: { "User-Agent": userAgent, Accept: "text/plain,*/*;q=0.1" } })
      : await fetchPinned({ url: robotsUrl, resolveHost, userAgent, accept: "text/plain,*/*;q=0.1", maxBytes: Math.min(args.budget.maxBytesPerResponse, 500_000), timeoutMs: args.budget.timeoutMs });
    if (response.ok) {
      const body = await response.text();
      if (Buffer.byteLength(body, "utf8") > Math.min(args.budget.maxBytesPerResponse, 500_000)) throw new Error("robots.txt exceeded the discovery size limit.");
      robotsText = body;
    } else if (response.status !== 404) throw new Error(`robots.txt returned HTTP ${response.status}`);
  } catch (error) {
    stats.warnings.push(`robots.txt could not be checked: ${error instanceof Error ? error.message : "unknown error"}`);
    stats.status = "BLOCKED";
    stats.blockedCount += 1;
    return { verifiedUrl, finalUrl: verifiedUrl, documents: [], stats };
  }
  if (!robotsAllows(robotsText, verifiedUrl, userAgent)) {
    stats.status = "BLOCKED";
    stats.blockedCount += 1;
    stats.warnings.push("robots.txt disallows the verified source path.");
    return { verifiedUrl, finalUrl: verifiedUrl, documents: [], stats };
  }
  const documents: FetchedDocument[] = [];
  const queue: Array<{ url: string; calendar: boolean }> = [{ url: verifiedUrl, calendar: false }];
  const queuedPages = new Set([verifiedUrl]);
  const queuedCalendars = new Set<string>();
  let calendarBudgetTruncated = false;
  while (queue.length && stats.requestCount < args.budget.maxRequests) {
    const item = queue.shift()!;
    const next = item.url;
    if (!robotsAllows(robotsText, next, userAgent)) {
      stats.blockedCount += 1;
      if (item.calendar) stats.warnings.push(`Optional calendar skipped by robots.txt: ${next}`);
      else {
        stats.warnings.push(`robots.txt disallows required HTML source: ${next}`);
        requiredTraversalIncomplete = true;
      }
      continue;
    }
    try {
      const document = await fetchDocument({ url: next, origin, budget: args.budget, stats, fetchImpl: args.fetchImpl, resolveHost, userAgent, calendar: item.calendar, robotsText });
      if (!document) continue;
      documents.push(document);
      stats.bytesRead += document.bytes;
      if (item.calendar) continue;
      stats.pageCount += 1;
      const sourceLinks = discoverUsefulSourceUrls(document, args.requestedExtractors);
      const detailLinks = args.requestedExtractors.includes("EVENTS") && !extractEventsFromDocuments([document]).eventCandidates.length
        ? discoverLikelyEventDetailUrls(document)
        : [];
      for (const link of [...new Set([...sourceLinks, ...detailLinks])]) {
        if (/\.ics(?:$|\?)|[?&]format=ical(?:&|$)/i.test(link)) continue;
        if (!queuedPages.has(link) && new URL(link).origin === origin && queuedPages.size < args.budget.maxPages) {
          queuedPages.add(link);
          queue.push({ url: link, calendar: false });
        }
      }
      if (args.requestedExtractors.includes("EVENTS")) {
        const explicit = discoverCalendarUrls(document);
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
      if (item.calendar) stats.warnings.push(`Optional calendar unavailable: ${next}: ${error instanceof Error ? error.message : "unknown error"}`);
      else {
        stats.warnings.push(`Required HTML source unavailable: ${next}: ${error instanceof Error ? error.message : "unknown error"}`);
        requiredTraversalIncomplete = true;
      }
      if (stats.requestCount >= args.budget.maxRequests) break;
    }
  }
  const pendingRequiredHtml = queue.some((item) => !item.calendar);
  if (pendingRequiredHtml) {
    requiredTraversalIncomplete = true;
    stats.warnings.push("Required HTML pages remain beyond the finite crawl budget.");
  }
  if (queue.some((item) => item.calendar) || calendarBudgetTruncated) stats.warnings.push("Optional calendar evidence was omitted at the finite crawl budget.");
  if (!documents.length) stats.status = stats.blockedCount ? "BLOCKED" : "FAILED";
  else if (requiredTraversalIncomplete) stats.status = "PARTIAL";
  return { verifiedUrl, finalUrl: documents[0]?.url ?? verifiedUrl, documents, stats };
}

export function extractFromFetchedDocuments(documents: FetchedDocument[], requestedExtractors: SourceExtractor[]) {
  const resources = extractResourcesFromDocuments(documents.filter((document) => !/text\/calendar/i.test(document.contentType ?? "") && !/(?:\.ics|[?&]format=ical)(?:$|&)/i.test(document.url)), requestedExtractors);
  const events = requestedExtractors.includes("EVENTS")
    ? extractEventsFromDocuments(documents)
    : { eventCandidates: [], warnings: [], evidenceRefs: [] };
  return {
    ...resources,
    eventCandidates: events.eventCandidates,
    evidenceRefs: [...new Set([...resources.evidenceRefs, ...events.evidenceRefs])],
    warnings: events.warnings,
  };
}
