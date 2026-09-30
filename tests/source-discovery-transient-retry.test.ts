import assert from "node:assert/strict";
import test from "node:test";
import { CONTRACTS } from "../src/nexus/contracts.ts";
import { executeSourceDiscoveryRequest, InMemoryNexusResultStore } from "../src/nexus/executor.ts";
import { crawlVerifiedSource } from "../src/nexus/source-discovery/crawler.ts";
import { classifyTransportFailure, DiscoveryTimeout } from "../src/nexus/source-discovery/network.ts";
import { OriginPoliteness } from "../src/nexus/source-discovery/politeness.ts";
import type { CrawlBudget, CrawlInput, FetchLike, ResolveHost } from "../src/nexus/source-discovery/types.ts";

const budget: CrawlBudget = { maxPages: 1, maxRequests: 8, maxBytesPerResponse: 100_000, maxRedirects: 2, maxRetries: 1, timeoutMs: 1_000, minRequestDelayMs: 0 };
const PUBLIC = [{ address: "93.184.216.34", family: 4 }];
const ALLOW = "User-agent: *\nAllow: /\n";

function nodeError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function page(body = "<html><title>Example Venue</title><p>Example Venue hire</p></html>") {
  return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
}

function run(overrides: Partial<CrawlInput>) {
  const sleeps: number[] = [];
  const promise = crawlVerifiedSource({
    verifiedUrl: "https://venue.example/",
    requestedExtractors: ["SOURCE_CLASSIFICATION"],
    budget,
    resolveHost: async () => PUBLIC,
    politeness: new OriginPoliteness({ sleep: async () => undefined }),
    sleep: async (ms) => { sleeps.push(ms); },
    ...overrides,
  });
  return { promise, sleeps };
}

function siteFetch(requested: string[], extra: Record<string, () => Response | Promise<Response>> = {}): FetchLike {
  return async (input) => {
    const url = String(input);
    requested.push(url);
    if (extra[url]) return extra[url]!();
    if (url.endsWith("/robots.txt")) return new Response(ALLOW);
    return page();
  };
}

test("DNS EBUSY on the first resolution is retried and the crawl succeeds", async () => {
  let lookups = 0;
  const resolveHost: ResolveHost = async (host) => {
    lookups += 1;
    if (lookups === 1) throw nodeError("EBUSY", `getaddrinfo EBUSY ${host}`);
    return PUBLIC;
  };
  const requested: string[] = [];
  const { promise, sleeps } = run({ resolveHost, fetchImpl: siteFetch(requested) });
  const result = await promise;
  assert.equal(result.stats.status, "COMPLETED");
  assert.equal(result.stats.failureClass, undefined);
  assert.equal(result.stats.retries, 1);
  assert.equal(result.documents.length, 1);
  assert.deepEqual(requested, ["https://venue.example/robots.txt", "https://venue.example/"]);
  assert.equal(result.stats.requestCount, 3);
  assert.deepEqual(sleeps, [250]);
});

test("a transient failure while retrieving robots.txt is retried instead of ending the crawl", async () => {
  let robotsAttempts = 0;
  const requested: string[] = [];
  const { promise } = run({
    fetchImpl: siteFetch(requested, {
      "https://venue.example/robots.txt": () => {
        robotsAttempts += 1;
        if (robotsAttempts === 1) throw nodeError("EAI_AGAIN", "getaddrinfo EAI_AGAIN venue.example");
        return new Response(ALLOW);
      },
    }),
  });
  const result = await promise;
  assert.equal(robotsAttempts, 2);
  assert.equal(result.stats.status, "COMPLETED");
  assert.equal(result.observability?.robots[0]?.status, "FETCHED");
});

test("a transient failure during normal page retrieval is retried", async () => {
  let pageAttempts = 0;
  const requested: string[] = [];
  const { promise } = run({
    fetchImpl: siteFetch(requested, {
      "https://venue.example/": () => {
        pageAttempts += 1;
        if (pageAttempts === 1) throw nodeError("ECONNRESET", "socket hang up");
        return page();
      },
    }),
  });
  const result = await promise;
  assert.equal(pageAttempts, 2);
  assert.equal(result.stats.status, "COMPLETED");
  assert.equal(result.stats.retries, 1);
});

test("transient retries stay within maxRetries and an exhausted transient failure remains retryable", async () => {
  let lookups = 0;
  const resolveHost: ResolveHost = async (host) => { lookups += 1; throw nodeError("EBUSY", `getaddrinfo EBUSY ${host}`); };
  const requested: string[] = [];
  const { promise } = run({ resolveHost, fetchImpl: siteFetch(requested), budget: { ...budget, maxRetries: 2 } });
  const result = await promise;
  assert.equal(lookups, 3);
  assert.equal(result.stats.retries, 2);
  assert.equal(result.stats.requestCount, 3);
  assert.equal(requested.length, 0);
  assert.equal(result.stats.status, "FAILED");
  assert.equal(result.stats.failureClass, "RETRYABLE");
  assert.equal(result.observability?.stopReason, "ROBOTS_UNAVAILABLE");
  assert.match(result.stats.warnings.join("\n"), /getaddrinfo EBUSY venue\.example/);
});

test("transient retries never exceed the request budget and budget exhaustion keeps the failure retryable", async () => {
  let lookups = 0;
  const resolveHost: ResolveHost = async (host) => { lookups += 1; throw nodeError("EBUSY", `getaddrinfo EBUSY ${host}`); };
  const { promise } = run({ resolveHost, fetchImpl: siteFetch([]), budget: { ...budget, maxRetries: 5, maxRequests: 2 } });
  const result = await promise;
  assert.equal(lookups, 2);
  assert.equal(result.stats.requestCount, 2);
  assert.equal(result.stats.retries, 1);
  assert.equal(result.stats.failureClass, "RETRYABLE");
});

test("the pinned production path retries a resolver EBUSY within maxRetries without any socket", async () => {
  let lookups = 0;
  const resolveHost: ResolveHost = async (host) => { lookups += 1; throw nodeError("EBUSY", `getaddrinfo EBUSY ${host}`); };
  const { promise } = run({ resolveHost, fetchImpl: undefined, budget: { ...budget, maxRetries: 1 } });
  const result = await promise;
  assert.equal(lookups, 2);
  assert.equal(result.stats.retries, 1);
  assert.equal(result.stats.failureClass, "RETRYABLE");
  assert.equal(result.stats.status, "FAILED");
});

test("a timeout is retried within the bound and stays retryable when exhausted", async () => {
  let attempts = 0;
  const { promise } = run({
    budget: { ...budget, timeoutMs: 20, maxRetries: 1 },
    fetchImpl: siteFetch([], { "https://venue.example/robots.txt": () => { attempts += 1; return new Promise<Response>(() => undefined); } }),
  });
  const result = await promise;
  assert.equal(attempts, 2);
  assert.equal(result.stats.failureClass, "RETRYABLE");
  assert.match(result.stats.warnings.join("\n"), /timed out/);
});

test("a self-signed or untrusted certificate is terminal and is never retried", async () => {
  for (const error of [
    nodeError("DEPTH_ZERO_SELF_SIGNED_CERT", "self-signed certificate; if the root CA is installed locally, try running Node.js with --use-system-ca"),
    nodeError("UNABLE_TO_VERIFY_LEAF_SIGNATURE", "unable to verify the first certificate"),
    nodeError("CERT_HAS_EXPIRED", "certificate has expired"),
    nodeError("ERR_TLS_CERT_ALTNAME_INVALID", "Hostname/IP does not match certificate's altnames"),
  ]) {
    let attempts = 0;
    const { promise } = run({
      budget: { ...budget, maxRetries: 3 },
      fetchImpl: siteFetch([], { "https://venue.example/robots.txt": () => { attempts += 1; throw error; } }),
    });
    const result = await promise;
    assert.equal(attempts, 1, error.message);
    assert.equal(result.stats.retries, 0);
    assert.equal(result.stats.status, "BLOCKED");
    assert.equal(result.stats.failureClass, "TERMINAL");
  }
});

test("the executor stores an exhausted DNS failure as retryable and a certificate failure as terminal", async () => {
  const request = {
    contractVersion: CONTRACTS.SOURCE_DISCOVERY_REQUEST,
    discoveryRequestId: "44444444-4444-4444-8444-444444444444",
    idempotencyKey: "22222222-2222-4222-8222-222222222222",
    correlationId: "33333333-3333-4333-8333-333333333333",
    originatingProduct: "event_suite_resources",
    subjectReference: { canonicalEntityId: null, candidateReference: { sourceSystem: "event_suite_resources", sourceRecordId: "Example Venue" }, entityType: "UNKNOWN" },
    verifiedSourceUrl: "https://venue.example/",
    requestedExtractors: ["SOURCE_CLASSIFICATION"],
    freshnessRequirements: { maxAgeHours: 24 },
    crawlBudget: { ...budget, maxRetries: 0 },
    existingEvidenceRefs: [],
    requestedBy: { actorType: "PRODUCT", actorId: "resources" },
    createdAt: "2026-09-21T00:00:00Z",
  };
  const dns = await executeSourceDiscoveryRequest(request, {
    resolveHost: async (host) => { throw nodeError("EBUSY", `getaddrinfo EBUSY ${host}`); },
    fetchImpl: siteFetch([]),
  }, new InMemoryNexusResultStore()) as { crawl: { status: string; retryable: boolean } };
  assert.equal(dns.crawl.status, "FAILED");
  assert.equal(dns.crawl.retryable, true);
  const cert = await executeSourceDiscoveryRequest(request, {
    resolveHost: async () => PUBLIC,
    fetchImpl: async () => { throw nodeError("DEPTH_ZERO_SELF_SIGNED_CERT", "self-signed certificate"); },
  }, new InMemoryNexusResultStore()) as { crawl: { status: string; retryable: boolean } };
  assert.equal(cert.crawl.status, "BLOCKED");
  assert.equal(cert.crawl.retryable, false);
});

test("a cross-site redirect stays refused, is never fetched, and retains only the refused host", async () => {
  const requested: string[] = [];
  const { promise } = run({
    fetchImpl: siteFetch(requested, { "https://venue.example/": () => new Response(null, { status: 301, headers: { location: "https://other-site.example/landing?token=secret" } }) }),
  });
  const result = await promise;
  assert.equal(result.stats.status, "BLOCKED");
  assert.equal(result.stats.failureClass, "TERMINAL");
  assert.equal(requested.some((url) => url.includes("other-site.example")), false);
  const warning = result.stats.warnings.join("\n");
  assert.match(warning, /CROSS_SITE; refused host other-site\.example/);
  assert.equal(warning.includes("token=secret"), false);

  const robotsRequested: string[] = [];
  const robots = await run({
    fetchImpl: siteFetch(robotsRequested, { "https://venue.example/robots.txt": () => new Response(null, { status: 302, headers: { location: "https://elsewhere.example/robots.txt" } }) }),
  }).promise;
  assert.equal(robots.stats.status, "BLOCKED");
  assert.equal(robots.stats.failureClass, "TERMINAL");
  assert.equal(robotsRequested.some((url) => url.includes("elsewhere.example")), false);
  assert.match(robots.stats.warnings.join("\n"), /CROSS_SITE; refused host elsewhere\.example/);
});

test("apex to www canonical redirects are still followed", async () => {
  const requested: string[] = [];
  const { promise } = run({
    fetchImpl: siteFetch(requested, { "https://venue.example/": () => new Response(null, { status: 301, headers: { location: "https://www.venue.example/" } }) }),
  });
  const result = await promise;
  assert.equal(result.stats.status, "COMPLETED");
  assert.equal(result.canonicalOrigin, "https://www.venue.example");
  assert.equal(result.finalUrl, "https://www.venue.example/");
  assert.ok(requested.includes("https://www.venue.example/"));
});

test("transport failures are classified without ever treating certificate trust as transient", () => {
  assert.equal(classifyTransportFailure(nodeError("EBUSY", "getaddrinfo EBUSY a.example")), "TRANSIENT");
  assert.equal(classifyTransportFailure(nodeError("EAI_AGAIN", "getaddrinfo EAI_AGAIN a.example")), "TRANSIENT");
  assert.equal(classifyTransportFailure(nodeError("ETIMEDOUT", "connect ETIMEDOUT")), "TRANSIENT");
  assert.equal(classifyTransportFailure(nodeError("ECONNRESET", "socket hang up")), "TRANSIENT");
  assert.equal(classifyTransportFailure(nodeError("EPROTO", "write EPROTO error:0A000410:SSL routines:ssl3_read_bytes:ssl/tls alert handshake failure")), "TRANSIENT");
  assert.equal(classifyTransportFailure(new DiscoveryTimeout()), "TRANSIENT");
  assert.equal(classifyTransportFailure(nodeError("DEPTH_ZERO_SELF_SIGNED_CERT", "self-signed certificate")), "CERTIFICATE");
  assert.equal(classifyTransportFailure(nodeError("SELF_SIGNED_CERT_IN_CHAIN", "self-signed certificate in certificate chain")), "CERTIFICATE");
  assert.equal(classifyTransportFailure(nodeError("UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "unable to get local issuer certificate")), "CERTIFICATE");
  assert.equal(classifyTransportFailure(nodeError("CERT_HAS_EXPIRED", "certificate has expired")), "CERTIFICATE");
  assert.equal(classifyTransportFailure(nodeError("ERR_TLS_CERT_ALTNAME_INVALID", "Hostname/IP does not match certificate's altnames")), "CERTIFICATE");
  assert.equal(classifyTransportFailure(new Error("self-signed certificate")), "CERTIFICATE");
  assert.equal(classifyTransportFailure(nodeError("ENOTFOUND", "getaddrinfo ENOTFOUND a.example")), "OTHER");
});
