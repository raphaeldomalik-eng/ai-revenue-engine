# Brave controlled integration — AIRE #78

Continues the existing standing-directory implementation with Nexus #57. Brave implements `PublicWebSearchProvider` and the existing signed research contracts; it does not create identities or publish listings. Search candidates share the existing verification/acquisition queue, with original provider evidence retained.

## Configuration and durable governor

Use the server-only environment-secret mechanism for `BRAVE_SEARCH_API_KEY` and `BRAVE_SEARCH_TEST_ALLOWANCE_ID`. Never expose either through a `NEXT_PUBLIC_` variable. Existing local secrets were not copied, changed or committed. A configured key alone does not permit a request.

Apply the additive search-allowance migration in an approved environment and create a verified allowance using the actual account's units, request price, verification reference and expiry. Rows default disabled. For this finite test the ceilings are **100 requests and 500,000 micro-USD ($0.50)**, at 5,000 micro-USD/request. They do not renew. The shared locked row reserves cost before network access; successful responses are cached, failures retain reservations, and no implicit retry or fallback purchases more requests. Do not reset receipts to retry unknown outcomes.

The signed-in Search prepaid account was verified on 21 October 2026: $5/1,000 requests; $5 monthly granted and $5 purchased balance; auto-reload off; grant resets 1 November UTC; purchased credit does not expire. Five live calls consumed $0.025 granted credit, $0 cash. Dashboard showed five calls and rounded $0.02 cost. Ninety-five requests/$0.475 remain in the first allocation. The other 1,900 equivalents remain reserved; future 200/400/1,300 stages are not authorised.

## Actual acceptance

Mocked adapter/SQL/signed integration completed before the live sample. Subsequent parser and integration debugging replayed cached searches with Brave transport denied. Five UK searches retained 50 links and prepared 17 current verification candidates. Against the existing frozen 41,156-row snapshot: two verified venue candidates, one new candidate and one existing OSM observation. One publisher site was correctly excluded. One acquisition completed; no canonical venue or listing was created. Credit cost per newly verified candidate: $0.025, not a claim of canonical or published inventory growth.

The connected local proof reaches Nexus evidence and an unsaved EventSuite readiness evaluation. The legacy canonical materializer still requires provider-specific identity/evidence and holds the new candidate; the complete deployed staging journey is **not accepted**. Continue the canonical handoff using cached evidence before expanding search. Full results and reproducible replay commands live with Nexus in `docs/evidence/brave-test-2026-10-21/README.md` and `scripts/run-brave-directory-test.mjs`.

Validation: full serial suite 753 tests (752 pass, one skip, zero failures); typecheck, lint and Production build pass. Nexus full suite 454 tests (447 pass, seven skips, zero failures). Concurrency, permissions, fail-closed accounting, cached replay, OSM/failure coexistence and idempotent search→verify→acquire progression are covered.

No remote migrations, deployment, production crawl activation, recurring Production search, extraction purchases, publication or venue outreach occurred. PRs remain drafts. Existing scheduler infrastructure is reused but no new recurring execution has been activated. Production requires completed staging acceptance and the existing exact release sign-off; normal mocked/cached development requires no additional owner approval.
