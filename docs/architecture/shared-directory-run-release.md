# Shared directory bounded runs

The existing standing endpoints now accept signed Last Train Home requests under an explicitly approved `budgetMode: PER_RUN` policy. Older daily policies keep their prior behavior, including existing canary continuations. A version number alone does not select the new mode.

The new mode requires `maxVenuesPerRun` (at most 500), `maxRequestsPerRun` (at most 2500), and a UUID `directoryContext.runId` inside the HMAC-signed envelope. The Nexus standing worker uses one run ID for its bounded cycle. Multiple concurrent HTTP requests share a durable budget row. Reservations remain consumed after uncertain execution; lease expiry creates a backed-off retry. Terminal queue replay cannot open another external execution. The ledger also retains existing host cooldown, identity lease, retry and zero-paid-provider controls.

Apply `20261023204000_shared_directory_run_budgets.sql` to AIRE project `cdcfmnlmshnustrqficy` only after the implementation and Production gates are satisfied. Deploy the same reviewed code, then verify the new table's RLS and RPC privileges and the unchanged existing policy/receipt rows. This migration seeds no policy and activates no research. An approved policy must independently be enabled and its exact hash matched to the existing endpoint configuration.

Search allowance verification, existing HTTP 503 retries and portfolio-wide autonomous continuation are separate acceptance steps. This change neither purchases credits nor authorises messaging or product publication.

The coordinated shared runtime uses the existing execute/verify URLs with `?policy=shared-intelligence-uk-v1`. Set only the additive `NEXUS_SHARED_INTELLIGENCE_POLICY_SHA256` to the approved Nexus manifest hash and seed that exact enabled policy under its new ID. The request still needs the matching HMAC-signed context and enabled database policy. Unknown/duplicate selectors fail closed. Keep `NEXUS_DIRECTORY_STANDING_POLICY_ID` and `NEXUS_DIRECTORY_STANDING_POLICY_SHA256` unchanged: requests without the selector continue their existing policy and canary/continuation path.

Rollback: disable the affected policy before disabling the new worker. Existing policies do not require the new mode. Preserve all run budgets and receipts, including unknown usage; never delete/refund reservations to make work executable. Correct a database defect with a reviewed additive roll-forward migration. Capture and verify current AIRE backup/recovery protection and Production invariants before applying this migration.

Local verification: repository `npm run check` passed (791 passed, one optional test skipped, zero failed), including typecheck, lint and Production build. Three SQL integration tests cover independent runs, reservation replay, bounds, unknown lease usage, permissions and legacy daily budgets. Production execution has not been performed by this change.
