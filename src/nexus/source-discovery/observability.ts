import type { ResourceExtraction } from "./extractors/resources.ts";
import type { CrawlObservability, ExtractorYields } from "./types.ts";

type Extracted = ResourceExtraction & { eventCandidates: unknown[] };

export function extractorYields(extracted: Extracted): ExtractorYields {
  const contacts = { email: 0, phone: 0, form: 0, other: 0, reviewRequired: 0 };
  for (const contact of extracted.publicContacts) {
    if (contact.type === "EMAIL") contacts.email += 1;
    else if (contact.type === "PHONE") contacts.phone += 1;
    else if (contact.type === "CONTACT_FORM") contacts.form += 1;
    else contacts.other += 1;
    if (contact.reviewRequired) contacts.reviewRequired += 1;
  }
  const venueFacts = { spaces: 0, namedSpaceCapacities: 0, venueCapacities: 0, facilities: 0, accessibility: 0, conflicts: 0, reviewRequired: 0 };
  for (const fact of extracted.venueFacts) {
    if (fact.fieldName === "spaces") venueFacts.spaces += 1;
    else if (fact.fieldName === "capacity") {
      if ((fact.value as { space?: string | null } | null)?.space) venueFacts.namedSpaceCapacities += 1;
      else venueFacts.venueCapacities += 1;
    } else if (fact.fieldName === "accessibility") venueFacts.accessibility += 1;
    else if (!["hireSuitability", "geo"].includes(fact.fieldName)) venueFacts.facilities += 1;
    if (fact.reviewRequired) venueFacts.reviewRequired += 1;
  }
  venueFacts.conflicts = extracted.warnings.filter((warning) => /conflict/i.test(warning)).length;
  const refs = [...extracted.identityFacts, ...extracted.publicContacts, ...extracted.venueFacts].map((item) => item.evidenceRef);
  return {
    identityFacts: extracted.identityFacts.length,
    contacts,
    venueFacts,
    images: {
      total: extracted.imageCandidates.length,
      restricted: extracted.imageCandidates.filter((item) => item.rightsState === "RIGHTS_RESERVED" || item.rightsState === "PERMISSION_REQUIRED").length,
      unknownRights: extracted.imageCandidates.filter((item) => item.rightsState === "UNKNOWN_RIGHTS").length,
      exactVenue: extracted.imageCandidates.filter((item) => item.exactVenue === true).length,
    },
    events: extracted.eventCandidates.length,
    evidenceRefs: extracted.evidenceRefs.length,
    pdfEvidence: refs.filter((ref) => /#page=\d+:/.test(ref)).length,
  };
}

/** One bounded structured line per crawl; carries no page bodies, contact values, or credentials. */
export function crawlLogLine(observability: CrawlObservability) {
  return JSON.stringify({
    event: "nexus.source-discovery.crawl",
    subjectType: observability.subjectType,
    extractors: observability.extractors,
    canonicalOrigin: observability.canonicalOrigin,
    mode: observability.mode,
    status: observability.finalStatus,
    stopReason: observability.stopReason,
    requests: observability.requests,
    bytes: observability.bytes,
    staticPages: observability.staticPages,
    renderedPages: observability.renderedPages,
    renderNeededButUnavailable: observability.renderNeededButUnavailable.length,
    hydrationPages: observability.hydrationPages,
    pdfDocuments: observability.pdfDocuments,
    sitemapFetched: observability.sitemap.fetched.length,
    cacheFreshHits: observability.cacheFreshHits,
    revalidatedNotModified: observability.revalidatedNotModified,
    retries: observability.retries,
    retryAfterWaits: observability.retryAfterWaits,
    blocked: observability.blockedPages.length,
    skippedContent: observability.skippedContent.length,
    dimensionsMissing: observability.dimensionsMissing,
    yields: observability.extractorYields ?? null,
  });
}
