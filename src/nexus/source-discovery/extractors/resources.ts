import { createHash } from "node:crypto";
import type { SourceExtractor } from "../../contracts.ts";
import { hrefTags, selfClosingTags, tags, visibleText } from "../html.ts";
import { canonicalHttpsUrl } from "../network.ts";
import type { FetchedDocument } from "../types.ts";

function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function sameOrigin(value: string, base: string): string | null { const normalized = canonicalHttpsUrl(value, base); return normalized && new URL(normalized).origin === new URL(base).origin ? normalized : null; }
function firstMeta(html: string, key: string): string | null { for (const tag of selfClosingTags(html, "meta")) if (tag.attrs.property?.toLowerCase() === key || tag.attrs.name?.toLowerCase() === key) return text(tag.attrs.content); return null; }
function labelledAddress(html: string): string | null { return text(visibleText(html).match(/\bADDRESS\b\s+(.{5,240}?)(?=\b(?:CONTACT(?:\s+US)?|PHONE|EMAIL|COMPANY)\b|$)/i)?.[1]); }

type EvidenceItem = { evidenceRef: string };
export type IdentityFact = EvidenceItem & { fieldName: string; value: unknown; sourceUrl: string };
export type PublicContact = EvidenceItem & { type: string; value: string; sourceUrl: string; confidence: number | null; reviewRequired: boolean };
export type VenueFact = EvidenceItem & { fieldName: string; value: unknown; sourceUrl: string; confidence: number | null; reviewRequired: boolean };
export type ImageCandidate = EvidenceItem & { sourceImageUrl: string; sourcePageUrl: string; filename: string | null; alt: string | null; title: string | null; caption: string | null; width: number | null; height: number | null; mime: string | null; likelyRole: string; exactVenue: boolean | null; discoveredAt: string; originDomain: string; rightsState: "PERMISSION_REQUIRED" };
export type ResourceExtraction = { identityFacts: IdentityFact[]; publicContacts: PublicContact[]; venueFacts: VenueFact[]; imageCandidates: ImageCandidate[]; evidenceRefs: string[] };

function extractDocument(document: FetchedDocument, extractors: SourceExtractor[]): ResourceExtraction {
  const out: ResourceExtraction = { identityFacts: [], publicContacts: [], venueFacts: [], imageCandidates: [], evidenceRefs: [] };
  const ref = (kind: string, value: string) => { const evidenceRef = `source:${document.sourceHash}:${kind}:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`; out.evidenceRefs.push(evidenceRef); return evidenceRef; };
  if (extractors.includes("IDENTITY")) {
    const titleTag = tags(document.body, "title")[0]; const title = text(titleTag ? visibleText(titleTag.inner) : null) ?? firstMeta(document.body, "og:site_name");
    const headingTag = tags(document.body, "h1")[0]; const heading = text(headingTag ? visibleText(headingTag.inner) : null);
    const addressTag = tags(document.body, "address")[0]; const address = text(addressTag ? visibleText(addressTag.inner) : null) ?? labelledAddress(document.body);
    const description = firstMeta(document.body, "description") ?? firstMeta(document.body, "og:description");
    if (title) out.identityFacts.push({ fieldName: "siteName", value: title, sourceUrl: document.url, evidenceRef: ref("identity", `siteName:${title}`) });
    if (heading && heading !== title) out.identityFacts.push({ fieldName: "explicitVenueName", value: heading, sourceUrl: document.url, evidenceRef: ref("identity", `explicitVenueName:${heading}`) });
    if (address) out.identityFacts.push({ fieldName: "address", value: address, sourceUrl: document.url, evidenceRef: ref("identity", `address:${address}`) });
    if (description) out.identityFacts.push({ fieldName: "siteDescription", value: description, sourceUrl: document.url, evidenceRef: ref("identity", `siteDescription:${description}`) });
  }
  if (extractors.includes("PUBLIC_CONTACT")) {
    const seen = new Set<string>();
    for (const anchor of hrefTags(document.body)) {
      const href = (anchor.attrs.href ?? "").trim(); let type: string | null = null; let value: string | null = null;
      if (/^mailto:/i.test(href)) { type = "EMAIL"; value = href.replace(/^mailto:/i, "").split("?")[0]!.trim().toLowerCase(); }
      else if (/^tel:/i.test(href)) { type = "PHONE"; value = href.replace(/^tel:/i, "").trim(); }
      else if (/whatsapp|wa\.me/i.test(href)) { type = "WHATSAPP"; value = href; }
      else if (/messenger|facebook\.com\/messages/i.test(href)) { type = "BUSINESS_MESSAGING"; value = href; }
      if (type && value && !seen.has(`${type}:${value}`)) { seen.add(`${type}:${value}`); out.publicContacts.push({ type, value, sourceUrl: document.url, confidence: type === "EMAIL" ? 0.95 : 0.85, reviewRequired: false, evidenceRef: ref("contact", `${type}:${value}`) }); }
    }
    for (const form of tags(document.body, "form")) { const action = form.attrs.action?.trim() ? sameOrigin(form.attrs.action, document.url) : document.url; if (action && !seen.has(`CONTACT_FORM:${action}`)) { seen.add(`CONTACT_FORM:${action}`); out.publicContacts.push({ type: "CONTACT_FORM", value: action, sourceUrl: document.url, confidence: 0.8, reviewRequired: false, evidenceRef: ref("contact", `CONTACT_FORM:${action}`) }); } }
  }
  if (extractors.includes("VENUE_FACTS")) {
    const body = visibleText(document.body); const patterns: Array<[string, RegExp]> = [["capacity", /(?:capacity|up to|standing|seated)\s*[:\-]?\s*[^.]{0,120}\b\d{2,5}\b[^.]{0,80}/i], ["spaces", /(?:rooms?|spaces?|hall|studio|suite|gallery)\s*[:\-]?\s*[^.]{0,180}/i], ["accessibility", /(?:accessible|wheelchair|step[- ]free|disabled access)[^.]{0,180}/i], ["parking", /(?:parking|car park|park and ride)[^.]{0,180}/i], ["publicTransport", /(?:public transport|train station|bus|underground|tube|tram)[^.]{0,180}/i], ["catering", /(?:catering|kitchen|bar|refreshments)[^.]{0,180}/i], ["avProduction", /(?:audio visual|\bAV\b|production|sound system|lighting|projector)[^.]{0,180}/i], ["wifi", /(?:wi[- ]?fi|wireless internet)[^.]{0,180}/i], ["accommodation", /(?:accommodation|hotel rooms?|bedrooms?)[^.]{0,180}/i], ["loadingAccess", /(?:loading bay|loading access|load[- ]?in)[^.]{0,180}/i], ["outdoorSpace", /(?:outdoor space|terrace|garden|courtyard|marquee)[^.]{0,180}/i], ["power", /(?:power supply|three[- ]?phase|power outlets?)[^.]{0,180}/i], ["staging", /(?:staging|stage)[^.]{0,180}/i], ["cloakroom", /(?:cloakroom|coat check)[^.]{0,180}/i]];
    for (const [fieldName, pattern] of patterns) { const value = body.match(pattern)?.[0]?.trim(); if (value) out.venueFacts.push({ fieldName, value, sourceUrl: document.url, confidence: 0.8, reviewRequired: false, evidenceRef: ref("venue", `${fieldName}:${value}`) }); }
  }
  if (extractors.includes("IMAGE_CANDIDATES")) for (const imageTag of selfClosingTags(document.body, "img")) { const src = canonicalHttpsUrl(imageTag.attrs.src ?? "", document.url); if (!src) continue; const image = new URL(src); const filename = image.pathname.split("/").pop() || null; out.imageCandidates.push({ sourceImageUrl: src, sourcePageUrl: document.url, filename, alt: text(imageTag.attrs.alt), title: text(imageTag.attrs.title), caption: null, width: Number(imageTag.attrs.width) || null, height: Number(imageTag.attrs.height) || null, mime: null, likelyRole: /logo/i.test(`${filename} ${imageTag.attrs.alt ?? ""}`) ? "LOGO" : "OTHER", exactVenue: null, discoveredAt: document.observedAt, originDomain: image.hostname, rightsState: "PERMISSION_REQUIRED", evidenceRef: ref("image", src) }); }
  return out;
}

export function extractResourcesFromDocuments(documents: FetchedDocument[], extractors: SourceExtractor[]): ResourceExtraction {
  const merged: ResourceExtraction = { identityFacts: [], publicContacts: [], venueFacts: [], imageCandidates: [], evidenceRefs: [] };
  for (const document of documents) { const item = extractDocument(document, extractors); merged.identityFacts.push(...item.identityFacts); merged.publicContacts.push(...item.publicContacts); merged.venueFacts.push(...item.venueFacts); merged.imageCandidates.push(...item.imageCandidates); merged.evidenceRefs.push(...item.evidenceRefs); }
  const dedupe = <T>(items: T[], key: (item: T) => string) => [...new Map(items.map((item) => [key(item), item])).values()];
  return { identityFacts: dedupe(merged.identityFacts, (item) => `${item.fieldName}:${JSON.stringify(item.value)}:${item.sourceUrl}`), publicContacts: dedupe(merged.publicContacts, (item) => `${item.type}:${item.value}`), venueFacts: dedupe(merged.venueFacts, (item) => `${item.fieldName}:${JSON.stringify(item.value)}:${item.sourceUrl}`), imageCandidates: dedupe(merged.imageCandidates, (item) => item.sourceImageUrl), evidenceRefs: [...new Set(merged.evidenceRefs)] };
}
