# AI Revenue Engine Deterministic Gates V1

## 1. Purpose

Models research and propose. Deterministic policy decides what the system is allowed to promote, persist, qualify, contact, and send.

The following rules must not depend solely on model instruction-following.

---

# 2. Discovery Acceptance Gate

A discovery result may enter candidate research memory when:

- it contains a credible public/authorised source URL;
- it represents current/upcoming or reasonably recent recurring event activity, or a credible timing/change signal;
- it is not an obvious malformed/no-signal result;
- same-run dedupe does not identify it as redundant.

Discovery acceptance does **not** establish commercial identity.

The discovery source URL is evidence. It must not automatically populate the resolved commercial organisation website.

---

# 3. Source Authority Gate

Before a URL can become an authoritative commercial website, server-side policy must consider the resolved source/site type and identity evidence.

Allowed as authoritative target website when supported:

- `ORGANISATION_OFFICIAL`
- `EVENT_OFFICIAL` only when the event brand itself is the proven commercial target

Not sufficient by itself:

- `TICKETING_PROVIDER`
- `EVENT_LISTING_DIRECTORY`
- `VENUE_CALENDAR`
- `NEWS_EDITORIAL`
- `SOCIAL_COMMUNITY`
- `ARTIST_OFFICIAL`
- `UNKNOWN`

`VENUE_OFFICIAL` may be target identity only when the venue is itself the resolved operator/customer.

Do not implement this as a giant domain blacklist. Provider/domain lists may be supplementary known-source hints, not the deciding architecture.

---

# 4. Identity Promotion Gate

The Identity Resolver proposes a resolution. Deterministic code validates promotion.

Promotion to canonical commercial target requires:

- `RESOLVED` or valid `NOT_REQUIRED` state;
- canonical organisation name;
- adequate identity evidence;
- sufficient confidence under current policy;
- no first-party/competitor/provider block;
- authoritative target-site semantics where website is supplied.

On promotion:

- preserve original discovery signal/source as evidence;
- update organisation-centric target fields safely;
- recompute canonical identity;
- perform same-run/cross-run dedupe using existing semantics;
- do not violate unique constraints;
- do not lose the original event/activity link.
- preserve validated related organisations as relationship evidence without
  copying their identity, website or contacts into the canonical target.

Exactly one primary commercial target may be promoted. A parent/group,
operating brand, commissioner, appointed operator, venue, ticketing provider,
production partner or subsidiary/division remains a separate related entity
unless evidence independently proves it is the correct primary target. If
conflicting authoritative evidence prevents that distinction, promotion must
remain unresolved or enter precise human review.

If evidence is insufficient, remain `UNRESOLVED`. Do not fall back to the discovery provider/domain as target.

---

# 5. First-Party / Competitor / Provider Gate

Existing stricter policy remains controlling.

At minimum:

- EventSuite/current first-party identity must be blocked from ordinary prospecting/outreach.
- Direct competitors must remain blocked under existing competitor rules.
- A competitor/customer/provider relationship must be represented accurately rather than automatically conflated.
- A ticketing provider hosting an event is not the organiser.
- A genuine event organiser using a ticketing provider remains a potential prospect.

Model classifications cannot override deterministic block policy.

---

# 6. Commercial Research Eligibility Gate

Commercial Research may run when:

- commercial organisation is resolved (or organisation-first identity is authoritatively validated);
- current/recurring event activity is sufficiently supported;
- no deterministic block applies;
- the candidate remains within bounded research budget.

Do not spend commercial research budget on known duplicates/rejected/blocked/no-connection records unless a deliberate regression/replay mode explicitly requests it.

---

# 7. Product Evidence Gate

A model-supplied `COMMERCIAL_EVIDENCE` label is not sufficient.

Server-side interpretation must validate:

- product is one of EGS/TICKETING/ECC;
- evidence category is valid for that product;
- source exists;
- polarity/context is respected;
- evidence actually supports the claimed product conclusion.
- each product assessment considered both supporting evidence and
  counter-evidence (or explicitly recorded that bounded research found none).

Safe negative rules:

- ticketing provider presence alone does not support Ticketing opportunity;
- own ticketing system alone does not support Ticketing opportunity;
- mature/coherent owned website is negative or neutral for EGS;
- generic event existence does not support ECC;
- mature integrated operations tooling reduces ECC confidence unless separate
  evidence establishes a gap, fragmentation, manual work, change intent,
  procurement or dissatisfaction;
- an established integrated ticketing/registration model reduces Ticketing
  confidence unless separate problem/change evidence exists;
- event/organisation validation is not itself commercial evidence.

Positive opportunity strength must be produced from the net validated
product-relevant evidence, not generic prose scanning or complexity alone.

---

# 8. Commercial Advancement Gate

Technical research success and commercial advancement are separate.

`commerciallyAdvanced=true` only when meaningful progress occurs, such as:

- a previously unresolved target becomes safely resolved; and/or
- defensible product-specific commercial evidence is found; and/or
- primary opportunity becomes supportable; and/or
- buyer role becomes supportable; and/or
- qualification evidence materially improves.

Validation-only factual expansion does not automatically count as commercial advancement.

---

# 9. Contact Research Eligibility Gate

Contact research must not be starved until after every final sales state is reached.

It may be authorised as a bounded research step when all are true:

- target organisation is resolved/authoritatively validated;
- no first-party/competitor/suppression block applies;
- at least one credible commercial signal or defensible product hypothesis exists;
- a likely buyer role/function can be articulated, or a legitimate organisation-level contact fallback would materially improve actionability;
- contact research budget is available.

This gate authorises **research only**.

It does not:

- create Account eligibility by itself;
- authorise outreach;
- override qualification;
- bypass suppression.

The implementation should preserve the canonical PRD rule that an email is not required merely to retain useful research memory or to establish a commercial hypothesis.

---

# 10. Contact Provenance Gate

Every persisted/usable contact route must pass server-side consistency and ownership validation.

Required properties:

- actual route value when route type requires one;
- source URL;
- source site type;
- owner identity or explicit owner uncertainty;
- target relationship;
- ownership evidence;
- verification confidence.

## Hard consistency rules

`BUYER_EMAIL_VERIFIED`, `ROLE_EMAIL_VERIFIED`, or `ORGANISATION_EMAIL_VERIFIED` requires:

- non-null syntactically valid email;
- public evidence containing/supporting that address;
- route not classified `NOT_TARGET`;
- source/ownership relationship acceptable under policy.

`OTHER_DIRECT_CONTACT_VERIFIED` requires an actual non-email direct method value.

`CONTACT_PAGE_ONLY` may have a page/form URL with no email/phone.

`BUYER_IDENTIFIED_NO_ROUTE` may have a named buyer and role but no usable route.

`THIRD_PARTY_CONTACT_REJECTED` requires at least one retained rejected route
with `NOT_TARGET` relationship and a precise ownership/rejection reason, and it
must never set email readiness or sales readiness.

Do not persist a ticketing-provider/venue/directory/artist/media route as target-owned unless independent evidence explicitly establishes target attribution.

## Domain is evidence, not proof

Matching the target domain can strengthen ownership but is not sufficient by itself.

A different domain can still be valid when authoritative evidence explicitly attributes the route to the target.

---

# 11. Qualification Gate

Preserve the controlling prospecting PRD semantics.

A candidate may become commercially qualified only when there is sufficient evidence for:

- credible/resolved organisation;
- current or recurring event activity;
- adequate Event Connection;
- no deterministic block;
- at least one credible EventSuite commercial signal/hypothesis meeting policy.

Qualification does not require:

- every product to be positive;
- a named buyer;
- a personal email;
- a quota/score threshold invented for V1.

Contact research can improve actionability before/around qualification but does not replace the commercial evidence gate.

---

# 12. Sales Readiness Gate

Sales readiness is stronger than qualification.

For an outbound-email motion, conceptual `SALES_READY` requires:

- qualified/resolved commercial target;
- defensible commercial opportunity;
- appropriate buyer role/function;
- legitimate verified public contact route appropriate to the motion;
- actual email when the motion specifically requires email;
- no suppression/block;
- outreach approval/control state satisfied under current policy.

Do not add a new persisted enum solely because this conceptual UX/policy state exists. Map using current data unless a separate schema decision is approved.

---

# 13. Human Review Gate

`REVIEW_REQUIRED` must identify a precise human decision that a human can actually make.

Good examples:

- conflicting authoritative organiser identity;
- confirm a relationship where two credible official sources disagree;
- approve outreach under existing controls.

Bad example:

- "needs more research" when the AI can perform additional bounded public research itself.

---

# 14. Outreach Gate

Buyer/contact discovery does not authorise outreach.

Existing outreach controls remain controlling, including:

- approval per outbound action where required;
- suppression/unsubscribe/bounce safety;
- first-party/competitor guards;
- idempotency;
- follow-up limits;
- no fabricated claims.

Outreach generation must consume approved FACT/INFERENCE summaries and must not silently restart discovery/identity research.

---

# 15. Bounded Research / Cost Gate

Preserve current bounded enrichment philosophy.

- Discovery stays bounded by run candidate limits.
- Expensive identity/commercial enrichment should remain limited to the most promising eligible candidates per run (current architecture has used a maximum four-candidate enrichment budget; preserve that unless a separate product decision changes it).
- Buyer/contact research should run only for candidates passing the contact-research eligibility gate.
- Do not create unbounded crawling or repeated loops.
- A specialist may return `UNRESOLVED`/`NO_EVIDENCE`/`NO_VERIFIED_CONTACT` as a valid terminal result for that research attempt.

---

# 16. Telemetry Gate

Preserve technical telemetry but add/retain business-outcome distinctions where existing JSON contracts permit.

Minimum useful dimensions:

- agent/prompt version;
- attempted;
- succeeded technically;
- resolution outcome;
- commercial outcome;
- commercially advanced;
- buyer identified;
- contact research status;
- email ready;
- buyer email ready;
- target-contact provenance outcome.

Do not require schema changes solely for telemetry labels; use existing JSON where safe.
