import type { AccountRelationship } from "./outreach-model.ts";
import type { AiSalesEvidence } from "./model.ts";
import { EVENTSUITE_LANDING_URL, selectResourceOffer, type ResourceOffer } from "./resource-offers.ts";

export type EventConnectionState = "CONFIRMED" | "STRONG" | "WEAK" | "NONE";
export type OpportunityStrength = "CONFIRMED_NEED" | "STRONG_HYPOTHESIS" | "POSSIBLE" | "NO_EVIDENCE" | "NOT_APPLICABLE";
export type ProspectOpportunity = "EGS" | "TICKETING" | "ECC" | "UNKNOWN";
export type OutreachDecision = "ELIGIBLE" | "REVIEW_REQUIRED" | "BLOCKED";
export type OutreachMotion = "DIRECT" | "PARTNER" | "UNKNOWN";
export type EventFreshness = "ACTIVE_UPCOMING" | "RECENT_RECURRING_EVIDENCE" | "HISTORICAL" | "CANCELLED_DEAD_UNSUPPORTED" | "UNKNOWN";
export type CommercialActionType = "PRODUCT_EXPLORATION" | "VALUE_RESOURCE" | "LOW_COMMITMENT_REPLY" | "HUMAN_ASSISTED" | "NONE";
export type CommercialActionCode = "EXPLORE_EVENTSUITE" | "VIEW_RESOURCE" | "REPLY_FOR_MORE_INFO" | "BOOK_WALKTHROUGH" | "NONE";
export type CommercialEvidenceProduct = "EGS" | "TICKETING" | "ECC";
export type CommercialEvidenceCategory = "WEAK_OWNED_PRESENCE" | "FRAGMENTED_DIGITAL" | "DISCOVERY_GAP" | "DISCONNECTED_EVENT_PAGES" | "PROVIDER_FRAGMENTATION" | "MANUAL_OPERATIONS" | "WORKFLOW_COMPLEXITY" | "MIGRATION_CHANGE" | "PROCUREMENT_CHANGE" | "MULTI_STAGE" | "MULTI_ZONE" | "MULTI_VENUE" | "CONCURRENCY" | "ACCREDITATION" | "WORKFORCE" | "VENDOR_COORDINATION" | "PRODUCTION_SCHEDULING" | "OPERATIONAL_COORDINATION";
export type CommercialEvidenceItem = { product: CommercialEvidenceProduct; claim: string; sourceUrl: string; evidenceCategory: CommercialEvidenceCategory; confidence: AiSalesEvidence["confidence"]; polarity?: "SUPPORTING" | "COUNTER"; existingSystem?: string | null };
export type SourceSiteType = "ORGANISATION_OFFICIAL" | "EVENT_OFFICIAL" | "TICKETING_PROVIDER" | "EVENT_LISTING_DIRECTORY" | "VENUE_OFFICIAL" | "VENUE_CALENDAR" | "ARTIST_OFFICIAL" | "NEWS_EDITORIAL" | "SOCIAL_COMMUNITY" | "PROFESSIONAL_COMPANY" | "INSTITUTIONAL_PROCUREMENT" | "UNKNOWN";
export type SourceSiteClassification = { url: string; siteType: SourceSiteType; siteTypeConfidence: AiSalesEvidence["confidence"]; siteTypeEvidence: string[] };
export type DiscoveryLane = "EVENT_FIRST" | "ORGANISATION_FIRST" | "PERSON_FIRST" | "VENUE_FIRST";
export type PersonSignalClassification = "DIRECT_BUYER_CANDIDATE" | "ROUTE_TO_BUYER" | "FREELANCE_EVENT_CONNECTOR" | "ACTIVITY_UNVERIFIED";
export type PersonSignalAssessment = {
  classification: PersonSignalClassification;
  reviewRequired: boolean;
  reason: string;
  recentActivityEvidence: string[];
  guard: string;
};
export type DiscoveryLaneContext = {
  organisation: { name: string; website: string | null } | null;
  person: { name: string; role: string | null; organisationName: string | null; organisationWebsite: string | null } | null;
  venue: { name: string; website: string | null; operatorName: string | null; operatorWebsite: string | null } | null;
};
export type LensAssessment = { status: "ASSESSED" | "NOT_ASSESSED"; opportunityStrength: OpportunityStrength; facts: string[]; inferences: string[]; unknowns: string[]; counterEvidence?: string[]; existingSystems?: string[]; rationale?: string };
export type ProspectIntelligence = {
  eventConnection: { state: EventConnectionState; reasons: string[]; evidence: string[] };
  personSignal: PersonSignalAssessment | null;
  eventFreshness: { state: EventFreshness; reasons: string[] };
  sourceSummary: { roles: string[]; highOrMediumConfidenceFacts: number; discoveryOnlyFacts: number };
  relationship: AccountRelationship; territory: "ZA" | "GB" | "UNKNOWN"; preferredOutreachLanguage: "EN" | "AF" | "OTHER" | "UNKNOWN"; languageEvidence: AiSalesEvidence[];
  egs: LensAssessment; ticketing: LensAssessment; ecc: LensAssessment; primaryEntryOpportunity: ProspectOpportunity; secondaryOpportunities: ProspectOpportunity[];
  buyerProblemOwner: { likelyRoles: string[]; evidence: string[] }; outreachEligibility: OutreachDecision; outreachBlockOrReviewReason: string | null; salesMotion: OutreachMotion;
  commercialPriority: "HIGH" | "MEDIUM" | "LOW"; priorityReasons: string[]; accountCreationEligible: boolean; accountCreationReason: string;
  nextBestCommercialAction: { type: CommercialActionType; code: CommercialActionCode; objective: string; ctaLabel: string; targetUrlIfVerified: string | null; productDestinationUrl: string; resourceOffer: ResourceOffer; rationale: string; humanHelpFallback: string | null; evidence: string[]; confidence: "LOW" | "MEDIUM" | "HIGH"; callRecommended: boolean };
  recommendedNextAction: string; unknownsToResearch: string[]; events: Array<{ name: string; role: string; evidence: string }>;
};

export type OrganisationResolution = {
  status: "RESOLVED" | "UNRESOLVED" | "NOT_REQUIRED";
  canonicalOrganisationName: string | null;
  officialWebsite: string | null;
  aliases: string[];
  confidence: AiSalesEvidence["confidence"];
  evidence: Array<{ claim: string; sourceUrl: string; sourceTitle: string | null; confidence: AiSalesEvidence["confidence"] }>;
  officialWebsiteSiteType?: SourceSiteType;
  siteClassifications?: SourceSiteClassification[];
  relatedOrganisations?: Array<{ name: string; relationship: string; website: string | null; confidence: AiSalesEvidence["confidence"]; evidence: string[] }>;
};

export type ProspectResearchOutcome = {
  resolutionOutcome: "NOT_REQUIRED" | "RESOLVED" | "UNRESOLVED";
  commercialOutcome: "PRODUCT_SIGNAL_FOUND" | "VALIDATION_ONLY" | "NO_COMMERCIAL_SIGNAL" | "NOT_RUN";
  commerciallyAdvanced: boolean;
};

const EVENT_PATTERN = /\b(?:event|expo|exhibition|conference|symposium|festival|programme|tournament|performance|summit|workshop|concert)\w*\b/i;
const RESPONSIBILITY_PATTERN = /\b(?:organis(?:e|es|ed|ing)|promotes?|operates?|produces?|presents?|runs?|owns?|host(?:s|ed|ing))\b/i;
const PERSON_ROLE_PATTERN = /\b(?:event|venue|production|ticketing|registration|operations?|marketing|commercial|sponsorship|supplier|promot(?:er|ing)|organis(?:er|ing)|agency|freelance)\b/i;
const PERSON_DIRECT_BUYER_ROLE_PATTERN = /\b(?:event director|director of events|head of events|commercial director|commercial manager|revenue director|head of operations|operations director|venue director|venue manager|marketing director|marketing manager|audience development|ticketing manager|box office manager|managing director|chief executive officer|\bceo\b|owner|founder)\b/i;
const PERSON_ROUTE_TO_BUYER_ROLE_PATTERN = /\b(?:event manager|event producer|project manager|programme manager|program manager|event coordinator|production manager|operations manager|partnerships?|sponsorship|business development|account manager|supplier manager|procurement|registration manager|admissions manager|officer|assistant)\b/i;
const PERSON_FREELANCE_ROLE_PATTERN = /\b(?:freelance|independent|self[- ]employed|consultant)\b/i;
const VENUE_ACTIVITY_PATTERN = /\b(?:venue|hosts?|hosting|what.s on|calendar|programme|resident|recurring)\b/i;
const CONFIRMED_OPERATIONAL_VENUE_PATTERN = /Google Places identity evidence lists .*target venue.*Business status: OPERATIONAL/i;
const ACTIVITY_PATTERN = /\b(?:upcoming|next edition|tickets? on sale|annual|recurring|returns?|edition|programme|dates?|current|announced)\b/i;
const DIGITAL_GAP_PATTERN = /\b(?:no meaningful owned|weak owned|poor owned|fragmented|thin|social[- ]first|ticket(?:ing| provider)? page (?:as|is) (?:the )?primary|missing .*programme|weak .*digital|poor .*presence|discoverab(?:ility|le)|public information .*spread)\b/i;
const PROVIDER_PATTERN = /\b(?:quicket|ticketmaster|eventbrite|howler|webtickets|tickets? (?:sold|available) (?:through|via)|powered by)\b/i;
const TICKETING_PROBLEM_PATTERN = /\b(?:multiple (?:ticket|registration|sales) arrangements|manual (?:registration|reconciliation|ticket)|switch(?:ing|ing provider)|procurement|evaluation|settlement|fragmented (?:purchasing|registration)|admission scanning|ticket tiers?|box office|reconciliation|paid (?:tickets?|registration)|registration)\b/i;
const COMPLEXITY_PATTERN = /\b(?:multi-day|multi-stage|multi-zone|multiple venues?|multiple locations?|concurrent|simultaneous|suppliers?|exhibitors?|vendors?|workforce|volunteers?|accreditation|production schedule|technical dependencies|guest operations|complex programme)\b/i;
const AFRIKAANS_PATTERN = /\b(?:afrikaans|afrikaans-language|predominantly afrikaans)\b/i;
const HIGH_TOUCH_PATTERN = /\b(?:enterprise|procurement|migration|settlement|security|multiple departments?|multiple events?|multi-event)\b/i;
type SourceRole = NonNullable<AiSalesEvidence["sourceRoles"]>[number];

function inferredFreshness(claim: string): EventFreshness {
  if (/\b(?:cancelled|canceled|defunct|no longer operating)\b/i.test(claim)) return "CANCELLED_DEAD_UNSUPPORTED";
  const year = new Date().getUTCFullYear();
  const years = [...claim.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1]));
  if (/\b(?:upcoming|next edition|tickets? on sale|this year|current|announced)\b/i.test(claim) || years.some((value) => value >= year)) return "ACTIVE_UPCOMING";
  if (/\b(?:annual|recurring|returns?|returning|edition)\b/i.test(claim)) return "RECENT_RECURRING_EVIDENCE";
  if (/\b(?:historic|historical|archive|archived|took place|was held)\b/i.test(claim) || years.some((value) => value < year)) return "HISTORICAL";
  return "UNKNOWN";
}
function factsOnly(items: AiSalesEvidence[]) {
  return items.filter((item) => item.kind === "FACT" && item.claim.trim()).map((item) => {
    const roles: SourceRole[] = item.sourceRoles?.length ? item.sourceRoles : [RESPONSIBILITY_PATTERN.test(item.claim) ? "VALIDATION" : DIGITAL_GAP_PATTERN.test(item.claim) || TICKETING_PROBLEM_PATTERN.test(item.claim) || COMPLEXITY_PATTERN.test(item.claim) ? "COMMERCIAL_EVIDENCE" : "DISCOVERY"];
    return { ...item, sourceRoles: roles, eventFreshness: item.eventFreshness ?? inferredFreshness(item.claim) };
  });
}
function assessment(strength: OpportunityStrength, facts: string[] = [], inferences: string[] = [], unknowns: string[] = [], rationale = "The lens was assessed from validated evidence."): LensAssessment { return { status: "ASSESSED", opportunityStrength: strength, facts, inferences, unknowns, rationale }; }
function freshnessOf(facts: AiSalesEvidence[]): ProspectIntelligence["eventFreshness"] {
  const states = facts.map((fact) => fact.eventFreshness ?? "UNKNOWN");
  if (states.includes("CANCELLED_DEAD_UNSUPPORTED")) return { state: "CANCELLED_DEAD_UNSUPPORTED", reasons: ["Public evidence marks the event or organisation as cancelled, dead or unsupported."] };
  if (states.includes("ACTIVE_UPCOMING")) return { state: "ACTIVE_UPCOMING", reasons: ["Public evidence supports a current or upcoming event."] };
  if (states.includes("RECENT_RECURRING_EVIDENCE")) return { state: "RECENT_RECURRING_EVIDENCE", reasons: ["A recent recurring event supports organisation intelligence but not an invented upcoming edition."] };
  if (states.includes("HISTORICAL")) return { state: "HISTORICAL", reasons: ["Only historical event evidence was found."] };
  return { state: "UNKNOWN", reasons: ["Event freshness has not been established."] };
}
function hasRecentActivity(fact: AiSalesEvidence) {
  const freshness = fact.eventFreshness ?? inferredFreshness(fact.claim);
  return freshness === "ACTIVE_UPCOMING" || freshness === "RECENT_RECURRING_EVIDENCE";
}
export function classifyPersonSignal(input: { person: DiscoveryLaneContext["person"] | null; facts: AiSalesEvidence[]; discoveryLane?: DiscoveryLane }): PersonSignalAssessment | null {
  if (input.discoveryLane !== "PERSON_FIRST") return null;
  const role = input.person?.role?.trim() ?? "";
  const roleOrPersonEvidence = input.facts.filter((fact) => Boolean(fact.sourceUrl) && (PERSON_ROLE_PATTERN.test(fact.claim) || (role && fact.claim.toLowerCase().includes(role.toLowerCase()))));
  const recentActivityEvidence = roleOrPersonEvidence.filter(hasRecentActivity).map((fact) => fact.claim);
  const guard = "Person evidence preserves the sourced relationship only; it does not establish event ownership, organiser status or buying authority.";
  if (!recentActivityEvidence.length) return { classification: "ACTIVITY_UNVERIFIED", reviewRequired: true, reason: "NO_RECENT_SOURCED_EVENT_SECTOR_ACTIVITY_FOR_PERSON_SIGNAL", recentActivityEvidence: [], guard };
  if (PERSON_FREELANCE_ROLE_PATTERN.test(role)) return { classification: "FREELANCE_EVENT_CONNECTOR", reviewRequired: true, reason: "RECENT_SOURCED_EVENT_SECTOR_ACTIVITY_SUPPORTS_FREELANCE_CONNECTOR_REVIEW", recentActivityEvidence, guard };
  if (PERSON_DIRECT_BUYER_ROLE_PATTERN.test(role)) return { classification: "DIRECT_BUYER_CANDIDATE", reviewRequired: true, reason: "RECENT_SOURCED_EVENT_SECTOR_ACTIVITY_AND_ROLE_FUNCTION_SUPPORT_DIRECT_BUYER_REVIEW", recentActivityEvidence, guard };
  return { classification: "ROUTE_TO_BUYER", reviewRequired: true, reason: "RECENT_SOURCED_EVENT_SECTOR_ACTIVITY_SUPPORTS_ROUTE_TO_BUYER_REVIEW", recentActivityEvidence, guard };
}
function selectCommercialAction(input: { eligible: boolean; primary: ProspectOpportunity; ticketing: LensAssessment; egs: LensAssessment; ecc: LensAssessment; claims: string[]; buyerRoles: string[] }): ProspectIntelligence["nextBestCommercialAction"] {
  const resourceOffer = selectResourceOffer({ primary: input.primary, claims: input.claims, buyerRoles: input.buyerRoles });
  if (!input.eligible || input.primary === "UNKNOWN") return { type: "NONE", code: "NONE", objective: "Do not advance ordinary Direct outreach until Prospect Intelligence is eligible.", ctaLabel: "No outreach CTA", targetUrlIfVerified: null, productDestinationUrl: EVENTSUITE_LANDING_URL, resourceOffer, rationale: "The event connection, current activity or evidence-backed opportunity is not sufficient for normal Direct outreach.", humanHelpFallback: null, evidence: [], confidence: "HIGH", callRecommended: false };
  const highTouch = HIGH_TOUCH_PATTERN.test(input.claims.join(" ")) || (input.primary === "ECC" && input.ecc.opportunityStrength === "STRONG_HYPOTHESIS");
  if (highTouch) return { type: "HUMAN_ASSISTED", code: "BOOK_WALKTHROUGH", objective: "Offer a guided walkthrough only because the evidenced event complexity warrants it.", ctaLabel: "Reply to arrange a walkthrough", targetUrlIfVerified: null, productDestinationUrl: EVENTSUITE_LANDING_URL, resourceOffer, rationale: "Observed event-operating, migration, procurement or enterprise complexity makes a guided conversation materially useful.", humanHelpFallback: "Explore EventSuite first if a lighter-weight route is easier.", evidence: input.primary === "ECC" ? input.ecc.facts : input.claims.filter((claim) => HIGH_TOUCH_PATTERN.test(claim)), confidence: "MEDIUM", callRecommended: true };
  return { type: "PRODUCT_EXPLORATION", code: "EXPLORE_EVENTSUITE", objective: "Invite the organiser to explore EventSuite before choosing a product or setup path.", ctaLabel: "Explore EventSuite", targetUrlIfVerified: EVENTSUITE_LANDING_URL, productDestinationUrl: EVENTSUITE_LANDING_URL, resourceOffer, rationale: "Cold prospects should start at the public EventSuite landing page.", humanHelpFallback: "Reply if help would be useful.", evidence: input.primary === "EGS" ? input.egs.facts : input.primary === "TICKETING" ? input.ticketing.facts : input.ecc.facts, confidence: "HIGH", callRecommended: false };
}

export function evaluateProspectIntelligence(input: { relationship: AccountRelationship; territory: ProspectIntelligence["territory"]; facts: AiSalesEvidence[]; inferences: AiSalesEvidence[]; unknowns?: string[]; commercialEvidence?: CommercialEvidenceItem[]; discoveryLane?: DiscoveryLane; laneContext?: DiscoveryLaneContext | null; identityResolved?: boolean }): ProspectIntelligence {
  const facts = factsOnly(input.facts); const claims = facts.map((item) => item.claim); const freshness = freshnessOf(facts);
  const personSignal = classifyPersonSignal({ person: input.laneContext?.person ?? null, facts, discoveryLane: input.discoveryLane });
  const validationFacts = facts.filter((item) => item.sourceRoles?.includes("VALIDATION") || RESPONSIBILITY_PATTERN.test(item.claim));
  const eventFacts = validationFacts.filter((item) => EVENT_PATTERN.test(item.claim) && (RESPONSIBILITY_PATTERN.test(item.claim) || item.sourceRoles?.includes("VALIDATION")));
  const eventMentionFacts = facts.filter((item) => EVENT_PATTERN.test(item.claim));
  const current = freshness.state === "ACTIVE_UPCOMING" || freshness.state === "RECENT_RECURRING_EVIDENCE";
  const lanePerson = input.laneContext?.person;
  const laneVenue = input.laneContext?.venue;
  const personRoleFacts = input.discoveryLane === "PERSON_FIRST" && Boolean(lanePerson?.name && lanePerson.role && PERSON_ROLE_PATTERN.test(lanePerson.role)) ? facts.filter((item) => PERSON_ROLE_PATTERN.test(item.claim) || (item.sourceRoles ?? []).includes("VALIDATION")) : [];
  const venueActivityFacts = input.discoveryLane === "VENUE_FIRST" && Boolean(laneVenue?.name) ? facts.filter((item) => VENUE_ACTIVITY_PATTERN.test(item.claim) && EVENT_PATTERN.test(item.claim)) : [];
  const venueIdentityFacts = input.discoveryLane === "VENUE_FIRST" && Boolean(laneVenue?.name) ? facts.filter((item) => CONFIRMED_OPERATIONAL_VENUE_PATTERN.test(item.claim)) : [];
  const eventConnection: ProspectIntelligence["eventConnection"] = input.discoveryLane === "VENUE_FIRST" && venueActivityFacts.length && current ? { state: "STRONG", reasons: ["The venue is evidenced as a current event host or operator; venue hosting does not prove organising responsibility."], evidence: venueActivityFacts.map((item) => item.claim) } : input.discoveryLane === "PERSON_FIRST" && personRoleFacts.length && personSignal?.classification !== "ACTIVITY_UNVERIFIED" ? { state: "STRONG", reasons: ["A real person with recent sourced event-sector activity is evidenced; this does not assert event ownership."], evidence: personRoleFacts.map((item) => item.claim) } : eventFacts.length && current ? { state: eventFacts.some((item) => item.sourceRoles?.includes("VALIDATION") || /\b(?:organis\w*|operates?|promotes?|produces?|owns?)\b/i.test(item.claim)) ? "CONFIRMED" : "STRONG", reasons: ["Source-grounded evidence connects the organisation to current or recurring event activity."], evidence: eventFacts.map((item) => item.claim) } : eventMentionFacts.length ? { state: "WEAK", reasons: [current ? "Event activity is mentioned, but organiser responsibility is not established." : "Event evidence is not current enough to establish a live commercial relationship."], evidence: eventMentionFacts.map((item) => item.claim) } : { state: "NONE", reasons: ["No source-grounded organiser/event relationship was established."] , evidence: [] };
  const eligibleEvent = ["CONFIRMED", "STRONG"].includes(eventConnection.state) && current;
  const laneRelevance = input.discoveryLane === "PERSON_FIRST" ? personRoleFacts.length > 0 && personSignal?.classification !== "ACTIVITY_UNVERIFIED" : input.discoveryLane === "VENUE_FIRST" ? (venueActivityFacts.length > 0 && current) || venueIdentityFacts.length > 0 : eligibleEvent;
  const commerciallyTrusted = facts.filter((item) => ["HIGH", "MEDIUM"].includes(item.confidence) && (item.sourceRoles?.includes("VALIDATION") || item.sourceRoles?.includes("COMMERCIAL_EVIDENCE") || item.sourceRoles?.includes("SIGNAL")));
  const structured = input.commercialEvidence ?? [];
  const structuredClaims = (product: CommercialEvidenceProduct) => structured.filter((item) => item.product === product && item.polarity !== "COUNTER").map((item) => item.claim);
  const structuredCounters = (product: CommercialEvidenceProduct) => structured.filter((item) => item.product === product && item.polarity === "COUNTER").map((item) => item.claim);
  const egsFacts = facts.filter((item) => DIGITAL_GAP_PATTERN.test(item.claim));
  const egsCounterFacts = facts.filter((item) => /\b(?:mature|coherent|strong)\b.{0,80}\b(?:owned|official|event website|digital presence)\b/i.test(item.claim));
  const egsClaims = [...new Set([...egsFacts.map((item) => item.claim), ...structuredClaims("EGS")])];
  const providerFacts = facts.filter((item) => PROVIDER_PATTERN.test(item.claim));
  const ticketProblemFacts = facts.filter((item) => TICKETING_PROBLEM_PATTERN.test(item.claim));
  const ticketCounterFacts = facts.filter((item) => /\b(?:established|mature|integrated|coherent)\b.{0,100}\b(?:ticketing|registration|admission|checkout|system)\b/i.test(item.claim));
  const ticketClaims = [...new Set([...ticketProblemFacts.map((item) => item.claim), ...structuredClaims("TICKETING")])];
  const eccFacts = facts.filter((item) => COMPLEXITY_PATTERN.test(item.claim));
  const eccClaims = [...new Set([...eccFacts.map((item) => item.claim), ...structuredClaims("ECC")])];
  const egsCounters = [...egsCounterFacts.map((item) => item.claim), ...structuredCounters("EGS")];
  const egs = eligibleEvent && egsClaims.length ? assessment(egsCounters.length ? "POSSIBLE" : "STRONG_HYPOTHESIS", egsClaims, [egsCounters.length ? "Supporting digital-gap evidence is tempered by mature/coherent owned presence." : "A weak or fragmented owned event presence is evidenced."], ["Validate the organisation's preferred canonical event destination."], egsCounters.length ? "Supporting EGS evidence exists, but mature/coherent owned presence is counter-evidence; the net result is not a strong hypothesis." : "Supporting EGS evidence has no material counter-evidence in the bounded research.") : assessment(eligibleEvent ? "NO_EVIDENCE" : "NOT_APPLICABLE", [], [], eligibleEvent ? ["No observable owned-digital problem is evidenced."] : ["Establish current organiser/event responsibility first."], egsCounters.length ? "Mature/coherent owned presence is the net EGS result." : "No validated EGS evidence was found."); egs.counterEvidence = egsCounters;
  const ticketCounters = [...ticketCounterFacts.map((item) => item.claim), ...structuredCounters("TICKETING")];
  const ticketing = eligibleEvent && ticketClaims.length ? assessment(ticketCounters.length ? "POSSIBLE" : "STRONG_HYPOTHESIS", ticketClaims, [ticketCounters.length ? "Specific Ticketing evidence is tempered by an established system." : "A specific ticketing or commerce problem is evidenced."], ["Validate current provider and purchasing workflow."], ticketCounters.length ? "Supporting Ticketing evidence is countered by established/integrated coverage; no strong hypothesis is promoted." : "Supporting Ticketing evidence has no material counter-evidence in the bounded research.") : assessment(eligibleEvent ? (providerFacts.length ? "POSSIBLE" : "NO_EVIDENCE") : "NOT_APPLICABLE", providerFacts.map((item) => item.claim), providerFacts.length ? ["Provider use is commercial intelligence, not switching intent."] : [], providerFacts.length ? ["Validate a switching, reconciliation or purchasing problem before treating Ticketing as an opportunity."] : ["No ticketing problem is publicly evidenced."], providerFacts.length ? "Provider context alone does not establish Ticketing need." : "No validated Ticketing evidence was found."); ticketing.counterEvidence = ticketCounters;
  const eccCounters = structuredCounters("ECC");
  const ecc = eligibleEvent && eccClaims.length ? assessment(eccCounters.length ? "POSSIBLE" : "STRONG_HYPOTHESIS", eccClaims, [eccCounters.length ? "Operational complexity is tempered by mature integrated tooling." : "Observed structure indicates meaningful coordination complexity."], ["Validate operating teams and current event operations workflow."], eccCounters.length ? "Complexity is valid context, but mature integrated tooling is counter-evidence; no strong ECC hypothesis is promoted." : "Supporting ECC complexity has no material counter-evidence in the bounded research.") : assessment(eligibleEvent ? "NO_EVIDENCE" : "NOT_APPLICABLE", [], [], eligibleEvent ? ["No defensible operational complexity signal is evidenced or mature tooling counters complexity."] : ["Establish current organiser/event responsibility first."], eccCounters.length ? "Mature integrated tooling is the net ECC result." : "No validated ECC evidence was found."); ecc.counterEvidence = eccCounters;
  const lenses: Array<[ProspectOpportunity, LensAssessment]> = [["EGS", egs], ["TICKETING", ticketing], ["ECC", ecc]]; const strong = lenses.filter(([, item]) => ["CONFIRMED_NEED", "STRONG_HYPOTHESIS"].includes(item.opportunityStrength));
  const primaryEntryOpportunity = strong.length ? strong.sort((a, b) => ["EGS", "TICKETING", "ECC"].indexOf(a[0]) - ["EGS", "TICKETING", "ECC"].indexOf(b[0]))[0][0] : "UNKNOWN";
  const secondaryOpportunities = strong.filter(([engine]) => engine !== primaryEntryOpportunity).map(([engine]) => engine);
  const likelyRoles = primaryEntryOpportunity === "EGS" ? ["Event Director", "Marketing Lead", "Organiser"] : primaryEntryOpportunity === "TICKETING" ? ["Ticketing Lead", "Commercial Lead", "Event Director"] : primaryEntryOpportunity === "ECC" ? ["Event Operations Lead", "Production Lead", "Event Director"] : [];
  const languageEvidence = facts.filter((item) => AFRIKAANS_PATTERN.test(item.claim)); const preferredOutreachLanguage = languageEvidence.length ? "AF" : input.territory === "UNKNOWN" ? "UNKNOWN" : "EN";
  const relationshipBlocked = input.relationship === "COMPETITOR"; const enoughCommercialEvidence = commerciallyTrusted.length > 0 && primaryEntryOpportunity !== "UNKNOWN";
  // Direct callers of the downstream intelligence contract historically
  // provide an already-identified organisation. Discovery passes false
  // explicitly until its lane-specific identity handoff succeeds.
  const identityResolved = input.identityResolved !== false;
  const accountCreationEligible = input.relationship === "PROSPECT" && laneRelevance && identityResolved;
  const accountCreationReason = relationshipBlocked ? "Actual competitor remains blocked from commercial memory." : !laneRelevance ? input.discoveryLane === "PERSON_FIRST" && personSignal?.classification === "ACTIVITY_UNVERIFIED" ? "Person signal is retained, but recent sourced event-sector activity requires human review before account creation." : input.discoveryLane === "PERSON_FIRST" ? "A credible event-sector person role has not been established." : input.discoveryLane === "VENUE_FIRST" ? "Current venue event relevance has not been established." : eventConnection.state === "WEAK" ? "Organiser responsibility or current activity needs human resolution before account creation." : "No current, defensible event/activity relationship is available for commercial memory." : !identityResolved ? "The commercial organisation identity is not yet resolved or authoritatively established." : primaryEntryOpportunity === "UNKNOWN" ? "The prospect is real and relevant, but no specific EventSuite problem is evidenced; retain an honest general-fit hypothesis." : !commerciallyTrusted.length ? "The prospect is relevant, but commercial evidence is not yet strong enough to prioritise." : "Credible identity, relevant activity and EventSuite commercial evidence justify commercial memory.";
  const personActivityUnverified = personSignal?.classification === "ACTIVITY_UNVERIFIED";
  const outreachEligibility: OutreachDecision = relationshipBlocked ? "BLOCKED" : personActivityUnverified ? "REVIEW_REQUIRED" : eventConnection.state === "NONE" ? "BLOCKED" : input.relationship !== "PROSPECT" ? "REVIEW_REQUIRED" : accountCreationEligible && primaryEntryOpportunity !== "UNKNOWN" ? "ELIGIBLE" : "REVIEW_REQUIRED";
  const reason = relationshipBlocked ? "Competitor — standard sales outreach not recommended" : accountCreationEligible && primaryEntryOpportunity !== "UNKNOWN" ? null : accountCreationEligible ? "No product-specific EventSuite signal is evidenced; outreach remains review-only." : accountCreationReason;
  const priority: ProspectIntelligence["commercialPriority"] = !accountCreationEligible ? "LOW" : egs.opportunityStrength === "STRONG_HYPOTHESIS" || (freshness.state === "ACTIVE_UPCOMING" && strong.length > 0 && commerciallyTrusted.length > 1) ? "HIGH" : "MEDIUM";
  const priorityReasons = priority === "HIGH" ? ["Current activity, strong commercial need and multiple credible evidence signals are present."] : priority === "MEDIUM" ? ["A credible current organisation and lens-specific commercial hypothesis are present."] : [accountCreationReason];
  const unknowns = [...(input.unknowns ?? []), ...(primaryEntryOpportunity === "UNKNOWN" && eligibleEvent ? ["Which EventSuite problem, if any, is commercially material for this organisation?"] : [])];
  const nextBestCommercialAction = selectCommercialAction({ eligible: outreachEligibility === "ELIGIBLE", primary: primaryEntryOpportunity, ticketing, egs, ecc, claims, buyerRoles: likelyRoles });
  return { eventConnection, personSignal, eventFreshness: freshness, sourceSummary: { roles: [...new Set(facts.flatMap((item) => item.sourceRoles ?? []))], highOrMediumConfidenceFacts: facts.filter((item) => ["HIGH", "MEDIUM"].includes(item.confidence)).length, discoveryOnlyFacts: facts.filter((item) => (item.sourceRoles ?? []).every((role) => role === "DISCOVERY")).length }, relationship: input.relationship, territory: input.territory, preferredOutreachLanguage, languageEvidence, egs, ticketing, ecc, primaryEntryOpportunity, secondaryOpportunities, buyerProblemOwner: { likelyRoles, evidence: primaryEntryOpportunity === "UNKNOWN" ? [] : [`Roles follow the evidenced ${primaryEntryOpportunity} problem; no person is invented.`] }, outreachEligibility, outreachBlockOrReviewReason: reason, salesMotion: input.relationship === "PROSPECT" ? "DIRECT" : input.relationship === "PARTNER" ? "PARTNER" : "UNKNOWN", commercialPriority: priority, priorityReasons, accountCreationEligible, accountCreationReason, nextBestCommercialAction, recommendedNextAction: nextBestCommercialAction.objective, unknownsToResearch: unknowns, events: eventFacts.map((item) => ({ name: item.sourceTitle ?? "Event activity", role: input.discoveryLane === "PERSON_FIRST" ? "person activity evidence; event ownership is not established" : "organised or operated by the account", evidence: item.claim })) };
}
