import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID, createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {run, loadManifest, resolveSource, ledgerFingerprint} from '../scripts/release/apply-reviewed-migrations.mjs';

// Real PostgreSQL proof of the AIRE acceleration migration and its reviewed runner/rollback, against a database shaped like Production:
// the four tables public.reserve_directory_search uses (columns, defaults and constraints read from the Production catalog), the
// Production-exact installed reserve_directory_search (md5 9d6350c1..., 6,139 characters), the Supabase-style roles, a migration ledger
// and default privileges. Two helper functions the release does not touch are test doubles (see the schema fixture header).
const connection = process.env.SHARED_EXECUTION_TEST_URL;
const MANIFEST = fileURLToPath(new URL('../release/resources-v2-aire-migrations.json', import.meta.url));
const REPO = fileURLToPath(new URL('..', import.meta.url));
const fixture = name => fs.readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8');
const approvedAvailable = (() => {try {execFileSync('git', ['cat-file', '-e', JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).source.approvedCommit + '^{commit}'], {cwd: REPO, stdio: 'ignore'}); return true;} catch {return false;}})();
const PASSWORD = 's3cr3t-Pa55word';
const RESERVE_MD5 = '9d6350c1edce3956c5b11f91ab023857';
const POLICY = 'resources-sa-uk-per-run-20261025';
const POLICY_SHA = 'e'.repeat(64);
const FIXTURE_HISTORY = [{version: '20261102150000', name: 'resources_initial_inventory_phase'}, {version: '20261102162851', name: 'resources_initial_http_clearance'}];
let currentDatabase = null;

async function productionLikeDatabase() {
  const target = new URL(connection); assert.equal(target.hostname, '127.0.0.1');
  const name = 'airerun_' + randomUUID().replaceAll('-', '');
  currentDatabase = name;
  const admin = new pg.Client({connectionString: connection}); await admin.connect();
  for (const role of ['anon', 'authenticated', 'service_role']) await admin.query(`do $$begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role};end if;end$$`);
  await admin.query(`do $$begin if not exists(select 1 from pg_roles where rolname='postgres.airt') then create role "postgres.airt" superuser login;end if;end$$`);
  await admin.query(`create database ${name}`);
  const direct = new URL(connection); direct.pathname = '/' + name; direct.username = 'postgres.airt'; direct.password = PASSWORD;
  const db = new pg.Client({connectionString: direct.href}); await db.connect();
  await db.query(`create schema auth;create schema supabase_migrations;
    grant usage on schema public to service_role;
    create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;
    create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text,created_by text,idempotency_key text,rollback text[]);`);
  await db.query(fixture('resources-production-aire-schema.sql'));
  await db.query(fixture('resources-production-reserve-directory-search.sql'));
  await db.query(`insert into supabase_migrations.schema_migrations(version,name) values('20261102150000','resources_initial_inventory_phase'),('20261102162851','resources_initial_http_clearance')`);
  await db.query(`grant select,insert,update on all tables in schema public to service_role;grant execute on function public.reserve_directory_search(jsonb) to service_role;
    revoke execute on function public.reserve_directory_search(jsonb) from public,anon,authenticated`);
  // The standing policy exactly as it matters here: Serper 100/day, per-run cap 8, an enabled run in the INITIAL_INVENTORY phase.
  await db.query(`insert into public.nexus_directory_standing_policy(policy_id,policy_sha256,policy,enabled) values($1,$2,$3::jsonb,true)`,
    [POLICY, POLICY_SHA, JSON.stringify({standing: true, paidProviderBudgetUsd: 0.05, serperMaxRequestsPerDay: 100, braveMaxRequestsPerDay: 50, minHostDelayMs: 1500})]);
  await db.query(`insert into public.nexus_directory_search_allowance(allowance_id,allocated_micro_usd,price_per_request_micro_usd,max_requests,verified_at,expires_at,verification_ref,enabled,provider_id,requires_run,policy_id)
    values('serper-1',5000000,1000,5000,now()-interval '1 day',now()+interval '30 days','receipt-ref-1',true,'serper-google-search',true,$1)`, [POLICY]);
  await db.query(`insert into public.nexus_directory_run(policy_id,policy_sha256,worker_id,max_venues,max_requests,serper_max_requests,execution_phase) values($1,$2,'w1',10,100,8,'INITIAL_INVENTORY')`, [POLICY, POLICY_SHA]);
  return {db, url: direct.href, name, close: async () => {await db.end(); await admin.query(`drop database ${name} with (force)`); await admin.end();}};
}

function manifestFor(mutate) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  manifest.target.projectRef = 'airt';
  manifest.target.database = currentDatabase;
  manifest.target.ledgerHistory = {throughVersion: '20261102162851', ...ledgerFingerprint(FIXTURE_HISTORY, '20261102162851')};
  mutate?.(manifest);
  const file = path.join(os.tmpdir(), 'aire_manifest_' + randomUUID() + '.json');
  fs.writeFileSync(file, JSON.stringify(manifest));
  return file;
}
const capture = () => {const lines = []; return {lines, out: line => lines.push(line), text: () => lines.join('\n')};};
const ledgerNames = db => db.query('select name,idempotency_key from supabase_migrations.schema_migrations order by version').then(r => r.rows);
const reserveMd5 = db => db.query("select md5(replace(pg_get_functiondef('public.reserve_directory_search(jsonb)'::regprocedure),chr(13),'')) h").then(r => r.rows[0].h);
const policyHash = db => db.query("select md5(string_agg(md5(p::text),',')) h from public.nexus_directory_standing_policy p").then(r => r.rows[0].h);
const env = url => ({RELEASE_DATABASE_URL: url});

async function seedToday(db, count) {
  for (let i = 0; i < count; i++) await db.query(`insert into public.nexus_directory_search_receipt(query_sha256,allowance_id,request_key,parameters,reserved_micro_usd,reserved_at)
    values($1,'serper-1',$2,'{}'::jsonb,1000,date_trunc('day',now() at time zone 'UTC') at time zone 'UTC' + interval '1 second')`, [createHash('sha256').update('seed' + i).digest('hex'), 'seed-' + i]);
}
async function reserve(db, n) {
  await db.query("select set_config('request.jwt.claim.role','service_role',false)");
  const runId = (await db.query('select run_id from public.nexus_directory_run limit 1')).rows[0].run_id;
  const r = await db.query('select public.reserve_directory_search($1::jsonb) r', [JSON.stringify({allowanceId: 'serper-1', querySha256: createHash('sha256').update('q' + n + randomUUID()).digest('hex'), requestKey: 'k' + n, runId, parameters: {provider: 'serper-google-search'}})]);
  return r.rows[0].r;
}

test('the committed manifest matches the approved commit and the fixture reproduces the Production definition', {skip: !approvedAvailable}, () => {
  const manifest = loadManifest(MANIFEST);
  assert.deepEqual(manifest.migrations.map(m => m.file.slice(0, 14)), ['20261111100000']);
  assert.equal(resolveSource(REPO, manifest).files.length, 1);
  assert.equal(createHash('md5').update(fixture('resources-production-reserve-directory-search.sql')).digest('hex'), RESERVE_MD5, 'the Production-exact definition text');
});

test('real PostgreSQL: plan shows limits and safety checks, the pre-release state is the reviewed one, nothing is changed', {skip: !connection || !approvedAvailable, timeout: 120000}, async () => {
  const {db, url, close} = await productionLikeDatabase();
  try {
    assert.equal(await reserveMd5(db), RESERVE_MD5, 'fixture function equals Production');
    const before = await policyHash(db), log = capture();
    const planned = await run({manifestPath: manifestFor(), repoDir: REPO, env: env(url), out: log.out});
    assert.equal(planned.state, 'PLANNED');
    const text = log.text();
    assert.match(text, /PRE-STATE/); assert.match(text, /PASS  .*exactly the reviewed pre-release definition/); assert.match(text, /LIMITS   lock 10s/); assert.match(text, /\(own limits: lock_timeout=5s, statement_timeout=30s\)/);
    assert.match(text, /RUNNER   sha256 [0-9a-f]{64}/); assert.match(text, /MANIFEST sha256 [0-9a-f]{64}/); assert.equal(text.includes(PASSWORD), false);
    assert.equal(await reserveMd5(db), RESERVE_MD5); assert.equal(await policyHash(db), before); assert.equal((await ledgerNames(db)).length, 2);
    await assert.rejects(() => run({manifestPath: manifestFor(), repoDir: REPO, mode: 'apply', env: env(url), out: () => {}}), error => error.code === 'CONFIRMATION_REQUIRED');
    await assert.rejects(() => run({manifestPath: manifestFor(m => {m.target.database = 'postgres';}), repoDir: REPO, env: env(url), out: () => {}}), error => error.code === 'IDENTITY_MISMATCH');
    await assert.rejects(() => run({manifestPath: manifestFor(m => {m.target.ledgerHistory.sha256 = '0'.repeat(64);}), repoDir: REPO, env: env(url), out: () => {}}), error => error.code === 'IDENTITY_MISMATCH');
    await db.query("alter function public.reserve_directory_search(jsonb) set statement_timeout='45s'");
    await assert.rejects(() => run({manifestPath: manifestFor(), repoDir: REPO, env: env(url), out: () => {}}), error => error.code === 'IDENTITY_MISMATCH' && /Pre-release state differs/.test(error.message));
  } finally {await close();}
});

test('real PostgreSQL: rehearsal rolls back, apply installs the gate once, inert until enabled; the ceiling is lifted only for an enabled INITIAL_INVENTORY row', {skip: !connection || !approvedAvailable, timeout: 240000}, async () => {
  const {db, url, close} = await productionLikeDatabase();
  try {
    const manifestPath = manifestFor();
    const policyBefore = await policyHash(db);
    const planned = await run({manifestPath, repoDir: REPO, env: env(url), out: () => {}});
    assert.equal((await run({manifestPath, repoDir: REPO, mode: 'rehearse', env: env(url), out: () => {}})).state, 'REHEARSED');
    assert.equal(await reserveMd5(db), RESERVE_MD5, 'rehearsal changed nothing');
    const log = capture();
    const done = await run({manifestPath, repoDir: REPO, mode: 'apply', confirm: planned.digest, env: env(url), out: log.out});
    assert.equal(done.state, 'APPLIED'); assert.match(log.text(), /RESULT  OK - applied 1/); assert.match(log.text(), /under the queue-table lock/);
    const ledger = await ledgerNames(db);
    assert.deepEqual(ledger.slice(2).map(r => [r.name, r.idempotency_key]), [['resources_inventory_search_acceleration', loadManifest(manifestPath).migrations[0].sha256]]);
    assert.equal(await policyHash(db), policyBefore, 'the standing policy and so its hash are untouched');
    assert.equal((await db.query('select count(*)::int n from public.nexus_directory_inventory_acceleration')).rows[0].n, 0, 'created empty: acceleration is OFF');
    // Behaviour on real PostgreSQL. 100 Serper searches today = the hard-coded daily ceiling.
    await seedToday(db, 100);
    assert.equal((await reserve(db, 1)).reason, 'PROVIDER_DAILY_BUDGET', 'OFF: the daily ceiling still applies');
    await db.query("insert into public.nexus_directory_inventory_acceleration(policy_id,enabled,serper_daily_limit,authorisation_ref,enabled_at) values($1,false,null,'owner-approval-20261111',now())", [POLICY]);
    assert.equal((await reserve(db, 2)).reason, 'PROVIDER_DAILY_BUDGET', 'a disabled row changes nothing');
    await db.query('update public.nexus_directory_inventory_acceleration set enabled=true');
    assert.equal((await reserve(db, 3)).state, 'RESERVED', 'enabled with no internal ceiling: the daily ceiling no longer blocks');
    await db.query('update public.nexus_directory_inventory_acceleration set serper_daily_limit=101');
    assert.equal((await reserve(db, 4)).reason, 'PROVIDER_DAILY_BUDGET', 'a bounded limit is honoured (101 reached)');
    await db.query('update public.nexus_directory_inventory_acceleration set serper_daily_limit=null');
    await db.query('update public.nexus_directory_run set execution_phase=\'ONGOING_ENRICHMENT\'');
    assert.equal((await reserve(db, 5)).reason, 'PROVIDER_DAILY_BUDGET', 'recurring enrichment never uses it');
    await db.query("update public.nexus_directory_run set execution_phase='INITIAL_INVENTORY'");
    await db.query('update public.nexus_directory_standing_policy set initial_inventory_completed_at=now()');
    assert.equal((await reserve(db, 6)).reason, 'PROVIDER_DAILY_BUDGET', 'after the initial inventory completes it no longer applies');
    await db.query('update public.nexus_directory_standing_policy set initial_inventory_completed_at=null');
    await db.query('update public.nexus_directory_run set serper_requests=serper_max_requests');
    assert.equal((await reserve(db, 7)).reason, 'RUN_PROVIDER_BUDGET', 'the per-run request cap still applies');
    // Idempotent.
    const again = capture();
    const verified = await run({manifestPath, repoDir: REPO, env: env(url), out: again.out});
    assert.equal(verified.state, 'VERIFIED'); assert.match(again.text(), /NOTHING TO APPLY/);
    assert.equal((await ledgerNames(db)).length, 3);
  } finally {await close();}
});

test('real PostgreSQL: the reviewed rollback restores the pre-release function exactly; an enabled control row is kept, and the release can be applied again', {skip: !connection || !approvedAvailable, timeout: 240000}, async () => {
  const {db, url, close} = await productionLikeDatabase();
  try {
    const manifestPath = manifestFor();
    const planned = await run({manifestPath, repoDir: REPO, env: env(url), out: () => {}});
    await run({manifestPath, repoDir: REPO, mode: 'apply', confirm: planned.digest, env: env(url), out: () => {}});
    assert.notEqual(await reserveMd5(db), RESERVE_MD5);
    const policyAfter = await policyHash(db);
    const plan = await run({manifestPath, repoDir: REPO, operation: 'rollback', env: env(url), out: () => {}});
    assert.equal(plan.state, 'ROLLBACK_PLANNED');
    await assert.rejects(() => run({manifestPath, repoDir: REPO, operation: 'rollback', mode: 'apply', confirm: planned.digest, env: env(url), out: () => {}}), error => error.code === 'CONFIRMATION_REQUIRED');
    assert.equal((await run({manifestPath, repoDir: REPO, operation: 'rollback', mode: 'rehearse', env: env(url), out: () => {}})).state, 'ROLLBACK_REHEARSED');
    assert.equal((await ledgerNames(db)).length, 3);
    assert.equal((await run({manifestPath, repoDir: REPO, operation: 'rollback', mode: 'apply', confirm: plan.digest, env: env(url), out: () => {}})).state, 'ROLLED_BACK');
    assert.equal(await reserveMd5(db), RESERVE_MD5, 'byte-equivalent to the pre-release definition');
    assert.equal(await policyHash(db), policyAfter); assert.equal((await ledgerNames(db)).length, 2);
    assert.deepEqual((await db.query("select to_regclass('public.nexus_directory_inventory_acceleration') t, to_regprocedure('public.directory_inventory_acceleration_allows(text,text,text,bigint)') f")).rows[0], {t: null, f: null});
    assert.equal((await run({manifestPath, repoDir: REPO, operation: 'rollback', env: env(url), out: () => {}})).state, 'NOTHING_TO_ROLL_BACK');
    // Re-apply, enable a row, roll back again: the old ceiling returns at once and the authorisation row is not lost.
    const replan = await run({manifestPath, repoDir: REPO, env: env(url), out: () => {}});
    await run({manifestPath, repoDir: REPO, mode: 'apply', confirm: replan.digest, env: env(url), out: () => {}});
    await db.query("insert into public.nexus_directory_inventory_acceleration(policy_id,enabled,authorisation_ref,enabled_at) values($1,true,'owner-approval-20261111',now())", [POLICY]);
    await seedToday(db, 100);
    assert.equal((await reserve(db, 1)).state, 'RESERVED');
    const rb = await run({manifestPath, repoDir: REPO, operation: 'rollback', env: env(url), out: () => {}});
    await run({manifestPath, repoDir: REPO, operation: 'rollback', mode: 'apply', confirm: rb.digest, env: env(url), out: () => {}});
    assert.equal(await reserveMd5(db), RESERVE_MD5);
    assert.equal((await reserve(db, 2)).reason, 'PROVIDER_DAILY_BUDGET', 'ceiling restored immediately');
    assert.equal((await db.query('select count(*)::int n from public.nexus_directory_inventory_acceleration where enabled')).rows[0].n, 1, 'the control row is kept');
  } finally {await close();}
});

test('real PostgreSQL: a policy change made during the file is detected by the full-row comparison and rolled back; a foreign ledger change is caught under the lock', {skip: !connection || !approvedAvailable, timeout: 240000}, async () => {
  const {db, url, close} = await productionLikeDatabase();
  try {
    await db.query(`create function public.tamper() returns event_trigger language plpgsql as $$ begin
      update public.nexus_directory_standing_policy set policy=jsonb_set(policy,'{serperMaxRequestsPerDay}','101'); end $$;
      create event trigger tamper_after_function on ddl_command_end when tag in ('CREATE FUNCTION') execute function public.tamper();`);
    const manifestPath = manifestFor();
    await db.query('alter event trigger tamper_after_function disable');
    const planned = await run({manifestPath, repoDir: REPO, env: env(url), out: () => {}});
    await db.query('alter event trigger tamper_after_function enable');
    const before = await policyHash(db);
    await assert.rejects(() => run({manifestPath, repoDir: REPO, mode: 'apply', confirm: planned.digest, env: env(url), out: () => {}}), error => error.code === 'DATA_PRESERVATION_FAILED');
    assert.equal(await policyHash(db), before); assert.equal((await ledgerNames(db)).length, 2); assert.equal(await reserveMd5(db), RESERVE_MD5);
    await db.query('drop event trigger tamper_after_function');
    const again = await run({manifestPath, repoDir: REPO, env: env(url), out: () => {}});
    const hooks = {beforeFile: async () => {await db.query("insert into supabase_migrations.schema_migrations(version,name) values('20261111120000','a_foreign_release')");}};
    await assert.rejects(() => run({manifestPath, repoDir: REPO, mode: 'apply', confirm: again.digest, env: env(url), out: () => {}, hooks}), error => error.code === 'LEDGER_DRIFT');
    assert.equal(await reserveMd5(db), RESERVE_MD5);
  } finally {await close();}
});
