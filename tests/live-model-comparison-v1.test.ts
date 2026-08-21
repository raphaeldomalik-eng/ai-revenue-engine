import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LIVE_MODEL_COMPARISON_CASES } from "../scripts/live-model-comparison-v1.ts";

test("live model comparison manifest is frozen to four distinct lanes", () => {
  assert.equal(LIVE_MODEL_COMPARISON_CASES.length, 4);
  assert.deepEqual(LIVE_MODEL_COMPARISON_CASES.map((item) => item.lane), ["EVENT_FIRST", "ORGANISATION_FIRST", "PERSON_FIRST", "VENUE_FIRST"]);
  assert.equal(new Set(LIVE_MODEL_COMPARISON_CASES.map((item) => item.id)).size, 4);
  for (const item of LIVE_MODEL_COMPARISON_CASES) {
    assert.ok(item.hint.includes(`lane=${item.lane}`));
    assert.ok(item.evidenceUrls.length >= 2);
    assert.ok(item.laneContext);
  }
});

test("M01 uses Mash Media's authoritative corporate domain", () => {
  const m01 = LIVE_MODEL_COMPARISON_CASES.find((item) => item.id === "M01");
  assert.equal(m01?.laneContext.organisationUrl, "https://mashmedia.net/");
  assert.ok(m01?.evidenceUrls.includes("https://mashmedia.net/"));
  assert.ok(!m01?.hint.includes("mashmedia.co.uk"));
});

test("Apollo acceptance artifact retains sanitized candidate telemetry", () => {
  const artifact = JSON.parse(readFileSync(new URL("../artifacts/ai-revenue-research-team-v1/apollo-primary-people-routing-acceptance.json", import.meta.url), "utf8")) as { cases: Array<{ candidates: Array<Record<string, unknown>> }>; focusedRerun?: { cases: Array<{ candidates: Array<Record<string, unknown>> }> } };
  for (const item of [...artifact.cases, ...(artifact.focusedRerun?.cases ?? [])].flatMap((entry) => entry.candidates)) {
    for (const field of ["employerDomainClassification", "employerDomainReason", "buyerRoutingReason", "roleRankingScore", "deterministicRank", "humanSelectionRecommendation"]) assert.ok(field in item, `missing sanitized telemetry field: ${field}`);
    assert.equal("providerPersonId" in item, false);
    assert.equal("email" in item, false);
    assert.equal("phone" in item, false);
  }
});
