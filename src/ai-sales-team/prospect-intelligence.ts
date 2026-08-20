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
export type CommercialEvidenceItem = { product: CommercialEvidenceProduct; claim: string; sourceUrl: string; evidenceCategory: CommercialEvidenceCategory; confidence: AiSalesEvidence["confidence"] };
export type LensAssessment = { status: "ASSESSED" | "NOT_ASSESSED"; opportunityStrength: OpportunityStrength; facts: string[]; inferences: string[]; unknowns: string[] };
export type ProspectIntelligence = {
  eventConnection: { state: EventConnectionState; reasons: string[]; evidence: string[] };
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
};

export type ProspectResearchOutcome = {
  resolutionOutcome: "NOT_REQUIRED" | "RESOLVED" | "UNRESOLVED";
  commercialOutcome: "PRODUCT_SIGNAL_FOUND" | "VALIDATION_ONLY" | "NO_COMMERCIAL_SIGNAL" | "NOT_RUN";
  commerciallyAdvanced: boolean;
};

const EVENT_PATTERN = /\b(?:event|conference|symposium|festival|programme|tournament|exhibition|performance|summit|workshop|concert)\w*\b/i;
const RESPONSIBILITY_PATTERN = /\b(?:organis(?:e|es|ed|ing)|promotes?|operates?|produces?|presents?|runs?|owns?|host(?:s|ed|ing))\b/i;
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
function assessment(strength: OpportunityStrength, facts: string[] = [], inferences: string[] = [], unknowns: string[] = []): LensAssessment { return { status: "ASSESSED", opportunityStrength: strength, facts, inferences, unknowns }; }
function freshnessOf(facts: AiSalesEvidence[]): ProspectIntelligence["eventFreshness"] {
  const states = facts.map((fact) => fact.eventFreshness ?? "UNKNOWN");
  if (states.includes("CANCELLED_DEAD_UNSUPPORTED")) return { state: "CANCELLED_DEAD_UNSUPPORTED", reasons: ["Public evidence marks the event or organisation as cancelled, dead or unsupported."] };
  if (states.includes("ACTIVE_UPCOMING")) return { state: "ACTIVE_UPCOMING", reasons: ["Public evidence supports a current or upcoming event."] };
  if (states.includes("RECENT_RECURRING_EVIDENCE")) return { state: "RECENT_RECURRING_EVIDENCE", reasons: ["A recent recurring event supports organisation intelligence but not an invented upcoming edition."] };
  if (states.includes("HISTORICAL")) return { state: "HISTORICAL", reasons: ["Only historical event evidence was found."] };
  return { state: "UNKNOWN", reasons: ["Event freshness has not been established."] };
}
function selectCommercialAction(input: { eligible: boolean; primary: ProspectOpportunity; ticketing: LensAssessment; egs: LensAssessment; ecc: LensAssessment; claims: string[]; buyerRoles: string[] }): ProspectIntelligence["nextBestCommercialAction"] {
  const resourceOffer = selectResourceOffer({ primary: input.primary, claims: input.claims, buyerRoles: input.buyerRoles });
  if (!input.eligible || input.primary === "UNKNOWN") return { type: "NONE", code: "NONE", objective: "Do not advance ordinary Direct outreach until Prospect Intelligence is eligible.", ctaLabel: "No outreach CTA", targetUrlIfVerified: null, productDestinationUrl: EVENTSUITE_LANDING_URL, resourceOffer, rationale: "The event connection, current activity or evidence-backed opportunity is not sufficient for normal Direct outreach.", humanHelpFallback: null, evidence: [], confidence: "HIGH", callRecommended: false };
  const highTouch = HIGH_TOUCH_PATTERN.test(input.claims.join(" ")) || (input.primary === "ECC" && input.ecc.opportunityStrength === "STRONG_HYPOTHESIS");
  if (highTouch) return { type: "HUMAN_ASSISTED", code: "BOOK_WALKTHROUGH", objective: "Offer a guided walkthrough only because the evidenced event complexity warrants it.", ctaLabel: "Reply to arrange a walkthrough", targetUrlIfVerified: null, productDestinationUrl: EVENTSUITE_LANDING_URL, resourceOffer, rationale: "Observed event-operating, migration, procurement or enterprise complexity makes a guided conversation materially useful.", humanHelpFallback: "Explore EventSuite first if a lighter-weight route is easier.", evidence: input.primary === "ECC" ? input.ecc.facts : input.claims.filter((claim) => HIGH_TOUCH_PATTERN.test(claim)), confidence: "MEDIUM", callRecommended: true };
  return { type: "PRODUCT_EXPLORATION", code: "EXPLORE_EVENTSUITE", objective: "Invite the organiser to explore EventSuite before choosing a product or setup path.", ctaLabel: "Explore EventSuite", targetUrlIfVerified: EVENTSUITE_LANDING_URL, productDestinationUrl: EVENTSUITE_LANDING_URL, resourceOffer, rationale: "Cold prospects should start at the public EventSuite landing page.", humanHelpFallback: "Reply if help would be useful.", evidence: input.primary === "EGS" ? input.egs.facts : input.primary === "TICKETING" ? input.ticketing.facts : input.ecc.facts, confidence: "HIGH", callRecommended: false };
}

export function evaluateProspectIntelligence(input: { relationship: AccountRelationship; territory: ProspectIntelligence["territory"]; facts: AiSalesEvidence[]; inferences: AiSalesEvidence[]; unknowns?: string[]; commercialEvidence?: CommercialEvidenceItem[] }): ProspectIntelligence {
  const facts = factsOnly(input.facts); const claims = facts.map((item) => item.claim); const freshness = freshnessOf(facts);
  const validationFacts = facts.filter((item) => item.sourceRoles?.includes("VALIDATION") || RESPONSIBILITY_PATTERN.test(item.claim));
  const eventFacts = validationFacts.filter((item) => EVENT_PATTERN.test(item.claim) && (RESPONSIBILITY_PATTERN.test(item.claim) || item.sourceRoles?.includes("VALIDATION")));
  const eventMentionFacts = facts.filter((item) => EVENT_PATTERN.test(item.claim));
  const current = freshness.state === "ACTIVE_UPCOMING" || freshness.state === "RECENT_RECURRING_EVIDENCE";
  const eventConnection: ProspectIntelligence["eventConnection"] = eventFacts.length && current ? { state: eventFacts.some((item) => item.sourceRoles?.includes("VALIDATION") || /\b(?:organis\w*|operates?|promotes?|produces?|owns?)\b/i.test(item.claim)) ? "CONFIRMED" : "STRONG", reasons: ["Source-grounded evidence connects the organisation to current or recurring event activity."], evidence: eventFacts.map((item) => item.claim) } : eventMentionFacts.length ? { state: "WEAK", reasons: [current ? "Event activity is mentioned, but organiser responsibility is not established." : "Event evidence is not current enough to establish a live commercial relationship."], evidence: eventMentionFacts.map((item) => item.claim) } : { state: "NONE", reasons: ["No source-grounded organiser/event relationship was established."], evidence: [] };
  const eligibleEvent = ["CONFIRMED", "STRONG"].includes(eventConnection.state) && current;
  const commerciallyTrusted = facts.filter((item) => ["HIGH", "MEDIUM"].includes(item.confidence) && (item.sourceRoles?.includes("VALIDATION") || item.sourceRoles?.includes("COMMERCIAL_EVIDENCE") || item.sourceRoles?.includes("SIGNAL")));
  const structured = input.commercialEvidence ?? [];
  const structuredClaims = (product: CommercialEvidenceProduct) => structured.filter((item) => item.product === product).map((item) => item.claim);
  const egsFacts = facts.filter((item) => DIGITAL_GAP_PATTERN.test(item.claim));
  const egsClaims = [...new Set([...egsFacts.map((item) => item.claim), ...structuredClaims("EGS")])];
  const providerFacts = facts.filter((item) => PROVIDER_PATTERN.test(item.claim));
  const ticketProblemFacts = facts.filter((item) => TICKETING_PROBLEM_PATTERN.test(item.claim));
  const ticketClaims = [...new Set([...ticketProblemFacts.map((item) => item.claim), ...structuredClaims("TICKETING")])];
  const eccFacts = facts.filter((item) => COMPLEXITY_PATTERN.test(item.claim));
  const eccClaims = [...new Set([...eccFacts.map((item) => item.claim), ...structuredClaims("ECC")])];
  const egs = eligibleEvent && egsClaims.length ? assessment("STRONG_HYPOTHESIS", egsClaims, ["A weak or fragmented owned event presence is evidenced."], ["Validate the organisation's preferred canonical event destination."]) : assessment(eligibleEvent ? "NO_EVIDENCE" : "NOT_APPLICABLE", [], [], eligibleEvent ? ["No observable owned-digital problem is evidenced."] : ["Establish current organiser/event responsibility first."]);
  const ticketing = eligibleEvent && ticketClaims.length ? assessment("STRONG_HYPOTHESIS", ticketClaims, ["A specific ticketing or commerce problem is evidenced."], ["Validate current provider and purchasing workflow."]) : assessment(eligibleEvent ? (providerFacts.length ? "POSSIBLE" : "NO_EVIDENCE") : "NOT_APPLICABLE", providerFacts.map((item) => item.claim), providerFacts.length ? ["Provider use is commercial intelligence, not switching intent."] : [], providerFacts.length ? ["Validate a switching, reconciliation or purchasing problem before treating Ticketing as an opportunity."] : ["No ticketing problem is publicly evidenced."]);
  const ecc = eligibleEvent && eccClaims.length ? assessment("STRONG_HYPOTHESIS", eccClaims, ["Observed structure indicates meaningful coordination complexity."], ["Validate operating teams and current event operations workflow."]) : assessment(eligibleEvent ? "NO_EVIDENCE" : "NOT_APPLICABLE", [], [], eligibleEvent ? ["No defensible operational complexity signal is evidenced."] : ["Establish current organiser/event responsibility first."]);
  const lenses: Array<[ProspectOpportunity, LensAssessment]> = [["EGS", egs], ["TICKETING", ticketing], ["ECC", ecc]]; const strong = lenses.filter(([, item]) => ["CONFIRMED_NEED", "STRONG_HYPOTHESIS"].includes(item.opportunityStrength));
  const primaryEntryOpportunity = strong.length ? strong.sort((a, b) => ["EGS", "TICKETING", "ECC"].indexOf(a[0]) - ["EGS", "TICKETING", "ECC"].indexOf(b[0]))[0][0] : "UNKNOWN";
  const secondaryOpportunities = strong.filter(([engine]) => engine !== primaryEntryOpportunity).map(([engine]) => engine);
  const likelyRoles = primaryEntryOpportunity === "EGS" ? ["Event Director", "Marketing Lead", "Organiser"] : primaryEntryOpportunity === "TICKETING" ? ["Ticketing Lead", "Commercial Lead", "Event Director"] : primaryEntryOpportunity === "ECC" ? ["Event Operations Lead", "Production Lead", "Event Director"] : [];
  const languageEvidence = facts.filter((item) => AFRIKAANS_PATTERN.test(item.claim)); const preferredOutreachLanguage = languageEvidence.length ? "AF" : input.territory === "UNKNOWN" ? "UNKNOWN" : "EN";
  const relationshipBlocked = input.relationship === "COMPETITOR"; const enoughCommercialEvidence = commerciallyTrusted.length > 0 && primaryEntryOpportunity !== "UNKNOWN";
  const accountCreationEligible = input.relationship === "PROSPECT" && eligibleEvent && enoughCommercialEvidence;
  const accountCreationReason = relationshipBlocked ? "Actual competitor remains blocked from commercial memory." : !eligibleEvent ? eventConnection.state === "WEAK" ? "Organiser responsibility or current activity needs human resolution before account creation." : "No current, defensible organiser/event relationship is available for commercial memory." : primaryEntryOpportunity === "UNKNOWN" ? "Current organisation activity is credible, but no EventSuite commercial signal has crossed the account-creation gate." : !commerciallyTrusted.length ? "Commercial evidence is discovery-only and needs stronger source confidence." : "Credible organisation identity, current activity and EventSuite commercial evidence justify commercial memory.";
  const outreachEligibility: OutreachDecision = relationshipBlocked || eventConnection.state === "NONE" ? "BLOCKED" : input.relationship !== "PROSPECT" ? "REVIEW_REQUIRED" : accountCreationEligible ? "ELIGIBLE" : "REVIEW_REQUIRED";
  const reason = relationshipBlocked ? "Competitor — standard sales outreach not recommended" : accountCreationEligible ? null : accountCreationReason;
  const priority: ProspectIntelligence["commercialPriority"] = !accountCreationEligible ? "LOW" : egs.opportunityStrength === "STRONG_HYPOTHESIS" || (freshness.state === "ACTIVE_UPCOMING" && strong.length > 0 && commerciallyTrusted.length > 1) ? "HIGH" : "MEDIUM";
  const priorityReasons = priority === "HIGH" ? ["Current activity, strong commercial need and multiple credible evidence signals are present."] : priority === "MEDIUM" ? ["A credible current organisation and lens-specific commercial hypothesis are present."] : [accountCreationReason];
  const unknowns = [...(input.unknowns ?? []), ...(primaryEntryOpportunity === "UNKNOWN" && eligibleEvent ? ["Which EventSuite problem, if any, is commercially material for this organisation?"] : [])];
  const nextBestCommercialAction = selectCommercialAction({ eligible: outreachEligibility === "ELIGIBLE", primary: primaryEntryOpportunity, ticketing, egs, ecc, claims, buyerRoles: likelyRoles });
  return { eventConnection, eventFreshness: freshness, sourceSummary: { roles: [...new Set(facts.flatMap((item) => item.sourceRoles ?? []))], highOrMediumConfidenceFacts: facts.filter((item) => ["HIGH", "MEDIUM"].includes(item.confidence)).length, discoveryOnlyFacts: facts.filter((item) => (item.sourceRoles ?? []).every((role) => role === "DISCOVERY")).length }, relationship: input.relationship, territory: input.territory, preferredOutreachLanguage, languageEvidence, egs, ticketing, ecc, primaryEntryOpportunity, secondaryOpportunities, buyerProblemOwner: { likelyRoles, evidence: primaryEntryOpportunity === "UNKNOWN" ? [] : [`Roles follow the evidenced ${primaryEntryOpportunity} problem; no person is invented.`] }, outreachEligibility, outreachBlockOrReviewReason: reason, salesMotion: input.relationship === "PROSPECT" ? "DIRECT" : input.relationship === "PARTNER" ? "PARTNER" : "UNKNOWN", commercialPriority: priority, priorityReasons, accountCreationEligible, accountCreationReason, nextBestCommercialAction, recommendedNextAction: nextBestCommercialAction.objective, unknownsToResearch: unknowns, events: eventFacts.map((item) => ({ name: item.sourceTitle ?? "Event activity", role: "organised or operated by the account", evidence: item.claim })) };
}
