# Resources V2 - Production migration handoff (operator procedure)

Runs in the separately authorised environment only. The coding assistant's environment denies Production migrations; do not run this there.

Runner: `scripts/release/apply-reviewed-migrations.mjs` (identical copy in both repositories). Dry by default. It reads the migration bytes from the approved git commit, checks each SHA-256, checks the target identity, prints the whole plan with a plan digest, and applies only with `--apply --confirm <that digest>`. One transaction and one ledger row per file; the first failure or uncertain commit stops everything; a re-run skips files already in the ledger with the same checksum and refuses a different one.

It never prints the connection string or password. Provide it only through your own shell:

```powershell
$env:RELEASE_DATABASE_URL = '<direct Supabase connection string for the target project>'   # type it yourself; never paste it into chat
$env:PGSSLROOTCERT = '<path to the Supabase root CA file>'                                  # optional but recommended
```

## Sources (exact)

| Target | Repository | Approved migration commit | Project ref |
|---|---|---|---|
| Nexus (Event Suite DB, schema `integration`) | Prestige-Nexus PR 133, branch `codex/resources-claim-recovery-prep` | `c97c2910f9b8d1d4f66aa5204c680d27f6b4c841` | `sbmcrnpdilmpybomxwox` |
| AIRE | ai-revenue-engine PR 121, branch `codex/resources-complete-content-prep` | `63e05dbd336a5691fbbda8a29a7cf51993f8fabb` | `cdcfmnlmshnustrqficy` |

Check out the PR branch head (it contains the approved commit plus this runner; the runner proves the approved commit is an ancestor and reads the SQL from it, not from your working tree). `npm ci` once per repository.

## Step 1 - Nexus dry run, review, rehearse

```powershell
cd <Prestige-Nexus checkout of the PR 133 head>
node scripts/release/apply-reviewed-migrations.mjs --manifest release/resources-v2-nexus-migrations.json
```

The output must show, in this order, all `PENDING`, ledger tail `20261110114418` (or later if unrelated releases have landed), project `sbmcrnpdilmpybomxwox`:

1. `resources_terminal_url_history` 5,008 bytes
2. `resources_frozen_inventory_retry_gate` 670,508 bytes (executed as one complete verified file)
3. `resources_terminal_history_stop` 9,418 bytes
4. `resources_shared_operator_first_pass` 9,683 bytes
5. `resources_ranked_candidate_claim_order` 2,631 bytes
6. `resources_policy_hash_compatibility` 6,187 bytes

Any other status (`APPLIED` is fine on a re-run; `CHECKSUM_MISMATCH`, `OUT_OF_ORDER`, an identity error) means stop and report. Optional but recommended: add `--rehearse` to run the whole chain in one transaction and roll it back (takes the queue-table locks for a few seconds).

## Step 2 - Nexus apply

```powershell
node scripts/release/apply-reviewed-migrations.mjs --manifest release/resources-v2-nexus-migrations.json --apply --confirm <PLAN DIGEST from step 1>
```

Success ends with `RESULT  OK - applied 6` and these `PASS` lines: the claim function carries every reviewed marker; `reconcile_directory_policy_hash` is SECURITY DEFINER; it and the worker-called functions are executable by `service_role` and `esn_nexus_cutover_20261025` and not by anon, authenticated or PUBLIC; `recover_directory_execution` and the recovery table are executable/readable by nobody. Each file also proves, inside its own transaction before commit, that every outbox and inbox record (state, attempts, leases, schedule, last error, idempotency key) is byte-identical, otherwise it rolls back.

## Step 3 - AIRE

```powershell
cd <ai-revenue-engine checkout of the PR 121 head>
node scripts/release/apply-reviewed-migrations.mjs --manifest release/resources-v2-aire-migrations.json
node scripts/release/apply-reviewed-migrations.mjs --manifest release/resources-v2-aire-migrations.json --apply --confirm <PLAN DIGEST>
```

One file: `resources_inventory_search_acceleration` (4,245 bytes), tail `20261102162851`. The table is created empty, so acceleration stays OFF; no standing-policy row or hash changes.

## Step 4 - Report back, then stop

Send the two `RESULT` blocks. Do not merge anything and do not enable acceleration. The release then continues: confirm installed state, merge Nexus #133 (Railway deploys), merge AIRE #121, bounded acceptance window, credit evidence, acceleration.

## If something stops

- A failed or rolled-back file leaves earlier files committed and the failed one untouched. Re-run the dry run to see exactly what remains. Do not edit the SQL or manifest.
- `UNCERTAIN` (commit outcome unknown): do not retry blindly; re-run the dry run and read the ledger.
- Rollback is additive and does not touch data: Nexus - reinstall the previous claim definition from `20261110113000` (installed definition md5 `5e960feb...`, 14,257 chars) and `drop function integration.reconcile_directory_policy_hash(text,text,integer)`; AIRE - leave `nexus_directory_inventory_acceleration` empty/disabled (its default), or restore the previous `reserve_directory_search` (installed md5 `9d6350c1edce3956c5b11f91ab023857`, 6,139 chars). The healthy Railway worker keeps running throughout; the new functions keep the same signatures.
