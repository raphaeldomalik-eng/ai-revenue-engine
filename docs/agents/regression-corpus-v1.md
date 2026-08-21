# AI Revenue Engine Agent Regression Corpus V1

## Purpose

These cases come from observed production failures/successes and define the minimum regression behavior for the agent redesign.

Tests should use stable fixtures/mocked structured outputs rather than live web calls for core correctness. Live web acceptance may supplement but must not control deterministic safety regressions.

The historical records are evidence of prior behavior; do not bulk rewrite production history merely to make these fixtures pass.

---

# Identity / Source Regressions

## R1 — Women's Heritage Festival / TicketsZA

Observed historical failure:

- Signal: `Women's Heritage Festival 2026`
- Discovery source/website historically became `https://www.ticketsza.co.za/`
- Placeholder organiser-like identity was used.

Expected V1 behavior:

- Discovery Scout returns festival as event signal.
- TicketsZA is classified `TICKETING_PROVIDER` (or equivalent source hint).
- TicketsZA URL remains discovery/ticketing evidence.
- Discovery does not set TicketsZA as commercial website or organiser.
- Identity Resolver searches for official event/organiser identity.
- If organiser cannot be proven, target stays `UNRESOLVED`.
- No Account/contact/outreach from unresolved provider identity.

## R2 — GlowFest / TicketsZA

Same invariant as R1. No provider-as-organiser fallback.

## R3 — Potch Geesfees / Tixsa

Observed historical failure:

- Event signal used `tixsa.co.za` as website.

Expected:

- `TICKETING_PROVIDER` source.
- Provider retained as ticketing context only.
- Actual organiser must be independently resolved.
- Tixsa email/contact can never be assigned to event organiser merely because event is listed there.

## R4 — Afri-Indie Musiektoekennings / Tixsa

Expected same source-target separation. Do not invent `<Event Name> Organisers` as an entity.

## R5 — Electra Mining Africa / third-party listing

Observed source example: `capmad.com/events/...`

Expected:

- third-party listing classified as directory/editorial/context, not commercial target.
- event official site and organiser require independent resolution.

## R6 — Venue-hosting is not organising

Observed pattern: event listed at/through a venue such as SEC Centre.

Expected:

- venue occurrence/location does not prove organiser.
- venue may become target only if authoritative evidence shows it is the operator/programmer for the relevant activity.

---

# Organisation Resolution Regressions

## R7 — Event Production Show -> Mash Media Group

Observed historical enrichment found a statement equivalent to:

`Mash Media Group Ltd. is the organiser of Event Production Show 2026.`

but failed to promote the organisation.

Expected:

- noun-form organiser statement is understood semantically.
- official event site remains event evidence.
- Mash Media Group becomes proposed commercial organisation when authoritative evidence supports it.
- authoritative organisation website is researched separately.
- downstream Commercial Research receives Mash Media Group, not merely Event Production Show.

## R8 — eCommerce Expo -> CloserStill Media

Observed historical enrichment incorrectly identified UPTECH Events as the
organiser. Current official event and CloserStill portfolio evidence identifies
CloserStill Media as the organiser/operator.

Expected:

- CloserStill Media becomes the resolved primary commercial target.
- the historical UPTECH result is rejected/overridden when stronger current
  authoritative evidence is available;
- original eCommerce Expo signal remains event evidence.
- related entities (including venue, co-located events, suppliers or past
  partners) remain separate and do not contaminate the target.
- downstream research investigates CloserStill Media's portfolio and existing
  systems, not just the eCommerce Expo event page.

## R9 — Event brand legitimately is operator

Fixture should represent a case where an official event site provides authoritative legal/about/contact evidence that the event brand itself is the operating entity.

Expected:

- Identity Resolver may resolve the event brand as target.
- It must not invent a parent organisation just to avoid event-brand identity.

## R10 — Procurement commissioner vs operator

Observed signal class: a public body seeking a promoter/operator (e.g. Mzansi Roar Festival procurement signal).

Expected:

- commissioner/procuring organisation is not automatically labelled organiser.
- future promoter may remain unresolved.
- procurement/change signal is preserved for commercial/timing analysis.
- relationship is represented accurately rather than forcing one identity.

## R11 — EventSuite self prospect

Expected:

- first-party self identity deterministically blocked.
- no contact research.
- no outreach.
- evidence URLs mentioning EventSuite incidentally must not block unrelated prospects.

## R12 — Ticketing provider as organisation-first prospect

Examples: Quicket/uTickets/TicketsOnline-like providers.

Expected:

- Identity Resolver may correctly resolve provider identity.
- deterministic competitor/provider policy decides whether it is blocked/rejected/other relationship.
- provider identity correctness does not equal a commercial prospect success.

---

# Commercial Research Regressions

## R13 — Festival Republic: own ticketing system != pain

Observed historical issue:

- statement equivalent to `Festival Republic operates its own ticketing system` was treated as `COMMERCIAL_EVIDENCE` while Ticketing stayed `NO_EVIDENCE`.

Expected:

- classify as `OWN_SYSTEM_CONTEXT_ONLY` (or equivalent context category).
- no positive Ticketing hypothesis unless problem/change evidence exists.
- no disconnected generic `COMMERCIAL_EVIDENCE` label.

## R14 — Provider presence alone

Fixture: organiser uses one named ticketing provider.

Expected:

- provider use is Ticketing context.
- no switching intent/pain inferred solely from provider presence.

## R15 — Provider fragmentation

Fixture: same organisation's current portfolio is evidenced across multiple ticketing/registration providers with operationally relevant fragmentation.

Expected:

- may support Ticketing `POSSIBLE` or stronger depending on evidence.
- rationale must cite the portfolio/provider evidence.

## R16 — Mature owned digital negative EGS

Fixture: coherent official organisation/event architecture with strong owned presence.

Expected:

- `MATURE_COHERENT_PRESENCE_NEGATIVE` or equivalent.
- EGS should be `NO_EVIDENCE`/negative-safe, not positive merely because a website exists.

## R17 — Fragmented digital EGS

Fixture: multiple disconnected event microsites/pages and weak coherent owned destination are publicly evidenced.

Expected:

- product-specific EGS evidence.
- defensible EGS hypothesis when evidence supports it.

## R18 — Generic event existence != ECC

Fixture: one straightforward event with no sourced complexity.

Expected:

- no ECC positive signal.

## R19 — Sourced operational complexity -> ECC

Fixture: evidence supports multi-stage/concurrent programme plus accreditation/workforce/vendors/production coordination.

Expected:

- can support ECC `STRONG_HYPOTHESIS` without requiring explicit complaint language.
- exact facts must be retained.

## R20 — Anything Goes organisation-first enrichment

Observed historical behavior mostly re-validated that it is an entertainment/events agency.

Expected:

- identity validation is not enough to mark commercial success.
- Commercial Research deliberately investigates portfolio, owned digital model, ticketing model, and operations complexity.
- outcome may still be `NO_COMMERCIAL_SIGNAL`; that is acceptable if bounded research genuinely checked the commercial hypotheses.

## R21 — Mzansi Roar procurement/change signal

Expected:

- procurement/seeking-promoter evidence captured as `SIGNAL`.
- signal does not automatically establish organiser identity.
- Commercial Research considers whether the procurement/change context maps to an EventSuite opportunity/timing hypothesis.
- no forced positive result if product relevance remains unsupported.

---

# Buyer / Contact Regressions

## R22 — ArcTanGent generic organisation emails

Observed valid contacts:

- `info@arctangent.co.uk`
- `hello@arctangent.co.uk`

Expected:

- official target-owned public route may be classified `ORGANISATION_EMAIL_VERIFIED`.
- generic email is usable fallback when provenance is clear.
- do not label it a named buyer email.

## R23 — Piece Hall named buyer, no email

Observed:

- named person: Aaron Casserly Stewart
- role: Programme & Event Director
- official evidence exists
- separate official contact page exists
- no actual person email persisted.

Expected:

- `buyerIdentified=true`
- no `BUYER_EMAIL_VERIFIED`
- generic contact page alone is `CONTACT_PAGE_ONLY` unless an actual method is extracted.
- if a separate organisation email exists, preserve it as organisation route, not personal buyer email.

## R24 — Messe Frankfurt contact page says email/phone exists but values are null

Expected:

- do not classify email/phone as found until actual public values are extracted.
- page-only result is `CONTACT_PAGE_ONLY`.
- status and persisted values must be consistent.

## R25 — Ticketing provider support email

Fixture:

- target: Festival X / ABC Promotions
- discovery/ticket source: TicketsZA/Tixsa/etc.
- page exposes `support@provider.example`.

Expected:

- owner = provider
- target relationship = `NOT_TARGET`
- `usableForSales=false`
- never persist as organiser email.

## R26 — Venue email where venue is not organiser

Expected same ownership rejection unless official evidence ties route to resolved target or venue itself is target.

## R27 — Directory/media email

Expected not-target rejection.

## R28 — Official event site explicitly attributes organiser email

Fixture:

- event site is `EVENT_OFFICIAL`.
- contact page explicitly states `For organiser ABC Events contact events@abcevents.example`.

Expected:

- may be verified target organisation email even if source domain differs from organisation domain.
- ownership evidence, not domain equality alone, controls.

## R29 — Guessed email pattern

Fixture supplies named buyer and organisation domain but no public email.

Expected:

- no constructed email.
- return `BUYER_IDENTIFIED_NO_ROUTE` or fallback legitimate organisation route.

## R30 — Contact page only

Expected:

- `CONTACT_PAGE_ONLY`
- `emailReady=false`
- no fake email field.

---

# Deterministic Gate Regressions

## R31 — Technical enrichment success != commercial advancement

Model call parses successfully but only adds generic validation.

Expected:

- technical `SUCCEEDED=true`
- `commerciallyAdvanced=false`
- commercial outcome `VALIDATION_ONLY`.

## R32 — Valid product evidence consumed by product diagnosis

If validated commercial evidence is persisted, the corresponding product assessment must either consume it or explicitly explain why it is context/negative and does not support a positive hypothesis.

No orphan generic commercial-evidence label.

## R33 — Contact research before final outbound readiness

Resolved unblocked organisation + credible commercial signal + buyer-role hypothesis may become contact-research eligible even before the final outbound/sales-ready state.

Expected:

- contact research can run.
- Account/outreach policy remains independently gated.

## R34 — Verified-email state consistency

Any status containing `EMAIL_VERIFIED` requires a non-null actual email value and acceptable target provenance.

## R35 — Human Review precision

Generic `needs more research` cannot be the only human-review decision when autonomous bounded research is still possible.

## R36 — Primary target and related organisations remain distinct

Fixture: an event brand, its operating company, parent/group, venue and
ticketing provider are all evidenced.

Expected:

- exactly one evidence-backed primary commercial target;
- every material non-primary entity retained in `relatedOrganisations[]` with
  relationship, website, confidence and evidence;
- no website, contact or block state leaks between entities;
- unresolved when authoritative sources conflict and the primary target cannot
  be selected safely.

## R37 — Mature tooling counters complexity-only ECC

Fixture: London Packaging Week has multi-stage/exhibitor/meeting complexity,
while official evidence also shows an Easyfairs-operated app, interactive
floorplans, AI matchmaking, meeting scheduling and smart badges.

Expected:

- complexity facts remain valid ECC context;
- the mature integrated operating stack is recorded as negative/counter-evidence;
- complexity alone does not create `STRONG_HYPOTHESIS`;
- a positive ECC result requires separate evidence of a gap, fragmentation,
  manual work, procurement, dissatisfaction or change intent.

## R38 — Four equal discovery lanes

Fixtures cover `EVENT_FIRST`, `ORGANISATION_FIRST`, `PERSON_FIRST` and
`VENUE_FIRST` independently.

Expected:

- each lane reaches the shared identity handoff when its minimum evidence is
  present;
- organisation-first uses UK legal-company evidence before Apollo and preserves
  legal company versus trading organisation;
- event-first resolves the organiser before legal validation and never
  substitutes the venue, supplier or discovery provider;
- venue-first uses physical-place evidence before operator/legal validation and
  preserves venue, operational employer and legal operator separately;
- person-first preserves the person, role and evidenced organisation/event
  relationships without claiming ownership;
- venue-first may retain the venue/operator as the prospect, while venue
  hosting never becomes organiser evidence;
- credible identity and event-sector relevance can continue without proven
  pain, while product evidence improves prioritisation;
- Apollo remains downstream of deterministic identity/domain checks, with
  maximum-five search, ranking, human selection and no automatic enrichment;
- the same organisation found through multiple lanes deduplicates through
  the existing canonical identity key;
- old stored origin strings remain readable and no production records are
  rewritten.

---

# Acceptance bar

For this corpus:

- zero known provider/listing/venue-as-target false promotions;
- zero known third-party contact-as-target false attributions;
- zero guessed-email outputs;
- zero `EMAIL_VERIFIED` states with null email;
- zero positive Ticketing results from provider presence alone;
- zero positive EGS results from website existence alone;
- zero positive ECC results from event existence alone;
- Event Production Show-style organiser statement promotes correctly when evidence is authoritative;
- original discovery signal remains preserved after organisation promotion;
- primary and related organisations remain distinct;
- supporting evidence and counter-evidence are both investigated and consumed;
- technical-success telemetry remains distinct from business advancement.
- all four discovery lanes remain distinct from any commercial/change signal
  attached to them.
