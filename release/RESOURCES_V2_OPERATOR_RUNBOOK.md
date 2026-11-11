# Resources V2 - Production database migrations (operator procedure)

Runs in the separately authorised environment only. The coding assistant's environment denies Production migrations; do not run this there.

This procedure covers **only the two database migrations** (Nexus/Event Suite database, then AIRE database). The Resources Product release (Event Suite P2 protected route) and the EventSuite main-app deployment are separate steps with their own gates and are not touched here.

Runner: `scripts/release/apply-reviewed-migrations.mjs` (identical copy in both repositories). Dry by default.

## What the confirmation covers

`--apply --confirm <digest>` is bound to the **complete reviewed instructions**, not only the file list. The digest is a SHA-256 over: the runner's own bytes; the manifest's bytes (so every identity, pre-state, preservation, per-file and final check, and every limit); the approved source commit; each SQL file's bytes and SHA-256 and the timeouts the file sets itself; the rollback script; the database, login and TLS mode actually connected; the full migration-ledger fingerprint; each file's ledger status. Change any of them and the old digest is refused. Read the printed `SAFETY CHECKS` list: it is exactly what will be enforced.

## Connection (type these yourself; never paste them into chat)

```powershell
$env:RELEASE_DATABASE_URL = 'postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres'   # direct connection, or the session pooler on 5432 (user postgres.<project-ref>)
$env:PGSSLROOTCERT = '<path to the Supabase root CA certificate (PEM)>'                                      # required for any non-local host
```

The runner refuses: a URL with query parameters (`sslmode=`, `options=` ...), port 6543 (transaction pooler), a database name other than `postgres`, a host/user without the expected project ref, a missing or non-PEM CA file, a replica or read-only session, and any connection whose server certificate is not verified against your CA (chain **and** host name; if a pooler host name legitimately fails the name check, set `RELEASE_TLS_HOSTNAME_CHECK=off` - the chain is still verified and the plan states it). It prints the host, port, database, login and TLS mode, and never the URL or password.

## Exact targets and sources

| Target | Project ref | Repository / branch | Approved migration commit | Pinned history (`target.ledgerHistory`) |
|---|---|---|---|---|
| Nexus - the Event Suite Production database, schema `integration` | `sbmcrnpdilmpybomxwox` | Prestige-Nexus PR 133, `codex/resources-claim-recovery-prep` | `c97c2910f9b8d1d4f66aa5204c680d27f6b4c841` | 1,717 migrations through `20261110114418`, sha256 `24240045...d70d` |
| AIRE | `cdcfmnlmshnustrqficy` | ai-revenue-engine PR 121, branch `codex/resources-complete-content-prep` | `63e05dbd336a5691fbbda8a29a7cf51993f8fabb` | 49 migrations through `20261102162851`, sha256 `c1962131...e1e2` |

Check out the PR branch head (it contains the approved commit, the runner, the manifest and the rollback script; the SQL is read from the approved commit, never from your working tree). `npm ci` once per repository. The runner also pins the exact pre-release state: the five Nexus functions this release rewrites (`claim_directory_policy_outbox_batch` 7- and 6-argument, `claim_outbox_batch`, `directory_is_first_pass`, `directory_origin_url_gone`) and AIRE's `reserve_directory_search` must be exactly the reviewed pre-release definitions (CR-insensitive md5), or it stops before changing anything. All of these checks were run read-only against Production on 2026-11-11 and passed.

## Shared-database impact (Nexus step)

The Nexus database is the Event Suite Production database. Event Suite writers also use `integration.outbox_event` (source system `event_suite`) and the Nexus worker claims from it (about 250 writes/hour; outbox 19,903 rows / 55 MB, inbox 9,067 rows / 58 MB).

- **What changes:** five existing functions are replaced (listed above); two `BEFORE UPDATE` triggers are added to `outbox_event` (they act only when a row is claimed into `PROCESSING`); three partial/GIN indexes are added (`idx_outbox_directory_inventory_subject_keys`, `directory_fatal_inbox_evidence`, `directory_unresolved_outbox_delivery`); two new tables (`resources_initial_inventory_subject`, `directory_execution_recovery`, RLS on, no grants to Event Suite roles); sixteen new `integration` functions. **No outbox or inbox row is inserted, updated or deleted** by any migration (the only statements touching them in the migrations are inside function bodies that run later at claim time).
- **Other readers/writers:** `public.dispatch_resource_discovery_verification` (SECURITY DEFINER) references the outbox; Event Suite code inserting `event_suite` rows is unaffected by the claim guards. The generic `claim_outbox_batch` gains a guard that is true for every row except Resources policy `resources-sa-uk-per-run-20261025`.
- **Locks:** for each file the runner holds `SHARE` locks on the outbox and inbox (plain reads and `SELECT ... FOR UPDATE` continue; every INSERT, UPDATE or DELETE - Event Suite writers and the worker claiming a row - waits, and none fails unless its own timeout is shorter). Each file is its own transaction, so locks are released between files. Lock acquisition is capped at 10 s (the runner stops with `LOCK_TIMEOUT` and changes nothing). Measured on a local PostgreSQL with 19,900 outbox rows and 9,000 inbox rows: 1.0-1.9 s per file including two whole-table content hashes (the same hash takes about 3 s on Production). Expect writers to pause for a few seconds per file, about 10-30 s in total. The runner stops any file that runs longer than 180 s and every statement is capped (see below).
- **Limits (read back from the server and printed):** lock timeout 10 s (max 10 s); statement timeout 120 s (max 120 s); idle-in-transaction 60 s; 180 s per transaction. The migration files set their own `SET LOCAL` limits (5 s lock, 30 s statement; 60 s for the last file); the runner reads them from the SQL, refuses any file that sets 0, DEFAULT, RESET, `set_config`, or a value above the maxima, and verifies the effective values after each file.
- **Data preservation:** before and after every file the runner hashes **every outbox and inbox row, all columns including the payload** (row count plus per-row md5). A single changed byte rolls the file back. (Rehearsed with a same-size payload edit; a size comparison would not have caught it.)
- **After the locks are held** the runner re-reads the migration ledger: the file must still be the next pending one, every predecessor applied with its checksum, and the full ledger identical to the plan (or to the state after the previous file). Any foreign ledger change stops it (`LEDGER_DRIFT`).

Run in a quiet period if you can; it is safe to run at any time.

## Step 1 - Nexus dry run, review, rehearse

```powershell
cd <Prestige-Nexus checkout of the PR 133 head>
node scripts/release/apply-reviewed-migrations.mjs --manifest release/resources-v2-nexus-migrations.json
```

Expected: project `sbmcrnpdilmpybomxwox`, database `postgres`, primary; `PRE-STATE` shows five `PASS` lines; all six files `PENDING` in this order: `resources_terminal_url_history` (5,008 bytes), `resources_frozen_inventory_retry_gate` (670,508), `resources_terminal_history_stop` (9,418), `resources_shared_operator_first_pass` (9,683), `resources_ranked_candidate_claim_order` (2,631), `resources_policy_hash_compatibility` (6,187). Any `STOPPED` (identity, history, pre-state, `CHECKSUM_MISMATCH`, `OUT_OF_ORDER`, TLS) means stop and report. Then rehearse (the whole chain in one transaction, rolled back):

```powershell
node scripts/release/apply-reviewed-migrations.mjs --manifest release/resources-v2-nexus-migrations.json --rehearse
```

## Step 2 - Nexus apply

```powershell
node scripts/release/apply-reviewed-migrations.mjs --manifest release/resources-v2-nexus-migrations.json --apply --confirm <PLAN DIGEST from the dry run>
```

Success ends with `RESULT  OK - applied 6`, per-file timings, and `PASS` lines proving the claim function carries every reviewed marker, `reconcile_directory_policy_hash` is SECURITY DEFINER, the worker-called functions are executable by `service_role` and `esn_nexus_cutover_20261025` and not by anon, authenticated or PUBLIC, and `recover_directory_execution` and the recovery table are accessible to nobody.

## Step 3 - AIRE

```powershell
cd <ai-revenue-engine checkout of the PR 121 head>
node scripts/release/apply-reviewed-migrations.mjs --manifest release/resources-v2-aire-migrations.json
node scripts/release/apply-reviewed-migrations.mjs --manifest release/resources-v2-aire-migrations.json --rehearse
node scripts/release/apply-reviewed-migrations.mjs --manifest release/resources-v2-aire-migrations.json --apply --confirm <PLAN DIGEST>
```

One file: `resources_inventory_search_acceleration` (4,245 bytes), history tail `20261102162851`. AIRE keeps serving while it runs (nothing is locked except a brief lock on the policy table for the foreign key). The table is created empty, so acceleration stays OFF; no standing-policy row or hash changes (compared before and after, with every allowance's configuration).

## Step 4 - Report back, then stop

Send the `RESULT` blocks. Do not merge anything and do not enable acceleration. The release then continues in its own steps.

## Rollback (reviewed, tested, never touches queue data)

Rollback scripts are committed and checksummed: `release/rollback/resources-v2-nexus-rollback.sql` and `release/rollback/resources-v2-aire-rollback.sql`, run by the same runner with the same checks:

```powershell
node scripts/release/apply-reviewed-migrations.mjs --manifest release/resources-v2-nexus-migrations.json --rollback            # dry run, prints a digest
node scripts/release/apply-reviewed-migrations.mjs --manifest release/resources-v2-nexus-migrations.json --rollback --rehearse
node scripts/release/apply-reviewed-migrations.mjs --manifest release/resources-v2-nexus-migrations.json --rollback --apply --confirm <ROLLBACK DIGEST>
```

- **Nexus:** drops the two release triggers and three indexes; restores the five rewritten functions to their exact pre-release definitions (verified by md5 against the Production values); drops the sixteen release-only functions; drops `directory_execution_recovery` only if it is empty (the inventory-subject table is kept); removes the six ledger rows. Order: **first return the Nexus worker to the previous Railway deployment** (the new worker calls functions the rollback removes), then run the rollback. It takes an exclusive lock for a few seconds and compares every outbox/inbox row before and after.
- **AIRE:** restores the pre-release `reserve_directory_search` (the hard-coded daily ceilings return immediately), drops the gate function, drops the control table only if it is empty (an enabled row is kept, inert, so the authorisation record is not lost), removes the ledger row.
- Both were proved on real PostgreSQL: apply, queue/row changes, rollback, byte-equivalent function definitions, unchanged data, ledger back to the starting rows, and a clean second apply.
- Do not hand-edit the SQL, manifest or ledger. A failed or rolled-back file leaves earlier files committed and the failed one untouched; `UNCERTAIN` (commit outcome unknown) means re-run the dry run and read the ledger, never retry blindly.
