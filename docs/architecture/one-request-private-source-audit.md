# One-request private source audit capture

Local preparation only. Default disabled. This document does not authorize deployment, activation, another venue request, publication, or disposal of evidence.

## Scope and ownership

AIRE captures bytes already returned by its existing bounded public-web crawler, before parsing and extraction. Nexus remains canonical owner and Product remains publication owner. No new fetch, parser budget, render adapter, provider allowance, schema, role, endpoint, secret, or image/outreach permission is introduced. The exact canary still requires its normal signed request, policy and inventory/terminal-history gates.

Server configuration must name one request UUID and a finite UTC window:

- `NEXUS_DIRECTORY_AUDIT_REQUEST_ID`
- `NEXUS_DIRECTORY_AUDIT_VALID_FROM`
- `NEXUS_DIRECTORY_AUDIT_VALID_UNTIL`

All three are required. The interval must be positive and at most 30 minutes; capture must start inside it. Malformed, expired, future, overlong or mismatched configuration disables capture without changing normal acquisition. Each body is checked again against expiry before retention. No client request field can enable it. Changing the selector is a separate operational decision, not an automatic next-venue loop. Disable/remove the configuration after the authorized sample.

## Evidence and size

Capture is limited to an 8,000,000-byte serialized JSON receipt, including base64 expansion and metadata. Whole bodies are retained or explicitly marked omitted; no source is silently truncated. `storedBytes` is the exact UTF-8 JSON payload size, not PostgreSQL physical/compressed disk usage. `capturedBodyBytes` and `encodedBodyBytes` separately account for retained binary/text representations and base64. The normal crawl's existing per-response/request/page limits remain in force.

The immutable receipt contains:

- Actual signed request UUID and existing semantic request fingerprint (`requestSha256`), identity, queue, policy hash, run, attempt and reservation binding. This fingerprint uses the verifier existing request hash, not a new hashing convention or a raw wire-body hash.
- Original bounded response bytes as base64, SHA-256, byte count, observation time, HTTP status, MIME/charset and recognized content encoding.
- Sanitized URLs and an exact original-URL SHA-256. Credentials and credential-like query parameters are not retained as metadata. No request/response authorization, cookies or arbitrary headers are recorded.
- Separate hydration markup, rendered HTML (only if already enabled elsewhere) and parsed PDF text actually supplied for extraction. Original PDF bytes remain independently inspectable.
- Explicit transport/size-limit/capture-window/total-byte/record-limit gaps, terminal-history reuse and bounded crawl status/stop information.

Existing terminal-history fatal paths return a bounded failed CrawlOutput, so already-read response bodies survive while their original fatal disposition and usage uncertainty remain unchanged. An unexpected exception escaping the crawler before onCrawl is invoked can still leave no durable corpus. Treat a missing audit receipt as unavailable, never as a complete error audit, and do not recrawl to repair it. This finite sample does not add a new crash journal or change fatal semantics.

The snapshot is sealed in the existing `onCrawl` callback before extraction/identity approval, so unverified outcomes retain independent source evidence too. Error403/503 bodies are retained only if the original crawler read them. Existing404/410 responses deliberately skip bodies; terminal statuses and their omission remain explicit. Oversized, refused or aborted responses whose bytes the network layer never returns are gaps, not reconstructed content. Redirect/revalidation bodies already discarded by the production transport are also explicit exclusions. Audit capture does not recover them with another request.

`captureComplete` describes retention of the bounded observed response corpus, never all content available on the website. Unfetched linked pages, image pixels, unavailable JavaScript rendering and unknown external content remain unaudited. Metadata and source markup can expose missed link/image/form candidates, but do not prove image suitability, reuse rights or form usability. There is no new publication criterion.

## Private immutable persistence

The existing service-role-only `public.nexus_executor_results` ledger receives at most one auxiliary row per selected request:

- Idempotency key: `directory-audit:<request UUID>`.
- Unique database request ID: `directory-audit-receipt:<request UUID>`.
- Contract: `aire.directory-audit-receipt.v1`.
- Classification: `INTERNAL`.
- Corpus: private top-level `directoryAuditCorpus`.

The actual research request UUID is inside the binding, not reused as the auxiliary row's database request ID. The base ledger's existing `ignoreDuplicates` writer preserves the first receipt across retries and process restarts. It bypasses only the directory-result replacement RPC, exactly like existing auxiliary terminal evidence; no grant or SQL change is made. This creates one additional technical ledger row, not a venue execution or provider call. Ledger totals must filter contract versions rather than treating every row as a research result.

Normal receipts have only a private top-level `directoryAudit` reference/status. Shared research responses, cache responses, Nexus/Product evidence and crawl logs receive neither the corpus nor the private reference. The auxiliary contract cannot validate as a normal research result, does not use terminal keys, and contains no terminal backfill manifest/diagnostics field. Existing frozen backfill exports/plans are unchanged.

Every write is followed by readback with key/binding, exact serialized-size and stable-key-order SHA-256 verification. A prior receipt with the same semantic fingerprint is reported as reused, never as newly captured; changed source inputs under the same UUID are unavailable/collision, and cannot overwrite the original. Original run/attempt metadata remains attached to reused evidence. A write acknowledgement failure is not retried: matching readback can establish persistence; otherwise the audit is explicitly unavailable/uncertain. Audit failure does not change venue eligibility, consume extra requests, erase usage evidence or trigger another crawl. The operating coordinator must inspect the exact audit/normal receipts and stop further canaries when audit evidence is unavailable, rather than treating an ordinary pipeline response as a successful audit.

## Lifecycle and safe review

This is one finite private technical corpus retained alongside its receipt for the authorized audit. No recurring raw-source collection or general indefinite-retention policy is enabled. No automatic deletion is introduced or authorized. After the audit, the owner must explicitly decide whether to archive or remove this sample through a separately authorized operation; disabling capture does not delete existing evidence.

Read only through existing authorized private ledger access. Never publish the raw receipt, put it in repository fixtures/logs automatically, or attach it to shared/public results. Public source pages may contain contacts, identifiers and transient tokens despite their public origin. Review byte snapshots as inert offline data with network/script execution disabled; do not open HTML/PDF in a way that loads remote assets. Do not refetch website pages solely for this audit.

## Verification

Focused tests exercise exact/off/invalid/expired configuration, real route server wiring, unchanged acquisition and cache requests, unverified and error responses, full late/footer/form/image/link markup, original PDF/robots/sitemap bytes, hydration,404 body skipping, size/time gaps, JSONB key ordering, hash/readback uncertainty, and private auxiliary persistence through the existing SQL replacement function. Full AIRE verification remains required before release. No fixture result constitutes a live venue audit.
