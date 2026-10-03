/**
 * Same official-site authority contract as Event-project
 * `resolveOfficialSiteAuthority`. AIRE uses it to select the READY cohort.
 * It does not write EventSuite authority.
 */

export const OFFICIAL_CRAWL_STATUSES = ["READY", "NO_OFFICIAL_URL", "AMBIGUOUS_OR_CONFLICTING", "NOT_VENUE"] as const;
export type OfficialCrawlStatus = (typeof OFFICIAL_CRAWL_STATUSES)[number];

export const OFFICIAL_WEBSITE_PROVENANCE = [
  "resources_listing_official_website",
  "verified_resources_evidence",
  "stored_google_website_uri",
  "nexus_confirmed_official_website",
] as const;
export type OfficialWebsiteProvenance = (typeof OFFICIAL_WEBSITE_PROVENANCE)[number];

export const NON_OFFICIAL_WEBSITE_HOST_SUFFIXES = [
  "facebook.com", "fb.com", "fb.me", "instagram.com", "tiktok.com", "twitter.com", "x.com", "linkedin.com",
  "youtube.com", "youtu.be", "linktr.ee", "linkin.bio", "wa.me", "whatsapp.com", "calendar.google.com",
  "maps.google.com", "goo.gl", "g.page",
] as const;

export type OfficialWebsiteEvidenceInput = { url: string | null; verified: boolean };

export type OfficialCrawlTargetInput = {
  classificationStatus: string;
  candidateStatus: string;
  listingPublicWebsite?: string | null;
  evidence?: readonly OfficialWebsiteEvidenceInput[];
  googleWebsiteUri?: string | null;
  nexusOfficialWebsite?: string | null;
};

export type OfficialSiteAuthorityInput = OfficialCrawlTargetInput & {
  providerPlaceId: string;
  listingId?: string | null;
  listingPlaceId?: string | null;
  promotedPlaceIds?: readonly string[];
};

export type OfficialSiteAuthority = {
  providerPlaceId: string;
  listingId: string | null;
  status: OfficialCrawlStatus;
  url: string | null;
  provenance: OfficialWebsiteProvenance | null;
  blockedReason: "not_venue" | null;
  identity: "unique" | "unresolved_conflict" | "not_venue";
};

type OfficialCandidate = { url: string; host: string; provenance: OfficialWebsiteProvenance };

export function officialWebsiteHost(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username || parsed.password) return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!host || host === "localhost" || host.endsWith(".local")) return null;
  return host;
}

export function isNonOfficialWebsiteHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^www\./, "");
  return NON_OFFICIAL_WEBSITE_HOST_SUFFIXES.some((suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`));
}

function officialCandidate(value: string | null | undefined, provenance: OfficialWebsiteProvenance): OfficialCandidate | null {
  const host = officialWebsiteHost(value);
  if (!host || isNonOfficialWebsiteHost(host) || !value?.trim()) return null;
  const parsed = new URL(value.trim());
  parsed.hash = "";
  return { url: parsed.toString(), host, provenance };
}

function distinctPlaceIds(placeIds: readonly string[] | undefined): string[] {
  return [...new Set((placeIds ?? []).map((placeId) => placeId.trim()).filter((placeId) => placeId.length > 0))];
}

export function hasUnresolvedPlaceIdentity(input: {
  listingPlaceId?: string | null;
  promotedPlaceIds?: readonly string[];
}): boolean {
  if (distinctPlaceIds(input.promotedPlaceIds).length < 2) return false;
  return !input.listingPlaceId?.trim();
}

export function resolveOfficialCrawlTarget(input: OfficialCrawlTargetInput): {
  status: OfficialCrawlStatus;
  url: string | null;
  provenance: OfficialWebsiteProvenance | null;
  blockedReason: "not_venue" | null;
} {
  if (input.classificationStatus === "not_venue" || input.candidateStatus === "rejected") {
    return { status: "NOT_VENUE", url: null, provenance: null, blockedReason: "not_venue" };
  }
  const listing = officialCandidate(input.listingPublicWebsite, "resources_listing_official_website");
  if (listing) return { status: "READY", url: listing.url, provenance: listing.provenance, blockedReason: null };

  const fallbacks = [
    ...(input.evidence ?? []).filter((item) => item.verified).map((item) => officialCandidate(item.url, "verified_resources_evidence")),
    officialCandidate(input.googleWebsiteUri, "stored_google_website_uri"),
    officialCandidate(input.nexusOfficialWebsite, "nexus_confirmed_official_website"),
  ].filter((item): item is OfficialCandidate => item !== null);

  if (fallbacks.length === 0) return { status: "NO_OFFICIAL_URL", url: null, provenance: null, blockedReason: null };
  if (new Set(fallbacks.map((item) => item.host)).size !== 1) {
    return { status: "AMBIGUOUS_OR_CONFLICTING", url: null, provenance: null, blockedReason: null };
  }
  const winner = (["verified_resources_evidence", "stored_google_website_uri", "nexus_confirmed_official_website"] as const)
    .map((provenance) => fallbacks.find((item) => item.provenance === provenance))
    .find((item): item is OfficialCandidate => item !== undefined);
  if (!winner) return { status: "NO_OFFICIAL_URL", url: null, provenance: null, blockedReason: null };
  return { status: "READY", url: winner.url, provenance: winner.provenance, blockedReason: null };
}

export function resolveOfficialSiteAuthority(input: OfficialSiteAuthorityInput): OfficialSiteAuthority {
  const listingId = input.listingId?.trim() || null;
  if (input.classificationStatus === "not_venue" || input.candidateStatus === "rejected") {
    return {
      providerPlaceId: input.providerPlaceId, listingId, status: "NOT_VENUE", url: null, provenance: null,
      blockedReason: "not_venue", identity: "not_venue",
    };
  }
  if (hasUnresolvedPlaceIdentity(input)) {
    return {
      providerPlaceId: input.providerPlaceId, listingId, status: "AMBIGUOUS_OR_CONFLICTING", url: null, provenance: null,
      blockedReason: null, identity: "unresolved_conflict",
    };
  }
  const crawl = resolveOfficialCrawlTarget(input);
  return {
    providerPlaceId: input.providerPlaceId, listingId, status: crawl.status, url: crawl.url, provenance: crawl.provenance,
    blockedReason: crawl.blockedReason, identity: "unique",
  };
}
