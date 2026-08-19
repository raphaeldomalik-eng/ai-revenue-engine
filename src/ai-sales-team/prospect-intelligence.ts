import type { AccountRelationship } from "./outreach-model.ts";
import type { AiSalesEvidence } from "./model.ts";
import { EVENTSUITE_LANDING_URL, selectResourceOffer, type ResourceOffer } from "./resource-offers.ts";

export type EventConnectionState = "CONFIRMED" | "STRONG" | "WEAK" | "NONE";
export type OpportunityStrength = "CONFIRMED_NEED" | "STRONG_HYPOTHESIS" | "POSSIBLE" | "NO_EVIDENCE" | "NOT_APPLICABLE";
export type ProspectOpportunity = "EGS" | "TICKETING" | "ECC" | "UNKNOWN";
export type OutreachDecision = "ELIGIBLE" | "REVIEW_REQUIRED" | "BLOCKED";
export type OutreachMotion = "DIRECT" | "PARTNER" | "UNKNOWN";
export type CommercialActionType = "PRODUCT_EXPLORATION" | "VALUE_RESOURCE" | "LOW_COMMITMENT_REPLY" | "HUMAN_ASSISTED" | "NONE";
export type CommercialActionCode = "EXPLORE_EVENTSUITE" | "VIEW_RESOURCE" | "REPLY_FOR_MORE_INFO" | "BOOK_WALKTHROUGH" | "NONE";

export type LensAssessment = {
  status: "ASSESSED" | "NOT_ASSESSED";
  opportunityStrength: OpportunityStrength;
  facts: string[];
  inferences: string[];
  unknowns: string[];
};

export type ProspectIntelligence = {
  eventConnection: { state: EventConnectionState; reasons: string[]; evidence: string[] };
  relationship: AccountRelationship;
  territory: "ZA" | "GB" | "UNKNOWN";
  preferredOutreachLanguage: "EN" | "AF" | "OTHER" | "UNKNOWN";
  languageEvidence: AiSalesEvidence[];
  egs: LensAssessment;
  ticketing: LensAssessment;
  ecc: LensAssessment;
  primaryEntryOpportunity: ProspectOpportunity;
  secondaryOpportunities: ProspectOpportunity[];
  buyerProblemOwner: { likelyRoles: string[]; evidence: string[] };
  outreachEligibility: OutreachDecision;
  outreachBlockOrReviewReason: string | null;
  salesMotion: OutreachMotion;
  commercialPriority: "HIGH" | "MEDIUM" | "LOW";
  priorityReasons: string[];
  nextBestCommercialAction: { type: CommercialActionType; code: CommercialActionCode; objective: string; ctaLabel: string; targetUrlIfVerified: string | null; productDestinationUrl: string; resourceOffer: ResourceOffer; rationale: string; humanHelpFallback: string | null; evidence: string[]; confidence: "LOW" | "MEDIUM" | "HIGH"; callRecommended: boolean };
  recommendedNextAction: string;
  unknownsToResearch: string[];
  events: Array<{ name: string; role: string; evidence: string }>;
};

const EVENT_PATTERN = /\b(?:event|events|conference|conferences|symposium|symposiums|festival|festivals|graduation|graduations|lecture|lectures|programme|programmes|tournament|tournaments|exhibition|exhibitions|performance|performances|summit|summits|workshop|workshops|concert|concerts)\b/i;
const ACTIVITY_PATTERN = /\b(?:hosts?|organis(?:e|es|ed|ing)|runs?|owns?|operates?|produces?|presents?|annual|recurring|edition|programme|programmes|dates?|multi-day|multi-stage|multiple venues?|multiple rooms?|suppliers?|exhibitors?|vendors?|workforce|teams?)\b/i;
const PAID_PATTERN = /\b(?:paid|ticket(?:ed|ing|s)?|registration|admission|ticket tiers?|scanning|box office|orders?|upsell|reconciliation|guest(?:s| list)?|comps?)\b/i;
const DIGITAL_GAP_PATTERN = /\b(?:no meaningful owned|weak owned|poor owned|fragmented|thin|social channels? .*site|ticket-provider page .*site|missing .*programme|weak .*digital|poor .*presence|discoverab(?:ility|le)|public information .*spread)\b/i;
const COMPLEXITY_PATTERN = /\b(?:multi-day|multi-stage|multi-room|multiple venues?|multiple locations?|suppliers?|exhibitors?|vendors?|workforce|production schedule|technical dependencies|guest operations|complex programme|concurrent|simultaneous)\b/i;
const AFRIKAANS_PATTERN = /\b(?:afrikaans|afrikaans-language|predominantly afrikaans)\b/i;
const HIGH_TOUCH_PATTERN = /\b(?:enterprise|procurement|migration|settlement|security|multiple departments?|multiple events?|multi-event)\b/i;

function materialEvidence(items: AiSalesEvidence[]) {
  return items.filter((item) => item.kind === "FACT" && item.claim.trim());
}

function assessment(strength: OpportunityStrength, facts: string[], inferences: string[], unknowns: string[]): LensAssessment {
  return { status: "ASSESSED", opportunityStrength: strength, facts, inferences, unknowns };
}

function selectCommercialAction(input: { eligible: boolean; primary: ProspectOpportunity; ticketing: LensAssessment; egs: LensAssessment; ecc: LensAssessment; claims: string[]; buyerRoles: string[] }) : ProspectIntelligence["nextBestCommercialAction"] {
  const resourceOffer = selectResourceOffer({ primary: input.primary, claims: input.claims, buyerRoles: input.buyerRoles });
  if (!input.eligible || input.primary === "UNKNOWN") return { type: "NONE", code: "NONE", objective: "Do not advance ordinary Direct outreach until Prospect Intelligence is eligible.", ctaLabel: "No outreach CTA", targetUrlIfVerified: null, productDestinationUrl: EVENTSUITE_LANDING_URL, resourceOffer, rationale: "The event connection or evidence-backed opportunity is not sufficient for normal Direct outreach.", humanHelpFallback: null, evidence: [], confidence: "HIGH", callRecommended: false };
  const highTouch = HIGH_TOUCH_PATTERN.test(input.claims.join(" ")) || (input.primary === "ECC" && input.ecc.opportunityStrength === "STRONG_HYPOTHESIS");
  if (highTouch) return { type: "HUMAN_ASSISTED", code: "BOOK_WALKTHROUGH", objective: "Offer a guided walkthrough only because the evidenced event complexity warrants it.", ctaLabel: "Reply to arrange a walkthrough", targetUrlIfVerified: null, productDestinationUrl: EVENTSUITE_LANDING_URL, resourceOffer, rationale: "Observed event-operating, migration, procurement or enterprise complexity makes a guided conversation materially useful.", humanHelpFallback: "Explore EventSuite first if a lighter-weight route is easier.", evidence: input.primary === "ECC" ? input.ecc.facts : input.claims.filter((claim) => HIGH_TOUCH_PATTERN.test(claim)), confidence: "MEDIUM", callRecommended: true };
  return { type: "PRODUCT_EXPLORATION", code: "EXPLORE_EVENTSUITE", objective: "Invite the organiser to explore EventSuite before choosing a product or setup path.", ctaLabel: "Explore EventSuite", targetUrlIfVerified: EVENTSUITE_LANDING_URL, productDestinationUrl: EVENTSUITE_LANDING_URL, resourceOffer, rationale: "Cold prospects should start at the public EventSuite landing page, which explains the connected platform and routes first-time evaluators to the right path.", humanHelpFallback: "Reply if help would be useful.", evidence: input.primary === "EGS" ? input.egs.facts : input.primary === "TICKETING" ? input.ticketing.facts : input.ecc.facts, confidence: "HIGH", callRecommended: false };
}

export function evaluateProspectIntelligence(input: {
  relationship: AccountRelationship;
  territory: ProspectIntelligence["territory"];
  facts: AiSalesEvidence[];
  inferences: AiSalesEvidence[];
  unknowns?: string[];
}): ProspectIntelligence {
  const facts = materialEvidence(input.facts);
  const claims = facts.map((item) => item.claim);
  const eventFacts = facts.filter((item) => EVENT_PATTERN.test(item.claim) && ACTIVITY_PATTERN.test(item.claim));
  const eventMentionFacts = facts.filter((item) => EVENT_PATTERN.test(item.claim));
  const eventConnection: ProspectIntelligence["eventConnection"] = eventFacts.length
    ? { state: eventFacts.some((item) => /\b(?:annual|recurring|edition|multi-day|multi-stage|programme|programmes)\b/i.test(item.claim)) ? "CONFIRMED" : "STRONG", reasons: ["Source-grounded evidence identifies actual event activity or an event programme."], evidence: eventFacts.map((item) => item.claim) }
    : eventMentionFacts.length
      ? { state: "WEAK", reasons: ["Events are mentioned, but the supplied evidence does not establish a concrete organiser/event opportunity."], evidence: eventMentionFacts.map((item) => item.claim) }
      : { state: "NONE", reasons: ["No source-grounded EventSuite-relevant event activity was established."], evidence: [] };

  const eventEligible = eventConnection.state === "CONFIRMED" || eventConnection.state === "STRONG";
  const egsFacts = claims.filter((claim) => DIGITAL_GAP_PATTERN.test(claim));
  const ticketFacts = claims.filter((claim) => PAID_PATTERN.test(claim));
  const eccFacts = claims.filter((claim) => COMPLEXITY_PATTERN.test(claim));
  const egs = eventEligible && egsFacts.length ? assessment("STRONG_HYPOTHESIS", egsFacts, ["The event has audience or activity evidence alongside a weak or fragmented owned presence."], ["Validate the organiser's preferred canonical event information path."]) : eventEligible ? assessment("POSSIBLE", [], ["An event is established, but a specific owned-digital problem is not yet evidenced."], ["Research event discoverability and owned digital presence."]) : assessment(eventConnection.state === "NONE" ? "NO_EVIDENCE" : "POSSIBLE", [], [], ["Establish an actual event connection before assessing EGS."]);
  const ticketing = eventEligible && ticketFacts.length ? assessment("STRONG_HYPOTHESIS", ticketFacts, ["The event evidence indicates ticketing, registration or admission operations that may warrant review."], ["Validate the organiser's current ticketing and reconciliation workflow."]) : eventEligible ? assessment("POSSIBLE", [], ["An event is established, but ticketing need is not confirmed."], ["Research paid admission, registration and event commerce details."]) : assessment(eventConnection.state === "NONE" ? "NO_EVIDENCE" : "POSSIBLE", [], [], ["Establish an actual event connection before assessing Ticketing."]);
  const ecc = eventEligible && eccFacts.length ? assessment("STRONG_HYPOTHESIS", eccFacts, ["Observed event structure indicates meaningful coordination complexity."], ["Validate teams, suppliers and next-best-action ownership."]) : eventEligible ? assessment("POSSIBLE", [], ["An event is established, but operational complexity is not confirmed."], ["Research event scale, programme structure and operating stakeholders."]) : assessment(eventConnection.state === "NONE" ? "NO_EVIDENCE" : "POSSIBLE", [], [], ["Establish an actual event connection before assessing ECC."]);

  const candidates: Array<[ProspectOpportunity, LensAssessment]> = [["EGS", egs], ["TICKETING", ticketing], ["ECC", ecc]];
  const strong = candidates.filter(([, item]) => item.opportunityStrength === "CONFIRMED_NEED" || item.opportunityStrength === "STRONG_HYPOTHESIS");
  const primaryEntryOpportunity = strong.length ? strong.sort((a, b) => (["EGS", "TICKETING", "ECC"].indexOf(a[0]) - ["EGS", "TICKETING", "ECC"].indexOf(b[0])))[0][0] : "UNKNOWN";
  const secondaryOpportunities = strong.filter(([engine]) => engine !== primaryEntryOpportunity).map(([engine]) => engine);
  const likelyRoles = primaryEntryOpportunity === "EGS" ? ["Event Director", "Marketing Lead", "Organiser"] : primaryEntryOpportunity === "TICKETING" ? ["Ticketing Lead", "Commercial Lead", "Event Director"] : primaryEntryOpportunity === "ECC" ? ["Event Operations Lead", "Production Lead", "Event Director"] : [];
  const buyerProblemOwner = { likelyRoles, evidence: primaryEntryOpportunity === "UNKNOWN" ? [] : [`Roles follow the evidenced ${primaryEntryOpportunity} event problem; no person is invented.`] };
  const languageEvidence = facts.filter((item) => AFRIKAANS_PATTERN.test(item.claim));
  const preferredOutreachLanguage = languageEvidence.length ? "AF" : input.territory === "UNKNOWN" ? "UNKNOWN" : "EN";
  const relationshipBlocked = input.relationship === "COMPETITOR";
  const sufficient = eventEligible && primaryEntryOpportunity !== "UNKNOWN" && strong.length > 0 && facts.length > 0 && likelyRoles.length > 0;
  const outreachEligibility: OutreachDecision = relationshipBlocked ? "BLOCKED" : input.relationship !== "PROSPECT" ? "REVIEW_REQUIRED" : sufficient ? "ELIGIBLE" : eventConnection.state === "NONE" ? "BLOCKED" : "REVIEW_REQUIRED";
  const reason = relationshipBlocked ? "Competitor — standard sales outreach not recommended" : outreachEligibility === "ELIGIBLE" ? null : eventConnection.state === "NONE" ? "No EventSuite-relevant event connection; ordinary Direct outreach is blocked." : "Prospect Intelligence requires further event or opportunity evidence before ordinary Direct outreach.";
  const priority: ProspectIntelligence["commercialPriority"] = primaryEntryOpportunity === "UNKNOWN" ? "LOW" : egs.opportunityStrength === "STRONG_HYPOTHESIS" && DIGITAL_GAP_PATTERN.test(claims.join(" ")) ? "HIGH" : "MEDIUM";
  const unknowns = [...(input.unknowns ?? []), ...(primaryEntryOpportunity === "UNKNOWN" ? ["Actual event activity and EventSuite-relevant problem owner"] : [])];
  const nextBestCommercialAction = selectCommercialAction({ eligible: outreachEligibility === "ELIGIBLE", primary: primaryEntryOpportunity, ticketing, egs, ecc, claims, buyerRoles: likelyRoles });
  return { eventConnection, relationship: input.relationship, territory: input.territory, preferredOutreachLanguage, languageEvidence, egs, ticketing, ecc, primaryEntryOpportunity, secondaryOpportunities, buyerProblemOwner, outreachEligibility, outreachBlockOrReviewReason: reason, salesMotion: input.relationship === "PROSPECT" ? "DIRECT" : input.relationship === "PARTNER" ? "PARTNER" : "UNKNOWN", commercialPriority: priority, priorityReasons: priority === "HIGH" ? ["Strong event activity and weak owned digital presence are evidenced; small size is not penalised."] : primaryEntryOpportunity === "UNKNOWN" ? ["No event connection or primary opportunity is established."] : ["Event activity is evidenced; lens-specific problem strength remains subject to review."], nextBestCommercialAction, recommendedNextAction: nextBestCommercialAction.objective, unknownsToResearch: unknowns, events: eventFacts.map((item) => ({ name: item.sourceTitle ?? "Event activity", role: "organised or operated by the account", evidence: item.claim })) };
}
