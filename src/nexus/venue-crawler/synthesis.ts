import type { CapacityFact, PracticalFact, SuitabilityFact } from "./facts.ts";

export type SupportedSentence = { sentence: string; evidenceRefs: string[] };

const FORBIDDEN = /\b(?:discovered|acquisition|inventory|candidates?|enrichment|verified as part of|confidence|crawl status|database)\b/i;
const RAW_ENUM = /\b[a-z]+_[a-z]+\b/;
const FAKE_REGION = /[A-Za-z ]+\/[A-Za-z ]+\s+region/i;
const ARTICLE_ERROR = /\ba event\b/i;

const LAYOUT_LABEL: Record<string, string> = {
  theatre: "theatre", banquet: "banquet", classroom: "classroom", boardroom: "boardroom",
  cabaret: "cabaret", reception: "reception", standing: "standing", seated: "seated",
  dinner: "dinner", conference: "conference", cocktail: "cocktail", "u-shape": "U-shape",
  "hollow-square": "hollow square", unspecified: "maximum",
};

const PRACTICAL_LABEL: Record<string, string> = {
  accessibility: "accessibility", parking: "parking", publicTransport: "public transport", catering: "catering",
  bar: "a bar", kitchen: "a kitchen", avProduction: "AV", sound: "sound", lighting: "lighting", staging: "staging",
  loadingAccess: "loading access", wifi: "Wi-Fi", power: "power", outdoorSpace: "outdoor space",
  accommodation: "accommodation", cloakroom: "a cloakroom",
};

export function synthesiseVenueCopy(input: {
  venueName: string;
  locality: string | null;
  region: string | null;
  country: string | null;
  spaces: string[];
  capacities: CapacityFact[];
  suitability: SuitabilityFact[];
  practical: PracticalFact[];
}): { summary: string; description: string; support: SupportedSentence[]; rejectedSentences: string[] } {
  const place = [input.locality, input.region, input.country].filter((item): item is string => Boolean(item && item.trim())).filter((item, index, all) => all.indexOf(item) === index);
  const support: SupportedSentence[] = [];
  const rejectedSentences: string[] = [];
  const accept = (sentence: string, evidenceRefs: string[]) => {
    if (!sentence || FORBIDDEN.test(sentence) || RAW_ENUM.test(sentence) || FAKE_REGION.test(sentence) || ARTICLE_ERROR.test(sentence)) {
      rejectedSentences.push(sentence);
      return;
    }
    support.push({ sentence, evidenceRefs });
  };

  const notable = input.spaces[0] ?? null;
  const placeText = place.length ? place.join(", ") : null;
  if (placeText && notable) accept(`${input.venueName} in ${placeText} includes ${notable}.`, [`space:${notable}`, `place:${placeText}`]);
  else if (placeText) accept(`${input.venueName} is in ${placeText}.`, [`place:${placeText}`]);
  else if (notable) accept(`${input.venueName} includes ${notable}.`, [`space:${notable}`]);
  else accept(`${input.venueName} is listed from its official website.`, ["identity:name"]);

  if (input.spaces.length) {
    const listed = input.spaces.slice(0, 4).join(", ");
    accept(`Named spaces include ${listed}.`, input.spaces.slice(0, 4).map((space) => `space:${space}`));
  }
  if (input.suitability.length) {
    const labels = input.suitability.map((item) => item.label);
    accept(`The venue states that it hosts ${joinLabels(labels)}.`, input.suitability.map((item) => `suitability:${item.key}`));
  }
  const capacityLines = input.capacities.slice(0, 4).map((item) => {
    const layout = LAYOUT_LABEL[item.layout] ?? item.layout;
    const who = item.space ? `${item.space} ` : "";
    return `${who}${layout} capacity ${item.count.toLocaleString("en-GB")}`;
  });
  if (capacityLines.length) accept(`Stated capacities include ${capacityLines.join("; ")}.`, input.capacities.slice(0, 4).map((item) => `capacity:${item.statement}`));
  if (input.practical.length) {
    const labels = [...new Set(input.practical.map((item) => PRACTICAL_LABEL[item.key] ?? item.key))].slice(0, 6);
    accept(`Practical facilities stated on the site include ${joinLabels(labels)}.`, input.practical.slice(0, 6).map((item) => `practical:${item.key}`));
  }

  const summary = support[0]?.sentence ?? `${input.venueName} is listed from its official website.`;
  const description = support.map((item) => item.sentence).join(" ");
  return { summary, description, support, rejectedSentences };
}

function joinLabels(labels: string[]) {
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
