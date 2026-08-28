import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../src/lib/supabase-server";
import { validateBlockDecision } from "../../../src/operator-ui/prospect-review";
import { decodeProspectQueueCursor, encodeProspectQueueCursor, prospectQueueKey } from "../../../src/operator-ui/prospect-queue-cursor";
const QUEUE_KEYS = new Set(["NEEDS_REVIEW", "READY_PEOPLE", "DRAFTS", "APPROVED", "DEFERRED", "ARCHIVE", "ALL"]);
const PROSPECT_TYPES = new Set(["ALL", "Event", "Organisation", "Person", "Venue"]);
const REVIEW_STATES = new Set(["ALL", "Needs identity review", "Ready for person review", "Contact needs review"]);
const CONTACT_STATES = new Set(["ALL", "PERSON", "NONE"]);
const EMAIL_STATES = new Set(["ALL", "VERIFIED", "REVIEW"]);
const PRIORITIES = new Set(["ALL", "Phase One priority", "Standard priority", "Deferred"]);
const SORTS = new Set(["attention", "recent", "name", "ready"]);

async function prospectList(client: Awaited<ReturnType<typeof createServerSupabaseClient>>, access: any, url: URL) {
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("pageSize") ?? "25", 10) || 25));
  const queue = url.searchParams.get("queue") ?? "NEEDS_REVIEW";
  const search = (url.searchParams.get("search") ?? "").trim();
  const territory = url.searchParams.get("territory") ?? "ALL";
  const prospectType = url.searchParams.get("prospectType") ?? "ALL";
  const reviewState = url.searchParams.get("reviewState") ?? "ALL";
  const contactState = url.searchParams.get("contactState") ?? "ALL";
  const emailState = url.searchParams.get("emailState") ?? "ALL";
  const priority = url.searchParams.get("priority") ?? "ALL";
  const sort = url.searchParams.get("sort") ?? "attention";
  const direction = url.searchParams.get("direction") === "previous" ? "previous" : "next";
  if (!QUEUE_KEYS.has(queue) || !PROSPECT_TYPES.has(prospectType) || !REVIEW_STATES.has(reviewState) || !CONTACT_STATES.has(contactState) || !EMAIL_STATES.has(emailState) || !PRIORITIES.has(priority) || !SORTS.has(sort) || search.length > 200) return NextResponse.json({ code: "PROSPECT_FILTER_INVALID", message: "The prospect filter is not valid." }, { status: 400 });
  const key = prospectQueueKey({ queue, search, territory, prospectType, reviewState, contactState, emailState, priority, sort, pageSize: String(pageSize) });
  let cursor: Record<string, string> | null;
  try { cursor = decodeProspectQueueCursor(url.searchParams.get("cursor"), key, page, sort, direction); } catch { return NextResponse.json({ code: "PAGINATION_CURSOR_INVALID", message: "This page cursor is no longer valid. Return to the first page and try again." }, { status: 400 }); }
  const [{ data: result, error: resultError }, { data: runs, error: runsError }] = await Promise.all([
    client.rpc("list_ai_prospect_queue", { p_queue: queue, p_search: search, p_territory: territory, p_prospect_type: prospectType, p_review_state: reviewState, p_contact_state: contactState, p_email_state: emailState, p_priority: priority, p_sort: sort, p_page: page, p_page_size: pageSize, p_cursor: cursor, p_direction: direction }),
    client.from("ai_prospect_discovery_runs").select("id,territory_code,focus,status,budget,summary,provider,model,error_message,started_at,completed_at,created_at").order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1),
  ]);
  if (resultError || runsError || !result) return NextResponse.json({ message: "Operator prospect queue is unavailable until the native pagination migration is applied." }, { status: 503 });
  const pageData = result as any;
  const total = Number(pageData.total ?? 0);
  const pageCount = Math.max(1, Number(pageData.pageCount ?? Math.ceil(total / pageSize)));
  const nextCursor = pageData.hasNext ? encodeProspectQueueCursor(pageData.lastPosition, key, page, sort) : null;
  const previousCursor = pageData.hasPrevious ? encodeProspectQueueCursor(pageData.firstPosition, key, page, sort) : null;
  return NextResponse.json({ access: access.access, view: "prospects", runs: runs ?? [], candidates: Array.isArray(pageData.candidates) ? pageData.candidates : [], latestRunId: runs?.[0]?.id ?? null, total, page: Math.min(pageCount, page), pageSize, pageCount, queueCounts: pageData.queueCounts ?? {}, hasNext: Boolean(nextCursor), hasPrevious: Boolean(previousCursor), nextCursor, previousCursor, returned: Number(pageData.returned ?? 0) });
}

async function prospectDetail(client: Awaited<ReturnType<typeof createServerSupabaseClient>>, access: any, candidateId: string | null) {
  if (!candidateId) return NextResponse.json({ message: "A prospect is required." }, { status: 400 });
  const [{ data: candidate, error: candidateError }, { data: runs, error: runsError }] = await Promise.all([
    client.from("ai_prospect_candidates").select("*").eq("id", candidateId).maybeSingle(),
    client.from("ai_prospect_discovery_runs").select("id,territory_code,focus,status,budget,summary,provider,model,error_message,started_at,completed_at,created_at").order("created_at", { ascending: false }).limit(50),
  ]);
  if (candidateError || runsError) return NextResponse.json({ message: "Prospect detail is unavailable until discovery persistence is applied." }, { status: 503 });
  if (!candidate) return NextResponse.json({ access: access.access, view: "prospect-detail", runs: runs ?? [], candidates: [], latestRunId: (runs ?? [])[0]?.id ?? null });
  const accountId = candidate.account_id;
  const [{ data: account, error: accountError }, { data: contacts, error: contactsError }, { data: evidence, error: evidenceError }, { data: decisions, error: decisionsError }, { data: approvals, error: approvalsError }] = await Promise.all([
    accountId ? client.from("accounts").select("id,name,website,metadata").eq("id", accountId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    accountId ? client.from("contacts").select("*").eq("account_id", accountId) : Promise.resolve({ data: [], error: null }),
    accountId ? client.from("research_evidence").select("*").eq("account_id", accountId) : Promise.resolve({ data: [], error: null }),
    client.from("ai_prospect_review_decisions").select("id,candidate_id,decision,reason_code,other_explanation,note,reviewer_id,previous_status,created_at").eq("candidate_id", candidateId).order("created_at", { ascending: false }),
    client.from("ai_prospect_approval_reviews").select("id,candidate_id,decision,reviewer_id,note,created_at").eq("candidate_id", candidateId).order("created_at", { ascending: false }),
  ]);
  if (accountError || contactsError || evidenceError || decisionsError || approvalsError) return NextResponse.json({ message: "Prospect detail evidence could not be loaded." }, { status: 503 });
  const hydrated = { ...candidate, account: account ?? null, contacts: contacts ?? [], evidence: evidence ?? [], review_decisions: decisions ?? [], prospect_approval: approvals?.[0] ?? null };
  return NextResponse.json({ access: access.access, view: "prospect-detail", runs: runs ?? [], candidates: [hydrated], latestRunId: (runs ?? [])[0]?.id ?? null });
}

async function readAccess(client: Awaited<ReturnType<typeof createServerSupabaseClient>>) {
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return { error: NextResponse.json({ message: "Sign in is required." }, { status: 401 }) };
  const { data: member, error } = await client.from("revenue_members").select("member_role, active").eq("user_id", auth.user.id).maybeSingle();
  if (error || !member?.active) return { error: NextResponse.json({ message: "Active membership is required." }, { status: 403 }) };
  return { access: String(member.member_role).toUpperCase() as "VIEWER" | "OPERATOR" | "ADMIN", userId: auth.user.id, memberRole: String(member.member_role).toLowerCase() };
}

export async function GET(request: Request) {
  const client = await createServerSupabaseClient();
  const access = await readAccess(client);
  if (access.error) return access.error;
  const url = new URL(request.url);
  const view = url.searchParams.get("view") ?? "overview";
  const runId = url.searchParams.get("runId");
  const candidateId = url.searchParams.get("candidateId");

  if (view === "prospects") return prospectList(client, access, url);
  if (view === "prospect-detail" || view === "prospect") return prospectDetail(client, access, candidateId);

  const runsQuery = client.from("ai_prospect_discovery_runs").select("*").order("created_at", { ascending: false }).limit(50);
  const candidatesQuery = runId
    ? client.from("ai_prospect_candidates").select("*").eq("discovery_run_id", runId).order("created_at", { ascending: false }).limit(500)
    : candidateId
      ? client.from("ai_prospect_candidates").select("*").eq("id", candidateId).limit(1)
      : client.from("ai_prospect_candidates").select("*").order("created_at", { ascending: false }).limit(500);
  const [{ data: runs, error: runsError }, { data: candidates, error: candidatesError }] = await Promise.all([runsQuery, candidatesQuery]);
  if (runsError || candidatesError) return NextResponse.json({ message: "Operator data is unavailable until discovery persistence is applied." }, { status: 503 });

  const safeRuns = runs ?? [];
  const safeCandidates = candidates ?? [];
  const accountIds = [...new Set(safeCandidates.map((candidate) => candidate.account_id).filter(Boolean))];
  const [accountsResult, contactsResult, evidenceResult] = accountIds.length ? await Promise.all([
    client.from("accounts").select("id, name, website, metadata").in("id", accountIds),
    client.from("contacts").select("*").in("account_id", accountIds),
    client.from("research_evidence").select("*").in("account_id", accountIds),
  ]) : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
  if (accountsResult.error || contactsResult.error || evidenceResult.error) return NextResponse.json({ message: "Operator evidence could not be loaded." }, { status: 503 });

  const accountById = new Map((accountsResult.data ?? []).map((account) => [account.id, account]));
  const contactsByAccount = new Map<string, any[]>();
  for (const contact of contactsResult.data ?? []) contactsByAccount.set(contact.account_id, [...(contactsByAccount.get(contact.account_id) ?? []), contact]);
  const evidenceByAccount = new Map<string, any[]>();
  for (const evidence of evidenceResult.data ?? []) evidenceByAccount.set(evidence.account_id, [...(evidenceByAccount.get(evidence.account_id) ?? []), evidence]);
  const candidateIds = safeCandidates.map((candidate) => candidate.id);
  const { data: decisions, error: decisionsError } = candidateIds.length
    ? await client.from("ai_prospect_review_decisions").select("id, candidate_id, decision, reason_code, other_explanation, note, reviewer_id, previous_status, created_at").in("candidate_id", candidateIds).order("created_at", { ascending: false })
    : { data: [], error: null };
  if (decisionsError) return NextResponse.json({ message: "Prospect review history is unavailable until its migration is applied." }, { status: 503 });
  const { data: approvals, error: approvalsError } = candidateIds.length
    ? await client.from("ai_prospect_approval_reviews").select("id, candidate_id, decision, reviewer_id, note, created_at").in("candidate_id", candidateIds).order("created_at", { ascending: false })
    : { data: [], error: null };
  if (approvalsError) return NextResponse.json({ message: "Prospect approval history is unavailable until its migration is applied." }, { status: 503 });
  const decisionsByCandidate = new Map<string, any[]>();
  for (const decision of decisions ?? []) decisionsByCandidate.set(decision.candidate_id, [...(decisionsByCandidate.get(decision.candidate_id) ?? []), decision]);
  const approvalsByCandidate = new Map<string, any[]>();
  for (const approval of approvals ?? []) approvalsByCandidate.set(approval.candidate_id, [...(approvalsByCandidate.get(approval.candidate_id) ?? []), approval]);
  const hydrated = safeCandidates.map((candidate) => ({
    ...candidate,
    account: candidate.account_id ? accountById.get(candidate.account_id) ?? null : null,
    contacts: candidate.account_id ? contactsByAccount.get(candidate.account_id) ?? [] : [],
    evidence: candidate.account_id ? evidenceByAccount.get(candidate.account_id) ?? [] : [],
    review_decisions: decisionsByCandidate.get(candidate.id) ?? [],
    prospect_approval: approvalsByCandidate.get(candidate.id)?.[0] ?? null,
  }));
  const latestRunId = safeRuns[0]?.id ?? null;
  const selectedRun = runId ? safeRuns.find((run) => run.id === runId) ?? null : null;
  return NextResponse.json({ access: access.access, view, runs: safeRuns, candidates: hydrated, selectedRun, latestRunId });
}

export async function POST(request: Request) {
  const client = await createServerSupabaseClient();
  const access = await readAccess(client);
  if (access.error) return access.error;
  if (!access.userId || !["operator", "admin"].includes(access.memberRole)) return NextResponse.json({ message: "Active operator access is required." }, { status: 403 });
  let body: { action?: string; candidateId?: string; sourceQueue?: string; reasonCode?: unknown; otherExplanation?: unknown; note?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ code: "PROSPECT_REVIEW_INPUT_INVALID", message: "A valid review decision is required." }, { status: 400 }); }
  if (!body.candidateId) return NextResponse.json({ code: "PROSPECT_ID_REQUIRED", message: "A prospect is required." }, { status: 400 });
  try {
    if (body.action === "APPROVE_PROSPECT") {
      const { data, error } = await client.rpc("record_ai_prospect_approval", { p_candidate_id: body.candidateId, p_note: typeof body.note === "string" ? body.note.trim() || null : null, p_reviewer_id: access.userId });
      if (error) throw new Error(error.message || "PROSPECT_APPROVAL_SAVE_FAILED");
      return NextResponse.json({ approval: data, message: "Prospect approved for drafting." });
    }
    if (body.action === "REOPEN" && body.sourceQueue !== "ARCHIVE") throw new Error("PROSPECT_REOPEN_ARCHIVE_ONLY");
    const decision = body.action === "REOPEN" ? { reasonCode: null, otherExplanation: null, note: typeof body.note === "string" ? body.note.trim() || null : null } : validateBlockDecision({ reasonCode: body.reasonCode, otherExplanation: body.otherExplanation, note: body.note });
    if (body.action !== "BLOCK" && body.action !== "REOPEN") throw new Error("PROSPECT_REVIEW_ACTION_INVALID");
    if (decision.note && decision.note.length > 1000) throw new Error("PROSPECT_BLOCK_NOTE_TOO_LONG");
    const { data, error } = await client.rpc("record_ai_prospect_review_decision", {
      p_candidate_id: body.candidateId,
      p_decision: body.action === "BLOCK" ? "BLOCKED" : "REOPENED",
      p_reason_code: decision.reasonCode,
      p_other_explanation: decision.otherExplanation,
      p_note: decision.note,
      p_reviewer_id: access.userId,
    });
    if (error) throw new Error(error.message || "PROSPECT_REVIEW_SAVE_FAILED");
    return NextResponse.json({ decision: data, message: body.action === "BLOCK" ? "Prospect blocked and moved to History / archive." : "Prospect reopened for review." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Prospect review decision could not be saved.";
    const code = message.includes("PROSPECT_") ? message.match(/PROSPECT_[A-Z_]+/)?.[0] ?? "PROSPECT_REVIEW_SAVE_FAILED" : "PROSPECT_REVIEW_SAVE_FAILED";
    const status = code.includes("REQUIRED") || code.includes("INVALID") || code.includes("TOO_LONG") || code.includes("EXPLANATION") || code.includes("ARCHIVE_ONLY") ? 400 : code.includes("NOT_FOUND") ? 404 : code.includes("ALREADY") || code.includes("NOT_BLOCKED") || code.includes("BLOCKED") ? 409 : 502;
    return NextResponse.json({ code, message: code === "PROSPECT_REVIEW_SAVE_FAILED" ? "The review decision could not be saved." : message }, { status });
  }
}
