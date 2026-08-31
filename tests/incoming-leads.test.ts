import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { communicationPolicy, currentIntent, initialIntent, normalizeEmail, shouldCreateOpportunity, sourceActivityType } from "../src/incoming-leads/domain.ts";
import { incomingLeadFixtures } from "../src/incoming-leads/fixtures.ts";

test("normalizes email for exact identity matching without replacing submitted values", () => {
  assert.equal(normalizeEmail(" AVA@Example.COM "), "ava@example.com");
  assert.equal(normalizeEmail("not-an-email"), null);
});

test("repeated downloads remain medium engagement and a later demo raises intent", () => {
  assert.equal(initialIntent("RESOURCE_DOWNLOAD", 1), "LOW");
  assert.equal(initialIntent("RESOURCE_DOWNLOAD", 4), "MEDIUM");
  assert.equal(currentIntent(["RESOURCE_DOWNLOAD", "TEMPLATE_DOWNLOAD", "RESOURCE_DOWNLOAD"]), "MEDIUM");
  assert.equal(currentIntent(["RESOURCE_DOWNLOAD", "DEMO_REQUEST"]), "VERY_HIGH");
});

test("opportunity rules are deterministic and low-intent downloads do not create one", () => {
  assert.equal(shouldCreateOpportunity("RESOURCE_DOWNLOAD"), false);
  assert.equal(shouldCreateOpportunity("TEMPLATE_DOWNLOAD"), false);
  assert.equal(shouldCreateOpportunity("DEMO_REQUEST"), true);
  assert.equal(sourceActivityType("TRIAL_STARTED"), "trial_started");
});

test("communication treatment is source-specific and consent-aware", () => {
  assert.equal(communicationPolicy("DEMO_REQUEST").responseUrgency, "IMMEDIATE");
  assert.equal(communicationPolicy("RESOURCE_DOWNLOAD", "UNKNOWN").marketingConsentRequired, true);
  assert.deepEqual(communicationPolicy("RESOURCE_DOWNLOAD", "UNKNOWN").recommendedCommunicationSet, ["Requested resource delivery"]);
  assert.equal(communicationPolicy("NEWSLETTER_SIGNUP", "UNKNOWN").recommendedCommunicationSet.length, 0);
  assert.equal(communicationPolicy("INTERNAL_TEST").permittedTreatment, "No communication.");
});

test("fixtures cover duplicate delivery, repeated activity, two people, ambiguity and exclusion", () => {
  assert.ok(incomingLeadFixtures.some((fixture) => fixture.sourceRecordId === "fixture-resource-002"));
  assert.equal(incomingLeadFixtures.filter((fixture) => fixture.submittedEmail?.toLowerCase().includes("northstar-events")).length >= 5, true);
  assert.equal(incomingLeadFixtures.some((fixture) => fixture.sourceCategory === "INTERNAL_TEST"), true);
  assert.equal(incomingLeadFixtures.some((fixture) => fixture.originalPayload.organisationConfidence === "AMBIGUOUS"), true);
});

test("migration protects intake evidence, keeps access fail-closed and does not add a send path", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260828142049_incoming_leads_v1.sql", import.meta.url), "utf8");
  assert.match(sql, /unique \(source_system, source_record_id\)/i);
  assert.match(sql, /incoming_submission_immutable_guard/i);
  assert.match(sql, /INCOMING_SUBMISSION_IMMUTABLE_FIELDS/i);
  assert.match(sql, /activities_incoming_submission_uidx/i);
  assert.match(sql, /alter table public\.contacts alter column account_id drop not null/i);
  assert.match(sql, /product_code text not null/i);
  assert.match(sql, /'consentState'/i);
  assert.match(sql, /v_account_match_count/i);
  assert.match(sql, /incoming_leads_list_idx/i);
  assert.match(sql, /revoke all on function public\.ingest_incoming_submission/i);
  assert.match(sql, /active members read incoming submissions/i);
  assert.match(sql, /revoke all on table public\.incoming_submissions, public\.incoming_leads/i);
  assert.match(sql, /create or replace function public\.update_incoming_lead/i);
  assert.doesNotMatch(sql, /send|provider|outbox/i);
});

test("corrective migration enforces non-production fixture exclusion and anonymous RPC denial", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260828142146_incoming_leads_v1_corrections.sql", import.meta.url), "utf8");
  assert.match(sql, /incoming_submission_environment_guard/i);
  assert.match(sql, /new\.environment <> 'PRODUCTION'/i);
  assert.match(sql, /activities_incoming_lead_idx/i);
  assert.match(sql, /revoke execute on function public\.ingest_incoming_submission.*from anon/i);
  assert.match(sql, /revoke execute on function public\.update_incoming_lead.*from anon/i);
});

test("test-state corrective migration propagates ledger exclusion to the lead projection", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260828142220_incoming_leads_v1_test_projection.sql", import.meta.url), "utf8");
  assert.match(sql, /sync_incoming_lead_test_state/i);
  assert.match(sql, /new\.is_test/i);
  assert.match(sql, /incoming_submission_test_projection_trigger/i);
  assert.match(sql, /set is_test = true/i);
});

test("activity compatibility migration uses the live opportunity column", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260828142456_incoming_leads_v1_activity_compatibility.sql", import.meta.url), "utf8");
  assert.match(sql, /insert into public\.activities\([^)]*opportunity_id/i);
  assert.doesNotMatch(sql, /activities\([^)]*product_opportunity_id/i);
  assert.match(sql, /product_code/i);
});

test("activity idempotency migration provides a conflict constraint", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260828142543_incoming_leads_v1_activity_idempotency.sql", import.meta.url), "utf8");
  assert.match(sql, /activities_incoming_submission_unique/i);
  assert.match(sql, /add constraint .*unique \(incoming_submission_id\)/i);
  assert.match(sql, /drop index if exists public\.activities_incoming_submission_uidx/i);
});

test("duplicate replay resolves the existing projection from the immutable ledger", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260828142715_incoming_leads_v1_duplicate_projection.sql", import.meta.url), "utf8");
  assert.match(sql, /select incoming_lead_id into v_lead_id from public\.incoming_submissions/i);
});

test("incoming navigation and API stay separate from outbound prospecting", async () => {
  const shell = await readFile(new URL("../app/operator/operator-shell.tsx", import.meta.url), "utf8");
  const api = await readFile(new URL("../app/api/incoming-leads/route.ts", import.meta.url), "utf8");
  const fixtureApi = await readFile(new URL("../app/api/incoming-leads/fixtures/route.ts", import.meta.url), "utf8");
  assert.match(shell, /\/operator\/incoming-leads/);
  assert.match(api, /incoming_leads/);
  assert.doesNotMatch(api, /outreach|send/i);
  assert.match(fixtureApi, /NODE_ENV === "production"/);
});

test("Event Suite receiver is server-to-server only and preserves the immutable intake path", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260831180000_event_suite_incoming_leads_receiver_v1.sql", import.meta.url), "utf8");
  const receiver = await readFile(new URL("../app/api/integrations/event-suite/incoming-leads/route.ts", import.meta.url), "utf8");
  assert.match(migration, /auth\.role\(\).*service_role/i);
  assert.match(migration, /unique|on conflict \(source_system,source_record_id\)/i);
  assert.match(receiver, /timingSafeEqual/);
  assert.match(receiver, /x-event-suite-signature/);
  assert.match(receiver, /MAX_AGE_SECONDS/);
  assert.doesNotMatch(receiver, /NEXT_PUBLIC_.*WEBHOOK_SECRET/);
});
