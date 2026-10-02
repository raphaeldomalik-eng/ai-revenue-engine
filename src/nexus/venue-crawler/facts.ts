import { visibleText } from "../source-discovery/html.ts";
import type { VenueFact } from "../source-discovery/extractors/resources.ts";

export type SuitabilityFact = {
  key: string;
  label: string;
  statement: string;
  sourceUrl: string;
};

const USES: Array<[string, string, RegExp]> = [
  ["wedding", "weddings", /\bweddings?\b/i],
  ["conference", "conferences", /\bconferences?\b/i],
  ["corporate_event", "corporate events", /\bcorporate (?:events?|functions?|hire)\b/i],
  ["meeting", "meetings", /\bmeetings?\b/i],
  ["private_party", "private parties", /\bprivate (?:parties|events?|functions?)\b/i],
  ["exhibition", "exhibitions", /\bexhibitions?\b/i],
  ["product_launch", "product launches", /\bproduct launches?\b/i],
  ["banquet", "banquets", /\bbanquets?\b/i],
  ["reception", "receptions", /\breceptions?\b/i],
  ["live_music", "live music", /\blive music\b/i],
];

/** A sentence must say the venue offers the use. A URL path is not evidence. */
const OFFER = /\b(?:host(?:s|ed|ing)?|hold(?:s|ing)?|available for|suitable for|ideal for|perfect for|cater(?:s|ed|ing)? for|specialis(?:e|es|ed|ing|z|zes|zed|zing) in|welcome[sd]?)\b/i;

export function suitabilityFromText(text: string, sourceUrl: string): SuitabilityFact[] {
  const found: SuitabilityFact[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const statement = sentence.replace(/\s+/g, " ").trim();
    if (statement.length < 12 || statement.length > 280 || !OFFER.test(statement)) continue;
    for (const [key, label, pattern] of USES) {
      if (!pattern.test(statement) || found.some((item) => item.key === key)) continue;
      found.push({ key, label, statement, sourceUrl });
    }
  }
  return found;
}

export type CapacityFact = { space: string | null; layout: string; count: number; statement: string; sourceUrl: string };
export type PracticalFact = { key: string; statement: string; sourceUrl: string };

const PRACTICAL_KEYS = new Set(["accessibility", "parking", "publicTransport", "catering", "bar", "kitchen", "avProduction", "sound", "lighting", "staging", "loadingAccess", "wifi", "power", "outdoorSpace", "accommodation", "cloakroom"]);

export function structuredVenueFacts(facts: VenueFact[]) {
  const spaces = [...new Set(facts.filter((item) => item.fieldName === "spaces" && typeof item.value === "string").map((item) => String(item.value)))];
  const capacities: CapacityFact[] = [];
  const practical: PracticalFact[] = [];
  for (const fact of facts) {
    if (fact.fieldName === "capacity" && fact.value && typeof fact.value === "object") {
      const value = fact.value as { space?: string | null; layout?: string; count?: number; statement?: string };
      if (typeof value.count === "number" && value.layout && value.statement) {
        capacities.push({ space: value.space ?? null, layout: value.layout, count: value.count, statement: value.statement, sourceUrl: fact.sourceUrl });
      }
    } else if (PRACTICAL_KEYS.has(fact.fieldName) && typeof fact.value === "string") {
      practical.push({ key: fact.fieldName, statement: fact.value, sourceUrl: fact.sourceUrl });
    }
  }
  return { spaces, capacities, practical };
}

export function pageText(html: string): string {
  return visibleText(html);
}
