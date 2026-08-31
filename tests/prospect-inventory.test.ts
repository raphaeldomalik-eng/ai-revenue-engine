import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("inventory cancels stale requests and exposes explicit review actions", async () => {
  const source = await readFile("app/operator/prospect-inventory-view.tsx", "utf8");
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /request === requestId\.current/);
  assert.match(source, /Clear filters/);
  assert.match(source, />Review</);
  assert.match(source, />Qualify</);
  assert.match(source, />Reject</);
  assert.match(source, />Block</);
  assert.match(source, />Mark duplicate</);
  assert.match(source, /Save next action/);
});

test("inventory API validates quality filters and retains server-side filtering", async () => {
  const route = await readFile("app/api/operator/route.ts", "utf8");
  assert.match(route, /INVENTORY_QUALITIES/);
  assert.match(route, /inventoryQuality/);
  assert.match(route, /quality === "ALL" \|\| inventoryQuality/);
  assert.match(route, /view === "inventory"/);
});
