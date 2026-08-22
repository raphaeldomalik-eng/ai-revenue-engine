import { test, expect } from "@playwright/test";

const words = Array.from({ length: 80 }, (_, index) => index === 0 ? "Current" : `evidence${index}`).join(" ");
const fixture = {
  access: "OPERATOR", runs: [{ id: "run-1", territory_code: "ZA", focus: "ALL", status: "COMPLETED", created_at: "2026-08-22T10:00:00Z" }], latestRunId: "run-1",
  candidates: [
    { id: "dsac-1", discovery_run_id: "run-1", canonical_key: "dsac", candidate_name: "Mzansi Roar Festival", organiser_name: "Department of Sport, Arts and Culture (DSAC)", website: null, territory_code: "ZA", origin: "EVENT_FIRST", status: "REVIEW_REQUIRED", relationship: "PROSPECT", facts: [{ claim: "DSAC is seeking a festival promoter for the Mzansi Roar Festival.", sourceUrl: "https://example.org/dsac", sourceTitle: "DSAC notice" }], unknowns: ["Event organiser not confirmed"], prospect_intelligence: { recommendedNextAction: "Confirm organiser", organisationResolution: { status: "UNRESOLVED" }, commercialPriority: "PHASE_ONE_PRIORITY" }, contacts: [], evidence: [], account: null },
    { id: "ready-1", discovery_run_id: "run-1", canonical_key: "ready", candidate_name: "Event Production Show", organiser_name: "Mash Media Group", website: "https://mashmedia.net", territory_code: "GB", origin: "EVENT_FIRST", status: "QUALIFIED", relationship: "PROSPECT", facts: [{ claim: "Runs a current event production programme.", sourceUrl: "https://mashmedia.net/events", sourceTitle: "Official events" }], unknowns: [], prospect_intelligence: { organisationResolution: { status: "RESOLVED", confidence: "HIGH" }, commercialPriority: "PHASE_ONE_PRIORITY" }, prospect_approval: { decision: "APPROVED", created_at: "2026-08-22T11:00:00Z" }, contacts: [{ id: "person-1", full_name: "Charlotte Fewlass", role_title: "Marketing Event Director", email: "charlotte@example.org", verification_status: "VERIFIED", metadata: { buyerRoutingClassification: "DIRECT_BUYER_CANDIDATE" } }], account: { id: "account-1", name: "Mash Media Group", website: "https://mashmedia.net", metadata: { outreachComposer: { drafts: [{ sequenceStage: "EMAIL_1", subject: "Event operations", bodyPlainText: words, approved: true, personalisationEvidenceIds: ["brief-evidence-1"] }] } } }, evidence: [] },
    { id: "duplicate-1", discovery_run_id: "run-1", canonical_key: "duplicate", candidate_name: "Historical duplicate", territory_code: "ZA", origin: "ORGANISATION_FIRST", status: "DUPLICATE", relationship: "PROSPECT", facts: [], unknowns: [], prospect_intelligence: {}, contacts: [], account: null },
  ],
};

for (const viewport of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }]) {
  test(`mocked prospect review flow at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const currentFixture = structuredClone(fixture);
    await page.route("**/api/operator?view=meta", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access: "OPERATOR" }) }));
    await page.route("**/api/operator?view=prospects", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(currentFixture) }));
    await page.route("**/api/operator", async (route) => {
      if (route.request().method() !== "POST") {
        if (route.request().url().includes("view=meta")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access: "OPERATOR" }) });
        if (route.request().url().includes("view=prospects")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(currentFixture) });
        return route.continue();
      }
      const body = route.request().postDataJSON() as { action: string; candidateId: string; reasonCode?: string; otherExplanation?: string; note?: string };
      const candidate = currentFixture.candidates.find((item) => item.id === body.candidateId) as any;
      if (body.action === "BLOCK") {
        candidate.status = "BLOCKED";
        candidate.review_decisions = [{ id: "decision-1", candidate_id: candidate.id, decision: "BLOCKED", reason_code: body.reasonCode, other_explanation: body.otherExplanation ?? null, note: body.note ?? null, created_at: "2026-08-22T12:00:00Z" }];
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ message: "Prospect blocked and moved to History / archive." }) });
      }
      candidate.status = "REVIEW_REQUIRED";
      candidate.review_decisions = [{ id: "decision-2", candidate_id: candidate.id, decision: "REOPENED", reason_code: null, other_explanation: null, note: null, created_at: "2026-08-22T12:05:00Z" }, ...(candidate.review_decisions ?? [])];
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ message: "Prospect reopened for review." }) });
    });
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
    await page.getByRole("button", { name: "Block prospect", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save block decision", exact: true })).toBeDisabled();
    await page.getByLabel("Why should this prospect leave active review?").selectOption("OTHER");
    await expect(page.getByRole("button", { name: "Save block decision", exact: true })).toBeDisabled();
    await page.getByLabel("Short explanation").fill("No credible commercial fit");
    await page.getByLabel(/Reviewer note/).fill("Keep this feedback for future evaluation only.");
    await expect(page.getByRole("button", { name: "Save block decision", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Save block decision", exact: true }).click();
    await expect(page.getByText("Prospect blocked and moved to History / archive.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close prospect drawer" }).click();
    await page.getByRole("tab", { name: /History \/ archive/ }).click();
    await page.getByText("Department of Sport, Arts and Culture (DSAC)", { exact: true }).click();
    await expect(page.getByRole("button", { name: "Reopen for review", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Reopen for review", exact: true }).click();
    await expect(page.getByText("This will return the prospect to Needs review.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Reopen for review", exact: true }).click();
    await expect(page.getByText("Prospect reopened for review.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close prospect drawer" }).click();
    await page.getByRole("tab", { name: /Needs review/ }).click();
    await expect(page.getByText("Department of Sport, Arts and Culture (DSAC)", { exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/prospect-dsac-overview-${viewport.width}x${viewport.height}.png`, fullPage: false });
    await page.getByText("Department of Sport, Arts and Culture (DSAC)", { exact: true }).click();
    await page.getByRole("tab", { name: "People", exact: true }).click();
    await expect(page.getByText("No suitable person has been identified yet.", { exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/prospect-dsac-people-${viewport.width}x${viewport.height}.png`, fullPage: false });
    await page.getByRole("tab", { name: "Email", exact: true }).click();
    await expect(page.getByText("“Approve prospect for drafting” is required before an email draft can be requested.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve prospect first", exact: true })).toBeDisabled();
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
    await expect(page.getByText("Email approved", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Send|Schedule|Publish|Enrol|Activate sequence/i })).toHaveCount(0);
    await page.screenshot({ path: `test-results/prospect-review-${viewport.width}x${viewport.height}.png`, fullPage: false });
  });
}

test("mocked two-stage prospect and email approval flow", async ({ page }) => {
  const currentFixture = structuredClone(fixture) as any;
  const candidate = currentFixture.candidates.find((item: any) => item.id === "ready-1");
  candidate.account_id = "account-1";
  candidate.prospect_approval = null;
  candidate.account.metadata.outreachComposer = { drafts: [] };
  await page.route("**/api/operator?view=meta", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access: "OPERATOR" }) }));
  await page.route("**/api/operator?view=prospects", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(currentFixture) }));
  await page.route("**/api/operator", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON() as { action: string; candidateId: string };
    if (body.action === "APPROVE_PROSPECT") {
      candidate.prospect_approval = { decision: "APPROVED", created_at: "2026-08-22T12:00:00Z" };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ message: "Prospect approved for drafting." }) });
    }
    return route.continue();
  });
  await page.route("**/api/ai-sales/outreach-composer", async (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ drafts: [], versions: [], reviews: [] }) });
    const body = route.request().postDataJSON() as { action: string };
    if (body.action === "prepare") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ draftId: "draft-1", versionIds: [], generated: [1, 2, 3].map((stage) => ({ model: { status: "DRAFT_READY", sequenceStage: `EMAIL_${stage}`, subject: `Subject ${stage}`, bodyPlainText: words, personalisationEvidenceIds: ["brief-evidence-1"], claimEvidence: [{ claim: "Current event activity" }] }, renderedBody: `Subject ${stage}\n\n${words}\n\nRaphael Domalik\nEventSuite` })) }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "review-1" }) });
  });
  await page.goto("/operator/prospects");
  await page.getByRole("tab", { name: /Ready for people/ }).click();
  await page.getByText("Mash Media Group", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Approve prospect for drafting", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve prospect for drafting", exact: true }).click();
  await expect(page.getByText("Prospect approved for drafting.", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Email", exact: true }).click();
  await page.getByRole("button", { name: "Prepare email draft", exact: true }).click();
  await expect(page.getByText("Email draft ready for your review", { exact: true })).toHaveCount(3);
  await expect(page.getByText("Recipient:", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Current", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve email", exact: true })).toHaveCount(3);
  await page.getByRole("button", { name: "Approve email", exact: true }).first().click();
  await expect(page.getByText("Email approved", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Email draft ready for your review", { exact: true })).toHaveCount(2);
  const secondEmail = page.locator(".email-stage").nth(1);
  await secondEmail.getByRole("button", { name: "Edit", exact: true }).click();
  await secondEmail.getByRole("button", { name: "Save edit for approval", exact: true }).click();
  await expect(secondEmail.getByText("Email draft ready for your review", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Send|Schedule|Publish|Enrol|Activate sequence/i })).toHaveCount(0);
});
