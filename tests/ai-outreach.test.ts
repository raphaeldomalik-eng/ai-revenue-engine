import assert from "node:assert/strict";
import test from "node:test";
import { boundedFollowUps, canSendMessage, classifyAccountRelationship, knownRecipient, sanitizeOutboundContent } from "../src/ai-sales-team/outreach-model.ts";

test("competitors are blocked while prospects remain eligible", () => {
  assert.equal(classifyAccountRelationship({ name: "Quicket", website: "https://www.quicket.co.za", qualificationFit: "HIGH" }).relationship, "COMPETITOR");
  assert.equal(classifyAccountRelationship({ name: "Quicket", website: "https://www.quicket.co.za", qualificationFit: "HIGH" }).eligibility, "BLOCKED");
  assert.equal(classifyAccountRelationship({ name: "Example Prospect", website: "https://example.org", qualificationFit: "HIGH" }).eligibility, "ELIGIBLE");
  assert.equal(classifyAccountRelationship({ name: "Unclear Organisation", qualificationFit: "UNKNOWN" }).eligibility, "REVIEW_REQUIRED");
  assert.equal(classifyAccountRelationship({ name: "Existing Customer", summary: "Existing customer of EventSuite", qualificationFit: "HIGH" }).relationship, "CUSTOMER");
  assert.equal(classifyAccountRelationship({ name: "Strategic Partner", summary: "Strategic partner organisation", qualificationFit: "HIGH" }).relationship, "PARTNER");
});

test("outbound content removes research URLs and resolves the sender signature", () => {
  const clean = sanitizeOutboundContent("A useful conversation", "Direct opening.\n\nSee https://example.org/source for context.");
  assert.equal(clean.body.includes("https://"), false);
  assert.match(clean.body, /Best regards,\nEventSuite Partnerships$/);
  assert.throws(() => sanitizeOutboundContent("Hello [Your Name]", "Body"), /placeholder/);
  assert.throws(() => sanitizeOutboundContent("Industry-leading option", "Body"), /comparative/);
});

test("outreach never turns an unknown contact into a sendable recipient", () => {
  assert.equal(knownRecipient(null), null);
  assert.equal(knownRecipient("not-an-email"), null);
  assert.equal(knownRecipient("owner@example.com"), "owner@example.com");
  assert.equal(canSendMessage({ status: "APPROVED", recipient_email: null }, "ACTIVE", false, false), false);
  assert.equal(canSendMessage({ status: "NEEDS_APPROVAL", recipient_email: "owner@example.com" }, "ACTIVE", false, false), false);
});

test("outreach send decision requires approval, active sequence, and no stop state", () => {
  const message = { status: "APPROVED" as const, recipient_email: "owner@example.com" };
  assert.equal(canSendMessage(message, "ACTIVE", false, false), true);
  assert.equal(canSendMessage(message, "CANCELLED", false, false), false);
  assert.equal(canSendMessage(message, "ACTIVE", true, false), false);
  assert.equal(canSendMessage(message, "ACTIVE", false, true), false);
  assert.equal(canSendMessage(message, "ACTIVE", false, false, "BLOCKED"), false);
});

test("outreach sequence is bounded to two follow-ups", () => {
  const messages = [0, 1, 2, 3].map((sequenceNumber) => ({ sequenceNumber: sequenceNumber as 0 | 1 | 2, delayHours: 24, subject: "", body: "", rationale: "", evidenceReferences: [], cta: "", stopConditions: [] }));
  assert.deepEqual(boundedFollowUps(messages).map((item) => item.sequenceNumber), [1, 2]);
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
