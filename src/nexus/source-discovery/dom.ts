import { decodeHtml } from "./html.ts";

export type DomNode = DomElement | DomText;
export type DomText = { type: "text"; text: string; parent: DomElement | null };
export type DomElement = { type: "element"; tag: string; attrs: Record<string, string>; children: DomNode[]; parent: DomElement | null };

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW_TEXT = new Set(["script", "style", "textarea", "title", "noscript", "template"]);
const IMPLIED_END: Record<string, string[]> = {
  p: ["p"], li: ["li"], dt: ["dt", "dd"], dd: ["dt", "dd"], tr: ["tr", "td", "th"], td: ["td", "th"], th: ["td", "th"],
  option: ["option"], thead: ["tbody", "tfoot"], tbody: ["tbody", "tfoot", "thead"],
};
const BLOCK_CLOSES_P = new Set(["div", "table", "ul", "ol", "dl", "section", "article", "header", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "form", "main", "nav", "aside", "figure", "blockquote", "pre"]);
const BLOCK = new Set([...BLOCK_CLOSES_P, "p", "li", "tr", "td", "th", "dt", "dd", "br", "hr", "option", "caption", "figcaption", "address", "picture"]);

export const DOM_LIMITS = { maxNodes: 60_000, maxDepth: 256, maxInputBytes: 5_000_000 };

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(/([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    const name = match[1]!.toLowerCase();
    if (name in attrs) continue;
    attrs[name] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

/** Tolerant tree builder: recovers from unclosed and misnested tags, never executes scripts, bounded in size and depth. */
export function parseHtml(html: string): DomElement {
  const input = html.length > DOM_LIMITS.maxInputBytes ? html.slice(0, DOM_LIMITS.maxInputBytes) : html;
  const root: DomElement = { type: "element", tag: "#root", attrs: {}, children: [], parent: null };
  const stack: DomElement[] = [root];
  let nodes = 0;
  const current = () => stack[stack.length - 1]!;
  const pushText = (text: string) => {
    if (!text || nodes >= DOM_LIMITS.maxNodes) return;
    nodes += 1;
    current().children.push({ type: "text", text, parent: current() });
  };
  const closeTo = (tag: string) => {
    for (let index = stack.length - 1; index > 0; index -= 1) {
      if (stack[index]!.tag === tag) { stack.length = index; return true; }
      if (["table", "ul", "ol", "dl", "body", "html"].includes(stack[index]!.tag) && tag !== stack[index]!.tag && ["li", "td", "th", "tr", "dt", "dd"].includes(tag)) return false;
    }
    return false;
  };
  const pattern = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<![^>]*>|<\?[^>]*>|<\/\s*([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
  let last = 0;
  for (let match = pattern.exec(input); match; match = pattern.exec(input)) {
    if (match.index > last) pushText(input.slice(last, match.index));
    last = pattern.lastIndex;
    if (match[1]) {
      const tag = match[1].toLowerCase();
      if (tag === "p" && !stack.some((item) => item.tag === "p")) continue;
      closeTo(tag);
      continue;
    }
    if (!match[2]) continue;
    const tag = match[2].toLowerCase();
    if (nodes >= DOM_LIMITS.maxNodes) break;
    const implied = IMPLIED_END[tag];
    if (implied && implied.includes(current().tag)) stack.pop();
    else if (implied && tag !== "p") {
      for (let index = stack.length - 1; index > 0; index -= 1) {
        const open = stack[index]!.tag;
        if (["table", "ul", "ol", "dl", "div", "section"].includes(open)) break;
        if (implied.includes(open)) { stack.length = index; break; }
      }
    }
    if (BLOCK_CLOSES_P.has(tag) && current().tag === "p") stack.pop();
    const element: DomElement = { type: "element", tag, attrs: parseAttributes(match[3] ?? ""), children: [], parent: current() };
    nodes += 1;
    current().children.push(element);
    if (VOID.has(tag) || match[4] === "/") continue;
    if (RAW_TEXT.has(tag)) {
      const close = new RegExp(`</${tag}\\s*>`, "ig");
      close.lastIndex = last;
      const end = close.exec(input);
      const raw = input.slice(last, end ? end.index : input.length);
      if (raw) { nodes += 1; element.children.push({ type: "text", text: raw, parent: element }); }
      last = end ? close.lastIndex : input.length;
      pattern.lastIndex = last;
      continue;
    }
    if (stack.length < DOM_LIMITS.maxDepth) stack.push(element);
  }
  if (last < input.length) pushText(input.slice(last));
  return root;
}

export function walk(node: DomElement, visit: (element: DomElement) => void) {
  const pending: DomElement[] = [node];
  while (pending.length) {
    const item = pending.shift()!;
    visit(item);
    for (const child of item.children) if (child.type === "element") pending.push(child);
  }
}

/** Document-order traversal (depth-first) for stable output ordering. */
export function elements(root: DomElement, predicate: (element: DomElement) => boolean): DomElement[] {
  const found: DomElement[] = [];
  const visit = (node: DomElement) => {
    if (predicate(node)) found.push(node);
    for (const child of node.children) if (child.type === "element") visit(child);
  };
  visit(root);
  return found;
}

export function byTag(root: DomElement, ...tags: string[]): DomElement[] {
  const wanted = new Set(tags);
  return elements(root, (element) => wanted.has(element.tag));
}

/** Visible text: skips script/style/template/noscript and hidden elements; block elements become line breaks. */
export function textContent(node: DomNode, separator = " "): string {
  const parts: string[] = [];
  const visit = (item: DomNode) => {
    if (item.type === "text") { parts.push(decodeHtml(item.text)); return; }
    if (["script", "style", "template", "noscript", "head"].includes(item.tag) || "hidden" in item.attrs || item.attrs["aria-hidden"] === "true") return;
    if (BLOCK.has(item.tag)) parts.push("\n");
    for (const child of item.children) visit(child);
    if (BLOCK.has(item.tag)) parts.push("\n");
  };
  visit(node);
  const joined = parts.join("");
  return separator === "\n"
    ? joined.split(/\n+/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n")
    : joined.replace(/\s+/g, " ").trim();
}

export function closestAncestor(element: DomElement, predicate: (ancestor: DomElement) => boolean): DomElement | null {
  for (let node = element.parent; node; node = node.parent) if (predicate(node)) return node;
  return null;
}

/** Headings preceding an element in document order, nearest first, used to attribute tables/lists to a named space. */
export function precedingHeading(root: DomElement, target: DomElement): DomElement | null {
  let found: DomElement | null = null;
  let done = false;
  const visit = (node: DomElement) => {
    if (done) return;
    if (node === target) { done = true; return; }
    if (/^h[1-4]$/.test(node.tag)) found = node;
    for (const child of node.children) if (child.type === "element") visit(child);
  };
  visit(root);
  return found;
}
