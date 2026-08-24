-- Native operator prospect queue keyset pagination.
-- This forward-only migration runs after 20260823000001_operator_prospect_performance_v1.sql.
-- It does not alter existing approval or RLS policies. The function is SECURITY INVOKER
-- so the caller's existing active-member policies remain authoritative.

create index if not exists ai_prospect_candidates_territory_updated_id_idx
  on public.ai_prospect_candidates(territory_code, updated_at desc, id desc);
create index if not exists ai_prospect_candidates_origin_updated_id_idx
  on public.ai_prospect_candidates(origin, updated_at desc, id desc);
create index if not exists ai_prospect_candidates_priority_updated_id_idx
  on public.ai_prospect_candidates((upper(coalesce(prospect_intelligence ->> 'commercialPriority', prospect_intelligence ->> 'priority', 'STANDARD'))), updated_at desc, id desc);
create index if not exists contacts_account_id_idx
  on public.contacts(account_id, id);

create or replace function public.list_ai_prospect_queue(
  p_queue text default 'NEEDS_REVIEW',
  p_search text default '',
  p_territory text default 'ALL',
  p_prospect_type text default 'ALL',
  p_review_state text default 'ALL',
  p_contact_state text default 'ALL',
  p_email_state text default 'ALL',
  p_priority text default 'ALL',
  p_sort text default 'attention',
  p_page integer default 1,
  p_page_size integer default 25,
  p_cursor jsonb default null,
  p_direction text default 'next'
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog
as $function$
declare
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_page_size integer := greatest(1, least(coalesce(p_page_size, 25), 100));
  v_direction text := case when lower(coalesce(p_direction, 'next')) = 'previous' then 'previous' else 'next' end;
begin
  return (
    with latest_run as (
      select id
      from public.ai_prospect_discovery_runs
      order by created_at desc, id desc
      limit 1
    ),
    candidate_context as (
      select
        c.id,
        c.discovery_run_id,
        c.canonical_key,
        c.candidate_name,
        c.organiser_name,
        c.website,
        c.territory_code,
        c.origin,
        c.status,
        c.account_id,
        c.relationship,
        c.dedupe_of_candidate_id,
        c.first_seen_at,
        c.last_seen_at,
        c.created_at,
        c.updated_at,
        c.contact_research,
        c.prospect_intelligence,
        a.name as account_name,
        a.website as account_website,
        jsonb_build_object('outreachComposer', coalesce(a.metadata -> 'outreachComposer', '{}'::jsonb)) as account_metadata,
        coalesce(contact_summary.contact_rows, '[]'::jsonb) as contact_rows,
        coalesce(contact_summary.contact_count, 0)::integer as contact_count,
        coalesce(contact_summary.has_verified_email, false) as has_verified_email,
        upper(coalesce(c.prospect_intelligence ->> 'commercialPriority', c.prospect_intelligence ->> 'priority', 'STANDARD')) as priority_key,
        coalesce(c.prospect_intelligence ->> 'recommendedNextAction', c.prospect_intelligence -> 'nextBestCommercialAction' ->> 'type', c.prospect_intelligence ->> 'outreachBlockOrReviewReason', '') as review_action,
        upper(coalesce(c.prospect_intelligence ->> 'contextLabel', c.prospect_intelligence ->> 'recencyLabel', '')) as explicit_context,
        coalesce(a.metadata -> 'outreachComposer' ->> 'state', '') as composer_state,
        lower(coalesce(a.metadata -> 'outreachComposer' ->> 'approved', 'false')) = 'true' as composer_approved,
        lower(coalesce(a.metadata -> 'outreachComposer' ->> 'pending', 'false')) = 'true' as composer_pending,
        case
          when upper(coalesce(c.prospect_intelligence ->> 'contextLabel', c.prospect_intelligence ->> 'recencyLabel', '')) in ('CALIBRATION', 'LEGACY') then upper(coalesce(c.prospect_intelligence ->> 'contextLabel', c.prospect_intelligence ->> 'recencyLabel'))
          when c.discovery_run_id = (select id from latest_run) then 'NEW'
          when coalesce(c.last_seen_at, c.created_at) >= now() - interval '30 days' then 'CURRENT'
          else 'HISTORICAL'
        end as context_label
      from public.ai_prospect_candidates c
      left join public.accounts a on a.id = c.account_id
      left join lateral (
        select
          jsonb_agg(jsonb_build_object(
            'id', ct.id,
            'account_id', ct.account_id,
            'name', ct.name,
            'full_name', ct.full_name,
            'title', ct.title,
            'role_title', ct.role_title,
            'verification_status', ct.verification_status
          ) order by coalesce(ct.full_name, ct.name, ''), ct.id) as contact_rows,
          count(*)::integer as contact_count,
          bool_or(upper(coalesce(ct.verification_status, '')) in ('VERIFIED', 'VALID')) as has_verified_email
        from public.contacts ct
        where ct.account_id = c.account_id
      ) contact_summary on true
    ),
    candidate_state as (
      select
        context.*,
        case
          when status = 'DUPLICATE' or dedupe_of_candidate_id is not null then 'Already tracked'
          when status in ('REJECTED', 'BLOCKED') then 'Excluded'
          when priority_key in ('ENTERPRISE_DEFERRED', 'DEFERRED') then 'Deferred'
          when composer_approved or composer_state = 'HUMAN_APPROVED_DRAFT' then 'Draft approved — not sent'
          when composer_pending or composer_state = 'PENDING_HUMAN_APPROVAL' then 'Draft awaiting approval'
          when status = 'REVIEW_REQUIRED' and nullif(review_action, '') is not null and review_action !~* '(more research|continue.*research|research required|needs validation)' then 'Needs identity review'
          else 'Ready for person review'
        end as workflow_state,
        (status in ('REJECTED', 'BLOCKED', 'DUPLICATE') or dedupe_of_candidate_id is not null or context_label in ('HISTORICAL', 'CALIBRATION', 'LEGACY')) as is_archive
      from candidate_context context
    ),
    ranked as (
      select
        state.*,
        case
          when p_sort = 'name' then lower(coalesce(organiser_name, account_name, candidate_name, ''))
          when p_sort = 'recent' then to_char(coalesce(last_seen_at, updated_at, created_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          else lower(workflow_state)
        end as sort_value,
        case when p_sort in ('name', 'ready') then false else true end as sort_desc,
        jsonb_strip_nulls(jsonb_build_object(
          'id', id,
          'discovery_run_id', discovery_run_id,
          'canonical_key', canonical_key,
          'candidate_name', candidate_name,
          'organiser_name', organiser_name,
          'website', website,
          'territory_code', territory_code,
          'origin', origin,
          'status', status,
          'account_id', account_id,
          'relationship', relationship,
          'dedupe_of_candidate_id', dedupe_of_candidate_id,
          'first_seen_at', first_seen_at,
          'last_seen_at', last_seen_at,
          'created_at', created_at,
          'contact_research', jsonb_build_object('status', contact_research ->> 'status'),
          'prospect_intelligence', jsonb_strip_nulls(jsonb_build_object(
            'organisationResolution', prospect_intelligence -> 'organisationResolution',
            'primaryEntryOpportunity', prospect_intelligence -> 'primaryEntryOpportunity',
            'commercialPriority', prospect_intelligence -> 'commercialPriority',
            'priority', prospect_intelligence -> 'priority',
            'recommendedNextAction', prospect_intelligence -> 'recommendedNextAction',
            'nextBestCommercialAction', prospect_intelligence -> 'nextBestCommercialAction',
            'outreachBlockOrReviewReason', prospect_intelligence -> 'outreachBlockOrReviewReason',
            'siteClassifications', prospect_intelligence -> 'siteClassifications',
            'eventConnection', prospect_intelligence -> 'eventConnection',
            'commercialEvidence', prospect_intelligence -> 'commercialEvidence'
          )),
          'account', case when account_id is null then null else jsonb_build_object('id', account_id, 'name', account_name, 'website', account_website, 'metadata', account_metadata) end,
          'contacts', contact_rows
        )) as candidate_json
      from candidate_state state
    ),
    filtered as (
      select *
      from ranked
      where
        (
          p_queue = 'ALL'
          or (p_queue = 'ARCHIVE' and is_archive)
          or (not is_archive and p_queue = 'NEEDS_REVIEW' and workflow_state in ('Needs identity review', 'Contact needs review', 'Draft awaiting approval'))
          or (not is_archive and p_queue = 'READY_PEOPLE' and workflow_state = 'Ready for person review')
          or (not is_archive and p_queue = 'DRAFTS' and workflow_state = 'Draft awaiting approval')
          or (not is_archive and p_queue = 'APPROVED' and workflow_state = 'Draft approved — not sent')
          or (not is_archive and p_queue = 'DEFERRED' and workflow_state = 'Deferred')
        )
        and (nullif(trim(coalesce(p_search, '')), '') is null or position(lower(trim(p_search)) in lower(concat_ws(' ', organiser_name, account_name, candidate_name, website))) > 0)
        and (coalesce(p_territory, 'ALL') = 'ALL' or territory_code = p_territory)
        and (coalesce(p_prospect_type, 'ALL') = 'ALL' or case origin when 'EVENT_FIRST' then 'Event' when 'ORGANISATION_FIRST' then 'Organisation' when 'PERSON_FIRST' then 'Person' when 'VENUE_FIRST' then 'Venue' else origin end = p_prospect_type)
        and (coalesce(p_review_state, 'ALL') = 'ALL' or workflow_state = p_review_state)
        and (coalesce(p_contact_state, 'ALL') = 'ALL' or (p_contact_state = 'PERSON' and contact_count > 0) or (p_contact_state = 'NONE' and contact_count = 0))
        and (coalesce(p_email_state, 'ALL') = 'ALL' or (p_email_state = 'VERIFIED' and has_verified_email) or (p_email_state = 'REVIEW' and not has_verified_email))
        and (coalesce(p_priority, 'ALL') = 'ALL' or case priority_key when 'PHASE_ONE_PRIORITY' then 'Phase One priority' when 'HIGH' then 'Phase One priority' when 'ENTERPRISE_DEFERRED' then 'Deferred' when 'DEFERRED' then 'Deferred' else 'Standard priority' end = p_priority)
    ),
    filtered_count as (
      select count(*)::integer as total
      from filtered
    ),
    queue_counts as (
      select jsonb_build_object(
        'NEEDS_REVIEW', count(*) filter (where not is_archive and workflow_state in ('Needs identity review', 'Contact needs review', 'Draft awaiting approval')),
        'READY_PEOPLE', count(*) filter (where not is_archive and workflow_state = 'Ready for person review'),
        'DRAFTS', count(*) filter (where not is_archive and workflow_state = 'Draft awaiting approval'),
        'APPROVED', count(*) filter (where not is_archive and workflow_state = 'Draft approved — not sent'),
        'DEFERRED', count(*) filter (where not is_archive and workflow_state = 'Deferred'),
        'ARCHIVE', count(*) filter (where is_archive),
        'ALL', count(*)
      ) as counts
      from ranked
    ),
    cursor_values as (
      select
        p_cursor ->> 'sort_value' as cursor_sort_value,
        nullif(p_cursor ->> 'updated_at', '')::timestamptz as cursor_updated_at,
        nullif(p_cursor ->> 'id', '')::uuid as cursor_id
    ),
    ordered_page as (
      select page_source.*
      from filtered page_source
      cross join cursor_values cursor_position
      where
        p_cursor is null
        or (
          (v_direction = 'next' and ((not sort_desc and (sort_value, updated_at, id) > (cursor_sort_value, cursor_updated_at, cursor_id)) or (sort_desc and (sort_value, updated_at, id) < (cursor_sort_value, cursor_updated_at, cursor_id))))
          or (v_direction = 'previous' and ((not sort_desc and (sort_value, updated_at, id) < (cursor_sort_value, cursor_updated_at, cursor_id)) or (sort_desc and (sort_value, updated_at, id) > (cursor_sort_value, cursor_updated_at, cursor_id))))
        )
      order by
        case when ((sort_desc and v_direction = 'next') or (not sort_desc and v_direction = 'previous')) then sort_value end desc,
        case when not ((sort_desc and v_direction = 'next') or (not sort_desc and v_direction = 'previous')) then sort_value end asc,
        case when ((sort_desc and v_direction = 'next') or (not sort_desc and v_direction = 'previous')) then updated_at end desc,
        case when not ((sort_desc and v_direction = 'next') or (not sort_desc and v_direction = 'previous')) then updated_at end asc,
        case when ((sort_desc and v_direction = 'next') or (not sort_desc and v_direction = 'previous')) then id end desc,
        case when not ((sort_desc and v_direction = 'next') or (not sort_desc and v_direction = 'previous')) then id end asc
      limit v_page_size + 1
    ),
    page_rows as (
      select page_source.*
      from ordered_page page_source
      order by
        case when sort_desc then sort_value end desc,
        case when not sort_desc then sort_value end asc,
        case when sort_desc then updated_at end desc,
        case when not sort_desc then updated_at end asc,
        case when sort_desc then id end desc,
        case when not sort_desc then id end asc
      limit v_page_size
    ),
    page_total as (
      select count(*)::integer as returned
      from page_rows
    )
    select jsonb_build_object(
      'candidates', coalesce((select jsonb_agg(candidate_json order by case when sort_desc then sort_value end desc, case when not sort_desc then sort_value end asc, case when sort_desc then updated_at end desc, case when not sort_desc then updated_at end asc, case when sort_desc then id end desc, case when not sort_desc then id end asc) from page_rows), '[]'::jsonb),
      'total', (select total from filtered_count),
      'page', v_page,
      'pageSize', v_page_size,
      'pageCount', greatest(1, ceil((select total from filtered_count)::numeric / v_page_size)::integer),
      'queueCounts', (select counts from queue_counts),
      'hasNext', v_page < greatest(1, ceil((select total from filtered_count)::numeric / v_page_size)::integer),
      'hasPrevious', v_page > 1,
      'firstPosition', (select jsonb_build_object('sort_value', sort_value, 'updated_at', updated_at, 'id', id) from page_rows order by case when sort_desc then sort_value end desc, case when not sort_desc then sort_value end asc, case when sort_desc then updated_at end desc, case when not sort_desc then updated_at end asc, case when sort_desc then id end desc, case when not sort_desc then id end asc limit 1),
      'lastPosition', (select jsonb_build_object('sort_value', sort_value, 'updated_at', updated_at, 'id', id) from page_rows order by case when sort_desc then sort_value end desc, case when not sort_desc then sort_value end asc, case when sort_desc then updated_at end desc, case when not sort_desc then updated_at end asc, case when sort_desc then id end desc, case when not sort_desc then id end asc offset greatest(v_page_size - 1, 0) limit 1),
      'returned', (select returned from page_total)
    )
  );
end;
$function$;

revoke all on function public.list_ai_prospect_queue(text, text, text, text, text, text, text, text, text, integer, integer, jsonb, text) from public, anon;
grant execute on function public.list_ai_prospect_queue(text, text, text, text, text, text, text, text, text, integer, integer, jsonb, text) to authenticated;
