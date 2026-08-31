-- Operator Workspace V1 read models.
-- These functions keep Overview and Runs on bounded, server-side projections so
-- inbound activities, canonical prospects, and research appearances cannot be
-- mistaken for one another in the UI.

create or replace function public.list_ai_prospect_run_history(
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
with bounded as (
  select greatest(1, least(coalesce(p_limit, 50), 100)) as page_size,
         greatest(0, coalesce(p_offset, 0)) as page_offset
),
canonical_current as (
  select distinct on (c.canonical_key)
    c.canonical_key,
    c.status,
    c.account_id,
    c.contact_research
  from public.ai_prospect_candidates c
  order by c.canonical_key,
    c.last_seen_at desc nulls last,
    c.updated_at desc nulls last,
    c.created_at desc nulls last,
    c.id desc
),
appearances as (
  select
    c.discovery_run_id as run_id,
    count(*)::integer as appearance_count,
    count(distinct c.canonical_key) filter (
      where not exists (
        select 1
        from public.ai_prospect_candidates prior
        where prior.canonical_key = c.canonical_key
          and (prior.created_at < c.created_at or (prior.created_at = c.created_at and prior.id < c.id))
      )
    )::integer as introduction_count
  from public.ai_prospect_candidates c
  group by c.discovery_run_id
),
current_dispositions as (
  select
    rc.run_id,
    count(*) filter (where cc.status = 'REVIEW_REQUIRED')::integer as review_count,
    count(*) filter (where cc.status = 'QUALIFIED')::integer as qualified_count,
    count(*) filter (where cc.status = 'REJECTED')::integer as rejected_count,
    count(*) filter (where cc.status = 'BLOCKED')::integer as blocked_count,
    count(*) filter (where cc.status = 'DUPLICATE')::integer as duplicate_count,
    count(*) filter (
      where exists (
        select 1
        from public.contacts ct
        where ct.account_id = cc.account_id
          and upper(coalesce(ct.verification_status, '')) in ('VERIFIED', 'VALID')
      )
      or upper(coalesce(cc.contact_research->>'status', '')) in ('VERIFIED', 'VALID', 'CONTACTABLE')
    )::integer as contactable_count
  from (
    select distinct discovery_run_id as run_id, canonical_key
    from public.ai_prospect_candidates
  ) rc
  join canonical_current cc on cc.canonical_key = rc.canonical_key
  group by rc.run_id
),
run_rows as (
  select
    r.id,
    r.territory_code,
    r.focus,
    r.status,
    r.budget,
    r.summary,
    r.provider,
    r.model,
    r.error_message,
    r.started_at,
    r.completed_at,
    r.created_at,
    coalesce(a.appearance_count, 0) as appearance_count,
    coalesce(a.introduction_count, 0) as introduction_count,
    coalesce(d.review_count, 0) as review_count,
    coalesce(d.qualified_count, 0) as qualified_count,
    coalesce(d.rejected_count, 0) as rejected_count,
    coalesce(d.blocked_count, 0) as blocked_count,
    coalesce(d.duplicate_count, 0) as duplicate_count,
    coalesce(d.contactable_count, 0) as contactable_count,
    extract(epoch from (r.completed_at - r.started_at))::integer as duration_seconds,
    coalesce(r.budget->>'maxCandidates', r.budget->>'max_candidates', r.summary->>'maxCandidates', r.summary->>'max_candidates') as requested,
    coalesce(r.summary->>'cost', r.budget->>'cost') as cost
  from public.ai_prospect_discovery_runs r
  left join appearances a on a.run_id = r.id
  left join current_dispositions d on d.run_id = r.id
),
summary as (
  select
    count(*)::integer as total_runs,
    count(*) filter (where upper(status) = 'COMPLETED')::integer as completed_runs,
    count(*) filter (where upper(status) in ('RUNNING', 'STARTED', 'PARTIAL'))::integer as active_or_partial_runs,
    count(*) filter (where upper(status) in ('FAILED', 'ERROR'))::integer as failed_runs,
    coalesce(sum(appearance_count), 0)::integer as appearances,
    coalesce(sum(introduction_count), 0)::integer as introductions
  from run_rows
)
select jsonb_build_object(
  'total', s.total_runs,
  'page', floor(b.page_offset / b.page_size)::integer + 1,
  'pageSize', b.page_size,
  'pageCount', greatest(1, ceil(s.total_runs::numeric / b.page_size)::integer),
  'summary', jsonb_build_object(
    'totalRuns', s.total_runs,
    'completedRuns', s.completed_runs,
    'activeOrPartialRuns', s.active_or_partial_runs,
    'failedRuns', s.failed_runs,
    'appearances', s.appearances,
    'introductions', s.introductions
  ),
  'runs', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', rr.id,
      'territoryCode', rr.territory_code,
      'focus', rr.focus,
      'status', rr.status,
      'startedAt', rr.started_at,
      'completedAt', rr.completed_at,
      'createdAt', rr.created_at,
      'requested', rr.requested,
      'appearances', rr.appearance_count,
      'introductions', rr.introduction_count,
      'durationSeconds', rr.duration_seconds,
      'cost', rr.cost,
      'currentDispositions', jsonb_build_object(
        'review', rr.review_count,
        'qualified', rr.qualified_count,
        'rejected', rr.rejected_count,
        'blocked', rr.blocked_count,
        'duplicates', rr.duplicate_count,
        'contactable', rr.contactable_count
      ),
      'errorMessage', rr.error_message
    ) order by rr.created_at desc nulls last, rr.id desc)
    from (select * from run_rows order by created_at desc nulls last, id desc limit b.page_size offset b.page_offset) rr
  ), '[]'::jsonb)
)
from summary s cross join bounded b;
$$;

create or replace function public.operator_workspace_overview()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
with lead_metrics as (
  select
    count(*) filter (where not coalesce(l.is_test, false) and upper(coalesce(l.lead_classification, '')) = 'NEEDS_REVIEW')::integer as needs_review,
    count(*) filter (where not coalesce(l.is_test, false) and upper(coalesce(l.lead_classification, '')) = 'GENUINE_PROSPECT')::integer as active_genuine,
    count(*) filter (where not coalesce(l.is_test, false)
      and upper(coalesce(l.lead_classification, '')) in ('NEEDS_REVIEW', 'GENUINE_PROSPECT')
      and upper(coalesce(l.current_intent, '')) in ('HIGH', 'VERY_HIGH')
      and upper(coalesce(l.stage, '')) not in ('CONVERTED', 'CLOSED', 'EXCLUDED'))::integer as high_intent,
    count(*) filter (where not coalesce(l.is_test, false) and l.follow_up_at is not null and l.follow_up_at <= now()
      and upper(coalesce(l.stage, '')) not in ('CONVERTED', 'CLOSED', 'EXCLUDED'))::integer as follow_up_due,
    count(*) filter (where not coalesce(l.is_test, false) and upper(coalesce(l.lead_classification, '')) = 'EXISTING_CUSTOMER')::integer as existing_customer_activity,
    count(*) filter (where not coalesce(l.is_test, false))::integer as canonical_leads
  from public.incoming_leads l
),
source_metrics as (
  select count(*) filter (where not coalesce(is_test, false))::integer as source_activities
  from public.incoming_submissions
),
inventory_value as (
  select public.list_ai_prospect_inventory('ALL', '', 'ALL', 'ALL', null, 'ALL', 1, 1) as value
),
research_metrics as (
  select
    count(*)::integer as total_runs,
    count(*) filter (where upper(status) = 'COMPLETED')::integer as completed_runs,
    count(*) filter (where upper(status) in ('FAILED', 'ERROR'))::integer as failed_runs,
    count(*) filter (where upper(status) in ('RUNNING', 'STARTED', 'PARTIAL'))::integer as active_or_partial_runs,
    count(*) filter (where upper(status) in ('FAILED', 'ERROR') and created_at >= current_date)::integer as failed_today
  from public.ai_prospect_discovery_runs
),
latest_run as (
  select r.*
  from public.ai_prospect_discovery_runs r
  order by r.created_at desc nulls last, r.id desc
  limit 1
),
latest_run_value as (
  select jsonb_build_object(
    'id', r.id,
    'territoryCode', r.territory_code,
    'focus', r.focus,
    'status', r.status,
    'startedAt', r.started_at,
    'completedAt', r.completed_at,
    'createdAt', r.created_at,
    'found', coalesce(nullif(r.summary->>'discovered', '')::integer, nullif(r.summary->>'found', '')::integer,
      (select count(*)::integer from public.ai_prospect_candidates c where c.discovery_run_id = r.id), 0)
  ) as value
  from latest_run r
),
attention_items as (
  select 1 as priority, jsonb_build_object(
    'id', l.id,
    'kind', 'INBOUND_HIGH_INTENT',
    'title', coalesce(nullif(l.display_name, ''), nullif(l.organisation_name, ''), 'Unnamed inbound activity'),
    'detail', upper(coalesce(l.highest_intent_source_category, l.latest_source_category, 'HIGH-INTENT INBOUND')) || ' · ' || coalesce(l.organisation_name, 'Organisation not recorded'),
    'href', '/operator/incoming-leads?view=high-intent',
    'createdAt', coalesce(l.last_activity_at, l.created_at)
  ) as item
  from public.incoming_leads l
  where not coalesce(l.is_test, false)
    and upper(coalesce(l.lead_classification, '')) in ('NEEDS_REVIEW', 'GENUINE_PROSPECT')
    and upper(coalesce(l.current_intent, '')) in ('HIGH', 'VERY_HIGH')
    and upper(coalesce(l.stage, '')) not in ('CONVERTED', 'CLOSED', 'EXCLUDED')
  order by l.priority_rank desc nulls last, l.last_activity_at desc nulls last
  limit 3
),
follow_up_items as (
  select 2 as priority, jsonb_build_object(
    'id', l.id,
    'kind', 'INBOUND_FOLLOW_UP',
    'title', coalesce(nullif(l.display_name, ''), nullif(l.organisation_name, ''), 'Inbound follow-up'),
    'detail', 'Follow-up due · ' || coalesce(l.next_action, 'Next action not recorded'),
    'href', '/operator/incoming-leads?view=follow-up-due',
    'createdAt', l.follow_up_at
  ) as item
  from public.incoming_leads l
  where not coalesce(l.is_test, false) and l.follow_up_at is not null and l.follow_up_at <= now()
    and upper(coalesce(l.stage, '')) not in ('CONVERTED', 'CLOSED', 'EXCLUDED')
  order by l.follow_up_at asc
  limit 2
),
identity_items as (
  select 3 as priority, jsonb_build_object(
    'id', c.id,
    'kind', 'PROSPECT_IDENTITY',
    'title', coalesce(nullif(c.candidate_name, ''), 'Organisation identity not resolved'),
    'detail', 'Identity decision required · ' || upper(replace(coalesce(c.origin, 'UNKNOWN'), '_', ' ')),
    'href', '/operator/prospects?queue=NEEDS_REVIEW',
    'createdAt', c.updated_at
  ) as item
  from (
    select distinct on (canonical_key) *
    from public.ai_prospect_candidates
    where status = 'REVIEW_REQUIRED'
    order by canonical_key, updated_at desc nulls last, created_at desc nulls last, id desc
  ) c
  order by c.updated_at desc nulls last
  limit 3
),
run_items as (
  select 4 as priority, jsonb_build_object(
    'id', r.id,
    'kind', 'RESEARCH_OPERATIONS',
    'title', 'Research run ' || upper(r.status),
    'detail', coalesce(r.error_message, 'Run requires operational review'),
    'href', '/operator/runs/' || r.id,
    'createdAt', coalesce(r.completed_at, r.created_at)
  ) as item
  from public.ai_prospect_discovery_runs r
  where upper(r.status) in ('FAILED', 'ERROR', 'PARTIAL', 'RUNNING', 'STARTED')
  order by r.created_at desc nulls last
  limit 2
),
attention as (
  select coalesce(jsonb_agg(item order by priority, (item->>'createdAt') desc nulls last), '[]'::jsonb) as value
  from (
    select * from attention_items
    union all select * from follow_up_items
    union all select * from identity_items
    union all select * from run_items
  ) all_items
),
recent_changes as (
  select coalesce(jsonb_agg(item order by happened_at desc nulls last), '[]'::jsonb) as value
  from (
    select * from (
      select s.created_at as happened_at, jsonb_build_object(
      'id', s.id, 'kind', 'INBOUND_ACTIVITY',
      'title', coalesce(nullif(s.source_category, ''), 'Inbound activity') || ' received',
      'detail', coalesce(s.organisation_name, 'Organisation not recorded'),
      'href', '/operator/incoming-leads?view=all', 'createdAt', s.created_at
      ) as item
      from public.incoming_submissions s
      where not coalesce(s.is_test, false)
      union all
      select r.created_at, jsonb_build_object(
      'id', r.id, 'kind', 'RESEARCH_RUN',
      'title', 'Research run ' || lower(r.status),
      'detail', coalesce(r.territory_code, 'Territory not recorded') || ' · ' || coalesce(r.focus, 'All lenses'),
      'href', '/operator/runs/' || r.id, 'createdAt', r.created_at
      )
      from public.ai_prospect_discovery_runs r
      union all
      select d.created_at, jsonb_build_object(
      'id', d.id, 'kind', 'PROSPECT_DECISION',
      'title', 'Prospect decision recorded',
      'detail', upper(coalesce(d.decision, 'REVIEW')),
      'href', '/operator/prospects?queue=NEEDS_REVIEW', 'createdAt', d.created_at
      )
      from public.ai_prospect_review_decisions d
    ) changes
    order by happened_at desc nulls last
    limit 8
  ) changes
),
inbound as (
  select jsonb_build_object(
    'needsReview', lm.needs_review,
    'activeGenuine', lm.active_genuine,
    'highIntent', lm.high_intent,
    'followUpDue', lm.follow_up_due,
    'existingCustomerActivity', lm.existing_customer_activity,
    'canonicalLeads', lm.canonical_leads,
    'sourceActivities', sm.source_activities
  ) as value
  from lead_metrics lm cross join source_metrics sm
),
prospects as (
  select jsonb_build_object(
    'canonical', (iv.value->>'total')::integer,
    'identityDecisions', coalesce((iv.value->'inventoryCounts'->>'NEEDS_REVIEW')::integer, 0),
    'qualificationDecisions', 0,
    'contactDecisions', coalesce((iv.value->'inventoryCounts'->>'CONTACTABLE')::integer, 0),
    'qualified', coalesce((iv.value->'inventoryCounts'->>'QUALIFIED')::integer, 0),
    'contactable', coalesce((iv.value->'inventoryCounts'->>'CONTACTABLE')::integer, 0),
    'draftApproved', (select count(*)::integer from public.ai_prospect_approval_reviews where decision = 'APPROVED'),
    'archived', coalesce((iv.value->'inventoryCounts'->>'REJECTED')::integer, 0)
      + coalesce((iv.value->'inventoryCounts'->>'BLOCKED')::integer, 0)
      + coalesce((iv.value->'inventoryCounts'->>'DUPLICATES')::integer, 0)
  ) as value
  from inventory_value iv
),
research as (
  select jsonb_build_object(
    'totalRuns', rm.total_runs,
    'completedRuns', rm.completed_runs,
    'failedRuns', rm.failed_runs,
    'activeOrPartialRuns', rm.active_or_partial_runs,
    'failedToday', rm.failed_today,
    'stale', case when lrv.value is null then true else coalesce((lrv.value->>'completedAt')::timestamptz < now() - interval '24 hours', true) end,
    'latestRun', coalesce(lrv.value, '{}'::jsonb)
  ) as value
  from research_metrics rm left join lateral (select value from latest_run_value) lrv on true
),
action as (
  select jsonb_build_object(
    'kind', case when lm.high_intent > 0 then 'INBOUND_HIGH_INTENT' when lm.follow_up_due > 0 then 'INBOUND_FOLLOW_UP' else 'PROSPECT_IDENTITY' end,
    'title', case
      when lm.high_intent > 0 then 'Review the ' || lm.high_intent || ' high-intent inbound activit' || case when lm.high_intent = 1 then 'y' else 'ies' end
      when lm.follow_up_due > 0 then 'Work the ' || lm.follow_up_due || ' overdue inbound follow-up' || case when lm.follow_up_due = 1 then '' else 's' end
      else 'Resolve the highest-priority prospect identity decisions'
    end,
    'detail', case
      when lm.high_intent > 0 then 'Demo and talk-to-sales signals are the fastest path to a real commercial decision.'
      when lm.follow_up_due > 0 then 'These inbound records already have a next action due.'
      else 'Canonical outbound prospects are held until their identity is clear.'
    end,
    'href', case when lm.high_intent > 0 or lm.follow_up_due > 0 then '/operator/incoming-leads' else '/operator/prospects?queue=NEEDS_REVIEW' end,
    'count', case when lm.high_intent > 0 then lm.high_intent when lm.follow_up_due > 0 then lm.follow_up_due else (p.value->>'identityDecisions')::integer end
  ) as value
  from lead_metrics lm cross join prospects p
)
select jsonb_build_object(
  'refreshedAt', now(),
  'highestValueAction', a.value,
  'inbound', i.value,
  'prospects', p.value,
  'research', r.value,
  'attention', at.value,
  'recentChanges', rc.value
)
from action a cross join inbound i cross join prospects p cross join research r cross join attention at cross join recent_changes rc;
$$;

comment on function public.list_ai_prospect_run_history(integer, integer) is 'Bounded server-side run history read model for the Operator Workspace.';
comment on function public.operator_workspace_overview() is 'Server-side command-centre read model separating inbound, canonical prospect, and research health.';

revoke all on function public.list_ai_prospect_run_history(integer, integer) from public, anon;
grant execute on function public.list_ai_prospect_run_history(integer, integer) to authenticated;
revoke all on function public.operator_workspace_overview() from public, anon;
grant execute on function public.operator_workspace_overview() to authenticated;
