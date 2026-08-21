import { discoverProspects, type DiscoveryTerritory, type EvaluatedDiscoveryCandidate } from "../src/ai-sales-team/discovery.ts";
import { AGENT_PROMPT_VERSIONS } from "../src/ai-sales-team/agent-prompts.ts";
import { researchEligibleProspectContact, type ContactResearchTargetIdentity } from "../src/ai-sales-team/contact-research.ts";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Non-persisting live acceptance harness.
 *
 * This file deliberately imports only the direct research functions. It does
 * not import Next routes, Supabase clients, repositories, or outreach code.
 * It makes one bounded discovery call per frozen case, with no retries.
 */

type FrozenCase = { id: string; name: string; territory: DiscoveryTerritory; hint: string; blind: boolean; expected: string };

export const LIVE_ACCEPTANCE_CASES: FrozenCase[] = [
  { id: "C01", name: "Event Production Show", territory: "GB", hint: "Event Production Show / Mash Media", blind: false, expected: "Mash Media identity; operational complexity may be relevant." },
  { id: "C02", name: "eCommerce Expo", territory: "GB", hint: "eCommerce Expo / CloserStill Media", blind: false, expected: "CloserStill Media, not historical UPTECH." },
  { id: "C03", name: "Mzansi Roar", territory: "ZA", hint: "Mzansi Roar Festival / DSAC procurement", blind: false, expected: "DSAC may be commissioner; do not fabricate promoter." },
  { id: "C04", name: "ArcTanGent", territory: "GB", hint: "ArcTanGent Festival", blind: false, expected: "Correct operator relationship and target-owned route only." },
  { id: "C05", name: "The Piece Hall", territory: "GB", hint: "The Piece Hall programme and events", blind: false, expected: "Programme/event buyer may be identified only from official evidence." },
  { id: "C06", name: "Comic Con Africa", territory: "ZA", hint: "Comic Con Africa / RX Africa", blind: false, expected: "Event, organiser, venue and ticketing provider separated." },
  { id: "C07", name: "London Packaging Week", territory: "GB", hint: "London Packaging Week / Easyfairs", blind: false, expected: "Easyfairs tooling is counter-evidence to an invented ECC problem." },
  { id: "C08", name: "KragDag", territory: "ZA", hint: "KragDag Ekspo / Tixsa", blind: false, expected: "KragDag target separated from Tixsa discovery source." },
  { id: "C09", name: "Connected Britain", territory: "GB", hint: "Connected Britain conference organiser", blind: false, expected: "Organisation identity resolved separately from event and venue evidence." },
  { id: "C10", name: "Tixsa/TicketsZA provider-source safety", territory: "ZA", hint: "Tixsa or TicketsZA ticketing provider", blind: false, expected: "Provider remains provider/discovery source, not organiser prospect." },
  { id: "C11", name: "National Arts Festival", territory: "ZA", hint: "National Arts Festival 2026 Makhanda", blind: true, expected: "Blind ZA signal selected from current public discovery evidence." },
  { id: "C12", name: "British Academy Ideas Festival", territory: "GB", hint: "British Academy Ideas Festival 2026", blind: true, expected: "Blind GB signal selected from current public discovery evidence." },
];

export const LIVE_ACCEPTANCE_SCORING = [
  "discovery-source classification", "primary commercial identity correctness", "event/organisation/venue/provider separation", "safe-unresolved behaviour", "related-organisation preservation", "product-specific commercial evidence", "commercial counter-evidence and existing-system recognition", "buyer-role relevance", "named-buyer quality", "target-contact ownership provenance", "organisation-email quality", "named-buyer-email quality", "overall commercial usefulness",
] as const;

function identityFor(candidate: EvaluatedDiscoveryCandidate): ContactResearchTargetIdentity {
  const resolution = candidate.organisationResolution;
  return {
    accountName: resolution?.canonicalOrganisationName ?? candidate.organiserName ?? candidate.canonicalName,
    accountWebsite: resolution?.officialWebsite ?? candidate.website,
    candidateName: candidate.canonicalName,
    candidateWebsite: candidate.website,
    authoritativeUrls: [resolution?.officialWebsite, candidate.website, ...(resolution?.evidence ?? []).map((item) => item.sourceUrl)].filter((item): item is string => Boolean(item)),
    relatedOrganisations: resolution?.relatedOrganisations ?? [],
  };
}

function selectCandidate(candidates: EvaluatedDiscoveryCandidate[], frozen: FrozenCase) {
  const terms = frozen.hint.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 3);
  return candidates.find((candidate) => terms.some((term) => `${candidate.canonicalName} ${candidate.organiserName ?? ""}`.toLowerCase().includes(term))) ?? candidates[0] ?? null;
}

function publicCase(candidate: EvaluatedDiscoveryCandidate | null, contact: unknown, error?: string) {
  if (!candidate) return { error: error ?? "No candidate returned." };
  const resolution = candidate.organisationResolution;
  const facts = candidate.facts.map((item) => ({ claim: item.claim, sourceUrl: item.sourceUrl, sourceRoles: item.sourceRoles, confidence: item.confidence }));
  const contactResult = contact && typeof contact === "object" && "researched" in contact ? (contact as { researched?: { result?: unknown; model?: string } }).researched : null;
  return {
    candidate: { name: candidate.canonicalName, organiserName: candidate.organiserName, website: candidate.website, origin: candidate.origin, relationship: candidate.relationship, status: candidate.status, sourceUrls: candidate.sourceUrls, siteClassifications: candidate.siteClassifications },
    identity: { resolution, relatedOrganisations: resolution?.relatedOrganisations ?? [] },
    commercial: { intelligence: candidate.prospectIntelligence, commercialEvidence: candidate.commercialEvidence },
    evidence: facts,
    contact: contactResult?.result ?? contact,
    model: contactResult?.model,
    promptVersions: AGENT_PROMPT_VERSIONS,
  };
}

function contactInput(candidate: EvaluatedDiscoveryCandidate) {
  const identity = identityFor(candidate);
  return {
    candidate: { status: candidate.status, relationship: candidate.relationship, account_id: null, candidate_name: candidate.canonicalName, organiser_name: candidate.organiserName, website: candidate.website, prospect_intelligence: { ...candidate.prospectIntelligence, organisationResolution: candidate.organisationResolution } },
    identity,
    researchInput: { accountName: identity.accountName ?? candidate.canonicalName, website: identity.accountWebsite ?? null, eventEvidence: candidate.facts.map((item) => item.claim).slice(0, 8), likelyBuyerRoles: candidate.prospectIntelligence.buyerProblemOwner.likelyRoles, targetIdentity: identity },
  } as const;
}

export async function runLiveAcceptance() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required; load the repository .env.local with node --env-file=.env.local.");
  if (LIVE_ACCEPTANCE_CASES.length !== 12) throw new Error("Live acceptance must remain exactly 12 cases.");
  const results: Array<Record<string, unknown>> = [];
  let discoveryCalls = 0;
  let contactCalls = 0;
  for (const frozen of LIVE_ACCEPTANCE_CASES) {
    discoveryCalls += 1;
    try {
      const discovered = await discoverProspects({ territory: frozen.territory, focus: "ALL", caseHint: frozen.hint });
      const candidate = selectCandidate(discovered.candidates, frozen);
      let contact: unknown = { blocked: true, reason: "No candidate selected." };
      if (candidate) {
        const input = contactInput(candidate);
        const eligible = await researchEligibleProspectContact(input);
        contact = eligible;
        if (!eligible.blocked) contactCalls += 1;
      }
      results.push({ ...frozen, callStatus: "COMPLETED", discovery: { provider: discovered.provider, model: discovered.model, enrichment: discovered.enrichment }, output: publicCase(candidate, contact) });
    } catch (error) {
      results.push({ ...frozen, callStatus: "FAILED", failure: error instanceof Error ? error.message : String(error) });
    }
  }
  return { caseCount: results.length, discoveryCalls, contactCalls, retryCount: 0, model: process.env.OPENAI_MODEL || "gpt-4.1-mini", promptVersions: AGENT_PROMPT_VERSIONS, scoringCriteria: LIVE_ACCEPTANCE_SCORING, persistence: { imported: false, writes: false, routes: false, outreach: false }, cases: results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runLiveAcceptance().then((value) => console.log(JSON.stringify(value))).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
