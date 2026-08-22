export const PROSPECT_BLOCK_REASON_OPTIONS = [
  { code: "NOT_RELEVANT", label: "Not relevant to EventSuite" },
  { code: "WRONG_IDENTITY", label: "Wrong organisation or person" },
  { code: "DUPLICATE", label: "Duplicate prospect" },
  { code: "COMPETITOR_PROVIDER", label: "Competitor or provider" },
  { code: "NO_EVENT_ACTIVITY", label: "No credible event activity" },
  { code: "CONTACT_NOT_USEFUL", label: "Contact is not useful" },
  { code: "TOO_LARGE", label: "Too large for current focus" },
  { code: "OTHER", label: "Other" },
] as const;

export type ProspectBlockReasonCode = typeof PROSPECT_BLOCK_REASON_OPTIONS[number]["code"];
export type ProspectReviewDecision = "BLOCKED" | "REOPENED";

const reasonCodes = new Set<string>(PROSPECT_BLOCK_REASON_OPTIONS.map((item) => item.code));

export function blockReasonLabel(code?: string | null) {
  return PROSPECT_BLOCK_REASON_OPTIONS.find((item) => item.code === code)?.label ?? "Reviewer decision";
}

export function validateBlockDecision(input: { reasonCode?: unknown; otherExplanation?: unknown; note?: unknown }) {
  const reasonCode = typeof input.reasonCode === "string" ? input.reasonCode.trim().toUpperCase() : "";
  if (!reasonCode) throw new Error("PROSPECT_BLOCK_REASON_REQUIRED");
  if (!reasonCodes.has(reasonCode)) throw new Error("PROSPECT_BLOCK_REASON_INVALID");
  const otherExplanation = typeof input.otherExplanation === "string" ? input.otherExplanation.trim() : "";
  if (reasonCode === "OTHER" && otherExplanation.length < 3) throw new Error("PROSPECT_BLOCK_OTHER_EXPLANATION_REQUIRED");
  if (otherExplanation.length > 500) throw new Error("PROSPECT_BLOCK_OTHER_EXPLANATION_TOO_LONG");
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > 1000) throw new Error("PROSPECT_BLOCK_NOTE_TOO_LONG");
  return {
    reasonCode: reasonCode as ProspectBlockReasonCode,
    otherExplanation: reasonCode === "OTHER" ? otherExplanation : null,
    note: note || null,
  };
}

export function isBlockedProspect(status?: string | null) {
  return status === "BLOCKED";
}
