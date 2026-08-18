# AI Revenue Engine operating rules

- This repository is the source of truth for AI Revenue Engine implementation.
- Event Suite is Product #1, but it is not the architecture boundary. Allxs and Prestige ID must later be addable without duplicating shared account, contact, research, or revenue infrastructure.
- Before substantial changes, read `docs/PRD.md`, relevant architecture docs, and the relevant product profile/playbook.
- Extend existing architecture before creating parallel mechanisms. Do not perform repository-wide speculative audits.
- Follow one coherent branch/PR per delivery slice; do not push after every tiny edit.
- Never expose or commit secrets. Keep Supabase RLS enabled and fail-closed unless an explicit authenticated access model is being implemented.
- Do not modify the Event-project repository. Run the repository verification gate before reporting completion.
- Every meaningful handoff must include status/result, approach, files, checks and outputs, relevant database/browser/deployment evidence, risks, deferred items, acceptance criteria, branch/commit/PR, and a concise technical handoff.
