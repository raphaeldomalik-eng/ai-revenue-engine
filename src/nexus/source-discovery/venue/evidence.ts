import type { ImageCandidate, PublicContact, ResourceExtraction, VenueFact } from "../extractors/resources.ts";

const GENERIC_SPACE = /^(?:the |our |your )?(?:newsletter|contact|what'?s on|whats on|latest news|conference venue|wedding venue|corporate venue|home|gallery|events|hall|room|rooms|venue|space|spaces|guest accommodation|accommodation|facilities|amenities|our venue|outdoor space|private events|meeting rooms|chapel|weddings|conferences|functions)$/i;
const FLUFF = /\b(?:versatile venue|perfect for any event|premier destination|ideal setting|world-class experience)\b/i;
const YEARISH = /^(?:19|20)\d{2}$/;
const ARTICLE = /^(?:the|our|your|a|an)$/i;
const CATEGORY_WORD = /^(?:guest|wedding|honeymoon|private|corporate|meeting|function|outdoor|conference|event|events)$/i;
const CATEGORY_NOUN = /^(?:accommodation|facilities|amenities|gallery|venue|newsletter|contact|home)$/i;
const TYPE_WORD = /^(?:hall|halls|room|rooms|suite|suites|cottage|cottages|chalet|chalets|chapel|chapels|auditorium|ballroom|ballrooms|studio|studios|terrace|terraces|garden|gardens|nave|theatre|theater|bar|barn|vault|vaults)$/i;

export type SpaceStatus = "confirmed" | "review";

export type SpaceEvidence = {
  name: string;
  sourceUrl: string;
  evidenceRef: string;
  status: SpaceStatus;
};

/**
 * A confirmed space needs a proper name, a compound room name, or a capacity/structured-data link.
 * A category heading stays unconfirmed. Capacity on a category name is review, not a room.
 */
export function classifyVenueSpace(name: string, signals: { capacityLinked?: boolean; structuredPlace?: boolean; listingContext?: boolean } = {}): SpaceStatus | "reject" {
  const cleaned = name.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > 60) return "reject";
  const backed = Boolean(signals.capacityLinked || signals.structuredPlace);
  if (GENERIC_SPACE.test(cleaned)) return backed ? "review" : "reject";
  const words = cleaned.split(" ");
  const content = words.filter((word) => !ARTICLE.test(word));
  if (!content.length) return "reject";
  const proper = content.filter((word) => !CATEGORY_WORD.test(word) && !CATEGORY_NOUN.test(word) && !TYPE_WORD.test(word));
  const types = content.filter((word) => TYPE_WORD.test(word));
  const categoryHeading = proper.length === 0 && types.length <= 1 && content.some((word) => CATEGORY_WORD.test(word) || CATEGORY_NOUN.test(word));
  if (categoryHeading) return backed ? "review" : "reject";
  const strong = backed || Boolean(signals.listingContext);
  if (proper.length >= 1 && types.length >= 1) return "confirmed";
  if (proper.length >= 2 && strong) return "confirmed";
  if (proper.length === 1 && content.length === 1 && strong) return "confirmed";
  if (proper.length === 0 && types.length >= 2 && content.every((word) => TYPE_WORD.test(word))) return "confirmed";
  if (proper.length === 0 && types.length === 1 && words.length === 2 && ARTICLE.test(words[0]!) && strong) return "confirmed";
  if (proper.length === 0) return backed ? "review" : "reject";
  return strong ? "confirmed" : "review";
}

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
  spaces: SpaceEvidence[];
  reviewSpaces: SpaceEvidence[];
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

const CAPTION_NOISE = new Set(["menu", "gallery", "rooms", "includes", "accommodation", "wedding", "banquet", "scenery", "chauffeured", "house", "contact", "the", "your", "our"]);
const SPACE_TYPE = /^(?:Chalets|Chalet|Cottages|Cottage|Suites|Suite|Chapel|Hall|Auditorium|Ballroom|House)$/;
const CAPTION_TOKEN = /[\p{L}'’&-]{3,}/gu;

/**
 * A room caption is the type word plus the proper words immediately before it.
 * The walk stops at another room type or a menu word, so neighbouring labels are not glued on.
 */
export function namedSpacesInText(text: string, sourceUrl: string): string[] {
  if (!/\/(?:rooms?|spaces|hire|weddings?|accommodation)(?:\/|$)/i.test(new URL(sourceUrl).pathname)) return [];
  const tokens = [...text.matchAll(CAPTION_TOKEN)].map((match) => match[0]!);
  const names: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const type = tokens[index]!;
    if (!SPACE_TYPE.test(type) || !/^[A-Z]/.test(type)) continue;
    const words = [type];
    for (let back = index - 1; back >= 0 && words.length < 4; back -= 1) {
      const word = tokens[back]!;
      if (!/^[A-Z]/.test(word) || CAPTION_NOISE.has(word.toLowerCase())) break;
      if (SPACE_TYPE.test(word)) {
        if (words.length === 1 && word.toLowerCase() !== type.toLowerCase()) words.unshift(word);
        break;
      }
      words.unshift(word);
    }
    if (words.length < 2) continue;
    const name = words.join(" ");
    if (classifyVenueSpace(name, { listingContext: true }) === "reject") continue;
    names.push(name);
  }
  return [...new Set(names)];
}

function rememberSpace(confirmed: Map<string, SpaceEvidence>, review: Map<string, SpaceEvidence>, item: SpaceEvidence) {
  const key = item.name.toLowerCase();
  if (item.status === "confirmed") {
    if (!confirmed.has(key)) confirmed.set(key, item);
    review.delete(key);
    return;
  }
  if (!confirmed.has(key) && !review.has(key)) review.set(key, item);
}

export function buildVenueEvidencePackage(extraction: ResourceExtraction): VenueEvidencePackage {
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
  const capacityNames = new Set(capacities.flatMap((item) => item.space ? [item.space.toLowerCase()] : []));
  const confirmed = new Map<string, SpaceEvidence>();
  const review = new Map<string, SpaceEvidence>();
  for (const fact of extraction.venueFacts) {
    if (fact.fieldName !== "spaces" || typeof fact.value !== "string") continue;
    const name = fact.value;
    const listingContext = /\/(?:rooms?|spaces|hire|meeting)(?:\/|$)/i.test(new URL(fact.sourceUrl).pathname);
    const status = classifyVenueSpace(name, {
      capacityLinked: capacityNames.has(name.toLowerCase()),
      structuredPlace: (fact.confidence ?? 0) >= 0.9,
      listingContext,
    });
    if (status === "reject") continue;
    rememberSpace(confirmed, review, { name, sourceUrl: fact.sourceUrl, evidenceRef: fact.evidenceRef, status });
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
    spaces: [...confirmed.values()],
    reviewSpaces: [...review.values()],
    capacities,
    practicalFacts: extraction.venueFacts.filter((fact) => !["spaces", "capacity", "hireSuitability", "geo"].includes(fact.fieldName)),
    suitability: extraction.venueFacts.filter((fact) => fact.fieldName === "hireSuitability"),
    imagesByRole,
    routingAuthority: "not_operator_confirmed",
  };
}
