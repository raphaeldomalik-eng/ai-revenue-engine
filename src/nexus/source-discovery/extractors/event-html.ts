import { hrefTags, selfClosingTags, tags, visibleText } from "../html.ts";
import { canonicalHttpsUrl } from "../network.ts";
import type { FetchedDocument } from "../types.ts";

export type HtmlEventFacts = {
  title: string;
  sourceExternalId: string | null;
  sourceEventUrl: string;
  startAt: string | null;
  endAt: string | null;
  timezone: string | null;
  venueText: string | null;
  description: string | null;
  performers: string[];
  ticketUrl: string | null;
  eventImageUrl: string | null;
};

const eventPath = /\/(?:events?|gigs?|shows?|concerts?|calendar|whats[-_]?on|live|tour)\/.+/i;

function text(value: string | null | undefined): string | null {
  return value?.replace(/\s+/g, " ").trim() || null;
}

function meta(document: FetchedDocument, key: string): string | null {
  return text(selfClosingTags(document.body, "meta").find(({ attrs }) => attrs.property?.toLowerCase() === key || attrs.name?.toLowerCase() === key)?.attrs.content);
}

function timezoneFromPage(document: FetchedDocument): string | null {
  const candidate = meta(document, "event:timezone") ?? document.body.match(/["'](?:timeZone|timezone)["']\s*:\s*["']([A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)["']/)?.[1] ?? null;
  if (!candidate) return null;
  try { new Intl.DateTimeFormat("en-GB", { timeZone: candidate }); return candidate; }
  catch { return null; }
}

function instant(value: string | undefined): string | null {
  if (!value || !/T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function artist(value: string) {
  const name = text(value.replace(/\b(?:plus guests?|support(?:ing)?|line[- ]?up|with)\b\s*:?/gi, ""))?.replace(/[.,;:]+$/, "").trim() ?? "";
  return name.length >= 2 && name.length <= 100 && !/^(?:tba|n\.?b\.?|tickets?|doors|free entry)$/i.test(name)
    && !/\b(?:presented by|biography|refund|information|buy tickets|born in)\b/i.test(name) ? name : null;
}

function performersFromArticle(article: string): string[] {
  const found: string[] = [];
  const add = (value: string) => {
    const name = artist(value);
    if (name && !found.some((item) => item.toLowerCase() === name.toLowerCase()) && found.length < 20) found.push(name);
  };
  for (const tag of selfClosingTags(article, "meta")) if (tag.attrs.itemprop === "performer") add(tag.attrs.content ?? "");
  for (const tag of tags(article, "p").slice(0, 16)) {
    const line = visibleText(tag.inner.replace(/<br\s*\/?\s*>/gi, ", "));
    if (/^(?:line[- ]?up|artists?|performers?|with)\s*:/i.test(line)) {
      line.replace(/^[^:]+:/, "").split(/,|\s+and\s+/i).forEach(add);
      continue;
    }
    if (/^(?:n\.?b\.?|please note|tickets?|doors|biography|presented by)/i.test(line)) break;
    if (!/<strong\b/i.test(tag.inner) || line.length > 150) continue;
    const strong = tags(tag.inner, "strong").map((item) => visibleText(item.inner.replace(/<br\s*\/?\s*>/gi, ", "))).join(", ");
    strong.split(",").forEach(add);
  }
  return found;
}

function imageFromPage(document: FetchedDocument, article: string): string | null {
  const candidate = meta(document, "og:image") ?? selfClosingTags(article, "img")[0]?.attrs.src ?? null;
  if (!candidate) return null;
  let image: URL;
  try { image = new URL(candidate, document.url); }
  catch { return null; }
  if (!/^https?:$/.test(image.protocol) || image.username || image.password) return null;
  if (/\b(?:logo|favicon|placeholder|default)\b/i.test(image.pathname)) return null;
  for (const script of tags(document.body, "script")) {
    if (script.attrs.type?.toLowerCase() !== "application/ld+json") continue;
    try {
      const node = JSON.parse(script.inner) as Record<string, unknown>;
      if (String(node["@type"]).toLowerCase() === "website" && typeof node.image === "string" && new URL(node.image, document.url).href === image.href) return null;
    } catch { /* A malformed unrelated JSON-LD block is not image evidence. */ }
  }
  return image.href;
}

export function extractHtmlEventFacts(document: FetchedDocument): HtmlEventFacts | null {
  if (!eventPath.test(new URL(document.url).pathname)) return null;
  const articleTag = tags(document.body, "article")[0];
  const article = articleTag?.inner;
  if (!article) return null;
  const title = text(visibleText(tags(article, "h1")[0]?.inner ?? ""));
  if (!title) return null;
  const times = selfClosingTags(article, "time").map(({ attrs }) => instant(attrs.datetime)).filter((value): value is string => Boolean(value));
  const date = times[0] ?? null;
  const canonical = canonicalHttpsUrl(meta(document, "og:url") ?? document.url, document.url);
  const sourceEventUrl = canonical && new URL(canonical).origin === new URL(document.url).origin ? canonical : document.url;
  const location = tags(article, "div").find((tag) => tag.attrs.itemprop === "location" || Boolean(tag.attrs["data-venue"]))?.inner;
  const venueText = text(location ? visibleText(location) : null);
  const description = tags(article, "div").find((tag) => tag.attrs.itemprop === "description" || /\bsqs-html-content\b/.test(tag.attrs.class ?? ""))?.inner;
  const ticket = hrefTags(article).find((anchor) => /\b(?:tickets?|rsvp|book(?:ing)?)\b/i.test(visibleText(anchor.inner)) && canonicalHttpsUrl(anchor.attrs.href ?? "", document.url));
  const ticketUrl = ticket ? canonicalHttpsUrl(ticket.attrs.href ?? "", document.url) : null;
  return {
    title, sourceExternalId: text(articleTag?.attrs["data-event-id"] ?? articleTag?.attrs["data-item-id"])?.slice(0, 256) ?? null,
    sourceEventUrl, startAt: date, endAt: times[1] ?? null,
    timezone: timezoneFromPage(document), venueText,
    description: description ? visibleText(description).slice(0, 10_000) : null,
    performers: performersFromArticle(article), ticketUrl,
    eventImageUrl: imageFromPage(document, article),
  };
}
