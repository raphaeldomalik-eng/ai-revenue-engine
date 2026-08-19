import { NextResponse } from "next/server";
import { researchCompany } from "../../../../src/ai-sales-team/research";
import { createServerSupabaseClient } from "../../../../src/lib/supabase-server";

export async function GET() {
  const client = await createServerSupabaseClient();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return NextResponse.json({ message: "Sign in is required." }, { status: 401 });
  const { data: member } = await client.from("revenue_members").select("member_role, active").eq("user_id", auth.user.id).maybeSingle();
  if (!member?.active) return NextResponse.json({ message: "Active membership is required." }, { status: 403 });
  const { data, error } = await client.from("ai_sales_briefs").select("*").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ message: "AI Sales Team persistence is not available until its migration is applied." }, { status: 503 });
  return NextResponse.json({ briefs: data ?? [] });
}

export async function POST(request: Request) {
  const client = await createServerSupabaseClient();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return NextResponse.json({ message: "Sign in is required." }, { status: 401 });
  const { data: member } = await client.from("revenue_members").select("member_role, active").eq("user_id", auth.user.id).maybeSingle();
  if (!member?.active || !["operator", "admin"].includes(member.member_role)) return NextResponse.json({ message: "Active operator access is required." }, { status: 403 });
  const body = await request.json() as { companyName?: string; website?: string };
  const companyName = body.companyName?.trim();
  if (!companyName) return NextResponse.json({ message: "Company name is required." }, { status: 400 });
  const { data: run, error: runError } = await client.from("ai_research_runs").insert({ requested_name: companyName, requested_website: body.website?.trim() || null, status: "RUNNING", created_by: auth.user.id }).select("id").single();
  if (runError) return NextResponse.json({ message: "AI Sales Team persistence is not available until its migration is applied." }, { status: 503 });
  try {
    const result = await researchCompany({ companyName, website: body.website });
    const brief = result.brief;
    const website = body.website?.trim() || null;
    const existing = await client.from("accounts").select("id, website").eq("name", companyName);
    if (existing.error) throw existing.error;
    const existingAccount = (existing.data ?? []).find((row) => (row.website ?? null) === website);
    const accountQuery = existingAccount
      ? client.from("accounts").update({ website, country_code: brief.territory.code === "UNKNOWN" ? null : brief.territory.code, source: "ai_sales_team", metadata: { aiSalesBrief: true, fit: brief.qualification.fit, lastResearchedDate: new Date().toISOString() } }).eq("id", existingAccount.id).select("id").single()
      : client.from("accounts").insert({ name: companyName, website, country_code: brief.territory.code === "UNKNOWN" ? null : brief.territory.code, source: "ai_sales_team", metadata: { aiSalesBrief: true, fit: brief.qualification.fit, lastResearchedDate: new Date().toISOString() } }).select("id").single();
    const { data: account, error: accountError } = await accountQuery;
    if (accountError) throw accountError;
    const evidence = [...brief.facts, ...brief.inferences].filter((item) => item.claim.trim()).map((item) => ({ account_id: account.id, evidence_type: item.sourceUrl ? "WEBSITE" : "OTHER", claim: item.claim, source_url: item.sourceUrl, source_title: item.sourceTitle, source_reference: item.sourceUrl ?? "ai-sales-team", observed_at: new Date().toISOString(), evidence_kind: item.kind, qualitative_confidence: item.confidence, metadata: { provider: result.provider, model: result.model } }));
    if (evidence.length) { const { error } = await client.from("research_evidence").insert(evidence); if (error) throw error; }
    const people = brief.people.filter((person) => person.name.trim());
    for (const person of people) {
      const existingPerson = await client.from("contacts").select("id").eq("account_id", account.id).eq("full_name", person.name).maybeSingle();
      if (existingPerson.error) throw existingPerson.error;
      const values = { account_id: account.id, full_name: person.name, role_title: person.role, verification_status: person.kind === "FACT" ? "UNVERIFIED" : "UNKNOWN", source: "ai_sales_team", metadata: { sourceUrl: person.sourceUrl, evidenceKind: person.kind, confidence: person.confidence } };
      const contactQuery = existingPerson.data ? client.from("contacts").update(values).eq("id", existingPerson.data.id) : client.from("contacts").insert(values);
      const { error } = await contactQuery;
      if (error) throw error;
    }
    let opportunityId: string | null = null;
    if (brief.territory.code !== "UNKNOWN" && brief.eventSuite.salesMotion !== "UNKNOWN") {
      const [product, territory, motion] = await Promise.all([
        client.from("products").select("id").eq("code", "event-suite").maybeSingle(),
        client.from("territories").select("id").eq("code", brief.territory.code.toLowerCase() === "gb" ? "uk" : brief.territory.code.toLowerCase()).maybeSingle(),
        client.from("sales_motions").select("id").eq("code", brief.eventSuite.salesMotion.toLowerCase() === "both" ? "direct" : brief.eventSuite.salesMotion.toLowerCase()).maybeSingle(),
      ]);
      if (product.data && territory.data && motion.data) {
        const values = { account_id: account.id, product_id: product.data.id, territory_id: territory.data.id, sales_motion_id: motion.data.id, commercial_program_id: null, stage: "identified", conversion_route: brief.eventSuite.conversionRoute, qualitative_confidence: brief.qualification.fit === "UNKNOWN" ? null : "MEDIUM", route_reason: brief.eventSuite.rationale, next_action: brief.nextBestAction.action, metadata: { aiSalesTeam: true, pains: brief.pains, useCases: brief.useCases, signals: brief.signals } };
        const existingOpportunity = await client.from("product_opportunities").select("id").eq("account_id", account.id).eq("product_id", product.data.id).maybeSingle();
        if (existingOpportunity.error) throw existingOpportunity.error;
        const opportunityQuery = existingOpportunity.data ? client.from("product_opportunities").update(values).eq("id", existingOpportunity.data.id).select("id").single() : client.from("product_opportunities").insert(values).select("id").single();
        const savedOpportunity = await opportunityQuery;
        if (savedOpportunity.error) throw savedOpportunity.error;
        opportunityId = savedOpportunity.data.id;
      }
    }
    const { error: activityError } = await client.from("activities").insert({ account_id: account.id, opportunity_id: opportunityId, activity_type: "AI_RESEARCH_NEXT_ACTION", summary: brief.nextBestAction.action, metadata: { reason: brief.nextBestAction.reason, owner: brief.nextBestAction.owner } });
    if (activityError) throw activityError;
    const { data: savedBrief, error: briefError } = await client.from("ai_sales_briefs").insert({ account_id: account.id, research_run_id: run.id, company_summary: brief.companySummary, why_it_matters: brief.whyItMatters, territory: brief.territory, qualification: brief.qualification, people: brief.people, facts: brief.facts, inferences: brief.inferences, pains: brief.pains, use_cases: brief.useCases, signals: brief.signals, eventsuite_opportunity: brief.eventSuite, account_strategy: brief.accountStrategy, next_best_action: brief.nextBestAction, unknowns: brief.unknowns }).select("*").single();
    if (briefError) throw briefError;
    await client.from("ai_research_runs").update({ status: "COMPLETED", provider: result.provider, model: result.model, result: brief, completed_at: new Date().toISOString(), account_id: account.id }).eq("id", run.id);
    return NextResponse.json({ accountId: account.id, brief: savedBrief });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI research failed.";
    await client.from("ai_research_runs").update({ status: "FAILED", error_message: message, completed_at: new Date().toISOString() }).eq("id", run.id);
    return NextResponse.json({ code: message.startsWith("AI_RESEARCH_NOT_CONFIGURED") ? "AI_RESEARCH_NOT_CONFIGURED" : "AI_RESEARCH_FAILED", message }, { status: message.startsWith("AI_RESEARCH_NOT_CONFIGURED") ? 503 : 502 });
  }
}
