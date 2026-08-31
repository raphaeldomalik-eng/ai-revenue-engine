export type PersistedDiscoveryResult = {
  status: string;
  prospect_intelligence?: unknown;
};

type EnrichmentSummary = Record<string, unknown> | undefined;

export function deriveDiscoveryRunSummary(results: PersistedDiscoveryResult[], enrichment?: EnrichmentSummary) {
  const count = (status: string) => results.filter((result) => result.status === status).length;
  return {
    discovered: results.length,
    qualified: count("QUALIFIED"),
    reviewRequired: count("REVIEW_REQUIRED"),
    blockedOrRejected: results.filter((result) => ["BLOCKED", "REJECTED"].includes(result.status)).length,
    duplicates: count("DUPLICATE"),
    ...(enrichment ?? {}),
  };
}

export function discoveryRunSummaryReconciles(summary: Record<string, unknown>, results: PersistedDiscoveryResult[]) {
  const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : 0;
  return number(summary.discovered) === results.length
    && number(summary.qualified) === results.filter((result) => result.status === "QUALIFIED").length
    && number(summary.reviewRequired) === results.filter((result) => result.status === "REVIEW_REQUIRED").length
    && number(summary.blockedOrRejected) === results.filter((result) => ["BLOCKED", "REJECTED"].includes(result.status)).length
    && number(summary.duplicates) === results.filter((result) => result.status === "DUPLICATE").length;
}
