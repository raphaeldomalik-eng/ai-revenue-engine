import type { AiSalesBrief, AiSalesResearchResult } from "./model.ts";

const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

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
      text: { format: { type: "json_object" } },
    }),
  });
  if (!response.ok) throw new Error(`AI research provider failed with HTTP ${response.status}.`);
  const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const text = payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("");
  if (!text) throw new Error("AI research provider returned no structured output.");
  const brief = parseBrief(JSON.parse(text));
  return { brief, provider: "openai", model, sourceCount: brief.facts.filter((item) => Boolean(item.sourceUrl)).length };
}

export { parseBrief };
