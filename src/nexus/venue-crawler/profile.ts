import type { ExtractorProfile } from "../source-discovery/planner.ts";
import { pathWords } from "../source-discovery/planner.ts";

const matches = (pattern: RegExp, url: string, label: string) => pattern.test(`${pathWords(url)} ${label}`);

/** Page concepts an organiser uses to judge a venue. Event listings are intentionally absent. */
const GROUPS: Array<{ dimension: string; pattern: RegExp; strength: number }> = [
  { dimension: "VENUE:GALLERY", strength: 9, pattern: /\b(?:galler(?:y|ies)|photos?|images|pictures|venue gallery)\b/i },
  { dimension: "VENUE:SPACES", strength: 8, pattern: /\b(?:spaces?|rooms?|halls?|suites?|studios?|meeting rooms?|conference rooms?|function rooms?)\b/i },
  { dimension: "VENUE:CAPACITY", strength: 7, pattern: /\b(?:capacit\w*|floor ?plans?|specifications?|capacity sheets?|tech(?:nical)? specs?)\b/i },
  { dimension: "VENUE:PRACTICAL", strength: 6, pattern: /\b(?:facilities|accessibility|catering|food|bar|technical|production|\bav\b|sound|lighting|staging|parking|transport|loading|accommodation|outdoor)\b/i },
  { dimension: "VENUE:USE", strength: 6, pattern: /\b(?:weddings?|functions?|parties|conferences?|meetings?|corporate events?|private events?|exhibitions?|launches?)\b/i },
  { dimension: "VENUE:CORE", strength: 5, pattern: /\b(?:venue hire|private hire|our venue|about(?: us)?|the venue)\b/i },
];

const PDF_HINT = /\b(?:spec\w*|capacit\w*|floor|plans?|technical|brochures?|packs?|hire|rooms?|spaces?|venue|factsheet|fact sheet|floorplans?)\b/i;
const PDF_SKIP = /\b(?:menu|menus|terms|privacy|policy|allergen|job|vacanc|newsletter|voucher)\b/i;

/**
 * Venue research profile. The shared crawler still fetches, renders and obeys robots.
 * This profile only decides which first-party pages are worth that budget.
 */
export function venueResearchProfile(venueName = ""): ExtractorProfile {
  const ownName = venueName.trim().toLowerCase();
  return {
    extractor: "VENUE_FACTS",
    dimensions: GROUPS.map((group) => group.dimension),
    priorityDimensions: ["VENUE:GALLERY", "VENUE:SPACES", "VENUE:CAPACITY", "VENUE:PRACTICAL"],
    strategy: "GAP_PLANNED",
    linkDimensions: (url, label) => GROUPS.filter((group) => matches(group.pattern, url, label)).map((group) => group.dimension),
    linkStrength: (url, label) => Math.max(...GROUPS.filter((group) => matches(group.pattern, url, label)).map((group) => group.strength), 1),
    pdfDimensions(url, label) {
      if (!matches(PDF_HINT, url, label) || matches(PDF_SKIP, url, label)) return null;
      return ["VENUE:CAPACITY", "VENUE:SPACES"];
    },
    observe(document, observation, state) {
      const path = `${pathWords(document.url)} ${new URL(document.url).pathname}`;
      if (GROUPS[0]!.pattern.test(path)) state.galleryPage = true;
      if (GROUPS[1]!.pattern.test(path)) state.spacesPage = true;
      if (GROUPS[2]!.pattern.test(path)) state.capacityPage = true;
      if (GROUPS[3]!.pattern.test(path)) state.practicalPage = true;
      if (GROUPS[4]!.pattern.test(path)) state.usePage = true;
      if (GROUPS[5]!.pattern.test(path) || new URL(document.url).pathname === "/") state.corePage = true;
      if (document.kind === "PDF") state.pdfSeen = true;
      const resources = observation.resources();
      const usefulImages = resources.imageCandidates.filter((item) => item.likelyRole !== "LOGO").length;
      state.images = Math.max(Number(state.images ?? 0), usefulImages);
      for (const fact of resources.venueFacts) {
        if (fact.fieldName === "spaces" && String(fact.value).trim().toLowerCase() !== ownName) state.spaces = true;
        if (fact.fieldName === "capacity") state.capacity = true;
        if (fact.fieldName === "hireSuitability") state.suitability = true;
        if (!["spaces", "capacity", "hireSuitability", "geo"].includes(fact.fieldName)) state.practical = true;
      }
      for (const fact of resources.identityFacts) {
        if (["siteName", "explicitVenueName", "placeName"].includes(fact.fieldName)) state.name = true;
        if (fact.fieldName === "address") state.address = true;
      }
    },
    satisfied: (state) => [
      ...(state.galleryPage || Number(state.images ?? 0) >= 8 ? ["VENUE:GALLERY"] : []),
      ...(state.spaces || state.spacesPage ? ["VENUE:SPACES"] : []),
      ...(state.capacity || state.capacityPage || state.pdfSeen ? ["VENUE:CAPACITY"] : []),
      ...(state.practical || state.practicalPage ? ["VENUE:PRACTICAL"] : []),
      ...(state.suitability || state.usePage ? ["VENUE:USE"] : []),
      ...(state.corePage ? ["VENUE:CORE"] : []),
    ],
  };
}
