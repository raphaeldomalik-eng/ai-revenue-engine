import { expect, test } from "@playwright/test";

const magicLink = process.env.E2E_MAGIC_LINK;

test.skip(!magicLink, "E2E_MAGIC_LINK is required for authenticated Incoming Leads acceptance.");

async function authenticateLocally(page: import("@playwright/test").Page) {
  await page.goto(magicLink!, { waitUntil: "networkidle" });
  const fragment = new URL(page.url()).hash.slice(1);
  const tokens = new URLSearchParams(fragment);
  const accessToken = tokens.get("access_token");
  const refreshToken = tokens.get("refresh_token");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!accessToken || !refreshToken || !supabaseUrl || !publishableKey) throw new Error("The authenticated magic-link session is incomplete.");
  const user = await page.evaluate(async ({ url, key, token }) => {
    const response = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error("The magic-link access token was not accepted by Supabase.");
    return response.json();
  }, { url: supabaseUrl, key: publishableKey, token: accessToken });
  const session = JSON.stringify({ access_token: accessToken, refresh_token: refreshToken, token_type: tokens.get("token_type") ?? "bearer", expires_in: Number(tokens.get("expires_in")), expires_at: Number(tokens.get("expires_at")), user });
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  await page.context().addCookies([{ name: `sb-${projectRef}-auth-token`, value: `base64-${Buffer.from(session).toString("base64url")}`, url: "http://localhost:3000", httpOnly: false, sameSite: "Lax", secure: false }]);
}

test("authenticated operator can classify a ticketing provider without sending or enriching", async ({ page }) => {
  await authenticateLocally(page);
  await page.goto("/operator/incoming-leads");
  await expect(page.getByRole("heading", { name: "What needs review?" })).toBeVisible();
  await expect(page.getByText("Ticketing Fixture")).toBeVisible();
  await page.screenshot({ path: "test-results/incoming-leads-needs-review.png", fullPage: true });

  await page.getByRole("link", { name: /Inspect/ }).click();
  await expect(page.getByRole("heading", { name: "Ticketing Fixture" })).toBeVisible();
  await page.getByLabel("Classification").selectOption("TICKETING_PROVIDER");
  await page.getByLabel(/Classification reason/).fill("Controlled acceptance: ticketing provider, not a revenue lead.");
  await page.screenshot({ path: "test-results/incoming-leads-classification.png", fullPage: true });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Save classification" }).click();
  await expect(page.getByRole("status")).toContainText("Incoming lead updated");
  await expect(page.getByText(/No send, schedule, provider or message action exists/)).toBeVisible();

  await page.getByRole("link", { name: "Back to Incoming Leads" }).click();
  await page.getByRole("button", { name: "Excluded" }).click();
  await expect(page.getByText("Ticketing Fixture")).toBeVisible();
  await expect(page.getByText("Ticketing provider")).toBeVisible();
  await page.screenshot({ path: "test-results/incoming-leads-excluded.png", fullPage: true });
});

test("authenticated operator sees a multi-interaction lead on desktop and mobile", async ({ page }) => {
  await authenticateLocally(page);
  await page.goto("/operator/incoming-leads");
  await page.getByRole("button", { name: "Active leads" }).click();
  await expect(page.getByText("Review Fixture")).toBeVisible();
  await page.getByRole("link", { name: /Inspect/ }).click();
  await expect(page.getByText("COMPLETE INTERACTION TIMELINE")).toBeVisible();
  await expect(page.getByText("2 interactions")).toBeVisible();
  await page.screenshot({ path: "test-results/incoming-lead-multiple-activities.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/incoming-lead-mobile-detail.png", fullPage: true });
});
