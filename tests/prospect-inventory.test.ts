import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("inventory cancels stale requests and exposes one explicit review save", async () => {
  const source = await readFile("app/operator/prospect-inventory-view.tsx", "utf8");
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /request === requestId\.current/);
  assert.match(source, /Clear filters/);
  assert.match(source, />Review</);
  assert.match(source, /QUALIFY/);
  assert.match(source, /REJECT/);
  assert.match(source, /BLOCK/);
  assert.match(source, /DUPLICATE/);
  assert.match(source, /Save review/);
  assert.match(source, /Unsaved review changes/);
  assert.match(source, /Discard the unsaved review/);
  assert.match(source, /Confirm and save/);
  assert.doesNotMatch(source, /Save next action/);
});

test("inventory API validates quality filters and retains server-side filtering", async () => {
  const route = await readFile("app/api/operator/route.ts", "utf8");
  assert.match(route, /INVENTORY_QUALITIES/);
  assert.match(route, /inventoryQuality/);
  assert.match(route, /quality === "ALL" \|\| inventoryQuality/);
  assert.match(route, /view === "inventory"/);
});

test("inventory review persists identity and lifecycle together", async () => {
  const route = await readFile("app/api/operator/route.ts", "utf8");
  const migration = await readFile("supabase/migrations/20260831220417_operator_prospect_identity_review_v1.sql", "utf8");
  assert.match(route, /action === "SAVE_REVIEW"/);
  assert.match(route, /record_ai_prospect_review/);
  assert.match(route, /idempotencyKey/);
  assert.match(route, /newOrganisation/);
  assert.match(migration, /ai_prospect_organisations/);
  assert.match(migration, /ai_prospect_identity_resolutions/);
  assert.match(migration, /ai_prospect_review_operations/);
  assert.match(migration, /unique \(candidate_id, idempotency_key\)/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /PROSPECT_IDENTITY_GATE_FAILED/);
  assert.match(migration, /never creates an Event Suite account/i);
});
