import assert from "node:assert/strict";
import test from "node:test";
import { contactPersistenceTargets, isContactResearchEligible, normaliseContactResearch } from "../src/ai-sales-team/contact-research.ts";
import { readFileSync } from "node:fs";

const sourceUrl = "https://festival.example/contact";
const base = () => ({ likelyBuyerRole: "Festival Director", buyerRoleRationale: "A festival director normally owns the event programme.", namedContact: null, organisationRoute: null, facts: [], unknowns: [] });

test("publicly evidenced named contact and direct email are retained", () => {
  const result = normaliseContactResearch({ ...base(), namedContact: { fullName: "Alex Example", roleTitle: "Festival Director", email: "alex@festival.example", phone: null, linkedinUrl: null, sourceUrl, sourceTitle: "Official team", evidence: "Alex Example is Festival Director. Contact Alex Example at alex@festival.example.", confidence: "HIGH" } });
  assert.equal(result.status, "CONTACT_FOUND");
  assert.equal(result.namedContact?.email, "alex@festival.example");
});

test("published organisation email is a route when no named person is evidenced", () => {
  const result = normaliseContactResearch({ ...base(), organisationRoute: { email: "events@festival.example", phone: null, contactUrl: sourceUrl, sourceUrl, sourceTitle: "Official contact", evidence: "For event enquiries contact events@festival.example.", confidence: "HIGH" } });
  assert.equal(result.status, "CONTACT_ROUTE_FOUND");
  assert.equal(result.organisationRoute?.email, "events@festival.example");
  assert.equal(result.namedContact, null);
});

test("buyer role can remain an inference while no contact is found", () => {
  const result = normaliseContactResearch(base());
  assert.equal(result.status, "CONTACT_RESEARCH_REQUIRED");
  assert.equal(result.likelyBuyerRole, "Festival Director");
  assert.equal(result.namedContact, null);
});

test("guessed emails and unsupported names are discarded", () => {
  const result = normaliseContactResearch({ ...base(), namedContact: { fullName: "Alex Example", roleTitle: "Festival Director", email: "alex.example@festival.example", phone: null, linkedinUrl: null, sourceUrl, sourceTitle: "Official contact", evidence: "The Festival Director role is responsible for the programme.", confidence: "LOW" } });
  assert.equal(result.status, "CONTACT_RESEARCH_REQUIRED");
  assert.equal(result.namedContact, null);
});

test("a named person can be retained while an unquoted email pattern is rejected", () => {
  const result = normaliseContactResearch({ ...base(), namedContact: { fullName: "Alex Example", roleTitle: "Festival Director", email: "alex.example@festival.example", phone: null, linkedinUrl: null, sourceUrl, sourceTitle: "Official team", evidence: "Alex Example is Festival Director.", confidence: "HIGH" } });
  assert.equal(result.status, "CONTACT_FOUND");
  assert.equal(result.namedContact?.fullName, "Alex Example");
  assert.equal(result.namedContact?.email, null);
});

test("only credible prospect candidates may run contact research", () => {
  const allowed = { status: "REVIEW_REQUIRED", relationship: "PROSPECT", account_id: "account-id", prospect_intelligence: { eventConnection: { state: "CONFIRMED" } } };
  assert.equal(isContactResearchEligible(allowed), true);
  assert.equal(isContactResearchEligible({ ...allowed, status: "REJECTED" }), false);
  assert.equal(isContactResearchEligible({ ...allowed, relationship: "COMPETITOR" }), false);
  assert.equal(isContactResearchEligible({ ...allowed, prospect_intelligence: { eventConnection: { state: "WEAK" } } }), false);
});

test("a matching public email is persisted only once when the named person and route agree", () => {
  const result = normaliseContactResearch({ ...base(), namedContact: { fullName: "Alex Example", roleTitle: "Festival Director", email: "alex@festival.example", phone: null, linkedinUrl: null, sourceUrl, sourceTitle: "Official team", evidence: "Alex Example is Festival Director. Contact Alex Example at alex@festival.example.", confidence: "HIGH" }, organisationRoute: { email: "alex@festival.example", phone: null, contactUrl: sourceUrl, sourceUrl, sourceTitle: "Official contact", evidence: "Contact Alex Example at alex@festival.example.", confidence: "HIGH" } });
  const targets = contactPersistenceTargets(result);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].kind, "NAMED");
});

test("contact research migration extends only discovery-candidate memory", () => {
  const sql = readFileSync("supabase/migrations/20260819235859_prospect_contact_discovery_verification_v1.sql", "utf8");
  assert.match(sql, /alter table public\.ai_prospect_candidates/);
  assert.match(sql, /contact_research jsonb/);
  assert.doesNotMatch(sql, /create table|create policy|alter table public\.contacts/i);
});
