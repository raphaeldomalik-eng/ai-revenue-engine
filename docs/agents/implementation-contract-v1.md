# AI Revenue Engine Agent Pack — Implementation Contract V1

## Purpose

This document tells Codex how to implement the approved agent pack without re-inventing the product behavior.

The prompt/spec documents are the product source of truth for agent responsibilities. Existing repository safety controls that are stricter remain controlling unless they conflict with an explicit approved product rule.

---

# 1. Required implementation approach

Before code changes, inspect the current repository and map:

- current autonomous prospect discovery prompt/schema;
- current enrichment prompt/schema;
- organisation-resolution logic;
- related-organisation representation and persistence boundaries;
- source/site classification;
- Event Connection/freshness logic;
- commercial evidence/product diagnosis;
- buyer role inference;
- contact research prompt/schema;
- contact persistence;
- qualification/account gate;
- first-party/competitor/provider guards;
- outreach gates;
- telemetry/version fields;
- current tests and production regression fixtures.

Do not perform a repository-wide audit. Inspect only the pipeline needed to implement this pack.

---

# 2. Architecture rule

Implement four model-driven roles:

1. Discovery Scout
2. Identity Resolver
3. Commercial Researcher
4. Buyer & Contact Researcher

They may share one model/provider infrastructure. "Four roles" does not require four separate services, queues, databases, or deployment systems.

Prefer existing OpenAI/structured-output/web-search architecture.

Do not introduce an agent framework merely to label these roles.

---

# 3. Prompt ownership

The runtime prompt content must remain recognisably faithful to `agent-spec-v1.md`.

Codex may adapt formatting/token-efficient wording only when:

- semantics are unchanged;
- explicit safety/product rules remain;
- output contracts remain equivalent;
- tests prove the intended behavior.

Do not let Codex replace the approved prompts with generic "research this lead" instructions.

Keep one canonical runtime prompt definition per role.

Version them explicitly:

- `discovery-scout-v1`
- `identity-resolver-v1`
- `commercial-researcher-v1`
- `buyer-contact-researcher-v1`

---

# 4. Structured output

Use strict structured outputs/JSON schema for each model role.

Do not persist free-form model prose as authoritative state without parsing/validation.

No chain-of-thought fields.

Validate enum values, URLs, evidence shape, confidence, contact values, and product categories server-side.

Identity output must preserve exactly one primary commercial target plus a
bounded `relatedOrganisations[]` collection. Relationship evidence must not
cause websites, contacts or block states to leak between entities.

---

# 5. Orchestration

Target orchestration:

```text
Discovery Scout
  -> deterministic discovery acceptance/dedupe
  -> Identity Resolver
  -> deterministic identity/source/promotion guard
  -> Commercial Researcher
  -> deterministic product evidence + contact-research eligibility guard
  -> Buyer & Contact Researcher where eligible
  -> deterministic qualification / sales-readiness / persistence gates
```

A single bounded enrichment operation may internally perform Identity Resolver then Commercial Researcher for a selected candidate if this is cheaper and clear in the current architecture, but the two contracts and outcomes must remain logically distinct and independently observable.

Do not collapse the roles back into one generic prompt.

---

# 6. Research budget

Preserve current bounded behavior.

- Do not increase the current maximum-four expensive enrichment candidates per discovery run unless separate evidence/product approval justifies it.
- Identity + commercial research may share that budget.
- Buyer/contact research is only for candidates passing the explicit eligibility gate.
- No unbounded crawling/retry loops.

If cost/latency requires choosing between more candidates and deeper research, prefer sufficient depth on the bounded best candidates so that the engine can actually resolve identity and commercial relevance.

---

# 7. Contact research placement

Current production behavior has starved Contact Research because almost nothing reaches the existing final gate.

Implement the approved conceptual change carefully:

- allow bounded Buyer & Contact Research when target identity is resolved, candidate is unblocked, and credible commercial evidence/primary problem exists;
- this authorises research only;
- do not loosen Account creation or outreach eligibility merely to enable contact research;
- preserve the canonical PRD rule that qualification/research memory does not require a named person or email;
- for email-led outbound, expose `emailReady` separately from qualification.

If the current persistence architecture absolutely requires an Account ID before contact research and changing that would require a schema/migration/RLS change, STOP and report the smallest design choice required. Do not silently add schema in the first implementation slice.

---

# 8. Contact status correction

The implementation must distinguish:

- buyer verified email;
- role/department verified email;
- organisation verified email;
- other direct method found;
- contact page/form found;
- buyer identified with no route;
- no target contact found.
- third-party contact found and explicitly rejected.

Do not allow a contact-page-only result to masquerade as an email-ready contact.

Persist/mapping can reuse current JSON fields where possible; do not add schema solely for a nicer enum unless unavoidable.

---

# 9. Provenance guard

Implement deterministic checks that prevent:

- ticketing provider contact -> organiser contact;
- directory contact -> organiser contact;
- unrelated venue contact -> organiser contact;
- artist/agent contact -> organiser contact;
- media contact -> organiser contact;
- guessed email -> persisted verified contact.

Ownership evidence must be explicit and reviewable.

Domain matching may support but cannot alone establish ownership.

---

# 10. Product evidence handoff

Commercial Research output must map evidence to EGS/TICKETING/ECC explicitly.

Product diagnosis must consume validated structured evidence.

Preserve deterministic safe-negative rules.

For every product lens, the runtime must deliberately research and return both
supporting evidence and counter-evidence/existing-system coverage. Product
strength must reflect the net evidence. Operational complexity alone cannot
support a strong ECC hypothesis when mature integrated tooling is evidenced
and no gap, fragmentation, manual work, procurement, dissatisfaction or change
signal is found. Apply the equivalent rule to mature owned digital for EGS and
established ticketing/registration systems for Ticketing.

Do not retain the old failure mode where a generic fact is labelled `COMMERCIAL_EVIDENCE` but no product assessment can explain its relevance.

---

# 11. Telemetry

Preserve current technical metrics and expose business outcomes separately.

At minimum, where existing JSON permits:

- role/prompt version;
- technical attempted/succeeded;
- identity resolution outcome;
- commercial research outcome;
- commercially advanced;
- contact research status;
- actual verified email;
- buyer identified;
- buyer verified email;
- target provenance accepted/rejected.

Do not count technical provider response as commercial success.

---

# 12. Regression tests

Implement stable tests covering every material invariant in `regression-corpus-v1.md`.

Prioritise deterministic fixtures over live web tests.

Core acceptance must include at least:

- TicketsZA/Tixsa source-target separation;
- official event vs official organisation distinction;
- Event Production Show -> organiser promotion;
- eCommerce Expo -> CloserStill Media, rejecting the historical UPTECH result;
- primary target + related-organisation boundary preservation;
- same-run re-key/dedupe safety;
- Festival Republic provider-context negative;
- positive EGS/Ticketing/ECC structured evidence mapping;
- counter-evidence/existing-system consumption for all three product lenses;
- London Packaging Week mature integrated operations counter-evidence;
- ArcTanGent generic target email valid;
- Piece Hall named buyer/no email distinction;
- contact-page-only distinction;
- ticketing-provider email rejection;
- guessed-email rejection;
- first-party self block;
- technical success vs commercial advancement distinction.

---

# 13. No historical rewrite in implementation slice

Do not bulk re-enrich, rewrite, delete, or normalise the existing 236 historical candidate records as part of implementing the agents.

Historical failure data is valuable evaluation material.

A later replay/cleanup slice can use the corpus once the new pipeline is proven.

---

# 14. No outreach change in first slice

Do not change actual send/approval/follow-up behavior in the agent-pack implementation unless a narrow compatibility change is strictly required.

The pack ends at research, qualification/sales-readiness evidence, and safe handoff to existing outreach policy.

---

# 15. Schema / RLS / auth stop rule

No schema, migration, RLS, or auth change is expected for the initial implementation.

If one is genuinely required:

STOP before implementing it.

Return:

`SCHEMA/RLS/AUTH CHANGE REQUIRED`

with:

- exact missing capability;
- why existing JSON/current tables cannot support the behavior;
- smallest proposed change;
- migration/rollback implications.

---

# 16. Verification

Risk is V3 around identity/persistence/contact provenance; normal prompt/orchestration changes are V2.

Verification should be risk-proportional:

1. focused regression fixtures first;
2. current prospecting/contact tests;
3. type/lint/build final gate;
4. exact-head Preview;
5. no more than a small bounded live acceptance sample using new prospects or approved replay fixtures;
6. prove no unauthorised outreach/contact mutation;
7. inspect contact provenance and product evidence in real output.

Do not run a broad V4 calibration until the agent implementation passes its focused acceptance.

---

# 17. Implementation completion criteria

The slice is not complete merely because all model calls parse.

It is complete only when:

- Discovery no longer treats source URL as commercial website by default;
- Identity safely separates event/source/organiser/organisation identities;
- resolved target is handed to commercial research;
- commercial research produces product-specific evidence or an honest no-signal outcome;
- provider/context evidence cannot silently become positive product need;
- eligible commercial prospects can reach Buyer & Contact Research;
- contact statuses match actual extracted values;
- third-party contact attribution is blocked;
- no guessed email can persist;
- technical success is separate from commercial advancement;
- regression corpus passes;
- existing auth/RLS/outreach protections remain intact.

---

# 18. Codex result contract

Codex must return all evidence required for the next decision, including:

1. RESULT
2. branch
3. HEAD
4. PR
5. exact files changed
6. current pipeline before change
7. implemented role mapping
8. Discovery Scout runtime prompt location/version
9. Identity Resolver runtime prompt location/version
10. Commercial Researcher runtime prompt location/version
11. Buyer & Contact Researcher runtime prompt location/version
12. structured schemas
13. deterministic source/identity guards
14. product-evidence validation
15. contact-research eligibility change
16. contact-provenance guard
17. contact status semantics
18. guessed-email prevention
19. first-party/competitor/provider regressions
20. regression corpus test mapping
21. focused tests/results
22. npm run check
23. git diff --check
24. schema/migrations/RLS/auth changes
25. Preview deployment and exact head
26. bounded live/replay acceptance evidence
27. contacts/emails found in acceptance
28. evidence that any email belongs to target
29. evidence of rejected third-party contacts
30. commercial advancement results
31. database mutation/outreach deltas
32. deliberately deferred items
33. unresolved risks
34. acceptance criteria met YES/NO
35. READY FOR PRODUCT REVIEW YES/NO
36. MORE MODEL SPEND JUSTIFIED YES/NO
37. EXACT NEXT RECOMMENDATION
