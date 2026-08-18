import type { PricingModel } from "./commercial-model.ts";

export const southAfricaPricing: PricingModel = {
  status: "CURRENT", currency: "ZAR", vat: "EXCLUSIVE",
  perEventPackages: [
    { name: "Essentials", includedCapabilities: ["event-management", "rsvp", "event-guide-essential-3"], priceZar: 4995 },
    { name: "Ticketed", includedCapabilities: ["event-management", "ticketing", "rsvp", "event-guide-essential-3"], priceZar: 5995 },
    { name: "Growth", includedCapabilities: ["event-management", "ticketing", "rsvp", "event-guide-plus-6"], priceZar: 7995 },
    { name: "Operations", includedCapabilities: ["event-management", "rsvp", "workforce", "production-operations", "event-guide-plus-6"], priceZar: 10995, ticketingOptional: true },
    { name: "Complete", includedCapabilities: ["event-management", "ticketing", "rsvp", "workforce", "production-operations", "event-guide-complete-12"], priceZar: 14995 },
  ],
  growthStudio: { standalone: [{ pages: 3, priceZar: 2495 }, { pages: 6, priceZar: 4495 }, { pages: 12, priceZar: 6995 }], managedFromZar: 24950, upgrades: [{ fromPages: 3, toPages: 6, priceZar: 2000 }, { fromPages: 6, toPages: 12, priceZar: 2500 }, { fromPages: 3, toPages: 12, priceZar: 4500 }] },
  ticketing: { paidOrderPercentage: 3.95, paidOrderFeeZar: 2, serviceFee: { thresholdZar: 100, atOrAboveZar: 7.5, belowZar: 5 }, standaloneMinimumZar: 995, includedComps: 500, additionalCompFeeZar: 1.5, freeEventPriceZar: 2495, freeEventIncludedTickets: 1000, externallyPaidImportedTicketFeeZar: 3.5, highVolume: "APPROVED_PRICING_CUSTOM_QUOTE" },
  annualPortfolio: { eventCounts: [4, 8, 12], packages: { Essentials: [4495, 4245, 3995], Ticketed: [5395, 5095, 4795], Growth: [7195, 6795, 6395], Operations: [9895, 9345, 8795], Complete: [13495, 12745, 11995] } },
};

export const unitedKingdomPricing: PricingModel = { status: "DEFERRED", currency: "GBP", notes: "UK pricing is intentionally unresolved; do not infer or copy South African prices." };
