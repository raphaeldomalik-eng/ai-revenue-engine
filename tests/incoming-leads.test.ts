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
  const sql = await readFile(new URL("../supabase/migrations/20260828000001_incoming_leads_v1.sql", import.meta.url), "utf8");
  assert.match(sql, /unique \(source_system, source_record_id\)/i);
  assert.match(sql, /incoming_submission_immutable_guard/i);
  assert.match(sql, /INCOMING_SUBMISSION_IMMUTABLE_FIELDS/i);
  assert.match(sql, /activities_incoming_submission_uidx/i);
  assert.match(sql, /alter table public\.contacts alter column account_id drop not null/i);
  assert.match(sql, /active members read incoming submissions/i);
  assert.match(sql, /revoke all on table public\.incoming_submissions, public\.incoming_leads/i);
  assert.match(sql, /create or replace function public\.update_incoming_lead/i);
  assert.doesNotMatch(sql, /send|provider|outbox/i);
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
