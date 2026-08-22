import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../../src/lib/supabase-server";
import { outreachComposerProductionEnabled } from "../../../../src/lib/server-production-activation";
import { assertOutreachAccountEligible } from "../../../../src/outreach/service";
import { composerInputFromPersisted } from "../../../../src/ai-sales-team/outreach-composer-input";
import { createComposerDraft, createComposerSequence, recordComposerReview, reviseComposerDraft } from "../../../../src/ai-sales-team/outreach-composer-persistence";

function disabled() { return NextResponse.json({ code: "PILOT_NOT_ENABLED", message: "Outreach Composer is disabled until both server-only pilot flags are explicitly enabled." }, { status: 503 }); }
async function actor() {
  const client = await createServerSupabaseClient();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return { client, user: null, member: null };
  const { data: member } = await client.from("revenue_members").select("member_role, active").eq("user_id", auth.user.id).maybeSingle();
  return { client, user: auth.user, member };
}
function stage(value: unknown) { return value === "EMAIL_1" || value === "EMAIL_2" || value === "EMAIL_3" || value === "REVISION" ? value : "EMAIL_1"; }
function stopState(value: unknown) { return value === "REPLIED" || value === "REJECTED" || value === "OPTOUT" || value === "UNSUBSCRIBED" || value === "BOUNCED" || value === "INVALID" || value === "BLOCKED" || value === "COMPLETE" ? value : "CLEAR"; }

async function accountInputs(client: any, accountId: string, briefId: string | null, contactId: string | null, details: { stage: any; originalStage?: any; priorMessageBody?: string | null; humanInstruction?: string | null; stopState?: any }) {
  const [{ data: account, error: accountError }, { data: brief, error: briefError }, { data: contact, error: contactError }] = await Promise.all([
    client.from("accounts").select("id, name, website, metadata").eq("id", accountId).single(),
    briefId ? client.from("ai_sales_briefs").select("id, account_id, facts, inferences, qualification").eq("id", briefId).eq("account_id", accountId).single() : Promise.resolve({ data: null, error: null }),
    contactId ? client.from("contacts").select("id, full_name, role_title, email, verification_status, metadata").eq("id", contactId).eq("account_id", accountId).single() : Promise.resolve({ data: null, error: null }),
  ]);
  if (accountError || briefError || contactError || !account) throw new Error("OUTREACH_COMPOSER_INPUT_NOT_FOUND");
  assertOutreachAccountEligible(account);
  return composerInputFromPersisted({ account, brief, contact, ...details });
}

export async function GET(request: Request) {
  if (!outreachComposerProductionEnabled()) return disabled();
  const { client, user, member } = await actor();
  if (!user) return NextResponse.json({ message: "Sign in is required." }, { status: 401 });
  if (!member?.active) return NextResponse.json({ message: "Active membership is required." }, { status: 403 });
  const draftId = new URL(request.url).searchParams.get("draftId");
  const drafts = draftId ? client.from("ai_outreach_drafts").select("*").eq("id", draftId).maybeSingle() : client.from("ai_outreach_drafts").select("*").order("created_at", { ascending: false }).limit(50);
  const { data, error } = await drafts;
  if (error) return NextResponse.json({ message: "Composer persistence is unavailable until its migration is applied." }, { status: 503 });
  const rows = draftId ? (data ? [data] : []) : data ?? [];
  const ids = rows.map((row: any) => row.id);
  const [{ data: versions }] = ids.length ? await Promise.all([client.from("ai_outreach_draft_versions").select("*").in("draft_id", ids).order("sequence_number").order("revision_number")]) : [{ data: [] }];
  const versionIds = (versions ?? []).map((version: any) => version.id);
  const { data: reviews } = versionIds.length ? await client.from("ai_outreach_draft_reviews").select("*").in("draft_version_id", versionIds) : { data: [] };
  return NextResponse.json({ drafts: rows, versions: versions ?? [], reviews: reviews ?? [] });
}

export async function POST(request: Request) {
  if (!outreachComposerProductionEnabled()) return disabled();
  const { client, user, member } = await actor();
  if (!user) return NextResponse.json({ message: "Sign in is required." }, { status: 401 });
  if (!member?.active || !["operator", "admin"].includes(member.member_role)) return NextResponse.json({ message: "Active operator access is required." }, { status: 403 });
  const body = await request.json() as { action?: string; reviewAction?: string; accountId?: string; briefId?: string; contactId?: string; draftId?: string; versionId?: string; sequenceStage?: string; stopState?: string; humanInstruction?: string; revisionNumber?: number; editedSubject?: string; editedBody?: string; relevanceRating?: number; toneRating?: number; reasonTags?: string[]; note?: string };
  try {
    if (body.action === "prepare") {
      if (!body.accountId || !body.briefId) throw new Error("OUTREACH_COMPOSER_ACCOUNT_AND_BRIEF_REQUIRED");
      const input = await accountInputs(client, body.accountId, body.briefId, body.contactId ?? null, { stage: stage(body.sequenceStage), stopState: stopState(body.stopState) });
      return NextResponse.json(body.sequenceStage && body.sequenceStage !== "EMAIL_1" ? await createComposerDraft(client, input, user.id, body.accountId, body.briefId, body.contactId ?? null) : await createComposerSequence(client, input, user.id, body.accountId, body.briefId, body.contactId ?? null));
    }
    if (body.action === "revise") {
      if (!body.draftId || !body.accountId || !body.versionId) throw new Error("OUTREACH_COMPOSER_REVISION_INPUT_REQUIRED");
      const { data: version, error: versionError } = await client.from("ai_outreach_draft_versions").select("sequence_stage, body_plain_text, revision_number").eq("id", body.versionId).eq("draft_id", body.draftId).single();
      if (versionError || !version) throw new Error("OUTREACH_COMPOSER_VERSION_NOT_FOUND");
      const input = await accountInputs(client, body.accountId, body.briefId ?? null, body.contactId ?? null, { stage: "REVISION", originalStage: version.sequence_stage, priorMessageBody: version.body_plain_text, humanInstruction: body.humanInstruction ?? null });
      return NextResponse.json(await reviseComposerDraft(client, input, body.draftId, user.id, Number(body.revisionNumber ?? version.revision_number)));
    }
    if (body.action === "review") {
      if (!body.versionId) throw new Error("OUTREACH_COMPOSER_VERSION_REQUIRED");
      const { data: reviewVersion, error: reviewVersionError } = await client.from("ai_outreach_draft_versions").select("model_status").eq("id", body.versionId).single();
      if (reviewVersionError || !reviewVersion) throw new Error("OUTREACH_COMPOSER_VERSION_NOT_FOUND");
      if (reviewVersion.model_status === "DO_NOT_DRAFT") throw new Error("OUTREACH_COMPOSER_REVIEW_BLOCKED");
      return NextResponse.json(await recordComposerReview(client, { versionId: body.versionId, action: body.reviewAction as any, actorId: user.id, editedSubject: body.editedSubject, editedBody: body.editedBody, relevanceRating: body.relevanceRating, toneRating: body.toneRating, reasonTags: body.reasonTags, note: body.note, stage: stage(body.sequenceStage) as any }));
    }
    throw new Error("OUTREACH_COMPOSER_ACTION_INVALID");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Outreach Composer action failed.";
    return NextResponse.json({ code: message.split(":")[0], message }, { status: message.includes("NOT_FOUND") ? 404 : message.includes("REQUIRED") || message.includes("INVALID") ? 400 : 502 });
  }
}
