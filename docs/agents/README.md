# AI Revenue Engine Agent Pack V1

**Status:** **AGENT PACK V1 — QUALITY-PROVEN FOR IMPLEMENTATION** (boundary re-test completed 2026-08-21).

**Purpose:** Define the model-driven research roles, deterministic policy boundaries, structured handoffs, contact-provenance rules, and regression cases that Codex must implement. The product is an **AI sales team, not a CRM**.

## Pack contents

1. [`agent-spec-v1.md`](./agent-spec-v1.md) — operating contract plus the four model-driven agent prompts and output contracts.
2. [`deterministic-gates-v1.md`](./deterministic-gates-v1.md) — non-model policy, handoff, qualification, contactability, and safety gates.
3. [`regression-corpus-v1.md`](./regression-corpus-v1.md) — known production failure cases that must become deterministic regression fixtures.
4. [`implementation-contract-v1.md`](./implementation-contract-v1.md) — rules for mapping this pack into the current repository without inventing product behavior.
5. [`quality-retest-2026-08-21.md`](./quality-retest-2026-08-21.md) — evidence-backed record of the four required boundary/stress cases.
6. [`outreach-composer-prompt-pack-v1.md`](./outreach-composer-prompt-pack-v1.md) — owner-approved draft-only outreach prompt source of truth.
7. [`outreach-composer-v1.md`](./outreach-composer-v1.md) — isolated Composer runtime, activation and review contract.

## Operating model

The research team is deliberately small:

1. **Discovery Scout** — finds credible current/recent event activity signals. It does **not** decide the customer.
2. **Identity Resolver** — establishes what the source is, who actually operates/owns the event activity, and the authoritative organisation identity.
3. **Commercial Researcher** — investigates the resolved organisation for evidence-backed EventSuite problems across Event Growth, Ticketing, and Event Operations.
4. **Buyer & Contact Researcher** — identifies the likely problem owner and a legitimate public route to that target, preferably an email, with strict ownership provenance.

Everything that decides persistence, blocking, qualification, sales readiness, dedupe, or outreach authority remains **deterministic policy**, not model discretion.

## Canonical pipeline

```text
DISCOVER SIGNAL
  -> RESOLVE COMMERCIAL ORGANISATION
  -> VALIDATE CURRENT / RECURRING EVENT ACTIVITY
  -> INVESTIGATE COMMERCIAL PROBLEMS
  -> DETERMINE CONTACT-RESEARCH ELIGIBILITY
  -> FIND BUYER / CONTACT WITH PROVENANCE
  -> DETERMINISTIC QUALIFICATION / SALES READINESS
  -> APPROVED OUTREACH
```

Important distinctions:

```text
Discovery source != event identity != organiser identity != organisation website

Contact page found != contact method found != verified email != buyer verified email

Technical model success != useful commercial advancement
```

## Product invariants

- Being unresolved is acceptable. Being confidently wrong is not.
- Ticketing platforms, directories, venue calendars, media, social pages, and other third-party pages are evidence unless they are independently proven to be the commercial target.
- An official event website is authoritative event evidence but is not automatically the organisation website.
- One primary commercial target is retained separately from evidenced parent,
  brand, commissioner, operator, venue, provider, production-partner and
  subsidiary relationships.
- A contact method belongs to the target only when evidence ties that method to the resolved target.
- No guessed people. No guessed emails. No inferred email patterns.
- No positive EventSuite opportunity without product-relevant evidence.
- Provider presence alone is context, not pain or switching intent.
- Every product lens must investigate counter-evidence and existing systems;
  complexity alone is not a strong opportunity when mature integrated coverage
  is evidenced and no gap/change signal is found.
- Contact research may be performed once a resolved, unblocked organisation has a credible commercial signal; contactability is part of completing a useful sales prospect, but contact availability is not permission to create an Account or send outreach.
- Outreach remains separately controlled and approved.

## Implementation status

This pack defines product behavior. Codex must first map it to the current repository contracts, reuse existing architecture, and preserve stricter existing safety controls. If a schema/RLS/auth change appears necessary, implementation must stop and report the exact reason instead of silently expanding scope.
