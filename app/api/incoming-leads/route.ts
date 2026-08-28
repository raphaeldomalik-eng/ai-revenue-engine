import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../src/lib/supabase-server";

const VIEWS = new Set(["needs-attention", "demo-requests", "talk-to-sales", "trials", "resources", "high-engagement", "follow-ups", "nurture", "converted", "disqualified", "test-excluded", "all"]);

async function readAccess(client: Awaited<ReturnType<typeof createServerSupabaseClient>>) {
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return { error: NextResponse.json({ message: "Sign in is required." }, { status: 401 }) };
  const { data: member, error } = await client.from("revenue_members").select("member_role, active").eq("user_id", auth.user.id).maybeSingle();
  if (error || !member?.active) return { error: NextResponse.json({ message: "Active membership is required." }, { status: 403 }) };
  return { access: String(member.member_role).toUpperCase() as "VIEWER" | "OPERATOR" | "ADMIN", memberRole: String(member.member_role).toLowerCase(), userId: auth.user.id };
}

function isOverdue(lead: Record<string, any>) {
  return Boolean(lead.follow_up_at && new Date(lead.follow_up_at).getTime() < Date.now() && !["CONVERTED", "DISQUALIFIED", "LOST"].includes(lead.stage));
}

function matchesView(lead: Record<string, any>, view: string) {
  if (view === "all") return true;
  if (view === "test-excluded") return lead.is_test;
  if (lead.is_test) return false;
  if (view === "needs-attention") return ["URGENT", "HIGH"].includes(lead.priority) || isOverdue(lead) || (lead.current_intent === "MEDIUM" && !lead.owner_id);
  if (view === "demo-requests") return lead.originating_source_category === "DEMO_REQUEST" || lead.latest_source_category === "DEMO_REQUEST";
  if (view === "talk-to-sales") return lead.originating_source_category === "TALK_TO_SALES" || lead.latest_source_category === "TALK_TO_SALES";
  if (view === "trials") return lead.originating_source_category === "TRIAL_STARTED" || lead.latest_source_category === "TRIAL_STARTED";
  if (view === "resources") return ["RESOURCE_DOWNLOAD", "TEMPLATE_DOWNLOAD"].includes(lead.originating_source_category) || ["RESOURCE_DOWNLOAD", "TEMPLATE_DOWNLOAD"].includes(lead.latest_source_category);
  if (view === "high-engagement") return lead.current_intent === "MEDIUM";
  if (view === "follow-ups") return Boolean(lead.follow_up_at);
  if (view === "nurture") return lead.stage === "NURTURE" || ["LOW", "NURTURE"].includes(lead.current_intent);
  if (view === "converted") return lead.stage === "CONVERTED";
  if (view === "disqualified") return ["DISQUALIFIED", "LOST"].includes(lead.stage);
  return true;
}

export async function GET(request: Request) {
  const client = await createServerSupabaseClient();
  const access = await readAccess(client);
  if (access.error) return access.error;
  const url = new URL(request.url);
  if (url.searchParams.get("view") === "meta") return NextResponse.json({ access: access.access });
  const leadId = url.searchParams.get("leadId");
  if (leadId) {
    const [{ data: lead, error: leadError }, { data: changes, error: changesError }, { data: notes, error: notesError }, { data: submissions, error: submissionsError }, { data: activities, error: activitiesError }, { data: members, error: membersError }] = await Promise.all([
      client.from("incoming_leads").select("*").eq("id", leadId).maybeSingle(),
      client.from("incoming_lead_changes").select("*").eq("incoming_lead_id", leadId).order("created_at", { ascending: false }),
      client.from("incoming_lead_notes").select("*").eq("incoming_lead_id", leadId).order("created_at", { ascending: false }),
      client.from("incoming_submissions").select("*").eq("incoming_lead_id", leadId).order("occurred_at", { ascending: false }),
      client.from("activities").select("*").eq("incoming_lead_id", leadId).order("occurred_at", { ascending: false }),
      client.from("revenue_members").select("user_id,member_role,active").eq("active", true),
    ]);
    if (leadError || changesError || notesError || submissionsError || activitiesError || membersError) return NextResponse.json({ message: "Incoming lead detail is unavailable until the V1 migration is applied." }, { status: 503 });
    if (!lead) return NextResponse.json({ message: "Incoming lead not found." }, { status: 404 });
    return NextResponse.json({ access: access.access, lead, changes: changes ?? [], notes: notes ?? [], submissions: submissions ?? [], activities: activities ?? [], members: members ?? [] });
  }
  const view = url.searchParams.get("view") ?? "needs-attention";
  if (!VIEWS.has(view)) return NextResponse.json({ message: "Incoming lead view is invalid." }, { status: 400 });
  const search = (url.searchParams.get("search") ?? "").trim().toLowerCase();
  if (search.length > 200) return NextResponse.json({ message: "Search is too long." }, { status: 400 });
  const [{ data: rows, error }, { data: members, error: membersError }] = await Promise.all([
    client.from("incoming_leads").select("*").order("priority_rank", { ascending: false, nullsFirst: false }).order("last_activity_at", { ascending: false }).limit(1000),
    client.from("revenue_members").select("user_id,member_role,active").eq("active", true),
  ]);
  if (error || membersError) return NextResponse.json({ message: "Incoming Leads data is unavailable until the V1 migration is applied." }, { status: 503 });
  const all = (rows ?? []) as Record<string, any>[];
  const source = url.searchParams.get("source") ?? "ALL";
  const stage = url.searchParams.get("stage") ?? "ALL";
  const country = url.searchParams.get("country") ?? "ALL";
  const consent = url.searchParams.get("consent") ?? "ALL";
  const owner = url.searchParams.get("owner") ?? "ALL";
  const dateFrom = url.searchParams.get("dateFrom") ?? "";
  const dateTo = url.searchParams.get("dateTo") ?? "";
  const filtered = all.filter((lead) => {
    const haystack = `${lead.display_name ?? ""} ${lead.organisation_name ?? ""} ${lead.originating_source_detail ?? ""} ${lead.latest_source_detail ?? ""} ${lead.product_code ?? ""}`.toLowerCase();
    const activityTime = new Date(lead.last_activity_at).getTime();
    return matchesView(lead, view) && (!search || haystack.includes(search)) && (source === "ALL" || lead.originating_source_category === source || lead.latest_source_category === source) && (stage === "ALL" || lead.stage === stage) && (country === "ALL" || lead.country_code === country) && (consent === "ALL" || String(lead.communication_policy?.consentState ?? "UNKNOWN") === consent) && (owner === "ALL" || (owner === "UNASSIGNED" ? !lead.owner_id : lead.owner_id === owner)) && (!dateFrom || activityTime >= new Date(`${dateFrom}T00:00:00Z`).getTime()) && (!dateTo || activityTime <= new Date(`${dateTo}T23:59:59Z`).getTime());
  });
  const periodStart = Date.now() - 30 * 86400000;
  const active = all.filter((lead) => !lead.is_test && new Date(lead.last_activity_at).getTime() >= periodStart);
  const metrics = {
    newQualified: active.filter((lead) => ["QUALIFIED", "CONTACTED", "DEMO_SCHEDULED", "TRIAL_ACTIVE", "PROPOSAL"].includes(lead.stage)).length,
    requiringAction: all.filter((lead) => matchesView(lead, "needs-attention")).length,
    demoAwaitingResponse: active.filter((lead) => lead.latest_source_category === "DEMO_REQUEST" && !lead.last_contacted_at && !["CONVERTED", "DISQUALIFIED", "LOST"].includes(lead.stage)).length,
    trialsAwaitingEngagement: active.filter((lead) => lead.latest_source_category === "TRIAL_STARTED" && !lead.last_contacted_at && !["CONVERTED", "DISQUALIFIED", "LOST"].includes(lead.stage)).length,
    overdueFollowUps: all.filter(isOverdue).length,
    incomingConversionRate: active.length ? Math.round((active.filter((lead) => lead.stage === "CONVERTED").length / active.length) * 100) : null,
  };
  return NextResponse.json({ access: access.access, view, leads: filtered, allCount: all.length, metrics, members: members ?? [] });
}

export async function POST(request: Request) {
  const client = await createServerSupabaseClient();
  const access = await readAccess(client);
  if (access.error) return access.error;
  if (access.memberRole !== "operator" && access.memberRole !== "admin") return NextResponse.json({ message: "Active operator access is required." }, { status: 403 });
  let body: { action?: string; leadId?: string; value?: Record<string, unknown>; payload?: Record<string, unknown> };
  try { body = await request.json(); } catch { return NextResponse.json({ message: "A valid JSON request is required." }, { status: 400 }); }
  try {
    if (body.action === "INGEST") {
      if (!body.payload || JSON.stringify(body.payload).length > 100000) throw new Error("INCOMING_SUBMISSION_PAYLOAD_TOO_LARGE");
      const { data, error } = await client.rpc("ingest_incoming_submission", { p_payload: body.payload });
      if (error) throw new Error(error.message);
      return NextResponse.json({ result: data });
    }
    if (!body.leadId || !body.action) throw new Error("INCOMING_LEAD_INPUT_INVALID");
    const { data, error } = await client.rpc("update_incoming_lead", { p_lead_id: body.leadId, p_action: body.action, p_value: body.value ?? {} });
    if (error) throw new Error(error.message);
    return NextResponse.json({ lead: data, message: "Incoming lead updated." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Incoming lead action failed.";
    const known = message.match(/INCOMING_[A-Z_]+/)?.[0];
    const status = known?.includes("NOT_FOUND") ? 404 : known?.includes("REQUIRED") || known?.includes("INVALID") || known?.includes("TOO_LARGE") ? 400 : 502;
    return NextResponse.json({ code: known ?? "INCOMING_LEAD_ACTION_FAILED", message: known ? message : "Incoming lead action failed." }, { status });
  }
}
