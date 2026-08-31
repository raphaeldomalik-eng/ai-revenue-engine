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
const INVENTORY_VIEWS = new Set(["ALL", "NEEDS_REVIEW", "QUALIFIED", "CONTACTABLE", "ACTIVE", "REJECTED", "BLOCKED", "DUPLICATES", "HISTORICAL"]);
const INVENTORY_STATUSES = new Set(["ALL", "REVIEW_REQUIRED", "QUALIFIED", "REJECTED", "BLOCKED", "DUPLICATE"]);
const INVENTORY_QUALITIES = new Set(["ALL", "READY", "NEEDS_EVIDENCE", "MISSING_SOURCE", "UNRESOLVED"]);

function inventoryStatus(candidate: any) {
  if (candidate.status === "DUPLICATE" || candidate.dedupe_of_candidate_id) return "DUPLICATES";
  if (candidate.status === "BLOCKED") return "BLOCKED";
  if (candidate.status === "REJECTED") return "REJECTED";
  if (candidate.status === "QUALIFIED") return "QUALIFIED";
  if (candidate.status === "REVIEW_REQUIRED") return "NEEDS_REVIEW";
  return "ACTIVE";
}

function inventoryQuality(candidate: any) {
  const intelligence = candidate.prospect_intelligence && typeof candidate.prospect_intelligence === "object" ? candidate.prospect_intelligence : {};
  if (!Array.isArray(candidate.source_urls) || !candidate.source_urls.length) return "MISSING_SOURCE";
  if (!Array.isArray(candidate.facts) || !candidate.facts.length) return "NEEDS_EVIDENCE";
  if ((Array.isArray(candidate.unknowns) && candidate.unknowns.length) || String(intelligence.organisationResolution?.status ?? "").toUpperCase() === "UNRESOLVED") return "UNRESOLVED";
  return "READY";
}

async function attachIdentityResolutions(client: Awaited<ReturnType<typeof createServerSupabaseClient>>, candidates: any[]) {
  const candidateIds = candidates.map((candidate) => candidate.id).filter(Boolean);
  if (!candidateIds.length) return candidates;
  const { data: resolutions, error: resolutionError } = await client
    .from("ai_prospect_identity_resolutions")
    .select("id,event_prospect_id,canonical_organisation_id,relationship_type,resolution_status,evidence_refs,operator_note,actor_id,resolved_at,idempotency_key,created_at")
    .in("event_prospect_id", candidateIds)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  // Keep the existing read-only inventory usable while this additive migration
  // is being rolled out. Save review still fails closed until the RPC exists.
  if (resolutionError) return candidates.map((candidate) => ({ ...candidate, identity_resolution: null, canonical_prospect_organisation: null }));
  const organisationIds = [...new Set((resolutions ?? []).map((item: any) => item.canonical_organisation_id).filter(Boolean))];
  const { data: organisations, error: organisationError } = organisationIds.length
    ? await client.from("ai_prospect_organisations").select("id,name,website,territory_code,source_refs").in("id", organisationIds)
    : { data: [], error: null };
  if (organisationError) throw new Error("PROSPECT_ORGANISATION_READ_FAILED");
  const organisationById = new Map((organisations ?? []).map((item: any) => [item.id, item]));
  const latestByCandidate = new Map<string, any>();
  for (const resolution of resolutions ?? []) if (!latestByCandidate.has(resolution.event_prospect_id)) latestByCandidate.set(resolution.event_prospect_id, resolution);
  return candidates.map((candidate) => {
    const resolution = latestByCandidate.get(candidate.id) ?? null;
    return { ...candidate, identity_resolution: resolution, canonical_prospect_organisation: resolution?.canonical_organisation_id ? organisationById.get(resolution.canonical_organisation_id) ?? null : null };
  });
}

async function prospectInventory(client: Awaited<ReturnType<typeof createServerSupabaseClient>>, access: any, url: URL) {
  const saved = url.searchParams.get("saved") ?? "NEEDS_REVIEW";
  const search = (url.searchParams.get("search") ?? "").trim().toLowerCase();
  const status = url.searchParams.get("status") ?? "ALL";
  const lane = url.searchParams.get("lane") ?? "ALL";
  const run = url.searchParams.get("run") ?? "ALL";
  const quality = url.searchParams.get("quality") ?? "ALL";
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(10, Number.parseInt(url.searchParams.get("pageSize") ?? "25", 10) || 25));
  if (!INVENTORY_VIEWS.has(saved) || !INVENTORY_STATUSES.has(status) || !INVENTORY_QUALITIES.has(quality) || search.length > 200) return NextResponse.json({ code: "INVENTORY_FILTER_INVALID", message: "The inventory filter is not valid." }, { status: 400 });
  const [{ data: result, error: inventoryError }, { data: runs, error: runsError }] = await Promise.all([
    client.rpc("list_ai_prospect_inventory", { p_saved: saved, p_search: search, p_status: status, p_lane: lane, p_run: run === "ALL" ? null : run, p_quality: quality, p_page: page, p_page_size: pageSize }),
    client.from("ai_prospect_discovery_runs").select("*").order("created_at", { ascending: false }).limit(50),
  ]);
  if (inventoryError || runsError || !result) return NextResponse.json({ message: "Prospect inventory is unavailable." }, { status: 503 });
  const inventory = result as { candidates?: unknown; total?: unknown; page?: unknown; pageCount?: unknown; inventoryCounts?: Record<string, number> };
  let candidates = Array.isArray(inventory.candidates) ? inventory.candidates : [];
  candidates = await attachIdentityResolutions(client, candidates);
  return NextResponse.json({ access: access.access, view: "inventory", runs: runs ?? [], candidates, latestRunId: runs?.[0]?.id ?? null, total: Number(inventory.total ?? 0), page: Number(inventory.page ?? 1), pageSize, pageCount: Number(inventory.pageCount ?? 1), inventoryCounts: inventory.inventoryCounts ?? {} });

  { /* Legacy in-route projection retained below only until the next migration cleanup. */
  const [{ data: candidates, error: candidateError }, { data: runs, error: runsError }] = await Promise.all([
    client.from("ai_prospect_candidates").select("*").order("updated_at", { ascending: false }).range(0, 9999),
    client.from("ai_prospect_discovery_runs").select("*").order("created_at", { ascending: false }).limit(50),
  ]);
  if (candidateError || runsError) return NextResponse.json({ message: "Prospect inventory is unavailable." }, { status: 503 });
  const all = candidates ?? [];
  const accountIds = [...new Set(all.map((candidate) => candidate.account_id).filter(Boolean))];
  const [accountsResult, contactsResult, decisionsResult] = accountIds.length ? await Promise.all([
    client.from("accounts").select("id,name,website,metadata").in("id", accountIds),
    client.from("contacts").select("*").in("account_id", accountIds),
    client.from("ai_prospect_review_decisions").select("id,candidate_id,decision,reason_code,other_explanation,note,reviewer_id,previous_status,created_at").in("candidate_id", all.map((candidate) => candidate.id)).order("created_at", { ascending: false }),
  ]) : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
  if (accountsResult.error || contactsResult.error || decisionsResult.error) return NextResponse.json({ message: "Prospect inventory evidence is unavailable." }, { status: 503 });
  const accounts = new Map((accountsResult.data ?? []).map((account) => [account.id, account]));
  const contacts = new Map<string, any[]>();
  for (const contact of contactsResult.data ?? []) contacts.set(contact.account_id, [...(contacts.get(contact.account_id) ?? []), contact]);
  const decisions = new Map<string, any[]>();
  for (const decision of decisionsResult.data ?? []) decisions.set(decision.candidate_id, [...(decisions.get(decision.candidate_id) ?? []), decision]);
  const grouped = new Map<string, any[]>();
  for (const candidate of all) grouped.set(candidate.canonical_key, [...(grouped.get(candidate.canonical_key) ?? []), candidate]);
  const canonical = [...grouped.values()].map((appearances) => {
    const ordered = [...appearances].sort((a, b) => new Date(b.updated_at ?? b.created_at ?? 0).getTime() - new Date(a.updated_at ?? a.created_at ?? 0).getTime());
    const current = ordered[0];
    return {
      ...current,
      account: current.account_id ? accounts.get(current.account_id) ?? null : null,
      contacts: current.account_id ? contacts.get(current.account_id) ?? [] : [],
      review_decisions: decisions.get(current.id) ?? [],
      appearance_count: appearances.length,
      run_appearances: ordered.map((item) => ({ id: item.id, discovery_run_id: item.discovery_run_id, status: item.status, created_at: item.created_at, territory_code: item.territory_code, origin: item.origin, reason: String(item.prospect_intelligence?.runResult?.dispositionReason ?? item.prospect_intelligence?.outreachBlockOrReviewReason ?? "Not recorded") })),
    };
  });
  const counts = { ALL: canonical.length, NEEDS_REVIEW: 0, QUALIFIED: 0, CONTACTABLE: 0, ACTIVE: 0, REJECTED: 0, BLOCKED: 0, DUPLICATES: 0, HISTORICAL: 0 };
  for (const item of canonical) {
    const state = inventoryStatus(item); counts[state as keyof typeof counts] += 1;
    if ((item.contacts ?? []).some((contact: any) => ["VERIFIED", "VALID"].includes(String(contact.verification_status ?? "").toUpperCase()))) counts.CONTACTABLE += 1;
    if (new Date(item.last_seen_at ?? item.created_at ?? 0).getTime() < Date.now() - 30 * 24 * 60 * 60 * 1000) counts.HISTORICAL += 1;
  }
  const filtered = canonical.filter((item) => {
    const itemState = inventoryStatus(item);
    const contactable = (item.contacts ?? []).some((contact: any) => ["VERIFIED", "VALID"].includes(String(contact.verification_status ?? "").toUpperCase()));
    const historical = new Date(item.last_seen_at ?? item.created_at ?? 0).getTime() < Date.now() - 30 * 24 * 60 * 60 * 1000;
    const haystack = `${item.candidate_name ?? ""} ${item.organiser_name ?? ""} ${item.account?.name ?? ""} ${item.website ?? ""} ${item.canonical_key ?? ""}`.toLowerCase();
    return (saved === "ALL" || saved === "CONTACTABLE" ? (saved !== "CONTACTABLE" || contactable) : saved === "HISTORICAL" ? historical : itemState === saved)
      && (status === "ALL" || item.status === status)
      && (lane === "ALL" || item.origin === lane)
      && (run === "ALL" || item.run_appearances.some((appearance: any) => appearance.discovery_run_id === run))
      && (quality === "ALL" || inventoryQuality(item) === quality)
      && (!search || haystack.includes(search));
  }).sort((a, b) => new Date(b.last_seen_at ?? b.created_at ?? 0).getTime() - new Date(a.last_seen_at ?? a.created_at ?? 0).getTime());
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return NextResponse.json({ access: access.access, view: "inventory", runs: runs ?? [], candidates: filtered.slice((Math.min(page, pageCount) - 1) * pageSize, Math.min(page, pageCount) * pageSize), latestRunId: runs?.[0]?.id ?? null, total, page: Math.min(page, pageCount), pageSize, pageCount, inventoryCounts: counts }); }
}

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
  const [{ data: account, error: accountError }, { data: contacts, error: contactsError }, { data: evidence, error: evidenceError }, { data: decisions, error: decisionsError }, { data: approvals, error: approvalsError }, { data: identityResolutions }] = await Promise.all([
    accountId ? client.from("accounts").select("id,name,website,metadata").eq("id", accountId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    accountId ? client.from("contacts").select("*").eq("account_id", accountId) : Promise.resolve({ data: [], error: null }),
    accountId ? client.from("research_evidence").select("*").eq("account_id", accountId) : Promise.resolve({ data: [], error: null }),
    client.from("ai_prospect_review_decisions").select("id,candidate_id,decision,reason_code,other_explanation,note,reviewer_id,previous_status,created_at").eq("candidate_id", candidateId).order("created_at", { ascending: false }),
    client.from("ai_prospect_approval_reviews").select("id,candidate_id,decision,reviewer_id,note,created_at").eq("candidate_id", candidateId).order("created_at", { ascending: false }),
    client.from("ai_prospect_identity_resolutions").select("id,event_prospect_id,canonical_organisation_id,relationship_type,resolution_status,evidence_refs,operator_note,actor_id,resolved_at,idempotency_key,created_at").eq("event_prospect_id", candidateId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1),
  ]);
  if (accountError || contactsError || evidenceError || decisionsError || approvalsError) return NextResponse.json({ message: "Prospect detail evidence could not be loaded." }, { status: 503 });
  const resolution = identityResolutions?.[0] ?? null;
  const { data: canonicalOrganisation } = resolution?.canonical_organisation_id ? await client.from("ai_prospect_organisations").select("id,name,website,territory_code,source_refs").eq("id", resolution.canonical_organisation_id).maybeSingle() : { data: null };
  const hydrated = { ...candidate, account: account ?? null, contacts: contacts ?? [], evidence: evidence ?? [], review_decisions: decisions ?? [], prospect_approval: approvals?.[0] ?? null, identity_resolution: resolution, canonical_prospect_organisation: canonicalOrganisation ?? null };
  return NextResponse.json({ access: access.access, view: "prospect-detail", runs: runs ?? [], candidates: [hydrated], latestRunId: (runs ?? [])[0]?.id ?? null });
}

async function prospectOrganisations(client: Awaited<ReturnType<typeof createServerSupabaseClient>>, access: any, url: URL) {
  const search = (url.searchParams.get("search") ?? "").trim();
  if (search.length > 200) return NextResponse.json({ code: "PROSPECT_ORGANISATION_SEARCH_INVALID", message: "The organisation search is not valid." }, { status: 400 });
  const query = client.from("ai_prospect_organisations").select("id,name,website,territory_code,source_refs").order("name", { ascending: true }).limit(25);
  const { data, error } = search ? await query.ilike("name", `%${search}%`) : await query;
  if (error) return NextResponse.json({ message: "Canonical prospect organisations are unavailable until their migration is applied." }, { status: 503 });
  return NextResponse.json({ access: access.access, view: "prospect-organisations", organisations: data ?? [] });
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
  if (view === "inventory") return prospectInventory(client, access, url);
  if (view === "prospect-organisations") return prospectOrganisations(client, access, url);
  if (view === "prospect-detail" || view === "prospect") return prospectDetail(client, access, candidateId);

  if (view === "overview") {
    const { data: overview, error } = await client.rpc("operator_workspace_overview");
    if (error || !overview) return NextResponse.json({ message: "Operator overview is unavailable until its read model is applied." }, { status: 503 });
    return NextResponse.json({ access: access.access, view, overview });
  }

  if (view === "runs") {
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("pageSize") ?? "50", 10) || 50));
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const { data: runHistory, error } = await client.rpc("list_ai_prospect_run_history", { p_limit: pageSize, p_offset: (page - 1) * pageSize });
    if (error || !runHistory) return NextResponse.json({ message: "Research run history is unavailable until its read model is applied." }, { status: 503 });
    return NextResponse.json({ access: access.access, view, runHistory });
  }

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
  let body: { action?: string; candidateId?: string; sourceQueue?: string; reasonCode?: unknown; otherExplanation?: unknown; note?: unknown; nextAction?: unknown; resolutionStatus?: unknown; canonicalOrganisationId?: unknown; relationshipType?: unknown; evidenceRefs?: unknown; operatorNote?: unknown; reviewNote?: unknown; newOrganisation?: unknown; outcome?: unknown; idempotencyKey?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ code: "PROSPECT_REVIEW_INPUT_INVALID", message: "A valid review decision is required." }, { status: 400 }); }
  if (!body.candidateId) return NextResponse.json({ code: "PROSPECT_ID_REQUIRED", message: "A prospect is required." }, { status: 400 });
  try {
    if (body.action === "APPROVE_PROSPECT") {
      const { data, error } = await client.rpc("record_ai_prospect_approval", { p_candidate_id: body.candidateId, p_note: typeof body.note === "string" ? body.note.trim() || null : null, p_reviewer_id: access.userId });
      if (error) throw new Error(error.message || "PROSPECT_APPROVAL_SAVE_FAILED");
      return NextResponse.json({ approval: data, message: "Prospect approved for drafting." });
    }
    if (body.action === "SAVE_REVIEW") {
      const resolutionStatus = typeof body.resolutionStatus === "string" ? body.resolutionStatus.trim().toUpperCase() : "";
      const relationshipType = typeof body.relationshipType === "string" ? body.relationshipType.trim().toUpperCase() : "";
      const evidenceRefs = Array.isArray(body.evidenceRefs) ? body.evidenceRefs.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 50) : [];
      const outcome = typeof body.outcome === "string" ? body.outcome.trim().toUpperCase() : "";
      const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
      if (!resolutionStatus || !relationshipType || !idempotencyKey) throw new Error("PROSPECT_REVIEW_INPUT_INVALID");
      if (outcome && ["REJECT", "BLOCK", "DUPLICATE"].includes(outcome)) validateBlockDecision({ reasonCode: body.reasonCode, otherExplanation: body.otherExplanation, note: body.reviewNote ?? body.note });
      const { data, error } = await client.rpc("record_ai_prospect_review", {
        p_candidate_id: body.candidateId,
        p_resolution_status: resolutionStatus,
        p_canonical_organisation_id: typeof body.canonicalOrganisationId === "string" && body.canonicalOrganisationId ? body.canonicalOrganisationId : null,
        p_relationship_type: relationshipType,
        p_evidence_refs: evidenceRefs,
        p_operator_note: typeof body.operatorNote === "string" ? body.operatorNote.trim() || null : null,
        p_new_organisation: body.newOrganisation && typeof body.newOrganisation === "object" ? body.newOrganisation : null,
        p_next_action: typeof body.nextAction === "string" ? body.nextAction.trim() || null : null,
        p_outcome: outcome || null,
        p_reason_code: typeof body.reasonCode === "string" ? body.reasonCode.trim().toUpperCase() || null : null,
        p_other_explanation: typeof body.otherExplanation === "string" ? body.otherExplanation.trim() || null : null,
        p_review_note: typeof body.reviewNote === "string" ? body.reviewNote.trim() || null : typeof body.note === "string" ? body.note.trim() || null : null,
        p_idempotency_key: idempotencyKey,
        p_reviewer_id: access.userId,
      });
      if (error) throw new Error(error.message || "PROSPECT_REVIEW_SAVE_FAILED");
      return NextResponse.json({ review: data, message: outcome === "QUALIFY" ? "Review saved and prospect qualified." : outcome === "REJECT" ? "Review saved and prospect rejected." : outcome === "BLOCK" ? "Review saved and prospect blocked." : outcome === "DUPLICATE" ? "Review saved and prospect marked as a duplicate." : "Review saved." });
    }
    const action = body.action;
    if (!["BLOCK", "REOPEN", "QUALIFY", "REJECT", "MARK_DUPLICATE", "RESTORE", "SET_NEXT_ACTION"].includes(String(action))) throw new Error("PROSPECT_REVIEW_ACTION_INVALID");
    const needsReason = ["BLOCK", "REJECT", "MARK_DUPLICATE"].includes(String(action));
    const decision = needsReason ? validateBlockDecision({ reasonCode: body.reasonCode, otherExplanation: body.otherExplanation, note: body.note }) : { reasonCode: null, otherExplanation: null, note: typeof body.note === "string" ? body.note.trim() || null : null };
    if (decision.note && decision.note.length > 1000) throw new Error("PROSPECT_BLOCK_NOTE_TOO_LONG");
    const nextAction = typeof body.nextAction === "string" ? body.nextAction.trim() : null;
    if (action === "SET_NEXT_ACTION" && (!nextAction || nextAction.length > 500)) throw new Error("PROSPECT_NEXT_ACTION_INVALID");
    const actionName = action === "REOPEN" || action === "RESTORE" ? "RESTORE" : action ?? "";
    const { data, error } = await client.rpc("record_ai_prospect_inventory_action", {
      p_candidate_id: body.candidateId,
      p_action: actionName,
      p_reason_code: decision.reasonCode,
      p_other_explanation: decision.otherExplanation,
      p_note: decision.note,
      p_next_action: nextAction,
      p_reviewer_id: access.userId,
    });
    if (error) throw new Error(error.message || "PROSPECT_REVIEW_SAVE_FAILED");
    const messages: Record<string, string> = { QUALIFY: "Prospect qualified.", REJECT: "Prospect rejected.", BLOCK: "Prospect blocked.", MARK_DUPLICATE: "Prospect marked as a duplicate.", RESTORE: "Prospect restored to review.", SET_NEXT_ACTION: "Next action updated." };
    return NextResponse.json({ decision: data, message: messages[actionName] ?? "Prospect updated." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Prospect review decision could not be saved.";
    const code = message.includes("PROSPECT_") ? message.match(/PROSPECT_[A-Z_]+/)?.[0] ?? "PROSPECT_REVIEW_SAVE_FAILED" : "PROSPECT_REVIEW_SAVE_FAILED";
    const status = code.includes("REQUIRED") || code.includes("INVALID") || code.includes("TOO_LONG") || code.includes("EXPLANATION") || code.includes("ARCHIVE_ONLY") || code.includes("INPUT") || code.includes("STATUS") || code.includes("RELATIONSHIP") || code.includes("EVIDENCE") ? 400 : code.includes("NOT_FOUND") ? 404 : code.includes("ALREADY") || code.includes("NOT_BLOCKED") || code.includes("BLOCKED") || code.includes("GATE_FAILED") ? 409 : 502;
    return NextResponse.json({ code, message: code === "PROSPECT_REVIEW_SAVE_FAILED" ? "The review decision could not be saved." : message }, { status });
  }
}
