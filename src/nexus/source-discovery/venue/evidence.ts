import type { ImageCandidate, PublicContact, ResourceExtraction, VenueFact } from "../extractors/resources.ts";

const GENERIC_SPACE = /^(?:newsletter|contact|what'?s on|latest news|conference venue|home|gallery|events|hall|room|rooms|venue|space|spaces)$/i;
const FLUFF = /\b(?:versatile venue|perfect for any event|premier destination|ideal setting|world-class experience)\b/i;
const YEARISH = /^(?:19|20)\d{2}$/;

export type DescriptionEvidence = {
  kind: "identity" | "character" | "setting" | "event-use" | "facility" | "quoted-claim";
  text: string;
  sourceUrl: string;
  evidenceRef: string;
};

export type CapacityEvidence = {
  space: string | null;
  layout: string;
  count: number;
  statement: string;
  sourceUrl: string;
  evidenceRef: string;
  reviewRequired: boolean;
};

export type VenueEvidencePackage = {
  identity: ResourceExtraction["identityFacts"];
  descriptionEvidence: DescriptionEvidence[];
  contacts: PublicContact[];
  excludedContacts: Array<{ value: string; reason: string; sourceUrl: string }>;
  spaces: Array<{ name: string; sourceUrl: string; evidenceRef: string }>;
  capacities: CapacityEvidence[];
  practicalFacts: VenueFact[];
  suitability: VenueFact[];
  imagesByRole: Record<string, ImageCandidate[]>;
  routingAuthority: "not_operator_confirmed";
};

function capacityValue(fact: VenueFact): { space: string | null; layout: string; count: number; statement: string } | null {
  const value = fact.value;
  if (!value || typeof value !== "object") return null;
  const row = value as { space?: string | null; layout?: string; count?: number; statement?: string };
  if (typeof row.count !== "number" || YEARISH.test(String(row.count))) return null;
  return { space: row.space ?? null, layout: row.layout ?? "unspecified", count: row.count, statement: row.statement ?? "" };
}

const NAMED_SPACE = /\b([A-Z][\p{L}'’&-]{2,}(?:\s+[A-Z][\p{L}'’&-]{2,}){0,2}\s+(?:Chalet|Cottage|Suite|Chapel|Hall|Auditorium|Ballroom))\b/gu;
const CAPTION_NOISE = new Set(["menu", "gallery", "rooms", "includes", "accommodation", "wedding", "banquet", "scenery", "chauffeured", "house", "contact", "the", "your", "our"]);
const SPACE_TYPE = /^(?:Chalet|Cottage|Suite|Chapel|Hall|Auditorium|Ballroom)$/;

/** Caption-style room names that are not headings, kept only when the page is about rooms or hire. */
export function namedSpacesInText(text: string, sourceUrl: string): string[] {
  if (!/\/(?:rooms?|spaces|hire|weddings?|accommodation)(?:\/|$)/i.test(new URL(sourceUrl).pathname)) return [];
  const names = [...text.matchAll(NAMED_SPACE)].flatMap((match) => {
    let words = match[1]!.replace(/\s+/g, " ").trim().split(" ");
    while (words.length > 1 && CAPTION_NOISE.has(words[0]!.toLowerCase())) words = words.slice(1);
    if (words.some((word) => CAPTION_NOISE.has(word.toLowerCase()))) return [];
    if (!SPACE_TYPE.test(words.at(-1) ?? "") || words.length > 3) return [];
    const name = words.join(" ");
    return GENERIC_SPACE.test(name) ? [] : [name];
  });
  return [...new Set(names)];
}

export function buildVenueEvidencePackage(extraction: ResourceExtraction): VenueEvidencePackage {
  const spaces = [...extraction.venueFacts
    .filter((fact) => fact.fieldName === "spaces" && typeof fact.value === "string" && !GENERIC_SPACE.test(fact.value))
    .reduce((seen, fact) => {
      const name = String(fact.value);
      if (!seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), { name, sourceUrl: fact.sourceUrl, evidenceRef: fact.evidenceRef });
      return seen;
    }, new Map<string, { name: string; sourceUrl: string; evidenceRef: string }>()).values()];
  const capacities = extraction.venueFacts.flatMap((fact) => {
    if (fact.fieldName !== "capacity") return [];
    const value = capacityValue(fact);
    if (!value) return [];
    return [{ ...value, sourceUrl: fact.sourceUrl, evidenceRef: fact.evidenceRef, reviewRequired: fact.reviewRequired }];
  });
  const byKey = new Map<string, number[]>();
  for (const item of capacities) {
    const key = `${(item.space ?? "").toLowerCase()}|${item.layout}`;
    byKey.set(key, [...(byKey.get(key) ?? []), item.count]);
  }
  for (const item of capacities) {
    const counts = byKey.get(`${(item.space ?? "").toLowerCase()}|${item.layout}`) ?? [];
    if (new Set(counts).size > 1) item.reviewRequired = true;
  }
  const descriptionEvidence: DescriptionEvidence[] = [];
  for (const fact of extraction.identityFacts) {
    if (typeof fact.value !== "string") continue;
    if (["siteName", "explicitVenueName", "placeName"].includes(fact.fieldName)) {
      descriptionEvidence.push({ kind: "identity", text: fact.value, sourceUrl: fact.sourceUrl, evidenceRef: fact.evidenceRef });
    }
    if (["siteDescription", "metaDescription", "address"].includes(fact.fieldName)) {
      const kind = FLUFF.test(fact.value) ? "quoted-claim" : fact.fieldName === "address" ? "setting" : "character";
      descriptionEvidence.push({ kind, text: fact.value, sourceUrl: fact.sourceUrl, evidenceRef: fact.evidenceRef });
    }
  }
  for (const fact of extraction.venueFacts) {
    if (fact.fieldName === "hireSuitability" && typeof fact.value === "string") {
      descriptionEvidence.push({ kind: FLUFF.test(fact.value) ? "quoted-claim" : "event-use", text: fact.value, sourceUrl: fact.sourceUrl, evidenceRef: fact.evidenceRef });
    }
    if (!["spaces", "capacity", "hireSuitability", "geo"].includes(fact.fieldName) && typeof fact.value === "string") {
      descriptionEvidence.push({ kind: "facility", text: fact.value, sourceUrl: fact.sourceUrl, evidenceRef: fact.evidenceRef });
    }
  }
  const excludedContacts = extraction.publicContacts
    .filter((contact) => contact.reviewRequired)
    .map((contact) => ({ value: contact.value, reason: "review-required", sourceUrl: contact.sourceUrl }));
  const imagesByRole: Record<string, ImageCandidate[]> = {};
  for (const image of extraction.imageCandidates) {
    const role = /floor[- ]?plan/i.test(`${image.filename ?? ""} ${image.alt ?? ""} ${image.caption ?? ""}`) ? "FLOOR_PLAN" : image.likelyRole;
    imagesByRole[role] = [...(imagesByRole[role] ?? []), image];
  }
  return {
    identity: extraction.identityFacts,
    descriptionEvidence,
    contacts: extraction.publicContacts.filter((contact) => !contact.reviewRequired),
    excludedContacts,
    spaces,
    capacities,
    practicalFacts: extraction.venueFacts.filter((fact) => !["spaces", "capacity", "hireSuitability", "geo"].includes(fact.fieldName)),
    suitability: extraction.venueFacts.filter((fact) => fact.fieldName === "hireSuitability"),
    imagesByRole,
    routingAuthority: "not_operator_confirmed",
  };
}
