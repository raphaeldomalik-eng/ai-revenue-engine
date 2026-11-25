import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { extractFromFetchedDocuments } from "../src/nexus/source-discovery/crawler.ts";
import { buildVenueEvidencePackage } from "../src/nexus/source-discovery/venue/evidence.ts";

const directory = process.env.UK20_RETAINED_RECEIPTS;
if (!directory) throw new Error("UK20_RETAINED_RECEIPTS is required");

const sourceRevision = "26074b5752eafc1814a2e602c41c9893e5ee5213";
const repairRevision = process.env.UK20_REPAIR_REVISION ?? "UNCOMMITTED";
const manifestPath = join(dirname(directory), "SHA256SUMS.txt");
const manifest = readFileSync(manifestPath, "utf8").trim().split(/\r?\n/);
for (const line of manifest) {
  const match = /^([a-f0-9]{64})\s+(.+)$/.exec(line);
  if (!match) continue;
  const bytes = readFileSync(join(dirname(directory), match[2].replaceAll("/", "\\")));
  if (createHash("sha256").update(bytes).digest("hex") !== match[1]) throw new Error(`Evidence hash mismatch: ${match[2]}`);
}

const held = new Set([1, 2, 14, 16]);
const facilities = ["accessibility", "parking", "publicTransport", "wifi", "avProduction", "catering", "bar", "outdoorSpace",
  "accommodation", "loadingAccess", "technicalFacilities", "sound", "lighting", "staging", "power", "kitchen", "cloakroom"];
const contactPurposes = ["SALES_HIRE", "ENQUIRIES", "BOOKINGS", "BOX_OFFICE", "GENERAL"];
const allExtractors = ["IDENTITY", "PUBLIC_CONTACT", "VENUE_FACTS", "IMAGE_CANDIDATES"];

function identityRows(before, after) {
  const list = [["exactProperty", ["siteName", "placeName", "explicitVenueName"]], ["operator", ["operatorName"]],
    ["canonicalOfficialUrl", ["canonicalUrl"]], ["address", ["address"]], ["postcode", ["address"]]];
  return list.map(([field, names]) => {
    const match = (facts) => facts.filter((fact) => {
      if (!names.includes(fact.fieldName)) return false;
      return field !== "postcode" || /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(String(fact.value));
    });
    return { field, officialSource: field === "operator" ? "UNKNOWN_NOT_FIELD_REVIEWED" : "OBSERVED_IN_RETAINED_CORPUS",
      crawlerPage: "CAPTURED_IN_74_PAGE_CORPUS", beforeCount: match(before).length, afterCount: match(after).length };
  });
}

function candidateState(values) {
  if (!values.length) return "MISSING_OR_UNOBSERVED";
  const accepted = values.some((value) => value.reviewRequired === false || value.reviewRequired == null);
  const reviewed = values.some((value) => value.reviewRequired === true);
  return accepted && reviewed ? "MIXED_ACCEPTED_AND_HELD" : accepted ? "ACCEPTED_AS_SOURCE_CANDIDATE" : "HELD_FOR_REVIEW";
}

function fieldRow(field, officialSource, before, after) {
  return { field, officialSource, crawlerPage: "CAPTURED_IN_74_PAGE_CORPUS",
    beforeCount: before.length, afterCount: after.length, candidate: candidateState(after) };
}

function sourceFor(afterCount, known = false) {
  return afterCount > 0 ? "OBSERVED_IN_RETAINED_CORPUS" : known ? "OBSERVED_BY_INDEPENDENT_REVIEW" : "UNKNOWN_NOT_FIELD_REVIEWED";
}

const rows = [];
for (let index = 1; index <= 20; index += 1) {
  const number = String(index).padStart(2, "0");
  const row = JSON.parse(readFileSync(join(directory, `${number}.json`), "utf8"));
  const extraction = extractFromFetchedDocuments(row.source.documents, allExtractors, row.venueName);
  const evidence = buildVenueEvidencePackage(extraction);
  const before = row.extracted;
  const descriptionsAfter = extraction.identityFacts.filter((fact) => ["siteDescription", "metaDescription"].includes(fact.fieldName));
  const descriptionsBefore = before.identityFacts.filter((fact) => ["siteDescription", "metaDescription", "description"].includes(fact.fieldName));
  const shortAfter = descriptionsAfter.filter((fact) => String(fact.value).length <= 240);
  const fullAfter = descriptionsAfter.filter((fact) => String(fact.value).length > 240);
  const shortBefore = descriptionsBefore.filter((fact) => String(fact.value).length <= 240);
  const fullBefore = descriptionsBefore.filter((fact) => String(fact.value).length > 240);
  const fields = [];
  for (const identity of identityRows(before.identityFacts, extraction.identityFacts)) {
    fields.push({ family: "IDENTITY_LOCATION", ...identity,
      candidate: held.has(index) ? "HELD_BY_EXISTING_SCOPE" : identity.afterCount ? "ACCEPTED_AS_SOURCE_CANDIDATE" : "MISSING_OR_UNOBSERVED" });
  }
  fields.push({ family: "RICH_DESCRIPTION", ...fieldRow("shortDescriptionCandidate", "OBSERVED_BY_INDEPENDENT_REVIEW", shortBefore, shortAfter) });
  fields.push({ family: "RICH_DESCRIPTION", ...fieldRow("fullDescriptionCandidate", "OBSERVED_BY_INDEPENDENT_REVIEW", fullBefore, fullAfter) });
  fields.push({ family: "RICH_DESCRIPTION", ...fieldRow("restrictions", "UNKNOWN_NOT_FIELD_REVIEWED",
    before.identityFacts.filter((fact) => /members only|not permitted|not available|no external|serious plan|subject to/i.test(String(fact.value))),
    descriptionsAfter.filter((fact) => /members only|not permitted|not available|no external|serious plan|subject to/i.test(String(fact.value)))) });
  for (const [field, beforeFacts, afterFacts] of [
    ["namedSpaces", before.venueFacts.filter((fact) => fact.fieldName === "spaces"), extraction.venueFacts.filter((fact) => fact.fieldName === "spaces")],
    ["capacityByLayout", before.venueFacts.filter((fact) => fact.fieldName === "capacity"), extraction.venueFacts.filter((fact) => fact.fieldName === "capacity")],
    ["eventSuitability", before.venueFacts.filter((fact) => fact.fieldName === "hireSuitability"), extraction.venueFacts.filter((fact) => fact.fieldName === "hireSuitability")],
  ]) {
    fields.push({ family: "SPACES_FACILITIES", ...fieldRow(field, sourceFor(afterFacts.length, field === "namedSpaces" && index === 13),
      beforeFacts, afterFacts) });
  }
  for (const field of facilities) {
    const beforeFacts = before.venueFacts.filter((fact) => fact.fieldName === field);
    const afterFacts = extraction.venueFacts.filter((fact) => fact.fieldName === field);
    fields.push({ family: "SPACES_FACILITIES", ...fieldRow(field, sourceFor(afterFacts.length), beforeFacts, afterFacts) });
  }
  for (const field of ["EMAIL", "PHONE", "CONTACT_FORM"]) {
    const beforeContacts = before.publicContacts.filter((contact) => contact.type === field);
    const afterContacts = extraction.publicContacts.filter((contact) => contact.type === field);
    fields.push({ family: "CONTACTS", ...fieldRow(field.toLowerCase(),
      sourceFor(afterContacts.length, index !== 1 && index !== 20), beforeContacts, afterContacts) });
  }
  for (const purpose of contactPurposes) {
    const beforeContacts = before.publicContacts.filter((contact) => contact.purpose === purpose);
    const afterContacts = extraction.publicContacts.filter((contact) => contact.purpose === purpose);
    fields.push({ family: "CONTACTS", ...fieldRow(`purpose:${purpose}`, sourceFor(afterContacts.length), beforeContacts, afterContacts) });
  }
  const beforeImages = before.imageCandidates ?? [];
  const afterImages = extraction.imageCandidates;
  const imageFields = [
    ["discoveredImageUrls", beforeImages, afterImages],
    ["deduplicatedOriginalAssets", [...new Map(beforeImages.map((image) => [image.sourceImageUrl, image])).values()],
      [...new Map(afterImages.map((image) => [image.sourceImageUrl, image])).values()]],
    ["exactVenuePhotos", beforeImages.filter((image) => image.exactVenue === true), afterImages.filter((image) => image.exactVenue === true)],
    ["rightsClearedPhotos", beforeImages.filter((image) => image.rightsState === "VERIFIED_REUSABLE"),
      afterImages.filter((image) => image.rightsState === "VERIFIED_REUSABLE")],
  ];
  for (const [field, prior, current] of imageFields) {
    const item = fieldRow(field, current.length ? "OBSERVED_IN_RETAINED_CORPUS" : "UNKNOWN_NOT_FIELD_REVIEWED", prior, current);
    item.candidate = field === "rightsClearedPhotos" ? (current.length ? item.candidate : "HELD_RIGHTS_UNKNOWN")
      : field === "exactVenuePhotos" ? (current.length ? "SUBJECT_CONFIRMED_CANDIDATE" : "SUBJECT_UNCONFIRMED")
      : current.length ? "DISCOVERY_CANDIDATE" : "MISSING_OR_UNOBSERVED";
    fields.push({ family: "PHOTOS", ...item });
  }
  fields.push({ family: "PHOTOS", field: "assetsInspected", officialSource: "NOT_APPLICABLE", crawlerPage: "NO_ASSET_FETCH_IN_RETAINED_REPLAY",
    beforeCount: 0, afterCount: 0, candidate: "UNKNOWN" });

  rows.push({
    number: index, venue: row.venueName, retainedPages: row.source.documents.length,
    originalIdentity: { state: row.assessment.state, reason: row.assessment.reason },
    decision: held.has(index)
      ? index === 14 ? "HELD_VENUE_EVIDENCE_COMPLETION_REQUIRED" : "HELD_IDENTITY"
      : "EXTRACTION_CANDIDATES_ONLY_NOT_ADMITTED",
    summary: {
      contacts: evidence.contacts.length, excludedContacts: evidence.excludedContacts.length,
      spaces: evidence.spaces.length, reviewSpaces: evidence.reviewSpaces.length, capacities: evidence.capacities.length,
      practicalFacts: evidence.practicalFacts.length, suitability: evidence.suitability.length,
      discoveredImageUrls: extraction.imageCandidates.length,
      exactVenuePhotos: extraction.imageCandidates.filter((image) => image.exactVenue === true).length,
      rightsClearedPhotos: extraction.imageCandidates.filter((image) => image.rightsState === "VERIFIED_REUSABLE").length,
      assetsInspected: 0,
    },
    fields,
  });
}

const totals = rows.reduce((sum, row) => {
  sum.pages += row.retainedPages;
  sum.imageUrls += row.summary.discoveredImageUrls;
  sum.exactVenuePhotos += row.summary.exactVenuePhotos;
  sum.rightsClearedPhotos += row.summary.rightsClearedPhotos;
  return sum;
}, { pages: 0, imageUrls: 0, exactVenuePhotos: 0, rightsClearedPhotos: 0, assetsInspected: 0 });

console.log(JSON.stringify({
  schemaVersion: 1,
  work: "ENR16-UK20-20261120",
  scope: "TEST_RETAINED_SOURCE_ONLY",
  sourceRevision,
  repairRevision,
  evidence: {
    manifest: join(dirname(directory), "SHA256SUMS.txt"),
    originalComment: "https://github.com/raphaeldomalik-eng/Prestige-Architecture/issues/16#issuecomment-7147563636",
    independentReview: "https://github.com/raphaeldomalik-eng/Prestige-Architecture/issues/16#issuecomment-7040925610",
    affectedCaseReview: "https://github.com/raphaeldomalik-eng/Prestige-Architecture/issues/16#issuecomment-7041610959",
  },
  costs: { freshProviderCalls: 0, freshFetches: 0, chargeUsd: 0 },
  totals,
  holds: [1, 2, 14, 16],
  planner: {
    freightIslandFaq: "SCHEDULED_WITHIN_5_REQUEST_CAP; response not retained, no actual fresh HTTP result",
    portsmouthGuildhallRoom: "SCHEDULED_WITHIN_7_REQUEST_CAP; response not retained, no actual fresh HTTP result",
    note: "Offline missing-page responses are simulated 404s and are not evidence of live website behavior.",
  },
  sourceProviderEvaluation: {
    conclusion: "UK-20 is not a Brave-versus-Serper comparison because it began from supplied websites.",
    cachedSerper: "Existing 1,619-record cache evaluated without fresh calls; rank-one verifier outcomes retained separately.",
    braveComparison: "NOT_RUN",
    freshMatchedComparison: "NOT_REQUIRED_WITHOUT_NEW_AUTHORISED_SPEND",
  },
  rows,
}, null, 2));
