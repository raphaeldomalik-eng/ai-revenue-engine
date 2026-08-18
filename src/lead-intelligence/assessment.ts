import type { ClientSegment, EvidenceConfidence, ProductSlug, SalesMotion, TerritoryCode } from "../revenue/commercial-model.ts";
import { resolveCommercialPlaybook } from "../revenue/playbook-resolver.ts";
import type { AccountProfile, ClientSegmentMatch, CommercialProgramMatch, CommercialSignal, ContactProfile, EventActivity, LeadIntelligenceAssessment, LeadIntelligenceInput, MotionCandidate, OpportunityConfidence, ProductOpportunityRecommendation, ResearchEvidence, ResearchGap, TerritoryAssessment } from "./model.ts";

const confidenceRank: Record<OpportunityConfidence, number> = { UNKNOWN: 0, NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
const directOrganisationTypes = new Set(["SCHOOL", "VENUE", "EVENT_PROMOTER", "EVENT_AGENCY", "CONFERENCE_ORGANISER", "FESTIVAL_ORGANISER"]);

function normalise(value?: string) { return value?.trim().toUpperCase(); }
function factEvidence(account: AccountProfile, evidence: ResearchEvidence[]) {
  return evidence.filter((item) => item.kind === "FACT" && account.sourceEvidenceIds.includes(item.id));
}
function confidenceFor(evidence: ResearchEvidence[]): OpportunityConfidence {
  if (evidence.length === 0) return "UNKNOWN";
  return evidence.reduce<EvidenceConfidence>((best, item) => confidenceRank[item.confidence] > confidenceRank[best] ? item.confidence : best, "NONE");
}
function ids(evidence: ResearchEvidence[]) { return evidence.map((item) => item.id); }
function supported(account: AccountProfile, evidence: ResearchEvidence[]) { return factEvidence(account, evidence); }
function hasValue<T>(value: T | undefined, account: AccountProfile, evidence: ResearchEvidence[]) { return value !== undefined && supported(account, evidence).length > 0; }

function resolveTerritory(account: AccountProfile, evidence: ResearchEvidence[]): TerritoryAssessment {
  const supportedEvidence = supported(account, evidence);
  const country = normalise(account.country);
  const code = supportedEvidence.length > 0 && (country === "ZA" || country === "SOUTH AFRICA") ? "ZA" : supportedEvidence.length > 0 && (country === "GB" || country === "UK" || country === "UNITED KINGDOM") ? "GB" : "UNKNOWN";
  return { code, confidence: code === "UNKNOWN" ? "UNKNOWN" : confidenceFor(supportedEvidence), evidenceIds: code === "UNKNOWN" ? [] : ids(supportedEvidence), rationale: code === "UNKNOWN" ? "No evidence-supported territory was provided." : `Country evidence resolves to ${code}.` };
}

function addSignal(signals: CommercialSignal[], signal: CommercialSignal) { if (!signals.some((item) => item.code === signal.code)) signals.push(signal); }
function deriveSignals(account: AccountProfile, evidence: ResearchEvidence[], territory: TerritoryAssessment): CommercialSignal[] {
  const supportedEvidence = supported(account, evidence);
  const evidenceIds = ids(supportedEvidence);
  const confidence = confidenceFor(supportedEvidence);
  const signals: CommercialSignal[] = [];
  if (territory.code !== "UNKNOWN") addSignal(signals, { code: `TERRITORY_${territory.code}`, state: "PRESENT", value: territory.code, confidence: territory.confidence, evidenceIds: territory.evidenceIds, source: "Account territory evidence" });
  const organisationType = normalise(account.organisationType);
  if (organisationType && organisationType !== "UNKNOWN" && supportedEvidence.length > 0) addSignal(signals, { code: `CLIENT_TYPE_${organisationType}`, state: "PRESENT", value: organisationType, confidence, evidenceIds, source: "Account profile evidence" });
  if (hasValue(account.eventFrequency, account, evidence) && account.eventFrequency !== "UNKNOWN") {
    if (account.eventFrequency === "RECURRING" || account.eventFrequency === "HIGH_FREQUENCY") addSignal(signals, { code: "MULTIPLE_EVENTS", state: "PRESENT", value: account.eventFrequency, confidence, evidenceIds, source: "Event frequency evidence" });
    if (account.eventFrequency === "HIGH_FREQUENCY") addSignal(signals, { code: "HIGH_EVENT_FREQUENCY", state: "PRESENT", value: account.estimatedEventsPerYear, confidence, evidenceIds, source: "Event frequency evidence" });
  }
  if (account.currentSystems?.ticketingProvider && supportedEvidence.length > 0) addSignal(signals, { code: "USES_EXISTING_TICKETING_PLATFORM", state: "PRESENT", value: account.currentSystems.ticketingProvider, confidence, evidenceIds, source: "Account systems evidence", notes: "Existing ticketing is not treated as a forced migration target." });
  if (account.operationalNeeds?.some((need) => /workforce/i.test(need)) && supportedEvidence.length > 0) addSignal(signals, { code: "WORKFORCE_COMPLEXITY", state: "PRESENT", confidence, evidenceIds, source: "Operational-needs evidence" });
  if (account.operationalNeeds?.some((need) => /production/i.test(need)) && supportedEvidence.length > 0) addSignal(signals, { code: "PRODUCTION_COMPLEXITY", state: "PRESENT", confidence, evidenceIds, source: "Operational-needs evidence" });
  if (account.localNetworkSignal === true && supportedEvidence.length > 0) addSignal(signals, { code: "LOCAL_EVENT_NETWORK", state: "PRESENT", confidence, evidenceIds, source: "Network evidence" });
  return signals;
}

function deriveMotion(account: AccountProfile, evidence: ResearchEvidence[]): MotionCandidate {
  const supportedEvidence = supported(account, evidence);
  if (supportedEvidence.length === 0) return "UNKNOWN";
  const activity: EventActivity = account.eventActivity ?? "UNKNOWN";
  const direct = activity === "RUNS_EVENTS" || activity === "RUNS_AND_SERVICES" || directOrganisationTypes.has(normalise(account.organisationType) ?? "");
  const lno = activity === "SERVICES_EVENT_ORGANISERS" || activity === "RUNS_AND_SERVICES" || (account.localNetworkSignal === true && account.customerServicingCapability === true);
  if (direct && lno) return "BOTH";
  if (direct) return "DIRECT";
  if (lno) return "LNO";
  return "UNKNOWN";
}

function deriveClientSegments(account: AccountProfile, evidence: ResearchEvidence[], territory: TerritoryAssessment): ClientSegmentMatch[] {
  if (supported(account, evidence).length === 0) return [];
  const confidence = confidenceFor(supported(account, evidence));
  const evidenceIds = ids(supported(account, evidence));
  const type = normalise(account.organisationType);
  const matches: ClientSegmentMatch[] = [];
  if (type === "SCHOOL" && territory.code === "ZA") {
    const segment: ClientSegment | undefined = resolveCommercialPlaybook({ product: "event-suite", territory: "ZA", salesMotion: "direct" }).clientSegments?.find((item) => item.code === "schools");
    if (segment) matches.push({ code: segment.code, label: segment.name, matchType: "PLAYBOOK_SEGMENT", confidence, evidenceIds, commercialTreatment: segment.commercialTreatment, pricingStatus: segment.pricingStatus, pricingInstruction: segment.pricingInstruction });
  }
  if (type === "VENUE") matches.push({ code: "venue", label: "Venue", matchType: "CLIENT_TYPE", confidence, evidenceIds });
  if (type && type !== "UNKNOWN" && type !== "SCHOOL" && type !== "VENUE") matches.push({ code: type.toLowerCase(), label: type.replaceAll("_", " "), matchType: "CLIENT_TYPE", confidence, evidenceIds });
  return matches;
}

function resolvePlaybooks(territory: TerritoryAssessment, motion: MotionCandidate, evidenceIds: string[]): CommercialProgramMatch[] {
  if (territory.code === "UNKNOWN" || motion === "UNKNOWN") return [];
  const motions: Array<"direct" | "lno"> = motion === "BOTH" ? ["direct", "lno"] : [motion.toLowerCase() as "direct" | "lno"];
  return motions.map((salesMotion) => {
    const playbook = resolveCommercialPlaybook({ product: "event-suite", territory: territory.code, salesMotion });
    return { product: playbook.product, territory: playbook.territory, salesMotion, playbookId: playbook.id, playbookLabel: `${playbook.productLabel} / ${playbook.territoryLabel} / ${salesMotion.toUpperCase()}`, conversionGoals: playbook.conversionGoals, confidence: territory.confidence, evidenceIds };
  });
}

function gaps(account: AccountProfile, evidence: ResearchEvidence[], territory: TerritoryAssessment, contacts: ContactProfile[] = []): ResearchGap[] {
  const result: ResearchGap[] = [];
  const type = normalise(account.organisationType);
  if (territory.code === "UNKNOWN") result.push({ code: "territory_unknown", label: "Territory unknown", priority: "HIGH", whyItMatters: "A territory is required to resolve a commercial playbook." });
  if (!type || type === "UNKNOWN") result.push({ code: "client_type_unknown", label: "Client type unknown", priority: "HIGH", whyItMatters: "Client type affects segment and opportunity interpretation." });
  if (!account.eventFrequency || account.eventFrequency === "UNKNOWN") result.push({ code: "event_frequency_unknown", label: "Event frequency unknown", priority: "HIGH", whyItMatters: "Frequency is relevant to event operations opportunity context." });
  if (account.estimatedEventsPerYear === undefined) result.push({ code: "annual_event_count_unclear", label: "Number of annual events unclear", priority: "MEDIUM", whyItMatters: "Raw annual volume should be retained when known without inventing a threshold." });
  if (!account.region) result.push({ code: "region_unknown", label: "Region unclear", priority: "LOW", whyItMatters: "Regional context can affect local commercial handling." });
  if (!contacts.some((contact) => contact.likelyDecisionRole)) result.push({ code: "decision_maker_unknown", label: "Decision maker unknown", priority: "HIGH", whyItMatters: "A human buyer or decision role is not yet evidenced." });
  if (!account.currentSystems?.ticketingProvider) result.push({ code: "ticketing_provider_unknown", label: "Current Ticketing provider unknown", priority: "MEDIUM", whyItMatters: "Existing systems should be understood before discussing ticketing scope." });
  if (!account.operationalNeeds?.some((need) => /workforce/i.test(need))) result.push({ code: "workforce_complexity_unknown", label: "Workforce complexity unknown", priority: "MEDIUM", whyItMatters: "Workforce needs are not evidenced." });
  if (!account.operationalNeeds?.some((need) => /production/i.test(need))) result.push({ code: "production_operations_unknown", label: "Production Operations needs unknown", priority: "MEDIUM", whyItMatters: "Production Operations needs are not evidenced." });
  if (evidence.length === 0) result.push({ code: "evidence_missing", label: "Research evidence missing", priority: "HIGH", whyItMatters: "Signals must remain unknown until source evidence is supplied." });
  return result;
}

function recommendations(account: AccountProfile, motion: MotionCandidate, matches: CommercialProgramMatch[], segments: ClientSegmentMatch[], signals: CommercialSignal[]): ProductOpportunityRecommendation[] {
  if (matches.length === 0) return [];
  const evidenceIds = [...new Set(signals.flatMap((signal) => signal.evidenceIds))];
  const hasIncumbentTicketing = signals.some((signal) => signal.code === "USES_EXISTING_TICKETING_PLATFORM");
  return matches.map((match) => {
    const school = segments.find((segment) => segment.code === "schools");
    const relevantCapabilities = ["event-management", "rsvp", "workforce", "production-operations", "event-growth-studio", ...(hasIncumbentTicketing ? [] : ["ticketing"])]
      .filter((capability, index, values) => values.indexOf(capability) === index);
    const rationale = match.salesMotion === "direct" ? ["The account has evidence consistent with a Direct event opportunity."] : ["The account has evidence consistent with an LNO opportunity involving multiple customer relationships or servicing capability."];
    if (hasIncumbentTicketing) rationale.push("Existing ticketing is acknowledged; no forced migration is recommended.");
    if (segments.some((segment) => segment.code === "venue")) rationale.push("Venue is treated as a client type, not a separate Venue Operations product.");
    if (school) rationale.push("South African Schools special pricing is marked deferred and requires the approved schedule or human confirmation.");
    return {
      product: match.product, territory: match.territory, salesMotion: match.salesMotion, commercialProgram: match.playbookId, clientSegment: segments[0]?.code,
      relevantCapabilities, observedProblems: account.operationalNeeds ?? [], commercialSignals: signals.map((signal) => signal.code), evidenceIds,
      confidence: match.confidence, conversionRoute: match.salesMotion === "lno" ? "BUSINESS_OPPORTUNITY_ENQUIRY" : "UNDETERMINED", conversionRouteStatus: match.salesMotion === "lno" ? "FIXED" : "UNDETERMINED",
      pricingTreatment: school?.commercialTreatment, pricingStatus: school?.pricingStatus, rationale, nextResearchActions: ["Confirm buyer/contact and decision role", "Confirm event frequency and annual event volume"], humanReviewRequired: true,
    };
  });
}

export function assessLeadIntelligence(input: LeadIntelligenceInput): LeadIntelligenceAssessment {
  const territory = resolveTerritory(input.account, input.evidence);
  const signals = deriveSignals(input.account, input.evidence, territory);
  const motionCandidate = deriveMotion(input.account, input.evidence);
  const clientSegments = deriveClientSegments(input.account, input.evidence, territory);
  const evidenceIds = [...new Set(signals.flatMap((signal) => signal.evidenceIds))];
  const playbooks = resolvePlaybooks(territory, motionCandidate, evidenceIds);
  const recommendationsList = recommendations(input.account, motionCandidate, playbooks, clientSegments, signals);
  const researchGaps = gaps(input.account, input.evidence, territory, input.contacts);
  const unknowns = researchGaps.map((gap) => gap.code);
  const explanation = [territory.rationale, `Motion candidate: ${motionCandidate}.`, playbooks.length > 0 ? `Resolved ${playbooks.length} existing commercial playbook(s).` : "No playbook resolved because territory or motion remains unknown."];
  return { account: input.account, territory, clientSegments, motionCandidate, signals, playbooks, recommendations: recommendationsList, researchGaps, unknowns, explanation };
}
