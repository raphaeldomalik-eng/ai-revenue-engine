import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { classificationRequiresReason, describeDataQuality, enrichmentEligibility, isExcludedClassification, isOperationalLead, pageRange } from "../src/incoming-leads/workspace.ts";

test("ticketing providers are excluded from active lead treatment and enrichment eligibility", () => {
  assert.equal(isExcludedClassification("TICKETING_PROVIDER"), true);
  assert.equal(isOperationalLead("TICKETING_PROVIDER"), false);
  assert.equal(enrichmentEligibility({ lead_classification: "TICKETING_PROVIDER", account_id: "account-1", identity_review_state: "RESOLVED" }), "NOT_ELIGIBLE");
  assert.equal(isOperationalLead("GENUINE_PROSPECT"), true);
});

test("classification reasons are mandatory for non-leads and existing customers", () => {
  assert.equal(classificationRequiresReason("TICKETING_PROVIDER"), true);
  assert.equal(classificationRequiresReason("EXISTING_CUSTOMER"), true);
  assert.equal(classificationRequiresReason("GENUINE_PROSPECT"), false);
});

test("data quality is specific and enrichment waits for a resolved account", () => {
  assert.deepEqual(describeDataQuality({ current_intent: "LOW", identity_review_state: "AMBIGUOUS_ACCOUNT" }), ["Organisation unresolved", "Account match ambiguous", "Website or domain missing", "Role unknown", "Location missing", "No meaningful commercial signal yet"]);
  assert.equal(enrichmentEligibility({ lead_classification: "NEEDS_REVIEW", identity_review_state: "AMBIGUOUS_ACCOUNT" }), "BLOCKED_UNTIL_IDENTITY_RESOLVED");
  assert.equal(enrichmentEligibility({ lead_classification: "GENUINE_PROSPECT", account_id: "account-1", identity_review_state: "RESOLVED", enrichment_evidence_count: 2 }), "EVIDENCE_AVAILABLE");
});

test("pagination uses bounded server page ranges", () => {
  assert.deepEqual(pageRange(3, 50), { page: 3, pageSize: 50, offset: 100 });
  assert.deepEqual(pageRange(-1, 9), { page: 1, pageSize: 25, offset: 0 });
});

test("operator workspace migration provides audited classification, restore, queue filtering and role gates", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260831150000_incoming_leads_operator_workspace_v1.sql", import.meta.url), "utf8");
  const opportunityGate = await readFile(new URL("../supabase/migrations/20260831152000_incoming_leads_classification_opportunity_gate.sql", import.meta.url), "utf8");
  const api = await readFile(new URL("../app/api/incoming-leads/route.ts", import.meta.url), "utf8");
  const ui = await readFile(new URL("../app/operator/incoming-leads/incoming-leads-view.tsx", import.meta.url), "utf8");
  assert.match(sql, /lead_classification text not null default 'NEEDS_REVIEW'/i);
  assert.match(sql, /TICKETING_PROVIDER/);
  assert.match(sql, /p_action='CLASSIFY'/);
  assert.match(sql, /INCOMING_LEAD_EXCLUSION_REASON_REQUIRED/);
  assert.match(sql, /p_action='RESTORE'/);
  assert.match(sql, /lead_classification='NEEDS_REVIEW'/);
  assert.match(sql, /insert into public\.incoming_lead_changes/i);
  assert.match(sql, /INCOMING_LEAD_OPERATOR_REQUIRED/);
  assert.match(sql, /create or replace function public\.bulk_update_incoming_leads/i);
  assert.match(sql, /p_action not in \('ASSIGN_OWNER','MARK_REVIEWED','CLASSIFY'\)/);
  assert.match(sql, /create or replace function public\.list_incoming_lead_queue/i);
  assert.match(sql, /p_view='excluded'[\s\S]*TICKETING_PROVIDER/i);
  assert.match(sql, /limit greatest\(1,least\(p_limit,100\)\) offset greatest\(0,p_offset\)/i);
  assert.match(sql, /create or replace function public\.incoming_lead_operational_metrics/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /revoke all on function public\.list_incoming_lead_queue/i);
  assert.match(sql, /grant execute on function public\.list_incoming_lead_queue/i);
  assert.match(sql, /revoke execute on function public\.list_incoming_lead_queue[\s\S]*from anon/i);
  assert.match(opportunityGate, /v_lead_classification='GENUINE_PROSPECT'/);
  assert.match(opportunityGate, /New records begin NEEDS_REVIEW/);
  assert.match(api, /access\.memberRole !== "operator" && access\.memberRole !== "admin"/);
  assert.match(api, /client\.rpc\("list_incoming_lead_queue"/);
  assert.match(api, /client\.rpc\("bulk_update_incoming_leads"/);
  assert.match(ui, /COMPLETE INTERACTION TIMELINE/);
  assert.match(ui, /database-filtered/);
  assert.match(ui, /Exclude ticketing/);
  assert.match(ui, /QuickReviewDrawer/);
  assert.match(ui, /Undo exclusion/);
  assert.match(ui, /keyboard triage/);
  assert.match(ui, /No send, schedule, provider or message action exists/);
});
