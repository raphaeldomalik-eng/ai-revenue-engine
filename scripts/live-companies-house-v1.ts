import { getCompaniesHouseOfficers, searchCompaniesHouse, validateSelectedCompaniesHouseCompany } from "../src/ai-sales-team/companies-house.ts";

const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
if (!apiKey) {
  console.error("COMPANIES_HOUSE_API_KEY is not configured.");
  process.exit(2);
}

const calls: Array<{ category: "COMPANY_SEARCH" | "COMPANY_PROFILE" | "OFFICERS"; status: number; path: string }> = [];
const fetchImpl: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.origin !== "https://api.company-information.service.gov.uk") throw new Error("Unexpected external endpoint blocked.");
  const path = url.pathname;
  const category = path === "/search/companies" ? "COMPANY_SEARCH" : path.endsWith("/officers") ? "OFFICERS" : "COMPANY_PROFILE";
  const categoryCount = calls.filter((call) => call.category === category).length;
  if (categoryCount >= 1 || calls.length >= 3) throw new Error("Bounded request limit exceeded.");
  const response = await fetch(input, init);
  calls.push({ category, status: response.status, path });
  return response;
};

const search = await searchCompaniesHouse({ organisationName: "Hyve Group", tradingName: "Hyve Group", territory: "GB", limit: 3 }, { apiKey, mode: "search_only", fetchImpl });
let profile: Awaited<ReturnType<typeof validateSelectedCompaniesHouseCompany>> | null = null;
let officers: Awaited<ReturnType<typeof getCompaniesHouseOfficers>> | null = null;

if (search.outcome === "REGISTRAR_CONFIRMED" && search.selectedCompany) {
  profile = await validateSelectedCompaniesHouseCompany({ company: search.selectedCompany, organisationName: "Hyve Group", tradingName: "Hyve Group" }, { apiKey, mode: "validate_selected", fetchImpl });
  if (profile.outcome === "REGISTRAR_CONFIRMED" && profile.company) {
    officers = await getCompaniesHouseOfficers({ company: profile.company, validationOutcome: profile.outcome }, { apiKey, mode: "officers_selected", fetchImpl });
  }
}

console.log(JSON.stringify({
  artifact: "companies-house-hyve-v1",
  keyPresent: true,
  case: { organisationName: "Hyve Group", territory: "GB" },
  requests: { total: calls.length, search: calls.filter((call) => call.category === "COMPANY_SEARCH").length, profile: calls.filter((call) => call.category === "COMPANY_PROFILE").length, officers: calls.filter((call) => call.category === "OFFICERS").length, retryCount: 0, statuses: calls },
  search: { outcome: search.outcome, reason: search.reason, resultCount: search.companies.length, selectedCompany: search.selectedCompany },
  profile: profile ? { outcome: profile.outcome, reason: profile.reason, company: profile.company } : { called: false },
  officers: officers ? { outcome: officers.outcome, reason: officers.reason, count: officers.officers.length, people: officers.officers } : { called: false },
  safety: { openAiCalls: 0, googleCalls: 0, apolloCalls: 0, emailOrPhoneRequests: 0, persistenceWrites: 0, outreachActions: 0, productionActivation: false },
}, null, 2));
