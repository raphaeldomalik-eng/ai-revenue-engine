# Incoming Leads V1

Incoming Leads is a separate commercial area from the outbound AI Prospect queue. It uses an immutable `incoming_submissions` ledger for source evidence and a mutable `incoming_leads` projection for operator work. Shared `accounts`, `contacts`, `product_opportunities` and `activities` remain the canonical commercial records.

Identity resolution is conservative: normalized exact email is the strongest contact key; the originally submitted email is retained; company domain alone never merges contacts. `contacts.account_id` is nullable so a contact can be retained while account evidence is unresolved. An account is reused by canonical reference or exact organisation match, and is only created from an explicitly high-confidence development/source organisation assertion. Ambiguous accounts remain in `AMBIGUOUS_ACCOUNT` review.

Every accepted non-test submission creates one activity linked by `activities.incoming_submission_id`; the unique index and source-system/source-record-id key make processing replay-safe. Resource and template repeats therefore become activity history on one contact/lead. Incoming records start in `NEEDS_REVIEW`; an inbound product opportunity can be created only where an operator has explicitly classified the lead as `GENUINE_PROSPECT`. A non-lead, customer, or excluded classification blocks enrichment and opportunity eligibility.

## Operator workspace V1

The operator queue is database-filtered and paginated, with views for review, active prospects, high intent, due follow-up, incomplete data, customers, excluded records, and all records. Operators can bulk assign, mark reviewed, or classify up to 100 selected records; every mutation is recorded in `incoming_lead_changes`. There is no destructive merge or delete control. A restored excluded record returns to `NEEDS_REVIEW` and remains subject to normal qualification.

Classification is explicit: genuine prospect, needs review, existing customer/tenant, partner, supplier, competitor, ticketing provider, internal, test/synthetic, and other non-lead. Existing customers and non-lead classes require a reason. The record detail shows raw submission evidence, the complete interaction timeline, data-quality gaps, account research evidence, enrichment eligibility, and the audit trail. Viewing never triggers enrichment.

Communication treatment is persisted as an explainable policy snapshot. V1 displays permitted treatment and recommended next action only; there is no delivery provider, send action, Event Suite integration, backfill, or autonomous communication path.
