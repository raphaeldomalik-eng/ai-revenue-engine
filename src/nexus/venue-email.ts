import { VENUE_EMAIL_RELATIONSHIPS } from "./contracts.ts";

/**
 * Shared venue-email acceptance for official-website discovery and the crawler email dimension.
 * Profiles import this module directly so they do not depend on the discovery orchestrator.
 */

type RejectionCategory = "SOCIAL_PROFILE" | "MAPS_OR_SEARCH_ENGINE" | "DIRECTORY" | "TICKETING" | "TRAVEL_OR_BOOKING_PLATFORM" | "REVIEW_SITE" | "AGGREGATOR" | "CACHED_OR_MIRRORED";
const REJECTED_HOSTS: Record<RejectionCategory, string[]> = {
  SOCIAL_PROFILE: ["facebook.com", "fb.com", "instagram.com", "tiktok.com", "linkedin.com", "twitter.com", "x.com", "youtube.com", "youtu.be", "linktr.ee", "pinterest.com", "threads.net", "snapchat.com", "wa.me", "whatsapp.com"],
  MAPS_OR_SEARCH_ENGINE: ["goo.gl", "g.page", "bing.com", "duckduckgo.com", "yahoo.com", "apple.com", "waze.com", "here.com", "openstreetmap.org", "mapquest.com"],
  DIRECTORY: ["yell.com", "thomsonlocal.com", "192.com", "cylex-uk.co.uk", "cylex.co.za", "hotfrog.co.uk", "hotfrog.co.za", "scoot.co.uk", "freeindex.co.uk", "brownbook.net", "foursquare.com", "yelp.com", "yelp.co.uk", "brabys.com", "yellowpages.co.za", "sa-venues.com", "snupit.co.za", "localbusinesses.co.za", "bizcommunity.com", "infobel.com", "cybo.com", "companieshouse.gov.uk", "find-and-update.company-information.service.gov.uk", "endole.co.uk", "opencorporates.com", "bark.com", "hireaspace.co.uk", "tagvenue.com", "venuedirectory.com", "venuescanner.com", "headbox.com", "coolplaces.co.uk", "hitched.co.uk", "bridebook.com", "confetti.co.uk", "venuefinder.com", "hirespace.com", "venuelist.co.za", "weddingvenues.co.za", "conference-venues.co.za", "eventective.com", "partyvenues.co.za", "uniquevenues.co.uk", "squaremeal.co.uk", "designmynight.com", "zomato.com", "opentable.co.uk", "opentable.com", "dineplan.com"],
  TICKETING: ["eventbrite.com", "eventbrite.co.uk", "eventbrite.co.za", "ticketmaster.co.uk", "ticketmaster.com", "seetickets.com", "skiddle.com", "dice.fm", "ticketweb.uk", "gigantic.com", "fatsoma.com", "ents24.com", "songkick.com", "bandsintown.com", "quicket.co.za", "computicket.com", "webtickets.co.za", "howler.co.za", "tixsa.co.za", "plankton.mobi", "ticketpro.co.za", "stubhub.com", "stubhub.co.uk", "viagogo.com", "twickets.live", "allevents.in", "meetup.com", "residentadvisor.net", "ra.co", "wegottickets.com", "ticketsource.co.uk"],
  TRAVEL_OR_BOOKING_PLATFORM: ["booking.com", "expedia.com", "expedia.co.uk", "hotels.com", "airbnb.com", "airbnb.co.uk", "airbnb.co.za", "agoda.com", "trivago.com", "trivago.co.uk", "lastminute.com", "laterooms.com", "kayak.com", "kayak.co.uk", "lekkeslaap.co.za", "travelground.com", "safarinow.com", "hostelworld.com", "trip.com"],
  REVIEW_SITE: ["tripadvisor.com", "tripadvisor.co.uk", "tripadvisor.co.za", "trustpilot.com", "reviews.io", "hellopeter.com", "feefo.com"],
  AGGREGATOR: ["wikipedia.org", "wikiwand.com", "wikidata.org", "timeout.com", "visitlondon.com", "visitbritain.com", "southafrica.net", "whatsonstage.com", "list.co.uk", "designmynight.com", "happyfresh.co.za", "medium.com", "blogspot.com", "wordpress.com", "reddit.com", "quora.com"],
  CACHED_OR_MIRRORED: ["webcache.googleusercontent.com", "cc.bingj.com", "archive.org", "archive.ph", "archive.today", "translate.goog"],
};
const SOCIAL_HOSTS = ["facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com", "youtube.com", "tiktok.com", "linktr.ee"];
const GENERIC_NAME_TOKENS = new Set(["the", "and", "venue", "venues", "grand", "hall", "halls", "club", "barn", "hotel", "hotels", "conference", "conferences", "centre", "center", "room", "rooms", "house", "lodge", "manor", "estate", "farm", "inn", "arms", "bar", "lounge", "studio", "studios", "event", "events", "function", "functions", "park", "gardens", "garden", "court", "place", "spa", "country", "city", "town", "village", "community", "church", "theatre", "theater", "arena", "pavilion", "suite", "suites", "space", "spaces", "loft", "warehouse", "boutique", "guest", "guesthouse", "resort", "retreat", "restaurant", "cafe", "social", "sports", "golf", "cricket", "rugby", "football", "bowls", "royal", "old", "new"]);
const SECOND_LEVEL_SUFFIX = /^(?:co|org|ac|gov|net|com|ltd|plc|me|nic|web|nom|sch|police|mod|nhs)\.(?:uk|za)$/;
const FREE_MAIL_DOMAINS = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk", "live.com", "live.co.uk", "msn.com", "yahoo.com", "yahoo.co.uk", "ymail.com", "icloud.com", "me.com", "aol.com", "btinternet.com", "sky.com", "talktalk.net", "virginmedia.com", "gmx.com", "protonmail.com", "proton.me", "mweb.co.za", "telkomsa.net", "vodamail.co.za", "webmail.co.za", "iafrica.com", "absamail.co.za", "lantic.net", "polka.co.za", "afrihost.co.za", "cybersmart.co.za"]);
const PLATFORM_OR_PLACEHOLDER_EMAIL_DOMAIN = /(?:^|\.)(?:eventsuite\.[a-z.]+|prestigeid\.[a-z.]+|prestige-id\.[a-z.]+|example\.(?:com|org|net)|sentry\.io|wixpress\.com|domain\.com|email\.com|yourdomain\.[a-z.]+|yoursite\.[a-z.]+|mysite\.com|website\.com|company\.com)$/;
const NON_CONTACT_MAILBOX = /^(?:no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|abuse|webmaster|hostmaster|privacy|dpo|gdpr|dataprotection|unsubscribe|bounce[s]?)$/;
const VENUE_ROLE_MAILBOX = /^(?:info|hello|hi|contact|contactus|enquiries|enquiry|enquire|inquiries|inquiry|bookings?|book|events?|eventsteam|functions?|hire|venuehire|venue|office|reception|reservations?|hospitality|conference|conferences|conferencing|weddings?|sales|admin|manager|management|frontdesk|guests?|stay|marketing|groups?|meetings?|catering|restaurant|studio|team|mail|welcome)$/;
const EMAIL_SHAPE = /^[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

function normalise(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function hostMatches(host: string, domain: string) { return host === domain || host.endsWith(`.${domain}`); }
function isSocialUrl(value: string) {
  const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  return SOCIAL_HOSTS.some((socialHost) => host === socialHost || host.endsWith(`.${socialHost}`));
}

export function distinctiveNameTokens(name: string) {
  return normalise(name).split(/\s+/).filter((token) => token.length > 2 && !GENERIC_NAME_TOKENS.has(token));
}
export function isGenericVenueName(name: string) { return distinctiveNameTokens(name).length === 0; }

export function candidateRejection(value: string): RejectionCategory | "INVALID_URL" | null {
  let parsed: URL;
  try { parsed = new URL(value); } catch { return "INVALID_URL"; }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return "INVALID_URL";
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":") || !host.includes(".")) return "INVALID_URL";
  if (/(?:^|\.)google\.[a-z.]+$/.test(host) || host.endsWith(".googleusercontent.com") || host === "maps.app.goo.gl") return host.startsWith("webcache.") ? "CACHED_OR_MIRRORED" : "MAPS_OR_SEARCH_ENGINE";
  if (isSocialUrl(parsed.toString())) return "SOCIAL_PROFILE";
  for (const [category, domains] of Object.entries(REJECTED_HOSTS) as Array<[RejectionCategory, string[]]>) {
    if (domains.some((domain) => hostMatches(host, domain))) return category;
  }
  return null;
}

export function registrableDomain(host: string) {
  const labels = host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "").split(".");
  const tail = labels.slice(-2).join(".");
  return SECOND_LEVEL_SUFFIX.test(tail) ? labels.slice(-3).join(".") : tail;
}

type EmailVerdict = { accepted: true; email: string; relationship: typeof VENUE_EMAIL_RELATIONSHIPS[number] } | { accepted: false; reason: string };

function emailShapeVerdict(value: string): { email: string; mailbox: string; domain: string } | { reason: string } {
  const email = value.trim().toLowerCase().replace(/^mailto:/, "").split("?")[0]!;
  if (!EMAIL_SHAPE.test(email) || email.length > 254) return { reason: "INVALID_EMAIL" };
  const [mailbox, domain] = email.split("@") as [string, string];
  if (/\.(?:png|jpe?g|gif|webp|svg|css|js)$/.test(domain)) return { reason: "INVALID_EMAIL" };
  if (PLATFORM_OR_PLACEHOLDER_EMAIL_DOMAIN.test(domain)) return { reason: "PLATFORM_RELAY_OR_PLACEHOLDER" };
  if (candidateRejection(`https://${domain}/`)) return { reason: "THIRD_PARTY_PLATFORM_DOMAIN" };
  if (NON_CONTACT_MAILBOX.test(mailbox)) return { reason: "NON_CONTACT_MAILBOX" };
  return { email, mailbox, domain };
}

/**
 * Deployed extractors could split a label from a glued address ("bookings@venue" also yielding "s@venue").
 * A fragment whose full labelled form was extracted from the same page is not an address the venue published.
 */
export function isLabelSplitFragment(value: string, samePageEmails: string[]) {
  const email = value.toLowerCase();
  return samePageEmails.some((other) => other !== email && other.endsWith(email) && /^(?:email|e-mail|enquiries|bookings?)$/.test(other.slice(0, other.length - email.length)));
}

/** A held venue email must itself be venue evidence; relay, platform, and third-party platform addresses never qualify. */
export function acceptHeldVenueEmail(value: string): EmailVerdict {
  const shape = emailShapeVerdict(value);
  if ("reason" in shape) return { accepted: false, reason: shape.reason };
  return { accepted: true, email: shape.email, relationship: "HELD_VENUE_EVIDENCE" };
}

/**
 * An email published on a verified first-party site is accepted when it is on the site's own registrable
 * domain, or is a role/venue-named mailbox at a free-mail provider published by the venue itself.
 * Any other off-domain address (web designer, promoter, operator group without proof) is not accepted.
 */
export function acceptVenueEmail(value: string, verifiedSiteUrl: string, venueName: string): EmailVerdict {
  const shape = emailShapeVerdict(value);
  if ("reason" in shape) return { accepted: false, reason: shape.reason };
  if (registrableDomain(shape.domain) === registrableDomain(new URL(verifiedSiteUrl).hostname)) return { accepted: true, email: shape.email, relationship: "VERIFIED_SITE_DOMAIN" };
  if (FREE_MAIL_DOMAINS.has(shape.domain)) {
    const bare = shape.mailbox.replace(/[._-]?\d+$/, "");
    const compact = shape.mailbox.replace(/[^a-z0-9]/g, "");
    if (VENUE_ROLE_MAILBOX.test(bare) || distinctiveNameTokens(venueName).some((token) => token.length >= 4 && compact.includes(token))) {
      return { accepted: true, email: shape.email, relationship: "PUBLISHED_ON_VERIFIED_SITE" };
    }
    return { accepted: false, reason: "PERSONAL_FREE_MAIL_ADDRESS" };
  }
  return { accepted: false, reason: "OFF_DOMAIN_WITHOUT_VENUE_RELATIONSHIP" };
}
