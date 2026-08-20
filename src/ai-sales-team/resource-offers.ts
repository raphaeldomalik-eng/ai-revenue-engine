import type { ProspectOpportunity } from "./prospect-intelligence.ts";

export type ResourceOffer = {
  available: boolean;
  title: string;
  resourceType: string;
  canonicalUrl: string;
  relevanceReason: string;
  matchedEventType: string | null;
  matchedProblem: string;
  matchedBuyerRole: string | null;
};

export const EVENTSUITE_ORIGIN = "https://www.eventsuite.pro";
export const EVENTSUITE_LANDING_URL = `${EVENTSUITE_ORIGIN}/`;
export const RESOURCE_CENTRE_URL = `${EVENTSUITE_ORIGIN}/resources`;

// Curated from EventSuite's canonical English Resource Family catalogue.
// Keep this deliberately small: it is a sales-routing manifest, not a catalogue sync.
const RESOURCES = {
  marketing: {
    title: "Event Website Content Planner",
    resourceType: "spreadsheet-template",
    canonicalUrl: `${EVENTSUITE_ORIGIN}/resources/templates/event-website-content-planner`,
    matchedProblem: "event marketing and discoverability",
  },
  ticketing: {
    title: "Ticket Sales And Registration Forecast",
    resourceType: "spreadsheet-template",
    canonicalUrl: `${EVENTSUITE_ORIGIN}/resources/templates/ticket-sales-and-registration-forecast`,
    matchedProblem: "ticket sales and event revenue planning",
  },
  festivalOperations: {
    title: "Festival Vendor Management Checklist",
    resourceType: "checklist",
    canonicalUrl: `${EVENTSUITE_ORIGIN}/resources/checklists/festival-vendor-management-checklist`,
    matchedProblem: "festival event operations",
  },
  conferenceOperations: {
    title: "Conference Registration Checklist",
    resourceType: "checklist",
    canonicalUrl: `${EVENTSUITE_ORIGIN}/resources/checklists/conference-registration-checklist`,
    matchedProblem: "conference planning and registration operations",
  },
  operations: {
    title: "Event Day Readiness Signoff Workbook",
    resourceType: "workbook",
    canonicalUrl: `${EVENTSUITE_ORIGIN}/resources/templates/event-day-readiness-signoff-workbook`,
    matchedProblem: "event operations and readiness",
  },
} as const;

function offer(resource: (typeof RESOURCES)[keyof typeof RESOURCES], eventType: string | null, buyerRole: string | null): ResourceOffer {
  return { available: true, ...resource, relevanceReason: `Matched to the evidenced ${resource.matchedProblem}.`, matchedEventType: eventType, matchedBuyerRole: buyerRole };
}

export function selectResourceOffer(input: { primary: ProspectOpportunity; claims: string[]; buyerRoles: string[] }): ResourceOffer {
  const text = input.claims.join(" ").toLowerCase();
  const buyerRole = input.buyerRoles[0] ?? null;
  if (input.primary === "EGS") return offer(RESOURCES.marketing, /festival/.test(text) ? "festival" : null, buyerRole);
  if (input.primary === "TICKETING") return offer(RESOURCES.ticketing, /promoter|concert|festival|live music/.test(text) ? "live-event" : null, buyerRole);
  if (input.primary === "ECC" && /festival/.test(text)) return offer(RESOURCES.festivalOperations, "festival", buyerRole);
  if (input.primary === "ECC" && /conference|university|symposium|congress/.test(text)) return offer(RESOURCES.conferenceOperations, "conference", buyerRole);
  if (input.primary === "ECC") return offer(RESOURCES.operations, null, buyerRole);
  return { available: true, title: "EventSuite Resource Centre", resourceType: "resource-centre", canonicalUrl: RESOURCE_CENTRE_URL, relevanceReason: "No individually verified resource match is safe; use the canonical Resource Centre instead.", matchedEventType: null, matchedProblem: "general event planning", matchedBuyerRole: buyerRole };
}

export const RESOURCE_CENTRE_MANIFEST_SIZE = Object.keys(RESOURCES).length;
