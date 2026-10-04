import assert from "node:assert/strict";
import test from "node:test";
import {
  getDbPool,
  fetchCatalogueBudgets,
  queryCataloguePage,
  fetchCatalogueItem,
  promoteCatalogueEntity,
} from "../src/nexus/db.ts";
import {
  buildCatalogueQuery,
  buildCatalogueCountQuery,
} from "../src/nexus/catalogue.ts";

// Spy on network requests to verify ZERO external calls occur
let externalNetworkCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (...args: any[]) => {
  const url = String(args[0]);
  // Allow internal loopback or mock if needed, but fail on external provider calls
  if (
    url.includes("googleapis.com") ||
    url.includes("serper.dev") ||
    url.includes("apollo.io") ||
    url.includes("openai.com")
  ) {
    externalNetworkCalls++;
    throw new Error(`VIOLATION: External provider call dispatched to ${url}`);
  }
  return originalFetch.apply(globalThis, args as any);
};

test("Entity Catalogue Workspace & Governance Suite", async (t) => {
  const pool = getDbPool();

  await t.test("1. Production Projection: 21,468 records accounted and pageable", async () => {
    const res = await queryCataloguePage({ limit: 25, offset: 0 }, pool);
    assert.equal(res.total, 21468, "Exact 21,468 records must exist in integration.v_aire_catalogue");
    assert.equal(res.items.length, 25, "Bounded limit must return exactly 25 items");
    assert.ok(res.pageCount > 800, "Page count must reflect 21,468 / 25");
  });

  await t.test("2. Live Durable Budgets: Pro=0, Enterprise=0, Atmosphere=Disabled", async () => {
    const budgets = await fetchCatalogueBudgets(pool);
    assert.equal(budgets.pro.monthlyCallLimit, 0, "Pro budget limit must be 0");
    assert.equal(budgets.pro.remaining, 0, "Pro remaining must be 0");
    assert.equal(budgets.pro.isEnabled, true, "Pro must be enabled (with 0 limit)");

    assert.equal(budgets.enterprise.monthlyCallLimit, 0, "Enterprise budget limit must be 0");
    assert.equal(budgets.enterprise.remaining, 0, "Enterprise remaining must be 0");
    assert.equal(budgets.enterprise.isEnabled, true, "Enterprise must be enabled (with 0 limit)");

    assert.equal(budgets.atmosphere.monthlyCallLimit, 0, "Atmosphere limit must be 0");
    assert.equal(budgets.atmosphere.remaining, 0, "Atmosphere remaining must be 0");
    assert.equal(budgets.atmosphere.isEnabled, false, "Atmosphere must be strictly disabled");
  });

  await t.test("3. Restaurant + Event Intent Entity Profile & Routing", async () => {
    const res = await queryCataloguePage(
      {
        normalizedProfile: "food_beverage",
        eventCapability: "VENUE_CAPABLE_NEEDS_WEB_VERIFICATION",
        limit: 1,
      },
      pool
    );
    assert.ok(res.items.length > 0, "Must find restaurant + event intent candidates");
    const item = res.items[0];
    assert.equal(item.normalized_profile, "food_beverage");
    assert.equal(item.event_capability, "VENUE_CAPABLE_NEEDS_WEB_VERIFICATION");
    assert.ok(
      item.resources_route === "NEEDS_MORE_EVIDENCE" || item.resources_route === "POSSIBLE_FIT",
      "Resources route must require evidence"
    );
    assert.equal(item.context_pos_route, "POSSIBLE_FIT", "ContextPOS must be possible fit for restaurant");
    assert.equal(item.research_disposition, "FIRST_PARTY_WEB_VERIFICATION", "Next action must be web verification");
  });

  await t.test("4. Explicit Event Venue Profile & Routing", async () => {
    const res = await queryCataloguePage(
      {
        eventCapability: "EXPLICIT_EVENT_VENUE",
        limit: 1,
      },
      pool
    );
    assert.ok(res.items.length > 0, "Must find explicit event venue candidate");
    const item = res.items[0];
    assert.equal(item.event_capability, "EXPLICIT_EVENT_VENUE");
    assert.equal(item.resources_route, "STRONG_FIT", "Resources must be strong fit for explicit venue");
    assert.ok(
      ["AUTO_ELIGIBLE", "OPERATOR_PROMOTION_ALLOWED", "NOT_REQUIRED", "DEFERRED"].includes(
        item.enterprise_eligibility
      ),
      "Enterprise eligibility must be evaluated independently"
    );
  });

  await t.test("5. Event Supplier Profile & Routing", async () => {
    const res = await queryCataloguePage(
      {
        eventBusinessRoute: "STRONG_FIT",
        limit: 1,
      },
      pool
    );
    assert.ok(res.items.length > 0, "Must find event supplier candidates");
    const item = res.items[0];
    assert.equal(item.event_business_route, "STRONG_FIT");
    assert.equal(item.resources_route, "NOT_APPLICABLE", "Resources must not list suppliers as venues");
  });

  await t.test("6. Invalid Provider Reference Protection: Paid actions blocked", async () => {
    // 6a. Malformed ID format
    const malformed = await promoteCatalogueEntity(
      {
        externalReferenceId: "ChIJ_invalid_short",
        billingTier: "PRO",
        purpose: "Test",
        reason: "Testing malformed ID block",
        originatingProduct: "resources",
      },
      pool
    );
    assert.equal(malformed.success, false);
    assert.equal(malformed.reason, "INVALID_PROVIDER_REFERENCE");

    // 6b. Known invalid entity in catalogue
    const invalidQuery = await pool.query(
      "SELECT external_reference_id FROM integration.v_aire_catalogue WHERE is_invalid_reference = true LIMIT 1;"
    );
    if (invalidQuery.rows.length > 0) {
      const invalidRef = invalidQuery.rows[0].external_reference_id;
      const res = await promoteCatalogueEntity(
        {
          externalReferenceId: invalidRef,
          billingTier: "PRO",
          purpose: "Test",
          reason: "Testing invalid catalogue entity block",
          originatingProduct: "resources",
        },
        pool
      );
      assert.equal(res.success, false);
      assert.equal(res.reason, "INVALID_PROVIDER_REFERENCE");
    }
  });

  await t.test("7. Existing Evidence: Paid Request Suppressed", async () => {
    const enrichedQuery = await pool.query(
      "SELECT external_reference_id FROM integration.v_aire_catalogue WHERE pro_evidence_state = 'EVIDENCE_ALREADY_AVAILABLE' LIMIT 1;"
    );
    if (enrichedQuery.rows.length > 0) {
      const enrichedRef = enrichedQuery.rows[0].external_reference_id;
      const res = await promoteCatalogueEntity(
        {
          externalReferenceId: enrichedRef,
          billingTier: "PRO",
          purpose: "Test duplicate spend suppression",
          reason: "Testing existing evidence check",
          originatingProduct: "resources",
        },
        pool
      );
      assert.equal(res.success, false);
      assert.equal(res.reason, "EVIDENCE_ALREADY_AVAILABLE");
      assert.match(res.message, /Existing evidence satisfies this request/);
    }
  });

  await t.test("8. Pro Promotion: Zero Budget Queue Intent & 0 Provider Calls", async () => {
    const candidateQuery = await pool.query(
      "SELECT external_reference_id FROM integration.v_aire_catalogue WHERE is_invalid_reference = false AND pro_evidence_state = 'NO_PRO_EVIDENCE' LIMIT 1;"
    );
    if (candidateQuery.rows.length > 0) {
      const targetRef = candidateQuery.rows[0].external_reference_id;
      const res = await promoteCatalogueEntity(
        {
          externalReferenceId: targetRef,
          billingTier: "PRO",
          purpose: "Operator Commercial Investigation",
          reason: "Testing zero-budget fail-closed queue intent",
          originatingProduct: "resources",
        },
        pool
      );
      assert.equal(res.success, true);
      assert.equal(res.status, "WAITING_FOR_MONTHLY_BUDGET");
      assert.ok(res.queueId, "Queue ID must be generated");

      // Verify row in queue
      const qCheck = await pool.query(
        "SELECT status, billing_tier FROM integration.paid_enrichment_queue WHERE id = $1;",
        [res.queueId]
      );
      assert.equal(qCheck.rows[0].status, "WAITING_FOR_MONTHLY_BUDGET");
      assert.equal(qCheck.rows[0].billing_tier, "PRO");

      // Clean up test queue row
      await pool.query("DELETE FROM integration.paid_enrichment_queue WHERE id = $1;", [res.queueId]);
    }
  });

  await t.test("9. Enterprise Promotion: Zero Budget Queue Intent & No Fake Venue Eligibility", async () => {
    const candidateQuery = await pool.query(
      "SELECT external_reference_id FROM integration.v_aire_catalogue WHERE is_invalid_reference = false AND enterprise_evidence_state != 'EVIDENCE_ALREADY_AVAILABLE' LIMIT 1;"
    );
    if (candidateQuery.rows.length > 0) {
      const targetRef = candidateQuery.rows[0].external_reference_id;
      const res = await promoteCatalogueEntity(
        {
          externalReferenceId: targetRef,
          billingTier: "ENTERPRISE",
          purpose: "Enterprise Venue Sizing",
          reason: "High priority commercial client inquiry",
          evidenceGapReason: "Unresolved multi-hall seating capacity",
          originatingProduct: "venue_management",
        },
        pool
      );
      assert.equal(res.success, true);
      assert.equal(res.status, "WAITING_FOR_MONTHLY_BUDGET");

      // Verify row in queue
      const qCheck = await pool.query(
        "SELECT status, billing_tier, evidence_gap_reason FROM integration.paid_enrichment_queue WHERE id = $1;",
        [res.queueId]
      );
      assert.equal(qCheck.rows[0].status, "WAITING_FOR_MONTHLY_BUDGET");
      assert.equal(qCheck.rows[0].billing_tier, "ENTERPRISE");
      assert.match(qCheck.rows[0].evidence_gap_reason, /Unresolved multi-hall seating capacity/);

      // Clean up test queue row
      await pool.query("DELETE FROM integration.paid_enrichment_queue WHERE id = $1;", [res.queueId]);
    }
  });

  await t.test("10. Atmosphere Promotion Refused (Tier Disabled)", async () => {
    const res = await promoteCatalogueEntity(
      {
        externalReferenceId: "ChIJKx4hfR4NlR4RCV3azr8zDvk",
        billingTier: "ENTERPRISE_ATMOSPHERE" as any,
        purpose: "Atmosphere test",
        reason: "Testing disabled tier",
        originatingProduct: "resources",
      },
      pool
    );
    assert.equal(res.success, false);
    assert.equal(res.reason, "INVALID_BILLING_TIER");
  });

  await t.test("11. Zero Provider / Crawler Calls Enforced Across Whole Run", () => {
    assert.equal(externalNetworkCalls, 0, "Strict cost rule: 0 external provider or crawler calls");
  });
});
