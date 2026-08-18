import { assessLeadIntelligence } from "./assessment.ts";
import type { LeadIntelligenceAssessment, LeadIntelligenceInput, ResearchEvidence } from "./model.ts";

function fact(id: string, observedFact: string, sourceReference: string): ResearchEvidence {
  return { id, sourceType: "OWNER_INPUT", sourceReference, title: "Scenario fact", observedFact, observedAt: "2026-08-18", confidence: "HIGH", kind: "FACT" };
}

function scenario(name: string, input: LeadIntelligenceInput) { return { name, input, assessment: assessLeadIntelligence(input) }; }

export const leadIntelligenceFixtures: Array<{ name: string; input: LeadIntelligenceInput; assessment: LeadIntelligenceAssessment }> = [
  scenario("South African school", {
    account: { organisationName: "Example High School", country: "South Africa", city: "Johannesburg", organisationType: "SCHOOL", eventActivity: "RUNS_EVENTS", eventFrequency: "RECURRING", estimatedEventsPerYear: 12, operationalNeeds: ["Event coordination", "RSVP"], sourceEvidenceIds: ["school-1", "school-2", "school-3"] },
    evidence: [fact("school-1", "Example High School is in South Africa.", "fixture:school:territory"), fact("school-2", "The organisation is a school.", "fixture:school:type"), fact("school-3", "The school runs recurring events.", "fixture:school:events")],
  }),
  scenario("South African high-frequency venue", {
    account: { organisationName: "Example Events Venue", country: "South Africa", region: "Gauteng", organisationType: "VENUE", eventActivity: "RUNS_EVENTS", eventFrequency: "HIGH_FREQUENCY", estimatedEventsPerYear: 120, operationalNeeds: ["Workforce coordination", "Production Operations planning"], sourceEvidenceIds: ["venue-1", "venue-2", "venue-3"] },
    evidence: [fact("venue-1", "Example Events Venue is in South Africa.", "fixture:venue:territory"), fact("venue-2", "The organisation is a venue.", "fixture:venue:type"), fact("venue-3", "The venue hosts many recurring events with workforce and production needs.", "fixture:venue:events")],
  }),
  scenario("UK promoter with existing Ticketing", {
    account: { organisationName: "Example UK Promoter", country: "United Kingdom", organisationType: "EVENT_PROMOTER", eventActivity: "RUNS_EVENTS", eventFrequency: "RECURRING", estimatedEventsPerYear: 18, currentSystems: { ticketingProvider: "Existing Ticketing Provider" }, operationalNeeds: ["Event operations", "Growth and discoverability"], sourceEvidenceIds: ["promoter-1", "promoter-2", "promoter-3", "promoter-4"] },
    evidence: [fact("promoter-1", "Example UK Promoter is in the United Kingdom.", "fixture:promoter:territory"), fact("promoter-2", "The organisation is an event promoter.", "fixture:promoter:type"), fact("promoter-3", "The promoter runs recurring events.", "fixture:promoter:events"), fact("promoter-4", "The promoter uses an existing Ticketing provider.", "fixture:promoter:systems")],
  }),
  scenario("South African event services company", {
    account: { organisationName: "Example Event Services Company", country: "South Africa", organisationType: "EVENT_SERVICES_COMPANY", eventActivity: "SERVICES_EVENT_ORGANISERS", localNetworkSignal: true, customerServicingCapability: true, sourceEvidenceIds: ["services-1", "services-2", "services-3"] },
    evidence: [fact("services-1", "Example Event Services Company is in South Africa.", "fixture:services:territory"), fact("services-2", "The company serves multiple event organisers.", "fixture:services:network"), fact("services-3", "The company can source and service customers.", "fixture:services:capability")],
  }),
  scenario("South African agency with Direct and LNO potential", {
    account: { organisationName: "Example Event Agency", country: "South Africa", organisationType: "EVENT_AGENCY", eventActivity: "RUNS_AND_SERVICES", eventFrequency: "RECURRING", estimatedEventsPerYear: 24, localNetworkSignal: true, customerServicingCapability: true, operationalNeeds: ["Event operations"], sourceEvidenceIds: ["agency-1", "agency-2", "agency-3", "agency-4"] },
    evidence: [fact("agency-1", "Example Event Agency is in South Africa.", "fixture:agency:territory"), fact("agency-2", "The agency runs its own recurring events.", "fixture:agency:events"), fact("agency-3", "The agency services external event organisers.", "fixture:agency:services"), fact("agency-4", "The agency has a relevant local network and servicing capability.", "fixture:agency:network")],
  }),
  scenario("Insufficient information", {
    account: { organisationName: "Unresearched Organisation", sourceEvidenceIds: [] },
    evidence: [],
  }),
];
