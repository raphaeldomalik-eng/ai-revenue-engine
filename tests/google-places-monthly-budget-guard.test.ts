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

  await t.test("11. Missing Google API Key fails closed without provider contact", async () => {
    const budgetGuard = new MonthlyProviderBudgetGuard({ proLimit: 5 });
    const evidenceStore = createInMemoryGooglePlacesEvidenceStore();

    // Explicitly pass empty API key and no mock fetch
    const worker = new GoogleEnrichmentWorker(budgetGuard, evidenceStore, undefined, "");

    const result = await worker.processBatch("PRO", [{
      externalReferenceId: "ChIJ11111111111111111111111",
      originatingProduct: "resources",
      computedPriority: 100,
      status: "QUEUED",
    }]);

    assert.equal(result.callsExecuted, 0, "Zero provider calls executed");
    assert.equal(result.callsFailed, 1);
    assert.equal(result.results[0].outcome, "FAILED");
    assert.equal(result.results[0].error, "MISSING_GOOGLE_API_KEY");
  });

  await t.test("12. Genuine Enterprise Eligibility: synthetic eligibility blocked, genuine executed", async () => {
    const budgetGuard = new MonthlyProviderBudgetGuard({ enterpriseLimit: 10 });
    const evidenceStore = createInMemoryGooglePlacesEvidenceStore();
    let networkCalls = 0;

    const worker = new GoogleEnrichmentWorker(budgetGuard, evidenceStore, mockGoogle(() => {
      networkCalls += 1;
    }), "mock-key");

    // 1. Missing genuine eligibility evidence -> BLOCKED (0 calls)
    const blockedResult = await worker.processBatch("ENTERPRISE", [{
      externalReferenceId: "ChIJ11111111111111111111111",
      originatingProduct: "resources",
      computedPriority: 100,
      status: "QUEUED",
      // resourcesVenueEligibility not provided!
    }]);

    assert.equal(networkCalls, 0, "Zero provider calls made when eligibility evidence is absent");
    assert.equal(blockedResult.callsExecuted, 0);
    assert.equal(blockedResult.results[0].outcome, "ENTERPRISE_ELIGIBILITY_MISSING");

    // 2. Genuine governed eligibility provided -> EXECUTED (1 call)
    const approvedResult = await worker.processBatch("ENTERPRISE", [{
      externalReferenceId: "ChIJ11111111111111111111111",
      originatingProduct: "resources",
      computedPriority: 100,
      status: "QUEUED",
      resourcesVenueEligibility: "ELIGIBLE",
      eligibilityRef: "evidence:venues/gauteng/approved_listing_42",
    }]);

    assert.equal(networkCalls, 1, "Exactly one Enterprise call made with genuine eligibility");
    assert.equal(approvedResult.callsExecuted, 1);
    assert.equal(approvedResult.results[0].outcome, "CALL_EXECUTED");
  });

  await t.test("13. Direct Durable Queue Consumption: worker consumes queue until budget exhausted", async () => {
    const store = new (await import("../src/nexus/monthly-budget-guard.ts")).InMemoryBudgetStore({ proLimit: 2 });
    // Seed 4 jobs in queue
    for (let i = 1; i <= 4; i++) {
      store.enqueueTestJob({
        queueId: `queue-id-${i}`,
        provider: "google_places",
        billingTier: "PRO",
        externalReferenceId: `ChIJqueue00000000000000000${i}`,
        reservationId: "",
        originatingProduct: "resources",
        computedPriority: 100 - i,
        evidenceGapReason: "MISSING_PRO_CLASSIFICATION",
        targetName: `Venue ${i}`,
        locality: "Cape Town",
      });
    }

    const evidenceStore = createInMemoryGooglePlacesEvidenceStore();
    let networkCalls = 0;

    const worker = new GoogleEnrichmentWorker(store, evidenceStore, mockGoogle(() => {
      networkCalls += 1;
    }), "mock-key");

    const result = await worker.processDurableQueue("PRO", 10);

    assert.equal(networkCalls, 2, "Exactly 2 calls executed, stopping at limit = 2");
    assert.equal(result.callsExecuted, 2);
    assert.equal(result.candidatesProcessed, 2);
    assert.equal(result.finalBudgetRemaining, 0);
  });

  await t.test("14. Dynamic request metadata: consumes real candidate name and locality", async () => {
    const budgetGuard = new MonthlyProviderBudgetGuard({ proLimit: 5 });
    const evidenceStore = createInMemoryGooglePlacesEvidenceStore();
    let capturedId = "";

    const worker = new GoogleEnrichmentWorker(budgetGuard, evidenceStore, mockGoogle((id) => {
      capturedId = id;
    }), "mock-key");

    await worker.processBatch("PRO", [{
      externalReferenceId: "ChIJ99999999999999999999999",
      targetName: "Kyalami Grand Prix Circuit",
      locality: "Midrand",
      originatingProduct: "ticketing",
      computedPriority: 95,
      status: "QUEUED",
    }]);

    assert.equal(capturedId, "ChIJ99999999999999999999999");
  });

  await t.test("15. DurableSupabaseBudgetStore RPC contract verification", async () => {
    const rpcCalls: Array<{ fnName: string; args: Record<string, unknown> }> = [];
    const mockSupabase = {
      rpc: async (fnName: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fnName, args });
        if (fnName === "get_or_create_monthly_provider_budget") {
          return {
            data: {
              provider: args.p_provider,
              billing_tier: args.p_billing_tier,
              monthly_call_limit: 10,
              is_enabled: true,
              billing_period_start: "2026-10-01T00:00:00Z",
              billing_period_end: "2026-11-01T00:00:00Z",
              calls_consumed: 2,
              calls_reserved: 1,
              updated_by: "test",
              updated_at: "2026-10-04T12:00:00Z",
            },
            error: null,
          };
        }
        if (fnName === "set_monthly_provider_budget_limit") {
          return { data: { success: true, limit: args.p_limit }, error: null };
        }
        if (fnName === "reserve_monthly_provider_budget") {
          return { data: { success: true, reservation_id: "res-123", limit: 10, consumed: 2, reserved: 2, remaining: 6 }, error: null };
        }
        if (fnName === "reconcile_provider_budget_reservation") {
          return { data: { success: true, reservation_id: args.p_reservation_id, state: "CONSUMED", actual_consumed: args.p_actual_consumed, limit: 10, consumed: 3, reserved: 1, remaining: 6 }, error: null };
        }
        if (fnName === "claim_next_paid_enrichment_job") {
          return {
            data: {
              success: true,
              job: {
                queue_id: "q-1",
                provider: args.p_provider,
                billing_tier: args.p_billing_tier,
                external_reference_id: "ChIJ11111111111111111111111",
                reservation_id: "res-456",
                discovery_query: "test venue",
                originating_product: "resources",
                computed_priority: 90,
                evidence_gap_reason: "MISSING_PRO_CLASSIFICATION",
              },
              budget: { limit: 10, consumed: 2, reserved: 2, remaining: 6 },
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
    };

    const { DurableSupabaseBudgetStore } = await import("../src/nexus/monthly-budget-guard.ts");
    const store = new DurableSupabaseBudgetStore(mockSupabase);

    // Test getOrCreateBudget
    const budget = await store.getOrCreateBudget("google_places", "PRO");
    assert.equal(budget.monthlyCallLimit, 10);
    assert.equal(budget.remaining, 7);

    // Test reserveBudget
    const res = await store.reserveBudget("google_places", "PRO", 1);
    assert.equal(res.success, true);
    assert.equal(res.reservationId, "res-123");

    // Test reconcileReservation
    const rec = await store.reconcileReservation("res-123", 1, "CALL_EXECUTED");
    assert.equal(rec.success, true);
    assert.equal(rec.state, "CONSUMED");

    // Test claimNextJob
    const claimed = await store.claimNextJob("google_places", "PRO");
    assert.equal(claimed.success, true);
    assert.equal(claimed.job?.externalReferenceId, "ChIJ11111111111111111111111");

    assert.equal(rpcCalls.length, 4);
  });
});
