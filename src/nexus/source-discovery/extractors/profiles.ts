import type { SourceExtractor } from "../../contracts.ts";
import { acceptVenueEmail } from "../../venue-email.ts";
import { calendarFallbackUrl, discoverCalendarUrls, discoverLikelyEventDetailUrls } from "../links.ts";
import { pathWords, type Dimension, type DocumentObservation, type ExtractorProfile, type ProfileCandidate, type ProfileState } from "../planner.ts";
import type { SiteIdentity } from "../site-identity.ts";
import type { FetchedDocument } from "../types.ts";
import { extractEventsFromDocuments } from "./events.ts";
import { extractResourcesFromDocuments, type ResourceExtraction } from "./resources.ts";

const matches = (pattern: RegExp, url: string, label: string) => pattern.test(`${pathWords(url)} ${label}`);
const count = (state: ProfileState, key: string) => Number(state[key] ?? 0);
const bump = (state: ProfileState, key: string, by = 1) => { state[key] = count(state, key) + by; };

const CONTACT_LINK = /\b(?:contact|enquir\w*|inquir\w*|bookings?|book[- ]?(?:now|a|the|your)|get[- ]in[- ]touch|find[- ]us|hire|private[- ](?:hire|events?|dining)|venue[- ]hire|sales)\b/i;
const CONTACT_PAGE = /\b(?:contact|enquir\w*|book\w*|hire|get-in-touch)\b/i;
const DIRECT_PURPOSES = new Set(["SALES_HIRE", "BOOKINGS", "ENQUIRIES"]);

/** DIRECT stays satisfied by phone or a contact-page form. EMAIL is a separate sufficiency goal. */
export function publicContactProfile(options: { emailGoal?: boolean; venueName?: string } = {}): ExtractorProfile {
  const emailGoal = options.emailGoal === true;
  const dimensions = emailGoal ? ["PUBLIC_CONTACT:DIRECT", "PUBLIC_CONTACT:EMAIL"] : ["PUBLIC_CONTACT:DIRECT"];
  return {
    extractor: "PUBLIC_CONTACT",
    dimensions,
    priorityDimensions: emailGoal ? ["PUBLIC_CONTACT:EMAIL"] : ["PUBLIC_CONTACT:DIRECT"],
    strategy: emailGoal ? "GAP_PLANNED" : "LINK_FOLLOWING",
    linkDimensions: (url, label) => (matches(CONTACT_LINK, url, label) ? dimensions : []),
    linkStrength: (url) => (/contact|hire/i.test(new URL(url).pathname) ? 2 : 1),
    pdfDimensions: () => null,
    observe(document, observation, state) {
      const contactPage = CONTACT_PAGE.test(new URL(document.url).pathname);
      for (const contact of observation.resources().publicContacts) {
        if (contact.type === "EMAIL") {
          if (emailGoal && !contact.reviewRequired && acceptVenueEmail(contact.value, document.url, options.venueName ?? "", contact.label ?? "").accepted) state.email = true;
          if (contact.reviewRequired) continue;
        } else if (contact.reviewRequired) continue;
        if ((contact.type === "EMAIL" || contact.type === "PHONE") && DIRECT_PURPOSES.has(contact.purpose)) state.direct = true;
        if (contactPage && ["EMAIL", "PHONE", "CONTACT_FORM"].includes(contact.type)) state.direct = true;
      }
    },
    satisfied: (state) => [
      ...(state.direct ? ["PUBLIC_CONTACT:DIRECT"] : []),
      ...(state.email ? ["PUBLIC_CONTACT:EMAIL"] : []),
    ],
  };
}

const VENUE_SIGNALS: Array<[Dimension, RegExp]> = [
  ["VENUE_FACTS:SPACES", /\b(?:spaces?|rooms?|venues?|halls?|suites?|floor[- ]?plans?|function|studios?|theatres?|auditori\w*|hire|weddings?|conferences?|corporate|meetings?|private[- ](?:hire|events?|dining)|parties|celebrations?|exhibitions?|filming)\b/i],
  ["VENUE_FACTS:CAPACITY", /\b(?:capacit\w*|specifications?|specs?|tech(?:nical)?[- ]specs?|floor[- ]?plans?|room[- ]guide|dimensions|hire|spaces?|rooms?|event[- ]packs?|brochures?|downloads?|weddings?|conferences?|meetings?|seating|layouts?)\b/i],
  ["VENUE_FACTS:FACILITIES", /\b(?:facilit\w*|technical|production|av|audio[- ]?visual|sound|lighting|catering|food|drinks?|menus?|amenit\w*|equipment|staging|stage|backstage|green[- ]room|dressing[- ]rooms?|riders?|load[- ]?in)\b/i],
  ["VENUE_FACTS:ACCESSIBILITY", /\b(?:accessib\w*|access|getting[- ]here|find[- ]us|directions|parking|travel|how[- ]to[- ]get|visit(?:ing)?)\b/i],
];
/** Event detail slugs ("…-karaoke-in-room-2") describe one performance, not the venue's spaces. */
const EVENT_DETAIL_PATH = /\/(?:events?|gigs?|shows?|whats-on|listings?|tickets?|performances?|programme)\/[^/]+/i;
const VENUE_PDF = /\b(?:spec\w*|capacit\w*|floor|plans?|technical|tech|riders?|access\w*|brochures?|packs?|hire|rooms?|spaces?|guides?|venue|weddings?|conferences?|corporate|meetings?|dimensions|layouts?|seating|factsheet|fact[- ]sheet|delegate|production)\b/i;
const NOT_VENUE_PDF = /\b(?:menu|menus|terms|privacy|policy|policies|allergen|job|vacanc|annual[- ]report|accounts|minutes|agenda|newsletter|gift|voucher)\b/i;

export const venueFactsProfile: ExtractorProfile = {
  extractor: "VENUE_FACTS",
  dimensions: VENUE_SIGNALS.map(([dim]) => dim),
  priorityDimensions: VENUE_SIGNALS.map(([dim]) => dim),
  strategy: "GAP_PLANNED",
  linkDimensions: (url, label) => (EVENT_DETAIL_PATH.test(new URL(url).pathname) ? [] : VENUE_SIGNALS.filter(([, pattern]) => matches(pattern, url, label)).map(([dim]) => dim)),
  linkStrength: (url, label) => (/\.pdf$/i.test(new URL(url).pathname)
    ? (matches(/\b(?:spec\w*|capacit\w*|floor|technical|tech)\b/i, url, label) ? 2 : 1)
    : (/capacit|spec|floor-?plan|spaces?\b|rooms?\b|technical|hire|accessib/i.test(new URL(url).pathname) ? 2 : 1)),
  pdfDimensions(url, label) {
    if (!matches(VENUE_PDF, url, label) || matches(NOT_VENUE_PDF, url, label)) return null;
    return [...new Set(["VENUE_FACTS:CAPACITY", ...VENUE_SIGNALS.filter(([, pattern]) => matches(pattern, url, label)).map(([dim]) => dim)])];
  },
  observe(_document, observation, state) {
    const facilities = new Set((state.facilities as string[] | undefined) ?? []);
    for (const fact of observation.resources().venueFacts) {
      if (fact.fieldName === "spaces") state.spaces = true;
      if (fact.fieldName === "capacity") {
        state.capacity = true;
        if ((fact.value as { space?: string | null }).space) state.spaces = true;
      }
      if (fact.fieldName === "accessibility") state.accessibility = true;
      else if (!["spaces", "capacity", "hireSuitability", "geo"].includes(fact.fieldName)) facilities.add(fact.fieldName);
    }
    state.facilities = [...facilities];
  },
  satisfied: (state) => [
    ...(state.spaces ? ["VENUE_FACTS:SPACES"] : []),
    ...(state.capacity ? ["VENUE_FACTS:CAPACITY"] : []),
    ...(((state.facilities as string[] | undefined) ?? []).length >= 2 ? ["VENUE_FACTS:FACILITIES"] : []),
    ...(state.accessibility ? ["VENUE_FACTS:ACCESSIBILITY"] : []),
  ],
};

const IMAGE_LINK = /\b(?:gallery|galleries|photos?|images|media|virtual[- ]tour|press|pictures|permissions?|licen[cs]e|media[- ]terms)\b/i;
export const imageCandidatesProfile: ExtractorProfile = {
  extractor: "IMAGE_CANDIDATES",
  dimensions: ["IMAGE_CANDIDATES:IMAGES"],
  priorityDimensions: [],
  strategy: "GAP_PLANNED",
  linkDimensions: (url, label) => (matches(IMAGE_LINK, url, label) ? ["IMAGE_CANDIDATES:IMAGES"] : []),
  linkStrength: (url) => (/galler/i.test(new URL(url).pathname) ? 2 : 1),
  pdfDimensions: () => null,
  observe(_document, observation, state) {
    bump(state, "images", observation.resources().imageCandidates.filter((item) => item.likelyRole !== "LOGO").length);
  },
  satisfied: (state) => (count(state, "images") >= 3 ? ["IMAGE_CANDIDATES:IMAGES"] : []),
};

const EVENT_LINK = /\b(?:events?|gigs?|shows?|tour|live|whats[- ]?on|what'?s on|calendar|concerts?|programme|listings?)\b/i;
export function eventsProfile(site?: SiteIdentity): ExtractorProfile {
  return {
    extractor: "EVENTS",
    dimensions: ["EVENTS:LISTINGS"],
    priorityDimensions: [],
    strategy: "LINK_FOLLOWING",
    linkDimensions: (url, label) => (matches(EVENT_LINK, url, label) ? ["EVENTS:LISTINGS"] : []),
    pdfDimensions: () => null,
    followUps(document, observation, open) {
      if (!open.has("EVENTS:LISTINGS") || document.kind !== "HTML") return [];
      const found = observation.eventCount();
      const pages: ProfileCandidate[] = (found ? [] : discoverLikelyEventDetailUrls(document, site)).map((url) => ({ url, kind: "PAGE", dims: ["EVENTS:LISTINGS"], source: "EVENT_DETAIL" }));
      const explicit = discoverCalendarUrls(document, site);
      const fallback = explicit.length || found ? [] : [calendarFallbackUrl(document)].filter((url): url is string => Boolean(url));
      return [...pages, ...[...explicit, ...fallback].map((url): ProfileCandidate => ({ url, kind: "CALENDAR", dims: ["EVENTS:LISTINGS"], source: "CALENDAR" }))];
    },
    observe(_document, observation, state, selectedFor) {
      bump(state, "events", observation.eventCount());
      if (selectedFor.length && selectedFor.every((dim) => dim === "EVENTS:LISTINGS")) bump(state, "eventPages");
    },
    satisfied: (state) => (count(state, "events") > 0 || count(state, "eventPages") >= 3 ? ["EVENTS:LISTINGS"] : []),
  };
}

const IDENTITY_NAME_LINK = /\b(?:about|about[- ]us|who[- ]we[- ]are|our[- ]story|history)\b/i;
const IDENTITY_ADDRESS_LINK = /\b(?:contact|find[- ]us|visit|location|getting[- ]here|directions)\b/i;
export const identityProfile: ExtractorProfile = {
  extractor: "IDENTITY",
  dimensions: ["IDENTITY:NAME", "IDENTITY:ADDRESS"],
  priorityDimensions: [],
  strategy: "LINK_FOLLOWING",
  linkDimensions: (url, label) => [
    ...(matches(IDENTITY_NAME_LINK, url, label) ? ["IDENTITY:NAME"] : []),
    ...(matches(IDENTITY_ADDRESS_LINK, url, label) ? ["IDENTITY:ADDRESS"] : []),
  ],
  pdfDimensions: () => null,
  observe(_document, observation, state) {
    for (const fact of observation.resources().identityFacts) {
      if (["siteName", "placeName", "explicitVenueName", "operatorName"].includes(fact.fieldName)) state.name = true;
      if (fact.fieldName === "address") state.address = true;
    }
  },
  satisfied: (state) => [...(state.name ? ["IDENTITY:NAME"] : []), ...(state.address ? ["IDENTITY:ADDRESS"] : [])],
};

export const sourceClassificationProfile: ExtractorProfile = {
  extractor: "SOURCE_CLASSIFICATION",
  dimensions: ["SOURCE_CLASSIFICATION:ENTRY"],
  priorityDimensions: [],
  strategy: "LINK_FOLLOWING",
  linkDimensions: (url, label) => (matches(IDENTITY_NAME_LINK, url, label) ? ["SOURCE_CLASSIFICATION:ENTRY"] : []),
  pdfDimensions: () => null,
  observe(_document, _observation, state) { state.entry = true; },
  satisfied: (state) => (state.entry ? ["SOURCE_CLASSIFICATION:ENTRY"] : []),
};

/** Registry order is also the round-robin order in which open dimensions share the budget. */
export function profilesFor(extractors: SourceExtractor[], site?: SiteIdentity, options: { emailGoal?: boolean; venueName?: string } = {}): ExtractorProfile[] {
  const registry: ExtractorProfile[] = [publicContactProfile(options), eventsProfile(site), venueFactsProfile, imageCandidatesProfile, identityProfile, sourceClassificationProfile];
  return registry.filter((profile) => extractors.includes(profile.extractor));
}

export function createObservation(document: FetchedDocument, extractors: SourceExtractor[]): DocumentObservation {
  let resources: ResourceExtraction | null = null;
  let events: number | null = null;
  return {
    resources: () => (resources ??= document.kind === "CALENDAR"
      ? { identityFacts: [], publicContacts: [], venueFacts: [], imageCandidates: [], evidenceRefs: [], warnings: [] }
      : extractResourcesFromDocuments([document], extractors)),
    eventCount: () => (events ??= extractors.includes("EVENTS") && document.kind !== "PDF" ? extractEventsFromDocuments([document]).eventCandidates.length : 0),
  };
}
