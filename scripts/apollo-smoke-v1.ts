import { LIVE_MODEL_COMPARISON_CASES } from "./live-model-comparison-v1.ts";
import { ApolloProviderError, apolloAuthenticationHealth, apolloUsageStats, searchApolloBuyers } from "../src/ai-sales-team/apollo.ts";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function safeError(error: unknown) { return error instanceof ApolloProviderError ? { message: error.message, telemetry: error.telemetry } : { message: "Apollo smoke test failed safely.", telemetry: null }; }

export async function runApolloSmokeTest() {
  if (!process.env.APOLLO_API_KEY) throw new Error("APOLLO_API_KEY is required; load .env.local with node --use-system-ca --env-file=.env.local.");
  const frozen = LIVE_MODEL_COMPARISON_CASES.find((item) => item.id === "M01");
  if (!frozen) throw new Error("Frozen M01 case is required.");
  const mode = "search_only" as const;
  let health: unknown;
  let usage: unknown;
  let search: unknown = { attempted: false, reason: "AUTH_HEALTH_NOT_CONFIRMED" };
  try {
    health = await apolloAuthenticationHealth({ mode });
    try { usage = await apolloUsageStats({ mode }); } catch (error) { usage = { available: false, error: safeError(error) }; }
    search = await searchApolloBuyers({ organisationName: "Mash Media Group", organisationDomain: frozen.laneContext.organisationUrl!, discoveryLane: frozen.lane, roleFamilies: ["event leadership", "commercial leadership", "marketing or audience growth"], limit: 3 }, { mode });
  } catch (error) {
    const safe = safeError(error);
    return { smokeVersion: "apollo-v1", mode, caseId: frozen.id, health: health ?? safe, usage: usage ?? null, search: { attempted: true, error: safe }, noPeopleMatchCalled: true, noEmailOrPhoneRequested: true, noPersistenceOrOutreach: true };
  }
  const result = search as { results: Array<{ fullName: string | null; title: string | null; status: string; roleClassification: string | null; employerDomainOutcome: string; employerDomainReason: string; rejectionReason: string | null }>; telemetry: unknown };
  return { smokeVersion: "apollo-v1", mode, caseId: frozen.id, health: { ok: true }, usage: { available: true }, search: { resultCount: result.results.length, people: result.results.map((person) => ({ fullName: person.fullName, title: person.title, status: person.status, roleClassification: person.roleClassification, employerDomainOutcome: person.employerDomainOutcome, employerDomainReason: person.employerDomainReason, rejectionReason: person.rejectionReason })), telemetry: result.telemetry }, noPeopleMatchCalled: true, noEmailOrPhoneRequested: true, noPersistenceOrOutreach: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) runApolloSmokeTest().then((value) => console.log(JSON.stringify(value))).catch((error) => { console.log(JSON.stringify({ smokeVersion: "apollo-v1", error: safeError(error), noPeopleMatchCalled: true, noEmailOrPhoneRequested: true, noPersistenceOrOutreach: true })); process.exitCode = 1; });
