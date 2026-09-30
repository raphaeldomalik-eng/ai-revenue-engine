# AI Revenue Engine operating rules

- This repository is the source of truth for AI Revenue Engine implementation.
- Event Suite is Product #1 for the commercial workforce, but it is not the AIRE architecture boundary. AIRE is the shared external execution, research, graph-expansion, orchestration and communication platform for the Prestige portfolio.
- Prestige Nexus is the canonical truth/evidence-governance owner. AIRE executes bounded external work and owns product-local commercial/workflow state; it must not silently become canonical identity or product-publication authority.
- Before substantial changes, read `docs/PRD.md`, `docs/PRD/aire-platform-pipeline-v1.md`, relevant architecture docs, and the relevant product profile/playbook.
- Before changing discovery, provider execution, crawling, classification, research orchestration, event acquisition, commercial workflows, communication or cross-product integration, also read the Prestige Nexus cross-product architecture contract and identify the owning repository/contract.
- Preserve the distinction between observation/evidence, canonical entity, product disposition, commercial prospect, contact, opportunity and communication.
- Communication must have an explicit purpose. Listing/claim/image-permission/service communications are not automatically commercial outreach.
- Prefer deterministic/structured evidence and existing evidence reuse before provider calls or AI. AI must be explicitly justified by workflow policy, not invoked merely because work runs inside AIRE.
- Graph expansion must always be bounded by purpose, market/entity scope, depth, provider allowances, request/cost budgets, freshness and stop conditions.
- Last Train Home is an active production product and mature donor. Do not break or prematurely cut over LTH to satisfy shared-architecture cleanup; use shadow/parity and capability-by-capability migration.
- Extend existing architecture before creating parallel mechanisms. Do not perform repository-wide speculative audits.
- Follow one coherent branch/PR per delivery slice; do not push after every tiny edit.
- Never expose or commit secrets. Keep Supabase RLS enabled and fail-closed unless an explicit authenticated access model is being implemented.
- Do not modify the Event-project repository from this repository's implementation tasks unless the user explicitly scopes a coordinated cross-repository change.
- Run the repository verification gate before reporting implementation completion.
- Every meaningful handoff must include status/result, approach, files, checks and outputs, relevant database/browser/deployment evidence, risks, deferred items, acceptance criteria, branch/commit/PR, and a concise technical handoff.
