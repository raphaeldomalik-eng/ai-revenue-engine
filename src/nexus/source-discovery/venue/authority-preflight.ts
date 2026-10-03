/**
 * Bounded official-site preflight. Establishes a safe HTTPS crawl entrypoint.
 * It does not crawl venue content, accept a new registrable domain, or write authority.
 */
import { robotsAllows } from "../crawler.ts";
import { hrefTags, selfClosingTags, tags, visibleText } from "../html.ts";
import { classifyTransportFailure, DiscoveryTimeout, NetworkRefusal } from "../network.ts";
import { assessStaticRetrieval } from "../spa.ts";
import { registrableDomain, SiteIdentity, wwwCounterpart } from "../site-identity.ts";
import { planVenueHttpsTarget, sameAuthorisedVenueSite } from "./http-authority.ts";

export const AUTHORITY_PREFLIGHT_DISPOSITIONS = [
  "HEALTHY",
  "SAFE_RECOVERY_AVAILABLE",
  "CROSS_DOMAIN_REVIEW",
  "AUTHORITY_MISMATCH",
  "ROBOTS_BLOCKED",
  "DEAD_HOST",
  "STALE_PATH_UNRECOVERED",
  "TRANSIENT_NETWORK",
  "STATIC_SHELL",
] as const;
export type AuthorityPreflightDisposition = (typeof AUTHORITY_PREFLIGHT_DISPOSITIONS)[number];

export const PREFLIGHT_USER_AGENT = "AiRevenueEngineNexusSourceDiscovery/1.0";

export type AuthorityPreflightInput = {
  candidateId: string;
  providerPlaceId: string;
  listingId: string | null;
  venueName: string;
  country: string | null;
  authorisedUrl: string;
  authorityProvenance: string;
};

export type AuthorityPreflightRow = {
  candidateId: string;
  providerPlaceId: string;
  listingId: string | null;
  venueName: string;
  country: string | null;
  authorisedUrl: string;
  authorityProvenance: string;
  initialStatus: string | null;
  initialHttpStatus: number | null;
  initialHost: string | null;
  recoveredUrl: string | null;
  recoveryMethod: string | null;
  finalHost: string | null;
  finalHttpStatus: number | null;
  robotsStatus: string | null;
  networkFailureClass: string | null;
  identityMatch: "match" | "mismatch" | "insufficient" | null;
  disposition: AuthorityPreflightDisposition;
  evidenceUrls: string[];
  notes: string;
  observedAt: string;
};

export type PreflightProbeResult = {
  status: number;
  location: string | null;
  body: string;
  contentType: string | null;
};

export type PreflightProbeFailure = {
  failure: "DEAD_HOST" | "TRANSIENT_NETWORK" | "PRIVATE_NETWORK" | "CERTIFICATE" | "OTHER";
  networkFailureClass: string;
  message: string;
};

export type PreflightProbe = (url: string) => Promise<PreflightProbeResult | PreflightProbeFailure>;

const REDIRECT = new Set([301, 302, 303, 307, 308]);
const MISSING = new Set([404, 410]);
const GENERIC_NAME = new Set([
  "the", "and", "at", "of", "for", "venue", "venues", "conference", "centre", "center", "hotel", "hall", "house",
  "estate", "lodge", "events", "event", "wedding", "weddings", "function", "functions", "gardens", "garden",
  "guest", "suite", "suites", "room", "rooms", "park", "manor", "church", "restaurant", "cafe", "resort", "inn",
]);
const HIRE_PATH = /\/(?:venue[- ]?hire|private[- ]hire|weddings?|functions?|conferences?|meetings?|event[- ]venues?)(?:\/|$)/i;

function hostOf(value: string): string {
  return new URL(value).hostname.toLowerCase();
}

function isFailure(result: object): result is PreflightProbeFailure {
  return "failure" in result && typeof (result as { failure?: unknown }).failure === "string";
}

export function classifyProbeError(error: unknown): PreflightProbeFailure {
  if (error instanceof NetworkRefusal && /private or reserved/i.test(error.message)) {
    return { failure: "PRIVATE_NETWORK", networkFailureClass: "PRIVATE_NETWORK", message: error.message };
  }
  if (error instanceof NetworkRefusal) return { failure: "OTHER", networkFailureClass: "REFUSED", message: error.message };
  const coded = error as { code?: unknown };
  const code = typeof coded.code === "string" ? coded.code : "";
  if (code === "ENOTFOUND" || code === "ENODATA" || code === "EAI_NONAME") {
    return { failure: "DEAD_HOST", networkFailureClass: "DNS", message: error instanceof Error ? error.message : "DNS failure" };
  }
  if (code === "ECONNREFUSED" || code === "EHOSTUNREACH" || code === "ENETUNREACH") {
    return { failure: "DEAD_HOST", networkFailureClass: "CONNECTION_REFUSED", message: error instanceof Error ? error.message : "unreachable" };
  }
  const transport = classifyTransportFailure(error);
  if (transport === "CERTIFICATE") return { failure: "CERTIFICATE", networkFailureClass: "CERTIFICATE", message: error instanceof Error ? error.message : "certificate" };
  if (transport === "TRANSIENT" || error instanceof DiscoveryTimeout) {
    return { failure: "TRANSIENT_NETWORK", networkFailureClass: error instanceof DiscoveryTimeout ? "TIMEOUT" : "TRANSIENT", message: error instanceof Error ? error.message : "transient" };
  }
  return { failure: "OTHER", networkFailureClass: code || "OTHER", message: error instanceof Error ? error.message : "request failed" };
}

function tokens(value: string): string[] {
  return value.toLowerCase().replace(/&amp;/g, " and ").split(/[^a-z0-9]+/).filter((token) => token.length >= 4 && !GENERIC_NAME.has(token));
}

function stem(token: string): string {
  return token.endsWith("s") && token.length > 4 ? token.slice(0, -1) : token;
}

function containsToken(haystack: string, token: string): boolean {
  const wanted = stem(token);
  return tokens(haystack).some((item) => stem(item) === wanted);
}

/** Lightweight subject check. Exact title equality is not required. A different organisation is a mismatch. */
export function classifyAuthorityIdentity(venueName: string, html: string): "match" | "mismatch" | "insufficient" {
  const title = tags(html, "title")[0]?.inner ?? "";
  const h1 = tags(html, "h1").map((tag) => visibleText(tag.inner)).join(" ");
  const siteName = selfClosingTags(html, "meta").find((tag) => tag.attrs.property === "og:site_name" || tag.attrs.name === "og:site_name")?.attrs.content ?? "";
  const schemaNames: string[] = [];
  for (const script of tags(html, "script")) {
    if (!/ld\+json/i.test(script.attrs.type ?? "")) continue;
    for (const match of script.inner.matchAll(/"name"\s*:\s*"([^"\\]{2,160})"/g)) schemaNames.push(match[1] ?? "");
  }
  const brand = [schemaNames[0] ?? "", siteName, title.split(/[|\-–—]/)[0] ?? ""].map((item) => item.trim()).find((item) => tokens(item).length > 0) ?? "";
  const identityText = `${title} ${h1} ${siteName} ${schemaNames.join(" ")}`;
  const venueTokens = tokens(venueName);
  if (!venueTokens.length || visibleText(identityText).length < 3) return "insufficient";
  if (/^(home|welcome|untitled|loading)$/i.test(brand.trim())) return "insufficient";
  const pageText = `${identityText} ${visibleText(html)}`;
  const foldedPage = pageText.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (venueName.includes("@")) {
    const ownName = (venueName.split("@")[0] ?? "").replace(/^\s*the\s+/i, "").trim();
    const ownTokens = tokens(ownName);
    const foldedOwn = ownName.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (ownTokens.length >= 2) return foldedOwn.length >= 6 && foldedPage.includes(foldedOwn) ? "match" : "mismatch";
  }
  if (venueTokens.some((token) => containsToken(pageText, token))) return "match";
  const foldedVenue = venueName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (foldedVenue.length >= 8 && foldedPage.includes(foldedVenue)) return "match";
  return "mismatch";
}

function absoluteHttpUrl(location: string, base: string): string | null {
  try {
    const url = new URL(location, base);
    url.hash = "";
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function hireCandidate(html: string, pageUrl: string, authorisedUrl: string): string | null {
  for (const tag of hrefTags(html)) {
    const href = tag.attrs.href;
    if (!href) continue;
    const absolute = absoluteHttpUrl(href, pageUrl);
    if (!absolute || !HIRE_PATH.test(new URL(absolute).pathname)) continue;
    const planned = planVenueHttpsTarget(absolute);
    if (!planned.crawlUrl || !sameAuthorisedVenueSite(authorisedUrl, planned.crawlUrl)) continue;
    if (new URL(planned.crawlUrl).pathname === new URL(pageUrl).pathname) continue;
    return planned.crawlUrl;
  }
  return null;
}

function canonicalCandidate(html: string, pageUrl: string, authorisedUrl: string): string | null {
  const links = [...selfClosingTags(html, "link"), ...tags(html, "link").map((item) => ({ attrs: item.attrs }))];
  for (const tag of links) {
    if (!/\bcanonical\b/i.test(tag.attrs.rel ?? "")) continue;
    const absolute = tag.attrs.href ? absoluteHttpUrl(tag.attrs.href, pageUrl) : null;
    if (!absolute) continue;
    const planned = planVenueHttpsTarget(absolute);
    if (!planned.crawlUrl || !sameAuthorisedVenueSite(authorisedUrl, planned.crawlUrl)) continue;
    if (new URL(planned.crawlUrl).href === new URL(pageUrl).href) continue;
    return planned.crawlUrl;
  }
  return null;
}

function softMissing(status: number, body: string, url: string): boolean {
  if (MISSING.has(status)) return true;
  if (status < 200 || status >= 300) return false;
  if (new URL(url).pathname === "/") return false;
  const title = visibleText(tags(body, "title")[0]?.inner ?? "");
  return /^(404\b|page not found\b|not found\b)/i.test(title);
}

type Walk = {
  status: number;
  url: string;
  body: string;
  chain: string[];
  crossDomain: { from: string; to: string } | null;
  downgrade: boolean;
  refusedReason: string | null;
};

export async function preflightAuthorisedVenue(input: AuthorityPreflightInput, probe: PreflightProbe, observedAt: string): Promise<AuthorityPreflightRow> {
  const evidenceUrls: string[] = [];
  const base = {
    candidateId: input.candidateId,
    providerPlaceId: input.providerPlaceId,
    listingId: input.listingId,
    venueName: input.venueName,
    country: input.country,
    authorisedUrl: input.authorisedUrl,
    authorityProvenance: input.authorityProvenance,
    initialStatus: null as string | null,
    initialHttpStatus: null as number | null,
    initialHost: null as string | null,
    recoveredUrl: null as string | null,
    recoveryMethod: null as string | null,
    finalHost: null as string | null,
    finalHttpStatus: null as number | null,
    robotsStatus: null as string | null,
    networkFailureClass: null as string | null,
    identityMatch: null as AuthorityPreflightRow["identityMatch"],
    evidenceUrls,
    notes: "",
    observedAt,
  };
  const finish = (disposition: AuthorityPreflightDisposition, notes: string, extra: Partial<AuthorityPreflightRow> = {}): AuthorityPreflightRow => ({
    ...base, ...extra, evidenceUrls, disposition, notes,
  });

  const plan = planVenueHttpsTarget(input.authorisedUrl);
  if (!plan.crawlUrl) {
    const refusal = plan.refusal ?? "UNPARSEABLE_AUTHORITY";
    const privateHost = refusal === "NON_PUBLIC_HOST" || refusal === "NON_PUBLIC_HTTPS";
    return finish(privateHost ? "DEAD_HOST" : "STALE_PATH_UNRECOVERED", refusal, {
      networkFailureClass: privateHost ? "PRIVATE_NETWORK" : refusal,
    });
  }
  try { base.initialHost = hostOf(input.authorisedUrl); } catch { base.initialHost = null; }
  const crawlUrl = plan.crawlUrl;
  const identity = new SiteIdentity(crawlUrl);
  const walk = async (start: string): Promise<Walk | PreflightProbeFailure> => {
    let current = start;
    const chain: string[] = [];
    for (let hop = 0; hop < 5; hop += 1) {
      if (!evidenceUrls.includes(current)) evidenceUrls.push(current);
      const result = await probe(current);
      if (isFailure(result)) return result;
      chain.push(`${result.status} ${current}`);
      if (!REDIRECT.has(result.status)) {
        return { status: result.status, url: current, body: result.body, chain, crossDomain: null, downgrade: false, refusedReason: null };
      }
      const next = result.location ? absoluteHttpUrl(result.location, current) : null;
      if (!next) return { status: result.status, url: current, body: "", chain, crossDomain: null, downgrade: false, refusedReason: "MISSING_LOCATION" };
      if (new URL(next).protocol === "http:") {
        const upgraded = planVenueHttpsTarget(next).crawlUrl;
        const same = Boolean(upgraded && sameAuthorisedVenueSite(crawlUrl, upgraded));
        if (new URL(current).protocol === "https:" || !same || !upgraded) {
          return {
            status: result.status, url: current, body: "", chain,
            crossDomain: same ? null : { from: hostOf(crawlUrl), to: hostOf(next) },
            downgrade: new URL(current).protocol === "https:" || new URL(next).protocol === "http:",
            refusedReason: new URL(current).protocol === "https:" ? "HTTPS_DOWNGRADE" : "CROSS_SITE",
          };
        }
        current = upgraded;
        continue;
      }
      const decision = identity.decideRedirect(current.startsWith("https:") ? current : crawlUrl, next, result.status, hop === 0 ? "ENTRY" : "PAGE");
      if (!decision.next) {
        const targetHost = hostOf(next);
        const fromHost = hostOf(current.startsWith("https:") ? current : crawlUrl);
        if (wwwCounterpart(fromHost) === targetHost || wwwCounterpart(hostOf(crawlUrl)) === targetHost) {
          current = new URL(next).toString();
          continue;
        }
        const cross = registrableDomain(targetHost) !== registrableDomain(hostOf(crawlUrl));
        return {
          status: result.status, url: current, body: "", chain,
          crossDomain: cross ? { from: hostOf(crawlUrl), to: targetHost } : null,
          downgrade: decision.reason === "HTTPS_DOWNGRADE",
          refusedReason: decision.reason,
        };
      }
      current = decision.next;
    }
    return { failure: "OTHER", networkFailureClass: "REDIRECT_LIMIT", message: "Redirect budget exhausted." };
  };

  const failureRow = (failure: PreflightProbeFailure): AuthorityPreflightRow => {
    const disposition: AuthorityPreflightDisposition = failure.failure === "DEAD_HOST" || failure.failure === "PRIVATE_NETWORK"
      ? "DEAD_HOST"
      : failure.failure === "CERTIFICATE" ? "STALE_PATH_UNRECOVERED" : "TRANSIENT_NETWORK";
    return finish(disposition, failure.message, { networkFailureClass: failure.networkFailureClass, initialStatus: "ERROR" });
  };

  let initial = await walk(input.authorisedUrl);
  if (isFailure(initial) && plan.upgradedFromHttp) {
    const upgraded = await walk(crawlUrl);
    if (!isFailure(upgraded)) initial = upgraded;
  }
  if (isFailure(initial)) return failureRow(initial);

  base.initialHttpStatus = initial.status;
  base.initialStatus = REDIRECT.has(initial.status) ? "REDIRECT" : MISSING.has(initial.status) ? "MISSING" : initial.status >= 200 && initial.status < 300 ? "OK" : `HTTP_${initial.status}`;
  let page = initial;
  if (plan.upgradedFromHttp && !page.url.startsWith("https:")) {
    const upgraded = await walk(crawlUrl);
    if (isFailure(upgraded)) return failureRow(upgraded);
    page = upgraded;
  }
  if (page.crossDomain) {
    return finish("CROSS_DOMAIN_REVIEW", `Redirect leaves ${page.crossDomain.from} for ${page.crossDomain.to}. A redirect does not transfer official-site authority. Chain: ${page.chain.join(" | ")}`, {
      initialStatus: "REDIRECT", finalHost: page.crossDomain.to, finalHttpStatus: page.status,
    });
  }
  if (page.downgrade || page.refusedReason) {
    return finish("STALE_PATH_UNRECOVERED", `${page.refusedReason ?? "REDIRECT_REFUSED"}. Chain: ${page.chain.join(" | ")}`, { finalHttpStatus: page.status });
  }

  const usable = (landed: Walk | PreflightProbeFailure): landed is Walk => !isFailure(landed)
    && !landed.crossDomain && !landed.downgrade && !landed.refusedReason
    && landed.status >= 200 && landed.status < 300 && !softMissing(landed.status, landed.body, landed.url);

  const robotsFor = async (pageUrl: string): Promise<{ blocked: boolean; unavailable: boolean; status: string; note: string }> => {
    const robotsUrl = new URL("/robots.txt", pageUrl).toString();
    if (!evidenceUrls.includes(robotsUrl)) evidenceUrls.push(robotsUrl);
    const result = await probe(robotsUrl);
    if (isFailure(result)) return { blocked: false, unavailable: true, status: "UNAVAILABLE", note: result.message };
    if (result.status === 404 || result.status === 410) return { blocked: false, unavailable: false, status: "ABSENT", note: "" };
    if (result.status === 401 || result.status === 403) return { blocked: true, unavailable: false, status: "DENIED", note: `robots.txt HTTP ${result.status}` };
    if (result.status >= 500 || result.status === 429) return { blocked: false, unavailable: true, status: "UNAVAILABLE", note: `robots.txt HTTP ${result.status}` };
    if (result.status < 200 || result.status >= 300) return { blocked: true, unavailable: false, status: "DENIED", note: `robots.txt HTTP ${result.status}` };
    const allowed = robotsAllows(result.body, pageUrl, PREFLIGHT_USER_AGENT);
    return { blocked: !allowed, unavailable: false, status: allowed ? "ALLOWED" : "DENIED", note: allowed ? "" : "robots.txt disallows the crawler" };
  };

  const classifyPage = async (landed: Walk, recoveryMethod: string | null): Promise<AuthorityPreflightRow> => {
    const finalHost = hostOf(landed.url);
    const robots = await robotsFor(landed.url);
    const method = recoveryMethod ?? (plan.upgradedFromHttp ? "http_to_https" : hostOf(crawlUrl) !== finalHost ? "apex_www" : null);
    if (robots.unavailable) {
      return finish("TRANSIENT_NETWORK", `robots.txt could not be checked. Authority is unchanged. ${robots.note}`, {
        networkFailureClass: "ROBOTS_UNAVAILABLE", finalHost, finalHttpStatus: landed.status, robotsStatus: "UNAVAILABLE",
        recoveredUrl: method ? landed.url : null, recoveryMethod: method,
      });
    }
    if (robots.blocked) {
      return finish("ROBOTS_BLOCKED", `Crawl policy blocks ${finalHost}. Authority is unchanged. ${robots.note}`, {
        finalHost, finalHttpStatus: landed.status, robotsStatus: robots.status,
        recoveredUrl: method ? landed.url : null, recoveryMethod: method,
      });
    }
    const identityMatch = classifyAuthorityIdentity(input.venueName, landed.body);
    if (identityMatch === "mismatch") {
      return finish("AUTHORITY_MISMATCH", `Reachable page does not identify ${input.venueName}. Chain: ${landed.chain.join(" | ")}`, {
        finalHost, finalHttpStatus: landed.status, robotsStatus: robots.status, identityMatch,
      });
    }
    const shell = assessStaticRetrieval(landed.body).shell;
    const disposition: AuthorityPreflightDisposition = shell ? "STATIC_SHELL" : method ? "SAFE_RECOVERY_AVAILABLE" : "HEALTHY";
    return finish(disposition, landed.chain.join(" | "), {
      finalHost, finalHttpStatus: landed.status, robotsStatus: robots.status, identityMatch,
      recoveredUrl: method ? landed.url : null, recoveryMethod: shell ? method : method,
    });
  };

  if (page.status >= 500 || page.status === 429) {
    return finish("TRANSIENT_NETWORK", `HTTP ${page.status}. Chain: ${page.chain.join(" | ")}`, {
      networkFailureClass: "HTTP_5XX", finalHost: hostOf(page.url), finalHttpStatus: page.status,
    });
  }
  if (page.status === 401 || page.status === 403) {
    return finish("ROBOTS_BLOCKED", `HTTP ${page.status} refuses the crawler. Authority is unchanged.`, {
      finalHost: hostOf(page.url), finalHttpStatus: page.status, robotsStatus: `HTTP_${page.status}`,
    });
  }

  if (softMissing(page.status, page.body, page.url)) {
    const stored = new URL(crawlUrl);
    const counterpart = new URL(crawlUrl);
    counterpart.hostname = stored.hostname.startsWith("www.") ? stored.hostname.slice(4) : `www.${stored.hostname}`;
    const counterpartPage = await walk(counterpart.toString());
    if (usable(counterpartPage)) return classifyPage(counterpartPage, "apex_www");
    if (stored.pathname !== "/") {
      const home = await walk(new URL("/", crawlUrl).toString());
      if (usable(home)) {
        const next = canonicalCandidate(home.body, home.url, input.authorisedUrl) ?? hireCandidate(home.body, home.url, input.authorisedUrl);
        if (next) {
          const specific = await walk(next);
          if (usable(specific)) return classifyPage(specific, "same_site_venue_path");
        }
        return classifyPage(home, "same_site_homepage");
      }
    }
    return finish("STALE_PATH_UNRECOVERED", `Stored path is missing and no same-site replacement was established. Chain: ${page.chain.join(" | ")}`, {
      finalHost: hostOf(page.url), finalHttpStatus: page.status,
    });
  }

  if (page.status >= 200 && page.status < 300) return classifyPage(page, null);
  return finish("TRANSIENT_NETWORK", `Unexpected HTTP ${page.status}`, {
    networkFailureClass: "OTHER", finalHost: hostOf(page.url), finalHttpStatus: page.status,
  });
}
