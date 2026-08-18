import type { ConversionGoal, EvidenceConfidence, PricingStatus, ProductSlug, SalesMotion, TerritoryCode } from "../revenue/commercial-model.ts";

export type UnknownValue = "UNKNOWN";
export type EvidenceKind = "FACT" | "INFERENCE";
export type EvidenceSourceType = "WEBSITE" | "PUBLIC_REGISTRY" | "OWNER_INPUT" | "CUSTOMER_INPUT" | "DOCUMENT" | "OTHER";
export type EventFrequency = "UNKNOWN" | "ONE_OFF" | "OCCASIONAL" | "RECURRING" | "HIGH_FREQUENCY";
export type MotionCandidate = "DIRECT" | "LNO" | "BOTH" | "UNKNOWN";
export type OpportunityConversionRoute = ConversionGoal | "UNDETERMINED";
export type OpportunityConversionRouteStatus = "FIXED" | "UNDETERMINED";
export type OpportunityConfidence = EvidenceConfidence | "UNKNOWN";

export type ResearchEvidence = {
  id: string;
  sourceType: EvidenceSourceType;
  sourceReference: string;
  title: string;
  observedFact: string;
  observedAt: string;
  confidence: EvidenceConfidence;
  kind: EvidenceKind;
  notes?: string;
};

export type ContactProfile = {
  id?: string;
  accountId?: string;
  name?: string;
  roleTitle?: string;
  seniority?: string;
  likelyDecisionRole?: string;
  email?: string;
  phone?: string;
  evidenceIds: string[];
  verificationState: "UNKNOWN" | "UNVERIFIED" | "VERIFIED";
};

export type OrganisationType =
  | "SCHOOL"
  | "VENUE"
  | "EVENT_PROMOTER"
  | "EVENT_AGENCY"
  | "CONFERENCE_ORGANISER"
  | "FESTIVAL_ORGANISER"
  | "EVENT_SERVICES_COMPANY"
  | "PRODUCTION_COMPANY"
  | "TICKETING_SUPPLIER"
  | "WORKFORCE_PROVIDER"
  | "DIGITAL_AGENCY"
  | "EVENT_TECHNOLOGY_SUPPLIER"
  | UnknownValue;

export type EventActivity = "UNKNOWN" | "RUNS_EVENTS" | "SERVICES_EVENT_ORGANISERS" | "RUNS_AND_SERVICES";

export type AccountProfile = {
  id?: string;
  organisationName: string;
  website?: string;
  domain?: string;
  country?: string;
  region?: string;
  city?: string;
  organisationType?: OrganisationType;
  industrySector?: string;
  sizeSignals?: string[];
  eventActivity?: EventActivity;
  eventFrequency?: EventFrequency;
  estimatedEventsPerYear?: number;
  currentSystems?: { ticketingProvider?: string; otherSystems?: string[] };
  operationalNeeds?: string[];
  localNetworkSignal?: boolean;
  customerServicingCapability?: boolean;
  sourceEvidenceIds: string[];
  lastResearchedDate?: string;
};

export type CommercialSignal = {
  code: string;
  state: "PRESENT" | "ABSENT" | "UNKNOWN";
  value?: string | number | boolean;
  confidence: OpportunityConfidence;
  evidenceIds: string[];
  source: string;
  notes?: string;
};

export type ClientSegmentMatch = {
  code: string;
  label: string;
  matchType: "CLIENT_TYPE" | "PLAYBOOK_SEGMENT";
  confidence: OpportunityConfidence;
  evidenceIds: string[];
  commercialTreatment?: string;
  pricingStatus?: PricingStatus | UnknownValue;
  pricingInstruction?: string;
};

export type CommercialProgramMatch = {
  product: ProductSlug;
  territory: TerritoryCode;
  salesMotion: Exclude<SalesMotion, string> | "direct" | "lno";
  playbookId: string;
  playbookLabel: string;
  conversionGoals: ConversionGoal[];
  confidence: OpportunityConfidence;
  evidenceIds: string[];
};

export type ResearchGap = {
  code: string;
  label: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  whyItMatters: string;
};

export type ProductOpportunityRecommendation = {
  product: ProductSlug;
  territory: TerritoryCode | UnknownValue;
  salesMotion: "direct" | "lno";
  commercialProgram?: string;
  clientSegment?: string;
  relevantCapabilities: string[];
  observedProblems: string[];
  commercialSignals: string[];
  evidenceIds: string[];
  confidence: OpportunityConfidence;
  conversionRoute: OpportunityConversionRoute;
  conversionRouteStatus: OpportunityConversionRouteStatus;
  pricingTreatment?: string;
  pricingStatus?: PricingStatus | UnknownValue;
  rationale: string[];
  nextResearchActions: string[];
  humanReviewRequired: boolean;
};

export type TerritoryAssessment = {
  code: TerritoryCode | UnknownValue;
  confidence: OpportunityConfidence;
  evidenceIds: string[];
  rationale: string;
};

export type LeadIntelligenceInput = {
  account: AccountProfile;
  evidence: ResearchEvidence[];
  contacts?: ContactProfile[];
};

export type LeadIntelligenceAssessment = {
  account: AccountProfile;
  territory: TerritoryAssessment;
  clientSegments: ClientSegmentMatch[];
  motionCandidate: MotionCandidate;
  signals: CommercialSignal[];
  playbooks: CommercialProgramMatch[];
  recommendations: ProductOpportunityRecommendation[];
  researchGaps: ResearchGap[];
  unknowns: string[];
  explanation: string[];
};
