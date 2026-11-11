#!/usr/bin/env node
// Reviewed, ledgered, idempotent Production migration runner. DRY BY DEFAULT.
//
//   node scripts/release/apply-reviewed-migrations.mjs --manifest release/<manifest>.json                           # plan (read-only)
//   node scripts/release/apply-reviewed-migrations.mjs --manifest ... --rehearse                                    # whole pending chain, then ROLLBACK
//   node scripts/release/apply-reviewed-migrations.mjs --manifest ... --apply --confirm <planDigest>                # execute
//   node scripts/release/apply-reviewed-migrations.mjs --manifest ... --rollback [--rehearse | --apply --confirm <digest>]   # reviewed undo
//
// The connection string is read ONLY from RELEASE_DATABASE_URL (PGSSLROOTCERT = path to the Supabase root CA, required for any
// non-loopback host). It is never printed: every line of output and every error message is redacted against it.
//
// What the confirmation digest covers (so --apply is bound to the complete reviewed instructions, not just the file list):
//   this runner's own bytes, the manifest's bytes (every identity, pre-state, preservation, per-file and final safety check and every
//   limit), the approved source commit, each SQL file's bytes/SHA-256 and each file's own timeout settings, the rollback script,
//   the database and login actually connected, the TLS verification mode, the full migration-ledger fingerprint and each file's status.
// Anything that differs at apply time yields a different digest and the apply is refused.
//
// Guarantees: migration bytes are read from git at the approved commit (not the working tree); target identity (project ref in the
// host/user, database name, migration-history fingerprint, pre-release function fingerprints, not a replica); verified TLS; a plan
// digest that --apply must echo; one transaction and one ledger row per file; after the queue-table locks are held the ledger is
// re-read and the file must still be pending with every predecessor applied and no foreign ledger change; explicit lock/statement/
// idle timeouts that are read back and that no file may exceed; every outbox and inbox row (all columns, payload content included)
// is hashed before and after each file and must be byte-identical or the transaction rolls back; the first failure or uncertain
// commit stops everything.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';

const sha256 = buf => createHash('sha256').update(buf).digest('hex');
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const SELF = fileURLToPath(import.meta.url);

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

/** PostgreSQL duration text ('5s', '1min', '500ms', bare number = ms) to milliseconds. */
export function durationMs(text) {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(us|ms|s|min|h|d)?\s*$/i.exec(String(text));
  if (!match) throw new ReleaseStop(`Cannot read duration "${text}"`, 'LIMIT_VIOLATION');
  const unit = {us: 0.001, ms: 1, s: 1000, min: 60000, h: 3600000, d: 86400000}[(match[2] || 'ms').toLowerCase()];
  return Math.round(Number(match[1]) * unit);
}

const rowLine = r => `${r.version}|${r.name ?? ''}`;
const byVersion = (a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0);
/** Fingerprint of the migration history (version|name per row, ascending), optionally only up to and including `through`. */
export function ledgerFingerprint(rows, through = null) {
  const kept = rows.filter(r => through === null || r.version <= through).sort(byVersion);
  return {rows: kept.length, sha256: sha256(Buffer.from(kept.map(rowLine).join('\n'), 'utf8'))};
}
const fullLedgerFingerprint = rows => sha256(Buffer.from([...rows].sort(byVersion).map(r => `${r.version}|${r.name ?? ''}|${r.idempotency_key ?? ''}`).join('\n'), 'utf8'));

export function loadManifest(file) {
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const need = (cond, message) => {if (!cond) throw new ReleaseStop(`Manifest invalid: ${message}`, 'MANIFEST_INVALID');};
  need(manifest.version === 'ReviewedMigrationManifestV2', 'version must be ReviewedMigrationManifestV2');
  need(manifest.target?.name && manifest.target?.projectRef && manifest.target?.database && Array.isArray(manifest.target.identity) && manifest.target.identity.length, 'target (name, projectRef, database, identity)');
  const pin = manifest.target.ledgerHistory;
  need(pin && /^\d{10,}$/.test(pin.throughVersion || '') && Number.isInteger(pin.rows) && HEX64.test(pin.sha256 || ''), 'target.ledgerHistory {throughVersion, rows, sha256}');
  need(HEX40.test(manifest.source?.approvedCommit || ''), 'source.approvedCommit must be a 40-hex commit');
  need(manifest.source?.migrationDir, 'source.migrationDir');
  need(Array.isArray(manifest.migrations) && manifest.migrations.length, 'migrations');
  manifest.migrations.forEach((m, i) => need(m.ordinal === i + 1 && m.file && m.ledgerName && HEX64.test(m.sha256 || '') && Number.isInteger(m.bytes), `migration ${i + 1} fields`));
  const limits = manifest.limits;
  need(limits && ['lockTimeout', 'maxLockTimeout', 'statementTimeout', 'maxStatementTimeout', 'idleInTransactionTimeout'].every(k => limits[k]) && Number.isInteger(limits.maxTransactionSeconds), 'limits (lockTimeout, maxLockTimeout, statementTimeout, maxStatementTimeout, idleInTransactionTimeout, maxTransactionSeconds)');
  need(durationMs(limits.lockTimeout) > 0 && durationMs(limits.lockTimeout) <= durationMs(limits.maxLockTimeout) && durationMs(limits.statementTimeout) > 0 && durationMs(limits.statementTimeout) <= durationMs(limits.maxStatementTimeout), 'limits must be positive and not above their maxima');
  if (manifest.rollback) need(manifest.rollback.file && HEX64.test(manifest.rollback.sha256 || '') && Number.isInteger(manifest.rollback.bytes), 'rollback fields');
  return manifest;
}

const LIMIT_SETTINGS = ['lock_timeout', 'statement_timeout', 'idle_in_transaction_session_timeout'];
/** Timeout settings a SQL file declares for itself. Anything that could lift or hide a limit is refused. */
export function declaredLimits(sql, manifest, label) {
  const code = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
  if (/\breset\b/i.test(code) && /\breset\s+(all|lock_timeout|statement_timeout|idle_in_transaction_session_timeout)\b/i.test(code)) throw new ReleaseStop(`${label}: resets a timeout; refused`, 'LIMIT_VIOLATION');
  if (/set_config\s*\(\s*'(lock_timeout|statement_timeout|idle_in_transaction_session_timeout)'/i.test(code)) throw new ReleaseStop(`${label}: sets a timeout through set_config; use a plain SET LOCAL so it can be reviewed`, 'LIMIT_VIOLATION');
  const found = [];
  for (const m of code.matchAll(/\bset\s+(?:local\s+|session\s+)?(lock_timeout|statement_timeout|idle_in_transaction_session_timeout)\s*(?:=|to)\s*(?:'([^']*)'|(\d+)|(default))/gi)) {
    if (m[4]) throw new ReleaseStop(`${label}: sets ${m[1]} to DEFAULT; refused`, 'LIMIT_VIOLATION');
    const ms = durationMs(m[2] ?? m[3]);
    const max = m[1].toLowerCase() === 'lock_timeout' ? durationMs(manifest.limits.maxLockTimeout) : m[1].toLowerCase() === 'statement_timeout' ? durationMs(manifest.limits.maxStatementTimeout) : durationMs(manifest.limits.idleInTransactionTimeout);
    if (ms <= 0 || ms > max) throw new ReleaseStop(`${label}: ${m[1]} ${m[2] ?? m[3]} is outside the reviewed limit (0 < value <= ${max} ms)`, 'LIMIT_VIOLATION');
    found.push(`${m[1].toLowerCase()}=${m[2] ?? m[3]}`);
  }
  return found;
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
    return {...m, sql, ownLimits: declaredLimits(sql, manifest, m.file)};
  });
  let rollback = null;
  if (manifest.rollback) {
    const bytes = git(repoDir, 'show', `HEAD:${manifest.rollback.file}`); // committed content only
    if (bytes.length !== manifest.rollback.bytes || sha256(bytes) !== manifest.rollback.sha256) throw new ReleaseStop(`${manifest.rollback.file}: differs from the reviewed rollback script`, 'CHECKSUM_MISMATCH');
    const sql = bytes.toString('utf8');
    const code = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
    if (/^\s*(begin|commit|rollback|start\s+transaction)\s*;/im.test(code)) throw new ReleaseStop(`${manifest.rollback.file}: contains transaction control`, 'REFUSED');
    for (const pattern of manifest.rollback.forbiddenSql || manifest.forbiddenSql || []) if (new RegExp(pattern, 'i').test(code)) throw new ReleaseStop(`${manifest.rollback.file}: matches forbidden pattern ${pattern}`, 'REFUSED');
    rollback = {...manifest.rollback, sql, ownLimits: declaredLimits(sql, manifest, manifest.rollback.file)};
  }
  return {commit, head, files, rollback};
}

/** Validate the connection URL and build discrete connection fields. Nothing in the URL's query string is honoured (it is refused). */
export function connectionFor(url, manifest, env = process.env) {
  let parsed;
  try {parsed = new URL(url);} catch {throw new ReleaseStop('RELEASE_DATABASE_URL is not a valid connection URL', 'IDENTITY_MISMATCH');}
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new ReleaseStop('RELEASE_DATABASE_URL must be a postgres:// URL', 'IDENTITY_MISMATCH');
  if (parsed.search || parsed.hash) throw new ReleaseStop('RELEASE_DATABASE_URL must not carry query parameters (sslmode, options, ...); TLS and settings are fixed by the runner', 'IDENTITY_MISMATCH');
  const user = decodeURIComponent(parsed.username);
  const ref = manifest.target.projectRef;
  if (!`${parsed.hostname} ${user}`.includes(ref)) throw new ReleaseStop(`Connection host/user does not contain the expected project ref ${ref}; refusing to connect`, 'IDENTITY_MISMATCH');
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (database !== manifest.target.database) throw new ReleaseStop(`Connection names database "${database}", the manifest expects "${manifest.target.database}"`, 'IDENTITY_MISMATCH');
  const port = Number(parsed.port || 5432);
  if (port === 6543) throw new ReleaseStop('Port 6543 is the transaction pooler; use the direct connection or the session pooler (5432) so locks and timeouts are held per session', 'IDENTITY_MISMATCH');
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  let ssl = false, tls = 'none (loopback only)', hostnameCheck = null;
  if (!local) {
    const caPath = env.PGSSLROOTCERT;
    if (!caPath || !fs.existsSync(caPath)) throw new ReleaseStop('A non-local target requires PGSSLROOTCERT = path to the Supabase root CA certificate so the server certificate is verified', 'TLS_REQUIRED');
    const ca = fs.readFileSync(caPath, 'utf8');
    if (!ca.includes('BEGIN CERTIFICATE')) throw new ReleaseStop('PGSSLROOTCERT does not contain a PEM certificate', 'TLS_REQUIRED');
    ssl = {rejectUnauthorized: true, ca, servername: parsed.hostname};
    hostnameCheck = env.RELEASE_TLS_HOSTNAME_CHECK !== 'off';
    if (!hostnameCheck) ssl.checkServerIdentity = () => undefined; // chain verified against the provided CA; host name not compared
    tls = hostnameCheck ? 'TLS, certificate chain and host name verified against PGSSLROOTCERT' : 'TLS, certificate chain verified against PGSSLROOTCERT (host name check disabled by RELEASE_TLS_HOSTNAME_CHECK=off)';
  }
  return {
    config: {host: parsed.hostname.replace(/^\[|\]$/g, ''), port, user, password: decodeURIComponent(parsed.password), database, ssl, application_name: 'reviewed-migration-runner', connectionTimeoutMillis: 20000},
    facts: {host: parsed.hostname, port, database, user, tls, local}
  };
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
  const info = await one(client, `select current_database() db, current_user usr, current_setting('server_version_num') ver, pg_is_in_recovery() recovery,
     current_setting('transaction_read_only') read_only, current_setting('default_transaction_read_only') default_read_only`);
  if (info.db !== manifest.target.database) throw new ReleaseStop(`Connected database is "${info.db}", expected "${manifest.target.database}"`, 'IDENTITY_MISMATCH');
  if (info.recovery || info.read_only !== 'off' || info.default_read_only !== 'off') throw new ReleaseStop('The connection is to a replica or a read-only session; connect to the primary', 'IDENTITY_MISMATCH');
  for (const q of manifest.target.identity) {
    const row = await one(client, q.sql);
    if (row?.ok !== true) throw new ReleaseStop(`Target identity check failed: ${q.description}`, 'IDENTITY_MISMATCH');
  }
  return info;
}

function checkLedgerHistory(manifest, ledger) {
  const pin = manifest.target.ledgerHistory;
  const actual = ledgerFingerprint(ledger.rows, pin.throughVersion);
  if (actual.rows !== pin.rows || actual.sha256 !== pin.sha256)
    throw new ReleaseStop(`Migration history up to ${pin.throughVersion} is ${actual.rows} rows / ${actual.sha256.slice(0, 16)}..., the reviewed target has ${pin.rows} rows / ${pin.sha256.slice(0, 16)}...: this is not the reviewed database (or it changed); stop`, 'IDENTITY_MISMATCH');
  return actual;
}

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

/** Session-level limits: applied to every runner statement, read back from the server. */
async function applySessionLimits(client, manifest) {
  const l = manifest.limits;
  await client.query(`set statement_timeout='${l.statementTimeout}'`);
  await client.query(`set idle_in_transaction_session_timeout='${l.idleInTransactionTimeout}'`);
  await client.query(`set lock_timeout='${l.lockTimeout}'`);
  const eff = await one(client, "select current_setting('statement_timeout') st, current_setting('idle_in_transaction_session_timeout') idle, current_setting('lock_timeout') lk");
  const expect = {st: durationMs(l.statementTimeout), idle: durationMs(l.idleInTransactionTimeout), lk: durationMs(l.lockTimeout)};
  if (durationMs(eff.st) !== expect.st || durationMs(eff.idle) !== expect.idle || durationMs(eff.lk) !== expect.lk) throw new ReleaseStop('The server did not apply the reviewed timeouts to this session', 'LIMIT_VIOLATION');
  return eff;
}

async function effectiveLimitsWithin(client, manifest, label) {
  const eff = await one(client, "select current_setting('statement_timeout') st, current_setting('lock_timeout') lk, current_setting('idle_in_transaction_session_timeout') idle");
  const l = manifest.limits;
  const bad = [];
  if (durationMs(eff.st) <= 0 || durationMs(eff.st) > durationMs(l.maxStatementTimeout)) bad.push(`statement_timeout ${eff.st}`);
  if (durationMs(eff.lk) <= 0 || durationMs(eff.lk) > durationMs(l.maxLockTimeout)) bad.push(`lock_timeout ${eff.lk}`);
  if (durationMs(eff.idle) <= 0 || durationMs(eff.idle) > durationMs(l.idleInTransactionTimeout)) bad.push(`idle_in_transaction_session_timeout ${eff.idle}`);
  if (bad.length) throw new ReleaseStop(`${label}: effective ${bad.join(', ')} is outside the reviewed limits; rolled back`, 'LIMIT_VIOLATION');
  return eff;
}

/** Lock the queue tables, then prove nothing in the ledger moved since the plan (or since the previous file). */
async function lockAndRecheck(client, manifest, ctx, label, lockMode) {
  const l = manifest.limits;
  await client.query(`set local lock_timeout='${l.lockTimeout}'`);
  await client.query(`set local statement_timeout='${l.statementTimeout}'`);
  const eff = await one(client, "select current_setting('lock_timeout') lk, current_setting('statement_timeout') st");
  if (durationMs(eff.lk) !== durationMs(l.lockTimeout) || durationMs(eff.st) !== durationMs(l.statementTimeout)) throw new ReleaseStop(`${label}: the server did not apply the reviewed transaction timeouts`, 'LIMIT_VIOLATION');
  try {
    await client.query('select pg_advisory_xact_lock(hashtext($1))', ['reviewed-migration-runner:' + manifest.target.name]);
    for (const table of manifest.lockTables || []) await client.query(`lock table ${table} in ${lockMode} mode`);
  } catch (error) {
    if (error.code === '55P03' || error.code === '57014') throw new ReleaseStop(`${label}: could not take the queue-table locks within ${l.lockTimeout}; nothing was changed. Retry in a quieter period.`, 'LOCK_TIMEOUT');
    throw error;
  }
  const ledger = await readLedger(client);
  const fp = fullLedgerFingerprint(ledger.rows);
  if (fp !== ctx.expectedFp) throw new ReleaseStop(`${label}: the migration ledger changed after the plan was taken (another migration or release ran); rolled back. Re-run the dry run and re-review.`, 'LEDGER_DRIFT');
  return ledger;
}

/** Run one migration file inside the caller's open transaction. */
async function runInsideTransaction(client, manifest, file, ctx, out) {
  const started = Date.now();
  const ledger = await lockAndRecheck(client, manifest, ctx, file.file, 'share');
  const statuses = classify(ctx.files, ledger);
  const idx = file.ordinal - 1;
  if (!statuses.slice(0, idx).every(s => s === 'APPLIED') || !statuses.slice(idx).every(s => s === 'PENDING'))
    throw new ReleaseStop(`${file.file}: ledger status is now ${statuses.join('/')}; it is no longer the next pending file; rolled back`, 'LEDGER_DRIFT');
  const before = await snapshot(client, manifest);
  await client.query(file.sql);
  const eff = await effectiveLimitsWithin(client, manifest, file.file);
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
  ctx.expectedFp = fullLedgerFingerprint((await readLedger(client)).rows);
  const seconds = (Date.now() - started) / 1000;
  if (seconds > manifest.limits.maxTransactionSeconds) throw new ReleaseStop(`${file.file}: transaction ran ${seconds.toFixed(1)}s, above the reviewed ${manifest.limits.maxTransactionSeconds}s; rolled back`, 'LIMIT_VIOLATION');
  out(`        ${seconds.toFixed(1)}s under the queue-table lock; effective lock_timeout ${eff.lk}, statement_timeout ${eff.st}`);
  return version;
}

/** Run the reviewed rollback script inside the caller's open transaction and remove the ledger rows of the migrations it undoes. */
async function rollbackInsideTransaction(client, manifest, source, applied, ctx, out) {
  const started = Date.now();
  const rb = source.rollback;
  await lockAndRecheck(client, manifest, ctx, rb.file, 'access exclusive');
  const before = await snapshot(client, manifest);
  await client.query(rb.sql);
  await effectiveLimitsWithin(client, manifest, rb.file);
  const after = await snapshot(client, manifest);
  (manifest.preserve || []).forEach((p, i) => {
    if (before[i] !== after[i]) throw new ReleaseStop(`${rb.file}: existing data changed (${p.description}); rolled back`, 'DATA_PRESERVATION_FAILED');
  });
  const failures = await runChecks(client, rb.verify || [], 'rollback: ', out);
  if (failures.length) throw new ReleaseStop(`${rb.file}: rollback checks failed (${failures.join('; ')}); rolled back`, 'VERIFY_FAILED');
  let removed = 0;
  for (const f of applied) removed += (await client.query('delete from supabase_migrations.schema_migrations where name=$1 and idempotency_key=$2', [f.ledgerName, f.sha256])).rowCount;
  if (removed !== applied.length) throw new ReleaseStop(`${rb.file}: removed ${removed} ledger rows, expected ${applied.length}; rolled back`, 'LEDGER_DRIFT');
  const seconds = (Date.now() - started) / 1000;
  if (seconds > manifest.limits.maxTransactionSeconds) throw new ReleaseStop(`${rb.file}: transaction ran ${seconds.toFixed(1)}s, above the reviewed ${manifest.limits.maxTransactionSeconds}s; rolled back`, 'LIMIT_VIOLATION');
  out(`        ${seconds.toFixed(1)}s under an exclusive queue-table lock; ${removed} ledger row(s) removed`);
}

const planDigestOf = parts => sha256(JSON.stringify(parts));

/**
 * hooks (tests only): {beforeFile(file)} runs just before a file's transaction begins, to simulate another actor.
 */
export async function run({manifestPath, repoDir = process.cwd(), mode = 'plan', operation = 'migrate', confirm = null, env = process.env, out = line => process.stdout.write(line + '\n'), hooks = {}}) {
  const url = env.RELEASE_DATABASE_URL;
  const safe = redactor(url);
  const say = line => out(safe(line));
  const manifest = loadManifest(manifestPath);
  if (!url) throw new ReleaseStop('Set RELEASE_DATABASE_URL in your own shell (never in chat or a file) and retry', 'NO_CONNECTION');
  if (!['migrate', 'rollback'].includes(operation)) throw new ReleaseStop(`Unknown operation ${operation}`, 'REFUSED');
  const source = resolveSource(repoDir, manifest);
  if (operation === 'rollback' && !source.rollback) throw new ReleaseStop('This manifest has no reviewed rollback script', 'REFUSED');
  const runnerSha = sha256(fs.readFileSync(SELF));
  const manifestSha = sha256(fs.readFileSync(manifestPath));
  say(`SOURCE   repo HEAD ${source.head}`);
  say(`         approved commit ${source.commit}: ${source.files.length} migration file(s) read from git, checksums verified`);
  say(`RUNNER   sha256 ${runnerSha}`);
  say(`MANIFEST sha256 ${manifestSha}`);
  const {config, facts} = connectionFor(url, manifest, env);
  const client = new pg.Client(config);
  try {
    await client.connect();
  } catch (error) {
    throw new ReleaseStop(`Could not connect: ${safe(error.code || error.message)}`, 'NO_CONNECTION');
  }
  let uncertain = false;
  try {
    if (!facts.local) {
      const stream = client.connection.stream;
      if (!(stream.encrypted === true && stream.authorized === true)) throw new ReleaseStop('The connection is not verified TLS; refusing', 'TLS_REQUIRED');
    }
    const limitsInEffect = await applySessionLimits(client, manifest);
    const identity = await checkIdentity(client, manifest);
    say(`TARGET   ${manifest.target.name} (project ${manifest.target.projectRef}); database ${identity.db}, login ${identity.usr}, server ${identity.ver}, primary, writable`);
    say(`CONNECT  ${facts.host}:${facts.port} - ${facts.tls}`);
    say(`LIMITS   lock ${limitsInEffect.lk} (max ${manifest.limits.maxLockTimeout}), statement ${limitsInEffect.st} (max ${manifest.limits.maxStatementTimeout}), idle-in-transaction ${limitsInEffect.idle}, ${manifest.limits.maxTransactionSeconds}s per transaction (all read back from the server)`);
    const ledger = await readLedger(client);
    const history = checkLedgerHistory(manifest, ledger);
    say(`LEDGER   tail ${ledger.tail}; history through ${manifest.target.ledgerHistory.throughVersion} is the reviewed ${history.rows} rows (fingerprint ${history.sha256.slice(0, 16)}...)`);
    for (const required of manifest.target.ledgerMustContain || []) if (!ledger.byName.has(required)) throw new ReleaseStop(`Ledger lacks required prior migration ${required}; wrong database or state`, 'IDENTITY_MISMATCH');
    const statuses = classify(source.files, ledger);
    const bad = statuses.filter(s => !['PENDING', 'APPLIED'].includes(s));
    if (bad.length) throw new ReleaseStop(`Refusing: ${statuses.map((s, i) => `${source.files[i].ledgerName}=${s}`).filter(x => !x.endsWith('PENDING') && !x.endsWith('APPLIED')).join(', ')}`, 'REFUSED');
    const fresh = statuses.every(s => s === 'PENDING');
    if (fresh && manifest.target.preState?.length) {
      say('PRE-STATE (nothing from this release is installed yet; the pre-release definitions must be exactly the reviewed ones):');
      const failures = await runChecks(client, manifest.target.preState, '', say);
      if (failures.length) throw new ReleaseStop(`Pre-release state differs from the reviewed one: ${failures.join('; ')}`, 'IDENTITY_MISMATCH');
    }
    const listChecks = (title, checks) => {if (checks?.length) {say(`  ${title}:`); checks.forEach(c => say(`    - ${c.description}`));}};
    say('SAFETY CHECKS (all are covered by the manifest hash above and run automatically):');
    listChecks('preserved byte-for-byte around every file', manifest.preserve);
    source.files.forEach(f => listChecks(`proved before ${f.ledgerName} may commit`, f.verify));
    listChecks('proved on the installed result', manifest.finalVerify);
    if (operation === 'rollback') listChecks('proved before the rollback may commit', source.rollback.verify);
    say('PLAN');
    source.files.forEach((f, i) => say(`  ${f.ordinal}. ${f.ledgerName}  ${f.bytes.toLocaleString('en-GB')} bytes  sha256 ${f.sha256.slice(0, 16)}...  ${statuses[i]}${f.ownLimits.length ? `  (own limits: ${f.ownLimits.join(', ')})` : ''}`));
    if (operation === 'rollback') say(`  ROLLBACK ${source.rollback.file}  ${source.rollback.bytes.toLocaleString('en-GB')} bytes  sha256 ${source.rollback.sha256.slice(0, 16)}...${source.rollback.ownLimits.length ? `  (own limits: ${source.rollback.ownLimits.join(', ')})` : ''}`);
    const ctx = {files: source.files, expectedFp: fullLedgerFingerprint(ledger.rows)};
    const digest = planDigestOf({
      digestVersion: 2, operation, runnerSha256: runnerSha, manifestSha256: manifestSha, repoHead: source.head,
      target: {name: manifest.target.name, projectRef: manifest.target.projectRef, database: identity.db, login: identity.usr, server: identity.ver},
      connection: {host: facts.host, port: facts.port, tls: facts.tls}, limits: manifest.limits,
      commit: manifest.source.approvedCommit, ledger: {tail: ledger.tail, rows: ledger.rows.length, fingerprint: ctx.expectedFp},
      migrations: source.files.map((f, i) => [f.ordinal, f.ledgerName, f.file, f.bytes, f.sha256, statuses[i], f.ownLimits]),
      rollback: source.rollback ? [source.rollback.file, source.rollback.sha256, source.rollback.ownLimits] : null
    });
    say(`PLAN DIGEST ${digest}`);
    const pending = source.files.filter((f, i) => statuses[i] === 'PENDING');
    const appliedFiles = source.files.filter((f, i) => statuses[i] === 'APPLIED');

    if (operation === 'rollback') {
      if (!appliedFiles.length) {say('NOTHING TO ROLL BACK (none of this release\'s migrations is in the ledger).'); return {state: 'NOTHING_TO_ROLL_BACK', digest};}
      if (mode === 'plan') {
        say(`DRY RUN complete: the rollback would restore the pre-release claim logic and remove ${appliedFiles.length} ledger row(s). Nothing was changed.`);
        say(`To rehearse: add --rehearse. To execute: add --apply --confirm ${digest}`);
        return {state: 'ROLLBACK_PLANNED', digest};
      }
      if (mode === 'apply' && confirm !== digest) throw new ReleaseStop('--confirm must equal the PLAN DIGEST printed by a fresh dry run of this exact rollback', 'CONFIRMATION_REQUIRED');
      await client.query('begin');
      try {
        await rollbackInsideTransaction(client, manifest, source, appliedFiles, ctx, say);
        if (mode === 'rehearse') await client.query('rollback');
        else {uncertain = true; await client.query('commit'); uncertain = false;}
      } catch (error) {
        try {await client.query('rollback');} catch { /* connection lost: server aborts the open transaction */ }
        throw error;
      }
      say(mode === 'rehearse' ? 'RESULT  ROLLBACK REHEARSAL OK - everything was rolled back; Production is unchanged' : `RESULT  OK - rolled back ${appliedFiles.length} migration(s)`);
      return {state: mode === 'rehearse' ? 'ROLLBACK_REHEARSED' : 'ROLLED_BACK', digest};
    }

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
        for (const f of pending) {say(`  ${f.ordinal}. ${f.ledgerName}`); await runInsideTransaction(client, manifest, f, ctx, say);}
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
      await hooks.beforeFile?.(f);
      await client.query('begin');
      let version;
      try {
        version = await runInsideTransaction(client, manifest, f, ctx, say);
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
  const args = {mode: 'plan', operation: 'migrate'};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--manifest') args.manifestPath = argv[++i];
    else if (a === '--repo') args.repoDir = argv[++i];
    else if (a === '--rehearse') args.mode = 'rehearse';
    else if (a === '--apply') args.mode = 'apply';
    else if (a === '--rollback') args.operation = 'rollback';
    else if (a === '--confirm') args.confirm = argv[++i];
    else throw new ReleaseStop(`Unknown argument ${a}`, 'REFUSED');
  }
  if (!args.manifestPath) throw new ReleaseStop('--manifest is required', 'REFUSED');
  return args;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  try {
    await run(parseArgs(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`STOPPED [${error.code || 'ERROR'}] ${redactor(process.env.RELEASE_DATABASE_URL)(error.message)}\n`);
    process.exit(error.code === 'CONFIRMATION_REQUIRED' || error.code === 'NO_CONNECTION' ? 2 : 1);
  }
}
