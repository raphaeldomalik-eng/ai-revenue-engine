import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { executeSourceDiscoveryRequest, InMemoryNexusResultStore, SOURCE_DISCOVERY_EXECUTION_VERSION, sourceDiscoveryReplayable } from "../src/nexus/executor.ts";
import { CONTRACTS } from "../src/nexus/contracts.ts";
import { crawlVerifiedSource } from "../src/nexus/source-discovery/crawler.ts";

const ids = {
  discoveryRequestId: "44444444-4444-4444-8444-444444444444",
  idempotencyKey: "22222222-2222-4222-8222-222222222222",
  correlationId: "33333333-3333-4333-8333-333333333333",
};
const budget = { maxPages: 1, maxRequests: 6, maxBytesPerResponse: 100000, maxRedirects: 2, maxRetries: 0, timeoutMs: 1000, minRequestDelayMs: 0 };
const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

function discovery(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: CONTRACTS.SOURCE_DISCOVERY_REQUEST,
    discoveryRequestId: ids.discoveryRequestId,
    idempotencyKey: ids.idempotencyKey,
    correlationId: ids.correlationId,
    originatingProduct: "event_suite_resources",
    subjectReference: { canonicalEntityId: null, candidateReference: { sourceSystem: "event_suite_resources", sourceRecordId: "Example Venue" }, entityType: "UNKNOWN" },
    verifiedSourceUrl: "https://venue.org/",
    requestedExtractors: ["SOURCE_CLASSIFICATION"],
    freshnessRequirements: { maxAgeHours: 24 },
    crawlBudget: budget,
    existingEvidenceRefs: [],
    requestedBy: { actorType: "PRODUCT", actorId: "resources" },
    createdAt: "2026-09-21T00:00:00Z",
    ...overrides,
  };
}

function page(body = "<html><title>Example Venue</title></html>") {
  return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
}

test("robots.txt follows one same-origin HTTPS redirect and then parses the allow rules", async () => {
  const requested: string[] = [];
  const resolutions: string[] = [];
  const result = await crawlVerifiedSource({
    verifiedUrl: "https://venue.org/",
    requestedExtractors: ["SOURCE_CLASSIFICATION"],
    budget,
    resolveHost: async (host) => {
      resolutions.push(host);
      return [{ address: "93.184.216.34", family: 4 }];
    },
    fetchImpl: async (input, init) => {
      const url = String(input);
      requested.push(url);
      assert.equal(init?.redirect, "manual");
      if (url === "https://venue.org/robots.txt") {
        return new Response(null, { status: 301, headers: { location: "/robots-live.txt" } });
      }
      if (url === "https://venue.org/robots-live.txt") return new Response("User-agent: *\nDisallow: /private\nAllow: /\n");
      if (url === "https://venue.org/") return page();
      return new Response("no", { status: 404 });
    },
  });
  assert.deepEqual(requested, [
    "https://venue.org/robots.txt",
    "https://venue.org/robots-live.txt",
    "https://venue.org/",
  ]);
  assert.equal(resolutions.filter((host) => host === "venue.org").length >= 3, true);
  assert.equal(result.stats.redirects, 1);
  assert.equal(result.stats.status, "COMPLETED");
  assert.equal(result.documents.length, 1);
  assert.equal(result.stats.failureClass, undefined);
});

test("robots redirects fail closed for missing, cross-origin, downgrade, credential, and private targets", async () => {
  const cases = [
    { location: null, host: "venue.org" },
    { location: "https://other.org/robots.txt", host: "venue.org" },
    { location: "http://venue.org/robots.txt", host: "venue.org" },
    { location: "https://user:pass@venue.org/robots.txt", host: "venue.org" },
  ];
  for (const item of cases) {
    const requested: string[] = [];
    const result = await crawlVerifiedSource({
      verifiedUrl: "https://venue.org/",
      requestedExtractors: ["SOURCE_CLASSIFICATION"],
      budget,
      resolveHost: publicResolver,
      fetchImpl: async (input) => {
        requested.push(String(input));
        return new Response(null, { status: 301, headers: item.location ? { location: item.location } : {} });
      },
    });
    assert.equal(result.stats.status, "BLOCKED");
    assert.equal(result.stats.failureClass, "TERMINAL");
    assert.equal(result.documents.length, 0);
    assert.equal(requested.includes("https://venue.org/"), false);
    assert.equal(requested.some((url) => url.includes("other.org") || url.startsWith("http://")), false);
  }

  let lookups = 0;
  const privateRedirect = await crawlVerifiedSource({
    verifiedUrl: "https://venue.org/",
    requestedExtractors: ["SOURCE_CLASSIFICATION"],
    budget,
    resolveHost: async () => {
      lookups += 1;
      return lookups === 1
        ? [{ address: "93.184.216.34", family: 4 }]
        : [{ address: "10.1.1.1", family: 4 }];
    },
    fetchImpl: async (input) => String(input).endsWith("/robots.txt")
      ? new Response(null, { status: 302, headers: { location: "/robots-live.txt" } })
      : page(),
  });
  assert.equal(privateRedirect.stats.status, "BLOCKED");
  assert.equal(privateRedirect.stats.failureClass, "TERMINAL");
  assert.equal(privateRedirect.documents.length, 0);

  const bounded = await crawlVerifiedSource({
    verifiedUrl: "https://venue.org/",
    requestedExtractors: ["SOURCE_CLASSIFICATION"],
    budget: { ...budget, maxRedirects: 0 },
    resolveHost: publicResolver,
    fetchImpl: async () => new Response(null, { status: 308, headers: { location: "/robots-live.txt" } }),
  });
  assert.equal(bounded.stats.failureClass, "TERMINAL");
  assert.match(bounded.stats.warnings.join("\n"), /Redirect budget exhausted/);
});

test("an explicit robots disallow is replayed and a retryable robots failure runs again", async () => {
  const store = new InMemoryNexusResultStore();
  let mode = "disallow";
  let calls = 0;
  const fetchImpl = async (input: RequestInfo | URL) => {
    calls += 1;
    const url = String(input);
    if (url.endsWith("/robots.txt")) {
      if (mode === "disallow") return new Response("User-agent: *\nDisallow: /");
      if (mode === "retry") return new Response("unavailable", { status: 503 });
      return new Response("User-agent: *\nAllow: /");
    }
    return page();
  };
  const blocked = await executeSourceDiscoveryRequest(discovery(), { resolveHost: publicResolver, fetchImpl }, store) as { crawl: { status: string; retryable: boolean } };
  assert.equal(blocked.crawl.status, "BLOCKED");
  assert.equal(blocked.crawl.retryable, false);
  const blockedCalls = calls;
  const replayed = await executeSourceDiscoveryRequest(discovery(), { resolveHost: publicResolver, fetchImpl }, store) as { crawl: { status: string } };
  assert.equal(replayed.crawl.status, "BLOCKED");
  assert.equal(calls, blockedCalls);

  mode = "retry";
  const retryStore = new InMemoryNexusResultStore();
  calls = 0;
  const failed = await executeSourceDiscoveryRequest(discovery(), { resolveHost: publicResolver, fetchImpl }, retryStore) as { crawl: { status: string; retryable: boolean } };
  assert.equal(failed.crawl.status, "FAILED");
  assert.equal(failed.crawl.retryable, true);
  const failedCalls = calls;
  mode = "ok";
  const recovered = await executeSourceDiscoveryRequest(discovery(), { resolveHost: publicResolver, fetchImpl }, retryStore) as { crawl: { status: string; retryable: boolean } };
  assert.equal(["COMPLETED", "PARTIAL"].includes(recovered.crawl.status), true);
  assert.equal(recovered.crawl.retryable, false);
  assert.equal(calls > failedCalls, true);
  const recoveredCalls = calls;
  const stable = await executeSourceDiscoveryRequest(discovery(), { resolveHost: publicResolver, fetchImpl }, retryStore);
  assert.equal(calls, recoveredCalls);
  assert.equal(stable, recovered);
});

test("a legacy blocked source-discovery result without retry disposition is not replayed", async () => {
  const store = new InMemoryNexusResultStore();
  const legacy = {
    contractVersion: CONTRACTS.SOURCE_DISCOVERY_RESULT,
    crawl: { status: "BLOCKED", warnings: ["robots.txt could not be checked: robots.txt returned HTTP 301"] },
  };
  assert.equal(sourceDiscoveryReplayable(legacy), false);
  await store.set(ids.idempotencyKey, legacy);
  let calls = 0;
  const result = await executeSourceDiscoveryRequest(discovery(), {
    resolveHost: publicResolver,
    fetchImpl: async (input) => {
      calls += 1;
      return String(input).endsWith("/robots.txt")
        ? new Response(null, { status: 301, headers: { location: "/robots-live.txt" } })
        : String(input).endsWith("/robots-live.txt")
          ? new Response("User-agent: *\nAllow: /")
          : page();
    },
  }, store) as { crawl: { status: string; retryable: boolean } };
  assert.equal(calls >= 3, true);
  assert.equal(result.crawl.retryable, false);
  assert.notEqual(result.crawl.status, "BLOCKED");
});

test("a legacy completed source-discovery result is replayed and research execution version stays v6", async () => {
  const store = new InMemoryNexusResultStore();
  const legacy = { crawl: { status: "COMPLETED", retryable: false }, idempotencyKey: ids.idempotencyKey };
  assert.equal(sourceDiscoveryReplayable(legacy), true);
  await store.set(ids.idempotencyKey, legacy);
  let calls = 0;
  const result = await executeSourceDiscoveryRequest(discovery(), {
    resolveHost: publicResolver,
    fetchImpl: async () => { calls += 1; return page(); },
  }, store);
  assert.equal(result, legacy);
  assert.equal(calls, 0);
  assert.equal(SOURCE_DISCOVERY_EXECUTION_VERSION, "resources-v2-source-discovery-v4");
  const route = readFileSync(new URL("../app/api/integrations/nexus/execute/route.ts", import.meta.url), "utf8");
  assert.match(route, /researchExecutionVersion:\s*"resources-v2-unclassified-evidence-v6"/);
  assert.match(route, /nexusExecutorDisabled\(\)/);
  assert.match(route, /NEXUS_EXECUTOR_NOT_AVAILABLE/);
  assert.equal(route.includes("resources-v2-source-discovery-v4"), false);
  assert.equal(route.includes("resources-v2-source-discovery-v3"), false);
});
