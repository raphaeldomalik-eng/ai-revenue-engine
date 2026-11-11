import assert from 'node:assert/strict';
import test from 'node:test';
import { crawlVerifiedSource } from '../src/nexus/source-discovery/crawler.ts';
import { resultStoreTerminalUrlHistory } from '../src/nexus/source-discovery/terminal-url-history.ts';
import { OriginPoliteness } from '../src/nexus/source-discovery/politeness.ts';
import type { CrawlInput } from '../src/nexus/source-discovery/types.ts';
const origin = 'https://venue.org';
const now = '2026-11-09T12:00:00.000Z';
const values = () => {
  const rows = new Map<string, Record<string, unknown>>();
  return { rows, async get(key: string) { return rows.get(key) ?? null; }, async set(key: string, value: Record<string, unknown>) { rows.set(key, value); } };
};
const budget = { maxPages: 6, maxRequests: 14, maxBytesPerResponse: 500000, maxRedirects: 3, maxRetries: 0, timeoutMs: 1000, minRequestDelayMs: 0 };
function input(store: ReturnType<typeof values>, calls: string[], status = 404): CrawlInput {
 return { verifiedUrl: origin + '/missing', requestedExtractors: ['PUBLIC_CONTACT'], budget, now: () => new Date(now), terminalUrlHistory: resultStoreTerminalUrlHistory(store), politeness: new OriginPoliteness(), resolveHost: async () => [{ address: '8.8.8.8', family: 4 }], fetchImpl: async (url) => { const path = new URL(String(url)).pathname; calls.push(path); return new Response(path === '/working' ? '<html><p>Venue</p></html>' : '', { status: path === '/working' ? 200 : status, headers: { 'content-type': 'text/html' } }); } };
}
for (const status of [404, 410]) test(`exact HTTP ${status} survives a new adapter and never suppresses another URL`, async () => {
 const store = values(), calls: string[] = [];
 const first = await crawlVerifiedSource(input(store, calls, status));
 assert.ok(first.stats.requestCount > 0);
 const after = [...calls];
 const second = await crawlVerifiedSource(input(store, calls, status));
 assert.deepEqual(calls, after);
 assert.equal(second.stats.requestCount, 0);
 assert.equal(second.stats.disposition?.httpStatus, status);
 assert.ok(second.stats.diagnostics?.some(d => d.code === 'TERMINAL_URL_HISTORY' && d.observedAt === now && d.status === status));
 const third = await crawlVerifiedSource({ ...input(store, calls, status), verifiedUrl: origin + '/working' });
 assert.equal(third.documents.length, 1);
 assert.equal(calls.filter(p => p === '/robots.txt').length, 1);
 const held = await resultStoreTerminalUrlHistory(store).get(origin + '/missing');
 assert.equal(held?.status, status);
 assert.equal(held?.source, 'DIRECT_HTTP_RESPONSE');
 assert.equal(held?.observedAt, now);
});
test('403, 503 and transport errors never become terminal URL observations', async () => {
 for (const status of [403, 503]) {
  const store = values(), calls: string[] = [];
  await crawlVerifiedSource(input(store, calls, status));
  await crawlVerifiedSource(input(store, calls, status));
  assert.equal(store.rows.size, 0);
  assert.equal(calls.length, 2);
 }
 const store = values();
 await crawlVerifiedSource({ ...input(store, []), fetchImpl: async () => { throw new Error('third-party transport failure'); } });
 assert.equal(store.rows.size, 0);
});
test('history preserves query, path and scheme identity and ignores fragments', async () => {
 const store = values(), history = resultStoreTerminalUrlHistory(store);
 await history.set({ url: origin + '/missing?a=1#section', status: 404, observedAt: now, source: 'DIRECT_HTTP_RESPONSE' });
 assert.equal((await history.get(origin + '/missing?a=1'))?.status, 404);
 assert.equal(await history.get(origin + '/missing?a=2'), null);
 assert.equal(await history.get(origin + '/Missing?a=1'), null);
 assert.equal(await history.get(origin + '/other?a=1'), null);
});
test('linked pages and sitemap terminal statuses are retained, not just entry failures', async () => {
 const store = values(), calls: string[] = [];
 const make = () => ({ ...input(store, calls), verifiedUrl: origin + '/', emailGoal: true, seedUrls: [origin + '/contact'], fetchImpl: async (url: RequestInfo | URL) => {
  const path = new URL(String(url)).pathname; calls.push(path);
  if (path === '/') return new Response('<html><a href="/contact">Contact</a></html>', { headers: { 'content-type': 'text/html' } });
  if (path === '/robots.txt') return new Response('User-agent: *\nSitemap: https://venue.org/sitemap.xml', { headers: { 'content-type': 'text/plain' } });
  return new Response('', { status: path === '/contact' ? 410 : 404 });
 } });
 await crawlVerifiedSource(make());
 assert.ok(calls.includes('/contact'));
 assert.ok(calls.includes('/sitemap.xml'));
 const firstCounts = new Map(calls.map(path => [path, calls.filter(p => p === path).length]));
 await crawlVerifiedSource(make());
 for (const path of ['/contact', '/sitemap.xml']) assert.equal(calls.filter(p => p === path).length, firstCounts.get(path));
 assert.equal(calls.filter(p => p === '/').length, 2);
});
test('terminal history overrides older successful document cache and retains oversized HTTP error status', async () => {
 const store = values(), calls: string[] = [];
 await crawlVerifiedSource({ ...input(store, calls), fetchImpl: async url => { calls.push(String(url)); return new Response('ignored body', { status: 404, headers: { 'content-length': '999999999' } }); } });
 const second = await crawlVerifiedSource({ ...input(store, calls), freshnessMaxAgeHours: 24, documentCache: { get: async url => ({ url, body: '<html>Stale</html>', contentType: 'text/html', bytes: 18, sourceHash: 'stale', observedAt: now, etag: null, lastModified: null }), set: async () => {} } });
 assert.equal(second.documents.length, 0);
 assert.equal(second.stats.requestCount, 0);
 assert.equal(second.stats.disposition?.httpStatus, 404);
});
test('history outages fail closed without network or fabricated HTTP status', async () => {
 const store = values(), calls: string[] = [];
 const result = await crawlVerifiedSource({ ...input(store, calls), terminalUrlHistory: { get: async () => { throw new Error('database down'); }, set: async () => {} } });
 assert.equal(calls.length, 0);
 assert.equal(result.stats.disposition?.httpStatus, null);
 assert.equal(result.stats.failureClass, 'TERMINAL');
 assert.equal(result.stats.disposition?.code, 'TERMINAL_URL_HISTORY_READ_FAILED');
});
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseDirectoryResultStore } from '../src/nexus/source-discovery/continuous-directory-store.ts';
test('directory history uses durable result ledger without invalid directory result RPC and survives store restart', async () => {
 const rows = new Map<string, Record<string, unknown>>();
 let rpcCalls = 0;
 const client = { rpc: async () => { rpcCalls++; throw new Error('DIRECTORY_RESULT_INVALID'); }, from: (table: string) => {
  assert.equal(table, 'nexus_executor_results');
  return { select: () => ({ eq: (_: string, key: string) => ({ maybeSingle: async () => ({ data: rows.has(key) ? { result_payload: rows.get(key) } : null, error: null }) }) }),
   upsert: async (row: { idempotency_key: string; request_id: string; result_payload: Record<string, unknown> }, options: { ignoreDuplicates: boolean }) => {
    assert.equal(row.idempotency_key, row.request_id); assert.equal(options.ignoreDuplicates, true);
    if (!rows.has(row.idempotency_key)) rows.set(row.idempotency_key, row.result_payload);
    return { error: null };
   } };
 } } as unknown as SupabaseClient;
 const first = new SupabaseDirectoryResultStore(client);
 await first.terminalUrlHistory.set({ url: origin + '/missing', status: 410, observedAt: now, source: 'DIRECT_HTTP_RESPONSE' });
 const restarted = new SupabaseDirectoryResultStore(client);
 assert.equal((await restarted.terminalUrlHistory.get(origin + '/missing'))?.status, 410);
 await restarted.terminalUrlHistory.set({ url: origin + '/missing', status: 404, observedAt: '2027-01-01T00:00:00Z', source: 'DIRECT_HTTP_RESPONSE' });
 assert.equal((await restarted.terminalUrlHistory.get(origin + '/missing'))?.observedAt, now);
 assert.equal(rpcCalls, 0);
});
test('malformed and private URLs remain refused, even when history is supplied', async () => {
 for (const url of ['http://venue.org/missing', 'https://127.0.0.1/missing', 'not a URL']) {
  const calls: string[] = [], store = values();
  await assert.rejects(crawlVerifiedSource({ ...input(store, calls), verifiedUrl: url }), /public HTTPS/);
  assert.equal(calls.length, 0);
 }
});
test('queued requests with different headers recheck durable history before a second fetch', async () => {
 const store = values(), calls: string[] = [], politeness = new OriginPoliteness();
 const a = { ...input(store, calls), politeness };
 const b = { ...input(store, calls), politeness, documentCache: { get: async (url: string) => ({ url, body: '<html>Old</html>', contentType: 'text/html', bytes: 16, sourceHash: 'old', observedAt: '2020-01-01T00:00:00Z', etag: 'old-version', lastModified: null }), set: async () => {} } };
 await Promise.all([crawlVerifiedSource(a), crawlVerifiedSource(b)]);
 assert.equal(calls.filter(p => p === '/missing').length, 1);
});
import { executeOfficialWebsiteDiscovery } from '../src/nexus/official-website-discovery.ts';
import { CONTRACTS } from '../src/nexus/contracts.ts';
import { crawlVenueOfficialSite } from '../src/nexus/source-discovery/venue/crawl.ts';
test('official website verification reuses terminal evidence across request identities', async () => {
 const store = values(), calls: string[] = [], fixture = input(store, calls);
 const request = { contractVersion: CONTRACTS.OFFICIAL_WEBSITE_DISCOVERY_REQUEST, requestId: '11111111-1111-4111-8111-111111111111', idempotencyKey: '22222222-2222-4222-8222-222222222222', correlationId: '33333333-3333-4333-8333-333333333333', originatingProduct: 'event_suite_resources', subject: { canonicalEntityId: '44444444-4444-4444-8444-444444444444', candidateReference: null, entityType: 'VENUE' }, identity: { venueName: 'Cornex Hall', locality: 'Bristol', country: 'GB' }, heldEvidence: { resources: { website: origin + '/missing', evidenceRef: 'resources:listing:1' } }, providerAllowances: ['PUBLIC_WEB'], costCeiling: { currency: 'USD', amount: 0 }, requestedBy: { actorType: 'SYSTEM', actorId: 'fixture' }, createdAt: now };
 const options = { fetchImpl: fixture.fetchImpl, resolveHost: fixture.resolveHost, now: () => now, verificationBudget: { minRequestDelayMs: 0 } };
 await executeOfficialWebsiteDiscovery(request, options, store);
 const first = [...calls];
 assert.ok(calls.includes('/missing'));
 await executeOfficialWebsiteDiscovery({ ...request, requestId: '55555555-5555-4555-8555-555555555555', idempotencyKey: '66666666-6666-4666-8666-666666666666' }, options, store);
 assert.deepEqual(calls, first);
});
test('venue wrapper passes terminal history to the shared crawler', async () => {
 const store = values(), calls: string[] = [];
 const base = input(store, calls);
 const options = { ...base, authorisedUrl: base.verifiedUrl };
 await crawlVenueOfficialSite(options);
 const first = [...calls];
 await crawlVenueOfficialSite(options);
 assert.deepEqual(calls, first);
});
import { executeSourceDiscoveryRequest } from '../src/nexus/executor.ts';
test('source discovery preserves terminal evidence across a lost result write and a new request', async () => {
 const backing = values(), calls: string[] = [], fixture = input(backing, calls);
 let failResultWrite = true;
 const store = { get: backing.get, async set(key: string, value: Record<string, unknown>) { if (!key.startsWith('terminal-url:') && failResultWrite) { throw new Error('lost result completion'); } await backing.set(key, value); } };
 const request = { contractVersion: CONTRACTS.SOURCE_DISCOVERY_REQUEST, discoveryRequestId: '11111111-1111-4111-8111-111111111111', idempotencyKey: '22222222-2222-4222-8222-222222222222', correlationId: '33333333-3333-4333-8333-333333333333', originatingProduct: 'event_suite_resources', subjectReference: { canonicalEntityId: null, candidateReference: { sourceSystem: 'event_suite_resources', sourceRecordId: 'Example Venue' }, entityType: 'VENUE' }, verifiedSourceUrl: origin + '/missing', requestedExtractors: ['IDENTITY'], freshnessRequirements: { maxAgeHours: 24 }, crawlBudget: budget, existingEvidenceRefs: [], requestedBy: { actorType: 'PRODUCT', actorId: 'resources' }, createdAt: now };
 const options = { fetchImpl: fixture.fetchImpl, resolveHost: fixture.resolveHost, now: () => now, politeness: new OriginPoliteness() };
 await assert.rejects(executeSourceDiscoveryRequest(request, options, store), /lost result completion/);
 failResultWrite = false;
 const first = [...calls];
 assert.ok(first.includes('/missing'));
 await executeSourceDiscoveryRequest({ ...request, discoveryRequestId: '55555555-5555-4555-8555-555555555555', idempotencyKey: '66666666-6666-4666-8666-666666666666' }, options, store);
 assert.deepEqual(calls, first);
});
import { venueCrawlProfiles, VENUE_EXTRACTORS } from '../src/nexus/source-discovery/venue/profiles.ts';
for (const failedPath of ['/robots.txt', '/contact', '/sitemap.xml']) test(`history write failure at ${failedPath} aborts all remaining crawl work`, async () => {
 const calls: string[] = [], base = input(values(), calls);
 const result = await crawlVerifiedSource({ ...base, verifiedUrl: origin + '/', requestedExtractors: [...VENUE_EXTRACTORS], profiles: venueCrawlProfiles(undefined, { completeContent: true }), budget: { ...budget, maxSitemapFetches: failedPath === '/sitemap.xml' ? 2 : 0 }, terminalUrlHistory: { get: async () => null, set: async () => { throw new Error('DB write rejected'); } }, fetchImpl: async value => {
  const path = new URL(String(value)).pathname; calls.push(path);
  if (path === failedPath) return new Response('', { status: 404 });
  if (path === '/robots.txt') return new Response('User-agent: *\nAllow: /\nSitemap: https://venue.org/sitemap.xml');
  return new Response(path === '/' && failedPath !== '/sitemap.xml' ? '<html><title>Alpha Hall</title><a href="/contact">Contact</a><a href="/hire">Private Hire</a><a href="/gallery">Gallery</a></html>' : '<html><title>Alpha Hall</title><p>A venue.</p></html>', { headers: { 'content-type': 'text/html' } });
 } });
 assert.ok(calls.includes(failedPath));
 assert.equal(calls.at(-1), failedPath, JSON.stringify(calls));
 assert.equal(result.stats.status, 'BLOCKED');
 assert.equal(result.documents.length, 0);
 assert.equal(result.stats.pageCount, 0);
 assert.equal(result.evidenceManifest?.pages.length, 0);
 assert.equal(result.stats.disposition?.code, 'TERMINAL_URL_HISTORY_WRITE_FAILED');
 assert.equal(result.stats.disposition?.retryable, false);
 assert.equal(result.stats.disposition?.httpStatus, 404);
 assert.equal(result.stats.requestCount, calls.length);
 assert.ok(result.stats.diagnostics?.some(d => d.url === origin + failedPath && d.status === 404 && d.code === 'HTTP_404'));
});
test('a child history read failure blocks the whole crawl instead of becoming a skippable gap', async () => {
 const calls: string[] = [];
 const result = await crawlVerifiedSource({ ...input(values(), calls), verifiedUrl: origin + '/', seedUrls: [origin + '/contact'], terminalUrlHistory: { get: async url => { if (url.endsWith('/contact')) throw new Error('DB read down'); return null; }, set: async () => {} }, fetchImpl: async value => { const path = new URL(String(value)).pathname; calls.push(path); return new Response(path === '/robots.txt' ? 'User-agent: *\nAllow: /' : '<html><a href="/contact">Contact</a><a href="/gallery">Gallery</a></html>', { headers: { 'content-type': 'text/html' } }); } });
 assert.equal(result.stats.status, 'BLOCKED');
 assert.equal(result.stats.disposition?.code, 'TERMINAL_URL_HISTORY_READ_FAILED');
 assert.equal(calls.includes('/contact'), false);
 assert.equal(result.documents.length, 0);
});
test('legacy linked-page history write failure cannot be swallowed or rendered', async () => {
 const calls: string[] = []; let renders = 0;
 const result = await crawlVerifiedSource({ ...input(values(), calls), verifiedUrl: origin + '/', profiles: [], terminalUrlHistory: { get: async () => null, set: async () => { throw new Error('DB write rejected'); } }, renderAdapter: { name: 'fixture', render: async () => { renders++; return { finalUrl: origin, html: '<html>Never</html>' }; } }, fetchImpl: async value => {
  const path = new URL(String(value)).pathname; calls.push(path);
  if (path === '/robots.txt') return new Response('User-agent: *\nAllow: /');
  if (path === '/contact') return new Response('', { status: 410 });
  return new Response('<html><title>Alpha Hall</title><p>Alpha Hall is a lovely venue with room for events and functions.</p><a href="/contact">Contact</a><a href="/venue-hire">Venue hire</a></html>', { headers: { 'content-type': 'text/html' } });
 } });
 assert.ok(calls.includes('/contact'));
 assert.equal(calls.at(-1), '/contact');
 assert.equal(result.stats.status, 'BLOCKED');
 assert.equal(result.stats.disposition?.httpStatus, 410);
 assert.equal(result.stats.requestCount, calls.length);
 assert.equal(result.documents.length, 0);
 assert.equal(renders, 0);
});
test('executor retains counted blocked history failure rather than its zero-request generic error fallback', async () => {
 const backing = values(), calls: string[] = [], fixture = input(backing, calls);
 const store = { get: backing.get, async set(key: string, value: Record<string, unknown>) { if (key.startsWith('terminal-url:')) throw new Error('history DB write failed'); await backing.set(key, value); } };
 const request = { contractVersion: CONTRACTS.SOURCE_DISCOVERY_REQUEST, discoveryRequestId: '11111111-1111-4111-8111-111111111111', idempotencyKey: '22222222-2222-4222-8222-222222222222', correlationId: '33333333-3333-4333-8333-333333333333', originatingProduct: 'event_suite_resources', subjectReference: { canonicalEntityId: null, candidateReference: { sourceSystem: 'event_suite_resources', sourceRecordId: 'Example Venue' }, entityType: 'VENUE' }, verifiedSourceUrl: origin + '/', requestedExtractors: ['PUBLIC_CONTACT'], freshnessRequirements: { maxAgeHours: 24 }, crawlBudget: budget, existingEvidenceRefs: [], requestedBy: { actorType: 'PRODUCT', actorId: 'resources' }, createdAt: now };
 const result = await executeSourceDiscoveryRequest(request, { fetchImpl: async value => { const path = new URL(String(value)).pathname; calls.push(path); return path === '/robots.txt' ? new Response('User-agent: *\nAllow: /') : path === '/contact' ? new Response('', { status: 404 }) : new Response('<html><title>Example Venue</title><a href="/contact">Contact</a></html>', { headers: { 'content-type': 'text/html' } }); }, resolveHost: fixture.resolveHost, now: () => now, politeness: new OriginPoliteness() }, store) as { crawl: { status: string; requestCount: number; retryable: boolean; evidenceManifest: { requests: Array<{status: number}> } } };
 assert.equal(result.crawl.status, 'BLOCKED');
 assert.equal(result.crawl.requestCount, calls.length);
 assert.ok(result.crawl.requestCount > 0);
 assert.equal(result.crawl.retryable, false);
 assert.equal(result.crawl.evidenceManifest.requests.at(-1)?.status, 404);
});
