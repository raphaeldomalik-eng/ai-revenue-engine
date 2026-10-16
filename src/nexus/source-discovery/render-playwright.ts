import { chromium, type Browser } from "@playwright/test";
import type { RenderAdapter } from "./render.ts";

let sharedBrowser: Browser | null = null;

async function launchSystemBrowser(): Promise<Browser> {
  if (sharedBrowser && sharedBrowser.isConnected()) {
    return sharedBrowser;
  }
  // Prioritize system chrome, then msedge, then default bundled chromium
  try {
    sharedBrowser = await chromium.launch({ headless: true, channel: "chrome" });
    return sharedBrowser;
  } catch {
    try {
      sharedBrowser = await chromium.launch({ headless: true, channel: "msedge" });
      return sharedBrowser;
    } catch {
      sharedBrowser = await chromium.launch({ headless: true });
      return sharedBrowser;
    }
  }
}

export async function closeSharedBrowser(): Promise<void> {
  if (sharedBrowser) {
    try {
      await sharedBrowser.close();
    } catch {}
    sharedBrowser = null;
  }
}

export function createPlaywrightRenderAdapter(options?: {
  browser?: Browser;
}): RenderAdapter {
  return {
    name: "playwright-system-chromium",
    async render(args) {
      const browser = options?.browser ?? (await launchSystemBrowser());
      const context = await browser.newContext({
        userAgent: args.userAgent,
        bypassCSP: false,
        javaScriptEnabled: true,
      });

      const page = await context.newPage();
      try {
        await page.route("**/*", async (route) => {
          const req = route.request();
          const targetUrl = req.url();
          const resourceType = req.resourceType();
          try {
            const allowed = await args.allowRequest(targetUrl, resourceType);
            if (allowed) {
              await route.continue();
            } else {
              await route.abort();
            }
          } catch {
            await route.abort();
          }
        });

        await page.goto(args.url, {
          timeout: args.timeoutMs,
          waitUntil: "domcontentloaded",
        });

        // Bounded settle period for hydration/rendering
        await page.waitForTimeout(500);

        const html = await page.content();
        const finalUrl = page.url();
        return { finalUrl, html };
      } finally {
        await page.close().catch(() => {});
        await context.close().catch(() => {});
      }
    },
  };
}
