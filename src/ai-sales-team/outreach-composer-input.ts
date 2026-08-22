import type { ComposerEvidence, ComposerInput, ComposerStage } from "./outreach-composer.ts";

function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function domain(value: string | null) { try { return value ? new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.replace(/^www\./, "").toLowerCase() : null; } catch { return null; } }

export function composerInputFromPersisted(input: { account: any; brief: any; contact?: any | null; stage: ComposerStage; originalStage?: "EMAIL_1" | "EMAIL_2" | "EMAIL_3"; priorMessageBody?: string | null; humanInstruction?: string | null; stopState?: ComposerInput["sequence"]["stopState"] }): ComposerInput {
  const metadata = input.account?.metadata && typeof input.account.metadata === "object" ? input.account.metadata : {};
  const intelligence = metadata.prospectIntelligence && typeof metadata.prospectIntelligence === "object" ? metadata.prospectIntelligence : {};
  const facts = Array.isArray(input.brief?.facts) ? input.brief.facts : [];
  const inferences = Array.isArray(input.brief?.inferences) ? input.brief.inferences : [];
  const evidence: ComposerEvidence[] = [...facts, ...inferences].map((item: any, index) => ({ id: `brief-evidence-${index + 1}`, claim: text(item?.claim) ?? "Evidence claim not recorded", sourceUrl: text(item?.sourceUrl), sourceTitle: text(item?.sourceTitle), kind: item?.kind === "INFERENCE" ? "INFERENCE" : "FACT", approved: Boolean(text(item?.claim) && (item?.kind === "FACT" || item?.confidence === "HIGH" || item?.confidence === "MEDIUM")) }));
  const contactMetadata = input.contact?.metadata && typeof input.contact.metadata === "object" ? input.contact.metadata : {};
  const provenance = contactMetadata.provenance && typeof contactMetadata.provenance === "object" ? contactMetadata.provenance : {};
  const contactName = text(input.contact?.full_name);
  const contactRole = text(input.contact?.role_title);
  const targetRelationship = metadata.relationship === "CUSTOMER" || metadata.relationship === "PARTNER" || metadata.relationship === "COMPETITOR" || metadata.relationship === "UNKNOWN" ? metadata.relationship : "PROSPECT";
  const fit = input.brief?.qualification?.fit === "HIGH" || input.brief?.qualification?.fit === "MEDIUM" || input.brief?.qualification?.fit === "LOW" ? input.brief.qualification.fit : "UNKNOWN";
  const productEvidence = [intelligence.egs, intelligence.ticketing, intelligence.ecc].flatMap((item: any) => Array.isArray(item?.facts) ? item.facts.map((value: any) => text(value?.claim)).filter(Boolean) : []);
  const classification = text(contactMetadata.buyerRoutingClassification) ?? text(contactMetadata.personClassification) ?? null;
  const route = contactName ? "NAMED_BUYER" : "NONE";
  return {
    target: { canonicalName: text(input.account?.name) ?? "Unknown organisation", canonicalDomain: domain(text(input.account?.website)), eligible: metadata.outreachEligibility === "ELIGIBLE" || intelligence.outreachEligibility === "ELIGIBLE", relationship: targetRelationship },
    originatingLane: text(metadata.discoveryLane) ?? text(metadata.originatingLane) ?? "UNKNOWN",
    recipient: { name: contactName, role: contactRole, classification, hasVerifiedBusinessEmail: Boolean(input.contact?.email && (input.contact?.verification_status === "VERIFIED" || contactMetadata.emailVerified === true)) },
    relationships: { organisation: text(input.account?.name), event: text(metadata.eventName), venue: text(metadata.venueName), operator: text(metadata.operatorName) },
    evidence,
    commercialOpportunity: { fit, productEvidence, noEvidence: productEvidence.length === 0 },
    contactProvenance: { ownershipValidated: Boolean(contactName && (provenance.ownershipConfidence === "HIGH" || contactMetadata.ownershipValidated === true)), sourceUrl: text(provenance.sourceUrl) ?? text(contactMetadata.sourceUrl), route },
    sequence: { stage: input.stage, originalStage: input.originalStage, priorMessageBody: input.priorMessageBody ?? null, stopState: input.stopState ?? (metadata.outreachStopState ?? "CLEAR") },
    humanInstruction: input.humanInstruction ?? null,
    humanRequestedLinks: false,
  };
}
