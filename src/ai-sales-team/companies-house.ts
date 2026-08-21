export const COMPANIES_HOUSE_BASE_URL = "https://api.company-information.service.gov.uk";
export const COMPANIES_HOUSE_MODES = ["disabled", "search_only", "validate_selected", "officers_selected"] as const;
export type CompaniesHouseMode = typeof COMPANIES_HOUSE_MODES[number];
export type CompaniesHouseOutcome = "REGISTRAR_CONFIRMED" | "REGISTRAR_AMBIGUOUS" | "REGISTRAR_CONFLICT" | "REGISTRAR_NOT_FOUND" | "REGISTRAR_UNAVAILABLE";
export type CompaniesHouseErrorCategory = "DISABLED" | "NON_UK_BYPASS" | "MISSING_API_KEY" | "AUTHENTICATION_FAILED" | "NOT_FOUND" | "TIMEOUT" | "MALFORMED_RESPONSE" | "PROVIDER_ERROR" | "SELECTION_REQUIRED" | null;

export type CompaniesHouseCompanyEvidence = {
  legalCompanyName: string;
  companyNumber: string;
  companyStatus: string | null;
  companyType: string | null;
  incorporationDate: string | null;
  sicCodes: string[];
  registeredRegion: string | null;
  recordUrl: string;
  evidenceTimestamp: string;
};

export type CompaniesHouseIdentityEvidence = {
  outcome: CompaniesHouseOutcome;
  reason: string;
  company: CompaniesHouseCompanyEvidence | null;
  evidenceTimestamp: string;
};

export type CompaniesHouseOfficer = {
  name: string;
  role: string | null;
  appointedDate: string | null;
  resignedDate: string | null;
  currentStatus: "CURRENT" | "FORMER";
  classification: "LEGAL_OFFICER";
};

export type CompaniesHouseTelemetry = {
  endpoint: "COMPANY_SEARCH" | "COMPANY_PROFILE" | "OFFICERS";
  mode: CompaniesHouseMode;
  requestAttempted: boolean;
  requestCount: number;
  retryCount: 0;
  httpStatus: number | null;
  outcome: CompaniesHouseOutcome;
  errorCategory: CompaniesHouseErrorCategory;
  durationMs: number;
};

export type CompaniesHouseOptions = {
  apiKey?: string;
  mode?: CompaniesHouseMode;
  fetchImpl?: typeof fetch;
  now?: () => string;
  timeoutMs?: number;
};

export type CompaniesHouseSearchInput = {
  organisationName: string;
  tradingName?: string | null;
  territory: "GB" | "ZA";
  limit?: number;
};

export type CompaniesHouseSearchResult = {
  outcome: CompaniesHouseOutcome;
  reason: string;
  companies: CompaniesHouseCompanyEvidence[];
  selectedCompany: CompaniesHouseCompanyEvidence | null;
  identityEvidence: CompaniesHouseIdentityEvidence;
  telemetry: CompaniesHouseTelemetry;
};

export type CompaniesHouseValidationResult = {
  outcome: CompaniesHouseOutcome;
  reason: string;
  company: CompaniesHouseCompanyEvidence | null;
  identityEvidence: CompaniesHouseIdentityEvidence;
  telemetry: CompaniesHouseTelemetry;
};

export type CompaniesHouseOfficersResult = {
  outcome: CompaniesHouseOutcome;
  reason: string;
  officers: CompaniesHouseOfficer[];
  telemetry: CompaniesHouseTelemetry;
};

function modeFrom(value: unknown): CompaniesHouseMode {
  return COMPANIES_HOUSE_MODES.includes(value as CompaniesHouseMode) ? value as CompaniesHouseMode : "disabled";
}

export function resolveCompaniesHouseMode(value = process.env.COMPANIES_HOUSE_MODE): CompaniesHouseMode {
  return modeFrom(value);
}

function optionsOf(options: CompaniesHouseOptions): Required<Pick<CompaniesHouseOptions, "fetchImpl" | "now" | "timeoutMs">> & { apiKey: string | undefined; mode: CompaniesHouseMode } {
  return {
    apiKey: options.apiKey ?? process.env.COMPANIES_HOUSE_API_KEY,
    mode: modeFrom(options.mode ?? process.env.COMPANIES_HOUSE_MODE),
    fetchImpl: options.fetchImpl ?? fetch,
    now: options.now ?? (() => new Date().toISOString()),
    timeoutMs: Math.min(Math.max(options.timeoutMs ?? 8_000, 1_000), 15_000),
  };
}

function safeLimit(value: number | undefined, max = 10) {
  return Math.min(Math.max(Math.trunc(value ?? 5), 1), max);
}

function comparableName(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/&/g, " and ").replace(/\b(?:public limited company|limited|ltd|plc|llp)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function identityMatches(companyName: string, input: CompaniesHouseSearchInput) {
  const legal = comparableName(companyName);
  return [input.organisationName, input.tradingName ?? null].filter(Boolean).some((name) => legal === comparableName(name));
}

function recordUrl(companyNumber: string) {
  return `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(companyNumber)}`;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeStringArray(value: unknown, max = 20) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()).slice(0, max) : [];
}

function companyFromApi(value: unknown, timestamp: string): CompaniesHouseCompanyEvidence | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const name = stringOrNull(item.title);
  const number = stringOrNull(item.company_number);
  if (!name || !number) return null;
  const address = item.registered_office_address && typeof item.registered_office_address === "object" ? item.registered_office_address as Record<string, unknown> : null;
  return {
    legalCompanyName: name,
    companyNumber: number,
    companyStatus: stringOrNull(item.company_status),
    companyType: stringOrNull(item.company_type),
    incorporationDate: stringOrNull(item.date_of_creation),
    sicCodes: safeStringArray(item.sic_codes),
    registeredRegion: stringOrNull(address?.region) ?? stringOrNull(address?.country),
    recordUrl: recordUrl(number),
    evidenceTimestamp: timestamp,
  };
}

function identityEvidence(outcome: CompaniesHouseOutcome, reason: string, company: CompaniesHouseCompanyEvidence | null, timestamp: string): CompaniesHouseIdentityEvidence {
  return { outcome, reason, company, evidenceTimestamp: timestamp };
}

function telemetry(endpoint: CompaniesHouseTelemetry["endpoint"], mode: CompaniesHouseMode, started: number, outcome: CompaniesHouseOutcome, errorCategory: CompaniesHouseErrorCategory, httpStatus: number | null, requestAttempted: boolean): CompaniesHouseTelemetry {
  return { endpoint, mode, requestAttempted, requestCount: requestAttempted ? 1 : 0, retryCount: 0, httpStatus, outcome, errorCategory, durationMs: Math.max(0, Date.now() - started) };
}

function disabledResult(endpoint: CompaniesHouseTelemetry["endpoint"], mode: CompaniesHouseMode, now: string): CompaniesHouseTelemetry {
  return { endpoint, mode, requestAttempted: false, requestCount: 0, retryCount: 0, httpStatus: null, outcome: "REGISTRAR_UNAVAILABLE", errorCategory: "DISABLED", durationMs: 0 };
}

async function requestJson(endpoint: CompaniesHouseTelemetry["endpoint"], path: string, options: CompaniesHouseOptions): Promise<{ body: unknown; telemetry: CompaniesHouseTelemetry }> {
  const resolved = optionsOf(options);
  const started = Date.now();
  if (!resolved.apiKey) return { body: null, telemetry: telemetry(endpoint, resolved.mode, started, "REGISTRAR_UNAVAILABLE", "MISSING_API_KEY", null, false) };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), resolved.timeoutMs);
  try {
    const auth = Buffer.from(`${resolved.apiKey}:`, "utf8").toString("base64");
    const response = await resolved.fetchImpl(`${COMPANIES_HOUSE_BASE_URL}${path}`, { method: "GET", headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Basic ${auth}` }, signal: controller.signal });
    if (response.status === 401 || response.status === 403) return { body: null, telemetry: telemetry(endpoint, resolved.mode, started, "REGISTRAR_UNAVAILABLE", "AUTHENTICATION_FAILED", response.status, true) };
    if (response.status === 404) return { body: null, telemetry: telemetry(endpoint, resolved.mode, started, "REGISTRAR_NOT_FOUND", "NOT_FOUND", response.status, true) };
    if (!response.ok) return { body: null, telemetry: telemetry(endpoint, resolved.mode, started, "REGISTRAR_UNAVAILABLE", "PROVIDER_ERROR", response.status, true) };
    try {
      return { body: await response.json(), telemetry: telemetry(endpoint, resolved.mode, started, "REGISTRAR_CONFIRMED", null, response.status, true) };
    } catch {
      return { body: null, telemetry: telemetry(endpoint, resolved.mode, started, "REGISTRAR_UNAVAILABLE", "MALFORMED_RESPONSE", response.status, true) };
    }
  } catch (error) {
    const errorCategory = error instanceof DOMException && error.name === "AbortError" ? "TIMEOUT" : "PROVIDER_ERROR";
    return { body: null, telemetry: telemetry(endpoint, resolved.mode, started, "REGISTRAR_UNAVAILABLE", errorCategory, null, true) };
  } finally {
    clearTimeout(timeout);
  }
}

function selectCompany(input: CompaniesHouseSearchInput, companies: CompaniesHouseCompanyEvidence[]) {
  const exact = companies.filter((company) => identityMatches(company.legalCompanyName, input));
  const active = exact.filter((company) => company.companyStatus?.toLowerCase() === "active");
  if (active.length === 1) return { outcome: "REGISTRAR_CONFIRMED" as const, reason: "One exact active Companies House legal-company match was selected deterministically.", company: active[0] };
  if (active.length > 1 || exact.length > 1) return { outcome: "REGISTRAR_AMBIGUOUS" as const, reason: "More than one credible Companies House match remains; profile and officer retrieval are blocked.", company: null };
  if (exact.some((company) => company.companyStatus?.toLowerCase() === "dissolved")) return { outcome: "REGISTRAR_CONFLICT" as const, reason: "The exact Companies House match is dissolved and cannot validate an active legal organisation.", company: null };
  if (companies.length) return { outcome: "REGISTRAR_AMBIGUOUS" as const, reason: "Search results exist but no exact active legal-company match was established.", company: null };
  return { outcome: "REGISTRAR_NOT_FOUND" as const, reason: "No Companies House company result was returned.", company: null };
}

export function selectCompaniesHouseCompany(input: CompaniesHouseSearchInput, companies: CompaniesHouseCompanyEvidence[]) {
  return selectCompany(input, companies);
}

export async function searchCompaniesHouse(input: CompaniesHouseSearchInput, options: CompaniesHouseOptions = {}): Promise<CompaniesHouseSearchResult> {
  const resolved = optionsOf(options);
  const timestamp = resolved.now();
  if (input.territory !== "GB") {
    const reason = "Companies House is bypassed for non-UK territory; no registrar request was made.";
    const t = { ...disabledResult("COMPANY_SEARCH", resolved.mode, timestamp), outcome: "REGISTRAR_NOT_FOUND" as const, errorCategory: "NON_UK_BYPASS" as const };
    return { outcome: "REGISTRAR_NOT_FOUND", reason, companies: [], selectedCompany: null, identityEvidence: identityEvidence("REGISTRAR_NOT_FOUND", reason, null, timestamp), telemetry: t };
  }
  if (resolved.mode !== "search_only") {
    const reason = "Companies House search is disabled until search_only mode is explicitly selected.";
    return { outcome: "REGISTRAR_UNAVAILABLE", reason, companies: [], selectedCompany: null, identityEvidence: identityEvidence("REGISTRAR_UNAVAILABLE", reason, null, timestamp), telemetry: disabledResult("COMPANY_SEARCH", resolved.mode, timestamp) };
  }
  const path = `/search/companies?q=${encodeURIComponent(input.organisationName.trim())}&items_per_page=${safeLimit(input.limit)}`;
  const request = await requestJson("COMPANY_SEARCH", path, options);
  if (!request.body) {
    const outcome: CompaniesHouseOutcome = request.telemetry.errorCategory === "NOT_FOUND" ? "REGISTRAR_NOT_FOUND" : "REGISTRAR_UNAVAILABLE";
    const reason = outcome === "REGISTRAR_NOT_FOUND" ? "Companies House returned no matching search resource." : "Companies House search was unavailable; no legal-company identity was promoted.";
    const t = { ...request.telemetry, outcome };
    return { outcome, reason, companies: [], selectedCompany: null, identityEvidence: identityEvidence(outcome, reason, null, timestamp), telemetry: t };
  }
  const items = request.body && typeof request.body === "object" && Array.isArray((request.body as { items?: unknown }).items) ? (request.body as { items: unknown[] }).items : [];
  const companies = items.map((item) => companyFromApi(item, timestamp)).filter((item): item is CompaniesHouseCompanyEvidence => Boolean(item)).slice(0, safeLimit(input.limit));
  const selected = selectCompany(input, companies);
  const reason = selected.reason;
  const t = { ...request.telemetry, outcome: selected.outcome };
  return { outcome: selected.outcome, reason, companies, selectedCompany: selected.company, identityEvidence: identityEvidence(selected.outcome, reason, selected.company, timestamp), telemetry: t };
}

export async function validateSelectedCompaniesHouseCompany(input: { company: CompaniesHouseCompanyEvidence; organisationName: string; tradingName?: string | null }, options: CompaniesHouseOptions = {}): Promise<CompaniesHouseValidationResult> {
  const resolved = optionsOf(options);
  const timestamp = resolved.now();
  if (resolved.mode !== "validate_selected") {
    const reason = "Companies House profile validation requires explicit validate_selected mode.";
    return { outcome: "REGISTRAR_UNAVAILABLE", reason, company: null, identityEvidence: identityEvidence("REGISTRAR_UNAVAILABLE", reason, null, timestamp), telemetry: disabledResult("COMPANY_PROFILE", resolved.mode, timestamp) };
  }
  const request = await requestJson("COMPANY_PROFILE", `/company/${encodeURIComponent(input.company.companyNumber)}`, options);
  if (!request.body) {
    const outcome = request.telemetry.errorCategory === "NOT_FOUND" ? "REGISTRAR_NOT_FOUND" : "REGISTRAR_UNAVAILABLE";
    const reason = outcome === "REGISTRAR_NOT_FOUND" ? "The selected Companies House company profile was not found." : "The selected Companies House profile could not be validated.";
    return { outcome, reason, company: null, identityEvidence: identityEvidence(outcome, reason, null, timestamp), telemetry: { ...request.telemetry, outcome } };
  }
  const company = companyFromApi(request.body, timestamp);
  if (!company || company.companyNumber !== input.company.companyNumber || !identityMatches(company.legalCompanyName, { organisationName: input.organisationName, tradingName: input.tradingName, territory: "GB" })) {
    const reason = "The selected profile did not preserve the selected company number and requested legal identity.";
    return { outcome: "REGISTRAR_CONFLICT", reason, company: null, identityEvidence: identityEvidence("REGISTRAR_CONFLICT", reason, null, timestamp), telemetry: { ...request.telemetry, outcome: "REGISTRAR_CONFLICT" } };
  }
  const active = company.companyStatus?.toLowerCase() === "active";
  const outcome = active ? "REGISTRAR_CONFIRMED" as const : company.companyStatus?.toLowerCase() === "dissolved" ? "REGISTRAR_CONFLICT" as const : "REGISTRAR_AMBIGUOUS" as const;
  const reason = active ? "The selected Companies House profile confirms one active legal company." : outcome === "REGISTRAR_CONFLICT" ? "The selected Companies House profile is dissolved." : "The selected Companies House profile has no determinative active status.";
  return { outcome, reason, company: active ? company : null, identityEvidence: identityEvidence(outcome, reason, active ? company : null, timestamp), telemetry: { ...request.telemetry, outcome } };
}

export async function getCompaniesHouseOfficers(input: { company: CompaniesHouseCompanyEvidence; validationOutcome: CompaniesHouseOutcome }, options: CompaniesHouseOptions = {}): Promise<CompaniesHouseOfficersResult> {
  const resolved = optionsOf(options);
  if (resolved.mode !== "officers_selected" || input.validationOutcome !== "REGISTRAR_CONFIRMED") {
    return { outcome: "REGISTRAR_UNAVAILABLE", reason: "Officer retrieval requires explicit officers_selected mode and a confirmed selected company.", officers: [], telemetry: disabledResult("OFFICERS", resolved.mode, resolved.now()) };
  }
  const request = await requestJson("OFFICERS", `/company/${encodeURIComponent(input.company.companyNumber)}/officers?items_per_page=50`, options);
  if (!request.body) {
    const outcome = request.telemetry.errorCategory === "NOT_FOUND" ? "REGISTRAR_NOT_FOUND" : "REGISTRAR_UNAVAILABLE";
    return { outcome, reason: outcome === "REGISTRAR_NOT_FOUND" ? "The selected Companies House officer resource was not found." : "Companies House officers were unavailable; no officer was retained.", officers: [], telemetry: { ...request.telemetry, outcome } };
  }
  const items = request.body && typeof request.body === "object" && Array.isArray((request.body as { items?: unknown }).items) ? (request.body as { items: unknown[] }).items : [];
  const officers = items.map((value): CompaniesHouseOfficer | null => {
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    const name = stringOrNull(item.name);
    if (!name) return null;
    const resignedDate = stringOrNull(item.resigned_on);
    return { name, role: stringOrNull(item.officer_role), appointedDate: stringOrNull(item.appointed_on), resignedDate, currentStatus: resignedDate ? "FORMER" : "CURRENT", classification: "LEGAL_OFFICER" };
  }).filter((item): item is CompaniesHouseOfficer => Boolean(item)).slice(0, 50);
  const reason = officers.length ? "Companies House legal officers were normalized for review only; no buyer classification was assigned." : "The confirmed company has no officers in the returned resource.";
  return { outcome: "REGISTRAR_CONFIRMED", reason, officers, telemetry: { ...request.telemetry, outcome: "REGISTRAR_CONFIRMED" } };
}
