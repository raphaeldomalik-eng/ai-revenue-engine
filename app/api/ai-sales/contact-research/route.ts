import { NextResponse } from "next/server";
import { contactPersistenceTargets, researchEligibleProspectContact } from "../../../../src/ai-sales-team/contact-research";
import { createServerSupabaseClient } from "../../../../src/lib/supabase-server";
import { AGENT_PROMPT_VERSIONS } from "../../../../src/ai-sales-team/agent-prompts";
import { contactResearchProductionEnabled } from "../../../../src/lib/server-production-activation";

async function operatorClient() {
  const client = await createServerSupabaseClient();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return { client, error: NextResponse.json({ message: "Sign in is required." }, { status: 401 }) };
  const { data: member } = await client.from("revenue_members").select("member_role, active").eq("user_id", auth.user.id).maybeSingle();
  if (!member?.active) return { client, error: NextResponse.json({ message: "Active membership is required." }, { status: 403 }) };
  if (!["operator", "admin"].includes(member.member_role)) return { client, error: NextResponse.json({ message: "Active operator access is required." }, { status: 403 }) };
  return { client };
}

export async function POST(request: Request) {
  if (!contactResearchProductionEnabled()) return NextResponse.json({ code: "PILOT_NOT_ENABLED", message: "Contact research production pilot is not enabled." }, { status: 503 });
  const state = await operatorClient();
  if (state.error) return state.error;
  const body = await request.json() as { candidateId?: string };
  if (!body.candidateId) return NextResponse.json({ message: "A discovery candidate is required." }, { status: 400 });
  const { data: candidate, error } = await state.client.from("ai_prospect_candidates").select("id, status, relationship, account_id, candidate_name, organiser_name, website, facts, prospect_intelligence").eq("id", body.candidateId).maybeSingle();
  if (error || !candidate) return NextResponse.json({ message: "Discovery candidate not found." }, { status: 404 });
  const { data: account, error: accountError } = candidate.account_id
    ? await state.client.from("accounts").select("name, website").eq("id", candidate.account_id).maybeSingle()
    : { data: null, error: null };
  if (accountError) return NextResponse.json({ message: "The prospect account could not be verified." }, { status: 502 });

  try {
    const intelligence = candidate.prospect_intelligence && typeof candidate.prospect_intelligence === "object" ? candidate.prospect_intelligence as { buyerProblemOwner?: { likelyRoles?: string[] }; organisationResolution?: { officialWebsite?: string | null; relatedOrganisations?: Array<{ name: string; relationship: string; website?: string | null }> } } : {};
    const facts = Array.isArray(candidate.facts) ? candidate.facts as Array<{ claim?: string }> : [];
    const targetIdentity = { accountName: account?.name, accountWebsite: account?.website, candidateName: candidate.organiser_name || candidate.candidate_name, candidateWebsite: candidate.website, authoritativeUrls: [account?.website, candidate.website, intelligence.organisationResolution?.officialWebsite].filter((item): item is string => Boolean(item)), relatedOrganisations: intelligence.organisationResolution?.relatedOrganisations ?? [] };
    const outcome = await researchEligibleProspectContact({
      candidate,
      identity: targetIdentity,
      researchInput: {
        accountName: account?.name || candidate.organiser_name || candidate.candidate_name,
        website: account?.website || candidate.website,
        eventEvidence: facts.map((fact) => fact.claim).filter((claim): claim is string => typeof claim === "string").slice(0, 6),
        likelyBuyerRoles: intelligence.buyerProblemOwner?.likelyRoles ?? [],
        targetIdentity,
      },
    });
    if (outcome.blocked) {
      const message = outcome.reason === "FIRST_PARTY_SELF" ? "FIRST_PARTY_SELF — EventSuite first-party identity is not eligible for Contact Discovery." : "Only an active, event-connected, resolved commercial prospect may receive public contact research.";
      return NextResponse.json({ code: outcome.reason, message }, { status: 409 });
    }
    const researched = outcome.researched;
    const targets = candidate.account_id ? contactPersistenceTargets(researched.result) : [];
    const contactIds: string[] = [];
    for (const target of targets) {
      const existing = target.fullName
        ? await state.client.from("contacts").select("id").eq("account_id", candidate.account_id).eq("full_name", target.fullName).maybeSingle()
        : target.email
          ? await state.client.from("contacts").select("id").eq("account_id", candidate.account_id).eq("email", target.email).maybeSingle()
          : target.phone
            ? await state.client.from("contacts").select("id").eq("account_id", candidate.account_id).eq("phone", target.phone).maybeSingle()
            : await state.client.from("contacts").select("id").eq("account_id", candidate.account_id).contains("metadata", { contactUrl: target.contactUrl }).maybeSingle();
      if (existing.error) throw existing.error;
      const values = {
        account_id: candidate.account_id,
        full_name: target.fullName,
        role_title: target.roleTitle,
        email: target.email,
        phone: target.phone,
        linkedin_url: target.linkedinUrl,
        decision_role: target.kind === "NAMED" ? researched.result.likelyBuyerRole : "Organisation contact route",
        verification_status: "VERIFIED",
        source: "prospect_contact_discovery",
        metadata: { contactResearch: true, sourceUrl: target.sourceUrl, sourceTitle: target.sourceTitle, publicEvidence: target.evidence, confidence: target.confidence, contactUrl: target.contactUrl, provenance: target.provenance },
      };
      const query = existing.data ? state.client.from("contacts").update(values).eq("id", existing.data.id) : state.client.from("contacts").insert(values).select("id").single();
      const saved = await query;
      if (saved.error) throw saved.error;
      const id = existing.data?.id ?? saved.data?.id;
      if (id) contactIds.push(id);
    }

    const directFacts = [...researched.result.facts, ...targets.map((target) => ({ claim: target.evidence, sourceUrl: target.sourceUrl, sourceTitle: target.sourceTitle, kind: "FACT" as const, confidence: target.confidence }))];
    if (candidate.account_id) {
      const { data: existingEvidence, error: evidenceReadError } = await state.client.from("research_evidence").select("claim, source_url").eq("account_id", candidate.account_id);
      if (evidenceReadError) throw evidenceReadError;
      const known = new Set((existingEvidence ?? []).map((item) => `${item.claim}::${item.source_url ?? ""}`));
      const unseen = directFacts.filter((fact) => fact.sourceUrl && !known.has(`${fact.claim}::${fact.sourceUrl}`)).map((fact) => ({ account_id: candidate.account_id, evidence_type: "WEBSITE", claim: fact.claim, source_url: fact.sourceUrl, source_title: fact.sourceTitle, source_reference: fact.sourceUrl, observed_at: new Date().toISOString(), evidence_kind: "FACT", qualitative_confidence: fact.confidence, metadata: { prospectContactDiscovery: true, discoveryCandidateId: candidate.id } }));
      if (unseen.length) {
        const { error: evidenceWriteError } = await state.client.from("research_evidence").insert(unseen);
        if (evidenceWriteError) throw evidenceWriteError;
      }
    }

    const snapshot = { status: researched.result.status, researchStatus: researched.result.status, likelyBuyerRole: researched.result.likelyBuyerRole, buyerRoleRationale: researched.result.buyerRoleRationale, buyerIdentified: researched.result.buyerIdentified, emailReady: researched.result.emailReady, targetProvenance: researched.result.targetProvenance, rejectedThirdPartyContacts: researched.result.rejectedThirdPartyContacts, contacts: researched.result.namedContact || researched.result.organisationRoute ? { namedContact: researched.result.namedContact, organisationRoute: researched.result.organisationRoute } : null, contactIds, sourceUrls: [...new Set(directFacts.map((fact) => fact.sourceUrl).filter(Boolean))], unknowns: researched.result.unknowns, researchedAt: new Date().toISOString(), provider: researched.provider, model: researched.model, promptVersion: AGENT_PROMPT_VERSIONS.buyerContactResearcher };
    const { data: savedCandidate, error: candidateWriteError } = await state.client.from("ai_prospect_candidates").update({ contact_research: snapshot }).eq("id", candidate.id).select("*").single();
    if (candidateWriteError) throw candidateWriteError;
    return NextResponse.json({ candidate: savedCandidate, contactResearch: { status: researched.result.status, likelyBuyerRole: researched.result.likelyBuyerRole, namedContact: researched.result.namedContact, organisationRoute: researched.result.organisationRoute } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string" ? cause.message : "Public contact research failed.";
    console.error("Prospect contact research failed", { candidateId: candidate.id, message });
    return NextResponse.json({ message }, { status: message.startsWith("AI_RESEARCH_NOT_CONFIGURED") ? 503 : 502 });
  }
}
