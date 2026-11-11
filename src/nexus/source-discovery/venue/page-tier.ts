import { articleLikePath, pathWords } from "../planner.ts";
import { propertyLinkStrength } from "../extractors/profiles.ts";

/**
 * Venue information value of a page, decided before it is fetched (product-owner strategy, 2026-11-11).
 *
 *  1  Mandatory: homepage, property identity, contact, enquiry, location
 *  2  High value: private hire, events and functions, weddings, corporate, spaces, rooms, capacity, facilities
 *  3  Supporting: photographs, galleries, floor plans, brochures, specifications
 *  4  Low value: menus, prices, blog, news, promotions, ecommerce, ticketing, duplicate variants
 *
 * Tier 4 is never planned for a venue crawl: a menu is not a default crawl target. A page that is also a
 * contact or enquiry route is tier 1 whatever else its path says, so a "contact" page is never lost.
 */
export type VenuePageTier = 1 | 2 | 3 | 4;

const CONTACT = /\b(?:contact(?:[- ]us)?|get[- ]in[- ]touch|enquir\w*|inquir\w*|reach[- ]us|speak[- ]to|talk[- ]to[- ]us)\b/i;
const IDENTITY = /\b(?:about(?:[- ]us)?|our[- ]story|the[- ]venue|who[- ]we[- ]are|find[- ]us|location|directions|address|visit(?:[- ]us)?|how[- ]to[- ]find)\b/i;
const MENU = /\b(?:menus?|food|drinks?|wine[- ]list|wines|cocktails?|brunch|lunch|dinner|breakfast|a[- ]la[- ]carte|set[- ]menus?|tasting|prices?|pricing|tariffs?)\b/i;
const COMMERCE = /\b(?:shop|store|cart|basket|checkout|products?|collections?|merch\w*|gift[- ]?(?:cards?|vouchers?)|vouchers?|offers?|deals?|promotions?|promo|specials?(?![- ]events?)|sale|discounts?|memberships?|subscriptions?|whats?[- ]?on|tickets?|box[- ]?office|programme|reviews?|testimonials?|competitions?)\b/i;
const HIRE = /\b(?:venue[- ]hire|private[- ](?:hire|events?|dining|parties|experiences?|functions?|rooms?|spaces?|venues?)|hire|functions?|events?|weddings?|celebrations?|parties|party|birthdays?|corporate|conferences?|conferencing|meetings?|spaces?|rooms?|venues|halls?|suites?|studios?|ballrooms?|auditor(?:ium|ia)|facilit\w*|amenit\w*|capacit\w*|accessib\w*|packages|exhibitions?|filming|accommodation|catering|christmas|team[- ]building)\b/i;
const SUPPORTING = /\b(?:galler(?:y|ies)|photos?|images|pictures|virtual[- ]tour|floor[- ]?plans?|brochures?|downloads?|spec(?:ification)?s?|tech(?:nical)?[- ]specs?|media|fact[- ]?sheets?|layouts?)\b/i;

/**
 * Property-landing strength: the venue name must be in the page's own final path segment (or its link text), so
 * "/bar/aberdeen/" is the Aberdeen landing page but "/saint-lukes/newspress/" is not (2026-11-11 replay: on a
 * single-venue site every path carried the venue name and outranked /contact/ and /special-events/).
 */
export function propertyLandingStrength(venueName: string | undefined, url: string, label = ""): number {
  if (!venueName) return 0;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return 0; }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length <= 1) return propertyLinkStrength(venueName, url, label);
  return propertyLinkStrength(venueName, `${parsed.origin}/${segments.at(-1)}/`, label);
}

export function venuePageTier(url: string, label = "", venueName = ""): VenuePageTier {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return 4; }
  const path = parsed.pathname;
  if (path === "/" || path === "") return 1;
  const text = `${pathWords(url)} ${label.replace(/\bnav\b/gi, " ")}`.replace(/\s+/g, " ").trim();
  if (CONTACT.test(text)) return 1;
  // A venue brochure or specification PDF is supporting material even under /downloads/.
  if (/\.pdf$/i.test(path)) return MENU.test(text) || COMMERCE.test(text) ? 4 : HIRE.test(text) ? 2 : 3;
  if (MENU.test(text) || COMMERCE.test(text) || articleLikePath(url)) return 4;
  if (IDENTITY.test(text)) return 1;
  if (HIRE.test(text)) return 2;
  if (SUPPORTING.test(text)) return 3;
  // A property landing page on a group site ("/bar/aberdeen/") is the venue's own identity page.
  if (venueName && propertyLandingStrength(venueName, url, label) > 0) return 1;
  return 3;
}
