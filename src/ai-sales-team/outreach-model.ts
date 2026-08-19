export type OutreachMessageDraft = {
  sequenceNumber: 0 | 1 | 2;
  delayHours: number;
  subject: string;
  body: string;
  rationale: string;
  evidenceReferences: string[];
  cta: string;
  stopConditions: string[];
};

export type OutreachSequenceDraft = {
  outreachGoal: string;
  recipientRationale: string;
  overallStrategy: string;
  initialMessage: OutreachMessageDraft;
  followUps: OutreachMessageDraft[];
  unknowns: string[];
  warnings: string[];
};

export type OutreachMessageStatus = "NEEDS_APPROVAL" | "APPROVED" | "SCHEDULED" | "SENDING" | "SENT" | "FAILED" | "CANCELLED";
export type AccountRelationship = "PROSPECT" | "CUSTOMER" | "PARTNER" | "COMPETITOR" | "UNKNOWN";
export type OutreachEligibility = "ELIGIBLE" | "BLOCKED" | "REVIEW_REQUIRED";

export const MAX_FOLLOW_UPS = 2;

export function knownRecipient(email: string | null | undefined) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? email.trim() : null;
}

export function classifyAccountRelationship(input: { name: string; website?: string | null; summary?: string | null; qualificationFit?: string | null; relationship?: AccountRelationship }): { relationship: AccountRelationship; eligibility: OutreachEligibility; reason: string } {
  const nameAndWebsite = `${input.name} ${input.website ?? ""}`.toLowerCase();
  const summary = (input.summary ?? "").toLowerCase();
  const haystack = `${nameAndWebsite} ${summary}`;
  if (input.relationship && input.relationship !== "PROSPECT") {
    const blocked = input.relationship === "COMPETITOR";
    return { relationship: input.relationship, eligibility: blocked ? "BLOCKED" : "REVIEW_REQUIRED", reason: blocked ? "Competitor — standard sales outreach not recommended" : `${input.relationship} relationship requires human review before outreach.` };
  }
  const organisationUsesCompetitor = /\b(?:uses?|using|runs? on|powered by|tickets? (?:sold|available) (?:through|via))\b.{0,60}\b(?:quicket|ticketmaster|eventbrite)\b/.test(summary);
  const providesTicketingTechnology = /quicket\.co\.za|\bquicket\b|\b(?:event )?ticketing\s+(?:software|technology|platform|services?|provider|company|solutions?)\b|\b(?:box office|ticket sales)\s+platform\b|\bticketing competitor\b/.test(nameAndWebsite) || (!organisationUsesCompetitor && /\b(?:provides?|sells?|offers?|builds?|operates?)\b.{0,60}\b(?:event )?ticketing\s+(?:software|technology|platform|services?|solutions?)\b/.test(summary));
  if (providesTicketingTechnology) {
    return { relationship: "COMPETITOR", eligibility: "BLOCKED", reason: "Competitor — standard sales outreach not recommended" };
  }
  if (/existing customer|current customer|customer of eventsuite/.test(haystack)) return { relationship: "CUSTOMER", eligibility: "REVIEW_REQUIRED", reason: "Customer relationship requires an explicit operator decision before net-new outreach." };
  if (/current partner|strategic partner|partner organisation/.test(haystack)) return { relationship: "PARTNER", eligibility: "REVIEW_REQUIRED", reason: "Partner relationship requires a partnership-oriented operator decision." };
  if (!input.qualificationFit || input.qualificationFit === "UNKNOWN") return { relationship: "UNKNOWN", eligibility: "REVIEW_REQUIRED", reason: "Account relationship requires human review before outreach." };
  return { relationship: "PROSPECT", eligibility: "ELIGIBLE", reason: "Prospect is eligible for normal human-reviewed sales outreach." };
}

const PLACEHOLDER_PATTERN = /(?:\[\s*(?:your\s+name|name|company|sender|email)\s*\]|\{\{\s*(?:name|sender|company|email)\s*\}\}|<\s*(?:todo|name|sender|company)\s*>|\bTODO\b)/i;
const RESEARCH_URL_PATTERN = /(?:https?:\/\/|www\.)\S+/gi;
const RESEARCH_LEAK_PATTERN = /(?:\[\s*(?:\d+|source|citation|evidence|fact|inference)[^\]]*\]|\b(?:evidence|source)[_-]?id\s*[:#-]?\s*[a-z0-9-]+\b|\b(?:fact|inference)[_-]?\d+\b|\b(?:FACT|INFERENCE)\s*[:·-])/i;
const UNSUPPORTED_SUPERLATIVE_PATTERN = /\b(?:industry-leading|market-leading|best-in-class|world-class)\b/i;

export function sanitizeOutboundContent(subject: string, body: string, allowedUrls: string[] = []) {
  if (PLACEHOLDER_PATTERN.test(subject) || PLACEHOLDER_PATTERN.test(body) || RESEARCH_LEAK_PATTERN.test(subject) || RESEARCH_LEAK_PATTERN.test(body)) throw new Error("OUTREACH_CONTENT_INVALID: internal evidence or unresolved placeholder");
  if (UNSUPPORTED_SUPERLATIVE_PATTERN.test(subject) || UNSUPPORTED_SUPERLATIVE_PATTERN.test(body)) throw new Error("OUTREACH_CONTENT_INVALID: unsupported comparative claim");
  const stripUnapprovedUrls = (value: string) => value.replace(RESEARCH_URL_PATTERN, (url) => allowedUrls.includes(url) ? url : "");
  const cleanSubject = stripUnapprovedUrls(subject).replace(/\s{2,}/g, " ").trim();
  const cleanBody = stripUnapprovedUrls(body).replace(/\n{3,}/g, "\n\n").trim();
  const signature = /best regards,?\s*eventsuite partnerships/i.test(cleanBody) ? cleanBody : `${cleanBody}\n\nBest regards,\nEventSuite Partnerships`;
  const remainingUrls = signature.match(RESEARCH_URL_PATTERN) ?? [];
  if (PLACEHOLDER_PATTERN.test(signature) || RESEARCH_LEAK_PATTERN.test(signature) || remainingUrls.some((url) => !allowedUrls.includes(url))) throw new Error("OUTREACH_CONTENT_INVALID: unsafe outbound content");
  return { subject: cleanSubject, body: signature };
}

export function canSendMessage(message: { status: OutreachMessageStatus; recipient_email?: string | null }, sequenceStatus: string, suppressed: boolean, priorReply: boolean, eligibility: OutreachEligibility = "REVIEW_REQUIRED") {
  return (message.status === "APPROVED" || message.status === "SCHEDULED") && sequenceStatus === "ACTIVE" && eligibility === "ELIGIBLE" && !suppressed && !priorReply && Boolean(knownRecipient(message.recipient_email));
}

export function boundedFollowUps(messages: OutreachMessageDraft[]) {
  return messages.filter((message) => message.sequenceNumber > 0).slice(0, MAX_FOLLOW_UPS);
}
