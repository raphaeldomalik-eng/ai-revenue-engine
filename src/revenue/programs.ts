export type SalesMotion = "direct" | "lno";
export type ConversionGoal = "self_service" | "live_demo" | "opportunity_enquiry";
export type CommercialProgram = { productSlug: string; territoryCode: "ZA" | "GB"; salesMotion: SalesMotion; conversionGoal: ConversionGoal };

export const initialEventSuitePrograms: CommercialProgram[] = [
  { productSlug: "event-suite", territoryCode: "ZA", salesMotion: "direct", conversionGoal: "self_service" },
  { productSlug: "event-suite", territoryCode: "ZA", salesMotion: "direct", conversionGoal: "live_demo" },
  { productSlug: "event-suite", territoryCode: "GB", salesMotion: "direct", conversionGoal: "self_service" },
  { productSlug: "event-suite", territoryCode: "GB", salesMotion: "direct", conversionGoal: "live_demo" },
  { productSlug: "event-suite", territoryCode: "ZA", salesMotion: "lno", conversionGoal: "opportunity_enquiry" },
  { productSlug: "event-suite", territoryCode: "GB", salesMotion: "lno", conversionGoal: "opportunity_enquiry" },
];
