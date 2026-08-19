import type { AiSalesBrief, AiSalesResearchResult } from "./model.ts";

const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const briefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["companySummary", "whyItMatters", "territory", "qualification", "people", "facts", "inferences", "pains", "useCases", "signals", "eventSuite", "accountStrategy", "nextBestAction", "unknowns"],
  properties: {
    companySummary: { type: "string" }, whyItMatters: { type: "string" }, pains: { type: "array", items: { type: "string" } }, useCases: { type: "array", items: { type: "string" } }, signals: { type: "array", items: { type: "string" } }, unknowns: { type: "array", items: { type: "string" } },
    territory: { type: "object", additionalProperties: false, required: ["code", "confidence", "rationale"], properties: { code: { type: "string", enum: ["ZA", "GB", "UNKNOWN"] }, confidence: { type: "string", enum: ["NONE", "LOW", "MEDIUM", "HIGH"] }, rationale: { type: "string" } } },
    qualification: { type: "object", additionalProperties: false, required: ["fit", "rationale", "strengths", "concerns"], properties: { fit: { type: "string", enum: ["HIGH", "MEDIUM", "LOW", "UNKNOWN"] }, rationale: { type: "string" }, strengths: { type: "array", items: { type: "string" } }, concerns: { type: "array", items: { type: "string" } } } },
    people: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "role", "sourceUrl", "kind", "confidence"], properties: { name: { type: "string" }, role: { type: ["string", "null"] }, sourceUrl: { type: ["string", "null"] }, kind: { type: "string", enum: ["FACT", "INFERENCE"] }, confidence: { type: "string", enum: ["NONE", "LOW", "MEDIUM", "HIGH"] } } } },
    facts: { type: "array", items: { type: "object", additionalProperties: false, required: ["claim", "sourceUrl", "sourceTitle", "kind", "confidence"], properties: { claim: { type: "string" }, sourceUrl: { type: ["string", "null"] }, sourceTitle: { type: ["string", "null"] }, kind: { type: "string", enum: ["FACT"] }, confidence: { type: "string", enum: ["NONE", "LOW", "MEDIUM", "HIGH"] } } } },
    inferences: { type: "array", items: { type: "object", additionalProperties: false, required: ["claim", "sourceUrl", "sourceTitle", "kind", "confidence"], properties: { claim: { type: "string" }, sourceUrl: { type: ["string", "null"] }, sourceTitle: { type: ["string", "null"] }, kind: { type: "string", enum: ["INFERENCE"] }, confidence: { type: "string", enum: ["NONE", "LOW", "MEDIUM", "HIGH"] } } } },
    eventSuite: { type: "object", additionalProperties: false, required: ["relevance", "salesMotion", "conversionRoute", "commercialProgramId", "rationale"], properties: { relevance: { type: "string" }, salesMotion: { type: "string", enum: ["DIRECT", "LNO", "BOTH", "UNKNOWN"] }, conversionRoute: { type: "string", enum: ["UNDETERMINED", "SELF_SERVICE", "QUALIFIED_LIVE_DEMO", "BUSINESS_OPPORTUNITY_ENQUIRY"] }, commercialProgramId: { type: "null" }, rationale: { type: "string" } } },
    accountStrategy: { type: "object", additionalProperties: false, required: ["positioning", "approach", "validationQuestions"], properties: { positioning: { type: "string" }, approach: { type: "string" }, validationQuestions: { type: "array", items: { type: "string" } } } },
    nextBestAction: { type: "object", additionalProperties: false, required: ["action", "reason", "owner"], properties: { action: { type: "string" }, reason: { type: "string" }, owner: { type: "string", enum: ["HUMAN_REVIEW", "AI_SALES_TEAM"] } } },
  },
} as const;

function parseBrief(value: unknown): AiSalesBrief {
  if (!value || typeof value !== "object") throw new Error("AI research returned no structured brief.");
  const brief = value as Partial<AiSalesBrief>;
  if (typeof brief.companySummary !== "string" || !brief.territory || !brief.qualification || !brief.eventSuite || !brief.nextBestAction) {
    throw new Error("AI research returned an incomplete structured brief.");
  }
  return {
    companySummary: brief.companySummary, whyItMatters: brief.whyItMatters ?? "", territory: brief.territory,
    qualification: brief.qualification, people: brief.people ?? [], facts: brief.facts ?? [], inferences: brief.inferences ?? [],
    pains: brief.pains ?? [], useCases: brief.useCases ?? [], signals: brief.signals ?? [], eventSuite: { ...brief.eventSuite, commercialProgramId: null },
    accountStrategy: brief.accountStrategy ?? { positioning: "", approach: "", validationQuestions: [] }, nextBestAction: brief.nextBestAction, unknowns: brief.unknowns ?? [],
  };
}

export async function researchCompany(input: { companyName: string; website?: string }): Promise<AiSalesResearchResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("AI_RESEARCH_NOT_CONFIGURED: OPENAI_API_KEY is required for real public research.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model, tools: [{ type: "web_search" }],
      input: `Research this prospective EventSuite account using current public web sources. Never invent people, facts, sources, or unknown values. Separate FACT from INFERENCE and cite source URLs when available. Company: ${input.companyName}. Website: ${input.website ?? "not provided"}. Return only the requested JSON brief.`,
      text: { format: { type: "json_schema", name: "ai_sales_brief", strict: true, schema: briefSchema } },
    }),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => null) as { error?: { type?: string; message?: string } } | null;
    const detail = failure?.error?.message || failure?.error?.type || "no provider detail";
    throw new Error(`AI research provider failed with HTTP ${response.status}: ${detail}`);
  }
  const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const text = payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("");
  if (!text) throw new Error("AI research provider returned no structured output.");
  const brief = parseBrief(JSON.parse(text));
  return { brief, provider: "openai", model, sourceCount: brief.facts.filter((item) => Boolean(item.sourceUrl)).length };
}

export { parseBrief };
