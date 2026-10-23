import { attributes, documentNavigationHtml, tags, visibleText } from "./html.ts";
import type { FetchedDocument } from "./types.ts";

export type WebsiteOpportunity = {
  version: "passive-html-v1";
  classification: "ImprovementObserved" | "Unknown";
  evidence: Array<{
    signal: "MISSING_TITLE" | "MISSING_META_DESCRIPTION" | "MISSING_DEVICE_WIDTH_VIEWPORT" | "LEGACY_FRAMESET";
    sourceUrl: string;
    sourceHash: string;
    observedAt: string;
  }>;
};

/** Observations of sampled static markup, never a commercial or whole-site quality score. */
export function assessWebsiteOpportunity(documents: readonly FetchedDocument[]): WebsiteOpportunity {
  const unknown: WebsiteOpportunity = { version: "passive-html-v1", classification: "Unknown", evidence: [] };
  try {
    const evidence: WebsiteOpportunity["evidence"] = [];
    for (const document of documents.slice(0, 8)) {
      // No rendered, derived, fragmentary, oversized, or unsupported evidence. Do not truncate
      // markup and then treat the truncated portion as proof that metadata was absent.
      if (document.kind !== "HTML" || document.retrieval === "RENDERED" || document.shellSignals?.length ||
        document.body.length > 1_500_000 || !document.sourceHash || !Number.isFinite(Date.parse(document.observedAt))) continue;
      const url = new URL(document.url);
      if (url.protocol !== "https:") continue;
      const html = documentNavigationHtml(document.body);
      if (!/<html\b/i.test(html) || !/<\/html\s*>/i.test(html) || !/<head\b/i.test(html) || !/<\/head\s*>/i.test(html)) continue;
      const head = tags(html, "head")[0]?.inner;
      if (head == null) continue;
      const title = visibleText(tags(head, "title")[0]?.inner ?? "");
      const body = visibleText(tags(html, "body")[0]?.inner ?? "");
      // A challenge/error/placeholder is insufficient evidence about the actual website.
      if (/access denied|forbidden|just a moment|verify you are human|captcha|under construction|coming soon|page not found|service unavailable/i.test(`${title} ${body}`)) continue;
      const signals: WebsiteOpportunity["evidence"][number]["signal"][] = [];
      if (/<frameset\b/i.test(html)) signals.push("LEGACY_FRAMESET");
      else {
        if (body.length < 40 || /enable javascript|javascript (?:is )?required/i.test(body)) continue;
        // Attribute values can contain `>`; only an unquoted bracket closes a tag.
        const metaTags = [...head.matchAll(/<meta\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>/gi)];
        if (metaTags.length !== (head.match(/<meta\b/gi)?.length ?? 0)) continue;
        const meta = metaTags.map(match => ({ attrs: attributes(match[1] ?? "") }));
        if (!title) signals.push("MISSING_TITLE");
        if (!meta.some(({ attrs }) => attrs.name?.trim().toLowerCase() === "description" && attrs.content?.trim())) signals.push("MISSING_META_DESCRIPTION");
        if (!meta.some(({ attrs }) => attrs.name?.trim().toLowerCase() === "viewport" && /(?:^|[,;\s])width\s*=\s*device-width(?:$|[,;\s])/i.test(attrs.content ?? ""))) signals.push("MISSING_DEVICE_WIDTH_VIEWPORT");
      }
      for (const signal of signals) {
        evidence.push({ signal, sourceUrl: document.url, sourceHash: document.sourceHash, observedAt: document.observedAt });
        if (evidence.length === 8) break;
      }
      if (evidence.length === 8) break;
    }
    return evidence.length ? { version: "passive-html-v1", classification: "ImprovementObserved", evidence } : unknown;
  } catch {
    return unknown;
  }
}

/** Reuse the mandatory replay write; optional metadata rejection must not reject the crawl.
 * If even the original payload cannot be stored, retain the existing replay-ledger safeguard.
 */
export async function storeWithWebsiteOpportunity(
  store: { set(key: string, result: Record<string, unknown>): Promise<void> },
  key: string,
  result: Record<string, unknown>,
  assessment: WebsiteOpportunity | undefined,
) {
  if (assessment) {
    try {
      await store.set(key, { ...result, crawlIntelligence: { websiteOpportunity: assessment } });
      return;
    } catch { /* Retry the original mandatory payload without optional intelligence. */ }
  }
  await store.set(key, result);
}
