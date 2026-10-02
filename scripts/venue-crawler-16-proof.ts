/**
 * Frozen 16-venue proof. Reads docs/quality/2026-10-02-venue-crawler-sample.json.
 * First-party official sites only. No Google, OpenAI, Apollo, Companies House,
 * search, or rendering vendor. No EventSuite writes.
 *
 * Run with Node's system certificate store:
 * `node --use-system-ca --experimental-strip-types scripts/venue-crawler-16-proof.ts`
 * That uses the OS trust store. It does not disable TLS verification.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { crawlVenueOfficialSite } from "../src/nexus/source-discovery/venue/crawl.ts";
import type { VenueEvidencePackage } from "../src/nexus/source-discovery/venue/evidence.ts";

type Sample = {
  id: string;
  placeId: string | null;
  listingId: string | null;
  name: string;
  market: string;
  authorisedUrl: string;
  provenance: string;
  reason: string;
};

const sample = JSON.parse(readFileSync(new URL("../docs/quality/2026-10-02-venue-crawler-sample.json", import.meta.url), "utf8")) as Sample[];
const calls = { google: 0, openai: 0, apollo: 0, companiesHouse: 0, renderVendor: 0 };

function forbid(url: string) {
  const host = new URL(url).hostname.toLowerCase();
  if (host.endsWith(".openai.com") || host === "api.openai.com") { calls.openai += 1; throw new Error("OPENAI_CALL_FORBIDDEN"); }
  if (host.endsWith(".googleapis.com")) { calls.google += 1; throw new Error("GOOGLE_CALL_FORBIDDEN"); }
  if (host.endsWith(".apollo.io")) { calls.apollo += 1; throw new Error("APOLLO_CALL_FORBIDDEN"); }
  if (host.endsWith("companieshouse.gov.uk")) { calls.companiesHouse += 1; throw new Error("COMPANIES_HOUSE_CALL_FORBIDDEN"); }
  if (/(browserless|scrapingbee|browserbase|zenrows)/i.test(host)) { calls.renderVendor += 1; throw new Error("RENDER_VENDOR_FORBIDDEN"); }
}

function guardedFetch(): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    forbid(url);
    return fetch(input, init);
  };
}

function imageCounts(evidence: VenueEvidencePackage | null) {
  if (!evidence) return {};
  return Object.fromEntries(Object.entries(evidence.imagesByRole).map(([role, items]) => [role, items.length]));
}

function judge(evidence: VenueEvidencePackage | null, pages: number, status: string) {
  if (!evidence || status === "FAILED" || status === "BLOCKED") {
    return {
      PAGE_SELECTION: "FAIL", DESCRIPTION_EVIDENCE: "FAIL", CONTACT_RECALL: "NOT_APPLICABLE", SPACE_RECALL: "NOT_APPLICABLE",
      CAPACITY_RECALL: "NOT_APPLICABLE", PRACTICAL_FACT_RECALL: "NOT_APPLICABLE", IMAGE_RECALL: "FAIL", PDF_DISCOVERY: "NOT_APPLICABLE",
      PRECISION: status === "BLOCKED" ? "PASS" : "FAIL", EVIDENCE_PROVENANCE: "FAIL",
    };
  }
  const usefulImages = Object.entries(evidence.imagesByRole).filter(([role]) => role !== "LOGO").reduce((sum, [, items]) => sum + items.length, 0);
  const character = evidence.descriptionEvidence.some((item) => item.kind === "character" || item.kind === "event-use" || item.kind === "facility");
  return {
    PAGE_SELECTION: pages >= 2 ? "PASS" : "FAIL",
    DESCRIPTION_EVIDENCE: character ? "PASS" : "FAIL",
    CONTACT_RECALL: evidence.contacts.length ? "PASS" : "FAIL",
    SPACE_RECALL: evidence.spaces.length ? "PASS" : "FAIL",
    CAPACITY_RECALL: evidence.capacities.length ? "PASS" : "FAIL",
    PRACTICAL_FACT_RECALL: evidence.practicalFacts.length ? "PASS" : "FAIL",
    IMAGE_RECALL: usefulImages >= 3 ? "PASS" : "FAIL",
    PDF_DISCOVERY: "NOT_APPLICABLE",
    PRECISION: evidence.spaces.some((item) => /newsletter|what's on|latest news/i.test(item.name)) ? "FAIL" : "PASS",
    EVIDENCE_PROVENANCE: evidence.descriptionEvidence.every((item) => item.sourceUrl && item.evidenceRef) ? "PASS" : "FAIL",
  };
}

const results = [];
for (const venue of sample) {
  process.stderr.write(`crawl ${venue.id}\n`);
  const started = Date.now();
  try {
    const result = await crawlVenueOfficialSite({
      authorisedUrl: venue.authorisedUrl,
      venueName: venue.name,
      fetchImpl: guardedFetch(),
    });
    const crawl = result.crawl;
    const obs = crawl?.observability;
    results.push({
      id: venue.id,
      name: venue.name,
      authorisedUrl: venue.authorisedUrl,
      provenance: venue.provenance,
      crawlUrl: result.authority.crawlUrl,
      upgradedFromHttp: result.authority.upgradedFromHttp,
      finalUrl: crawl?.finalUrl ?? null,
      status: crawl?.stats.status ?? "FAILED",
      refusal: result.refusal,
      sameSite: result.sameSite,
      pages: crawl?.documents.filter((item) => item.kind !== "PDF").map((item) => item.url) ?? [],
      pdfs: crawl?.documents.filter((item) => item.kind === "PDF").map((item) => item.url) ?? [],
      requests: crawl?.stats.requestCount ?? 0,
      bytes: crawl?.stats.bytesRead ?? 0,
      redirects: obs?.redirects ?? 0,
      retries: obs?.retries ?? 0,
      robots: obs?.robots ?? [],
      stopReason: obs?.stopReason ?? result.refusal,
      selections: obs?.selections ?? [],
      sitemap: obs?.sitemap ?? null,
      warnings: crawl?.stats.warnings ?? [],
      spaces: result.evidence?.spaces.map((item) => item.name) ?? [],
      capacities: result.evidence?.capacities.map((item) => ({ space: item.space, layout: item.layout, count: item.count, reviewRequired: item.reviewRequired, sourceUrl: item.sourceUrl })) ?? [],
      contacts: result.evidence?.contacts.map((item) => ({ type: item.type, purpose: item.purpose, sourceUrl: item.sourceUrl })) ?? [],
      practical: result.evidence?.practicalFacts.map((item) => item.fieldName) ?? [],
      description: result.evidence?.descriptionEvidence.map((item) => ({ kind: item.kind, text: item.text.slice(0, 240), sourceUrl: item.sourceUrl })) ?? [],
      images: imageCounts(result.evidence),
      routingAuthority: result.evidence?.routingAuthority ?? null,
      judgement: judge(result.evidence, crawl?.stats.pageCount ?? 0, crawl?.stats.status ?? "FAILED"),
      elapsedMs: Date.now() - started,
    });
  } catch (error) {
    results.push({ id: venue.id, name: venue.name, authorisedUrl: venue.authorisedUrl, status: "FAILED", error: error instanceof Error ? error.message : "unknown", elapsedMs: Date.now() - started });
  }
}

const output = { paidProviderCalls: calls, venues: results };
writeFileSync(new URL("../docs/quality/2026-10-02-venue-crawler-proof.json", import.meta.url), JSON.stringify(output, null, 2));
process.stdout.write(`${results.length} venues\n`);
