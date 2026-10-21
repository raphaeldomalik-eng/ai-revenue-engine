# Option 1 minimal compatibility implementation plan

> Execute inline with test-first checks; one whole-branch review at completion.

Goal: the owner's approved Option 1 organisation/operator → commercial assessment → Apollo replay shortlist → human selection → saved intelligence journey, with no provider activation.

Architecture: retain existing research/contact APIs and assessment/Apollo adapters. Existing commercial records are reused without research overwriting their state. Add one RLS-protected organisation-scoped replay/intelligence table and an additive account metadata cross-reference to Nexus; canonical lookup is read-only. Production/pilot flags remain unchanged, replay is server-configured and production-disabled, no live provider fallback or selected enrichment exists in this path.

Spec: owner work package in this chat; audit findings F01/F02/F12 at the original workspace audit pack. No Option 2 consolidation.

Constraints: no paid/provider/network research, emails/queues, crawling, production/Staging mutations, bulk migration, publication, or change to #79/#58. One separate PR from main. Additive migration file only. Preserve legal/trading/operator/venue/person identities; no domain-based canonical creation/merge.

Review focus: refresh against existing verified contact/advanced opportunity; stale concurrent account metadata/context revision; untrusted shortlist/person selection; canonical identity/domain/venue conflicts; default-disabled/unauthorised/provider/error paths.

- [x] Task 1 — `research-persistence.ts` and existing research API: extract existing persistence calls, reproduce contact/opportunity overwrite, then reuse existing rows unchanged; keep fresh evidence/briefs as research history. Regression tests for old/new records and decisions/metadata/ownership.
- [x] Task 2 — organisation research service/store/reference reader and one additive migration: authoritative Nexus organisation/domain/venue read, explicit account reference, shared optimistic-version context. Reuse `contactResearchEligibility`, `searchPrimaryApolloBuyers` and `evaluateProspectIntelligence` outputs. No new qualification/scoring algorithm.
- [x] Task 3 — existing contact API and a small operator panel: explicit replay provider, link/search/select/read actions; persist server-held shortlist and human selection with no verified email, enrichment or outreach authority. Production remains held. Tests reject forged/stale/unbound selection and cover portfolio reuse.
- [x] Task 4 — complete non-paying HTTP/service/store journey, local browser UI acceptance, full repo gate and architecture check; review whole branch and batch one commit/push/PR. Record exact evidence and limits. Do not deploy or apply migration.

Baseline: isolated `codex/option1-minimal-compatibility` from `8bae160`; 40 relevant existing offline tests pass. Native worktree tool could not resolve the projectless parent; sibling Git worktree used. Dependencies reuse the existing node_modules through an ignored junction.

Acceptance results and limits: docs/delivery/option1-minimal-compatibility/README.md. Full gate, browser and local PostgreSQL proof passed; migration and production flags remain unapplied. Delivery is ready for one implementation PR.
