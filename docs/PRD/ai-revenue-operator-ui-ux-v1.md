# AI Revenue Engine Operator UI / UX V1

Status: Product/design PRD; documentation only  
Owner: Revenue Engine product team  
Scope: Operator supervision of the AI sales team  
Implementation status: Not implemented by this document

## 1. Product purpose

The AI Revenue Engine is an AI sales team, not a CRM. The operator should supervise what the team found, what it believes matters, what evidence supports that belief, what changed in a run, and what genuinely needs a human decision.

Accounts, contacts, opportunities, activities and evidence remain machine commercial memory. They may appear in context, but they are not the primary navigation or mental model.

The V1 interface supports real operator use while making prospecting quality observable during calibration. It must make uncertainty and provenance useful without exposing database structure, raw JSON or model internals in the normal flow.

## 2. UX principles

- Organisation-centric: show the likely commercial target separately from the event or discovery signal.
- Evidence-forward: every meaningful conclusion has visible supporting FACTS, INFERENCES and UNKNOWNS.
- Run-centric: new work is always distinguishable from historical persistence.
- Actionable: prioritise decisions and next actions over vanity metrics.
- Plain language: use “Found”, “Resolved”, “Evidence”, “Recommendation” and “Needs your decision”.
- Calibratable: operators can assess identity, source type, product mapping and contact quality.
- Safe by default: provider, venue, directory and unverified contacts are visibly non-target until proven otherwise.
- Calm and scan-friendly: clear hierarchy, restrained colour, minimal animation and no decorative AI treatment.
- Desktop-first and responsive: support an operator reviewing many candidates without requiring a wide data grid.

## 3. Primary user and goals

The primary user is a non-technical commercial/product operator. They do not need to understand tables, JSON, SQL, agents, models or implementation architecture.

Primary goals:

1. See what the AI sales team found recently.
2. Identify the latest run and inspect only its candidates.
3. Separate current work from historical/calibration records.
4. Understand the resolved organisation, original signal and authoritative sources.
5. Judge the EGS, Ticketing and ECC commercial hypotheses.
6. See who the likely buyer is without invented people.
7. Assess whether a contact route is legitimate and belongs to the target.
8. Decide what, if anything, requires human intervention.

## 4. Information architecture

Primary navigation:

1. **AI Sales Team** — landing overview and current attention queue.
2. **Runs** — newest-first run history and run detail.
3. **Prospects** — organisation-centric prospect list.
4. **Needs Review** — only items requiring a meaningful human decision.
5. **Historical / Calibration** — separated inspection of old, replay, legacy and evaluation data.

Accounts, Contacts, Opportunities and Activities are contextual sections inside a prospect detail, not primary navigation. Settings, tenant management and future partner/channel areas remain outside V1.

Default route: **AI Sales Team**. The default view favours the latest completed run and current attention rather than all-time totals.

## 5. Overview / AI Sales Team

The landing page opens with a plain-language summary such as “Your AI sales team researched 8 candidates in the latest South Africa run.”

Above the fold:

- latest run banner with status, time, territory and lens;
- “View latest run” primary action;
- “What needs your attention?” queue;
- compact outcome strip: found, organisations resolved, commercially advanced, qualified, needs review, rejected/held, research incomplete;
- clear distinction between current run results and historical records.

Metrics are actionable counts, not growth theatre. Each count links to the filtered underlying view. A zero is a valid outcome and receives explanatory text, for example “No commercial signal was established; the research remains available as evidence.”

The overview should also show recent changes: newly resolved organisations, candidates that advanced commercially, candidates newly held for review, and failed/incomplete research. It should not show a generic CRM dashboard.

## 6. Navigation and run experience

### Runs list

Runs are newest first. The latest run receives a `LATEST RUN` badge; older records are labelled `HISTORICAL RUN` when outside the configured current window or explicitly calibration/legacy.

Each run displays where available:

- run ID and start/completion times;
- trigger/source of run;
- territory and prospecting lens;
- discovery path/configuration and source-family configuration;
- bounded candidate/research limits;
- discovery/query strategy version where available;
- status: running, completed, failed or partly completed;
- application commit SHA and deployment/version identifier in diagnostics;
- discovered, resolved, unresolved, attempted, technically succeeded, commercially advanced, qualified, rejected and duplicate counts;
- account creation and contactable counts;
- a plain-language result summary.

Clicking a run opens only candidates belonging to that run. It must never silently mix all historical candidates into the run detail.

### Run detail

Run detail begins with status and outcome, then a compact `RESEARCH BRIEF` / run-provenance area followed by a candidate list scoped to that run. Where available, the provenance area shows run ID, trigger/source, territory, commercial lens, discovery path/configuration, source-family configuration, bounded candidate/research limits, discovery/query strategy version, application commit SHA, deployment/version identifier, started/completed timestamps and a plain-language brief such as “South Africa · Ticketing — Find active event organisations showing credible ticketing workflow, fragmentation or change signals.” The operator must be able to answer what this run was instructed to investigate without guessing.

The brief is a product-facing summary of the research instruction. It must not expose system prompts, hidden chain-of-thought, secrets, API keys or privileged configuration. If the exact prompt/query version or another provenance field is not persisted, show `BACKEND SUPPORT REQUIRED` in the data-contract mapping rather than implying that the value is available.

The page explains technical success separately from commercial advancement. A technically successful enrichment with no product signal is shown as “Research completed — no commercial signal established”, not as a success KPI.

The operator can filter within the run by resolution, product outcome, qualification, contactability, source type and review state. A failed run shows what was completed and what remains unavailable.

## 7. Current versus historical

### Collection interaction model

The Operator UI uses one coherent collection interaction model:

**OVERVIEW FOR ORIENTATION. TABLES FOR COLLECTIONS. INSPECTOR FOR RAPID EVALUATION. DETAIL PAGES FOR EVIDENCE AND NARRATIVE.**

The operator should be able to scan approximately 50 records, compare records, spot anomalies and inspect several prospects without repeatedly losing table position. Desktop collection screens optimise for **SCAN, COMPARE, FILTER, SORT and INSPECT**; they do not present each record as a standalone card.

Runs, run-detail candidates, Prospects, Needs Review and Historical / Calibration use compact, readable tables with a shared treatment: sticky headers where practical, clear column hierarchy, subtle row separators, keyboard-accessible row selection, restrained status text/badges, sensible widths and explicit empty/filter-zero states. Long names may wrap to two lines and secondary context may use a muted second line. Cards remain appropriate for small Overview summaries, commercial-intelligence sections, evidence groups, contact provenance and individual record/detail narrative.

Prospects default to current actionable work while keeping Historical / All explicitly available. Collections support simple client-side pagination after filtering, with 25, 50 and 100 row options and a default page size of 50. A read-only Quick Inspector may summarise a selected prospect and link to the full narrative detail without replacing the detail page or exposing raw JSON.

Every result has a visible recency/context label:

- `NEW` — first seen in the latest run;
- `CURRENT` — recent active result still in the operator’s current working window;
- `HISTORICAL` — older persisted result, not evidence of current sales activity;
- `CALIBRATION` — intentionally retained evaluation or quality-review data;
- `LEGACY` — older data whose semantics may not match current rules.

The current operator flow defaults to `CURRENT` and `NEW`. Historical records remain searchable and inspectable but are not counted as active sales-ready prospects. Calibration views show the corpus context and evaluation status explicitly.

## 8. Prospect list

The list is organisation-centric. Each row/card contains:

- canonical organisation name, or `ORGANISATION NOT YET RESOLVED`;
- key event or discovery signal;
- territory and origin;
- `FOUND IN RUN` with run date/time, territory, lens, current/historical/calibration label and a short run identifier;
- resolution state and confidence;
- primary opportunity: Event Growth, Ticketing, Event Operations or no established opportunity;
- commercial priority and outcome;
- contactability summary;
- status and current/historical label;
- a clear `Needs your decision` indicator when applicable.

The list must not present a ticketing-provider URL as `Prospect website`. Source and target are separate fields.

Filters:

- latest run, run and date;
- territory and origin;
- source/site type;
- resolution state;
- commercial outcome and product;
- qualification/status;
- contactability;
- current, new, historical, calibration or legacy.

Sorting defaults to attention and recency, then newest first. Alternative sorts include priority, resolution confidence and commercial advancement. Search covers organisation, event and source names without implying that a match is a qualified prospect.

## 9. Prospect detail story

The detail screen follows this order:

1. Resolved commercial target
2. Discovery signal
3. Identity and organiser evidence
4. Event/activity context
5. Commercial intelligence
6. Buyer
7. Contactability
8. AI recommendation
9. Diagnostic/audit trail

### A. Resolved commercial target

Show prominently:

- canonical organisation name;
- authoritative organisation website;
- territory and relationship;
- resolution status and confidence;
- commercial priority and primary opportunity.

When unresolved, show `ORGANISATION NOT YET RESOLVED`. Do not promote the event, venue, directory or ticketing provider into the organisation heading.

### B. Discovery signal

Use a section titled `WHAT WE FOUND` followed by `WHO WE THINK THE CUSTOMER IS`.

Show the original event/signal name, original URL, source site type, discovery path, source authority/confidence, freshness and original event website. A ticketing page is labelled `SOURCE: TICKETING PROVIDER`; it is never labelled `PROSPECT WEBSITE`.

### C. Identity and organiser evidence

Show the organiser claim, source, site type, confidence, official event site, official organisation site and useful aliases. The operator should be able to answer “Why does the AI think this organisation owns or runs this event?” without opening raw JSON.

### D. Event/activity context

Summarise events, dates, recurrence, locations, portfolio breadth, freshness, ticketing/provider context and evidenced operational complexity. Present a story and evidence clusters rather than a dump of rows.

### E. Origin run context

Place `FOUND IN RUN` near the discovery signal or detail header. Show the originating run/context prominently enough that the operator never has to infer from timestamps whether a prospect belongs to the latest test. `CURRENT` is a recency label, not a substitute for origin-run identity. For cross-run canonical prospects, show where practical: `FIRST SEEN`, `LATEST SEEN` and `CURRENT RUN`, without turning the detail screen into CRM history.

## 10. Commercial intelligence

Use product-facing lenses:

- **Event Growth** — owned digital presence, discoverability and event-growth signals;
- **Ticketing** — concrete ticketing, registration, workflow, provider fragmentation or change evidence;
- **Event Operations** — stages, venues, concurrency, accreditation, workforce, vendors and production coordination.

Each lens shows assessment, opportunity strength, supporting FACTS, supporting INFERENCES, UNKNOWNS, commercial evidence and confidence. Positive, negative and unproven conclusions must all explain why in plain language.

The UI must preserve the distinction between a ticketing provider being present and a proven Ticketing problem. A provider alone is context, not commercial pain.

## 11. FACT / INFERENCE / UNKNOWN

These are separate visual components and filters:

- **FACT** — directly supported by public evidence; show claim, source and confidence.
- **INFERENCE** — AI-supported interpretation; show the reasoning summary and the evidence it relies on, without chain-of-thought.
- **UNKNOWN** — an important unanswered question; show why it matters and whether the AI or a human should resolve it.

FACTS use an evidence treatment, INFERENCES use an interpretation treatment, and UNKNOWNS use a question treatment. They must never be merged into one undifferentiated “AI insight” block.

## 12. Buyer presentation

Show likely buyer/problem-owner roles, rationale and confidence. A named person is shown only when legitimately evidenced. Do not invent a name, title, email or social profile from a role hypothesis.

## 13. Contact provenance

Contactability is first-class. For every route show:

- email, phone or public route;
- verification state and contact type;
- source URL and source site type;
- organisation/contact owner;
- bounded ownership evidence explaining why the route belongs to the resolved target;
- whether it belongs to the resolved commercial target;
- usable, rejected or review-required state;
- rejection reason.

Prominent provenance labels include:

- `TICKETING PROVIDER CONTACT — NOT TARGET CONTACT`
- `VENUE CONTACT — NOT VERIFIED AS ORGANISER`
- `DIRECTORY CONTACT — NOT TARGET CONTACT`
- `TARGET ORGANISATION CONTACT — VERIFIED`

For a usable target route, present the bounded evidence in plain language, for example:

```text
CONTACT       events@abcpromotions.co.za
OWNER         ABC Promotions Ltd
SOURCE        Official organisation contact page
WHY WE BELIEVE IT BELONGS TO THE TARGET
              Published on ABC Promotions Ltd's authoritative contact page.
STATUS        TARGET ORGANISATION CONTACT — VERIFIED
```

Ownership evidence may be an authoritative organisation website, an official event site explicitly attributing the contact to the resolved organiser, or an authoritative contact/about/legal page tying the route to the target. For rejected/non-target routes, show the mismatch plainly, including the owner, source type, target and reason, for example `support@ticketsza.co.za` → `TicketsZA` → `TICKETING_PROVIDER` → `NOT TARGET CONTACT`: “This route belongs to the ticketing provider, not the event organiser.” Ticket-provider support pages, directories, unrelated venue or artist/agent routes, generic third-party footers and guessed email patterns must not establish target ownership alone.

No provenance or ownership evidence means the route is not safe to present as usable sales contact. If stronger ownership evidence or its history is not currently persisted, mark that specific field/history `BACKEND SUPPORT REQUIRED`. Contact Discovery and outreach policy remain unchanged by this PRD.

## 14. AI recommendation

Show the recommended next action, reason, confidence, whether approval is required and the unresolved blocking question. Examples are “Confirm organiser relationship”, “Review EGS evidence” or “No human action — continue bounded research”. Do not manufacture human tasks for work the AI can safely continue.

## 15. Needs Review

Needs Review is a decision queue, not a failure bucket. An item belongs there only when a human can meaningfully resolve a specific ambiguity or approve a meaningful action.

Every item must answer: **WHAT DECISION DO YOU NEED FROM ME?**

Valid examples:

- confirm organiser relationship;
- approve a material correction to authoritative identity;
- resolve conflicting official sources;
- approve outreach when all safety conditions are met.

“Needs more research” is not sufficient when the AI can continue researching itself. Weak, unresolved or rejected candidates remain inspectable in the relevant status view without being promoted into the human queue.

## 16. Historical and calibration mode

Historical/Calibration is a deliberate inspection workspace, not a second active pipeline. It shows corpus date, source/run context, legacy/calibration label, current-rule interpretation and evaluation status.

Future comparison mode should place `ORIGINAL HISTORICAL RESULT` beside `CURRENT REPLAY RESULT`, with changed identity, website, source type, product mapping, qualification and contactability highlighted. Replay is not implemented by V1.

## 17. Evaluation feedback

When calibration is active and durable backend support exists, an operator can submit structured feedback:

`CORRECT`, `WRONG ORGANISATION`, `WRONG OFFICIAL WEBSITE`, `WRONG SITE TYPE`, `WRONG ORGANISER`, `BAD COMMERCIAL HYPOTHESIS`, `BAD PRODUCT MAPPING`, `BAD CONTACT`, `DUPLICATE`, `OTHER`.

Feedback is evaluation data with timestamp, reviewer and affected candidate/run context. It does not trigger automatic model retraining. The UI should show whether feedback is pending review or incorporated into a future calibration cycle.

Structured evaluation feedback is a product requirement, but it is `AVAILABLE NOW` only when durable backend persistence exists. Otherwise the control is `PLANNED / BACKEND SUPPORT REQUIRED`; do not create local-only feedback that disappears on refresh or silently encode feedback into unrelated candidate fields. Do not request a schema change in this documentation correction.

## 18. Status semantics

Operator labels are mapped from existing states where possible:

| Operator label | Meaning | Current persistence |
|---|---|---|
| DISCOVERED SIGNAL | A sourced event or organisation signal exists | Candidate/run data |
| RESOLVING ORGANISATION | Identity research is in progress | Derived from enrichment state |
| RESEARCHING | Public enrichment is running | Derived from run state |
| RESEARCH MEMORY | Useful evidence exists but no commercial qualification | Candidate status/qualification |
| NEEDS REVIEW | A specific human decision is required | Derived UI queue |
| QUALIFIED | Existing intelligence passes the current account gate | Prospect intelligence/status |
| SALES READY | Future stronger outbound-ready concept | Derived future UI concept; no new backend state |
| REJECTED | Explicitly blocked or not a valid prospect | Candidate status |
| DUPLICATE | Existing canonical candidate found | Candidate status |
| HISTORICAL | Older or calibration context | Derived from timestamps/metadata |

Raw database statuses are translated into these labels with explanatory text. No schema change is requested to create visual labels.

## 19. Sales-ready concept

Sales Ready is deliberately stronger than Qualified. For outbound email it eventually requires resolved organisation, defensible commercial opportunity, appropriate buyer role, verified legitimate target contact, no suppression/blocking issue and the appropriate outreach approval state. V1 documents this concept but does not add a backend state or alter sending policy.

## 20. Empty and failure states

- **No prospects found:** “No current prospects were established in this run.” Show the run evidence and invite another bounded run where permitted.
- **Organisation unresolved:** “Organisation not yet resolved.” Keep the original signal and explain what identity evidence is missing.
- **Enrichment failed:** “Research could not be completed.” Show technical retry/context in diagnostics, not as a false commercial conclusion.
- **Enrichment succeeded, no commercial signal:** “Research completed — no commercial signal established.” Preserve evidence and unknowns.
- **No contact route:** “No verified target contact found.” Explain that guessed routes are excluded.
- **Source ambiguous:** “Source role is not established.” Do not promote the URL.
- **Run failed:** show completed/failed stages, timestamp and safe retry action.
- **Run partly completed:** show completed candidates separately from pending/failed work.
- **No recent runs:** explain that historical results remain available and provide the bounded discovery action if the user is authorised.

Valid research outcomes must not look like application failures.

## 21. Transparency and diagnostics

The normal interface uses commercial language and evidence summaries. An expandable `Diagnostics` layer may expose run ID, candidate ID, trigger/source, territory, commercial lens, discovery path/configuration, source-family configuration, bounded limits, discovery/query strategy version where available, provider/model, started/completed timestamps, technical outcome, application commit SHA, deployment/version identifier, source roles and raw status mapping. Run Detail also shows the plain-language `RESEARCH BRIEF` where available.

Do not render raw JSON, access tokens, service credentials, chain-of-thought or internal prompts in the default page or diagnostic layer.

## 22. Filters, search and accessibility

Filters and sorting must be keyboard accessible, have named controls and preserve scope in the URL where practical. Colour is never the sole status signal. Every badge has text and accessible name. Focus order follows the story hierarchy.

Tables are used only where comparison benefits from columns; cards and sections are preferred for detail. The layout is desktop-first but collapses to a readable single-column flow. Text remains zoomable, contrast is sufficient, links identify destination, and loading/error states are announced to assistive technology.

## 23. Data-contract mapping

| UI requirement | Existing support | UI logic or future support |
|---|---|---|
| Runs, status, timestamps, territory, lens | `ai_prospect_discovery_runs` | Derived counts and current/historical labels |
| Candidates scoped to a run | `ai_prospect_candidates.discovery_run_id` | Run filtering |
| Organisation identity and source distinctions | Candidate fields plus `prospect_intelligence` JSON | Presentation mapping; no schema change |
| Site type/classification evidence | `prospect_intelligence` and candidate evidence after PR #18 | Derived badges and source grouping |
| EGS/Ticketing/ECC assessments | `prospect_intelligence` | Lens components and explanations |
| FACT/INFERENCE/UNKNOWN | Candidate facts, inferences and unknowns; `research_evidence` | Evidence grouping and confidence display |
| Accounts | `accounts` | Contextual target summary only |
| Opportunities | `product_opportunities` | Contextual product/commercial summary |
| Contacts | `contacts` | Contact provenance presentation |
| Contact research | Candidate `contact_research` and contact metadata | Derived verification/ownership display |
| Run provenance and research brief | Run metadata where persisted | Display run instruction context; exact prompt/query version, discovery configuration or brief history are `BACKEND SUPPORT REQUIRED` where not persisted |
| Prospect origin run | `ai_prospect_candidates.discovery_run_id` plus run metadata | `FOUND IN RUN`, first/latest/current-seen context; richer cross-run lineage may require backend support |
| Contact ownership evidence | Contact research, evidence and source URLs where persisted | Show owner/source/why/rejection evidence; missing bounded evidence/history is `BACKEND SUPPORT REQUIRED` |
| Evidence | `research_evidence` and candidate source URLs | Source and claim presentation |
| Needs Review | Existing statuses/intelligence/recommendations | Derived queue; a durable review decision model may be needed later |
| Current versus historical | Timestamps, run context and metadata | Derived policy/configuration; no schema request in V1 |
| Evaluation feedback | Not established as a dedicated product flow | Planned backend support required before durable feedback analytics |
| Replay comparison | Not available | Planned backend and UI support |

### Availability classification

**AVAILABLE NOW:** run/candidate retrieval, run scoping, candidate facts/inferences/unknowns, resolution state, source URLs, site classifications, commercial lenses, recommendations, accounts, opportunities, contacts, contact research and evidence.

**NEEDS DERIVED UI LOGIC:** latest/current/historical labels, attention queue, commercially advanced summary, contactability rollups, sales-ready interpretation, source-owner warnings, status translation and run comparison summaries.

**PLANNED / BACKEND SUPPORT REQUIRED:** exact prompt/query version and any unpersisted research-brief/provenance fields, richer cross-run lineage where unavailable, bounded contact ownership evidence/history where unavailable, durable evaluation-feedback records, replay lineage/comparison, explicit review decisions and future notification/assignment mechanics.

No missing capability requires a schema change for the documentation slice. Future backend work must preserve RLS, internal-only membership and the distinction between event signals and commercial targets.

## 24. V1 scope

V1 prioritises run visibility, current/historical separation, the organisation-centric prospect list, prospect detail, identity/source transparency, commercial evidence transparency, contact provenance, Needs Review and safe structured evaluation feedback where the existing contract supports it.

V1 is not a full CRM and does not introduce manual account/contact/opportunity maintenance.

## 25. Deferred concepts

Defer customer lifecycle management, Local Operator Network UI, EventSuite tenant management, advanced attribution, SendGrid analytics, Meta/LinkedIn-specific interfaces, autonomous campaign control, forecasting, pipeline management, manual CRM editing, advanced mobile UI, broad settings administration and replay implementation.

Leave room for future Partner/Channel concepts without treating partners as internal `revenue_members`.

## 26. Textual wireframes

### A. Overview / AI Sales Team

```text
[AI SALES TEAM]                         [Run bounded research]
Latest run: South Africa · All · Completed · 12 min ago [View run]

What needs your attention?  [2 decisions]
  Confirm organiser relationship       [Review]
  Resolve conflicting official sources  [Review]

Latest run outcomes
  Found 8   Resolved 3   Advanced 1   Qualified 0   Review 2   Rejected 4

Recent changes
  Newly resolved organisations ...
  Research completed with no commercial signal ...

[Current prospects] [Latest run] [Historical / calibration]
```

### B. Runs list

```text
RUNS                                      [Filter] [Newest first]
LATEST RUN  20 Aug · ZA · All · COMPLETED
  Found 8 · Resolved 3 · Advanced 1 · Qualified 0 · Review 2
  Started / completed · [View run]

HISTORICAL RUN  19 Aug · GB · EGS · COMPLETED
  Found ... · Calibration label · [View run]
```

### C. Run detail

```text
[Back to Runs]  LATEST RUN
South Africa · All · Completed
Found 8 | Resolved 3 | Unresolved 2 | Enrichment 4/4 | Advanced 1

RESEARCH BRIEF                         RUN PROVENANCE
South Africa · Ticketing               Run ID · trigger/source
Find active event organisations ...     Discovery path · source families
                                        Limits · strategy version · commit/deployment

Candidates in this run only
[Organisation] [Signal] [Resolution] [Product] [Outcome] [Attention]
...

Diagnostics (collapsed)
  Run ID · model/provider · commit/deployment · timestamps · technical result
```

### D. Prospect list

```text
PROSPECTS                         [Latest run] [Filters] [Search]
Organisation       Signal          Product       Contactability  Status
Promoter Group     Festival X      Event Growth  No verified route  Review
ORGANISATION NOT   TicketsZA event  Unknown       None              Memory
YET RESOLVED

FOUND IN RUN: 20 Aug · ZA · Event Growth · CURRENT · run-abc123

Badges: NEW · CURRENT · HISTORICAL · NEEDS YOUR DECISION
```

### E. Prospect detail

```text
RESOLVED COMMERCIAL TARGET
Promoter Group  [HIGH confidence]  promotergroup.example
PROSPECT · South Africa · Event Growth

WHAT WE FOUND                         WHO WE THINK THE CUSTOMER IS
Festival X · EVENT_OFFICIAL            Promoter Group · ORGANISATION_OFFICIAL
Original source [Open evidence]        Why: organiser claim [source]
FOUND IN RUN: 20 Aug · ZA · Event Growth · run-abc123
FIRST SEEN · LATEST SEEN · CURRENT RUN

EVENT / ACTIVITY   COMMERCIAL INTELLIGENCE   BUYER   CONTACTABILITY
...                Event Growth: Strong       Festival  No verified target route
                    FACT / INFERENCE / UNKNOWN

CONTACTABILITY
  Contact · Owner · Source · Ownership evidence
  TARGET ORGANISATION CONTACT — VERIFIED / NOT TARGET CONTACT

RECOMMENDATION: Confirm organiser relationship [Needs your decision]
Diagnostics (collapsed)
```

### F. Needs Review

```text
NEEDS YOUR DECISION
Each item states the decision, not merely “more research”.

[Confirm organiser relationship]
  Promoter Group ↔ Festival X · evidence conflict · [Open prospect]

[Approve outreach]
  Target contact verified · no suppression issue · [Review approval]
```

### G. Historical / Calibration

```text
HISTORICAL / CALIBRATION                  [Corpus filters]
These records are inspectable, not active sales leads.

CALIBRATION · 14 Aug · original result: provider mistaken for organiser
  Current interpretation: provider source / organisation unresolved
  Feedback: WRONG ORGANISATION [Open]

Future: ORIGINAL HISTORICAL RESULT  |  CURRENT REPLAY RESULT
```

## 27. V1 acceptance criteria

The implementation of this PRD is acceptable only when an operator can, without database knowledge:

- identify the primary navigation and default AI Sales Team landing page;
- identify the latest run and inspect only its candidates;
- distinguish current, new, historical, calibration and legacy records;
- see run counts for found, resolved, unresolved, enriched, commercially advanced, qualified, rejected and duplicate results;
- understand discovery signal versus resolved commercial target;
- distinguish official organisation, official event, ticketing provider, directory, venue, social, news and unknown sources;
- see why an organiser identity was resolved or remains unresolved;
- see the authoritative organisation website without mistaking a provider/listing URL for it;
- understand Event Growth, Ticketing and Event Operations assessments;
- distinguish FACT, INFERENCE and UNKNOWN;
- see buyer-role reasoning without invented people;
- inspect contact provenance, ownership, verification state and rejection reason;
- answer the exact originating run, its territory/lens/research brief and application/version where available;
- see `FOUND IN RUN` on prospect cards/lists/details, including run time, territory, lens, context label and short identifier;
- distinguish `FIRST SEEN`, `LATEST SEEN` and `CURRENT RUN` for cross-run canonical prospects where practical;
- understand why a contact route is believed to belong to the resolved target and why ticket-provider, venue or directory routes were rejected;
- determine whether operator calibration feedback is durably persisted or deliberately deferred as backend support required;
- understand what belongs in Needs Review and what does not;
- inspect rejected, duplicate and unresolved candidates without treating them as active leads;
- identify the information shown on prospect cards and detail screens;
- understand what is explicitly outside V1.

## 28. Non-goals and safety constraints

This documentation does not implement frontend code, backend changes, schema, migrations, RLS, auth, replay, contact-provenance backend changes, database cleanup, prospecting changes or Quality Calibration V4. It does not alter outreach approval/send behaviour. It must not expose privileged credentials, system prompts, hidden chain-of-thought, API keys or raw authentication material. Durable evaluation feedback and stronger contact-ownership evidence are not represented as available UI capabilities unless backend persistence exists.
