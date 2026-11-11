# Terminal URL history release preflight

Status: local preparation only. No activation, live writes, external HTTP or deployment is authorized by this document. AIRE/Event Suite separation must pass before release.

AIRE owns fetch execution. Exact HTTP 404/410 observations are execution evidence, not a host exclusion, venue closure, canonical identity decision or publication decision. The existing `nexus_executor_results` ledger retains namespaced URL-hash records; no database migration or new database is needed. RLS/grants are unchanged. Directory-result RPC validation is not weakened: the dedicated history adapter uses the existing base-ledger writer.

## Historical coverage before activation

1. Export retained AIRE executor result payloads, including original observation timestamps and direct response manifests/HTTP diagnostics, through the authorized read-only data route. An array of `nexus_executor_results` rows or result payloads is supported. Do not crawl to fill export gaps.
2. Run the offline dry-run planner:

   `node --experimental-strip-types scripts/plan-terminal-url-backfill.ts retained-results-export.json`

   Redirect its JSON output to a reviewed plan artifact. The CLI has no apply mode and never opens a network connection. Default bounds are 10,000 records, 100,000 candidate terminal observations, 16 nested levels and a 50 MiB input file. Exceeding a bound fails instead of silently dropping inventory. Split large exports into disjoint bounded batches and review each batch.
3. Review input count, unique exact URLs, duplicates, ignored nonterminal statuses and refused observations. Missing observed dates, unsafe URLs, unsupported diagnostics and missing response hashes are refused. Never infer 404 from warnings, 403, provider failures or business dispositions. Original date, exact retained URL, status and source record are preserved. Fragment-only differences collapse; path/query differences do not.
4. Resolve refused records from retained evidence only. Historical manifests sanitize credential-like query parameters; they cannot reconstruct removed parameters. Do not claim full exact-URL coverage for records whose original request URL is unavailable. No production-wide counts have been established by the local fixtures.
5. After the separation and release gates pass, the authorized release-preflight caller may invoke `applyTerminalUrlBackfill(plan, { history: store.terminalUrlHistory, approvedPlanSha256: plan.planSha256, maxWrites: reviewedUniqueCount })` using the same approved AIRE result store. This hook verifies the exact plan hash and finite write cap. It preserves already-held terminal records and is idempotent. A failed write stops the batch; rerun only the same reviewed plan after resolving the error. No wrapper or task in this slice invokes that hook against a live store.
6. Verify the complete reviewed batch coverage and persisted exact-URL history before allowing any later crawl cycle. The inventory-first scheduler gate is separate and remains required.

## Runtime behavior and limits

The shared crawler checks history before HTTP and before fresh-document cache reuse. It records newly observed 404/410 before result completion, including robots/sitemap/child pages, and does not expire them or erase them across request IDs or policy epochs. Missing robots still permits ordinary site crawling. Other URLs on the same host remain eligible. History read or write failures are fatal to the current crawl, including optional child, robots and sitemap paths. The public boundary returns BLOCKED with a dedicated TERMINAL_URL_HISTORY_READ_FAILED or TERMINAL_URL_HISTORY_WRITE_FAILED operational disposition and retryable=false. It withholds extractable pages (pageCount=0), retains actual HTTP request/byte accounting and direct response diagnostics, and must enter the existing run-control/quarantine recovery path rather than ordinary venue retry. Persistence is awaited outside the fetch timeout race. Durable coverage cannot be claimed for an uncommitted write: another process or later request can still fetch an unsaved URL unless the operational block is honored. Repair and backfill retained direct HTTP evidence before releasing that block.

Production source-discovery, official-site verification and Resources first-pass paths must receive the configured durable store. The venue wrapper accepts history, but standalone proof/wave/backfill scripts do not configure a durable store automatically and must not be used as a bypass around release preflight. Existing in-process origin politeness and request budgets remain in force; this slice does not add distributed HTTP locks.

## Local evidence

- `tests/terminal-url-history.test.ts`: direct 404/410, different URLs, robots, child pages, sitemaps, no false 403/503 classification, cache override, read failure, queued requests, persistence adapter restart, official verifier request changes, venue wrapper and lost result-completion replay.
- `tests/terminal-url-backfill.test.ts`: bounded offline plan, duplicate/refused counts, no fabricated dates, exact hash/write cap and repeat-apply reuse, all with in-memory fixtures.
- Existing retained technical fixture: 2 records, 0 terminal observations, 11 nonterminal responses, 0 refused. This fixture is not a production inventory export.
