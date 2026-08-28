import { expect, test, type Page } from "@playwright/test";

const lead = { id: "lead-1", display_name: "Ava Morgan", organisation_name: "Northstar Events", product_code: "event-suite", originating_source_category: "RESOURCE_DOWNLOAD", originating_source_detail: "Event Operations Planning Pack", latest_source_category: "DEMO_REQUEST", latest_source_detail: "Demo form", highest_intent_source_category: "DEMO_REQUEST", current_intent: "VERY_HIGH", priority: "URGENT", priority_reason: "Demo request requires immediate response", stage: "REVIEWING", activity_count: 4, last_activity_at: "2026-08-28T08:00:00Z", first_activity_at: "2026-08-24T08:00:00Z", follow_up_at: null, last_contacted_at: null, owner_id: null, next_action: "Prepare demo response", identity_review_state: "RESOLVED", is_test: false, communication_policy: { permittedTreatment: "Transactional acknowledgement and human sales follow-up permitted.", marketingConsentRequired: false, responseUrgency: "IMMEDIATE", ownerRequired: true, humanApprovalRequired: true } };

async function mockIncomingApi(page: Page) {
  await page.route("**/api/operator?view=meta*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access: "OPERATOR" }) }));
  await page.route("**/api/incoming-leads?*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("leadId")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access: "OPERATOR", lead, changes: [], notes: [], submissions: [{ id: "submission-1", source_system: "event-suite-fixture", source_record_id: "fixture-demo-002", source_category: "DEMO_REQUEST", source_detail: "Demo form", source_page: "/demo", processing_state: "PROCESSED", consent_state: "NOT_REQUIRED", occurred_at: lead.last_activity_at, received_at: lead.last_activity_at }], activities: [{ id: "activity-1", activity_type: "demo_requested", summary: "Demo form", occurred_at: lead.last_activity_at }], members: [] }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access: "OPERATOR", leads: [lead], allCount: 1, metrics: { newQualified: 0, requiringAction: 1, demoAwaitingResponse: 1, trialsAwaitingEngagement: 0, overdueFollowUps: 0, incomingConversionRate: 0 }, members: [] }) });
  });
}

test("Incoming Leads workspace is separate, actionable and source-aware on laptop", async ({ page }) => {
  await mockIncomingApi(page);
  await page.goto("/operator/incoming-leads");
  await expect(page.getByRole("heading", { name: "What needs attention?" })).toBeVisible();
  await expect(page.getByText("Incoming Leads are operationally separate from outbound AI Prospects.")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Demo request" })).toBeVisible();
  await expect(page.getByText("Prepare demo response")).toBeVisible();
  await expect(page.getByRole("link", { name: /Inspect/ })).toHaveAttribute("href", "/operator/incoming-leads/lead-1");
  await page.screenshot({ path: "test-results/incoming-leads-desktop.png", fullPage: true });
});

test("Incoming Lead detail is readable on mobile and has no send control", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockIncomingApi(page);
  await page.goto("/operator/incoming-leads/lead-1");
  await expect(page.getByRole("heading", { name: "Ava Morgan" })).toBeVisible();
  await expect(page.getByText("COMMUNICATION TREATMENT")).toBeVisible();
  await expect(page.getByText("V1 is display-only. No send, schedule, provider or message action exists.")).toBeVisible();
  await expect(page.getByRole("button", { name: /send/i })).toHaveCount(0);
  await page.screenshot({ path: "test-results/incoming-lead-mobile.png", fullPage: true });
});
