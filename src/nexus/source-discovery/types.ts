import type { SourceExtractor } from "../contracts.ts";

export type ResolveHost = (hostname: string) => Promise<Array<{ address: string; family: number }>>;
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type CrawlBudget = {
  maxPages: number;
  maxRequests: number;
  maxBytesPerResponse: number;
  maxRedirects: number;
  maxRetries: number;
  timeoutMs: number;
  minRequestDelayMs: number;
};
export type FetchedDocument = {
  url: string;
  body: string;
  contentType: string | null;
  bytes: number;
  sourceHash: string;
  observedAt: string;
};
export type CrawlStats = {
  requestCount: number;
  pageCount: number;
  bytesRead: number;
  redirects: number;
  blockedCount: number;
  retries: number;
  warnings: string[];
  status: "COMPLETED" | "PARTIAL" | "BLOCKED" | "FAILED";
};
export type CrawlOutput = {
  verifiedUrl: string;
  finalUrl: string;
  documents: FetchedDocument[];
  stats: CrawlStats;
};
export type CrawlInput = {
  verifiedUrl: string;
  requestedExtractors: SourceExtractor[];
  budget: CrawlBudget;
  fetchImpl?: FetchLike;
  resolveHost?: ResolveHost;
  userAgent?: string;
};
