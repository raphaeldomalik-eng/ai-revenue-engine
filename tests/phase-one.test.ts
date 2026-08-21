import assert from "node:assert/strict";
import test from "node:test";
import { assessPhaseOneCandidate, PHASE_ONE_LANE_SEQUENCES, rankPhaseOneCandidates, type PhaseOneEvidence } from "../src/ai-sales-team/phase-one.ts";

const evidence = (kind: PhaseOneEvidence["kind"], value = "supported", confidence: PhaseOneEvidence["confidence"] = "HIGH"): PhaseOneEvidence => ({ kind, value, confidence, sourceUrl: "https://official.example.test/source" });

test("Phase One exposes soft priority classifications without requiring SME proof", () => {
  const priority = assessPhaseOneCandidate({ lane: "ORGANISATION_FIRST", territory: "GB", evidence: [evidence("INDEPENDENT_ORGANISER")] });
  assert.equal(priority.classification, "PHASE_ONE_PRIORITY");
  assert.match(priority.reason, /not.*proof|not.*size|SME/i);
  assert.deepEqual(assessPhaseOneCandidate({ lane: "ORGANISATION_FIRST", territory: "GB", evidence: [evidence("ENTERPRISE_GROUP")] }).classification, "ENTERPRISE_DEFERRED");
  assert.deepEqual(assessPhaseOneCandidate({ lane: "ORGANISATION_FIRST", territory: "GB", evidence: [] }).classification, "STANDARD_PRIORITY");
});

test("account categories and venue capacity are indicators only, never guessed size", () => {
  const accountCategory = assessPhaseOneCandidate({ lane: "ORGANISATION_FIRST", territory: "GB", evidence: [evidence("COMPANIES_HOUSE_ACCOUNT_CATEGORY", "small")] });
  const venueCapacity = assessPhaseOneCandidate({ lane: "VENUE_FIRST", territory: "GB", evidence: [evidence("VENUE_CAPACITY", "large venue")] });
  assert.equal(accountCategory.classification, "STANDARD_PRIORITY");
  assert.equal(venueCapacity.classification, "STANDARD_PRIORITY");
  assert.match(accountCategory.reason, /informative|unknown|research/i);
  assert.match(venueCapacity.reason, /capacity|size/i);
});

test("enterprise prospects are deferred and all four lane sequences preserve their origin", () => {
  const deferred = assessPhaseOneCandidate({ lane: "EVENT_FIRST", territory: "GB", evidence: [evidence("ENTERPRISE_GROUP", "group evidence")] });
  assert.equal(deferred.classification, "ENTERPRISE_DEFERRED");
  assert.equal(deferred.priorityScore, 0);
  assert.match(deferred.reason, /retain|later|defer/i);
  assert.equal(PHASE_ONE_LANE_SEQUENCES.EVENT_FIRST[0], "PUBLIC_WEB_EVENT_DISCOVERY");
  assert.equal(PHASE_ONE_LANE_SEQUENCES.ORGANISATION_FIRST[0], "COMPANIES_HOUSE_SEARCH");
  assert.equal(PHASE_ONE_LANE_SEQUENCES.PERSON_FIRST[0], "PUBLIC_WEB_PERSON_DISCOVERY");
  assert.equal(PHASE_ONE_LANE_SEQUENCES.VENUE_FIRST[0], "GOOGLE_PLACES_TEXT_SEARCH");
  assert.ok(Object.keys(PHASE_ONE_LANE_SEQUENCES).length === 4);
});

test("Phase One ranking prefers priority signals, then standard, then deferred, with stable ties", () => {
  const candidates = [
    { id: "standard", phaseOneAssessment: assessPhaseOneCandidate({ lane: "ORGANISATION_FIRST", territory: "GB" }) },
    { id: "priority", phaseOneAssessment: assessPhaseOneCandidate({ lane: "EVENT_FIRST", territory: "GB", evidence: [evidence("REGIONAL_SCOPE")] }) },
    { id: "deferred", phaseOneAssessment: assessPhaseOneCandidate({ lane: "VENUE_FIRST", territory: "GB", evidence: [evidence("ENTERPRISE_GROUP")] }) },
  ];
  const ranked = rankPhaseOneCandidates(candidates);
  assert.deepEqual(ranked.map((item) => item.id), ["priority", "standard", "deferred"]);
  assert.deepEqual(ranked.map((item) => item.deterministicRank), [1, 2, 3]);
});
