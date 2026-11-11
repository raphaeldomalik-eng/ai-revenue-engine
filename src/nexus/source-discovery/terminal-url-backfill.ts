import { createHash } from 'node:crypto';
import { canonicalHttpsUrl } from './network.ts';
import type { TerminalUrlHistory, TerminalUrlObservation } from './types.ts';

type Item = TerminalUrlObservation & { retainedRecord: string };
export type TerminalUrlBackfillPlan = { version: 1; inputRecords: number; candidateObservations: number; duplicateObservations: number; ignoredNonterminal: number; observations: Item[]; refused: Array<{ record: string; url: string | null; reason: string }>; planSha256: string };
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
function hashPlan(plan: Omit<TerminalUrlBackfillPlan, 'planSha256'>) { return createHash('sha256').update(JSON.stringify(plan)).digest('hex'); }
/** Offline only. Consume exported AIRE result payloads; never infer a status from warnings or a provider error. */
export function planTerminalUrlBackfill(records: unknown[], maxRecords = 10000): TerminalUrlBackfillPlan {
 if (!Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > 100000 || records.length > maxRecords) throw new Error('TERMINAL_BACKFILL_RECORD_BOUND');
 const unique = new Map<string, Item>();
 const refused: TerminalUrlBackfillPlan['refused'] = [];
 let candidateObservations = 0, duplicateObservations = 0, ignoredNonterminal = 0, visited = 0;
 const visit = (value: unknown, record: string, inheritedDate: unknown, depth: number) => {
  if (++visited > 1000000 || depth > 16) throw new Error('TERMINAL_BACKFILL_STRUCTURE_BOUND');
  const node = object(value); if (!node) return;
  const source = object(node.source);
  const date = source?.observedAt ?? node.observedAt ?? inheritedDate;
  const candidates: Array<{ value: unknown; diagnostic: boolean }> = [];
  const manifest = object(node.evidenceManifest);
  if (manifest?.version === 1 && Array.isArray(manifest.requests)) candidates.push(...manifest.requests.map(value => ({ value, diagnostic: false })));
  if (Array.isArray(node.responseManifest)) candidates.push(...node.responseManifest.map(value => ({ value, diagnostic: false })));
  if (Array.isArray(node.diagnostics)) candidates.push(...node.diagnostics.map(value => ({ value, diagnostic: true })));
  for (const candidate of candidates) {
   const response = object(candidate.value); if (!response) continue;
   if (response.status !== 404 && response.status !== 410) { ignoredNonterminal++; continue; }
   if (++candidateObservations > 100000) throw new Error('TERMINAL_BACKFILL_OBSERVATION_BOUND');
   const url = typeof response.url === 'string' ? canonicalHttpsUrl(response.url) : null;
   const observedAt = response.observedAt ?? date;
   const reason = !url ? 'INVALID_OR_PRIVATE_URL' : typeof observedAt !== 'string' || !Number.isFinite(Date.parse(observedAt)) ? 'MISSING_OBSERVATION_DATE' : candidate.diagnostic && response.code !== 'HTTP_' + response.status ? 'NOT_DIRECT_HTTP_DIAGNOSTIC' : !candidate.diagnostic && (typeof response.responseHash !== 'string' || !/^[a-f0-9]{64}$/.test(response.responseHash)) ? 'MISSING_DIRECT_RESPONSE_HASH' : null;
   if (reason) { refused.push({ record, url: typeof response.url === 'string' ? response.url : null, reason }); continue; }
   const item: Item = { url: url!, status: response.status, observedAt: observedAt as string, source: 'DIRECT_HTTP_RESPONSE', retainedRecord: record };
   const old = unique.get(item.url);
   if (old) duplicateObservations++;
   if (!old || Date.parse(item.observedAt) < Date.parse(old.observedAt)) unique.set(item.url, item);
  }
  for (const [key, child] of Object.entries(node)) {
   if (['evidenceManifest', 'responseManifest', 'diagnostics'].includes(key)) continue;
   if (Array.isArray(child)) { for (const item of child) if (object(item)) visit(item, record, date, depth + 1); }
   else if (object(child)) visit(child, record, date, depth + 1);
  }
 };
 records.forEach((row, i) => { const value = object(row); visit(row, typeof value?.idempotency_key === 'string' ? value.idempotency_key : `export-row:${i}`, undefined, 0); });
 const plan: Omit<TerminalUrlBackfillPlan, 'planSha256'> = { version: 1, inputRecords: records.length, candidateObservations, duplicateObservations, ignoredNonterminal, observations: [...unique.values()].sort((a, b) => a.url.localeCompare(b.url)), refused };
 return { ...plan, planSha256: hashPlan(plan) };
}
/** Release-preflight hook only: exact reviewed plan hash and a finite write cap are mandatory. */
export async function applyTerminalUrlBackfill(plan: TerminalUrlBackfillPlan, options: { history: TerminalUrlHistory; approvedPlanSha256: string; maxWrites: number }) {
 const { planSha256, ...body } = plan;
 if (hashPlan(body) !== planSha256 || options.approvedPlanSha256 !== planSha256) throw new Error('TERMINAL_BACKFILL_PLAN_NOT_APPROVED');
 if (!Number.isInteger(options.maxWrites) || options.maxWrites < 0 || options.maxWrites > 100000 || plan.observations.length > options.maxWrites) throw new Error('TERMINAL_BACKFILL_WRITE_BOUND');
 let written = 0, reused = 0;
 for (const item of plan.observations) {
  const observation: TerminalUrlObservation = { url: item.url, status: item.status, observedAt: item.observedAt, source: item.source };
  if (await options.history.get(observation.url)) { reused++; continue; }
  await options.history.set(observation); written++;
 }
 return { planSha256, written, reused, refused: plan.refused.length };
}
