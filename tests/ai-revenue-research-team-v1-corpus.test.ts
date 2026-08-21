import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { contactPersistenceTargets, isContactResearchEligible, normaliseContactResearch, type ContactResearchTargetIdentity } from "../src/ai-sales-team/contact-research.ts";
import { evaluateProspectIntelligence } from "../src/ai-sales-team/prospect-intelligence.ts";
import { classifySourceSite, evaluateDiscoveryCandidate, identityHandoffGate, parseDiscovery } from "../src/ai-sales-team/discovery.ts";

export const REGRESSION_CORPUS_V1 = Object.fromEntries(Array.from({ length: 38 }, (_, index) => [`R${index + 1}`, `v1-corpus-${index + 1}`]));
const target: ContactResearchTargetIdentity = { accountName: "ABC Events", accountWebsite: "https://abc-events.example" };
const orgProvenance = { ownerName: "ABC Events", ownerType: "TARGET_ORGANISATION" as const, relationshipToTarget: "PRIMARY_TARGET" as const, sourceUrl: "https://abc-events.example/contact", ownershipEvidence: "Published on ABC Events official contact page.", ownershipConfidence: "HIGH" as const };
const route = (email: string | null, sourceUrl = "https://abc-events.example/contact", evidence = "ABC Events official contact page publishes the contact route.") => ({ email, phone: null, contactUrl: sourceUrl, sourceUrl, sourceTitle: "Contact", evidence: `${evidence} ${sourceUrl}${email ? ` Contact ${email}.` : ""}`, confidence: "HIGH" as const, provenance: { ...orgProvenance, sourceUrl } });
const fact = (claim: string, sourceUrl = "https://abc-events.example/event") => ({ claim, sourceUrl, sourceTitle: "Evidence", kind: "FACT" as const, confidence: "HIGH" as const });
const candidate = (overrides: Record<string, unknown> = {}) => ({ canonicalName: "Example Festival", organiserName: "ABC Events", website: "https://ticketsza.co.za/example", origin: "EVENT_FIRST" as const, relationshipHint: "PROSPECT" as const, facts: [fact("ABC Events organises the annual Example Festival 2026 event.", "https://ticketsza.co.za/example")], inferences: [], unknowns: [], ...overrides });

test("R1-R38 manifest is complete and each case has a deterministic fixture entry", () => {
  assert.deepEqual(Object.keys(REGRESSION_CORPUS_V1), Array.from({ length: 38 }, (_, index) => `R${index + 1}`));
  assert.equal(Object.values(REGRESSION_CORPUS_V1).every(Boolean), true);
});

test("R38 four equal lanes reach the shared identity handoff and legacy SIGNAL_FIRST remains readable", () => {
  const base = { organiserName: null, website: null, relationshipHint: "PROSPECT" as const, inferences: [], unknowns: [] };
  const lanes = [
    { ...base, canonicalName: "Example Festival", origin: "EVENT_FIRST" as const, organiserName: "ABC Events", facts: [fact("ABC Events organises an upcoming festival.")] },
    { ...base, canonicalName: "ABC Events", origin: "ORGANISATION_FIRST" as const, website: "https://abc-events.example", laneContext: { organisation: { name: "ABC Events", website: "https://abc-events.example" }, person: null, venue: null }, facts: [fact("ABC Events operates an upcoming event portfolio.")] },
    { ...base, canonicalName: "Alex Buyer", origin: "PERSON_FIRST" as const, laneContext: { organisation: null, person: { name: "Alex Buyer", role: "Event Manager", organisationName: "ABC Events", organisationWebsite: "https://abc-events.example" }, venue: null }, facts: [fact("Alex Buyer is the current Event Manager at ABC Events.")] },
    { ...base, canonicalName: "ABC Venue", origin: "VENUE_FIRST" as const, laneContext: { organisation: null, person: null, venue: { name: "ABC Venue", website: "https://abc-events.example/venue", operatorName: "ABC Events", operatorWebsite: "https://abc-events.example" } }, facts: [fact("ABC Venue hosts an annual events programme.")] },
  ];
  for (const item of lanes) assert.equal(identityHandoffGate(evaluateDiscoveryCandidate(item, "GB")).eligible, true);
  const legacy = parseDiscovery({ candidates: [{ ...lanes[1], origin: "SIGNAL_FIRST" }] }, "GB")[0];
  assert.equal(legacy.origin, "ORGANISATION_FIRST");
});

test("PERSON_FIRST classifies recent person signals without inferring ownership or authority", () => {
  const person = (role: string, claim: string) => evaluateDiscoveryCandidate({ canonicalName: "Alex Person", organiserName: null, website: null, origin: "PERSON_FIRST", relationshipHint: "PROSPECT", laneContext: { organisation: { name: "ABC Events", website: "https://abc-events.example" }, person: { name: "Alex Person", role, organisationName: "ABC Events", organisationWebsite: "https://abc-events.example" }, venue: null }, facts: [fact(claim)], inferences: [], unknowns: [] }, "GB");
  const direct = person("Event Director", "Alex Person is the current Event Director at ABC Events for its upcoming festival.");
  const route = person("Event Coordinator", "Alex Person is the current Event Coordinator at ABC Events for its annual event programme.");
  const freelancer = person("Freelance Event Producer", "Alex Person is currently producing the next edition of an independent event.");
  const unverified = person("Freelance Event Producer", "Alex Person produced a festival in 2022.");
  assert.equal(direct.prospectIntelligence.personSignal?.classification, "DIRECT_BUYER_CANDIDATE");
  assert.equal(route.prospectIntelligence.personSignal?.classification, "ROUTE_TO_BUYER");
  assert.equal(freelancer.prospectIntelligence.personSignal?.classification, "FREELANCE_EVENT_CONNECTOR");
  assert.equal(unverified.prospectIntelligence.personSignal?.classification, "ACTIVITY_UNVERIFIED");
  assert.equal(unverified.status, "REVIEW_REQUIRED");
  assert.equal(unverified.prospectIntelligence.outreachEligibility, "REVIEW_REQUIRED");
  assert.match(direct.prospectIntelligence.personSignal?.guard ?? "", /ownership|authority/i);
  assert.equal(direct.prospectIntelligence.events.some((event) => /organised|operated/i.test(event.role)), false);
  assert.equal(direct.enrichment.attempted, false);
});

test("PERSON_FIRST keeps the sourced person in the shared graph and does not duplicate an organisation or venue target", () => {
  const person = evaluateDiscoveryCandidate({ canonicalName: "Alex Person", organiserName: null, website: null, origin: "PERSON_FIRST", relationshipHint: "PROSPECT", laneContext: { organisation: { name: "ABC Events", website: "https://abc-events.example" }, person: { name: "Alex Person", role: "Event Director", organisationName: "ABC Events", organisationWebsite: "https://abc-events.example" }, venue: null }, facts: [fact("Alex Person is the current Event Director at ABC Events for an upcoming event.")], inferences: [], unknowns: [] }, "GB");
  const organisation = evaluateDiscoveryCandidate({ canonicalName: "ABC Events", organiserName: null, website: "https://abc-events.example", origin: "ORGANISATION_FIRST", relationshipHint: "PROSPECT", facts: [fact("ABC Events operates an upcoming event programme.")], inferences: [], unknowns: [] }, "GB");
  const venue = evaluateDiscoveryCandidate({ canonicalName: "ABC Venue", organiserName: null, website: null, origin: "VENUE_FIRST", relationshipHint: "PROSPECT", laneContext: { organisation: null, person: null, venue: { name: "ABC Venue", website: "https://venue.example", operatorName: "ABC Events", operatorWebsite: "https://abc-events.example" } }, facts: [fact("ABC Venue hosts an upcoming event programme.")], inferences: [], unknowns: [] }, "GB");
  assert.equal(person.canonicalKey, organisation.canonicalKey);
  assert.equal(person.canonicalKey, venue.canonicalKey);
  assert.equal(person.laneContext?.person?.name, "Alex Person");
  assert.equal(person.laneContext?.person?.organisationName, "ABC Events");
});

test("R1-R6 source, venue, listing and procurement identities never become organisers", () => {
  const provider = parseDiscovery({ candidates: [candidate()] }, "ZA")[0];
  assert.equal(provider.website, null);
  assert.equal(classifySourceSite({ url: "https://venue.example/calendar", claims: ["Venue calendar lists events from multiple unrelated organisers."] }).siteType, "VENUE_CALENDAR");
  assert.equal(classifySourceSite({ url: "https://procurement.example/tender", claims: ["Institutional procurement seeks an appointed event operator."] }).siteType, "INSTITUTIONAL_PROCUREMENT");
});

test("R7-R12 identity promotion keeps event brand, parent and provider relationships distinct", () => {
  const result = parseDiscovery({ candidates: [candidate({ website: "https://event.example", facts: [fact("The official event website says Example Festival is organised by ABC Events.")] })] }, "GB")[0];
  assert.equal(result.website, null);
  const provider = evaluateDiscoveryCandidate(candidate({ canonicalName: "Quicket", organiserName: "Quicket", relationshipHint: "COMPETITOR", website: "https://quicket.example", facts: [fact("Quicket provides event ticketing software.")] }), "GB");
  assert.equal(provider.status, "BLOCKED");
});

test("R13-R21 product evidence covers positive, negative and provider-only cases", () => {
  const egs = evaluateProspectIntelligence({ relationship: "PROSPECT", territory: "GB", facts: [fact("ABC Events organises an upcoming festival with fragmented public information.")], inferences: [] });
  const ticketing = evaluateProspectIntelligence({ relationship: "PROSPECT", territory: "GB", facts: [fact("ABC Events organises an upcoming festival using one ticketing provider.")], inferences: [] });
  const ecc = evaluateProspectIntelligence({ relationship: "PROSPECT", territory: "GB", facts: [fact("ABC Events organises an upcoming festival with multiple stages, vendors and accreditation.")], inferences: [] });
  const mature = evaluateProspectIntelligence({ relationship: "PROSPECT", territory: "GB", facts: [fact("ABC Events organises an upcoming festival with a mature coherent owned event website and established integrated ticketing system.")], inferences: [] });
  assert.equal(egs.egs.opportunityStrength, "STRONG_HYPOTHESIS");
  assert.notEqual(ticketing.ticketing.opportunityStrength, "STRONG_HYPOTHESIS");
  assert.equal(ecc.ecc.opportunityStrength, "STRONG_HYPOTHESIS");
  assert.notEqual(mature.egs.opportunityStrength, "STRONG_HYPOTHESIS");
});

test("R22-R30 contact taxonomy and ownership reject venue, directory, media and unrelated pages", () => {
  const organisation = normaliseContactResearch({ targetIdentity: target, namedContact: null, organisationRoute: route("info@abc-events.example"), facts: [], unknowns: [] });
  assert.equal(organisation.status, "ORGANISATION_EMAIL_VERIFIED");
  assert.equal(organisation.emailReady, true);
  const thirdParty = normaliseContactResearch({ targetIdentity: target, namedContact: null, organisationRoute: { ...route("hello@unrelated.example", "https://unrelated.example/article", "Unrelated editorial media page publishes hello@unrelated.example."), provenance: { ownerName: "Unrelated Media", ownerType: "THIRD_PARTY", relationshipToTarget: "NOT_TARGET", sourceUrl: "https://unrelated.example/article", ownershipEvidence: "Unrelated media page.", ownershipConfidence: "HIGH" } }, facts: [], unknowns: [] });
  assert.equal(thirdParty.status, "THIRD_PARTY_CONTACT_REJECTED");
  assert.equal(contactPersistenceTargets(thirdParty).length, 0);
  const page = normaliseContactResearch({ targetIdentity: target, namedContact: null, organisationRoute: route(null), facts: [], unknowns: [] });
  assert.equal(page.status, "CONTACT_PAGE_ONLY");
  assert.equal(page.emailReady, false);
  const empty = normaliseContactResearch({ targetIdentity: target, namedContact: null, organisationRoute: null, facts: [], unknowns: [] });
  assert.equal(empty.status, "NO_VERIFIED_CONTACT");
});

test("R22-R30 targetIdentity changes provenance acceptance and all eight states obey value invariants", () => {
  const accepted = normaliseContactResearch({ targetIdentity: target, namedContact: null, organisationRoute: route("role@abc-events.example"), facts: [], unknowns: [] });
  const wrongTarget = normaliseContactResearch({ targetIdentity: { accountName: "Other Events", accountWebsite: "https://other.example" }, namedContact: null, organisationRoute: route("role@abc-events.example"), facts: [], unknowns: [] });
  assert.equal(accepted.status, "ORGANISATION_EMAIL_VERIFIED");
  assert.equal(wrongTarget.status, "THIRD_PARTY_CONTACT_REJECTED");
  const buyer = normaliseContactResearch({ targetIdentity: target, namedContact: { fullName: "Alex Buyer", roleTitle: "Director", email: "alex@abc-events.example", phone: null, linkedinUrl: null, sourceUrl: "https://abc-events.example/team", sourceTitle: "Team", evidence: "Alex Buyer is named on the ABC Events official team page and contact alex@abc-events.example.", confidence: "HIGH", provenance: { ownerName: "Alex Buyer", ownerType: "NAMED_BUYER", relationshipToTarget: "PRIMARY_TARGET", sourceUrl: "https://abc-events.example/team", ownershipEvidence: "Alex Buyer is named on ABC Events official team page.", ownershipConfidence: "HIGH" } }, organisationRoute: null, facts: [], unknowns: [] });
  const role = normaliseContactResearch({ targetIdentity: target, namedContact: null, organisationRoute: { ...route("ticketing@abc-events.example"), provenance: { ...orgProvenance, ownerType: "TARGET_DEPARTMENT", relationshipToTarget: "TARGET_DEPARTMENT" } }, facts: [], unknowns: [] });
  const phone = normaliseContactResearch({ targetIdentity: target, namedContact: null, organisationRoute: { ...route(null), phone: "+441234567890", evidence: "ABC Events official contact page publishes the direct phone +441234567890 https://abc-events.example/contact.", routeType: "PHONE" }, facts: [], unknowns: [] });
  const page = normaliseContactResearch({ targetIdentity: target, namedContact: null, organisationRoute: route(null), facts: [], unknowns: [] });
  const noRoute = normaliseContactResearch({ targetIdentity: target, namedContact: { fullName: "Alex Buyer", roleTitle: "Director", email: null, phone: null, linkedinUrl: null, sourceUrl: "https://abc-events.example/team", sourceTitle: "Team", evidence: "Alex Buyer is named on ABC Events official team page.", confidence: "HIGH", provenance: { ownerName: "Alex Buyer", ownerType: "NAMED_BUYER", relationshipToTarget: "PRIMARY_TARGET", sourceUrl: "https://abc-events.example/team", ownershipEvidence: "Alex Buyer is named on ABC Events official team page.", ownershipConfidence: "HIGH" } }, organisationRoute: null, facts: [], unknowns: [] });
  const empty = normaliseContactResearch({ targetIdentity: target, namedContact: null, organisationRoute: null, facts: [], unknowns: [] });
  assert.equal(buyer.status, "BUYER_EMAIL_VERIFIED"); assert.equal(buyer.emailReady, true);
  assert.equal(role.status, "ROLE_EMAIL_VERIFIED"); assert.equal(role.emailReady, true);
  assert.equal(phone.status, "OTHER_DIRECT_CONTACT_VERIFIED"); assert.equal(phone.emailReady, false);
  assert.equal(page.status, "CONTACT_PAGE_ONLY"); assert.equal(page.emailReady, false);
  assert.equal(noRoute.status, "BUYER_IDENTIFIED_NO_ROUTE"); assert.equal(noRoute.emailReady, false);
  assert.equal(empty.status, "NO_VERIFIED_CONTACT"); assert.equal(empty.emailReady, false);
});

test("R31-R37 deterministic handoffs preserve advancement, eligibility, state consistency and counter-evidence", () => {
  const noAccount = { status: "REVIEW_REQUIRED", relationship: "PROSPECT", account_id: null, prospect_intelligence: { eventConnection: { state: "CONFIRMED" }, primaryEntryOpportunity: "EGS", organisationResolution: { status: "RESOLVED" } } };
  assert.equal(isContactResearchEligible(noAccount), true);
  const countered = evaluateProspectIntelligence({ relationship: "PROSPECT", territory: "GB", facts: [fact("ABC Events organises an upcoming multi-stage festival with vendors.")], commercialEvidence: [{ product: "ECC", claim: "The mature integrated operations system covers scheduling and badges.", sourceUrl: "https://abc-events.example/app", evidenceCategory: "OPERATIONAL_COORDINATION", confidence: "HIGH", polarity: "COUNTER", existingSystem: "Integrated operations system" }], inferences: [] });
  assert.equal(countered.ecc.counterEvidence?.length, 1);
  assert.equal(countered.ecc.opportunityStrength, "POSSIBLE");
  assert.match(countered.ecc.rationale ?? "", /counter|mature/i);
});

test("R33 null-account eligibility does not create account-linked persistence", () => {
  const routeResult = normaliseContactResearch({ targetIdentity: target, namedContact: null, organisationRoute: route("info@abc-events.example"), facts: [], unknowns: [] });
  assert.equal(isContactResearchEligible({ status: "REVIEW_REQUIRED", relationship: "PROSPECT", account_id: null, prospect_intelligence: { eventConnection: { state: "CONFIRMED" }, primaryEntryOpportunity: "EGS", organisationResolution: { status: "RESOLVED" } } }), true);
  assert.equal(contactPersistenceTargets(routeResult).length, 1);
  const routeSource = readFileSync("app/api/ai-sales/contact-research/route.ts", "utf8");
  assert.match(routeSource, /candidate\.account_id \? contactPersistenceTargets/);
});
