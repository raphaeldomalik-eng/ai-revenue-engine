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

test("public contact research uses the authenticated preview path without outreach", async ({ page }) => {
  test.setTimeout(240_000);
  await signInInBrowser(page);
  const discovery = await page.evaluate(async () => (await fetch("/api/ai-sales/discovery")).json());
  const candidates = discovery.runs.flatMap((run: { ai_prospect_candidates?: any[] }) => run.ai_prospect_candidates ?? []);
  const prospects = candidates.filter((candidate: any) => ["QUALIFIED", "REVIEW_REQUIRED"].includes(candidate.status) && candidate.relationship === "PROSPECT" && candidate.account_id && ["CONFIRMED", "STRONG"].includes(candidate.prospect_intelligence?.eventConnection?.state)).slice(0, 3);
  expect(prospects.length).toBeGreaterThan(0);
  const results = [] as string[];
  for (const prospect of prospects) {
    const result = await page.evaluate(async (candidateId) => {
      const response = await fetch("/api/ai-sales/contact-research", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ candidateId }) });
      const body = await response.json();
      return { status: response.status, result: body.contactResearch?.status ?? null, message: body.message ?? null };
    }, prospect.id);
    expect(result.status, result.message ?? "contact research request failed").toBe(200);
    expect(["CONTACT_FOUND", "CONTACT_ROUTE_FOUND", "CONTACT_RESEARCH_REQUIRED"]).toContain(result.result);
    results.push(result.result);
  }
  expect(results.length).toBe(prospects.length);

  const repeat = await page.evaluate(async (candidateId) => {
    const response = await fetch("/api/ai-sales/contact-research", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ candidateId }) });
    return response.status;
  }, prospects[0].id);
  expect(repeat).toBe(200);
  await page.reload();
  await expect(page.getByText(/CONTACT RESEARCH · (CONTACT_FOUND|CONTACT_ROUTE_FOUND|CONTACT_RESEARCH_REQUIRED)/).first()).toBeVisible();
  await expect(page.getByText(/no sequence is created or sent automatically/).first()).toBeVisible();
});
