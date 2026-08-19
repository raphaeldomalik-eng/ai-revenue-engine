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

export const MAX_FOLLOW_UPS = 2;

export function knownRecipient(email: string | null | undefined) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? email.trim() : null;
}

export function canSendMessage(message: { status: OutreachMessageStatus; recipient_email?: string | null }, sequenceStatus: string, suppressed: boolean, priorReply: boolean) {
  return (message.status === "APPROVED" || message.status === "SCHEDULED") && sequenceStatus === "ACTIVE" && !suppressed && !priorReply && Boolean(knownRecipient(message.recipient_email));
}

export function boundedFollowUps(messages: OutreachMessageDraft[]) {
  return messages.filter((message) => message.sequenceNumber > 0).slice(0, MAX_FOLLOW_UPS);
}
