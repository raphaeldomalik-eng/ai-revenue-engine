import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { CONTRACTS } from "../src/nexus/contracts.ts";
import {
  candidateRejection,
  distinctiveNameTokens,
  executeOfficialWebsiteDiscovery,
  registrableDomain,
} from "../src/nexus/official-website-discovery.ts";

const serperLines = fs.readFileSync("docs/quality/2026-10-16-venue-serper-discovery-results.jsonl", "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const dbCtx = JSON.parse(
  fs.readFileSync(path.resolve("..", "Event-project", "scripts", "ops", "discovery-cohort-db-context.json"), "utf8"),
);

const NON_VENUE_PRIMARY_TYPES = new Set([
  "nail_salon", "beauty_salon", "hair_salon", "hair_care", "barber_shop",
  "car_wash", "car_repair", "car_dealer", "gas_station",
  "hardware_store", "home_goods_store", "furniture_store", "electronics_store", "clothing_store", "shoe_store", "jewelry_store", "convenience_store", "supermarket", "grocery_store", "pet_store", "liquor_store", "auto_parts_store",
  "plumber", "electrician", "roofing_contractor", "general_contractor", "painter", "locksmith", "moving_company",
  "real_estate_agency", "insurance_agency", "accounting", "lawyer", "legal_services",
  "doctor", "dentist", "pharmacy", "hospital", "medical_clinic", "physiotherapist", "veterinary_care",
  "travel_agency", "tour_agency", "courier_service", "storage", "laundry",
  "party_equipment_rental_service", "equipment_rental_agency", "tent_rental_service",
]);

const NON_VENUE_NAME_PATTERN = /\b(marquee\s+letter|decor\s*&\s*marquee|party\s+bus|mobile\s+bar|mobile\s+chillers|toilet\s+hire|tent\s+hire|sound\s+hire|stage\s+hire|catering\s+equipment|jumping\s+castle|photobooth|photo\s+booth|kwikfind\s+directory|acoustics|production\s+services|event\s+management|events\s+management|promotions\s+cc|nail\s+salon|car\s+wash|auto\s+valet|plumber|plumbing|hardware|panelbeaters|upholstery|security\s+services|cleaning\s+services|driving\s+school|day\s+care|creche|pre-?school|primary\s+school|high\s+school|early\s+learning|dance\s+lessons|puppet\s+company|event\s+companies|party\s+venues|museums\s+online|cape\s+vows|art\s+craft|christmas\s+lights|main\s+beach)\b/i;

const BARE_LOCALITY_OR_CORRUPTED_NAMES = new Set([
  "grabouw", "ga-rankuwa", "riebeek west", "riebeek-kasteel", "melkbosstrand",
  "vanderbijlpark", "putfontein", "kwathema", "segwagwa", "for the poor",
  "left", "zsb", "management", "connaught", "....", "springs municipality",
]);

function classifyInvalidBusiness(row, ctx) {
  const placeId = ctx?.place_id || ctx?.provider_place_id || "";
  if (/^ChIJ_(?:jhb|cpt)_/i.test(placeId)) {
    return "SYNTHETIC_FIXTURE_PLACE_ID";
  }
  const cleanName = (row.venueName || "").trim();
  const lowerName = cleanName.toLowerCase();
  const lowerCity = (ctx?.city || "").trim().toLowerCase();
  if (!/[a-z]{3}/i.test(cleanName) || BARE_LOCALITY_OR_CORRUPTED_NAMES.has(lowerName) || (lowerCity && lowerName === lowerCity)) {
    return "BARE_LOCALITY_OR_CORRUPTED_NAME";
  }
  if (/\b(country club|hotel conference|live music|wedding venue|conference centre|function venue|banquet hall|event space)\s+\d+$/i.test(cleanName)) {
    return "SYNTHETIC_NUMBERED_SEED";
  }
  const primaryType = (ctx?.provider_primary_type || "").toLowerCase();
  if (NON_VENUE_PRIMARY_TYPES.has(primaryType)) {
    return `NON_VENUE_PRIMARY_TYPE:${primaryType}`;
  }
  if (NON_VENUE_NAME_PATTERN.test(cleanName)) {
    return "NON_VENUE_SUPPLIER_OR_SERVICE_NAME";
  }
  return null;
}

function versionedUuid(seed) {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function normalise(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function shouldEvaluateLive(row) {
  const cands = (row.candidates || []).filter((c) => !candidateRejection(c.url));
  if (!cands.length) return false;
  const distTokens = distinctiveNameTokens(row.venueName);
  return cands.some((c) => {
    if (
      c.reasons.includes("DOMAIN_NAME_ALIGNMENT") ||
      c.reasons.includes("TITLE_NAME_ALIGNMENT") ||
      c.reasons.includes("NAME_ALIGNED_WITHOUT_LOCATION_OR_IDENTITY_PROOF") ||
      c.state === "NOT_EVALUATED"
    ) {
      return true;
    }
    const urlText = normalise(c.url);
    return distTokens.some((t) => t.length >= 4 && urlText.includes(t));
  });
}

function toCrawlWave1Row(listingId, venueName, result) {
  const sd = result.sourceDiscovery;
  const officialUrl = result.officialWebsite?.url ?? null;
  if (!sd || !officialUrl) return null;
  const venueFacts = sd.venueFacts || [];
  const identityFacts = sd.identityFacts || [];
  const descriptionEvidence = [
    ...identityFacts
      .filter((f) => f.fieldName === "siteDescription" && typeof f.value === "string" && f.value.trim())
      .map((f) => ({ kind: "character", text: f.value, sourceUrl: f.sourceUrl || officialUrl })),
    ...venueFacts
      .filter((f) => f.fieldName === "description" && typeof f.value === "string" && f.value.trim())
      .map((f) => ({ kind: "facility", text: f.value, sourceUrl: f.sourceUrl || officialUrl })),
  ];
  const contacts = (result.publicContacts || []).map((c) => ({
    type: c.type,
    value: c.value,
    sourceUrl: c.sourceUrl || officialUrl,
    routingAuthority: "not_operator_confirmed",
  }));
  const spaces = venueFacts
    .filter((f) => f.fieldName === "spaces" && typeof f.value === "string")
    .map((f) => ({ name: f.value, sourceUrl: f.sourceUrl || officialUrl }));
  const capacities = venueFacts
    .filter((f) => f.fieldName === "capacity" && f.value && typeof f.value === "object")
    .map((f) => ({
      space: f.value.space ?? null,
      layout: f.value.layout ?? "unspecified",
      count: Number(f.value.count) || 0,
      statement: f.value.statement ?? "",
      sourceUrl: f.sourceUrl || officialUrl,
      reviewRequired: Boolean(f.reviewRequired),
    }))
    .filter((c) => c.count > 0);
  const practicalFacts = venueFacts
    .filter((f) => !["spaces", "capacity", "hireSuitability", "geo", "description"].includes(f.fieldName))
    .map((f) => ({
      fieldName: f.fieldName,
      value: typeof f.value === "string" ? f.value : JSON.stringify(f.value),
      sourceUrl: f.sourceUrl || officialUrl,
    }));
  const suitability = venueFacts
    .filter((f) => f.fieldName === "hireSuitability" && typeof f.value === "string")
    .map((f) => ({ value: f.value, sourceUrl: f.sourceUrl || officialUrl }));
  const images = (sd.imageCandidates || []).map((img) => ({
    sourceImageUrl: img.sourceImageUrl,
    sourcePageUrl: img.sourcePageUrl || officialUrl,
    likelyRole: img.likelyRole || "GALLERY",
    rightsState: img.rightsState || "UNKNOWN_RIGHTS",
  }));
  const hasUseful =
    contacts.some((c) => c.type === "EMAIL") ||
    spaces.length > 0 ||
    capacities.length > 0 ||
    practicalFacts.length >= 2 ||
    descriptionEvidence.some((d) => d.text.split(/\s+/).length >= 18);

  return {
    listingId,
    venueName,
    authorisedOfficialUrl: officialUrl,
    outcome: hasUseful ? "CRAWL_SUCCESS_USEFUL" : "CRAWL_SUCCESS_THIN",
    sameSite: true,
    finalUrl: sd.source?.finalUrl || officialUrl,
    descriptionEvidence,
    contacts,
    spaces,
    capacities,
    practicalFacts,
    suitability,
    images,
    pdfs: [],
    routingAuthority: "not_operator_confirmed",
  };
}

async function main() {
  console.log(`=== PHASE 1: CACHED SERPER DISCOVERY RECOVERY (${serperLines.length} records, 0 live Serper calls) ===`);
  const invalidBusinesses = [];
  const verifiedOfficialWebsites = [];
  const uncertainCandidates = [];
  const genuinelyUnresolvedVenues = [];
  const jsonlOut = [];

  const liveQueue = [];
  for (const row of serperLines) {
    const ctx = dbCtx[row.listingId] || {};
    const invReason = classifyInvalidBusiness(row, ctx);
    if (invReason) {
      invalidBusinesses.push({
        listingId: row.listingId,
        venueName: row.venueName,
        placeId: ctx.place_id || null,
        city: ctx.city || null,
        primaryType: ctx.provider_primary_type || null,
        classificationReason: invReason,
      });
      jsonlOut.push({ ...row, reconciledBucket: "INVALID_BUSINESS", invalidReason: invReason });
      continue;
    }

    if (!shouldEvaluateLive(row)) {
      genuinelyUnresolvedVenues.push({
        listingId: row.listingId,
        venueName: row.venueName,
        placeId: ctx.place_id || null,
        city: ctx.city || null,
        formattedAddress: ctx.discovered_formatted_address || ctx.street_address || null,
        websiteStatus: "NO_CREDIBLE_WEBSITE_FOUND",
        returnedCandidateCount: (row.search?.returnedCandidateUrls || []).length,
      });
      jsonlOut.push({ ...row, reconciledBucket: "GENUINELY_UNRESOLVED", websiteStatus: "NO_CREDIBLE_WEBSITE_FOUND", officialWebsite: null });
      continue;
    }

    liveQueue.push({ row, ctx });
  }

  console.log(`Classified ${invalidBusinesses.length} invalid businesses, ${genuinelyUnresolvedVenues.length} immediately unresolved, ${liveQueue.length} queued for authority verification...`);

  let completed = 0;
  const concurrency = 25;
  const workers = Array.from({ length: concurrency }, async (_, workerIdx) => {
    while (liveQueue.length > 0) {
      const item = liveQueue.shift();
      if (!item) break;
      const { row, ctx } = item;
      const formattedAddress = ctx.discovered_formatted_address || ctx.street_address || null;
      const locality = (ctx.city || "Cape Town").replace(/\s+Region$/i, "");
      const region = ctx.discovered_region || ctx.administrative_area || null;
      const placeId = ctx.place_id || ctx.provider_place_id || null;

      // Reconstruct cached search results with title alignment preserved from the initial Serper response
      const titleAlignedUrls = new Set(
        (row.candidates || [])
          .filter((c) => c.reasons && c.reasons.includes("TITLE_NAME_ALIGNMENT"))
          .map((c) => c.url),
      );
      const cachedResults = (row.search?.returnedCandidateUrls || []).map((url) => ({
        url,
        title: titleAlignedUrls.has(url) ? row.venueName : null,
      }));

      const cachedSearchProvider = {
        id: "serper-cached-replay",
        costModel: { kind: "ZERO_INCREMENTAL", currency: "USD", amountPerCall: 0 },
        async search() {
          return cachedResults;
        },
      };

      const reqInput = {
        contractVersion: CONTRACTS.OFFICIAL_WEBSITE_DISCOVERY_REQUEST,
        requestId: versionedUuid(`phase1-recovery-req:${row.listingId}`),
        idempotencyKey: versionedUuid(`phase1-recovery-idem:${row.listingId}`),
        correlationId: versionedUuid(`phase1-recovery-corr:${row.listingId}`),
        originatingProduct: "event_suite_resources",
        subject: { canonicalEntityId: row.listingId, candidateReference: null, entityType: "VENUE" },
        identity: {
          venueName: row.venueName,
          locality,
          administrativeRegion: region,
          country: "ZA",
          formattedAddress,
          placeId,
          placeIdEvidenceRef: placeId ? `google_places:${placeId}` : null,
        },
        heldEvidence: {
          storedGoogle: {
            displayName: row.venueName,
            formattedAddress,
            evidenceRef: placeId ? `google_places:${placeId}` : null,
          },
        },
        providerAllowances: ["PUBLIC_WEB_SEARCH", "PUBLIC_WEB"],
        costCeiling: { currency: "USD", amount: 0 },
        requestedBy: { actorType: "SYSTEM", actorId: "aire-cached-serper-recovery" },
        createdAt: new Date().toISOString(),
      };

      try {
        const result = await executeOfficialWebsiteDiscovery(reqInput, {
          searchProvider: cachedSearchProvider,
          maxSearchCalls: 1,
          maxCandidates: 4,
          verificationBudget: { maxPages: 2, maxRequests: 5, timeoutMs: 6000 },
          sourceDiscoveryBudget: { maxPages: 6, maxRequests: 12, timeoutMs: 8000, minRequestDelayMs: 100 },
        });

        if (result.officialWebsite) {
          const crawlRow = toCrawlWave1Row(row.listingId, row.venueName, result);
          verifiedOfficialWebsites.push({
            listingId: row.listingId,
            venueName: row.venueName,
            placeId,
            city: ctx.city || locality,
            formattedAddress,
            officialWebsite: result.officialWebsite,
            websiteStatus: result.websiteStatus,
            contactStatus: result.contactStatus,
            guideEmailReady: result.guideEmailReady,
            publicContacts: result.publicContacts,
            crawlRow,
          });
          jsonlOut.push({
            listingId: row.listingId,
            venueName: row.venueName,
            reconciledBucket: "VERIFIED_OFFICIAL_WEBSITE",
            status: result.status,
            websiteStatus: result.websiteStatus,
            contactStatus: result.contactStatus,
            officialWebsite: result.officialWebsite,
            guideEmailReady: result.guideEmailReady,
            publicContacts: result.publicContacts,
            candidates: result.candidates,
            crawlRow,
          });
        } else {
          const hasUncertain =
            result.websiteStatus === "WEBSITE_CANDIDATES_AMBIGUOUS" ||
            result.websiteStatus === "CRAWL_BLOCKED" ||
            result.websiteStatus === "CRAWL_UNAVAILABLE" ||
            result.candidates.some(
              (c) =>
                c.state === "UNVERIFIED" &&
                (c.reasons.includes("DOMAIN_NAME_ALIGNMENT") ||
                  c.reasons.includes("TITLE_NAME_ALIGNMENT") ||
                  c.reasons.includes("NAME_ALIGNED_WITHOUT_LOCATION_OR_IDENTITY_PROOF") ||
                  c.reasons.includes("GENERIC_NAME_REQUIRES_ADDRESS_CORROBORATION")),
            );
          if (hasUncertain) {
            uncertainCandidates.push({
              listingId: row.listingId,
              venueName: row.venueName,
              placeId,
              city: ctx.city || locality,
              formattedAddress,
              websiteStatus: result.websiteStatus,
              candidates: result.candidates.filter((c) => c.state !== "REJECTED"),
              unknowns: result.unknowns,
            });
            jsonlOut.push({
              listingId: row.listingId,
              venueName: row.venueName,
              reconciledBucket: "UNCERTAIN_CANDIDATE",
              status: result.status,
              websiteStatus: result.websiteStatus,
              candidates: result.candidates,
              unknowns: result.unknowns,
            });
          } else {
            genuinelyUnresolvedVenues.push({
              listingId: row.listingId,
              venueName: row.venueName,
              placeId,
              city: ctx.city || locality,
              formattedAddress,
              websiteStatus: result.websiteStatus,
              returnedCandidateCount: cachedResults.length,
            });
            jsonlOut.push({
              listingId: row.listingId,
              venueName: row.listingId,
              reconciledBucket: "GENUINELY_UNRESOLVED",
              status: result.status,
              websiteStatus: result.websiteStatus,
              candidates: result.candidates,
            });
          }
        }
      } catch (err) {
        uncertainCandidates.push({
          listingId: row.listingId,
          venueName: row.venueName,
          placeId,
          city: ctx.city || locality,
          formattedAddress,
          websiteStatus: "CRAWL_UNAVAILABLE",
          error: err instanceof Error ? err.message : String(err),
        });
      }

      completed++;
      if (completed % 25 === 0 || completed === 214) {
        console.log(
          `Progress: ${completed} evaluated | verified=${verifiedOfficialWebsites.length} (emails=${verifiedOfficialWebsites.filter((v) => v.guideEmailReady).length}) | uncertain=${uncertainCandidates.length} | unresolved=${genuinelyUnresolvedVenues.length}`,
        );
      }
    }
  });

  await Promise.all(workers);

  const summary = {
    generatedAt: new Date().toISOString(),
    totalCachedSerperRecords: serperLines.length,
    newSerperApiCalls: 0,
    newSerperCostUsd: 0,
    counts: {
      verifiedOfficialWebsites: verifiedOfficialWebsites.length,
      verifiedWithUsableVenueEmail: verifiedOfficialWebsites.filter((v) => v.guideEmailReady).length,
      verifiedWithPublicContact: verifiedOfficialWebsites.filter((v) => v.publicContacts.length > 0).length,
      uncertainCandidates: uncertainCandidates.length,
      invalidBusinesses: invalidBusinesses.length,
      genuinelyUnresolvedVenues: genuinelyUnresolvedVenues.length,
    },
    falsePositive51OnVleiRejected: !verifiedOfficialWebsites.some((v) =>
      v.officialWebsite.url.includes("capetownhotelsearch.com"),
    ),
  };

  fs.writeFileSync(
    "docs/quality/2026-10-16-venue-serper-cached-recovery-results.jsonl",
    jsonlOut.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  fs.writeFileSync(
    "docs/quality/2026-10-16-venue-serper-cached-recovery-summary.json",
    JSON.stringify(summary, null, 2),
  );

  const manifestOutPath = path.resolve(
    "..",
    "Event-project",
    "scripts",
    "ops",
    "manifest-phase1-cached-discovery-reconciled.json",
  );
  fs.writeFileSync(
    manifestOutPath,
    JSON.stringify(
      {
        summary,
        verifiedOfficialWebsites,
        uncertainCandidates,
        invalidBusinesses,
        genuinelyUnresolvedVenues,
      },
      null,
      2,
    ),
  );

  console.log("\n=== PHASE 1 RECONCILED SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
