import { createHash } from "node:crypto";

export type SourceDiscoveryBatchScope = {
  scopeId: string;
  manifestSha256: string;
  validFrom: string;
  validUntil: string;
  maxVenues: number;
  maxRequestsPerVenue: number;
  maxTotalRequests: number;
  paidProviderBudgetUsd: 0;
  records: Array<{ listingId: string; host: string; idempotencyKey: string; requestSha256: string }>;
};

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function sourceDiscoveryManifestSha256(manifest: Record<string, unknown>) {
  const { manifestSha256: _ignored, ...body } = manifest;
  return createHash("sha256").update(stableJson(body)).digest("hex");
}

export function sourceDiscoveryRequestSha256(request: Record<string, unknown>) {
  const { batchExecution: _scopeBinding, ...unbound } = request;
  return createHash("sha256").update(stableJson(unbound)).digest("hex");
}

export function validateBatchScope(scope: SourceDiscoveryBatchScope, now = Date.now()) {
  if (!/^[0-9a-f]{64}$/i.test(scope.manifestSha256) || !scope.scopeId) throw new Error("BATCH_SCOPE_INVALID");
  const from = Date.parse(scope.validFrom), until = Date.parse(scope.validUntil);
  if (!Number.isFinite(from) || !Number.isFinite(until) || from >= until) throw new Error("BATCH_SCOPE_WINDOW_INVALID");
  if (!Number.isInteger(scope.maxVenues) || !Number.isInteger(scope.maxRequestsPerVenue) || !Number.isInteger(scope.maxTotalRequests)
    || scope.maxVenues < 1 || scope.maxVenues > 50 || scope.maxRequestsPerVenue < 1 || scope.maxRequestsPerVenue > 14
    || scope.maxTotalRequests < 1 || scope.maxTotalRequests > 700
    || scope.maxTotalRequests > scope.maxVenues * scope.maxRequestsPerVenue || scope.paidProviderBudgetUsd !== 0) {
    throw new Error("BATCH_SCOPE_BUDGET_INVALID");
  }
  if (!Array.isArray(scope.records) || scope.records.length < 1 || scope.records.length > scope.maxVenues) throw new Error("BATCH_SCOPE_RECORDS_INVALID");
  const ids = new Set<string>(), hosts = new Set<string>(), keys = new Set<string>();
  for (const row of scope.records) {
    if (!row.listingId || !/^[a-z0-9.-]+$/i.test(row.host) || !row.idempotencyKey || !/^[0-9a-f]{64}$/i.test(row.requestSha256)
      || ids.has(row.listingId) || hosts.has(row.host.toLowerCase()) || keys.has(row.idempotencyKey)) throw new Error("BATCH_SCOPE_RECORD_DUPLICATE_OR_INVALID");
    ids.add(row.listingId); hosts.add(row.host.toLowerCase()); keys.add(row.idempotencyKey);
  }
  return { active: now >= from && now < until, expiresAt: new Date(until).toISOString() };
}

export function authorizeBatchRequest(scope: SourceDiscoveryBatchScope, request: {
  batchExecution?: unknown; contractVersion?: unknown; originatingProduct?: unknown;
  subjectReference?: { entityType?: unknown }; acquisitionGoal?: unknown; venueName?: unknown; verifiedSourceUrl: string;
  idempotencyKey: string; crawlBudget: Record<string, number>;
}, now = Date.now()) {
  const state = validateBatchScope(scope, now);
  if (!state.active) throw new Error(now < Date.parse(scope.validFrom) ? "BATCH_SCOPE_NOT_YET_VALID" : "BATCH_SCOPE_EXPIRED");
  const binding = request.batchExecution as { scopeId?: unknown; manifestSha256?: unknown; listingId?: unknown } | undefined;
  if (!binding || binding.scopeId !== scope.scopeId || binding.manifestSha256 !== scope.manifestSha256) throw new Error("BATCH_SCOPE_IDENTITY_MISMATCH");
  if (request.contractVersion !== "nexus.source-discovery-request.v1" || request.originatingProduct !== "event_suite_resources"
    || request.subjectReference?.entityType !== "VENUE" || request.acquisitionGoal !== "VENUE_EMAIL") throw new Error("BATCH_SCOPE_PURPOSE_DENIED");
  const listingId = String(binding.listingId ?? "");
  const host = new URL(request.verifiedSourceUrl).hostname.toLowerCase();
  const record = scope.records.find(row => row.listingId === listingId && row.host.toLowerCase() === host
    && row.idempotencyKey === request.idempotencyKey);
  if (!record) throw new Error("BATCH_SCOPE_ORIGIN_OR_RECORD_DENIED");
  if (sourceDiscoveryRequestSha256(request as Record<string, unknown>) !== record.requestSha256.toLowerCase()) throw new Error("BATCH_SCOPE_REQUEST_MISMATCH");
  const budget = request.crawlBudget ?? {};
  if (budget.maxRequests < 1 || budget.maxRequests > scope.maxRequestsPerVenue) throw new Error("BATCH_SCOPE_HOST_BUDGET_EXCEEDED");
  if (budget.maxPages > 8 || budget.maxBytesPerResponse > 1_500_000 || budget.maxRedirects > 4 || budget.maxRetries > 1) throw new Error("BATCH_SCOPE_REQUEST_BUDGET_EXCEEDED");
  return { listingId, host, requestBudget: budget.maxRequests, scopeId: scope.scopeId,
    manifestSha256: scope.manifestSha256, requestSha256: record.requestSha256.toLowerCase() };
}
