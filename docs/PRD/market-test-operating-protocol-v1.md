# Revenue Operations Measurement & Autonomy Protocol V1

**Status:** Product-definition draft
**Applies to:** Event Suite Direct revenue operations in South Africa, the United Kingdom and the United States
**Purpose:** Make sales operations measurable and safe while promoting proven workflows from supervised testing to monitored autonomous execution. Market comparison is a secondary analytical output, not the operating objective.

## 1. Decisions this protocol makes possible

For each active commercial programme, determine whether Event Suite has enough evidence of safe, efficient commercial progress to:

- **Advance** the next cohort;
- **Adapt** one named variable;
- **Hold** pending a missing commercial or data input; or
- **Deprioritise** the programme or territory.

The primary decision is how to create more qualified conversations, opportunities, conversions and revenue safely. The protocol also distinguishes a weak market from weak product-market fit, weak message/offer, poor source coverage, limited contactability, seasonal timing or poor execution. It must not treat raw lead volume, Apollo match rate or email volume as evidence of demand.

## 2. Initial sales focus and measurement shape

The initial direct-sales focus is:

> Independent organisers and promoters of recurring, ticketed events, with a clear commercial owner, active public event evidence, and an observable growth or operational problem.

This shared ICP creates operational focus; it is not a requirement to withhold a credible revenue opportunity that falls outside it. Every pursued account must still pass the relevant identity, evidence, contact, suppression and commercial-policy gates.

The default is one primary Event Suite commercial wedge, lifecycle window, channel, conversion event and policy version across the three territories wherever commercially appropriate. A territory may use a recorded local adaptation when it has a credible sales reason. The result is then reported as operational performance, not as a clean like-for-like market comparison.

Community-led status, operating model, event type, scale and geography are recorded as independent analysis tags. They cannot change inclusion or priority by themselves and have no reserved account capacity in Round 1. In particular, community-led does not mean small, volunteer-only or low-value.

Community and other event types remain discoverable and reportable. A dedicated vertical analysis may begin when sufficient sales activity exists; it must not delay or restrict an eligible revenue opportunity.

## 3. Commercial programme plan

Before activation, the Revenue Director records a commercial programme plan with:

- territory-specific commercial budget, provider-cost ceiling and operating capacity;
- the active event-lifecycle window, such as a confirmed upcoming event or recurring programme at a comparable public planning/on-sale stage;
- the primary Event Suite commercial wedge and any permitted local adaptations;
- the approved offer, destination, channel, sender identity and message-policy version;
- the primary conversion event and the observation window;
- evidence, identity, contact and suppression rules;
- the named human policy owner and the autonomous-action status: `SHADOW`, `SUPERVISED`, `MONITORED_AUTONOMY` or `PAUSED`.

The shared ICP and any comparison subset are recorded before the first outreach decision. All eligible revenue opportunities may be pursued within approved policy and budget. A territory may scale when qualified opportunities or revenue evidence justify it, but not simply because its public signals are easier to find. If a like-for-like comparison cannot be assembled, record `INSUFFICIENT_COMPARISON_EVIDENCE` and continue normal sales operations; do not mislabel the result as comparable.

## 4. Apollo coverage-neutral policy

Apollo is the primary bounded people-matching route after the existing identity and eligibility gates. Its result is a measurement of provider coverage and contactability, not commercial demand.

For every eligible account, record exactly one people-provider outcome:

| Outcome | Meaning | Effect on commercial evaluation |
| --- | --- | --- |
| `NOT_ELIGIBLE` | Identity, relationship or policy gate prevented a query | Not a contactability result |
| `NOT_QUERIED_POLICY_OR_BUDGET` | The account was eligible but not queried under the operating-period budget/policy | Missing data; not a failure |
| `PROVIDER_UNAVAILABLE` | Provider error, service issue or unavailable capability | Missing data; not a failure |
| `ZERO_PROVIDER_MATCH` | Provider returned no suitable person for the canonical organisation | Contact route unresolved; not a buyer/value conclusion |
| `CANDIDATE_NO_VERIFIED_ROUTE` | A relevant person was found but no permitted route is available | Contactability constraint; commercial evidence remains valid |
| `VERIFIED_ROUTE_FOUND` | A policy-valid public or provider-verified route exists | Eligible for the applicable engagement gate |

No automatic personal-data fallback is permitted. An otherwise strong account with no verified route remains a valid market observation and may be retained for inbound, future source, partner or manual-policy routes. It is not silently discarded as a poor prospect.

## 5. Autonomy promotion path

Human review is temporary calibration, not the destination.

| State | Workforce behaviour | Human role | Promotion requirement |
| --- | --- | --- |
| `SHADOW` | Produces the full recommendation and draft without external action | Compare output with human judgement | Evidence and policy gates are implemented and auditable |
| `SUPERVISED` | Executes only after record-level approval | Approve, revise, block and label reasons | Stable quality baseline across a complete cohort |
| `MONITORED_AUTONOMY` | Executes approved low-risk actions automatically | Sample audits, manage policy and handle exceptions | All hard gates pass; no material safety defect; delivery/reply outcomes reconcile; stop controls tested |
| `PAUSED` | Stops the affected policy/action | Diagnose and correct | Any safety, consent, suppression, sender, evidence or cost guardrail breach |

The first actions eligible for monitored autonomy are narrowly bounded: sending a pre-approved sequence to an eligible verified business route, sending a pre-approved resource follow-up, routing an inbound lead, acknowledging an approved inbound request, and creating/assigning internal follow-up tasks. Pricing changes, bespoke commercial claims, contract terms, negotiation, strategic partnership and exceptional customer commitments remain A4 exceptions.

## 6. Solutions to current weaknesses

| Current weakness | Required solution | Delivery evidence |
| --- | --- | --- |
| Apollo may underrepresent some event types | Persist provider outcome separately and report it by territory, subgroup tag and scale | Coverage dashboard and no-match audit |
| Community can be mistaken for small | Store vertical, operating model, scale and geography independently | Cohort records never derive size from vertical |
| Market comparisons can be confounded | Record the shared ICP, lifecycle window, wedge, channel and budget for each comparable subset | Commercial programme plan and comparison report |
| ICP is too broad | Start with one narrow shared ICP; treat community and verticals as tags in the initial operating period | ICP inclusion/exclusion list |
| Product message can confound results | One primary wedge, with approved offer/version recorded | Wedge and message-version reporting |
| Human review never becomes autonomy | Use Shadow → Supervised → Monitored Autonomy promotion states | Promotion decision, audit sample and tested kill switch |
| Strong accounts may lack a contact route | Preserve account quality and contactability separately | Unresolved-contact queue and outcome reporting |
| US is not commercially ready | Create and approve a US Direct playbook before external activation | Territory activation record |
| Marketing is not connected to sales learning | Attribute campaign/content version through qualified conversation and opportunity outcomes | Campaign-to-opportunity report |

## 7. Minimum data contract

The implementation must persist or derive without ambiguity:

- `commercial_operating_period_id`, territory, vertical, operating model and evidence basis;
- `comparison_subset_id` where a record is part of a like-for-like market comparison;
- event/organisation scale and confidence, independently of vertical;
- lifecycle stage/freshness and comparable cohort marker;
- commercial wedge, offer, content/message-policy version, channel and sender;
- people-provider outcome, provider cost and contactability state;
- autonomy state, policy version, approval/audit record and stop reason;
- interaction, reply/intake class, opportunity stage, outcome, attributable pipeline/revenue and loss reason.

No like-for-like market result may be reported as a receptivity conclusion while one of these is missing or mixed across the comparison subset. This does not block the reporting of ordinary sales performance.

## 8. Metrics and thresholds

### Hard guardrails

The affected autonomous action pauses immediately for: a suppression/opt-out failure, unauthorised sender, unsupported commercial claim, material evidence/identity error, unbounded provider spend, failed delivery reconciliation or broken stop control.

### Quality and commercial measures

Report the following for each `territory × commercial programme × ICP × wedge × channel × operating period`, with vertical, operating model, community status and scale available as descriptive subgroup tags:

- resolved-account and evidence-completeness rate;
- people-provider outcomes and verified-route rate;
- approval/revision/block rate during supervised calibration;
- autonomous-action policy compliance and sampled audit result;
- meaningful reply, qualified conversation, opportunity and conversion progression;
- time to first qualified conversation;
- provider/model/human-review cost per qualified opportunity;
- attributable pipeline/revenue where the cycle has matured.

Before an operating period begins, the owner sets the numeric promotion thresholds appropriate to the available volume. Two rules are not negotiable: all hard gates must pass, and a market cannot be deprioritised on a provider-coverage metric alone.

## 9. Operating-period close and next action

The Revenue Director closes every operating period with one evidence-backed result per commercial programme:

- **Advance:** repeat or expand the programme; promote a workflow only if autonomy gates pass.
- **Adapt:** change one declared variable in the next operating period—ICP definition, wedge, offer, channel, lifecycle window or source mix.
- **Hold:** preserve records and wait for the missing playbook, coverage, season or evidence input.
- **Deprioritise:** pause expansion after comparable evidence shows weak progression and the alternative explanations have been ruled out.

The report must name whether the finding is about revenue performance, market receptivity, product wedge, contactability, provider coverage, execution quality or insufficient evidence. A vertical-receptivity claim requires a dedicated analysis. "No Apollo match" is never a market conclusion.

## 10. Entry criteria

The first supervised operating period may begin only when:

- South Africa, UK and US have distinct territory-playbook status; US external activation remains blocked until its playbook is approved;
- the active ICP, inclusion/exclusion rules and any comparison subset are recorded;
- lifecycle window, wedge, offer, budget, channel and primary conversion are recorded for the operating period;
- the minimum data contract is available in the operator workflow or an approved interim record;
- existing identity, competitor, suppression, contact-provenance and approval gates remain active;
- the affected autonomous action has a tested stop control before any monitored autonomy is enabled.
