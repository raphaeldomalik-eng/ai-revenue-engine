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
  assertSafeMutationTarget,
  isProductionDatabaseUrl,
  PRODUCTION_PROJECT_REF,
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
  // Use mock pool exclusively for test isolation — no production DB mutation
  const sharedMockPool = createMockPool();
  setDbPool(sharedMockPool);
  const getPool = () => sharedMockPool;

  await t.test("1. production DB missing -> 503 fail closed", () => {
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
      setDbPool(sharedMockPool);
    }
  });

  await t.test("2. mock pool only via explicit test path", () => {
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
      assert.equal(typeof mockPool.connect, "function");
    } finally {
      env.NODE_ENV = oldNodeEnv;
      if (oldResUrl) env.RESOURCES_V2_PRODUCTION_DATABASE_URL = oldResUrl;
      if (oldDbUrl) env.DATABASE_URL = oldDbUrl;
      setDbPool(sharedMockPool);
    }
  });

  await t.test("3. queue + audit commit together in single transaction", async () => {
    const pool = createMockPool();
    const res = await promoteCatalogueEntity(
      {
        externalReferenceId: "ChIJ11111111111111111111111",
        billingTier: "PRO",
        purpose: "Atomic Promotion Verification",
        reason: "Testing single transaction commit",
        originatingProduct: "resources",
        actorId: "operator-atomic-test",
      },
      pool
    );
    assert.equal(res.success, true);
    assert.ok(res.queueId);

    // Verify BOTH queue and audit records exist
    const queueRows = pool.getQueueRecords();
    const auditRows = pool.getAuditRecords();
    assert.equal(queueRows.length, 1);
    assert.equal(auditRows.length, 1);
    assert.equal(queueRows[0].id, res.queueId);
    assert.equal(auditRows[0].source_id, res.queueId);
    assert.equal(auditRows[0].actor_id, "operator-atomic-test");
    assert.equal(auditRows[0].action, "PROMOTE_PRO");
  });

  await t.test("4. audit failure rolls back queue mutation", async () => {
    const pool = createMockPool();
    pool.simulateAuditFailure(true);

    const res = await promoteCatalogueEntity(
      {
        externalReferenceId: "ChIJ11111111111111111111111",
        billingTier: "PRO",
        purpose: "Audit Failure Rollback Verification",
        reason: "Testing transaction rollback on audit failure",
        originatingProduct: "resources",
        actorId: "operator-rollback-test",
      },
      pool
    );
    assert.equal(res.success, false);
    assert.equal(res.reason, "TRANSACTION_FAILED");

    // Verify queue mutation was rolled back and no audit record exists
    const queueRows = pool.getQueueRecords();
    const auditRows = pool.getAuditRecords();
    assert.equal(queueRows.length, 0, "Queue row must be rolled back on audit failure");
    assert.equal(auditRows.length, 0, "No audit record should persist");
  });

  await t.test("5. concurrent QUEUED -> RESERVED race cannot be reset", async () => {
    const pool = createMockPool();
    // 1. Operator sees mutable job (initially QUEUED)
    pool.seedQueueRecord({
      id: "mock-race-job-1",
      provider: "google_places",
      external_reference_id: "ChIJ11111111111111111111111",
      billing_tier: "PRO",
      status: "QUEUED",
      reservation_id: null,
      attempts: 0,
    });

    // 2. Competing worker transitions job to RESERVED before operator mutation executes
    const existing = pool.getQueueRecords().find((r: any) => r.id === "mock-race-job-1");
    existing.status = "RESERVED";
    existing.reservation_id = "worker-res-777";
    existing.attempts = 1;
    pool.seedQueueRecord(existing);

    // 3. Operator promotion attempts mutation
    const res = await promoteCatalogueEntity(
      {
        externalReferenceId: "ChIJ11111111111111111111111",
        billingTier: "PRO",
        purpose: "Race Condition Test",
        reason: "Attempting to reset in-flight worker job",
        originatingProduct: "resources",
        actorId: "operator-race-test",
      },
      pool
    );

    assert.equal(res.success, false);
    assert.equal(res.reason, "ALREADY_IN_PROGRESS");
    assert.match(res.message, /already in progress/i);

    const finalJob = pool.getQueueRecords().find((r: any) => r.id === "mock-race-job-1");
    assert.equal(finalJob.status, "RESERVED", "Row must remain RESERVED");
    assert.equal(finalJob.reservation_id, "worker-res-777", "Reservation ID must remain intact");
    assert.equal(finalJob.attempts, 1, "Attempts must remain intact");
    assert.equal(pool.getAuditRecords().length, 0, "No promotion audit should be persisted when race is rejected");
  });

  await t.test("6. RESERVED remains RESERVED", async () => {
    const pool = createMockPool();
    pool.seedQueueRecord({
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
        actorId: "test-operator",
      },
      pool
    );
    assert.equal(res.success, false);
    assert.equal(res.reason, "ALREADY_IN_PROGRESS");
    assert.match(res.message, /already in progress/i);

    const check = pool.getQueueRecords().find((r: any) => r.id === "mock-reserved-1");
    assert.equal(check.status, "RESERVED");
  });

  await t.test("7. IN_PROGRESS remains IN_PROGRESS", async () => {
    const pool = createMockPool();
    pool.seedQueueRecord({
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
        actorId: "test-operator",
      },
      pool
    );
    assert.equal(res.success, false);
    assert.equal(res.reason, "ALREADY_IN_PROGRESS");

    const check = pool.getQueueRecords().find((r: any) => r.id === "mock-in-progress-1");
    assert.equal(check.status, "IN_PROGRESS");
  });

  await t.test("8. COMPLETED/evidence-available job does not recreate spend", async () => {
    const pool = createMockPool();
    pool.seedQueueRecord({
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
        actorId: "test-operator",
      },
      pool
    );
    assert.equal(res.success, false);
    assert.equal(res.reason, "EVIDENCE_ALREADY_AVAILABLE");
    assert.match(res.message, /Existing evidence/);
  });

  await t.test("9. BLOCKED remains blocked", async () => {
    const pool = createMockPool();
    pool.seedQueueRecord({
      id: "mock-blocked-1",
      provider: "google_places",
      external_reference_id: "ChIJ11111111111111111111111",
      billing_tier: "PRO",
      status: "BLOCKED",
      attempts: 2,
    });

    const res = await promoteCatalogueEntity(
      {
        externalReferenceId: "ChIJ11111111111111111111111",
        billingTier: "PRO",
        purpose: "Attempt override on blocked",
        reason: "Should be refused",
        originatingProduct: "resources",
        actorId: "test-operator",
      },
      pool
    );
    assert.equal(res.success, false);
    assert.equal(res.reason, "JOB_BLOCKED");
    assert.match(res.message, /blocked/i);

    const check = pool.getQueueRecords().find((r: any) => r.id === "mock-blocked-1");
    assert.equal(check.status, "BLOCKED");
  });

  await t.test("10. mutable WAITING/QUEUED/DEFERRED state can be safely reprioritized", async () => {
    const pool = createMockPool();
    // 1. Initial creation
    const res1 = await promoteCatalogueEntity(
      {
        externalReferenceId: "ChIJ11111111111111111111111",
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

    // 2. Safe reprioritization/update of existing WAITING_FOR_MONTHLY_BUDGET job
    const res2 = await promoteCatalogueEntity(
      {
        externalReferenceId: "ChIJ11111111111111111111111",
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

    const check = pool.getQueueRecords().find((r: any) => r.id === initialQueueId);
    assert.match(check.evidence_gap_reason, /Updated Intent/);
    assert.equal(check.originating_product, "commercial_engine");
    assert.equal(check.attempts, 0, "Attempts must be preserved");

    // Two audit records created: initial and update
    const audits = pool.getAuditRecords();
    assert.equal(audits.length, 2);
    assert.equal(audits[0].actor_id, "operator-1");
    assert.equal(audits[1].actor_id, "operator-2");
    assert.equal(audits[1].previous_state, "WAITING_FOR_MONTHLY_BUDGET");
  });

  await t.test("11. actor ID durable in audit", async () => {
    const pool = createMockPool();
    const testActorId = "operator-audit-test-actor-" + Date.now();

    const res = await promoteCatalogueEntity(
      {
        externalReferenceId: "ChIJ11111111111111111111111",
        billingTier: "PRO",
        purpose: "Audit Trail Verification",
        reason: "Ensuring actor audit logging",
        originatingProduct: "resources",
        actorId: testActorId,
      },
      pool
    );
    assert.equal(res.success, true);

    const audits = pool.getAuditRecords();
    assert.equal(audits.length, 1);
    const auditRow = audits[0];
    assert.equal(auditRow.actor_id, testActorId);
    assert.equal(auditRow.source_type, "paid_enrichment_queue");
    assert.equal(auditRow.source_id, res.queueId);
    assert.equal(auditRow.action, "PROMOTE_PRO");
    assert.equal(auditRow.new_state, "WAITING_FOR_MONTHLY_BUDGET");
    assert.equal(auditRow.payload_diff.actor_id, testActorId);
    assert.equal(auditRow.payload_diff.purpose, "Audit Trail Verification");
  });

  await t.test("12. missing actor rejected for real promotion path", async () => {
    const pool = createMockPool();
    const resNoActor = await promoteCatalogueEntity(
      {
        externalReferenceId: "ChIJ11111111111111111111111",
        billingTier: "PRO",
        purpose: "Testing missing actor",
        reason: "Valid reason",
        originatingProduct: "resources",
        actorId: "",
      },
      pool
    );
    assert.equal(resNoActor.success, false);
    assert.equal(resNoActor.reason, "ACTOR_REQUIRED");
    assert.match(resNoActor.message, /Actor ID is required/i);

    const resWhitespace = await promoteCatalogueEntity(
      {
        externalReferenceId: "ChIJ11111111111111111111111",
        billingTier: "PRO",
        purpose: "Testing whitespace actor",
        reason: "Valid reason",
        originatingProduct: "resources",
        actorId: "    ",
      },
      pool
    );
    assert.equal(resWhitespace.success, false);
    assert.equal(resWhitespace.reason, "ACTOR_REQUIRED");

    // Route level check
    const routeSource = readFileSync("app/api/operator/catalogue/route.ts", "utf8");
    assert.ok(routeSource.includes('!access.userId || !access.userId.trim()'));
    assert.ok(routeSource.includes('code: "ACTOR_REQUIRED"'));
  });

  await t.test("13. test mutation against production project ref is rejected before SQL mutation", async () => {
    assert.equal(
      isProductionDatabaseUrl(`postgresql://postgres.${PRODUCTION_PROJECT_REF}:secret@pooler.supabase.com:5432/postgres`),
      true
    );

    // Verify assertSafeMutationTarget throws MUTATION_BLOCKED
    assert.throws(
      () => assertSafeMutationTarget(`postgresql://postgres.${PRODUCTION_PROJECT_REF}:secret@pooler.supabase.com:5432/postgres`),
      /MUTATION_BLOCKED/
    );

    // Verify promoteCatalogueEntity rejects before SQL mutation
    let sqlDispatched = false;
    const prodPoolStub = {
      options: {
        connectionString: `postgresql://postgres.${PRODUCTION_PROJECT_REF}:secret@pooler.supabase.com:5432/postgres`,
      },
      query: async () => {
        sqlDispatched = true;
        throw new Error("SHOULD_NOT_EXECUTE_SQL");
      },
      connect: async () => {
        sqlDispatched = true;
        throw new Error("SHOULD_NOT_CONNECT");
      },
    };

    await assert.rejects(
      async () => {
        await promoteCatalogueEntity(
          {
            externalReferenceId: "ChIJ11111111111111111111111",
            billingTier: "PRO",
            purpose: "Attempt mutation against production",
            reason: "Must be blocked",
            originatingProduct: "resources",
            actorId: "attacker-or-test",
          },
          prodPoolStub
        );
      },
      /MUTATION_BLOCKED/
    );
    assert.equal(sqlDispatched, false, "Zero SQL queries must be dispatched to production during test execution");
  });

  await t.test("14. provider calls = 0", () => {
    assert.equal(externalNetworkCalls, 0, "Strict cost rule: 0 external provider or crawler calls dispatched");
  });

  await t.test("15. duplicate concurrent promotion requests do not create duplicate jobs", async () => {
    const pool = createMockPool();
    const [resA, resB] = await Promise.all([
      promoteCatalogueEntity(
        {
          externalReferenceId: "ChIJ11111111111111111111111",
          billingTier: "PRO",
          purpose: "Concurrent promotion A",
          reason: "Request A",
          originatingProduct: "resources",
          actorId: "operator-A",
        },
        pool
      ),
      promoteCatalogueEntity(
        {
          externalReferenceId: "ChIJ11111111111111111111111",
          billingTier: "PRO",
          purpose: "Concurrent promotion B",
          reason: "Request B",
          originatingProduct: "resources",
          actorId: "operator-B",
        },
        pool
      ),
    ]);

    assert.equal(resA.success, true);
    assert.equal(resB.success, true);
    assert.equal(resA.queueId, resB.queueId, "Duplicate concurrent promotions must resolve to the same unique queue job");

    const queueRecords = pool.getQueueRecords();
    const matchingJobs = queueRecords.filter(
      (r: any) => r.external_reference_id === "ChIJ11111111111111111111111" && r.billing_tier === "PRO"
    );
    assert.equal(matchingJobs.length, 1, "Exactly one unique queue job must exist in the queue");
  });

  await t.test("16. missing Pro reason rejected (400 REASON_REQUIRED)", async () => {
    const pool = createMockPool();
    const res = await promoteCatalogueEntity(
      {
        externalReferenceId: "ChIJ11111111111111111111111",
        billingTier: "PRO",
        purpose: "Commercial Evaluation",
        reason: "   ",
        originatingProduct: "resources",
        actorId: "test-operator",
      },
      pool
    );
    assert.equal(res.success, false);
    assert.equal(res.reason, "REASON_REQUIRED");

    const routeSource = readFileSync("app/api/operator/catalogue/route.ts", "utf8");
    assert.ok(routeSource.includes('code: "REASON_REQUIRED"'));
    assert.ok(routeSource.includes('!reason || !reason.trim()'));
  });

  await t.test("17. missing Enterprise evidence gap rejected (400 EVIDENCE_GAP_REQUIRED)", async () => {
    const pool = createMockPool();
    const res = await promoteCatalogueEntity(
      {
        externalReferenceId: "ChIJ11111111111111111111111",
        billingTier: "ENTERPRISE",
        purpose: "Enterprise Assessment",
        reason: "Valid reason",
        evidenceGapReason: "   ",
        originatingProduct: "venue_management",
        actorId: "test-operator",
      },
      pool
    );
    assert.equal(res.success, false);
    assert.equal(res.reason, "EVIDENCE_GAP_REQUIRED");

    const routeSource = readFileSync("app/api/operator/catalogue/route.ts", "utf8");
    assert.ok(routeSource.includes('code: "EVIDENCE_GAP_REQUIRED"'));
    assert.ok(routeSource.includes('!evidenceGapReason || !evidenceGapReason.trim()'));
  });

  await t.test("18. invalid provider ID blocked", async () => {
    const pool = createMockPool();
    const malformed = await promoteCatalogueEntity(
      {
        externalReferenceId: "ChIJ_invalid_short",
        billingTier: "PRO",
        purpose: "Test",
        reason: "Testing malformed ID block",
        originatingProduct: "resources",
        actorId: "test-operator",
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
          actorId: "test-operator",
        },
        pool
      );
      assert.equal(res.success, false);
      assert.equal(res.reason, "INVALID_PROVIDER_REFERENCE");
    }
  });

  await t.test("19. unauthenticated Catalogue API denied (401)", () => {
    const routeSource = readFileSync("app/api/operator/catalogue/route.ts", "utf8");
    const operatorRouteSource = readFileSync("app/api/operator/route.ts", "utf8");

    // In production, ALLOW_LOCAL_OPERATOR must never activate
    assert.ok(routeSource.includes('process.env.NODE_ENV !== "production" && process.env.ALLOW_LOCAL_OPERATOR === "true"'));
    assert.ok(operatorRouteSource.includes('process.env.NODE_ENV !== "production" && process.env.ALLOW_LOCAL_OPERATOR === "true"'));

    // Unauthenticated caller receives 401
    assert.ok(routeSource.includes('{ status: 401 }'));
    assert.ok(operatorRouteSource.includes('{ status: 401 }'));
  });

  await t.test("20. viewer cannot promote (403)", () => {
    const routeSource = readFileSync("app/api/operator/catalogue/route.ts", "utf8");
    assert.ok(routeSource.includes('access.access !== "OPERATOR" && access.access !== "ADMIN"'));
    assert.ok(routeSource.includes('{ status: 403 }'));
    assert.ok(routeSource.includes('Operator permission required for catalogue actions'));
  });

  await t.test("21. atmosphere promotion refused (tier disabled)", async () => {
    const pool = createMockPool();
    const res = await promoteCatalogueEntity(
      {
        externalReferenceId: "ChIJ11111111111111111111111",
        billingTier: "ENTERPRISE_ATMOSPHERE" as any,
        purpose: "Atmosphere test",
        reason: "Testing disabled tier",
        originatingProduct: "resources",
        actorId: "test-operator",
      },
      pool
    );
    assert.equal(res.success, false);
    assert.equal(res.reason, "INVALID_BILLING_TIER");
  });

  await t.test("22. category-aware profile and routing verification", async () => {
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

  await t.test("23. saved-view live count parity (9743, 2923, 17922, 17944, 210, 5367, 1078, 21468)", async () => {
    const pool = getPool();
    const countChecks: [string, any, number][] = [
      ["All Entities", {}, 21468],
      ["Resources Ready", { resourcesRoute: "STRONG_FIT" }, 9743],
      ["Event Businesses", { eventBusinessRoute: "STRONG_FIT" }, 2923],
      ["Commercial Possible", { commercialProspectingRoute: "POSSIBLE_FIT" }, 17922],
      ["Needs Identity Review", { canonicalIdentityState: "UNRESOLVED" }, 17944],
      ["Owner Confirmed", { ownerConfirmationRoute: "STRONG_FIT" }, 210],
      ["Web Verification Queue", { researchDisposition: "FIRST_PARTY_WEB_VERIFICATION" }, 5367],
      ["Blocked / Invalid Place ID", { isInvalidReference: true }, 1078],
    ];

    for (const [name, filter, expectedCount] of countChecks) {
      const q = buildCatalogueCountQuery(filter);
      const res = await pool.query(q.text, q.values);
      const total = Number(res.rows[0]?.total ?? res.rows[0]?.count ?? 0);
      assert.equal(total, expectedCount, `Saved view '${name}' count must be exactly ${expectedCount}, got ${total}`);
    }
  });
});
