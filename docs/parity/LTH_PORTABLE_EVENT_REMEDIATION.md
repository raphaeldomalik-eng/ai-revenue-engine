# LTH portable event-evidence remediation

**Technical state: `CUTOVER_NOT_READY`.** This branch closes the shared extractor's factual HTML gaps on the frozen three-event cohort, but the full live dual-run cannot pass the source-safety gate: Our Black Heart's current `robots.txt` expressly disallows `?format=ical`. No ICS URL was fetched in the new live proof, and no cutover or Production activation is authorized.

## Frozen cohort, unchanged

- Acceptance baseline: [LTH PR #161](https://github.com/raphaeldomalik-eng/last-train-home/pull/161), capture `2eb9a2113e2a8bf8f4acf6004af63248a19ce5eeef372f4beb557c66c84d5845`, AI Revenue base `4d75155a3d29015ca77fac94f4d7fe22fc98e01e`.
- Cohort: the same three detail URLs, reference time `2026-09-23T12:00:00.000Z`, Europe/London, four HTML pages and eight total requests. No URL or reference-time substitution.
- Current raw listing hash still equals the baseline: `845dc8e29bb8cdf855b35192fd9a3cdeb16f0c004f571181b3e1b3d8ae20684d`.
- Current detail HTML hashes still equal the baseline, in cohort order: `7267a47fcf598eef5e9da75425280d701e3f970b01fd33457365ca6258bba612`, `ae14ba3b60505b4e2876fa9ec18562faced845f64c12df7289799a3d62e495b5`, `7879eae72a5ca4c450a8b92988ef7a86faf1aae1cb0a047611001b3c1017a274`.

The comparison was a read-only local invocation of the shared crawler against a fixed, in-memory listing and these DNS-pinned first-party HTML responses, checked against PR #161's stored LTH result. The same document set fed the existing extractors. It was **not** a successful rerun of the unchanged LTH live harness or a deployed Preview endpoint.

## Result

The shared core returned **three** candidates, matching LTH's **three**. For each event, title, UTC start/end, explicit Europe/London timezone, venue, ordered performers, event ticket URL, and event image URL matched the frozen LTH evidence. The first-party HTML `data-item-id` matched the local part of LTH's ICS UID for all three; this is neutral source-item evidence, **not** a claim that the full ICS UID was obtained. Fingerprints were stable when only observation time changed. No source URL, ticket URL, or image URL was followed for evidence outside the fixed first-party capture.

The safety-aware crawl made **five** requests (robots, narrowed listing, three HTML details), fetched **four** HTML pages and **307,240** bytes, with zero redirects/retries. It blocked all **three** ICS links under the source's robots rule and correctly reported `PARTIAL`, not `COMPLETED`. The source's rule is `Disallow:/*?format=ical`; the old harness's query-insensitive robots check did not catch it. We have not bypassed that rule to improve the result.

Fixture-backed HTML+ICS extraction separately yields three valid factual candidates from the four original fixture details, with a bounded malformed-ICS warning for the fourth. That fixture requires ten requests (robots, listing, four HTML details, four ICS feeds), two more than its previous eight-request bound; the live three-event bound remains eight. Missing fixture TZID/source timezone is left unknown, and a moved-show venue conflict remains an LTH editorial/source-interpretation matter rather than a fabricated shared fact.

Verification on this branch: TypeScript and lint passed; the full AI Revenue suite passed **351/351** tests, including the existing shared-crawler and Resources tests; the production build completed. The Next.js build retained its existing ESLint-plugin configuration warning. Review regressions also prove that two calendar performances sharing one URL retain separate UIDs and that a malformed structured date cannot abort the other events. The unchanged LTH live harness rerun stopped before page capture with `robots.txt disallows ...?format=ical`; the LTH fixture harness remained write-free and replay-stable, but its original eight-request fixture cap cannot cover four HTML+ICS pairs.

## Decision gate

`LTH_PARITY_GAPS_CLOSED` is **not** claimed. The portable HTML facts match the unchanged live bytes, but full UID parity and a completed live dual-run require owner permission for the ICS paths or another first-party, robots-permitted source of the complete UID. Once that external condition changes, rerun PR #161's frozen harness, then reassess its sign-off. The zero-mutation proof is structural: this shared-core extraction path and the read-only comparison instantiate no persistence, media, publication, or canonical-write adapter; no external ledger-row audit is claimed.
