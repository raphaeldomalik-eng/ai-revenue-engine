import type { EmailAcquisitionOutcome } from "../contracts.ts";
import type { CrawlStats, CrawlStopReason } from "./types.ts";

/**
 * Email acquisition is recorded beside the transport status.
 * COMPLETED with no email is not an exhausted email search unless this outcome says so.
 */
export function deriveEmailAcquisitionOutcome(input: {
  emailGoal: boolean;
  emailFound: boolean;
  status: CrawlStats["status"];
  retryable: boolean;
  stopReason: CrawlStopReason | null;
  renderNeeded: boolean;
  contactPathsRemaining: number;
}): EmailAcquisitionOutcome {
  if (!input.emailGoal) return "EMAIL_NOT_REQUESTED";
  if (input.emailFound) return "EMAIL_FOUND";
  if (input.status === "BLOCKED" || input.stopReason === "ROBOTS_BLOCKED" || input.stopReason === "ROBOTS_UNAVAILABLE") return "BLOCKED";
  if (input.status === "FAILED") return input.retryable ? "TRANSIENT_FAILURE" : "BLOCKED";
  if (input.renderNeeded) return "RENDER_NEEDED";
  if (input.stopReason === "PAGE_BUDGET") return "PAGE_BUDGET_REACHED";
  if (input.stopReason === "REQUEST_BUDGET") return "REQUEST_BUDGET_REACHED";
  if (input.contactPathsRemaining > 0) return "CONTACT_PATHS_REMAIN";
  return "EMAIL_SEARCH_EXHAUSTED";
}
