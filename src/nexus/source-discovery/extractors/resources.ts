import { createHash } from "node:crypto";
import type { SourceExtractor } from "../../contracts.ts";
import { hrefTags, selfClosingTags, tags, visibleText } from "../html.ts";
import { canonicalHttpsUrl } from "../network.ts";
import type { FetchedDocument } from "../types.ts";

export type IdentityFact = { fieldName: string; value: unknown; sourceUrl: string; evidenceRef: string };
export type PublicContact = { type: string; value: string; sourceUrl: string; confidence: number | null; reviewRequired: boolean; evidenceRef: string };
export type VenueFact = { fieldName: string; value: unknown; sourceUrl: string; confidence: number | null; reviewRequired: boolean; evidenceRef: string };
type RightsState = "UNKNOWN_RIGHTS" | "PERMISSION_REQUIRED" | "RIGHTS_RESERVED" | "VERIFIED_REUSABLE";
type RightsEvidence = { basis: string; sourceUrl: string; evidenceRef: string; statement: string };
export type ImageCandidate = { sourceImageUrl: string; sourcePageUrl: string; filename: string | null; alt: string | null; title: string | null; caption: string | null; width: number | null; height: number | null; mime: string | null; likelyRole: string; exactVenue: boolean | null; discoveredAt: string; originDomain: string; rightsState: RightsState; rightsEvidence: RightsEvidence | null; operatorConfirmed: false };
export type ResourceExtraction = { identityFacts: IdentityFact[]; publicContacts: PublicContact[]; venueFacts: VenueFact[]; imageCandidates: ImageCandidate[]; evidenceRefs: string[]; warnings: string[] };

const clean = (value: unknown): string | null => typeof value === "string" ? value.trim().replace(/\s+/g, " ") || null : null;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : value == null ? [] : [value];
const typed = (node: Record<string, unknown>, name: string) => list(node["@type"]).some((type) => String(type).toLowerCase().split(/[\/#]/).pop() === name.toLowerCase());
const ref = (doc: FetchedDocument, kind: string, value: string) => `source:${doc.sourceHash}:${kind}:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
function sameOrigin(value: string, base: string): string | null {
  const result = canonicalHttpsUrl(value, base);
  return result && new URL(result).origin === new URL(base).origin ? result : null;
}
function addIdentity(out: ResourceExtraction, doc: FetchedDocument, fieldName: string, value: unknown) {
  if (value == null || value === "") return;
  const evidenceRef = ref(doc, "identity", `${fieldName}:${JSON.stringify(value)}`);
  out.identityFacts.push({ fieldName, value, sourceUrl: doc.url, evidenceRef }); out.evidenceRefs.push(evidenceRef);
}
function addContact(out: ResourceExtraction, doc: FetchedDocument, type: string, raw: string | null, confidence: number, reviewRequired = false) {
  if (!raw) return;
  const value = type === "EMAIL" ? raw.toLowerCase() : raw;
  if (type === "EMAIL" && !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) return;
  const evidenceRef = ref(doc, "contact", `${type}:${value}`);
  out.publicContacts.push({ type, value, sourceUrl: doc.url, confidence, reviewRequired, evidenceRef }); out.evidenceRefs.push(evidenceRef);
}
function addFact(out: ResourceExtraction, doc: FetchedDocument, fieldName: string, value: unknown, confidence = 0.8) {
  const evidenceRef = ref(doc, "venue", `${fieldName}:${JSON.stringify(value)}`);
  out.venueFacts.push({ fieldName, value, sourceUrl: doc.url, confidence, reviewRequired: false, evidenceRef }); out.evidenceRefs.push(evidenceRef);
}
function structuredNodes(doc: FetchedDocument): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 8 || nodes.length >= 200) return;
    if (Array.isArray(value)) { value.forEach((item) => visit(item, depth + 1)); return; }
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (node["@type"]) nodes.push(node);
    for (const [key, item] of Object.entries(node)) if (key !== "@context" && item && typeof item === "object") visit(item, depth + 1);
  };
  for (const script of tags(doc.body, "script")) if (/application\/ld\+json/i.test(script.attrs.type ?? "")) {
    try { visit(JSON.parse(script.inner), 0); } catch { /* bad JSON-LD cannot suppress other evidence */ }
  }
  return nodes;
}
function structuredAddress(value: unknown): string | null {
  if (typeof value === "string") return clean(value);
  const address = object(value);
  const parts = ["streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry"].map((key) => clean(address[key])).filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}
function structured(doc: FetchedDocument, out: ResourceExtraction, extractors: SourceExtractor[]) {
  const nodes = structuredNodes(doc);
  const hasLocalBusiness = nodes.some((node) => typed(node, "LocalBusiness") && (!clean(node.url) || sameOrigin(clean(node.url)!, doc.url)));
  for (const node of nodes) {
    if (typed(node, "ContactPoint") && (/^\/(?:index\.html?)?$/i.test(new URL(doc.url).pathname) || /\b(?:contact|enquir\w*|book\w*|hire)\b/i.test(new URL(doc.url).pathname))
      && (!clean(node.email) || clean(node.email)!.toLowerCase().endsWith(`@${new URL(doc.url).hostname.replace(/^www\./, "")}`))
      && /\b(?:book\w*|enquir\w*|venue hire)\b/i.test(clean(node.contactType) ?? "")) {
      if (extractors.includes("PUBLIC_CONTACT")) { addContact(out, doc, "PHONE", clean(node.telephone), 0.9); addContact(out, doc, "EMAIL", clean(node.email), 0.9); }
      if (extractors.includes("IDENTITY")) addIdentity(out, doc, "contactType", clean(node.contactType));
      continue;
    }
    const organisation = ["Organization", "LocalBusiness"].some((name) => typed(node, name));
    const place = ["Place", "EventVenue", "CivicStructure"].some((name) => typed(node, name));
    const business = organisation || place;
    if (!business || (clean(node.url) && !sameOrigin(clean(node.url)!, doc.url))) continue;
    if (business && extractors.includes("IDENTITY")) {
      addIdentity(out, doc, typed(node, "Organization") && !typed(node, "LocalBusiness") && hasLocalBusiness ? "operatorName" : organisation ? "siteName" : "placeName", clean(node.name));
      addIdentity(out, doc, "address", structuredAddress(node.address));
      const website = clean(node.url); if (website) addIdentity(out, doc, "website", sameOrigin(website, doc.url));
      for (const link of list(node.sameAs)) if (clean(link)) addIdentity(out, doc, "sameAs", clean(link));
    }
    if (business && extractors.includes("VENUE_FACTS")) {
      const geo = object(node.geo); const latitude = Number(geo.latitude); const longitude = Number(geo.longitude);
      if (geo.latitude != null && geo.longitude != null && Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) addFact(out, doc, "geo", { latitude, longitude }, 0.9);
      const access = clean(node.accessibilityFeature) ?? clean(node.accessibilitySummary); if (access) addFact(out, doc, "accessibility", access, 0.9);
    }
    if (extractors.includes("PUBLIC_CONTACT")) {
      addContact(out, doc, "PHONE", clean(node.telephone), 0.9); addContact(out, doc, "EMAIL", clean(node.email), 0.9);
      for (const point of list(node.contactPoint)) {
        const contact = object(point);
        addContact(out, doc, "PHONE", clean(contact.telephone), 0.9); addContact(out, doc, "EMAIL", clean(contact.email), 0.9);
        if (extractors.includes("IDENTITY")) addIdentity(out, doc, "contactType", clean(contact.contactType));
      }
    }
  }
}
function firstMeta(html: string, key: string): string | null {
  for (const tag of selfClosingTags(html, "meta")) if (tag.attrs.property?.toLowerCase() === key || tag.attrs.name?.toLowerCase() === key) return clean(tag.attrs.content);
  return null;
}
function contacts(doc: FetchedDocument, out: ResourceExtraction) {
  const path = new URL(doc.url).pathname;
  if (/\b(?:accommodation|hotels?|suppliers?|partners?|sponsors?|directory|search|privacy|terms)\b/i.test(path)) return;
  const body = doc.body.replace(/<section\b([^>]*)>[\s\S]*?<\/section>/gi, (section, attrs: string) =>
    /\b(?:ticketing[\s-]*provider|third[\s-]*party|website[\s-]*designer|external[\s-]*support)\b/i.test(`${attrs} ${visibleText(section).slice(0, 100)}`) ? " " : section);
  const footer = tags(body, "footer").map((tag) => tag.inner).join(" ");
  const privacy: Array<{ type: string; value: string }> = [];
  for (const anchor of hrefTags(body)) {
    const href = (anchor.attrs.href ?? "").trim(); const label = visibleText(anchor.inner);
    if (/^mailto:/i.test(href)) {
      const email = href.slice(7).split("?")[0] ?? "";
      if (/^(?:supplier|hotline|feedback|webmaster|privacy|dpo)/i.test(email.split("@")[0] ?? "")) continue;
      const inVendorFooter = footer.includes(href) && /\b(?:website|site)\s+(?:by|design)|powered by/i.test(visibleText(footer))
        && !email.toLowerCase().endsWith(`@${new URL(doc.url).hostname.replace(/^www\./, "")}`);
      if (inVendorFooter || /\b(?:designer|developer|webmaster|ticketing provider)\b/i.test(label)) continue;
      if (/\b(?:privacy|data protection|dpo)\b/i.test(`${email} ${label}`)) privacy.push({ type: "EMAIL", value: email });
      else addContact(out, doc, "EMAIL", email, 0.95);
    }
    else if (/^tel:/i.test(href)) addContact(out, doc, "PHONE", href.slice(4), 0.9);
    else if (/^(?:https:\/\/(?:wa\.me\/\d|(?:api\.)?whatsapp\.com\/send\?phone=)|whatsapp:\/\/send\?phone=)/i.test(href)) addContact(out, doc, "WHATSAPP", href, 0.85);
    else if (/messenger|facebook\.com\/messages/i.test(href)) addContact(out, doc, "BUSINESS_MESSAGING", href, 0.75);
    else if (/\bcontact(?:\s+us)?\b/i.test(label)) {
      const url = sameOrigin(href, doc.url);
      if (url && /\bcontact\b/i.test(new URL(url).pathname)) addContact(out, doc, "CONTACT_FORM", url, 0.6, true);
    }
  }
  for (const form of tags(body, "form")) {
    const descriptor = `${form.attrs.action ?? ""} ${form.attrs.id ?? ""} ${form.attrs.class ?? ""} ${form.attrs.name ?? ""}`;
    if (/\b(?:search|comments?|newsletter|login|subscribe)\b|wp-comments-post/i.test(descriptor)) continue;
    if (!/\b(?:contact|enquir\w*|book\w*|hire|message|sendmail)\b/i.test(descriptor)
      && !(/<textarea\b/i.test(form.inner) && /(?:name|id)=["']?email/i.test(form.inner))) continue;
    const action = form.attrs.action?.trim() ? sameOrigin(form.attrs.action, doc.url) : doc.url;
    if (action) addContact(out, doc, "CONTACT_FORM", action, 0.8);
  }
  const primary = visibleText(body.replace(/<footer\b[\s\S]*?<\/footer>/gi, " "));
  for (const match of primary.matchAll(/\b(?:email|e-mail|enquiries|bookings?)\s*[:\-]?\s*([a-z0-9._%+-]+\s*(?:@|\[at\]|\(at\))\s*[a-z0-9.-]+\.[a-z]{2,})/gi)) {
    const value = match[1]!.replace(/\s*(?:\[at\]|\(at\)|@)\s*/i, "@");
    addContact(out, doc, "EMAIL", value, /\[at\]|\(at\)/i.test(match[1]!) ? 0.8 : 0.9);
  }
  for (const match of primary.matchAll(/\b(?:call(?: us)?|phone|telephone|tel)\s*[:\-]?\s*(\+?\d[\d\s().-]{7,}\d)/gi)) addContact(out, doc, "PHONE", clean(match[1]), 0.85);
  for (const match of primary.matchAll(/\bwhats\s*app\s*[:\-]?\s*(\+?\d[\d\s().-]{7,}\d)/gi)) addContact(out, doc, "WHATSAPP", clean(match[1]), 0.8);
  if (!out.publicContacts.some((item) => item.type === "EMAIL" || item.type === "PHONE")) for (const item of privacy) addContact(out, doc, item.type, item.value, 0.4, true);
}
const practical: Array<[string, RegExp]> = [
  ["accessibility", /\b(?:step[- ]free access|wheelchair access|accessible toilets?|disabled access)\b[^.]{0,100}/i],
  ["parking", /\b(?:on[- ]site parking|car park|parking spaces?|park and ride)\b[^.]{0,100}/i],
  ["publicTransport", /\b(?:public transport|train station|bus stop|underground station|tube station|tram stop)\b[^.]{0,100}/i],
  ["catering", /\b(?:in[- ]house catering|external catering|catering available)\b[^.]{0,100}/i],
  ["bar", /\b(?:licensed bar|private bar|bar service)\b[^.]{0,100}/i],
  ["kitchen", /\b(?:commercial kitchen|catering kitchen|kitchen facilities)\b[^.]{0,100}/i],
  ["avProduction", /\b(?:AV equipment|audio[- ]visual equipment|production facilities|projector)\b[^.]{0,100}/i],
  ["sound", /\b(?:sound system|PA system|sound equipment)\b[^.]{0,100}/i],
  ["lighting", /\b(?:stage lighting|lighting rig|production lighting)\b[^.]{0,100}/i],
  ["staging", /\b(?:built[- ]in stage|raised stage|stage facilities|staging available|modular staging|stage equipment)\b[^.]{0,100}/i],
  ["loadingAccess", /\b(?:loading bay|loading access|load[- ]?in)\b[^.]{0,100}/i],
  ["wifi", /\b(?:wi[- ]?fi|wireless internet)\b[^.]{0,100}/i],
  ["power", /\b(?:three[- ]phase power|power outlets?|power supply)\b[^.]{0,100}/i],
  ["outdoorSpace", /\b(?:outdoor space|terrace|garden|courtyard)\b[^.]{0,100}/i],
  ["accommodation", /\b(?:on[- ]site accommodation|hotel rooms?|bedrooms?)\b[^.]{0,100}/i],
  ["cloakroom", /\b(?:cloakroom|coat check)\b[^.]{0,100}/i],
  ["hireSuitability", /\b(?:available|suitable)\s+for\s+(?:weddings?|receptions?|corporate events?|conferences?|private events?|meetings?|exhibitions?)\b[^.]{0,100}/i],
];
function venueFacts(doc: FetchedDocument, out: ResourceExtraction) {
  const body = visibleText(doc.body);
  for (const [field, pattern] of practical) { const statement = clean(body.match(pattern)?.[0]); if (statement && !/^no\s/i.test(statement)) addFact(out, doc, field, statement); }
  const headings = [...doc.body.matchAll(/<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi)];
  const sections = headings.length ? headings.map((match, index) => ({ name: clean(visibleText(match[2]!)), body: visibleText(doc.body.slice((match.index ?? 0) + match[0].length, headings[index + 1]?.index ?? doc.body.length)) })) : [{ name: null, body }];
  for (const section of sections) {
    const candidateName = section.name?.replace(/\s+(?:hire|facilities)$/i, "") ?? null;
    const named = section.name && /^[A-Za-z]/.test(section.name)
      && !/^(?:ideal for|capacities|capacity|our spaces|venue spaces|the space|rooms|facilities|venue|contact|home|gallery|events|newsletter|more at|venue hire)/i.test(section.name)
      && !/\b(?:where|included|signup|follow|blog|homepage|experience|everything|enquiry)\b/i.test(section.name)
      && !/\b(?:event|capacity)\b/i.test(section.name)
      && !/^(?:conference|corporate|wedding)\s+venue$/i.test(section.name)
      && candidateName!.replace(/[():/]/g, "").split(/\s+/).filter(Boolean).every((word) => /^[A-Z][A-Za-z0-9'&-]*$/.test(word) || /^\d+$/.test(word))
      && section.name.split(/\s+/).length <= 6 && !/[.!?]$/.test(section.name)
      && !/\baccommodation\b/i.test(new URL(doc.url).pathname);
    const strongName = /\b(?:hall|room|suite|studio|theatre|auditorium|vault|ballroom)\b/i.test(section.name ?? "");
    const nearbyCapacity = /\b(?:capacity|standing|seated|up to)\b/i.test(section.body.slice(0, 160));
    const space = named && (strongName || nearbyCapacity) ? candidateName : null;
    if (space) addFact(out, doc, "spaces", space, 0.85);
    const patterns = [
      /\b(banquet|reception|theatre|theater|standing|seated|classroom|cabaret|dinner|conference)\s+(?:capacity\s*)?[:\-]?\s*(\d{1,3}(?:,\d{3})+|\d{1,5})\b/gi,
      /\bcapacity\s*(?:of|:|-)?\s*(\d{1,3}(?:,\d{3})+|\d{1,5})\s*(banquet|reception|theatre|theater|standing|seated|classroom|cabaret|dinner|conference)?\b/gi,
      /\bup to\s*(\d{1,3}(?:,\d{3})+|\d{1,5})\s*(standing|seated|guests?|people)\b/gi,
      /\b(\d{1,3}(?:,\d{3})+|\d{1,5})\s*(standing|seated)\b/gi,
    ];
    for (const [index, pattern] of patterns.entries()) for (const match of section.body.matchAll(pattern)) {
      const count = Number((index === 0 ? match[2] : match[1])?.replaceAll(",", ""));
      if (!Number.isSafeInteger(count) || count < 1 || count > 100000) continue;
      const rawLayout = index === 0 ? match[1] : match[2];
      const layout = rawLayout ? /^(?:guests?|people)$/i.test(rawLayout) ? "unspecified" : rawLayout.toLowerCase().replace("theater", "theatre") : "unspecified";
      addFact(out, doc, "capacity", { space, layout, count, statement: match[0].trim() }, 0.9);
    }
    if (/\b(?:room|space|venue)\s+capacit(?:y|ies)\b/i.test(section.body)) {
      const listed = [...section.body.matchAll(/\b([A-Z][\w'&-]*(?:\s+[A-Z][\w'&-]*){0,3})\s*[–—-]\s*(\d{2,5})\b/g)];
      if (listed.length >= 2) for (const match of listed) {
        const name = match[1]!.replace(/^(?:(?:Room|Space|Venue)\s+)?Capacit(?:y|ies)\s+/i, "").trim();
        const namedSpace = /^(?:venue|room|space)\s+capacity$/i.test(name) ? null : name;
        if (namedSpace) addFact(out, doc, "spaces", namedSpace, 0.85);
        addFact(out, doc, "capacity", { space: namedSpace, layout: "unspecified", count: Number(match[2]), statement: match[0].trim() }, 0.85);
      }
    }
  }
}
function imageRights(doc: FetchedDocument): { rightsState: RightsState; rightsEvidence: RightsEvidence | null } {
  const body = visibleText(doc.body);
  const cases: Array<[RegExp, RightsState, string]> = [
    [/(?:©|copyright)\s*\d{4}[^.]{0,150}\ball rights reserved\b|\ball rights reserved\b/i, "RIGHTS_RESERVED", "EXPLICIT_RIGHTS_RESERVED"],
    [/(?:©|\bcopyright\b)\s*(?:19|20)\d{2}\b[^.]{0,100}/i, "RIGHTS_RESERVED", "EXPLICIT_RIGHTS_RESERVED"],
    [/(?:images?|photos?|photographs?)[^.]{0,100}\b(?:requires?\s+(?:written|prior)?\s*permission|(?:written|prior)\s+permission\s+(?:is\s+)?required|authorisation\s+required|authorization\s+required)\b[^.]{0,100}/i, "PERMISSION_REQUIRED", "EXPLICIT_PERMISSION_REQUIRED"],
    [/(?:images?|photos?|photographs?)[^.]{0,100}\b(?:CC\s*BY(?:\s*-?SA)?\s*4\.0|CC0|public domain|commercial reuse permitted|free for commercial use)\b[^.]{0,100}/i, "VERIFIED_REUSABLE", "EXPLICIT_COMMERCIAL_REUSE_PERMISSION"],
  ];
  for (const [pattern, rightsState, defaultBasis] of cases) {
    const statement = clean(body.match(pattern)?.[0]); if (!statement) continue;
    const basis = rightsState === "VERIFIED_REUSABLE" ? /\bCC\s*BY\s*-?SA/i.test(statement) ? "CC_BY_SA" : /\bCC\s*BY/i.test(statement) ? "CC_BY" : /\bCC0\b/i.test(statement) ? "CC0" : /public domain/i.test(statement) ? "PUBLIC_DOMAIN" : defaultBasis : defaultBasis;
    return { rightsState, rightsEvidence: { basis, sourceUrl: doc.url, evidenceRef: ref(doc, "rights", statement), statement } };
  }
  return { rightsState: "UNKNOWN_RIGHTS", rightsEvidence: null };
}
function sitewidePhotoRestriction(doc: FetchedDocument): { rightsState: "PERMISSION_REQUIRED" | "RIGHTS_RESERVED"; rightsEvidence: RightsEvidence } | null {
  const body = visibleText(doc.body);
  const scope = /\ball\s+(?:images|photos|photographs)\s+on\s+(?:this|our)\s+(?:website|site)\b[^.]{0,150}/i;
  const statement = clean(body.match(scope)?.[0]);
  if (!statement) return null;
  const restricted = /\ball rights reserved\b|(?:©|\bcopyright\b)\s*(?:19|20)\d{2}\b/i.test(statement);
  const permission = /\b(?:requires?\s+(?:written|prior)?\s*permission|(?:written|prior)\s+permission\s+(?:is\s+)?required|authorisation\s+required|authorization\s+required)\b/i.test(statement);
  if (!restricted && !permission) return null;
  const rightsState = restricted ? "RIGHTS_RESERVED" : "PERMISSION_REQUIRED";
  return { rightsState, rightsEvidence: { basis: restricted ? "EXPLICIT_RIGHTS_RESERVED" : "EXPLICIT_PERMISSION_REQUIRED",
    sourceUrl: doc.url, evidenceRef: ref(doc, "rights", statement), statement } };
}
function images(doc: FetchedDocument, out: ResourceExtraction) {
  const rights = imageRights(doc); if (rights.rightsEvidence) out.evidenceRefs.push(rights.rightsEvidence.evidenceRef);
  for (const tag of selfClosingTags(doc.body, "img")) {
    const src = canonicalHttpsUrl(tag.attrs.src ?? "", doc.url); if (!src) continue;
    const image = new URL(src); const filename = image.pathname.split("/").pop() || null;
    const likelyRole = /logo/i.test(`${filename} ${tag.attrs.alt ?? ""}`) ? "LOGO" : "OTHER";
    const imageRights = rights.rightsState === "VERIFIED_REUSABLE" && likelyRole === "LOGO"
      && !/\blogos?\b[^.]{0,100}\b(?:CC\s*BY|CC0|public domain|commercial reuse permitted)/i.test(rights.rightsEvidence?.statement ?? "")
      ? { rightsState: "UNKNOWN_RIGHTS" as const, rightsEvidence: null } : rights;
    out.imageCandidates.push({ sourceImageUrl: src, sourcePageUrl: doc.url, filename, alt: clean(tag.attrs.alt), title: clean(tag.attrs.title), caption: null,
      width: Number(tag.attrs.width) || null, height: Number(tag.attrs.height) || null, mime: null,
      likelyRole, exactVenue: null,
      discoveredAt: doc.observedAt, originDomain: image.hostname, ...imageRights, operatorConfirmed: false });
  }
}
function extractDocument(doc: FetchedDocument, extractors: SourceExtractor[]): ResourceExtraction {
  const out: ResourceExtraction = { identityFacts: [], publicContacts: [], venueFacts: [], imageCandidates: [], evidenceRefs: [], warnings: [] };
  structured(doc, out, extractors);
  if (extractors.includes("IDENTITY")) {
    const landingPage = /^\/(?:index\.html?)?$/i.test(new URL(doc.url).pathname);
    const title = clean(visibleText(tags(doc.body, "title")[0]?.inner ?? "")) ?? firstMeta(doc.body, "og:site_name");
    const heading = clean(visibleText(tags(doc.body, "h1")[0]?.inner ?? ""));
    const address = clean(visibleText(tags(doc.body, "address")[0]?.inner ?? "")) ?? clean(visibleText(doc.body).match(/\bADDRESS\b\s+(.{5,240}?)(?=\b(?:CONTACT(?:\s+US)?|PHONE|EMAIL|COMPANY)\b|$)/i)?.[1]);
    if (landingPage && !out.identityFacts.some((item) => item.fieldName === "siteName")) {
      if (title && !/^(?:home|homepage)$/i.test(title)) addIdentity(out, doc, "siteName", title);
      if (heading && heading !== title && !/^(?:home|welcome|contact us)$/i.test(heading)) addIdentity(out, doc, "explicitVenueName", heading);
    }
    addIdentity(out, doc, "address", address); addIdentity(out, doc, "siteDescription", firstMeta(doc.body, "description") ?? firstMeta(doc.body, "og:description"));
  }
  if (extractors.includes("PUBLIC_CONTACT")) contacts(doc, out);
  if (extractors.includes("VENUE_FACTS")) venueFacts(doc, out);
  if (extractors.includes("IMAGE_CANDIDATES")) images(doc, out);
  return out;
}
export function extractResourcesFromDocuments(documents: FetchedDocument[], extractors: SourceExtractor[]): ResourceExtraction {
  const merged: ResourceExtraction = { identityFacts: [], publicContacts: [], venueFacts: [], imageCandidates: [], evidenceRefs: [], warnings: [] };
  for (const doc of documents) {
    const item = extractDocument(doc, extractors);
    merged.identityFacts.push(...item.identityFacts); merged.publicContacts.push(...item.publicContacts);
    merged.venueFacts.push(...item.venueFacts); merged.imageCandidates.push(...item.imageCandidates); merged.evidenceRefs.push(...item.evidenceRefs);
  }
  const unique = <T>(items: T[], key: (item: T) => string) => [...new Map(items.map((item) => [key(item), item])).values()];
  const identityFacts = unique(merged.identityFacts, (item) => `${item.fieldName}:${JSON.stringify(item.value)}:${item.sourceUrl}`);
  const publicContacts = unique(merged.publicContacts, (item) => `${item.type}:${item.value}`);
  const venueFacts = unique(merged.venueFacts, (item) => `${item.fieldName}:${JSON.stringify(item.value)}:${item.sourceUrl}`);
  const rightsRank: Record<RightsState, number> = { UNKNOWN_RIGHTS: 0, VERIFIED_REUSABLE: 1, PERMISSION_REQUIRED: 2, RIGHTS_RESERVED: 3 };
  const imagesByUrl = new Map<string, ImageCandidate>();
  for (const item of merged.imageCandidates) {
    const previous = imagesByUrl.get(item.sourceImageUrl);
    if (!previous || rightsRank[item.rightsState] > rightsRank[previous.rightsState]) imagesByUrl.set(item.sourceImageUrl, item);
  }
  const imageCandidates = [...imagesByUrl.values()];
  for (const doc of documents) {
    const restriction = sitewidePhotoRestriction(doc);
    if (!restriction) continue;
    for (const candidate of imageCandidates) {
      if (candidate.likelyRole === "LOGO" || new URL(candidate.sourceImageUrl).origin !== new URL(doc.url).origin) continue;
      if (rightsRank[restriction.rightsState] <= rightsRank[candidate.rightsState]) continue;
      candidate.rightsState = restriction.rightsState;
      candidate.rightsEvidence = restriction.rightsEvidence;
      merged.evidenceRefs.push(restriction.rightsEvidence.evidenceRef);
    }
  }
  for (const type of ["EMAIL", "PHONE"]) {
    const items = publicContacts.filter((item) => item.type === type);
    const valuesByPage = new Map<string, Set<string>>();
    for (const item of merged.publicContacts.filter((contact) => contact.type === type)) {
      const values = valuesByPage.get(item.sourceUrl) ?? new Set<string>(); values.add(item.value); valuesByPage.set(item.sourceUrl, values);
    }
    const soleValues = [...valuesByPage.values()].filter((values) => values.size === 1).map((values) => [...values][0]);
    if (new Set(soleValues).size > 1) { items.forEach((item) => { item.reviewRequired = true; }); merged.warnings.push(`Conflicting first-party ${type.toLowerCase()} contacts require review.`); }
  }
  const groups = new Map<string, VenueFact[]>();
  for (const item of venueFacts.filter((fact) => fact.fieldName === "capacity")) {
    const value = item.value as { space: string | null; layout: string };
    const key = `${value.space ?? ""}:${value.layout}`.toLowerCase(); groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  for (const [key, items] of groups) if (new Set(items.map((item) => item.sourceUrl)).size > 1
    && new Set(items.map((item) => (item.value as { count: number }).count)).size > 1) {
    items.forEach((item) => { item.reviewRequired = true; }); merged.warnings.push(`Conflicting first-party capacity evidence for ${key} requires review.`);
  }
  for (const field of ["address", "siteName", "explicitVenueName"]) {
    const values = identityFacts.filter((item) => item.fieldName === field).map((item) => String(item.value).toLowerCase());
    if (new Set(values).size > 1) merged.warnings.push(`Conflicting first-party ${field} evidence requires review.`);
  }
  return { identityFacts, publicContacts, venueFacts, imageCandidates, evidenceRefs: [...new Set(merged.evidenceRefs)], warnings: merged.warnings };
}
