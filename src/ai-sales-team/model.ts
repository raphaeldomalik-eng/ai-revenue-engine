export type AiSalesEvidence = {
  claim: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  kind: "FACT" | "INFERENCE";
  confidence: "NONE" | "LOW" | "MEDIUM" | "HIGH";
};

export type AiSalesPerson = {
  name: string;
  role: string | null;
  sourceUrl: string | null;
  kind: "FACT" | "INFERENCE";
  confidence: "NONE" | "LOW" | "MEDIUM" | "HIGH";
};

export type AiSalesBrief = {
  companySummary: string;
  whyItMatters: string;
  territory: { code: "ZA" | "GB" | "UNKNOWN"; confidence: AiSalesEvidence["confidence"]; rationale: string };
  qualification: { fit: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN"; rationale: string; strengths: string[]; concerns: string[] };
  people: AiSalesPerson[];
  facts: AiSalesEvidence[];
  inferences: AiSalesEvidence[];
  pains: string[];
  useCases: string[];
  signals: string[];
  eventSuite: { relevance: string; salesMotion: "DIRECT" | "LNO" | "BOTH" | "UNKNOWN"; conversionRoute: "UNDETERMINED" | "SELF_SERVICE" | "QUALIFIED_LIVE_DEMO" | "BUSINESS_OPPORTUNITY_ENQUIRY"; commercialProgramId: null; rationale: string };
  accountStrategy: { positioning: string; approach: string; validationQuestions: string[] };
  nextBestAction: { action: string; reason: string; owner: "HUMAN_REVIEW" | "AI_SALES_TEAM" };
  unknowns: string[];
};

export type AiSalesResearchResult = { brief: AiSalesBrief; provider: "openai"; model: string; sourceCount: number };
