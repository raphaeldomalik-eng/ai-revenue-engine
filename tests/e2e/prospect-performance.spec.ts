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

test("operator keyset navigation handles next, previous, filter reset, sort reset and drawer deep links", async ({ page }) => {
  const rows = Array.from({ length: 51 }, (_, index) => candidate(`keyset-${index + 1}`, `Keyset Prospect ${index + 1}`));
  const listRequests: string[] = [];
  await page.route("**/api/operator*", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ message: "ok" }) });
    if (url.searchParams.get("view") === "meta") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access: "OPERATOR" }) });
    if (url.searchParams.get("view") === "prospect-detail") {
      const id = url.searchParams.get("candidateId");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access: "OPERATOR", candidates: rows.filter((item) => item.id === id), runs: [], latestRunId: "run-1" }) });
    }
    listRequests.push(route.request().url());
    const search = String(url.searchParams.get("search") ?? "").toLowerCase();
    const filtered = rows.filter((item) => !search || item.candidate_name.toLowerCase().includes(search));
    const pageNumber = Number(url.searchParams.get("page") ?? "1");
    const pageSize = Number(url.searchParams.get("pageSize") ?? "25");
    const start = (pageNumber - 1) * pageSize;
    const pageRows = filtered.slice(start, start + pageSize);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access: "OPERATOR", candidates: pageRows, runs: [], latestRunId: "run-1", total: filtered.length, page: pageNumber, pageSize, pageCount: Math.max(1, Math.ceil(filtered.length / pageSize)), hasNext: start + pageSize < filtered.length, hasPrevious: pageNumber > 1, nextCursor: start + pageSize < filtered.length ? `opaque-next-${pageNumber}` : null, previousCursor: pageNumber > 1 ? `opaque-previous-${pageNumber}` : null, queueCounts: { NEEDS_REVIEW: filtered.length, READY_PEOPLE: 0, DRAFTS: 0, APPROVED: 0, DEFERRED: 0, ARCHIVE: 0, ALL: filtered.length } }) });
  });
  await page.goto("/operator/prospects");
  await expect(page.getByText("Keyset Prospect 1", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Keyset Prospect 26", { exact: true }).first()).toBeVisible();
  expect(await page.locator(".pagination").innerText()).toContain("Page 2 of 3");
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page.getByText("Keyset Prospect 1", { exact: true }).first()).toBeVisible();
  await page.getByPlaceholder("Search prospects").fill("Keyset Prospect 50");
  await expect(page.getByText("Keyset Prospect 50", { exact: true }).first()).toBeVisible();
  await page.getByLabel("Sort").selectOption("name");
  await expect(page.getByText("Keyset Prospect 50", { exact: true }).first()).toBeVisible();
  await page.goto("/operator/prospects?prospect=keyset-1");
  await expect(page.getByRole("dialog", { name: /Keyset Prospect 1/ })).toBeVisible();
  const nextRequest = listRequests.find((url) => new URL(url).searchParams.get("direction") === "next" && new URL(url).searchParams.get("page") === "2");
  const previousRequest = listRequests.find((url) => new URL(url).searchParams.get("direction") === "previous" && new URL(url).searchParams.get("page") === "1");
  const filterRequest = listRequests.find((url) => new URL(url).searchParams.get("search") === "Keyset Prospect 50");
  const sortRequest = listRequests.find((url) => new URL(url).searchParams.get("sort") === "name");
  expect(nextRequest && new URL(nextRequest).searchParams.get("cursor")).toBeTruthy();
  expect(previousRequest && new URL(previousRequest).searchParams.get("cursor")).toBeTruthy();
  expect(filterRequest && new URL(filterRequest).searchParams.get("page")).toBe("1");
  expect(filterRequest && new URL(filterRequest).searchParams.get("cursor")).toBeNull();
  expect(sortRequest && new URL(sortRequest).searchParams.get("page")).toBe("1");
  expect(sortRequest && new URL(sortRequest).searchParams.get("cursor")).toBeNull();
});
