import { createHash } from "node:crypto";
import type { ResearchRequest } from "./contracts.ts";
import { crawlVerifiedSource, extractFromFetchedDocuments, type CrawlBudget, type FetchLike, type ResolveHost } from "./source-discovery/crawler.ts";
import type { ProviderResult, ResearchContext } from "./executor.ts";

export type PublicWebProviderOptions = {
  fetchImpl?: FetchLike;
  resolveHost?: ResolveHost;
  now?: () => string;
  budget?: Partial<CrawlBudget>;
};

export function researchContextFromPayload(input: Record<string, unknown>): ResearchContext {
  const candidate = input.researchContext ?? input.context;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return {};
  const raw = candidate as Record<string, unknown>;
  const existingFacts = Array.isArray(raw.existingFacts)
    ? raw.existingFacts.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const fact = item as Record<string, unknown>;
      if (typeof fact.fieldName !== "string" || !fact.fieldName.trim()) return [];
      return [{ fieldName: fact.fieldName.trim().slice(0, 256), value: bounded(fact.value), evidenceRef: typeof fact.evidenceRef === "string" ? fact.evidenceRef.slice(0, 512) : null }];
    }).slice(0, 100)
    : undefined;
  return {
    targetName: typeof raw.targetName === "string" ? raw.targetName.trim().slice(0, 512) : null,
    targetWebsite: typeof raw.targetWebsite === "string" ? raw.targetWebsite.trim().slice(0, 4096) : null,
    locality: typeof raw.locality === "string" ? raw.locality.trim().slice(0, 512) : null,
    territory: raw.territory === "GB" || raw.territory === "ZA" ? raw.territory : undefined,
    existingFacts,
  };
}

const DEFAULT_BUDGET: CrawlBudget = {
  maxPages: 2,
  maxRequests: 4,
  maxBytesPerResponse: 500_000,
  maxRedirects: 2,
  maxRetries: 0,
  timeoutMs: 5_000,
  minRequestDelayMs: 0,
};

const SOCIAL_HOSTS = new Set([
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "tiktok.com",
  "linktr.ee",
]);
const BUSINESS_MAILBOXES = new Set([
  "admin",
  "bookings",
  "contact",
  "enquiries",
  "enquiry",
  "events",
  "hello",
  "hire",
  "info",
  "inquiries",
  "marketing",
  "office",
  "reservations",
  "sales",
  "support",
  "venue",
]);

function nowOf(options: PublicWebProviderOptions) { return options.now?.() ?? new Date().toISOString(); }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function normalise(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function tokens(value: string) { return new Set(normalise(value).split(/\s+/).filter((item) => item.length > 2)); }
function nameMatches(target: string, candidate: string) {
  const targetTokens = tokens(target);
  const candidateTokens = tokens(candidate);
  return targetTokens.size > 0 && [...targetTokens].every((token) => candidateTokens.has(token));
}
function hostOf(value: string) { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); }
function isSocialUrl(value: string) {
  const host = hostOf(value);
  return [...SOCIAL_HOSTS].some((socialHost) => host === socialHost || host.endsWith(`.${socialHost}`));
}
function sourceRecordUrl(request: ResearchRequest) {
  const sourceRecordId = request.subject.candidateReference?.sourceRecordId;
  return sourceRecordId && /^https:\/\//i.test(sourceRecordId) ? sourceRecordId : null;
}
function targetName(request: ResearchRequest, context: ResearchContext) {
  return context.targetName?.trim()
    || text(context.existingFacts?.find((item) => item.fieldName === "placeName")?.value)
    || (request.subject.candidateReference?.sourceRecordId && !/^https?:\/\//i.test(request.subject.candidateReference.sourceRecordId) ? request.subject.candidateReference.sourceRecordId : null)
    || request.subject.canonicalEntityId
    || null;
}
function targetWebsite(request: ResearchRequest, context: ResearchContext) {
  const candidate = context.targetWebsite?.trim() || sourceRecordUrl(request);
  if (!candidate || isSocialUrl(candidate)) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch { return null; }
}
function evidenceRef(request: ResearchRequest, fingerprint: string) { return `research:${request.requestId}:public_web:${fingerprint}`; }
function bounded(value: unknown, max = 2048): unknown {
  if (typeof value === "string") return value.slice(0, max);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => bounded(item, 512));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, item]) => [key, bounded(item, 512)]));
  return value;
}
function businessEmail(value: string) {
  const [mailbox, domain] = value.toLowerCase().split("@");
  return Boolean(mailbox && domain && BUSINESS_MAILBOXES.has(mailbox) && domain.includes("."));
}

function identityIsStrong(request: ResearchRequest, context: ResearchContext, identityFacts: Array<{ fieldName: string; value: unknown }>) {
  const name = targetName(request, context);
  if (!name) return false;
  const values = identityFacts.map((item) => text(item.value)).filter((item): item is string => Boolean(item));
  const nameSignal = values.some((value) => nameMatches(name, value));
  if (!nameSignal) return false;

  const addressValues = identityFacts.filter((item) => item.fieldName === "address").map((item) => text(item.value)).filter((item): item is string => Boolean(item));
  const existingAddress = text(context.existingFacts?.find((item) => ["address", "formattedAddress"].includes(item.fieldName))?.value);
  const locality = context.locality?.trim();
  const locationRequired = Boolean(locality || existingAddress);
  const locationSignal = Boolean(
    (locality && addressValues.some((value) => normalise(value).includes(normalise(locality))))
      || (existingAddress && addressValues.some((value) => normalise(value).includes(normalise(existingAddress))))
  );
  if (locationRequired && !locationSignal) return false;

  const hasTitle = identityFacts.some((item) => item.fieldName === "siteName" && text(item.value) && nameMatches(name, text(item.value)!));
  const hasHeading = identityFacts.some((item) => item.fieldName === "explicitVenueName" && text(item.value) && nameMatches(name, text(item.value)!));
  const existingPlaceEvidence = Boolean(
    context.existingFacts?.some((item) => item.fieldName === "placeId")
      && context.existingFacts?.some((item) => item.fieldName === "placeName" && nameMatches(name, text(item.value) ?? "")),
  );
  return nameSignal && (locationSignal || (hasTitle && hasHeading) || existingPlaceEvidence);
}

function unresolved(request: ResearchRequest, purpose: string, message: string, error?: ProviderResult["error"]): ProviderResult {
  return { provider: "PUBLIC_WEB", purpose, facts: [], evidence: [], unknowns: [message], conflicts: [], cost: { currency: "USD", amount: 0 }, ...(error ? { error } : {}) };
}

export function createPublicWebProvider(options: PublicWebProviderOptions = {}) {
  return async ({ request, context }: { request: ResearchRequest; context: ResearchContext }): Promise<ProviderResult> => {
    const purpose = request.researchPurpose;
    const website = targetWebsite(request, context);
    if (!website) return unresolved(request, purpose, "No evidenced public first-party HTTPS website was available for bounded discovery.");

    try {
      const crawl = await crawlVerifiedSource({
        verifiedUrl: website,
        requestedExtractors: ["IDENTITY", "PUBLIC_CONTACT"],
        budget: { ...DEFAULT_BUDGET, ...options.budget },
        fetchImpl: options.fetchImpl,
        resolveHost: options.resolveHost,
      });
      const extracted = extractFromFetchedDocuments(crawl.documents, ["IDENTITY", "PUBLIC_CONTACT"]);
      if (!crawl.documents.length) {
        return unresolved(request, purpose, "Public-web discovery produced no safe first-party document.", { code: "PUBLIC_WEB_UNAVAILABLE", message: crawl.stats.warnings.join(" ") || "No safe public-web document was fetched.", retryable: true });
      }
      if (!identityIsStrong(request, context, extracted.identityFacts)) {
        return unresolved(request, purpose, "The candidate site did not provide strong same-entity venue identity evidence.");
      }

      const observedAt = nowOf(options);
      const finalUrl = crawl.finalUrl;
      const origin = new URL(finalUrl).origin;
      const contacts = extracted.publicContacts.filter((item) => {
        if (new URL(item.sourceUrl).origin !== origin) return false;
        if (item.type === "EMAIL") return businessEmail(item.value);
        if (item.type === "CONTACT_FORM") {
          try { return new URL(item.value).origin === origin; } catch { return false; }
        }
        return item.type === "PHONE";
      });
      const fingerprint = createHash("sha256").update(`${finalUrl}:${crawl.documents.map((item) => item.sourceHash).join(":")}`).digest("hex").slice(0, 24);
      const ref = evidenceRef(request, fingerprint);
      const evidence = [{
        evidenceRef: ref,
        provider: "PUBLIC_WEB" as const,
        externalRecordId: `public-web:${fingerprint}`,
        sourceUrl: finalUrl,
        observedAt,
        dataClassification: "PUBLIC" as const,
        licenceType: "PUBLIC_SOURCE",
        payload: bounded({
          kind: "FIRST_PARTY_WEBSITE",
          verifiedUrl: website,
          finalUrl,
          identityFacts: extracted.identityFacts,
          contacts: contacts.map((item) => ({ type: item.type, value: item.value, sourceUrl: item.sourceUrl })),
          sourceHashes: crawl.documents.map((item) => item.sourceHash),
        }),
      }];
      const facts: ProviderResult["facts"] = [{ fieldName: "officialWebsite", value: finalUrl, evidenceRef: ref, confidence: 0.95, observedAt, subjectEntityType: request.subject.entityType, canonicalEntityId: request.subject.canonicalEntityId }];
      if (purpose === "PUBLIC_CONTACT") {
        for (const contact of contacts) {
          const fieldName = contact.type === "EMAIL" ? "publicContactEmail" : contact.type === "PHONE" ? "publicContactPhone" : contact.type === "CONTACT_FORM" ? "contactFormUrl" : null;
          if (fieldName) facts.push({ fieldName, value: contact.value, evidenceRef: ref, confidence: contact.confidence, observedAt, subjectEntityType: request.subject.entityType, canonicalEntityId: request.subject.canonicalEntityId });
        }
        if (!contacts.length) return { provider: "PUBLIC_WEB", purpose, facts: [facts[0]!], evidence, unknowns: ["The verified first-party site published no bounded business email, phone, or same-origin contact form."], conflicts: [], cost: { currency: "USD", amount: 0 } };
      }
      return { provider: "PUBLIC_WEB", purpose, facts, evidence, unknowns: [], conflicts: [], cost: { currency: "USD", amount: 0 } };
    } catch (error) {
      return unresolved(request, purpose, "Public-web discovery failed safely without retaining unverified facts.", { code: "PUBLIC_WEB_UNAVAILABLE", message: error instanceof Error ? error.message : "Public-web provider failed safely.", retryable: true });
    }
  };
}
