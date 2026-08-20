import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { applyDiscoveryEnrichment, canonicalDiscoveryKey, evaluateDiscoveryCandidate, parseDiscovery } from "../src/ai-sales-team/discovery.ts";
import { evaluateProspectIntelligence } from "../src/ai-sales-team/prospect-intelligence.ts";

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
