/**
 * Prestige Nexus owns classification. This module only dispatches a crawl
 * when that decision is already a governed venue. EVENT, PROMOTER and
 * ORGANISATION are later crawler profiles and are refused here.
 */
export const VENUE_CLASSIFICATION_STATES = ["CONFIRMED", "HIGH_CONFIDENCE", "PROPOSED"] as const;

export type VenueCrawlerClassification = {
  subjectEntityType: string;
  sourceType: string;
  classificationState: string;
  verifiedOfficialUrl: string;
  venueName: string;
  candidateReference?: { sourceSystem: string; sourceRecordId: string } | null;
  canonicalEntityId?: string | null;
  locality?: string | null;
  region?: string | null;
  country?: string | null;
};

export class VenueCrawlerDispatchRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VenueCrawlerDispatchRefusal";
  }
}

export function assertVenueCrawlerDispatch(input: VenueCrawlerClassification): void {
  if (input.subjectEntityType !== "VENUE") {
    throw new VenueCrawlerDispatchRefusal(
      input.subjectEntityType === "UNKNOWN"
        ? "Nexus classification is UNKNOWN. An unclassified source is not crawled as a venue."
        : `Nexus subject entity type ${input.subjectEntityType || "missing"} is not dispatched to the Venue Crawler.`,
    );
  }
  if (input.sourceType !== "OFFICIAL_ENTITY_WEBSITE") {
    throw new VenueCrawlerDispatchRefusal("Venue Crawler requires a verified official entity website.");
  }
  if (!VENUE_CLASSIFICATION_STATES.includes(input.classificationState as typeof VENUE_CLASSIFICATION_STATES[number])) {
    throw new VenueCrawlerDispatchRefusal("Venue Crawler requires a confirmed, high-confidence, or proposed Nexus venue classification.");
  }
  let official: URL;
  try { official = new URL(input.verifiedOfficialUrl); } catch { throw new VenueCrawlerDispatchRefusal("Verified official website must be an absolute URL."); }
  if (official.protocol !== "https:" && official.protocol !== "http:") throw new VenueCrawlerDispatchRefusal("Verified official website must be an HTTP(S) URL.");
  const reference = input.candidateReference;
  const governedReference = Boolean(input.canonicalEntityId) || Boolean(reference?.sourceSystem && reference.sourceRecordId);
  if (!governedReference) throw new VenueCrawlerDispatchRefusal("Venue Crawler requires a canonical entity id or a governed candidate reference.");
  if (!input.venueName.trim()) throw new VenueCrawlerDispatchRefusal("Venue Crawler requires the governed venue name.");
}
