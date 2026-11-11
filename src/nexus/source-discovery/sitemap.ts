import { gunzipSync } from "node:zlib";
import { decodeHtml } from "./html.ts";

export const SITEMAP_LIMITS = { maxFetches: 4, maxDepth: 2, maxUrlsPerSitemap: 5_000, maxUncompressedBytes: 10_000_000 };

export function robotsSitemapDirectives(robotsText: string): string[] {
  const found: string[] = [];
  for (const raw of robotsText.split(/\r?\n/)) {
    const match = /^\s*sitemap\s*:\s*(\S+)/i.exec(raw.replace(/#.*$/, ""));
    if (match && !found.includes(match[1]!)) found.push(match[1]!);
  }
  return found.slice(0, 20);
}

export function conventionalSitemapUrls(origin: string): string[] {
  return [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
}

export type ParsedSitemap = { kind: "INDEX" | "URLSET" | "TEXT"; urls: Array<{ loc: string; lastmod: string | null }> };

export function inflateSitemap(bytes: Uint8Array): Uint8Array | null {
  try { return gunzipSync(bytes, { maxOutputLength: SITEMAP_LIMITS.maxUncompressedBytes }); } catch { return null; }
}

export function parseSitemap(text: string): ParsedSitemap {
  const body = text.replace(/<!--[\s\S]*?-->/g, " ");
  const index = /<sitemapindex\b/i.test(body);
  const urls: ParsedSitemap["urls"] = [];
  if (/<(?:urlset|sitemapindex)\b/i.test(body)) {
    const entry = index ? /<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi : /<url\b[^>]*>([\s\S]*?)<\/url>/gi;
    for (const match of body.matchAll(entry)) {
      if (urls.length >= SITEMAP_LIMITS.maxUrlsPerSitemap) break;
      const loc = /<loc\b[^>]*>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/i.exec(match[1]!)?.[1]?.trim();
      if (!loc) continue;
      const lastmod = /<lastmod\b[^>]*>\s*([^<]+?)\s*<\/lastmod>/i.exec(match[1]!)?.[1] ?? null;
      urls.push({ loc: decodeHtml(loc), lastmod });
    }
    return { kind: index ? "INDEX" : "URLSET", urls };
  }
  for (const line of body.split(/\r?\n/)) {
    if (urls.length >= SITEMAP_LIMITS.maxUrlsPerSitemap) break;
    const value = line.trim();
    if (/^https:\/\/\S+$/i.test(value)) urls.push({ loc: value, lastmod: null });
  }
  return { kind: "TEXT", urls };
}

/**
 * Child sitemaps likely to list pages (not posts/products/media archives) are visited first. Only the best
 * tier is returned: each child costs one request from the crawl budget, and a WordPress index lists
 * author, template and post sitemaps that never name a hire, contact or spaces page (2026-11-10:
 * rockingthedaisies spent 5 of its 9 requests on sitemaps and fetched only 2 content pages).
 */
export function rankChildSitemaps(urls: string[]): string[] {
  const score = (url: string) => {
    const path = new URL(url).pathname.toLowerCase();
    if (/(?:post|blog|news|product|tag|categor|author|attachment|image|video|event_listing|archive|feed|template)/.test(path)) return 0;
    if (/(?:page|venue|space|room|hire|site|main|static)/.test(path)) return 3;
    return 1;
  };
  const ranked = [...urls].sort((a, b) => score(b) - score(a) || a.localeCompare(b));
  const best = ranked.length ? score(ranked[0]!) : 0;
  return best > 0 ? ranked.filter((url) => score(url) === best) : ranked.slice(0, 1);
}
