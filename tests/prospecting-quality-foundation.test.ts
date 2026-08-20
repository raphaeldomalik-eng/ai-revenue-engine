import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { applyDiscoveryEnrichment, canonicalDiscoveryKey, evaluateDiscoveryCandidate, parseDiscovery } from "../src/ai-sales-team/discovery.ts";
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
    organisationResolution: { status: "RESOLVED", canonicalOrganisationName: "Mash Media Group Ltd.", officialWebsite: "https://www.mashmedia.co.uk/", aliases: ["Mash Media"], confidence: "HIGH", evidence: [{ claim: "Mash Media Group Ltd. is the organiser of Event Production Show 2026.", sourceUrl: "https://www.eventproductionshow.co.uk/about", sourceTitle: "Official organiser information", confidence: "HIGH" }] },
    commercialEvidence: [], facts: [], inferences: [], unknowns: [],
  }, "GB");
  assert.equal(promoted.canonicalName, "Mash Media Group Ltd.");
  assert.equal(promoted.organiserName, "Mash Media Group Ltd.");
  assert.equal(promoted.website, "https://www.mashmedia.co.uk/");
  assert.equal(promoted.canonicalKey, "mash-media-group-ltd|mashmedia.co.uk");
  assert.ok(promoted.facts.some((item) => /Event Production Show/.test(item.claim)));
  assert.equal(promoted.organisationResolution?.status, "RESOLVED");
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
  const initial = evaluateDiscoveryCandidate(candidate({ canonicalName: "Current Event", organiserName: null, website: null, facts: [fact("Current Event is scheduled this year.", ["DISCOVERY"])] }), "GB");
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
