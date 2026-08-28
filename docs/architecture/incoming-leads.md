# Incoming Leads V1

Incoming Leads is a separate commercial area from the outbound AI Prospect queue. It uses an immutable `incoming_submissions` ledger for source evidence and a mutable `incoming_leads` projection for operator work. Shared `accounts`, `contacts`, `product_opportunities` and `activities` remain the canonical commercial records.

Identity resolution is conservative: normalized exact email is the strongest contact key; the originally submitted email is retained; company domain alone never merges contacts. `contacts.account_id` is nullable so a contact can be retained while account evidence is unresolved. An account is reused by canonical reference or exact organisation match, and is only created from an explicitly high-confidence development/source organisation assertion. Ambiguous accounts remain in `AMBIGUOUS_ACCOUNT` review.

Every accepted non-test submission creates one activity linked by `activities.incoming_submission_id`; the unique index and source-system/source-record-id key make processing replay-safe. Resource and template repeats therefore become activity history on one contact/lead. High-intent sources may create one inbound product opportunity per account/product commercial context; low-intent downloads do not.

Communication treatment is persisted as an explainable policy snapshot. V1 displays permitted treatment and recommended next action only; there is no delivery provider, send action, Event Suite integration, backfill, or autonomous communication path.
