import { extractFromFetchedDocuments } from "../crawler.ts";
import { crawlVerifiedSource } from "../crawler.ts";
import { visibleText } from "../html.ts";
import type { CrawlBudget, CrawlInput, CrawlOutput } from "../types.ts";
import { buildVenueEvidencePackage, namedSpacesInText, type VenueEvidencePackage } from "./evidence.ts";
import { planVenueHttpsTarget, sameAuthorisedVenueSite, type VenueAuthorityPlan } from "./http-authority.ts";
import { VENUE_EXTRACTORS, venueCrawlProfiles } from "./profiles.ts";

/** Bounded venue budget. The gap planner stops when venue dimensions are satisfied. */
export const VENUE_CRAWL_BUDGET: CrawlBudget = {
  maxPages: 8,
  maxRequests: 14,
  maxBytesPerResponse: 1_500_000,
  maxRedirects: 4,
  maxRetries: 1,
  timeoutMs: 12_000,
  minRequestDelayMs: 200,
  maxPdfDocuments: 2,
  maxSitemapFetches: 2,
};

export type VenueCrawlResult = {
  authority: VenueAuthorityPlan;
  sameSite: boolean;
  crawl: CrawlOutput | null;
  evidence: VenueEvidencePackage | null;
  refusal: string | null;
};

export async function crawlVenueOfficialSite(args: {
  authorisedUrl: string;
  venueName?: string;
  budget?: CrawlBudget;
} & Pick<CrawlInput, "fetchImpl" | "resolveHost" | "userAgent" | "politeness" | "now" | "sleep">): Promise<VenueCrawlResult> {
  const authority = planVenueHttpsTarget(args.authorisedUrl);
  if (!authority.crawlUrl) {
    return { authority, sameSite: false, crawl: null, evidence: null, refusal: authority.refusal };
  }
  const crawl = await crawlVerifiedSource({
    verifiedUrl: authority.crawlUrl,
    requestedExtractors: [...VENUE_EXTRACTORS],
    profiles: venueCrawlProfiles(undefined, { emailGoal: true, venueName: args.venueName ?? "" }),
    budget: args.budget ?? VENUE_CRAWL_BUDGET,
    subjectType: "VENUE",
    emailGoal: true,
    venueName: args.venueName,
    fetchImpl: args.fetchImpl,
    resolveHost: args.resolveHost,
    userAgent: args.userAgent,
    politeness: args.politeness,
    now: args.now,
    sleep: args.sleep,
  });
  const sameSite = sameAuthorisedVenueSite(authority.authorisedUrl, crawl.finalUrl);
  if (!sameSite) {
    return { authority, sameSite: false, crawl, evidence: null, refusal: "CROSS_SITE_FINAL_URL" };
  }
  const extracted = extractFromFetchedDocuments(crawl.documents, [...VENUE_EXTRACTORS]);
  const evidence = buildVenueEvidencePackage(extracted);
  const seen = new Set(evidence.spaces.map((item) => item.name.toLowerCase()));
  for (const document of crawl.documents) {
    if (document.kind === "PDF") continue;
    for (const name of namedSpacesInText(visibleText(document.body), document.url)) {
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      evidence.spaces.push({ name, sourceUrl: document.url, evidenceRef: `source:${document.sourceHash}:space-caption` });
    }
  }
  return { authority, sameSite: true, crawl, evidence, refusal: null };
}
