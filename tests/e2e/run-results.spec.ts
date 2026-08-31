import { expect, test, type Page } from "@playwright/test";

const run = { id: "run-rejected", territory_code: "ZA", focus: "ALL", status: "COMPLETED", summary: { discovered: 1, blockedOrRejected: 1 }, created_at: "2026-08-20T20:41:09.818Z", completed_at: "2026-08-20T20:41:14.385Z" };
const rejected = { id: "eventsuite-self", discovery_run_id: run.id, canonical_key: "eventsuite|eventsuite.pro", candidate_name: "EventSuite", organiser_name: "EventSuite", website: "https://www.eventsuite.pro/za/event-ticketing-platform", territory_code: "ZA", origin: "ORGANISATION_FIRST", status: "REJECTED", relationship: "UNKNOWN", source_urls: ["https://www.eventsuite.pro/za/event-ticketing-platform"], facts: [{ claim: "EventSuite offers a ticketing platform for South African events.", sourceUrl: "https://www.eventsuite.pro/za/event-ticketing-platform", sourceTitle: "Event Ticketing Platform" }], inferences: [], unknowns: [], prospect_intelligence: { firstPartyStatus: "FIRST_PARTY_SELF", outreachBlockOrReviewReason: "FIRST_PARTY_SELF — EventSuite first-party identity is not eligible for commercial memory or outreach.", organisationResolution: { status: "NOT_REQUIRED" }, enrichment: { status: "SKIPPED", succeeded: false } } };

async function mockOperator(page: Page, payload: unknown) {
  await page.route("**/api/operator?*", (route) => {
    if (route.request().url().includes("view=meta")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access: "OPERATOR" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
}

test("rejected run result remains visible when no human decision is required", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await mockOperator(page, { access: "OPERATOR", runs: [run], selectedRun: run, candidates: [rejected], latestRunId: run.id });
  await page.goto(`/operator/runs/${run.id}`);
  await expect(page.getByText("No human decisions are required", { exact: true })).toBeVisible();
  await expect(page.getByText("ALL RUN RESULTS", { exact: true })).toBeVisible();
  await expect(page.getByText("EventSuite", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("FIRST_PARTY_SELF", { exact: false })).toBeVisible();
  await page.screenshot({ path: "test-results/run-results-rejected-desktop.png", fullPage: true });
  await page.getByRole("button", { name: /Rejected 1/ }).click();
  await expect(page.getByText("EventSuite", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: "test-results/run-results-rejected-filter.png", fullPage: true });
  await page.getByPlaceholder("Organisation, event, reason or source").fill("does-not-exist");
  await expect(page.getByRole("heading", { name: "No results match these filters" })).toBeVisible();
});

test("all results and attention stay separate on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const review = { ...rejected, id: "review", candidate_name: "Review organisation", organiser_name: "Review organisation", status: "REVIEW_REQUIRED", prospect_intelligence: { recommendedNextAction: "Confirm organiser", organisationResolution: { status: "UNRESOLVED" } } };
  const secondRejected = { ...rejected, id: "rejected-two", candidate_name: "Rejected organisation", organiser_name: "Rejected organisation" };
  const currentRun = { ...run, id: "run-mixed", summary: { discovered: 3, reviewRequired: 1, blockedOrRejected: 2 } };
  await mockOperator(page, { access: "OPERATOR", runs: [currentRun], selectedRun: currentRun, candidates: [{ ...review, discovery_run_id: currentRun.id }, { ...rejected, discovery_run_id: currentRun.id }, { ...secondRejected, discovery_run_id: currentRun.id }], latestRunId: currentRun.id });
  await page.goto(`/operator/runs/${currentRun.id}`);
  await expect(page.getByText("1 decision-oriented items", { exact: true })).toBeVisible();
  await expect(page.getByText("3 persisted results", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/run-results-mobile.png", fullPage: true });
});

test("aggregate-only historical runs say incomplete rather than no results", async ({ page }) => {
  await mockOperator(page, { access: "VIEWER", runs: [run], selectedRun: run, candidates: [], latestRunId: run.id });
  await page.goto(`/operator/runs/${run.id}`);
  await expect(page.getByText("HISTORICAL DATA INCOMPLETE", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Historical data incomplete" })).toBeVisible();
});
