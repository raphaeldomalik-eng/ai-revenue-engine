import { createHash } from "node:crypto";
import type { SourceExtractor } from "../../contracts.ts";
import { byTag, closestAncestor, elements, parseHtml, precedingHeading, textContent, type DomElement } from "../dom.ts";
import { decodeHtml, hrefTags, selfClosingTags, tags, visibleText } from "../html.ts";
import { canonicalHttpsUrl } from "../network.ts";
import { registrableDomain, wwwCounterpart } from "../site-identity.ts";
import { recognisedEmailDomain } from "../../email-suffix.ts";
import { acceptVenueEmail } from "../../venue-email.ts";
import type { FetchedDocument } from "../types.ts";

export type IdentityFact = { fieldName: string; value: unknown; sourceUrl: string; evidenceRef: string };
export type ContactPurpose = "ENQUIRIES" | "BOOKINGS" | "SALES_HIRE" | "GENERAL" | "SWITCHBOARD" | "BOX_OFFICE" | "MESSAGING" | "FORM";
export type PublicContact = {
  type: string; value: string; sourceUrl: string; confidence: number | null; reviewRequired: boolean; evidenceRef: string;
  /** Internal classification; V1 publicContact cannot carry these, so they drive ordering and telemetry only. */
  purpose: ContactPurpose; normalized: string; original: string; label: string | null;
};
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
const bareHost = (url: string) => new URL(url).hostname.toLowerCase().replace(/^www\./, "");

/** Same site means same origin or the apex/www counterpart; structured data often names the other host. */
function sameOrigin(value: string, base: string): string | null {
  const result = canonicalHttpsUrl(value, base);
  if (!result) return null;
  const target = new URL(result); const origin = new URL(base);
  if (target.origin === origin.origin) return result;
  return target.protocol === origin.protocol && target.port === origin.port && wwwCounterpart(target.hostname.toLowerCase()) === origin.hostname.toLowerCase() ? result : null;
}
function addIdentity(out: ResourceExtraction, doc: FetchedDocument, fieldName: string, value: unknown) {
  if (value == null || value === "") return;
  const evidenceRef = ref(doc, "identity", `${fieldName}:${JSON.stringify(value)}`);
  out.identityFacts.push({ fieldName, value, sourceUrl: doc.url, evidenceRef }); out.evidenceRefs.push(evidenceRef);
}

const TICKETING_DOMAINS = /(?:^|\.)(?:ticketmaster|seetickets|eventbrite|dice\.fm|skiddle|ticketweb|gigantic|axs|ticketsource|fatsoma|universe|tickettailor|ents24|stargreen|wegottickets|ticketline|quicket|computicket|webtickets|howler)\./i;

export function normalizePhone(raw: string, siteHost: string): string {
  let value = raw.replace(/^tel:/i, "").replace(/\(0\)/g, "").trim();
  try { value = decodeURIComponent(value); } catch { /* keep the raw text */ }
  const plus = value.trim().startsWith("+");
  let digits = value.replace(/[^\d]/g, "");
  if (!plus && digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (plus) return `+${digits}`;
  if (/\.uk$/i.test(siteHost) && digits.startsWith("0") && digits.length >= 10 && digits.length <= 11) { digits = digits.slice(1); return `+44${digits}`; }
  return digits;
}

function classifyPurpose(type: string, context: string): ContactPurpose {
  if (type === "WHATSAPP" || type === "BUSINESS_MESSAGING") return "MESSAGING";
  if (type === "CONTACT_FORM") return "FORM";
  const text = context.toLowerCase();
  if (/\b(?:venue[- ]hire|private[- ](?:hire|events?|dining)|hire|functions?|sales|conference|corporate|weddings?|meetings?|events? (?:team|sales|office|enquir))\b|^(?:events|hire|sales|functions|weddings|conference)@/.test(text)) return "SALES_HIRE";
  if (/\b(?:bookings?|reservations?|book (?:the|a|your|now))\b|^(?:bookings?|reservations?|book)@/.test(text)) return "BOOKINGS";
  if (/\bbox[- ]office\b|^(?:boxoffice|tickets)@/.test(text)) return "BOX_OFFICE";
  if (/\b(?:switchboard|main (?:line|office|number)|reception desk)\b/.test(text)) return "SWITCHBOARD";
  if (/\benquir\w*|\binquir\w*|^(?:enquiries|inquiries)@/.test(text)) return "ENQUIRIES";
  return "GENERAL";
}
const PURPOSE_RANK: Record<ContactPurpose, number> = { SALES_HIRE: 0, BOOKINGS: 1, ENQUIRIES: 2, GENERAL: 3, SWITCHBOARD: 4, BOX_OFFICE: 5, FORM: 6, MESSAGING: 7 };

function addContact(out: ResourceExtraction, doc: FetchedDocument, type: string, raw: string | null, confidence: number, reviewRequired = false, context = "") {
  if (!raw) return;
  const original = raw.trim();
  const value = type === "EMAIL" ? original.toLowerCase() : original;
  if (type === "EMAIL" && !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) return;
  if (type === "EMAIL" && !recognisedEmailDomain(value.split("@")[1] ?? "")) return;
  if (type === "EMAIL") {
    const domain = value.split("@")[1]!;
    const unrelatedMailbox = TICKETING_DOMAINS.test(`.${domain}`) && registrableDomain(domain) !== registrableDomain(new URL(doc.url).hostname)
      || /^(?:newsletter|marketing|unsubscribe|noreply|no-reply|donotreply|careers|jobs|recruitment)@/.test(value);
    if (unrelatedMailbox) reviewRequired = true;
  }
  const normalized = type === "EMAIL" ? value : type === "PHONE" || type === "WHATSAPP" && !/^https?:|^whatsapp:/i.test(value) ? normalizePhone(value, new URL(doc.url).hostname) : value;
  if ((type === "PHONE") && normalized.replace(/\D/g, "").length < 7) return;
  const evidenceRef = ref(doc, "contact", `${type}:${value}`);
  const label = clean(context) ? clean(context)!.slice(0, 160) : null;
  out.publicContacts.push({ type, value, sourceUrl: doc.url, confidence, reviewRequired, evidenceRef, purpose: classifyPurpose(type, `${type === "EMAIL" ? value : ""} ${context} ${new URL(doc.url).pathname.replace(/[\/_-]/g, " ")}`), normalized, original, label });
  out.evidenceRefs.push(evidenceRef);
}
function addFact(out: ResourceExtraction, doc: FetchedDocument, fieldName: string, value: unknown, confidence = 0.8) {
  if (fieldName === "capacity") {
    const next = value as { space: string | null; layout: string; count: number };
    const duplicate = out.venueFacts.some((item) => item.fieldName === "capacity" && item.sourceUrl === doc.url
      && (item.value as typeof next).count === next.count && (item.value as typeof next).layout === next.layout
      && ((item.value as typeof next).space ?? "").toLowerCase() === (next.space ?? "").toLowerCase());
    if (duplicate) return;
  }
  if (fieldName === "spaces" && out.venueFacts.some((item) => item.fieldName === "spaces" && item.sourceUrl === doc.url && String(item.value).toLowerCase() === String(value).toLowerCase())) return;
  const evidenceRef = ref(doc, "venue", `${fieldName}:${JSON.stringify(value)}`);
  out.venueFacts.push({ fieldName, value, sourceUrl: doc.url, confidence, reviewRequired: false, evidenceRef }); out.evidenceRefs.push(evidenceRef);
}
function jsonLdRoots(doc: FetchedDocument): unknown[] {
  const roots: unknown[] = [];
  for (const script of tags(doc.body, "script")) if (/application\/ld\+json/i.test(script.attrs.type ?? "")) {
    try { roots.push(JSON.parse(script.inner.trim().replace(/^<!--|-->$/g, ""))); } catch { /* bad JSON-LD cannot suppress other evidence */ }
  }
  return roots;
}
function structuredNodes(doc: FetchedDocument): { nodes: Record<string, unknown>[]; contained: Set<Record<string, unknown>> } {
  const nodes: Record<string, unknown>[] = [];
  const contained = new Set<Record<string, unknown>>();
  const visit = (value: unknown, depth: number, key: string) => {
    if (depth > 8 || nodes.length >= 200) return;
    if (Array.isArray(value)) { value.forEach((item) => visit(item, depth + 1, key)); return; }
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (node["@type"]) { nodes.push(node); if (key === "containsPlace") contained.add(node); }
    for (const [childKey, item] of Object.entries(node)) if (childKey !== "@context" && item && typeof item === "object") visit(item, depth + 1, childKey);
  };
  for (const root of jsonLdRoots(doc)) visit(root, 0, "");
  return { nodes, contained };
}
function structuredAddress(value: unknown): string | null {
  if (typeof value === "string") return clean(value);
  const address = object(value);
  const parts = ["streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry"].map((key) => clean(address[key]) ?? clean(object(address[key]).name)).filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}
const validCount = (value: unknown) => {
  const text = String(value ?? "").trim();
  return /^\d{1,6}$/.test(text) && Number(text) >= 1 && Number(text) <= 100000 ? Number(text) : null;
};
function structured(doc: FetchedDocument, out: ResourceExtraction, extractors: SourceExtractor[]) {
  const { nodes, contained } = structuredNodes(doc);
  const hasLocalBusiness = nodes.some((node) => typed(node, "LocalBusiness") && (!clean(node.url) || sameOrigin(clean(node.url)!, doc.url)));
  for (const node of nodes) {
    if (typed(node, "ContactPoint") && (/^\/(?:index\.html?)?$/i.test(new URL(doc.url).pathname) || /\b(?:contact|enquir\w*|book\w*|hire)\b/i.test(new URL(doc.url).pathname))
      && (!clean(node.email) || clean(node.email)!.toLowerCase().endsWith(`@${bareHost(doc.url)}`))
      && /\b(?:book\w*|enquir\w*|venue hire)\b/i.test(clean(node.contactType) ?? "")) {
      if (extractors.includes("PUBLIC_CONTACT")) { addContact(out, doc, "PHONE", clean(node.telephone), 0.9, false, clean(node.contactType) ?? ""); addContact(out, doc, "EMAIL", clean(node.email), 0.9, false, clean(node.contactType) ?? ""); }
      if (extractors.includes("IDENTITY")) addIdentity(out, doc, "contactType", clean(node.contactType));
      continue;
    }
    const organisation = ["Organization", "LocalBusiness"].some((name) => typed(node, name));
    const place = ["Place", "EventVenue", "CivicStructure", "PerformingArtsTheater", "MusicVenue"].some((name) => typed(node, name));
    const business = organisation || place;
    if (!business || (clean(node.url) && !sameOrigin(clean(node.url)!, doc.url))) continue;
    if (contained.has(node)) {
      const name = clean(node.name);
      if (extractors.includes("IDENTITY")) addIdentity(out, doc, "placeName", name);
      const count = validCount(node.maximumAttendeeCapacity);
      if (extractors.includes("VENUE_FACTS") && name) {
        addFact(out, doc, "spaces", name, 0.9);
        if (count) addFact(out, doc, "capacity", { space: name, layout: "unspecified", count, statement: `${name} maximumAttendeeCapacity ${count}` }, 0.9);
      }
      continue;
    }
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
      const count = validCount(node.maximumAttendeeCapacity);
      if ((place || typed(node, "LocalBusiness")) && count) {
        addFact(out, doc, "capacity", { space: null, layout: "unspecified", count, statement: `maximumAttendeeCapacity ${count}` }, 0.9);
      }
    }
    if (extractors.includes("PUBLIC_CONTACT")) {
      addContact(out, doc, "PHONE", clean(node.telephone), 0.9); addContact(out, doc, "EMAIL", clean(node.email), 0.9);
      for (const point of list(node.contactPoint)) {
        const contact = object(point);
        addContact(out, doc, "PHONE", clean(contact.telephone), 0.9, false, clean(contact.contactType) ?? ""); addContact(out, doc, "EMAIL", clean(contact.email), 0.9, false, clean(contact.contactType) ?? "");
        if (extractors.includes("IDENTITY")) addIdentity(out, doc, "contactType", clean(contact.contactType));
      }
    }
  }
}
function firstMeta(html: string, key: string): string | null {
  for (const tag of selfClosingTags(html, "meta")) if (tag.attrs.property?.toLowerCase() === key || tag.attrs.name?.toLowerCase() === key) return clean(tag.attrs.content);
  return null;
}
function precedingText(text: string, needle: string, span = 80): string {
  const index = text.indexOf(needle);
  return index < 0 ? "" : text.slice(Math.max(0, index - span), index);
}
/** Inline tags must not split a visible address, and form controls are visitor input, not published contacts. */
function emailSurface(html: string): string {
  return visibleText(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<textarea\b[^>]*>[\s\S]*?<\/textarea>/gi, " ")
    .replace(/<select\b[^>]*>[\s\S]*?<\/select>/gi, " ")
    .replace(/<button\b[^>]*>[\s\S]*?<\/button>/gi, " ")
    .replace(/<input\b[^>]*>/gi, " ")
    .replace(/<br\b[^>]*>/gi, " ")
    .replace(/<\/?(?:span|b|strong|em|i|small|font|u|abbr|label|sup|sub|wbr|mark)\b[^>]*>/gi, "")
    .replace(/<\/?a\b[^>]*>/gi, " "));
}
/** Cloudflare replaces a visible address with this attribute. It is a fixed XOR, not a script engine. */
function cloudflareEmails(html: string): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(/\bdata-cfemail=["']([0-9a-f]{4,200})["']/gi)) {
    const encoded = match[1]!;
    if (encoded.length % 2 !== 0) continue;
    const key = Number.parseInt(encoded.slice(0, 2), 16);
    let email = "";
    for (let index = 2; index < encoded.length; index += 2) email += String.fromCharCode(Number.parseInt(encoded.slice(index, index + 2), 16) ^ key);
    if (/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) found.push(email);
  }
  return found;
}
function publishedDescriptions(html: string): string[] {
  const descriptions: string[] = [];
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/\b(?:name|property)=["'](?:description|og:description)["']/i.test(tag)) continue;
    const content = tag.match(/\bcontent=["']([^"']*)["']/i)?.[1];
    if (content) descriptions.push(decodeHtml(content));
  }
  return descriptions;
}
function aroundEmail(text: string, email: string): string {
  const index = text.toLowerCase().indexOf(email.toLowerCase());
  if (index < 0) return "";
  return text.slice(Math.max(0, index - 90), index + email.length);
}
function publishedEmailReview(email: string, pageUrl: string, context: string): boolean {
  const verdict = acceptVenueEmail(email, pageUrl, "", context);
  // A free-mail local part may match the venue name, which is only known to the acquisition caller.
  return !verdict.accepted && verdict.reason !== "PERSONAL_FREE_MAIL_ADDRESS";
}
function contacts(doc: FetchedDocument, out: ResourceExtraction) {
  const path = new URL(doc.url).pathname;
  // These paths stay out of phone, form, and messaging extraction. Email candidates are still read and classified one by one.
  const skipNonEmail = /\b(?:accommodation|hotels?|suppliers?|partners?|sponsors?|directory|search|privacy|terms)\b/i.test(path);
  const body = doc.body.replace(/<section\b([^>]*)>[\s\S]*?<\/section>/gi, (section, attrs: string) =>
    /\b(?:ticketing[\s-]*provider|third[\s-]*party|website[\s-]*designer|external[\s-]*support)\b/i.test(`${attrs} ${visibleText(section).slice(0, 100)}`) ? " " : section)
    .replace(/<form\b[^>]*(?:newsletter|subscribe|mailchimp|login|signin)[^>]*>[\s\S]*?<\/form>/gi, " ");
  const primary = visibleText(body.replace(/<footer\b[\s\S]*?<\/footer>/gi, " "));
  const emailText = [emailSurface(doc.body), ...publishedDescriptions(doc.body), ...cloudflareEmails(doc.body)].filter(Boolean).join("\n");
  const addPublishedEmail = (email: string, confidence: number, context: string) => {
    const domain = email.split("@")[1] ?? "";
    if (!registrableDomain(domain)) return;
    addContact(out, doc, "EMAIL", email, confidence, publishedEmailReview(email, doc.url, context), context);
  };
  for (const anchor of hrefTags(doc.body)) {
    const href = (anchor.attrs.href ?? "").trim(); const label = visibleText(anchor.inner);
    if (/^mailto:/i.test(href)) {
      let email = href.slice(7).split("?")[0] ?? "";
      try { email = decodeURIComponent(email); } catch { /* keep raw */ }
      const context = `${label} ${aroundEmail(emailText, email)}`.trim();
      addPublishedEmail(email, 0.95, context);
    }
    else if (skipNonEmail) continue;
    else if (/^tel:/i.test(href)) {
      let phone = href.slice(4);
      try { phone = decodeURIComponent(phone); } catch { /* keep raw */ }
      addContact(out, doc, "PHONE", phone, 0.9, false, `${label} ${precedingText(primary, label || phone)}`);
    }
    else if (/^(?:https:\/\/(?:wa\.me\/\d|(?:api\.)?whatsapp\.com\/send\?phone=)|whatsapp:\/\/send\?phone=)/i.test(href)) addContact(out, doc, "WHATSAPP", href, 0.85, false, label);
    else if (/messenger|facebook\.com\/messages/i.test(href)) addContact(out, doc, "BUSINESS_MESSAGING", href, 0.75, false, label);
    else if (/\bcontact(?:\s+us)?\b/i.test(label)) {
      const url = sameOrigin(href, doc.url);
      if (url && /\bcontact\b/i.test(new URL(url).pathname)) addContact(out, doc, "CONTACT_FORM", url, 0.6, true, label);
    }
  }
  if (!skipNonEmail) for (const form of tags(body, "form")) {
    const descriptor = `${form.attrs.action ?? ""} ${form.attrs.id ?? ""} ${form.attrs.class ?? ""} ${form.attrs.name ?? ""}`;
    if (/\b(?:search|comments?|newsletter|login|subscribe|signin|register|password)\b|wp-comments-post|wp-login/i.test(descriptor)) continue;
    if (/type=["']?password/i.test(form.inner)) continue;
    if (!/\b(?:contact|enquir\w*|book\w*|hire|message|sendmail)\b/i.test(descriptor)
      && !(/<textarea\b/i.test(form.inner) && /(?:name|id)=["']?email/i.test(form.inner))) continue;
    const action = form.attrs.action?.trim() ? sameOrigin(form.attrs.action, doc.url) : doc.url;
    if (action) addContact(out, doc, "CONTACT_FORM", action, 0.8, false, descriptor);
  }
  // A label must be separated from the address, or "bookings@venue" would also yield "s@venue".
  // Footer text stays in emailText. Region deletion is not how unrelated addresses are rejected.
  for (const match of emailText.matchAll(/\b(?:email|e-mail|enquiries|bookings?)(?:\s*[:\-]\s*|\s+)([a-z0-9._%+-]+\s*(?:@|\[at\]|\(at\))\s*[a-z0-9.-]+\.[a-z]{2,})/gi)) {
    const value = match[1]!.replace(/\s*(?:\[at\]|\(at\)|@)\s*/i, "@");
    addPublishedEmail(value, /\[at\]|\(at\)/i.test(match[1]!) ? 0.8 : 0.9, aroundEmail(emailText, value) || match[0]);
  }
  for (const match of emailText.matchAll(/(?<![\w.@-])([a-z0-9][a-z0-9._%+-]*@([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}))(?![\w@-])/gi)) {
    addPublishedEmail(match[1]!, 0.85, aroundEmail(emailText, match[1]!));
  }
  if (skipNonEmail) return;
  for (const match of primary.matchAll(/\b(?:call(?: us)?|phone|telephone|tel|box office|reservations|switchboard|bookings?|enquiries)\s*[:\-.]?\s*(\+?\d[\d\s().-]{7,}\d)/gi)) addContact(out, doc, "PHONE", clean(match[1]), 0.85, false, `${precedingText(primary, match[0], 60)} ${match[0]}`);
  for (const match of primary.matchAll(/\bwhats\s*app\s*[:\-]?\s*(\+?\d[\d\s().-]{7,}\d)/gi)) addContact(out, doc, "WHATSAPP", clean(match[1]), 0.8, false, match[0]);
}
const practical: Array<[string, RegExp]> = [
  ["accessibility", /\b(?:step[- ]free access|wheelchair access(?:ible)?|accessible toilets?|disabled access|hearing loop|induction loop|accessible entrance|lift access)\b[^.]{0,100}/i],
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

const LAYOUTS: Array<[RegExp, string]> = [
  [/^(?:theatre|theater)(?:[- ]style)?$/i, "theatre"], [/^cabaret(?:[- ]style)?$/i, "cabaret"], [/^banquet(?:ing)?$/i, "banquet"],
  [/^(?:seated )?dinner(?: dance)?$|^dining$/i, "dinner"], [/^(?:drinks )?reception$/i, "reception"], [/^standing$/i, "standing"],
  [/^seated$/i, "seated"], [/^classroom$/i, "classroom"], [/^boardroom$/i, "boardroom"], [/^u[- ]?shape(?:d)?$/i, "u-shape"],
  [/^hollow square$/i, "hollow-square"], [/^conference$/i, "conference"], [/^cocktail$/i, "cocktail"], [/^(?:lecture|auditorium)$/i, "theatre"],
  [/^(?:capacity|max(?:imum)?(?: capacity)?|guests|people|pax|total capacity)$/i, "unspecified"],
];
const IGNORED_COLUMN = /^(?:size|area|sq\.? ?m|sqm|m2|m²|sq\.? ?ft|sqft|dimensions?|length|width|height|ceiling(?: height)?|floor|level|price|rate|cost|from)\b/i;
function layoutOf(text: string): string | null {
  const value = text.replace(/[():*]/g, " ").replace(/\s+/g, " ").trim();
  for (const [pattern, layout] of LAYOUTS) if (pattern.test(value)) return layout;
  return null;
}
function parseCount(text: string): number | null {
  const value = text.replace(/\s+/g, " ").trim();
  const match = /^(?:up to |max\.? )?(\d{1,3}(?:,\d{3})+|\d{1,6})(?: (?:guests|people|pax))?$/i.exec(value);
  if (!match) return null;
  const count = Number(match[1]!.replaceAll(",", ""));
  return Number.isSafeInteger(count) && count >= 1 && count <= 100000 ? count : null;
}
const NON_SPACE = /^(?:room|rooms|space|spaces|venue|layout|layouts|capacity|capacities|total|name|area|style|format|setup|set[- ]up|type|floor|level|size|dimensions)$/i;
function spaceName(text: string): string | null {
  const value = text.replace(/\s+/g, " ").replace(/[*:]+$/, "").trim();
  if (!value || value.length > 60 || NON_SPACE.test(value) || layoutOf(value) || !/^[A-Za-z0-9]/.test(value) || !/[A-Za-z]/.test(value)) return null;
  if (value.split(" ").length > 6 || /[.!?]$/.test(value)) return null;
  return value;
}
function headingSpace(heading: string | null, docUrl: string): string | null {
  if (!heading) return null;
  const candidate = heading.replace(/\s+(?:hire|facilities)$/i, "");
  const named = /^[A-Za-z]/.test(heading)
    && !/^(?:ideal for|capacities|capacity|our spaces|venue spaces|the space|rooms|facilities|venue|contact|home|gallery|events|newsletter|more at|venue hire)/i.test(heading)
    && !/\b(?:where|included|signup|follow|blog|homepage|experience|everything|enquiry)\b/i.test(heading)
    && !/\b(?:access(?:ible|ibility)?|step[- ]free|wheelchair|tickets?|booking|parking|toilets?|companions?|assistance|performances?)\b/i.test(heading)
    && !/\b(?:event|capacity)\b/i.test(heading)
    && !/^(?:conference|corporate|wedding)\s+venue$/i.test(heading)
    && candidate.replace(/[():/]/g, "").split(/\s+/).filter(Boolean).every((word) => /^[A-Z][A-Za-z0-9'&-]*$/.test(word) || /^\d+$/.test(word))
    && heading.split(/\s+/).length <= 6 && !/[.!?]$/.test(heading)
    && !/\baccommodation\b/i.test(new URL(docUrl).pathname);
  return named ? candidate : null;
}

/** Capacity matrices: layouts as columns and spaces as rows (or transposed). Only explicit cells become facts. */
function capacityTables(doc: FetchedDocument, root: DomElement, out: ResourceExtraction) {
  for (const table of byTag(root, "table")) {
    const rows = elements(table, (element) => element.tag === "tr" && closestAncestor(element, (item) => item.tag === "table") === table)
      .map((row) => row.children.filter((cell): cell is DomElement => cell.type === "element" && (cell.tag === "td" || cell.tag === "th")).map((cell) => textContent(cell)));
    if (rows.length < 2) continue;
    const headerIndex = rows.findIndex((row) => row.filter((cell) => layoutOf(cell)).length >= 1 && row.some((cell) => !parseCount(cell)));
    if (headerIndex < 0) {
      const heading = headingSpace(textContent(precedingHeading(root, table) ?? { type: "text", text: "", parent: null }), doc.url);
      for (const row of rows) {
        if (row.length !== 2) continue;
        const layout = layoutOf(row[0]!); const count = parseCount(row[1]!);
        if (layout && count) addFact(out, doc, "capacity", { space: heading, layout, count, statement: `${row[0]} ${row[1]}` }, 0.85);
      }
      continue;
    }
    const header = rows[headerIndex]!;
    const columns = header.map((cell) => layoutOf(cell));
    const body = rows.slice(headerIndex + 1);
    const transposed = columns.filter(Boolean).length <= 1 && body.filter((row) => layoutOf(row[0] ?? "")).length >= 2;
    if (transposed) {
      for (const row of body) {
        const layout = layoutOf(row[0] ?? ""); if (!layout) continue;
        row.slice(1).forEach((cell, index) => {
          const name = spaceName(header[index + 1] ?? ""); const count = parseCount(cell);
          if (name && count) { addFact(out, doc, "spaces", name, 0.85); addFact(out, doc, "capacity", { space: name, layout, count, statement: `${name} ${row[0]} ${cell}` }, 0.9); }
        });
      }
      continue;
    }
    for (const row of body) {
      const name = spaceName(row[0] ?? "");
      if (!name) continue;
      let any = false;
      row.forEach((cell, index) => {
        const layout = columns[index]; if (!layout || index === 0) return;
        const count = parseCount(cell); if (!count) return;
        any = true;
        addFact(out, doc, "capacity", { space: name, layout, count, statement: `${name} ${header[index]} ${cell}` }, 0.9);
      });
      if (any) addFact(out, doc, "spaces", name, 0.85);
    }
  }
}

function definitionLists(doc: FetchedDocument, root: DomElement, out: ResourceExtraction) {
  for (const dl of byTag(root, "dl")) {
    const heading = precedingHeading(root, dl);
    const space = headingSpace(heading ? textContent(heading) : null, doc.url);
    let term: string | null = null;
    for (const child of dl.children) {
      if (child.type !== "element") continue;
      if (child.tag === "dt") term = textContent(child);
      else if (child.tag === "dd" && term) {
        const layout = layoutOf(term); const count = parseCount(textContent(child));
        if (layout && count) addFact(out, doc, "capacity", { space, layout, count, statement: `${term} ${textContent(child)}` }, 0.85);
        term = null;
      }
    }
  }
}

/** Text matrices (PDF text layers, preformatted blocks): a header of layout columns followed by rows with exactly matching cells. */
export function capacityMatrixLines(lines: string[]): Array<{ space: string; layout: string; count: number; statement: string }> {
  const found: Array<{ space: string; layout: string; count: number; statement: string }> = [];
  const termPattern = /(theatre|theater|cabaret|banquet(?:ing)?|dinner(?: dance)?|dining|reception|standing|seated|classroom|boardroom|u[- ]?shape(?:d)?|hollow square|cocktail|conference|capacity|size|area|sq\.? ?m|sqm|m2|m²|sq\.? ?ft|sqft|dimensions?|height|ceiling(?: height)?)/gi;
  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index]!;
    const terms = [...header.matchAll(termPattern)].map((match) => match[1]!);
    const layouts = terms.map((term) => (IGNORED_COLUMN.test(term) ? null : layoutOf(term)));
    if (layouts.filter(Boolean).length < 2) continue;
    for (let rowIndex = index + 1; rowIndex < Math.min(lines.length, index + 40); rowIndex += 1) {
      const row = lines[rowIndex]!;
      if ([...row.matchAll(termPattern)].filter((match) => layoutOf(match[1]!)).length >= 2) break;
      const match = /^([A-Za-z][A-Za-z0-9'&\- ]{1,58}?)\s+((?:(?:\d{1,3}(?:,\d{3})+|\d{1,6}(?:\.\d+)?)|[-–]|n\/a)(?:\s+(?:(?:\d{1,3}(?:,\d{3})+|\d{1,6}(?:\.\d+)?)|[-–]|n\/a))*)$/i.exec(row);
      if (!match) continue;
      const name = spaceName(match[1]!);
      const cells = match[2]!.split(/\s+/);
      if (!name || cells.length !== terms.length) continue;
      cells.forEach((cell, column) => {
        const layout = layouts[column]; const count = layout ? parseCount(cell) : null;
        if (layout && count) found.push({ space: name, layout, count, statement: `${name} ${terms[column]} ${cell}` });
      });
    }
  }
  return found;
}

function venueFacts(doc: FetchedDocument, out: ResourceExtraction, root: DomElement | null) {
  const body = visibleText(doc.body);
  for (const [field, pattern] of practical) { const statement = clean(body.match(pattern)?.[0]); if (statement && !/^no\s/i.test(statement)) addFact(out, doc, field, statement); }
  let html = doc.body;
  if (root) {
    const before = out.venueFacts.length;
    capacityTables(doc, root, out);
    const tableYield = out.venueFacts.length > before;
    const listStart = out.venueFacts.length;
    definitionLists(doc, root, out);
    if (tableYield) html = html.replace(/<table\b[\s\S]*?<\/table>/gi, " ");
    if (out.venueFacts.length > listStart) html = html.replace(/<dl\b[\s\S]*?<\/dl>/gi, " ");
  }
  const lines = root ? textContent(root, "\n").split("\n") : doc.body.split("\n");
  for (const item of capacityMatrixLines(lines)) { addFact(out, doc, "spaces", item.space, 0.85); addFact(out, doc, "capacity", item, 0.85); }
  const headings = [...html.matchAll(/<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi)];
  const sections = headings.length ? headings.map((match, index) => ({ name: clean(visibleText(match[2]!)), body: visibleText(html.slice((match.index ?? 0) + match[0].length, headings[index + 1]?.index ?? html.length)) })) : [{ name: null, body: visibleText(html) }];
  for (const section of sections) {
    const candidateName = headingSpace(section.name, doc.url);
    const strongName = /\b(?:hall|room|suite|studio|theatre|auditorium|vault|ballroom)\b/i.test(section.name ?? "");
    const nearbyCapacity = /\b(?:capacity|standing|seated|up to)\b/i.test(section.body.slice(0, 160));
    const space = candidateName && (strongName || nearbyCapacity) ? candidateName : null;
    if (space) addFact(out, doc, "spaces", space, 0.85);
    const patterns = [
      /\b(banquet|reception|theatre|theater|standing|seated|classroom|cabaret|dinner|conference|boardroom)\s+(?:style\s*)?(?:capacity\s*)?[:\-]?\s*(\d{1,3}(?:,\d{3})+|\d{1,5})\b/gi,
      /\bcapacity\s*(?:of|:|-)?\s*(\d{1,3}(?:,\d{3})+|\d{1,5})\s*(banquet|reception|theatre|theater|standing|seated|classroom|cabaret|dinner|conference|boardroom)?\b/gi,
      /\bup to\s*(\d{1,3}(?:,\d{3})+|\d{1,5})\s*(standing|seated|guests?|people)\b/gi,
      /\b(\d{1,3}(?:,\d{3})+|\d{1,5})\s*(standing|seated)\b/gi,
    ];
    const consumed: Array<[number, number]> = [];
    for (const match of section.body.matchAll(/\b(?:[Cc]apacit(?:y|ies)|CAPACIT(?:Y|IES))\s*[:\-–]?\s*((?:[A-Z][A-Za-z'&]*\s+){0,3}[A-Z][A-Za-z'&]*)\s*[:\-–]\s*(\d{1,3}(?:,\d{3})+|\d{2,5})\b/g)) {
      const name = spaceName(match[1]!); const count = Number(match[2]!.replaceAll(",", ""));
      if (!name || /^(?:max(?:imum)?|total|approx(?:imately)?|up)$/i.test(name) || count < 2 || count > 100000) continue;
      consumed.push([match.index ?? 0, (match.index ?? 0) + match[0].length]);
      addFact(out, doc, "spaces", name, 0.85);
      addFact(out, doc, "capacity", { space: name, layout: "unspecified", count, statement: match[0].trim() }, 0.85);
    }
    for (const [index, pattern] of patterns.entries()) for (const match of section.body.matchAll(pattern)) {
      const start = match.index ?? 0; const end = start + match[0].length;
      if (consumed.some(([from, to]) => start < to && end > from)) continue;
      const count = Number((index === 0 ? match[2] : match[1])?.replaceAll(",", ""));
      if (!Number.isSafeInteger(count) || count < (index === 3 ? 10 : 2) || count > 100000) continue;
      consumed.push([start, end]);
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

type ImageSource = { url: string; width: number | null; height: number | null };
function srcsetBest(value: string | undefined, base: string): ImageSource | null {
  if (!value) return null;
  let best: ImageSource | null = null; let bestScore = -1;
  for (const part of value.split(/,\s+(?=[^\s])/)) {
    const [raw, descriptor] = part.trim().split(/\s+/);
    const url = raw && !/^data:/i.test(raw) ? canonicalHttpsUrl(raw, base) : null;
    if (!url) continue;
    const width = /^(\d+)w$/.exec(descriptor ?? "")?.[1]; const density = /^(\d+(?:\.\d+)?)x$/.exec(descriptor ?? "")?.[1];
    const score = width ? Number(width) : density ? Number(density) * 1000 : 1;
    if (score > bestScore) { bestScore = score; best = { url, width: width ? Number(width) : null, height: null }; }
  }
  return best;
}
const PLACEHOLDER = /(?:^data:|blank\.gif|spacer\.gif|placeholder|lazy[-_]?load|transparent\.png|1x1)/i;
const TRACKER = /(?:facebook\.com\/tr|google-analytics|doubleclick|googletagmanager|pixel\.|\/pixel\b|analytics\.)/i;
function imageRole(filename: string | null, alt: string | null, element: DomElement | null, docUrl: string, og: boolean): string {
  const context = `${filename ?? ""} ${alt ?? ""} ${element?.attrs.class ?? ""} ${element?.attrs.id ?? ""}`;
  if (/logo/i.test(context) || (element && closestAncestor(element, (item) => /logo|brand/i.test(`${item.attrs.class ?? ""} ${item.attrs.id ?? ""}`)))) return "LOGO";
  if (og) return "HERO";
  if (element && closestAncestor(element, (item) => /\b(?:hero|banner|masthead)\b/i.test(`${item.attrs.class ?? ""} ${item.attrs.id ?? ""}`))) return "HERO";
  if (/\b(?:exterior|outside|facade|façade|building front)\b/i.test(alt ?? "")) return "EXTERIOR";
  if (/\b(?:interior|inside)\b/i.test(alt ?? "")) return "INTERIOR";
  if (/\b(?:room|hall|suite|space|studio|auditorium|ballroom|theatre|terrace|bar|lounge)\b/i.test(alt ?? "")) return "SPACE";
  if (/gallery|photos/i.test(new URL(docUrl).pathname) || (element && closestAncestor(element, (item) => /gallery|carousel|slider|swiper|lightbox/i.test(`${item.attrs.class ?? ""} ${item.attrs.id ?? ""}`)))) return "GALLERY";
  return "OTHER";
}
function images(doc: FetchedDocument, out: ResourceExtraction, root: DomElement | null) {
  const rights = imageRights(doc); if (rights.rightsEvidence) out.evidenceRefs.push(rights.rightsEvidence.evidenceRef);
  const push = (source: ImageSource, alt: string | null, title: string | null, caption: string | null, element: DomElement | null, options: { og?: boolean; exactVenue?: boolean | null; role?: string } = {}) => {
    if (TRACKER.test(source.url)) return;
    if ((source.width !== null && source.width < 50) || (source.height !== null && source.height < 50)) return;
    const image = new URL(source.url); const filename = decodeURIComponent(image.pathname.split("/").pop() || "") || null;
    if (out.imageCandidates.some((item) => item.sourceImageUrl === source.url)) return;
    const likelyRole = options.role ?? imageRole(filename, alt, element, doc.url, Boolean(options.og));
    const imageRights = rights.rightsState === "VERIFIED_REUSABLE" && likelyRole === "LOGO"
      && !/\blogos?\b[^.]{0,100}\b(?:CC\s*BY|CC0|public domain|commercial reuse permitted)/i.test(rights.rightsEvidence?.statement ?? "")
      ? { rightsState: "UNKNOWN_RIGHTS" as const, rightsEvidence: null } : rights;
    const mime = /\.(jpe?g)$/i.test(filename ?? "") ? "image/jpeg" : /\.png$/i.test(filename ?? "") ? "image/png" : /\.webp$/i.test(filename ?? "") ? "image/webp" : /\.avif$/i.test(filename ?? "") ? "image/avif" : /\.svg$/i.test(filename ?? "") ? "image/svg+xml" : /\.gif$/i.test(filename ?? "") ? "image/gif" : null;
    out.imageCandidates.push({ sourceImageUrl: source.url, sourcePageUrl: doc.url, filename, alt, title, caption, width: source.width, height: source.height, mime,
      likelyRole, exactVenue: options.exactVenue ?? null, discoveredAt: doc.observedAt, originDomain: image.hostname, ...imageRights, operatorConfirmed: false });
  };
  const dimension = (value: string | undefined) => { const number = Number(value); return Number.isFinite(number) && number > 0 ? Math.round(number) : null; };
  if (root) {
    for (const img of byTag(root, "img")) {
      const attrs = img.attrs;
      const picture = closestAncestor(img, (item) => item.tag === "picture");
      const sourceSets = picture ? byTag(picture, "source").map((source) => srcsetBest(source.attrs.srcset ?? source.attrs["data-srcset"], doc.url)) : [];
      const candidates = [srcsetBest(attrs["data-srcset"] ?? attrs["data-lazy-srcset"], doc.url), srcsetBest(attrs.srcset, doc.url), ...sourceSets].filter((item): item is ImageSource => Boolean(item));
      const lazy = ["data-src", "data-lazy-src", "data-original", "data-lazy", "data-full", "data-large_image"].map((key) => attrs[key]).find((value) => value && !/^data:/i.test(value));
      const direct = lazy ?? (attrs.src && !PLACEHOLDER.test(attrs.src) ? attrs.src : undefined);
      const best = candidates.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
      const url = best?.url ?? (direct ? canonicalHttpsUrl(direct, doc.url) : null);
      if (!url) continue;
      const figure = closestAncestor(img, (item) => item.tag === "figure");
      const caption = figure ? clean(textContent(byTag(figure, "figcaption")[0] ?? { type: "text", text: "", parent: null })) : null;
      push({ url, width: best?.width ?? dimension(attrs.width), height: best?.width ? null : dimension(attrs.height) }, clean(attrs.alt), clean(attrs.title), caption, img);
    }
  } else {
    for (const tag of selfClosingTags(doc.body, "img")) {
      const url = canonicalHttpsUrl(tag.attrs.src ?? "", doc.url); if (!url) continue;
      push({ url, width: dimension(tag.attrs.width), height: dimension(tag.attrs.height) }, clean(tag.attrs.alt), clean(tag.attrs.title), null, null);
    }
  }
  const og = firstMeta(doc.body, "og:image") ?? firstMeta(doc.body, "og:image:secure_url") ?? firstMeta(doc.body, "twitter:image");
  const ogUrl = og ? canonicalHttpsUrl(og, doc.url) : null;
  if (ogUrl) push({ url: ogUrl, width: dimension(firstMeta(doc.body, "og:image:width") ?? undefined), height: dimension(firstMeta(doc.body, "og:image:height") ?? undefined) }, clean(firstMeta(doc.body, "og:image:alt")), null, null, null, { og: true });
  const { nodes, contained } = structuredNodes(doc);
  for (const node of nodes) {
    const subject = ["Place", "EventVenue", "LocalBusiness", "Organization", "CivicStructure", "PerformingArtsTheater", "MusicVenue"].some((name) => typed(node, name));
    if (!subject || (clean(node.url) && !sameOrigin(clean(node.url)!, doc.url))) continue;
    for (const [key, role] of [["logo", "LOGO"], ["image", null], ["photo", null]] as const) {
      for (const item of list(node[key])) {
        const value = typeof item === "string" ? item : clean(object(item).url) ?? clean(object(item).contentUrl);
        const url = value ? canonicalHttpsUrl(value, doc.url) : null;
        if (!url) continue;
        const venueImage = role === null && typed(node, "Organization") === false;
        push({ url, width: dimension(String(object(item).width ?? "")), height: dimension(String(object(item).height ?? "")) }, clean(object(item).caption) ?? clean(node.name), null, clean(object(item).caption), null,
          { role: role ?? (contained.has(node) ? "SPACE" : undefined), exactVenue: venueImage ? true : null });
      }
    }
  }
}
function classificationEvidence(doc: FetchedDocument, out: ResourceExtraction) {
  const { nodes } = structuredNodes(doc);
  const types = [...new Set(nodes.flatMap((node) => list(node["@type"]).map((type) => (String(type).split(/[\/#]/).pop() ?? "").trim())).filter(Boolean))].slice(0, 24);
  if (types.length) addIdentity(out, doc, "schemaOrgTypes", types);
  const title = clean(visibleText(tags(doc.body, "title")[0]?.inner ?? "")) ?? firstMeta(doc.body, "og:title");
  const description = firstMeta(doc.body, "description") ?? firstMeta(doc.body, "og:description");
  if (title) addIdentity(out, doc, "pageTitle", title);
  if (description) addIdentity(out, doc, "metaDescription", description);
  const text = `${title ?? ""} ${description ?? ""} ${visibleText(doc.body).slice(0, 4000)}`;
  const signals: string[] = [];
  if (types.some((type) => /^(?:eventvenue|place|civicstructure|performingartsvenue)$/i.test(type))) signals.push("SCHEMA_PLACE_OR_VENUE");
  if (types.some((type) => /^(?:organization|localbusiness|corporation|ngo)$/i.test(type))) signals.push("SCHEMA_ORGANISATION");
  if (/\b(?:festival|fest)\b/i.test(text)) signals.push("FESTIVAL_OR_SERIES_LANGUAGE");
  if (/\b(?:promot(?:er|ing|es)|presents)\b/i.test(text)) signals.push("PROMOTER_LANGUAGE");
  if (/\b(?:tickets?|box office|ticketmaster|dice\.fm)\b/i.test(text)) signals.push("TICKETING_OR_MEDIA_LANGUAGE");
  if (/\b(?:capacity|seating|function rooms?|venue hire|banquet|auditorium)\b/i.test(text)) signals.push("FACILITY_LANGUAGE");
  if (signals.includes("SCHEMA_ORGANISATION") && (signals.includes("SCHEMA_PLACE_OR_VENUE") || signals.includes("FACILITY_LANGUAGE"))) signals.push("ORGANISATION_VENUE_CONFLICT");
  if (signals.includes("FESTIVAL_OR_SERIES_LANGUAGE") && (signals.includes("SCHEMA_PLACE_OR_VENUE") || signals.includes("FACILITY_LANGUAGE"))) signals.push("FESTIVAL_PLACE_CONFLICT");
  if (signals.length) addIdentity(out, doc, "classificationSignals", signals);
}

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * A PDF page is presented to the text-based extractors as its own pseudo-document so every fact keeps the PDF URL
 * and a page-qualified evidence ref (`source:<pdf sha256>#page=N:...`).
 */
function pdfPageDocuments(doc: FetchedDocument): FetchedDocument[] {
  return (doc.pdfPages ?? []).map((text, index) => ({
    ...doc, url: `${doc.url.split("#")[0]}#page=${index + 1}`, kind: "HTML" as const, pdfPages: undefined, sourceHash: `${doc.sourceHash}#page=${index + 1}`,
    body: text.split("\n").map((line) => `<p>${escapeHtml(line)}</p>`).join("\n"),
  })).filter((page) => page.body.length > 0);
}

function extractDocument(source: FetchedDocument, extractors: SourceExtractor[]): ResourceExtraction {
  const out: ResourceExtraction = { identityFacts: [], publicContacts: [], venueFacts: [], imageCandidates: [], evidenceRefs: [], warnings: [] };
  if (source.kind === "PDF") {
    for (const page of pdfPageDocuments(source)) {
      const root = parseHtml(page.body);
      if (extractors.includes("PUBLIC_CONTACT")) contacts(page, out);
      if (extractors.includes("VENUE_FACTS")) venueFacts(page, out, root);
    }
    return out;
  }
  const doc = source.derivedMarkup ? { ...source, body: `${source.body}\n${source.derivedMarkup}` } : source;
  const root = extractors.includes("VENUE_FACTS") || extractors.includes("IMAGE_CANDIDATES") ? parseHtml(doc.body) : null;
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
    const canonical = selfClosingTags(doc.body, "link").map((tag) => tag.attrs).find((attrs) => /\bcanonical\b/i.test(attrs.rel ?? ""))?.href;
    const canonicalUrl = canonical ? sameOrigin(canonical, doc.url) : null;
    if (landingPage && canonicalUrl) addIdentity(out, doc, "canonicalUrl", canonicalUrl);
  }
  if (extractors.includes("PUBLIC_CONTACT")) contacts(doc, out);
  if (extractors.includes("VENUE_FACTS")) venueFacts(doc, out, root);
  if (extractors.includes("SOURCE_CLASSIFICATION")) classificationEvidence(doc, out);
  if (extractors.includes("IMAGE_CANDIDATES")) images(doc, out, root);
  return out;
}
export function extractResourcesFromDocuments(documents: FetchedDocument[], extractors: SourceExtractor[]): ResourceExtraction {
  const merged: ResourceExtraction = { identityFacts: [], publicContacts: [], venueFacts: [], imageCandidates: [], evidenceRefs: [], warnings: [] };
  const seenSources = new Set<string>();
  for (const doc of documents) {
    const key = `${doc.url}:${doc.sourceHash}`;
    if (seenSources.has(key)) continue;
    seenSources.add(key);
    const item = extractDocument(doc, extractors);
    merged.identityFacts.push(...item.identityFacts); merged.publicContacts.push(...item.publicContacts);
    merged.venueFacts.push(...item.venueFacts); merged.imageCandidates.push(...item.imageCandidates); merged.evidenceRefs.push(...item.evidenceRefs);
  }
  const unique = <T>(items: T[], key: (item: T) => string) => [...new Map(items.map((item) => [key(item), item])).values()];
  const identityFacts = unique(merged.identityFacts, (item) => `${item.fieldName}:${JSON.stringify(item.value)}:${item.sourceUrl}`);
  const firstByKey = new Map<string, PublicContact>();
  for (const item of merged.publicContacts) { const key = `${item.type}:${item.normalized}`; if (!firstByKey.has(key)) firstByKey.set(key, item); }
  const publicContacts = [...firstByKey.values()].map((item, order) => ({ item, order }))
    .sort((a, b) => PURPOSE_RANK[a.item.purpose] - PURPOSE_RANK[b.item.purpose] || a.order - b.order).map(({ item }) => item);
  const venueFacts = unique(merged.venueFacts, (item) => `${item.fieldName}:${JSON.stringify(item.value)}:${item.sourceUrl}`);
  const rightsRank: Record<RightsState, number> = { UNKNOWN_RIGHTS: 0, VERIFIED_REUSABLE: 1, PERMISSION_REQUIRED: 2, RIGHTS_RESERVED: 3 };
  const imagesByUrl = new Map<string, ImageCandidate>();
  for (const item of merged.imageCandidates) {
    const previous = imagesByUrl.get(item.sourceImageUrl);
    if (!previous || rightsRank[item.rightsState] > rightsRank[previous.rightsState]) imagesByUrl.set(item.sourceImageUrl, previous && previous.exactVenue && !item.exactVenue ? { ...item, exactVenue: true } : item);
  }
  const imageCandidates = [...imagesByUrl.values()];
  for (const doc of documents) {
    if (doc.kind === "PDF") continue;
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
    for (const item of merged.publicContacts.filter((contact) => contact.type === type && (type !== "EMAIL" || !contact.reviewRequired))) {
      const values = valuesByPage.get(item.sourceUrl) ?? new Set<string>(); values.add(item.normalized); valuesByPage.set(item.sourceUrl, values);
    }
    const soleValues = [...valuesByPage.values()].filter((values) => values.size === 1).map((values) => [...values][0]);
    if (new Set(soleValues).size > 1) { items.forEach((item) => { item.reviewRequired = true; }); merged.warnings.push(`Conflicting first-party ${type.toLowerCase()} contacts require review.`); }
  }
  const groups = new Map<string, VenueFact[]>();
  for (const item of venueFacts.filter((fact) => fact.fieldName === "capacity")) {
    const value = item.value as { space: string | null; layout: string };
    const key = `${value.space ?? ""}:${value.layout}`.toLowerCase(); groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  for (const [key, items] of groups) {
    const counts = new Set(items.map((item) => (item.value as { count: number }).count));
    const named = Boolean((items[0]!.value as { space: string | null }).space);
    if (counts.size > 1 && (new Set(items.map((item) => item.sourceUrl)).size > 1 || named)) {
      items.forEach((item) => { item.reviewRequired = true; }); merged.warnings.push(`Conflicting first-party capacity evidence for ${key} requires review.`);
    }
  }
  for (const field of ["address", "siteName", "explicitVenueName"]) {
    const values = identityFacts.filter((item) => item.fieldName === field).map((item) => String(item.value).toLowerCase());
    if (new Set(values).size > 1) merged.warnings.push(`Conflicting first-party ${field} evidence requires review.`);
  }
  return { identityFacts, publicContacts, venueFacts, imageCandidates, evidenceRefs: [...new Set(merged.evidenceRefs)], warnings: merged.warnings };
}
