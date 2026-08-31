import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deriveDiscoveryRunSummary, discoveryRunSummaryReconciles } from "../src/ai-sales-team/run-results.ts";
import { matchesRunResultMetric, runResultReconciliation, type OperatorCandidate, type OperatorRun } from "../src/operator-ui/logic.ts";

const candidate = (overrides: Partial<OperatorCandidate> = {}): OperatorCandidate => ({
  id: "candidate-1", discovery_run_id: "run-1", canonical_key: "candidate-1", candidate_name: "Candidate", territory_code: "ZA", origin: "ORGANISATION_FIRST", status: "REJECTED", relationship: "UNKNOWN", facts: [], inferences: [], unknowns: [], prospect_intelligence: {}, ...overrides,
});

const run = (summary: Record<string, unknown>): OperatorRun => ({ id: "run-1", territory_code: "ZA", focus: "ALL", status: "COMPLETED", summary });

test("found and disposition counters are derived from the persisted result ledger", () => {
  const results = [{ status: "REJECTED" }];
  const summary = deriveDiscoveryRunSummary(results);
  assert.equal(summary.discovered, 1);
  assert.equal(summary.blockedOrRejected, 1);
  assert.equal(discoveryRunSummaryReconciles(summary, results), true);
  assert.equal(discoveryRunSummaryReconciles({ ...summary, discovered: 2 }, results), false);
});

test("all persisted results remain visible while attention only includes review-required records", () => {
  const results = [candidate({ id: "review", status: "REVIEW_REQUIRED" }), candidate({ id: "rejected-a", status: "REJECTED" }), candidate({ id: "rejected-b", status: "REJECTED" })];
  assert.equal(results.filter((item) => matchesRunResultMetric(item, "found")).length, 3);
  assert.equal(results.filter((item) => matchesRunResultMetric(item, "review")).length, 1);
  assert.equal(results.filter((item) => matchesRunResultMetric(item, "rejected")).length, 2);
});

test("legacy aggregate-only runs are explicitly marked incomplete instead of treated as zero results", () => {
  assert.deepEqual(runResultReconciliation(run({ discovered: 1 }), []), { recordedFound: 1, persisted: 0, missing: 1, complete: false });
  assert.deepEqual(runResultReconciliation(run({ discovered: 1 }), [candidate()]), { recordedFound: 1, persisted: 1, missing: 0, complete: true });
});

test("run results UI keeps attention, all results, filter and historical states distinct", async () => {
  const source = await readFile("app/operator/operator-views.tsx", "utf8");
  assert.match(source, /WHAT NEEDS YOUR ATTENTION\?/);
  assert.match(source, /ALL RUN RESULTS/);
  assert.match(source, /No human decisions are required/);
  assert.match(source, /No prospects were found/);
  assert.match(source, /No results match these filters/);
  assert.match(source, /HISTORICAL DATA INCOMPLETE/);
  assert.match(source, /onMetricFilter=\{selectMetric\}/);
});

test("future discovery persistence records provenance and refuses divergent counters", async () => {
  const source = await readFile("app/api/ai-sales/discovery/route.ts", "utf8");
  assert.match(source, /schemaVersion: "ai-sales-run-results-v1"/);
  assert.match(source, /runResult: \{ recordedAt/);
  assert.match(source, /discoveryRunSummaryReconciles\(counts, saved\)/);
  assert.match(source, /countersDerivedFrom: "persisted_result_ledger"/);
});
