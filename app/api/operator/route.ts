import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../src/lib/supabase-server";

async function readAccess(client: Awaited<ReturnType<typeof createServerSupabaseClient>>) {
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return { error: NextResponse.json({ message: "Sign in is required." }, { status: 401 }) };
  const { data: member, error } = await client.from("revenue_members").select("member_role, active").eq("user_id", auth.user.id).maybeSingle();
  if (error || !member?.active) return { error: NextResponse.json({ message: "Active membership is required." }, { status: 403 }) };
  return { access: String(member.member_role).toUpperCase() as "VIEWER" | "OPERATOR" | "ADMIN" };
}

export async function GET(request: Request) {
  const client = await createServerSupabaseClient();
  const access = await readAccess(client);
  if (access.error) return access.error;
  const url = new URL(request.url);
  const view = url.searchParams.get("view") ?? "overview";
  const runId = url.searchParams.get("runId");
  const candidateId = url.searchParams.get("candidateId");

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
  const hydrated = safeCandidates.map((candidate) => ({
    ...candidate,
    account: candidate.account_id ? accountById.get(candidate.account_id) ?? null : null,
    contacts: candidate.account_id ? contactsByAccount.get(candidate.account_id) ?? [] : [],
    evidence: candidate.account_id ? evidenceByAccount.get(candidate.account_id) ?? [] : [],
  }));
  const latestRunId = safeRuns[0]?.id ?? null;
  const selectedRun = runId ? safeRuns.find((run) => run.id === runId) ?? null : null;
  return NextResponse.json({ access: access.access, view, runs: safeRuns, candidates: hydrated, selectedRun, latestRunId });
}
