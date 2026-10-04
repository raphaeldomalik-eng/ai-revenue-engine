// google-places-monthly-budget-guard.test.ts — Comprehensive test suite for Monthly Budget Guard (Section 39).
import test from "node:test";
import assert from "node:assert/strict";
import { MonthlyProviderBudgetGuard } from "../src/nexus/monthly-budget-guard.ts";
import { GoogleEnrichmentWorker, type EnrichedQueueCandidate } from "../src/nexus/google-enrichment-worker.ts";
import { createInMemoryGooglePlacesEvidenceStore } from "../src/ai-sales-team/google-places-evidence.ts";

function mockGoogle(onCall?: (placeId: string, mask: string) => void): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    const fieldMask = new Headers(init?.headers).get("x-goog-fieldmask") ?? "";
    const id = decodeURIComponent(String(url).split("/").pop() ?? "");
    if (onCall) onCall(id, fieldMask);
    return Response.json({
      id,
      displayName: { text: "Mock Venue" },
      primaryType: "event_venue",
      types: ["event_venue"],
      formattedAddress: "1 Main St, Johannesburg",
      businessStatus: "OPERATIONAL",
      websiteUri: "https://mockvenue.example",
    });
  }) as typeof fetch;
}

test("Google Places Monthly Budget Guard — Section 39 Requirements Matrix", async (t) => {
  await t.test("1. Zero budget: Pro limit = 0, backlog = 500 -> calls = 0, candidates remain waiting", async () => {
    const budgetGuard = new MonthlyProviderBudgetGuard({ proLimit: 0 });
    const evidenceStore = createInMemoryGooglePlacesEvidenceStore();
    let networkCalls = 0;

    const worker = new GoogleEnrichmentWorker(budgetGuard, evidenceStore, mockGoogle(() => {
      networkCalls += 1;
    }));

    const candidates: EnrichedQueueCandidate[] = Array.from({ length: 500 }, (_, i) => ({
      externalReferenceId: `ChIJ${String(i).padStart(23, "0")}`,
      originatingProduct: "resources",
      computedPriority: 100 - (i % 50),
      status: "QUEUED",
    }));

    const result = await worker.processBatch("PRO", candidates);

    assert.equal(networkCalls, 0, "Zero real or mock provider calls made");
    assert.equal(result.callsExecuted, 0);
    assert.equal(result.finalBudgetRemaining, 0);
  });

  await t.test("2. Partial monthly allowance: Pro limit = 100, backlog = 500 -> max 100 calls executed", async () => {
    const budgetGuard = new MonthlyProviderBudgetGuard({ proLimit: 100 });
    const evidenceStore = createInMemoryGooglePlacesEvidenceStore();
    let networkCalls = 0;

    const worker = new GoogleEnrichmentWorker(budgetGuard, evidenceStore, mockGoogle(() => {
      networkCalls += 1;
    }));

    const candidates: EnrichedQueueCandidate[] = Array.from({ length: 500 }, (_, i) => ({
      externalReferenceId: `ChIJ${String(i).padStart(23, "0")}`,
      originatingProduct: "resources",
      computedPriority: 500 - i, // Highest priority first
      status: "QUEUED",
    }));

    const result = await worker.processBatch("PRO", candidates);

    assert.equal(networkCalls, 100, "Exactly 100 calls executed");
    assert.equal(result.callsExecuted, 100);
    assert.equal(result.candidatesProcessed, 101, "Processed up to boundary where budget was exhausted");
    assert.equal(result.finalBudgetRemaining, 0, "Monthly budget is now exhausted");
  });

  await t.test("3. Fewer candidates than allowance: limit = 1000, 217 candidates -> 217 calls max, 783 unspent", async () => {
    const budgetGuard = new MonthlyProviderBudgetGuard({ proLimit: 1000 });
    const evidenceStore = createInMemoryGooglePlacesEvidenceStore();
    let networkCalls = 0;

    const worker = new GoogleEnrichmentWorker(budgetGuard, evidenceStore, mockGoogle(() => {
      networkCalls += 1;
    }));

    const candidates: EnrichedQueueCandidate[] = Array.from({ length: 217 }, (_, i) => ({
      externalReferenceId: `ChIJ${String(i).padStart(23, "0")}`,
      originatingProduct: "resources",
      computedPriority: 100,
      status: "QUEUED",
    }));

    const result = await worker.processBatch("PRO", candidates);

    assert.equal(networkCalls, 217, "Exactly 217 calls executed");
    assert.equal(result.callsExecuted, 217);
    assert.equal(result.finalBudgetRemaining, 783, "Remaining 783 is NOT spent (ceiling, not target)");
  });

  await t.test("4. Evidence discovered before execution: job suppressed from evidence, budget consumption = 0", async () => {
    const budgetGuard = new MonthlyProviderBudgetGuard({ proLimit: 50 });
    const evidenceStore = createInMemoryGooglePlacesEvidenceStore();
    let networkCalls = 0;

    const placeId = "ChIJaaaaaaaaaaaaaaaaaaaaaaa";
    const worker = new GoogleEnrichmentWorker(budgetGuard, evidenceStore, mockGoogle(() => {
      networkCalls += 1;
    }));

    // First call fetches and stores evidence
    await worker.processBatch("PRO", [{
      externalReferenceId: placeId,
      originatingProduct: "resources",
      computedPriority: 100,
      status: "QUEUED",
    }]);
    assert.equal(networkCalls, 1, "First call stored evidence");

    // Second call for same Place ID immediately reuses evidence
    const secondResult = await worker.processBatch("PRO", [{
      externalReferenceId: placeId,
      originatingProduct: "resources",
      computedPriority: 100,
      status: "QUEUED",
    }]);

    assert.equal(networkCalls, 1, "Network call was completely suppressed by evidence");
    assert.equal(secondResult.callsSuppressed, 1);
    assert.equal(secondResult.callsExecuted, 0);
    assert.equal(secondResult.finalBudgetRemaining, 49, "Budget remaining is untouched from the second attempt");
  });

  await t.test("5. Duplicate cross-product requests: at most 1 call made, shared evidence reused", async () => {
    const budgetGuard = new MonthlyProviderBudgetGuard({ proLimit: 10 });
    const evidenceStore = createInMemoryGooglePlacesEvidenceStore();
    let networkCalls = 0;

    const placeId = "ChIJbbbbbbbbbbbbbbbbbbbbbbb";

    const worker = new GoogleEnrichmentWorker(budgetGuard, evidenceStore, mockGoogle(() => {
      networkCalls += 1;
    }));

    // Resources requests placeId
    const resResources = await worker.processBatch("PRO", [{
      externalReferenceId: placeId,
      originatingProduct: "resources",
      computedPriority: 90,
      status: "QUEUED",
    }]);
    assert.equal(resResources.callsExecuted, 1);
    assert.equal(networkCalls, 1);

    // ContextPOS requests same placeId
    const resPOS = await worker.processBatch("PRO", [{
      externalReferenceId: placeId,
      originatingProduct: "context_pos",
      computedPriority: 80,
      status: "QUEUED",
    }]);
    assert.equal(resPOS.callsSuppressed, 1);
    assert.equal(resPOS.callsExecuted, 0);
    assert.equal(networkCalls, 1, "Still exactly 1 provider call made across both products");
  });

  await t.test("6. Concurrent workers racing for 1 credit: only one gets reservation, calls <= 1", async () => {
    const budgetGuard = new MonthlyProviderBudgetGuard({ proLimit: 1 });

    const [res1, res2] = await Promise.all([
      budgetGuard.reserveBudget("google_places", "PRO", 1),
      budgetGuard.reserveBudget("google_places", "PRO", 1),
    ]);

    const successes = [res1, res2].filter(r => r.success);
    const failures = [res1, res2].filter(r => !r.success);

    assert.equal(successes.length, 1, "Only 1 worker succeeded");
    assert.equal(failures.length, 1, "Other worker failed reservation");
    assert.equal(failures[0].reason, "MONTHLY_LIMIT_EXCEEDED");
  });

  await t.test("7. Month rollover: Month A exhausted, Month B resumes backlog automatically", async () => {
    const budgetGuard = new MonthlyProviderBudgetGuard();
    const evidenceStore = createInMemoryGooglePlacesEvidenceStore();
    let networkCalls = 0;

    const worker = new GoogleEnrichmentWorker(budgetGuard, evidenceStore, mockGoogle(() => {
      networkCalls += 1;
    }));

    const monthA = new Date("2026-10-15T00:00:00Z");
    await budgetGuard.setMonthlyLimit("google_places", "PRO", 1, true, "owner", monthA);

    const candidates: EnrichedQueueCandidate[] = [
      { externalReferenceId: "ChIJ11111111111111111111111", originatingProduct: "resources", computedPriority: 100, status: "QUEUED" },
      { externalReferenceId: "ChIJ22222222222222222222222", originatingProduct: "resources", computedPriority: 90, status: "QUEUED" },
    ];

    // Month A execution: consumes the 1 credit
    const resA = await worker.processBatch("PRO", candidates, monthA);
    assert.equal(resA.callsExecuted, 1);
    assert.equal(resA.finalBudgetRemaining, 0);

    // Month B (November 2026): allowance becomes available
    const monthB = new Date("2026-11-01T00:00:01Z");
    const budgetB = budgetGuard.getOrCreateBudget("google_places", "PRO", monthB);
    assert.equal(budgetB.remaining, 1, "Allowance reset for new month");

    // Second candidate is processed in Month B
    const resB = await worker.processBatch("PRO", [candidates[1]], monthB);
    assert.equal(resB.callsExecuted, 1);
    assert.equal(networkCalls, 2, "Both candidates completed across month boundary");
  });

  await t.test("8. Independent tiers: Pro exhausted does not block Enterprise; no borrowing across tiers", async () => {
    const budgetGuard = new MonthlyProviderBudgetGuard({ proLimit: 1, enterpriseLimit: 1 });

    // Exhaust Pro
    const resPro = await budgetGuard.reserveBudget("google_places", "PRO", 1);
    assert.equal(resPro.success, true);
    const resProExhausted = await budgetGuard.reserveBudget("google_places", "PRO", 1);
    assert.equal(resProExhausted.success, false);

    // Enterprise is still available and has 1 credit
    const entState = budgetGuard.getOrCreateBudget("google_places", "ENTERPRISE");
    assert.equal(entState.remaining, 1);
    const resEnt = await budgetGuard.reserveBudget("google_places", "ENTERPRISE", 1);
    assert.equal(resEnt.success, true);

    // Further Enterprise cannot borrow from Pro
    const resEntExhausted = await budgetGuard.reserveBudget("google_places", "ENTERPRISE", 1);
    assert.equal(resEntExhausted.success, false);
  });

  await t.test("9. Enterprise not justified: zero enterprise calls when not requested", async () => {
    const budgetGuard = new MonthlyProviderBudgetGuard({ proLimit: 10, enterpriseLimit: 10 });
    const evidenceStore = createInMemoryGooglePlacesEvidenceStore();
    let enterpriseCalls = 0;

    const worker = new GoogleEnrichmentWorker(budgetGuard, evidenceStore, mockGoogle((id, mask) => {
      if (mask.includes("websiteUri")) {
        enterpriseCalls += 1;
      }
    }));

    // Run Pro batch
    await worker.processBatch("PRO", [{
      externalReferenceId: "ChIJ11111111111111111111111",
      originatingProduct: "resources",
      computedPriority: 100,
      status: "QUEUED",
    }]);

    assert.equal(enterpriseCalls, 0, "No Enterprise calls made for Pro batch");
    const entState = budgetGuard.getOrCreateBudget("google_places", "ENTERPRISE");
    assert.equal(entState.callsConsumed, 0);
  });

  await t.test("10. Malformed Place ID: cannot reserve budget, cannot reach provider", async () => {
    const budgetGuard = new MonthlyProviderBudgetGuard({ proLimit: 10 });
    const evidenceStore = createInMemoryGooglePlacesEvidenceStore();
    let networkCalls = 0;

    const worker = new GoogleEnrichmentWorker(budgetGuard, evidenceStore, mockGoogle(() => {
      networkCalls += 1;
    }));

    const result = await worker.processBatch("PRO", [{
      externalReferenceId: "ChIJ_cpt_bInvalidHash",
      originatingProduct: "resources",
      computedPriority: 100,
      status: "QUEUED",
    }]);

    assert.equal(networkCalls, 0, "Provider was never contacted for malformed ID");
    assert.equal(result.callsExecuted, 0);
    assert.equal(result.results[0].outcome, "MALFORMED_REJECTED");
    assert.equal(result.finalBudgetRemaining, 10, "Budget intact");
  });
});
