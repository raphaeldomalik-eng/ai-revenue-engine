import { createHash } from "node:crypto";
import { CONTRACTS, validateSourceDiscoveryResult } from "../contracts.ts";
import { crawlVerifiedSource, extractFromFetchedDocuments } from "./crawler.ts";
import { canonicalHttpsUrl } from "./network.ts";
import type { CrawlInput, FetchedDocument } from "./types.ts";

export const PHASE3A_HARD_LIMITS = Object.freeze({
  MAX_ROOT_DOMAINS: 2,
  MAX_TOTAL_HTML_PAGES: 20,
  MAX_EXPANSION_HOPS: 1,
});

const TICKETING_PLATFORM_HOST = /(?:^|\.)(?:seetickets\.com|dice\.fm|wegottickets\.com|ticketmaster\.co\.uk|ticketmaster\.com|ra\.co|offaxisgigs\.com|skiddle\.com|eventbrite\.co\.uk|eventbrite\.com|musicglue\.com|gigantic\.com|ents24\.com|citizensticket\.com|citizenticket\.co\.uk|universe\.com|fatsoma\.com)$/i;

const STREAMING_OR_SOCIAL_HOST = /(?:^|\.)(?:spotify\.com|bandcamp\.com|youtube\.com|youtu\.be|soundcloud\.com|apple\.com|instagram\.com|facebook\.com|tiktok\.com|x\.com|twitter\.com|linktr\.ee|os\.fan)$/i;

export type FollowUpDisposition =
  | "ELIGIBLE_FOLLOW_UP"
  | "SKIPPED_SAME_OR_VISITED_ORIGIN"
  | "REJECTED_TICKETING_PLATFORM"
  | "REJECTED_STREAMING_OR_SOCIAL_PLATFORM"
  | "BLOCKED_BY_SOURCE_POLICY"
  | "HELD_UNREGISTERED_EXTERNAL_DOMAIN"
  | "HELD_HOP_DEPTH_LIMIT";

export type CandidateSourceRole =
  | "ARTIST_CONTROLLED_WEBSITE"
  | "PROMOTER_OR_SHOWCASE_WEBSITE"
  | "VENUE_OR_EVENT_WEBSITE"
  | "NON_CRAWLABLE_PLATFORM";

export type EvaluatedFollowUpCandidate = {
  candidateUrl: string;
  normalizedOrigin: string;
  registrableDomain: string;
  discoveredFromSourceUrl: string;
  discoveredFromEventUrl: string;
  relatedPerformers: string[];
  hopDepth: number;
  inferredRole: CandidateSourceRole;
  disposition: FollowUpDisposition;
  reasonCode: string;
};

export type OriginPermissionVerdict = {
  permitted: boolean;
  reasonCode: string;
  sourceRole?: "ARTIST_CONTROLLED_WEBSITE" | "PROMOTER_OR_SHOWCASE_WEBSITE" | "VENUE_OR_EVENT_WEBSITE";
  subjectEntityType?: "VENUE" | "CREATIVE_ENTITY" | "ORGANISATION";
};

export type OriginPermissionEvaluator = (url: string) => OriginPermissionVerdict;

function deterministicUuid(seed: string): string {
  const hex = createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = "a";
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function assertFiniteIntegerInRange(
  value: unknown,
  min: number,
  max: number,
  code: string,
  label: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    const err = new Error(
      `${code}: ${label}=${String(value)} must be a finite integer in [${min}, ${max}].`,
    ) as Error & { code?: string };
    err.code = code;
    throw err;
  }
  return value;
}

export function normalizeDomainKey(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host.endsWith(".bandcamp.com")) return "bandcamp.com";
  if (host === "open.spotify.com") return "spotify.com";
  if (host.endsWith(".seetickets.com")) return "seetickets.com";
  if (host.endsWith(".os.fan")) return "os.fan";
  return host;
}

function cleanTrackingParams(rawUrl: string): string | null {
  const canonical = canonicalHttpsUrl(rawUrl);
  if (!canonical) return null;
  const parsed = new URL(canonical);
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(?:si|utm_[a-z_]+|fbclid|gclid|mc_[a-z]+|feature)$/i.test(key)) {
      parsed.searchParams.delete(key);
    }
  }
  return parsed.toString();
}

function inferCandidateRole(candidateUrl: string, performers: string[]): CandidateSourceRole {
  const parsed = new URL(candidateUrl);
  const host = parsed.hostname.toLowerCase();
  if (TICKETING_PLATFORM_HOST.test(host) || STREAMING_OR_SOCIAL_HOST.test(host)) {
    return "NON_CRAWLABLE_PLATFORM";
  }
  const hostCompact = host.replace(/^www\./, "").split(".")[0]?.replace(/[^a-z0-9]/g, "") ?? "";
  if (performers.length === 1) {
    const tokens = performers[0]!.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter((t) => t.length >= 3);
    if (tokens.length > 0 && tokens.every((tok) => hostCompact.includes(tok))) {
      return "ARTIST_CONTROLLED_WEBSITE";
    }
    const actSlug = performers[0]!.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const pathSlug = parsed.pathname.replace(/^\/+|\/+$/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (actSlug.length >= 3 && pathSlug === actSlug) {
      return "PROMOTER_OR_SHOWCASE_WEBSITE";
    }
  }
  return "VENUE_OR_EVENT_WEBSITE";
}

export function evaluateFollowUpUrlsFromDiscoveryResult(
  discoveryResult: ReturnType<typeof validateSourceDiscoveryResult>,
  options: {
    currentHopDepth: number;
    maxExpansionHops?: number;
    visitedOrigins: ReadonlySet<string>;
    visitedUrls?: ReadonlySet<string>;
    evaluateOriginPermission: OriginPermissionEvaluator;
  },
): EvaluatedFollowUpCandidate[] {
  const maxExpansionHops = assertFiniteIntegerInRange(
    options.maxExpansionHops === undefined ? PHASE3A_HARD_LIMITS.MAX_EXPANSION_HOPS : options.maxExpansionHops,
    0,
    PHASE3A_HARD_LIMITS.MAX_EXPANSION_HOPS,
    "DISCOVERY_HOP_BUDGET_EXCEEDED",
    "maxExpansionHops",
  );
  const currentHopDepth = assertFiniteIntegerInRange(
    options.currentHopDepth,
    0,
    PHASE3A_HARD_LIMITS.MAX_EXPANSION_HOPS,
    "DISCOVERY_HOP_BUDGET_EXCEEDED",
    "currentHopDepth",
  );
  const sourceOrigin = new URL(discoveryResult.source.verifiedUrl).origin;
  const seenCandidateUrls = new Set<string>();
  const evaluated: EvaluatedFollowUpCandidate[] = [];

  const sortedEvents = [...discoveryResult.eventCandidates].sort((a, b) =>
    a.sourceEventUrl.localeCompare(b.sourceEventUrl),
  );

  for (const ev of sortedEvents) {
    const rawLinks = [
      ...(ev.outboundArtistUrls ?? []),
      ...(ev.ticketUrl ? [ev.ticketUrl] : []),
    ];
    for (const rawLink of rawLinks) {
      const candidateUrl = cleanTrackingParams(rawLink);
      if (!candidateUrl || seenCandidateUrls.has(candidateUrl)) continue;
      seenCandidateUrls.add(candidateUrl);

      const parsed = new URL(candidateUrl);
      const normalizedOrigin = parsed.origin;
      const registrableDomain = normalizeDomainKey(candidateUrl);
      const nextHopDepth = currentHopDepth + 1;
      const defaultRole = inferCandidateRole(candidateUrl, ev.performers);

      if (
        normalizedOrigin === sourceOrigin ||
        options.visitedOrigins.has(normalizedOrigin) ||
        options.visitedOrigins.has(registrableDomain) ||
        options.visitedUrls?.has(candidateUrl)
      ) {
        evaluated.push({
          candidateUrl,
          normalizedOrigin,
          registrableDomain,
          discoveredFromSourceUrl: discoveryResult.source.verifiedUrl,
          discoveredFromEventUrl: ev.sourceEventUrl,
          relatedPerformers: [...ev.performers],
          hopDepth: nextHopDepth,
          inferredRole: defaultRole,
          disposition: "SKIPPED_SAME_OR_VISITED_ORIGIN",
          reasonCode: "ORIGIN_OR_URL_ALREADY_VISITED",
        });
        continue;
      }

      if (TICKETING_PLATFORM_HOST.test(parsed.hostname)) {
        evaluated.push({
          candidateUrl,
          normalizedOrigin,
          registrableDomain,
          discoveredFromSourceUrl: discoveryResult.source.verifiedUrl,
          discoveredFromEventUrl: ev.sourceEventUrl,
          relatedPerformers: [...ev.performers],
          hopDepth: nextHopDepth,
          inferredRole: "NON_CRAWLABLE_PLATFORM",
          disposition: "REJECTED_TICKETING_PLATFORM",
          reasonCode: "PASSIVE_TICKET_SELLER_URL_ONLY",
        });
        continue;
      }

      if (STREAMING_OR_SOCIAL_HOST.test(parsed.hostname)) {
        evaluated.push({
          candidateUrl,
          normalizedOrigin,
          registrableDomain,
          discoveredFromSourceUrl: discoveryResult.source.verifiedUrl,
          discoveredFromEventUrl: ev.sourceEventUrl,
          relatedPerformers: [...ev.performers],
          hopDepth: nextHopDepth,
          inferredRole: "NON_CRAWLABLE_PLATFORM",
          disposition: "REJECTED_STREAMING_OR_SOCIAL_PLATFORM",
          reasonCode: "PASSIVE_PROFILE_OR_RECORDING_URL_ONLY",
        });
        continue;
      }

      if (currentHopDepth >= maxExpansionHops) {
        evaluated.push({
          candidateUrl,
          normalizedOrigin,
          registrableDomain,
          discoveredFromSourceUrl: discoveryResult.source.verifiedUrl,
          discoveredFromEventUrl: ev.sourceEventUrl,
          relatedPerformers: [...ev.performers],
          hopDepth: nextHopDepth,
          inferredRole: defaultRole,
          disposition: "HELD_HOP_DEPTH_LIMIT",
          reasonCode: `MAX_EXPANSION_HOPS_${maxExpansionHops}_REACHED`,
        });
        continue;
      }

      const permission = options.evaluateOriginPermission(candidateUrl);
      if (!permission.permitted) {
        const isUnregistered = permission.reasonCode === "UNREGISTERED_SOURCE_BLOCKED";
        evaluated.push({
          candidateUrl,
          normalizedOrigin,
          registrableDomain,
          discoveredFromSourceUrl: discoveryResult.source.verifiedUrl,
          discoveredFromEventUrl: ev.sourceEventUrl,
          relatedPerformers: [...ev.performers],
          hopDepth: nextHopDepth,
          inferredRole: permission.sourceRole ?? defaultRole,
          disposition: isUnregistered ? "HELD_UNREGISTERED_EXTERNAL_DOMAIN" : "BLOCKED_BY_SOURCE_POLICY",
          reasonCode: permission.reasonCode,
        });
        continue;
      }

      evaluated.push({
        candidateUrl,
        normalizedOrigin,
        registrableDomain,
        discoveredFromSourceUrl: discoveryResult.source.verifiedUrl,
        discoveredFromEventUrl: ev.sourceEventUrl,
        relatedPerformers: [...ev.performers],
        hopDepth: nextHopDepth,
        inferredRole: permission.sourceRole ?? defaultRole,
        disposition: "ELIGIBLE_FOLLOW_UP",
        reasonCode: permission.reasonCode,
      });
    }
  }

  return evaluated;
}

function buildDiscoveryResultFromDocuments(params: {
  verifiedUrl: string;
  subjectEntityType: "VENUE" | "CREATIVE_ENTITY" | "ORGANISATION";
  canonicalEntityId?: string | null;
  candidateSourceRecordId: string;
  documents: FetchedDocument[];
  warnings?: string[];
  requestCount?: number;
  redirects?: number;
  blockedCount?: number;
}) {
  const sortedDocs = [...params.documents];
  const entryDoc = sortedDocs.find((d) => d.url === params.verifiedUrl) ?? sortedDocs[0];
  if (!entryDoc) {
    throw new Error(`EMPTY_DISCOVERY_DOCUMENTS: No HTML documents available for ${params.verifiedUrl}`);
  }
  const extracted = extractFromFetchedDocuments(sortedDocs, ["EVENTS"]);
  const totalBytes = sortedDocs.reduce((sum, d) => sum + d.bytes, 0);
  const requests = sortedDocs.map((d) => ({
    url: d.url,
    status: 200,
    contentType: d.contentType ?? "text/html; charset=UTF-8",
    bytes: d.bytes,
    responseHash: d.sourceHash,
  }));
  const pages = sortedDocs.map((d) => ({
    url: d.url,
    sourceHash: d.sourceHash,
    contentType: d.contentType ?? "text/html; charset=UTF-8",
    bytes: d.bytes,
    kind: "HTML" as const,
    publisherType: "VERIFIED_FIRST_PARTY" as const,
    subjectAssignment: "TARGET" as const,
    evidenceRefs: extracted.evidenceRefs.filter((ref) => ref.startsWith(`source:${d.sourceHash}:`)),
  }));

  const rawEnvelope = {
    contractVersion: CONTRACTS.SOURCE_DISCOVERY_RESULT,
    discoveryRequestId: deterministicUuid(`ea-phase3a-req\n${params.verifiedUrl}\n${entryDoc.sourceHash}`),
    idempotencyKey: deterministicUuid(`ea-phase3a-idem\n${params.verifiedUrl}\n${entryDoc.sourceHash}`),
    subjectReference: {
      canonicalEntityId: params.canonicalEntityId ?? null,
      candidateReference: params.canonicalEntityId
        ? null
        : { sourceSystem: "public_web", sourceRecordId: params.candidateSourceRecordId },
      entityType: params.subjectEntityType,
    },
    source: {
      verifiedUrl: params.verifiedUrl,
      finalUrl: entryDoc.url,
      observedAt: entryDoc.observedAt,
      sourceHash: entryDoc.sourceHash,
    },
    crawl: {
      status: "COMPLETED" as const,
      warnings: [...new Set([...(params.warnings ?? []), ...extracted.warnings])],
      requestCount: params.requestCount ?? requests.length,
      pageCount: pages.length,
      bytesRead: totalBytes,
      redirects: params.redirects ?? 0,
      blockedCount: params.blockedCount ?? 0,
      retryable: false,
      evidenceManifest: {
        version: 1,
        attemptedRequests: params.requestCount ?? requests.length,
        requestsOmitted: 0,
        unrecordedRequests: 0,
        requests,
        pages,
      },
    },
    identityFacts: [],
    publicContacts: [],
    venueFacts: [],
    imageCandidates: [],
    eventCandidates: extracted.eventCandidates,
    evidenceRefs: extracted.evidenceRefs,
  };

  return validateSourceDiscoveryResult(rawEnvelope);
}

export type DiscoveryLoopStep = {
  hopDepth: number;
  verifiedUrl: string;
  registrableDomain: string;
  discoveredFromSourceUrl: string | null;
  discoveredFromEventUrl: string | null;
  relatedPerformers: string[];
  discoveryResult: ReturnType<typeof validateSourceDiscoveryResult>;
  documents: FetchedDocument[];
};

export type BoundedDiscoveryLoopInput = {
  rootSeeds: Array<{
    verifiedUrl: string;
    subjectEntityType?: "VENUE" | "CREATIVE_ENTITY" | "ORGANISATION";
    canonicalEntityId?: string | null;
  }>;
  maxRootDomains?: number;
  maxTotalHtmlPages?: number;
  maxExpansionHops?: number;
  maxPagesPerHop?: number;
  evaluateOriginPermission: OriginPermissionEvaluator;
  /** Offline replay fixture map keyed by registrable domain (`sneakypetes.co.uk`, `thisfeeling.co.uk`). */
  offlineDocumentsByDomain?: ReadonlyMap<string, FetchedDocument[]>;
  crawlOptions?: Pick<CrawlInput, "fetchImpl" | "resolveHost" | "userAgent" | "sleep" | "now">;
};

export async function runBoundedEmergingArtistDiscoveryLoop(input: BoundedDiscoveryLoopInput) {
  if (!input || typeof input !== "object") {
    const err = new Error("INVALID_DISCOVERY_LOOP_INPUT: input object is required.") as Error & { code?: string };
    err.code = "INVALID_DISCOVERY_LOOP_INPUT";
    throw err;
  }

  const maxRootDomains = assertFiniteIntegerInRange(
    input.maxRootDomains === undefined ? PHASE3A_HARD_LIMITS.MAX_ROOT_DOMAINS : input.maxRootDomains,
    1,
    PHASE3A_HARD_LIMITS.MAX_ROOT_DOMAINS,
    "DISCOVERY_ROOT_DOMAIN_BUDGET_EXCEEDED",
    "maxRootDomains",
  );
  const maxTotalHtmlPages = assertFiniteIntegerInRange(
    input.maxTotalHtmlPages === undefined ? PHASE3A_HARD_LIMITS.MAX_TOTAL_HTML_PAGES : input.maxTotalHtmlPages,
    1,
    PHASE3A_HARD_LIMITS.MAX_TOTAL_HTML_PAGES,
    "DISCOVERY_HTML_PAGE_BUDGET_EXCEEDED",
    "maxTotalHtmlPages",
  );
  const maxExpansionHops = assertFiniteIntegerInRange(
    input.maxExpansionHops === undefined ? PHASE3A_HARD_LIMITS.MAX_EXPANSION_HOPS : input.maxExpansionHops,
    0,
    PHASE3A_HARD_LIMITS.MAX_EXPANSION_HOPS,
    "DISCOVERY_HOP_BUDGET_EXCEEDED",
    "maxExpansionHops",
  );
  const maxPagesPerHop = assertFiniteIntegerInRange(
    input.maxPagesPerHop === undefined ? Math.min(12, maxTotalHtmlPages) : input.maxPagesPerHop,
    1,
    maxTotalHtmlPages,
    "DISCOVERY_STEP_PAGE_BUDGET_EXCEEDED",
    "maxPagesPerHop",
  );

  if (!Array.isArray(input.rootSeeds) || input.rootSeeds.length < 1) {
    const err = new Error("DISCOVERY_ROOT_DOMAIN_BUDGET_EXCEEDED: At least 1 rootSeed is required.") as Error & { code?: string };
    err.code = "DISCOVERY_ROOT_DOMAIN_BUDGET_EXCEEDED";
    throw err;
  }

  const normalizedRootSeeds = input.rootSeeds.map((seed) => {
    const verifiedUrl = canonicalHttpsUrl(seed?.verifiedUrl ?? "");
    if (!verifiedUrl) {
      const err = new Error(`INVALID_VERIFIED_SOURCE_URL: "${String(seed?.verifiedUrl)}" must be public HTTPS.`) as Error & { code?: string };
      err.code = "INVALID_VERIFIED_SOURCE_URL";
      throw err;
    }
    return {
      verifiedUrl,
      subjectEntityType: seed.subjectEntityType ?? "VENUE",
      canonicalEntityId: seed.canonicalEntityId ?? null,
    };
  });

  const rootDomains = new Set(normalizedRootSeeds.map((s) => normalizeDomainKey(s.verifiedUrl)));
  if (rootDomains.size > maxRootDomains) {
    const err = new Error(`DISCOVERY_ROOT_DOMAIN_BUDGET_EXCEEDED: ${rootDomains.size} root domains provided, limit is ${maxRootDomains}.`) as Error & { code?: string };
    err.code = "DISCOVERY_ROOT_DOMAIN_BUDGET_EXCEEDED";
    throw err;
  }

  type QueueItem = {
    hopDepth: number;
    verifiedUrl: string;
    subjectEntityType: "VENUE" | "CREATIVE_ENTITY" | "ORGANISATION";
    canonicalEntityId: string | null;
    discoveredFromSourceUrl: string | null;
    discoveredFromEventUrl: string | null;
    relatedPerformers: string[];
  };

  const queue: QueueItem[] = normalizedRootSeeds.map((seed) => ({
    hopDepth: 0,
    verifiedUrl: seed.verifiedUrl,
    subjectEntityType: seed.subjectEntityType,
    canonicalEntityId: seed.canonicalEntityId,
    discoveredFromSourceUrl: null,
    discoveredFromEventUrl: null,
    relatedPerformers: [],
  }));

  const visitedOrigins = new Set<string>();
  const visitedUrls = new Set<string>();
  const steps: DiscoveryLoopStep[] = [];
  const candidateLedger: EvaluatedFollowUpCandidate[] = [];
  let totalHtmlPagesCaptured = 0;

  while (queue.length > 0) {
    const current = queue.shift()!;
    const domain = normalizeDomainKey(current.verifiedUrl);
    const origin = new URL(current.verifiedUrl).origin;

    if (visitedOrigins.has(domain) || visitedOrigins.has(origin) || visitedUrls.has(current.verifiedUrl)) {
      continue;
    }

    const perm = input.evaluateOriginPermission(current.verifiedUrl);
    if (!perm.permitted) {
      const err = new Error(`SOURCE_ORIGIN_NOT_PERMITTED: ${current.verifiedUrl} rejected (${perm.reasonCode}).`) as Error & { code?: string };
      err.code = perm.reasonCode;
      throw err;
    }

    const remainingHtmlBudget = maxTotalHtmlPages - totalHtmlPagesCaptured;
    if (remainingHtmlBudget <= 0) break;

    visitedOrigins.add(domain);
    visitedOrigins.add(origin);
    visitedUrls.add(current.verifiedUrl);

    const stepPageCap = Math.min(maxPagesPerHop, remainingHtmlBudget);
    let docs: FetchedDocument[];
    let warnings: string[] = [];

    if (input.offlineDocumentsByDomain) {
      const preloaded = input.offlineDocumentsByDomain.get(domain) ?? [];
      docs = preloaded.slice(0, stepPageCap);
    } else {
      const crawled = await crawlVerifiedSource({
        verifiedUrl: current.verifiedUrl,
        requestedExtractors: ["EVENTS"],
        budget: {
          maxPages: stepPageCap,
          maxRequests: stepPageCap + 4,
          maxBytesPerResponse: 2_500_000,
          maxRedirects: 4,
          maxRetries: 1,
          timeoutMs: 15_000,
          minRequestDelayMs: 500,
          maxSitemapFetches: 0,
        },
        ...input.crawlOptions,
      });
      docs = crawled.documents.filter((d) => (d.kind ?? "HTML") === "HTML").slice(0, stepPageCap);
      warnings = crawled.stats.warnings;
    }

    for (const d of docs) visitedUrls.add(d.url);
    totalHtmlPagesCaptured += docs.length;

    const subjectType = perm.subjectEntityType ?? current.subjectEntityType;
    const discoveryResult = buildDiscoveryResultFromDocuments({
      verifiedUrl: current.verifiedUrl,
      subjectEntityType: subjectType,
      canonicalEntityId: current.canonicalEntityId,
      candidateSourceRecordId: `source:${domain}`,
      documents: docs,
      warnings,
    });

    steps.push({
      hopDepth: current.hopDepth,
      verifiedUrl: current.verifiedUrl,
      registrableDomain: domain,
      discoveredFromSourceUrl: current.discoveredFromSourceUrl,
      discoveredFromEventUrl: current.discoveredFromEventUrl,
      relatedPerformers: current.relatedPerformers,
      discoveryResult,
      documents: docs,
    });

    const evaluated = evaluateFollowUpUrlsFromDiscoveryResult(discoveryResult, {
      currentHopDepth: current.hopDepth,
      maxExpansionHops,
      visitedOrigins,
      visitedUrls,
      evaluateOriginPermission: input.evaluateOriginPermission,
    });
    candidateLedger.push(...evaluated);

    for (const cand of evaluated) {
      if (cand.disposition !== "ELIGIBLE_FOLLOW_UP") continue;
      if (queue.some((q) => normalizeDomainKey(q.verifiedUrl) === cand.registrableDomain)) continue;
      queue.push({
        hopDepth: cand.hopDepth,
        verifiedUrl: cand.candidateUrl,
        subjectEntityType: cand.inferredRole === "ARTIST_CONTROLLED_WEBSITE" ? "CREATIVE_ENTITY" : "ORGANISATION",
        canonicalEntityId: null,
        discoveredFromSourceUrl: cand.discoveredFromSourceUrl,
        discoveredFromEventUrl: cand.discoveredFromEventUrl,
        relatedPerformers: cand.relatedPerformers,
      });
    }
  }

  return {
    steps,
    candidateLedger,
    totals: {
      rootDomainsUsed: rootDomains.size,
      expansionHopsExecuted: steps.some((s) => s.hopDepth > 0) ? Math.max(...steps.map((s) => s.hopDepth)) : 0,
      totalHtmlPagesCaptured,
      maxRootDomains,
      maxTotalHtmlPages,
      maxExpansionHops,
      offlineMode: Boolean(input.offlineDocumentsByDomain),
    },
  };
}
