import { gunzipSync, inflateRawSync, inflateSync } from "node:zlib";

export type ContentKind = "HTML" | "PDF" | "CALENDAR" | "XML" | "GZIP" | "TEXT";
export type ContentDecision = { kind: ContentKind; reason: string } | { kind: null; reason: string };

export const TYPE_BYTE_LIMITS: Record<ContentKind, number> = {
  HTML: 5_000_000,
  PDF: 15_000_000,
  CALENDAR: 2_000_000,
  XML: 10_000_000,
  GZIP: 5_000_000,
  TEXT: 500_000,
};

const REJECTED_TYPES = /^(?:image|video|audio|font)\/|^application\/(?:zip|x-zip|x-rar|x-7z|x-tar|gzip-compressed|vnd\.|msword|octet-stream-binary|x-msdownload|x-shockwave|wasm|java-archive)/i;

export function mediaType(contentType: string | null): string {
  return (contentType ?? "").split(";")[0]!.trim().toLowerCase();
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

/** Binary if the leading window has NULs or a high share of control bytes; UTF-8 multibyte sequences are allowed. */
export function looksBinary(bytes: Uint8Array): boolean {
  const window = bytes.subarray(0, Math.min(bytes.length, 4096));
  if (!window.length) return false;
  let control = 0;
  for (const byte of window) {
    if (byte === 0) return true;
    if (byte < 9 || (byte > 13 && byte < 32)) control += 1;
  }
  return control / window.length > 0.05;
}

function leadingText(bytes: Uint8Array) {
  return Buffer.from(bytes.subarray(0, Math.min(bytes.length, 1024))).toString("utf8").replace(/^\uFEFF/, "").trimStart().toLowerCase();
}

function archiveResource(url: string, contentType: string | null): boolean {
  const type = mediaType(contentType);
  let path = url;
  try { path = new URL(url).pathname; } catch { /* keep the raw value */ }
  if (/\.(?:gz|tgz|zip|rar|7z|tar)$/i.test(path)) return true;
  return type === "application/gzip" || type === "application/x-gzip" || type === "application/gzip-compressed" || type === "application/zip" || type === "application/x-zip-compressed";
}

function textualTransfer(contentType: string | null): boolean {
  const type = mediaType(contentType);
  return !type || type.startsWith("text/") || type === "application/xhtml+xml" || type.includes("xml") || type === "application/octet-stream" || type === "application/pdf";
}

/**
 * One bounded decode of a transfer-encoded HTML/text body.
 * Archive resources and application/gzip stay compressed so the classifier still rejects them.
 */
export function inflateBoundedDocument(bytes: Uint8Array, contentEncoding: string | null, contentType: string | null, url: string, maxBytes: number): Uint8Array {
  if (archiveResource(url, contentType)) return bytes;
  const encoding = (contentEncoding ?? "").toLowerCase();
  const gzipMagic = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  const textual = textualTransfer(contentType);
  const declaredGzip = encoding.includes("gzip");
  const declaredDeflate = encoding.includes("deflate") && !encoding.includes("gzip");
  const sniffGzip = gzipMagic && textual && !encoding.includes("br") && !encoding.includes("zstd");
  if (!declaredGzip && !declaredDeflate && !sniffGzip) return bytes;
  if (!textual && !declaredGzip && !declaredDeflate) return bytes;
  try {
    const output = declaredDeflate && !gzipMagic ? inflateDeflate(bytes, maxBytes) : gunzipSync(bytes, { maxOutputLength: maxBytes });
    return new Uint8Array(output);
  } catch (error) {
    const code = (error as { code?: string }).code;
    const tooBig = error instanceof RangeError || code === "ERR_BUFFER_TOO_LARGE";
    throw new Error(tooBig ? "Response exceeded the discovery size limit." : "Compressed document could not be decoded within bounds.");
  }
}

function inflateDeflate(bytes: Uint8Array, maxBytes: number): Buffer {
  try { return inflateSync(bytes, { maxOutputLength: maxBytes }); } catch {
    return inflateRawSync(bytes, { maxOutputLength: maxBytes });
  }
}

/** Classifies by the declared type and the actual body; a declared type the body contradicts is refused. */
export function classifyContent(contentType: string | null, bytes: Uint8Array, url: string, expected: "PAGE" | "CALENDAR" | "SITEMAP" | "PDF"): ContentDecision {
  const type = mediaType(contentType);
  const isPdfBody = startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  const isGzipBody = startsWith(bytes, [0x1f, 0x8b]);
  if (type === "application/pdf" || (isPdfBody && (!type || type === "application/octet-stream" || /\.pdf(?:$|\?)/i.test(url)))) {
    return isPdfBody ? { kind: "PDF", reason: "PDF signature verified" } : { kind: null, reason: "Declared PDF body lacks a PDF signature." };
  }
  if (isGzipBody) {
    return expected === "SITEMAP" ? { kind: "GZIP", reason: "gzip sitemap" } : { kind: null, reason: "Compressed archive bodies are not parsed as documents." };
  }
  if (REJECTED_TYPES.test(type)) return { kind: null, reason: `Unsupported content type ${type}.` };
  if (type === "application/json" || type.endsWith("+json")) return { kind: null, reason: "JSON documents are not first-party pages." };
  if (looksBinary(bytes)) return { kind: null, reason: `Binary body refused${type ? ` (declared ${type})` : ""}.` };
  const head = leadingText(bytes);
  if (type === "text/calendar" || head.startsWith("begin:vcalendar")) return { kind: "CALENDAR", reason: "iCalendar body" };
  if (expected === "SITEMAP") {
    if (type.includes("xml") || head.startsWith("<?xml") || /^<(?:urlset|sitemapindex)\b/.test(head)) return { kind: "XML", reason: "XML sitemap" };
    if (type === "text/plain" || !type) return { kind: "TEXT", reason: "plain-text sitemap" };
    return { kind: null, reason: `Sitemap has unsupported type ${type || "unknown"}.` };
  }
  if (type === "text/html" || type === "application/xhtml+xml") return { kind: "HTML", reason: "declared HTML" };
  if (!type || type === "text/plain" || type === "application/octet-stream") return { kind: "HTML", reason: "textual body without an HTML declaration" };
  if (type.includes("xml") && /^<(?:!doctype html|html)\b/.test(head)) return { kind: "HTML", reason: "XHTML body" };
  return { kind: null, reason: `Unsupported content type ${type}.` };
}

/** Early refusal on headers so unsupported bodies are never downloaded. */
export function refuseByHeaders(contentType: string | null): string | null {
  const type = mediaType(contentType);
  if (REJECTED_TYPES.test(type)) return `Unsupported content type ${type}.`;
  return null;
}

export function decodeText(bytes: Uint8Array, contentType: string | null): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType ?? "")?.[1]?.toLowerCase();
  const label = charset === "iso-8859-1" || charset === "latin1" || charset === "windows-1252" ? "windows-1252" : "utf-8";
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    return Buffer.from(bytes).toString("utf8");
  }
}
