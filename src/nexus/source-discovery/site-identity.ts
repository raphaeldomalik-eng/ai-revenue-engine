import { canonicalHttpsUrl } from "./network.ts";

// Shared hosting platforms where sibling subdomains belong to unrelated operators.
const PLATFORM_SUFFIXES = new Set([
  "github.io", "gitlab.io", "wixsite.com", "wix.com", "squarespace.com", "wordpress.com", "blogspot.com", "weebly.com",
  "webflow.io", "netlify.app", "vercel.app", "pages.dev", "workers.dev", "herokuapp.com", "azurewebsites.net",
  "cloudfront.net", "appspot.com", "firebaseapp.com", "web.app", "myshopify.com", "carrd.co", "godaddysites.com",
  "jimdosite.com", "site123.me", "strikingly.com", "tumblr.com", "ueniweb.com", "business.site", "square.site",
  "eventbrite.com", "eventbrite.co.uk", "hubspotpagebuilder.com", "framer.website", "notion.site",
]);
const GENERIC_SECOND_LEVEL = new Set([
  "co", "com", "net", "org", "ac", "gov", "edu", "ltd", "plc", "me", "sch", "nhs", "police", "mod", "nic", "or",
  "ne", "gr", "lg", "ad", "go", "mil", "gob", "nom", "info", "biz", "asn", "id", "judiciary",
]);

function hostOf(value: string): string {
  return new URL(value).hostname.toLowerCase().replace(/\.$/, "");
}

export function registrableDomain(host: string): string | null {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  if (labels.length < 2) return null;
  for (let size = 3; size >= 2; size -= 1) {
    const suffix = labels.slice(-size).join(".");
    if (PLATFORM_SUFFIXES.has(suffix)) return labels.length > size ? labels.slice(-(size + 1)).join(".") : null;
  }
  const tld = labels[labels.length - 1]!;
  const second = labels[labels.length - 2]!;
  if (tld.length === 2 && GENERIC_SECOND_LEVEL.has(second)) return labels.length >= 3 ? labels.slice(-3).join(".") : null;
  return labels.slice(-2).join(".");
}

export function wwwCounterpart(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : `www.${host}`;
}

export type OriginGrant = "VERIFIED" | "CANONICAL_REDIRECT" | "LINKED_FIRST_PARTY_SUBDOMAIN";
export type RedirectHop = { from: string; to: string; status: number; decision: "FOLLOWED" | "REFUSED"; reason: string };

export class SiteIdentity {
  readonly verifiedUrl: string;
  readonly verifiedHost: string;
  readonly registrable: string | null;
  canonicalOrigin: string;
  readonly grants = new Map<string, OriginGrant>();
  readonly redirectChain: RedirectHop[] = [];
  readonly maxSubdomains: number;

  constructor(verifiedUrl: string, maxSubdomains = 2) {
    this.verifiedUrl = verifiedUrl;
    this.verifiedHost = hostOf(verifiedUrl);
    this.registrable = registrableDomain(this.verifiedHost);
    this.canonicalOrigin = new URL(verifiedUrl).origin;
    this.maxSubdomains = maxSubdomains;
    this.grants.set(this.canonicalOrigin, "VERIFIED");
  }

  isAllowedOrigin(origin: string): boolean {
    return this.grants.has(origin);
  }

  private isWwwPair(a: string, b: string) {
    return a !== b && wwwCounterpart(a) === b;
  }

  /** Apex↔www of the verified host is the same site; the host that the entry page settles on becomes canonical. */
  sameSiteHost(host: string): boolean {
    return host === this.verifiedHost || this.isWwwPair(host, this.verifiedHost);
  }

  /** Rewrites apex/www links to the canonical origin so one site is never crawled twice under two hosts. */
  canonicalize(value: string, base: string): string | null {
    const normalized = canonicalHttpsUrl(value, base);
    if (!normalized) return null;
    const url = new URL(normalized);
    const canonical = new URL(this.canonicalOrigin);
    if (url.origin !== this.canonicalOrigin && this.sameSiteHost(url.hostname.toLowerCase()) && this.sameSiteHost(canonical.hostname) && url.port === canonical.port) {
      url.hostname = canonical.hostname;
    }
    return url.toString();
  }

  /**
   * Redirect policy: never downgrade, never leave the verified site. The entry page may settle on the www/apex
   * counterpart (which becomes canonical); any later hop must stay on an already granted origin.
   */
  decideRedirect(from: string, location: string | null, status: number, mode: "ENTRY" | "ROBOTS" | "PAGE"): { next: string | null; reason: string } {
    if (!location) return this.refuse(from, "(missing)", status, "MISSING_LOCATION");
    let raw: URL;
    try { raw = new URL(location, from); } catch { return this.refuse(from, location, status, "INVALID_LOCATION"); }
    if (raw.protocol !== "https:") return this.refuse(from, raw.toString(), status, raw.protocol === "http:" ? "HTTPS_DOWNGRADE" : "NON_HTTPS_SCHEME");
    const next = canonicalHttpsUrl(raw.toString());
    if (!next) return this.refuse(from, raw.toString(), status, "NON_PUBLIC_TARGET");
    const target = new URL(next);
    if (mode === "ROBOTS" && target.origin === new URL(from).origin) return this.follow(from, next, status, "SAME_ORIGIN");
    if (mode !== "ROBOTS" && this.grants.has(target.origin)) return this.follow(from, next, status, "GRANTED_ORIGIN");
    const host = target.hostname.toLowerCase();
    const sameSite = this.sameSiteHost(host) && this.sameSiteHost(new URL(from).hostname.toLowerCase()) && target.port === new URL(from).port;
    if (mode === "ROBOTS" && sameSite) return this.follow(from, next, status, "ROBOTS_WWW_APEX");
    if (mode === "ENTRY" && sameSite) {
      this.grants.set(target.origin, "CANONICAL_REDIRECT");
      this.canonicalOrigin = target.origin;
      return this.follow(from, next, status, "WWW_APEX_CANONICAL");
    }
    return this.refuse(from, next, status, registrableDomain(host) === this.registrable && this.registrable ? "UNEVIDENCED_SUBDOMAIN" : "CROSS_SITE");
  }

  /** A sibling subdomain is admitted only when a first-party page links to it and it shares the registrable domain. */
  admitLinkedSubdomain(candidate: string, linkedFrom: string): boolean {
    const url = new URL(candidate);
    if (this.grants.has(url.origin)) return true;
    if (!this.grants.has(new URL(linkedFrom).origin)) return false;
    const host = url.hostname.toLowerCase();
    if (!this.registrable || registrableDomain(host) !== this.registrable || url.port) return false;
    if ([...this.grants.values()].filter((grant) => grant === "LINKED_FIRST_PARTY_SUBDOMAIN").length >= this.maxSubdomains) return false;
    this.grants.set(url.origin, "LINKED_FIRST_PARTY_SUBDOMAIN");
    return true;
  }

  private follow(from: string, to: string, status: number, reason: string) {
    this.redirectChain.push({ from, to, status, decision: "FOLLOWED", reason });
    return { next: to, reason };
  }

  private refuse(from: string, to: string, status: number, reason: string) {
    this.redirectChain.push({ from, to, status, decision: "REFUSED", reason });
    return { next: null, reason };
  }

  grantedOrigins(): Array<{ origin: string; grant: OriginGrant }> {
    return [...this.grants.entries()].map(([origin, grant]) => ({ origin, grant }));
  }
}
