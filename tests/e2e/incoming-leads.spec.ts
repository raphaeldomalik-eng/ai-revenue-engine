import { expect, test, type Page } from "@playwright/test";

const lead = { id: "lead-1", display_name: "Ava Morgan", contact_email: "ava@northstar.invalid", organisation_name: "Northstar Events", product_code: "event-suite", originating_source_category: "RESOURCE_DOWNLOAD", originating_source_detail: "Event Operations Planning Pack", latest_source_category: "DEMO_REQUEST", latest_source_detail: "Demo form", highest_intent_source_category: "DEMO_REQUEST", current_intent: "VERY_HIGH", priority: "URGENT", priority_reason: "Demo request requires immediate response", stage: "REVIEWING", lead_classification: "GENUINE_PROSPECT", data_quality_issues: [], enrichment_state: "NOT_ENRICHED", activity_count: 4, last_activity_at: "2026-08-28T08:00:00Z", first_activity_at: "2026-08-24T08:00:00Z", follow_up_at: null, last_contacted_at: null, owner_id: null, next_action: "Prepare demo response", identity_review_state: "RESOLVED", is_test: false, communication_policy: { permittedTreatment: "Transactional acknowledgement and human sales follow-up permitted.", marketingConsentRequired: false, responseUrgency: "IMMEDIATE", ownerRequired: true, humanApprovalRequired: true } };

async function mockIncomingApi(page: Page) {
  await page.route(/\/api\/operator/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access: "OPERATOR" }) }));
  await page.route("**/api/incoming-leads", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ lead, message: "Incoming lead updated." }) }));
  await page.route("**/api/incoming-leads?*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("leadId")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access: "OPERATOR", lead, changes: [], notes: [], submissions: [{ id: "submission-1", source_system: "event-suite-fixture", source_record_id: "fixture-demo-002", source_category: "DEMO_REQUEST", source_detail: "Demo form", source_page: "/demo", processing_state: "PROCESSED", consent_state: "NOT_REQUIRED", occurred_at: lead.last_activity_at, received_at: lead.last_activity_at }], activities: [{ id: "activity-1", activity_type: "demo_requested", summary: "Demo form", occurred_at: lead.last_activity_at }], members: [], account: null, contact: null, opportunity: null, evidence: [] }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access: "OPERATOR", leads: [lead], totalCount: 1, metrics: { newUnreviewed: 0, activeGenuineLeads: 1, highIntentLeads: 1, followUpsDue: 0, needsClassification: 0, incompleteNeedsEnrichment: 0 }, members: [], page: 1, pageSize: 25 }) });
  });
}

test("Incoming Leads supports inline triage and quick review on laptop", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await mockIncomingApi(page);
  await page.goto("/operator/incoming-leads");
  await expect(page.getByRole("heading", { name: "Triage incoming leads" })).toBeVisible();
  await expect(page.getByText("Review evidence and take the next safe action without leaving this queue.")).toBeVisible();
  await expect(page.getByText("Latest: Demo request")).toBeVisible();
  await expect(page.getByText("Prepare demo response")).toBeVisible();
  await expect(page.getByRole("button", { name: "Genuine" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Exclude ticketing" })).toBeVisible();
  await page.getByRole("button", { name: "Quick review" }).click();
  await expect(page.getByRole("complementary", { name: /Quick review for Ava Morgan/ })).toBeVisible();
  await expect(page.getByText("Full source and activity timeline")).toBeVisible();
  await page.getByLabel("Close quick review").click();
  await expect(page.getByRole("complementary", { name: /Quick review/ })).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("complementary", { name: /Quick review for Ava Morgan/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("g");
  await expect(page.getByRole("status")).toContainText("genuine prospect");
  await page.screenshot({ path: "test-results/incoming-leads-inline-triage-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("button", { name: "Exclude ticketing" })).toBeVisible();
  await page.screenshot({ path: "test-results/incoming-leads-inline-triage-wide.png", fullPage: true });
});

test("inline ticketing exclusion asks for confirmation and exposes undo", async ({ page }) => {
  await mockIncomingApi(page);
  await page.goto("/operator/incoming-leads");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Exclude ticketing" }).click();
  await expect(page.getByRole("status")).toContainText("Excluded as ticketing provider");
  await expect(page.getByRole("button", { name: "Undo exclusion" })).toBeVisible();
});

test("mobile triage keeps essential quick actions without the desktop table", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockIncomingApi(page);
  await page.goto("/operator/incoming-leads");
  await expect(page.getByRole("article").getByText("Ava Morgan")).toBeVisible();
  await expect(page.getByRole("button", { name: "Genuine" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Quick review" })).toBeVisible();
  await page.screenshot({ path: "test-results/incoming-leads-inline-triage-mobile.png", fullPage: true });
});

test("Incoming Lead detail is readable on mobile and has no send control", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockIncomingApi(page);
  await page.goto("/operator/incoming-leads/lead-1");
  await expect(page.getByRole("heading", { name: "Ava Morgan" })).toBeVisible();
  await expect(page.getByText("COMMUNICATION TREATMENT")).toBeVisible();
  await expect(page.getByText("No send, schedule, provider or message action exists in this workspace.")).toBeVisible();
  await expect(page.getByRole("button", { name: /send/i })).toHaveCount(0);
  await page.screenshot({ path: "test-results/incoming-lead-mobile.png", fullPage: true });
});
