import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getDbPool,
  setDbPool,
  resetDbPool,
  createMockPool,
  isDbConfigured,
  fetchCatalogueBudgets,
  queryCataloguePage,
  fetchCatalogueItem,
  promoteCatalogueEntity,
} from "../src/nexus/db.ts";
import {
  buildCatalogueQuery,
  buildCatalogueCountQuery,
} from "../src/nexus/catalogue.ts";

// Spy on network requests to verify ZERO external provider calls occur
let externalNetworkCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (...args: any[]) => {
  const url = String(args[0]);
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
  const getPool = () => getDbPool();

  await t.test("1. no DB configuration in production fails closed", () => {
    const env = process.env as Record<string, string | undefined>;
    const oldNodeEnv = env.NODE_ENV;
    const oldResUrl = env.RESOURCES_V2_PRODUCTION_DATABASE_URL;
    const oldDbUrl = env.DATABASE_URL;
    try {
      env.NODE_ENV = "production";
      delete env.RESOURCES_V2_PRODUCTION_DATABASE_URL;
      delete env.DATABASE_URL;
      resetDbPool();

      assert.equal(isDbConfigured(), false, "isDbConfigured must be false when DB URL missing in production");
      assert.throws(
        () => getDbPool(),
        /DATABASE_UNCONFIGURED/,
        "getDbPool must fail closed without silent mock instantiation"
      );

      // Verify route source checks fail-closed 503 before any query
      const routeSource = readFileSync("app/api/operator/catalogue/route.ts", "utf8");
      assert.ok(routeSource.includes('if (!isDbConfigured())'));
      assert.ok(routeSource.includes('code: "DATABASE_UNCONFIGURED"'));
      assert.ok(routeSource.includes('{ status: 503 }'));
      assert.ok(routeSource.indexOf('if (!isDbConfigured())') < routeSource.indexOf('queryCataloguePage('));
    } finally {
      env.NODE_ENV = oldNodeEnv;
      if (oldResUrl) env.RESOURCES_V2_PRODUCTION_DATABASE_URL = oldResUrl;
      if (oldDbUrl) env.DATABASE_URL = oldDbUrl;
      resetDbPool();
    }
  });

  await t.test("2. mock data only available through explicit test path", () => {
    const env = process.env as Record<string, string | undefined>;
    const oldNodeEnv = env.NODE_ENV;
    const oldResUrl = env.RESOURCES_V2_PRODUCTION_DATABASE_URL;
    const oldDbUrl = env.DATABASE_URL;
    try {
      env.NODE_ENV = "production";
      delete env.RESOURCES_V2_PRODUCTION_DATABASE_URL;
      delete env.DATABASE_URL;
      resetDbPool();

      // Normal unconfigured call fails closed
      assert.throws(() => getDbPool(), /DATABASE_UNCONFIGURED/);

      // Explicit test path returns mock pool
      const mockPool = getDbPool({ allowMock: true });
      assert.ok(mockPool, "Explicit allowMock returns mock pool");
      assert.equal(typeof mockPool.query, "function");
    } finally {
      env.NODE_ENV = oldNodeEnv;
      if (oldResUrl) env.RESOURCES_V2_PRODUCTION_DATABASE_URL = oldResUrl;
      if (oldDbUrl) env.DATABASE_URL = oldDbUrl;
      resetDbPool();
    }
  });

  await t.test("3. unauthenticated Catalogue API denied (401)", () => {
    const routeSource = readFileSync("app/api/operator/catalogue/route.ts", "utf8");
    const operatorRouteSource = readFileSync("app/api/operator/route.ts", "utf8");

    // In production, ALLOW_LOCAL_OPERATOR must never activate
    assert.ok(routeSource.includes('process.env.NODE_ENV !== "production" && process.env.ALLOW_LOCAL_OPERATOR === "true"'));
    assert.ok(operatorRouteSource.includes('process.env.NODE_ENV !== "production" && process.env.ALLOW_LOCAL_OPERATOR === "true"'));

    // Unauthenticated caller receives 401
    assert.ok(routeSource.includes('{ status: 401 }'));
    assert.ok(operatorRouteSource.includes('{ status: 401 }'));
  });

  await t.test("4. viewer cannot promote (403)", () => {
    const routeSource = readFileSync("app/api/operator/catalogue/route.ts", "utf8");
    assert.ok(routeSource.includes('access.access !== "OPERATOR" && access.access !== "ADMIN"'));
    assert.ok(routeSource.includes('{ status: 403 }'));
    assert.ok(routeSource.includes('Operator permission required for catalogue actions'));
  });

  await t.test("5. operator can submit valid Pro promotion", async () => {
    const pool = getPool();
    const candidateQuery = await pool.query(
      "SELECT external_reference_id FROM integration.v_aire_catalogue WHERE is_invalid_reference = false AND pro_evidence_state = 'NO_PRO_EVIDENCE' LIMIT 1;"
    );
    assert.ok(candidateQuery.rows.length > 0);
    const targetRef = candidateQuery.rows[0].external_reference_id;

    const res = await promoteCatalogueEntity(
      {
        externalReferenceId: targetRef,
        billingTier: "PRO",
        purpose: "Operator Commercial Investigation",
        reason: "Valid prospect evaluation reason",
        originatingProduct: "resources",
        actorId: "test-operator-valid-pro",
      },
      pool
    );
    assert.equal(res.success, true);
    assert.equal(res.status, "WAITING_FOR_MONTHLY_BUDGET");
    assert.ok(res.queueId);

    const qCheck = await pool.query(
      "SELECT status, billing_tier, evidence_gap_reason, originating_product FROM integration.paid_enrichment_queue WHERE id = $1;",
      [res.queueId]
    );
    assert.equal(qCheck.rows[0].status, "WAITING_FOR_MONTHLY_BUDGET");
    assert.equal(qCheck.rows[0].billing_tier, "PRO");
    assert.match(qCheck.rows[0].evidence_gap_reason, /Operator Commercial Investigation/);
    assert.equal(qCheck.rows[0].originating_product, "resources");

    await pool.query("DELETE FROM integration.paid_enrichment_queue WHERE id = $1;", [res.queueId]);
  });

  await t.test("6. missing Pro reason rejected (400 REASON_REQUIRED)", async () => {
    const pool = getPool();
    // 1. Runtime function validation
    const res = await promoteCatalogueEntity(
      {
        externalReferenceId: "ChIJ11111111111111111111111",
        billingTier: "PRO",
        purpose: "Commercial Evaluation",
        reason: "   ",
        originatingProduct: "resources",
      },
      pool
    );
    assert.equal(res.success, false);
    assert.equal(res.reason, "REASON_REQUIRED");

    // 2. Route endpoint validation
    const routeSource = readFileSync("app/api/operator/catalogue/route.ts", "utf8");
    assert.ok(routeSource.includes('code: "REASON_REQUIRED"'));
    assert.ok(routeSource.includes('!reason || !reason.trim()'));
  });

  await t.test("7. missing Enterprise evidence gap rejected (400 EVIDENCE_GAP_REQUIRED)", async () => {
    const pool = getPool();
    // 1. Runtime function validation
    const res = await promoteCatalogueEntity(
      {
        externalReferenceId: "ChIJ11111111111111111111111",
        billingTier: "ENTERPRISE",
        purpose: "Enterprise Assessment",
        reason: "Valid reason",
        evidenceGapReason: "   ",
        originatingProduct: "venue_management",
      },
      pool
    );
    assert.equal(res.success, false);
    assert.equal(res.reason, "EVIDENCE_GAP_REQUIRED");

    // 2. Route endpoint validation
    const routeSource = readFileSync("app/api/operator/catalogue/route.ts", "utf8");
    assert.ok(routeSource.includes('code: "EVIDENCE_GAP_REQUIRED"'));
    assert.ok(routeSource.includes('!evidenceGapReason || !evidenceGapReason.trim()'));
  });

  await t.test("8. actor ID persisted in durable audit/authorization record", async () => {
    const pool = getPool();
    const candidateQuery = await pool.query(
      "SELECT external_reference_id FROM integration.v_aire_catalogue WHERE is_invalid_reference = false AND pro_evidence_state = 'NO_PRO_EVIDENCE' LIMIT 1;"
    );
    const targetRef = candidateQuery.rows[0].external_reference_id;
    const testActorId = "operator-audit-test-actor-" + Date.now();

    const res = await promoteCatalogueEntity(
      {
        externalReferenceId: targetRef,
        billingTier: "PRO",
        purpose: "Audit Trail Verification",
        reason: "Ensuring actor audit logging",
        originatingProduct: "resources",
        actorId: testActorId,
      },
      pool
    );
    assert.equal(res.success, true);
    assert.ok(res.queueId);

    const auditRes = await pool.query(
      "SELECT source_type, source_id, actor_id, action, previous_state, new_state, payload_diff FROM integration.operator_work_audit WHERE source_id = $1 ORDER BY created_at DESC LIMIT 1;",
      [res.queueId]
    );
    assert.ok(auditRes.rows.length > 0, "Audit record must be created in integration.operator_work_audit");
    const auditRow = auditRes.rows[0];
    assert.equal(auditRow.source_type, "paid_enrichment_queue");
    assert.equal(auditRow.source_id, res.queueId);
    assert.equal(auditRow.actor_id, testActorId);
    assert.equal(auditRow.action, "PROMOTE_PRO");
    assert.equal(auditRow.new_state, "WAITING_FOR_MONTHLY_BUDGET");

    const diff = typeof auditRow.payload_diff === "string" ? JSON.parse(auditRow.payload_diff) : auditRow.payload_diff;
    assert.equal(diff.authorization_source, "operator_manual");
    assert.equal(diff.actor_id, testActorId);
    assert.equal(diff.purpose, "Audit Trail Verification");
    assert.equal(diff.originating_product, "resources");
    assert.equal(diff.requested_tier, "PRO");

    await pool.query("DELETE FROM integration.paid_enrichment_queue WHERE id = $1;", [res.queueId]);
  });

  await t.test("9. existing queued job updated safely", async () => {
    const pool = getPool();
    const candidateQuery = await pool.query(
      "SELECT external_reference_id FROM integration.v_aire_catalogue WHERE is_invalid_reference = false AND pro_evidence_state = 'NO_PRO_EVIDENCE' LIMIT 1;"
    );
    const targetRef = candidateQuery.rows[0].external_reference_id;

    // First promotion creates it
    const res1 = await promoteCatalogueEntity(
      {
        externalReferenceId: targetRef,
        billingTier: "PRO",
        purpose: "Initial Intent",
        reason: "Initial reason",
        originatingProduct: "resources",
        actorId: "operator-1",
      },
      pool
    );
    assert.equal(res1.success, true);
    const initialQueueId = res1.queueId;

    // Second promotion updates it safely
    const res2 = await promoteCatalogueEntity(
      {
        externalReferenceId: targetRef,
        billingTier: "PRO",
        purpose: "Updated Intent",
        reason: "Updated reason",
        originatingProduct: "commercial_engine",
        actorId: "operator-2",
      },
      pool
    );
    assert.equal(res2.success, true);
    assert.equal(res2.queueId, initialQueueId, "Queue ID must be preserved on update");

    const check = await pool.query(
      "SELECT evidence_gap_reason, originating_product, attempts FROM integration.paid_enrichment_queue WHERE id = $1;",
      [initialQueueId]
    );
    assert.match(check.rows[0].evidence_gap_reason, /Updated Intent/);
    assert.equal(check.rows[0].originating_product, "commercial_engine");
    assert.equal(check.rows[0].attempts, 0, "Attempts must be preserved");

    await pool.query("DELETE FROM integration.paid_enrichment_queue WHERE id = $1;", [initialQueueId]);
  });

  await t.test("10. RESERVED job not reset (ALREADY_IN_PROGRESS)", async () => {
    const mockPool = createMockPool();
    mockPool.seedQueueRecord({
      id: "mock-reserved-1",
      provider: "google_places",
      external_reference_id: "ChIJ11111111111111111111111",
      billing_tier: "PRO",
      status: "RESERVED",
      reservation_id: "res-abc-123",
      attempts: 1,
    });

    const res = await promoteCatalogueEntity(
      {
        externalReferenceId: "ChIJ11111111111111111111111",
        billingTier: "PRO",
        purpose: "Attempt reset",
        reason: "Should be refused",
        originatingProduct: "resources",
      },
      mockPool
    );
    assert.equal(res.success, false);
    assert.equal(res.reason, "ALREADY_IN_PROGRESS");
    assert.match(res.message, /already in progress/i);

    const check = await mockPool.query(
      "SELECT status FROM integration.paid_enrichment_queue WHERE id = $1;",
      ["mock-reserved-1"]
    );
    assert.equal(check.rows[0].status, "RESERVED");
  });

  await t.test("11. IN_PROGRESS job not reset (ALREADY_IN_PROGRESS)", async () => {
    const mockPool = createMockPool();
    mockPool.seedQueueRecord({
      id: "mock-in-progress-1",
      provider: "google_places",
      external_reference_id: "ChIJ11111111111111111111111",
      billing_tier: "PRO",
      status: "IN_PROGRESS",
      attempts: 1,
    });

    const res = await promoteCatalogueEntity(
      {
        externalReferenceId: "ChIJ11111111111111111111111",
        billingTier: "PRO",
        purpose: "Attempt in-progress reset",
        reason: "Should be refused",
        originatingProduct: "resources",
      },
      mockPool
    );
    assert.equal(res.success, false);
    assert.equal(res.reason, "ALREADY_IN_PROGRESS");

    const check = await mockPool.query(
      "SELECT status FROM integration.paid_enrichment_queue WHERE id = $1;",
      ["mock-in-progress-1"]
    );
    assert.equal(check.rows[0].status, "IN_PROGRESS");
  });

  await t.test("12. COMPLETED/evidence-available job does not recreate spend", async () => {
    const mockPool = createMockPool();
    mockPool.seedQueueRecord({
      id: "mock-completed-1",
      provider: "google_places",
      external_reference_id: "ChIJ11111111111111111111111",
      billing_tier: "PRO",
      status: "COMPLETED",
      attempts: 1,
    });

    const res = await promoteCatalogueEntity(
      {
        externalReferenceId: "ChIJ11111111111111111111111",
        billingTier: "PRO",
        purpose: "Attempt spend on completed",
        reason: "Should be suppressed",
        originatingProduct: "resources",
      },
      mockPool
    );
    assert.equal(res.success, false);
    assert.equal(res.reason, "EVIDENCE_ALREADY_AVAILABLE");
    assert.match(res.message, /Existing evidence/);
  });

  await t.test("13. invalid provider ID blocked", async () => {
    const pool = getPool();
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

  await t.test("14. budget 0 creates/waits safely (WAITING_FOR_MONTHLY_BUDGET)", async () => {
    const pool = getPool();
    const budgets = await fetchCatalogueBudgets(pool);
    assert.equal(budgets.pro.monthlyCallLimit, 0);
    assert.equal(budgets.pro.remaining, 0);
    assert.equal(budgets.enterprise.monthlyCallLimit, 0);
    assert.equal(budgets.enterprise.remaining, 0);
    assert.equal(budgets.atmosphere.isEnabled, false);

    const candidateQuery = await pool.query(
      "SELECT external_reference_id FROM integration.v_aire_catalogue WHERE is_invalid_reference = false AND pro_evidence_state = 'NO_PRO_EVIDENCE' LIMIT 1;"
    );
    const targetRef = candidateQuery.rows[0].external_reference_id;
    const res = await promoteCatalogueEntity(
      {
        externalReferenceId: targetRef,
        billingTier: "PRO",
        purpose: "Budget 0 verification",
        reason: "Must enter WAITING_FOR_MONTHLY_BUDGET",
        originatingProduct: "resources",
      },
      pool
    );
    assert.equal(res.success, true);
    assert.equal(res.status, "WAITING_FOR_MONTHLY_BUDGET");
    await pool.query("DELETE FROM integration.paid_enrichment_queue WHERE id = $1;", [res.queueId]);
  });

  await t.test("15. zero provider calls", () => {
    assert.equal(externalNetworkCalls, 0, "Strict cost rule: 0 external provider or crawler calls dispatched");
  });

  await t.test("16. saved-view live count parity (9743, 2923, 17922, 17944, 210, 5367, 1078, 21468)", async () => {
    const pool = getPool();
    const countChecks: [string, any, number][] = [
      ["All Entities", {}, 21468],
      ["Resources Ready", { resourcesRoute: "STRONG_FIT" }, 9743],
      ["Event Businesses", { eventBusinessRoute: "STRONG_FIT" }, 2923],
      ["Commercial Possible", { commercialProspectingRoute: "POSSIBLE_FIT" }, 17922],
      ["Needs Identity Review", { canonicalIdentityState: "UNRESOLVED" }, 17944],
      ["Owner Confirmation", { ownerConfirmationRoute: "STRONG_FIT" }, 210],
      ["Needs Web Verification", { researchDisposition: "FIRST_PARTY_WEB_VERIFICATION" }, 5367],
      ["Invalid Provider Refs", { isInvalidReference: true }, 1078],
    ];

    for (const [name, filter, expectedCount] of countChecks) {
      const q = buildCatalogueCountQuery(filter);
      const res = await pool.query(q.text, q.values);
      const total = Number(res.rows[0]?.total ?? res.rows[0]?.count ?? 0);
      assert.equal(total, expectedCount, `Saved view '${name}' count must be exactly ${expectedCount}, got ${total}`);
    }
  });

  await t.test("17. Atmosphere Promotion Refused (Tier Disabled)", async () => {
    const pool = getPool();
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

  await t.test("18. Category-aware profile and routing verification", async () => {
    const pool = getPool();
    const res = await queryCataloguePage(
      {
        normalizedProfile: "food_beverage",
        eventCapability: "VENUE_CAPABLE_NEEDS_WEB_VERIFICATION",
        limit: 1,
      },
      pool
    );
    assert.ok(res.items.length > 0);
    const item = res.items[0];
    assert.equal(item.normalized_profile, "food_beverage");
    assert.equal(item.event_capability, "VENUE_CAPABLE_NEEDS_WEB_VERIFICATION");
    assert.equal(item.context_pos_route, "POSSIBLE_FIT");
  });
});
