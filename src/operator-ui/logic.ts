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
  review_decisions?: Array<{ id: string; decision: "BLOCKED" | "REOPENED"; reason_code?: string | null; other_explanation?: string | null; note?: string | null; created_at?: string | null }>;
  prospect_approval?: { decision: "APPROVED" | "REVOKED"; reviewer_id?: string | null; created_at?: string | null } | null;
};

export type RunResultMetric = "found" | "resolved" | "unresolved" | "enriched" | "advanced" | "qualified" | "review" | "rejected" | "contactable";

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

export function organisationName(candidate: OperatorCandidate) { return candidate.organiser_name || candidate.account?.name || "ORGANISATION NOT YET RESOLVED"; }
export function resolutionLabel(candidate: OperatorCandidate) {
  const resolution = asObject(intelligence(candidate).organisationResolution);
  const status = String(resolution.status ?? "UNRESOLVED").toUpperCase();
  if (status !== "RESOLVED") return status === "CONFLICTING" ? "Conflicting evidence" : "Unresolved";
  return `Resolved · ${String(resolution.confidence ?? "not recorded").replaceAll("_", " ")}`;
}
export function discoverySignal(candidate: OperatorCandidate) { return candidate.candidate_name || "Discovery signal not recorded"; }
export function contactShortLabel(candidate: OperatorCandidate) {
  const state = contactState(candidate);
  if (state === "Verified route available") return "Verified target contact";
  if (state === "Research required") return "Research not completed";
  return "No verified target contact";
}
export function reviewReason(candidate: OperatorCandidate) { return reviewDecision(candidate) || "Decision context not recorded"; }
export function runDateLabel(run?: OperatorRun | null) { return formatDate(run?.created_at ?? run?.started_at, "Date not recorded"); }

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

export function dispositionReason(candidate: OperatorCandidate) {
  const value = intelligence(candidate);
  return String(value.runResult?.dispositionReason ?? value.outreachBlockOrReviewReason ?? value.accountCreationReason ?? value.recommendedNextAction ?? "No additional disposition reason was recorded.");
}

export function resultDataQualityWarnings(candidate: OperatorCandidate) {
  const warnings: string[] = [];
  if (!asArray(candidate.source_urls).length && !facts(candidate).some((fact) => fact.sourceUrl)) warnings.push("Source not recorded");
  if (!facts(candidate).length) warnings.push("Evidence not recorded");
  if (unknowns(candidate).length) warnings.push(`${unknowns(candidate).length} unresolved item${unknowns(candidate).length === 1 ? "" : "s"}`);
  return warnings;
}

export function runResultReconciliation(run: OperatorRun | null, candidates: OperatorCandidate[]) {
  const summary = asObject(run?.summary);
  const persisted = run ? candidates.filter((candidate) => candidate.discovery_run_id === run.id).length : 0;
  const recordedFound = typeof summary.discovered === "number" ? summary.discovered : persisted;
  return { recordedFound, persisted, missing: Math.max(0, recordedFound - persisted), complete: recordedFound <= persisted };
}

export function matchesRunResultMetric(candidate: OperatorCandidate, metric: RunResultMetric) {
  const value = intelligence(candidate);
  switch (metric) {
    case "found": return true;
    case "resolved": return value.organisationResolution?.status === "RESOLVED";
    case "unresolved": return value.organisationResolution?.status === "UNRESOLVED";
    case "enriched": return value.enrichment?.succeeded === true;
    case "advanced": return value.enrichment?.commerciallyAdvanced === true;
    case "qualified": return candidate.status === "QUALIFIED";
    case "review": return candidate.status === "REVIEW_REQUIRED";
    case "rejected": return ["BLOCKED", "REJECTED"].includes(candidate.status);
    case "contactable": return contactState(candidate) === "Verified route available";
  }
}

export function runCounts(run: OperatorRun | null, candidates: OperatorCandidate[]) {
  const scoped = run ? candidates.filter((candidate) => candidate.discovery_run_id === run.id) : [];
  return {
    found: runResultReconciliation(run, candidates).recordedFound,
    resolved: scoped.filter((candidate) => matchesRunResultMetric(candidate, "resolved")).length,
    unresolved: scoped.filter((candidate) => matchesRunResultMetric(candidate, "unresolved")).length,
    enriched: scoped.filter((candidate) => matchesRunResultMetric(candidate, "enriched")).length,
    advanced: scoped.filter((candidate) => matchesRunResultMetric(candidate, "advanced")).length,
    qualified: scoped.filter((candidate) => matchesRunResultMetric(candidate, "qualified")).length,
    review: scoped.filter((candidate) => matchesRunResultMetric(candidate, "review")).length,
    rejected: scoped.filter((candidate) => matchesRunResultMetric(candidate, "rejected")).length,
    duplicate: scoped.filter((candidate) => candidate.status === "DUPLICATE").length,
    contactable: scoped.filter((candidate) => matchesRunResultMetric(candidate, "contactable")).length,
  };
}

export const operatorLanguage = Object.freeze({
  lanes: { EVENT_FIRST: "Event", ORGANISATION_FIRST: "Organisation", PERSON_FIRST: "Person", VENUE_FIRST: "Venue" },
  resolution: { SAFE_UNRESOLVED: "Needs identity review", REGISTRAR_CONFIRMED: "Company verified" },
  activity: { ACTIVE_UPCOMING: "Upcoming activity" },
  relationship: { PROSPECT: "Candidate" },
  domain: { DOMAIN_QUERY_SCOPED: "Employer likely matched", DOMAIN_MISSING: "Employer needs checking" },
  contact: { NO_VERIFIED_TARGET_ROUTE: "No verified business email" },
  draft: { DRAFT_READY: "Ready to review", HUMAN_REVIEW_REQUIRED: "Needs your review", DO_NOT_DRAFT: "Not suitable for email", PENDING_HUMAN_APPROVAL: "Draft awaiting approval", HUMAN_APPROVED_DRAFT: "Draft approved — not sent" },
  lifecycle: { REJECTED: "Excluded", DUPLICATE: "Already tracked" },
  pilot: { PILOT_NOT_ENABLED: "Pilot drafting is currently switched off" },
} as const);

function composerMetadata(candidate: OperatorCandidate) {
  return asObject(asObject(candidate.account?.metadata).outreachComposer);
}

export function prospectType(candidate: OperatorCandidate) {
  return operatorLanguage.lanes[candidate.origin as keyof typeof operatorLanguage.lanes] ?? "Organisation";
}

export function prospectPriority(candidate: OperatorCandidate) {
  const value = String(intelligence(candidate).commercialPriority ?? intelligence(candidate).priority ?? "STANDARD").toUpperCase();
  if (value === "PHASE_ONE_PRIORITY" || value === "HIGH") return "Phase One priority";
  if (value === "ENTERPRISE_DEFERRED" || value === "DEFERRED") return "Deferred";
  return "Standard priority";
}

export function operatorWorkflowState(candidate: OperatorCandidate) {
  if (candidate.status === "DUPLICATE" || candidate.dedupe_of_candidate_id) return operatorLanguage.lifecycle.DUPLICATE;
  if (["REJECTED", "BLOCKED"].includes(candidate.status)) return operatorLanguage.lifecycle.REJECTED;
  if (prospectPriority(candidate) === "Deferred") return "Deferred";
  const composer = composerMetadata(candidate);
  if (composer.approved === true || composer.state === "HUMAN_APPROVED_DRAFT") return operatorLanguage.draft.HUMAN_APPROVED_DRAFT;
  if (composer.pending === true || composer.state === "PENDING_HUMAN_APPROVAL") return operatorLanguage.draft.PENDING_HUMAN_APPROVAL;
  const value = intelligence(candidate);
  const resolution = String(value.organisationResolution?.status ?? "UNRESOLVED").toUpperCase();
  if (needsReview(candidate) || resolution !== "RESOLVED") return "Needs identity review";
  if (!candidate.contacts?.length) return "Ready for person review";
  if (contactState(candidate) !== "Verified route available") return "Contact needs review";
  return "Ready for person review";
}

export function operatorNextAction(candidate: OperatorCandidate) {
  switch (operatorWorkflowState(candidate)) {
    case "Needs identity review": return "Confirm organiser";
    case "Ready for person review": return candidate.contacts?.length ? "Review people" : "Select person";
    case "Contact needs review": return "Review email";
    case operatorLanguage.draft.HUMAN_APPROVED_DRAFT: return "No action";
    case operatorLanguage.draft.PENDING_HUMAN_APPROVAL: return "Review email";
    case "Deferred": return "No action";
    default: return "No action";
  }
}

export function operatorWhyRelevant(candidate: OperatorCandidate) {
  const value = intelligence(candidate);
  const known = facts(candidate)[0]?.claim ?? asArray<any>(value.commercialEvidence ?? value.evidence)[0]?.claim;
  if (typeof known === "string" && known.trim()) return known.trim().replace(/\s+/g, " ").slice(0, 155);
  const eventName = String(asObject(candidate.account?.metadata).eventName ?? candidate.candidate_name ?? "").trim();
  if (candidate.origin === "EVENT_FIRST") return eventName ? `${eventName} shows event activity relevant to EventSuite.` : "Event activity may be relevant to EventSuite.";
  if (candidate.origin === "VENUE_FIRST") return "Active venue programming may be relevant to EventSuite.";
  if (candidate.origin === "PERSON_FIRST") return "Current event-sector activity may lead to a useful route into the organisation.";
  return `${organisationName(candidate)} is associated with event activity relevant to EventSuite.`;
}

export function operatorContactState(candidate: OperatorCandidate) {
  if (candidate.contacts?.some((contact) => contact.email && ["VERIFIED", "VALID"].includes(String(contact.verification_status ?? "").toUpperCase()))) return "Business email verified";
  if (candidate.contacts?.length) return "Employer likely matched";
  const state = contactState(candidate);
  return state === "Research required" ? "Needs review" : "No email found";
}

export function operatorPersonLabel(candidate: OperatorCandidate) {
  const contact = candidate.contacts?.[0];
  if (!contact) return "No person selected";
  const name = String(contact.full_name ?? contact.name ?? "Person selected");
  return `${name} · ${operatorContactState(candidate)}`;
}

export function operatorRoleLabel(value: unknown) {
  const classification = String(value ?? "").toUpperCase();
  if (classification === "DIRECT_BUYER_CANDIDATE") return "Likely buyer";
  if (classification === "ROUTE_TO_BUYER") return "Can introduce us";
  if (classification === "FREELANCE_EVENT_CONNECTOR") return "Freelance event contact";
  if (classification === "ACTIVITY_UNVERIFIED") return "Activity needs checking";
  return "Potential person";
}

export function operatorActivityLabel(value: unknown) {
  const activity = String(value ?? "").toUpperCase();
  const labels: Record<string, string> = {
    ACTIVE_UPCOMING: "Upcoming activity",
    ACTIVE_RECURRING: "Recurring activity",
    RECENT: "Recent activity",
    HISTORICAL: "Historical activity",
    NOT_ESTABLISHED: "Activity not established",
    SAFE_UNRESOLVED: "Identity needs review",
    DOMAIN_QUERY_SCOPED: "Employer matched by an approved search; human review required",
    PHASE_ONE_PRIORITY: "Phase One priority",
    REVIEW_REQUIRED: "Needs review",
  };
  return labels[activity] ?? (activity ? activity.replaceAll("_", " ").toLowerCase() : "Activity not recorded");
}

export function paginationModel(total: number, page: number, pageSize: number) {
  const safeTotal = Math.max(0, Number.isFinite(total) ? Math.floor(total) : 0);
  const safePageSize = Math.max(1, Number.isFinite(pageSize) ? Math.floor(pageSize) : 1);
  const pageCount = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const currentPage = Math.min(pageCount, Math.max(1, Number.isFinite(page) ? Math.floor(page) : 1));
  const start = safeTotal === 0 ? 0 : (currentPage - 1) * safePageSize + 1;
  const end = safeTotal === 0 ? 0 : Math.min(currentPage * safePageSize, safeTotal);
  return {
    page: currentPage,
    pageCount,
    start,
    end,
    rangeLabel: safeTotal === 0 ? "0 prospects" : `Showing ${start}–${end} of ${safeTotal}`,
  };
}
