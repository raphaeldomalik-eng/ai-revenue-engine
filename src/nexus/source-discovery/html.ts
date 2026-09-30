export type HtmlTag = { attrs: Record<string, string>; inner: string };

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", hellip: "…", pound: "£", euro: "€", copy: "©", reg: "®", trade: "™", middot: "·",
  bull: "•", times: "×", deg: "°", frac12: "½", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", uuml: "ü",
  ouml: "ö", auml: "ä", szlig: "ß", shy: "",
};

export function decodeHtml(value: string): string {
  return value.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,8});/gi, (entity, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1));
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return entity;
      return code === 160 ? " " : String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
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

/** Navigation anchors only. Script, style, template, and comment copies are not fetchable links. */
export function documentNavigationHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

export function hrefTags(html: string): HtmlTag[] {
  return tags(documentNavigationHtml(html), "a");
}
