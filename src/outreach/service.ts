import type { SupabaseClient } from "@supabase/supabase-js";
import { canSendMessage, knownRecipient, sanitizeOutboundContent } from "../ai-sales-team/outreach-model.ts";
import { sendEmail } from "./provider.ts";

export async function sendApprovedOutreachMessage(client: SupabaseClient, messageId: string, actorId: string) {
  const { data: message, error: messageError } = await client.from("outreach_messages").select("*").eq("id", messageId).maybeSingle();
  if (messageError) throw messageError;
  if (!message) throw new Error("OUTREACH_MESSAGE_NOT_FOUND");
  if (message.status === "SENT") return { alreadySent: true, providerMessageId: message.provider_message_id };
  const { data: account, error: accountError } = await client.from("accounts").select("metadata").eq("id", message.account_id).single();
  if (accountError) throw accountError;
  const eligibility = account?.metadata?.outreachEligibility ?? "REVIEW_REQUIRED";
  const prospectIntelligence = account?.metadata?.prospectIntelligence;
  if (eligibility !== "ELIGIBLE" || prospectIntelligence?.outreachEligibility !== "ELIGIBLE" || prospectIntelligence?.salesMotion !== "DIRECT" || !prospectIntelligence?.nextBestCommercialAction || prospectIntelligence.nextBestCommercialAction.type === "NONE") throw new Error(account?.metadata?.outreachEligibilityReason ?? "OUTREACH_REVIEW_REQUIRED");
  const { data: sequence, error: sequenceError } = await client.from("outreach_sequences").select("status").eq("id", message.sequence_id).single();
  if (sequenceError) throw sequenceError;
  const { data: suppression } = await client.from("outreach_suppressions").select("id").eq("account_id", message.account_id).eq("active", true).or(`contact_id.is.null,contact_id.eq.${message.contact_id ?? "00000000-0000-0000-0000-000000000000"}`).limit(1).maybeSingle();
  if (suppression) throw new Error("OUTREACH_STOPPED_SUPPRESSED");
  if (!canSendMessage(message, sequence.status, false, false, eligibility)) throw new Error(message.status !== "APPROVED" ? "OUTREACH_APPROVAL_REQUIRED" : "OUTREACH_RECIPIENT_UNKNOWN");
  const recipient = knownRecipient(message.recipient_email);
  if (!recipient) throw new Error("OUTREACH_RECIPIENT_UNKNOWN");

  // Claiming APPROVED atomically makes browser retries, job retries, and double-clicks harmless.
  const { data: claimed, error: claimError } = await client.from("outreach_messages").update({ status: "SENDING", send_attempts: (message.send_attempts ?? 0) + 1, updated_at: new Date().toISOString() }).eq("id", messageId).in("status", ["APPROVED", "SCHEDULED"]).select("id, subject, body").maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return { alreadyClaimed: true };
  try {
    const content = sanitizeOutboundContent(claimed.subject, claimed.body);
    const result = await sendEmail({ messageId, recipientEmail: recipient, subject: content.subject, body: content.body });
    await client.from("outreach_messages").update({ status: "SENT", provider: result.provider, provider_message_id: result.providerMessageId, sent_at: new Date().toISOString(), sent_subject: content.subject, sent_body: content.body, updated_at: new Date().toISOString() }).eq("id", messageId).eq("status", "SENDING");
    await client.from("activities").insert({ account_id: message.account_id, contact_id: message.contact_id, activity_type: "OUTREACH_EMAIL_SENT", direction: "OUTBOUND", summary: `Outreach message ${message.sequence_number + 1} sent.`, external_id: result.providerMessageId, metadata: { messageId, provider: result.provider } });
    return { sent: true, providerMessageId: result.providerMessageId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "OUTREACH_PROVIDER_FAILED";
    await client.from("outreach_messages").update({ status: "FAILED", failure_reason: reason, updated_at: new Date().toISOString() }).eq("id", messageId).eq("status", "SENDING");
    await client.from("activities").insert({ account_id: message.account_id, contact_id: message.contact_id, activity_type: "OUTREACH_EMAIL_FAILED", direction: "OUTBOUND", summary: `Outreach message ${message.sequence_number + 1} failed.`, metadata: { messageId, reason } });
    throw error;
  }
}

export async function processDueOutreachMessages(client: SupabaseClient) {
  const { data: due, error } = await client.from("outreach_messages").select("id").in("status", ["APPROVED", "SCHEDULED"]).lte("scheduled_for", new Date().toISOString()).limit(25);
  if (error) throw error;
  const results: Array<{ id: string; sent: boolean; error?: string }> = [];
  for (const message of due ?? []) {
    try { await sendApprovedOutreachMessage(client, message.id, "scheduler"); results.push({ id: message.id, sent: true }); }
    catch (error) { results.push({ id: message.id, sent: false, error: error instanceof Error ? error.message : "send failed" }); }
  }
  return results;
}
