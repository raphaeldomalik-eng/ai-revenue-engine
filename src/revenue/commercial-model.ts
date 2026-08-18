export type ProductSlug = "event-suite" | string;
export type TerritoryCode = "ZA" | "GB" | string;
export type SalesMotion = "direct" | "lno" | string;

export type PlaybookStatus = "DRAFT" | "ACTIVE" | "RETIRED";
export type ReadinessState = "YES" | "NO" | "PARTIAL" | "CURRENT" | "DEFERRED";
export type ConversionGoal = "SELF_SERVICE" | "QUALIFIED_LIVE_DEMO" | "BUSINESS_OPPORTUNITY_ENQUIRY";
export type ClaimCategory = "FEATURE" | "ADVANTAGE" | "SALES_WEDGE" | "DEFENSIBLE_DIFFERENTIATOR";
export type ClaimStrength = "DEFENSIBLE" | "ADVANTAGE" | "COMMODITY" | "HYPOTHESIS" | "PROHIBITED";
export type EvidenceConfidence = "NONE" | "LOW" | "MEDIUM" | "HIGH";

export type CommercialClaim = {
  id: string;
  category: ClaimCategory;
  strength: ClaimStrength;
  conciseClaim: string;
  whatIsDifferent: string;
  customerProblem: string;
  relevantCapabilities: string[];
  relevantClientTypes: string[];
  territoryRelevance: TerritoryCode[];
  supportingEvidence: string[];
  competitorComparisonStatus: "NOT_RESEARCHED" | "PARTIAL" | "EVIDENCE_BACKED";
  evidenceConfidence: EvidenceConfidence;
  approvedWording?: string;
  prohibitedWording?: string[];
  notes?: string;
};

export type CommercialProblem = { id: string; label: string; notes: string };
export type CommercialCapability = { id: string; label: string; group: "GROW" | "MANAGE" | "RUN" };
export type CommercialOffer = { id: string; label: string; description: string; conversionGoals: readonly ConversionGoal[] };
export type PricingModel =
  | { status: "CURRENT"; currency: "ZAR"; vat: "EXCLUSIVE"; perEventPackages: PerEventPackage[]; growthStudio: GrowthStudioPricing; ticketing: TicketingPricing; annualPortfolio: AnnualPortfolioPricing }
  | { status: "DEFERRED"; currency: "GBP"; notes: string };

export type PerEventPackage = { name: "Essentials" | "Ticketed" | "Growth" | "Operations" | "Complete"; includedCapabilities: string[]; priceZar: number; ticketingOptional?: boolean };
export type GrowthStudioPricing = { standalone: { pages: 3 | 6 | 12; priceZar: number }[]; managedFromZar: number; upgrades: { fromPages: 3 | 6; toPages: 6 | 12; priceZar: number }[] };
export type TicketingPricing = { paidOrderPercentage: number; paidOrderFeeZar: number; serviceFee: { thresholdZar: number; atOrAboveZar: number; belowZar: number }; standaloneMinimumZar: number; includedComps: number; additionalCompFeeZar: number; freeEventPriceZar: number; freeEventIncludedTickets: number; externallyPaidImportedTicketFeeZar: number; highVolume: "APPROVED_PRICING_CUSTOM_QUOTE" };
export type AnnualPortfolioPricing = { eventCounts: [4, 8, 12]; packages: Record<PerEventPackage["name"], [number, number, number]> };
export type ChannelGuidance = { isChannelOpportunity: boolean; primaryConversion: ConversionGoal; networkLayers?: number; originatingPortfolioCommissionPercentage?: number; commissionNotes: string };

export type PlaybookReadiness = {
  playbook: PlaybookStatus;
  pricing: ReadinessState;
  icpPriority: ReadinessState;
  differentiationEvidence: ReadinessState;
  outreachReady: "YES" | "NO";
};

export type CommercialPlaybook = {
  id: string;
  product: ProductSlug;
  productLabel: string;
  territory: TerritoryCode;
  territoryLabel: string;
  salesMotion: SalesMotion;
  status: PlaybookStatus;
  version: string;
  phase: "EVENT_OPERATIONS" | string;
  targetClientTypes: string[];
  targetRoles: string[];
  targetCharacteristics: string[];
  problems: CommercialProblem[];
  capabilityRelevance: CommercialCapability[];
  valuePropositions: string[];
  entryOffers: CommercialOffer[];
  conversionGoals: ConversionGoal[];
  allowedClaims: CommercialClaim[];
  prohibitedClaims: CommercialClaim[];
  differentiationHypotheses: CommercialClaim[];
  objections: string[];
  pricingGuidance: PricingModel;
  channelGuidance?: ChannelGuidance;
  evidenceRequirements: string[];
  territoryConsiderations: string[];
  qualificationConsiderations: string[];
  routeToConversionConsiderations: string[];
  humanEscalationPoints: string[];
  unresolvedDecisions: string[];
  readiness: PlaybookReadiness;
};
