import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_PROMPT_VERSIONS } from "../src/ai-sales-team/agent-prompts.ts";
import { applyDiscoveryEnrichment, classifySourceSite, evaluateDiscoveryCandidate, parseDiscovery } from "../src/ai-sales-team/discovery.ts";
import { contactPersistenceTargets, isContactResearchEligible, normaliseContactResearch } from "../src/ai-sales-team/contact-research.ts";
import { evaluateProspectIntelligence } from "../src/ai-sales-team/prospect-intelligence.ts";

const fact = (claim: string, sourceUrl = "https://event.example/source") => ({ claim, sourceUrl, sourceTitle: "Public source", kind: "FACT" as const, confidence: "HIGH" as const });
const candidate = (overrides: Record<string, unknown> = {}) => ({ canonicalName: "Example Expo", organiserName: "Example Events", website: "https://ticketsza.co.za/example", origin: "EVENT_FIRST" as const, relationshipHint: "PROSPECT" as const, facts: [fact("Example Events organises the annual Example Expo 2026 event.")], inferences: [], unknowns: [], ...overrides });

test("all four V1 roles have stable prompt versions", () => {
  assert.deepEqual(Object.values(AGENT_PROMPT_VERSIONS), ["discovery-scout-v1", "identity-resolver-v1", "commercial-researcher-v1", "buyer-contact-researcher-v1"]);
});

test("TicketsZA/Tixsa discovery sources never become organiser websites", () => {
  const result = parseDiscovery({ candidates: [candidate({ website: "https://ticketsza.co.za/example", facts: [fact("Example Events organises the annual Example Expo 2026 event.", "https://ticketsza.co.za/example")] })] }, "ZA")[0];
  assert.equal(result.website, null);
  assert.equal(result.siteClassifications?.some((item) => item.siteType === "TICKETING_PROVIDER"), true);
});

test("official event site remains distinct until authoritative organisation identity is resolved", () => {
  const result = parseDiscovery({ candidates: [candidate({ website: "https://glowfest.example", facts: [fact("GlowFest 2026 is the official event website and the annual event returns in 2026.")] })] }, "ZA")[0];
  assert.equal(result.website, null);
  assert.equal(result.organisationResolution?.status, "UNRESOLVED");
  assert.equal(result.siteClassifications?.find((item) => item.url === "https://glowfest.example")?.siteType, "EVENT_OFFICIAL");
});

test("Event Production Show promotes the evidenced organiser and preserves the event signal", () => {
  const before = evaluateDiscoveryCandidate(candidate({ canonicalName: "Event Production Show", website: "https://eventproductionshow.example", facts: [fact("The official event site says Event Production Show is organised by Mash Media Group.")] }), "GB");
  const after = applyDiscoveryEnrichment(before, { organisationResolution: { status: "RESOLVED", canonicalOrganisationName: "Mash Media Group", officialWebsite: "https://mashmedia.example", officialWebsiteSiteType: "ORGANISATION_OFFICIAL", aliases: [], confidence: "HIGH", evidence: [{ claim: "Event Production Show is organised by Mash Media Group.", sourceUrl: "https://eventproductionshow.example/about", sourceTitle: "About", confidence: "HIGH" }], siteClassifications: [], relatedOrganisations: [{ name: "Event Production Show", relationship: "EVENT_BRAND", website: "https://eventproductionshow.example", confidence: "HIGH", evidence: ["Event Production Show is the event brand."] }] }, commercialEvidence: [], facts: [], inferences: [], unknowns: [] }, "GB");
  assert.equal(after.canonicalName, "Mash Media Group");
  assert.equal(after.website, "https://mashmedia.example");
  assert.equal(after.facts.some((item) => item.sourceUrl?.includes("eventproductionshow")), true);
  assert.equal(after.organisationResolution?.relatedOrganisations?.[0].relationship, "EVENT_BRAND");
});

test("eCommerce Expo resolves to CloserStill Media and rejects historical UPTECH identity", () => {
  const before = evaluateDiscoveryCandidate(candidate({ canonicalName: "eCommerce Expo", organiserName: "UPTECH", website: "https://ecommerceexpo.example", facts: [fact("The official eCommerce Expo site says the event is organised by CloserStill Media.")] }), "GB");
  const after = applyDiscoveryEnrichment(before, { organisationResolution: { status: "RESOLVED", canonicalOrganisationName: "CloserStill Media", officialWebsite: "https://closerstill.example", officialWebsiteSiteType: "ORGANISATION_OFFICIAL", aliases: [], confidence: "HIGH", evidence: [{ claim: "eCommerce Expo is organised by CloserStill Media.", sourceUrl: "https://ecommerceexpo.example/about", sourceTitle: "About", confidence: "HIGH" }], siteClassifications: [], relatedOrganisations: [{ name: "eCommerce Expo", relationship: "EVENT_BRAND", website: "https://ecommerceexpo.example", confidence: "HIGH", evidence: ["Event brand."] }, { name: "UPTECH", relationship: "HISTORICAL_IDENTITY_REJECTED", website: null, confidence: "LOW", evidence: ["Historical candidate value was not authoritative."] }] }, commercialEvidence: [], facts: [], inferences: [], unknowns: [] }, "GB");
  assert.equal(after.canonicalName, "CloserStill Media");
  assert.equal(after.organisationResolution?.relatedOrganisations?.some((item) => item.name === "UPTECH"), true);
  assert.equal(after.organisationResolution?.relatedOrganisations?.some((item) => item.name === "UPTECH" && item.relationship === "HISTORICAL_IDENTITY_REJECTED"), true);
});

test("provider presence and own ticketing system are context, not Ticketing pain", () => {
  const result = evaluateProspectIntelligence({ relationship: "PROSPECT", territory: "GB", facts: [fact("Example Events runs an annual festival using Ticketmaster."), fact("Example Events operates its own ticketing system.")], inferences: [], unknowns: [] });
  assert.notEqual(result.ticketing.opportunityStrength, "STRONG_HYPOTHESIS");
});

test("supporting and counter-evidence are both consumed for mature tooling", () => {
  const result = evaluateProspectIntelligence({ relationship: "PROSPECT", territory: "GB", facts: [fact("Example Events organises an annual exhibition with multiple stages, exhibitors and vendors.")], inferences: [], commercialEvidence: [
    { product: "ECC", claim: "Multiple stages and vendors are publicly evidenced.", sourceUrl: "https://example.org/complexity", evidenceCategory: "MULTI_STAGE", confidence: "HIGH", polarity: "SUPPORTING" },
    { product: "ECC", claim: "The organisation uses a mature integrated event operations app with meeting scheduling and smart badges.", sourceUrl: "https://example.org/app", evidenceCategory: "OPERATIONAL_COORDINATION", confidence: "HIGH", polarity: "COUNTER", existingSystem: "Integrated event app" },
  ], unknowns: [] });
  assert.equal(result.ecc.counterEvidence?.length, 1);
  assert.equal(result.ecc.opportunityStrength, "NO_EVIDENCE");
});

test("contact research can run before final sales readiness but not for blocked records", () => {
  const state = { status: "REVIEW_REQUIRED", relationship: "PROSPECT", account_id: "account-1", prospect_intelligence: { eventConnection: { state: "CONFIRMED" }, primaryEntryOpportunity: "ECC", organisationResolution: { status: "RESOLVED" } } };
  assert.equal(isContactResearchEligible(state), true);
  assert.equal(isContactResearchEligible({ ...state, status: "REJECTED" }), false);
});

test("generic organisation email is target-owned and contact-page-only is not email-ready", () => {
  const result = normaliseContactResearch({ likelyBuyerRole: "Event Director", buyerRoleRationale: "Supported role hypothesis", namedContact: null, organisationRoute: { email: "info@arctangent.co.uk", phone: null, contactUrl: "https://arctangent.co.uk/contact", sourceUrl: "https://arctangent.co.uk/contact", sourceTitle: "Official contact", evidence: "For organisation enquiries contact info@arctangent.co.uk.", confidence: "HIGH" }, facts: [], unknowns: [] });
  assert.equal(result.emailReady, true);
  assert.equal(result.buyerIdentified, false);
  const page = normaliseContactResearch({ likelyBuyerRole: "Programme Director", buyerRoleRationale: null, namedContact: null, organisationRoute: { email: null, phone: null, contactUrl: "https://piecehall.example/contact", sourceUrl: "https://piecehall.example/contact", sourceTitle: "Contact", evidence: "Contact page for the organisation: https://piecehall.example/contact", confidence: "HIGH" }, facts: [], unknowns: [] });
  assert.equal(page.status, "CONTACT_PAGE_ONLY");
  assert.equal(page.emailReady, false);
});

test("third-party provider support email is explicitly rejected and never persisted", () => {
  const result = normaliseContactResearch({ likelyBuyerRole: "Event Director", buyerRoleRationale: null, namedContact: null, organisationRoute: { email: "support@provider.example", phone: null, contactUrl: "https://provider.example/support", sourceUrl: "https://provider.example/support", sourceTitle: "Provider support", evidence: "Ticketing provider support contact support@provider.example.", confidence: "HIGH" }, facts: [], unknowns: [] });
  assert.equal(result.targetProvenance, "REJECTED");
  assert.equal(result.emailReady, false);
  assert.equal(contactPersistenceTargets(result).length, 0);
});

test("named buyer without email remains buyer-no-route and guessed email is discarded", () => {
  const result = normaliseContactResearch({ likelyBuyerRole: "Programme & Event Director", buyerRoleRationale: null, namedContact: { fullName: "Aaron Casserly Stewart", roleTitle: "Programme & Event Director", email: "aaron.casserly.stewart@piecehall.example", phone: null, linkedinUrl: null, sourceUrl: "https://piecehall.example/team", sourceTitle: "Team", evidence: "Aaron Casserly Stewart is Programme & Event Director.", confidence: "HIGH" }, organisationRoute: null, facts: [], unknowns: [] });
  assert.equal(result.buyerIdentified, true);
  assert.equal(result.emailReady, false);
  assert.equal(result.namedContact?.email, null);
});

test("first-party identity remains blocked", () => {
  const result = evaluateDiscoveryCandidate(candidate({ canonicalName: "EventSuite", organiserName: "EventSuite", website: "https://www.eventsuite.pro", facts: [fact("EventSuite organises an annual event programme.", "https://www.eventsuite.pro/events")] }), "GB");
  assert.equal(result.status, "REJECTED");
  assert.equal(result.prospectIntelligence.outreachEligibility, "BLOCKED");
});

test("technical success without product evidence is validation-only", () => {
  const before = evaluateDiscoveryCandidate(candidate({ website: "https://example.org" }), "GB");
  const after = applyDiscoveryEnrichment(before, { organisationResolution: { status: "RESOLVED", canonicalOrganisationName: "Example Events", officialWebsite: "https://example.org", officialWebsiteSiteType: "ORGANISATION_OFFICIAL", aliases: [], confidence: "HIGH", evidence: [{ claim: "Example Events organises Example Expo.", sourceUrl: "https://example.org/about", sourceTitle: "About", confidence: "HIGH" }], siteClassifications: [], relatedOrganisations: [] }, commercialEvidence: [], facts: [], inferences: [], unknowns: [] }, "GB");
  assert.equal(after.prospectIntelligence.primaryEntryOpportunity, "UNKNOWN");
  assert.equal(after.prospectIntelligence.accountCreationEligible, false);
});
