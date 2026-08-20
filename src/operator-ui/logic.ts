export type OperatorRun = {
  id: string;
  territory_code: string;
  focus: string;
  status: string;
  budget?: Record<string, unknown> | null;
  summary?: Record<string, unknown> | null;
  provider?: string | null;
  model?: string | null;
  error_message?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
};

export type OperatorCandidate = {
  id: string;
  discovery_run_id: string;
  canonical_key: string;
  candidate_name: string;
  organiser_name?: string | null;
  website?: string | null;
  territory_code: string;
  origin: string;
  status: string;
  account_id?: string | null;
  relationship: string;
  facts?: unknown;
  inferences?: unknown;
  unknowns?: unknown;
  prospect_intelligence?: unknown;
  source_urls?: unknown;
  dedupe_of_candidate_id?: string | null;
  first_seen_at?: string | null;
  last_seen_at?: string | null;
  created_at?: string | null;
  contact_research?: unknown;
  account?: { id: string; name: string; website?: string | null; metadata?: unknown } | null;
  contacts?: Array<Record<string, unknown>>;
  evidence?: Array<Record<string, unknown>>;
};

export type OperatorPayload = {
  access: "VIEWER" | "OPERATOR" | "ADMIN";
  runs: OperatorRun[];
  candidates: OperatorCandidate[];
  latestRunId: string | null;
};

export const territoryLabels: Record<string, string> = { ZA: "South Africa", GB: "United Kingdom", za: "South Africa", gb: "United Kingdom" };
export const lensLabels: Record<string, string> = { ALL: "All lenses", EGS: "Event Growth", TICKETING: "Ticketing", ECC: "Event Operations" };
export const statusLabels: Record<string, string> = {
  QUALIFIED: "Qualified",
  REVIEW_REQUIRED: "Needs review",
  REJECTED: "Rejected",
  BLOCKED: "Blocked",
  DUPLICATE: "Duplicate",
  DISCOVERED: "Discovered",
  RESOLVED: "Resolved",
  RESEARCHED: "Researched",
};
export const siteTypeLabels: Record<string, string> = {
  ORGANISATION_OFFICIAL: "Official organisation site",
  EVENT_OFFICIAL: "Official event site",
  TICKETING_PROVIDER: "Ticketing provider",
  EVENT_LISTING_DIRECTORY: "Event directory",
  VENUE_OFFICIAL: "Official venue site",
  VENUE_CALENDAR: "Venue calendar",
  ARTIST_OFFICIAL: "Artist site",
  NEWS_EDITORIAL: "News / editorial",
  SOCIAL_COMMUNITY: "Social / community",
  UNKNOWN: "Source type not established",
};

export function asObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

export function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export function territoryLabel(code?: string | null) { return code ? territoryLabels[code] ?? code : "Territory not recorded"; }
export function lensLabel(focus?: string | null) { return focus ? lensLabels[focus] ?? focus : "Lens not recorded"; }
export function statusLabel(status?: string | null) { return status ? statusLabels[status] ?? status.replaceAll("_", " ") : "Status not recorded"; }
export function siteTypeLabel(type?: string | null) { return type ? siteTypeLabels[type] ?? type.replaceAll("_", " ") : "Source type not established"; }

export function formatDate(value?: string | null, fallback = "Not recorded") {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function shortId(value?: string | null) { return value ? value.slice(0, 8) : "not recorded"; }

export function latestRun(runs: OperatorRun[]) {
  return [...runs].sort((a, b) => new Date(b.created_at ?? b.started_at ?? 0).getTime() - new Date(a.created_at ?? a.started_at ?? 0).getTime())[0] ?? null;
}

export function contextLabel(candidate: OperatorCandidate, latestRunId: string | null, now = Date.now()) {
  const intelligence = asObject(candidate.prospect_intelligence);
  const explicit = String(intelligence.contextLabel ?? intelligence.recencyLabel ?? "").toUpperCase();
  if (["CALIBRATION", "LEGACY"].includes(explicit)) return explicit;
  if (candidate.discovery_run_id === latestRunId) return "NEW";
  const seenAt = new Date(candidate.last_seen_at ?? candidate.created_at ?? 0).getTime();
  return seenAt && now - seenAt <= 30 * 24 * 60 * 60 * 1000 ? "CURRENT" : "HISTORICAL";
}

export function intelligence(candidate: OperatorCandidate) { return asObject(candidate.prospect_intelligence); }
export function facts(candidate: OperatorCandidate) { return asArray<Record<string, any>>(candidate.facts); }
export function inferences(candidate: OperatorCandidate) { return asArray<Record<string, any>>(candidate.inferences); }
export function unknowns(candidate: OperatorCandidate) { return asArray<string>(candidate.unknowns); }

export function sourceType(candidate: OperatorCandidate) {
  const intelligenceValue = intelligence(candidate);
  const sources = asArray<any>(intelligenceValue.siteClassifications ?? intelligenceValue.organisationResolution?.siteClassifications);
  return sources[0]?.siteType ?? sources[0]?.type ?? "UNKNOWN";
}

export function primaryOpportunity(candidate: OperatorCandidate) {
  const value = intelligence(candidate).primaryEntryOpportunity;
  return value ? String(value).replaceAll("_", " ") : "No established opportunity";
}

export function contactState(candidate: OperatorCandidate) {
  const contacts = candidate.contacts ?? [];
  const research = asObject(candidate.contact_research);
  if (contacts.length || ["CONTACT_FOUND", "CONTACT_ROUTE_FOUND"].includes(String(research.status))) return "Verified route available";
  if (research.status === "CONTACT_RESEARCH_REQUIRED") return "Research required";
  return "No verified target route";
}

export function needsReview(candidate: OperatorCandidate) {
  if (candidate.status !== "REVIEW_REQUIRED") return false;
  const value = intelligence(candidate);
  const action = reviewDecision(candidate);
  return Boolean(action && !/more research|continue.*research|research required|needs validation/i.test(action));
}

export function reviewDecision(candidate: OperatorCandidate) {
  const value = intelligence(candidate);
  return String(value.recommendedNextAction ?? value.nextBestCommercialAction?.type ?? value.outreachBlockOrReviewReason ?? "");
}

export function runCounts(run: OperatorRun | null, candidates: OperatorCandidate[]) {
  const summary = asObject(run?.summary);
  const scoped = run ? candidates.filter((candidate) => candidate.discovery_run_id === run.id) : [];
  const count = (key: string, status?: string) => typeof summary[key] === "number" ? summary[key] : status ? scoped.filter((candidate) => candidate.status === status).length : 0;
  return {
    found: count("discovered") || scoped.length,
    resolved: count("resolved") || scoped.filter((candidate) => asObject(candidate.prospect_intelligence).organisationResolution?.status === "RESOLVED").length,
    unresolved: count("unresolved") || scoped.filter((candidate) => asObject(candidate.prospect_intelligence).organisationResolution?.status === "UNRESOLVED").length,
    enriched: count("enrichmentSucceededCount"),
    advanced: count("commerciallyAdvanced"),
    qualified: count("qualified", "QUALIFIED"),
    review: count("reviewRequired", "REVIEW_REQUIRED"),
    rejected: count("blockedOrRejected", "REJECTED"),
    duplicate: count("duplicates", "DUPLICATE"),
    contactable: scoped.filter((candidate) => contactState(candidate) === "Verified route available").length,
  };
}
