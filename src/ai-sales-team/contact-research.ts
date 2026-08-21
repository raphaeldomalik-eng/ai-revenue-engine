import type { AiSalesEvidence } from "./model.ts";
import { isEventSuiteFirstPartyTarget } from "./first-party.ts";

export type ContactResearchStatus = "CONTACT_FOUND" | "CONTACT_ROUTE_FOUND" | "CONTACT_RESEARCH_REQUIRED" | "CONTACT_PAGE_ONLY" | "BUYER_IDENTIFIED_NO_ROUTE" | "THIRD_PARTY_CONTACT_REJECTED";

type PublicNamedContact = {
  fullName: string;
  roleTitle: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  sourceUrl: string;
  sourceTitle: string | null;
  evidence: string;
  confidence: AiSalesEvidence["confidence"];
};

type PublicOrganisationRoute = {
  email: string | null;
  phone: string | null;
  contactUrl: string | null;
  sourceUrl: string;
  sourceTitle: string | null;
  evidence: string;
  confidence: AiSalesEvidence["confidence"];
};

export type ContactResearchResult = {
  likelyBuyerRole: string | null;
  buyerRoleRationale: string | null;
  namedContact: PublicNamedContact | null;
  organisationRoute: PublicOrganisationRoute | null;
  facts: AiSalesEvidence[];
  unknowns: string[];
  status: ContactResearchStatus;
  buyerIdentified: boolean;
  emailReady: boolean;
  targetProvenance: "ACCEPTED" | "REJECTED" | "UNKNOWN";
  rejectedThirdPartyContacts: string[];
};

export type ContactPersistenceTarget = {
  kind: "NAMED" | "ORGANISATION_ROUTE";
  fullName: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  contactUrl: string | null;
  roleTitle: string | null;
  sourceUrl: string;
  sourceTitle: string | null;
  evidence: string;
  confidence: AiSalesEvidence["confidence"];
};

type ContactResearchInput = Omit<ContactResearchResult, "status" | "buyerIdentified" | "emailReady" | "targetProvenance" | "rejectedThirdPartyContacts"> & { targetIdentity?: ContactResearchTargetIdentity; rejectedThirdPartyContacts?: string[] };

const schema = {
  type: "object", additionalProperties: false,
  required: ["likelyBuyerRole", "buyerRoleRationale", "namedContact", "organisationRoute", "facts", "unknowns"],
  properties: {
    likelyBuyerRole: { type: ["string", "null"] },
    buyerRoleRationale: { type: ["string", "null"] },
    namedContact: {
      type: ["object", "null"],
      properties: {
        fullName: { type: "string" }, roleTitle: { type: ["string", "null"] }, email: { type: ["string", "null"] }, phone: { type: ["string", "null"] }, linkedinUrl: { type: ["string", "null"] }, sourceUrl: { type: "string" }, sourceTitle: { type: ["string", "null"] }, evidence: { type: "string" }, confidence: { type: "string", enum: ["NONE", "LOW", "MEDIUM", "HIGH"] },
      },
      required: ["fullName", "roleTitle", "email", "phone", "linkedinUrl", "sourceUrl", "sourceTitle", "evidence", "confidence"], additionalProperties: false,
    },
    organisationRoute: {
      type: ["object", "null"],
      properties: {
        email: { type: ["string", "null"] }, phone: { type: ["string", "null"] }, contactUrl: { type: ["string", "null"] }, sourceUrl: { type: "string" }, sourceTitle: { type: ["string", "null"] }, evidence: { type: "string" }, confidence: { type: "string", enum: ["NONE", "LOW", "MEDIUM", "HIGH"] },
      },
      required: ["email", "phone", "contactUrl", "sourceUrl", "sourceTitle", "evidence", "confidence"], additionalProperties: false,
    },
    facts: { type: "array", items: { type: "object", additionalProperties: false, required: ["claim", "sourceUrl", "sourceTitle", "kind", "confidence"], properties: { claim: { type: "string" }, sourceUrl: { type: ["string", "null"] }, sourceTitle: { type: ["string", "null"] }, kind: { type: "string", const: "FACT" }, confidence: { type: "string", enum: ["NONE", "LOW", "MEDIUM", "HIGH"] } } } },
    unknowns: { type: "array", items: { type: "string" } },
  },
} as const;

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function url(value: unknown) {
  const candidate = text(value);
  return candidate && /^https?:\/\//i.test(candidate) ? candidate : null;
}

function email(value: unknown) {
  const candidate = text(value);
  return candidate && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

function publicValue(value: string | null, evidence: string, sourceUrl: string | null) {
  return value && sourceUrl && evidence.toLowerCase().includes(value.toLowerCase()) ? value : null;
}

function validNamedContact(value: ContactResearchInput["namedContact"]): PublicNamedContact | null {
  if (!value) return null;
  const fullName = text(value.fullName);
  const sourceUrl = url(value.sourceUrl);
  const evidence = text(value.evidence);
  if (!fullName || !sourceUrl || !evidence || !evidence.toLowerCase().includes(fullName.toLowerCase())) return null;
  return {
    fullName,
    roleTitle: text(value.roleTitle),
    email: publicValue(email(value.email), evidence, sourceUrl),
    phone: publicValue(text(value.phone), evidence, sourceUrl),
    linkedinUrl: (() => { const linkedInUrl = url(value.linkedinUrl); return linkedInUrl && (linkedInUrl === sourceUrl || evidence.includes(linkedInUrl)) ? linkedInUrl : null; })(),
    sourceUrl,
    sourceTitle: text(value.sourceTitle),
    evidence,
    confidence: value.confidence,
  };
}

function validOrganisationRoute(value: ContactResearchInput["organisationRoute"]): PublicOrganisationRoute | null {
  if (!value) return null;
  const sourceUrl = url(value.sourceUrl);
  const evidence = text(value.evidence);
  if (!sourceUrl || !evidence) return null;
  const route = {
    email: publicValue(email(value.email), evidence, sourceUrl),
    phone: publicValue(text(value.phone), evidence, sourceUrl),
    contactUrl: (() => { const contactUrl = url(value.contactUrl); return contactUrl && (contactUrl === sourceUrl || evidence.includes(contactUrl)) ? contactUrl : null; })(),
    sourceUrl,
    sourceTitle: text(value.sourceTitle),
    evidence,
    confidence: value.confidence,
  };
  return route.email || route.phone || route.contactUrl ? route : null;
}

export function normaliseContactResearch(value: ContactResearchInput): ContactResearchResult {
  const rawNamed = validNamedContact(value.namedContact);
  const rawRoute = validOrganisationRoute(value.organisationRoute);
  const thirdParty = /(?:ticket(?:ing)? provider|ticket platform|venue|directory|media|artist|agent|support@|powered by)/i;
  const ownershipRejected = (item: { evidence: string; sourceUrl: string }) => thirdParty.test(`${item.evidence} ${item.sourceUrl}`) && !/for (?:the )?(?:organiser|organizer|target|organisation|organization)/i.test(item.evidence);
  const namedContact = rawNamed && !ownershipRejected(rawNamed) ? rawNamed : null;
  const organisationRoute = rawRoute && !ownershipRejected(rawRoute) ? rawRoute : null;
  const facts = (value.facts ?? []).filter((fact) => fact.kind === "FACT" && Boolean(text(fact.claim)) && Boolean(url(fact.sourceUrl)));
  const rejectedThirdPartyContacts = [...(value.rejectedThirdPartyContacts ?? []), ...(rawNamed && !namedContact ? [`Rejected named contact from non-target source: ${rawNamed.sourceUrl}`] : []), ...(rawRoute && !organisationRoute ? [`Rejected organisation route from non-target source: ${rawRoute.sourceUrl}`] : [])];
  const buyerIdentified = Boolean(namedContact);
  const emailReady = Boolean(namedContact?.email || organisationRoute?.email);
  const hasPageOnly = Boolean(organisationRoute?.contactUrl && !organisationRoute.email && !organisationRoute.phone);
  return {
    likelyBuyerRole: text(value.likelyBuyerRole),
    buyerRoleRationale: text(value.buyerRoleRationale),
    namedContact,
    organisationRoute,
    facts,
    unknowns: Array.isArray(value.unknowns) ? value.unknowns.filter((item): item is string => Boolean(text(item))) : [],
    status: namedContact ? "CONTACT_FOUND" : organisationRoute ? (hasPageOnly ? "CONTACT_PAGE_ONLY" : "CONTACT_ROUTE_FOUND") : rawNamed || rawRoute ? "THIRD_PARTY_CONTACT_REJECTED" : "CONTACT_RESEARCH_REQUIRED",
    buyerIdentified,
    emailReady,
    targetProvenance: namedContact || organisationRoute ? "ACCEPTED" : rawNamed || rawRoute ? "REJECTED" : "UNKNOWN",
    rejectedThirdPartyContacts,
  };
}

export type ContactResearchCandidateState = { status: string; relationship: string; account_id: string | null; prospect_intelligence: unknown };
export type ContactResearchTargetIdentity = { accountName?: string | null; accountWebsite?: string | null; candidateName?: string | null; candidateWebsite?: string | null };

export function isContactResearchEligible(candidate: ContactResearchCandidateState) {
  const intelligence = candidate.prospect_intelligence && typeof candidate.prospect_intelligence === "object" ? candidate.prospect_intelligence as { eventConnection?: { state?: string }; accountCreationEligible?: boolean; primaryEntryOpportunity?: string; firstPartyStatus?: string; organisationResolution?: { status?: string } } : {};
  // candidate.status === "QUALIFIED" remains valid, but is intentionally not required for bounded research.
  const eligibleStatus = candidate.status !== "REJECTED" && candidate.status !== "BLOCKED";
  return Boolean(candidate.account_id) && eligibleStatus && candidate.relationship === "PROSPECT" && intelligence.firstPartyStatus !== "FIRST_PARTY_SELF" && intelligence.organisationResolution?.status !== "UNRESOLVED" && (intelligence.accountCreationEligible === true || Boolean(intelligence.primaryEntryOpportunity && intelligence.primaryEntryOpportunity !== "UNKNOWN")) && ["CONFIRMED", "STRONG"].includes(intelligence.eventConnection?.state ?? "");
}

export function contactResearchEligibility(candidate: ContactResearchCandidateState, identity: ContactResearchTargetIdentity) {
  if (isEventSuiteFirstPartyTarget(identity)) return { eligible: false as const, reason: "FIRST_PARTY_SELF" as const };
  return isContactResearchEligible(candidate)
    ? { eligible: true as const }
    : { eligible: false as const, reason: "CONTACT_RESEARCH_NOT_ELIGIBLE" as const };
}

export function contactPersistenceTargets(result: ContactResearchResult): ContactPersistenceTarget[] {
  const targets: ContactPersistenceTarget[] = [];
  if (result.namedContact) targets.push({ kind: "NAMED", ...result.namedContact, contactUrl: null });
  const route = result.organisationRoute;
  if (route && (!result.namedContact || !route.email || route.email !== result.namedContact.email)) {
    targets.push({ kind: "ORGANISATION_ROUTE", fullName: null, roleTitle: null, email: route.email, phone: route.phone, linkedinUrl: null, contactUrl: route.contactUrl, sourceUrl: route.sourceUrl, sourceTitle: route.sourceTitle, evidence: route.evidence, confidence: route.confidence });
  }
  return targets;
}

export async function researchProspectContact(input: { accountName: string; website: string | null; eventEvidence: string[]; likelyBuyerRoles: string[]; targetIdentity?: ContactResearchTargetIdentity }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  if (!apiKey) throw new Error("AI_RESEARCH_NOT_CONFIGURED: OPENAI_API_KEY is required for public contact research.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model, tools: [{ type: "web_search" }], max_output_tokens: 6000,
      input: `Research public business contact evidence for this EventSuite prospect. Do not send outreach and do not infer, guess or construct names, job titles, email addresses, phone numbers, LinkedIn URLs or email patterns. A named person is allowed only when an authoritative public source explicitly names that person and supports their role. A direct email or phone is allowed only when that exact value appears in defensible public evidence. A generic organisation address or contact route is allowed only when publicly published by an authoritative source. If no defensible contact is found, return null contacts and state the gap. The likely buyer role is an INFERENCE and must remain separate from a named person. Return FACT evidence with source URLs. Account: ${input.accountName}. Website: ${input.website ?? "not provided"}. Existing event evidence: ${input.eventEvidence.join(" | ")}. Likely buyer-role hypotheses from existing prospect intelligence: ${input.likelyBuyerRoles.join(", ") || "none"}.`,
      text: { format: { type: "json_schema", name: "prospect_contact_research", strict: true, schema } },
    }),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => null) as { error?: { message?: string; type?: string } } | null;
    throw new Error(`AI contact research provider failed with HTTP ${response.status}: ${failure?.error?.message || failure?.error?.type || "no provider detail"}`);
  }
  const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const output = payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("");
  if (!output) throw new Error("AI contact research provider returned no structured output.");
  return { result: normaliseContactResearch({ ...(JSON.parse(output) as ContactResearchInput), targetIdentity: input.targetIdentity }), provider: "openai", model };
}

export async function researchEligibleProspectContact(
  input: {
    candidate: ContactResearchCandidateState;
    identity: ContactResearchTargetIdentity;
    researchInput: Parameters<typeof researchProspectContact>[0];
  },
  provider: typeof researchProspectContact = researchProspectContact,
) {
  const eligibility = contactResearchEligibility(input.candidate, input.identity);
  if (!eligibility.eligible) return { blocked: true as const, reason: eligibility.reason };
  return { blocked: false as const, researched: await provider(input.researchInput) };
}
