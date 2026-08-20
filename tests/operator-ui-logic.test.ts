import assert from "node:assert/strict";
import test from "node:test";
import { contextLabel, latestRun, needsReview, runCounts, siteTypeLabel, sourceType, type OperatorCandidate, type OperatorRun } from "../src/operator-ui/logic.ts";

const run = (id: string, created_at: string): OperatorRun => ({ id, territory_code: "ZA", focus: "TICKETING", status: "COMPLETED", created_at, summary: {} });
const candidate = (overrides: Partial<OperatorCandidate> = {}): OperatorCandidate => ({ id: "candidate-1", discovery_run_id: "run-1", canonical_key: "key", candidate_name: "Festival X", territory_code: "ZA", origin: "EVENT_FIRST", status: "REVIEW_REQUIRED", relationship: "PROSPECT", facts: [], inferences: [], unknowns: ["Owner not established"], prospect_intelligence: { recommendedNextAction: "Confirm organiser relationship", siteClassifications: [{ siteType: "TICKETING_PROVIDER" }] }, created_at: "2026-08-20T10:00:00Z", ...overrides });

test("latest run selection is newest-first and deterministic", () => {
  assert.equal(latestRun([run("old", "2026-08-18T10:00:00Z"), run("new", "2026-08-20T10:00:00Z")])?.id, "new");
});

test("run context labels new records from the latest run and historical records conservatively", () => {
  assert.equal(contextLabel(candidate({ discovery_run_id: "latest" }), "latest"), "NEW");
  assert.equal(contextLabel(candidate({ discovery_run_id: "old", last_seen_at: "2026-08-20T10:00:00Z" }), "latest", Date.parse("2026-08-20T12:00:00Z")), "CURRENT");
  assert.equal(contextLabel(candidate({ discovery_run_id: "old", last_seen_at: "2026-07-01T10:00:00Z" }), "latest", Date.parse("2026-08-20T12:00:00Z")), "HISTORICAL");
  assert.equal(contextLabel(candidate({ prospect_intelligence: { contextLabel: "CALIBRATION" } }), "latest"), "CALIBRATION");
});

test("ticketing provider sources remain readable provider labels", () => {
  assert.equal(sourceType(candidate()), "TICKETING_PROVIDER");
  assert.equal(siteTypeLabel(sourceType(candidate())), "Ticketing provider");
});

test("review queue excludes qualified records and includes specific decisions", () => {
  assert.equal(needsReview(candidate()), true);
  assert.equal(needsReview(candidate({ status: "QUALIFIED" })), false);
  assert.equal(needsReview(candidate({ prospect_intelligence: {}, unknowns: [] })), false);
});

test("run counts stay scoped to one run", () => {
  const scoped = candidate({ discovery_run_id: "run-1", status: "QUALIFIED" });
  const other = candidate({ id: "candidate-2", discovery_run_id: "run-2", status: "QUALIFIED" });
  assert.deepEqual(runCounts({ ...run("run-1", "2026-08-20T10:00:00Z"), summary: {} }, [scoped, other]), { found: 1, resolved: 0, unresolved: 0, enriched: 0, advanced: 0, qualified: 1, review: 0, rejected: 0, duplicate: 0, contactable: 0 });
});
