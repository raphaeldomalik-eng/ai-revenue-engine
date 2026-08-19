import type { AiSalesBrief } from "./model.ts";
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

function parse(value: unknown): OutreachSequenceDraft {
  if (!value || typeof value !== "object") throw new Error("Outreach generation returned no structured sequence.");
  const draft = value as OutreachSequenceDraft;
  if (!draft.initialMessage || !Array.isArray(draft.followUps) || typeof draft.overallStrategy !== "string") throw new Error("Outreach generation returned an incomplete sequence.");
  const initial = { ...draft.initialMessage, sequenceNumber: 0 as const, ...sanitizeOutboundContent(draft.initialMessage.subject, draft.initialMessage.body) };
  const followUps = boundedFollowUps(draft.followUps).map((item, index) => ({ ...item, sequenceNumber: (index + 1) as 1 | 2, ...sanitizeOutboundContent(item.subject, item.body) }));
  return { ...draft, initialMessage: initial, followUps };
}

export async function generateOutreachSequence(input: { brief: AiSalesBrief; contact: { name: string | null; role: string | null; email: string | null } | null }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("AI_OUTREACH_NOT_CONFIGURED: OPENAI_API_KEY is required.");
  const email = knownRecipient(input.contact?.email);
  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, max_output_tokens: 5000, input: `Prepare a bounded human-reviewed email outreach sequence from this existing AI Sales Brief. Do not research again. The account is a PROSPECT using a DIRECT sales motion. Use only the primary EventSuite opportunity, event connection and evidence-backed event problem from prospectIntelligence. Do not use generic company, AI, technology, tourism, university or subject-matter overlap as the reason for contact. Never invent an email address, relationship, metric, customer, partnership, collaboration, capability, or prior conversation. Do not use partnership language for a PROSPECT. The recipient email is ${email ?? "unknown"}; keep it unknown if absent. Use supported evidence internally, but never place research URLs, citations, evidence IDs, internal rationale, FACT/INFERENCE labels, placeholders, or unsupported superlatives in subject/body. Write a direct, concise 3–5 paragraph email with one clear CTA and no generic opening. End with Best regards, EventSuite Partnerships. Create one initial message and at most two follow-ups. Initial sequenceNumber must be 0, follow-ups 1 or 2. Prospect brief: ${JSON.stringify(input.brief)}. Known contact: ${JSON.stringify(input.contact)}.`, text: { format: { type: "json_schema", name: "ai_outreach_sequence", strict: true, schema } } }) });
  if (!response.ok) { const failure = await response.json().catch(() => null) as { error?: { message?: string } } | null; throw new Error(`AI outreach provider failed with HTTP ${response.status}: ${failure?.error?.message ?? "no provider detail"}`); }
  const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const text = payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("");
  if (!text) throw new Error("AI outreach provider returned no structured output.");
  return { draft: parse(JSON.parse(text)), model };
}
