# Governed Resources continuation

The existing signed directory search, verification and acquisition routes accept a signed run ID under a `quotaMode: PER_RUN` standing policy. The new `/api/integrations/nexus/directory-run` route opens and finishes that run; it has no research or product mutation authority. Nexus retains orchestration and canonical governance; EventSuite retains private contact routing and publication.

Each run reserves at most 500 venues and 2,500 website requests. Policy-specific `braveMaxRequestsPerRun` and `serperMaxRequestsPerRun` ceilings are independently enforced by the database, defaulting to zero. The run lease cannot roll over while a website work lease is still active. Finishing requires the same policy, hash and worker, and no outstanding work.

Search uses the existing durable allowance/query ledger for both providers. Brave is preferred. Serper may follow an empty Brave result or a confirmed inactive, exhausted or per-run-capped Brave allocation. An uncertain, failed or in-flight outcome cannot trigger another purchase. Cache fingerprints bind provider, query, country, result count, locality and category; they deliberately exclude the run and venue request IDs. Cached evidence expires after 24 hours; uncertain outcome tombstones retain the consumed reservation.

Apply `20261023182003_resources_provider_and_run_budgets.sql` before deploying the new routes. Existing legacy policies remain supported. Activation requires independently verified current prepaid/free balances, finite provider-bound allocation rows, their existing server-side API keys, and these configuration names:

- `NEXUS_DIRECTORY_STANDING_POLICY_ID` and `NEXUS_DIRECTORY_STANDING_POLICY_SHA256`
- `BRAVE_SEARCH_TEST_ALLOWANCE_ID`
- `SERPER_SEARCH_ALLOWANCE_ID`

Each new allocation must set `requires_run = true`, bind `policy_id`, record the credit verification evidence and currency ceiling, and expire within the verified credit validity. No allocation or policy is enabled by the migration. Only one active allocation per provider is permitted. No purchase or top-up API exists in this path.

Rollback: disable the exact standing policy and its allowance rows before rolling application code back. Keep the additive run/receipt tables and search tombstones; do not refund unknown calls or replay completed records. Legacy signed routes and generic executor restrictions remain unchanged. `publicationAllowed` and `outreachAllowed` remain false in AIRE; separately authorised EventSuite product publication is not delegated to the research executor.

Validation: full AIRE gate, signed negative-path tests, real adapter fallback tests, and the Nexus `directory_run_budget_sql.test.mjs` integration test against the actual migrations. Production acceptance additionally requires a signed request, stored provider usage and an idempotent product outcome on its correlated venue. Key presence or a disabled-route response is not acceptance.
