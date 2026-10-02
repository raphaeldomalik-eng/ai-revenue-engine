import { isPublicHttpsUrl } from "../network.ts";
import { registrableDomain, wwwCounterpart } from "../site-identity.ts";

/**
 * EventSuite stores crawl-ready official sites as either HTTP or HTTPS.
 * The shared transport fetches public HTTPS only. This plans a same-host
 * HTTPS target and refuses anything that is not that authorised site.
 */
export type VenueAuthorityPlan = {
  authorisedUrl: string;
  crawlUrl: string | null;
  upgradedFromHttp: boolean;
  refusal: string | null;
};

const PRIVATE_HOST = /^(?:localhost|.*\.(?:localhost|local|internal|onion))$/i;

function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

export function planVenueHttpsTarget(authorisedUrl: string): VenueAuthorityPlan {
  let parsed: URL;
  try {
    parsed = new URL(authorisedUrl.trim());
  } catch {
    return { authorisedUrl, crawlUrl: null, upgradedFromHttp: false, refusal: "UNPARSEABLE_AUTHORITY" };
  }
  parsed.hash = "";
  if (parsed.username || parsed.password) {
    return { authorisedUrl: parsed.toString(), crawlUrl: null, upgradedFromHttp: false, refusal: "CREDENTIALS_IN_AUTHORITY" };
  }
  const host = bareHost(parsed.hostname);
  if (!host || PRIVATE_HOST.test(parsed.hostname) || PRIVATE_HOST.test(host)) {
    return { authorisedUrl: parsed.toString(), crawlUrl: null, upgradedFromHttp: false, refusal: "NON_PUBLIC_HOST" };
  }
  if (parsed.protocol === "https:") {
    const crawlUrl = isPublicHttpsUrl(parsed.toString()) ? parsed.toString() : null;
    return { authorisedUrl: parsed.toString(), crawlUrl, upgradedFromHttp: false, refusal: crawlUrl ? null : "NON_PUBLIC_HTTPS" };
  }
  if (parsed.protocol !== "http:") {
    return { authorisedUrl: parsed.toString(), crawlUrl: null, upgradedFromHttp: false, refusal: "UNSUPPORTED_SCHEME" };
  }
  parsed.protocol = "https:";
  const crawlUrl = isPublicHttpsUrl(parsed.toString()) ? parsed.toString() : null;
  return {
    authorisedUrl: authorisedUrl.trim(),
    crawlUrl,
    upgradedFromHttp: Boolean(crawlUrl),
    refusal: crawlUrl ? null : "HTTPS_UPGRADE_REFUSED",
  };
}

/** Apex and www of the authorised host are the same venue site. Any other registrable domain is not. */
export function sameAuthorisedVenueSite(authorisedUrl: string, finalUrl: string): boolean {
  let authorised: URL;
  let final: URL;
  try {
    authorised = new URL(authorisedUrl);
    final = new URL(finalUrl);
  } catch {
    return false;
  }
  if (final.protocol !== "https:") return false;
  const left = authorised.hostname.toLowerCase();
  const right = final.hostname.toLowerCase();
  if (left === right || wwwCounterpart(left) === right) return true;
  const domain = registrableDomain(left);
  return Boolean(domain) && domain === registrableDomain(right) && (left === `www.${domain}` || left === domain || right === `www.${domain}` || right === domain);
}
