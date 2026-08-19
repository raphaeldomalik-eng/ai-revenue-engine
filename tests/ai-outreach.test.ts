import assert from "node:assert/strict";
import test from "node:test";
import { boundedFollowUps, canSendMessage, knownRecipient } from "../src/ai-sales-team/outreach-model.ts";

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
