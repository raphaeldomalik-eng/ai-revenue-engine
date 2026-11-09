import {RESOURCE_PRACTICAL_FIELDS} from '../extractors/resources.ts';
import type { SourceExtractor } from "../../contracts.ts";
import { profilesFor, propertyLinkStrength } from "../extractors/profiles.ts";
import type { ExtractorProfile } from "../planner.ts";
import { isPdfUrl } from "../planner.ts";
import type { SiteIdentity } from "../site-identity.ts";
import { classifyVenueSpace } from "./evidence.ts";
import { venueLinkDimensions, venueLinkStrength } from "./selection.ts";

export const VENUE_EXTRACTORS = ["IDENTITY", "PUBLIC_CONTACT", "VENUE_FACTS", "IMAGE_CANDIDATES"] as const satisfies readonly SourceExtractor[];

const PDF_USEFUL = /\b(?:venue|hire|wedding|conference|capacity|floor|plan|technical|spec|brochure|pack|access|room|space)\b/i;
const PDF_SKIP = /\b(?:menu|privacy|policy|job|accounts|minutes|newsletter|voucher)\b/i;

/**
 * Venue-only profiles. Events are not requested, so what's-on pages do not compete for the venue budget.
 * Link choice uses the venue assessment (navigation, path, label, PDF context), not the generic event ranking.
 */
export function venueCrawlProfiles(site?: SiteIdentity, options: { emailGoal?: boolean; venueName?: string; completeContent?: boolean } = {}): ExtractorProfile[] {
  return profilesFor([...VENUE_EXTRACTORS], site, options).map((profile) => {
    const dimensions = profile.extractor === "IDENTITY"
      ? [...profile.dimensions, "VENUE_DESCRIPTION:CHARACTER"]
      : options.completeContent && profile.extractor === "VENUE_FACTS" ? [...profile.dimensions,...RESOURCE_PRACTICAL_FIELDS.map(field=>"VENUE_FACTS:"+field)] : profile.dimensions;
    return {
      ...profile,
      dimensions,
      priorityDimensions: dimensions,
      linkDimensions(url, label) {
        if (propertyLinkStrength(options.venueName,url,label)) return dimensions;
        if (profile.extractor === 'PUBLIC_CONTACT') return profile.linkDimensions(url, label);
        const base=venueLinkDimensions(url,label).filter(dim=>dimensions.includes(dim));
        if(options.completeContent&&profile.extractor==='VENUE_FACTS'){
          const text=`${url} ${label}`;
          const broad=base.some(dim=>['VENUE_FACTS:FACILITIES','VENUE_FACTS:ACCESSIBILITY','VENUE_FACTS:SPACES'].includes(dim))||/facilit|amenit|technical|accessib|catering|kitchen|wifi|wi-fi|parking|transport|loading|power|outdoor|garden|terrace|courtyard|accommodation|cloakroom/i.test(text);
          if(broad)base.push(...RESOURCE_PRACTICAL_FIELDS.map(field=>'VENUE_FACTS:'+field));
        }
        return base;
      },
      linkStrength: (url,label) => Math.max(propertyLinkStrength(options.venueName,url,label),profile.extractor === 'PUBLIC_CONTACT' ? profile.linkStrength?.(url,label) ?? 1 : venueLinkStrength(url,label)),
      pdfDimensions(url, label) {
        if (profile.extractor === 'PUBLIC_CONTACT') return profile.pdfDimensions(url, label);
        if (profile.extractor !== "VENUE_FACTS" || !isPdfUrl(url)) return null;
        const text = `${url} ${label}`;
        if (!PDF_USEFUL.test(text) || PDF_SKIP.test(text)) return null;
        return ["VENUE_FACTS:CAPACITY", "VENUE_FACTS:SPACES", "VENUE_FACTS:FACILITIES", ...(options.completeContent ? RESOURCE_PRACTICAL_FIELDS.map(field => "VENUE_FACTS:"+field) : [])];
      },
      observe(document, observation, state, selectedFor) {
        profile.observe(document, observation, state, selectedFor);
        const path = new URL(document.url).pathname;
        if (profile.extractor === "VENUE_FACTS") {
          const facts = observation.resources().venueFacts;
          if(options.completeContent)state.observedFields=[...new Set([...(state.observedFields as string[]??[]),...facts.map(f=>f.fieldName)])];
          const capacityLinked = new Set(facts.flatMap((fact) => {
            if (fact.fieldName !== "capacity" || !fact.value || typeof fact.value !== "object") return [];
            const space = (fact.value as { space?: string | null }).space;
            return space ? [space.toLowerCase()] : [];
          }));
          const names = new Set<string>((state.spaceNames as string[] | undefined) ?? []);
          const listingContext = /\/(?:rooms?|spaces|hire|meeting)(?:\/|$)/i.test(path);
          for (const fact of facts) {
            if (fact.fieldName !== "spaces" || typeof fact.value !== "string") continue;
            const decision = classifyVenueSpace(fact.value, {
              capacityLinked: capacityLinked.has(fact.value.toLowerCase()),
              structuredPlace: (fact.confidence ?? 0) >= 0.9,
              listingContext,
            });
            if (decision === "confirmed") names.add(fact.value.toLowerCase());
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
          // Complete-content discovery needs candidates, not just a gallery path.
          // Preserve the gallery-visit shortcut for legacy venue crawls.
          const enough = Number(state.images ?? 0) >= 8 || (!options.completeContent && state.galleryPage === true);
          return enough ? ["IMAGE_CANDIDATES:IMAGES"] : [];
        }
        return [...profile.satisfied(state), ...(options.completeContent&&profile.extractor==='VENUE_FACTS'?(state.observedFields as string[]??[]).map(field=>'VENUE_FACTS:'+field):[]), ...(state.character ? ["VENUE_DESCRIPTION:CHARACTER"] : [])];
      },
    };
  });
}
