// venue-web-verification.ts — Category-aware venue website verification for AI Revenue Engine.
// Evaluates whether venue-capable entities (hotels, restaurants, bars, clubs, museums, farms, etc.)
// actively market themselves as available for event hire.

export type VenueVerificationOutcome =
  | "WEB_CONFIRMED_EVENT_VENUE"
  | "OWNER_CONFIRMATION_REQUIRED"
  | "NO_EVENT_VENUE_EVIDENCE"
  | "WEB_VERIFICATION_BLOCKED";

export interface VenueVerificationResult {
  outcome: VenueVerificationOutcome;
  matchedSignals: string[];
  reason: string;
}

export const VENUE_HIRE_SIGNALS: readonly string[] = Object.freeze([
  "private hire",
  "venue hire",
  "functions",
  "function room",
  "function venue",
  "weddings",
  "wedding venue",
  "wedding packages",
  "conferences",
  "conference venue",
  "conference facilities",
  "meetings",
  "meeting room",
  "meeting rooms",
  "parties",
  "party venue",
  "private dining",
  "private dining room",
  "corporate events",
  "celebrations",
  "event packages",
  "banquet facilities",
  "event spaces",
  "group bookings",
  "exclusive hire",
  "hall hire",
]);

/**
 * Evaluates website text content with category awareness.
 */
export function verifyVenueCapability(params: {
  websiteUrl?: string;
  primaryType?: string;
  htmlContent?: string;
  isReachable?: boolean;
}): VenueVerificationResult {
  const {
    websiteUrl,
    primaryType = "",
    htmlContent = "",
    isReachable = true,
  } = params;

  if (!websiteUrl || !isReachable) {
    return {
      outcome: "WEB_VERIFICATION_BLOCKED",
      matchedSignals: [],
      reason: "Website URL missing or unreachable",
    };
  }

  const text = htmlContent.toLowerCase();
  const matchedSignals: string[] = [];

  for (const signal of VENUE_HIRE_SIGNALS) {
    if (text.includes(signal)) {
      matchedSignals.push(signal);
    }
  }

  const isFoodBeverage = ["restaurant", "bar", "pub", "nightclub"].includes(primaryType.toLowerCase());

  if (
    matchedSignals.length >= 2 ||
    (isFoodBeverage && (text.includes("private dining") || text.includes("function room") || text.includes("private hire")))
  ) {
    return {
      outcome: "WEB_CONFIRMED_EVENT_VENUE",
      matchedSignals,
      reason: `Found ${matchedSignals.length} event hire signals on first-party site`,
    };
  }

  if (matchedSignals.length === 1) {
    return {
      outcome: "OWNER_CONFIRMATION_REQUIRED",
      matchedSignals,
      reason: "Plausible event capability with single event mention; requires owner confirmation",
    };
  }

  return {
    outcome: "NO_EVENT_VENUE_EVIDENCE",
    matchedSignals: [],
    reason: "No event hire or private function marketing found on site",
  };
}
