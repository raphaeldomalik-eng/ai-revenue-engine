import assert from "node:assert/strict";
import test from "node:test";
import { createPublicWebProvider, researchContextFromPayload } from "../src/nexus/public-web.ts";
import { executeResearchRequest, InMemoryNexusResultStore } from "../src/nexus/executor.ts";
import type { ResearchRequest } from "../src/nexus/contracts.ts";
import { CONTRACTS } from "../src/nexus/contracts.ts";

const request = (purpose: ResearchRequest["researchPurpose"] = "OFFICIAL_WEBSITE") => ({
  contractVersion: CONTRACTS.RESEARCH_REQUEST,
  requestId: "11111111-1111-4111-8111-111111111111",
  idempotencyKey: "22222222-2222-4222-8222-222222222222",
  correlationId: "33333333-3333-4333-8333-333333333333",
  originatingProduct: "event_suite_resources",
  subject: {
    canonicalEntityId: null,
    candidateReference: { sourceSystem: "event_suite_resources", sourceRecordId: "Example Venue" },
    entityType: "VENUE",
  },
  researchPurpose: purpose,
  requestedFactTypes: ["officialWebsite", "publicContactEmail", "publicContactPhone", "contactFormUrl"],
  providerAllowances: ["PUBLIC_WEB"],
  costCeiling: { currency: "USD", amount: 0 },
  freshnessRequirements: { maxAgeHours: 24 },
  existingEvidenceRefs: [],
  requestedBy: { actorType: "PRODUCT", actorId: "resources" },
  createdAt: "2026-09-21T00:00:00Z",
}) as unknown as ResearchRequest;

const resolver = async () => [{ address: "93.184.216.34", family: 4 }];
function fetchSite(body: string, options: { redirect?: ResponseInit } = {}) {
  return async (input: RequestInfo | URL) => String(input).endsWith("/robots.txt")
    ? new Response("User-agent: *\nAllow: /", { status: 200 })
    : new Response(body, { status: 200, headers: { "content-type": "text/html" }, ...options.redirect });
}

test("PUBLIC_WEB accepts strong first-party identity evidence and extracts business contacts", async () => {
  const body = '<html><head><title>Example Venue</title></head><body><h1>Example Venue</h1><address>1 High Street, London</address><a href="mailto:events@example.test">events@example.test</a><a href="tel:+441234567890">Call</a><form action="/contact"></form><form action="https://forms.third-party.test/submit"></form></body></html>';
  const provider = createPublicWebProvider({ fetchImpl: fetchSite(body), resolveHost: resolver, now: () => "2026-09-21T00:00:00.000Z" });
  const result = await provider({ request: request("PUBLIC_CONTACT"), context: { targetName: "Example Venue", targetWebsite: "https://example.test/", locality: "London", existingFacts: [{ fieldName: "placeId", value: "places/example" }] } });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.facts.map((fact) => fact.fieldName), ["officialWebsite", "publicContactEmail", "publicContactPhone", "contactFormUrl"]);
  assert.equal(result.evidence[0]?.provider, "PUBLIC_WEB");
  assert.equal(result.evidence[0]?.dataClassification, "PUBLIC");
  assert.equal(result.cost?.amount, 0);
  assert.equal(result.evidence.some((item) => String(item.payload).includes("third-party")), false);
});

test("research context bridge keeps only bounded evidenced fields", () => {
  const context = researchContextFromPayload({ researchContext: { targetName: " Example Venue ", targetWebsite: " https://example.test/ ", locality: " London ", territory: "GB", existingFacts: [{ fieldName: "placeId", value: "places/example", evidenceRef: "place:example" }, { value: "ignored" }] } });
  assert.deepEqual(context, { targetName: "Example Venue", targetWebsite: "https://example.test/", locality: "London", territory: "GB", existingFacts: [{ fieldName: "placeId", value: "places/example", evidenceRef: "place:example" }] });
});

test("executor records a real PUBLIC_WEB execution with zero metered cost and preserves replay", async () => {
  const body = '<html><head><title>Example Venue</title></head><body><h1>Example Venue</h1><address>1 High Street, London</address><a href="mailto:events@example.test">events@example.test</a></body></html>';
  let fetches = 0;
  const provider = createPublicWebProvider({
    fetchImpl: async (input: RequestInfo | URL) => { fetches += 1; return fetchSite(body)(input); },
    resolveHost: resolver,
    now: () => "2026-09-21T00:00:00.000Z",
  });
  const store = new InMemoryNexusResultStore();
  const input = request("PUBLIC_CONTACT");
  const context = { targetName: "Example Venue", targetWebsite: "https://example.test/", locality: "London" };
  const first = await executeResearchRequest(input, context, { publicWeb: provider }, store) as any;
  const second = await executeResearchRequest(input, context, { publicWeb: async () => { throw new Error("replay must not fetch"); } }, store) as any;
  assert.equal(first.providerUsage[0]?.provider, "PUBLIC_WEB");
  assert.equal(first.providerUsage[0]?.callCount, 1);
  assert.equal(first.providerUsage[0]?.cost?.amount, 0);
  assert.equal(first.facts.some((fact: any) => fact.fieldName === "publicContactEmail"), true);
  assert.equal(fetches, 2);
  assert.deepEqual(second, first);
});

test("PUBLIC_WEB rejects weak name-only, locality-mismatched, unrelated, and social-only candidates", async () => {
  const weak = createPublicWebProvider({ fetchImpl: fetchSite("<title>Example Venue</title>"), resolveHost: resolver });
  const weakResult = await weak({ request: request(), context: { targetName: "Example Venue", targetWebsite: "https://example.test/" } });
  assert.equal(weakResult.facts.length, 0);
  assert.match(weakResult.unknowns.join(" "), /identity evidence/i);

  const mismatch = createPublicWebProvider({ fetchImpl: fetchSite("<title>Example Venue</title><h1>Example Venue</h1><address>1 High Street, Manchester</address>"), resolveHost: resolver });
  const mismatchResult = await mismatch({ request: request(), context: { targetName: "Example Venue", targetWebsite: "https://example.test/", locality: "London" } });
  assert.equal(mismatchResult.facts.length, 0);

  const unrelated = createPublicWebProvider({ fetchImpl: fetchSite("<title>Other Business</title><h1>Other Business</h1><address>1 High Street, London</address>"), resolveHost: resolver });
  const unrelatedResult = await unrelated({ request: request(), context: { targetName: "Example Venue", targetWebsite: "https://example.test/", locality: "London" } });
  assert.equal(unrelatedResult.facts.length, 0);

  const social = createPublicWebProvider({ fetchImpl: fetchSite("<title>Example Venue</title><h1>Example Venue</h1><address>1 High Street, London</address>"), resolveHost: resolver });
  const socialResult = await social({ request: request(), context: { targetName: "Example Venue", targetWebsite: "https://www.facebook.com/examplevenue", locality: "London" } });
  assert.equal(socialResult.facts.length, 0);
});

test("PUBLIC_WEB safely handles credential-bearing URLs, private redirects, bounded responses, and failures", async () => {
  const invalid = createPublicWebProvider({ fetchImpl: fetchSite("<title>Example Venue</title>"), resolveHost: resolver });
  for (const targetWebsite of ["https://user:pass@example.test/", "https://127.0.0.1/"]) {
    const result = await invalid({ request: request(), context: { targetName: "Example Venue", targetWebsite } });
    assert.equal(result.facts.length, 0);
    assert.equal(result.evidence.length, 0);
  }

  const redirect = createPublicWebProvider({
    fetchImpl: async (input: RequestInfo | URL) => String(input).endsWith("/robots.txt")
      ? new Response("User-agent: *\nAllow: /", { status: 200 })
      : new Response(null, { status: 302, headers: { location: "https://127.0.0.1/" } }),
    resolveHost: resolver,
  });
  const redirectResult = await redirect({ request: request(), context: { targetName: "Example Venue", targetWebsite: "https://example.test/" } });
  assert.equal(redirectResult.facts.length, 0);

  const failing = createPublicWebProvider({ fetchImpl: async () => { throw new Error("timeout"); }, resolveHost: resolver });
  const failureResult = await failing({ request: request(), context: { targetName: "Example Venue", targetWebsite: "https://example.test/" } });
  assert.equal(failureResult.facts.length, 0);
  assert.equal(failureResult.error?.retryable, true);
});
