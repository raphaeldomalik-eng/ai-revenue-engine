import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type Session } from "@supabase/supabase-js";

const storageKey = "sb-cdcfmnlmshnustrqficy-auth-token";
const cookieChunkSize = 3180;

function sessionCookieChunks(session: Session) {
  const encoded = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
  if (encodeURIComponent(encoded).length <= cookieChunkSize) return [{ name: storageKey, value: encoded }];
  const chunks: Array<{ name: string; value: string }> = [];
  let remaining = encoded;
  while (remaining) {
    let size = Math.min(cookieChunkSize, remaining.length);
    while (encodeURIComponent(remaining.slice(0, size)).length > cookieChunkSize) size -= 1;
    chunks.push({ name: `${storageKey}.${chunks.length}`, value: remaining.slice(0, size) });
    remaining = remaining.slice(size);
  }
  return chunks;
}

async function signInInMemory(context: BrowserContext) {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.auth.signInWithPassword({ email: process.env.E2E_TEST_EMAIL!, password: process.env.E2E_TEST_PASSWORD! });
  if (error || !data.session) throw new Error(`E2E password sign-in failed: ${error?.message ?? "session missing"}`);
  const host = new URL(process.env.E2E_BASE_URL ?? "https://ai-revenue-engine-git-feature-lead-inte-000dc1-event-suite-team.vercel.app").hostname;
  await context.addCookies(sessionCookieChunks(data.session).map((cookie) => ({ ...cookie, domain: host, path: "/", secure: true, httpOnly: false, sameSite: "Lax" as const })));
  return supabase;
}

async function expectAppReady(page: Page) {
  await expect(page.getByText("REVENUE COMMAND CENTRE · FOUNDATION")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("LEAD INTELLIGENCE", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Organisation name")).toBeVisible();
}

test("operator can persist and re-open Lead Intelligence workflow", async ({ page, context }) => {
  const browserErrors: string[] = [];
  const previewHost = new URL(process.env.E2E_BASE_URL ?? "https://ai-revenue-engine-git-feature-lead-inte-000dc1-event-suite-team.vercel.app").hostname;
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.hostname === previewHost) return route.continue();
    const headers = { ...route.request().headers() };
    delete headers["x-vercel-protection-bypass"];
    delete headers["x-vercel-set-bypass-cookie"];
    return route.continue({ headers });
  });
  page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(`console: ${message.text()}`); });

  const supabase = await signInInMemory(context);
  await page.goto("/");
  await expectAppReady(page);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const organisation = `E2E Lead Persistence ${timestamp}`;
  const contact = `E2E Operator ${timestamp}`;
  const observation = "Owner-confirmed South African school runs recurring events.";
  const nextAction = "Confirm the operational owner and annual event volume.";

  await page.getByRole("button", { name: "+ New prospect" }).click();
  await page.getByLabel("Organisation name").fill(organisation);
  await page.getByLabel("Country").selectOption({ label: "South Africa" });
  await page.getByLabel("Organisation type").selectOption("SCHOOL");
  await page.getByLabel("Event activity").selectOption("RUNS_EVENTS");
  await page.getByLabel("Contact name").fill(contact);
  await page.getByLabel("Contact email").fill(`e2e-${Date.now()}@eventsuite.pro`);
  await page.getByLabel("Research observation").fill(observation);
  await page.getByLabel("Evidence kind").selectOption("FACT");
  await page.getByLabel("Confidence").selectOption("HIGH");
  await page.getByLabel("Next action").fill(nextAction);
  await page.getByRole("button", { name: "Save prospect" }).click();

  await expect(page.getByRole("status")).toContainText("Saved.", { timeout: 30_000 });
  await expect(page.getByText("DIRECT · UNDETERMINED", { exact: true })).toBeVisible();
  await expect(page.getByText("FACT · HIGH", { exact: true })).toBeVisible();
  const { data: account, error: accountError } = await supabase.from("accounts").select("id").eq("name", organisation).maybeSingle();
  expect(accountError).toBeNull();
  expect(account).not.toBeNull();
  const [contacts, evidence, opportunities, activities] = await Promise.all([
    supabase.from("contacts").select("id").eq("account_id", account!.id),
    supabase.from("research_evidence").select("evidence_kind, qualitative_confidence").eq("account_id", account!.id),
    supabase.from("product_opportunities").select("conversion_route, commercial_program_id").eq("account_id", account!.id),
    supabase.from("activities").select("summary").eq("account_id", account!.id),
  ]);
  expect(contacts.error).toBeNull();
  expect(contacts.data).toHaveLength(1);
  expect(evidence.data?.[0]).toMatchObject({ evidence_kind: "FACT", qualitative_confidence: "HIGH" });
  expect(opportunities.data?.[0]).toMatchObject({ conversion_route: "UNDETERMINED", commercial_program_id: null });
  expect(activities.data?.[0]?.summary).toBe(nextAction);
  await page.screenshot({ path: "test-results/lead-intelligence-saved.png", fullPage: true });

  await page.reload();
  await expectAppReady(page);
  await expect(page.getByLabel("Organisation name")).toHaveValue(organisation);
  await expect(page.getByLabel("Contact name")).toHaveValue(contact);
  await expect(page.getByLabel("Research observation")).toHaveValue(observation);
  await expect(page.getByLabel("Next action")).toHaveValue(nextAction);
  await expect(page.getByRole("status")).toContainText("Saved");

  await page.getByLabel("Research observation").fill(`${observation} Updated once.`);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Saved.", { timeout: 30_000 });
  await expect(page.getByRole("button", { name: organisation, exact: true })).toHaveCount(1);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({ timeout: 15_000 });
  await signInInMemory(context);
  await page.goto("/");
  await expectAppReady(page);
  await expect(page.getByLabel("Organisation name")).toHaveValue(organisation);
  await expect(page.getByLabel("Research observation")).toHaveValue(`${observation} Updated once.`);
  await expect(page.getByRole("button", { name: organisation, exact: true })).toHaveCount(1);
  await page.screenshot({ path: "test-results/lead-intelligence-relogin.png", fullPage: true });

  expect(browserErrors, browserErrors.join("\n")).toEqual([]);
});
