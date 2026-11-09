import assert from 'node:assert/strict';
import test from 'node:test';
import { planTerminalUrlBackfill, applyTerminalUrlBackfill } from '../src/nexus/source-discovery/terminal-url-backfill.ts';
import type { TerminalUrlObservation } from '../src/nexus/source-discovery/types.ts';
const date = '2026-10-01T00:00:00.000Z';
const response = (url: string, status: number) => ({ url, status, responseHash: 'a'.repeat(64) });
const exported = [{ idempotency_key: 'old-request', result_payload: { source: { observedAt: date }, crawl: { evidenceManifest: { version: 1, requests: [response('https://venue.org/gone', 404), response('https://venue.org/robots.txt', 410), response('https://venue.org/sitemap.xml', 404), response('https://venue.org/blocked', 403), response('https://127.0.0.1/private', 404)] }, diagnostics: [{ url: 'https://venue.org/gone', status: 404, observedAt: date, code: 'HTTP_404' }, { url: 'https://venue.org/provider', status: 404, observedAt: date, code: 'PROVIDER_ERROR' }] } } }];
test('offline plan deduplicates exact retained page, robots and sitemap statuses without inference', () => {
 const plan = planTerminalUrlBackfill(exported);
 assert.equal(plan.observations.length, 3);
 assert.equal(plan.candidateObservations, 6);
 assert.equal(plan.duplicateObservations, 1);
 assert.equal(plan.ignoredNonterminal, 1);
 assert.deepEqual(plan.refused.map(item => item.reason), ['INVALID_OR_PRIVATE_URL', 'NOT_DIRECT_HTTP_DIAGNOSTIC']);
 assert.ok(plan.observations.every(item => item.observedAt === date && item.retainedRecord === 'old-request'));
});
test('missing historical dates are refused instead of fabricated from backfill time', () => {
 const plan = planTerminalUrlBackfill([{ crawl: { evidenceManifest: { version: 1, requests: [response('https://venue.org/gone', 404)] } } }]);
 assert.equal(plan.observations.length, 0);
 assert.equal(plan.refused[0]?.reason, 'MISSING_OBSERVATION_DATE');
});
test('apply requires exact approved hash and write bound, is idempotent, and cannot run network', async () => {
 const plan = planTerminalUrlBackfill(exported), saved = new Map<string, TerminalUrlObservation>();
 const history = { get: async (url: string) => saved.get(url) ?? null, set: async (item: TerminalUrlObservation) => { saved.set(item.url, item); } };
 await assert.rejects(applyTerminalUrlBackfill(plan, { history, approvedPlanSha256: 'wrong', maxWrites: 3 }), /NOT_APPROVED/);
 await assert.rejects(applyTerminalUrlBackfill(plan, { history, approvedPlanSha256: plan.planSha256, maxWrites: 2 }), /WRITE_BOUND/);
 assert.equal(saved.size, 0);
 assert.deepEqual(await applyTerminalUrlBackfill(plan, { history, approvedPlanSha256: plan.planSha256, maxWrites: 3 }), { planSha256: plan.planSha256, written: 3, reused: 0, refused: 2 });
 assert.equal((await applyTerminalUrlBackfill(plan, { history, approvedPlanSha256: plan.planSha256, maxWrites: 3 })).reused, 3);
});
test('record and traversal bounds fail closed rather than truncate unseen inventory', () => {
 assert.throws(() => planTerminalUrlBackfill(exported, 0), /RECORD_BOUND/);
 let node: unknown = {}; for (let i = 0; i < 20; i++) node = { nested: node };
 assert.throws(() => planTerminalUrlBackfill([node]), /STRUCTURE_BOUND/);
});
