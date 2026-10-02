import { canonicalHttpsUrl } from "../network.ts";
import { isPdfUrl, pathWords, planableUrl } from "../planner.ts";

/** Venue crawl dimensions. The shared planner schedules these; it does not interpret them. */
export const VENUE_DIMENSIONS = {
  contact: ["PUBLIC_CONTACT:DIRECT", "PUBLIC_CONTACT:EMAIL"],
  spaces: ["VENUE_FACTS:SPACES"],
  capacity: ["VENUE_FACTS:CAPACITY"],
  facilities: ["VENUE_FACTS:FACILITIES"],
  accessibility: ["VENUE_FACTS:ACCESSIBILITY"],
  images: ["IMAGE_CANDIDATES:IMAGES"],
  identity: ["IDENTITY:NAME", "IDENTITY:ADDRESS"],
  description: ["VENUE_DESCRIPTION:CHARACTER"],
} as const;

const SKIP_PATH = /\b(?:whats?-?on|whatson|tickets?|box-?office|news|blog|shop|store|cart|privacy|cookies?|careers?|jobs|search|login|account|directions-from|catalogue|catalog)\b/i;
const CONTACT = /\b(?:contact|enquir\w*|inquir\w*|bookings?|hire|private[- ](?:hire|events?)|get[- ]in[- ]touch|find[- ]us)\b/i;
const SPACES = /\b(?:spaces?|rooms?|halls?|suites?|studios?|auditor(?:ium|ia)|ballrooms?|floor[- ]?plans?|our[- ]venue|function[- ]spaces?)\b/i;
const HIRE = /\b(?:venue[- ]hire|private[- ]hire|weddings?|conferences?|meetings?|corporate|exhibitions?|banquets?|parties|celebrations?|filming|photo[- ]shoots?)\b/i;
const CAPACITY = /\b(?:capacit\w*|specifications?|tech(?:nical)?[- ]specs?|floor[- ]?plans?|dimensions|seating|layouts?|brochures?|venue[- ]packs?|fact[- ]?sheets?)\b/i;
const PRACTICAL = /\b(?:accessib\w*|parking|getting[- ]here|directions|how[- ]to[- ](?:get|find)|catering|bars?|licen[cs]ing|audio[- ]?visual|\bav\b|staging|load[- ]?in|accommodation|cloakroom|toilets?|curfew|wifi|wi-fi)\b/i;
const IMAGES = /\b(?:galler(?:y|ies)|photos?|images|pictures|virtual[- ]tour|media)\b/i;
const ABOUT = /\b(?:about|our[- ]story|the[- ]venue|visit|location|history)\b/i;
const PDF_USEFUL = /\b(?:venue|hire|wedding|conference|capacity|floor|plan|technical|spec|brochure|pack|access|room|space)\b/i;
const PDF_SKIP = /\b(?:menu|privacy|policy|job|accounts|minutes|newsletter|voucher)\b/i;

export type VenueLinkAssessment = {
  url: string;
  dims: string[];
  strength: number;
  reason: string;
};

function words(url: string, label: string): string {
  return `${pathWords(url)} ${label}`.replace(/\s+/g, " ").trim();
}

/** Path, link text, navigation marker, and PDF context. Keyword match alone does not select a page. */
export function assessVenueLink(url: string, label = ""): VenueLinkAssessment | null {
  if (!planableUrl(url)) return null;
  if (/directions-from|\/(?:menu|catalogue|catalog)(?:\/|$)/i.test(new URL(url).pathname)) return null;
  const inNavigation = /\bnav\b/i.test(label);
  const text = words(url, label.replace(/\bnav\b/gi, " "));
  const pdf = isPdfUrl(url);
  if (pdf && (PDF_SKIP.test(text) || !PDF_USEFUL.test(text))) return null;
  if (!pdf && SKIP_PATH.test(text) && !CONTACT.test(text) && !SPACES.test(text)) return null;
  const dims = new Set<string>();
  const reasons: string[] = [];
  if (inNavigation) reasons.push("primary-navigation");
  if (CONTACT.test(text)) { VENUE_DIMENSIONS.contact.forEach((dim) => dims.add(dim)); reasons.push("contact-route"); }
  if (SPACES.test(text) || HIRE.test(text)) { VENUE_DIMENSIONS.spaces.forEach((dim) => dims.add(dim)); reasons.push("space-or-hire"); }
  if (CAPACITY.test(text) || pdf) { VENUE_DIMENSIONS.capacity.forEach((dim) => dims.add(dim)); reasons.push(pdf ? "venue-pdf" : "capacity-or-specification"); }
  if (PRACTICAL.test(text)) {
    if (/\b(?:accessib\w*|parking|getting[- ]here|directions)\b/i.test(text)) dims.add("VENUE_FACTS:ACCESSIBILITY");
    dims.add("VENUE_FACTS:FACILITIES");
    reasons.push("practical-detail");
  }
  if (IMAGES.test(text)) { dims.add("IMAGE_CANDIDATES:IMAGES"); reasons.push("gallery"); }
  if (ABOUT.test(text)) {
    VENUE_DIMENSIONS.identity.forEach((dim) => dims.add(dim));
    dims.add("VENUE_DESCRIPTION:CHARACTER");
    reasons.push("venue-character");
  }
  if (HIRE.test(text)) { dims.add("VENUE_DESCRIPTION:CHARACTER"); reasons.push("event-use"); }
  if (!dims.size) return null;
  const depth = new URL(url).pathname.split("/").filter(Boolean).length;
  const strength = (inNavigation ? 4 : 0) + Math.min(reasons.length, 4) * 2 + (pdf ? 3 : 0) - Math.min(depth, 4);
  return { url, dims: [...dims], strength: Math.max(strength, 1), reason: reasons.join("+") };
}

export function venueLinkDimensions(url: string, label = ""): string[] {
  return assessVenueLink(url, label)?.dims ?? [];
}

export function venueLinkStrength(url: string, label = ""): number {
  return assessVenueLink(url, label)?.strength ?? 1;
}

export function rankVenueLinks(htmlAnchors: Array<{ href: string; label: string }>, pageUrl: string): VenueLinkAssessment[] {
  const ranked = new Map<string, VenueLinkAssessment>();
  for (const anchor of htmlAnchors) {
    const url = canonicalHttpsUrl(anchor.href, pageUrl);
    if (!url || new URL(url).origin !== new URL(pageUrl).origin) continue;
    const assessment = assessVenueLink(url, anchor.label);
    if (!assessment) continue;
    const existing = ranked.get(url);
    if (!existing || assessment.strength > existing.strength) ranked.set(url, assessment);
  }
  return [...ranked.values()].sort((a, b) => b.strength - a.strength || a.url.localeCompare(b.url));
}
