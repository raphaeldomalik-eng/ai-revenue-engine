import type { RenderAdapter } from "../source-discovery/render.ts";

/**
 * Local Playwright adapter for the existing guarded renderer.
 * It loads one URL, does not click or type, and discards the browser afterwards.
 */
export function playwrightRenderAdapter(): RenderAdapter {
  return {
    name: "playwright-local",
    async render({ url, timeoutMs, userAgent, allowRequest }) {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({ headless: true });
      try {
        const context = await browser.newContext({ userAgent });
        const page = await context.newPage();
        await page.route("**/*", async (route) => {
          const request = route.request();
          const allowed = await allowRequest(request.url(), request.resourceType());
          if (allowed) await route.continue();
          else await route.abort();
        });
        await page.goto(url, { timeout: timeoutMs, waitUntil: "domcontentloaded" });
        const html = await page.content();
        return { finalUrl: page.url(), html };
      } finally {
        await browser.close();
      }
    },
  };
}
