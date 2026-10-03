// google-places-evidence.v1 — shared Google Places evidence reuse contract.
// This file is kept byte-identical in ai-revenue-engine and Event-project; both
// test suites pin the same golden masks and classifications so the copies cannot drift.
import { createHash } from "node:crypto";

export const GOOGLE_PLACES_EVIDENCE_CONTRACT = "google-places-evidence.v1" as const;
// Google Maps Platform terms cap cached Places content at 30 days.
export const GOOGLE_PLACES_EVIDENCE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const GOOGLE_PLACES_EVIDENCE_MAX_REQUEST_HISTORY = 20;

export const GOOGLE_PLACES_BILLING_TIERS = ["ESSENTIALS", "PRO", "ENTERPRISE", "ENTERPRISE_ATMOSPHERE"] as const;
export type GooglePlacesBillingTier = typeof GOOGLE_PLACES_BILLING_TIERS[number];
export type GooglePlacesEndpoint = "PLACE_DETAILS" | "TEXT_SEARCH";
export type GooglePlacesEvidenceReuse = "FULL_HIT" | "PARTIAL_HIT" | "MISS" | "NO_STORE";

const TIER_RANK: Readonly<Record<GooglePlacesBillingTier, number>> = { ESSENTIALS: 0, PRO: 1, ENTERPRISE: 2, ENTERPRISE_ATMOSPHERE: 3 };

// Places API (New) field → SKU tier (developers.google.com/maps/documentation/places/web-service/data-fields).
const FIELD_TIERS: Readonly<Record<string, GooglePlacesBillingTier>> = Object.freeze({
  attributions: "ESSENTIALS", id: "ESSENTIALS", name: "ESSENTIALS", photos: "ESSENTIALS", movedPlace: "ESSENTIALS", movedPlaceId: "ESSENTIALS", nextPageToken: "ESSENTIALS",
  addressComponents: "ESSENTIALS", addressDescriptor: "ESSENTIALS", adrFormatAddress: "ESSENTIALS", formattedAddress: "ESSENTIALS", location: "ESSENTIALS", plusCode: "ESSENTIALS", postalAddress: "ESSENTIALS", shortFormattedAddress: "ESSENTIALS", types: "ESSENTIALS", viewport: "ESSENTIALS",
  accessibilityOptions: "PRO", businessStatus: "PRO", containingPlaces: "PRO", displayName: "PRO", googleMapsLinks: "PRO", googleMapsUri: "PRO", iconBackgroundColor: "PRO", iconMaskBaseUri: "PRO", primaryType: "PRO", primaryTypeDisplayName: "PRO", pureServiceAreaBusiness: "PRO", subDestinations: "PRO", utcOffsetMinutes: "PRO",
  currentOpeningHours: "ENTERPRISE", currentSecondaryOpeningHours: "ENTERPRISE", internationalPhoneNumber: "ENTERPRISE", nationalPhoneNumber: "ENTERPRISE", priceLevel: "ENTERPRISE", priceRange: "ENTERPRISE", rating: "ENTERPRISE", regularOpeningHours: "ENTERPRISE", regularSecondaryOpeningHours: "ENTERPRISE", userRatingCount: "ENTERPRISE", websiteUri: "ENTERPRISE",
  allowsDogs: "ENTERPRISE_ATMOSPHERE", curbsidePickup: "ENTERPRISE_ATMOSPHERE", delivery: "ENTERPRISE_ATMOSPHERE", dineIn: "ENTERPRISE_ATMOSPHERE", editorialSummary: "ENTERPRISE_ATMOSPHERE", evChargeAmenitySummary: "ENTERPRISE_ATMOSPHERE", evChargeOptions: "ENTERPRISE_ATMOSPHERE", fuelOptions: "ENTERPRISE_ATMOSPHERE", generativeSummary: "ENTERPRISE_ATMOSPHERE", goodForChildren: "ENTERPRISE_ATMOSPHERE", goodForGroups: "ENTERPRISE_ATMOSPHERE", goodForWatchingSports: "ENTERPRISE_ATMOSPHERE", liveMusic: "ENTERPRISE_ATMOSPHERE", menuForChildren: "ENTERPRISE_ATMOSPHERE", neighborhoodSummary: "ENTERPRISE_ATMOSPHERE", outdoorSeating: "ENTERPRISE_ATMOSPHERE", parkingOptions: "ENTERPRISE_ATMOSPHERE", paymentOptions: "ENTERPRISE_ATMOSPHERE", reservable: "ENTERPRISE_ATMOSPHERE", restroom: "ENTERPRISE_ATMOSPHERE", reviews: "ENTERPRISE_ATMOSPHERE", reviewSummary: "ENTERPRISE_ATMOSPHERE", routingSummaries: "ENTERPRISE_ATMOSPHERE", servesBeer: "ENTERPRISE_ATMOSPHERE", servesBreakfast: "ENTERPRISE_ATMOSPHERE", servesBrunch: "ENTERPRISE_ATMOSPHERE", servesCocktails: "ENTERPRISE_ATMOSPHERE", servesCoffee: "ENTERPRISE_ATMOSPHERE", servesDessert: "ENTERPRISE_ATMOSPHERE", servesDinner: "ENTERPRISE_ATMOSPHERE", servesLunch: "ENTERPRISE_ATMOSPHERE", servesVegetarianFood: "ENTERPRISE_ATMOSPHERE", servesWine: "ENTERPRISE_ATMOSPHERE", takeout: "ENTERPRISE_ATMOSPHERE",
});
const DETAILS_IDS_ONLY_FIELDS = new Set(["attributions", "id", "name", "photos", "movedPlace", "movedPlaceId"]);
const TEXT_SEARCH_IDS_ONLY_FIELDS = new Set(["attributions", "id", "name", "nextPageToken"]);

// Estimated list price per 1,000 requests at the first volume band, before monthly free caps.
const COST_PER_1000_USD: Readonly<Record<GooglePlacesEndpoint, Record<GooglePlacesBillingTier | "IDS_ONLY", number>>> = {
  PLACE_DETAILS: { IDS_ONLY: 0, ESSENTIALS: 5, PRO: 17, ENTERPRISE: 20, ENTERPRISE_ATMOSPHERE: 25 },
  TEXT_SEARCH: { IDS_ONLY: 0, ESSENTIALS: 32, PRO: 32, ENTERPRISE: 35, ENTERPRISE_ATMOSPHERE: 40 },
};

export const GOOGLE_PLACES_PRO_CLASSIFICATION_FIELDS = ["id", "displayName", "primaryType", "types", "formattedAddress", "addressComponents", "location", "businessStatus"] as const;
export const GOOGLE_PLACES_PRO_CLASSIFICATION_MASK = GOOGLE_PLACES_PRO_CLASSIFICATION_FIELDS.join(",");
// The only Enterprise fields with a current product consumer: official website seed and public switchboard.
// Excluded deliberately: nationalPhoneNumber (formatting duplicate), opening hours (no consumer),
// rating/userRatingCount (Resources forbids Google ratings), all Enterprise + Atmosphere fields.
export const GOOGLE_PLACES_ENTERPRISE_ENRICHMENT_FIELDS = ["websiteUri", "internationalPhoneNumber"] as const;
export const GOOGLE_PLACES_ENTERPRISE_REQUEST_FIELDS = [...GOOGLE_PLACES_PRO_CLASSIFICATION_FIELDS, ...GOOGLE_PLACES_ENTERPRISE_ENRICHMENT_FIELDS] as const;
export const GOOGLE_PLACES_ENTERPRISE_REQUEST_MASK = GOOGLE_PLACES_ENTERPRISE_REQUEST_FIELDS.join(",");
const APPROVED_DETAILS_FIELDS: ReadonlySet<string> = new Set(GOOGLE_PLACES_ENTERPRISE_REQUEST_FIELDS);

// Pro classification is the fail-safe default. Enterprise exists only to acquire an official website for a
// Place that has already passed venue eligibility; nothing upgrades a Pro request to Enterprise implicitly.
export const GOOGLE_PLACES_DETAILS_PURPOSES = ["VENUE_IDENTITY", "OFFICIAL_WEBSITE"] as const;
export type GooglePlacesDetailsPurpose = typeof GOOGLE_PLACES_DETAILS_PURPOSES[number];
export type GooglePlacesDetailsAuthorization =
  | { purpose: "VENUE_IDENTITY" }
  | { purpose: "OFFICIAL_WEBSITE"; venueEligible: true; eligibilityRef: string };
export const GOOGLE_PLACES_VENUE_IDENTITY_AUTHORIZATION: GooglePlacesDetailsAuthorization = Object.freeze({ purpose: "VENUE_IDENTITY" });

export type GooglePlacesMaskClassification = {
  endpoint: GooglePlacesEndpoint;
  fields: string[];
  tier: GooglePlacesBillingTier;
  idsOnly: boolean;
  sku: string;
  tierDrivingFields: string[];
  unknownFields: string[];
  estimatedCostUsd: number;
};

export function normaliseGooglePlacesField(token: string): string {
  const trimmed = token.trim().replace(/^places\./, "");
  return trimmed === "*" ? "*" : trimmed.split(".")[0]!.trim();
}

function fieldList(mask: string | readonly string[]): string[] {
  const tokens = typeof mask === "string" ? mask.split(",") : [...mask];
  return [...new Set(tokens.map(normaliseGooglePlacesField).filter(Boolean))];
}

function tierForField(field: string, endpoint: GooglePlacesEndpoint): GooglePlacesBillingTier | null {
  if (field === "*") return "ENTERPRISE_ATMOSPHERE";
  const tier = FIELD_TIERS[field];
  if (!tier) return null;
  if (endpoint === "TEXT_SEARCH" && tier === "ESSENTIALS" && !TEXT_SEARCH_IDS_ONLY_FIELDS.has(field)) return "PRO";
  return tier;
}

const SKU_TIER_LABEL: Readonly<Record<GooglePlacesBillingTier, string>> = { ESSENTIALS: "Essentials", PRO: "Pro", ENTERPRISE: "Enterprise", ENTERPRISE_ATMOSPHERE: "Enterprise + Atmosphere" };

// The highest tier present in the mask sets the SKU for the whole request. Unknown fields and "*" fail high.
export function classifyGooglePlacesFieldMask(mask: string | readonly string[], endpoint: GooglePlacesEndpoint = "PLACE_DETAILS"): GooglePlacesMaskClassification {
  const fields = fieldList(mask);
  if (fields.length === 0) throw new Error("GOOGLE_PLACES_FIELD_MASK_EMPTY");
  const unknownFields = fields.filter((field) => tierForField(field, endpoint) === null);
  let tier: GooglePlacesBillingTier = "ESSENTIALS";
  for (const field of fields) {
    const fieldTier = tierForField(field, endpoint) ?? "ENTERPRISE_ATMOSPHERE";
    if (TIER_RANK[fieldTier] > TIER_RANK[tier]) tier = fieldTier;
  }
  const idsOnlySet = endpoint === "TEXT_SEARCH" ? TEXT_SEARCH_IDS_ONLY_FIELDS : DETAILS_IDS_ONLY_FIELDS;
  const idsOnly = fields.every((field) => idsOnlySet.has(field));
  const tierDrivingFields = fields.filter((field) => (tierForField(field, endpoint) ?? "ENTERPRISE_ATMOSPHERE") === tier);
  const endpointLabel = endpoint === "TEXT_SEARCH" ? "Text Search" : "Place Details";
  const sku = idsOnly ? `${endpointLabel} Essentials (IDs Only)` : `${endpointLabel} ${SKU_TIER_LABEL[tier]}`;
  const estimatedCostUsd = COST_PER_1000_USD[endpoint][idsOnly ? "IDS_ONLY" : tier] / 1000;
  return { endpoint, fields, tier, idsOnly, sku, tierDrivingFields, unknownFields, estimatedCostUsd };
}

/** Place continuity only. Not part of the approved venue-identity or official-website mask. */
export const GOOGLE_PLACES_CONTINUITY_FIELDS = ["id", "movedPlace", "movedPlaceId"] as const;
export const GOOGLE_PLACES_CONTINUITY_FIELD_MASK = GOOGLE_PLACES_CONTINUITY_FIELDS.join(",");
const CONTINUITY_FORBIDDEN_FIELDS = new Set([
  "displayName", "primaryType", "types", "formattedAddress", "businessStatus", "googleMapsUri", "googleMapsLinks",
  "websiteUri", "internationalPhoneNumber", "nationalPhoneNumber", "reviews", "photos", "rating", "userRatingCount",
]);

export function assertGooglePlacesContinuityMask(mask: string = GOOGLE_PLACES_CONTINUITY_FIELD_MASK): GooglePlacesMaskClassification {
  if (mask !== GOOGLE_PLACES_CONTINUITY_FIELD_MASK) throw new Error("GOOGLE_PLACES_CONTINUITY_MASK_REFUSED");
  const classification = classifyGooglePlacesFieldMask(mask, "PLACE_DETAILS");
  const allowed = new Set<string>(GOOGLE_PLACES_CONTINUITY_FIELDS);
  if (
    !classification.idsOnly
    || classification.estimatedCostUsd !== 0
    || classification.sku !== "Place Details Essentials (IDs Only)"
    || classification.fields.some((field) => CONTINUITY_FORBIDDEN_FIELDS.has(field) || !allowed.has(field))
  ) throw new Error("GOOGLE_PLACES_CONTINUITY_ABOVE_IDS_ONLY");
  return classification;
}

export function assertApprovedGooglePlacesDetailsFields(fields: string | readonly string[]): string[] {
  const list = fieldList(fields);
  if (list.length === 0) throw new Error("GOOGLE_PLACES_FIELD_MASK_EMPTY");
  for (const field of list) if (!APPROVED_DETAILS_FIELDS.has(field)) throw new Error(`GOOGLE_PLACES_FIELD_NOT_APPROVED:${field}`);
  return list;
}

export function assertGooglePlacesDetailsAuthorized(fields: string | readonly string[], authorization: GooglePlacesDetailsAuthorization = GOOGLE_PLACES_VENUE_IDENTITY_AUTHORIZATION): string[] {
  const list = assertApprovedGooglePlacesDetailsFields(fields);
  if (TIER_RANK[classifyGooglePlacesFieldMask(list).tier] < TIER_RANK.ENTERPRISE) return list;
  if (authorization?.purpose !== "OFFICIAL_WEBSITE") throw new Error("GOOGLE_PLACES_ENTERPRISE_REQUIRES_OFFICIAL_WEBSITE_PURPOSE");
  if (authorization.venueEligible !== true || typeof authorization.eligibilityRef !== "string" || !authorization.eligibilityRef.trim()) throw new Error("GOOGLE_PLACES_ENTERPRISE_REQUIRES_VENUE_ELIGIBILITY");
  return list;
}

export function googlePlacesDetailsFieldsFor(authorization: GooglePlacesDetailsAuthorization = GOOGLE_PLACES_VENUE_IDENTITY_AUTHORIZATION): string[] {
  const fields = authorization?.purpose === "OFFICIAL_WEBSITE" ? GOOGLE_PLACES_ENTERPRISE_REQUEST_FIELDS : GOOGLE_PLACES_PRO_CLASSIFICATION_FIELDS;
  return assertGooglePlacesDetailsAuthorized(fields, authorization);
}

export type GooglePlacesFieldObservation = { observedAt: string; expiresAt: string; tier: GooglePlacesBillingTier; requestId: string };
export type GooglePlacesEvidenceRequestLog = { requestId: string; fieldMask: string; tier: GooglePlacesBillingTier; observedAt: string; requestingApplication: string; workflow: string; statusCode: number | null };
export type GooglePlacesEvidenceRecordV1 = {
  contract: typeof GOOGLE_PLACES_EVIDENCE_CONTRACT;
  providerPlaceId: string;
  sourceUrl: string;
  observedAt: string;
  expiresAt: string;
  place: Record<string, unknown>;
  fields: Record<string, GooglePlacesFieldObservation>;
  requests: GooglePlacesEvidenceRequestLog[];
};

export function googlePlacesSourceUrl(providerPlaceId: string) { return `https://places.googleapis.com/v1/places/${encodeURIComponent(providerPlaceId)}`; }

export function googlePlacesEvidenceRowId(providerPlaceId: string): string {
  const hex = createHash("sha256").update(`${GOOGLE_PLACES_EVIDENCE_CONTRACT}:${providerPlaceId.trim()}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16]!, 16) % 4]!;
  const compact = hex.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function isFresh(observation: GooglePlacesFieldObservation | undefined, nowMs: number) {
  if (!observation) return false;
  const expires = Date.parse(observation.expiresAt);
  return Number.isFinite(expires) && expires > nowMs;
}

export function freshGooglePlacesFields(record: GooglePlacesEvidenceRecordV1 | null, now: string): string[] {
  if (!record) return [];
  const nowMs = Date.parse(now);
  return Object.keys(record.fields).filter((field) => isFresh(record.fields[field], nowMs)).sort();
}

export type GooglePlacesDetailsPlan =
  | { decision: "REUSE"; requestedFields: string[]; freshFields: string[]; missingFields: []; fetchFields: []; fetchMask: null; classification: null; evidenceReuse: "FULL_HIT" }
  | { decision: "FETCH"; requestedFields: string[]; freshFields: string[]; missingFields: string[]; fetchFields: string[]; fetchMask: string; classification: GooglePlacesMaskClassification; evidenceReuse: "PARTIAL_HIT" | "MISS" };

// Fresh stored superset → zero calls. Otherwise exactly one call using the smallest approved bundle
// at the tier the missing fields require: Enterprise pulls the whole Enterprise bundle (Pro fields
// ride along at no extra SKU cost), Pro pulls the Pro classification bundle.
export function planGooglePlaceDetailsFetch(input: { record: GooglePlacesEvidenceRecordV1 | null; requestedFields: string | readonly string[]; now: string }): GooglePlacesDetailsPlan {
  const requestedFields = assertApprovedGooglePlacesDetailsFields(input.requestedFields);
  const fresh = new Set(freshGooglePlacesFields(input.record, input.now));
  const freshFields = requestedFields.filter((field) => fresh.has(field));
  const missingFields = requestedFields.filter((field) => !fresh.has(field));
  if (missingFields.length === 0) return { decision: "REUSE", requestedFields, freshFields, missingFields: [], fetchFields: [], fetchMask: null, classification: null, evidenceReuse: "FULL_HIT" };
  const missingTier = classifyGooglePlacesFieldMask(missingFields).tier;
  const fetchFields: string[] = TIER_RANK[missingTier] >= TIER_RANK.ENTERPRISE
    ? [...GOOGLE_PLACES_ENTERPRISE_REQUEST_FIELDS]
    : missingTier === "PRO"
      ? [...GOOGLE_PLACES_PRO_CLASSIFICATION_FIELDS]
      : [...new Set(["id", ...missingFields])];
  const fetchMask = fetchFields.join(",");
  return { decision: "FETCH", requestedFields, freshFields, missingFields, fetchFields, fetchMask, classification: classifyGooglePlacesFieldMask(fetchMask), evidenceReuse: freshFields.length > 0 ? "PARTIAL_HIT" : "MISS" };
}

function requestIdFor(providerPlaceId: string, fieldMask: string, observedAt: string) {
  return createHash("sha256").update(`${providerPlaceId}|${fieldMask}|${observedAt}`).digest("hex").slice(0, 32);
}

function withEnvelopeBounds(record: Omit<GooglePlacesEvidenceRecordV1, "observedAt" | "expiresAt">, fallbackAt: string): GooglePlacesEvidenceRecordV1 {
  const observations = Object.values(record.fields);
  const observedAt = observations.reduce((latest, item) => (item.observedAt > latest ? item.observedAt : latest), observations[0]?.observedAt ?? fallbackAt);
  const expiresAt = observations.reduce((latest, item) => (item.expiresAt > latest ? item.expiresAt : latest), observations[0]?.expiresAt ?? fallbackAt);
  return { ...record, observedAt, expiresAt };
}

function prunedCopy(record: GooglePlacesEvidenceRecordV1 | null, nowMs: number) {
  const place: Record<string, unknown> = {};
  const fields: Record<string, GooglePlacesFieldObservation> = {};
  if (record) {
    for (const [field, observation] of Object.entries(record.fields)) {
      if (!APPROVED_DETAILS_FIELDS.has(field) || !isFresh(observation, nowMs)) continue;
      fields[field] = { ...observation };
      if (Object.prototype.hasOwnProperty.call(record.place, field)) place[field] = record.place[field];
    }
  }
  return { place, fields };
}

// Field coverage is the requested mask, not the response keys: Google omits fields that have no value,
// and a known-empty websiteUri must not trigger another Enterprise call.
export function mergeGooglePlacesEvidence(input: {
  record: GooglePlacesEvidenceRecordV1 | null;
  providerPlaceId: string;
  fetchFields: readonly string[];
  response: Record<string, unknown>;
  observedAt: string;
  requestingApplication: string;
  workflow: string;
  statusCode: number | null;
  maxAgeMs?: number;
}): GooglePlacesEvidenceRecordV1 {
  const fetchFields = assertApprovedGooglePlacesDetailsFields(input.fetchFields);
  const fieldMask = fetchFields.join(",");
  const tier = classifyGooglePlacesFieldMask(fieldMask).tier;
  const observedMs = Date.parse(input.observedAt);
  const expiresAt = new Date(observedMs + (input.maxAgeMs ?? GOOGLE_PLACES_EVIDENCE_MAX_AGE_MS)).toISOString();
  const requestId = requestIdFor(input.providerPlaceId, fieldMask, input.observedAt);
  const { place, fields } = prunedCopy(input.record, observedMs);
  for (const field of fetchFields) {
    fields[field] = { observedAt: input.observedAt, expiresAt, tier, requestId };
    if (input.response[field] !== undefined && input.response[field] !== null) place[field] = input.response[field];
    else delete place[field];
  }
  const requests = [...(input.record?.requests ?? []), { requestId, fieldMask, tier, observedAt: input.observedAt, requestingApplication: input.requestingApplication, workflow: input.workflow, statusCode: input.statusCode }].slice(-GOOGLE_PLACES_EVIDENCE_MAX_REQUEST_HISTORY);
  return withEnvelopeBounds({ contract: GOOGLE_PLACES_EVIDENCE_CONTRACT, providerPlaceId: input.providerPlaceId, sourceUrl: googlePlacesSourceUrl(input.providerPlaceId), place, fields, requests }, input.observedAt);
}

// Field-level newest-observation-wins merge used by stores to reconcile concurrent writers.
export function combineGooglePlacesEvidence(existing: GooglePlacesEvidenceRecordV1 | null, incoming: GooglePlacesEvidenceRecordV1, now: string): GooglePlacesEvidenceRecordV1 {
  if (existing && existing.providerPlaceId !== incoming.providerPlaceId) throw new Error("GOOGLE_PLACES_EVIDENCE_PLACE_ID_MISMATCH");
  const nowMs = Date.parse(now);
  const base = prunedCopy(existing, nowMs);
  const next = prunedCopy(incoming, nowMs);
  for (const [field, observation] of Object.entries(next.fields)) {
    const current = base.fields[field];
    if (current && current.observedAt > observation.observedAt) continue;
    base.fields[field] = observation;
    if (Object.prototype.hasOwnProperty.call(next.place, field)) base.place[field] = next.place[field];
    else delete base.place[field];
  }
  const seen = new Set<string>();
  const requests = [...(existing?.requests ?? []), ...incoming.requests]
    .filter((item) => (seen.has(item.requestId) ? false : (seen.add(item.requestId), true)))
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt))
    .slice(-GOOGLE_PLACES_EVIDENCE_MAX_REQUEST_HISTORY);
  return withEnvelopeBounds({ contract: GOOGLE_PLACES_EVIDENCE_CONTRACT, providerPlaceId: incoming.providerPlaceId, sourceUrl: googlePlacesSourceUrl(incoming.providerPlaceId), place: base.place, fields: base.fields, requests }, now);
}

export function googlePlacesPlaceView(record: GooglePlacesEvidenceRecordV1, fields: readonly string[]): Record<string, unknown> {
  const view: Record<string, unknown> = { id: record.providerPlaceId };
  for (const field of fields) if (Object.prototype.hasOwnProperty.call(record.place, field)) view[field] = record.place[field];
  return view;
}

export function oldestGooglePlacesObservation(record: GooglePlacesEvidenceRecordV1, fields: readonly string[]): string {
  const times = fields.map((field) => record.fields[field]?.observedAt).filter((value): value is string => typeof value === "string");
  return times.length ? times.reduce((oldest, value) => (value < oldest ? value : oldest)) : record.observedAt;
}

function boundedJson(value: unknown, depth = 0): unknown {
  if (depth > 6) throw new Error("INVALID_GOOGLE_PLACES_EVIDENCE");
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new Error("INVALID_GOOGLE_PLACES_EVIDENCE"); return value; }
  if (typeof value === "string") return value.slice(0, 2048);
  if (Array.isArray(value)) return value.slice(0, 64).map((item) => boundedJson(item, depth + 1));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 64).map(([key, item]) => [key.slice(0, 128), boundedJson(item, depth + 1)]));
  throw new Error("INVALID_GOOGLE_PLACES_EVIDENCE");
}

function isoText(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error("INVALID_GOOGLE_PLACES_EVIDENCE");
  return new Date(value).toISOString();
}

function shortText(value: unknown, max: number) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("INVALID_GOOGLE_PLACES_EVIDENCE");
  return value.trim();
}

function tierValue(value: unknown): GooglePlacesBillingTier {
  if (typeof value !== "string" || !(GOOGLE_PLACES_BILLING_TIERS as readonly string[]).includes(value)) throw new Error("INVALID_GOOGLE_PLACES_EVIDENCE");
  return value as GooglePlacesBillingTier;
}

// Strict wire/storage validation. Only approved Details fields survive, so nothing outside the
// Pro/Enterprise bundles (reviews, photos, atmosphere) can enter shared evidence through this contract.
export function validateGooglePlacesEvidenceRecord(value: unknown): GooglePlacesEvidenceRecordV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_GOOGLE_PLACES_EVIDENCE");
  const input = value as Record<string, unknown>;
  if (input.contract !== GOOGLE_PLACES_EVIDENCE_CONTRACT) throw new Error("INVALID_GOOGLE_PLACES_EVIDENCE_CONTRACT");
  const providerPlaceId = shortText(input.providerPlaceId, 512);
  const rawFields = input.fields && typeof input.fields === "object" && !Array.isArray(input.fields) ? input.fields as Record<string, unknown> : null;
  const rawPlace = input.place && typeof input.place === "object" && !Array.isArray(input.place) ? input.place as Record<string, unknown> : null;
  if (!rawFields || !rawPlace) throw new Error("INVALID_GOOGLE_PLACES_EVIDENCE");
  const fields: Record<string, GooglePlacesFieldObservation> = {};
  for (const [field, raw] of Object.entries(rawFields)) {
    if (!APPROVED_DETAILS_FIELDS.has(field)) continue;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("INVALID_GOOGLE_PLACES_EVIDENCE");
    const item = raw as Record<string, unknown>;
    fields[field] = { observedAt: isoText(item.observedAt), expiresAt: isoText(item.expiresAt), tier: tierValue(item.tier), requestId: shortText(item.requestId, 128) };
  }
  const place: Record<string, unknown> = {};
  for (const [field, raw] of Object.entries(rawPlace)) if (Object.prototype.hasOwnProperty.call(fields, field)) place[field] = boundedJson(raw);
  const requests = (Array.isArray(input.requests) ? input.requests : []).slice(-GOOGLE_PLACES_EVIDENCE_MAX_REQUEST_HISTORY).map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("INVALID_GOOGLE_PLACES_EVIDENCE");
    const item = raw as Record<string, unknown>;
    return { requestId: shortText(item.requestId, 128), fieldMask: shortText(item.fieldMask, 1024), tier: tierValue(item.tier), observedAt: isoText(item.observedAt), requestingApplication: shortText(item.requestingApplication, 128), workflow: shortText(item.workflow, 256), statusCode: typeof item.statusCode === "number" && Number.isInteger(item.statusCode) ? item.statusCode : null };
  });
  return withEnvelopeBounds({ contract: GOOGLE_PLACES_EVIDENCE_CONTRACT, providerPlaceId, sourceUrl: googlePlacesSourceUrl(providerPlaceId), place, fields, requests }, isoText(input.observedAt));
}

export interface GooglePlacesEvidenceStore {
  get(providerPlaceId: string): Promise<GooglePlacesEvidenceRecordV1 | null>;
  put(record: GooglePlacesEvidenceRecordV1): Promise<GooglePlacesEvidenceRecordV1>;
}

export function createInMemoryGooglePlacesEvidenceStore(seed: readonly GooglePlacesEvidenceRecordV1[] = [], now: () => string = () => new Date().toISOString()): GooglePlacesEvidenceStore & { size(): number; writes: number } {
  const values = new Map<string, GooglePlacesEvidenceRecordV1>();
  for (const record of seed) values.set(record.providerPlaceId, record);
  const store = {
    writes: 0,
    size: () => values.size,
    async get(providerPlaceId: string) { return values.get(providerPlaceId) ?? null; },
    async put(record: GooglePlacesEvidenceRecordV1) {
      const merged = combineGooglePlacesEvidence(values.get(record.providerPlaceId) ?? null, record, now());
      values.set(record.providerPlaceId, merged);
      store.writes += 1;
      return merged;
    },
  };
  return store;
}

export type GooglePlacesCallTelemetry = {
  contract: typeof GOOGLE_PLACES_EVIDENCE_CONTRACT;
  provider: "google_places";
  endpoint: "PLACE_DETAILS";
  providerPlaceId: string;
  requestedFields: string[];
  fieldMask: string | null;
  billingTier: GooglePlacesBillingTier | null;
  sku: string | null;
  requestingApplication: string;
  workflow: string;
  evidenceReuse: GooglePlacesEvidenceReuse;
  suppressed: boolean;
  googleCalls: 0 | 1;
  attempts: number;
  statusCode: number | null;
  observedAt: string;
  estimatedCostUsd: number;
};

export type GooglePlacesDetailsFetchOutcome =
  | { ok: true; statusCode: number; payload: Record<string, unknown>; attempts?: number }
  | { ok: false; statusCode: number | null; error: string; notFound?: boolean; attempts?: number };

export type GooglePlacesEvidenceResolution =
  | { ok: true; place: Record<string, unknown>; record: GooglePlacesEvidenceRecordV1 | null; plan: GooglePlacesDetailsPlan; googleCalls: 0 | 1; telemetry: GooglePlacesCallTelemetry; retrievedAt: string }
  | { ok: false; error: string; statusCode: number | null; notFound: boolean; record: GooglePlacesEvidenceRecordV1 | null; plan: GooglePlacesDetailsPlan; googleCalls: 0 | 1; telemetry: GooglePlacesCallTelemetry };

const inFlight = new WeakMap<object, Map<string, Promise<unknown>>>();

async function serialisePerPlace<T>(store: GooglePlacesEvidenceStore | null, providerPlaceId: string, work: () => Promise<T>): Promise<T> {
  if (!store) return work();
  let perStore = inFlight.get(store);
  if (!perStore) { perStore = new Map(); inFlight.set(store, perStore); }
  const previous = perStore.get(providerPlaceId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(work);
  perStore.set(providerPlaceId, current);
  try { return await current; } finally { if (perStore.get(providerPlaceId) === current) perStore.delete(providerPlaceId); }
}

// The single Place Details entry point: persisted evidence first, then at most one Google request.
export async function resolveGooglePlaceDetailsWithEvidence(input: {
  providerPlaceId: string;
  requestedFields: string | readonly string[];
  authorization?: GooglePlacesDetailsAuthorization;
  store: GooglePlacesEvidenceStore | null;
  requestingApplication: string;
  workflow: string;
  fetchDetails: (fieldMask: string) => Promise<GooglePlacesDetailsFetchOutcome>;
  now?: () => string;
  maxAgeMs?: number;
  onTelemetry?: (telemetry: GooglePlacesCallTelemetry) => void | Promise<void>;
}): Promise<GooglePlacesEvidenceResolution> {
  const providerPlaceId = input.providerPlaceId.trim();
  if (!providerPlaceId) throw new Error("GOOGLE_PLACES_PLACE_ID_REQUIRED");
  assertGooglePlacesDetailsAuthorized(input.requestedFields, input.authorization);
  const now = input.now ?? (() => new Date().toISOString());
  return serialisePerPlace(input.store, providerPlaceId, async () => {
    const record = input.store ? await input.store.get(providerPlaceId) : null;
    const at = now();
    const plan = planGooglePlaceDetailsFetch({ record, requestedFields: input.requestedFields, now: at });
    const base = { contract: GOOGLE_PLACES_EVIDENCE_CONTRACT, provider: "google_places" as const, endpoint: "PLACE_DETAILS" as const, providerPlaceId, requestedFields: plan.requestedFields, requestingApplication: input.requestingApplication, workflow: input.workflow, observedAt: at };
    const emit = async (telemetry: GooglePlacesCallTelemetry) => { await input.onTelemetry?.(telemetry); return telemetry; };
    if (plan.decision === "REUSE" && record) {
      const telemetry = await emit({ ...base, fieldMask: null, billingTier: null, sku: null, evidenceReuse: "FULL_HIT", suppressed: true, googleCalls: 0, attempts: 0, statusCode: null, estimatedCostUsd: 0 });
      return { ok: true as const, place: googlePlacesPlaceView(record, plan.requestedFields), record, plan, googleCalls: 0 as const, telemetry, retrievedAt: oldestGooglePlacesObservation(record, plan.requestedFields) };
    }
    const fetchPlan = plan as Extract<GooglePlacesDetailsPlan, { decision: "FETCH" }>;
    const evidenceReuse: GooglePlacesEvidenceReuse = input.store ? fetchPlan.evidenceReuse : "NO_STORE";
    const callTelemetry = (statusCode: number | null, attempts: number): GooglePlacesCallTelemetry => ({ ...base, fieldMask: fetchPlan.fetchMask, billingTier: fetchPlan.classification.tier, sku: fetchPlan.classification.sku, evidenceReuse, suppressed: false, googleCalls: 1, attempts, statusCode, estimatedCostUsd: fetchPlan.classification.estimatedCostUsd });
    let outcome: GooglePlacesDetailsFetchOutcome;
    try { outcome = await input.fetchDetails(fetchPlan.fetchMask); } catch (error) { await emit(callTelemetry(null, 1)); throw error; }
    const telemetry = await emit(callTelemetry(outcome.statusCode, outcome.attempts ?? 1));
    if (!outcome.ok) return { ok: false as const, error: outcome.error, statusCode: outcome.statusCode, notFound: Boolean(outcome.notFound), record, plan, googleCalls: 1 as const, telemetry };
    const merged = mergeGooglePlacesEvidence({ record, providerPlaceId, fetchFields: fetchPlan.fetchFields, response: outcome.payload, observedAt: at, requestingApplication: input.requestingApplication, workflow: input.workflow, statusCode: outcome.statusCode, maxAgeMs: input.maxAgeMs });
    const persisted = input.store ? await input.store.put(merged) : merged;
    return { ok: true as const, place: googlePlacesPlaceView(persisted, plan.requestedFields), record: persisted, plan, googleCalls: 1 as const, telemetry, retrievedAt: at };
  });
}
