import assert from "node:assert/strict";
import test from "node:test";
import { CONTRACTS } from "../src/nexus/contracts.ts";
import { executeSourceDiscoveryRequest, InMemoryNexusResultStore, sourceDiscoveryExecutionKey, SOURCE_DISCOVERY_EXECUTION_VERSION, venueEmailAcquisitionRequested } from "../src/nexus/executor.ts";

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];
const budget = { maxPages: 4, maxRequests: 12, maxBytesPerResponse: 100000, maxRedirects: 2, maxRetries: 0, timeoutMs: 1000, minRequestDelayMs: 0 };
const venueSubject = { canonicalEntityId: null, candidateReference: { sourceSystem: "event_suite_resources", sourceRecordId: "Example Venue" }, entityType: "VENUE" };

function request(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: CONTRACTS.SOURCE_DISCOVERY_REQUEST,
    discoveryRequestId: "44444444-4444-4444-8444-444444444451",
    idempotencyKey: "22222222-2222-4222-8222-222222222251",
    correlationId: "33333333-3333-4333-8333-333333333351",
    originatingProduct: "event_suite_resources",
    subjectReference: venueSubject,
    verifiedSourceUrl: "https://venue.org/",
    requestedExtractors: ["IDENTITY", "VENUE_FACTS"],
    acquisitionGoal: "VENUE_FACTS",
    venueName: "Example Venue",
    freshnessRequirements: { maxAgeHours: 24 },
    crawlBudget: budget,
    existingEvidenceRefs: [],
    requestedBy: { actorType: "PRODUCT", actorId: "resources" },
    createdAt: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

function html(body: string) {
  return new Response(`<html><body>${body}</body></html>`, { headers: { "content-type": "text/html" } });
}

function venueSite() {
  const requested: string[] = [];
  const fetchImpl = async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requested.push(`${url.hostname}${url.pathname}`);
    assert.equal(/googleapis|openai|apollo|serpapi|bing/i.test(url.hostname), false);
    if (url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /");
    if (url.pathname === "/") return html('<title>Example Venue</title><h1>Example Venue</h1><a href="mailto:events@venue.org">events@venue.org</a><a href="/contact">Contact</a><a href="/spaces">Spaces</a>');
    if (url.pathname === "/contact") return html('<a href="mailto:events@venue.org">events@venue.org</a>');
    if (url.pathname === "/spaces") return html("<p>Grand Hall — theatre capacity 250</p>");
    return new Response("missing", { status: 404 });
  };
  return { fetchImpl, requested };
}

function capacityCount(result: { venueFacts: Array<{ fieldName: string; value: { count?: number; layout?: string } }> }) {
  return result.venueFacts.find((fact) => fact.fieldName === "capacity" && fact.value?.count === 250);
}

test("an omitted goal keeps Resources venue email acquisition", () => {
  assert.equal(venueEmailAcquisitionRequested({ acquisitionGoal: null, originatingProduct: "event_suite_resources", subjectReference: { entityType: "VENUE" } }), true);
});

test("an explicit VENUE_EMAIL goal stays an email acquisition", () => {
  assert.equal(venueEmailAcquisitionRequested({ acquisitionGoal: "VENUE_EMAIL", originatingProduct: "last_train_home", subjectReference: { entityType: "ORGANISATION" } }), true);
});

test("an explicit VENUE_FACTS goal is not an email acquisition", () => {
  assert.equal(venueEmailAcquisitionRequested({ acquisitionGoal: "VENUE_FACTS", originatingProduct: "event_suite_resources", subjectReference: { entityType: "VENUE" } }), false);
});

test("a legacy Resources venue request still forces the email search", async () => {
  const { fetchImpl, requested } = venueSite();
  const result = await executeSourceDiscoveryRequest(request({
    acquisitionGoal: null,
    requestedExtractors: ["IDENTITY"],
    idempotencyKey: "22222222-2222-4222-8222-222222222252",
    discoveryRequestId: "44444444-4444-4444-8444-444444444452",
  }), { resolveHost: publicResolver, fetchImpl }) as any;
  assert.equal(result.crawl.emailOutcome, "EMAIL_FOUND");
  assert.equal(result.guideEmailReady, true);
  assert.equal(result.publicContacts.some((item: { type: string; value: string }) => item.type === "EMAIL" && item.value === "events@venue.org"), true);
  assert.equal(requested.includes("venue.org/contact"), true);
});

test("VENUE_FACTS keeps crawling after a contact page email and extracts capacity", async () => {
  const { fetchImpl, requested } = venueSite();
  const result = await executeSourceDiscoveryRequest(request(), { resolveHost: publicResolver, fetchImpl }) as any;
  assert.equal(result.contractVersion, CONTRACTS.SOURCE_DISCOVERY_RESULT);
  assert.equal(result.crawl.emailOutcome, "EMAIL_NOT_REQUESTED");
  assert.equal(result.guideEmailReady, false);
  assert.equal(result.publicContacts.length, 0);
  assert.equal(result.identityFacts.some((fact: { fieldName: string; value: string }) => fact.fieldName === "siteName" && fact.value === "Example Venue"), true);
  assert.equal(requested.includes("venue.org/contact"), true);
  assert.equal(requested.indexOf("venue.org/spaces") > requested.indexOf("venue.org/"), true);
  const capacity = capacityCount(result);
  assert.equal(capacity?.value.count, 250);
  assert.equal(capacity?.value.layout, "theatre");
  assert.equal(requested.every((target) => target.startsWith("venue.org/")), true);
});

test("VENUE_EMAIL on the same fixture still records an email acquisition", async () => {
  const { fetchImpl, requested } = venueSite();
  const result = await executeSourceDiscoveryRequest(request({
    acquisitionGoal: "VENUE_EMAIL",
    requestedExtractors: ["IDENTITY"],
    idempotencyKey: "22222222-2222-4222-8222-222222222253",
    discoveryRequestId: "44444444-4444-4444-8444-444444444453",
  }), { resolveHost: publicResolver, fetchImpl }) as any;
  assert.equal(result.crawl.emailOutcome, "EMAIL_FOUND");
  assert.equal(result.guideEmailReady, true);
  assert.equal(result.publicContacts.some((item: { value: string }) => item.value === "events@venue.org"), true);
  assert.equal(requested.includes("venue.org/spaces"), false);
});

test("a stored VENUE_EMAIL result does not satisfy a later VENUE_FACTS request with the same client key", async () => {
  assert.equal(SOURCE_DISCOVERY_EXECUTION_VERSION, "resources-v2-source-discovery-v4");
  const idempotencyKey = "22222222-2222-4222-8222-222222222254";
  assert.notEqual(
    sourceDiscoveryExecutionKey(idempotencyKey, SOURCE_DISCOVERY_EXECUTION_VERSION, "VENUE_EMAIL"),
    sourceDiscoveryExecutionKey(idempotencyKey, SOURCE_DISCOVERY_EXECUTION_VERSION, "VENUE_FACTS"),
  );
  assert.equal(
    sourceDiscoveryExecutionKey(idempotencyKey, SOURCE_DISCOVERY_EXECUTION_VERSION, "VENUE_EMAIL"),
    sourceDiscoveryExecutionKey(idempotencyKey, SOURCE_DISCOVERY_EXECUTION_VERSION, null),
  );
  const store = new InMemoryNexusResultStore();
  const emailSite = venueSite();
  const email = await executeSourceDiscoveryRequest(request({
    acquisitionGoal: "VENUE_EMAIL",
    requestedExtractors: ["IDENTITY"],
    idempotencyKey,
    discoveryRequestId: "44444444-4444-4444-8444-444444444454",
  }), { resolveHost: publicResolver, fetchImpl: emailSite.fetchImpl }, store) as any;
  assert.equal(email.crawl.emailOutcome, "EMAIL_FOUND");
  const factsSite = venueSite();
  const facts = await executeSourceDiscoveryRequest(request({
    acquisitionGoal: "VENUE_FACTS",
    idempotencyKey,
    discoveryRequestId: "44444444-4444-4444-8444-444444444455",
  }), { resolveHost: publicResolver, fetchImpl: factsSite.fetchImpl }, store) as any;
  assert.equal(facts.crawl.emailOutcome, "EMAIL_NOT_REQUESTED");
  assert.equal(capacityCount(facts)?.value.count, 250);
  assert.equal(factsSite.requested.includes("venue.org/spaces"), true);
  const beforeReplay = factsSite.requested.length;
  const replay = await executeSourceDiscoveryRequest(request({
    acquisitionGoal: "VENUE_FACTS",
    idempotencyKey,
    discoveryRequestId: "44444444-4444-4444-8444-444444444456",
  }), { resolveHost: publicResolver, fetchImpl: factsSite.fetchImpl }, store) as any;
  assert.equal(factsSite.requested.length, beforeReplay);
  assert.equal(replay.crawl.emailOutcome, "EMAIL_NOT_REQUESTED");
  assert.equal(capacityCount(replay)?.value.count, 250);
});
