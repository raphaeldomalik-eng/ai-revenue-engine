import { test, expect } from "@playwright/test";

const words = Array.from({ length: 80 }, (_, index) => index === 0 ? "Current" : `evidence${index}`).join(" ");
const fixture = {
  access: "OPERATOR", runs: [{ id: "run-1", territory_code: "ZA", focus: "ALL", status: "COMPLETED", created_at: "2026-08-22T10:00:00Z" }], latestRunId: "run-1",
  candidates: [
    { id: "dsac-1", discovery_run_id: "run-1", canonical_key: "dsac", candidate_name: "Mzansi Roar Festival", organiser_name: "Department of Sport, Arts and Culture (DSAC)", website: null, territory_code: "ZA", origin: "EVENT_FIRST", status: "REVIEW_REQUIRED", relationship: "PROSPECT", facts: [{ claim: "DSAC is seeking a festival promoter for the Mzansi Roar Festival.", sourceUrl: "https://example.org/dsac", sourceTitle: "DSAC notice" }], unknowns: ["Event organiser not confirmed"], prospect_intelligence: { recommendedNextAction: "Confirm organiser", organisationResolution: { status: "UNRESOLVED" }, commercialPriority: "PHASE_ONE_PRIORITY" }, contacts: [], evidence: [], account: null },
    { id: "ready-1", discovery_run_id: "run-1", canonical_key: "ready", candidate_name: "Event Production Show", organiser_name: "Mash Media Group", website: "https://mashmedia.net", territory_code: "GB", origin: "EVENT_FIRST", status: "QUALIFIED", relationship: "PROSPECT", facts: [{ claim: "Runs a current event production programme.", sourceUrl: "https://mashmedia.net/events", sourceTitle: "Official events" }], unknowns: [], prospect_intelligence: { organisationResolution: { status: "RESOLVED", confidence: "HIGH" }, commercialPriority: "PHASE_ONE_PRIORITY" }, contacts: [{ id: "person-1", full_name: "Charlotte Fewlass", role_title: "Marketing Event Director", email: "charlotte@example.org", verification_status: "VERIFIED", metadata: { buyerRoutingClassification: "DIRECT_BUYER_CANDIDATE" } }], account: { id: "account-1", name: "Mash Media Group", website: "https://mashmedia.net", metadata: { outreachComposer: { drafts: [{ sequenceStage: "EMAIL_1", subject: "Event operations", bodyPlainText: words, approved: true, personalisationEvidenceIds: ["brief-evidence-1"] }] } } }, evidence: [] },
    { id: "duplicate-1", discovery_run_id: "run-1", canonical_key: "duplicate", candidate_name: "Historical duplicate", territory_code: "ZA", origin: "ORGANISATION_FIRST", status: "DUPLICATE", relationship: "PROSPECT", facts: [], unknowns: [], prospect_intelligence: {}, contacts: [], account: null },
  ],
};

for (const viewport of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }]) {
  test(`mocked prospect review flow at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route("**/api/operator?view=meta", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access: "OPERATOR" }) }));
    await page.route("**/api/operator?view=prospects", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture) }));
    await page.route("**/api/ai-sales/outreach-composer", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "PILOT_NOT_ENABLED", message: "Draft-only pilot is disabled in this mock." }) }));
    await page.goto("/operator/prospects");
    await expect(page.getByRole("heading", { name: "Prospects", exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Needs review/ })).toBeVisible();
    await expect(page.getByText("Historical duplicate", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Why relevant" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Person and email" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Next action" })).toBeVisible();
    await page.screenshot({ path: `test-results/prospect-queue-${viewport.width}x${viewport.height}.png`, fullPage: false });
    await page.getByText("Department of Sport, Arts and Culture (DSAC)", { exact: true }).click();
    await expect(page.getByRole("dialog", { name: /Department of Sport/ })).toBeVisible();
    await expect(page.getByText("Confirm the event organiser before looking for a buyer.", { exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/prospect-dsac-overview-${viewport.width}x${viewport.height}.png`, fullPage: false });
    await page.getByRole("tab", { name: "People", exact: true }).click();
    await expect(page.getByText("No suitable person has been identified yet.", { exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/prospect-dsac-people-${viewport.width}x${viewport.height}.png`, fullPage: false });
    await page.getByRole("tab", { name: "Email", exact: true }).click();
    await expect(page.getByText("Confirm identity and select a person with validated ownership before drafting.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Generate draft", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/operator\/prospects$/);
    await page.getByRole("tab", { name: /Ready for people/ }).click();
    await page.screenshot({ path: `test-results/prospect-ready-people-${viewport.width}x${viewport.height}.png`, fullPage: false });
    await page.getByText("Mash Media Group", { exact: true }).click();
    await page.getByRole("tab", { name: "People", exact: true }).click();
    await expect(page.getByText("Charlotte Fewlass", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Email", exact: true }).click();
    await expect(page.getByText("Email 1 — Introduction", { exact: true })).toBeVisible();
    await expect(page.getByText("Draft approved — not sent", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Send|Schedule|Publish|Enrol|Activate sequence/i })).toHaveCount(0);
    await page.screenshot({ path: `test-results/prospect-review-${viewport.width}x${viewport.height}.png`, fullPage: false });
  });
}
