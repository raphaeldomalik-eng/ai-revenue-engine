import type { LargeEventReview, PricingModel, ProfessionalServiceGuidance } from "./commercial-model.ts";

export const southAfricaPricing: PricingModel = {
  status: "CURRENT", pricingVersion: "ZA-current", sourceDocuments: ["Existing Event Suite South African commercial data"], currency: "ZAR", vat: "EXCLUSIVE",
  perEventPackages: [
    { name: "Essentials", includedCapabilities: ["event-management", "rsvp", "event-guide-essential-3"], price: 4995 },
    { name: "Ticketed", includedCapabilities: ["event-management", "ticketing", "rsvp", "event-guide-essential-3"], price: 5995 },
    { name: "Growth", includedCapabilities: ["event-management", "ticketing", "rsvp", "event-guide-plus-6"], price: 7995 },
    { name: "Operations", includedCapabilities: ["event-management", "rsvp", "workforce", "production-operations", "event-guide-plus-6"], price: 10995, ticketingOptional: true },
    { name: "Complete", includedCapabilities: ["event-management", "ticketing", "rsvp", "workforce", "production-operations", "event-guide-complete-12"], price: 14995 },
  ],
  growthStudio: { standalone: [{ pages: 3, price: 2495 }, { pages: 6, price: 4495 }, { pages: 12, price: 6995 }], managedFrom: 24950, upgrades: [{ fromPages: 3, toPages: 6, price: 2000 }, { fromPages: 6, toPages: 12, price: 2500 }, { fromPages: 3, toPages: 12, price: 4500 }] },
  ticketing: { paidOrderPercentage: 3.95, paidOrderFee: 2, serviceFee: { threshold: 100, atOrAbove: 7.5, below: 5 }, standaloneMinimum: 995, includedComps: 500, additionalCompFee: 1.5, freeEventPrice: 2495, freeEventIncludedTickets: 1000, externallyPaidImportedTicketFee: 3.5, highVolume: "APPROVED_PRICING_CUSTOM_QUOTE" },
  annualPortfolio: { eventCounts: [4, 8, 12], packages: { Essentials: [4495, 4245, 3995], Ticketed: [5395, 5095, 4795], Growth: [7195, 6795, 6395], Operations: [9895, 9345, 8795], Complete: [13495, 12745, 11995] } },
};

const ukProfessionalServices: ProfessionalServiceGuidance[] = [
  { category: "General", item: "New customer onboarding/account setup", price: 150, unit: "once-off", binding: "NON_BINDING_RECOMMENDATION" },
  { category: "General", item: "Additional configuration/data administration", price: 75, unit: "hour", binding: "NON_BINDING_RECOMMENDATION" },
  { category: "General", item: "Remote product training", price: 85, unit: "hour", binding: "NON_BINDING_RECOMMENDATION" },
  { category: "General", item: "Onsite training", price: { from: 450, to: 750 }, unit: "half-day / full-day", binding: "NON_BINDING_RECOMMENDATION" },
  { category: "General", item: "Standard Event Management setup", price: 150, unit: "event", binding: "NON_BINDING_RECOMMENDATION" },
  { category: "General", item: "Complex multi-product event setup", price: { from: 350, to: 650 }, unit: "event", binding: "NON_BINDING_RECOMMENDATION" },
  { category: "General", item: "Managed event administration", price: { from: 250, to: 500 }, unit: "event", binding: "NON_BINDING_RECOMMENDATION" },
  { category: "Ticketing / RSVP", item: "Standard GA Ticketing setup", price: 150, unit: "event", binding: "NON_BINDING_RECOMMENDATION" },
  { category: "Ticketing / RSVP", item: "Timed-entry / multi-day Ticketing", price: 250, unit: "event", binding: "NON_BINDING_RECOMMENDATION" },
  { category: "Ticketing / RSVP", item: "Seated Ticketing", price: { from: 450 }, unit: "event", binding: "NON_BINDING_RECOMMENDATION" },
  { category: "Ticketing / RSVP", item: "Scanner configuration/pre-event test", price: 75, unit: "event", binding: "NON_BINDING_RECOMMENDATION" },
  { category: "Ticketing / RSVP", item: "Event-day Ticketing lead", price: 450, unit: "day", binding: "NON_BINDING_RECOMMENDATION" },
  { category: "Ticketing / RSVP", item: "Ticket/check-in Operator", price: 30, unit: "hour/person; 5-hour minimum", binding: "NON_BINDING_RECOMMENDATION" },
  { category: "Ticketing / RSVP", item: "Post-event report/reconciliation support", price: 95, unit: "event", binding: "NON_BINDING_RECOMMENDATION" },
  { category: "Ticketing / RSVP", item: "Standard RSVP setup", price: 150, unit: "event", binding: "NON_BINDING_RECOMMENDATION" },
  { category: "Ticketing / RSVP", item: "Guest-list preparation/import", price: 125, unit: "event", binding: "NON_BINDING_RECOMMENDATION" },
  { category: "Ticketing / RSVP", item: "Invitation campaign setup", price: 95, unit: "campaign", binding: "NON_BINDING_RECOMMENDATION" },
  { category: "Ticketing / RSVP", item: "RSVP/guest-desk lead", price: 350, unit: "day", binding: "NON_BINDING_RECOMMENDATION" },
  { category: "Workforce / Production", item: "Workforce setup up to 50 people", price: 250, unit: "event", binding: "NON_BINDING_RECOMMENDATION" },
  { category: "Workforce / Production", item: "Workforce setup 51-150", price: 450, unit: "event", binding: "NON_BINDING_RECOMMENDATION" },
  { category: "Workforce / Production", item: "Rostering / Workforce administration", price: 75, unit: "hour", binding: "NON_BINDING_RECOMMENDATION" },
  { category: "Workforce / Production", item: "Event-day Workforce coordinator", price: 450, unit: "day", binding: "NON_BINDING_RECOMMENDATION" },
  { category: "Workforce / Production", item: "Production Operations standard setup", price: 350, unit: "event", binding: "NON_BINDING_RECOMMENDATION" },
  { category: "Workforce / Production", item: "Ops Sheet preparation / issue support", price: 250, unit: "event", binding: "NON_BINDING_RECOMMENDATION" },
  { category: "Workforce / Production", item: "Complex Production Operations implementation", price: { from: 750 }, unit: "event", binding: "NON_BINDING_RECOMMENDATION" },
  { category: "Workforce / Production", item: "Event-day Production Operations lead", price: 550, unit: "day", binding: "NON_BINDING_RECOMMENDATION" },
  { category: "Hardware", item: "Scanner rental", price: 30, unit: "device/day", binding: "NON_BINDING_RECOMMENDATION" },
  { category: "Hardware", item: "Device setup/deployment", price: 75, unit: "event", binding: "NON_BINDING_RECOMMENDATION" },
  { category: "Hardware", item: "POS deployment/configuration", price: 75, unit: "device; hardware excluded", binding: "NON_BINDING_RECOMMENDATION" },
];

const ukLargeEventReview: LargeEventReview = { semantics: "REVIEW_NOT_SURCHARGE", triggers: { uniqueAttendees: 10000, paidTicketsOrItems: 20000, ticketingGmv: "GBP 250,000+", workforceRecords: 500, concurrentCheckInPoints: 20, operatingDurationDays: 7, distinctVenuesOrSites: 5, campaignAudience: 25000, unusualSettlementOrOperationalRisk: "ALWAYS_REVIEW" } };

export const unitedKingdomPricing: PricingModel = {
  status: "PROPOSED", pricingVersion: "UK-1.0", sourceDate: "2026-08", sourceDocuments: ["Event Suite Local Operator Network — United Kingdom Pricing & Commercial Guide", "Event Suite Local Operator Network — United Kingdom Partner Opportunity Guide v1.1"], currency: "GBP", vat: "EXCLUSIVE",
  perEventPackages: [
    { name: "Event Essentials", includedCapabilities: ["event-management", "rsvp", "event-guide-essential-3"], price: 495, operatorDeliveryPrice: 396, operatorOriginatedCommission: 99 },
    { name: "Ticketed Event", includedCapabilities: ["event-management", "ticketing", "rsvp", "event-guide-essential-3"], price: 595, operatorDeliveryPrice: 476, operatorOriginatedCommission: 119 },
    { name: "Event Growth", includedCapabilities: ["event-management", "ticketing", "rsvp", "event-guide-plus-6"], price: 795, operatorDeliveryPrice: 636, operatorOriginatedCommission: 159 },
    { name: "Event Operations", includedCapabilities: ["event-management", "rsvp", "workforce", "production-operations", "event-guide-plus-6"], price: 1095, operatorDeliveryPrice: 876, operatorOriginatedCommission: 219, ticketingOptional: true },
    { name: "Complete Event Suite", includedCapabilities: ["event-management", "ticketing", "rsvp", "workforce", "production-operations", "event-guide-complete-12"], price: 1495, operatorDeliveryPrice: 1196, operatorOriginatedCommission: 299 },
  ],
  growthStudio: { standalone: [{ pages: 3, price: 249, operatorDeliveryPrice: 199 }, { pages: 6, price: 449, operatorDeliveryPrice: 359 }, { pages: 12, price: 699, operatorDeliveryPrice: 559 }], managedFrom: 2495, upgrades: [{ fromPages: 3, toPages: 6, price: 200 }, { fromPages: 6, toPages: 12, price: 250 }, { fromPages: 3, toPages: 12, price: 450 }] },
  ticketing: { corePercentage: 2, servicingPercentage: 1, servicingCapPerTicket: 1, paymentProcessing: "SEPARATE", freeStandardServiceFee: 0, importedExternallyPaidTicket: "CURRENT_RATE_CARD_OR_APPROVED_QUOTE", highVolume: "APPROVED_CUSTOM_COMMERCIAL_TERMS" },
  annualPortfolio: { eventCounts: ["1-3", 4, 8, "12+"], packages: { "Event Essentials": [495, 449, 425, 395], "Ticketed Event": [595, 539, 505, 475], "Event Growth": [795, 719, 675, 635], "Event Operations": [1095, 989, 930, 875], "Complete Event Suite": [1495, 1349, 1270, 1195] } },
  operatorEconomics: { packageCommissionPercentage: 20, packageCommissionBasis: "Qualifying net Event Suite Event Package revenue actually collected for an Operator-originated customer.", exclusions: ["Ticketing service fees", "VAT", "Communications usage", "Hardware", "Third-party charges", "Operator professional services"], operatorDeliveryPriceIsSeparatePurchase: true, noSelfCommissionOnOperatorManagedPurchase: true, operatorOriginatedTicketingServicingPercentage: 1, operatorOriginatedTicketingServicingCap: 1, assignedOperatorServicingPercentage: 0.5, assignedOperatorServicingCap: 0.5, assignedOperatorServicingAllocation: "50% of standard servicing component while assigned; equivalent to 0.5% capped at £0.50/ticket", professionalServicesRevenuePercentage: 100 },
  portfolioRules: { commitmentPeriod: "12_MONTHS", contractedPer: "EVENT_ENTITLEMENT", additionalEventsUseContractedPortfolioFee: true, upgradesUseApplicablePriceDifference: true, paymentCadence: "YEARLY_OR_MONTHLY_AGAINST_COMMITMENT", rolloverOnRenewal: { "4": { events: 1, days: 90 }, "8": { events: 2, days: 90 }, "12+": { events: 3, days: 90 } }, originatingOperatorCommissionPercentage: 20, commissionDecay: "NONE", assignedPortfolioSupportSharePercentage: 10 },
  channelPriceProtection: ["Standard customer-facing Ticketing tariff is channel-neutral.", "Direct should not standardly undercut the Local Operator standard customer price.", "Protected Operator-originated opportunities should not receive competing Direct quotes designed to bypass the Operator.", "Major-event/enterprise discounts require channel-impact review."],
  operatorParticipation: { applicationFee: 0, joiningFee: 0, workspace: "INCLUDED_FOR_APPROVED_ACTIVE_OPERATORS", demoEnvironment: "ONE_NON_COMMERCIAL_INCLUDED", commercialCustomerEvents: "BILLABLE", ownCommercialEvents: "OPERATOR_DELIVERY_PRICE", selfCommissionAllowed: false, professionalServicesRevenuePercentage: 100 },
  professionalServices: ukProfessionalServices, largeEventReview: ukLargeEventReview,
  configurableItems: ["Additional campaign-email pricing", "SMS pricing", "WhatsApp pricing", "Premium payment-method markups", "Final major-account Ticketing rates", "Territory/operator/high-volume Ticketing adjustments", "Enterprise Event Portfolio pricing", "Recurring event-series pricing", "Event Assurance pricing and scope"],
  notes: "PROPOSED owner input. Prices may move and may be superseded by a later UK pricing version. Professional service prices are non-binding operator recommendations and separate from Event Suite platform pricing.",
};
