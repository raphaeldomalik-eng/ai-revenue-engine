# Direct Prospecting & ICP Intelligence V1

**Status:** Canonical product contract — documentation only  
**Owner:** AI Revenue Engine  
**Commercial scope:** Event Suite Direct Sales  
**Territories:** South Africa and the United Kingdom for activated V1 programs; Europe is strategic direction only

## 1. Purpose

Direct Prospecting & ICP Intelligence turns public, source-grounded event and organisation evidence into a reviewable account decision. It identifies the organiser, resolves one account, evaluates the Event Suite commercial engines, names the likely problem owner, and recommends the next action.

This is a decision-support contract. It is not an authorisation to build autonomous discovery, send outreach, create CRM automation, or mutate production data.

## 2. Commercial thesis

Event Suite wins when it helps an organiser run and grow an event with less operational friction and better discoverability. A credible product problem is sufficient for a prospect; a prospect does not need to need every module.

The V1 lenses are:

1. **Ticketing V2** — ticket operations, orders, audience and attendee operations, issue resolution, reporting and reconciliation, scanning and entry, exceptions, guests and comps, products, add-ons, upgrades, experiences, merchandising and fulfilment.
2. **Event Growth Studio (EGS)** — an AI-assisted, source-grounded, typed event microsite CMS that turns approved event facts and content into discoverable public pages.
3. **Event Command Center (ECC V3)** — lifecycle-first orchestration that keeps one authoritative event fact and directs the organiser to the next action, attention item, milestone or specialist capability.

RSVP, workforce, production operations and other EventSuite capabilities may provide evidence or complexity signals, but do not create independent V1 campaigns.

## 3. Scope and exclusions

### In scope

- Public prospect and event evidence.
- Account identity and relationship resolution.
- Territory, language and commercial-program fit.
- Ticketing, EGS and ECC opportunity assessment.
- Buyer/problem-owner hypotheses.
- Qualitative priority, evidence quality and next action.
- Acquisition versus expansion classification.
- Human review before any outreach.

### Explicitly out of scope

- Autonomous web discovery or scheduled crawling.
- Automated email, social outreach, Gmail or SendGrid.
- CRM replacement, contact enrichment providers or lead purchasing.
- Local Operator Network / partner organisations, partner members or partner authorisations.
- Demographic inference, sensitive personal data inference or scraping behind access controls.
- Changes to Event Suite, Supabase, Ticketing Audience A3, PR #1674 or the existing Outreach PR #7.

## 4. Decision hierarchy

Every candidate follows this order:

`candidate → hard exclusions → account relationship → territory → lens assessment → primary opportunity → buyer/problem owner → outreach eligibility → account strategy → outreach`

The system must not skip relationship classification, silently turn `UNKNOWN` into `PROSPECT`, or infer outreach eligibility from a promising event alone.

### Event connection gate

Every ordinary Direct EventSuite sales opportunity must also have an explicit EventSuite-relevant event connection. An organisation's sector, size, technology, topic or general interest in events is not sufficient. The connection is `CONFIRMED` when source-grounded evidence identifies an actual relevant event or active event programme, `STRONG` when reliable recurring event activity is established but the exact opportunity needs detail, `WEAK` when events are only plausible or generically mentioned, and `NONE` when no meaningful event connection is established. Only `CONFIRMED` or `STRONG` connections may proceed to lens qualification; `WEAK` requires review/research and `NONE` blocks ordinary Direct outreach.

## 5. Relationship and eligibility policy

### Account relationship

Use exactly one primary relationship:

| Relationship | Meaning |
|---|---|
| `PROSPECT` | Organisation may be approached for a direct Event Suite commercial conversation. |
| `CUSTOMER` | Existing Event Suite customer; assess expansion or retention context. |
| `PARTNER` | Commercial or channel relationship; not a direct prospect by default. |
| `COMPETITOR` | Organisation provides or sells competing ticketing technology/platform capability. |
| `UNKNOWN` | Evidence is insufficient to classify the relationship. |

Competitor ticketing technology/platform companies are hard DNC: `COMPETITOR → BLOCKED`. This is not limited to Quicket. An organisation that runs an event using a competitor remains a valid prospect; the event organiser and the technology provider must be resolved as different entities.

### Outreach eligibility

Use exactly one:

- `ELIGIBLE` — direct prospecting is permitted after normal human review.
- `REVIEW_REQUIRED` — evidence, identity, relationship or territory needs review.
- `BLOCKED` — hard exclusion or explicit relationship policy prevents outreach.

## 6. Evidence contract

Every material claim stores:

- `claim` and claim type;
- `FACT`, `INFERENCE` or `UNKNOWN` classification;
- source URL or durable source reference;
- publisher/organisation, observed date and freshness where available;
- evidence excerpt or structured observation;
- confidence and evidence quality;
- conflicts and unresolved questions.

Facts are externally observable or owner-confirmed. Inferences are labelled hypotheses derived from facts. Unknowns remain visible and are never filled with plausible prose. No price, date, venue, capacity, availability, payment or operational claim may be invented.

Evidence quality is qualitative: `HIGH`, `MEDIUM`, `LOW` or `UNKNOWN`. Source quality and confidence are separate from opportunity priority.

## 7. Opportunity strength and priority

Each lens returns one of:

`CONFIRMED_NEED | STRONG_HYPOTHESIS | POSSIBLE | NO_EVIDENCE | NOT_APPLICABLE`

A primary opportunity requires `CONFIRMED_NEED` or `STRONG_HYPOTHESIS`. `POSSIBLE` is a secondary hypothesis only.

Priority is qualitative: `HIGH`, `MEDIUM` or `LOW`, with explicit reasons. It must not be a simplistic 0–100 score. Reasons may include urgency, repeated/complex operations, audience or revenue exposure, evidence quality, poor owned presence, expansion fit and reachable problem owner. Small size or low volume is not itself a negative priority reason.

## 8. Lens: Ticketing V2

Ticketing assessment describes the organiser’s actual operating problem, not merely “selling tickets.” Relevant evidence can include fragmented order or attendee handling, manual issue resolution, reconciliation burden, scanning/entry exceptions, guest and complimentary allocation, product/add-on complexity, upgrades, experiences, merchandise, fulfilment, reporting or settlement questions.

The contract must distinguish current capability, approved direction and future direction in the controlling Ticketing V2 documents. It must not promise a feature merely because it appears in a future plan.

Signals include repeated events, multiple ticket types, timed entry, guest/comps, add-ons, merchandise, multiple sales channels, reconciliation pain or operational complexity. Ticket volume is a priority signal, never a hard inclusion threshold.

## 9. Lens: Event Growth Studio

EGS is an AI-assisted, source-grounded, typed event microsite CMS. It creates approved visible content and derives discoverability projections for search, Google, Bing, AI search, answer engines, LLM retrieval, local, image and entity discovery.

It is not generic SEO software and not a generic website builder. It must not promise rankings or traffic. Visible content quality comes before metadata, structured data, canonical, internal-link, locale or LLM-readiness projections. It must never invent event facts.

Public output types may include Event Guide, Ticket Explainer, Programme/Schedule, Performer/Lineup, Activities/Experiences, Stay/Accommodation, Travel/Venue, Audience Guide, Food/Hospitality/Markets and Vendor/Exhibitor. The output is ticketing-agnostic: where no EventSuite Ticketing need exists, EGS may still recommend a provider-neutral canonical event profile that routes to the organiser’s canonical ticketing path.

The strongest EGS pattern is a credible event and audience with a weak, fragmented or absent owned digital presence. This can be `HIGH` even when the operator is small and no Ticketing need is evidenced.

## 10. Lens: Event Command Center

ECC is lifecycle-first orchestration, not a second specialist product. The commercial signal is an event or event portfolio whose coordination burden creates a need for one authoritative event fact, cross-product readiness, milestones, attention items and next-best-action guidance.

Complexity signals may include multi-day, stage, space or venue structure; supplier ecosystems; teams/workforce; technical production; exhibitors/vendors; guest operations; complex schedules; recurring series; simultaneous events; or specialist workstreams. Complexity may remain a clearly labelled hypothesis. The system must not invent a spreadsheet, team or process to justify it.

## 11. Regional and language policy

### South Africa

South Africa is national, not metro-only. Small-town and regional events are valuable. Use English or Afrikaans only when observable communications support that conclusion; do not infer language, ethnicity or demographics. Price pressure, payment settlement and affordability are signals only when evidenced, not assumptions.

### United Kingdom

Small organisers, grassroots events and small venues are important prospects. “Underserved by existing providers” is a valid evidence-backed signal; low volume is not a blocker. Assessment should reflect the UK organiser-controlled payment model and Stripe Connect-style operating expectations where the source supports that fact.

### Europe

Europe remains strategic direction only. V1 must not imply that every European market, language, payment model or commercial program is activated.

## 12. Small operators and regional events

Small operators are not a lower-value class. A small event may have a high EGS or ECC priority when its audience is active, its owned presence is weak, or its organiser carries disproportionate coordination work. The system should separate size from evidence quality and urgency.

### Required scenario: small regional event with minimal organiser footprint

When public event information shows an active regional event, but the organiser has little or no meaningful corporate web presence and information is fragmented, the expected result is:

1. identify the organiser from event evidence;
2. create or resolve exactly one organiser account;
3. retain the event evidence and unresolved identity questions;
4. assess EGS as `HIGH` when the weak owned presence and audience signal are well evidenced;
5. do not penalise priority because the event is small;
6. target the organiser or problem owner, not an invented enterprise marketing persona.

## 13. Artist and manager vertical

Artist or manager candidates are exploratory Tier 2 only. They become a direct prospect when evidence shows they control or promote their own event economics or operating workflow. Otherwise classify the relationship and opportunity as `REVIEW_REQUIRED`, `POSSIBLE` or `NOT_APPLICABLE` as appropriate. Do not treat a performer credit alone as an organiser account.

## 14. Buyer and problem-owner model

The persona follows the primary problem:

`ECONOMIC_BUYER | PROBLEM_OWNER | OPERATIONAL_INFLUENCER | EXECUTIVE_SPONSOR | UNKNOWN`

Examples include organiser/founder, event director, ticketing or box-office lead, marketing/growth lead, finance/reconciliation owner, operations lead, venue operator or production lead. A name is not required for a valid role hypothesis. Unknown remains acceptable.

## 15. Acquisition versus expansion

These are separate motions:

- **Acquisition:** `PROSPECT` account with no established EventSuite relationship.
- **Expansion:** `CUSTOMER` account with a confirmed or strong hypothesis for another lens/capability.

Do not mix customer expansion with new-logo prospecting. Do not treat a customer’s existing module usage as proof that every additional problem exists.

## 16. Canonical machine output

The implementation contract is conceptually equivalent to:

```yaml
account:
  canonical_name: string
  relationship: PROSPECT|CUSTOMER|PARTNER|COMPETITOR|UNKNOWN
  identity_confidence: HIGH|MEDIUM|LOW|UNKNOWN
territory: ZA|UK|EU_STRATEGIC|UNKNOWN
language:
  value: EN|AF|OTHER|UNKNOWN
  basis: FACT|INFERENCE|UNKNOWN
outreach:
  eligibility: ELIGIBLE|REVIEW_REQUIRED|BLOCKED
  block_reason: string|null
  motion: ACQUISITION|EXPANSION|UNKNOWN
priority:
  level: HIGH|MEDIUM|LOW
  reasons: [string]
primary_opportunity:
  engine: TICKETING|EGS|ECC|UNKNOWN
  strength: CONFIRMED_NEED|STRONG_HYPOTHESIS|POSSIBLE|NO_EVIDENCE|NOT_APPLICABLE
  problem: string
  buyer_persona: ECONOMIC_BUYER|PROBLEM_OWNER|OPERATIONAL_INFLUENCER|EXECUTIVE_SPONSOR|UNKNOWN
ticketing: {status, strength, facts, inferences, unknowns}
egs: {status, strength, facts, inferences, unknowns}
ecc: {status, strength, facts, inferences, unknowns}
secondary_opportunities: [string]
events: [{name, role, evidence}]
evidence: [{claim, classification, source, observed_at, quality, confidence}]
next_action: string
```

`status` is lens-specific and must not be interpreted as a numeric score. `null` and `UNKNOWN` carry meaning and must remain distinct from an empty string or a false claim.

## 17. Outreach boundary

The first contact uses only the primary engine and primary problem. Secondary opportunities inform account strategy but do not create a multi-product pitch. Outreach is never sent automatically by this contract; human review must confirm identity, relationship, evidence, eligibility and the proposed problem statement.

### Next best commercial action / CTA strategy

Prospect Intelligence selects the lowest-friction credible next commercial action; Outreach executes it. The default cold-prospect product destination is the public [EventSuite landing page](https://www.eventsuite.pro/), not an onboarding or other specialised setup route. It must not invent or over-specialise product destinations, trials or URLs.

Every eligible Direct prospect normally receives a structured free Resource Centre offer matched to the evidenced event, problem and likely owner. Only verified canonical Resource Centre URLs may be used; when no individual match is safe, use the [Resource Centre](https://www.eventsuite.pro/resources) root. Product discovery and useful free value should normally both appear somewhere across the bounded sequence, while each individual email retains one primary CTA. A call is never the default objective: high-complexity, migration, procurement, enterprise or multi-team situations may justify a human-assisted walkthrough. EGS may lead with a short personalised event insight rather than a meeting.

## 18. Discovery requirements for a future implementation

Future discovery must support public-source collection, source freshness, canonical URL retention, duplicate resolution, organisation/event separation, competitor detection, evidence provenance, conflict handling, rate limits, robots/terms compliance, opt-out/DNC, auditability and human review. It must not scrape access-controlled content or invent contact details.

## 19. Acceptance scenarios

| Scenario | Required policy result |
|---|---|
| A. Quicket-like ticketing platform | Resolve as `COMPETITOR`; eligibility `BLOCKED`. |
| B. Small Afrikaans regional festival | Organiser is one account; language is evidence-based; small size does not penalise; EGS or Ticketing may be primary. |
| C. Small UK venue | Valid prospect; low volume is not a blocker; assess underserved/organiser-controlled payment evidence. |
| D. Organiser using competitor ticketing with weak website | Organiser remains a prospect; competitor platform is a separate blocked account; EGS may be primary. |
| E. Large complex festival | ECC and/or Ticketing may be high priority from evidenced complexity; do not invent operational facts. |
| F. Grassroots artist | Tier 2 exploratory unless the artist/manager controls event economics; otherwise review or not applicable. |
| G. Existing one-module customer | `CUSTOMER`; expansion only when another problem has evidence. |
| H. Small regional event with minimal organiser footprint | Identify organiser, resolve one account, retain event evidence, EGS `HIGH` where warranted, and target organiser/problem owner. |

## 20. Delivery sequencing

This document does not implement the following sequence:

1. **Policy foundation:** persist/configure relationship, eligibility, evidence, lens and output policy.
2. **Manual account foundation:** create and review manually resolved accounts and events.
3. **Outreach consumption:** make the existing outreach slice consume the policy without broadening it.
4. **Autonomous discovery:** only after source governance, duplicate resolution, safety and human-review gates are accepted.
5. **Regional optimisation:** tune activated territory and language policy using observed evidence and outcomes.

PR #7 remains independent. Its smallest future compatibility change, if any, should consume this contract rather than redefine ICP policy. Event-project PR #1674 and Ticketing Audience A3 remain independent.

## 21. Non-goals for this documentation slice

- No branch other than this docs branch.
- No application code, migration, RLS, environment variable, deployment or production data change.
- No new partner/LNO persistence model.
- No claims that autonomous discovery or all regional programs are shipped.

## 22. Open decisions

The following require owner/product review before implementation, but do not weaken the contract:

- Which additional territories move from `EU_STRATEGIC` to activated commercial programs.
- Approved source freshness windows by event type and source class.
- Human-review thresholds for `ELIGIBLE` versus `REVIEW_REQUIRED`.
- Provider and terms-of-use policy for future public-source discovery.
- Whether any provider credential should be dedicated to prospecting rather than shared.

## 23. Controlling sources

This contract is derived from the following Event-project documents:

- [Ticketing V2 Master PRD](https://github.com/raphaeldomalik-eng/Event-project/blob/main/docs/prd/ticketing/ticketing-v2-master-prd.md)
- [Ticketing V2 Reporting Excellence PRD](https://github.com/raphaeldomalik-eng/Event-project/blob/main/docs/prd/ticketing/ticketing-v2-reporting-excellence-prd.md)
- [Ticketing V2 Products, Add-ons and Merchandising PRD](https://github.com/raphaeldomalik-eng/Event-project/blob/main/docs/prd/ticketing/ticketing-v2-products-addons-merchandising-prd.md)
- [Event Growth Studio AI CMS PRD](https://github.com/raphaeldomalik-eng/Event-project/blob/main/docs/prd/event-growth-studio-ai-cms-prd.md)
- [Event Growth Studio Guided Microsite Creation PRD](https://github.com/raphaeldomalik-eng/Event-project/blob/main/docs/prd/event-growth-studio-guided-microsite-creation-prd.md)
- [Event Growth Discoverability Contracts](https://github.com/raphaeldomalik-eng/Event-project/blob/main/docs/ARCHITECTURE/event-growth-discoverability-contracts.md)
- [Event Command Center V3 UX PRD](https://github.com/raphaeldomalik-eng/Event-project/blob/main/docs/prd/event-command-center/ecc-v3-ux-prd.md)

The broader AI Revenue Engine product context remains in [`docs/PRD.md`](../PRD.md). This document is the canonical Direct Prospecting & ICP Intelligence V1 contract and does not duplicate the broader product PRD.

