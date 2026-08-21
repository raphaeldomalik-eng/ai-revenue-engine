import { writeFile } from "node:fs/promises";
import { searchApolloBuyers, APOLLO_PRIMARY_ROLE_FAMILIES, type ApolloBuyerSearchResult } from "../src/ai-sales-team/apollo.ts";
import { searchCompaniesHouse, validateSelectedCompaniesHouseCompany, type CompaniesHouseCompanyEvidence } from "../src/ai-sales-team/companies-house.ts";
import { resolveGooglePlacesVenueComplex } from "../src/ai-sales-team/google-places.ts";
import { assessPhaseOneCandidate, type PhaseOneEvidence } from "../src/ai-sales-team/phase-one.ts";
import type { DiscoveryLane } from "../src/ai-sales-team/prospect-intelligence.ts";

type FrozenCase = {
  id: string;
  lane: DiscoveryLane;
  startingSignal: string;
  organisationName: string;
  tradingName: string | null;
  domain: string;
  officialOrganisationUrl: string;
  eventName: string | null;
  personName: string | null;
  personTitle: string | null;
  venueName: string | null;
  locality: string | null;
  roleFamilies: readonly string[];
  companySearchName: string;
  phaseOneEvidence: PhaseOneEvidence[];
};

// Frozen before provider calls. These are smaller/regional UK targets and official public source inputs,
// not model-generated discoveries. P3/P4 intentionally reuse the established Piece Hall regression source.
const FROZEN_CASES: readonly FrozenCase[] = [
  {
    id: "P1",
    lane: "EVENT_FIRST",
    startingSignal: "ArcTanGent Festival",
    organisationName: "ArcTanGent",
    tradingName: "ArcTanGent Festival",
    domain: "arctangent.co.uk",
    officialOrganisationUrl: "https://arctangent.co.uk",
    eventName: "ArcTanGent Festival",
    personName: null,
    personTitle: null,
    venueName: null,
    locality: "Bristol, United Kingdom",
    roleFamilies: APOLLO_PRIMARY_ROLE_FAMILIES,
    companySearchName: "ArcTanGent",
    phaseOneEvidence: [{ kind: "INDEPENDENT_ORGANISER", value: "Independent UK festival organiser", sourceUrl: "https://arctangent.co.uk", confidence: "HIGH" }],
  },
  {
    id: "P2",
    lane: "ORGANISATION_FIRST",
    startingSignal: "Farnham Maltings regional events programme",
    organisationName: "Farnham Maltings Association",
    tradingName: "Farnham Maltings",
    domain: "farnhammaltings.com",
    officialOrganisationUrl: "https://www.farnhammaltings.com",
    eventName: null,
    personName: null,
    personTitle: null,
    venueName: null,
    locality: "Farnham, United Kingdom",
    roleFamilies: APOLLO_PRIMARY_ROLE_FAMILIES,
    companySearchName: "Farnham Maltings Association",
    phaseOneEvidence: [{ kind: "REGIONAL_SCOPE", value: "Regional arts and events organisation", sourceUrl: "https://www.farnhammaltings.com", confidence: "HIGH" }],
  },
  {
    id: "P3",
    lane: "PERSON_FIRST",
    startingSignal: "Aaron Casserly Stewart",
    organisationName: "The Piece Hall Trust",
    tradingName: "The Piece Hall",
    domain: "piecehall.co.uk",
    officialOrganisationUrl: "https://www.thepiecehall.co.uk",
    eventName: null,
    personName: "Aaron Casserly Stewart",
    personTitle: "Programme & Event Director",
    venueName: null,
    locality: "Halifax, United Kingdom",
    roleFamilies: APOLLO_PRIMARY_ROLE_FAMILIES,
    companySearchName: "The Piece Hall Trust",
    phaseOneEvidence: [{ kind: "REGIONAL_SCOPE", value: "Regional venue programme", sourceUrl: "https://www.thepiecehall.co.uk", confidence: "HIGH" }],
  },
  {
    id: "P4",
    lane: "VENUE_FIRST",
    startingSignal: "The Piece Hall",
    organisationName: "The Piece Hall Trust",
    tradingName: "The Piece Hall",
    domain: "piecehall.co.uk",
    officialOrganisationUrl: "https://www.thepiecehall.co.uk",
    eventName: null,
    personName: null,
    personTitle: null,
    venueName: "The Piece Hall",
    locality: "Halifax, United Kingdom",
    roleFamilies: APOLLO_PRIMARY_ROLE_FAMILIES,
    companySearchName: "The Piece Hall Trust",
    phaseOneEvidence: [{ kind: "REGIONAL_SCOPE", value: "Regional venue", sourceUrl: "https://www.thepiecehall.co.uk", confidence: "HIGH" }],
  },
];

type Counts = { companiesHouse: { search: number; profile: number; officers: number }; googlePlaces: { textSearch: number; details: number }; apollo: { peopleSearch: number; enrichment: number }; openAi: number };
type SafeFailure = { category: string; httpStatus: number | null };

function keyPresent(name: string) { return Boolean(process.env[name]?.trim()); }
function emptyCounts(): Counts { return { companiesHouse: { search: 0, profile: 0, officers: 0 }, googlePlaces: { textSearch: 0, details: 0 }, apollo: { peopleSearch: 0, enrichment: 0 }, openAi: 0 }; }
function safeFailure(error: unknown): SafeFailure { const telemetry = error && typeof error === "object" && "telemetry" in error ? (error as { telemetry?: { errorCategory?: string | null; httpStatus?: number | null } }).telemetry : null; return { category: telemetry?.errorCategory ?? "PROVIDER_ERROR", httpStatus: telemetry?.httpStatus ?? null }; }
function countedFetch(counts: Counts, provider: "companiesHouse" | "googlePlaces" | "apollo") {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (provider === "companiesHouse") {
      if (url.includes("/search/companies")) counts.companiesHouse.search += 1;
      else if (url.includes("/company/") && !url.includes("/officers")) counts.companiesHouse.profile += 1;
      else if (url.includes("/officers")) counts.companiesHouse.officers += 1;
      if (counts.companiesHouse.search > 1 || counts.companiesHouse.profile > 1 || counts.companiesHouse.officers > 0) throw new Error("BOUNDED_COMPANIES_HOUSE_REQUEST_LIMIT");
    }
    if (provider === "googlePlaces") {
      if (url.includes(":searchText")) counts.googlePlaces.textSearch += 1;
      else if (url.includes("/places/")) counts.googlePlaces.details += 1;
      if (counts.googlePlaces.textSearch > 1 || counts.googlePlaces.details > 2) throw new Error("BOUNDED_GOOGLE_PLACES_REQUEST_LIMIT");
    }
    if (provider === "apollo") {
      counts.apollo.peopleSearch += 1;
      if (counts.apollo.peopleSearch > 1) throw new Error("BOUNDED_APOLLO_SEARCH_LIMIT");
    }
    return fetch(input, init);
  };
}
function sanitiseCompany(company: CompaniesHouseCompanyEvidence | null) { return company ? { legalCompanyName: company.legalCompanyName, companyStatus: company.companyStatus, companyType: company.companyType, sicCodes: company.sicCodes, accountsCategory: company.accountsCategory, registeredRegion: company.registeredRegion } : null; }
function sanitisePerson(person: ApolloBuyerSearchResult, rank: number) { return { fullName: person.fullName, title: person.title, currentEmployer: person.organisationName, employerDomain: person.organisationDomain, employerDomainClassification: person.employerDomainOutcome, employerDomainReason: person.employerDomainReason, buyerRoutingClassification: person.buyerRoutingClassification ?? "IRRELEVANT", buyerRoutingReason: person.buyerRoutingReason ?? "NO_BUYER_ROUTING_REASON", roleClassification: person.roleClassification, roleRankingScore: person.roleRankingScore ?? 0, deterministicRank: rank, status: person.status, humanSelectionRecommendation: person.status === "ACCEPTED" ? "REVIEW_REQUIRED_BEFORE_ANY_SELECTED_ENRICHMENT" : "DO_NOT_SELECT" }; }

async function runCase(item: FrozenCase) {
  const counts = emptyCounts();
  const assessment = assessPhaseOneCandidate({ lane: item.lane, territory: "GB", evidence: item.phaseOneEvidence });
  const stages: string[] = [];
  const identities = { event: item.eventName, organisation: { name: item.organisationName, domain: item.domain }, venue: item.venueName, venueOperator: null as string | null, person: item.personName ? { name: item.personName, title: item.personTitle } : null, legalCompany: null as ReturnType<typeof sanitiseCompany> };
  const result: Record<string, unknown> = { id: item.id, originatingLane: item.lane, startingSignal: item.startingSignal, canonicalOrganisationName: item.organisationName, canonicalDomain: item.domain, officialSourceUrls: [item.officialOrganisationUrl], providerSequence: [], identities, conflicts: [], phaseOne: { classification: assessment.classification, priorityScore: assessment.priorityScore, reason: assessment.reason, evidence: assessment.evidence }, lanePreserved: true, counts, openAiCalls: 0, apolloCandidates: [], contactResearchAttempted: false, outreachActions: 0, persistenceWrites: 0, plausibleEventSuiteBenefit: { value: true, reason: "The frozen signal is an active event, event organisation, professional event programme or venue context; proven pain is not required." } };
  if (item.lane === "VENUE_FIRST") {
    const google = await resolveGooglePlacesVenueComplex({ targetName: item.venueName!, targetWebsite: `https://${item.domain}`, locality: item.locality, lane: item.lane, targetType: "VENUE", limit: 3 }, { apiKey: process.env.GOOGLE_PLACES_API_KEY, mode: "details_selected", fetchImpl: countedFetch(counts, "googlePlaces") });
    (result.providerSequence as string[]).push("GOOGLE_PLACES");
    stages.push("GOOGLE_PLACES_TEXT_SEARCH", ...google.details.map(() => "GOOGLE_PLACES_SELECTED_DETAILS"));
    result.googlePlaces = { resolution: { status: google.resolution.status, canonicalVenueName: google.resolution.canonicalVenueName, officialWebsiteDomain: google.resolution.officialWebsiteDomain, groupingReason: google.resolution.groupingReason, groupingEvidence: google.resolution.groupingEvidence }, search: google.search.results.map((place) => ({ displayName: place.displayName, formattedAddress: place.formattedAddress, types: place.types, businessStatus: place.businessStatus, matchStatus: place.matchStatus, rejectionReasons: place.rejectionReasons, websiteDomain: place.websiteDomain })), details: google.details.map((place) => ({ displayName: place.displayName, formattedAddress: place.formattedAddress, types: place.types, businessStatus: place.businessStatus, matchStatus: place.matchStatus, websiteDomain: place.websiteDomain })) };
    if (google.resolution.status !== "PLACES_IDENTITY_SUFFICIENT") {
      result.identityDecision = "SAFE_UNRESOLVED";
      result.stages = stages;
      result.counts = counts;
      return result;
    }
  }
  const chOptions = { apiKey: process.env.COMPANIES_HOUSE_API_KEY, mode: "search_only" as const, fetchImpl: countedFetch(counts, "companiesHouse") };
  let search;
  try {
    search = await searchCompaniesHouse({ organisationName: item.companySearchName, tradingName: item.tradingName, territory: "GB", limit: 3 }, chOptions);
    (result.providerSequence as string[]).push("COMPANIES_HOUSE");
    stages.push("COMPANIES_HOUSE_SEARCH");
  } catch (error) {
    result.providerFailure = { provider: "COMPANIES_HOUSE", ...safeFailure(error) };
    result.counts = counts;
    return result;
  }
  result.companiesHouseSearch = { outcome: search.outcome, reason: search.reason, resultCount: search.companies.length };
  let profile = null;
  if (search.outcome === "REGISTRAR_CONFIRMED" && search.selectedCompany) {
    profile = await validateSelectedCompaniesHouseCompany({ company: search.selectedCompany, organisationName: item.companySearchName, tradingName: item.tradingName }, { ...chOptions, mode: "validate_selected" });
    stages.push("COMPANIES_HOUSE_PROFILE");
    result.companiesHouseProfile = { outcome: profile.outcome, reason: profile.reason, company: sanitiseCompany(profile.company) };
    identities.legalCompany = sanitiseCompany(profile.company);
  }
  if (profile?.outcome !== "REGISTRAR_CONFIRMED" || !profile.company) {
    result.identityDecision = "SAFE_UNRESOLVED";
    result.stages = stages;
    result.counts = counts;
    return result;
  }
  stages.push("PUBLIC_WEB_IDENTITY_AND_ACTIVITY", "EVENTSUITE_FIT");
  const apollo = await searchApolloBuyers({ organisationName: item.organisationName, organisationDomain: item.domain, discoveryLane: item.lane, roleFamilies: [...item.roleFamilies], limit: 5 }, { apiKey: process.env.APOLLO_API_KEY, mode: "search_only", fetchImpl: countedFetch(counts, "apollo") });
  (result.providerSequence as string[]).push("APOLLO");
  stages.push("APOLLO_PEOPLE_SEARCH");
  result.identityDecision = "REGISTRAR_CONFIRMED";
  result.commercialAdvancement = { advanced: true, reason: "Confirmed UK legal identity and frozen authoritative organisation/domain evidence passed the bounded commercial-research handoff." };
  result.apollo = { httpStatus: apollo.telemetry.httpStatus, resultCount: apollo.results.length, candidates: apollo.results.map((person, index) => sanitisePerson(person, index + 1)), creditCategory: apollo.telemetry.creditCategory };
  result.stages = stages;
  result.counts = counts;
  return result;
}

async function main() {
  const missing = ["COMPANIES_HOUSE_API_KEY", "GOOGLE_PLACES_API_KEY", "APOLLO_API_KEY"].filter((name) => !keyPresent(name));
  if (missing.length) throw new Error(`MISSING_REQUIRED_PROVIDER_KEY:${missing.join(",")}`);
  const cases = [];
  for (const item of FROZEN_CASES) cases.push(await runCase(item));
  const summary = { artifact: "live-phase-one-four-lane-v1", manifestFrozen: true, requestPolicy: { sequential: true, retries: 0, companiesHouse: { maxSearch: 1, maxProfile: 1, officers: 0 }, googlePlaces: { maxTextSearch: 1, maxDetails: 2 }, apollo: { maxPeopleSearch: 1, enrichment: 0 }, openAi: 0, persistenceWrites: 0, outreachActions: 0 }, keyPresence: { companiesHouse: true, googlePlaces: true, apollo: true }, cases, generatedAt: new Date().toISOString(), cost: { openAi: "USD 0; no model calls", apollo: "zero-credit search-only; provider billing not reported by adapter", googlePlaces: "provider billing not reported by adapter", companiesHouse: "provider billing not reported by adapter" } };
  await writeFile("artifacts/live-phase-one-four-lane-v1.json", `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "BOUNDED_LIVE_HARNESS_FAILED"); process.exitCode = 1; });
