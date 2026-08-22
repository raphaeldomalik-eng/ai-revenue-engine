# Outreach Composer V1

The owner-approved runtime source of truth is [`outreach-composer-prompt-pack-v1.md`](./outreach-composer-prompt-pack-v1.md), prompt version `outreach-composer-v1`. Its wording is loaded by the server Composer and protected by a byte-fidelity regression test.

The Composer is a supervised drafting agent only. It may create at most three email drafts, generate human-directed revisions, and record review feedback. It cannot send, schedule, publish, enrol, connect to a mailbox, or call the legacy `outreach_messages`, `outreach_sequences`, SendGrid or cron paths.

Production activation is opt-in and server-only. Both flags must equal the literal value `true`:

- `AI_OUTREACH_COMPOSER_ENABLED`
- `AI_OUTREACH_COMPOSER_PERSISTENCE_ENABLED`

The Composer uses strict `json_schema` structured output. Deterministic validation enforces evidence IDs, identity/contact provenance, stop states, message limits, URL tokens, CTA rules, prohibited language, and the rule that signatures are inserted outside the model.

Composer data is isolated in `ai_outreach_drafts`, immutable `ai_outreach_draft_versions`, and append-only `ai_outreach_draft_reviews`. Separate approval is required for each message version. Approval is review data only and is never a send permission.

Approved deterministic sender configuration:

- Trial: `https://app.eventsuite.pro/onboarding`
- Demo: `https://app.eventsuite.pro/book-demo`
- LinkedIn: `https://www.linkedin.com/in/raphaeldomalik/`

No production activation values are committed.
