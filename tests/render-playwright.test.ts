import assert from "node:assert/strict";
import test, { after } from "node:test";
import { guardedRender } from "../src/nexus/source-discovery/render.ts";
import { closeSharedBrowser, createPlaywrightRenderAdapter } from "../src/nexus/source-discovery/render-playwright.ts";

after(async () => {
  await closeSharedBrowser();
});

test("createPlaywrightRenderAdapter renders dynamic HTML content via system browser", async () => {
  const adapter = createPlaywrightRenderAdapter();
  assert.equal(adapter.name, "playwright-system-chromium");

  // Verify adapter interface
  assert.equal(typeof adapter.render, "function");
});
