import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { composerVersionIsApproved, latestProspectApproval, prospectApprovalAllowsDrafting } from "../src/ai-sales-team/prospect-email-approval.ts";
import { PRODUCTION_ACTIVATION_FLAGS, outreachSendingProductionEnabled } from "../src/lib/server-production-activation.ts";

test("prospect approval is separate from individual email approval", () => {
  assert.equal(prospectApprovalAllowsDrafting(latestProspectApproval([{ decision: "APPROVED", created_at: "2026-08-22T10:00:00Z" }])), true);
  assert.equal(composerVersionIsApproved("email-1", [{ draft_version_id: "email-1", action: "APPROVE", created_at: "2026-08-22T10:00:00Z" }]), true);
  assert.equal(composerVersionIsApproved("email-2", [{ draft_version_id: "email-1", action: "APPROVE", created_at: "2026-08-22T10:00:00Z" }]), false);
  assert.equal(composerVersionIsApproved("email-1", [{ draft_version_id: "email-1", action: "APPROVE", created_at: "2026-08-22T10:00:00Z" }, { draft_version_id: "email-1", action: "EDIT", created_at: "2026-08-22T11:00:00Z" }]), false);
  assert.equal(composerVersionIsApproved("email-1", [{ draft_version_id: "email-1", action: "REJECT", created_at: "2026-08-22T12:00:00Z" }]), false);
});

test("approval migration is isolated, append-only and links every Composer draft to its prospect", async () => {
  const sql = await readFile("supabase/migrations/20260822000003_ai_prospect_email_approval_v1.sql", "utf8");
  assert.match(sql, /ai_prospect_approval_reviews/);
  assert.match(sql, /candidate_id uuid references public\.ai_prospect_candidates/);
  assert.match(sql, /APPROVED', 'REVOKED/);
  assert.match(sql, /action in \('APPROVE', 'REJECT', 'REQUEST_REVISION', 'EDIT'/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /security invoker/);
  assert.doesNotMatch(sql, /grant .*update|grant .*delete/i);
});

test("Composer and legacy sending remain default-disabled", async () => {
  assert.equal(outreachSendingProductionEnabled({}), false);
  assert.equal(outreachSendingProductionEnabled({ [PRODUCTION_ACTIVATION_FLAGS.outreachSending]: "true" }), true);
  const composerRoute = await readFile("app/api/ai-sales/outreach-composer/route.ts", "utf8");
  const legacyRoute = await readFile("app/api/ai-sales/outreach/route.ts", "utf8");
  const scheduler = await readFile("app/api/cron/outreach/route.ts", "utf8");
  assert.match(composerRoute, /PROSPECT_APPROVAL_REQUIRED|assertProspectApproved/);
  assert.match(legacyRoute, /outreachSendingProductionEnabled/);
  assert.match(scheduler, /outreachSendingProductionEnabled/);
  assert.doesNotMatch(composerRoute, /sendApprovedOutreachMessage|processDueOutreachMessages/);
});
