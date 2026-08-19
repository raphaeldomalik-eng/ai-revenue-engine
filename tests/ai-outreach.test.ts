import assert from "node:assert/strict";
import test from "node:test";
import { boundedFollowUps, canSendMessage, classifyAccountRelationship, knownRecipient, sanitizeOutboundContent } from "../src/ai-sales-team/outreach-model.ts";
import { assertCommercialActionContract } from "../src/ai-sales-team/outreach.ts";
import { evaluateProspectIntelligence } from "../src/ai-sales-team/prospect-intelligence.ts";
import type { AiSalesEvidence } from "../src/ai-sales-team/model.ts";

const prospectFact = (claim: string): AiSalesEvidence => ({ claim, sourceUrl: "https://example.org", sourceTitle: "Example", kind: "FACT", confidence: "HIGH" });

test("competitors are blocked while prospects remain eligible", () => {
  assert.equal(classifyAccountRelationship({ name: "Quicket", website: "https://www.quicket.co.za", qualificationFit: "HIGH" }).relationship, "COMPETITOR");
  assert.equal(classifyAccountRelationship({ name: "Quicket", website: "https://www.quicket.co.za", qualificationFit: "HIGH" }).eligibility, "BLOCKED");
  assert.equal(classifyAccountRelationship({ name: "Regional Festival", summary: "The organiser uses Quicket for ticket sales.", qualificationFit: "HIGH" }).eligibility, "ELIGIBLE");
  assert.equal(classifyAccountRelationship({ name: "Ticketing Platform Ltd", summary: "We provide event ticketing software and services.", qualificationFit: "HIGH" }).eligibility, "BLOCKED");
  assert.equal(classifyAccountRelationship({ name: "Example Prospect", website: "https://example.org", qualificationFit: "HIGH" }).eligibility, "ELIGIBLE");
  assert.equal(classifyAccountRelationship({ name: "Unclear Organisation", qualificationFit: "UNKNOWN" }).eligibility, "REVIEW_REQUIRED");
  assert.equal(classifyAccountRelationship({ name: "Missing Relationship Evidence" }).eligibility, "REVIEW_REQUIRED");
  assert.equal(classifyAccountRelationship({ name: "Existing Customer", summary: "Existing customer of EventSuite", qualificationFit: "HIGH" }).relationship, "CUSTOMER");
  assert.equal(classifyAccountRelationship({ name: "Strategic Partner", summary: "Strategic partner organisation", qualificationFit: "HIGH" }).relationship, "PARTNER");
});

test("outbound content removes research URLs and resolves the sender signature", () => {
  const clean = sanitizeOutboundContent("A useful conversation", "Direct opening.\n\nSee https://example.org/source for context.");
  assert.equal(clean.body.includes("https://"), false);
  assert.match(clean.body, /Best regards,\nEventSuite Partnerships$/);
  assert.throws(() => sanitizeOutboundContent("Hello [Your Name]", "Body"), /placeholder/);
  assert.throws(() => sanitizeOutboundContent("A useful conversation", "FACT: [evidence-123] See source-id:abc"), /internal evidence/);
  assert.throws(() => sanitizeOutboundContent("A useful conversation", "TODO — add the account name"), /placeholder/);
  assert.throws(() => sanitizeOutboundContent("Industry-leading option", "Body"), /comparative/);
});

test("outreach never turns an unknown contact into a sendable recipient", () => {
  assert.equal(knownRecipient(null), null);
  assert.equal(knownRecipient("not-an-email"), null);
  assert.equal(knownRecipient("owner@example.com"), "owner@example.com");
  assert.equal(canSendMessage({ status: "APPROVED", recipient_email: null }, "ACTIVE", false, false), false);
  assert.equal(canSendMessage({ status: "NEEDS_APPROVAL", recipient_email: "owner@example.com" }, "ACTIVE", false, false), false);
  assert.equal(canSendMessage({ status: "APPROVED", recipient_email: "owner@example.com" }, "ACTIVE", false, false, "REVIEW_REQUIRED"), false);
});

test("outreach send decision requires approval, active sequence, and no stop state", () => {
  const message = { status: "APPROVED" as const, recipient_email: "owner@example.com" };
  assert.equal(canSendMessage(message, "ACTIVE", false, false, "ELIGIBLE"), true);
  assert.equal(canSendMessage(message, "CANCELLED", false, false), false);
  assert.equal(canSendMessage(message, "ACTIVE", true, false), false);
  assert.equal(canSendMessage(message, "ACTIVE", false, true), false);
  assert.equal(canSendMessage(message, "ACTIVE", false, false, "BLOCKED"), false);
});

test("outreach sequence is bounded to two follow-ups", () => {
  const messages = [0, 1, 2, 3].map((sequenceNumber) => ({ sequenceNumber: sequenceNumber as 0 | 1 | 2, delayHours: 24, subject: "", body: "", rationale: "", evidenceReferences: [], cta: "", stopConditions: [] }));
  assert.deepEqual(boundedFollowUps(messages).map((item) => item.sequenceNumber), [1, 2]);
});

test("outreach CTA contract follows low-friction actions and allows justified walkthroughs", () => {
  const ticketing = evaluateProspectIntelligence({ relationship: "PROSPECT", territory: "ZA", facts: [prospectFact("The organiser runs an annual paid festival with ticket tiers and admission scanning.")], inferences: [] }).nextBestCommercialAction;
  const selfServiceDraft = { outreachGoal: "", recipientRationale: "", overallStrategy: "", unknowns: [], warnings: [], initialMessage: { sequenceNumber: 0 as const, delayHours: 0, subject: "Launch ticketing", body: "You can start at your own pace.", rationale: "", evidenceReferences: [], cta: ticketing.ctaLabel, stopConditions: [] }, followUps: [] };
  assert.doesNotThrow(() => assertCommercialActionContract(selfServiceDraft, ticketing));
  assert.throws(() => assertCommercialActionContract({ ...selfServiceDraft, initialMessage: { ...selfServiceDraft.initialMessage, body: "Would you like to book a call?" } }, ticketing), /OUTREACH_CTA_MISMATCH/);

  const ecc = evaluateProspectIntelligence({ relationship: "PROSPECT", territory: "ZA", facts: [prospectFact("The university runs an annual conference programme across multiple events, departments, suppliers and workforce teams.")], inferences: [] }).nextBestCommercialAction;
  const guidedDraft = { ...selfServiceDraft, initialMessage: { ...selfServiceDraft.initialMessage, subject: "Guided walkthrough", body: "Book a guided walkthrough to discuss the event operation.", cta: ecc.ctaLabel } };
  assert.doesNotThrow(() => assertCommercialActionContract(guidedDraft, ecc));
});

test("outreach migration keeps message identity and approval states durable", async () => {
  const fs = await import("node:fs/promises");
  const sql = await fs.readFile("supabase/migrations/20260819000003_ai_outreach_follow_up.sql", "utf8");
  assert.match(sql, /unique \(sequence_id, sequence_number\)/);
  assert.match(sql, /NEEDS_APPROVAL/);
  assert.match(sql, /SENDING/);
  assert.match(sql, /SUPPRESSIONS|outreach_suppressions/i);
  assert.match(sql, /enable row level security/);
});
