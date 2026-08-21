import type { DiscoveryLane } from "./prospect-intelligence.ts";

export const GOOGLE_PLACES_MODES = ["disabled", "search_only", "details_selected"] as const;
export type GooglePlacesMode = typeof GOOGLE_PLACES_MODES[number];
export type GooglePlacesEndpointCategory = "TEXT_SEARCH" | "PLACE_DETAILS";
export type GooglePlacesMatchStatus = "EXACT_OR_STRONG" | "REVIEW_REQUIRED" | "CONFLICTING" | "NO_MATCH";
export type GooglePlacesErrorCategory = "MISSING_API_KEY" | "HTTP_ERROR" | "RATE_LIMITED" | "MALFORMED_RESPONSE" | "TIMEOUT" | "REQUEST_FAILED" | "INVALID_INPUT" | "MODE_NOT_ALLOWED" | null;
export type GooglePlacesTargetType = "VENUE" | "ORGANISATION";

export const GOOGLE_PLACES_TEXT_SEARCH_FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.types,places.businessStatus";
export const GOOGLE_PLACES_DETAILS_FIELD_MASK = "id,displayName,formattedAddress,types,businessStatus,websiteUri";

export type GooglePlacesTelemetry = {
  endpointCategory: GooglePlacesEndpointCategory;
  mode: GooglePlacesMode;
  fieldMask: string | null;
  candidateCount: number;
  matchStatus: GooglePlacesMatchStatus;
  httpStatus: number | null;
  errorCategory: GooglePlacesErrorCategory;
  retryCount: 0;
};

export type GooglePlacesEvidence = {
  provider: "GOOGLE_PLACES";
  googlePlaceId: string;
  displayName: string | null;
  formattedAddress: string | null;
  types: string[];
  websiteUri: string | null;
  websiteDomain: string | null;
  businessStatus: string | null;
  retrievedAt: string;
  queryContext: { targetName: string; targetWebsite: string | null; locality: string | null; lane: DiscoveryLane; targetType: GooglePlacesTargetType };
  identityConfidence: "LOW" | "MEDIUM" | "HIGH";
  matchStatus: GooglePlacesMatchStatus;
  rejectionReasons: string[];
  sourceUrl: string;
};

export type GooglePlacesSearchInput = {
  targetName: string;
  targetWebsite?: string | null;
  locality?: string | null;
  lane: "VENUE_FIRST" | "ORGANISATION_FIRST";
  targetType: GooglePlacesTargetType;
  limit?: number;
};

export type GooglePlacesDetailsInput = GooglePlacesSearchInput & { googlePlaceId: string };
export type GooglePlacesFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type GooglePlacesOptions = { apiKey?: string; mode?: GooglePlacesMode; fetchImpl?: GooglePlacesFetch; now?: () => string; timeoutMs?: number };

export type GooglePlacesVenueComplexResolution = {
  status: "PLACES_IDENTITY_SUFFICIENT" | "AI_IDENTITY_REQUIRED" | "SAFE_UNRESOLVED";
  canonicalVenueName: string | null;
  canonicalVenue: GooglePlacesEvidence | null;
  relatedFacilities: GooglePlacesEvidence[];
  officialWebsiteDomain: string | null;
  groupingReason: string | null;
  groupingEvidence: string[];
  selectedPlaceIds: string[];
  excludedBeforeDetails: Array<{ googlePlaceId: string; displayName: string | null; reason: string }>;
};

export type GooglePlacesVenueComplexRun = {
  search: { results: GooglePlacesEvidence[]; telemetry: GooglePlacesTelemetry };
  details: GooglePlacesEvidence[];
  resolution: GooglePlacesVenueComplexResolution;
  telemetry: GooglePlacesTelemetry[];
};

type RawPlace = { id?: unknown; displayName?: { text?: unknown } | null; formattedAddress?: unknown; types?: unknown; websiteUri?: unknown; businessStatus?: unknown };

function modeOf(value: string | undefined): GooglePlacesMode { return GOOGLE_PLACES_MODES.includes(value as GooglePlacesMode) ? value as GooglePlacesMode : "disabled"; }
function optionsOf(options: GooglePlacesOptions = {}) { return { apiKey: options.apiKey ?? process.env.GOOGLE_PLACES_API_KEY, mode: options.mode ?? modeOf(process.env.GOOGLE_PLACES_MODE), fetchImpl: options.fetchImpl ?? fetch, now: options.now ?? (() => new Date().toISOString()), timeoutMs: Math.max(1, Math.min(30_000, Math.floor(options.timeoutMs ?? 8_000))) }; }
function canonicalText(value: string | null | undefined) { return value?.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ?? ""; }
function domainOf(value: string | null | undefined) { try { const url = new URL(value ?? ""); return url.hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; } }
function sameDomain(expected: string | null, actual: string | null) { return Boolean(expected && actual && (expected === actual || actual.endsWith(`.${expected}`))); }
function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function boundedLimit(value: number | undefined) { return Math.max(1, Math.min(5, Math.floor(value ?? 3))); }
function matchName(target: string, actual: string | null) {
  const expected = canonicalText(target); const received = canonicalText(actual);
  if (!expected || !received) return false;
  if (expected === received || expected.includes(received) || received.includes(expected)) return true;
  const expectedTokens = new Set(expected.split(" ")); const receivedTokens = new Set(received.split(" ")); const overlap = [...expectedTokens].filter((token) => receivedTokens.has(token)).length;
  return overlap >= 2 && overlap / Math.max(expectedTokens.size, receivedTokens.size) >= 0.5;
}
function venueBrand(value: string | null | undefined) {
  return canonicalText(value).replace(/\b(?:[0-9]+|ii|iii|iv|v|vi)\b/g, " ").replace(/\s+/g, " ").trim();
}
function venueBrandAligned(target: string, actual: string | null) {
  const expected = venueBrand(target); const received = venueBrand(actual);
  return Boolean(expected && received && (expected === received || expected.includes(received) || received.includes(expected)));
}
function localityMatches(locality: string | null | undefined, address: string | null) {
  if (!locality || !address) return false;
  const expectedTokens = canonicalText(locality).split(" ").filter((token) => token.length > 2);
  const addressTokens = new Set(canonicalText(address).split(" "));
  return expectedTokens.length > 0 && expectedTokens.every((token) => addressTokens.has(token));
}
function typeMatches(targetType: GooglePlacesTargetType, types: string[]) {
  const venueTypes = ["convention_center", "event_venue", "cultural_center", "stadium", "auditorium", "museum", "performing_arts_theater", "tourist_attraction"];
  const organisationTypes = ["corporate_office", "establishment", "point_of_interest", "locality"];
  const expected = targetType === "VENUE" ? venueTypes : organisationTypes;
  return types.some((type) => expected.includes(type));
}
function operationalPlace(evidence: GooglePlacesEvidence) { return evidence.businessStatus?.toUpperCase() === "OPERATIONAL"; }
function venueRelevantPlace(evidence: GooglePlacesEvidence) { return typeMatches("VENUE", evidence.types); }
function sourceUrl(id: string) { return `https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`; }
function telemetry(endpointCategory: GooglePlacesEndpointCategory, mode: GooglePlacesMode, fieldMask: string | null, candidateCount: number, matchStatus: GooglePlacesMatchStatus, httpStatus: number | null, errorCategory: GooglePlacesErrorCategory = null): GooglePlacesTelemetry { return { endpointCategory, mode, fieldMask, candidateCount, matchStatus, httpStatus, errorCategory, retryCount: 0 }; }

export class GooglePlacesProviderError extends Error {
  readonly telemetry: GooglePlacesTelemetry;
  constructor(message: string, telemetryValue: GooglePlacesTelemetry) { super(message); this.name = "GooglePlacesProviderError"; this.telemetry = telemetryValue; }
}

function errorFor(endpointCategory: GooglePlacesEndpointCategory, mode: GooglePlacesMode, fieldMask: string | null, httpStatus: number | null, errorCategory: Exclude<GooglePlacesErrorCategory, null>) { return new GooglePlacesProviderError(`Google Places ${endpointCategory.toLowerCase()} failed safely.`, telemetry(endpointCategory, mode, fieldMask, 0, "NO_MATCH", httpStatus, errorCategory)); }
async function safeJson(response: Response, endpointCategory: GooglePlacesEndpointCategory, mode: GooglePlacesMode, fieldMask: string) { try { return await response.json() as unknown; } catch { throw errorFor(endpointCategory, mode, fieldMask, response.status, "MALFORMED_RESPONSE"); } }

async function request(configured: ReturnType<typeof optionsOf>, endpointCategory: GooglePlacesEndpointCategory, url: string, init: RequestInit, fieldMask: string) {
  if (!configured.apiKey) throw errorFor(endpointCategory, configured.mode, fieldMask, null, "MISSING_API_KEY");
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), configured.timeoutMs);
  try {
    const headers = new Headers(init.headers); headers.set("accept", "application/json"); headers.set("content-type", "application/json"); headers.set("x-goog-api-key", configured.apiKey); headers.set("x-goog-fieldmask", fieldMask);
    const response = await configured.fetchImpl(url, { ...init, headers, signal: controller.signal });
    if (!response.ok) throw errorFor(endpointCategory, configured.mode, fieldMask, response.status, response.status === 429 ? "RATE_LIMITED" : "HTTP_ERROR");
    return { payload: await safeJson(response, endpointCategory, configured.mode, fieldMask), response };
  } catch (error) {
    if (error instanceof GooglePlacesProviderError) throw error;
    const category = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError") ? "TIMEOUT" : "REQUEST_FAILED";
    throw errorFor(endpointCategory, configured.mode, fieldMask, null, category);
  } finally { clearTimeout(timeout); }
}

function normalisePlace(raw: RawPlace, input: GooglePlacesSearchInput, configured: ReturnType<typeof optionsOf>, extraReasons: string[] = [], includeWebsiteUri = false): GooglePlacesEvidence | null {
  const id = text(raw.id); if (!id) return null;
  const displayName = text(raw.displayName?.text); const formattedAddress = text(raw.formattedAddress); const types = Array.isArray(raw.types) ? raw.types.filter((item): item is string => typeof item === "string").slice(0, 24) : [];
  const websiteUri = includeWebsiteUri ? text(raw.websiteUri) : null; const websiteDomain = domainOf(websiteUri); const targetDomain = domainOf(input.targetWebsite); const nameAligned = matchName(input.targetName, displayName); const domainAligned = sameDomain(targetDomain, websiteDomain); const localityAligned = localityMatches(input.locality, formattedAddress); const typeAligned = typeMatches(input.targetType, types);
  const reasons = [...extraReasons];
  if (targetDomain && websiteDomain && !domainAligned) reasons.push("WEBSITE_DOMAIN_CONFLICT");
  if (!nameAligned) reasons.push("NAME_NOT_ALIGNED");
  if (input.locality && !localityAligned) reasons.push("LOCALITY_NOT_ALIGNED");
  const businessStatus = text(raw.businessStatus); const closed = businessStatus?.toUpperCase() === "CLOSED_PERMANENTLY" || businessStatus?.toUpperCase() === "CLOSED";
  let matchStatus: GooglePlacesMatchStatus = targetDomain && websiteDomain && !domainAligned ? "CONFLICTING" : domainAligned || (nameAligned && (localityAligned || typeAligned || !input.locality)) ? "EXACT_OR_STRONG" : nameAligned || localityAligned || typeAligned ? "REVIEW_REQUIRED" : "NO_MATCH";
  if (closed && matchStatus === "EXACT_OR_STRONG") matchStatus = "REVIEW_REQUIRED";
  if (closed) reasons.push("CLOSED_PLACE_COUNTER_EVIDENCE");
  return { provider: "GOOGLE_PLACES", googlePlaceId: id, displayName, formattedAddress, types, websiteUri, websiteDomain, businessStatus, retrievedAt: configured.now(), queryContext: { targetName: input.targetName, targetWebsite: input.targetWebsite ?? null, locality: input.locality ?? null, lane: input.lane, targetType: input.targetType }, identityConfidence: matchStatus === "EXACT_OR_STRONG" ? "HIGH" : matchStatus === "REVIEW_REQUIRED" ? "MEDIUM" : "LOW", matchStatus, rejectionReasons: [...new Set(reasons)], sourceUrl: sourceUrl(id) };
}

function finaliseMatches(results: GooglePlacesEvidence[]) {
  const plausible = results.filter((item) => ["EXACT_OR_STRONG", "REVIEW_REQUIRED"].includes(item.matchStatus));
  if (plausible.length > 1) {
    return results.map((item) => plausible.includes(item) ? { ...item, matchStatus: "REVIEW_REQUIRED" as const, identityConfidence: "MEDIUM" as const, rejectionReasons: [...new Set([...item.rejectionReasons, "MULTIPLE_PLAUSIBLE_MATCHES"])] } : item);
  }
  return results;
}

function venueCandidateReason(input: GooglePlacesSearchInput, evidence: GooglePlacesEvidence) {
  if (evidence.matchStatus === "CONFLICTING" || evidence.rejectionReasons.includes("WEBSITE_DOMAIN_CONFLICT")) return "CONFLICTING_WEBSITE_DOMAIN";
  if (!venueBrandAligned(input.targetName, evidence.displayName)) return "BASE_BRAND_NOT_ALIGNED";
  if (input.locality && !localityMatches(input.locality, evidence.formattedAddress)) return "LOCALITY_NOT_ALIGNED";
  if (!venueRelevantPlace(evidence)) return "VENUE_TYPE_NOT_RELEVANT";
  if (!operationalPlace(evidence)) return "NOT_OPERATIONAL";
  return null;
}

function venueCandidateScore(input: GooglePlacesSearchInput, evidence: GooglePlacesEvidence) {
  let score = 0;
  if (matchName(input.targetName, evidence.displayName)) score += 4;
  if (venueBrand(input.targetName) === venueBrand(evidence.displayName)) score += 4;
  if (localityMatches(input.locality, evidence.formattedAddress)) score += 2;
  if (venueRelevantPlace(evidence)) score += 2;
  if (operationalPlace(evidence)) score += 1;
  return score;
}

export function selectGooglePlacesVenueComplexCandidates(input: GooglePlacesSearchInput, results: GooglePlacesEvidence[]) {
  const ranked = results.map((evidence, index) => ({ evidence, index, reason: venueCandidateReason(input, evidence), score: venueCandidateScore(input, evidence) }));
  const selected = ranked.filter((item) => !item.reason).sort((left, right) => right.score - left.score || left.index - right.index).slice(0, 2);
  const selectedIds = new Set(selected.map((item) => item.evidence.googlePlaceId));
  return {
    selected: selected.map((item) => item.evidence),
    excluded: ranked.filter((item) => !selectedIds.has(item.evidence.googlePlaceId)).map((item) => ({ googlePlaceId: item.evidence.googlePlaceId, displayName: item.evidence.displayName, reason: item.reason ?? "DETAIL_SELECTION_LIMIT" })),
  };
}

function familyName(value: string | null) { return value?.replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+(?:[0-9]+|ii|iii|iv|v|vi)\s*$/i, "").trim() || null; }

export function resolveGooglePlacesVenueComplexEvidence(input: GooglePlacesSearchInput, searchResults: GooglePlacesEvidence[], detailResults: GooglePlacesEvidence[], excludedBeforeDetails = selectGooglePlacesVenueComplexCandidates(input, searchResults).excluded): GooglePlacesVenueComplexResolution {
  const selection = selectGooglePlacesVenueComplexCandidates(input, searchResults);
  const selectedPlaceIds = selection.selected.map((item) => item.googlePlaceId);
  const details = detailResults.filter((item) => selectedPlaceIds.includes(item.googlePlaceId));
  const canonicalVenue = details.find((item) => item.matchStatus === "EXACT_OR_STRONG" && !item.rejectionReasons.includes("CLOSED_PLACE_COUNTER_EVIDENCE")) ?? null;
  const sharedDomain = details.length === 2 && details.every((item) => Boolean(item.websiteDomain)) && details.every((item) => item.websiteDomain === details[0].websiteDomain) ? details[0].websiteDomain : null;
  const sameFamily = details.length === 2 && details.every((item) => venueBrandAligned(input.targetName, item.displayName)) && venueBrand(details[0].displayName) === venueBrand(details[1].displayName);
  const sameLocality = details.length === 2 && details.every((item) => localityMatches(input.locality, item.formattedAddress));
  const relevantTypes = details.length === 2 && details.every(venueRelevantPlace);
  const operating = details.length === 2 && details.every(operationalPlace);
  const individualMatch = details.length === 1 && canonicalVenue === details[0] && selection.selected.length === 1;
  if (details.length === 0 || (!individualMatch && details.length < selection.selected.length)) {
    return { status: "SAFE_UNRESOLVED", canonicalVenueName: null, canonicalVenue: null, relatedFacilities: [], officialWebsiteDomain: null, groupingReason: null, groupingEvidence: [], selectedPlaceIds, excludedBeforeDetails };
  }
  if (individualMatch) {
    return { status: "PLACES_IDENTITY_SUFFICIENT", canonicalVenueName: familyName(canonicalVenue.displayName) ?? input.targetName, canonicalVenue, relatedFacilities: details, officialWebsiteDomain: canonicalVenue.websiteDomain, groupingReason: "ONE_DETERMINISTIC_VENUE_MATCH", groupingEvidence: ["name/locality/type/operational checks passed", "selected details supplied venue identity"], selectedPlaceIds, excludedBeforeDetails };
  }
  if (details.length === 2 && details.every((item) => item.matchStatus === "EXACT_OR_STRONG") && sameFamily && sameLocality && relevantTypes && operating && sharedDomain) {
    return { status: "PLACES_IDENTITY_SUFFICIENT", canonicalVenueName: familyName(canonicalVenue?.displayName ?? details[0].displayName) ?? input.targetName, canonicalVenue, relatedFacilities: details, officialWebsiteDomain: sharedDomain, groupingReason: "SAME_BRAND_LOCALITY_TYPE_OPERATIONAL_AND_SHARED_OFFICIAL_DOMAIN", groupingEvidence: ["strong normalized base-brand alignment", "same relevant locality", "both venue-relevant types", "both places operational", `same official website domain: ${sharedDomain}`, "related facilities preserved as separate Places evidence"], selectedPlaceIds, excludedBeforeDetails };
  }
  return { status: "AI_IDENTITY_REQUIRED", canonicalVenueName: null, canonicalVenue: null, relatedFacilities: details, officialWebsiteDomain: null, groupingReason: null, groupingEvidence: ["venue-family tie-breaker conditions were not all satisfied"], selectedPlaceIds, excludedBeforeDetails };
}

export async function resolveGooglePlacesVenueComplex(input: GooglePlacesSearchInput, options: GooglePlacesOptions = {}): Promise<GooglePlacesVenueComplexRun> {
  const search = await searchGooglePlaces(input, options);
  const selection = selectGooglePlacesVenueComplexCandidates(input, search.results);
  const details: GooglePlacesEvidence[] = [];
  const detailTelemetry: GooglePlacesTelemetry[] = [];
  for (const candidate of selection.selected) {
    const detail = await getGooglePlaceDetails({ ...input, googlePlaceId: candidate.googlePlaceId }, options);
    detailTelemetry.push(detail.telemetry);
    if (detail.result) details.push(detail.result);
  }
  return { search, details, resolution: resolveGooglePlacesVenueComplexEvidence(input, search.results, details, selection.excluded), telemetry: [search.telemetry, ...detailTelemetry] };
}

export async function searchGooglePlaces(input: GooglePlacesSearchInput, options: GooglePlacesOptions = {}): Promise<{ results: GooglePlacesEvidence[]; telemetry: GooglePlacesTelemetry }> {
  const configured = optionsOf(options); const fieldMask = GOOGLE_PLACES_TEXT_SEARCH_FIELD_MASK;
  if (configured.mode === "disabled") return { results: [], telemetry: telemetry("TEXT_SEARCH", configured.mode, null, 0, "NO_MATCH", null, "MODE_NOT_ALLOWED") };
  if (!input.targetName.trim() || !["VENUE_FIRST", "ORGANISATION_FIRST"].includes(input.lane) || !["VENUE", "ORGANISATION"].includes(input.targetType)) throw errorFor("TEXT_SEARCH", configured.mode, fieldMask, null, "INVALID_INPUT");
  const query = [input.targetName.trim(), input.locality?.trim()].filter(Boolean).join(" ");
  const response = await request(configured, "TEXT_SEARCH", "https://places.googleapis.com/v1/places:searchText", { method: "POST", body: JSON.stringify({ textQuery: query, pageSize: boundedLimit(input.limit) }) }, fieldMask);
  const rawPlaces = response.payload && typeof response.payload === "object" && Array.isArray((response.payload as { places?: unknown }).places) ? (response.payload as { places: RawPlace[] }).places : null;
  if (!rawPlaces) throw errorFor("TEXT_SEARCH", configured.mode, fieldMask, response.response.status, "MALFORMED_RESPONSE");
  const results = finaliseMatches(rawPlaces.slice(0, boundedLimit(input.limit)).map((item) => normalisePlace(item, input, configured)).filter((item): item is GooglePlacesEvidence => Boolean(item)));
  const matchStatus: GooglePlacesMatchStatus = results.length === 0 ? "NO_MATCH" : results.some((item) => item.matchStatus === "REVIEW_REQUIRED") ? "REVIEW_REQUIRED" : results.some((item) => item.matchStatus === "EXACT_OR_STRONG") ? "EXACT_OR_STRONG" : results.every((item) => item.matchStatus === "CONFLICTING") ? "CONFLICTING" : "NO_MATCH";
  return { results, telemetry: telemetry("TEXT_SEARCH", configured.mode, fieldMask, results.length, matchStatus, response.response.status) };
}

export async function getGooglePlaceDetails(input: GooglePlacesDetailsInput, options: GooglePlacesOptions = {}): Promise<{ result: GooglePlacesEvidence | null; telemetry: GooglePlacesTelemetry }> {
  const configured = optionsOf(options); const fieldMask = GOOGLE_PLACES_DETAILS_FIELD_MASK;
  if (configured.mode === "disabled") return { result: null, telemetry: telemetry("PLACE_DETAILS", configured.mode, null, 0, "NO_MATCH", null, "MODE_NOT_ALLOWED") };
  if (configured.mode !== "details_selected") throw errorFor("PLACE_DETAILS", configured.mode, fieldMask, null, "MODE_NOT_ALLOWED");
  if (!input.googlePlaceId.trim() || !input.targetName.trim()) throw errorFor("PLACE_DETAILS", configured.mode, fieldMask, null, "INVALID_INPUT");
  const response = await request(configured, "PLACE_DETAILS", `https://places.googleapis.com/v1/places/${encodeURIComponent(input.googlePlaceId)}`, { method: "GET" }, fieldMask);
  if (!response.payload || typeof response.payload !== "object" || Array.isArray(response.payload)) throw errorFor("PLACE_DETAILS", configured.mode, fieldMask, response.response.status, "MALFORMED_RESPONSE");
  const result = normalisePlace(response.payload as RawPlace, input, configured, [], true);
  if (!result) throw errorFor("PLACE_DETAILS", configured.mode, fieldMask, response.response.status, "MALFORMED_RESPONSE");
  return { result, telemetry: telemetry("PLACE_DETAILS", configured.mode, fieldMask, 1, result.matchStatus, response.response.status) };
}
