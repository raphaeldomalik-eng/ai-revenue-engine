import type { ConversionGoal, SalesMotion } from "./commercial-model.ts";
export type { ConversionGoal, SalesMotion } from "./commercial-model.ts";
export type CommercialProgram = { productSlug: string; territoryCode: "ZA" | "GB"; salesMotion: SalesMotion; conversionGoal: ConversionGoal };

export const initialEventSuitePrograms: CommercialProgram[] = [
  { productSlug: "event-suite", territoryCode: "ZA", salesMotion: "direct", conversionGoal: "SELF_SERVICE" },
  { productSlug: "event-suite", territoryCode: "ZA", salesMotion: "direct", conversionGoal: "QUALIFIED_LIVE_DEMO" },
  { productSlug: "event-suite", territoryCode: "GB", salesMotion: "direct", conversionGoal: "SELF_SERVICE" },
  { productSlug: "event-suite", territoryCode: "GB", salesMotion: "direct", conversionGoal: "QUALIFIED_LIVE_DEMO" },
  { productSlug: "event-suite", territoryCode: "ZA", salesMotion: "lno", conversionGoal: "BUSINESS_OPPORTUNITY_ENQUIRY" },
  { productSlug: "event-suite", territoryCode: "GB", salesMotion: "lno", conversionGoal: "BUSINESS_OPPORTUNITY_ENQUIRY" },
];
