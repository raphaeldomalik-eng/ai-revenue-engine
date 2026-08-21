import test from "node:test";
import assert from "node:assert/strict";
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
