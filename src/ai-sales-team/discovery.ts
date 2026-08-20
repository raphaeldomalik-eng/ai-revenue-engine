import type { AiSalesEvidence } from "./model.ts";
import { classifyAccountRelationship, type AccountRelationship } from "./outreach-model.ts";
import { evaluateProspectIntelligence, type ProspectIntelligence } from "./prospect-intelligence.ts";

export type DiscoveryTerritory = "ZA" | "GB";
export type DiscoveryFocus = "ALL" | "EGS" | "TICKETING" | "ECC";
export type DiscoveryOrigin = "EVENT_FIRST" | "ORGANISATION_FIRST";
export type DiscoveryCandidateStatus = "QUALIFIED" | "REVIEW_REQUIRED" | "BLOCKED" | "REJECTED";
export type DiscoverySourceRole = "DISCOVERY" | "VALIDATION" | "COMMERCIAL_EVIDENCE" | "CONTACT" | "SIGNAL";
export type EventFreshness = NonNullable<AiSalesEvidence["eventFreshness"]>;
export type DiscoveryEvidence = AiSalesEvidence & { sourceRoles?: DiscoverySourceRole[]; eventFreshness?: EventFreshness };
export type EnrichmentEvidence = DiscoveryEvidence;

export type DiscoveredCandidate = { canonicalName: string; organiserName: string | null; website: string | null; origin: DiscoveryOrigin; relationshipHint: AccountRelationship; facts: DiscoveryEvidence[]; inferences: AiSalesEvidence[]; unknowns: string[] };
export type EvaluatedDiscoveryCandidate = DiscoveredCandidate & { canonicalKey: string; relationship: AccountRelationship; status: DiscoveryCandidateStatus; prospectIntelligence: ProspectIntelligence; sourceUrls: string[] };

const sourceRoles = ["DISCOVERY", "VALIDATION", "COMMERCIAL_EVIDENCE", "CONTACT", "SIGNAL"] as const;
const freshnessStates = ["ACTIVE_UPCOMING", "RECENT_RECURRING_EVIDENCE", "HISTORICAL", "CANCELLED_DEAD_UNSUPPORTED", "UNKNOWN"] as const;
const SERVICE_NOISE_PATTERN = /\b(?:ticketing platform|ticketing software|ticketing provider|event technology|event[- ]tech|recruitment solutions?|recruitment business)\b/i;
const EVENT_CONTEXT_PATTERN = /\b(?:event|conference|symposium|festival|programme|tournament|exhibition|performance|summit|workshop|concert)\w*\b/i;
const ORGANISER_PATTERN = /\b(?:organis(?:e|es|ed|ing)|promotes?|operates?|produces?|presents?|runs?|owns?|host(?:s|ed|ing))\b/i;
const candidateSchema = {
  type: "object", additionalProperties: false, required: ["candidates"], properties: {
    candidates: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, required: ["canonicalName", "organiserName", "website", "origin", "relationshipHint", "facts", "inferences", "unknowns"], properties: {
      canonicalName: { type: "string" }, organiserName: { type: ["string", "null"] }, website: { type: ["string", "null"] }, origin: { type: "string", enum: ["EVENT_FIRST", "ORGANISATION_FIRST"] }, relationshipHint: { type: "string", enum: ["PROSPECT", "CUSTOMER", "PARTNER", "COMPETITOR", "UNKNOWN"] },
      facts: { type: "array", items: { type: "object", additionalProperties: false, required: ["claim", "sourceUrl", "sourceTitle", "kind", "confidence", "sourceRoles", "eventFreshness"], properties: { claim: { type: "string" }, sourceUrl: { type: ["string", "null"] }, sourceTitle: { type: ["string", "null"] }, kind: { type: "string", const: "FACT" }, confidence: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] }, sourceRoles: { type: "array", items: { type: "string", enum: sourceRoles } }, eventFreshness: { type: "string", enum: freshnessStates } } } },
      inferences: { type: "array", items: { type: "object", additionalProperties: false, required: ["claim", "sourceUrl", "sourceTitle", "kind", "confidence"], properties: { claim: { type: "string" }, sourceUrl: { type: ["string", "null"] }, sourceTitle: { type: ["string", "null"] }, kind: { type: "string", const: "INFERENCE" }, confidence: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] } } } }, unknowns: { type: "array", items: { type: "string" } },
    } } },
  },
} as const;

const enrichmentSchema = {
  type: "object", additionalProperties: false, required: ["candidates"], properties: {
    candidates: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, required: ["candidateRef", "facts", "inferences", "unknowns"], properties: {
      candidateRef: { type: "string" },
      facts: { type: "array", items: { type: "object", additionalProperties: false, required: ["claim", "sourceUrl", "sourceTitle", "kind", "confidence", "sourceRoles", "eventFreshness"], properties: { claim: { type: "string" }, sourceUrl: { type: ["string", "null"] }, sourceTitle: { type: ["string", "null"] }, kind: { type: "string", const: "FACT" }, confidence: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] }, sourceRoles: { type: "array", items: { type: "string", enum: sourceRoles } }, eventFreshness: { type: "string", enum: freshnessStates } } } },
      inferences: { type: "array", items: { type: "object", additionalProperties: false, required: ["claim", "sourceUrl", "sourceTitle", "kind", "confidence"], properties: { claim: { type: "string" }, sourceUrl: { type: ["string", "null"] }, sourceTitle: { type: ["string", "null"] }, kind: { type: "string", const: "INFERENCE" }, confidence: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] } } } },
      unknowns: { type: "array", items: { type: "string" } },
    } } },
  },
} as const;

const normaliseName = (value: string) => value.trim().toLowerCase().replace(/\b(?:festival|events?)\b/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const rawName = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function domainOf(website?: string | null) { return website?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "") || null; }
export function canonicalDiscoveryKey(name: string, website?: string | null) { const domain = domainOf(website); return `${domain ? normaliseName(name) : rawName(name)}|${domain || "no-domain"}`; }

function inferFreshness(claim: string, supplied?: EventFreshness): EventFreshness {
  if (supplied && freshnessStates.includes(supplied)) return supplied;
  if (/\b(?:cancelled|canceled|postponed indefinitely|closed down|defunct|no longer operating)\b/i.test(claim)) return "CANCELLED_DEAD_UNSUPPORTED";
  const year = new Date().getUTCFullYear();
  const years = [...claim.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1]));
  if (/\b(?:upcoming|next edition|tickets? on sale|this year|current|announced|opens? on)\b/i.test(claim) || years.some((value) => value >= year)) return "ACTIVE_UPCOMING";
  if (/\b(?:annual|recurring|returns?|returning|edition)\b/i.test(claim)) return "RECENT_RECURRING_EVIDENCE";
  if (/\b(?:historic|historical|archive|archived|took place|was held)\b/i.test(claim) || years.some((value) => value < year)) return "HISTORICAL";
  return "UNKNOWN";
}
function calibrateConfidence(value: DiscoveryEvidence, roles: DiscoverySourceRole[]): DiscoveryEvidence["confidence"] {
  if (!value.sourceUrl && value.confidence === "HIGH") return "MEDIUM";
  if (roles.length === 1 && roles[0] === "DISCOVERY" && value.confidence === "HIGH") return "MEDIUM";
  return value.confidence;
}
function normaliseFact(value: DiscoveryEvidence): DiscoveryEvidence { const roles = Array.isArray(value.sourceRoles) ? value.sourceRoles.filter((role): role is DiscoverySourceRole => sourceRoles.includes(role)) : []; const inferred: DiscoverySourceRole = /\b(?:organis|promotes?|operates?|produces?|presents?|runs?|owns?|hosts?)\b/i.test(value.claim) ? "VALIDATION" : /\b(?:fragmented|weak|poor|ticket|registration|multi-|vendors?|workforce|accreditation)\b/i.test(value.claim) ? "COMMERCIAL_EVIDENCE" : "DISCOVERY"; const resolvedRoles: DiscoverySourceRole[] = roles.length ? [...new Set(roles)] : [inferred]; return { ...value, confidence: calibrateConfidence(value, resolvedRoles), sourceRoles: resolvedRoles, eventFreshness: inferFreshness(value.claim, value.eventFreshness) }; }

function parseProviderText(payload: { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> }) {
  const text = (payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("") ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  if (!text) throw new Error("AI discovery provider returned no structured output.");
  return JSON.parse(text) as { candidates?: Array<{ candidateRef: string; facts: EnrichmentEvidence[]; inferences: AiSalesEvidence[]; unknowns: string[] }> };
}

export function applyDiscoveryEnrichment(candidate: EvaluatedDiscoveryCandidate, update: { facts: EnrichmentEvidence[]; inferences: AiSalesEvidence[]; unknowns: string[] }, territory: DiscoveryTerritory) {
  const factKeys = new Set(candidate.facts.map((item) => `${item.claim}::${item.sourceUrl ?? ""}`));
  const facts = [...candidate.facts, ...update.facts.filter((item) => item.kind === "FACT" && item.claim.trim() && (item.sourceUrl || item.sourceTitle) && !factKeys.has(`${item.claim}::${item.sourceUrl ?? ""}`))];
  const inferenceKeys = new Set(candidate.inferences.map((item) => item.claim));
  const inferences = [...candidate.inferences, ...update.inferences.filter((item) => item.kind === "INFERENCE" && item.claim.trim() && !inferenceKeys.has(item.claim))];
  return evaluateDiscoveryCandidate({ ...candidate, facts, inferences, unknowns: [...new Set([...candidate.unknowns, ...update.unknowns.filter((item) => item.trim())])] }, territory);
}

export async function enrichDiscoveryCandidates(candidates: EvaluatedDiscoveryCandidate[], territory: DiscoveryTerritory) {
  const targets = candidates.filter((candidate) => candidate.status === "REVIEW_REQUIRED" && candidate.relationship === "PROSPECT" && candidate.prospectIntelligence.eventConnection.state !== "NONE").slice(0, 4);
  if (!targets.length) return candidates;
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  if (!apiKey) throw new Error("AI_RESEARCH_NOT_CONFIGURED: OPENAI_API_KEY is required for prospect enrichment.");
  const dossier = targets.map((candidate, index) => ({ candidateRef: String(index + 1), candidate: candidate.canonicalName, organiser: candidate.organiserName, website: candidate.website, origin: candidate.origin, facts: candidate.facts.map((item) => ({ claim: item.claim, sourceUrl: item.sourceUrl, roles: item.sourceRoles, confidence: item.confidence })), unresolved: candidate.prospectIntelligence.accountCreationReason }));
  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, tools: [{ type: "web_search" }], max_output_tokens: 10000, input: `Perform one bounded second-stage public-web enrichment pass for these plausible ${territory === "ZA" ? "South African" : "UK"} EventSuite candidates. Do not repeat generic discovery. For each candidate, deliberately seek official organiser/event/portfolio validation, current or recurring activity, owned digital presence for EGS, concrete ticketing or registration operations for Ticketing, and observable event complexity for ECC. Use only public web evidence. A fact is FACT only when directly supported by its URL. Assign VALIDATION to evidence confirming identity/event responsibility, COMMERCIAL_EVIDENCE to evidence supporting an EGS/Ticketing/ECC problem, SIGNAL to timing/change/growth, CONTACT only for a clearly public route, and DISCOVERY only for existence. Calibrate confidence: official direct evidence may be HIGH, credible corroboration MEDIUM, generic listings or indirect evidence LOW/MEDIUM. Return a useful INFERENCE only when it follows from sourced facts. Return a meaningful UNKNOWN when a material commercial question remains unanswered. Do not invent providers, dissatisfaction, switching intent, people, emails or operational tools. If no commercial evidence exists, say so through a specific unknown and leave the candidate unqualified. Never approve or send outreach. Dossiers: ${JSON.stringify(dossier)}`, text: { format: { type: "json_schema", name: "prospecting_evidence_enrichment", strict: true, schema: enrichmentSchema } } }) });
  if (!response.ok) throw new Error(`AI enrichment provider failed with HTTP ${response.status}.`);
  const parsed = parseProviderText(await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> });
  const updates = new Map((parsed.candidates ?? []).filter((item) => targets[Number(item.candidateRef) - 1]).map((item) => [item.candidateRef, item]));
  return candidates.map((candidate) => { const index = targets.indexOf(candidate); const update = updates.get(String(index + 1)); return update ? applyDiscoveryEnrichment(candidate, update, territory) : candidate; });
}

export function evaluateDiscoveryCandidate(candidate: DiscoveredCandidate, territory: DiscoveryTerritory): EvaluatedDiscoveryCandidate {
  const facts = candidate.facts.filter((item) => item.kind === "FACT").map(normaliseFact);
  const relationship = classifyAccountRelationship({ name: candidate.organiserName || candidate.canonicalName, website: candidate.website, summary: [...facts, ...candidate.inferences].map((item) => item.claim).join(" "), qualificationFit: facts.length ? "MEDIUM" : "UNKNOWN", relationship: candidate.relationshipHint }).relationship;
  const prospectIntelligence = evaluateProspectIntelligence({ relationship, territory, facts, inferences: candidate.inferences.filter((item) => item.kind === "INFERENCE"), unknowns: candidate.unknowns });
  const freshness = prospectIntelligence.eventFreshness.state;
  const hasOrganiserEvidence = facts.some((item) => EVENT_CONTEXT_PATTERN.test(item.claim) && ORGANISER_PATTERN.test(item.claim));
  const providerNoise = relationship !== "COMPETITOR" && facts.some((item) => SERVICE_NOISE_PATTERN.test(item.claim)) && !hasOrganiserEvidence;
  const status: DiscoveryCandidateStatus = relationship === "COMPETITOR" ? "BLOCKED" : providerNoise ? "REJECTED" : freshness === "HISTORICAL" || freshness === "CANCELLED_DEAD_UNSUPPORTED" || prospectIntelligence.eventConnection.state === "NONE" ? "REJECTED" : prospectIntelligence.accountCreationEligible ? "QUALIFIED" : "REVIEW_REQUIRED";
  return { ...candidate, facts, canonicalKey: canonicalDiscoveryKey(candidate.organiserName || candidate.canonicalName, candidate.website), relationship, status, prospectIntelligence, sourceUrls: [...new Set(facts.map((item) => item.sourceUrl).filter((url): url is string => Boolean(url)))] };
}

export function parseDiscovery(value: unknown, territory: DiscoveryTerritory) {
  if (!value || typeof value !== "object" || !Array.isArray((value as { candidates?: unknown }).candidates)) throw new Error("Discovery returned no candidate list.");
  const seen = new Set<string>();
  return (value as { candidates: DiscoveredCandidate[] }).candidates.filter((candidate) => candidate?.canonicalName?.trim() && candidate.facts?.some((fact) => fact.kind === "FACT" && fact.sourceUrl)).map((candidate) => evaluateDiscoveryCandidate({ ...candidate, organiserName: candidate.organiserName?.trim() || null, website: candidate.website?.trim() || null }, territory)).filter((candidate) => { if (seen.has(candidate.canonicalKey)) return false; seen.add(candidate.canonicalKey); return true; });
}

export async function discoverProspects(input: { territory: DiscoveryTerritory; focus: DiscoveryFocus }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  if (!apiKey) throw new Error("AI_RESEARCH_NOT_CONFIGURED: OPENAI_API_KEY is required for real public discovery.");
  const territory = input.territory === "ZA" ? "South Africa" : "United Kingdom";
  const focus = input.focus === "ALL" ? "EGS, Ticketing and ECC" : input.focus;
  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, tools: [{ type: "web_search" }], max_output_tokens: 12000, input: `Find up to eight current public EventSuite sales candidates in ${territory}, focused on ${focus}. Today is ${new Date().toISOString().slice(0, 10)}. Discover commercially responsible organisations, not event lists. Use either EVENT_FIRST (event then responsible organisation) or ORGANISATION_FIRST (organiser/promoter/venue then its active event portfolio) only when public evidence supports that origin. Every FACT needs an authoritative URL, one or more source roles (DISCOVERY, VALIDATION, COMMERCIAL_EVIDENCE, CONTACT, SIGNAL), source confidence, and freshness (ACTIVE_UPCOMING, RECENT_RECURRING_EVIDENCE, HISTORICAL, CANCELLED_DEAD_UNSUPPORTED or UNKNOWN). Confirm organiser responsibility explicitly; a listing or artist appearance is not sufficient. Historical one-off or cancelled events are discovery memory, not live prospects. Diagnose EGS only from observable weak/fragmented owned digital presence; Ticketing only from a specific commercial problem, not provider use alone; ECC only from observed operational complexity. A ticketing provider is a COMPETITOR only when the organisation itself provides the product; an organiser using it remains a PROSPECT. Return FACTS, separate cautious INFERENCES and commercially relevant UNKNOWNs. Do not invent people, emails, dissatisfaction, recurrence, provider relationships or operational tools. No outreach, contact, scraping or crawling beyond this bounded web search.`, text: { format: { type: "json_schema", name: "prospecting_quality_foundation", strict: true, schema: candidateSchema } } } ) });
  if (!response.ok) throw new Error(`AI discovery provider failed with HTTP ${response.status}.`);
  const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const text = payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("");
  if (!text) throw new Error("AI discovery provider returned no structured output.");
  const initial = parseDiscovery(JSON.parse(text), input.territory);
  let candidates = initial;
  try {
    candidates = await enrichDiscoveryCandidates(initial, input.territory);
  } catch {
    candidates = initial.map((candidate) => candidate.status === "REVIEW_REQUIRED" ? { ...candidate, unknowns: [...new Set([...candidate.unknowns, "Second-stage commercial enrichment was unavailable; validation and product fit remain unresolved."])] } : candidate);
  }
  return { candidates, provider: "openai", model };
}
