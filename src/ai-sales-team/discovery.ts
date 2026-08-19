import type { AiSalesEvidence } from "./model.ts";
import { classifyAccountRelationship, type AccountRelationship } from "./outreach-model.ts";
import { evaluateProspectIntelligence, type ProspectIntelligence } from "./prospect-intelligence.ts";

export type DiscoveryTerritory = "ZA" | "GB";
export type DiscoveryFocus = "ALL" | "EGS" | "TICKETING" | "ECC";
export type DiscoveryOrigin = "EVENT_FIRST" | "ORGANISATION_FIRST";
export type DiscoveryCandidateStatus = "QUALIFIED" | "REVIEW_REQUIRED" | "BLOCKED" | "REJECTED";

export type DiscoveredCandidate = {
  canonicalName: string;
  organiserName: string | null;
  website: string | null;
  origin: DiscoveryOrigin;
  relationshipHint: AccountRelationship;
  facts: AiSalesEvidence[];
  inferences: AiSalesEvidence[];
  unknowns: string[];
};

export type EvaluatedDiscoveryCandidate = DiscoveredCandidate & {
  canonicalKey: string;
  relationship: AccountRelationship;
  status: DiscoveryCandidateStatus;
  prospectIntelligence: ProspectIntelligence;
  sourceUrls: string[];
};

const candidateSchema = {
  type: "object", additionalProperties: false, required: ["candidates"], properties: {
    candidates: { type: "array", maxItems: 8, items: {
      type: "object", additionalProperties: false,
      required: ["canonicalName", "organiserName", "website", "origin", "relationshipHint", "facts", "inferences", "unknowns"],
      properties: {
        canonicalName: { type: "string" }, organiserName: { type: ["string", "null"] }, website: { type: ["string", "null"] },
        origin: { type: "string", enum: ["EVENT_FIRST", "ORGANISATION_FIRST"] }, relationshipHint: { type: "string", enum: ["PROSPECT", "CUSTOMER", "PARTNER", "COMPETITOR", "UNKNOWN"] },
        facts: { type: "array", items: { type: "object", additionalProperties: false, required: ["claim", "sourceUrl", "sourceTitle", "kind", "confidence"], properties: { claim: { type: "string" }, sourceUrl: { type: ["string", "null"] }, sourceTitle: { type: ["string", "null"] }, kind: { type: "string", const: "FACT" }, confidence: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] } } } },
        inferences: { type: "array", items: { type: "object", additionalProperties: false, required: ["claim", "sourceUrl", "sourceTitle", "kind", "confidence"], properties: { claim: { type: "string" }, sourceUrl: { type: ["string", "null"] }, sourceTitle: { type: ["string", "null"] }, kind: { type: "string", const: "INFERENCE" }, confidence: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] } } } },
        unknowns: { type: "array", items: { type: "string" } },
      },
    } },
  },
} as const;

export function canonicalDiscoveryKey(name: string, website?: string | null) {
  const domain = website?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  return `${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}|${domain || "no-domain"}`;
}

export function evaluateDiscoveryCandidate(candidate: DiscoveredCandidate, territory: DiscoveryTerritory): EvaluatedDiscoveryCandidate {
  const relationship = classifyAccountRelationship({ name: candidate.organiserName || candidate.canonicalName, website: candidate.website, summary: [...candidate.facts, ...candidate.inferences].map((item) => item.claim).join(" "), qualificationFit: candidate.facts.length ? "MEDIUM" : "UNKNOWN", relationship: candidate.relationshipHint }).relationship;
  const prospectIntelligence = evaluateProspectIntelligence({ relationship, territory, facts: candidate.facts, inferences: candidate.inferences, unknowns: candidate.unknowns });
  const claims = candidate.facts.map((item) => item.claim).join(" ");
  const currentYear = new Date().getUTCFullYear();
  const historicalOnly = /\b(?:historic|historical|archive|archived|took place)\b/i.test(claims) && [...claims.matchAll(/\b(\d{4})\b/g)].some((match) => Number(match[1]) < currentYear - 1) && !/\b(?:current|upcoming|annual|recurring|next edition|20(?:2[6-9]|[3-9]\d))\b/i.test(claims);
  const status: DiscoveryCandidateStatus = relationship === "COMPETITOR" ? "BLOCKED" : historicalOnly ? "REJECTED" : prospectIntelligence.outreachEligibility === "ELIGIBLE" ? "QUALIFIED" : prospectIntelligence.outreachEligibility === "BLOCKED" ? "REJECTED" : "REVIEW_REQUIRED";
  return { ...candidate, canonicalKey: canonicalDiscoveryKey(candidate.organiserName || candidate.canonicalName, candidate.website), relationship, status, prospectIntelligence, sourceUrls: [...new Set(candidate.facts.map((item) => item.sourceUrl).filter((url): url is string => Boolean(url)))] };
}

export function parseDiscovery(value: unknown, territory: DiscoveryTerritory) {
  if (!value || typeof value !== "object" || !Array.isArray((value as { candidates?: unknown }).candidates)) throw new Error("Discovery returned no candidate list.");
  const raw = (value as { candidates: DiscoveredCandidate[] }).candidates;
  const seen = new Set<string>();
  return raw.filter((candidate) => candidate?.canonicalName?.trim() && candidate.facts?.some((fact) => fact.kind === "FACT" && fact.sourceUrl)).map((candidate) => evaluateDiscoveryCandidate({ ...candidate, organiserName: candidate.organiserName?.trim() || null, website: candidate.website?.trim() || null, facts: candidate.facts.filter((item) => item.kind === "FACT"), inferences: candidate.inferences.filter((item) => item.kind === "INFERENCE") }, territory)).filter((candidate) => {
    if (seen.has(candidate.canonicalKey)) return false;
    seen.add(candidate.canonicalKey);
    return true;
  });
}

export async function discoverProspects(input: { territory: DiscoveryTerritory; focus: DiscoveryFocus }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  if (!apiKey) throw new Error("AI_RESEARCH_NOT_CONFIGURED: OPENAI_API_KEY is required for real public discovery.");
  const territory = input.territory === "ZA" ? "South Africa" : "United Kingdom";
  const focus = input.focus === "ALL" ? "EGS, Ticketing and ECC" : input.focus;
  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, tools: [{ type: "web_search" }], max_output_tokens: 12000, input: `Find up to eight current public EventSuite sales candidates in ${territory}, focused on ${focus}. Today is ${new Date().toISOString().slice(0, 10)}. Start from real public event activity, preferably lesser-known regional events, festivals, venues, conferences, universities or organisers; organisation-first is allowed only when actual events are then established. Do not use topic similarity as event evidence. Return source-grounded FACTS with URLs, label hypotheses INFERENCE, and retain unknowns. A ticketing platform/provider itself is COMPETITOR; an organiser using one may be PROSPECT. Do not invent people, email addresses, dissatisfaction, event recurrence, operational tools or facts. No outreach, no contact, no crawling beyond this bounded web search.`, text: { format: { type: "json_schema", name: "autonomous_prospect_discovery", strict: true, schema: candidateSchema } } } ) });
  if (!response.ok) throw new Error(`AI discovery provider failed with HTTP ${response.status}.`);
  const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const text = payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("");
  if (!text) throw new Error("AI discovery provider returned no structured output.");
  return { candidates: parseDiscovery(JSON.parse(text), input.territory), provider: "openai", model };
}
