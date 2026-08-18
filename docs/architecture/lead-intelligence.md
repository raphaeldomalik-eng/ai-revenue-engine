# Lead Intelligence Foundation V1

Lead Intelligence is a product-agnostic, deterministic domain layer. It accepts a structured `AccountProfile`, optional shared `ContactProfile` records, and explicit `ResearchEvidence`; it does not discover, crawl, enrich, or persist prospects.

```text
Evidence
  -> Signals
  -> Assessment
  -> Commercial Program / Playbook
  -> Product Opportunity recommendation
  -> Research Gaps
```

## Contracts

- `AccountProfile` represents the real organisation. It is shared across products; it is not an Event Suite-specific lead record.
- `ResearchEvidence` records provenance, observation date, confidence, and whether the item is a `FACT` or `INFERENCE`.
- `CommercialSignal` contains a derived state, confidence, evidence references, source, and notes.
- `ClientSegmentMatch` identifies generic client types or an existing commercial segment such as South African Schools.
- `CommercialProgramMatch` references the existing deterministic commercial playbook resolver. It does not copy pricing or claims.
- `ProductOpportunityRecommendation` supports multiple products and multiple motions for one Account. Direct routes remain `UNDETERMINED`; LNO uses the existing opportunity-enquiry conversion goal.
- `ResearchGap` states what is missing and why it matters for the next research step.

`FACT != INFERENCE`. An inference is never silently promoted to a fact. The assessment engine only derives territory, segment, motion, or signal conclusions from evidence-linked structured facts. Unknown values remain `UNKNOWN`.

## Current boundary

The first adapter resolves Event Suite playbooks because Event Suite is Product #1. The shared account, contact, evidence, signal, assessment, and opportunity contracts are reusable for Allxs and Prestige ID later.

South African Schools are recognised through the existing South Africa Direct playbook segment. The recommendation exposes special pricing with `DEFERRED` status and no numeric discount. Venues remain client types; no Venue Operations product is created.

No Supabase writes, migrations, authentication, RLS changes, OpenAI calls, automated discovery, contact discovery, scoring, outreach, CRM workflow, or scheduled research are part of this slice.
