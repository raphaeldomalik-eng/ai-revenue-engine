# Email-first code-only release execution hold

Production source discovery is hard-disabled in `nexusSourceDiscoveryDisabled`, including when a stale `NEXUS_SOURCE_DISCOVERY_ENABLED=true` is supplied. Preview behaviour is retained. Reopening production discovery requires a separately authorised code change and execution release; changing this flag alone cannot reopen it.

During pre-release preparation the existing AIRE project production flag was set to false and a project-scoped Vercel deny rule was activated for `/api/integrations/nexus/execute`. This is an execution safety control, not a production code deployment. Preserve it across promotion and rollback until separate execution authorisation. Existing immutable deployment environment values are not rewritten by changing the project configuration.

Verify the production alias returns a firewall denial without submitting a valid research envelope or contacting an external venue. Confirm the production project setting remains false and test the code guard with production/stale-enabled combinations locally. Do not use a production crawler journey as a smoke test. Retain protected immutable deployment URLs; do not weaken protection to test them.

No production crawls, provider calls, database mutations, contact approvals or messages are authorised by this code-only release. Do not remove the hold as part of deployment or rollback. A code rollback alone does not prove an execution hold; recheck the live firewall and aliases.
