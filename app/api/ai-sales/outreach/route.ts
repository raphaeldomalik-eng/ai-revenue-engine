import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../src/lib/supabase-server";
import { generateOutreachSequence } from "../../../../src/ai-sales-team/outreach";
import { sendApprovedOutreachMessage } from "../../../../src/outreach/service";
import { classifyAccountRelationship, knownRecipient } from "../../../../src/ai-sales-team/outreach-model";

async function actor() {
  const client = await createServerSupabaseClient();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return { client, user: null, member: null };
  const { data: member } = await client.from("revenue_members").select("member_role, active").eq("user_id", auth.user.id).maybeSingle();
  return { client, user: auth.user, member };
}

function forbidden(member: { active: boolean; member_role: string } | null) { return !member?.active || !["operator", "admin"].includes(member.member_role); }

export async function GET(request: Request) {
  const { client, user, member } = await actor();
  if (!user) return NextResponse.json({ message: "Sign in is required." }, { status: 401 });
  if (!member?.active) return NextResponse.json({ message: "Active membership is required." }, { status: 403 });
  const accountId = new URL(request.url).searchParams.get("accountId");
  if (!accountId) return NextResponse.json({ message: "Account is required." }, { status: 400 });
  const { data: sequences, error } = await client.from("outreach_sequences").select("*").eq("account_id", accountId).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ message: "Outreach persistence is not available until its migration is applied." }, { status: 503 });
  const ids = (sequences ?? []).map((item) => item.id);
  const { data: messages } = ids.length ? await client.from("outreach_messages").select("*").in("sequence_id", ids).order("sequence_number") : { data: [] };
  const { data: suppressions } = await client.from("outreach_suppressions").select("*").eq("account_id", accountId).eq("active", true);
  return NextResponse.json({ sequences: sequences ?? [], messages: messages ?? [], suppressions: suppressions ?? [] });
}

export async function POST(request: Request) {
  const { client, user, member } = await actor();
  if (!user) return NextResponse.json({ message: "Sign in is required." }, { status: 401 });
  if (forbidden(member)) return NextResponse.json({ message: "Active operator access is required." }, { status: 403 });
  const body = await request.json() as { action?: string; accountId?: string; briefId?: string; sequenceId?: string; messageId?: string; subject?: string; messageBody?: string; recipientEmail?: string; reason?: string };
  try {
    if (body.action === "prepare") {
      if (!body.accountId || !body.briefId) return NextResponse.json({ message: "Account and AI Sales Brief are required." }, { status: 400 });
      const { data: existing } = await client.from("outreach_sequences").select("id").eq("account_id", body.accountId).eq("ai_sales_brief_id", body.briefId).eq("status", "ACTIVE").maybeSingle();
      if (existing) return NextResponse.json({ sequenceId: existing.id, reused: true });
      const { data: accountState, error: accountStateError } = await client.from("accounts").select("metadata").eq("id", body.accountId).single();
      if (accountStateError) throw accountStateError;
      const prospectIntelligence = accountState?.metadata?.prospectIntelligence;
      if (accountState?.metadata?.outreachEligibility !== "ELIGIBLE" || prospectIntelligence?.outreachEligibility !== "ELIGIBLE" || prospectIntelligence?.salesMotion !== "DIRECT" || !prospectIntelligence?.nextBestCommercialAction || prospectIntelligence.nextBestCommercialAction.type === "NONE" || !prospectIntelligence.nextBestCommercialAction.resourceOffer || !prospectIntelligence.nextBestCommercialAction.productDestinationUrl) throw new Error(accountState?.metadata?.outreachEligibilityReason || "OUTREACH_REVIEW_REQUIRED");
      const [{ data: brief, error: briefError }, { data: contacts, error: contactsError }] = await Promise.all([
        client.from("ai_sales_briefs").select("*").eq("id", body.briefId).eq("account_id", body.accountId).single(),
        client.from("contacts").select("id, full_name, role_title, email").eq("account_id", body.accountId).order("created_at"),
      ]);
      if (briefError) throw briefError;
      if (contactsError) throw contactsError;
      const contact = (contacts ?? []).find((item) => item.email) ?? contacts?.[0] ?? null;
      const previewRecipient = process.env.VERCEL_ENV === "preview" ? knownRecipient(process.env.E2E_OUTREACH_RECIPIENT) : null;
      const explicitRecipient = body.recipientEmail?.trim() ? knownRecipient(body.recipientEmail) : previewRecipient;
      if (body.recipientEmail?.trim() && !explicitRecipient) throw new Error("OUTREACH_RECIPIENT_INVALID");
      const recipient = explicitRecipient ?? contact?.email ?? null;
      const generated = await generateOutreachSequence({ brief: { companySummary: brief.company_summary, whyItMatters: brief.why_it_matters, territory: brief.territory, qualification: brief.qualification, people: brief.people, facts: brief.facts, inferences: brief.inferences, pains: brief.pains, useCases: brief.use_cases, signals: brief.signals, eventSuite: brief.eventsuite_opportunity, accountStrategy: brief.account_strategy, nextBestAction: brief.next_best_action, unknowns: brief.unknowns, prospectIntelligence: brief.eventsuite_opportunity?.prospectIntelligence }, contact: contact ? { name: contact.full_name, role: contact.role_title, email: recipient } : recipient ? { name: null, role: null, email: recipient } : null });
      const { data: sequence, error: sequenceError } = await client.from("outreach_sequences").insert({ account_id: body.accountId, contact_id: contact?.id ?? null, ai_sales_brief_id: body.briefId, created_by: user.id, outreach_goal: generated.draft.outreachGoal, overall_strategy: generated.draft.overallStrategy }).select("id").single();
      if (sequenceError) throw sequenceError;
      const all = [generated.draft.initialMessage, ...generated.draft.followUps];
      const { error: messageError } = await client.from("outreach_messages").insert(all.map((item) => ({ sequence_id: sequence.id, account_id: body.accountId, contact_id: contact?.id ?? null, sequence_number: item.sequenceNumber, recipient_email: recipient, subject: item.subject, body: item.body, rationale: item.rationale, evidence_references: item.evidenceReferences, cta: item.cta, stop_conditions: item.stopConditions, scheduled_for: new Date(Date.now() + item.delayHours * 3600000).toISOString() })));
      if (messageError) throw messageError;
      return NextResponse.json({ sequenceId: sequence.id });
    }
    if (body.action === "approve" && body.messageId) {
      const { data, error } = await client.from("outreach_messages").update({ status: "APPROVED", approved_by: user.id, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", body.messageId).eq("status", "NEEDS_APPROVAL").select("id, status").maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("OUTREACH_MESSAGE_ALREADY_CHANGED");
      return NextResponse.json(data);
    }
    if (body.action === "edit" && body.messageId) {
      if (!body.subject?.trim() || !body.messageBody?.trim()) throw new Error("OUTREACH_MESSAGE_CONTENT_REQUIRED");
      const { data, error } = await client.from("outreach_messages").update({ subject: body.subject.trim(), body: body.messageBody.trim(), edited_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", body.messageId).in("status", ["NEEDS_APPROVAL", "APPROVED"]).select("id, status").maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("OUTREACH_MESSAGE_IMMUTABLE");
      return NextResponse.json(data);
    }
    if (body.action === "send" && body.messageId) return NextResponse.json(await sendApprovedOutreachMessage(client, body.messageId, user.id));
    if (body.action === "cancel" && body.sequenceId) {
      await client.from("outreach_sequences").update({ status: "CANCELLED", stop_reason: body.reason || "MANUAL_STOP", updated_at: new Date().toISOString() }).eq("id", body.sequenceId).eq("status", "ACTIVE");
      await client.from("outreach_messages").update({ status: "CANCELLED", updated_at: new Date().toISOString() }).eq("sequence_id", body.sequenceId).in("status", ["NEEDS_APPROVAL", "APPROVED", "SCHEDULED", "FAILED"]);
      return NextResponse.json({ cancelled: true });
    }
    if (body.action === "suppress" && body.accountId) {
      const { error } = await client.from("outreach_suppressions").insert({ account_id: body.accountId, reason: body.reason || "MANUAL_STOP", created_by: user.id });
      if (error) throw error;
      await client.from("outreach_sequences").update({ status: "STOPPED", stop_reason: body.reason || "MANUAL_STOP", updated_at: new Date().toISOString() }).eq("account_id", body.accountId).eq("status", "ACTIVE");
      await client.from("outreach_messages").update({ status: "CANCELLED", updated_at: new Date().toISOString() }).eq("account_id", body.accountId).in("status", ["NEEDS_APPROVAL", "APPROVED", "SCHEDULED", "FAILED"]);
      return NextResponse.json({ suppressed: true });
    }
    throw new Error("OUTREACH_ACTION_INVALID");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Outreach action failed.";
    const status = message.includes("NOT_CONFIGURED") ? 503 : message.includes("REQUIRED") || message.includes("INVALID") ? 400 : message.includes("OUTREACH_RECIPIENT_UNKNOWN") || message.includes("OUTREACH_APPROVAL_REQUIRED") || message.includes("OUTREACH_STOPPED") || message.includes("OUTREACH_REVIEW_REQUIRED") || message.includes("Competitor") ? 409 : 502;
    return NextResponse.json({ code: message.split(":")[0], message }, { status });
  }
}
