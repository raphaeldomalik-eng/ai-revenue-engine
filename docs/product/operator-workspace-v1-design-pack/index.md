# AI Revenue Engine Operator Workspace V1 Design Pack

Status: design candidate for product-owner approval. This is an isolated local render pack for the approved [Operator Workspace V1 PRD](../operator-workspace-v1-prd.md). It contains no application routes, components, API calls, database mutations or production changes.

The visual system reuses the production language—dark green, warm off-white, restrained lime and editorial hierarchy—while changing the hierarchy from a latest-run report into a supervised operational workspace.

## Surface index

Every primary surface is rendered at the three required laptop sizes.

| Surface | 1366 × 768 | 1440 × 900 | 1920 × 1080 | PRD contract |
|---|---|---|---|---|
| Overview | [PNG](overview-1366x768.png) | [PNG](overview-1440x900.png) | [PNG](overview-1920x1080.png) | Sections 10, 17, 19, 21, 25, 26 |
| Incoming Leads | [PNG](incoming-leads-1366x768.png) | [PNG](incoming-leads-1440x900.png) | [PNG](incoming-leads-1920x1080.png) | Sections 9, 11, 17, 18, 21, 25, 26 |
| Runs | [PNG](runs-1366x768.png) | [PNG](runs-1440x900.png) | [PNG](runs-1920x1080.png) | Sections 12, 17, 20, 21, 25, 26 |
| Prospect Inventory | [PNG](prospect-inventory-1366x768.png) | [PNG](prospect-inventory-1440x900.png) | [PNG](prospect-inventory-1920x1080.png) | Sections 8, 13, 17, 20, 21, 25, 26 |
| Prospect review drawer | [PNG](prospect-review-drawer-1366x768.png) | [PNG](prospect-review-drawer-1440x900.png) | [PNG](prospect-review-drawer-1920x1080.png) | Section 14 and acceptance criteria 11–17 |
| Run inspection drawer | [PNG](run-inspection-drawer-1366x768.png) | [PNG](run-inspection-drawer-1440x900.png) | [PNG](run-inspection-drawer-1920x1080.png) | Sections 12, 15, 17 and acceptance criteria 7–8, 18 |

## Contact sheets

- [1366 × 768 contact sheet](contact-sheets/contact-sheet-1366x768.png)
- [1440 × 900 contact sheet](contact-sheets/contact-sheet-1440x900.png)
- [1920 × 1080 contact sheet](contact-sheets/contact-sheet-1920x1080.png)

## Full-height workflow and state boards

- [Prospect review workflow board](drawers/prospect-review-workflow-board.png) — Identity → Relationships → Evidence → Decision, with the identity choices, evidence grouping, intended outcome and sticky Save review treatment.
- [Run inspection board](drawers/run-inspection-board.png) — execution facts, canonical introductions, recorded historical decisions, current dispositions, provenance, persisted appearances and read-only diagnostics.
- [Supporting states board](states/supporting-states-board.png) — loading, empty, no results, recoverable error, stale data, save pending/success/failure, unknown persistence, dirty close, destructive confirmation and permission denied.

## Hierarchy by surface

- **Overview:** page purpose and refresh time, then one deterministic highest-value next action, prioritised attention, separate inbound/prospect health, compact research health and recent changes. The latest run is supporting context only.
- **Incoming Leads:** saved queues and operational counts lead into one readable row-level Review action. Source/activity history is visible without competing Genuine, Exclude, Reviewed, More and Quick review controls.
- **Runs:** execution facts are grouped separately from canonical introductions and current dispositions. Inspect is the only row action; the run remains read-only and links outward to Prospect Inventory.
- **Prospect Inventory:** decision counts and stable filters lead into a canonical cross-run queue. Identity state, lifecycle and next action are more prominent than low-value database fields.
- **Prospect review drawer:** a persistent header, four-step progress model, independently scrollable body and sticky footer make identity resolution and Save review the primary workflow. Outcome controls are draft selections; destructive choices are secondary.
- **Run inspection drawer:** the Runs context remains visible behind the drawer while provenance, historical facts, current dispositions and incomplete-data warnings stay explicit and read-only.

## Product workflow decisions represented

### Confirm organiser

The Event-first example shows a suggested organiser relationship and five explicit choices: confirm the suggestion, search another canonical prospect organisation, create a canonical prospect organisation from sourced evidence, mark unresolved, or mark not applicable when the record is not an event. This action resolves a prospect identity relationship only; it does not create an Event Suite account, tenant or opportunity.

### Save review and destructive decisions

Qualify, Reject, Block and Duplicate appear as intended outcomes inside the review draft. The visible **Save review** footer communicates that the outcome is not persisted yet. Reject, Block and Duplicate are secondary/destructive and the states board shows the required confirmation pattern: named record, consequence, required reason and Cancel.

### Historical runs versus current dispositions

The Runs surface labels requested/found and canonical introductions as execution-related facts. Historical operator decisions are shown only when recorded. Current lifecycle/identity/contactability dispositions are grouped separately and labelled as current, so later prospect decisions do not rewrite the historical run.

## Production-shaped data used

The screens use the observed production-shaped quantities: 16 Incoming Leads needing review, 2 high-intent inbound leads, 0 active genuine inbound leads, 39 runs, 188 canonical prospects, 95 identity decisions, 1 qualified, 4 contactable, 58 rejected, 5 blocked, 29 duplicates and no persisted Outreach Drafts. Long organisation, event and contact names are included to exercise wrapping and density.

## Rendering boundary

`render-design-pack.cjs` is an isolated local renderer kept with this pack for reproducibility. It uses SVG composition and Sharp to emit exact-size PNGs. It is not imported by the application and has no functional controls or persistence.

## Approval gate

Implementation remains blocked until the product owner approves these images. After approval, implementation should follow the vertical functional slices and controlled cutover rule in PRD Section 27; the current production routes remain authoritative until each replacement passes data, persistence and browser acceptance.
