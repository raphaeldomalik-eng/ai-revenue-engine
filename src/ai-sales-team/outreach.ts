import type { AiSalesBrief } from "./model.ts";
import type { ProspectIntelligence } from "./prospect-intelligence.ts";
import type { OutreachSequenceDraft } from "./outreach-model.ts";
import { boundedFollowUps, knownRecipient, sanitizeOutboundContent } from "./outreach-model.ts";

const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const schema = {
  type: "object", additionalProperties: false,
  required: ["outreachGoal", "recipientRationale", "overallStrategy", "initialMessage", "followUps", "unknowns", "warnings"],
  properties: {
    outreachGoal: { type: "string" }, recipientRationale: { type: "string" }, overallStrategy: { type: "string" }, unknowns: { type: "array", items: { type: "string" } }, warnings: { type: "array", items: { type: "string" } },
    initialMessage: { $ref: "#/$defs/message" },
    followUps: { type: "array", maxItems: 2, items: { $ref: "#/$defs/message" } },
  },
  $defs: { message: { type: "object", additionalProperties: false, required: ["sequenceNumber", "delayHours", "subject", "body", "rationale", "evidenceReferences", "cta", "stopConditions"], properties: { sequenceNumber: { type: "integer", enum: [0, 1, 2] }, delayHours: { type: "integer", minimum: 0, maximum: 720 }, subject: { type: "string" }, body: { type: "string" }, rationale: { type: "string" }, evidenceReferences: { type: "array", items: { type: "string" } }, cta: { type: "string" }, stopConditions: { type: "array", items: { type: "string" } } } } },
} as const;

const CALL_PATTERN = /\b(?:book|schedule|jump on|have) (?:a )?(?:call|meeting|demo|walkthrough)|\b(?:call|meeting|demo|walkthrough)\b/i;

function urls(value: string) { return (value.match(/https?:\/\/\S+/g) ?? []).map((url) => url.replace(/[.,;:!?]+$/, "").replace(/\)$/, "")); }

export function assertCommercialActionContract(draft: OutreachSequenceDraft, action: ProspectIntelligence["nextBestCommercialAction"]) {
  const messages = [draft.initialMessage, ...draft.followUps];
  if (action.type === "NONE") throw new Error("OUTREACH_CTA_MISMATCH: no commercial action is available");
  if (!action.resourceOffer.available) throw new Error("OUTREACH_CTA_MISMATCH: eligible outreach requires a resource offer");
  const resourceCta = `Explore free resource: ${action.resourceOffer.title}`;
  const allowedCtas = new Set([action.ctaLabel, "Explore EventSuite", resourceCta, "Reply for more information"]);
  const allowedUrls = new Set([action.productDestinationUrl, action.resourceOffer.canonicalUrl]);
  let resourceOfferUsed = false;
  for (const message of messages) {
    const content = `${message.subject}\n${message.body}\n${message.cta}`;
    if (action.type !== "HUMAN_ASSISTED" && CALL_PATTERN.test(content)) throw new Error("OUTREACH_CTA_MISMATCH: a call CTA conflicts with the selected low-friction action");
    if (!allowedCtas.has(message.cta)) throw new Error("OUTREACH_CTA_MISMATCH: message CTA is not an approved sequence action");
    const messageUrls = urls(message.body);
    if (messageUrls.length !== 1 || !allowedUrls.has(messageUrls[0])) throw new Error("OUTREACH_CTA_MISMATCH: every message needs one verified primary destination");
    if (message.cta === resourceCta) {
      if (messageUrls[0] !== action.resourceOffer.canonicalUrl) throw new Error("OUTREACH_CTA_MISMATCH: resource CTA does not use its canonical URL");
      resourceOfferUsed = true;
    }
    if (message.cta === "Explore EventSuite" && messageUrls[0] !== action.productDestinationUrl) throw new Error("OUTREACH_CTA_MISMATCH: product CTA does not use the public landing page");
  }
  if (!resourceOfferUsed) throw new Error("OUTREACH_CTA_MISMATCH: sequence does not include the selected free resource");
  if (action.type === "PRODUCT_EXPLORATION" && action.targetUrlIfVerified !== action.productDestinationUrl) throw new Error("OUTREACH_CTA_MISMATCH: product exploration must use the public landing page");
}

function parse(value: unknown, action: ProspectIntelligence["nextBestCommercialAction"]): OutreachSequenceDraft {
  if (!value || typeof value !== "object") throw new Error("Outreach generation returned no structured sequence.");
  const draft = value as OutreachSequenceDraft;
  if (!draft.initialMessage || !Array.isArray(draft.followUps) || typeof draft.overallStrategy !== "string") throw new Error("Outreach generation returned an incomplete sequence.");
  const allowedUrls = [action.productDestinationUrl, action.resourceOffer.canonicalUrl];
  const initial = { ...draft.initialMessage, sequenceNumber: 0 as const, ...sanitizeOutboundContent(draft.initialMessage.subject, draft.initialMessage.body, allowedUrls) };
  const followUps = boundedFollowUps(draft.followUps).map((item, index) => ({ ...item, sequenceNumber: (index + 1) as 1 | 2, ...sanitizeOutboundContent(item.subject, item.body, allowedUrls) }));
  const parsed = { ...draft, initialMessage: initial, followUps };
  assertCommercialActionContract(parsed, action);
  return parsed;
}

export async function generateOutreachSequence(input: { brief: AiSalesBrief; contact: { name: string | null; role: string | null; email: string | null } | null }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("AI_OUTREACH_NOT_CONFIGURED: OPENAI_API_KEY is required.");
  const email = knownRecipient(input.contact?.email);
  const action = input.brief.prospectIntelligence.nextBestCommercialAction;
  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, max_output_tokens: 5000, input: `Prepare a bounded human-reviewed email outreach sequence from this existing AI Sales Brief. Do not research again. The account is a PROSPECT using a DIRECT sales motion. Use only the primary EventSuite opportunity, event connection and evidence-backed event problem from prospectIntelligence. Do not use generic company, AI, technology, tourism, university or subject-matter overlap as the reason for contact. Never invent an email address, relationship, metric, customer, partnership, collaboration, capability, or prior conversation. Do not use partnership language for a PROSPECT. You MUST follow this selected Next Best Commercial Action exactly: ${JSON.stringify(action)}. The initial message should normally use the product discovery CTA, and one follow-up must use the selected free Resource Centre offer. Every message has exactly one CTA and one matching verified URL: use only ${action.productDestinationUrl} and ${action.resourceOffer.canonicalUrl}. The CTA field must be exactly one of: ${action.ctaLabel}, Explore EventSuite, Explore free resource: ${action.resourceOffer.title}, Reply for more information. A call or walkthrough is allowed only when action.type is HUMAN_ASSISTED. The recipient email is ${email ?? "unknown"}; keep it unknown if absent. Use supported evidence internally, but never place research URLs, citations, evidence IDs, internal rationale, FACT/INFERENCE labels, placeholders, or unsupported superlatives in subject/body. Write a direct, concise 3–5 paragraph email with one clear CTA and no generic opening. End with Best regards, EventSuite Partnerships. Create one initial message and at most two follow-ups. Follow-ups must add value rather than repeat a meeting request. Initial sequenceNumber must be 0, follow-ups 1 or 2. Prospect brief: ${JSON.stringify(input.brief)}. Known contact: ${JSON.stringify(input.contact)}.`, text: { format: { type: "json_schema", name: "ai_outreach_sequence", strict: true, schema } } }) });
  if (!response.ok) { const failure = await response.json().catch(() => null) as { error?: { message?: string } } | null; throw new Error(`AI outreach provider failed with HTTP ${response.status}: ${failure?.error?.message ?? "no provider detail"}`); }
  const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const text = payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("");
  if (!text) throw new Error("AI outreach provider returned no structured output.");
  return { draft: parse(JSON.parse(text), action), model };
}
