import assert from "node:assert/strict";
import test from "node:test";
import { assessLeadIntelligence } from "../src/lead-intelligence/assessment.ts";
import { leadIntelligenceFixtures } from "../src/lead-intelligence/fixtures.ts";

const byName = (name: string) => leadIntelligenceFixtures.find((fixture) => fixture.name === name)!.assessment;

test("South African school resolves Direct, Schools, and deferred special pricing", () => {
  const assessment = byName("South African school");
  assert.equal(assessment.territory.code, "ZA");
  assert.equal(assessment.motionCandidate, "DIRECT");
  assert.equal(assessment.clientSegments[0].code, "schools");
  assert.equal(assessment.playbooks[0].playbookId, "event-suite-za-direct");
  assert.equal(assessment.recommendations[0].pricingTreatment, "SPECIAL_DISCOUNT");
  assert.equal(assessment.recommendations[0].pricingStatus, "DEFERRED");
  assert.ok(!("numericDiscount" in assessment.recommendations[0]));
});

test("South African venue is a client type with high-frequency Direct opportunity", () => {
  const assessment = byName("South African high-frequency venue");
  assert.equal(assessment.motionCandidate, "DIRECT");
  assert.equal(assessment.clientSegments[0].code, "venue");
  assert.ok(assessment.signals.some((signal) => signal.code === "HIGH_EVENT_FREQUENCY"));
  assert.equal(assessment.recommendations[0].clientSegment, "venue");
  assert.equal(assessment.recommendations[0].commercialProgram, "event-suite-za-direct");
  assert.equal(assessment.recommendations[0].relevantCapabilities.includes("venue-operations"), false);
});

test("UK promoter with incumbent Ticketing remains a UK Direct opportunity without forced migration", () => {
  const assessment = byName("UK promoter with existing Ticketing");
  assert.equal(assessment.territory.code, "GB");
  assert.equal(assessment.motionCandidate, "DIRECT");
  assert.equal(assessment.playbooks[0].playbookId, "event-suite-gb-direct");
  assert.ok(assessment.signals.some((signal) => signal.code === "USES_EXISTING_TICKETING_PLATFORM"));
  assert.equal(assessment.recommendations[0].relevantCapabilities.includes("ticketing"), false);
  assert.match(assessment.recommendations[0].rationale.join(" "), /no forced migration/i);
});

test("South African event services company resolves LNO enquiry", () => {
  const assessment = byName("South African event services company");
  assert.equal(assessment.motionCandidate, "LNO");
  assert.equal(assessment.playbooks[0].playbookId, "event-suite-za-lno");
  assert.equal(assessment.recommendations[0].conversionRoute, "BUSINESS_OPPORTUNITY_ENQUIRY");
});

test("agency can produce coexisting Direct and LNO opportunities", () => {
  const assessment = byName("South African agency with Direct and LNO potential");
  assert.equal(assessment.motionCandidate, "BOTH");
  assert.deepEqual(assessment.playbooks.map((playbook) => playbook.playbookId), ["event-suite-za-direct", "event-suite-za-lno"]);
  assert.equal(assessment.recommendations.length, 2);
  assert.deepEqual(assessment.recommendations.map((recommendation) => recommendation.salesMotion), ["direct", "lno"]);
});

test("insufficient information remains unknown and produces research gaps", () => {
  const assessment = byName("Insufficient information");
  assert.equal(assessment.territory.code, "UNKNOWN");
  assert.equal(assessment.motionCandidate, "UNKNOWN");
  assert.deepEqual(assessment.clientSegments, []);
  assert.deepEqual(assessment.playbooks, []);
  assert.deepEqual(assessment.recommendations, []);
  assert.ok(assessment.researchGaps.some((gap) => gap.code === "territory_unknown"));
  assert.ok(assessment.researchGaps.some((gap) => gap.code === "client_type_unknown"));
});

test("inferences require explicit evidence and facts remain typed separately", () => {
  const assessment = assessLeadIntelligence({ account: { organisationName: "Unproven School", country: "South Africa", organisationType: "SCHOOL", sourceEvidenceIds: [] }, evidence: [{ id: "inference-1", sourceType: "OTHER", sourceReference: "fixture", title: "Hypothesis", observedFact: "May be a school", observedAt: "2026-08-18", confidence: "LOW", kind: "INFERENCE" }] });
  assert.equal(assessment.territory.code, "UNKNOWN");
  assert.deepEqual(assessment.clientSegments, []);
});

test("assessment reuses the existing commercial playbook resolver", () => {
  const school = byName("South African school");
  const direct = school.playbooks.find((playbook) => playbook.salesMotion === "direct");
  assert.equal(direct?.playbookId, "event-suite-za-direct");
  assert.equal(direct?.conversionGoals.includes("QUALIFIED_LIVE_DEMO"), true);
});
