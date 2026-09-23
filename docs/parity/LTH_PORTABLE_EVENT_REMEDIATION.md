# LTH portable event-evidence remediation

**Technical state: `CUTOVER_READY` for the frozen cohort's required factual evidence.** Our Black Heart's current `robots.txt` disallows `?format=ical`; the crawler skips those optional calendar enrichments, records the policy constraint as a warning, and reports required HTML extraction as complete. No ICS URL was fetched and no cutover or Production activation is authorized by this finding.

## Frozen cohort, unchanged

- Acceptance baseline: [LTH PR #161](https://github.com/raphaeldomalik-eng/last-train-home/pull/161), capture `2eb9a2113e2a8bf8f4acf6004af63248a19ce5eeef372f4beb557c66c84d5845`, AI Revenue main after PR #39 `9868cb8b4448d8ba3a085a1ce251bb9427e6a556`.
- Cohort: the same three detail URLs, reference time `2026-09-23T12:00:00.000Z`, Europe/London, four HTML pages and eight total requests. No URL or reference-time substitution.
- Current raw listing hash still equals the baseline: `845dc8e29bb8cdf855b35192fd9a3cdeb16f0c004f571181b3e1b3d8ae20684d`.
- Current detail HTML hashes still equal the baseline, in cohort order: `7267a47fcf598eef5e9da75425280d701e3f970b01fd33457365ca6258bba612`, `ae14ba3b60505b4e2876fa9ec18562faced845f64c12df7289799a3d62e495b5`, `7879eae72a5ca4c450a8b92988ef7a86faf1aae1cb0a047611001b3c1017a274`.

The comparison was a read-only local invocation of the shared crawler against a fixed, in-memory listing and these DNS-pinned first-party HTML responses, checked against PR #161's stored LTH result. The same document set fed the existing extractors. The unchanged LTH capture harness remains intentionally strict about ICS and is not the evidence path for this revised optional-source decision; no deployed Preview endpoint was used.

## Result

The shared core returned **three** candidates, matching LTH's **three**. For each event, title, UTC start/end, explicit Europe/London timezone, venue, ordered performers, event ticket URL, and event image URL matched the frozen LTH evidence. The first-party HTML `data-item-id` matched the local part of LTH's ICS UID for all three; this is neutral source-item evidence, **not** a claim that the full ICS UID was obtained. Fingerprints were stable when only observation time changed. No source URL, ticket URL, or image URL was followed for evidence outside the fixed first-party capture.

The safety-aware crawl made **five** requests (robots, narrowed listing, three HTML details), fetched **four** HTML pages and **307,240** bytes, with zero redirects/retries. It skipped all **three** ICS links under the source's `Disallow:/*?format=ical` rule, recorded them as optional-calendar policy warnings, and reported `COMPLETED` for the required HTML traversal. It did not request or replay any blocked ICS URL.

Fixture-backed HTML+ICS extraction separately yields three valid factual candidates from the four original fixture details, with a bounded malformed-ICS warning for the fourth. That fixture requires ten requests (robots, listing, four HTML details, four ICS feeds), two more than its previous eight-request bound; the live three-event bound remains eight. Missing fixture TZID/source timezone is left unknown, and a moved-show venue conflict remains an LTH editorial/source-interpretation matter rather than a fabricated shared fact.

Verification on the optional-calendar status follow-up: TypeScript and lint passed; the full AI Revenue suite passed **352/352** tests, including existing shared-crawler and Resources tests; the production build completed. The Next.js build retained its existing ESLint-plugin configuration warning. Tests establish that optional robots-blocked calendars do not make complete HTML traversal partial, while required HTML left beyond the request bound still does. The compliant live HTML diagnostic reports `COMPLETED`, records all three skipped calendar URLs as policy warnings, and has stable replay.

## Decision gate

The frozen cohort demonstrates no remaining material portability gap in the required HTML evidence: three events, factual fields, stable source IDs/fingerprints, replay, deduplication, bounded traversal, and zero mutation adapters. The historical full ICS UID is optional corroboration; LTH's parser already falls back to canonical URL when a UID is absent, while ingestion requires a stable external key rather than the ICS UID format. The zero-mutation proof is structural: this shared-core extraction path and the read-only comparison instantiate no persistence, media, publication, or canonical-write adapter; no external ledger-row audit is claimed. This technical readiness does not execute the LTH cutover.
