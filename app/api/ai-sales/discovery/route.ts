import { NextResponse } from "next/server";
import { canPersistCommercialMemory, discoverProspects, isFirstPartyCandidate, type DiscoveryFocus, type DiscoveryTerritory } from "../../../../src/ai-sales-team/discovery";
import { createServerSupabaseClient } from "../../../../src/lib/supabase-server";
import { FIRST_PARTY_SELF } from "../../../../src/ai-sales-team/first-party";

async function operatorClient() {
  const client = await createServerSupabaseClient();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return { client, error: NextResponse.json({ message: "Sign in is required." }, { status: 401 }) };
  const { data: member } = await client.from("revenue_members").select("member_role, active").eq("user_id", auth.user.id).maybeSingle();
  if (!member?.active) return { client, error: NextResponse.json({ message: "Active membership is required." }, { status: 403 }) };
  return { client, userId: auth.user.id, canRun: ["operator", "admin"].includes(member.member_role) };
}

export async function GET() {
  const state = await operatorClient();
  if (state.error) return state.error;
  const { data, error } = await state.client.from("ai_prospect_discovery_runs").select("*, ai_prospect_candidates(*)").order("created_at", { ascending: false }).limit(5);
  if (error) return NextResponse.json({ message: "Discovery persistence is not available until its migration is applied." }, { status: 503 });
  return NextResponse.json({ runs: data ?? [], canRun: state.canRun });
}

export async function POST(request: Request) {
  const state = await operatorClient();
  if (state.error) return state.error;
  if (!state.canRun) return NextResponse.json({ message: "Active operator access is required." }, { status: 403 });
  const body = await request.json() as { territory?: DiscoveryTerritory; focus?: DiscoveryFocus };
  if (!body.territory || !["ZA", "GB"].includes(body.territory) || !body.focus || !["ALL", "EGS", "TICKETING", "ECC"].includes(body.focus)) return NextResponse.json({ message: "A supported territory and focus are required." }, { status: 400 });
  const { data: run, error: runError } = await state.client.from("ai_prospect_discovery_runs").insert({ territory_code: body.territory, focus: body.focus, status: "RUNNING", created_by: state.userId }).select("id").single();
  if (runError || !run) return NextResponse.json({ message: "Discovery persistence is not available until its migration is applied." }, { status: 503 });
  try {
    const result = await discoverProspects({ territory: body.territory, focus: body.focus });
    const saved = [];
    for (const candidate of result.candidates) {
      const prior = await state.client.from("ai_prospect_candidates").select("id, account_id").eq("canonical_key", candidate.canonicalKey).order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (prior.error) throw prior.error;
      const accountName = candidate.organiserName || candidate.canonicalName;
      const firstPartySelf = isFirstPartyCandidate(candidate);
      let accountId = firstPartySelf ? null : prior.data?.account_id ?? null;
      const shouldCreateAccount = canPersistCommercialMemory(candidate);
      if (!accountId && shouldCreateAccount) {
        const existing = candidate.website
          ? await state.client.from("accounts").select("id, website").eq("website", candidate.website).limit(1).maybeSingle()
          : await state.client.from("accounts").select("id, website").eq("name", accountName).limit(1).maybeSingle();
        if (existing.error) throw existing.error;
        if (existing.data) accountId = existing.data.id;
        else {
          const { data: created, error } = await state.client.from("accounts").insert({ name: accountName, website: candidate.website, country_code: body.territory, source: "autonomous_discovery", metadata: { prospectIntelligence: candidate.prospectIntelligence, discoveryCandidate: true } }).select("id").single();
          if (error) throw error;
          accountId = created.id;
        }
      }
      if (accountId && !firstPartySelf && candidate.prospectIntelligence.accountCreationEligible) {
        const evidence = candidate.facts.map((item) => ({ account_id: accountId, evidence_type: item.sourceUrl ? "WEBSITE" : "OTHER", claim: item.claim, source_url: item.sourceUrl, source_title: item.sourceTitle, source_reference: item.sourceUrl ?? "autonomous-discovery", observed_at: new Date().toISOString(), evidence_kind: "FACT", qualitative_confidence: item.confidence, metadata: { discoveryRunId: run.id, origin: candidate.origin, sourceRoles: item.sourceRoles ?? ["DISCOVERY"], eventFreshness: item.eventFreshness ?? "UNKNOWN" } }));
        const existingEvidence = await state.client.from("research_evidence").select("claim, source_url").eq("account_id", accountId);
        if (existingEvidence.error) throw existingEvidence.error;
        const knownEvidence = new Set((existingEvidence.data ?? []).map((item) => `${item.claim}::${item.source_url ?? ""}`));
        const unseenEvidence = evidence.filter((item) => !knownEvidence.has(`${item.claim}::${item.source_url ?? ""}`));
        if (unseenEvidence.length) { const { error } = await state.client.from("research_evidence").insert(unseenEvidence); if (error) throw error; }
        const [product, territory, motion] = await Promise.all([
          state.client.from("products").select("id").eq("code", "event-suite").maybeSingle(),
          state.client.from("territories").select("id").eq("code", body.territory.toLowerCase() === "gb" ? "uk" : "za").maybeSingle(),
          state.client.from("sales_motions").select("id").eq("code", "direct").maybeSingle(),
        ]);
        if (product.data && territory.data && motion.data) {
          const values = { account_id: accountId, product_id: product.data.id, territory_id: territory.data.id, sales_motion_id: motion.data.id, commercial_program_id: null, stage: "identified", conversion_route: "UNDETERMINED", qualitative_confidence: "MEDIUM", route_reason: candidate.prospectIntelligence.recommendedNextAction, next_action: candidate.prospectIntelligence.recommendedNextAction, metadata: { autonomousDiscovery: true, discoveryRunId: run.id, prospectIntelligence: candidate.prospectIntelligence } };
          const existingOpportunity = await state.client.from("product_opportunities").select("id").eq("account_id", accountId).eq("product_id", product.data.id).maybeSingle();
          if (existingOpportunity.error) throw existingOpportunity.error;
          const query = existingOpportunity.data ? state.client.from("product_opportunities").update(values).eq("id", existingOpportunity.data.id) : state.client.from("product_opportunities").insert(values);
          const { error } = await query;
          if (error) throw error;
        }
      }
      const status = firstPartySelf ? "REJECTED" : prior.data ? "DUPLICATE" : candidate.status;
      const relationship = firstPartySelf ? "UNKNOWN" : candidate.relationship;
      const prospectIntelligence = { ...candidate.prospectIntelligence, firstPartyStatus: firstPartySelf ? FIRST_PARTY_SELF : candidate.prospectIntelligence.firstPartyStatus, enrichment: candidate.enrichment };
      const values = { discovery_run_id: run.id, canonical_key: candidate.canonicalKey, candidate_name: candidate.canonicalName, organiser_name: candidate.organiserName, website: candidate.website, territory_code: body.territory, origin: candidate.origin, status, account_id: accountId, relationship, facts: candidate.facts, inferences: candidate.inferences, unknowns: candidate.unknowns, prospect_intelligence: prospectIntelligence, source_urls: candidate.sourceUrls, dedupe_of_candidate_id: prior.data?.id ?? null, last_seen_at: new Date().toISOString() };
      const { data, error } = await state.client.from("ai_prospect_candidates").insert(values).select("*").single();
      if (error) throw error;
      saved.push(data);
    }
    const counts = { discovered: saved.length, qualified: saved.filter((item) => item.status === "QUALIFIED").length, reviewRequired: saved.filter((item) => item.status === "REVIEW_REQUIRED").length, blockedOrRejected: saved.filter((item) => item.status === "BLOCKED" || item.status === "REJECTED").length, duplicates: saved.filter((item) => item.status === "DUPLICATE").length, ...result.enrichment };
    await state.client.from("ai_prospect_discovery_runs").update({ status: "COMPLETED", provider: result.provider, model: result.model, summary: counts, completed_at: new Date().toISOString() }).eq("id", run.id);
    return NextResponse.json({ run: { id: run.id, territory_code: body.territory, focus: body.focus, status: "COMPLETED", summary: counts, ai_prospect_candidates: saved } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Autonomous discovery failed.";
    await state.client.from("ai_prospect_discovery_runs").update({ status: "FAILED", error_message: message, completed_at: new Date().toISOString() }).eq("id", run.id);
    return NextResponse.json({ message }, { status: message.startsWith("AI_RESEARCH_NOT_CONFIGURED") ? 503 : 502 });
  }
}
