import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { blockReasonLabel, isBlockedProspect, PROSPECT_BLOCK_REASON_OPTIONS, validateBlockDecision } from "../src/operator-ui/prospect-review.ts";

test("all supervised block reasons have deterministic labels and validation", () => {
  assert.equal(PROSPECT_BLOCK_REASON_OPTIONS.length, 8);
  for (const reason of PROSPECT_BLOCK_REASON_OPTIONS) {
    const value = validateBlockDecision({ reasonCode: reason.code, otherExplanation: reason.code === "OTHER" ? "No credible fit" : "", note: "Reviewed by operator" });
    assert.equal(value.reasonCode, reason.code);
    assert.equal(blockReasonLabel(reason.code), reason.label);
  }
});

test("a block decision requires a reason and Other requires an explanation", () => {
  assert.throws(() => validateBlockDecision({}), /PROSPECT_BLOCK_REASON_REQUIRED/);
  assert.throws(() => validateBlockDecision({ reasonCode: "UNKNOWN" }), /PROSPECT_BLOCK_REASON_INVALID/);
  assert.throws(() => validateBlockDecision({ reasonCode: "OTHER" }), /PROSPECT_BLOCK_OTHER_EXPLANATION_REQUIRED/);
  assert.deepEqual(validateBlockDecision({ reasonCode: "OTHER", otherExplanation: "Not a credible prospect", note: "Keep for evaluation" }), { reasonCode: "OTHER", otherExplanation: "Not a credible prospect", note: "Keep for evaluation" });
});

test("blocked status is a hard downstream exclusion", () => {
  assert.equal(isBlockedProspect("BLOCKED"), true);
  assert.equal(isBlockedProspect("REVIEW_REQUIRED"), false);
});

test("operator review API and migration are append-only and operator-scoped", async () => {
  const route = await readFile("app/api/operator/route.ts", "utf8");
  const sql = await readFile("supabase/migrations/20260822000002_ai_prospect_review_decisions_v1.sql", "utf8");
  assert.match(route, /record_ai_prospect_review_decision/);
  assert.match(route, /validateBlockDecision/);
  assert.match(route, /PROSPECT_REOPEN_ARCHIVE_ONLY/);
  assert.match(sql, /decision text not null check \(decision in \('BLOCKED', 'REOPENED'\)\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /operators create prospect review decisions/);
  assert.match(sql, /security invoker/);
  assert.doesNotMatch(sql, /grant .*update|grant .*delete/i);
});

test("blocked prospects are excluded before contact research and Composer drafting", async () => {
  const contactRoute = await readFile("app/api/ai-sales/contact-research/route.ts", "utf8");
  const composerRoute = await readFile("app/api/ai-sales/outreach-composer/route.ts", "utf8");
  const outreachService = await readFile("src/outreach/service.ts", "utf8");
  const contactPost = contactRoute.slice(contactRoute.indexOf("export async function POST"));
  assert.ok(contactPost.indexOf('candidate.status === "BLOCKED"') < contactPost.indexOf("researchEligibleProspectContact"));
  assert.ok(composerRoute.indexOf("assertNoBlockedProspect") < composerRoute.indexOf("createComposerSequence"));
  assert.match(outreachService, /assertNoBlockedProspect/);
  assert.ok(outreachService.indexOf("assertNoBlockedProspect(client, message.account_id)") < outreachService.lastIndexOf("sendEmail("));
});

test("prospects UI provides reason-gated block, archive reopen and plain-language feedback", async () => {
  const source = await readFile("app/operator/operator-views.tsx", "utf8");
  assert.match(source, /Block prospect/);
  assert.match(source, /Choose a reason/);
  assert.match(source, /Other/);
  assert.match(source, /Save block decision/);
  assert.match(source, /Reopen for review/);
  assert.match(source, /History \/ archive/);
  assert.match(source, /Prospect blocked and moved to History \/ archive/);
  assert.match(source, /onReviewSaved={refresh}/);
});
