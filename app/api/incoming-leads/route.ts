import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../src/lib/supabase-server";

const VIEWS = new Set(["needs-review", "active-leads", "high-intent", "follow-up-due", "incomplete-data", "existing-customers", "excluded", "all"]);
const SOURCE_CATEGORIES = new Set(["ALL", "DEMO_REQUEST", "TALK_TO_SALES", "TRIAL_STARTED", "PRODUCT_ENQUIRY", "RESOURCE_DOWNLOAD", "TEMPLATE_DOWNLOAD", "NEWSLETTER_SIGNUP", "INTERNAL_TEST"]);
const CLASSIFICATIONS = new Set(["ALL", "NEEDS_REVIEW", "GENUINE_PROSPECT", "EXISTING_CUSTOMER", "PARTNER", "SUPPLIER", "COMPETITOR", "TICKETING_PROVIDER", "INTERNAL", "TEST_SYNTHETIC", "OTHER_NON_LEAD"]);
const INTENTS = new Set(["ALL", "VERY_HIGH", "HIGH", "MEDIUM", "LOW", "NURTURE", "EXCLUDED"]);
const STAGES = new Set(["ALL", "NEW", "REVIEWING", "QUALIFIED", "CONTACTED", "DEMO_SCHEDULED", "TRIAL_ACTIVE", "PROPOSAL", "NURTURE", "CONVERTED", "DISQUALIFIED", "LOST"]);
const FOLLOW_UP_STATES = new Set(["ALL", "DUE", "SCHEDULED", "NONE"]);
const DATA_QUALITY_STATES = new Set(["ALL", "INCOMPLETE", "COMPLETE"]);
const ENRICHMENT_STATES = new Set(["ALL", "NOT_ELIGIBLE", "BLOCKED_UNTIL_IDENTITY_RESOLVED", "EVIDENCE_AVAILABLE", "NOT_ENRICHED"]);

async function readAccess(client: Awaited<ReturnType<typeof createServerSupabaseClient>>) {
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return { error: NextResponse.json({ message: "Sign in is required." }, { status: 401 }) };
  const { data: member, error } = await client.from("revenue_members").select("member_role, active").eq("user_id", auth.user.id).maybeSingle();
  if (error || !member?.active) return { error: NextResponse.json({ message: "Active membership is required." }, { status: 403 }) };
  return { access: String(member.member_role).toUpperCase() as "VIEWER" | "OPERATOR" | "ADMIN", memberRole: String(member.member_role).toLowerCase(), userId: auth.user.id };
}

function oneOf(value: string | null, choices: Set<string>, fallback: string) {
  return choices.has(value ?? fallback) ? value ?? fallback : null;
}

function dateValue(value: string | null, end = false) {
  if (!value) return null;
  const parsed = new Date(`${value}${end ? "T23:59:59.999Z" : "T00:00:00.000Z"}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
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
    if (leadError || changesError || notesError || submissionsError || activitiesError || membersError) return NextResponse.json({ message: "Incoming Leads data is unavailable until the V1 migration is applied." }, { status: 503 });
    if (!lead) return NextResponse.json({ message: "Incoming lead not found." }, { status: 404 });
    const [account, contact, opportunity, evidence] = await Promise.all([
      lead.account_id ? client.from("accounts").select("id,name,website,organisation_type").eq("id", lead.account_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      lead.contact_id ? client.from("contacts").select("id,full_name,email,phone,role_title,verification_status").eq("id", lead.contact_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      lead.product_opportunity_id ? client.from("product_opportunities").select("id,stage,conversion_route,next_action,metadata").eq("id", lead.product_opportunity_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      lead.account_id ? client.from("research_evidence").select("id,evidence_type,claim,source_url,source_title,observed_at,confidence,created_at").eq("account_id", lead.account_id).order("created_at", { ascending: false }).limit(25) : Promise.resolve({ data: [], error: null }),
    ]);
    if (account.error || contact.error || opportunity.error || evidence.error) return NextResponse.json({ message: "Incoming lead enrichment evidence is unavailable." }, { status: 503 });
    return NextResponse.json({ access: access.access, lead, changes: changes ?? [], notes: notes ?? [], submissions: submissions ?? [], activities: activities ?? [], members: members ?? [], account: account.data, contact: contact.data, opportunity: opportunity.data, evidence: evidence.data ?? [] });
  }

  const view = oneOf(url.searchParams.get("view"), VIEWS, "needs-review");
  const source = oneOf(url.searchParams.get("source"), SOURCE_CATEGORIES, "ALL");
  const classification = oneOf(url.searchParams.get("classification"), CLASSIFICATIONS, "ALL");
  const intent = oneOf(url.searchParams.get("intent"), INTENTS, "ALL");
  const stage = oneOf(url.searchParams.get("stage"), STAGES, "ALL");
  const followUpState = oneOf(url.searchParams.get("followUpState"), FOLLOW_UP_STATES, "ALL");
  const dataQualityState = oneOf(url.searchParams.get("dataQualityState"), DATA_QUALITY_STATES, "ALL");
  const enrichmentState = oneOf(url.searchParams.get("enrichmentState"), ENRICHMENT_STATES, "ALL");
  const search = (url.searchParams.get("search") ?? "").trim();
  const owner = url.searchParams.get("owner") ?? "ALL";
  const page = Math.max(1, Math.min(Number(url.searchParams.get("page") ?? 1) || 1, 100000));
  const pageSize = [25, 50, 100].includes(Number(url.searchParams.get("pageSize"))) ? Number(url.searchParams.get("pageSize")) : 25;
  if (!view || !source || !classification || !intent || !stage || !followUpState || !dataQualityState || !enrichmentState || search.length > 200) return NextResponse.json({ message: "One or more incoming lead filters are invalid." }, { status: 400 });

  const membersResult = await client.from("revenue_members").select("user_id,member_role,active").eq("active", true);
  if (membersResult.error) return NextResponse.json({ message: "Incoming Lead members are unavailable." }, { status: 503 });
  const members = membersResult.data ?? [];
  const ownerId = owner === "ALL" || owner === "UNASSIGNED" ? null : members.some((member) => member.user_id === owner) ? owner : null;
  if (!ownerId && owner !== "ALL" && owner !== "UNASSIGNED") return NextResponse.json({ message: "Incoming Lead owner filter is invalid." }, { status: 400 });
  const [queue, metrics, sourceActivities] = await Promise.all([
    client.rpc("list_incoming_lead_queue", {
      p_view: view, p_search: search || null, p_source: source, p_classification: classification, p_intent: intent,
      p_owner_id: ownerId, p_owner_unassigned: owner === "UNASSIGNED", p_stage: stage,
      p_date_from: dateValue(url.searchParams.get("dateFrom")), p_date_to: dateValue(url.searchParams.get("dateTo"), true),
      p_follow_up_state: followUpState, p_data_quality_state: dataQualityState, p_enrichment_state: enrichmentState,
      p_limit: pageSize, p_offset: (page - 1) * pageSize,
    }),
    client.rpc("incoming_lead_operational_metrics"),
    client.from("incoming_submissions").select("id", { count: "exact", head: true }),
  ]);
  if (queue.error || metrics.error || sourceActivities.error) return NextResponse.json({ message: "Incoming Leads data is unavailable until the operator workspace migration is applied." }, { status: 503 });
  const leads = queue.data ?? [];
  return NextResponse.json({ access: access.access, view, leads, totalCount: Number(leads[0]?.total_count ?? 0), metrics: { ...(metrics.data ?? {}), sourceActivities: sourceActivities.count ?? 0 }, members, page, pageSize });
}

export async function POST(request: Request) {
  const client = await createServerSupabaseClient();
  const access = await readAccess(client);
  if (access.error) return access.error;
  if (access.memberRole !== "operator" && access.memberRole !== "admin") return NextResponse.json({ message: "Active operator access is required." }, { status: 403 });
  let body: { action?: string; leadId?: string; leadIds?: string[]; bulkAction?: string; value?: Record<string, unknown>; payload?: Record<string, unknown> };
  try { body = await request.json(); } catch { return NextResponse.json({ message: "A valid JSON request is required." }, { status: 400 }); }
  try {
    if (body.action === "INGEST") {
      if (!body.payload || JSON.stringify(body.payload).length > 100000) throw new Error("INCOMING_SUBMISSION_PAYLOAD_TOO_LARGE");
      const { data, error } = await client.rpc("ingest_incoming_submission", { p_payload: body.payload });
      if (error) throw new Error(error.message);
      return NextResponse.json({ result: data });
    }
    if (body.action === "BULK") {
      if (!Array.isArray(body.leadIds) || !body.bulkAction) throw new Error("INCOMING_LEAD_BULK_SELECTION_INVALID");
      const { data, error } = await client.rpc("bulk_update_incoming_leads", { p_lead_ids: body.leadIds, p_action: body.bulkAction, p_value: body.value ?? {} });
      if (error) throw new Error(error.message);
      return NextResponse.json({ count: data, message: `${data} incoming lead${data === 1 ? "" : "s"} updated.` });
    }
    if (!body.leadId || !body.action) throw new Error("INCOMING_LEAD_INPUT_INVALID");
    const { data, error } = await client.rpc("update_incoming_lead", { p_lead_id: body.leadId, p_action: body.action, p_value: body.value ?? {} });
    if (error) throw new Error(error.message);
    return NextResponse.json({ lead: data, message: "Incoming lead updated." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Incoming lead action failed.";
    const known = message.match(/INCOMING_[A-Z_]+/)?.[0];
    const isInput = known?.includes("NOT_FOUND") || known?.includes("REQUIRED") || known?.includes("INVALID") || known?.includes("TOO_LARGE") || known?.includes("EXCLUDED") || known?.includes("RESTORE");
    return NextResponse.json({ code: known ?? "INCOMING_LEAD_ACTION_FAILED", message: known ? message : "Incoming lead action failed." }, { status: isInput ? 400 : 502 });
  }
}
