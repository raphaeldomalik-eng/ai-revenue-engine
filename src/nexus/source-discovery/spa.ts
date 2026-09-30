import { tags, visibleText } from "./html.ts";

export type ShellAssessment = {
  shell: boolean;
  signals: string[];
  visibleChars: number;
  hydrationStrings: string[];
  hydrationImages: string[];
};

const MAX_HYDRATION_STRINGS = 1500;
const MAX_HYDRATION_BYTES = 2_000_000;
const SKIP_KEYS = /^(?:id|_id|key|class(?:name)?|style|css|slug|hash|token|nonce|buildid|locale|__typename|typename|type|variant|icon|component|template|layout|theme|color|colour|width|height|srcset|sizes|loading|target|rel|query|assetprefix|runtimeconfig|gssp|gsp|isfallback|scriptloader|page)$/i;

function balancedJson(source: string, start: number): string | null {
  const open = source[start];
  if (open !== "{" && open !== "[") return null;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  for (let index = start; index < source.length && index - start < MAX_HYDRATION_BYTES; index += 1) {
    const char = source[index]!;
    if (inString) {
      if (char === "\\") index += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth += 1;
    else if (char === close) { depth -= 1; if (depth === 0) return source.slice(start, index + 1); }
  }
  return null;
}

/** Embedded JSON state in known framework containers; parsed as data only, never evaluated. */
export function hydrationPayloads(html: string): unknown[] {
  const payloads: unknown[] = [];
  const push = (raw: string | null) => {
    if (!raw || raw.length > MAX_HYDRATION_BYTES) return;
    try { payloads.push(JSON.parse(raw)); } catch { /* non-JSON state (JS literals) is skipped, not evaluated */ }
  };
  for (const script of tags(html, "script")) {
    const type = (script.attrs.type ?? "").toLowerCase();
    const id = (script.attrs.id ?? "").toLowerCase();
    if (id === "__next_data__" || id === "__nuxt_data__" || id === "ng-state" || (type === "application/json" && script.inner.trim().length > 2)) push(script.inner.trim());
    else if (!type || type === "text/javascript" || type === "module") {
      for (const match of script.inner.matchAll(/(?:window\.)?(?:__NUXT__|__INITIAL_STATE__|__PRELOADED_STATE__|__APOLLO_STATE__|__remixContext|__staticRouterHydrationData)\s*=\s*/g)) {
        push(balancedJson(script.inner, (match.index ?? 0) + match[0].length));
      }
      for (const match of script.inner.matchAll(/JSON\.parse\(\s*"((?:[^"\\]|\\.){20,})"\s*\)/g)) {
        try { push(JSON.parse(`"${match[1]}"`)); } catch { /* malformed escaped JSON is skipped */ }
      }
    }
  }
  return payloads;
}

function collect(value: unknown, strings: string[], images: string[], depth: number, key: string) {
  if (depth > 24 || strings.length >= MAX_HYDRATION_STRINGS) return;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || SKIP_KEYS.test(key)) return;
    if (/^https?:\/\/\S+\.(?:jpe?g|png|webp|avif|gif)(?:\?\S*)?$/i.test(text) || (/^\/\S+\.(?:jpe?g|png|webp|avif)(?:\?\S*)?$/i.test(text) && /image|photo|src|url|gallery|hero|thumbnail/i.test(key))) {
      if (images.length < 200) images.push(text);
      return;
    }
    const human = /\s/.test(text) && /[A-Za-z]/.test(text);
    const contact = /^(?:mailto:|tel:)/i.test(text) || /^[\w.%+-]+@[\w-]+(?:\.[\w-]+)+$/.test(text) || /^\+?\d[\d\s().-]{7,}\d$/.test(text);
    if ((human || contact) && !/^[{[]/.test(text) && text.length <= 5000) {
      const readable = /<[a-z][\s\S]*>/i.test(text) ? visibleText(text) : text;
      strings.push(/^mailto:/i.test(readable) ? `Email: ${readable.slice(7)}` : /^tel:/i.test(readable) ? `Telephone: ${readable.slice(4)}` : contact && !human ? `${key}: ${readable}` : readable);
    }
    return;
  }
  if (typeof value === "number" && /capacity|guests|seated|standing|theatre|cabaret|banquet|reception|classroom|boardroom/i.test(key)) {
    strings.push(`${key.replace(/([a-z])([A-Z])/g, "$1 $2")}: ${value}`);
    return;
  }
  if (Array.isArray(value)) { for (const item of value) collect(item, strings, images, depth + 1, key); return; }
  if (value && typeof value === "object") for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) collect(child, strings, images, depth + 1, childKey);
}

/**
 * Static retrieval is materially incomplete when the visible body is thin while the markup carries a framework
 * mount point, hydration state, or metadata that the body does not render.
 */
export function assessStaticRetrieval(html: string): ShellAssessment {
  const body = tags(html, "body")[0]?.inner ?? html;
  const visibleChars = visibleText(body).length;
  const signals: string[] = [];
  if (/<div\b[^>]*\bid=["'](?:__next|__nuxt|root|app|svelte|___gatsby|q-app)["'][^>]*>\s*(?:<\/div>|<noscript)/i.test(html)) signals.push("EMPTY_FRAMEWORK_MOUNT");
  if (/<script\b[^>]*id=["']__NEXT_DATA__["']/i.test(html)) signals.push("NEXT_DATA");
  if (/__NUXT__|__NUXT_DATA__/i.test(html)) signals.push("NUXT_STATE");
  if (/<noscript\b[^>]*>[^<]*(?:enable|requires?)\s+javascript/i.test(html)) signals.push("NOSCRIPT_JS_REQUIRED");
  if (/<meta\b[^>]*(?:name|property)=["'](?:description|og:description)["'][^>]*content=["'][^"']{40,}/i.test(html) && visibleChars < 200) signals.push("METADATA_WITHOUT_BODY");
  const scripts = (html.match(/<script\b/gi) ?? []).length;
  if (scripts >= 8 && visibleChars < 300) signals.push("SCRIPT_HEAVY_THIN_BODY");
  const thin = visibleChars < 400;
  const shell = thin && signals.length > 0;
  const hydrationStrings: string[] = [];
  const hydrationImages: string[] = [];
  if (shell || signals.includes("NEXT_DATA") || signals.includes("NUXT_STATE")) {
    for (const payload of hydrationPayloads(html)) collect(payload, hydrationStrings, hydrationImages, 0, "");
  }
  return { shell, signals, visibleChars, hydrationStrings: [...new Set(hydrationStrings)], hydrationImages: [...new Set(hydrationImages)] };
}

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Deterministic derived markup from hydration data so the ordinary extractors can read it with page provenance. */
export function hydrationMarkup(assessment: ShellAssessment): string {
  if (!assessment.hydrationStrings.length && !assessment.hydrationImages.length) return "";
  const paragraphs = assessment.hydrationStrings.map((text) => `<p>${escape(text)}</p>`).join("");
  const images = assessment.hydrationImages.map((src) => `<img src="${escape(src)}" data-nexus-derived="hydration">`).join("");
  return `<main data-nexus-derived="hydration">${paragraphs}${images}</main>`;
}
