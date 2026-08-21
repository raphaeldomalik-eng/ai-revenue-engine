# Codex Implementation Prompt — AI Revenue Research Team V1

Use this prompt only after the Agent Pack has been reviewed and is available in the repository.

```text
Implement AI Revenue Research Team V1 from the canonical agent pack.

REPOSITORY
C:\Users\rapha\dev\ai-revenue-engine

SOURCE OF TRUTH
Read ALL of these before changing code:

docs/agents/README.md
docs/agents/agent-spec-v1.md
docs/agents/deterministic-gates-v1.md
docs/agents/regression-corpus-v1.md
docs/agents/implementation-contract-v1.md
docs/agents/quality-retest-2026-08-21.md

Also read the controlling prospecting PRD:

docs/PRD/ai-revenue-prospecting-v1.md

The Agent Pack is the approved product behavior for agent roles and handoffs.
The prospecting PRD remains controlling for broader product policy.
If the documents appear to conflict materially, STOP and report the exact conflict before implementation.

BRANCH
feat/ai-revenue-research-team-v1

The branch and draft PR already exist for this coherent delivery slice.
Check out this exact branch and update the existing PR.
DO NOT create another branch or PR.
Do not merge.

==================================================
OUTCOME
==================================================

Replace the current shallow/mixed prospect research behavior with four
explicit model-driven roles plus deterministic policy gates:

1. Discovery Scout
2. Identity Resolver
3. Commercial Researcher
4. Buyer & Contact Researcher

The intended business outcome is:

credible signal
-> correct commercial organisation
-> evidence-backed EventSuite problem (or honest no-signal result)
-> relevant buyer/contact research with strict provenance
-> deterministic qualification/sales-readiness handoff.

The current database shows that technical enrichment often succeeds while
commercial advancement/contactability fails. Fix that structural outcome,
not merely prompt wording.

==================================================
IMPLEMENTATION DISCIPLINE
==================================================

First inspect the current pipeline and map existing code to the pack.
Reuse current OpenAI structured-output/web-search infrastructure and
existing source/identity/product/contact guards wherever correct.

Do NOT add an agent framework merely to model four roles.
Do NOT create four services if functions/contracts inside the current
architecture are sufficient.

The prompts in agent-spec-v1.md are canonical product behavior.
Implement them faithfully and version them.

==================================================
MUST
==================================================

- Discovery returns a signal/source, not an assumed prospect website.
- Identity Resolution exclusively owns authoritative target resolution.
- Source/event/organiser/organisation identities stay distinct.
- Identity output retains one primary target plus evidenced related organisations.
- Commercial Research researches the resolved organisation and maps
  evidence explicitly to EGS/TICKETING/ECC.
- Every product lens searches for and consumes supporting evidence plus
  counter-evidence/existing-system coverage.
- Generic validation is not commercial advancement.
- Product diagnosis consumes validated structured evidence.
- Buyer & Contact Research receives resolved target + commercial problem
  + likely buyer role.
- Contact research distinguishes actual email from contact-page-only.
- Every usable contact has target ownership provenance.
- Ticketing/provider/directory/venue/media contacts cannot leak into the
  organiser target.
- No guessed people or email patterns.
- Eligible resolved commercial prospects can reach contact research before
  being starved by final outbound readiness.
- Qualification/Account/outreach remain deterministic and separately gated.
- Preserve current bounded enrichment philosophy and max-four expensive
  candidate budget unless current implementation proves a stricter limit.
- Add/maintain prompt version telemetry using existing JSON where possible.
- Implement regression fixtures from regression-corpus-v1.md.

==================================================
MUST NOT
==================================================

Do NOT:

- loosen first-party or competitor protection;
- loosen Account qualification merely to increase counts;
- authorise outreach because a contact was found;
- add unbounded crawling;
- guess emails;
- bulk rewrite historical candidates;
- clean the database;
- run Quality Calibration V4;
- change Operator UI;
- implement Meta/LinkedIn/scheduling;
- redesign outreach/follow-up;
- add schema/migrations/RLS/auth unless unavoidable.

==================================================
SCHEMA / AUTH STOP RULE
==================================================

No schema, migration, RLS or auth change is expected.

If the required contact-research placement or structured state cannot be
implemented safely with current candidate/contact/JSON contracts:

STOP BEFORE CHANGING SCHEMA.

Return:

SCHEMA/RLS/AUTH CHANGE REQUIRED

with the exact blocker and smallest proposed change.

==================================================
REGRESSION ACCEPTANCE
==================================================

The canonical regression corpus must pass, including:

- TicketsZA/Tixsa source != organiser;
- official event site != organisation site by default;
- Event Production Show organiser promotion;
- eCommerce Expo organisation handoff;
- eCommerce Expo resolves to CloserStill Media and rejects historical UPTECH identity;
- parent/brand/operator/venue/provider relationships remain distinct;
- venue hosting != organiser;
- EventSuite self block;
- provider/competitor handling;
- provider presence alone != Ticketing pain;
- own ticketing system alone != Ticketing pain;
- mature website != EGS opportunity;
- sourced fragmented digital can support EGS;
- generic event != ECC;
- sourced multi-stage/workforce/vendor complexity can support ECC;
- mature integrated operations tooling prevents complexity-only ECC promotion;
- ArcTanGent generic official email is valid organisation fallback;
- Piece Hall named buyer without email remains buyer-no-email;
- Messe Frankfurt contact page without extracted value is not EMAIL_VERIFIED;
- ticketing provider support email is NOT target contact;
- guessed email is rejected;
- technical success != commercial advancement.

Use deterministic fixtures/mocks for core regressions.
Do not depend on live web results for regression correctness.

==================================================
VERIFICATION
==================================================

Treat source/identity/contact provenance and persistence boundaries as V3.
Treat normal prompt/orchestration changes as V2.

Run focused tests first.

Then once:

npm run check
git diff --check

Deploy exact PR head to Preview.

Run only a SMALL bounded live/replay acceptance sample after deterministic
regressions pass.

Do not run V4.
Do not send outreach.

Acceptance must show, with returned evidence:

- identity/source separation;
- resolved organisation handoff;
- product-specific commercial evidence or honest no-signal result;
- eligible candidate reaching Buyer & Contact Research;
- actual email classification accuracy;
- target provenance;
- rejected third-party contact example;
- zero outreach side effects.

==================================================
RETURN
==================================================

Return every item required by:

docs/agents/implementation-contract-v1.md
section "Codex result contract".

Include exact files, commands, outputs, Preview/deployment evidence,
database/contact evidence, risks and the exact next recommendation.

STOP.

Do not merge.
Do not run V4.
Do not clean historical data.
```
