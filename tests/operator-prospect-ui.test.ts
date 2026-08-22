import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { operatorActivityLabel, operatorContactState, operatorNextAction, operatorPersonLabel, operatorRoleLabel, operatorWorkflowState, operatorWhyRelevant, paginationModel, prospectPriority, prospectType, type OperatorCandidate } from "../src/operator-ui/logic.ts";

const candidate = (overrides: Partial<OperatorCandidate> = {}): OperatorCandidate => ({
  id: "candidate-1", discovery_run_id: "run-1", canonical_key: "dsac", candidate_name: "Mzansi Roar Festival", organiser_name: "Department of Sport, Arts and Culture (DSAC)", website: null, territory_code: "ZA", origin: "EVENT_FIRST", status: "REVIEW_REQUIRED", relationship: "PROSPECT", facts: [{ claim: "DSAC is seeking a festival promoter for the Mzansi Roar Festival.", sourceUrl: "https://example.org/dsac", sourceTitle: "DSAC notice" }], inferences: [], unknowns: ["Event organiser not confirmed"], prospect_intelligence: { recommendedNextAction: "Confirm organiser", organisationResolution: { status: "UNRESOLVED" }, commercialPriority: "PHASE_ONE_PRIORITY" }, ...overrides,
});

test("operator presentation maps internal lanes, priority and review states to plain language", () => {
  const value = candidate();
  assert.equal(prospectType(value), "Event");
  assert.equal(prospectPriority(value), "Phase One priority");
  assert.equal(operatorWorkflowState(value), "Needs identity review");
  assert.equal(operatorNextAction(value), "Confirm organiser");
  assert.match(operatorWhyRelevant(value), /DSAC is seeking a festival promoter/);
});

test("operator people and email labels avoid provider taxonomy", () => {
  const value = candidate({ contacts: [{ id: "contact-1", full_name: "A Person", role_title: "Event Director", email: "a@example.org", verification_status: "VERIFIED", metadata: { buyerRoutingClassification: "ROUTE_TO_BUYER" } }] });
  assert.equal(operatorPersonLabel(value), "A Person · Business email verified");
  assert.equal(operatorContactState(value), "Business email verified");
  assert.equal(operatorRoleLabel("ROUTE_TO_BUYER"), "Can introduce us");
  assert.doesNotMatch(operatorRoleLabel("ROUTE_TO_BUYER"), /DOMAIN_|QUERY_SCOPED|Apollo/);
});

test("pagination clamps invalid pages and produces safe ranges", () => {
  assert.deepEqual(paginationModel(2, 2, 25), { page: 1, pageCount: 1, start: 1, end: 2, rangeLabel: "Showing 1–2 of 2" });
  assert.deepEqual(paginationModel(0, 2, 25), { page: 1, pageCount: 1, start: 0, end: 0, rangeLabel: "0 prospects" });
  assert.deepEqual(paginationModel(26, 2, 25), { page: 2, pageCount: 2, start: 26, end: 26, rangeLabel: "Showing 26–26 of 26" });
  assert.deepEqual(paginationModel(2, 99, 25), { page: 1, pageCount: 1, start: 1, end: 2, rangeLabel: "Showing 1–2 of 2" });
});

test("activity statuses are translated for operators", () => {
  assert.equal(operatorActivityLabel("ACTIVE_UPCOMING"), "Upcoming activity");
  assert.equal(operatorActivityLabel("SAFE_UNRESOLVED"), "Identity needs review");
  assert.equal(operatorActivityLabel("DOMAIN_QUERY_SCOPED"), "Employer matched by an approved search; human review required");
});

test("prospect list uses the compact drawer IA and has no sending control", async () => {
  const source = await readFile("app/operator/operator-views.tsx", "utf8");
  const start = source.lastIndexOf("export function ProspectsView");
  const active = source.slice(start, source.indexOf("const siteTypeLabelsForFilter", start));
  assert.doesNotMatch(active, /Commercial targets, not CRM records|Attention then recency|DISCOVERY SIGNAL|Source type not established|EVENT_FIRST/);
  assert.match(source, /className="drawer-progress"/);
  assert.match(source, /Prospect[\s\S]*Person[\s\S]*Email[\s\S]*Approval/);
  assert.match(source, /Overview.*People.*Email.*History/);
  assert.match(source, /aria-modal=\"true\"/);
  assert.match(source, /Confirm the event organiser before looking for a buyer/);
  assert.match(source, /Draft approved — not sent/);
  assert.doesNotMatch(source, /Send|Schedule|Publish|Enrol|Activate sequence/);
  assert.match(active, /setProspectTypeFilter\(event\.target\.value\); setPage\(1\)/);
  assert.match(active, /setTerritory\(event\.target\.value\); setPage\(1\)/);
  assert.match(active, /setReviewState\(event\.target\.value\); setPage\(1\)/);
  assert.match(active, /setContactFilter\(event\.target\.value\); setPage\(1\)/);
  assert.match(active, /setEmailFilter\(event\.target\.value\); setPage\(1\)/);
  assert.match(active, /setPriority\(event\.target\.value\); setPage\(1\)/);
  assert.match(active, /setQuery\(event\.target\.value\); setPage\(1\)/);
  assert.match(active, /setQueue\(key\); setPage\(1\)/);
  assert.match(source, /onPageSize\(Number\(event\.target\.value\)\); onPage\(1\)/);
  assert.match(active, /paginationModel\(sorted\.length, page, pageSize\)/);
  assert.match(active, /ProspectQueueRow[\s\S]*onOpen=\{openDrawer\}/);
  assert.doesNotMatch(active, /<CandidateLink/);
});

test("deep-link prospect pages redirect to the queue drawer", async () => {
  const source = await readFile("app/operator/prospects/[candidateId]/page.tsx", "utf8");
  assert.match(source, /redirect\(`\/operator\/prospects\?prospect=/);
  assert.doesNotMatch(source, /ProspectDetailView/);
});
