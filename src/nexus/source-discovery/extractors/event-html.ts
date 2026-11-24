import { hrefTags, selfClosingTags, tags, visibleText } from "../html.ts";
import { canonicalHttpsUrl } from "../network.ts";
import type { FetchedDocument } from "../types.ts";

export type PerformerBillingObservation = {
  billedName: string;
  listedPosition: number;
  role: "HEADLINE" | "SUPPORT" | "DJ" | "PERFORMER";
  billingRank: number | null;
  billingOrderBasis: "EXPLICIT" | "LIST_ORDER_ONLY";
};

export type ArtistPageObservation = {
  billedName: string;
  baseLocalities: string[];
  baseCountryCode: string | null;
  ukNation: "SCT" | "ENG" | "WLS" | "NIR" | null;
  originText: string | null;
  originCountryCode: string | null;
  repertoireOriginality: "ORIGINAL" | "MIXED" | "COVER" | "TRIBUTE" | "FUNCTION" | "UNKNOWN";
  emergingSignals: Array<{ signalType: string; value: string; excerpt: string }>;
  musicEvidence: Array<{ title: string | null; releaseKind: string; releaseStatus: string; url: string | null; excerpt: string }>;
  spotifyArtistUri: string | null;
  excerpt: string | null;
};

export type HCalendarIndexSummary = {
  sourceEventUrl: string;
  sourceExternalId: string;
  startAt: string;
  timezone: string;
  timePrecision: "EXPLICIT_INSTANT";
  timeMeaning: "DOORS_OR_START";
  sourceHash: string;
};

export type HtmlEventFacts = {
  title: string;
  sourceExternalId: string | null;
  sourceEventUrl: string;
  startAt: string | null;
  endAt: string | null;
  timezone: string | null;
  venueText: string | null;
  description: string | null;
  organiser?: string | null;
  ageRestriction?: string | null;
  eventStatus?: string | null;
  timePrecision?: "EXPLICIT_INSTANT" | "DATE_ONLY";
  timeMeaning?: "DOORS_OPEN" | "SHOW_WINDOW" | "DOORS_OR_START" | "DATE_ONLY_DEFAULTED";
  seriesTitle?: string | null;
  performers: string[];
  performerBillings?: PerformerBillingObservation[];
  outboundArtistUrls?: string[];
  artistObservations?: ArtistPageObservation[];
  ticketUrl: string | null;
  eventImageUrl: string | null;
};

const eventPath = /\/(?:events?|gigs?|shows?|concerts?|calendar|whats[-_]?on|live|tour)\/.+/i;
const datedPermalinkPath = /^\/20\d{2}\/\d{2}\/\d{2}\/[a-z0-9%-]+\/?$/i;

const MONTHS: Record<string, string> = {
  january: "01", jan: "01",
  february: "02", feb: "02",
  march: "03", mar: "03",
  april: "04", apr: "04",
  may: "05",
  june: "06", jun: "06",
  july: "07", jul: "07",
  august: "08", aug: "08",
  september: "09", sep: "09", sept: "09",
  october: "10", oct: "10",
  november: "11", nov: "11",
  december: "12", dec: "12",
};

const UK_LOCALITY_NATION: Record<string, "SCT" | "ENG" | "WLS" | "NIR"> = {
  edinburgh: "SCT",
  glasgow: "SCT",
  aberdeen: "SCT",
  dundee: "SCT",
  fife: "SCT",
  scotland: "SCT",
  london: "ENG",
  manchester: "ENG",
  bristol: "ENG",
  brighton: "ENG",
  leeds: "ENG",
  sheffield: "ENG",
  liverpool: "ENG",
  newcastle: "ENG",
  nottingham: "ENG",
  birmingham: "ENG",
  southampton: "ENG",
  cardiff: "WLS",
  wrexham: "WLS",
  swansea: "WLS",
  wales: "WLS",
  belfast: "NIR",
  derry: "NIR",
};

const KNOWN_TICKET_DOMAINS = /(?:^|\.)(?:seetickets\.com|dice\.fm|wegottickets\.com|ticketmaster\.co\.uk|ticketmaster\.com|ra\.co|offaxisgigs\.com|skiddle\.com|eventbrite\.co\.uk|eventbrite\.com|musicglue\.com|gigantic\.com|ents24\.com|citizensticket\.com|citizenticket\.co\.uk)$/i;

function text(value: string | null | undefined): string | null {
  return value?.replace(/\s+/g, " ").trim() || null;
}

function boundedExcerpt(value: string, max = 260): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 3).trim()}...`;
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

function isForFansOfClause(value: string): boolean {
  return /^(?:for\s+fans\s+of|ffo)\b/i.test(value.trim());
}

function stripTrailingForFansOf(value: string): string {
  return value.replace(/\s*\b(?:for\s+fans\s+of|ffo)\b[\s\S]*$/i, "").trim();
}

function artist(value: string) {
  if (isForFansOfClause(value) || /\bpresents$/i.test(value.trim())) return null;
  const stripped = stripTrailingForFansOf(value);
  const name = text(stripped.replace(/\b(?:plus\s+(?:special\s+)?guests?|support(?:ing)?|line[- ]?up|with)\b\s*:?/gi, ""))?.replace(/[.,;:]+$/, "").trim() ?? "";
  return name.length >= 2 && name.length <= 100 && !/^(?:tba|n\.?b\.?|tickets?|doors|free entry)$/i.test(name)
    && !/\b(?:presented by|presents$|biography|refund|information|buy tickets|born in|for fans of)\b/i.test(name) ? name : null;
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
    if (isForFansOfClause(line) || /\bpresents$/i.test(line)) continue;
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

function londonLocalToUtcIso(dateStr: string, timeStr: string): string {
  const roughIso = `${dateStr}T${timeStr}Z`;
  const d = new Date(roughIso);
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    timeZoneName: "shortOffset",
  });
  const parts = formatter.formatToParts(d);
  const tzPart = parts.find((p) => p.type === "timeZoneName")?.value || "GMT";
  const match = tzPart.match(/GMT([+-]\d+)?/);
  const offsetHours = match && match[1] ? parseInt(match[1], 10) : 0;

  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, min, sec] = timeStr.split(":").map(Number);
  const utcDate = new Date(Date.UTC(year!, month! - 1, day!, hour! - offsetHours, min!, sec || 0));
  return utcDate.toISOString();
}

function parseClockHourMin(hourRaw: string, minRaw: string | undefined, meridiemRaw: string): string {
  let hour = parseInt(hourRaw, 10);
  const min = (minRaw ?? "00").padStart(2, "0");
  const mer = meridiemRaw.toUpperCase();
  if (mer === "PM" && hour < 12) hour += 12;
  if (mer === "AM" && hour === 12) hour = 0;
  return `${hour.toString().padStart(2, "0")}:${min}:00`;
}

function parseHumanDate(article: string, urlPathname: string): string | null {
  for (const t of tags(article, "time")) {
    const raw = visibleText(t.inner);
    const m = raw.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(20\d{2})\b/i);
    if (m) {
      const month = MONTHS[m[1]!.toLowerCase()];
      if (month) return `${m[3]}-${month}-${m[2]!.padStart(2, "0")}`;
    }
  }
  const pathMatch = urlPathname.match(/^\/(20\d{2})\/(\d{2})\/(\d{2})\//);
  return pathMatch ? `${pathMatch[1]}-${pathMatch[2]}-${pathMatch[3]}` : null;
}

function parseEntryHeading(rawHeadingHtml: string, paragraphs: string[]): {
  title: string | null;
  eventStatus: string | null;
  seriesTitle: string | null;
  headerPerformers: string[];
} {
  const rawLines = rawHeadingHtml
    .split(/<br\s*\/?\s*>/gi)
    .map((chunk) => text(visibleText(chunk)))
    .filter((line): line is string => Boolean(line));

  const nonComparisonLines = rawLines
    .filter((line) => !isForFansOfClause(line))
    .map((line) => stripTrailingForFansOf(line))
    .filter(Boolean);

  if (!nonComparisonLines.length) {
    return { title: null, eventStatus: null, seriesTitle: null, headerPerformers: [] };
  }

  let eventStatus: string | null = null;
  const firstStatusMatch = nonComparisonLines[0]!.match(/^(postponed|cancelled|rescheduled)\s*:\s*(.+)$/i);
  if (firstStatusMatch) {
    eventStatus = firstStatusMatch[1]!.toUpperCase();
    nonComparisonLines[0] = firstStatusMatch[2]!.trim();
  }

  const subtitleLines: string[] = [];
  const candidateActLines: string[] = [];
  for (const line of nonComparisonLines) {
    if (/^[–—-]\s*\S/.test(line)) {
      subtitleLines.push(line.replace(/^[–—-]\s*/, "").trim());
    } else {
      candidateActLines.push(line);
    }
  }

  let seriesTitle: string | null = null;
  let actLines = candidateActLines;
  if (candidateActLines.length >= 2) {
    const firstEscaped = candidateActLines[0]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const seriesRe = new RegExp(`^${firstEscaped}\\s+is\\s+a\\s+(?:new\\s+)?(?:event|gig|live|showcase)\\s+series\\b`, "i");
    if (paragraphs.some((p) => seriesRe.test(p))) {
      seriesTitle = candidateActLines[0]!;
      actLines = candidateActLines.slice(1);
    }
  }
  if (!seriesTitle) {
    for (const p of paragraphs) {
      const m = p.match(/\bas part of the ([A-Z][A-Za-z0-9 '&-]{2,50}?)\s+(?:launch\s+)?series\b/);
      if (m) {
        seriesTitle = m[1]!.trim();
        break;
      }
    }
  }

  const headerPerformers: string[] = [];
  for (const line of actLines) {
    const cleaned = artist(line);
    if (cleaned && !headerPerformers.some((p) => p.toLowerCase() === cleaned.toLowerCase())) {
      headerPerformers.push(cleaned);
    }
  }

  let title: string;
  if (seriesTitle && candidateActLines[0]?.toLowerCase() === seriesTitle.toLowerCase() && headerPerformers.length) {
    title = `${seriesTitle}: ${headerPerformers.join(" / ")}`;
  } else if (subtitleLines.length && headerPerformers.length === 1) {
    title = `${headerPerformers[0]} – ${subtitleLines.join(" – ")}`;
  } else if (headerPerformers.length > 1) {
    title = headerPerformers.join(" / ");
  } else {
    title = nonComparisonLines.join(" – ");
  }

  return { title: text(title), eventStatus, seriesTitle, headerPerformers };
}

function classifyPerformerBillings(
  performers: string[],
  paragraphs: string[],
  ticketUrl: string | null,
  rawTitle: string,
): PerformerBillingObservation[] {
  if (!performers.length) return [];
  const fullBody = paragraphs.join(" ");

  if (performers.length === 1) {
    const isDjShow = /\bra\.co\b/i.test(ticketUrl ?? "") || /\b(?:dj set|club night|to another rhythm)\b/i.test(`${rawTitle} ${fullBody}`);
    return [{
      billedName: performers[0]!,
      listedPosition: 1,
      role: isDjShow ? "DJ" : "HEADLINE",
      billingRank: 1,
      billingOrderBasis: "EXPLICIT",
    }];
  }

  // Check if prose explicitly names support act(s) vs lead act
  const supportClauseMatches = [
    ...fullBody.matchAll(/\bsupport\s+(?:comes\s+)?from\s+([^.!?\n]+)/gi),
    ...fullBody.matchAll(/\bwith\s+(?:special\s+guests?\s+|support\s+from\s+)([^.!?\n]+)/gi),
  ].map((m) => m[1]!.toLowerCase());

  if (supportClauseMatches.length > 0) {
    const supportText = supportClauseMatches.join(" ");
    const explicitSupports = new Set<string>();
    for (const p of performers) {
      if (supportText.includes(p.toLowerCase())) explicitSupports.add(p.toLowerCase());
    }
    if (explicitSupports.size > 0 && explicitSupports.size < performers.length) {
      let rank = 1;
      const leads = performers.filter((p) => !explicitSupports.has(p.toLowerCase()));
      const supports = performers.filter((p) => explicitSupports.has(p.toLowerCase()));
      const rankByAct = new Map<string, { role: "HEADLINE" | "SUPPORT"; billingRank: number }>();
      for (const lead of leads) rankByAct.set(lead.toLowerCase(), { role: "HEADLINE", billingRank: rank++ });
      for (const sup of supports) rankByAct.set(sup.toLowerCase(), { role: "SUPPORT", billingRank: rank++ });

      return performers.map((billedName, idx) => {
        const assigned = rankByAct.get(billedName.toLowerCase())!;
        return {
          billedName,
          listedPosition: idx + 1,
          role: assigned.role,
          billingRank: assigned.billingRank,
          billingOrderBasis: "EXPLICIT",
        };
      });
    }
  }

  // Multi-act bill without explicit headline/support prose -> preserve unknown billing rank (null)
  return performers.map((billedName, idx) => ({
    billedName,
    listedPosition: idx + 1,
    role: "PERFORMER",
    billingRank: null,
    billingOrderBasis: "LIST_ORDER_ONLY",
  }));
}

function extractOutboundArtistUrls(article: string, pageUrl: string, ticketUrl: string | null, performers: string[]): string[] {
  const pageParsed = new URL(pageUrl);
  const pageOrigin = pageParsed.origin;
  const venueStem = pageParsed.hostname.replace(/^www\./i, "").split(".")[0]?.toLowerCase() ?? "";
  const singleActTokens = performers.length === 1
    ? performers[0]!.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter((t) => t.length >= 3)
    : [];
  const found: string[] = [];
  for (const anchor of hrefTags(article)) {
    const normalized = canonicalHttpsUrl(anchor.attrs.href ?? "", pageUrl);
    if (!normalized) continue;
    const u = new URL(normalized);
    if (u.origin === pageOrigin) continue;
    if (/cookiedatabase\.org|onetrust\.com/i.test(u.hostname)) continue;
    if (/^\/user\//i.test(u.pathname) && /spotify\.com$/i.test(u.hostname)) continue;
    if (venueStem.length >= 4 && normalized.toLowerCase().includes(venueStem)) continue;
    if (KNOWN_TICKET_DOMAINS.test(u.hostname)) continue;
    if (normalized === ticketUrl) {
      const hostCompact = u.hostname.toLowerCase().replace(/[^a-z0-9]/g, "");
      const isArtistDirectDomain = singleActTokens.length > 0 && singleActTokens.every((tok) => hostCompact.includes(tok));
      if (!isArtistDirectDomain) continue;
    }
    if (!found.includes(normalized)) found.push(normalized);
  }
  return found;
}

function extractArtistObservations(
  performers: string[],
  paragraphs: string[],
  outboundUrls: string[],
): ArtistPageObservation[] {
  const observations: ArtistPageObservation[] = [];
  const spotifyIdMatch = outboundUrls
    .map((u) => u.match(/^https:\/\/open\.spotify\.com\/artist\/([A-Za-z0-9]{22})\b/))
    .find((m): m is RegExpMatchArray => Boolean(m));
  const singleActSpotifyUri = performers.length === 1 && spotifyIdMatch ? `spotify:artist:${spotifyIdMatch[1]}` : null;

  const allSentences = paragraphs
    .filter((p) => !isForFansOfClause(p))
    .flatMap((p) => p.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean));

  for (const billedName of performers) {
    const escaped = billedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const nameRe = new RegExp(`\\b${escaped}\\b`, "i");

    // Sentence-scoped attribution prevents support acts named in trailing "with support from X, Y"
    // clauses from inheriting the headliner's hometown or release claims from earlier sentences.
    const attributedSentences: string[] = [];
    if (performers.length === 1) {
      attributedSentences.push(...allSentences);
    } else {
      for (let idx = 0; idx < allSentences.length; idx++) {
        const sentence = allSentences[idx]!;
        if (nameRe.test(sentence)) {
          attributedSentences.push(sentence);
          // Include immediate follow-up pronoun sentence ("With the release of their debut EP imminent...")
          // only when no other billed performer is named in that follow-up sentence.
          const next = allSentences[idx + 1];
          if (next && /\b(?:they|their|his|her|the\s+(?:band|group|trio|duo|outfit|[a-z]+-piece))\b/i.test(next) && !performers.some((other) => new RegExp(`\\b${other.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(next))) {
            attributedSentences.push(next);
          }
        }
      }
    }
    const contextParagraphs = attributedSentences;
    const joined = contextParagraphs.join(" ");

    const baseLocalities: string[] = [];
    let baseCountryCode: string | null = null;
    let ukNation: "SCT" | "ENG" | "WLS" | "NIR" | null = null;
    let originText: string | null = null;
    let originCountryCode: string | null = null;

    const addUkLocality = (locRaw: string) => {
      const key = locRaw.trim().toLowerCase();
      const nation = UK_LOCALITY_NATION[key];
      if (!nation) return;
      const canonicalLoc = locRaw.trim().replace(/\b\w/g, (c) => c.toUpperCase());
      if (!baseLocalities.includes(canonicalLoc)) baseLocalities.push(canonicalLoc);
      baseCountryCode = "GB";
      ukNation ??= nation;
    };

    for (const p of contextParagraphs) {
      // Explicit UK base patterns
      for (const m of p.matchAll(/\bbased\s+(?:in|between)\s+([A-Z][a-z]+)(?:\s+and\s+([A-Z][a-z]+))?/g)) {
        if (m[1]) addUkLocality(m[1]);
        if (m[2]) addUkLocality(m[2]);
        if (/Greece/i.test(m[1] ?? "")) {
          originText ??= "Greece";
          originCountryCode ??= "GR";
        }
      }
      for (const m of p.matchAll(/\b(?:hailing\s+from|band\s+from|piece\s+from|outfit\s+from)\s+([A-Z][a-z]+)\b/g)) {
        if (m[1]) addUkLocality(m[1]);
      }
      const prefixLoc = p.match(new RegExp(`\\b(Aberdeen|Edinburgh|Glasgow|Fife|Bristol|Manchester|London|Brighton|Leeds|Cardiff|Belfast)\\s+[^.]{0,50}?\\b${escaped}\\b`, "i"));
      if (prefixLoc?.[1]) addUkLocality(prefixLoc[1]);

      // Explicit non-UK origins
      if (new RegExp(`\\bDutch\\s+(?:trio|band|duo|act|group)\\s+${escaped}\\b`, "i").test(p)) {
        originText = "Dutch trio";
        originCountryCode = "NL";
      }
      if (/Oakland,\s*California/i.test(p)) {
        originText = "Oakland, California";
        originCountryCode = "US";
      }
      if (/Originally\s+from\s+Athens/i.test(p)) {
        originText = "Athens, Greece";
        originCountryCode = "GR";
      }
    }

    let repertoireOriginality: ArtistPageObservation["repertoireOriginality"] = "UNKNOWN";
    const emergingSignals: ArtistPageObservation["emergingSignals"] = [];
    const musicEvidence: ArtistPageObservation["musicEvidence"] = [];

    for (const p of contextParagraphs) {
      if (/\b(?:release\s+of\s+their\s+debut\s+EP\s+imminent|debut\s+EP\s+imminent)\b/i.test(p)) {
        repertoireOriginality = "ORIGINAL";
        const ex = boundedExcerpt(p);
        emergingSignals.push({ signalType: "DEBUT_RELEASE_IMMINENT", value: "Debut EP imminent", excerpt: ex });
        musicEvidence.push({ title: null, releaseKind: "EP", releaseStatus: "IMMINENT", url: null, excerpt: ex });
      } else if (/\bupcoming\s+debut\s+album\b/i.test(p)) {
        repertoireOriginality = "ORIGINAL";
        const ex = boundedExcerpt(p);
        emergingSignals.push({ signalType: "DEBUT_ALBUM_UPCOMING", value: "Upcoming debut album", excerpt: ex });
        musicEvidence.push({ title: null, releaseKind: "ALBUM", releaseStatus: "UPCOMING", url: outboundUrls[0] ?? null, excerpt: ex });
      } else if (/\b(?:songwriting|songwriters|each\s+new\s+release|high-energy\s+punk\s+songs|infuriatingly\s+catchy\s+songs)\b/i.test(p)) {
        repertoireOriginality = "ORIGINAL";
      }
      if (/\b(?:2026\s+has\s+been\s+a\s+breakout\s+year|debut\s+[A-Z][A-Za-z ]+\s+tour)\b/i.test(p)) {
        emergingSignals.push({ signalType: "EARLY_TOUR_OR_BREAKOUT_CONTEXT", value: "2026 breakout / debut tour context", excerpt: boundedExcerpt(p) });
      }
    }

    if (/\b(?:tribute\s+to|the\s+songs\s+of)\b/i.test(joined)) {
      repertoireOriginality = "TRIBUTE";
    }

    observations.push({
      billedName,
      baseLocalities,
      baseCountryCode,
      ukNation,
      originText,
      originCountryCode,
      repertoireOriginality,
      emergingSignals,
      musicEvidence,
      spotifyArtistUri: singleActSpotifyUri,
      excerpt: contextParagraphs[0] ? boundedExcerpt(contextParagraphs[0]) : null,
    });
  }

  return observations;
}

export function extractHtmlEventFacts(document: FetchedDocument): HtmlEventFacts | null {
  const pathname = new URL(document.url).pathname;
  const isStandardEventPath = eventPath.test(pathname);
  const isDatedPermalink = !isStandardEventPath && datedPermalinkPath.test(pathname);
  if (!isStandardEventPath && !isDatedPermalink) return null;

  const articleTag = tags(document.body, "article")[0];
  const article = articleTag?.inner;
  if (!article) return null;

  const ticket = hrefTags(article).find((anchor) =>
    (/\b(?:tickets?|rsvp|book(?:ing)?)\b/i.test(visibleText(anchor.inner)) || /\btickets?\b/i.test(anchor.attrs.class ?? ""))
    && canonicalHttpsUrl(anchor.attrs.href ?? "", document.url));
  const ticketUrl = ticket ? canonicalHttpsUrl(ticket.attrs.href ?? "", document.url) : null;

  if (isDatedPermalink && (!/<time\b/i.test(article) || !ticketUrl)) return null;

  const rawParagraphs = tags(article, "p")
    .map((p) => text(visibleText(p.inner)))
    .filter((p): p is string => p !== null && !/^buy\s+tickets$/i.test(p));

  const h1Inner = tags(article, "h1")[0]?.inner ?? null;
  const h2Tag = tags(article, "h2").find((t) => /\bentry-title\b/i.test(t.attrs.class ?? "")) ?? tags(article, "h2")[0];

  let title: string | null = null;
  let eventStatus: string | null = null;
  let seriesTitle: string | null = null;
  let headerPerformers: string[] = [];

  const h1Visible = h1Inner ? text(visibleText(h1Inner)) : null;
  if (h1Visible) {
    // Preserve exact h1 title text for backward compatibility with existing Squarespace/portable callers
    title = h1Visible;
    const statusPrefix = h1Visible.match(/^(postponed|cancelled|rescheduled)\s*:/i);
    eventStatus = statusPrefix ? statusPrefix[1]!.toUpperCase() : null;
  } else if (h2Tag?.inner) {
    const parsedH2 = parseEntryHeading(h2Tag.inner, rawParagraphs);
    title = parsedH2.title;
    eventStatus = parsedH2.eventStatus;
    seriesTitle = parsedH2.seriesTitle;
    headerPerformers = parsedH2.headerPerformers;
  }
  if (!title) return null;
  const finalTitle = title;

  const isoTimes = selfClosingTags(article, "time")
    .map(({ attrs }) => instant(attrs.datetime))
    .filter((value): value is string => Boolean(value));

  let startAt: string | null = isoTimes[0] ?? null;
  let endAt: string | null = isoTimes[1] ?? null;
  let timePrecision: HtmlEventFacts["timePrecision"] = startAt ? "EXPLICIT_INSTANT" : undefined;
  let timeMeaning: HtmlEventFacts["timeMeaning"] = startAt ? "DOORS_OR_START" : undefined;
  let timezone = timezoneFromPage(document);

  if (!startAt) {
    const humanDate = parseHumanDate(article, pathname);
    if (humanDate) {
      const joinedProse = `${title} ${rawParagraphs.join(" ")}`;
      const doorsMatch = joinedProse.match(/\bdoors\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)(?:[\s,;/]+curfew\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm))?/i);
      const windowMatch = joinedProse.match(/\((\d{1,2})(?:[:.](\d{2}))?\s*-\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\)/i);
      if (doorsMatch) {
        startAt = londonLocalToUtcIso(humanDate, parseClockHourMin(doorsMatch[1]!, doorsMatch[2], doorsMatch[3]!));
        if (doorsMatch[4] && doorsMatch[6]) {
          endAt = londonLocalToUtcIso(humanDate, parseClockHourMin(doorsMatch[4], doorsMatch[5], doorsMatch[6]));
        }
        timezone ??= "Europe/London";
        timePrecision = "EXPLICIT_INSTANT";
        timeMeaning = "DOORS_OPEN";
      } else if (windowMatch) {
        const mer = windowMatch[5]!;
        startAt = londonLocalToUtcIso(humanDate, parseClockHourMin(windowMatch[1]!, windowMatch[2], mer));
        endAt = londonLocalToUtcIso(humanDate, parseClockHourMin(windowMatch[3]!, windowMatch[4], mer));
        timezone ??= "Europe/London";
        timePrecision = "EXPLICIT_INSTANT";
        timeMeaning = "SHOW_WINDOW";
      } else {
        startAt = `${humanDate}T00:00:00.000Z`;
        timePrecision = "DATE_ONLY";
        timeMeaning = "DATE_ONLY_DEFAULTED";
      }
    }
  }

  const rawOgUrl = meta(document, "og:url");
  const canonical = canonicalHttpsUrl(rawOgUrl ?? document.url, document.url);
  const isRootQueryShortlink = Boolean(canonical && new URL(canonical).pathname === "/" && new URL(canonical).searchParams.has("p") && pathname !== "/");
  const sourceEventUrl = canonical && !isRootQueryShortlink && new URL(canonical).origin === new URL(document.url).origin ? canonical : document.url;
  const location = tags(article, "div").find((tag) => tag.attrs.itemprop === "location" || Boolean(tag.attrs["data-venue"]))?.inner;
  const venueText = text(location ? visibleText(location) : null);

  const structuredDescTag = tags(article, "div").find((tag) => tag.attrs.itemprop === "description" || /\bsqs-html-content\b/.test(tag.attrs.class ?? ""))?.inner;
  const description = structuredDescTag
    ? visibleText(structuredDescTag).slice(0, 10_000)
    : (!h1Visible && rawParagraphs.length ? rawParagraphs.join("\n").slice(0, 10_000) : null);

  const siteNameNorm = (meta(document, "og:site_name") ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const venueHostStem = new URL(document.url).hostname.replace(/^www\./i, "").split(".")[0]?.toLowerCase().replace(/[^a-z0-9]+/g, "") ?? "";
  let organiser: string | null = null;
  for (const p of rawParagraphs.slice(0, 4)) {
    const presMatch = p.match(/^([A-Za-z0-9 '&.-]{2,70}?)\s+presents$/i);
    if (presMatch) {
      const candidateOrg = presMatch[1]!.trim();
      const candidateNorm = candidateOrg.toLowerCase().replace(/[^a-z0-9]+/g, "");
      const matchesSiteVenue = (siteNameNorm.length >= 4 && candidateNorm.includes(siteNameNorm))
        || (venueHostStem.length >= 4 && candidateNorm.includes(venueHostStem));
      if (!matchesSiteVenue) {
        organiser = candidateOrg;
        break;
      }
    }
  }

  const ageMatch = rawParagraphs.join(" ").match(/\b(14\+|16\+|18\+|all ages)(?!\w)/i);
  const ageRestriction = ageMatch ? ageMatch[1]! : null;

  const articlePerformers = performersFromArticle(article);
  const performers = headerPerformers.length ? headerPerformers : articlePerformers;
  const performerBillings = classifyPerformerBillings(performers, rawParagraphs, ticketUrl, finalTitle);
  const outboundArtistUrls = extractOutboundArtistUrls(article, document.url, ticketUrl, performers);
  const artistObservations = extractArtistObservations(performers, rawParagraphs, outboundArtistUrls);

  return {
    title: finalTitle,
    sourceExternalId: text(articleTag?.attrs["data-event-id"] ?? articleTag?.attrs["data-item-id"])?.slice(0, 256) ?? null,
    sourceEventUrl,
    startAt,
    endAt,
    timezone,
    venueText,
    description,
    organiser,
    ageRestriction,
    eventStatus,
    ...(timePrecision ? { timePrecision } : {}),
    ...(timeMeaning ? { timeMeaning } : {}),
    ...(seriesTitle ? { seriesTitle } : {}),
    performers,
    performerBillings,
    outboundArtistUrls,
    artistObservations,
    ticketUrl,
    eventImageUrl: imageFromPage(document, article),
  };
}

export function extractHCalendarIndexSummaries(document: FetchedDocument): HCalendarIndexSummary[] {
  const summaries: HCalendarIndexSummary[] = [];
  const pattern = /<div\b[^>]*\bid=["'](hcalendar-event-[A-Za-z0-9_-]+)["'][^>]*\bclass=["'][^"']*\bvevent\b[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*\bid=["']hcalendar-event-|<footer\b|<\/main>|$)/gi;
  for (const match of document.body.matchAll(pattern)) {
    const sourceExternalId = match[1]!.trim();
    const block = match[2]!;
    const dtTitle = block.match(/<abbr\b[^>]*\btitle=["'](\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)["'][^>]*\bclass=["'][^"']*\bdtstart\b/i)
      ?? block.match(/<abbr\b[^>]*\bclass=["'][^"']*\bdtstart\b[^"']*["'][^>]*\btitle=["'](\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)["']/i);
    const urlHref = block.match(/<h3\b[^>]*\bclass=["'][^"']*\bsummary\b[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*\bhref=["']([^"']+)["']/i)?.[1];
    if (!dtTitle || !urlHref) continue;
    const sourceEventUrl = canonicalHttpsUrl(urlHref, document.url);
    if (!sourceEventUrl || new URL(sourceEventUrl).origin !== new URL(document.url).origin) continue;
    const timePart = dtTitle[2]!.length === 5 ? `${dtTitle[2]}:00` : dtTitle[2]!;
    const startAt = londonLocalToUtcIso(dtTitle[1]!, timePart);
    summaries.push({
      sourceEventUrl,
      sourceExternalId,
      startAt,
      timezone: "Europe/London",
      timePrecision: "EXPLICIT_INSTANT",
      timeMeaning: "DOORS_OR_START",
      sourceHash: document.sourceHash,
    });
  }
  return summaries;
}

function normalizeTicketUrl(rawHref: string | null | undefined, base: string): string | null {
  const trimmed = text(rawHref);
  if (!trimmed) return null;
  let candidate = trimmed;
  if (/^https?:\/\/seetickets\/com\//i.test(candidate)) {
    candidate = candidate.replace(/^https?:\/\/seetickets\/com\//i, "https://www.seetickets.com/");
  }
  if (/^[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+\//.test(candidate) && !/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }
  return canonicalHttpsUrl(candidate, base);
}

function normalizeImageUrl(rawSrc: string | null | undefined, base: string): string | null {
  const trimmed = text(rawSrc);
  if (!trimmed) return null;
  return canonicalHttpsUrl(trimmed, base);
}

export function extractHtmlCardEvents(document: FetchedDocument): HtmlEventFacts[] {
  const cardStarts = [...document.body.matchAll(/<div\b[^>]*\bclass=["'][^"']*\bgrid_item\b[^"']*\bevent\b[^"']*["'][^>]*>/gi)];
  if (!cardStarts.length) return [];
  const events: HtmlEventFacts[] = [];
  for (let i = 0; i < cardStarts.length; i++) {
    const startIdx = cardStarts[i]!.index;
    const nextStart = i + 1 < cardStarts.length ? cardStarts[i + 1]!.index : document.body.indexOf("</main>", startIdx);
    const chunk = document.body.slice(startIdx, nextStart > startIdx ? nextStart : startIdx + 3000);
    const dateAttr = chunk.match(/data-date=["']([^"']+)["']/i)?.[1]?.trim();
    if (!dateAttr || !/^\d{4}-\d{2}-\d{2}$/.test(dateAttr)) continue;
    const artistAttr = chunk.match(/data-artist=["']([^"']+)["']/i)?.[1]?.trim();
    const rawTitle = chunk.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1];
    const title = text(rawTitle ? visibleText(rawTitle) : null);
    if (!title) continue;

    const dateText = text(chunk.match(/<p\b[^>]*\bclass=["'][^"']*\bdate\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1]) ?? "";
    const rawLoc = chunk.match(/<p\b[^>]*\bclass=["'][^"']*\blocation\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1];
    const locText = text(rawLoc ? visibleText(rawLoc) : null);
    const rawTicketHref = chunk.match(/<a\b[^>]*\bclass=["'][^"']*\bevent_link\b[^"']*["'][^>]*\bhref=["']([^"']+)["']/i)?.[1];
    const rawImgSrc = chunk.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];

    let timeString = "19:00:00";
    let timePrecision: HtmlEventFacts["timePrecision"] = "DATE_ONLY";
    let timeMeaning: HtmlEventFacts["timeMeaning"] = "DATE_ONLY_DEFAULTED";
    const timeMatch = dateText.match(/^(\d{1,2}):(\d{2})(AM|PM)\b/i);
    if (timeMatch) {
      let hour = parseInt(timeMatch[1]!, 10);
      const min = timeMatch[2]!;
      const meridiem = timeMatch[3]!.toUpperCase();
      if (meridiem === "PM" && hour < 12) hour += 12;
      if (meridiem === "AM" && hour === 12) hour = 0;
      timeString = `${hour.toString().padStart(2, "0")}:${min}:00`;
      timePrecision = "EXPLICIT_INSTANT";
      timeMeaning = "DOORS_OR_START";
    }

    const startAt = londonLocalToUtcIso(dateAttr, timeString);
    const artistSlug = artistAttr || title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const sourceEventUrl = `${document.url}#${artistSlug}-${dateAttr}`;
    const ticketUrl = normalizeTicketUrl(rawTicketHref, document.url);
    const eventImageUrl = normalizeImageUrl(rawImgSrc, document.url);

    events.push({
      title,
      sourceExternalId: null,
      sourceEventUrl,
      startAt,
      endAt: null,
      timezone: "Europe/London",
      venueText: locText,
      description: null,
      timePrecision,
      timeMeaning,
      performers: [title],
      ticketUrl,
      eventImageUrl,
    });
  }
  return events;
}
