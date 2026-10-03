import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { TYPE_BYTE_LIMITS } from "../src/nexus/source-discovery/content.ts";
import { extractFromFetchedDocuments } from "../src/nexus/source-discovery/crawler.ts";
import type { FetchedDocument } from "../src/nexus/source-discovery/types.ts";
import { crawlVenueOfficialSite, VENUE_CRAWL_BUDGET } from "../src/nexus/source-discovery/venue/crawl.ts";
import { buildVenueEvidencePackage, classifyVenueSpace, namedSpacesInText } from "../src/nexus/source-discovery/venue/evidence.ts";
import { planVenueHttpsTarget, sameAuthorisedVenueSite } from "../src/nexus/source-discovery/venue/http-authority.ts";
import { pdfFetchCeiling, VENUE_RELEVANT_PDF_BYTES } from "../src/nexus/source-discovery/venue/pdf-policy.ts";
import { assessVenueLink, rankVenueLinks } from "../src/nexus/source-discovery/venue/selection.ts";

const origin = "https://venue.org";
function page(path: string, body: string): FetchedDocument {
  return {
    url: `${origin}${path}`, body, contentType: "text/html", bytes: Buffer.byteLength(body),
    sourceHash: createHash("sha256").update(body).digest("hex"), observedAt: "2026-10-02T12:00:00.000Z", kind: "HTML",
  };
}

test("venue ranking prefers hire, spaces, gallery and a venue PDF over what's-on", () => {
  const ranked = rankVenueLinks([
    { href: "/whats-on", label: "nav What's on" },
    { href: "/venue-hire", label: "nav Venue hire" },
    { href: "/spaces", label: "Our spaces" },
    { href: "/gallery", label: "nav Gallery" },
    { href: "/downloads/venue-pack.pdf", label: "Venue brochure" },
    { href: "/privacy", label: "Privacy" },
    { href: "https://supplier.example/contact", label: "Supplier" },
  ], `${origin}/`);
  assert.deepEqual(ranked.map((item) => new URL(item.url).pathname), [
    "/venue-hire", "/gallery", "/downloads/venue-pack.pdf", "/spaces",
  ]);
  assert.equal(ranked.some((item) => item.url.includes("whats-on")), false);
  assert.equal(ranked.some((item) => item.url.includes("supplier.example")), false);
  assert.ok(ranked.find((item) => item.url.endsWith(".pdf"))?.dims.includes("VENUE_FACTS:CAPACITY"));
});

test("airport direction variants and menus do not consume the venue budget", () => {
  assert.equal(assessVenueLink(`${origin}/directions-from-the-airport`, "Directions from the airport"), null);
  assert.equal(assessVenueLink(`${origin}/menu/`, "Menu"), null);
  assert.ok(assessVenueLink(`${origin}/directions`, "nav Directions"));
});

test("navigation and path together outrank a bare keyword in the footer", () => {
  const nav = assessVenueLink(`${origin}/venue-hire`, "nav Hire");
  const footer = assessVenueLink(`${origin}/blog/hire-tips`, "Hire tips");
  assert.ok(nav && footer && nav.strength > footer.strength);
});

test("stored HTTP authority upgrades to the same host and refuses another site", () => {
  const planned = planVenueHttpsTarget("http://www.countrysjiek.co.za/weddings");
  assert.equal(planned.upgradedFromHttp, true);
  assert.equal(planned.crawlUrl, "https://www.countrysjiek.co.za/weddings");
  assert.equal(planned.refusal, null);
  assert.equal(sameAuthorisedVenueSite("http://countrysjiek.co.za/", "https://www.countrysjiek.co.za/"), true);
  assert.equal(sameAuthorisedVenueSite("https://theempirevenue.co.za/", "https://theempire.co.za/"), false);
  assert.equal(planVenueHttpsTarget("http://user:pass@venue.example/").refusal, "CREDENTIALS_IN_AUTHORITY");
  assert.equal(planVenueHttpsTarget("http://localhost/venue").refusal, "NON_PUBLIC_HOST");
});

test("named spaces, explicit capacities and conflicts stay review-required", () => {
  const rooms = page("/spaces", `<h1>Spaces</h1><h2>Grand Hall</h2><p>Banquet capacity 180.</p><h2>Newsletter</h2><p>Sign up.</p>`);
  const other = page("/hire", `<h2>Grand Hall</h2><p>Banquet capacity 200.</p><p>Step-free access and on-site parking.</p>`);
  const extracted = extractFromFetchedDocuments([rooms, other], ["VENUE_FACTS"]);
  const evidence = buildVenueEvidencePackage(extracted);
  assert.deepEqual(evidence.spaces.map((item) => item.name), ["Grand Hall"]);
  assert.equal(evidence.capacities.every((item) => item.reviewRequired), true);
  assert.deepEqual([...new Set(evidence.capacities.map((item) => item.count))].sort(), [180, 200]);
  assert.ok(evidence.practicalFacts.some((item) => item.fieldName === "parking" || item.fieldName === "accessibility"));
  assert.ok(evidence.capacities.every((item) => item.sourceUrl.startsWith(origin) && item.evidenceRef.includes("source:")));
});

test("room captions on a rooms page become named spaces", () => {
  assert.deepEqual(namedSpacesInText("Jakkalsbessie Chalet met dubbelbed, privaat badkamer", `${origin}/rooms/`), ["Jakkalsbessie Chalet"]);
  assert.deepEqual(namedSpacesInText("Rooms Gallery Menu Jakkalsbessie Chalet", `${origin}/rooms/`), ["Jakkalsbessie Chalet"]);
  assert.deepEqual(namedSpacesInText("Jakkalsbessie Chalet met dubbelbed", `${origin}/news/`), []);
});

test("venue contacts keep hire email and drop newsletter and hotel addresses", () => {
  const contact = page("/contact", `<main>    <a href="mailto:hire@venue.org">Venue hire</a>
    <a href="mailto:newsletter@venue.org">Newsletter</a></main>`);
  const hotels = page("/accommodation", `<h1>Nearby hotels</h1><a href="mailto:reservations@hotel.org">Hotel</a>`);
  const evidence = buildVenueEvidencePackage(extractFromFetchedDocuments([contact, hotels], ["PUBLIC_CONTACT"]));
  assert.deepEqual(evidence.contacts.map((item) => item.value), ["hire@venue.org"]);
  assert.equal(evidence.routingAuthority, "not_operator_confirmed");
  assert.ok(evidence.excludedContacts.some((item) => item.value === "reservations@hotel.org"));
});

test("a theme body class containing logo does not turn venue photos into logos", () => {
  const gallery = page("/photo-gallery", `<body class="wp-custom-logo">
    <img class="custom-logo" src="/logo.png" alt="Venue logo" width="200" height="80">
    <img class="attachment-full" src="/photos/hall.jpg" alt="Grand Hall" width="900" height="700">
  </body>`);
  const images = extractFromFetchedDocuments([gallery], ["IMAGE_CANDIDATES"]).imageCandidates;
  assert.equal(images.find((item) => item.filename === "logo.png")?.likelyRole, "LOGO");
  assert.notEqual(images.find((item) => item.filename === "hall.jpg")?.likelyRole, "LOGO");
});

test("image candidates keep source page, role and unknown rights", () => {
  const gallery = page("/gallery", `<figure><img src="/photos/hall.jpg" alt="Grand Hall interior" width="1200" height="800"></figure>`);
  const evidence = buildVenueEvidencePackage(extractFromFetchedDocuments([gallery], ["IMAGE_CANDIDATES"]));
  const image = evidence.imagesByRole.SPACE?.[0] ?? evidence.imagesByRole.GALLERY?.[0] ?? evidence.imagesByRole.INTERIOR?.[0];
  assert.ok(image);
  assert.equal(image?.sourcePageUrl, `${origin}/gallery`);
  assert.equal(image?.rightsState, "UNKNOWN_RIGHTS");
  assert.equal(image?.operatorConfirmed, false);
});

test("a venue crawl spends its budget on hire and spaces, not what's on", async () => {
  const pages: Record<string, string> = {
    "/": `<nav><a href="/whats-on">What's on</a><a href="/venue-hire">Venue hire</a><a href="/spaces">Spaces</a><a href="/gallery">Gallery</a></nav>
      <p>${"The Lantern is a riverside hall used for conferences and weddings. ".repeat(8)}</p>`,
    "/venue-hire": `<h1>Venue hire</h1><p>Email: hire@venue.org</p><p>Available for weddings and conferences.</p>`,
    "/spaces": `<h2>Grand Hall</h2><p>Banquet capacity 180.</p><img src="/photos/hall.jpg" alt="Grand Hall interior" width="800" height="600">`,
    "/gallery": `<img src="/photos/exterior.jpg" alt="Exterior of the hall" width="800" height="600">`,
    "/whats-on": `<h1>Jazz Night</h1>`,
  };
  const result = await crawlVenueOfficialSite({
    authorisedUrl: "http://venue.org/",
    venueName: "The Lantern",
    budget: { ...VENUE_CRAWL_BUDGET, maxPages: 4, maxRequests: 6, minRequestDelayMs: 0, timeoutMs: 1000, maxRetries: 0 },
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("robots.txt")) return new Response("User-agent: *\nAllow: /");
      const body = pages[url.pathname];
      return new Response(body ?? "missing", { status: body ? 200 : 404, headers: { "content-type": "text/html" } });
    },
  });
  assert.equal(result.authority.upgradedFromHttp, true);
  assert.equal(result.refusal, null);
  const paths = result.crawl?.documents.map((item) => new URL(item.url).pathname) ?? [];
  assert.equal(paths.includes("/whats-on"), false);
  assert.ok(paths.includes("/venue-hire"));
  assert.ok(paths.includes("/spaces"));
  assert.ok(result.evidence?.spaces.some((item) => item.name === "Grand Hall"));
  assert.ok(result.evidence?.contacts.some((item) => item.value === "hire@venue.org"));
  assert.ok((result.crawl?.stats.pageCount ?? 0) <= 4);
});

test("named rooms stay confirmed and generic headings do not", () => {
  assert.equal(classifyVenueSpace("Grand Hall"), "confirmed");
  assert.equal(classifyVenueSpace("Chapel Cottage"), "confirmed");
  assert.equal(classifyVenueSpace("Sugar Rooms"), "confirmed");
  assert.equal(classifyVenueSpace("The Porter Tun", { capacityLinked: true }), "confirmed");
  assert.equal(classifyVenueSpace("Wicket", { listingContext: true }), "confirmed");
  assert.equal(classifyVenueSpace("The Ballroom", { listingContext: true }), "confirmed");
  assert.equal(classifyVenueSpace("The Nave", { structuredPlace: true }), "confirmed");
  assert.equal(classifyVenueSpace("Guest Accommodation"), "reject");
  assert.equal(classifyVenueSpace("Guest Accommodation", { capacityLinked: true }), "review");
  assert.equal(classifyVenueSpace("Chapel"), "reject");
  assert.equal(classifyVenueSpace("Meeting Rooms"), "reject");
  assert.equal(classifyVenueSpace("Wedding Venue"), "reject");
  assert.equal(classifyVenueSpace("Your Wedding Chapel"), "reject");
  assert.equal(classifyVenueSpace("Honeymoon Suite"), "reject");
  assert.equal(namedSpacesInText("Your Wedding Chapel and Valley Suite", `${origin}/weddings/`).includes("Chapel"), false);
  assert.deepEqual(namedSpacesInText("Valley Suite and Chapel Cottage", `${origin}/weddings/`), ["Valley Suite", "Chapel Cottage"]);
  assert.deepEqual(namedSpacesInText("The Gatehouse Cottages The Arbour Cottage The Manor House", `${origin}/weddings/`), ["Gatehouse Cottages", "Arbour Cottage", "Manor House"]);
  assert.deepEqual(namedSpacesInText("House The Valley Suite", `${origin}/weddings/`), ["Valley Suite"]);
  assert.deepEqual(namedSpacesInText("Wedding Chapel Harmony Hall", `${origin}/weddings/`), ["Harmony Hall"]);
});

test("capacity-linked proper names and containsPlace stay confirmed while a category capacity does not", () => {
  const hire = page("/spaces", `<h2>The Porter Tun</h2><p>1,000 standing.</p>
    <h2>Guest Accommodation</h2><p>Capacity Guest Accommodation - 50</p>
    <script type="application/ld+json">{"@type":"EventVenue","name":"The Lantern","url":"${origin}/","containsPlace":{"@type":"Place","name":"The Nave"}}</script>`);
  const evidence = buildVenueEvidencePackage(extractFromFetchedDocuments([hire], ["VENUE_FACTS"]));
  assert.ok(evidence.spaces.some((item) => item.name === "The Porter Tun" && item.status === "confirmed"));
  assert.ok(evidence.spaces.some((item) => item.name === "The Nave" && item.status === "confirmed"));
  assert.equal(evidence.spaces.some((item) => item.name === "Guest Accommodation"), false);
  assert.ok(evidence.reviewSpaces.some((item) => item.name === "Guest Accommodation"));
  const porter = evidence.capacities.find((item) => item.space === "The Porter Tun");
  assert.equal(porter?.count, 1000);
  assert.equal(porter?.layout, "standing");
  assert.ok(evidence.capacities.some((item) => item.space === "Guest Accommodation" && item.count === 50));
  const menu = page("/conference", `<p>2 x Three-Course Dinner 2 x Country Breakfasts</p><h2>Grand Hall</h2><p>Banquet capacity 180.</p>`);
  const menuEvidence = buildVenueEvidencePackage(extractFromFetchedDocuments([menu], ["VENUE_FACTS"]));
  assert.equal(menuEvidence.capacities.some((item) => item.count === 2), false);
  assert.ok(menuEvidence.capacities.some((item) => item.count === 180 && item.space === "Grand Hall"));
});

test("conflicting capacities stay review-required and several real spaces are still fetched", async () => {
  const images = Array.from({ length: 8 }, (_, index) => `<img src="/photos/${index}.jpg" alt="Hall interior" width="800" height="600">`).join("");
  const pages: Record<string, string> = {
    "/": `<nav><a href="/spaces">Spaces</a><a href="/more-spaces">More spaces</a><a href="/whats-on">What's on</a></nav>
      <p>${"The Lantern is a riverside hall used for conferences and weddings. ".repeat(8)}</p>
      <a href="mailto:hire@venue.org">Hire</a>
      <p>On-site parking and step-free access.</p>
      <h2>Grand Hall</h2><p>Banquet capacity 180.</p>${images}`,
    "/more-spaces": `<h2>Valley Suite</h2><p>A private suite.</p><h2>Corner Cottage</h2><p>Seated capacity 12.</p><h2>Grand Hall</h2><p>Banquet capacity 200.</p>`,
    "/whats-on": `<h1>Jazz Night</h1>`,
  };
  const result = await crawlVenueOfficialSite({
    authorisedUrl: "https://venue.org/",
    budget: { ...VENUE_CRAWL_BUDGET, maxPages: 4, maxRequests: 8, minRequestDelayMs: 0, timeoutMs: 1000, maxRetries: 0 },
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("robots.txt")) return new Response("User-agent: *\nAllow: /");
      const body = pages[url.pathname];
      return new Response(body ?? "missing", { status: body ? 200 : 404, headers: { "content-type": "text/html" } });
    },
  });
  const paths = result.crawl?.documents.map((item) => new URL(item.url).pathname) ?? [];
  assert.ok(paths.includes("/more-spaces"));
  assert.equal(paths.includes("/whats-on"), false);
  assert.deepEqual(result.evidence?.spaces.map((item) => item.name).sort(), ["Corner Cottage", "Grand Hall", "Valley Suite"]);
  assert.ok(result.evidence?.capacities.filter((item) => item.space === "Grand Hall").every((item) => item.reviewRequired));
});

function pdfFixture(pages: string[][]): Uint8Array {
  const objects: string[] = [];
  const kids = pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ");
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  const streams: Array<{ id: number; data: Buffer }> = [];
  pages.forEach((lines, index) => {
    const pageId = 4 + index * 2;
    const contentId = pageId + 1;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    const ops = ["BT", "/F1 12 Tf", "72 780 Td", ...lines.flatMap((line, lineIndex) => [lineIndex ? "0 -16 Td" : "", `(${line.replace(/[()\\]/g, "\\$&")}) Tj`]).filter(Boolean), "ET"].join("\n");
    streams.push({ id: contentId, data: deflateSync(Buffer.from(ops, "latin1")) });
  });
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const offsets: number[] = [];
  let length = chunks[0]!.length;
  const push = (chunk: Buffer) => { chunks.push(chunk); length += chunk.length; };
  const total = 3 + pages.length * 2;
  for (let id = 1; id <= total; id += 1) {
    offsets[id] = length;
    const stream = streams.find((item) => item.id === id);
    if (stream) {
      push(Buffer.from(`${id} 0 obj\n<< /Length ${stream.data.length} /Filter /FlateDecode >>\nstream\n`, "latin1"));
      push(stream.data);
      push(Buffer.from("\nendstream\nendobj\n", "latin1"));
    } else push(Buffer.from(`${id} 0 obj\n${objects[id]}\nendobj\n`, "latin1"));
  }
  const xref = length;
  push(Buffer.from(`xref\n0 ${total + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`, "latin1"));
  return new Uint8Array(Buffer.concat(chunks));
}

test("venue PDF ceilings stay bounded and do not raise ordinary responses", () => {
  assert.equal(pdfFetchCeiling({ genericMaxBytes: VENUE_CRAWL_BUDGET.maxBytesPerResponse }), VENUE_CRAWL_BUDGET.maxBytesPerResponse);
  assert.equal(pdfFetchCeiling({ relevantPdfBytes: 50_000_000, genericMaxBytes: VENUE_CRAWL_BUDGET.maxBytesPerResponse }), VENUE_RELEVANT_PDF_BYTES);
  assert.ok(VENUE_RELEVANT_PDF_BYTES < TYPE_BYTE_LIMITS.PDF);
  assert.ok(VENUE_RELEVANT_PDF_BYTES > VENUE_CRAWL_BUDGET.maxBytesPerResponse);
});

test("a relevant venue PDF above the generic cap is read, and unrelated or oversized PDFs are not", async () => {
  const pack = pdfFixture([["Venue Specification", "Grand Hall", "Theatre capacity: 250"], ["Riverside Room", "Reception capacity: 90"]]);
  const padded = new Uint8Array(Buffer.concat([Buffer.from(pack), Buffer.alloc(1_600_000 - pack.length, 0x20)]));
  assert.ok(padded.length > VENUE_CRAWL_BUDGET.maxBytesPerResponse);
  assert.ok(padded.length < VENUE_RELEVANT_PDF_BYTES);
  const requested: string[] = [];
  const result = await crawlVenueOfficialSite({
    authorisedUrl: "https://venue.org/",
    budget: { ...VENUE_CRAWL_BUDGET, maxPages: 4, maxRequests: 8, maxPdfDocuments: 1, minRequestDelayMs: 0, timeoutMs: 1000, maxRetries: 0 },
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      requested.push(url.toString());
      if (url.pathname.endsWith("robots.txt")) return new Response("User-agent: *\nAllow: /");
      if (url.pathname === "/") {
        return new Response(`<a href="/downloads/venue-hire-pack.pdf">Venue hire pack</a><a href="/downloads/dinner-menu.pdf">Dinner menu</a><a href="/downloads/accounts.pdf">Accounts</a>`, { headers: { "content-type": "text/html" } });
      }
      if (url.pathname === "/downloads/venue-hire-pack.pdf") {
        return new Response(Buffer.from(padded), { headers: { "content-type": "application/pdf", "content-length": String(padded.length) } });
      }
      if (url.pathname === "/downloads/too-big.pdf") {
        return new Response(Buffer.from("%PDF-1.4\n"), { headers: { "content-type": "application/pdf", "content-length": String(VENUE_RELEVANT_PDF_BYTES + 1) } });
      }
      return new Response("missing", { status: 404 });
    },
  });
  const pdfDoc = result.crawl?.documents.find((item) => item.url.endsWith("/downloads/venue-hire-pack.pdf"));
  assert.ok(pdfDoc && pdfDoc.bytes > VENUE_CRAWL_BUDGET.maxBytesPerResponse);
  assert.equal(requested.some((url) => url.includes("dinner-menu") || url.includes("accounts")), false);
  assert.ok(result.evidence?.capacities.some((item) => item.count === 250 && item.sourceUrl.includes("venue-hire-pack.pdf")));
  assert.ok(result.evidence?.capacities.some((item) => item.count === 90 && item.layout === "reception"));
  assert.equal(result.crawl?.documents.filter((item) => item.kind === "PDF").length, 1);
});

test("an oversized venue PDF and a cross-site PDF redirect stay refused", async () => {
  const requested: string[] = [];
  const result = await crawlVenueOfficialSite({
    authorisedUrl: "https://venue.org/",
    budget: { ...VENUE_CRAWL_BUDGET, maxPages: 3, maxRequests: 8, minRequestDelayMs: 0, timeoutMs: 1000, maxRetries: 0 },
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      requested.push(url.toString());
      if (url.hostname !== "venue.org") return new Response("offsite", { status: 200 });
      if (url.pathname.endsWith("robots.txt")) return new Response("User-agent: *\nAllow: /");
      if (url.pathname === "/") {
        return new Response(`<a href="/downloads/venue-hire-pack.pdf">Venue hire pack</a><a href="/downloads/floor-plan.pdf">Floor plan</a>`, { headers: { "content-type": "text/html" } });
      }
      if (url.pathname === "/downloads/venue-hire-pack.pdf") {
        return new Response(Buffer.from("%PDF-1.4\n"), { headers: { "content-type": "application/pdf", "content-length": String(VENUE_RELEVANT_PDF_BYTES + 1) } });
      }
      if (url.pathname === "/downloads/floor-plan.pdf") {
        return new Response(null, { status: 302, headers: { location: "https://files.example/floor-plan.pdf" } });
      }
      return new Response("missing", { status: 404 });
    },
  });
  assert.equal(result.crawl?.documents.some((item) => item.kind === "PDF"), false);
  assert.equal(requested.some((url) => url.includes("files.example")), false);
  assert.ok(result.crawl?.stats.warnings.some((warning) => /venue-hire-pack\.pdf/.test(warning) && /size limit/i.test(warning)));
  assert.ok(result.crawl?.observability?.blockedPages.some((item) => item.reason === "REDIRECT_CROSS_SITE"));
});
