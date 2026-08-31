export const LEAD_CLASSIFICATIONS = [
  "NEEDS_REVIEW",
  "GENUINE_PROSPECT",
  "EXISTING_CUSTOMER",
  "PARTNER",
  "SUPPLIER",
  "COMPETITOR",
  "TICKETING_PROVIDER",
  "INTERNAL",
  "TEST_SYNTHETIC",
  "OTHER_NON_LEAD",
] as const;

export type LeadClassification = (typeof LEAD_CLASSIFICATIONS)[number];

export const leadClassificationLabels: Record<LeadClassification, string> = {
  NEEDS_REVIEW: "Needs review",
  GENUINE_PROSPECT: "Genuine prospect",
  EXISTING_CUSTOMER: "Existing customer / tenant",
  PARTNER: "Partner",
  SUPPLIER: "Supplier",
  COMPETITOR: "Competitor",
  TICKETING_PROVIDER: "Ticketing provider",
  INTERNAL: "Internal",
  TEST_SYNTHETIC: "Test / synthetic",
  OTHER_NON_LEAD: "Other non-lead",
};

const nonLeadClassifications = new Set<LeadClassification>([
  "PARTNER",
  "SUPPLIER",
  "COMPETITOR",
  "TICKETING_PROVIDER",
  "INTERNAL",
  "TEST_SYNTHETIC",
  "OTHER_NON_LEAD",
]);

export function isExcludedClassification(classification?: string | null) {
  return nonLeadClassifications.has(classification as LeadClassification);
}

export function isLikelyTicketingOrganisation(organisationName?: string | null) {
  return Boolean(organisationName?.toLowerCase().includes("ticket"));
}

export function isOperationalLead(classification?: string | null, isTest = false) {
  return !isTest && ["NEEDS_REVIEW", "GENUINE_PROSPECT"].includes(classification ?? "NEEDS_REVIEW");
}

export function classificationRequiresReason(classification?: string | null) {
  return classification === "EXISTING_CUSTOMER" || isExcludedClassification(classification);
}

export function describeDataQuality(lead: Record<string, unknown>) {
  const issues: string[] = [];
  if (!lead.organisation_name) issues.push("Organisation unresolved");
  if (lead.identity_review_state === "AMBIGUOUS_ACCOUNT") issues.push("Account match ambiguous");
  else if (!lead.account_id) issues.push("Account match unresolved");
  if (!lead.account_website) issues.push("Website or domain missing");
  if (!lead.contact_role_title) issues.push("Role unknown");
  if (!lead.country_code) issues.push("Location missing");
  if (["LOW", "NURTURE"].includes(String(lead.current_intent))) issues.push("No meaningful commercial signal yet");
  return issues;
}

export function enrichmentEligibility(lead: Record<string, unknown>) {
  if (isExcludedClassification(String(lead.lead_classification)) || lead.lead_classification === "EXISTING_CUSTOMER" || lead.is_test) return "NOT_ELIGIBLE";
  if (!lead.account_id || lead.identity_review_state !== "RESOLVED") return "BLOCKED_UNTIL_IDENTITY_RESOLVED";
  return Number(lead.enrichment_evidence_count ?? 0) > 0 ? "EVIDENCE_AVAILABLE" : "NOT_ENRICHED";
}

export function pageRange(page: number, pageSize: number) {
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const safePageSize = [25, 50, 100].includes(pageSize) ? pageSize : 25;
  return { page: safePage, pageSize: safePageSize, offset: (safePage - 1) * safePageSize };
}
