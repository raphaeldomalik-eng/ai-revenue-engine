import assert from "node:assert/strict";
import test from "node:test";
import { getCompaniesHouseOfficers, resolveCompaniesHouseMode, searchCompaniesHouse, selectCompaniesHouseCompany, validateSelectedCompaniesHouseCompany, type CompaniesHouseCompanyEvidence } from "../src/ai-sales-team/companies-house.ts";
import { enrichDiscoveryCandidatesWithCompaniesHouse, evaluateDiscoveryCandidate } from "../src/ai-sales-team/discovery.ts";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const searchItem = (overrides: Record<string, unknown> = {}) => ({ title: "Hyve Group Plc", company_number: "01234567", company_status: "active", company_type: "plc", date_of_creation: "2001-02-03", sic_codes: ["82301"], links: { self: "/company/01234567" }, ...overrides });
const selectedCompany: CompaniesHouseCompanyEvidence = { legalCompanyName: "Hyve Group Plc", companyNumber: "01234567", companyStatus: "active", companyType: "plc", incorporationDate: "2001-02-03", sicCodes: ["82301"], registeredRegion: "England", recordUrl: "https://find-and-update.company-information.service.gov.uk/company/01234567", evidenceTimestamp: "2026-08-21T00:00:00.000Z" };

test("Companies House is disabled by default and non-UK searches bypass without a request", async () => {
  assert.equal(resolveCompaniesHouseMode(undefined), "disabled");
  let calls = 0;
  const disabled = await searchCompaniesHouse({ organisationName: "Hyve Group", territory: "GB" }, { apiKey: "secret", fetchImpl: async () => { calls += 1; return response({ items: [] }); } });
  const nonUk = await searchCompaniesHouse({ organisationName: "Convenco", territory: "ZA" }, { apiKey: "secret", mode: "search_only", fetchImpl: async () => { calls += 1; return response({ items: [] }); } });
  assert.equal(disabled.outcome, "REGISTRAR_UNAVAILABLE");
  assert.equal(nonUk.outcome, "REGISTRAR_NOT_FOUND");
  assert.equal(nonUk.telemetry.errorCategory, "NON_UK_BYPASS");
  assert.equal(calls, 0);
});

test("search uses Companies House Basic auth, JSON headers and one bounded request", async () => {
  const seen: Request[] = [];
  const result = await searchCompaniesHouse({ organisationName: "Hyve Group", territory: "GB", limit: 3 }, { apiKey: "test-key", mode: "search_only", now: () => "2026-08-21T00:00:00.000Z", fetchImpl: async (input, init) => { seen.push(new Request(input, init)); return response({ items: [searchItem()] }); } });
  assert.equal(result.outcome, "REGISTRAR_CONFIRMED");
  assert.equal(result.selectedCompany?.legalCompanyName, "Hyve Group Plc");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, "GET");
  assert.equal(seen[0].url, "https://api.company-information.service.gov.uk/search/companies?q=Hyve%20Group&items_per_page=3");
  assert.equal(seen[0].headers.get("content-type"), "application/json");
  assert.equal(seen[0].headers.get("authorization"), `Basic ${Buffer.from("test-key:").toString("base64")}`);
  assert.equal(JSON.stringify(result).includes("test-key"), false);
  assert.equal(result.telemetry.retryCount, 0);
});

test("selection distinguishes active, ambiguous and dissolved legal identities", () => {
  const input = { organisationName: "Hyve Group", territory: "GB" as const };
  assert.equal(selectCompaniesHouseCompany(input, [selectedCompany]).outcome, "REGISTRAR_CONFIRMED");
  assert.equal(selectCompaniesHouseCompany(input, [selectedCompany, { ...selectedCompany, companyNumber: "07654321", recordUrl: "https://find-and-update.company-information.service.gov.uk/company/07654321" }]).outcome, "REGISTRAR_AMBIGUOUS");
  assert.equal(selectCompaniesHouseCompany(input, [{ ...selectedCompany, companyStatus: "dissolved" }]).outcome, "REGISTRAR_CONFLICT");
  assert.equal(selectCompaniesHouseCompany({ ...input, tradingName: "Hyve Events" }, [{ ...selectedCompany, legalCompanyName: "Hyve Events Limited" }]).outcome, "REGISTRAR_CONFIRMED");
});

test("profile validation retains legal fields only and does not overwrite a trading domain", async () => {
  const result = await validateSelectedCompaniesHouseCompany({ company: selectedCompany, organisationName: "Hyve Group" }, { apiKey: "test-key", mode: "validate_selected", now: () => "2026-08-21T00:00:00.000Z", fetchImpl: async () => response({ ...searchItem(), registered_office_address: { address_line_1: "private address", postal_code: "XX", country: "England", region: "England" }, persons_with_significant_control: [{ name: "must not retain" }] }) });
  assert.equal(result.outcome, "REGISTRAR_CONFIRMED");
  assert.equal(result.company?.registeredRegion, "England");
  assert.equal("website" in (result.company ?? {}), false);
  assert.equal(JSON.stringify(result).includes("private address"), false);
  assert.equal(JSON.stringify(result).includes("must not retain"), false);
});

test("Hyve search title and profile company_name normalize to the same active legal company", async () => {
  const hyveSearch = await searchCompaniesHouse({ organisationName: "Hyve Group", territory: "GB", limit: 3 }, { apiKey: "test-key", mode: "search_only", fetchImpl: async () => response({ items: [{ title: "HYVE GROUP LIMITED", company_number: "01927339", company_status: "active", company_type: "ltd", date_of_creation: "1985-06-28", sic_codes: [] }] }) });
  assert.equal(hyveSearch.outcome, "REGISTRAR_CONFIRMED");
  assert.equal(hyveSearch.selectedCompany?.companyNumber, "01927339");
  const hyveProfile = await validateSelectedCompaniesHouseCompany({ company: hyveSearch.selectedCompany!, organisationName: "Hyve Group" }, { apiKey: "test-key", mode: "validate_selected", now: () => "2026-08-21T00:00:00.000Z", fetchImpl: async () => response({ company_name: "HYVE GROUP LIMITED", company_number: "01927339", company_status: "active", company_type: "ltd", date_of_creation: "1985-06-28", sic_codes: [] }) });
  assert.equal(hyveProfile.outcome, "REGISTRAR_CONFIRMED");
  assert.equal(hyveProfile.company?.legalCompanyName, "HYVE GROUP LIMITED");
  assert.equal(hyveProfile.company?.companyNumber, "01927339");
  assert.deepEqual(hyveProfile.company?.sicCodes, []);
});

test("Companies House retains only a sanitized account-category size indicator", async () => {
  const result = await validateSelectedCompaniesHouseCompany({ company: selectedCompany, organisationName: "Hyve Group" }, { apiKey: "test-key", mode: "validate_selected", fetchImpl: async () => response({ ...searchItem(), accounts: { last_accounts: { type: "small" } }, registered_office_address: { country: "England" } }) });
  assert.equal(result.outcome, "REGISTRAR_CONFIRMED");
  assert.equal(result.company?.accountsCategory, "small");
  assert.equal(JSON.stringify(result).includes("accounts_category"), false);
});

test("officers are minimized legal officers and never buyer candidates", async () => {
  const result = await getCompaniesHouseOfficers({ company: selectedCompany, validationOutcome: "REGISTRAR_CONFIRMED" }, { apiKey: "test-key", mode: "officers_selected", now: () => "2026-08-21T00:00:00.000Z", fetchImpl: async () => response({ items: [{ name: "Current Director", officer_role: "director", appointed_on: "2020-01-01", address: { postal_code: "XX" }, date_of_birth: { month: 1, year: 1980 } }, { name: "Former Director", officer_role: "director", appointed_on: "2010-01-01", resigned_on: "2019-01-01", nationality: "hidden" }] }) });
  assert.equal(result.outcome, "REGISTRAR_CONFIRMED");
  assert.deepEqual(result.officers, [
    { name: "Current Director", role: "director", appointedDate: "2020-01-01", resignedDate: null, currentStatus: "CURRENT", classification: "LEGAL_OFFICER" },
    { name: "Former Director", role: "director", appointedDate: "2010-01-01", resignedDate: "2019-01-01", currentStatus: "FORMER", classification: "LEGAL_OFFICER" },
  ]);
  assert.equal("buyerRoutingClassification" in (result.officers[0] ?? {}), false);
  assert.equal(JSON.stringify(result).includes("hidden"), false);
});

test("missing key, auth failure, malformed response and timeout fail safely with zero retries", async () => {
  const missing = await searchCompaniesHouse({ organisationName: "Hyve Group", territory: "GB" }, { mode: "search_only", apiKey: "" });
  assert.equal(missing.telemetry.errorCategory, "MISSING_API_KEY");
  const auth = await searchCompaniesHouse({ organisationName: "Hyve Group", territory: "GB" }, { mode: "search_only", apiKey: "test-key", fetchImpl: async () => response({ error: "do not retain" }, 401) });
  assert.equal(auth.telemetry.errorCategory, "AUTHENTICATION_FAILED");
  assert.equal(JSON.stringify(auth).includes("do not retain"), false);
  const malformed = await searchCompaniesHouse({ organisationName: "Hyve Group", territory: "GB" }, { mode: "search_only", apiKey: "test-key", fetchImpl: async () => new Response("raw secret provider body", { status: 200 }) });
  assert.equal(malformed.telemetry.errorCategory, "MALFORMED_RESPONSE");
  assert.equal(JSON.stringify(malformed).includes("raw secret"), false);
  const timeout = await searchCompaniesHouse({ organisationName: "Hyve Group", territory: "GB" }, { mode: "search_only", apiKey: "test-key", timeoutMs: 1_000, fetchImpl: async (_input, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")))) });
  assert.equal(timeout.telemetry.errorCategory, "TIMEOUT");
  assert.equal(timeout.telemetry.retryCount, 0);
});

test("registrar evidence is attached before identity handoff without changing the official web domain", async () => {
  const candidate = evaluateDiscoveryCandidate({ canonicalName: "World Travel Market London", organiserName: "Hyve Group", website: "https://www.hyve.group", origin: "EVENT_FIRST", relationshipHint: "PROSPECT", facts: [{ claim: "World Travel Market London returns in 2026.", sourceUrl: "https://www.hyve.group/events", sourceTitle: "Hyve events", kind: "FACT", confidence: "HIGH", sourceRoles: ["DISCOVERY"], eventFreshness: "ACTIVE_UPCOMING" }], inferences: [], unknowns: [] }, "GB");
  let calls = 0;
  const result = await enrichDiscoveryCandidatesWithCompaniesHouse([candidate], "GB", { apiKey: "test-key", mode: "search_only", fetchImpl: async () => { calls += 1; return response({ items: [searchItem()] }); } });
  assert.equal(calls, 1);
  assert.equal(result.telemetry.attemptedCount, 1);
  assert.equal(result.candidates[0].registrarValidation?.outcome, "REGISTRAR_CONFIRMED");
  assert.equal(result.candidates[0].registrarValidation?.company?.legalCompanyName, "Hyve Group Plc");
  assert.equal(result.candidates[0].website, "https://www.hyve.group");
  assert.equal(result.candidates[0].prospectIntelligence.accountCreationEligible, false);
});
