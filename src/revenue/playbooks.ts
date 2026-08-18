import type { ClientSegment, CommercialCapability, CommercialPlaybook, CommercialProblem } from "./commercial-model.ts";
import { commodityClaims, eventSuiteHypotheses, prohibitedCompetitiveClaim } from "./claims.ts";
import { southAfricaPricing, unitedKingdomPricing } from "./pricing.ts";

const capabilities: CommercialCapability[] = [
  { id: "event-growth-studio", label: "Event Growth Studio", group: "GROW" }, { id: "ticketing", label: "Ticketing where relevant", group: "GROW" },
  { id: "event-management", label: "Event Management", group: "MANAGE" }, { id: "rsvp", label: "RSVP", group: "MANAGE" },
  { id: "workforce", label: "Workforce", group: "RUN" }, { id: "production-operations", label: "Production Operations", group: "RUN" },
];
const problems: CommercialProblem[] = [
  { id: "fragmented-workflows", label: "Fragmented event workflows", notes: "Work spread across specialist tools, spreadsheets, messaging, Drive, and run sheets." },
  { id: "repeat-event-work", label: "Repeated event portfolio work", notes: "Teams may repeat planning and delivery work across many events." },
  { id: "switching-friction", label: "Platform switching friction", notes: "A full stack replacement may be too large a first step." },
];
const clientTypes = ["festival-organisers", "event-promoters", "venues-multiple-events", "event-agencies", "conference-organisers", "exhibition-trade-show-organisers", "corporate-event-teams", "sports-event-organisers"];
const roles = ["Founder / Owner", "Event Director", "Event Manager", "Operations Director", "Head of Events", "Production Manager", "Marketing / Growth lead", "Venue / event-programming leadership"];
const directOffers = [{ id: "direct-self-service", label: "Start with a relevant event operations or growth module", description: "Self-service entry where appropriate; thresholds remain undefined.", conversionGoals: ["SELF_SERVICE"] as const }, { id: "direct-live-demo", label: "Qualified live demo", description: "Human-led demonstration for qualified commercial conversations.", conversionGoals: ["QUALIFIED_LIVE_DEMO"] as const }];
const lnoOffers = [{ id: "lno-opportunity", label: "Business opportunity enquiry / application", description: "Explore originating, onboarding, local services, and agreed module delivery.", conversionGoals: ["BUSINESS_OPPORTUNITY_ENQUIRY"] as const }];
const southAfricanSchoolsSegment: ClientSegment = {
  code: "schools", name: "Schools / Education", territoryRelevance: ["ZA"], salesMotionRelevance: ["direct"], status: "DRAFT",
  description: "South African schools organising events that may benefit from Event Suite event operations capabilities.",
  commercialTreatment: "SPECIAL_DISCOUNT", pricingStatus: "DEFERRED",
  pricingInstruction: "School special pricing requires the current approved school pricing schedule or human confirmation; do not invent a numeric discount.",
  qualificationNotes: ["Segment recognition only; not a final prioritised ICP.", "Examples are indicative and are not qualification requirements."],
  buyerRoleHypotheses: ["School leadership", "Event organiser / coordinator", "Operations / administration", "Finance / business management", "Sports / events leadership"],
  eventExamples: ["School sports events", "Fundraising events", "Performances / productions", "Parent or community events", "School fairs / festivals", "Ceremonies"],
  notes: ["Schools remain within South African Direct.", "Schools are not a separate product, territory, sales motion, or top-level commercial program.", "Do not copy portfolio or UK discounts."],
};

function makePlaybook(territory: "ZA" | "GB", salesMotion: "direct" | "lno"): CommercialPlaybook {
  const isZA = territory === "ZA";
  const isDirect = salesMotion === "direct";
  return {
    id: `event-suite-${territory.toLowerCase()}-${salesMotion}`,
    product: "event-suite", productLabel: "Event Suite", territory, territoryLabel: isZA ? "South Africa" : "United Kingdom", salesMotion, status: "DRAFT", version: "v1.0-draft", phase: "EVENT_OPERATIONS",
    targetClientTypes: clientTypes, clientSegments: isZA && isDirect ? [southAfricanSchoolsSegment] : [], targetRoles: roles,
    targetCharacteristics: ["Runs or supports events", "May coordinate multiple operational workstreams", "May operate a recurring event portfolio"],
    problems, capabilityRelevance: capabilities,
    valuePropositions: ["Connected Event Operations across GROW, MANAGE, and RUN.", "Modular entry around the immediate event problem.", "Optional human/local delivery where approved."],
    entryOffers: isDirect ? directOffers : lnoOffers,
    conversionGoals: isDirect ? ["SELF_SERVICE", "QUALIFIED_LIVE_DEMO"] : ["BUSINESS_OPPORTUNITY_ENQUIRY"],
    allowedClaims: [], prohibitedClaims: [...commodityClaims, prohibitedCompetitiveClaim], differentiationHypotheses: eventSuiteHypotheses,
    objections: ["We already use specialist tools.", "We do not want a full replacement.", "We need operational support, not another tool."],
    pricingGuidance: isZA ? southAfricaPricing : unitedKingdomPricing,
    channelGuidance: isDirect ? undefined : { isChannelOpportunity: true, primaryConversion: "BUSINESS_OPPORTUNITY_ENQUIRY", networkLayers: 1, originatingPortfolioCommissionPercentage: isZA ? 20 : 20, commissionDecay: "NONE", operatorDeliveryPriceModel: "CUSTOMER_OWNED_OR_OPERATOR_MANAGED", selfCommissionAllowed: false, commissionNotes: isZA ? "Approved South African concept: 20% of qualifying package revenue each portfolio year while originating/servicing; no automatic decay in current pack." : "Proposed UK concept: 20% of qualifying Event Package revenue every Portfolio year while originating/servicing; no automatic decay. Operator-managed purchases do not earn self-commission." },
    evidenceRequirements: ["Customer evidence for workflow pain and repeat-event value", "Territory-specific commercial approval", "Competitor evidence before superiority claims", "Human approval for LNO terms"],
    territoryConsiderations: isZA ? ["May favour operations + ticketing entry.", "LNO operator-pack concepts can use approved South African terms."] : ["May allow operations/growth entry alongside an incumbent ticketing platform.", "Do not copy South African pricing or commission rules."],
    qualificationConsiderations: ["Final ICP prioritisation is deferred.", "Event frequency may become a variable; no threshold is defined."],
    routeToConversionConsiderations: isDirect ? ["Self-service versus demo thresholds are deferred.", "Live demos remain human-led."] : ["Opportunity enquiry/application is the primary CTA.", "A software demo is supporting proof, not the default CTA."],
    humanEscalationPoints: ["Important commercial conversations", "Commercial negotiation", "LNO opportunity discussions and operator approval", "Major relationships"],
    unresolvedDecisions: ["Final ICP priority", "Qualification scoring", "Route thresholds", "Competitor evidence and final differentiation wording", ...(isZA ? [] : ["Final owner approval and future revisions of UK pricing"])],
    readiness: { playbook: "DRAFT", pricing: isZA ? "CURRENT" : "PROPOSED", icpPriority: "DEFERRED", differentiationEvidence: "PARTIAL", outreachReady: "NO" },
  };
}

export const commercialPlaybooks: CommercialPlaybook[] = [makePlaybook("ZA", "direct"), makePlaybook("GB", "direct"), makePlaybook("ZA", "lno"), makePlaybook("GB", "lno")];
