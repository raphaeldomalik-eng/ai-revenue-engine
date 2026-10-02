import type { SourceExtractor } from "../../contracts.ts";
import { profilesFor } from "../extractors/profiles.ts";
import type { ExtractorProfile } from "../planner.ts";
import { isPdfUrl } from "../planner.ts";
import type { SiteIdentity } from "../site-identity.ts";
import { venueLinkDimensions, venueLinkStrength } from "./selection.ts";

export const VENUE_EXTRACTORS = ["IDENTITY", "PUBLIC_CONTACT", "VENUE_FACTS", "IMAGE_CANDIDATES"] as const satisfies readonly SourceExtractor[];

const PDF_USEFUL = /\b(?:venue|hire|wedding|conference|capacity|floor|plan|technical|spec|brochure|pack|access|room|space)\b/i;
const PDF_SKIP = /\b(?:menu|privacy|policy|job|accounts|minutes|newsletter|voucher)\b/i;

/**
 * Venue-only profiles. Events are not requested, so what's-on pages do not compete for the venue budget.
 * Link choice uses the venue assessment (navigation, path, label, PDF context), not the generic event ranking.
 */
export function venueCrawlProfiles(site?: SiteIdentity, options: { emailGoal?: boolean; venueName?: string } = {}): ExtractorProfile[] {
  return profilesFor([...VENUE_EXTRACTORS], site, options).map((profile) => {
    const dimensions = profile.extractor === "IDENTITY"
      ? [...profile.dimensions, "VENUE_DESCRIPTION:CHARACTER"]
      : profile.dimensions;
    return {
      ...profile,
      dimensions,
      priorityDimensions: dimensions,
      linkDimensions(url, label) {
        return venueLinkDimensions(url, label).filter((dim) => dimensions.includes(dim));
      },
      linkStrength: venueLinkStrength,
      pdfDimensions(url, label) {
        if (profile.extractor !== "VENUE_FACTS" || !isPdfUrl(url)) return null;
        const text = `${url} ${label}`;
        if (!PDF_USEFUL.test(text) || PDF_SKIP.test(text)) return null;
        return ["VENUE_FACTS:CAPACITY", "VENUE_FACTS:SPACES", "VENUE_FACTS:FACILITIES"];
      },
      observe(document, observation, state, selectedFor) {
        profile.observe(document, observation, state, selectedFor);
        const path = new URL(document.url).pathname;
        if (profile.extractor === "VENUE_FACTS") {
          const names = new Set<string>((state.spaceNames as string[] | undefined) ?? []);
          for (const fact of observation.resources().venueFacts) {
            if (fact.fieldName === "spaces" && typeof fact.value === "string") names.add(fact.value.toLowerCase());
          }
          state.spaceNames = [...names];
          state.spaces = names.size >= 3;
        }
        if (profile.extractor === "IMAGE_CANDIDATES" && /galler|photo|image/i.test(path)) state.galleryPage = true;
        if (profile.extractor !== "IDENTITY") return;
        const characterPage = /about|hire|wedding|venue|space|room|conference/i.test(path) || path === "/";
        const text = observation.resources().identityFacts.some((fact) => fact.fieldName === "siteDescription" || fact.fieldName === "metaDescription")
          || observation.resources().venueFacts.some((fact) => fact.fieldName === "spaces" || fact.fieldName === "hireSuitability");
        if (characterPage && (text || document.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length > 280)) state.character = true;
      },
      satisfied(state) {
        if (profile.extractor === "IMAGE_CANDIDATES") {
          const enough = Number(state.images ?? 0) >= 8 || state.galleryPage === true;
          return enough ? ["IMAGE_CANDIDATES:IMAGES"] : [];
        }
        return [...profile.satisfied(state), ...(state.character ? ["VENUE_DESCRIPTION:CHARACTER"] : [])];
      },
    };
  });
}
