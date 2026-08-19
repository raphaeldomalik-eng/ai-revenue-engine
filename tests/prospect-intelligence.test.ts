import assert from "node:assert/strict";
import test from "node:test";
import { classifyAccountRelationship } from "../src/ai-sales-team/outreach-model.ts";
import { evaluateProspectIntelligence } from "../src/ai-sales-team/prospect-intelligence.ts";
import type { AiSalesEvidence } from "../src/ai-sales-team/model.ts";

const fact = (claim: string, sourceUrl = "https://example.org/event"): AiSalesEvidence => ({ claim, sourceUrl, sourceTitle: "Public event page", kind: "FACT", confidence: "HIGH" });
const assess = (name: string, claims: string[], relationship: "PROSPECT" | "COMPETITOR" = "PROSPECT") => evaluateProspectIntelligence({ relationship, territory: "ZA", facts: claims.map((claim) => fact(claim)), inferences: [], unknowns: [] });

test("Wits MIND topic overlap does not create an EventSuite opportunity", () => {
  const result = assess("Wits MIND", ["The institute researches artificial intelligence and machine learning."]);
  assert.equal(result.eventConnection.state, "NONE");
  assert.equal(result.primaryEntryOpportunity, "UNKNOWN");
  assert.equal(result.outreachEligibility, "BLOCKED");
  assert.equal(result.salesMotion, "DIRECT");
  assert.equal(result.eventConnection.evidence.length, 0);
});

test("a university with actual conferences can qualify from event evidence", () => {
  const result = assess("Wits University", ["The university hosts annual research conferences and public symposiums.", "The conference programme includes multiple sessions and registration."]);
  assert.equal(result.eventConnection.state, "CONFIRMED");
  assert.equal(result.primaryEntryOpportunity, "TICKETING");
  assert.equal(result.ticketing.opportunityStrength, "STRONG_HYPOTHESIS");
  assert.equal(result.outreachEligibility, "ELIGIBLE");
  assert.equal(result.salesMotion, "DIRECT");
});

test("small Afrikaans festival keeps EGS primary without a size penalty", () => {
  const result = assess("Example Festival", ["Annual regional festival with a strong audience and recurring paid tickets.", "Public communications are predominantly Afrikaans and event information is fragmented across social channels and a ticket-provider page.", "The event is multi-day with multiple stages, vendors and performers."]);
  assert.equal(result.eventConnection.state, "CONFIRMED");
  assert.equal(result.primaryEntryOpportunity, "EGS");
  assert.equal(result.egs.opportunityStrength, "STRONG_HYPOTHESIS");
  assert.equal(result.ticketing.opportunityStrength, "STRONG_HYPOTHESIS");
  assert.equal(result.ecc.opportunityStrength, "STRONG_HYPOTHESIS");
  assert.equal(result.preferredOutreachLanguage, "AF");
  assert.equal(result.commercialPriority, "HIGH");
  assert.equal(result.outreachEligibility, "ELIGIBLE");
});

test("ticketing platform is blocked while its organiser customer remains a prospect", () => {
  const competitor = assess("Quicket", ["We provide event ticketing software and services."], "COMPETITOR");
  assert.equal(competitor.outreachEligibility, "BLOCKED");
  const customer = assess("Regional Festival", ["The festival runs an annual paid event using another ticketing provider.", "Event information is fragmented across public channels."]);
  assert.equal(customer.outreachEligibility, "ELIGIBLE");
  assert.equal(customer.relationship, "PROSPECT");
});

test("generic large corporation with no event evidence stays unqualified", () => {
  const result = assess("Large Technology Corporation", ["The corporation is a large technology business with AI research." ]);
  assert.equal(result.eventConnection.state, "NONE");
  assert.equal(result.primaryEntryOpportunity, "UNKNOWN");
  assert.equal(result.outreachEligibility, "BLOCKED");
});

test("direct prospect motion never becomes partnership motion from shared subject matter", () => {
  const relationship = classifyAccountRelationship({ name: "AI Research Prospect", summary: "The organisation researches AI.", qualificationFit: "HIGH" });
  const result = evaluateProspectIntelligence({ relationship: relationship.relationship, territory: "ZA", facts: [fact("The organisation hosts an annual public conference.")], inferences: [], unknowns: [] });
  assert.equal(result.relationship, "PROSPECT");
  assert.equal(result.salesMotion, "DIRECT");
  assert.equal(result.eventConnection.state, "CONFIRMED");
});
