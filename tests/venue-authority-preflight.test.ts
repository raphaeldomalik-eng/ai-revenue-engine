import assert from "node:assert/strict";
import test from "node:test";
import { DiscoveryTimeout, NetworkRefusal } from "../src/nexus/source-discovery/network.ts";
import { resolveOfficialSiteAuthority } from "../src/nexus/source-discovery/venue/authority-contract.ts";
import {
  classifyAuthorityIdentity,
  classifyProbeError,
  preflightAuthorisedVenue,
  type AuthorityPreflightInput,
  type PreflightProbe,
  type PreflightProbeResult,
} from "../src/nexus/source-discovery/venue/authority-preflight.ts";

const observedAt = "2026-10-03T00:00:00.000Z";

function input(over: Partial<AuthorityPreflightInput> = {}): AuthorityPreflightInput {
  return {
    candidateId: "candidate-1",
    providerPlaceId: "place-1",
    listingId: "listing-1",
    venueName: "Harbour House",
    country: "ZA",
    authorisedUrl: "https://venue.example/",
    authorityProvenance: "resources_listing_official_website",
    ...over,
  };
}

function page(title: string, extra = ""): string {
  return `<title>${title}</title><h1>${title}</h1><p>${"A working conference and wedding hall with a clear public page. ".repeat(12)}</p>${extra}`;
}

function probe(routes: Record<string, Partial<PreflightProbeResult> | { failure: "DEAD_HOST" | "TRANSIENT_NETWORK" | "PRIVATE_NETWORK" | "CERTIFICATE" | "OTHER"; networkFailureClass: string; message: string }>): PreflightProbe {
  return async (url) => {
    const found = routes[url];
    if (found && "failure" in found) return found;
    if (!found && url.endsWith("/robots.txt")) return { status: 404, location: null, body: "", contentType: "text/plain" };
    if (!found) return { status: 404, location: null, body: "missing", contentType: "text/html" };
    return { status: 200, location: null, body: page("Harbour House"), contentType: "text/html", ...found };
  };
}

test("official listing website wins and an unresolved place identity is not ready", () => {
  const ready = resolveOfficialSiteAuthority({
    providerPlaceId: "place-1", classificationStatus: "event_venue", candidateStatus: "promoted",
    listingId: "listing-1", listingPlaceId: "place-1", promotedPlaceIds: ["place-1"],
    listingPublicWebsite: "https://www.harbour.example/hire",
    googleWebsiteUri: "https://other.example/",
  });
  assert.equal(ready.status, "READY");
  assert.equal(ready.url, "https://www.harbour.example/hire");
  assert.equal(ready.provenance, "resources_listing_official_website");
  const ambiguous = resolveOfficialSiteAuthority({
    providerPlaceId: "place-1", classificationStatus: "event_venue", candidateStatus: "promoted",
    listingId: "listing-1", listingPlaceId: null, promotedPlaceIds: ["place-1", "place-2"],
    listingPublicWebsite: "https://harbour.example/",
  });
  assert.equal(ambiguous.status, "AMBIGUOUS_OR_CONFLICTING");
  assert.equal(ambiguous.url, null);
});

test("healthy HTTPS stays the crawl entrypoint", async () => {
  const row = await preflightAuthorisedVenue(input(), probe({ "https://venue.example/": { body: page("Harbour House") } }), observedAt);
  assert.equal(row.disposition, "HEALTHY");
  assert.equal(row.recoveredUrl, null);
  assert.equal(row.finalHost, "venue.example");
  assert.equal(row.robotsStatus, "ABSENT");
});

test("HTTP authority can settle on the apex host after the www upgrade", async () => {
  const row = await preflightAuthorisedVenue(input({
    authorisedUrl: "http://www.countrysjiek.co.za/",
    venueName: "Country Sjiek",
  }), probe({
    "http://www.countrysjiek.co.za/": { status: 301, location: "https://www.countrysjiek.co.za/", body: "" },
    "https://www.countrysjiek.co.za/": { status: 301, location: "https://countrysjiek.co.za/", body: "" },
    "https://countrysjiek.co.za/": { body: page("Country Sjiek") },
  }), observedAt);
  assert.equal(row.disposition, "SAFE_RECOVERY_AVAILABLE");
  assert.equal(row.recoveryMethod, "http_to_https");
  assert.equal(row.recoveredUrl, "https://countrysjiek.co.za/");
});

test("stored HTTP upgrades to HTTPS on the same site", async () => {
  const row = await preflightAuthorisedVenue(input({ authorisedUrl: "http://venue.example/weddings" }), probe({
    "http://venue.example/weddings": { status: 200, body: page("Harbour House") },
    "https://venue.example/weddings": { body: page("Harbour House") },
  }), observedAt);
  assert.equal(row.disposition, "SAFE_RECOVERY_AVAILABLE");
  assert.equal(row.recoveryMethod, "http_to_https");
  assert.equal(row.recoveredUrl, "https://venue.example/weddings");
});

test("apex to www is a same-site recovery", async () => {
  const row = await preflightAuthorisedVenue(input({ authorisedUrl: "https://venue.example/" }), probe({
    "https://venue.example/": { status: 301, location: "https://www.venue.example/", body: "" },
    "https://www.venue.example/": { body: page("Harbour House") },
  }), observedAt);
  assert.equal(row.disposition, "SAFE_RECOVERY_AVAILABLE");
  assert.equal(row.recoveryMethod, "apex_www");
  assert.equal(row.recoveredUrl, "https://www.venue.example/");
});

test("an allowed same-site path redirect remains healthy", async () => {
  const row = await preflightAuthorisedVenue(input({ authorisedUrl: "https://venue.example/old" }), probe({
    "https://venue.example/old": { status: 301, location: "https://venue.example/hire", body: "" },
    "https://venue.example/hire": { body: page("Harbour House") },
  }), observedAt);
  assert.equal(row.disposition, "HEALTHY");
  assert.equal(row.recoveredUrl, null);
  assert.equal(row.finalHost, "venue.example");
});

test("a stale deep URL recovers to the same-site homepage", async () => {
  const row = await preflightAuthorisedVenue(input({ authorisedUrl: "https://ssisa.com/venue-hire/", venueName: "SSISA Conference Centre" }), probe({
    "https://ssisa.com/venue-hire/": { status: 404, body: "missing" },
    "https://ssisa.com/": { body: page("SSISA Conference Centre") },
  }), observedAt);
  assert.equal(row.disposition, "SAFE_RECOVERY_AVAILABLE");
  assert.equal(row.recoveryMethod, "same_site_homepage");
  assert.equal(row.recoveredUrl, "https://ssisa.com/");
});

test("a stale deep URL recovers to an obvious same-site venue page", async () => {
  const row = await preflightAuthorisedVenue(input({ authorisedUrl: "https://ssisa.com/old-hire/", venueName: "SSISA Conference Centre" }), probe({
    "https://ssisa.com/old-hire/": { status: 404, body: "missing" },
    "https://ssisa.com/": { body: `${page("SSISA Conference Centre")}<a href="/weddings/">Weddings</a>` },
    "https://ssisa.com/weddings/": { body: page("SSISA Conference Centre weddings") },
  }), observedAt);
  assert.equal(row.disposition, "SAFE_RECOVERY_AVAILABLE");
  assert.equal(row.recoveryMethod, "same_site_venue_path");
  assert.equal(row.recoveredUrl, "https://ssisa.com/weddings/");
});

test("a cross-domain redirect stays in review", async () => {
  const row = await preflightAuthorisedVenue(input({ authorisedUrl: "https://prinschurch.co.za/", venueName: "Prinschurch" }), probe({
    "https://prinschurch.co.za/": { status: 301, location: "https://cityproperty.co.za/", body: "" },
  }), observedAt);
  assert.equal(row.disposition, "CROSS_DOMAIN_REVIEW");
  assert.equal(row.recoveredUrl, null);
  assert.equal(row.finalHost, "cityproperty.co.za");
  assert.equal(row.evidenceUrls.includes("https://cityproperty.co.za/"), false);
});

test("robots denial blocks the crawl and keeps the authority", async () => {
  const row = await preflightAuthorisedVenue(input({ authorisedUrl: "https://alexandrapalace.com/", venueName: "Alexandra Palace" }), probe({
    "https://alexandrapalace.com/": { body: page("Alexandra Palace") },
    "https://alexandrapalace.com/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /\n", contentType: "text/plain" },
  }), observedAt);
  assert.equal(row.disposition, "ROBOTS_BLOCKED");
  assert.equal(row.robotsStatus, "DENIED");
  assert.equal(row.recoveredUrl, null);
});

test("DNS failure is a dead host", async () => {
  const row = await preflightAuthorisedVenue(input({ authorisedUrl: "https://theempirevenue.co.za/" }), probe({
    "https://theempirevenue.co.za/": { failure: "DEAD_HOST", networkFailureClass: "DNS", message: "ENOTFOUND" },
  }), observedAt);
  assert.equal(row.disposition, "DEAD_HOST");
  assert.equal(row.networkFailureClass, "DNS");
});

test("a timeout stays transient", async () => {
  const row = await preflightAuthorisedVenue(input(), probe({
    "https://venue.example/": { failure: "TRANSIENT_NETWORK", networkFailureClass: "TIMEOUT", message: "timeout" },
  }), observedAt);
  assert.equal(row.disposition, "TRANSIENT_NETWORK");
  assert.equal(row.networkFailureClass, "TIMEOUT");
});

test("a missing path with no same-site replacement stays unresolved", async () => {
  const row = await preflightAuthorisedVenue(input({ authorisedUrl: "https://venue.example/gone" }), probe({
    "https://venue.example/gone": { status: 404, body: "missing" },
    "https://venue.example/": { status: 404, body: "missing" },
  }), observedAt);
  assert.equal(row.disposition, "STALE_PATH_UNRECOVERED");
  assert.equal(row.recoveredUrl, null);
});

test("a client-rendered shell remains valid authority", async () => {
  const row = await preflightAuthorisedVenue(input({ venueName: "Pavilion Conference Centre", authorisedUrl: "https://pavilion.example/" }), probe({
    "https://pavilion.example/": { body: `<title>Pavilion Conference Centre</title><div id="__next"></div><script id="__NEXT_DATA__">{}</script>` },
  }), observedAt);
  assert.equal(row.disposition, "STATIC_SHELL");
  assert.equal(row.identityMatch, "match");
});

test("a reachable nursery page is not Rose Shed authority", async () => {
  const html = `<title>Ludwig's Roses</title><h1>Ludwig's Roses</h1><p>${"A rose nursery and garden centre. ".repeat(20)}</p>`;
  assert.equal(classifyAuthorityIdentity("The Rose Shed @ Ludwig's Roses", html), "mismatch");
  assert.equal(classifyAuthorityIdentity("The Rose Shed @ Ludwig's Roses", `<title>Ludwig's Roses</title><h1>Buy roses</h1><p>${"A potting shed beside the roses. ".repeat(12)}</p>`), "mismatch");
  assert.equal(classifyAuthorityIdentity("The Rose Shed @ Ludwig's Roses", `<title>The Rose Shed</title><p>${"The Rose Shed is the venue at Ludwig's Roses. ".repeat(8)}</p>`), "match");
  assert.equal(classifyAuthorityIdentity("HOUTBAY LEOPARDS", `<title>Hout Bay Leopards</title><p>${"Club fixtures and venue hire. ".repeat(12)}</p>`), "match");
  assert.equal(classifyAuthorityIdentity("Dassie Palace - Lapa & Rest", `<title>Dassie Paleis</title><p>${"Dassie Paleis is a lapa and restaurant. ".repeat(12)}</p>`), "match");
  const row = await preflightAuthorisedVenue(input({
    venueName: "The Rose Shed @ Ludwig's Roses",
    authorisedUrl: "https://ludwigsroses.co.za/",
  }), probe({ "https://ludwigsroses.co.za/": { body: html } }), observedAt);
  assert.equal(row.disposition, "AUTHORITY_MISMATCH");
  assert.equal(row.recoveredUrl, null);
});

test("an HTTPS downgrade is refused", async () => {
  const row = await preflightAuthorisedVenue(input(), probe({
    "https://venue.example/": { status: 301, location: "http://venue.example/home", body: "" },
  }), observedAt);
  assert.equal(row.disposition, "STALE_PATH_UNRECOVERED");
  assert.match(row.notes, /HTTPS_DOWNGRADE/);
  assert.equal(row.recoveredUrl, null);
  assert.equal(row.evidenceUrls.some((url) => url.startsWith("http://")), false);
});

test("a private network target is refused", async () => {
  const row = await preflightAuthorisedVenue(input({ authorisedUrl: "https://intranet.example/" }), probe({
    "https://intranet.example/": { failure: "PRIVATE_NETWORK", networkFailureClass: "PRIVATE_NETWORK", message: "Refused a hostname resolving to a private or reserved network address." },
  }), observedAt);
  assert.equal(row.disposition, "DEAD_HOST");
  assert.equal(row.networkFailureClass, "PRIVATE_NETWORK");
  assert.equal(row.recoveredUrl, null);
  assert.equal(classifyProbeError(new NetworkRefusal("Refused a hostname resolving to a private or reserved network address.")).failure, "PRIVATE_NETWORK");
  assert.equal(classifyProbeError(Object.assign(new Error("no address"), { code: "ENOTFOUND" })).failure, "DEAD_HOST");
  assert.equal(classifyProbeError(new DiscoveryTimeout()).failure, "TRANSIENT_NETWORK");
});
