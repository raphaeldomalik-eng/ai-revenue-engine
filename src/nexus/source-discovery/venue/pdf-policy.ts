import { TYPE_BYTE_LIMITS } from "../content.ts";

/** Largest first-party venue-hire PDF this crawler will read. Ordinary responses stay smaller. */
export const VENUE_RELEVANT_PDF_BYTES = 8_000_000;

/**
 * Byte ceiling for one response.
 * A venue-relevant PDF may exceed the generic response cap, up to the venue PDF cap and the shared PDF type cap.
 * Every other response, including an unrelated PDF, stays on the generic cap.
 */
export function pdfFetchCeiling(args: { relevantPdfBytes?: number; genericMaxBytes: number }): number {
  const generic = Math.min(TYPE_BYTE_LIMITS.PDF, args.genericMaxBytes);
  if (args.relevantPdfBytes == null) return generic;
  const requested = Math.min(args.relevantPdfBytes, VENUE_RELEVANT_PDF_BYTES);
  return Math.min(TYPE_BYTE_LIMITS.PDF, Math.max(generic, requested));
}
