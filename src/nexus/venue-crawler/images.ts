import { assertPublicNetworkTarget } from "../source-discovery/network.ts";
import type { ImageCandidate } from "../source-discovery/extractors/resources.ts";
import type { ResolveHost } from "../source-discovery/types.ts";

export type VenueImagePublication = "PUBLISHABLE" | "PRIVATE_OWNER_REVIEW";

export type RankedVenueImage = {
  sourceImageUrl: string;
  sourcePageUrl: string;
  filename: string | null;
  alt: string | null;
  role: string;
  width: number | null;
  height: number | null;
  dimensionSource: "BINARY" | "UNVERIFIED";
  publication: VenueImagePublication;
  rightsRecord: string;
  rightsStatement: string | null;
  score: number;
};

const REJECT = /\b(?:logo|icon|sprite|favicon|map|maps|staff|portrait|sponsor|advert|banner-ad|stock|placeholder|google|fixture|avatar|emoji)\b/i;
const USEFUL_ROLE = new Set(["HERO", "EXTERIOR", "INTERIOR", "SPACE", "GALLERY"]);

export function imagePublication(candidate: ImageCandidate): { publication: VenueImagePublication; rightsRecord: string; rightsStatement: string | null } {
  if (candidate.rightsState === "VERIFIED_REUSABLE" && candidate.rightsEvidence) {
    return { publication: "PUBLISHABLE", rightsRecord: candidate.rightsEvidence.basis, rightsStatement: candidate.rightsEvidence.statement };
  }
  if (candidate.rightsState === "PERMISSION_REQUIRED" || candidate.rightsState === "RIGHTS_RESERVED") {
    return {
      publication: "PRIVATE_OWNER_REVIEW",
      rightsRecord: candidate.rightsEvidence?.basis ?? candidate.rightsState,
      rightsStatement: candidate.rightsEvidence?.statement ?? null,
    };
  }
  return { publication: "PUBLISHABLE", rightsRecord: "NO_EXPLICIT_RESTRICTION_FOUND", rightsStatement: null };
}

export function imageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: readU32(bytes, 16), height: readU32(bytes, 20) };
  }
  if (bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: bytes[6]! + (bytes[7]! << 8), height: bytes[8]! + (bytes[9]! << 8) };
  }
  if (bytes.length >= 30 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    const format = String.fromCharCode(...bytes.slice(8, 12));
    if (format === "VP8X" && bytes.length >= 30) return { width: 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)), height: 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)) };
    if (format === "VP8 " && bytes.length >= 30) return { width: bytes[26]! | (bytes[27]! << 8), height: bytes[28]! | (bytes[29]! << 8) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1]!;
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        return { height: readU16(bytes, offset + 5), width: readU16(bytes, offset + 7) };
      }
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      const size = readU16(bytes, offset + 2);
      if (size < 2) break;
      offset += 2 + size;
    }
  }
  return null;
}

function readU16(bytes: Uint8Array, offset: number) {
  return (bytes[offset]! << 8) + bytes[offset + 1]!;
}
function readU32(bytes: Uint8Array, offset: number) {
  return (bytes[offset]! * 0x1000000) + (bytes[offset + 1]! << 16) + (bytes[offset + 2]! << 8) + bytes[offset + 3]!;
}

async function readPrefix(url: string, resolveHost: ResolveHost): Promise<Uint8Array | null> {
  await assertPublicNetworkTarget(url, resolveHost);
  const response = await fetch(url, {
    headers: { Range: "bytes=0-65535", "User-Agent": "AiRevenueEngineVenueCrawler/1.0" },
    redirect: "follow",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok && response.status !== 206) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < 65536) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
    total += next.value.length;
    if (total >= 65536) { await reader.cancel().catch(() => undefined); break; }
  }
  const bytes = new Uint8Array(Math.min(total, 65536));
  let offset = 0;
  for (const chunk of chunks) {
    const slice = chunk.subarray(0, bytes.length - offset);
    bytes.set(slice, offset);
    offset += slice.length;
    if (offset >= bytes.length) break;
  }
  return bytes;
}

function stem(filename: string | null, url: string) {
  const name = (filename || new URL(url).pathname.split("/").pop() || url).toLowerCase();
  return name.replace(/[-_](?:\d{2,4}x\d{2,4}|\d{2,4}w|scaled|large|medium|small|thumb)\b/g, "").replace(/\.[a-z0-9]+$/, "");
}

export async function rankVenueImages(candidates: ImageCandidate[], options: { resolveHost?: ResolveHost; probeLimit?: number; knownDimensions?: Record<string, { width: number; height: number } | null> } = {}): Promise<{ hero: RankedVenueImage | null; gallery: RankedVenueImage[]; ownerReviewHero: RankedVenueImage | null; ownerReviewGallery: RankedVenueImage[]; rejected: number }> {
  const ranked: RankedVenueImage[] = [];
  let rejected = 0;
  const probed = new Map<string, { width: number; height: number } | null>();
  const probeLimit = options.probeLimit ?? (options.resolveHost ? 8 : 0);
  const worthProbing = candidates.filter((item) => item.likelyRole !== "LOGO" && !REJECT.test(`${item.filename ?? ""} ${item.alt ?? ""} ${item.sourceImageUrl}`)).slice(0, probeLimit);
  for (const candidate of worthProbing) {
    if (options.knownDimensions && candidate.sourceImageUrl in options.knownDimensions) {
      probed.set(candidate.sourceImageUrl, options.knownDimensions[candidate.sourceImageUrl] ?? null);
      continue;
    }
    if (!options.resolveHost) continue;
    try { probed.set(candidate.sourceImageUrl, await readPrefix(candidate.sourceImageUrl, options.resolveHost).then((bytes) => bytes ? imageDimensions(bytes) : null)); }
    catch { probed.set(candidate.sourceImageUrl, null); }
  }
  for (const candidate of candidates) {
    if (options.knownDimensions && candidate.sourceImageUrl in options.knownDimensions && !probed.has(candidate.sourceImageUrl)) {
      probed.set(candidate.sourceImageUrl, options.knownDimensions[candidate.sourceImageUrl] ?? null);
    }
  }
  for (const candidate of candidates) {
    const context = `${candidate.filename ?? ""} ${candidate.alt ?? ""} ${candidate.likelyRole} ${candidate.sourceImageUrl}`;
    if (candidate.likelyRole === "LOGO" || REJECT.test(context) || candidate.mime === "image/svg+xml" || candidate.mime === "image/gif") { rejected += 1; continue; }
    const binary = probed.get(candidate.sourceImageUrl) ?? null;
    const width = binary?.width ?? null;
    const height = binary?.height ?? null;
    if (binary && (width! < 240 || height! < 240)) { rejected += 1; continue; }
    if (!binary && ((candidate.width !== null && candidate.width < 240) || (candidate.height !== null && candidate.height < 240))) { rejected += 1; continue; }
    const rights = imagePublication(candidate);
    const page = new URL(candidate.sourcePageUrl).pathname;
    const area = binary ? Math.min(width! * height!, 4_000_000) : 0;
    const aspect = binary && height ? width! / height! : 0;
    const score = (candidate.exactVenue ? 50 : 0)
      + (USEFUL_ROLE.has(candidate.likelyRole) ? 25 : 0)
      + (/galler|space|room|venue|wedd|confer/i.test(page) ? 15 : 0)
      + Math.round(Math.log10(area + 1) * 8)
      + (aspect >= 1.1 && aspect <= 2.2 ? 5 : 0)
      + (rights.publication === "PUBLISHABLE" ? 4 : 0);
    ranked.push({
      sourceImageUrl: candidate.sourceImageUrl, sourcePageUrl: candidate.sourcePageUrl, filename: candidate.filename, alt: candidate.alt,
      role: candidate.likelyRole, width, height, dimensionSource: binary ? "BINARY" : "UNVERIFIED", score, ...rights,
    });
  }
  ranked.sort((a, b) => b.score - a.score || a.sourceImageUrl.localeCompare(b.sourceImageUrl));
  const distinct: RankedVenueImage[] = [];
  const seen = new Set<string>();
  for (const item of ranked) {
    const key = stem(item.filename, item.sourceImageUrl);
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push(item);
  }
  const publishable = distinct.filter((item) => item.publication === "PUBLISHABLE" && item.dimensionSource === "BINARY");
  const review = distinct.filter((item) => item.publication === "PRIVATE_OWNER_REVIEW" && item.dimensionSource === "BINARY");
  return { hero: publishable[0] ?? null, gallery: publishable.slice(1, 9), ownerReviewHero: review[0] ?? null, ownerReviewGallery: review.slice(0, 8), rejected };
}
