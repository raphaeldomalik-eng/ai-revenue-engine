import type { SupabaseClient } from "@supabase/supabase-js";
import { generateOutreachComposerDraft, type ComposerInput, type ValidatedComposerDraft } from "./outreach-composer.ts";
import { OUTREACH_COMPOSER_BODY_URL_ALLOWLIST, renderApprovedOutreachComposerSignature } from "./outreach-composer-config.ts";

export const COMPOSER_REVIEW_TAGS = ["GOOD_PERSONALISATION", "GENERIC_PERSONALISATION", "GOOD_TONE", "TOO_SALESY", "TOO_FORMAL", "TOO_LONG", "UNSUPPORTED_CLAIM", "WRONG_PRODUCT_ANGLE", "WRONG_PERSON", "CTA_TOO_STRONG", "CTA_TOO_WEAK", "MANUAL_REWRITE", "DO_NOT_CONTACT"] as const;
export type ComposerReviewAction = "APPROVE" | "REJECT" | "REQUEST_REVISION" | "EDIT" | "EDIT_APPROVE" | "RATE";

export type ComposerPersistenceOptions = { fetchImpl?: typeof fetch; candidateId?: string | null };

function optionsFor(value?: typeof fetch | ComposerPersistenceOptions) {
  return typeof value === "function" ? { fetchImpl: value, candidateId: null } : { fetchImpl: value?.fetchImpl, candidateId: value?.candidateId ?? null };
}

function rowForVersion(draftId: string, sequenceNumber: number, revisionNumber: number, sourceKind: "MODEL_DRAFT" | "AI_REVISION" | "HUMAN_EDIT", value: ValidatedComposerDraft, actorId: string, instruction: string | null) {
  return { draft_id: draftId, sequence_number: sequenceNumber, revision_number: revisionNumber, source_kind: sourceKind, prompt_version: value.model.promptVersion, sequence_stage: value.model.sequenceStage, model_status: value.model.status, message_type: value.model.messageType, subject: value.model.subject, body_plain_text: value.model.bodyPlainText, rendered_body: value.renderedBody, structured_output: { ...value.model, telemetry: value.telemetry }, human_instruction: instruction, created_by: actorId };
}

export async function createComposerDraft(client: SupabaseClient, input: ComposerInput, actorId: string, accountId: string, briefId: string | null, contactId: string | null, options?: typeof fetch | ComposerPersistenceOptions) {
  const { fetchImpl, candidateId } = optionsFor(options);
  const generated = await generateOutreachComposerDraft(input, fetchImpl);
  const draftInsert = await client.from("ai_outreach_drafts").insert({ candidate_id: candidateId, account_id: accountId, ai_sales_brief_id: briefId, contact_id: contactId, prompt_version: input.sequence.stage === "REVISION" ? "outreach-composer-v1" : generated.model.promptVersion, originating_lane: input.originatingLane, recipient_name: input.recipient.name, recipient_role: input.recipient.role, recipient_email: null, evidence_snapshot: input.evidence, stop_state: input.sequence.stopState, status: generated.model.status === "DO_NOT_DRAFT" ? "BLOCKED" : "ACTIVE", created_by: actorId }).select("id").single();
  if (draftInsert.error || !draftInsert.data) throw draftInsert.error ?? new Error("OUTREACH_COMPOSER_DRAFT_CREATE_FAILED");
  const versionInsert = await client.from("ai_outreach_draft_versions").insert(rowForVersion(draftInsert.data.id, generated.model.sequenceStage === "EMAIL_1" ? 0 : generated.model.sequenceStage === "EMAIL_2" ? 1 : 2, 0, "MODEL_DRAFT", generated, actorId, input.humanInstruction ?? null)).select("id").single();
  if (versionInsert.error || !versionInsert.data) throw versionInsert.error ?? new Error("OUTREACH_COMPOSER_VERSION_CREATE_FAILED");
  return { draftId: draftInsert.data.id, versionId: versionInsert.data.id, generated };
}

export async function createComposerSequence(client: SupabaseClient, input: ComposerInput, actorId: string, accountId: string, briefId: string | null, contactId: string | null, options?: typeof fetch | ComposerPersistenceOptions) {
  const { fetchImpl, candidateId } = optionsFor(options);
  const generated: ValidatedComposerDraft[] = [];
  for (const sequenceStage of ["EMAIL_1", "EMAIL_2", "EMAIL_3"] as const) {
    const stageInput: ComposerInput = { ...input, sequence: { ...input.sequence, stage: sequenceStage, originalStage: undefined, priorMessageBody: generated.at(-1)?.model.bodyPlainText ?? null } };
    const next = await generateOutreachComposerDraft(stageInput, fetchImpl);
    generated.push(next);
    if (next.model.status !== "DRAFT_READY") break;
  }
  const first = generated[0];
  if (!first) throw new Error("OUTREACH_COMPOSER_SEQUENCE_EMPTY");
  const draftInsert = await client.from("ai_outreach_drafts").insert({ candidate_id: candidateId, account_id: accountId, ai_sales_brief_id: briefId, contact_id: contactId, prompt_version: first.model.promptVersion, originating_lane: input.originatingLane, recipient_name: input.recipient.name, recipient_role: input.recipient.role, recipient_email: null, evidence_snapshot: input.evidence, stop_state: input.sequence.stopState, status: first.model.status === "DO_NOT_DRAFT" ? "BLOCKED" : "ACTIVE", created_by: actorId }).select("id").single();
  if (draftInsert.error || !draftInsert.data) throw draftInsert.error ?? new Error("OUTREACH_COMPOSER_DRAFT_CREATE_FAILED");
  const rows = generated.map((value, index) => rowForVersion(draftInsert.data.id, index, 0, "MODEL_DRAFT", value, actorId, input.humanInstruction ?? null));
  const versions = await client.from("ai_outreach_draft_versions").insert(rows).select("id");
  if (versions.error) throw versions.error;
  return { draftId: draftInsert.data.id, versionIds: (versions.data ?? []).map((item: any) => item.id), generated };
}

export async function reviseComposerDraft(client: SupabaseClient, input: ComposerInput, draftId: string, actorId: string, latestRevisionNumber: number, options?: typeof fetch | ComposerPersistenceOptions) {
  const { fetchImpl } = optionsFor(options);
  const generated = await generateOutreachComposerDraft(input, fetchImpl);
  const sequenceNumber = input.sequence.originalStage === "EMAIL_2" ? 1 : input.sequence.originalStage === "EMAIL_3" ? 2 : 0;
  const versionInsert = await client.from("ai_outreach_draft_versions").insert(rowForVersion(draftId, sequenceNumber, latestRevisionNumber + 1, "AI_REVISION", generated, actorId, input.humanInstruction ?? null)).select("id").single();
  if (versionInsert.error || !versionInsert.data) throw versionInsert.error ?? new Error("OUTREACH_COMPOSER_REVISION_CREATE_FAILED");
  return { versionId: versionInsert.data.id, generated };
}

export async function editComposerDraft(client: SupabaseClient, input: { versionId: string; actorId: string; subject: string; body: string; stage: "EMAIL_1" | "EMAIL_2" | "EMAIL_3" }) {
  const { data: prior, error: priorError } = await client.from("ai_outreach_draft_versions").select("*").eq("id", input.versionId).single();
  if (priorError || !prior) throw new Error("OUTREACH_COMPOSER_VERSION_NOT_FOUND");
  const edited = validateHumanEditedComposerText(input.subject, input.body, input.stage);
  const next = await client.from("ai_outreach_draft_versions").insert({
    draft_id: prior.draft_id,
    sequence_number: prior.sequence_number,
    revision_number: Number(prior.revision_number ?? 0) + 1,
    source_kind: "HUMAN_EDIT",
    prompt_version: "outreach-composer-v1",
    sequence_stage: input.stage,
    model_status: "DRAFT_READY",
    message_type: prior.message_type,
    subject: edited.subject,
    body_plain_text: edited.bodyPlainText,
    rendered_body: edited.renderedBody,
    structured_output: { ...(prior.structured_output ?? {}), subject: edited.subject, bodyPlainText: edited.bodyPlainText, sequenceStage: input.stage, status: "DRAFT_READY" },
    human_instruction: "Human edit; approval required again.",
    created_by: input.actorId,
  }).select("id").single();
  if (next.error || !next.data) throw next.error ?? new Error("OUTREACH_COMPOSER_EDIT_CREATE_FAILED");
  const review = await client.from("ai_outreach_draft_reviews").insert({ draft_version_id: input.versionId, action: "EDIT", edited_subject: edited.subject, edited_body_plain_text: edited.bodyPlainText, reason_tags: ["MANUAL_REWRITE"], note: "Edited draft requires separate approval.", created_by: input.actorId }).select("id").single();
  if (review.error || !review.data) throw review.error ?? new Error("OUTREACH_COMPOSER_EDIT_REVIEW_FAILED");
  return { versionId: next.data.id, reviewId: review.data.id };
}

function approvedUrl(value: string) {
  return (OUTREACH_COMPOSER_BODY_URL_ALLOWLIST as readonly string[]).includes(value) || value === "{{APPROVED_TRIAL_URL}}" || value === "{{APPROVED_DEMO_URL}}";
}

export function validateHumanEditedComposerText(subject: string, body: string, stage: "EMAIL_1" | "EMAIL_2" | "EMAIL_3") {
  if (!subject.trim() || subject.length > 45) throw new Error("OUTREACH_COMPOSER_EDIT_INVALID: subject length");
  if (/Raphael Domalik\s+EventSuite|LinkedIn:|Best regards,?\s+EventSuite Partnerships/i.test(body)) throw new Error("OUTREACH_COMPOSER_EDIT_INVALID: signature must remain deterministic");
  if (/\b[^\s@]+@[^\s@]+\.[^\s@]+\b|\+?\d[\d ()-]{7,}\d\b/.test(body)) throw new Error("OUTREACH_COMPOSER_EDIT_INVALID: contact detail");
  const bodyUrls = body.match(/https?:\/\/[^\s)]+/g) ?? [];
  if (bodyUrls.some((value) => !approvedUrl(value))) throw new Error("OUTREACH_COMPOSER_EDIT_INVALID: URL not allowlisted");
  if (/\b(?:industry-leading|market-leading|best-in-class|world-class|revolutionary|game-changing|cutting-edge|I hope this email finds you well|just checking in|bumping this|circling back)\b/i.test(`${subject}\n${body}`)) throw new Error("OUTREACH_COMPOSER_EDIT_INVALID: prohibited language");
  const count = body.trim().split(/\s+/u).length;
  const [minimum, maximum] = stage === "EMAIL_1" ? [75, 125] : stage === "EMAIL_2" ? [55, 100] : [35, 75];
  if (count < minimum || count > maximum) throw new Error(`OUTREACH_COMPOSER_EDIT_INVALID: body word count ${count} outside ${minimum}-${maximum}`);
  return { subject: subject.trim(), bodyPlainText: body.trim(), renderedBody: `${body.trim()}\n\n${renderApprovedOutreachComposerSignature()}` };
}

export async function recordComposerReview(client: SupabaseClient, input: { versionId: string; action: ComposerReviewAction; actorId: string; editedSubject?: string; editedBody?: string; relevanceRating?: number; toneRating?: number; reasonTags?: string[]; note?: string; stage?: "EMAIL_1" | "EMAIL_2" | "EMAIL_3" }) {
  if (!input.versionId || !input.actorId) throw new Error("OUTREACH_COMPOSER_REVIEW_INVALID");
  if (!( ["APPROVE", "REJECT", "REQUEST_REVISION", "EDIT", "EDIT_APPROVE", "RATE"] as readonly string[]).includes(input.action)) throw new Error("OUTREACH_COMPOSER_REVIEW_INVALID: action");
  if (input.reasonTags?.some((tag) => !(COMPOSER_REVIEW_TAGS as readonly string[]).includes(tag))) throw new Error("OUTREACH_COMPOSER_REVIEW_INVALID: reason tag");
  if (input.action === "EDIT" || input.action === "EDIT_APPROVE") {
    if (!input.editedSubject || !input.editedBody || !input.stage) throw new Error("OUTREACH_COMPOSER_REVIEW_INVALID: edited content required");
    validateHumanEditedComposerText(input.editedSubject, input.editedBody, input.stage);
  }
  if (input.relevanceRating !== undefined && (!Number.isInteger(input.relevanceRating) || input.relevanceRating < 1 || input.relevanceRating > 5)) throw new Error("OUTREACH_COMPOSER_REVIEW_INVALID: relevance rating");
  if (input.toneRating !== undefined && (!Number.isInteger(input.toneRating) || input.toneRating < 1 || input.toneRating > 5)) throw new Error("OUTREACH_COMPOSER_REVIEW_INVALID: tone rating");
  const result = await client.from("ai_outreach_draft_reviews").insert({ draft_version_id: input.versionId, action: input.action, edited_subject: input.editedSubject ?? null, edited_body_plain_text: input.editedBody ?? null, relevance_rating: input.relevanceRating ?? null, tone_rating: input.toneRating ?? null, reason_tags: input.reasonTags ?? [], note: input.note?.trim() || null, created_by: input.actorId }).select("id").single();
  if (result.error || !result.data) throw result.error ?? new Error("OUTREACH_COMPOSER_REVIEW_CREATE_FAILED");
  return result.data;
}
