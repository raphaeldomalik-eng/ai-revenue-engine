# AI Revenue Engine Operator Workspace V1

## 1. Document authority, status and scope

**Status:** Draft canonical product and UX PRD. This document is the source of truth for the next Operator Workspace redesign and must be approved before application implementation begins.

**Authority:** Product and UX contract for the authenticated AI Revenue Engine operator workspace. It supersedes layout-only iteration briefs where they conflict with the workflow, terminology, state or acceptance rules below.

**Repository:** `ai-revenue-engine`

**Production surface audited:** `https://ai-revenue-engine-pearl.vercel.app/operator`

**In scope:**

- `/operator`
- `/operator/incoming-leads`
- `/operator/runs`
- `/operator/prospects`
- `/operator/outreach`
- Prospect and run drawers/panels and their deep links
- Relevant API routes, server actions, database functions, migrations and read models
- Existing operator tests and operator documentation
- The Event Suite incoming-lead outbox, cron sender and signed receiver path

**Out of scope for this turn:** Application code, CSS, components, database schema or data, API changes, production changes, deployment, provider calls, enrichment, generation, persistence, scheduling, outreach, PR creation, branch push and destructive browser actions.

## 2. Product outcome

An operator can open one coherent workspace, understand what requires attention, inspect the evidence behind a record, resolve explicit uncertainty, make a deliberate decision, save that decision once, and safely move to the next item.

The workspace must distinguish four different things:

1. Real inbound interest received from Event Suite.
2. AI-discovered candidates and canonical prospects.
3. Research executions and their result appearances.
4. Human-supervised outreach drafts.

The workspace is successful when its screens make those boundaries obvious and when every important operator action has a visible, durable and safe state transition.

## 3. Current-state problem statement

Four UI iterations changed layouts without establishing a durable operator workflow. The current product therefore contains multiple competing interaction models:

- Overview is still a large latest-run report rather than an operational command centre.
- Incoming Leads is a dense database table with several independent inline actions competing for attention.
- Runs shows history but does not expose a complete, readable inspection model or a reliable unique/new distinction.
- Prospect Inventory is the canonical cross-run queue, but its drawer does not present identity, evidence, uncertainty and decision as one workflow.
- The instruction “Confirm organiser” is shown as if it were actionable, while no corresponding identity-resolution mutation is exposed.
- The current Prospect Inventory drawer has no explicit **Save review** action. Next action can be saved separately; classification outcomes save immediately.
- Destructive outcomes are not consistently confirmed, unsaved draft state is not protected on close, and the operator cannot tell which values are local draft state versus persisted state.
- Overview, legacy operator views and the current inventory route contain overlapping concepts and different levels of detail.

These are product failures, not isolated styling defects. The next implementation must begin from the workflow and screen contracts in this document.

## 4. Audit baseline

The working tree was clean before this documentation branch was created. Current repository evidence:

- Branch created locally from current `origin/main`: `docs/operator-workspace-v1-prd`.
- Base commit: `512f40c27c59a2d875d20b841e1e10912a43cc5f`.
- Production deployment resolved to commit `512f40c27c59a2d875d20b841e1e10912a43cc5f`, status READY.
- Related operator changes, including PRs #28–#32, are merged. No open related operator UI PR was found.
- The only intended change in this turn is this local PRD.

Live production observations on 31 August 2026:

- Overview displayed the latest South Africa / All lenses run as its dominant content: one found result, zero review items and one rejected result.
- Incoming Leads displayed 16 matching review records, two high-intent records and zero active genuine leads in the observed data.
- Runs displayed 39 **Inspect in place** actions and a latest run with one persisted rejected result.
- Prospect Inventory displayed 188 unique prospects, 95 in Needs review, 1 qualified, 4 contactable, 58 rejected, 5 blocked and 29 duplicates.
- The Prospect Inventory drawer measured 745px wide and 1,031px scroll height in the connected browser viewport, with a persistent vertical scroll region. The current connected viewport was 1,536 × 695 CSS pixels; the browser connector did not expose a viewport override, so the 1,366 × 768, 1,440 × 900 and 1,920 × 1,080 design checks remain mandatory acceptance work for the design and implementation pass.

## 5. Primary operator and jobs to be done

**Primary operator:** An internal Revenue Engine operator or administrator supervising AI research and inbound interest. The operator understands Event Suite commercial context but should not need database knowledge, raw status codes or implementation documentation.

The operator needs to:

- Start the day at a command centre that prioritises work rather than reporting the last run.
- Triage real inbound interest separately from AI-discovered outbound prospects.
- Verify identity and relationships before treating a candidate as a commercial prospect.
- Read source evidence and understand uncertainty without confusing facts, inferences and unknowns.
- Record a safe, auditable qualification, exclusion or identity decision.
- Review research execution quality and trace every appearance back to the canonical inventory.
- Prepare and review outreach drafts without accidentally sending, scheduling or enrolling communications.

## 6. Canonical terminology

| Term | Canonical meaning | Must not be called |
|---|---|---|
| Overview | Operational command centre for attention, pipeline health, recent changes and next actions | Latest run report |
| Incoming Lead | Real inbound Event Suite interest: demo, talk-to-sales, trial, product enquiry, download or retained interaction | AI prospect |
| Incoming Submission | Immutable source event in the inbound ledger | Lead, unless projected into `incoming_leads` |
| Activity | A retained interaction attached to a contact/lead | Duplicate lead |
| Canonical prospect organisation | An organisation identified through research and stored in the outbound prospect domain | Event Suite customer/account by default |
| Event Suite/customer account | An existing commercial customer or tenant record | Canonical prospect organisation |
| Event-organiser relationship | Evidence that a particular organisation organises, operates, promotes or owns the relevant event | Customer/account link |
| Prospect Inventory | Complete canonical database of AI-discovered candidates across runs | Run results |
| Prospect appearance | A candidate result recorded by one research run | New prospect automatically |
| Run | One bounded research execution and its provenance | Prospect database |
| Identity resolution | Determining the authoritative organisation, event/operator relationship and source role | Qualification |
| Qualification | Human decision that a record is commercially worth pursuing under the relevant workflow | Identity confirmation |
| Needs review | A record with a specific unresolved human decision | Generic failure bucket |
| Review note | Optional operator context stored with a decision | Hidden local text |
| Outreach Draft | A generated message version isolated for human review | Sent email |
| Save review | One explicit, idempotent persistence of the review draft and selected decision | Any individual field save |
| Contactable | A verified, legitimate route to a selected target person | Any email-looking string |
| Existing customer / tenant activity | Inbound activity retained for context but excluded from new-business outreach | Rejected lead |

Raw database codes may be available in collapsed diagnostics, but primary operator language uses the terms above.

Identity resolution may confirm or create a **canonical prospect organisation** from sourced evidence. It must not create an Event Suite/customer account, tenant or CRM opportunity merely because an AI-discovered organisation was confirmed. A later, separately governed workflow may link that prospect organisation to an existing customer/account or promote it into an opportunity.

## 7. Information architecture and section boundaries

### Overview

The command centre. It answers what needs attention now, what changed, whether the system is healthy and what action has the highest value.

### Incoming Leads

The inbound commercial queue. It is the human-triage surface over Event Suite submissions and retained activities, and it owns the mutable lead projection: intent, classification, owner, follow-up and inbound opportunity progression. The immutable source ledger remains the authority for received evidence; this surface does not own AI discovery results.

### Prospect Inventory

The canonical cross-run outbound prospect database. It owns identity resolution, research evidence, source interpretation, classification, qualification state, contactability and readiness for later outreach.

### Runs

The execution and provenance history. It explains when, where, with which lens and under which bounded configuration research occurred, and what each run produced. It does not create a second prospect list.

### Outreach Drafts

The human-supervised message review surface. It owns draft versions, edits, ratings, approval and rejection. It does not send, schedule, enrol or publish communications.

The same person, organisation or account may be referenced by more than one section, but each section must label the record type and link to the owning surface.

## 8. Prospect lifecycle, identity substates and allowed transitions

The canonical prospect state is the persisted `ai_prospect_candidates.status`, presented in plain language:

| State | Meaning | Default location |
|---|---|---|
| `REVIEW_REQUIRED` | A specific human decision remains | Needs review |
| `QUALIFIED` | Operator judged the prospect worth pursuing | Qualified |
| `REJECTED` | Operator excluded the prospect from active work | Archive |
| `BLOCKED` | Operator explicitly blocked the prospect, with a reason | Archive |
| `DUPLICATE` | Operator identified an already-tracked canonical record | Archive |

Allowed transitions for V1:

- `REVIEW_REQUIRED` → `QUALIFIED` through a saved positive decision.
- `REVIEW_REQUIRED` → `REJECTED` through a saved reasoned decision.
- `REVIEW_REQUIRED` → `BLOCKED` through a saved reasoned decision.
- `REVIEW_REQUIRED` → `DUPLICATE` through a saved duplicate decision.
- `REJECTED`, `BLOCKED` or `DUPLICATE` → `REVIEW_REQUIRED` only through an explicit **Restore to review** action available from Archive.
- A non-lifecycle review update, such as a note or next action, is still part of the review draft and is persisted through **Save review**; the audit record must identify it as a non-lifecycle update.
- Prospect approval for drafting is separate from qualification. `APPROVED` means only that draft preparation is permitted; it never sends an email.
- Email approval is separate again and is per message version.

The interface must not silently qualify a record as a side effect of confirming identity, selecting a contact or opening a drawer.

### Independent prospect substates

Lifecycle is not the same thing as identity, contactability or drafting approval. The operator UI must expose these as separate, attributable states:

| Substate | Meaning | Example values / authority |
|---|---|---|
| Lifecycle state | The commercial disposition of the canonical prospect | `REVIEW_REQUIRED`, `QUALIFIED`, `REJECTED`, `BLOCKED`, `DUPLICATE`; persisted on `ai_prospect_candidates` |
| Identity-resolution state | Whether the authoritative identity or required relationship is resolved | `UNRESOLVED`, `RESOLVED`, `CONFLICTING_EVIDENCE`, `NOT_APPLICABLE`; persisted by the identity-resolution contract |
| Contactability state | Whether a legitimate target person and route are sufficiently verified | Not started, needs review, contactable, not contactable; persisted contact/review evidence |
| Approval-for-drafting state | Whether the qualified prospect may have a draft prepared | Draft not approved, `APPROVED`, revoked; persisted in prospect approval reviews |
| Email-version approval state | Whether one specific message version is approved for the draft-only workflow | Pending, approved, rejected, revision requested; persisted per message version |

Do not collapse “identity decisions required” and “qualification decisions required” into one metric. A prospect can have resolved identity but still require qualification review, or be qualified but still need a contact decision.

### Identity-resolution workflow

For an Event prospect, **Confirm organiser** is a saved identity-resolution decision, not a generic next-action label. The operator can:

1. Confirm the suggested organiser/operator relationship.
2. Search for and select another existing canonical prospect organisation.
3. Create a new canonical prospect-organisation record from the supplied sourced evidence.
4. Mark the organiser unresolved.
5. Mark the relationship not applicable when the record is not an event.

Creating a canonical prospect organisation does not create an Event Suite/customer account, tenant or CRM opportunity. The saved identity-resolution payload must include:

| Payload field | Required meaning |
|---|---|
| `event_prospect_id` | The event prospect being resolved; for non-event lanes use the equivalent prospect ID and record type |
| `canonical_organisation_id` | The authoritative canonical prospect organisation; nullable only for unresolved or not-applicable outcomes |
| `relationship_type` | Organises, operates, promotes, owns or not applicable |
| `resolution_status` | `UNRESOLVED`, `RESOLVED`, `CONFLICTING_EVIDENCE` or `NOT_APPLICABLE` |
| `evidence_refs` | Supporting evidence/source references shown to the operator |
| `operator_note` | Optional explanation or unresolved-context note |
| `actor_id` / `resolved_at` | Acting member and server timestamp |
| `idempotency_key` | Stable retry key for the logical identity decision |

Every identity save is separately audited from qualification. `RESOLVED` means the authoritative relationship is selected and supported; `CONFLICTING_EVIDENCE` means competing evidence remains; `UNRESOLVED` means no authoritative relationship was accepted; `NOT_APPLICABLE` is valid only where the prospect lane does not require that relationship.

### Qualification gate

A prospect cannot be qualified while a required identity relationship is `UNRESOLVED` or `CONFLICTING_EVIDENCE`. Qualification requires:

- authoritative identity appropriate to the prospect lane;
- at least one attributable, viewable source supporting identity or commercial relevance;
- no blocking identity uncertainty; and
- a deliberate qualification decision separate from identity resolution.

Pain proof is not required. AI confidence alone cannot qualify a prospect.

The identity requirement is lane-specific:

| Prospect lane | Qualification identity requirement |
|---|---|
| Organisation-first | Resolve or otherwise authoritatively identify the canonical prospect organisation and retain a viewable source for identity or commercial relevance. No event-organiser relationship is required unless an event is part of the claim. |
| Event-first | Resolve the event’s organiser/operator relationship to an authoritative canonical prospect organisation, or record `NOT_APPLICABLE` only if the record is corrected as non-event. Retain a viewable source for the relationship or commercial relevance. |
| Person-first | Authoritatively identify the person and their relevant canonical prospect organisation where applicable, with a viewable source for identity or commercial relevance. No event-organiser relationship is required by default. |
| Venue-first | Authoritatively identify the venue and relevant operator/organisation relationship where applicable, with a viewable source for identity or commercial relevance. An event-organiser relationship is required only when the record is also an event claim. |

Identity resolution and qualification remain separate saved decisions. Qualification must be disabled, or explain its unmet gate, until the appropriate lane-specific identity and evidence requirements are satisfied.

## 9. Incoming Lead lifecycle and separation from AI prospects

The inbound system has two data layers and one workspace over them:

1. `incoming_submissions` and retained source activities form the immutable, replay-safe inbound evidence ledger. Event ID and source-system identity make ingestion replay-safe; source evidence is never overwritten because an operator changes a lead.
2. `incoming_leads` is the mutable operator projection. It aggregates retained activities and carries classification, intent, ownership, follow-up, stage, opportunity state and review history.
3. The Incoming Leads UI is a human-triage workspace over both layers. It must show the source evidence alongside the current lead projection and clearly distinguish historical evidence from mutable operator state.

Accepted Event Suite submissions create retained activities. Repeated downloads remain activities attached to the same projected lead where identity rules permit; they are not silently counted as separate people.

Incoming records start as `NEEDS_REVIEW`. A lead becomes a new-business inbound lead only after the operator classifies it as `GENUINE_PROSPECT`. Existing customers/tenants remain retained activity and are excluded from new-business outreach. Non-lead classes remain auditable but are excluded from active lead metrics, enrichment and opportunity creation.

Recommended inbound stages are `NEW`, `REVIEWING`, `QUALIFIED`, `CONTACTED`, `DEMO_SCHEDULED`, `TRIAL_ACTIVE`, `PROPOSAL`, `NURTURE`, `CONVERTED`, `DISQUALIFIED` and `LOST`. The UI must explain the difference between classification and stage.

The Event Suite source path is:

`internal_sales_lead` → transactional `revenue_engine_incoming_lead_outbox` → scheduled sender → signed AI Revenue receiver → `ingest_incoming_submission` → `incoming_submissions` / `incoming_leads` / `activities`.

The outbox is service-role-only and replay-safe. The signed receiver must remain server-only. No inbound record becomes an AI-discovered prospect merely because it is high intent.

## 10. Overview screen contract

### Purpose

Overview is the operational command centre, not the latest-run report.

### At-a-glance questions

The first viewport must answer:

- What requires my attention now?
- How many real inbound leads need review or follow-up?
- How many AI prospects need identity or qualification decisions?
- What changed recently?
- Are research runs healthy?
- What is the most valuable next action?

### Required content

1. **Attention queue:** prioritised cards or rows with one explicit decision or follow-up per item, source section, age, urgency and one primary action.
2. **Inbound health:** needs review, high intent, follow-up due, active genuine leads and existing-customer activity, with links to Incoming Leads.
3. **Prospect health:** identity decisions required, qualification decisions required, contact decisions required, qualified, contactable, draft-approved and archived/excluded counts, with links to Prospect Inventory.
4. **Research health:** recent completed, failed and partial runs; stale run warning; latest run link.
5. **Recent changes:** newly received inbound interest, newly resolved identities, decisions saved and run completions. Changes must be time ordered and not reconstructed from arbitrary row ordering.
6. **Highest-value next action:** one deterministic action with a reason, age, owning section and direct route. V1 does not introduce a separate AI recommendation system. Priority is:
   1. Unhandled high-intent inbound demo, trial or talk-to-sales activity.
   2. Overdue inbound follow-up.
   3. Blocking identity decisions on high-priority prospects.
   4. Qualification decisions ready for human review.
   5. Failed or partial research executions requiring operational attention.
   6. Lower-priority review work.

### Latest run role

The latest run may appear as a compact health card containing start time, scope, status, counts and an **Inspect run** action. Its research brief must not dominate the page. Full run details belong to Runs.

## 11. Incoming Leads screen contract

### Purpose

A readable operator queue for real Event Suite interest.

### Primary queue columns

- Contact name and email
- Organisation/account and match state
- Why the lead exists: original source, latest source, interaction count and highest-value interaction
- Intent and priority reason
- Current classification and commercial stage
- Owner and follow-up state
- Data-quality summary
- One primary **Review** action

Secondary actions must live inside the review experience or a clearly labelled overflow menu. The default table must not present several equal-weight inline decision buttons.

### Views

- Needs review
- Active genuine leads
- High intent
- Follow-up due
- Incomplete data
- Existing customers / tenants
- Excluded
- All records

Each view must show its count, definition and whether it is a work queue or an audit view.

### Review experience

The review panel must show identity, account/contact match, opportunity context, complete source and activity timeline, classification, reason, owner, next action, follow-up, communication treatment, data-quality gaps, enrichment eligibility and audit history.

Classification, owner, next action, follow-up and notes are draft values until **Save review**. The panel may provide safe quick filters or a secondary overflow menu, but every mutation must make its persistence state clear.

## 12. Runs screen contract

### Purpose

Compact, readable research execution history and provenance.

### Required list fields

- Start time and completed time where available
- Territory/market
- Research lens
- Status: completed, partial, failed or in progress
- Requested/budgeted count where available
- Found appearances
- Unique/new canonical introductions
- Operator decisions directly attributed to the run, where recorded
- Current canonical lifecycle/identity/contactability dispositions shown in a separately labelled group
- Duration where timestamps permit
- Cost where a persisted cost field exists; otherwise show **Not recorded**
- One clear **Inspect** action

“Found” is a count of run appearances unless explicitly labelled as unique canonical prospects. The list must never imply that eight appearances equal eight new prospects.

### Run metric separation

Runs primarily display immutable execution facts. The contract separates:

1. **Execution facts:** run ID, start/completion time, status, scope, configuration, requested/budgeted count, technical outcome, duration and persisted cost. Missing historical values remain **Not recorded**.
2. **Run appearances:** candidate result appearances and persisted result rows produced by that execution.
3. **Canonical introductions:** unique canonical prospect organisations first introduced by that run, deduplicated by `canonical_key`.
4. **Recorded run decisions:** operator decisions made during or directly after the run only when the audit/source context explicitly records the run; otherwise **Not recorded**.
5. **Current canonical disposition:** the current lifecycle, identity, contactability and approval substates of canonical prospects that appeared in the run. These can change without rewriting the historical run and must be labelled **Current**, never presented as the run’s historical outcome.

### Inspection drawer

The drawer preserves the Runs list context and contains:

- Run identity, scope, timestamps and status
- Research brief and provenance
- Requested, found, unique/new and outcome counts
- Candidate appearances for that run only
- Each appearance’s canonical prospect link, current state, reason and source/evidence summary
- Reconciliation warning when aggregate counters exceed recoverable result rows
- Collapsed diagnostics: run ID, provider/model, strategy/version, deployment, technical outcome and error context; never secrets or hidden reasoning

The drawer must not become a second editable prospect workflow. Prospect decisions link to Prospect Inventory.

## 13. Prospect Inventory screen contract

### Purpose

The canonical cross-run database of AI-discovered candidates and prospects.

### Top-level counts

The required counts are separate and must link to their definitions and saved views:

- **Identity decisions required:** canonical prospects with a required identity state of `UNRESOLVED` or `CONFLICTING_EVIDENCE`.
- **Qualification decisions required:** prospects with appropriate identity and evidence gates satisfied but without a saved qualification or exclusion decision.
- **Contact decisions required:** qualified prospects without a verified target person/route or with an explicit contactability review outstanding.
- **Qualified:** prospects whose lifecycle state is `QUALIFIED`.
- **Contactable:** qualified or otherwise eligible prospects with a verified legitimate target route.
- **Draft-approved:** prospects with prospect approval state `APPROVED`; this permits draft preparation only.
- **Archived/excluded:** `REJECTED`, `BLOCKED`, `DUPLICATE` or other explicitly archived/excluded records, shown with reason.

`Active` is not a required V1 count because the current backend has no single authoritative persisted meaning for it. If a future view uses the label, it must define its exact lifecycle and eligibility predicate before release; otherwise use the specific counts above.

### Primary list fields

- Prospect identity: authoritative organisation if resolved, otherwise **Organisation not yet resolved**
- Record type: Event, Organisation, Person or Venue
- Why relevant / discovery signal
- Person and contactability state
- Current lifecycle state
- Unresolved issue or next required action
- Run appearances and last researched time
- Evidence quality
- One **Review** action

### Filters, search and sorting

- Saved lifecycle views are the primary navigation.
- Search covers candidate name, organisation, domain and canonical key where permitted.
- Filters cover status, lane/type, territory, run, review state, contact state, email state, priority and quality.
- Sort options are attention first, most recent, name and ready-for-review.
- Filter and sort state must survive refresh through URL state where practical.
- Pagination must be stable under concurrent inserts. The existing keyset queue contract is the preferred basis; the current inventory RPC uses offset pagination and must be corrected or explicitly replaced before calling the implementation complete.

### Record semantics

The list is canonicalised by `canonical_key`. A run appearance is historical evidence about the canonical record, not another lead. Every record must show whether it is new in the latest run, current, historical, calibration or legacy. A discovered organisation is a canonical prospect organisation, not automatically an Event Suite/customer account.

## 14. Prospect review drawer contract

### Structure

The right-hand drawer preserves the queue, supports a deep-link query, traps focus, closes with Escape and warns before closing when draft values are dirty. It has:

- Persistent header with prospect name, record type, lifecycle state and close action
- Progress indicator: Identity → Relationships → Evidence → Decision
- Scrollable body
- Sticky action footer

### Required review sequence

1. Review identity.
2. Review organisation/event/person relationships.
3. Review research evidence and sources.
4. Resolve explicit uncertainty.
5. Choose a qualification or exclusion outcome.
6. Add an optional review note.
7. Select **Save review**.
8. Show success, error and resulting status clearly.

### Required content

- Identity: candidate name, authoritative organisation, event, website, territory and identity confidence.
- Relationships: event ↔ organiser/operator, organisation, selected person, account and opportunity links.
- Evidence: facts, inferences and unknowns with source title, URL, role and observed time where available.
- Commercial interpretation: Event Growth, Ticketing and Event Operations fit, with reasons.
- Contactability: person, role, route, ownership evidence, verification state and rejection reason.
- Decision: Qualify as the primary positive action; Reject, Block and Mark duplicate as secondary/destructive actions.
- Review note: optional, included in the same save operation.

### Save semantics

1. The operator edits identity, relationships, classification, owner, next action, follow-up, decision fields and note in draft state.
2. The operator selects **Qualify**, **Reject**, **Block** or **Duplicate** as the intended outcome. Selecting an outcome changes only the draft; no lifecycle mutation fires.
3. Required reasons are validated before save.
4. The operator selects **Save review**.
5. For Reject, Block or Duplicate, confirmation names the record, consequence and reason.
6. Confirmation submits the same atomic, idempotent review payload.
7. No separate lifecycle mutation fires merely because an outcome control was selected.

Every editable value is draft state until **Save review**. Save is one transactional or equivalent server operation, double-submit protected and auditable. Qualify remains visually primary; Reject, Block and Duplicate remain secondary/destructive. Successful save reports the persisted decision, timestamp and next state, then offers **Next item** without losing queue context. Failed save retains the draft and makes persistence status clear. Closing a dirty drawer requires explicit discard or return-to-review choice.

### Identity resolution and “Confirm organiser”

The current **Confirm organiser** instruction is derived from unresolved identity, but V1 makes it a real saved workflow. For an Event prospect, the review drawer must let the operator confirm the suggested organiser/operator relationship, search for and select another existing canonical prospect organisation, create a new canonical prospect-organisation record from supplied sourced evidence, mark the organiser unresolved, or mark the relationship not applicable when the record is not an event.

The identity decision persists `event_prospect_id`, `canonical_organisation_id`, `relationship_type`, `resolution_status`, supporting `evidence_refs`, optional `operator_note`, `actor_id`, server `resolved_at` and an `idempotency_key`. Resolution states are `UNRESOLVED`, `RESOLVED`, `CONFLICTING_EVIDENCE` and `NOT_APPLICABLE`. It creates or links only a canonical prospect organisation; it never creates an Event Suite/customer account, tenant or CRM opportunity. Identity resolution remains separate from qualification and is independently audited.

## 15. Run inspection drawer contract

The run drawer is read-only except for links into the owning Prospect Inventory records. It must:

- Keep the Runs list visible behind a dimmed but recognisable context.
- Have a persistent header and close action.
- Use a scrollable content region with no clipped result rows.
- Show the run brief, provenance, counts, data completeness and result appearances.
- Display one result card per persisted appearance with a canonical prospect link.
- Explicitly distinguish aggregate counters from recoverable ledger rows.
- Show completed, partial, failed and historical-incomplete states without calling valid no-result runs errors.
- Never expose private prompts, credentials or hidden reasoning.

## 16. Outreach Drafts boundary and deferred scope

Outreach Drafts is a separate supervised workspace. It may expose:

- Evidence used for the draft
- Recipient and role
- Subject and body
- Version history
- Human edits
- Regeneration/revision request
- Per-message approve, reject, rate and request-revision controls

It must not expose send, schedule, enrolment, campaign publication or autonomous follow-up actions. Prospect approval, email approval and sending remain separate gates. The canonical approved state is **Draft approved — not sent**.

Deferred: provider delivery, sequence management, campaign analytics, automated follow-up, autonomous outreach and CRM campaign execution.

## 17. Exact field, metric and action definitions

### Shared fields

| Field | Definition |
|---|---|
| `id` | Stable record identifier; never displayed as the primary identity |
| `created_at` | First persisted record time |
| `updated_at` | Last persisted change time |
| `territory_code` | Market/territory for a research run or prospect |
| `focus` | Research lens: All lenses, Event Growth, Ticketing or Event Operations |
| `status` | Persisted lifecycle or run status, translated to operator language |
| `canonical_key` | Cross-run identity key for a canonical prospect |
| `discovery_run_id` | Run that produced the candidate appearance |
| `first_seen_at` / `last_seen_at` | Canonical prospect observation bounds |

### Run metrics

- **Execution facts:** run ID, start/completion time, status, scope, configuration, requested/budgeted count, technical outcome, duration and persisted cost. Missing historical values remain **Not recorded**.
- **Found appearances:** persisted candidate appearances or result rows attributed to that run; this is not a unique count unless explicitly labelled.
- **Unique introductions:** canonical prospect organisations first introduced by that run, deduplicated by `canonical_key`.
- **Recorded run decisions:** operator decisions directly attributed to that run by audit/source context; otherwise **Not recorded**.
- **Current canonical dispositions:** current lifecycle, identity, contactability and approval substates of canonical prospects that appeared in the run. These are labelled **Current** and may change without rewriting the run.
- **Duration:** `completed_at - started_at` when both are persisted.
- **Cost:** persisted run cost only; never estimate or imply cost from provider/model names.

### Incoming Lead fields

Contact/account, original/latest/highest-intent source, activity count and timeline, `current_intent`, `priority_reason`, `lead_classification`, `classification_reason`, `stage`, `owner_id`, `next_action`, `follow_up_at`, `last_contacted_at`, account/contact/opportunity references, `identity_review_state`, `data_quality_issues`, `enrichment_state`, `is_test`, consent/policy snapshot and audit history.

### Prospect actions

| Action | Required input | Effect |
|---|---|---|
| Qualify | Optional note, satisfied identity/evidence gate | Include intended `QUALIFIED` outcome in the review draft; lifecycle changes only on **Save review** |
| Reject | Reason and optional note | Include intended `REJECTED` outcome in the review draft; require confirmation and persist only on **Save review** |
| Block | Reason and optional note | Include intended `BLOCKED` outcome in the review draft; require confirmation and persist only on **Save review** |
| Mark duplicate | Duplicate reason and optional note | Include intended `DUPLICATE` outcome in the review draft; require confirmation and persist only on **Save review** |
| Restore to review | Optional note, archive context | Set `REVIEW_REQUIRED`; record decision |
| Resolve identity | Authoritative relationship and evidence | Include the identity decision in the review draft; persist only on **Save review**; no automatic qualification |
| Save review | Draft identity, relationships, selected outcome, required reason and note | Persist one atomic, idempotent review operation with actor, timestamp and audit context |

### Incoming Lead actions

Assign owner, mark reviewed, classify, restore, change stage, set next action, set follow-up, mark contacted, add note, qualify, move to nurture, disqualify and mark converted. Each must be permission-checked, recorded in `incoming_lead_changes`, and reflected in the queue after refresh.

## 18. Data-source and mutation mapping

| Surface | Current read source | Current mutation | Current limitation / V1 requirement |
|---|---|---|---|
| Overview | `/api/operator?view=overview`; `ai_prospect_discovery_runs`, up to 500 candidate rows, hydrated accounts/contacts/evidence | None | Replace latest-run dominance with attention and health read models; avoid unbounded client projection |
| Runs | `/api/operator?view=runs`; runs plus candidate appearances | Current list opens local inspection panel only | Add unique/new, duration/cost and canonical links; make inspection drawer the intentional contract |
| Run detail | `/api/operator?view=run&runId=...` and `/operator/runs/[runId]` | None | Preserve provenance and reconciliation; use the same drawer model where appropriate |
| Prospect Inventory | `/api/operator?view=inventory`; `list_ai_prospect_inventory` RPC, accounts, contacts and run appearances | V1 target: one `/api/operator` review mutation carrying identity, relationships, selected outcome, reason and note; current implementation still uses `record_ai_prospect_inventory_action` per action | Current RPC pages by offset; replace with stable keyset pagination; add canonical prospect-organisation identity mutation and atomic/idempotent Save review |
| Prospect detail | `/api/operator?view=prospect-detail&candidateId=...` | Prospect review mutation plus separate `record_ai_prospect_approval` for draft approval | Existing detail route redirects into the drawer; do not split the workflow across disconnected pages; account links must not be inferred from prospect-organisation identity |
| Incoming Leads list | `/api/incoming-leads` GET; `list_incoming_lead_queue` and `incoming_lead_operational_metrics` | `/api/incoming-leads` POST → `update_incoming_lead` or `bulk_update_incoming_leads` | Current independent saves should become a clear review transaction where product semantics require it |
| Incoming Lead detail | Incoming lead, changes, notes, submissions, activities, account, contact, opportunity and evidence | `update_incoming_lead` actions | ADD_NOTE exists in backend but is not consistently exposed in the quick review experience |
| Event Suite import | Transactional outbox and scheduled sender; signed receiver calls `ingest_incoming_submission` | Server-to-server delivery only | Keep idempotent, observable and isolated from UI actions |
| Outreach Drafts | `/api/ai-sales/outreach-composer`; draft/version/review tables | Prepare, revise, edit and per-message review | Keep draft-only; no send capability in this workspace |

Existing backend capabilities that must be reused: RLS and active-member checks, append-only prospect review decisions, append-only email approval reviews, incoming submission idempotency, incoming lead change history, source activity timeline, evidence/source URLs, account/contact/opportunity references, signed Event Suite delivery, and server-side inventory/queue retrieval.

The required identity-resolution contract introduces a canonical prospect-organisation relationship and its own audit record. It may reference an existing Event Suite/customer account only when a separate, explicit commercial link exists; confirming a prospect organisation alone must never create or mutate a customer/account or opportunity.

## 19. Loading, empty, error, success and stale-data states

Every screen and drawer must define these states:

| State | Required behaviour |
|---|---|
| Loading | Preserve page purpose, show an accessible busy announcement and skeleton/placeholder structure; do not render stale counts as current without a label |
| Empty work queue | Explain that no work currently matches, show the filter scope and a direct next route; do not imply system failure |
| Empty historical/run result | Explain whether nothing was found, nothing was persisted or historical detail is unavailable |
| Error | State what failed, whether any mutation occurred, provide retry and preserve safe draft state |
| Save pending | Disable duplicate submission, show the action being saved and retain context |
| Save success | Announce persisted result, timestamp/state and offer next-item navigation |
| Save failure | Say “Nothing changed” only when the API contract confirms it; otherwise show unknown persistence state and require refresh/reconciliation |
| Stale data | Show when the list was loaded and offer refresh; after a mutation refresh the affected record and counts |
| Partial run | Separate completed results from pending/failed work and show reconciliation evidence |
| Permission denied | Explain viewer/operator distinction without exposing sensitive implementation details |

## 20. Filtering, sorting, search and pagination behaviour

- All filter controls have visible labels and accessible names.
- Search is debounced or submitted deliberately and capped to the backend’s supported length.
- Changing a filter resets pagination to the first page.
- Filter state is URL-addressable where practical, including saved queue, search, sort and page cursor.
- Sort order is deterministic with a stable tie-breaker (`updated_at`/relevant sort value plus `id`).
- Prospect Inventory uses keyset pagination for growing data. A cursor is scoped to the complete filter/sort key and invalid cursors return the operator to page one with an explanation.
- Incoming Leads may use database pagination with stable order by priority, last activity and ID; selected bulk actions are explicitly limited to visible page records.
- Runs must add server-side pagination if the history exceeds a safe bounded result set.
- Do not hide records solely because they have been excluded; excluded and customer views remain auditable.

## 21. Laptop-first layout requirements

At 1,366 × 768, the first viewport must show page purpose, primary queue context, key counts, primary action and enough of the first record to continue work.

- No heading collision, action overlap, clipped columns or accidental horizontal scroll at the default laptop width.
- Tables may scroll horizontally only when the column set cannot be made readable; the primary action column remains visible or is moved into a deliberate row action pattern.
- Drawers occupy a bounded right-hand region, have a persistent header and sticky footer, and scroll only their body.
- At 1,440 × 900 and 1,920 × 1,080, increased space may reveal more rows or evidence but must not change semantics or move the primary action unpredictably.
- Use cards/sections for evidence and decision context; use tables only for comparison-heavy queues.
- Do not use repeated uppercase labels as a substitute for hierarchy.
- Primary action styling is consistent across screens. Destructive actions are visually secondary and clearly labelled.

## 22. Accessibility and keyboard requirements

- All routes have one meaningful page heading and a meaningful title/landmark structure.
- Keyboard focus order follows the workflow: page purpose → queue/filter → record → review action → drawer content → save footer.
- Open drawers move focus to the drawer, trap focus while open, close on Escape and restore focus to the originating control.
- Dirty-close warnings are keyboard accessible and do not rely on browser-native ambiguous prompts alone.
- Tables expose row and column headers; row actions have record-specific accessible names.
- Status, intent, quality and lifecycle always have text, not colour alone.
- Save pending, save success and save failure use an accessible status/live region.
- Destructive confirmation names the record, action and reason required.
- Inputs have labels, error text and preserved values after failed save.
- Zoom to 200% and keyboard-only use must preserve access to the primary action and drawer footer.
- External source links identify destination and open behaviour.

## 23. Audit/history requirements

Every durable operator action must preserve:

- Record ID and owning surface
- Action/decision name
- Previous state/value
- New state/value
- Reason code and optional note where relevant
- Actor ID
- Created timestamp
- Source context: run, submission or queue where applicable

Prospect decisions remain append-only in `ai_prospect_review_decisions`. Incoming mutations remain in `incoming_lead_changes`; notes remain separately attributable. Audit history is read-only to operators and must be visible in the relevant drawer without requiring database access.

The history must distinguish a review decision from a next-action-only update, identity resolution from qualification, prospect approval from email approval, and an inbound activity from a canonical lead.

## 24. Functional acceptance criteria

The next implementation is acceptable only when:

1. Overview answers all six operational questions in its first viewport.
2. Overview does not render the latest research brief as its dominant content.
3. An operator can reach each of the five sections from stable primary navigation.
4. Incoming Leads clearly separates real inbound interest from AI-discovered prospects.
5. Incoming Lead review shows source, interaction history, identity, classification, intent, owner, follow-up and data quality.
6. Incoming Lead actions have explicit persistence semantics and audit history.
7. Runs show start, scope, status, requested/found, unique introductions, recorded run decisions, clearly labelled current canonical dispositions and available duration/cost.
8. Run inspection preserves list context and links appearances to canonical Prospect Inventory records.
9. Prospect Inventory canonicalises repeated run appearances and labels new/current/historical context.
10. Inventory filters and search are server-backed and pagination remains stable under inserts.
11. Prospect review follows Identity → Relationships → Evidence → Uncertainty → Decision → Note → Save.
12. “Confirm organiser” provides the defined identity-resolution choices and persists the complete identity payload without creating an Event Suite/customer account or opportunity.
13. Qualification is blocked for required `UNRESOLVED` or `CONFLICTING_EVIDENCE` identity states and requires lane-appropriate authoritative identity plus one attributable, viewable source; pain proof is not required.
14. Qualify is the primary positive outcome; Reject, Block and Mark duplicate are selected in draft, require appropriate reason/confirmation and persist only through Save review.
15. Save review is explicit, atomic or equivalent, idempotent and double-submit protected.
16. Draft close warnings preserve or intentionally discard unsaved review state.
17. Overview and Prospect Inventory show identity, qualification, contact, qualified, contactable, draft-approved and archived/excluded counts separately; no unexplained Active count is required.
18. Runs distinguish execution facts, appearances, canonical introductions, explicitly recorded run decisions and current canonical dispositions.
19. Successful save displays resulting status and provides safe next-item navigation.
20. Outreach Drafts cannot send, schedule, enrol or publish.
21. Loading, empty, error, success, partial and stale-data states are observable and accessible.
22. No persisted decision can be triggered by merely opening, selecting or closing a record.
23. Audit history allows an operator to understand who changed what and why.

## 25. Visual acceptance criteria

At 1,366 × 768:

- No action overlap.
- No clipped table columns or merged headings.
- Page purpose is clear without reading documentation.
- The primary queue action is visible for the first records.
- Overview shows attention and health before detailed run evidence.
- Incoming Leads has one dominant Review action per row.
- Runs has readable hierarchy and one Inspect action per row.
- Prospect Inventory has readable identity, decision state, next action and Review action.
- Prospect and run drawers have usable body scrolling, persistent header and sticky action footer.
- Drawer close, save and destructive actions remain visible when the body is scrolled.

At 1,440 × 900 and 1,920 × 1,080:

- Additional space improves scanability without introducing a second competing hierarchy.
- Sticky elements do not cover content or actions.
- Empty and error states remain proportionate and purposeful.
- Tables do not expand into excessive whitespace or force low-value columns into the primary story.

## 26. Browser acceptance matrix

| Surface | 1,366 × 768 | 1,440 × 900 | 1,920 × 1,080 |
|---|---|---|---|
| Overview | Attention queue, inbound/prospect health and next action visible; no latest-run takeover | Recent changes and compact run health remain above fold | Extra history/evidence does not displace operational hierarchy |
| Incoming Leads | Contact/account, intent, state and Review visible; no competing inline action collision | Review panel body and timeline usable | More context may appear without changing primary Review action |
| Runs | Start/scope/status/counts/Inspect visible; no heading collision | Drawer preserves context and scrolls independently | Full provenance and result linking remain readable |
| Prospect Inventory | Identity/status/reason/next action/Review visible; no clipped action column | Filters and pagination remain compact; drawer footer reachable | Counts, filters and canonical lineage remain visually subordinate to queue |
| Prospect review drawer | Sticky header/footer, dirty-close protection and save action visible | Evidence and relationships scan in workflow order | Additional evidence remains grouped, not a wall of text |
| Run inspection drawer | Run context, counts and first appearances readable | Independent body scroll; canonical links visible | Diagnostics remain collapsed and non-dominant |

The current audit baseline was captured in a connected Chrome viewport of 1,536 × 695 CSS pixels. The three required laptop sizes above remain mandatory implementation verification because the connector did not provide a viewport override during this documentation pass.

## 27. Recommended implementation slices

The next action is a full-page design pack only. No application implementation should begin before those designs are approved against production-shaped data.

After approval, deliver vertical, functional slices in this order:

1. **Shared contracts:** terminology, independent state contracts, operational read models and mutation contracts.
2. **Prospect Inventory:** complete identity-resolution workflow and unified, idempotent Save review workflow.
3. **Incoming Leads:** complete human-triage review and save workflow over the immutable evidence ledger and mutable lead projection.
4. **Runs:** complete contextual inspection with immutable execution facts, appearance lineage and clearly labelled current canonical dispositions.
5. **Overview:** build the command centre from the completed operational read models and deterministic priority order.
6. **Outreach Drafts and cross-workspace acceptance:** preserve the draft-only boundary and verify the complete workspace at the required laptop sizes.

Each screen replacement must be functional from data retrieval through persisted decision and browser verification before its existing production route is replaced. Do not deploy a redesigned shell containing stub, disconnected or misleading controls. Use feature gating or an equivalent controlled cutover where necessary; the current screen remains authoritative until its replacement passes acceptance. Each slice should be one coherent branch/PR where practical, with focused tests and browser verification appropriate to its risk. Do not use a design pass as permission to alter production data or invoke providers.

## 28. Explicit non-goals

- No full CRM replacement.
- No manual arbitrary account/contact/opportunity administration.
- No creation of an Event Suite/customer account, tenant or CRM opportunity as a side effect of confirming or creating a canonical prospect organisation.
- No automatic qualification from AI confidence alone.
- No qualification before required identity uncertainty is resolved.
- No autonomous enrichment or contact discovery from a review click.
- No send, scheduling, sequence enrolment, campaign publication or autonomous outreach.
- No replay or historical re-research implementation in V1.
- No model retraining from operator feedback.
- No provider activation for OpenAI, Apollo, Google Places or Companies House in this redesign.
- No broad repository cleanup, migration reconciliation or data deletion.
- No mobile-first redesign; mobile remains a later responsive concern after laptop acceptance.
- No hidden prompts, chain-of-thought, secrets, access tokens or raw credentials in operator UI.

## 29. Known backend gaps

1. **Identity-resolution mutation is missing.** `operatorNextAction()` derives **Confirm organiser** from unresolved identity, but `/api/operator` exposes no action that persists the authoritative organisation/event relationship or changes `organisationResolution.status`. The current button routes to People, not identity resolution.
2. **Prospect review is not one transaction.** Current actions separately call `record_ai_prospect_inventory_action`; note and next action may be persisted through different paths from the lifecycle choice. The redesign needs an explicit review payload and atomic/idempotent save semantics.
3. **Current Inventory paging is offset-based.** `list_ai_prospect_inventory` uses `offset`/`limit`, while a separate keyset queue function exists. Growing inventory and concurrent inserts require a stable keyset contract for the canonical Inventory surface.
4. **Runs do not expose all required metrics.** The current route shows appearances and selected outcome counts but does not provide a reliable unique/new count, requested count, duration or persisted cost contract.
5. **Run provenance is incomplete for older data.** Research brief, trigger/source, discovery path, application version, cost and exact configuration are not consistently persisted. The UI must show **Not recorded** rather than infer them.
6. **Cross-run lineage is derived narrowly.** Canonical grouping and appearance data exist, but first-seen/latest-seen/current-run semantics and a stable run-to-canonical link should be formalised in the read model.
7. **Incoming Lead quick review exposes partial mutation coverage.** Backend `ADD_NOTE` and several stage actions exist, but quick review does not provide one coherent note/classification/owner/follow-up save flow.
8. **Idempotency is stronger for ingestion than review.** Inbound ingestion has source-event idempotency; prospect operator actions rely mainly on UI busy state and row locking, so repeated requests can create repeated audit rows unless action idempotency is added or defined.
9. **Attention and recent-change aggregates are not first-class read models.** Overview currently derives attention from latest-run candidate data and capped client projections. The command centre needs bounded, explicit operational queries.
10. **Run list pagination and failure detail are incomplete.** The current route retrieves a bounded set and exposes only a compact inspector; large histories and partial-run diagnostics require a server-backed contract.

## 30. Genuine owner decision still required

Identity-resolution behaviour and the qualification gate are resolved by this correction and are binding for V1. The only remaining owner decision is the **design approval gate**: approve the full-page production-shaped design pack for Overview, Incoming Leads, Runs, Prospect Inventory, Prospect review drawer and Run inspection drawer at 1,366 × 768, 1,440 × 900 and 1,920 × 1,080 before implementation begins.

## 31. Binding product decisions captured

The following decisions are binding for the next design and implementation cycle:

1. **Workspace purpose:** The Operator Workspace is a supervised decision surface for turning evidence into controlled revenue actions; it is not a research transcript, autonomous agent console or generic CRM.
2. **Five-section information architecture:** Overview, Incoming Leads, Runs, Prospect Inventory and Outreach Drafts remain distinct sections with explicit cross-links and no competing home surfaces.
3. **Inbound/outbound separation:** `incoming_submissions` and retained source activities form the immutable/replay-safe inbound evidence ledger; `incoming_leads` is the mutable operator projection; Incoming Leads is the human-triage workspace over both. Prospect Inventory is the canonical outbound prospect surface. A contact can be related across both domains without collapsing their source, lifecycle or audit history.
4. **Run semantics:** Runs record immutable execution facts and appearances. They are not the prospect database, and metrics distinguish appearances, canonical introductions, explicitly recorded run decisions and current canonical dispositions.
5. **Prospect identity gate:** Identity resolution has the four defined states and Event organiser workflow. A canonical prospect organisation is distinct from an Event Suite/customer account, and confirming one never creates the other.
6. **Qualification gate:** Qualification is blocked for required `UNRESOLVED` or `CONFLICTING_EVIDENCE` identity states and requires lane-appropriate authoritative identity plus one attributable, viewable source. Pain proof is not required and AI confidence alone cannot qualify.
7. **Independent substates:** Lifecycle, identity resolution, contactability, prospect approval-for-drafting and email-version approval remain separate states and counts.
8. **Review draft semantics:** Identity, relationships, selected lifecycle outcome, reason and notes are draft values until one explicit atomic/idempotent **Save review** operation persists the review. Selecting an outcome never fires a lifecycle mutation.
9. **Destructive safety:** Reject, block and duplicate actions require explicit confirmation naming the record, consequence and reason. Closing dirty review state requires a discard decision.
10. **Evidence-first decisions:** Every review decision must retain the supporting evidence, source URL or source event context available at decision time, plus actor and timestamp.
11. **Outreach boundary:** Outreach remains draft-only and isolated from sending infrastructure. No autonomous communication, scheduling or send action is part of this PRD.
12. **Production-shaped design:** The approved design pack must be validated at 1366×768, 1440×900 and 1920×1080 using realistic data volumes, including long drawers, empty states, errors, stale data and responsive overflow.
13. **No hidden inference:** Missing historical provenance or configuration is displayed as **Not recorded**; the product must not infer private prompts, hidden model instructions, unrecorded source metadata or unsupported lifecycle facts.
