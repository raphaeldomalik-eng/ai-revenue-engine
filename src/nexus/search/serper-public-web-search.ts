import type { PublicWebSearchCostModel, PublicWebSearchProvider, PublicWebSearchResult } from "../official-website-discovery.ts";

/**
 * Serper Google Search adapter for the existing official-website discovery lane.
 * Ranking is not identity proof. Only URL, title, and snippet leave this module.
 * The 2,500-request cap is a usage ceiling for the approved free allowance.
 * It is not proof that the Serper account cannot bill after that allowance.
 */

export const SERPER_PUBLIC_WEB_SEARCH_PROVIDER_ID = "serper-google-search";
export const PUBLIC_WEB_SEARCH_REQUEST_CAP = 2_500;
export const PUBLIC_WEB_SEARCH_BUDGET_EXHAUSTED = "PUBLIC_WEB_SEARCH_BUDGET_EXHAUSTED";
export const PUBLIC_WEB_SEARCH_PROVIDER_FAILURE = "PUBLIC_WEB_SEARCH_PROVIDER_FAILURE";
export const SERPER_SEARCH_URL = "https://google.serper.dev/search";

/** Google's gl code for the United Kingdom is `uk`, not `gb`. South Africa is `za`. */
const SERPER_LOCALISATION = {
  ZA: { gl: "za", hl: "en", location: "South Africa" },
  GB: { gl: "uk", hl: "en", location: "United Kingdom" },
} as const;

export const SERPER_PUBLIC_WEB_SEARCH_COST_MODEL: PublicWebSearchCostModel = {
  kind: "METERED",
  currency: "USD",
  amountPerCall: 0,
};

export type PublicWebSearchLedgerEntry = {
  requestIndex: number;
  at: string;
  venueId: string | null;
  query: string;
  country: "GB" | "ZA";
  resultCount: number;
  candidateUrls: string[];
  verificationOutcome: string | null;
};

export type PublicWebSearchBudget = {
  cap: number;
  used: number;
  entries: PublicWebSearchLedgerEntry[];
  venueId: string | null;
};

const programmeBudget = createPublicWebSearchBudget();

export function createPublicWebSearchBudget(cap = PUBLIC_WEB_SEARCH_REQUEST_CAP): PublicWebSearchBudget {
  return { cap, used: 0, entries: [], venueId: null };
}

export function programmePublicWebSearchBudget(): PublicWebSearchBudget {
  return programmeBudget;
}

export function setPublicWebSearchVenue(budget: PublicWebSearchBudget, venueId: string | null) {
  budget.venueId = venueId;
}

export function recordPublicWebSearchVerification(budget: PublicWebSearchBudget, venueId: string, outcome: string) {
  for (const entry of budget.entries) {
    if (entry.venueId === venueId && entry.verificationOutcome == null) entry.verificationOutcome = outcome;
  }
}

export class PublicWebSearchBudgetExhaustedError extends Error {
  readonly code = PUBLIC_WEB_SEARCH_BUDGET_EXHAUSTED;
  readonly retryable = false;
  constructor() {
    super(PUBLIC_WEB_SEARCH_BUDGET_EXHAUSTED);
    this.name = "PublicWebSearchBudgetExhaustedError";
  }
}

export class PublicWebSearchProviderFailure extends Error {
  readonly code = PUBLIC_WEB_SEARCH_PROVIDER_FAILURE;
  readonly retryable = true;
  readonly status: number | null;
  constructor(status: number | null = null) {
    super(PUBLIC_WEB_SEARCH_PROVIDER_FAILURE);
    this.name = "PublicWebSearchProviderFailure";
    this.status = status;
  }
}

export function isPublicWebSearchBudgetExhausted(error: unknown): error is PublicWebSearchBudgetExhaustedError {
  return error instanceof PublicWebSearchBudgetExhaustedError || (error instanceof Error && (error as { code?: string }).code === PUBLIC_WEB_SEARCH_BUDGET_EXHAUSTED);
}

export function serperApiKeyFromEnv(): string | null {
  const value = process.env.SERPER_API_KEY?.trim();
  return value ? value : null;
}

function isPublicHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return false;
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function boundedText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : null;
}

/** Organic URL, title, and snippet only. Knowledge-graph and other SERP fields are discarded. */
export function mapSerperOrganicResults(payload: unknown, maxResults: number): PublicWebSearchResult[] {
  if (!payload || typeof payload !== "object") return [];
  const organic = (payload as { organic?: unknown }).organic;
  if (!Array.isArray(organic)) return [];
  const limit = Math.max(0, Math.min(10, maxResults));
  const results: PublicWebSearchResult[] = [];
  for (const item of organic) {
    if (results.length >= limit) break;
    if (!item || typeof item !== "object") continue;
    const link = (item as { link?: unknown }).link;
    if (typeof link !== "string" || !isPublicHttpUrl(link)) continue;
    results.push({ url: link, title: boundedText((item as { title?: unknown }).title), snippet: boundedText((item as { snippet?: unknown }).snippet) });
  }
  return results;
}

function beginSearch(budget: PublicWebSearchBudget, query: string, country: "GB" | "ZA"): PublicWebSearchLedgerEntry {
  if (!Number.isFinite(budget.cap) || budget.cap > PUBLIC_WEB_SEARCH_REQUEST_CAP) budget.cap = PUBLIC_WEB_SEARCH_REQUEST_CAP;
  if (budget.used >= budget.cap || budget.used >= PUBLIC_WEB_SEARCH_REQUEST_CAP) throw new PublicWebSearchBudgetExhaustedError();
  budget.used += 1;
  const entry: PublicWebSearchLedgerEntry = {
    requestIndex: budget.used,
    at: new Date().toISOString(),
    venueId: budget.venueId,
    query,
    country,
    resultCount: 0,
    candidateUrls: [],
    verificationOutcome: null,
  };
  budget.entries.push(entry);
  return entry;
}

export type SerperPublicWebSearchOptions = {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  budget?: PublicWebSearchBudget;
  now?: () => string;
};

export function createSerperPublicWebSearchProvider(options: SerperPublicWebSearchOptions = {}): PublicWebSearchProvider {
  const budget = options.budget ?? programmePublicWebSearchBudget();
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    id: SERPER_PUBLIC_WEB_SEARCH_PROVIDER_ID,
    costModel: SERPER_PUBLIC_WEB_SEARCH_COST_MODEL,
    async search(input) {
      const apiKey = options.apiKey ?? serperApiKeyFromEnv();
      if (!apiKey) throw new PublicWebSearchProviderFailure(null);
      const localisation = SERPER_LOCALISATION[input.country];
      const maxResults = Math.max(1, Math.min(10, input.maxResults));
      const entry = beginSearch(budget, input.query, input.country);
      if (options.now) entry.at = options.now();
      let response: Response;
      try {
        response = await fetchImpl(SERPER_SEARCH_URL, {
          method: "POST",
          redirect: "error",
          headers: { "X-API-KEY": apiKey, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ q: input.query, gl: localisation.gl, hl: localisation.hl, location: localisation.location, num: maxResults }),
        });
      } catch {
        throw new PublicWebSearchProviderFailure(null);
      }
      if (!response.ok) {
        await response.arrayBuffer().catch(() => undefined);
        throw new PublicWebSearchProviderFailure(response.status);
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new PublicWebSearchProviderFailure(response.status);
      }
      const results = mapSerperOrganicResults(payload, maxResults);
      entry.resultCount = results.length;
      entry.candidateUrls = results.map((item) => item.url);
      return results;
    },
  };
}
