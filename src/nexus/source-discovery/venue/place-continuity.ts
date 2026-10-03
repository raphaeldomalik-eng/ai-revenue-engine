/**
 * Place ID continuity only. One Place Details Essentials (IDs Only) mask.
 * A successor Place ID is evidence. It is not a new official website and it is not written back.
 */
import {
  assertGooglePlacesContinuityMask,
  GOOGLE_PLACES_CONTINUITY_FIELD_MASK,
  type GooglePlacesMaskClassification,
} from "../../../ai-sales-team/google-places-evidence.ts";

export const PLACE_MOVE_STATUSES = [
  "NO_PLACE_ID",
  "NO_MOVE_SIGNAL",
  "MOVED_PLACE_RESOLVED",
  "MOVED_PLACE_CYCLE",
  "MOVED_PLACE_HOP_LIMIT",
  "INVALID_PLACE_ID",
  "OBSOLETE_PLACE_ID",
  "MOVED_PLACE_LOOKUP_FAILED",
] as const;
export type PlaceMoveStatus = (typeof PLACE_MOVE_STATUSES)[number];

export const PLACE_CONTINUITY_MAX_IDS = 5;

export type PlaceContinuityResult = {
  providerPlaceId: string | null;
  terminalProviderPlaceId: string | null;
  placeMoveStatus: PlaceMoveStatus;
  placeMoveChain: string[];
  placeMoveHopCount: number;
  failureReason: string | null;
  observedAt: string;
};

export type PlaceContinuityLookup =
  | { ok: true; movedPlaceId: string | null }
  | { ok: false; reason: "MALFORMED" | "FAILED"; message: string };

/** HTTP 400 is an invalid identifier. HTTP 404 means Google does not resolve that stored ID. Neither is a transient lookup failure, a closure, or a successor. */
export function classifyPlaceLookupFailure(message: string): PlaceMoveStatus {
  if (/\bHTTP 400\b/.test(message) || message.includes("INVALID_REQUEST")) return "INVALID_PLACE_ID";
  if (/\bHTTP 404\b/.test(message) || message.includes("NOT_FOUND")) return "OBSOLETE_PLACE_ID";
  return "MOVED_PLACE_LOOKUP_FAILED";
}

export function reclassifyStoredPlaceMove(status: PlaceMoveStatus, failureReason: string | null): PlaceMoveStatus {
  if (status !== "MOVED_PLACE_LOOKUP_FAILED" || !failureReason) return status;
  return classifyPlaceLookupFailure(failureReason);
}

export function normaliseProviderPlaceId(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim().replace(/^places\//, "");
  return /^[A-Za-z0-9_-]{8,}$/.test(trimmed) ? trimmed : null;
}

export function placeSuccessor(payload: Record<string, unknown>): { ok: true; movedPlaceId: string | null } | { ok: false; reason: "MALFORMED"; message: string } {
  if (typeof payload.id !== "string" || !normaliseProviderPlaceId(payload.id)) {
    return { ok: false, reason: "MALFORMED", message: "Place Details response did not include a Place ID." };
  }
  const fromId = typeof payload.movedPlaceId === "string" ? normaliseProviderPlaceId(payload.movedPlaceId) : null;
  const fromResource = typeof payload.movedPlace === "string" ? normaliseProviderPlaceId(payload.movedPlace) : null;
  if (payload.movedPlaceId != null && typeof payload.movedPlaceId !== "string") return { ok: false, reason: "MALFORMED", message: "movedPlaceId was not a string." };
  if (payload.movedPlace != null && typeof payload.movedPlace !== "string") return { ok: false, reason: "MALFORMED", message: "movedPlace was not a string." };
  if ((typeof payload.movedPlaceId === "string" && !fromId) || (typeof payload.movedPlace === "string" && !fromResource)) {
    return { ok: false, reason: "MALFORMED", message: "Moved Place ID was malformed." };
  }
  if (fromId && fromResource && fromId !== fromResource) {
    return { ok: false, reason: "MALFORMED", message: "movedPlace and movedPlaceId disagreed." };
  }
  return { ok: true, movedPlaceId: fromId ?? fromResource };
}

export async function followPlaceContinuity(
  providerPlaceId: string | null | undefined,
  lookup: (placeId: string) => Promise<PlaceContinuityLookup>,
  observedAt: string,
): Promise<PlaceContinuityResult> {
  const start = normaliseProviderPlaceId(providerPlaceId);
  if (!start) {
    return { providerPlaceId: providerPlaceId?.trim() || null, terminalProviderPlaceId: null, placeMoveStatus: "NO_PLACE_ID", placeMoveChain: [], placeMoveHopCount: 0, failureReason: null, observedAt };
  }
  const chain: string[] = [];
  let current = start;
  for (;;) {
    if (chain.includes(current)) {
      const placeMoveChain = [...chain, current];
      return { providerPlaceId: start, terminalProviderPlaceId: current, placeMoveStatus: "MOVED_PLACE_CYCLE", placeMoveChain, placeMoveHopCount: chain.length, failureReason: null, observedAt };
    }
    if (chain.length >= PLACE_CONTINUITY_MAX_IDS) {
      return { providerPlaceId: start, terminalProviderPlaceId: chain[chain.length - 1] ?? null, placeMoveStatus: "MOVED_PLACE_HOP_LIMIT", placeMoveChain: chain, placeMoveHopCount: chain.length - 1, failureReason: "Further moved Place ID was not followed.", observedAt };
    }
    chain.push(current);
    const result = await lookup(current);
    if (!result.ok) {
      return { providerPlaceId: start, terminalProviderPlaceId: current, placeMoveStatus: classifyPlaceLookupFailure(result.message), placeMoveChain: chain, placeMoveHopCount: chain.length - 1, failureReason: result.message, observedAt };
    }
    if (!result.movedPlaceId || result.movedPlaceId === current) {
      const placeMoveStatus = chain.length === 1 ? "NO_MOVE_SIGNAL" : "MOVED_PLACE_RESOLVED";
      return { providerPlaceId: start, terminalProviderPlaceId: current, placeMoveStatus, placeMoveChain: chain, placeMoveHopCount: chain.length - 1, failureReason: null, observedAt };
    }
    current = result.movedPlaceId;
  }
}

export type PlaceContinuityInstrumentation = {
  requestCount: number;
  uniquePlaceIds: number;
  followUpRequests: number;
  fieldMask: string;
  sku: string;
  estimatedPaidCostUsd: number;
};

export function createPlaceContinuityFetcher(args: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  originalPlaceIds: ReadonlySet<string>;
}): {
  classification: GooglePlacesMaskClassification;
  lookup: (placeId: string) => Promise<PlaceContinuityLookup>;
  instrumentation: () => PlaceContinuityInstrumentation;
} {
  const classification = assertGooglePlacesContinuityMask(GOOGLE_PLACES_CONTINUITY_FIELD_MASK);
  if (classification.fields.join(",") !== GOOGLE_PLACES_CONTINUITY_FIELD_MASK) {
    throw new Error("GOOGLE_PLACES_CONTINUITY_ABOVE_IDS_ONLY");
  }
  const fetchImpl = args.fetchImpl ?? fetch;
  const cache = new Map<string, PlaceContinuityLookup>();
  const requested = new Set<string>();
  let requestCount = 0;
  let followUpRequests = 0;
  const lookup = async (placeId: string): Promise<PlaceContinuityLookup> => {
    const cached = cache.get(placeId);
    if (cached) return cached;
    if (!args.originalPlaceIds.has(placeId)) followUpRequests += 1;
    requested.add(placeId);
    const requestOnce = async () => {
      requestCount += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? 12_000);
      try {
        return await fetchImpl(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
          method: "GET",
          headers: {
            accept: "application/json",
            "X-Goog-Api-Key": args.apiKey,
            "X-Goog-FieldMask": GOOGLE_PLACES_CONTINUITY_FIELD_MASK,
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      let response = await requestOnce();
      if (response.status === 429 || response.status >= 500) response = await requestOnce();
      if (!response.ok) {
        const failed: PlaceContinuityLookup = { ok: false, reason: "FAILED", message: `HTTP ${response.status}` };
        if (response.status !== 429 && response.status < 500) cache.set(placeId, failed);
        return failed;
      }
      const payload = await response.json() as unknown;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        const failed: PlaceContinuityLookup = { ok: false, reason: "MALFORMED", message: "Place Details response was not an object." };
        cache.set(placeId, failed);
        return failed;
      }
      const parsed = placeSuccessor(payload as Record<string, unknown>);
      const value: PlaceContinuityLookup = parsed.ok ? parsed : { ok: false, reason: "MALFORMED", message: parsed.message };
      cache.set(placeId, value);
      return value;
    } catch (error) {
      return { ok: false, reason: "FAILED", message: error instanceof Error ? error.name : "REQUEST_FAILED" };
    }
  };
  return {
    classification,
    lookup,
    instrumentation: () => ({
      requestCount,
      uniquePlaceIds: requested.size,
      followUpRequests,
      fieldMask: GOOGLE_PLACES_CONTINUITY_FIELD_MASK,
      sku: classification.sku,
      estimatedPaidCostUsd: requestCount * classification.estimatedCostUsd,
    }),
  };
}
