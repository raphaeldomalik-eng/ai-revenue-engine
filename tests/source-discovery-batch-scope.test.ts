import assert from "node:assert/strict";
import test from "node:test";
import { authorizeBatchRequest, sourceDiscoveryRequestSha256, validateBatchScope } from "../src/nexus/source-discovery/batch-scope.ts";
import type { SourceDiscoveryBatchScope } from "../src/nexus/source-discovery/batch-scope.ts";

const scope: SourceDiscoveryBatchScope = {
  scopeId: "11111111-1111-4111-8111-111111111111",
  manifestSha256: "a".repeat(64),
  validFrom: "2026-10-21T05:00:00.000Z",
  validUntil: "2026-10-21T07:00:00.000Z",
  maxVenues: 26,
  maxRequestsPerVenue: 14,
  maxTotalRequests: 364,
  paidProviderBudgetUsd: 0 as const,
  records: [],
};
const request = {
  contractVersion: "nexus.source-discovery-request.v1",
  originatingProduct: "event_suite_resources",
  subjectReference: { entityType: "VENUE" },
  verifiedSourceUrl: "https://venue.example/contact/",
  acquisitionGoal: "VENUE_EMAIL",
  idempotencyKey: "33333333-3333-4333-8333-333333333333",
  crawlBudget: { maxPages: 8, maxRequests: 14, maxBytesPerResponse: 1_500_000, maxRedirects: 4, maxRetries: 1 },
};
scope.records.push({ listingId: "22222222-2222-4222-8222-222222222222", host: "venue.example", idempotencyKey: "33333333-3333-4333-8333-333333333333", requestSha256: sourceDiscoveryRequestSha256(request) });
const scopedRequest = { ...request, batchExecution: { scopeId: scope.scopeId, manifestSha256: scope.manifestSha256, listingId: scope.records[0].listingId } };

test("exact manifest identity, venue, host and request key authorize only within the window", () => {
  assert.equal(validateBatchScope(scope, Date.parse("2026-10-21T05:30:00Z")).active, true);
  assert.deepEqual(authorizeBatchRequest(scope, scopedRequest, Date.parse("2026-10-21T05:30:00Z")), {
    scopeId: scope.scopeId, manifestSha256: scope.manifestSha256, listingId: scope.records[0].listingId, host: "venue.example", requestBudget: 14,
  });
});

test("scope refuses an unlisted host, venue, idempotency key and altered manifest", () => {
  assert.throws(() => authorizeBatchRequest(scope, { ...scopedRequest, verifiedSourceUrl: "https://other.example/" }, Date.parse("2026-10-21T05:30:00Z")), /BATCH_SCOPE_ORIGIN_OR_RECORD_DENIED/);
  assert.throws(() => authorizeBatchRequest(scope, { ...scopedRequest, idempotencyKey: "44444444-4444-4444-8444-444444444444" }, Date.parse("2026-10-21T05:30:00Z")), /BATCH_SCOPE_ORIGIN_OR_RECORD_DENIED/);
  assert.throws(() => authorizeBatchRequest(scope, { ...scopedRequest, batchExecution: { ...scopedRequest.batchExecution, manifestSha256: "b".repeat(64) } }, Date.parse("2026-10-21T05:30:00Z")), /BATCH_SCOPE_IDENTITY_MISMATCH/);
  assert.throws(() => authorizeBatchRequest(scope, { ...scopedRequest, acquisitionGoal: "VENUE_FACTS" }, Date.parse("2026-10-21T05:30:00Z")), /BATCH_SCOPE_PURPOSE_DENIED/);
  assert.throws(() => authorizeBatchRequest(scope, { ...scopedRequest, venueName: "Different venue" }, Date.parse("2026-10-21T05:30:00Z")), /BATCH_SCOPE_REQUEST_MISMATCH/);
});

test("scope refuses over-budget, paid, invalid and expired authorizations", () => {
  const overBudgetRequest = { ...scopedRequest, crawlBudget: { ...scopedRequest.crawlBudget, maxRequests: 15 } };
  const overBudgetScope = { ...scope, records: scope.records.map(row => ({ ...row, requestSha256: sourceDiscoveryRequestSha256(overBudgetRequest) })) };
  assert.throws(() => authorizeBatchRequest(overBudgetScope, overBudgetRequest, Date.parse("2026-10-21T05:30:00Z")), /BATCH_SCOPE_HOST_BUDGET_EXCEEDED/);
  assert.throws(() => validateBatchScope({ ...scope, paidProviderBudgetUsd: 1 as 0 }, Date.parse("2026-10-21T05:30:00Z")), /BATCH_SCOPE_BUDGET_INVALID/);
  assert.throws(() => authorizeBatchRequest(scope, scopedRequest, Date.parse("2026-10-21T07:00:00Z")), /BATCH_SCOPE_EXPIRED/);
  assert.throws(() => authorizeBatchRequest(scope, scopedRequest, Date.parse("2026-10-21T04:59:59Z")), /BATCH_SCOPE_NOT_YET_VALID/);
});
