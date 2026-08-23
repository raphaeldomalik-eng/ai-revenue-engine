import { test, expect } from "@playwright/test";

const candidate = (id: string, name: string, status = "REVIEW_REQUIRED") => ({
  id, discovery_run_id: "run-1", canonical_key: id, candidate_name: name, organiser_name: name, website: `https://${id}.example`, territory_code: "GB", origin: "EVENT_FIRST", status, relationship: "PROSPECT", account_id: "account-1", prospect_intelligence: { organisationResolution: { status: status === "QUALIFIED" ? "RESOLVED" : "UNRESOLVED" }, commercialPriority: "PHASE_ONE_PRIORITY", recommendedNextAction: status === "QUALIFIED" ? "Review people" : "Confirm organiser" }, contact_research: {}, contacts: [], account: { id: "account-1", name, website: `https://${id}.example` }, facts: [], unknowns: [], inferences: [], evidence: [], review_decisions: [], prospect_approval: status === "QUALIFIED" ? { decision: "APPROVED" } : null,
});

test("operator prospect performance stays scoped to list, drawer and email actions", async ({ page }) => {
  const requests: string[] = [];
  const detail = candidate("mash", "Mash Media Group", "QUALIFIED");
  const list = [candidate("dsac", "DSAC"), detail];
  await page.route("**/api/operator*", async (route) => {
    requests.push(route.request().url());
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ message: "ok" }) });
    if (url.searchParams.get("view") === "meta") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access: "OPERATOR" }) });
    if (url.searchParams.get("view") === "prospect-detail") { await new Promise((resolve) => setTimeout(resolve, 40)); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access: "OPERATOR", runs: [{ id: "run-1", territory_code: "GB", focus: "ALL", status: "COMPLETED", created_at: "2026-08-22T10:00:00Z" }], candidates: [detail], latestRunId: "run-1" }) }); }
    const pageNumber = Number(url.searchParams.get("page") ?? "1");
    const pageSize = Number(url.searchParams.get("pageSize") ?? "25");
    const search = String(url.searchParams.get("search") ?? "").toLowerCase();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access: "OPERATOR", runs: [{ id: "run-1", territory_code: "GB", focus: "ALL", status: "COMPLETED", created_at: "2026-08-22T10:00:00Z" }], candidates: list.filter((item) => !search || item.candidate_name.toLowerCase().includes(search)), latestRunId: "run-1", total: search ? 1 : 2, page: pageNumber, pageSize, pageCount: 1, queueCounts: { NEEDS_REVIEW: 1, READY_PEOPLE: 1, DRAFTS: 0, APPROVED: 0, DEFERRED: 0, ARCHIVE: 0, ALL: 2 } }) });
  });
  await page.route("**/api/ai-sales/outreach-composer*", (route) => { requests.push(route.request().url()); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ drafts: [], versions: [], reviews: [] }) }); });
  const start = Date.now();
  await page.goto("/operator/prospects");
  await expect(page.getByRole("heading", { name: "Prospects", exact: true })).toBeVisible();
  const initialLoadMs = Date.now() - start;
  const filterStart = Date.now();
  await page.getByPlaceholder("Search prospects").fill("Mash");
  await expect(page.getByText("Mash Media Group", { exact: true }).first()).toBeVisible();
  const filterMs = Date.now() - filterStart;
  const drawerStart = Date.now();
  await page.getByText("Mash Media Group", { exact: true }).first().click();
  await expect(page.getByRole("dialog", { name: /Mash Media/ })).toBeVisible();
  await expect(page.getByText("Loading evidence and review history…", { exact: true })).toHaveCount(0);
  const drawerMs = Date.now() - drawerStart;
  await page.getByRole("tab", { name: "Email", exact: true }).click();
  await expect(page.getByText("Email 1 — Introduction", { exact: true })).toBeVisible();
  const actionStart = Date.now();
  await page.getByRole("button", { name: "Prepare email draft", exact: true }).click();
  const emailActionMs = Date.now() - actionStart;
  expect(requests.filter((url) => url.includes("view=prospect-detail")).length).toBe(1);
  expect(requests.some((url) => url.includes("/api/ai-sales/"))).toBe(true);
  expect(initialLoadMs).toBeLessThan(5000); expect(filterMs).toBeLessThan(5000); expect(drawerMs).toBeLessThan(5000); expect(emailActionMs).toBeLessThan(5000);
  console.log(JSON.stringify({ performanceMs: { initialQueueLoad: initialLoadMs, filterChange: filterMs, drawerOpen: drawerMs, emailReviewAction: emailActionMs }, providerRequests: 0, mockedComposerRequests: requests.filter((url) => url.includes("/api/ai-sales/")).length }));
});
