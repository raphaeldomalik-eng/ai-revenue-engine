import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseStrictStructuredOutput, type StructuredOutputPayload, type StructuredOutputTelemetry } from "./structured-output.ts";
import { OUTREACH_COMPOSER_BODY_URL_ALLOWLIST, OUTREACH_COMPOSER_SENDER, renderApprovedOutreachComposerSignature } from "./outreach-composer-config.ts";

export const OUTREACH_COMPOSER_PROMPT_VERSION = "outreach-composer-v1" as const;
export const OUTREACH_COMPOSER_MODEL = process.env.OPENAI_OUTREACH_COMPOSER_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";

const PACK_PATH = join(process.cwd(), "docs", "agents", "outreach-composer-prompt-pack-v1.md");

function packSection(heading: string, nextHeading: string) {
  const pack = readFileSync(PACK_PATH, "utf8");
  const start = pack.indexOf(heading);
  const end = pack.indexOf(nextHeading, start + heading.length);
  if (start < 0 || end < 0) throw new Error("OUTREACH_COMPOSER_PROMPT_PACK_INVALID");
  const section = pack.slice(start, end);
  const fenceStart = section.indexOf("```text");
  const fenceEnd = section.indexOf("\n```", fenceStart + 7);
  if (fenceStart < 0 || fenceEnd < 0) throw new Error("OUTREACH_COMPOSER_PROMPT_PACK_INVALID");
  return section.slice(fenceStart + "```text".length, fenceEnd).trim();
}

export function outreachComposerPromptPackText() { return readFileSync(PACK_PATH, "utf8"); }
export function outreachComposerSystemPrompt() { return packSection("## 3. Canonical system prompt", "## 4. Stage instruction: Email 1"); }
export function outreachComposerStageInstruction(stage: "EMAIL_1" | "EMAIL_2" | "EMAIL_3" | "REVISION") {
  const next = stage === "EMAIL_1" ? "## 5. Stage instruction: Email 2" : stage === "EMAIL_2" ? "## 6. Stage instruction: Email 3" : stage === "EMAIL_3" ? "## 7. Revision instruction" : "## 8. Required runtime inputs";
  const heading = stage === "EMAIL_1" ? "## 4. Stage instruction: Email 1" : stage === "EMAIL_2" ? "## 5. Stage instruction: Email 2" : stage === "EMAIL_3" ? "## 6. Stage instruction: Email 3" : "## 7. Revision instruction";
  return packSection(heading, next);
}

export type ComposerStage = "EMAIL_1" | "EMAIL_2" | "EMAIL_3" | "REVISION";
export type ComposerMessageType = "PERSONAL_PLATFORM_INTRODUCTION" | "EVIDENCE_LED_INTRODUCTION" | "ROUTE_TO_BUYER_REQUEST" | "FREELANCE_CONNECTOR_INTRODUCTION" | "FOLLOW_UP";
export type ComposerStatus = "DRAFT_READY" | "HUMAN_REVIEW_REQUIRED" | "DO_NOT_DRAFT";
export type ComposerCta = "TRY_PLATFORM" | "BOOK_DEMO" | "SEND_OVERVIEW" | "RELEVANCE_CHECK" | "RIGHT_PERSON" | "CONNECTOR_RELEVANCE" | "CLOSE_CONVERSATION";
export type ComposerEvidence = { id: string; claim: string; sourceUrl: string | null; sourceTitle: string | null; kind: "FACT" | "INFERENCE"; approved: boolean };

export type ComposerInput = {
  target: { canonicalName: string; canonicalDomain: string | null; eligible: boolean; relationship: "PROSPECT" | "CUSTOMER" | "PARTNER" | "COMPETITOR" | "UNKNOWN" };
  originatingLane: string;
  recipient: { name: string | null; role: string | null; classification: string | null; hasVerifiedBusinessEmail: boolean };
  relationships: { organisation: string | null; event: string | null; venue: string | null; operator: string | null };
  evidence: ComposerEvidence[];
  commercialOpportunity: { fit: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN"; productEvidence: string[]; noEvidence: boolean };
  contactProvenance: { ownershipValidated: boolean; sourceUrl: string | null; route: "NAMED_BUYER" | "ORGANISATION_ROUTE" | "NONE" };
  sequence: { stage: ComposerStage; originalStage?: "EMAIL_1" | "EMAIL_2" | "EMAIL_3"; priorMessageBody?: string | null; stopState: "CLEAR" | "REPLIED" | "REJECTED" | "OPTOUT" | "UNSUBSCRIBED" | "BOUNCED" | "INVALID" | "BLOCKED" | "COMPLETE" };
  humanInstruction?: string | null;
  humanRequestedLinks?: boolean;
};

export type ComposerClaimEvidence = { claim: string; evidenceIds: string[] };
export type ComposerStructuredDraft = {
  status: ComposerStatus;
  promptVersion: typeof OUTREACH_COMPOSER_PROMPT_VERSION;
  sequenceStage: ComposerStage;
  messageType: ComposerMessageType;
  subject: string;
  bodyPlainText: string;
  productAngle: "PLATFORM_OVERVIEW" | "EVENT_GROWTH_STUDIO" | "TICKETING" | "EVENT_OPERATIONS";
  mentionedCapabilities: string[];
  primaryCtaType: ComposerCta;
  secondaryCtaType: ComposerCta | null;
  urlTokensUsed: string[];
  personalisationEvidenceIds: string[];
  claimEvidence: ComposerClaimEvidence[];
  uncertainties: string[];
  riskFlags: string[];
  humanReviewSummary: string;
};

export type ValidatedComposerDraft = { model: ComposerStructuredDraft; renderedBody: string; telemetry: StructuredOutputTelemetry };

const messageSchema = {
  type: "object", additionalProperties: false,
  required: ["status", "promptVersion", "sequenceStage", "messageType", "subject", "bodyPlainText", "productAngle", "mentionedCapabilities", "primaryCtaType", "secondaryCtaType", "urlTokensUsed", "personalisationEvidenceIds", "claimEvidence", "uncertainties", "riskFlags", "humanReviewSummary"],
  properties: {
    status: { type: "string", enum: ["DRAFT_READY", "HUMAN_REVIEW_REQUIRED", "DO_NOT_DRAFT"] },
    promptVersion: { type: "string", enum: [OUTREACH_COMPOSER_PROMPT_VERSION] },
    sequenceStage: { type: "string", enum: ["EMAIL_1", "EMAIL_2", "EMAIL_3", "REVISION"] },
    messageType: { type: "string", enum: ["PERSONAL_PLATFORM_INTRODUCTION", "EVIDENCE_LED_INTRODUCTION", "ROUTE_TO_BUYER_REQUEST", "FREELANCE_CONNECTOR_INTRODUCTION", "FOLLOW_UP"] },
    subject: { type: "string" }, bodyPlainText: { type: "string" },
    productAngle: { type: "string", enum: ["PLATFORM_OVERVIEW", "EVENT_GROWTH_STUDIO", "TICKETING", "EVENT_OPERATIONS"] },
    mentionedCapabilities: { type: "array", maxItems: 3, items: { type: "string" } },
    primaryCtaType: { type: "string", enum: ["TRY_PLATFORM", "BOOK_DEMO", "SEND_OVERVIEW", "RELEVANCE_CHECK", "RIGHT_PERSON", "CONNECTOR_RELEVANCE", "CLOSE_CONVERSATION"] },
    secondaryCtaType: { type: ["string", "null"], enum: ["TRY_PLATFORM", "BOOK_DEMO", "SEND_OVERVIEW", "RELEVANCE_CHECK", "RIGHT_PERSON", "CONNECTOR_RELEVANCE", "CLOSE_CONVERSATION", null] },
    urlTokensUsed: { type: "array", items: { type: "string", enum: ["APPROVED_TRIAL_URL", "APPROVED_DEMO_URL"] } },
    personalisationEvidenceIds: { type: "array", items: { type: "string" } },
    claimEvidence: { type: "array", items: { type: "object", additionalProperties: false, required: ["claim", "evidenceIds"], properties: { claim: { type: "string" }, evidenceIds: { type: "array", items: { type: "string" } } } } },
    uncertainties: { type: "array", items: { type: "string" } }, riskFlags: { type: "array", items: { type: "string" } }, humanReviewSummary: { type: "string" },
  },
} as const;

export const OUTREACH_COMPOSER_RESPONSE_FORMAT = { type: "json_schema", name: "outreach_composer_draft", strict: true, schema: messageSchema } as const;

function words(value: string) { return value.trim() ? value.trim().split(/\s+/u).length : 0; }
function urls(value: string) { return value.match(/https?:\/\/[^\s)]+/g) ?? []; }
function tokenNames(value: string) { return [...value.matchAll(/\{\{(APPROVED_TRIAL_URL|APPROVED_DEMO_URL)\}\}/g)].map((match) => match[1]); }
function stopState(state: ComposerInput["sequence"]["stopState"]) { return state !== "CLEAR"; }
function stageLimit(input: ComposerInput) {
  const stage = input.sequence.stage === "REVISION" ? input.sequence.originalStage ?? "EMAIL_1" : input.sequence.stage;
  return stage === "EMAIL_1" ? [75, 125] : stage === "EMAIL_2" ? [55, 100] : [35, 75];
}

const prohibited = /\b(?:industry-leading|market-leading|best-in-class|world-class|revolutionary|game-changing|cutting-edge|I hope this email finds you well|just checking in|bumping this|circling back)\b/i;
const emailOrPhone = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b|\+?\d[\d ()-]{7,}\d\b/;
const signature = /Raphael Domalik\s+EventSuite|Best regards,?\s+EventSuite Partnerships|LinkedIn:/i;

export class OutreachComposerValidationError extends Error { constructor(message: string) { super(`OUTREACH_COMPOSER_INVALID: ${message}`); this.name = "OutreachComposerValidationError"; } }

export function validateOutreachComposerDraft(input: ComposerInput, draft: ComposerStructuredDraft, telemetry: StructuredOutputTelemetry): ValidatedComposerDraft {
  if (draft.promptVersion !== OUTREACH_COMPOSER_PROMPT_VERSION) throw new OutreachComposerValidationError("prompt version mismatch");
  if (draft.sequenceStage !== input.sequence.stage) throw new OutreachComposerValidationError("sequence stage mismatch");
  if (stopState(input.sequence.stopState)) {
    if (draft.status !== "DO_NOT_DRAFT") throw new OutreachComposerValidationError("stopped sequence must not draft");
    return { model: draft, renderedBody: "", telemetry };
  }
  if (!input.target.eligible || input.target.relationship !== "PROSPECT" || !input.contactProvenance.ownershipValidated) {
    if (draft.status === "DRAFT_READY") throw new OutreachComposerValidationError("target is not eligible for a draft");
  }
  const evidenceIds = new Set(input.evidence.filter((item) => item.approved).map((item) => item.id));
  for (const id of [...draft.personalisationEvidenceIds, ...draft.claimEvidence.flatMap((item) => item.evidenceIds)]) if (!evidenceIds.has(id)) throw new OutreachComposerValidationError(`unknown evidence id ${id}`);
  if (draft.status === "DRAFT_READY" && !draft.personalisationEvidenceIds.length) throw new OutreachComposerValidationError("ready draft has no personalisation evidence");
  if (draft.mentionedCapabilities.length > 3) throw new OutreachComposerValidationError("more than three capabilities");
  if (draft.subject.length > 45 || !draft.subject.trim()) throw new OutreachComposerValidationError("subject length");
  if (draft.status === "DRAFT_READY") {
    const [minimum, maximum] = stageLimit(input);
    const count = words(draft.bodyPlainText);
    if (count < minimum || count > maximum) throw new OutreachComposerValidationError(`body word count ${count} outside ${minimum}-${maximum}`);
  }
  if (prohibited.test(`${draft.subject}\n${draft.bodyPlainText}`)) throw new OutreachComposerValidationError("prohibited language");
  if (signature.test(draft.bodyPlainText)) throw new OutreachComposerValidationError("model-generated signature or footer");
  if (emailOrPhone.test(draft.bodyPlainText)) throw new OutreachComposerValidationError("contact detail in generated body");
  if ((draft.bodyPlainText.match(/\?/g) ?? []).length > 1) throw new OutreachComposerValidationError("multiple primary questions");
  const usedTokens = tokenNames(draft.bodyPlainText);
  if (usedTokens.some((token) => !draft.urlTokensUsed.includes(token)) || draft.urlTokensUsed.some((token) => !usedTokens.includes(token))) throw new OutreachComposerValidationError("URL token telemetry mismatch");
  const allowedTokens = input.sequence.stage === "EMAIL_1" && !input.humanRequestedLinks ? [] : ["APPROVED_TRIAL_URL", "APPROVED_DEMO_URL"];
  if (draft.urlTokensUsed.some((token) => !allowedTokens.includes(token))) throw new OutreachComposerValidationError("URL token is not allowed at this stage");
  if (draft.secondaryCtaType && (input.sequence.stage !== "EMAIL_2" || draft.secondaryCtaType !== "BOOK_DEMO")) throw new OutreachComposerValidationError("secondary CTA is not allowed");
  const renderedBody = draft.bodyPlainText
    .replaceAll("{{APPROVED_TRIAL_URL}}", OUTREACH_COMPOSER_SENDER.trialUrl)
    .replaceAll("{{APPROVED_DEMO_URL}}", OUTREACH_COMPOSER_SENDER.demoUrl)
    .trim() + `\n\n${renderApprovedOutreachComposerSignature()}`;
  if (urls(renderedBody).some((url) => !(OUTREACH_COMPOSER_BODY_URL_ALLOWLIST as readonly string[]).includes(url) && !url.includes("linkedin.com/in/raphaeldomalik/"))) throw new OutreachComposerValidationError("unapproved URL");
  return { model: draft, renderedBody, telemetry };
}

export function composerRequestBody(input: ComposerInput) {
  const stageInstruction = outreachComposerStageInstruction(input.sequence.stage);
  const promptInput = {
    ...input,
    approvedSender: { fromName: OUTREACH_COMPOSER_SENDER.fromName, companyName: OUTREACH_COMPOSER_SENDER.companyName, replyTo: OUTREACH_COMPOSER_SENDER.replyTo },
    approvedUrlTokens: { APPROVED_TRIAL_URL: OUTREACH_COMPOSER_SENDER.trialUrl, APPROVED_DEMO_URL: OUTREACH_COMPOSER_SENDER.demoUrl },
    signatureInstruction: "The application appends the deterministic signature. Do not include it in bodyPlainText.",
  };
  return { model: OUTREACH_COMPOSER_MODEL, max_output_tokens: 2200, input: `${stageInstruction}\n\nVALIDATED RUNTIME INPUTS:\n${JSON.stringify(promptInput)}`, text: { format: OUTREACH_COMPOSER_RESPONSE_FORMAT } };
}

export async function generateOutreachComposerDraft(input: ComposerInput, fetchImpl: typeof fetch = fetch): Promise<ValidatedComposerDraft> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("AI_OUTREACH_COMPOSER_NOT_CONFIGURED: OPENAI_API_KEY is required.");
  const response = await fetchImpl("https://api.openai.com/v1/responses", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ ...composerRequestBody(input), instructions: outreachComposerSystemPrompt() }) });
  const payload = await response.json().catch(() => ({})) as StructuredOutputPayload;
  if (!response.ok) throw new Error(`AI_OUTREACH_COMPOSER_PROVIDER_FAILED: HTTP ${response.status}`);
  const parsed = parseStrictStructuredOutput<ComposerStructuredDraft>(payload);
  return validateOutreachComposerDraft(input, parsed.value, parsed.telemetry);
}
