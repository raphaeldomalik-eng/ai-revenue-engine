import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { applyDiscoveryEnrichment, canonicalDiscoveryKey, classifySourceSite, enrichDiscoveryCandidates, evaluateDiscoveryCandidate, identityHandoffGate, parseDiscovery } from "../src/ai-sales-team/discovery.ts";
import { evaluateProspectIntelligence } from "../src/ai-sales-team/prospect-intelligence.ts";
import { isContactResearchEligible } from "../src/ai-sales-team/contact-research.ts";

const fact = (claim: string, roles: Array<"DISCOVERY" | "VALIDATION" | "COMMERCIAL_EVIDENCE" | "CONTACT" | "SIGNAL">, freshness: "ACTIVE_UPCOMING" | "RECENT_RECURRING_EVIDENCE" | "HISTORICAL" | "CANCELLED_DEAD_UNSUPPORTED" | "UNKNOWN" = "ACTIVE_UPCOMING") => ({ claim, sourceUrl: "https://official.example.org/event", sourceTitle: "Official organiser", kind: "FACT" as const, confidence: "HIGH" as const, sourceRoles: roles, eventFreshness: freshness });
const candidate = (overrides: Record<string, unknown> = {}) => ({ canonicalName: "Quality Festival", organiserName: "Quality Events", website: "https://quality.example.org", origin: "EVENT_FIRST" as const, relationshipHint: "PROSPECT" as const, facts: [fact("Quality Events organises the upcoming annual Quality Festival; event information is fragmented across social channels and the ticket page.", ["VALIDATION", "COMMERCIAL_EVIDENCE"])], inferences: [{ claim: "A fragmented owned destination may limit discoverability.", sourceUrl: null, sourceTitle: null, kind: "INFERENCE" as const, confidence: "MEDIUM" as const }], unknowns: ["Current event website owner is not published."], ...overrides });

test("event-first and organisation-first are both real, commercially assessed origins", () => {
  const eventFirst = evaluateDiscoveryCandidate(candidate(), "ZA");
  const organisationFirst = evaluateDiscoveryCandidate(candidate({ canonicalName: "Quality Events", organiserName: "Quality Events", origin: "ORGANISATION_FIRST", facts: [fact("Quality Events operates an upcoming portfolio of regional festivals and its primary event information is fragmented across social and ticket pages.", ["VALIDATION", "COMMERCIAL_EVIDENCE"])] }), "ZA");
  assert.equal(eventFirst.status, "QUALIFIED");
  assert.equal(organisationFirst.status, "QUALIFIED");
  assert.equal(organisationFirst.origin, "ORGANISATION_FIRST");
  assert.equal(organisationFirst.prospectIntelligence.accountCreationEligible, true);
});

test("venue identity resolution promotes an operator without rewriting the venue as organiser", () => {
  const initial = evaluateDiscoveryCandidate(candidate({ canonicalName: "The Piece Hall", organiserName: null, website: "https://www.thepiecehall.co.uk", origin: "VENUE_FIRST", laneContext: { organisation: null, person: null, venue: { name: "The Piece Hall", website: "https://www.thepiecehall.co.uk", operatorName: null, operatorWebsite: null } }, facts: [fact("The Piece Hall hosts an upcoming events programme.", ["DISCOVERY"])] }), "GB");
  const resolved = applyDiscoveryEnrichment(initial, { organisationResolution: { status: "RESOLVED", canonicalOrganisationName: "The Piece Hall Trust", officialWebsite: "https://www.thepiecehall.co.uk", officialWebsiteSiteType: "ORGANISATION_OFFICIAL", aliases: [], confidence: "HIGH", evidence: [{ claim: "The Piece Hall Trust operates The Piece Hall venue.", sourceUrl: "https://www.thepiecehall.co.uk/about", sourceTitle: "Venue operator", confidence: "HIGH" }] }, commercialEvidence: [], facts: [], inferences: [], unknowns: [] }, "GB");
  assert.equal(resolved.organiserName, null);
  assert.equal(resolved.laneContext?.venue?.name, "The Piece Hall");
  assert.equal(resolved.laneContext?.venue?.operatorName, "The Piece Hall Trust");
  assert.equal(resolved.laneContext?.venue?.operatorWebsite, "https://www.thepiecehall.co.uk");
});

test("person-first preserves the sourced person when identity enrichment is unresolved", () => {
  const initial = evaluateDiscoveryCandidate(candidate({ canonicalName: "Alex Morgan", organiserName: null, origin: "PERSON_FIRST", laneContext: { organisation: null, person: { name: "Alex Morgan", role: "Event Manager", organisationName: "Quality Events", organisationWebsite: "https://quality.example.org" }, venue: null }, facts: [fact("Alex Morgan is the current Event Manager at Quality Events.", ["DISCOVERY"])] }), "GB");
  const unresolved = applyDiscoveryEnrichment(initial, { organisationResolution: { status: "UNRESOLVED" }, commercialEvidence: [], facts: [], inferences: [], unknowns: ["Employer needs confirmation."] }, "GB");
  assert.deepEqual(unresolved.laneContext?.person, { name: "Alex Morgan", role: "Event Manager", organisationName: "Quality Events", organisationWebsite: "https://quality.example.org" });
  assert.equal(unresolved.organisationResolution?.status, "UNRESOLVED");
});

test("event-first runs bounded public identity research before Companies House", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  const order: string[] = [];
  process.env.OPENAI_API_KEY = "test-only-key";
  globalThis.fetch = async (input) => {
    if (String(input).includes("api.openai.com/v1/responses")) {
      order.push("OPENAI");
      return new Response(JSON.stringify({ output_text: JSON.stringify({ candidates: [{ candidateRef: "1", organisationResolution: { status: "RESOLVED", canonicalOrganisationName: "ArcTanGent", officialWebsite: "https://arctangent.co.uk", officialWebsiteSiteType: "ORGANISATION_OFFICIAL", aliases: [], confidence: "HIGH", evidence: [{ claim: "ArcTanGent organises the current festival.", sourceUrl: "https://arctangent.co.uk", sourceTitle: "Official organiser", confidence: "HIGH" }] }, commercialEvidence: [], facts: [], inferences: [], unknowns: [] }] }) }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error("UNEXPECTED_PROVIDER_CALL");
  };
  const initial = evaluateDiscoveryCandidate(candidate({ canonicalName: "ArcTanGent Festival", organiserName: "ArcTanGent", website: null, facts: [fact("ArcTanGent organises the current ArcTanGent Festival.", ["DISCOVERY"])] }), "GB");
  const result = await enrichDiscoveryCandidates([initial], "GB", { companiesHouse: { apiKey: "test-key", mode: "search_only", fetchImpl: async () => { order.push("CH"); return new Response(JSON.stringify({ items: [{ title: "ARCTANGENT LIMITED", company_number: "01234567", company_status: "active", company_type: "ltd", sic_codes: ["90020"] }] }), { status: 200, headers: { "content-type": "application/json" } }); } } });
  assert.deepEqual(order, ["OPENAI", "CH"]);
  assert.equal(result.candidates[0].organisationResolution?.status, "RESOLVED");
  assert.equal(result.candidates[0].registrarValidation?.outcome, "REGISTRAR_CONFIRMED");
  process.env.OPENAI_API_KEY = originalKey;
  globalThis.fetch = originalFetch;
});

test("freshness rejects historical one-offs while recurring evidence stays explicitly non-upcoming", () => {
  const stale = evaluateDiscoveryCandidate(candidate({ facts: [fact("Quality Events organised a one-off festival that took place in 2018.", ["VALIDATION"], "HISTORICAL")] }), "ZA");
  const recurring = evaluateDiscoveryCandidate(candidate({ facts: [fact("Quality Events organised the 2025 annual festival and remains the recurring organiser.", ["VALIDATION"], "RECENT_RECURRING_EVIDENCE")] }), "ZA");
  assert.equal(stale.status, "REJECTED");
  assert.equal(stale.prospectIntelligence.accountCreationEligible, false);
  assert.equal(recurring.prospectIntelligence.eventFreshness.state, "RECENT_RECURRING_EVIDENCE");
  assert.notEqual(recurring.prospectIntelligence.eventFreshness.state, "ACTIVE_UPCOMING");
});

test("provider customers stay prospects while actual providers remain blocked", () => {
  const customer = evaluateDiscoveryCandidate(candidate({ facts: [fact("Quality Events organises an upcoming annual festival; tickets are sold through Quicket and event information is fragmented across the ticket page and social channels.", ["VALIDATION", "COMMERCIAL_EVIDENCE"])] }), "ZA");
  const competitor = evaluateDiscoveryCandidate(candidate({ canonicalName: "Quicket", organiserName: "Quicket", relationshipHint: "COMPETITOR", facts: [fact("Quicket provides event ticketing software.", ["VALIDATION"])] }), "ZA");
  assert.equal(customer.relationship, "PROSPECT");
  assert.notEqual(customer.relationship, "COMPETITOR");
  assert.equal(competitor.status, "BLOCKED");
});

test("canonicalisation reuses authoritative-domain variants but does not merge unrelated similar names", () => {
  assert.equal(canonicalDiscoveryKey("ArcTanGent", "https://arctangent.co.uk/about"), canonicalDiscoveryKey("ArcTanGent Festival", "https://arctangent.co.uk/tickets"));
  assert.notEqual(canonicalDiscoveryKey("ArcTanGent", null), canonicalDiscoveryKey("ArcTanGent Festival", null));
  const parsed = parseDiscovery({ candidates: [candidate({ canonicalName: "ArcTanGent", organiserName: "ArcTanGent", website: "https://arctangent.co.uk", facts: [fact("ArcTanGent organises an upcoming festival with fragmented owned information.", ["VALIDATION", "COMMERCIAL_EVIDENCE"]) ] }), candidate({ canonicalName: "ArcTanGent Festival", organiserName: "ArcTanGent Festival", website: "https://arctangent.co.uk/tickets", facts: [fact("ArcTanGent Festival organises an upcoming festival with fragmented owned information.", ["VALIDATION", "COMMERCIAL_EVIDENCE"]) ] })] }, "GB");
  assert.equal(parsed.length, 1);
});

test("EGS, Ticketing and ECC each require their own evidence", () => {
  const egsPositive = evaluateProspectIntelligence({ relationship: "PROSPECT", territory: "ZA", facts: [fact("The organiser runs an upcoming festival and the ticket provider page is the primary destination with fragmented event information.", ["VALIDATION", "COMMERCIAL_EVIDENCE"])], inferences: [] });
  const egsNegative = evaluateProspectIntelligence({ relationship: "PROSPECT", territory: "ZA", facts: [fact("The organiser runs an upcoming festival with a complete official programme and coherent owned event website.", ["VALIDATION"])], inferences: [] });
  const providerOnly = evaluateProspectIntelligence({ relationship: "PROSPECT", territory: "ZA", facts: [fact("The organiser runs an upcoming festival and tickets are sold through Quicket.", ["VALIDATION", "COMMERCIAL_EVIDENCE"])], inferences: [] });
  const ticketProblem = evaluateProspectIntelligence({ relationship: "PROSPECT", territory: "ZA", facts: [fact("The organiser runs an upcoming festival with ticket tiers, admission scanning and manual reconciliation across multiple sales arrangements.", ["VALIDATION", "COMMERCIAL_EVIDENCE"])], inferences: [] });
  const ecc = evaluateProspectIntelligence({ relationship: "PROSPECT", territory: "ZA", facts: [fact("The organiser operates an upcoming multi-day, multi-stage festival with vendors, accreditation, volunteers and concurrent programming.", ["VALIDATION", "COMMERCIAL_EVIDENCE"])], inferences: [] });
  assert.equal(egsPositive.egs.opportunityStrength, "STRONG_HYPOTHESIS");
  assert.equal(egsNegative.egs.opportunityStrength, "NO_EVIDENCE");
  assert.notEqual(providerOnly.ticketing.opportunityStrength, "STRONG_HYPOTHESIS");
  assert.equal(ticketProblem.ticketing.opportunityStrength, "STRONG_HYPOTHESIS");
  assert.equal(ecc.ecc.opportunityStrength, "STRONG_HYPOTHESIS");
});

test("review is actionable and weak discovery remains discovery memory only", () => {
  const weak = evaluateDiscoveryCandidate(candidate({ facts: [fact("A directory lists Quality Festival.", ["DISCOVERY"], "UNKNOWN")] }), "ZA");
  assert.equal(weak.status, "REVIEW_REQUIRED");
  assert.equal(weak.prospectIntelligence.accountCreationEligible, false);
  assert.match(weak.prospectIntelligence.accountCreationReason, /organiser responsibility|current/i);
});

test("facts, inferences and unknowns remain distinct and contact/outreach remain gated", () => {
  const result = evaluateDiscoveryCandidate(candidate(), "ZA");
  assert.equal(result.facts.every((item) => item.kind === "FACT"), true);
  assert.equal(result.inferences.every((item) => item.kind === "INFERENCE"), true);
  assert.ok(result.prospectIntelligence.unknownsToResearch.length > 0);
  const route = readFileSync("app/api/ai-sales/discovery/route.ts", "utf8");
  const contact = readFileSync("src/ai-sales-team/contact-research.ts", "utf8");
  assert.match(route, /candidate\.prospectIntelligence\.accountCreationEligible/);
  assert.match(contact, /candidate\.status === "QUALIFIED"/);
  assert.doesNotMatch(route, /outreach_messages\)\.insert/);
});

test("provider and service noise without organiser evidence is rejected before enrichment", () => {
  const noise = evaluateDiscoveryCandidate(candidate({ canonicalName: "Noise Tickets", organiserName: "Noise Tickets", facts: [fact("Noise Tickets is a South African ticketing platform offering online ticketing software for events.", ["DISCOVERY"])] }), "ZA");
  const organiser = evaluateDiscoveryCandidate(candidate({ facts: [fact("Quality Events organises an upcoming festival and uses a ticketing platform for paid admissions.", ["VALIDATION", "COMMERCIAL_EVIDENCE"])] }), "ZA");
  assert.equal(noise.status, "REJECTED");
  assert.equal(organiser.relationship, "PROSPECT");
  assert.notEqual(organiser.status, "REJECTED");
});

test("unverified organiser hints enter identity handoff without becoming qualified", () => {
  const hinted = evaluateDiscoveryCandidate(candidate({ canonicalName: "Event Production Show 2026", organiserName: "Mash Media Group", website: "https://www.eventproductionshow.co.uk/", facts: [fact("Event Production Show 2026 is scheduled for February 2026.", ["DISCOVERY"])] }), "GB");
  assert.equal(hinted.status, "REVIEW_REQUIRED");
  assert.deepEqual(identityHandoffGate(hinted), { eligible: true, reason: "EVENT_CONNECTION_REQUIRES_ENRICHMENT" });
  assert.equal(hinted.prospectIntelligence.accountCreationEligible, false);
  assert.equal(hinted.enrichment.gateReason, "UNVERIFIED_ORGANISER_HINT");
  const unknownRelationship = evaluateDiscoveryCandidate(candidate({ relationshipHint: "UNKNOWN", organiserName: "Mash Media Group", facts: [fact("Event Production Show is scheduled for February 2026.", ["DISCOVERY"])] }), "GB");
  assert.equal(unknownRelationship.relationship, "UNKNOWN");
  assert.deepEqual(identityHandoffGate(unknownRelationship), { eligible: true, reason: "EVENT_CONNECTION_REQUIRES_ENRICHMENT" });
  const unresolved = evaluateDiscoveryCandidate(candidate({ canonicalName: "Unknown Event", organiserName: null, website: null, facts: [fact("A directory mentions a generic listing without current organiser activity.", ["DISCOVERY"], "UNKNOWN")] }), "GB");
  assert.equal(unresolved.status, "REJECTED");
  assert.deepEqual(identityHandoffGate(unresolved), { eligible: false, reason: "STATUS_REJECTED" });
});

test("bounded enrichment adds validation and commercial roles without inflating discovery confidence", () => {
  const initial = evaluateDiscoveryCandidate(candidate({ facts: [fact("A directory lists Quality Festival.", ["DISCOVERY"])] }), "ZA");
  const enriched = applyDiscoveryEnrichment(initial, {
    facts: [fact("Quality Events is the official organiser of the upcoming festival and its event information is fragmented across social and ticketing pages.", ["VALIDATION", "COMMERCIAL_EVIDENCE"])],
    inferences: [{ claim: "The fragmented owned destination may limit event discoverability.", sourceUrl: null, sourceTitle: null, kind: "INFERENCE", confidence: "MEDIUM" }],
    unknowns: ["Whether the organiser has a central operations workflow remains unknown."],
  }, "ZA");
  assert.equal(initial.facts[0].confidence, "MEDIUM");
  assert.ok(enriched.facts.some((item) => item.sourceRoles?.includes("VALIDATION")));
  assert.ok(enriched.facts.some((item) => item.sourceRoles?.includes("COMMERCIAL_EVIDENCE")));
  assert.equal(enriched.prospectIntelligence.egs.opportunityStrength, "STRONG_HYPOTHESIS");
  assert.equal(enriched.prospectIntelligence.primaryEntryOpportunity, "EGS");
  assert.equal(enriched.prospectIntelligence.accountCreationEligible, true);
  assert.ok(enriched.inferences.length > 0);
  assert.ok(enriched.prospectIntelligence.unknownsToResearch.some((item) => /operations workflow/i.test(item)));
});

test("third-party ticketing pages remain discovery signals rather than commercial websites", () => {
  const parsed = parseDiscovery({ candidates: [
    candidate({ canonicalName: "Women's Heritage Festival 2026", organiserName: null, website: "https://www.ticketsza.co.za/", facts: [{ ...fact("Women's Heritage Festival 2026 is scheduled for September 2026.", ["DISCOVERY"]), sourceUrl: "https://www.ticketsza.co.za/" }] }),
    candidate({ canonicalName: "Potch Geesfees", organiserName: null, website: "https://www.tixsa.co.za/events/potch", facts: [{ ...fact("Potch Geesfees is listed for the current season.", ["DISCOVERY"]), sourceUrl: "https://www.tixsa.co.za/events/potch" }] }),
  ] }, "ZA");
  assert.equal(parsed[0].website, null);
  assert.equal(parsed[1].website, null);
  assert.ok(parsed[0].sourceUrls.includes("https://www.ticketsza.co.za/"));
  assert.ok(parsed[1].sourceUrls.includes("https://www.tixsa.co.za/events/potch"));
});

test("unresolved event-first identity remains discovery memory and cannot create an account", () => {
  const unresolved = evaluateDiscoveryCandidate(candidate({ canonicalName: "Unresolved Event", organiserName: null, website: null, facts: [fact("Unresolved Event is scheduled this year.", ["DISCOVERY"])] }), "ZA");
  assert.equal(unresolved.organisationResolution?.status, "UNRESOLVED");
  assert.equal(unresolved.website, null);
  assert.equal(unresolved.prospectIntelligence.accountCreationEligible, false);
  assert.equal(isContactResearchEligible({ status: unresolved.status, relationship: unresolved.relationship, account_id: null, prospect_intelligence: unresolved.prospectIntelligence }), false);
});

test("organiser noun phrasing establishes validation and resolution promotes the commercial target", () => {
  const initial = evaluateDiscoveryCandidate(candidate({ canonicalName: "Event Production Show 2026", organiserName: "Mash Media Group Ltd.", website: "https://www.eventproductionshow.co.uk/", facts: [fact("Mash Media Group Ltd. is the organiser of Event Production Show 2026 at ExCeL London.", ["DISCOVERY"])] }), "GB");
  assert.ok(initial.facts[0].sourceRoles?.includes("VALIDATION"));
  assert.equal(initial.prospectIntelligence.eventConnection.state, "CONFIRMED");
  const promoted = applyDiscoveryEnrichment(initial, {
    organisationResolution: { status: "RESOLVED", canonicalOrganisationName: "Mash Media Group Ltd.", officialWebsite: "https://mashmedia.net/", aliases: ["Mash Media"], confidence: "HIGH", evidence: [{ claim: "Mash Media Group Ltd. is the organiser of Event Production Show 2026.", sourceUrl: "https://www.eventproductionshow.co.uk/about", sourceTitle: "Official organiser information", confidence: "HIGH" }] },
    commercialEvidence: [], facts: [], inferences: [], unknowns: [],
  }, "GB");
  assert.equal(promoted.canonicalName, "Mash Media Group Ltd.");
  assert.equal(promoted.organiserName, "Mash Media Group Ltd.");
  assert.equal(promoted.website, "https://mashmedia.net/");
  assert.equal(promoted.canonicalKey, "mash-media-group-ltd|mashmedia.net");
  assert.ok(promoted.facts.some((item) => /Event Production Show/.test(item.claim)));
  assert.equal(promoted.organisationResolution?.status, "RESOLVED");
});

test("expo terminology remains event evidence after identity promotion", () => {
  const initial = evaluateDiscoveryCandidate(candidate({ canonicalName: "eCommerce Expo 2026", organiserName: "CloserStill Media", facts: [fact("eCommerce Expo 2026 is scheduled for September 2026.", ["DISCOVERY"])] }), "GB");
  const promoted = applyDiscoveryEnrichment(initial, { organisationResolution: { status: "RESOLVED", canonicalOrganisationName: "CloserStill Media", officialWebsite: "https://www.closerstillmedia.com/", aliases: [], confidence: "HIGH", evidence: [{ claim: "CloserStill Media is the organiser of eCommerce Expo 2026.", sourceUrl: "https://www.ecommerceexpo.co.uk/", sourceTitle: "Official event website", confidence: "HIGH" }] }, commercialEvidence: [], facts: [], inferences: [], unknowns: [] }, "GB");
  assert.equal(promoted.organisationResolution?.status, "RESOLVED");
  assert.equal(promoted.prospectIntelligence.eventConnection.state, "CONFIRMED");
  assert.notEqual(promoted.status, "REJECTED");
});

test("the four discovery lanes independently reach identity handoff", () => {
  const eventFirst = evaluateDiscoveryCandidate(candidate({ laneContext: { organisation: null, person: null, venue: null } }), "GB");
  const organisationFirst = evaluateDiscoveryCandidate(candidate({ canonicalName: "Quality Events", organiserName: "Quality Events", origin: "ORGANISATION_FIRST", website: "https://quality.example.org", laneContext: { organisation: { name: "Quality Events", website: "https://quality.example.org" }, person: null, venue: null }, facts: [fact("Quality Events operates an upcoming portfolio of regional festivals.", ["VALIDATION"])] }), "GB");
  const personFirst = evaluateDiscoveryCandidate(candidate({ canonicalName: "Alex Morgan", organiserName: null, website: null, origin: "PERSON_FIRST", laneContext: { organisation: null, person: { name: "Alex Morgan", role: "Event Operations Manager", organisationName: "Quality Events", organisationWebsite: "https://quality.example.org" }, venue: null }, facts: [fact("Alex Morgan is the current Event Operations Manager at Quality Events.", ["VALIDATION"])] }), "GB");
  const venueFirst = evaluateDiscoveryCandidate(candidate({ canonicalName: "The Piece Hall", organiserName: null, website: "https://piecehall.co.uk", origin: "VENUE_FIRST", laneContext: { organisation: null, person: null, venue: { name: "The Piece Hall", website: "https://piecehall.co.uk", operatorName: "The Piece Hall Trust", operatorWebsite: "https://piecehall.co.uk/about" } }, facts: [fact("The Piece Hall hosts an annual events programme and recurring concerts.", ["VALIDATION"])] }), "GB");
  assert.deepEqual(identityHandoffGate(eventFirst), { eligible: true, reason: "EVENT_CONNECTION_REQUIRES_ENRICHMENT" });
  assert.deepEqual(identityHandoffGate(organisationFirst), { eligible: true, reason: "ORGANISATION_FIRST_IDENTITY_CONFIRMATION" });
  assert.deepEqual(identityHandoffGate(personFirst), { eligible: true, reason: "PERSON_FIRST_IDENTITY_CONFIRMATION" });
  assert.deepEqual(identityHandoffGate(venueFirst), { eligible: true, reason: "VENUE_FIRST_IDENTITY_CONFIRMATION" });
});

test("person-first preserves person relationships without claiming event ownership", () => {
  const initial = evaluateDiscoveryCandidate(candidate({ canonicalName: "Alex Morgan", organiserName: null, website: null, origin: "PERSON_FIRST", laneContext: { organisation: null, person: { name: "Alex Morgan", role: "Freelance Event Producer", organisationName: "Alex Morgan Events", organisationWebsite: "https://alexmorgan.example.org" }, venue: null }, facts: [fact("Alex Morgan is a freelance event producer who works on public conferences.", ["VALIDATION"])] }), "GB");
  const resolved = applyDiscoveryEnrichment(initial, { organisationResolution: { status: "RESOLVED", canonicalOrganisationName: "Alex Morgan Events", officialWebsite: "https://alexmorgan.example.org", aliases: [], confidence: "HIGH", evidence: [{ claim: "Alex Morgan Events employs Alex Morgan as a freelance event producer.", sourceUrl: "https://alexmorgan.example.org/about", sourceTitle: "Team", confidence: "HIGH" }] }, commercialEvidence: [], facts: [], inferences: [], unknowns: [] }, "GB");
  assert.equal(resolved.origin, "PERSON_FIRST");
  assert.equal(resolved.laneContext?.person?.name, "Alex Morgan");
  assert.equal(resolved.laneContext?.person?.role, "Freelance Event Producer");
  assert.equal(resolved.canonicalName, "Alex Morgan Events");
  assert.equal(resolved.prospectIntelligence.accountCreationEligible, true);
  assert.match(resolved.prospectIntelligence.eventConnection.reasons[0], /does not assert event ownership/i);
});

test("venue-first can retain an operator while hosting does not become organiser evidence", () => {
  const initial = evaluateDiscoveryCandidate(candidate({ canonicalName: "The Piece Hall", organiserName: null, website: "https://piecehall.co.uk", origin: "VENUE_FIRST", laneContext: { organisation: null, person: null, venue: { name: "The Piece Hall", website: "https://piecehall.co.uk", operatorName: "The Piece Hall Trust", operatorWebsite: "https://piecehall.co.uk/about" } }, facts: [fact("The Piece Hall hosts an annual events programme and recurring concerts.", ["VALIDATION"])] }), "GB");
  assert.equal(initial.prospectIntelligence.eventConnection.state, "STRONG");
  assert.match(initial.prospectIntelligence.eventConnection.reasons[0], /does not prove organising/i);
  const resolved = applyDiscoveryEnrichment(initial, { organisationResolution: { status: "RESOLVED", canonicalOrganisationName: "The Piece Hall Trust", officialWebsite: "https://piecehall.co.uk/about", aliases: ["The Piece Hall"], confidence: "HIGH", evidence: [{ claim: "The Piece Hall Trust operates The Piece Hall venue.", sourceUrl: "https://piecehall.co.uk/about", sourceTitle: "About", confidence: "HIGH" }] }, commercialEvidence: [], facts: [], inferences: [], unknowns: [] }, "GB");
  assert.equal(resolved.laneContext?.venue?.name, "The Piece Hall");
  assert.equal(resolved.canonicalName, "The Piece Hall Trust");
  assert.equal(resolved.prospectIntelligence.accountCreationEligible, true);
});

test("lack of proven pain does not block a resolved lane prospect or create outreach readiness", () => {
  const result = evaluateDiscoveryCandidate(candidate({ canonicalName: "Quality Events", organiserName: "Quality Events", origin: "ORGANISATION_FIRST", website: "https://quality.example.org", laneContext: { organisation: { name: "Quality Events", website: "https://quality.example.org" }, person: null, venue: null }, facts: [fact("Quality Events operates an annual portfolio of public festivals.", ["VALIDATION"])], inferences: [], commercialEvidence: [] }), "GB");
  assert.equal(result.prospectIntelligence.accountCreationEligible, true);
  assert.equal(result.prospectIntelligence.primaryEntryOpportunity, "UNKNOWN");
  assert.equal(result.prospectIntelligence.outreachEligibility, "REVIEW_REQUIRED");
});

test("the shared identity key deduplicates one organisation found through multiple lanes", () => {
  const parsed = parseDiscovery({ candidates: [
    candidate({ canonicalName: "Quality Festival", organiserName: "Quality Events", website: "https://quality.example.org", origin: "EVENT_FIRST", laneContext: { organisation: { name: "Quality Events", website: "https://quality.example.org" }, person: null, venue: null } }),
    candidate({ canonicalName: "Quality Events", organiserName: "Quality Events", website: "https://quality.example.org", origin: "ORGANISATION_FIRST", laneContext: { organisation: { name: "Quality Events", website: "https://quality.example.org" }, person: null, venue: null }, facts: [fact("Quality Events operates an upcoming portfolio of regional festivals.", ["VALIDATION"])] }),
  ] }, "GB");
  assert.equal(parsed.length, 1);
});

test("orchestration lane override preserves the Hyve organisation-first lane through enrichment", () => {
  const parsed = parseDiscovery({ candidates: [{ canonicalName: "Hyve Group", organiserName: "Hyve Group", website: "https://hyve.group", origin: "EVENT_FIRST", relationshipHint: "UNKNOWN", laneContext: { organisation: { name: "Hyve Group", website: "https://hyve.group" }, person: null, venue: null }, facts: [fact("Hyve Group operates an upcoming portfolio of events.", ["VALIDATION"])], inferences: [], unknowns: [], siteClassifications: [] }] }, "GB", "ORGANISATION_FIRST")[0];
  assert.equal(parsed.origin, "ORGANISATION_FIRST");
  const enriched = applyDiscoveryEnrichment(parsed, { organisationResolution: { status: "RESOLVED", canonicalOrganisationName: "Hyve Group", officialWebsite: "https://hyve.group", officialWebsiteSiteType: "ORGANISATION_OFFICIAL", aliases: [], confidence: "HIGH", evidence: [{ claim: "Hyve Group organises its event portfolio.", sourceUrl: "https://hyve.group/about", sourceTitle: "Hyve", confidence: "HIGH" }], siteClassifications: [], relatedOrganisations: [] }, commercialEvidence: [], facts: [], inferences: [], unknowns: [] }, "GB");
  assert.equal(enriched.origin, "ORGANISATION_FIRST");
});

test("eCommerce Expo-style resolution hands commercial research to UPTECH, not the event page", () => {
  const initial = evaluateDiscoveryCandidate(candidate({ canonicalName: "eCommerce Expo 2026", organiserName: "UPTECH Events", website: "https://www.ecommerceexpo.co.uk/", facts: [fact("UPTECH Events is the organiser of eCommerce Expo 2026.", ["DISCOVERY"])] }), "GB");
  const promoted = applyDiscoveryEnrichment(initial, {
    organisationResolution: { status: "RESOLVED", canonicalOrganisationName: "UPTECH Events", officialWebsite: "https://www.uptechevents.com/", aliases: [], confidence: "HIGH", evidence: [{ claim: "UPTECH Events is the organiser of eCommerce Expo 2026.", sourceUrl: "https://www.ecommerceexpo.co.uk/about", sourceTitle: "Organiser information", confidence: "HIGH" }] },
    commercialEvidence: [{ product: "EGS", claim: "UPTECH Events has fragmented event pages across disconnected destinations.", sourceUrl: "https://www.uptechevents.com/events", evidenceCategory: "DISCONNECTED_EVENT_PAGES", confidence: "MEDIUM" }], facts: [], inferences: [], unknowns: [],
  }, "GB");
  assert.equal(promoted.canonicalName, "UPTECH Events");
  assert.equal(promoted.website, "https://www.uptechevents.com/");
  assert.equal(promoted.prospectIntelligence.primaryEntryOpportunity, "EGS");
  assert.equal(promoted.prospectIntelligence.accountCreationEligible, true);
  assert.ok(promoted.facts.some((item) => item.sourceRoles?.includes("COMMERCIAL_EVIDENCE")));
});

test("provider presence and an owned ticketing system alone are not Ticketing pain", () => {
  const provider = evaluateProspectIntelligence({ relationship: "PROSPECT", territory: "GB", facts: [fact("The organiser runs an upcoming event and tickets are sold through Ticketmaster.", ["VALIDATION", "COMMERCIAL_EVIDENCE"])], inferences: [] });
  const owned = evaluateProspectIntelligence({ relationship: "PROSPECT", territory: "GB", facts: [fact("The organiser runs an upcoming event and operates its own ticketing system.", ["VALIDATION", "COMMERCIAL_EVIDENCE"])], inferences: [] });
  assert.notEqual(provider.ticketing.opportunityStrength, "STRONG_HYPOTHESIS");
  assert.equal(owned.ticketing.opportunityStrength, "NO_EVIDENCE");
});

test("validated structured evidence maps product-by-product without weakening negative rules", () => {
  const egs = evaluateProspectIntelligence({ relationship: "PROSPECT", territory: "GB", facts: [fact("The organiser runs an upcoming event.", ["VALIDATION"])], commercialEvidence: [{ product: "EGS", claim: "The organisation has a fragmented owned event destination.", sourceUrl: "https://official.example.org/site", evidenceCategory: "FRAGMENTED_DIGITAL", confidence: "HIGH" }], inferences: [] });
  const ticketing = evaluateProspectIntelligence({ relationship: "PROSPECT", territory: "GB", facts: [fact("The organiser runs an upcoming event.", ["VALIDATION"])], commercialEvidence: [{ product: "TICKETING", claim: "The organisation has multiple fragmented ticket providers and manual reconciliation.", sourceUrl: "https://official.example.org/tickets", evidenceCategory: "PROVIDER_FRAGMENTATION", confidence: "HIGH" }], inferences: [] });
  const ecc = evaluateProspectIntelligence({ relationship: "PROSPECT", territory: "GB", facts: [fact("The organiser runs an upcoming event.", ["VALIDATION"])], commercialEvidence: [{ product: "ECC", claim: "The event has multiple stages, concurrent programming and vendor coordination.", sourceUrl: "https://official.example.org/plan", evidenceCategory: "CONCURRENCY", confidence: "HIGH" }], inferences: [] });
  assert.equal(egs.primaryEntryOpportunity, "EGS");
  assert.equal(ticketing.primaryEntryOpportunity, "TICKETING");
  assert.equal(ecc.primaryEntryOpportunity, "ECC");
});

test("Festival Republic own-ticketing context is downgraded when it lacks problem or change evidence", () => {
  const result = evaluateProspectIntelligence({ relationship: "PROSPECT", territory: "GB", facts: [fact("Festival Republic operates its own ticketing system.", ["VALIDATION", "COMMERCIAL_EVIDENCE"]), fact("Festival Republic organises an upcoming festival.", ["VALIDATION"])], inferences: [] });
  assert.equal(result.ticketing.opportunityStrength, "NO_EVIDENCE");
  assert.equal(result.primaryEntryOpportunity, "UNKNOWN");
});

test("commercial advancement telemetry distinguishes resolution/product progress from technical success", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "test-only-key";
  globalThis.fetch = async () => new Response(JSON.stringify({ output_text: JSON.stringify({ candidates: [{ candidateRef: "1", organisationResolution: { status: "RESOLVED", canonicalOrganisationName: "Resolved Events", officialWebsite: "https://resolved.example.org", aliases: [], confidence: "HIGH", evidence: [{ claim: "Resolved Events is the organiser of the current event.", sourceUrl: "https://event.example.org/about", sourceTitle: "Organiser", confidence: "HIGH" }] }, commercialEvidence: [{ product: "EGS", claim: "The organisation has fragmented event pages.", sourceUrl: "https://resolved.example.org/events", evidenceCategory: "FRAGMENTED_DIGITAL", confidence: "HIGH" }], facts: [], inferences: [], unknowns: [] }] }) }), { status: 200, headers: { "content-type": "application/json" } });
  const initial = evaluateDiscoveryCandidate(candidate({ canonicalName: "Current Event", organiserName: "Current Events", website: null, facts: [fact("Current Event is scheduled this year.", ["DISCOVERY"])] }), "GB");
  const result = await (await import("../src/ai-sales-team/discovery.ts")).enrichDiscoveryCandidates([initial], "GB");
  assert.equal(result.candidates[0].enrichment.status, "SUCCEEDED");
  assert.equal(result.candidates[0].enrichment.resolutionOutcome, "RESOLVED");
  assert.equal(result.candidates[0].enrichment.commercialOutcome, "PRODUCT_SIGNAL_FOUND");
  assert.equal(result.candidates[0].enrichment.commerciallyAdvanced, true);
  assert.equal(result.telemetry.enrichmentMateriallyChangedCount, 1);
  assert.equal(JSON.stringify(result).includes("reasoning"), false);
  process.env.OPENAI_API_KEY = originalKey;
  globalThis.fetch = originalFetch;
});

test("source-site classification keeps provider and directory evidence out of commercial identity", () => {
  assert.equal(classifySourceSite({ url: "https://www.ticketsza.co.za/events/example", claims: ["TicketsZA sells tickets for multiple unrelated events."] }).siteType, "TICKETING_PROVIDER");
  assert.equal(classifySourceSite({ url: "https://www.tixsa.co.za/events/example", claims: ["Tixsa is a ticketing platform."] }).siteType, "TICKETING_PROVIDER");
  assert.equal(classifySourceSite({ url: "https://events.example.org/festival", claims: ["The directory lists events from multiple unrelated organisers."] }).siteType, "EVENT_LISTING_DIRECTORY");
});

test("official event sites are authoritative event evidence but do not automatically become organisation identity", () => {
  const eventSite = classifySourceSite({ url: "https://festival.example.org", claims: ["This is the official event website for Festival X."] });
  assert.equal(eventSite.siteType, "EVENT_OFFICIAL");
  const initial = evaluateDiscoveryCandidate(candidate({ canonicalName: "Festival X", organiserName: null, website: "https://festival.example.org", facts: [fact("This is the official event website for Festival X.", ["DISCOVERY"])] }), "GB");
  const unresolved = applyDiscoveryEnrichment(initial, { organisationResolution: { status: "RESOLVED", canonicalOrganisationName: "Festival X", officialWebsite: "https://festival.example.org", officialWebsiteSiteType: "EVENT_OFFICIAL", aliases: [], confidence: "HIGH", evidence: [{ claim: "This is the official event website for Festival X.", sourceUrl: "https://festival.example.org", sourceTitle: "Official event site", confidence: "HIGH" }] }, commercialEvidence: [], facts: [], inferences: [], unknowns: [] }, "GB");
  assert.equal(unresolved.organisationResolution?.status, "UNRESOLVED");
  assert.equal(unresolved.siteClassifications?.find((item) => item.url === "https://festival.example.org")?.siteType, "EVENT_OFFICIAL");
});

test("separate organiser official site is promoted while the event official site remains evidence", () => {
  const initial = evaluateDiscoveryCandidate(candidate({ canonicalName: "Festival X", organiserName: null, website: "https://festival.example.org", facts: [fact("This is the official event website for Festival X.", ["DISCOVERY"])] }), "GB");
  const resolved = applyDiscoveryEnrichment(initial, { organisationResolution: { status: "RESOLVED", canonicalOrganisationName: "Promoter Group", officialWebsite: "https://promotergroup.example.org", officialWebsiteSiteType: "ORGANISATION_OFFICIAL", aliases: ["Festival X"], confidence: "HIGH", evidence: [{ claim: "Promoter Group is the organiser of Festival X.", sourceUrl: "https://festival.example.org/about", sourceTitle: "About the event", confidence: "HIGH" }], siteClassifications: [{ url: "https://festival.example.org", siteType: "EVENT_OFFICIAL", siteTypeConfidence: "HIGH", siteTypeEvidence: ["This is the official event website."] }, { url: "https://promotergroup.example.org", siteType: "ORGANISATION_OFFICIAL", siteTypeConfidence: "HIGH", siteTypeEvidence: ["Promoter Group official organisation website."] }] }, commercialEvidence: [], facts: [], inferences: [], unknowns: [] }, "GB");
  assert.equal(resolved.organisationResolution?.status, "RESOLVED");
  assert.equal(resolved.website, "https://promotergroup.example.org");
  assert.equal(resolved.siteClassifications?.find((item) => item.url === "https://festival.example.org")?.siteType, "EVENT_OFFICIAL");
  assert.equal(resolved.siteClassifications?.find((item) => item.url === "https://promotergroup.example.org")?.siteType, "ORGANISATION_OFFICIAL");
});

test("event brand can remain the target only with explicit operating-entity evidence", () => {
  const initial = evaluateDiscoveryCandidate(candidate({ canonicalName: "Festival X", organiserName: null, website: "https://festival.example.org", facts: [fact("This is the official event website for Festival X.", ["DISCOVERY"])] }), "GB");
  const resolved = applyDiscoveryEnrichment(initial, { organisationResolution: { status: "RESOLVED", canonicalOrganisationName: "Festival X", officialWebsite: "https://festival.example.org", officialWebsiteSiteType: "EVENT_OFFICIAL", aliases: [], confidence: "HIGH", evidence: [{ claim: "Festival X is itself the operating entity for the event.", sourceUrl: "https://festival.example.org/legal", sourceTitle: "Legal notice", confidence: "HIGH" }] }, commercialEvidence: [], facts: [], inferences: [], unknowns: [] }, "GB");
  assert.equal(resolved.organisationResolution?.status, "RESOLVED");
  assert.equal(resolved.website, "https://festival.example.org");
});

test("venue context does not infer organiser responsibility without authoritative evidence", () => {
  assert.equal(classifySourceSite({ url: "https://venue.example.org/whats-on", claims: ["The venue calendar lists events at the venue."] }).siteType, "VENUE_CALENDAR");
  assert.equal(classifySourceSite({ url: "https://venue.example.org", claims: ["The official venue presents its own programmed event."] }).siteType, "VENUE_OFFICIAL");
});

test("unknown source classification cannot silently become a commercial website", () => {
  const unknown = classifySourceSite({ url: "https://unknown.example.org/page", claims: ["The page contains event information."] });
  assert.equal(unknown.siteType, "UNKNOWN");
  const initial = evaluateDiscoveryCandidate(candidate({ website: "https://unknown.example.org/page", facts: [fact("The page contains event information.", ["DISCOVERY"])] }), "GB");
  const result = applyDiscoveryEnrichment(initial, { organisationResolution: { status: "RESOLVED", canonicalOrganisationName: "Unknown Target", officialWebsite: "https://unknown.example.org/page", officialWebsiteSiteType: "UNKNOWN", aliases: [], confidence: "HIGH", evidence: [{ claim: "Unknown Target is the organiser of the event.", sourceUrl: "https://unknown.example.org/page", sourceTitle: "Event page", confidence: "HIGH" }] }, commercialEvidence: [], facts: [], inferences: [], unknowns: [] }, "GB");
  assert.equal(result.organisationResolution?.status, "UNRESOLVED");
  assert.equal(result.website, null);
});
