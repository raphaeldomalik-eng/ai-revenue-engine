import test from "node:test";
import assert from "node:assert/strict";
import { parseBrief, researchCompany } from "../src/ai-sales-team/research.ts";
import { readFileSync } from "node:fs";

const valid = { companySummary: "Known summary", whyItMatters: "Known reason", territory: { code: "UNKNOWN", confidence: "NONE", rationale: "Not established" }, qualification: { fit: "UNKNOWN", rationale: "Needs review", strengths: [], concerns: [] }, people: [], facts: [{ claim: "A sourced fact", sourceUrl: "https://example.com", sourceTitle: "Example", kind: "FACT", confidence: "HIGH" }], inferences: [], pains: [], useCases: [], signals: [], eventSuite: { relevance: "Unknown", salesMotion: "UNKNOWN", conversionRoute: "UNDETERMINED", commercialProgramId: "should-be-null", rationale: "No route selected" }, accountStrategy: { positioning: "", approach: "", validationQuestions: [] }, nextBestAction: { action: "Validate", reason: "Unknowns remain", owner: "HUMAN_REVIEW" }, unknowns: ["Territory"] };

test("AI Sales brief preserves unknowns and null commercial program", () => {
  const brief = parseBrief(valid);
  assert.equal(brief.territory.code, "UNKNOWN");
  assert.equal(brief.eventSuite.commercialProgramId, null);
  assert.equal(brief.facts[0].kind, "FACT");
});

test("AI research fails clearly without a provider key", async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  await assert.rejects(() => researchCompany({ companyName: "Test" }), /AI_RESEARCH_NOT_CONFIGURED/);
  if (previous) process.env.OPENAI_API_KEY = previous;
});

test("AI Sales migration defines durable research and brief tables", () => {
  const sql = readFileSync("supabase/migrations/20260819000002_ai_sales_team_mvp.sql", "utf8");
  assert.match(sql, /create table if not exists public\.ai_research_runs/);
  assert.match(sql, /create table if not exists public\.ai_sales_briefs/);
  assert.match(sql, /enable row level security/);
});
