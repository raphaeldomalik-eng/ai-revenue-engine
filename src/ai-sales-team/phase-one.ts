import type { DiscoveryLane } from "./prospect-intelligence.ts";

export const PHASE_ONE_CLASSIFICATIONS = ["PHASE_ONE_PRIORITY", "STANDARD_PRIORITY", "ENTERPRISE_DEFERRED"] as const;
export type PhaseOneClassification = typeof PHASE_ONE_CLASSIFICATIONS[number];
export type PhaseOneEvidenceKind = "INDEPENDENT_ORGANISER" | "REGIONAL_SCOPE" | "SMALLER_EVENT_AGENCY" | "ENTERPRISE_GROUP" | "COMPANIES_HOUSE_ACCOUNT_CATEGORY" | "VENUE_CAPACITY";
export type PhaseOneEvidence = { kind: PhaseOneEvidenceKind; value: string; sourceUrl: string | null; confidence: "LOW" | "MEDIUM" | "HIGH" };
export type PhaseOneAssessment = { classification: PhaseOneClassification; priorityScore: number; reason: string; evidence: PhaseOneEvidence[] };
export type PhaseOneCandidate = { lane: DiscoveryLane; territory: "GB" | "ZA"; evidence?: PhaseOneEvidence[] };

export const PHASE_ONE_LANE_SEQUENCES: Record<DiscoveryLane, readonly string[]> = {
  ORGANISATION_FIRST: ["COMPANIES_HOUSE_SEARCH", "COMPANIES_HOUSE_PROFILE", "PUBLIC_WEB_IDENTITY_AND_ACTIVITY", "EVENTSUITE_FIT", "APOLLO_PEOPLE_SEARCH", "HUMAN_SELECTION", "SELECTED_ENRICHMENT"],
  EVENT_FIRST: ["PUBLIC_WEB_EVENT_DISCOVERY", "PUBLIC_WEB_ORGANISER_RESOLUTION", "COMPANIES_HOUSE_SEARCH", "COMPANIES_HOUSE_PROFILE", "PUBLIC_WEB_DOMAIN_CONFIRMATION", "OPTIONAL_GOOGLE_PLACES", "EVENTSUITE_FIT", "APOLLO_PEOPLE_SEARCH", "HUMAN_SELECTION", "SELECTED_ENRICHMENT"],
  VENUE_FIRST: ["GOOGLE_PLACES_TEXT_SEARCH", "GOOGLE_PLACES_SELECTED_DETAILS", "PUBLIC_WEB_OPERATOR_AND_DOMAIN", "COMPANIES_HOUSE_SEARCH", "COMPANIES_HOUSE_PROFILE", "EVENTSUITE_FIT", "APOLLO_PEOPLE_SEARCH", "HUMAN_SELECTION", "SELECTED_ENRICHMENT"],
  PERSON_FIRST: ["PUBLIC_WEB_PERSON_DISCOVERY", "PUBLIC_WEB_EMPLOYER_AND_DOMAIN", "COMPANIES_HOUSE_SEARCH", "COMPANIES_HOUSE_PROFILE", "APOLLO_EMPLOYMENT_AND_ROLE_CHECK", "EVENTSUITE_FIT", "HUMAN_SELECTION", "SELECTED_ENRICHMENT"],
};

function supported(evidence: PhaseOneEvidence[], kind: PhaseOneEvidenceKind) {
  return evidence.some((item) => item.kind === kind && ["HIGH", "MEDIUM"].includes(item.confidence));
}

export function assessPhaseOneCandidate(input: PhaseOneCandidate): PhaseOneAssessment {
  const evidence = input.evidence ?? [];
  if (supported(evidence, "ENTERPRISE_GROUP")) return { classification: "ENTERPRISE_DEFERRED", priorityScore: 0, reason: "Strong public evidence identifies an enterprise or enterprise group; retain for later sequencing rather than reject.", evidence };
  if (input.territory === "GB" && (supported(evidence, "INDEPENDENT_ORGANISER") || supported(evidence, "REGIONAL_SCOPE") || supported(evidence, "SMALLER_EVENT_AGENCY"))) return { classification: "PHASE_ONE_PRIORITY", priorityScore: 100, reason: "A documented Phase One focus signal supports priority routing; it is not a proof of company size and does not require SME verification.", evidence };
  if (supported(evidence, "COMPANIES_HOUSE_ACCOUNT_CATEGORY")) return { classification: "STANDARD_PRIORITY", priorityScore: 50, reason: "Companies House account category is informative evidence only; unknown size remains eligible and research is not blocked.", evidence };
  if (supported(evidence, "VENUE_CAPACITY")) return { classification: "STANDARD_PRIORITY", priorityScore: 50, reason: "Venue capacity or attendance is informative only and does not establish operator size; research remains eligible.", evidence };
  return { classification: "STANDARD_PRIORITY", priorityScore: 50, reason: "Company size is unknown and optional; do not guess or spend research calls proving it.", evidence };
}

export function rankPhaseOneCandidates<T extends { phaseOneAssessment: PhaseOneAssessment }>(candidates: T[]) {
  return candidates.map((candidate, index) => ({ candidate, sourceIndex: index })).sort((left, right) => right.candidate.phaseOneAssessment.priorityScore - left.candidate.phaseOneAssessment.priorityScore || left.sourceIndex - right.sourceIndex).map((item, index) => ({ ...item.candidate, deterministicRank: index + 1 }));
}
