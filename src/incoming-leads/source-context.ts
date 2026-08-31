type JsonRecord = Record<string, unknown>;

export type SourceContextEntry = { label: string; value: string };

export type SourceContext = {
  downloadedTemplates: string[];
  downloadedResources: string[];
  bookingSelections: SourceContextEntry[];
  isBookingRequest: boolean;
};

const BOOKING_SELECTION_KEYS = new Set([
  "role",
  "eventModel",
  "launchTimeline",
  "operatingScale",
  "needsAdmissions",
  "organizationType",
  "organisationType",
  "primaryInterests",
  "migrationRequired",
  "needsScannerTools",
  "preferredNextStep",
  "needsOnsiteBoxOffice",
  "settlementOrPayoutNeeds",
  "currentTicketingProvider",
  "estimatedAttendanceOrVolume",
  "expectedAttendeeRange",
  "planningTimeframe",
  "currentChallenge",
]);

const NON_SELECTION_KEYS = new Set([
  "sourcePage",
  "sourceRoute",
  "page",
  "landingPath",
  "referrerUrl",
  "referrer",
  "clickSource",
  "clickedAt",
  "journeyId",
  "campaignId",
  "messageSendId",
  "eventId",
  "integrationContext",
  "schemaVersion",
  "resourceSlug",
  "resourceTitle",
  "resourceFamilyId",
  "contentType",
  "resourceLocale",
  "accessExpiresAt",
  "lifecycleStages",
  "requestedAssetIds",
  "authorisedAssetIds",
]);

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" || typeof value === "string") return String(value);
  if (Array.isArray(value)) {
    const items = value.map(asText).filter((item): item is string => Boolean(item));
    return items.length ? items.join(", ") : null;
  }
  return null;
}

function labelFor(key: string) {
  const labels: Record<string, string> = {
    organizationType: "Organisation type",
    organisationType: "Organisation type",
    operatingScale: "Operating scale",
    primaryInterests: "Primary interests",
    needsAdmissions: "Admissions needed",
    migrationRequired: "Migration required",
    needsScannerTools: "Scanner tools needed",
    needsOnsiteBoxOffice: "On-site box office needed",
    settlementOrPayoutNeeds: "Settlement / payout needs",
    currentTicketingProvider: "Current ticketing provider",
    estimatedAttendanceOrVolume: "Estimated attendance / volume",
    expectedAttendeeRange: "Expected attendance range",
    preferredNextStep: "Preferred next step",
    launchTimeline: "Launch timeline",
    eventModel: "Event model",
    planningTimeframe: "Planning timeframe",
    currentChallenge: "Current challenge",
  };
  return labels[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, (char) => char.toUpperCase());
}

function unique(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function isBookingRequest(submission: JsonRecord, payload: JsonRecord) {
  const category = String(submission.source_category ?? "").toUpperCase();
  const inquiryType = String(payload.inquiryType ?? "").toLowerCase();
  const sourcePage = String(submission.source_page ?? payload.sourcePage ?? "").toLowerCase();
  return category === "DEMO_REQUEST" || inquiryType.includes("book_demo") || inquiryType.includes("booking") || sourcePage.includes("/book-demo");
}

export function describeSourceContext(submission: JsonRecord): SourceContext {
  const payload = asRecord(submission.original_payload);
  const attribution = asRecord(payload.attributionContext);
  const contentType = String(attribution.contentType ?? "").toLowerCase();
  const resourceId = asText(submission.resource_identifier) ?? asText(attribution.resourceSlug);
  const templateId = asText(submission.template_identifier);
  const resourceTitle = asText(attribution.resourceTitle);
  const templateValue = resourceTitle && resourceId ? `${resourceTitle} · ${resourceId}` : resourceTitle ?? templateId ?? resourceId;
  const isTemplate = Boolean(templateId) || contentType === "template" || String(submission.source_category ?? "").toUpperCase() === "TEMPLATE_DOWNLOAD";
  const downloadedTemplates = isTemplate ? unique([templateValue]) : [];
  const downloadedResources = !isTemplate ? unique([resourceTitle && resourceId ? `${resourceTitle} · ${resourceId}` : resourceId]) : [];

  const booking = isBookingRequest(submission, payload);
  const directSelections = [payload.bookingSelections, payload.booking, payload.formSelections, payload.formData, payload.selections]
    .map(asRecord)
    .find((value) => Object.keys(value).length > 0);
  const selectionSource = directSelections ?? (booking ? attribution : {});
  const bookingSelections = Object.entries(selectionSource)
    .filter(([key]) => (directSelections ? !NON_SELECTION_KEYS.has(key) : BOOKING_SELECTION_KEYS.has(key)))
    .map(([key, value]) => ({ label: labelFor(key), value: asText(value) }))
    .filter((entry): entry is SourceContextEntry => Boolean(entry.value));

  return { downloadedTemplates, downloadedResources, bookingSelections, isBookingRequest: booking };
}

