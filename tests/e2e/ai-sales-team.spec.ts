import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type Session } from "@supabase/supabase-js";

const storageKey = "sb-cdcfmnlmshnustrqficy-auth-token";
const cookieChunkSize = 3180;
function chunks(session: Session) {
  const encoded = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
  if (encodeURIComponent(encoded).length <= cookieChunkSize) return [{ name: storageKey, value: encoded }];
  const output: Array<{ name: string; value: string }> = [];
  let remaining = encoded;
  while (remaining) { let size = Math.min(cookieChunkSize, remaining.length); while (encodeURIComponent(remaining.slice(0, size)).length > cookieChunkSize) size -= 1; output.push({ name: `${storageKey}.${output.length}`, value: remaining.slice(0, size) }); remaining = remaining.slice(size); }
  return output;
}
async function signIn(context: BrowserContext) {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.auth.signInWithPassword({ email: process.env.E2E_TEST_EMAIL!, password: process.env.E2E_TEST_PASSWORD! });
  if (error || !data.session) throw new Error(`E2E sign-in failed: ${error?.message ?? "session missing"}`);
  const host = new URL(process.env.E2E_BASE_URL!).hostname;
  await context.addCookies(chunks(data.session).map((cookie) => ({ ...cookie, domain: host, path: "/", secure: true, httpOnly: false, sameSite: "Lax" as const })));
  return supabase;
}
async function ready(page: Page) {
  await expect(page.getByText("REVENUE COMMAND CENTRE · FOUNDATION")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("AI SALES TEAM · MVP V1")).toBeVisible();
}

test("real AI Sales Team research persists and survives state changes", async ({ page, context }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  const previewHost = new URL(process.env.E2E_BASE_URL!).hostname;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (new URL(request.url()).hostname === previewHost) return route.continue();
    if (request.resourceType() === "font") return route.abort();
    const headers = { ...request.headers() };
    delete headers["x-vercel-protection-bypass"];
    delete headers["x-vercel-set-bypass-cookie"];
    return route.continue({ headers });
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && message.text() !== "Failed to load resource: net::ERR_FAILED") errors.push(message.text()); });
  const supabase = await signIn(context);
  await page.goto("/");
  await ready(page);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const company = `Eventbrite E2E AI Sales ${timestamp}`;
  await page.getByLabel("Prospect or company name").fill(company);
  await page.getByLabel("Website or domain").fill("https://www.eventbrite.com");
  await page.getByRole("button", { name: "Research prospect" }).click();
  await expect(page.getByRole("status").filter({ hasText: "AI Sales Brief saved" })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText("AI SALES BRIEF", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("QUALIFICATION / ICP FIT", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("FACT EVIDENCE / SOURCES", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("ACCOUNT STRATEGY", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("NEXT BEST ACTION", { exact: true }).first()).toBeVisible();

  const account = await supabase.from("accounts").select("id").eq("name", company).maybeSingle();
  expect(account.error).toBeNull();
  expect(account.data).not.toBeNull();
  const [briefs, contacts, evidence, opportunities, activities] = await Promise.all([
    supabase.from("ai_sales_briefs").select("facts, inferences, qualification, territory, eventsuite_opportunity, account_strategy, next_best_action, unknowns").eq("account_id", account.data!.id),
    supabase.from("contacts").select("id").eq("account_id", account.data!.id),
    supabase.from("research_evidence").select("claim, evidence_kind, qualitative_confidence, source_url, source_title").eq("account_id", account.data!.id),
    supabase.from("product_opportunities").select("conversion_route, commercial_program_id").eq("account_id", account.data!.id),
    supabase.from("activities").select("activity_type, summary").eq("account_id", account.data!.id),
  ]);
  expect(briefs.error).toBeNull();
  expect(briefs.data?.length).toBeGreaterThan(0);
  expect(briefs.data?.[0].qualification).toBeTruthy();
  expect(briefs.data?.[0].account_strategy).toBeTruthy();
  expect(briefs.data?.[0].next_best_action).toBeTruthy();
  expect(briefs.data?.[0].eventsuite_opportunity.commercialProgramId).toBeNull();
  expect(evidence.error).toBeNull();
  expect(evidence.data?.some((row) => row.evidence_kind === "FACT")).toBe(true);
  expect(evidence.data?.every((row) => ["NONE", "LOW", "MEDIUM", "HIGH"].includes(row.qualitative_confidence))).toBe(true);
  expect(evidence.data?.some((row) => row.source_url || row.source_title)).toBe(true);
  expect(opportunities.error).toBeNull();
  expect((opportunities.data ?? []).length).toBeLessThanOrEqual(1);
  expect(activities.data?.some((row) => row.activity_type === "AI_RESEARCH_NEXT_ACTION")).toBe(true);

  await page.reload();
  await ready(page);
  await expect(page.getByText("AI SALES BRIEF", { exact: true }).first()).toBeVisible();
  await page.getByLabel("Prospect or company name").fill(company);
  await page.getByLabel("Website or domain").fill("https://www.eventbrite.com");
  await page.getByRole("button", { name: "Research prospect" }).click();
  await expect(page.getByRole("status").filter({ hasText: "AI Sales Brief saved" })).toBeVisible({ timeout: 180_000 });
  const duplicateCheck = await supabase.from("accounts").select("id").eq("name", company);
  expect(duplicateCheck.data).toHaveLength(1);
  const opportunityCheck = await supabase.from("product_opportunities").select("id").eq("account_id", account.data!.id);
  expect((opportunityCheck.data ?? []).length).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await signIn(context);
  await page.goto("/");
  await ready(page);
  await expect(page.getByText("AI SALES BRIEF", { exact: true }).first()).toBeVisible();
  expect(errors, errors.join("\n")).toEqual([]);
});
