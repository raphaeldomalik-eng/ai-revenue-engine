#!/usr/bin/env node
// Reviewed, ledgered, idempotent Production migration runner. DRY BY DEFAULT.
//
//   node scripts/release/apply-reviewed-migrations.mjs --manifest release/<manifest>.json                 # plan (read-only)
//   node scripts/release/apply-reviewed-migrations.mjs --manifest ... --rehearse                          # whole pending chain, then ROLLBACK
//   node scripts/release/apply-reviewed-migrations.mjs --manifest ... --apply --confirm <planDigest>      # execute
//
// The connection string is read ONLY from RELEASE_DATABASE_URL (optional PGSSLROOTCERT = path to the Supabase root CA).
// It is never printed: every line of output and every error message is redacted against it.
//
// Guarantees: exact approved source commit (migration bytes are read from git, not the working tree) and per-file SHA-256;
// target identity (project ref must appear in the host or user name, plus database identity queries); a complete plan with a plan
// digest that --apply must echo back; one transaction and one ledger row per migration file; already-applied files are skipped
// only when their ledger row carries the same SHA-256 (a different checksum is a refusal); the first failure or uncertain commit
// stops everything; the queue tables are locked against writers for the duration of each file and compared before/after, so
// existing records, attempts, leases and last errors must be byte-identical or the transaction rolls back.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';

const sha256 = buf => createHash('sha256').update(buf).digest('hex');
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export class ReleaseStop extends Error {constructor(message, code = 'STOPPED') {super(message); this.code = code;}}

export function redactor(secret) {
  const needles = new Set();
  if (secret) {
    needles.add(secret);
    try {
      const u = new URL(secret);
      for (const part of [u.password, decodeURIComponent(u.password)]) if (part && part.length >= 4) needles.add(part); // the role name is not secret
    } catch { /* not a URL: still redact verbatim */ }
  }
  return text => [...needles].reduce((out, needle) => out.split(needle).join('[redacted]'), String(text));
}

function git(cwd, ...args) {
  try {return execFileSync('git', args, {cwd, maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe']});}
  catch (error) {throw new ReleaseStop(`git ${args[0]} failed: ${String(error.stderr || error.message).trim()}`, 'SOURCE_MISMATCH');}
}

export function loadManifest(file) {
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const need = (cond, message) => {if (!cond) throw new ReleaseStop(`Manifest invalid: ${message}`, 'MANIFEST_INVALID');};
  need(manifest.version === 'ReviewedMigrationManifestV1', 'version');
  need(manifest.target?.name && manifest.target?.projectRef && Array.isArray(manifest.target.identity) && manifest.target.identity.length, 'target');
  need(HEX40.test(manifest.source?.approvedCommit || ''), 'source.approvedCommit must be a 40-hex commit');
  need(manifest.source?.migrationDir, 'source.migrationDir');
  need(Array.isArray(manifest.migrations) && manifest.migrations.length, 'migrations');
  manifest.migrations.forEach((m, i) => need(m.ordinal === i + 1 && m.file && m.ledgerName && HEX64.test(m.sha256 || '') && Number.isInteger(m.bytes), `migration ${i + 1} fields`));
  return manifest;
}

/** Read every migration from the approved commit, verify its checksum and refuse anything that would escape this runner's rules. */
export function resolveSource(repoDir, manifest) {
  const commit = manifest.source.approvedCommit;
  git(repoDir, 'cat-file', '-e', `${commit}^{commit}`);
  const head = git(repoDir, 'rev-parse', 'HEAD').toString().trim();
  try {git(repoDir, 'merge-base', '--is-ancestor', commit, 'HEAD');}
  catch {throw new ReleaseStop(`HEAD ${head} does not contain the approved commit ${commit}`, 'SOURCE_MISMATCH');}
  const files = manifest.migrations.map(m => {
    const bytes = git(repoDir, 'show', `${commit}:${manifest.source.migrationDir}/${m.file}`);
    if (bytes.length !== m.bytes) throw new ReleaseStop(`${m.file}: ${bytes.length} bytes at ${commit}, manifest says ${m.bytes}`, 'CHECKSUM_MISMATCH');
    if (sha256(bytes) !== m.sha256) throw new ReleaseStop(`${m.file}: SHA-256 differs from the reviewed value`, 'CHECKSUM_MISMATCH');
    const sql = bytes.toString('utf8');
    const code = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' '); // comments may mention forbidden words
    if (/^\s*(begin|commit|rollback|start\s+transaction)\s*;/im.test(code)) throw new ReleaseStop(`${m.file}: contains transaction control; the runner owns the transaction`, 'REFUSED');
    for (const pattern of manifest.forbiddenSql || []) if (new RegExp(pattern, 'i').test(code)) throw new ReleaseStop(`${m.file}: matches forbidden pattern ${pattern}`, 'REFUSED');
    return {...m, sql};
  });
  return {commit, head, files};
}

export function connectionFor(url, manifest, env = process.env) {
  let parsed;
  try {parsed = new URL(url);} catch {throw new ReleaseStop('RELEASE_DATABASE_URL is not a valid connection URL', 'IDENTITY_MISMATCH');}
  const ref = manifest.target.projectRef;
  const hostOrUser = `${parsed.hostname} ${decodeURIComponent(parsed.username)}`;
  if (!hostOrUser.includes(ref)) throw new ReleaseStop(`Connection host/user does not contain the expected project ref ${ref}; refusing to connect`, 'IDENTITY_MISMATCH');
  const local = ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
  const ssl = local ? false : {rejectUnauthorized: true, ...(env.PGSSLROOTCERT ? {ca: fs.readFileSync(env.PGSSLROOTCERT, 'utf8')} : {})};
  return {connectionString: url, ssl, application_name: 'reviewed-migration-runner', connectionTimeoutMillis: 20000};
}

async function one(client, sql, params = []) {return (await client.query(sql, params)).rows[0];}

async function readLedger(client) {
  const rows = (await client.query('select version,name,idempotency_key from supabase_migrations.schema_migrations')).rows;
  return {rows, byName: new Map(rows.map(r => [r.name, r])), tail: rows.map(r => r.version).sort().at(-1) || null};
}

function classify(files, ledger) {
  const statuses = files.map(f => {
    const row = ledger.byName.get(f.ledgerName);
    if (!row) return 'PENDING';
    return row.idempotency_key === f.sha256 ? 'APPLIED' : 'CHECKSUM_MISMATCH';
  });
  let pending = false;
  statuses.forEach((s, i) => {
    if (s === 'PENDING') pending = true;
    else if (s === 'APPLIED' && pending) statuses[i] = 'OUT_OF_ORDER';
  });
  return statuses;
}

async function checkIdentity(client, manifest) {
  for (const q of manifest.target.identity) {
    const row = await one(client, q.sql);
    if (row?.ok !== true) throw new ReleaseStop(`Target identity check failed: ${q.description}`, 'IDENTITY_MISMATCH');
  }
  const info = await one(client, 'select current_database() db, current_user usr, current_setting(\'server_version_num\') ver');
  return info;
}

const planDigestOf = ({manifest, identity, ledgerTail, files, statuses}) => sha256(JSON.stringify({
  target: manifest.target.name, projectRef: manifest.target.projectRef, database: identity.db, commit: manifest.source.approvedCommit, ledgerTail,
  migrations: files.map((f, i) => [f.ordinal, f.ledgerName, f.sha256, statuses[i]])}));

async function runChecks(client, checks, label, out) {
  const failures = [];
  for (const check of checks) {
    const row = await one(client, check.sql);
    const ok = row?.ok === true;
    out(`    ${ok ? 'PASS' : 'FAIL'}  ${label}${check.description}`);
    if (!ok) failures.push(check.description);
  }
  return failures;
}

async function snapshot(client, manifest) {
  const values = [];
  for (const p of manifest.preserve || []) values.push((await one(client, p.sql)).snapshot);
  return values;
}

/** Run one migration file inside the caller's open transaction. */
async function runInsideTransaction(client, manifest, file, out) {
  await client.query(`set local lock_timeout='${manifest.lockTimeout || '10s'}'`);
  await client.query('select pg_advisory_xact_lock(hashtext($1))', ['reviewed-migration-runner:' + manifest.target.name]);
  for (const table of manifest.lockTables || []) await client.query(`lock table ${table} in share mode`);
  const before = await snapshot(client, manifest);
  await client.query(file.sql);
  const after = await snapshot(client, manifest);
  (manifest.preserve || []).forEach((p, i) => {
    if (before[i] !== after[i]) throw new ReleaseStop(`${file.file}: existing data changed (${p.description}); rolled back`, 'DATA_PRESERVATION_FAILED');
  });
  const failures = await runChecks(client, file.verify || [], '', out);
  if (failures.length) throw new ReleaseStop(`${file.file}: post-migration checks failed (${failures.join('; ')}); rolled back`, 'VERIFY_FAILED');
  const version = (await one(client, `select greatest(to_char(clock_timestamp() at time zone 'utc','YYYYMMDDHH24MISS'),
      (select coalesce(max(version::numeric),0)+1 from supabase_migrations.schema_migrations)::text) v`)).v;
  await client.query('insert into supabase_migrations.schema_migrations(version,name,created_by,idempotency_key) values($1,$2,$3,$4)',
    [version, file.ledgerName, 'reviewed-migration-runner', file.sha256]);
  return version;
}

export async function run({manifestPath, repoDir = process.cwd(), mode = 'plan', confirm = null, env = process.env, out = line => process.stdout.write(line + '\n')}) {
  const url = env.RELEASE_DATABASE_URL;
  const safe = redactor(url);
  const say = line => out(safe(line));
  const manifest = loadManifest(manifestPath);
  if (!url) throw new ReleaseStop('Set RELEASE_DATABASE_URL in your own shell (never in chat or a file) and retry', 'NO_CONNECTION');
  const source = resolveSource(repoDir, manifest);
  say(`SOURCE   repo HEAD ${source.head}`);
  say(`         approved commit ${source.commit}: ${source.files.length} migration file(s) read from git, checksums verified`);
  const client = new pg.Client(connectionFor(url, manifest, env));
  try {
    await client.connect();
  } catch (error) {
    throw new ReleaseStop(`Could not connect: ${safe(error.code || error.message)}`, 'NO_CONNECTION');
  }
  let uncertain = false;
  try {
    const identity = await checkIdentity(client, manifest);
    say(`TARGET   ${manifest.target.name} (project ${manifest.target.projectRef}); database ${identity.db}, login ${identity.usr}, server ${identity.ver}`);
    const ledger = await readLedger(client);
    const statuses = classify(source.files, ledger);
    say(`LEDGER   tail ${ledger.tail}`);
    for (const required of manifest.target.ledgerMustContain || []) if (!ledger.byName.has(required)) throw new ReleaseStop(`Ledger lacks required prior migration ${required}; wrong database or state`, 'IDENTITY_MISMATCH');
    if (statuses[0] === 'PENDING' && manifest.target.expectedLedgerTailBeforeFirst && ledger.tail !== manifest.target.expectedLedgerTailBeforeFirst)
      throw new ReleaseStop(`Ledger tail ${ledger.tail} is not the reviewed ${manifest.target.expectedLedgerTailBeforeFirst}; Production has moved - re-review the plan`, 'LEDGER_DRIFT');
    say('PLAN');
    source.files.forEach((f, i) => say(`  ${f.ordinal}. ${f.ledgerName}  ${f.bytes.toLocaleString('en-GB')} bytes  sha256 ${f.sha256.slice(0, 16)}...  ${statuses[i]}`));
    const bad = statuses.filter(s => !['PENDING', 'APPLIED'].includes(s));
    if (bad.length) throw new ReleaseStop(`Refusing: ${statuses.map((s, i) => `${source.files[i].ledgerName}=${s}`).filter(x => !x.endsWith('PENDING') && !x.endsWith('APPLIED')).join(', ')}`, 'REFUSED');
    const digest = planDigestOf({manifest, identity, ledgerTail: ledger.tail, files: source.files, statuses});
    say(`PLAN DIGEST ${digest}`);
    const pending = source.files.filter((f, i) => statuses[i] === 'PENDING');

    if (!pending.length) {
      say('NOTHING TO APPLY (every migration is already in the ledger with the reviewed checksum). Verifying installed state:');
      const failures = await runChecks(client, manifest.finalVerify || [], '', say);
      if (failures.length) throw new ReleaseStop(`Installed state is wrong: ${failures.join('; ')}`, 'VERIFY_FAILED');
      say('RESULT  OK - installed state verified');
      return {state: 'VERIFIED', digest};
    }
    if (mode === 'plan') {
      say(`DRY RUN complete: ${pending.length} migration(s) would be applied, in the order above. Nothing was changed.`);
      say(`To rehearse the whole chain in one rolled-back transaction: add --rehearse`);
      say(`To execute: add --apply --confirm ${digest}`);
      return {state: 'PLANNED', digest, pending: pending.map(f => f.ledgerName)};
    }
    if (mode === 'rehearse') {
      say('REHEARSAL: running the full pending chain in ONE transaction, then rolling it back.');
      await client.query('begin');
      try {
        for (const f of pending) {say(`  ${f.ordinal}. ${f.ledgerName}`); await runInsideTransaction(client, manifest, f, say);}
        const failures = await runChecks(client, manifest.finalVerify || [], 'final: ', say);
        if (failures.length) throw new ReleaseStop(`Final checks failed: ${failures.join('; ')}`, 'VERIFY_FAILED');
      } finally {await client.query('rollback');}
      say('RESULT  REHEARSAL OK - everything was rolled back; Production is unchanged');
      return {state: 'REHEARSED', digest};
    }
    if (mode !== 'apply') throw new ReleaseStop(`Unknown mode ${mode}`, 'REFUSED');
    if (confirm !== digest) throw new ReleaseStop('--confirm must equal the PLAN DIGEST printed by a fresh dry run of this exact plan', 'CONFIRMATION_REQUIRED');
    const applied = [];
    for (const f of pending) {
      say(`APPLY   ${f.ordinal}. ${f.ledgerName}`);
      await client.query('begin');
      let version;
      try {
        version = await runInsideTransaction(client, manifest, f, say);
      } catch (error) {
        try {await client.query('rollback');} catch { /* connection lost: server aborts the open transaction */ }
        throw error;
      }
      uncertain = true;
      await client.query('commit');
      uncertain = false;
      applied.push(`${f.ledgerName}@${version}`);
      say(`        committed, ledger version ${version}`);
    }
    say('VERIFY  installed state:');
    const failures = await runChecks(client, manifest.finalVerify || [], '', say);
    if (failures.length) throw new ReleaseStop(`Applied but verification failed (${failures.join('; ')}). Do NOT proceed to merges. Report this output.`, 'VERIFY_FAILED');
    say(`RESULT  OK - applied ${applied.length}: ${applied.join(', ')}`);
    return {state: 'APPLIED', digest, applied};
  } catch (error) {
    if (uncertain) throw new ReleaseStop(`UNCERTAIN: the commit outcome is unknown (${safe(error.message)}). Re-run a dry run; the ledger shows exactly what was committed. Do not retry blindly.`, 'UNCERTAIN');
    if (error instanceof ReleaseStop) throw error;
    throw new ReleaseStop(safe(error.message || error), 'STOPPED');
  } finally {
    try {await client.end();} catch { /* ignore */ }
  }
}

function parseArgs(argv) {
  const args = {mode: 'plan'};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--manifest') args.manifestPath = argv[++i];
    else if (a === '--repo') args.repoDir = argv[++i];
    else if (a === '--rehearse') args.mode = 'rehearse';
    else if (a === '--apply') args.mode = 'apply';
    else if (a === '--confirm') args.confirm = argv[++i];
    else throw new ReleaseStop(`Unknown argument ${a}`, 'REFUSED');
  }
  if (!args.manifestPath) throw new ReleaseStop('--manifest is required', 'REFUSED');
  return args;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await run(parseArgs(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`STOPPED [${error.code || 'ERROR'}] ${redactor(process.env.RELEASE_DATABASE_URL)(error.message)}\n`);
    process.exit(error.code === 'CONFIRMATION_REQUIRED' || error.code === 'NO_CONNECTION' ? 2 : 1);
  }
}
