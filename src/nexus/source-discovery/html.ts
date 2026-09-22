export type HtmlTag = { attrs: Record<string, string>; inner: string };

export function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function attributes(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of raw.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result[match[1]!.toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return result;
}

export function tags(html: string, name: string): HtmlTag[] {
  const result: HtmlTag[] = [];
  const pattern = new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)<\\/${name}>`, "gi");
  for (const match of html.matchAll(pattern)) result.push({ attrs: attributes(match[1] ?? ""), inner: match[2] ?? "" });
  return result;
}

export function selfClosingTags(html: string, name: string): Array<{ attrs: Record<string, string> }> {
  const result: Array<{ attrs: Record<string, string> }> = [];
  const pattern = new RegExp(`<${name}\\b([^>]*)/?\\s*>`, "gi");
  for (const match of html.matchAll(pattern)) result.push({ attrs: attributes(match[1] ?? "") });
  return result;
}

export function visibleText(html: string): string {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  ).trim();
}

export function hrefTags(html: string): HtmlTag[] {
  return tags(html, "a");
}
