import assert from "node:assert/strict";
import test from "node:test";
import { assessPhaseOneCandidate, PHASE_ONE_LANE_SEQUENCES, rankPhaseOneCandidates, type PhaseOneEvidence } from "../src/ai-sales-team/phase-one.ts";

const evidence = (kind: PhaseOneEvidence["kind"], value = "supported", confidence: PhaseOneEvidence["confidence"] = "HIGH"): PhaseOneEvidence => ({ kind, value, confidence, sourceUrl: "https://official.example.test/source" });

test("Phase One exposes only the three documented size classifications", () => {
  assert.deepEqual(assessPhaseOneCandidate({ lane: "ORGANISATION_FIRST", territory: "GB", evidence: [evidence("INDEPENDENT_ORGANISER")] }).classification, "PHASE_ONE_SME");
  assert.deepEqual(assessPhaseOneCandidate({ lane: "ORGANISATION_FIRST", territory: "GB", evidence: [evidence("ENTERPRISE_GROUP")] }).classification, "ENTERPRISE_DEFERRED");
  assert.deepEqual(assessPhaseOneCandidate({ lane: "ORGANISATION_FIRST", territory: "GB", evidence: [] }).classification, "SIZE_UNRESOLVED");
});

test("account categories and venue capacity are indicators only, never guessed size", () => {
  const accountCategory = assessPhaseOneCandidate({ lane: "ORGANISATION_FIRST", territory: "GB", evidence: [evidence("COMPANIES_HOUSE_ACCOUNT_CATEGORY", "small")] });
  const venueCapacity = assessPhaseOneCandidate({ lane: "VENUE_FIRST", territory: "GB", evidence: [evidence("VENUE_CAPACITY", "large venue")] });
  assert.equal(accountCategory.classification, "SIZE_UNRESOLVED");
  assert.equal(venueCapacity.classification, "SIZE_UNRESOLVED");
  assert.match(accountCategory.reason, /indicator|insufficient/i);
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

test("Phase One ranking prefers SME evidence, then unresolved, with stable ties", () => {
  const candidates = [
    { id: "unresolved", phaseOneAssessment: assessPhaseOneCandidate({ lane: "ORGANISATION_FIRST", territory: "GB" }) },
    { id: "sme", phaseOneAssessment: assessPhaseOneCandidate({ lane: "EVENT_FIRST", territory: "GB", evidence: [evidence("REGIONAL_SCOPE")] }) },
    { id: "deferred", phaseOneAssessment: assessPhaseOneCandidate({ lane: "VENUE_FIRST", territory: "GB", evidence: [evidence("ENTERPRISE_GROUP")] }) },
  ];
  const ranked = rankPhaseOneCandidates(candidates);
  assert.deepEqual(ranked.map((item) => item.id), ["sme", "unresolved", "deferred"]);
  assert.deepEqual(ranked.map((item) => item.deterministicRank), [1, 2, 3]);
});
