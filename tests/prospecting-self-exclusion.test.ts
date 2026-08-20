import assert from "node:assert/strict";
import test from "node:test";
import { canPersistCommercialMemory, enrichDiscoveryCandidates, evaluateDiscoveryCandidate } from "../src/ai-sales-team/discovery.ts";
import { isEventSuiteFirstPartyUrl } from "../src/ai-sales-team/first-party.ts";
import { isContactResearchEligible, normaliseContactResearch, researchEligibleProspectContact } from "../src/ai-sales-team/contact-research.ts";
import { assertOutreachAccountEligible } from "../src/outreach/service.ts";

const fact = (claim: string, sourceUrl = "https://example.org/event") => ({ claim, sourceUrl, sourceTitle: "Public event page", kind: "FACT" as const, confidence: "HIGH" as const });
const prospect = (overrides: Record<string, unknown> = {}) => ({ canonicalName: "Regional Festival", organiserName: "Regional Events", website: "https://regional.example.org", origin: "EVENT_FIRST" as const, relationshipHint: "PROSPECT" as const, facts: [fact("Regional Events organises an annual public festival.")], inferences: [], unknowns: [], ...overrides });

test("EventSuite first-party identity uses strict domain matching", () => {
  assert.equal(isEventSuiteFirstPartyUrl("https://eventsuite.pro/path?x=1"), true);
  assert.equal(isEventSuiteFirstPartyUrl("HTTPS://WWW.EVENTSUITE.PRO/"), true);
  assert.equal(isEventSuiteFirstPartyUrl("https://research.eventsuite.pro/page"), true);
  assert.equal(isEventSuiteFirstPartyUrl("https://eventsuite.pro.example.org"), false);
  assert.equal(isEventSuiteFirstPartyUrl("https://eventsuite-example.org"), false);
});

test("name similarity alone never creates a first-party classification", () => {
  const result = evaluateDiscoveryCandidate(prospect({ canonicalName: "EventSuite Regional Events", organiserName: "EventSuite Regional Events" }), "ZA");
  assert.equal(result.firstPartyStatus, undefined);
});

test("an ordinary prospect citing an EventSuite resource is not self", () => {
  const result = evaluateDiscoveryCandidate(prospect({ facts: [fact("Regional Events organises an annual public festival.", "https://www.eventsuite.pro/resources/event-planning")] }), "ZA");
  assert.equal(result.firstPartyStatus, undefined);
});

test("first-party candidate is rejected before persistence gates", () => {
  const result = evaluateDiscoveryCandidate(prospect({ canonicalName: "EventSuite", organiserName: "EventSuite", website: "https://www.eventsuite.pro/" }), "GB");
  assert.equal(result.firstPartyStatus, "FIRST_PARTY_SELF");
  assert.equal(result.status, "REJECTED");
  assert.equal(result.relationship, "UNKNOWN");
  assert.equal(result.prospectIntelligence.accountCreationEligible, false);
  assert.equal(result.prospectIntelligence.outreachEligibility, "BLOCKED");
  assert.equal(result.prospectIntelligence.primaryEntryOpportunity, "UNKNOWN");
  assert.equal(canPersistCommercialMemory(result), false);
  assert.equal(isContactResearchEligible({ status: result.status, relationship: result.relationship, account_id: "old-self-account", prospect_intelligence: result.prospectIntelligence }), false);
});

test("first-party identity discovered during enrichment remains blocked", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-only-key";
  globalThis.fetch = async () => new Response(JSON.stringify({ output_text: JSON.stringify({ candidates: [{ candidateRef: "1", facts: [fact("EventSuite operates an event operations platform.", "https://www.eventsuite.pro/platform")], inferences: [], unknowns: [] }] }) }), { status: 200, headers: { "content-type": "application/json" } });
  const initial = evaluateDiscoveryCandidate(prospect({ canonicalName: "EventSuite", organiserName: "EventSuite" }), "GB");
  const result = await enrichDiscoveryCandidates([initial], "GB");
  const enriched = result.candidates[0];
  assert.equal(enriched.firstPartyStatus, "FIRST_PARTY_SELF");
  assert.equal(enriched.status, "REJECTED");
  assert.equal(enriched.prospectIntelligence.accountCreationEligible, false);
  assert.equal(enriched.prospectIntelligence.outreachEligibility, "BLOCKED");
  assert.equal(result.telemetry.enrichmentEligibleCount, 1);
  assert.equal(result.telemetry.enrichmentAttemptedCount, 1);
  assert.equal(result.telemetry.enrichmentSucceededCount, 1);
  assert.equal(result.telemetry.enrichmentMateriallyChangedCount, 1);
  process.env.OPENAI_API_KEY = originalKey;
  globalThis.fetch = originalFetch;
});

test("enrichment telemetry respects the four-candidate budget and reconciles skips", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-only-key";
  globalThis.fetch = async () => new Response(JSON.stringify({ output_text: JSON.stringify({ candidates: [1, 2, 3, 4].map((candidateRef) => ({ candidateRef: String(candidateRef), facts: [], inferences: [], unknowns: [] })) }) }), { status: 200, headers: { "content-type": "application/json" } });
  const initial = [1, 2, 3, 4, 5].map((index) => evaluateDiscoveryCandidate(prospect({ canonicalName: `Regional Festival ${index}`, organiserName: `Regional Events ${index}` }), "ZA"));
  const result = await enrichDiscoveryCandidates(initial, "ZA");
  assert.equal(result.telemetry.firstPassCandidateCount, 5);
  assert.equal(result.telemetry.enrichmentEligibleCount, 5);
  assert.equal(result.telemetry.enrichmentAttemptedCount, 4);
  assert.equal(result.telemetry.enrichmentSkippedCount, 1);
  assert.equal(result.telemetry.enrichmentFailedCount, 0);
  assert.equal(result.candidates.filter((candidate) => candidate.enrichment.status === "ATTEMPTED").length, 0);
  assert.equal(result.candidates.filter((candidate) => candidate.enrichment.status === "SUCCEEDED").length, 4);
  assert.equal(result.candidates.filter((candidate) => candidate.enrichment.skipReason === "BUDGET_LIMIT").length, 1);
  assert.equal(JSON.stringify(result).includes("test-only-key"), false);
  assert.equal(JSON.stringify(result).includes("reasoning"), false);
  process.env.OPENAI_API_KEY = originalKey;
  globalThis.fetch = originalFetch;
});

test("competitors remain blocked and ordinary prospects remain eligible", () => {
  const competitor = evaluateDiscoveryCandidate(prospect({ relationshipHint: "COMPETITOR", facts: [fact("Regional Events provides event ticketing software.")] }), "ZA");
  const ordinary = evaluateDiscoveryCandidate(prospect({ facts: [fact("Regional Events organises an annual paid festival with fragmented public event information.")] }), "ZA");
  assert.equal(competitor.status, "BLOCKED");
  assert.equal(ordinary.relationship, "PROSPECT");
  assert.equal(ordinary.status, "QUALIFIED");
});

const legacyEligibleCandidate = {
  status: "QUALIFIED",
  relationship: "PROSPECT",
  account_id: "853ace7e-bbbf-4ddb-92a2-927eda81a284",
  prospect_intelligence: { eventConnection: { state: "CONFIRMED" }, accountCreationEligible: true, outreachEligibility: "ELIGIBLE" },
};

const externalContactResult = normaliseContactResearch({
  likelyBuyerRole: "Festival Director",
  buyerRoleRationale: "The role owns the programme.",
  namedContact: null,
  organisationRoute: null,
  facts: [],
  unknowns: ["No public route found."],
});

test("legacy qualified self account is blocked by current authoritative identity before contact research", async () => {
  let providerCalls = 0;
  const provider = async () => {
    providerCalls += 1;
    return { result: externalContactResult, provider: "openai", model: "test-model" };
  };
  const outcome = await researchEligibleProspectContact({
    candidate: legacyEligibleCandidate,
    identity: { accountName: "EventSuite", accountWebsite: "https://www.eventsuite.pro/", candidateName: "EventSuite", candidateWebsite: "https://www.eventsuite.pro/" },
    researchInput: { accountName: "EventSuite", website: "https://www.eventsuite.pro/", eventEvidence: [], likelyBuyerRoles: ["Organisation contact route"] },
  }, provider);
  assert.deepEqual(outcome, { blocked: true, reason: "FIRST_PARTY_SELF" });
  assert.equal(providerCalls, 0);
  assert.throws(() => assertOutreachAccountEligible({ name: "EventSuite", website: "https://www.eventsuite.pro/", metadata: { outreachEligibility: "ELIGIBLE", prospectIntelligence: { outreachEligibility: "ELIGIBLE", salesMotion: "DIRECT", nextBestCommercialAction: { type: "RESOURCE", resourceOffer: { canonicalUrl: "https://eventsuite.pro/resource" }, productDestinationUrl: "https://eventsuite.pro" } } } }), /FIRST_PARTY_SELF/);
});

test("external targets remain contact-eligible despite incidental EventSuite references or similar domains", async () => {
  let providerCalls = 0;
  const provider = async () => {
    providerCalls += 1;
    return { result: externalContactResult, provider: "openai", model: "test-model" };
  };
  const outcome = await researchEligibleProspectContact({
    candidate: legacyEligibleCandidate,
    identity: { accountName: "Regional Events", accountWebsite: "https://eventsuite.pro.example.org", candidateName: "Regional Festival", candidateWebsite: "https://regional.example.org" },
    researchInput: { accountName: "Regional Events", website: "https://regional.example.org", eventEvidence: ["The prospect references https://eventsuite.pro/resources/event-planning."], likelyBuyerRoles: ["Festival Director"] },
  }, provider);
  assert.equal(outcome.blocked, false);
  assert.equal(providerCalls, 1);
  if (!outcome.blocked) assert.deepEqual(outcome.researched.result, externalContactResult);
});
