import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { passwordlessSignInOptions, resolveApplicationOrigin } from "../src/lib/auth/otp.ts";
import { canMutateCommercialData, revenueAccessState } from "../src/lib/auth/access.ts";
import { leadIntelligenceFixtures } from "../src/lead-intelligence/fixtures.ts";
import { commercialProgramLookup, mapAccountProfile, mapProductOpportunity, mapResearchEvidence } from "../src/persistence/revenue-repository.ts";

const byName = (name: string) => leadIntelligenceFixtures.find((fixture) => fixture.name === name)!;
const migrationVersion = "20260819000001";
const migration = readFileSync(new URL(`../supabase/migrations/${migrationVersion}_secure_persistence_foundation.sql`, import.meta.url), "utf8");

test("passwordless sign-in never creates an arbitrary user", () => {
  const options = passwordlessSignInOptions("https://example.test");
  assert.equal(options.shouldCreateUser, false);
  assert.equal(options.emailRedirectTo, "https://example.test/auth/callback");
});

test("browser auth client uses PKCE and callback exchanges only a query code", () => {
  const browserClient = readFileSync(new URL("../src/lib/supabase.ts", import.meta.url), "utf8");
  const callback = readFileSync(new URL("../app/auth/callback/route.ts", import.meta.url), "utf8");
  assert.match(browserClient, /flowType:\s*["']pkce["']/);
  assert.match(browserClient, /createBrowserClient/);
  assert.match(callback, /searchParams\.get\(["']code["']\)/);
  assert.match(callback, /exchangeCodeForSession\(code\)/);
  assert.doesNotMatch(callback, /access_token|refresh_token/);

  const serverClient = readFileSync(new URL("../src/lib/supabase-server.ts", import.meta.url), "utf8");
  assert.match(serverClient, /createServerClient/);
  assert.match(serverClient, /getAll\(\)/);
  assert.match(serverClient, /setAll\(cookiesToSet\)/);
});

test("passwordless redirect origin is environment-aware", () => {
  assert.equal(resolveApplicationOrigin("http://localhost:3000", {}), "http://localhost:3000");
  assert.equal(resolveApplicationOrigin("http://localhost:3000", { vercelUrl: "ai-revenue-engine-preview-event-suite-team.vercel.app" }), "https://ai-revenue-engine-preview-event-suite-team.vercel.app");
  assert.equal(resolveApplicationOrigin("http://localhost:3000", { siteUrl: "https://ai-revenue-engine-pearl.vercel.app/" }), "https://ai-revenue-engine-pearl.vercel.app");
  assert.equal(passwordlessSignInOptions("https://ai-revenue-engine-preview-event-suite-team.vercel.app").emailRedirectTo, "https://ai-revenue-engine-preview-event-suite-team.vercel.app/auth/callback");
});

test("application access states separate authentication from active internal membership", () => {
  assert.equal(revenueAccessState(null, false), "ANON");
  assert.equal(revenueAccessState(null, true), "NON_MEMBER");
  assert.equal(revenueAccessState({ active: false, member_role: "operator" }, true), "NON_MEMBER");
  assert.equal(revenueAccessState({ active: true, member_role: "viewer" }, true), "VIEWER");
  assert.equal(canMutateCommercialData("VIEWER"), false);
  assert.equal(canMutateCommercialData("OPERATOR"), true);
  assert.equal(canMutateCommercialData("ADMIN"), true);
});

test("account mapping preserves unknowns as null and qualitative facts in metadata", () => {
  const mapped = mapAccountProfile({ organisationName: "Unknown Organisation", country: "Unknown", organisationType: "UNKNOWN", sourceEvidenceIds: [] });
  assert.equal(mapped.country_code, null);
  assert.equal(mapped.organisation_type, null);
  assert.equal(mapped.metadata.eventFrequency, "UNKNOWN");
  assert.equal(mapped.metadata.estimatedEventsPerYear, null);
});

test("research evidence preserves FACT and INFERENCE without numeric confidence", () => {
  const base = { id: "evidence-1", sourceType: "DOCUMENT" as const, sourceReference: "reference:1", title: "Document", observedFact: "Observed claim", observedAt: "2026-08-18", confidence: "MEDIUM" as const, kind: "FACT" as const };
  const fact = mapResearchEvidence("account-id", base);
  const inference = mapResearchEvidence("account-id", { ...base, id: "evidence-2", kind: "INFERENCE" });
  assert.equal(fact.evidence_kind, "FACT");
  assert.equal(inference.evidence_kind, "INFERENCE");
  assert.equal(fact.qualitative_confidence, "MEDIUM");
  assert.equal("numeric_confidence" in fact, false);
});

test("unresolved Direct route persists context without a fake commercial program", () => {
  const school = byName("South African school").assessment.recommendations[0];
  const lookup = commercialProgramLookup(school);
  const mapped = mapProductOpportunity("account-id", school, { productId: "product-id", territoryId: "territory-id", salesMotionId: "motion-id", commercialProgramId: null });
  assert.equal(lookup.productCode, "event-suite");
  assert.equal(lookup.territoryCode, "za");
  assert.equal(lookup.salesMotionCode, "direct");
  assert.equal(lookup.conversionGoal, null);
  assert.equal(mapped.commercial_program_id, null);
  assert.equal(mapped.conversion_route, "UNDETERMINED");
  assert.equal(mapped.metadata.pricingStatus, "DEFERRED");
  assert.equal("numericDiscount" in mapped.metadata, false);
});

test("incumbent Ticketing and LNO program lookup survive persistence mapping", () => {
  const promoter = byName("UK promoter with existing Ticketing").assessment.recommendations[0];
  const lno = byName("South African event services company").assessment.recommendations[0];
  const promoterMapped = mapProductOpportunity("account-id", promoter, { productId: "product-id", territoryId: "territory-id", salesMotionId: "motion-id", commercialProgramId: null });
  assert.equal(promoterMapped.metadata.commercialSignals.includes("USES_EXISTING_TICKETING_PLATFORM"), true);
  assert.deepEqual(commercialProgramLookup(lno), { productCode: "event-suite", territoryCode: "za", salesMotionCode: "lno", conversionGoal: "business_opportunity_enquiry" });
});

test("migration encodes internal-only membership, least-privilege grants, and route semantics", () => {
  assert.equal(migrationVersion > "20260818210534", true, "the migration must follow the live foundation migration history");
  assert.match(migration, /create table if not exists public\.revenue_members/i);
  assert.match(migration, /Internal AI Revenue Engine company users only/i);
  assert.match(migration, /revoke all on table public\.revenue_members from anon, authenticated/i);
  assert.match(migration, /grant select on table public\.revenue_members to authenticated/i);
  assert.equal(/grant (?:insert|update|delete).*revenue_members/i.test(migration), false);
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = pg_catalog/i);
  assert.match(migration, /alter column commercial_program_id drop not null/i);
  assert.match(migration, /rename column slug to code/i);
  assert.match(migration, /update public\.territories set code = lower\(code\)/i);
  assert.match(migration, /'UNDETERMINED'/i);
  assert.match(migration, /evidence_kind[\s\S]*\('FACT', 'INFERENCE'\)/i);
  assert.equal(/service_role/i.test(migration), false);
});

test("Lead Intelligence uses persistent repository workflow and keeps viewers read-only", () => {
  const view = readFileSync(new URL("../app/lead-intelligence-view.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(view, /leadIntelligenceFixtures/);
  assert.match(view, /listAccounts/);
  assert.match(view, /saveProductOpportunity/);
  assert.match(view, /opportunityId/);
  assert.match(view, /canMutateCommercialData/);
  assert.equal(canMutateCommercialData("VIEWER"), false);
});
