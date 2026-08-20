import { test, expect, type Page } from "@playwright/test";

const storageKey = "sb-cdcfmnlmshnustrqficy-auth-token";

async function signInInBrowser(page: Page) {
  await page.goto("/");
  const authenticated = await page.evaluate(async ({ url, key, email, password, cookieName }) => {
    const response = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    if (!response.ok) return false;
    const session = await response.json();
    const json = JSON.stringify(session);
    const value = `base64-${btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`;
    document.cookie = `${cookieName}=${value}; Path=/; Secure; SameSite=Lax`;
    return true;
  }, { url: process.env.NEXT_PUBLIC_SUPABASE_URL!, key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, email: process.env.E2E_TEST_EMAIL!, password: process.env.E2E_TEST_PASSWORD!, cookieName: storageKey });
  expect(authenticated).toBe(true);
  await page.reload();
  await expect(page.getByText("REVENUE COMMAND CENTRE · FOUNDATION")).toBeVisible({ timeout: 30_000 });
}

test("authenticated discovery preview exposes resolution and commercial handoff telemetry", async ({ page }) => {
  test.setTimeout(240_000);
  const contactRequests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/ai-sales/contact-research")) contactRequests.push(request.method()); });
  await signInInBrowser(page);
  await expect(page.getByText("AI SALES TEAM · AUTONOMOUS PROSPECT DISCOVERY V1")).toBeVisible();
  await expect(page.getByText("no autonomous outreach")).toBeVisible();

  const before = await page.evaluate(async () => (await fetch("/api/ai-sales/discovery")).json());
  await page.getByRole("button", { name: "Find prospects" }).click();
  await expect(page.getByText("Discovery completed. No outreach was approved or sent.")).toBeVisible({ timeout: 210_000 });
  const after = await page.evaluate(async () => (await fetch("/api/ai-sales/discovery")).json());
  const run = after.runs[0];
  expect(run.id).not.toBe(before.runs[0]?.id);
  expect(run.status).toBe("COMPLETED");
  expect(run.summary.enrichmentAttemptedCount).toBeLessThanOrEqual(4);
  expect(run.summary.enrichmentEligibleCount).toBeGreaterThanOrEqual(run.summary.enrichmentAttemptedCount);
  for (const candidate of run.ai_prospect_candidates ?? []) {
    const intelligence = candidate.prospect_intelligence ?? {};
    expect(intelligence.organisationResolution).toBeTruthy();
    expect(intelligence.commercialEvidence).toBeTruthy();
    expect(intelligence.enrichment?.resolutionOutcome).toBeTruthy();
    expect(intelligence.enrichment?.commercialOutcome).toBeTruthy();
    expect(typeof intelligence.enrichment?.commerciallyAdvanced).toBe("boolean");
  }
  expect(contactRequests).toEqual([]);
});
