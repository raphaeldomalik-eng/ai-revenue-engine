-- Canonical prospect inventory paging stays in Postgres so growing discovery
-- history never turns browser filters into an unbounded client-side operation.
create or replace function public.list_ai_prospect_inventory(
  p_saved text default 'NEEDS_REVIEW',
  p_search text default '',
  p_status text default 'ALL',
  p_lane text default 'ALL',
  p_run uuid default null,
  p_quality text default 'ALL',
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language sql
security invoker
set search_path = public, pg_catalog
as $$
with ranked as (
  select c.*, row_number() over (partition by c.canonical_key order by c.last_seen_at desc, c.created_at desc, c.id desc) as canonical_rank
  from public.ai_prospect_candidates c
), canonical as (
  select
    c.*,
    coalesce(contact_data.contacts, '[]'::jsonb) as contacts_json,
    coalesce(contact_data.is_contactable, false) as is_contactable,
    coalesce(appearance_data.appearance_count, 1) as appearance_count,
    coalesce(appearance_data.run_appearances, '[]'::jsonb) as run_appearances,
    account_data.account_json,
    case
      when c.status = 'DUPLICATE' or c.dedupe_of_candidate_id is not null then 'DUPLICATES'
      when c.status = 'BLOCKED' then 'BLOCKED'
      when c.status = 'REJECTED' then 'REJECTED'
      when c.status = 'QUALIFIED' then 'QUALIFIED'
      when c.status = 'REVIEW_REQUIRED' then 'NEEDS_REVIEW'
      else 'ACTIVE'
    end as inventory_state,
    case
      when jsonb_typeof(c.source_urls) <> 'array' or jsonb_array_length(c.source_urls) = 0 then 'MISSING_SOURCE'
      when jsonb_typeof(c.facts) <> 'array' or jsonb_array_length(c.facts) = 0 then 'NEEDS_EVIDENCE'
      when (jsonb_typeof(c.unknowns) = 'array' and jsonb_array_length(c.unknowns) > 0)
        or upper(coalesce(c.prospect_intelligence #>> '{organisationResolution,status}', '')) = 'UNRESOLVED' then 'UNRESOLVED'
      else 'READY'
    end as inventory_quality
  from ranked c
  left join lateral (
    select jsonb_build_object('id', a.id, 'name', a.name, 'website', a.website) as account_json
    from public.accounts a where a.id = c.account_id
  ) account_data on true
  left join lateral (
    select jsonb_agg(to_jsonb(ct)) as contacts,
      bool_or(upper(coalesce(ct.verification_status, '')) in ('VERIFIED', 'VALID')) as is_contactable
    from public.contacts ct where ct.account_id = c.account_id
  ) contact_data on true
  left join lateral (
    select count(*)::integer as appearance_count,
      jsonb_agg(jsonb_build_object(
        'id', a.id, 'discovery_run_id', a.discovery_run_id, 'status', a.status,
        'created_at', a.created_at, 'territory_code', a.territory_code, 'origin', a.origin,
        'reason', coalesce(a.prospect_intelligence #>> '{runResult,dispositionReason}', a.prospect_intelligence ->> 'outreachBlockOrReviewReason', 'Not recorded')
      ) order by a.last_seen_at desc, a.created_at desc, a.id desc) as run_appearances
    from public.ai_prospect_candidates a where a.canonical_key = c.canonical_key
  ) appearance_data on true
  where c.canonical_rank = 1
), filtered as (
  select * from canonical c
  where (p_saved = 'ALL'
      or (p_saved = 'CONTACTABLE' and c.is_contactable)
      or (p_saved = 'HISTORICAL' and c.last_seen_at < now() - interval '30 days')
      or (p_saved not in ('ALL', 'CONTACTABLE', 'HISTORICAL') and c.inventory_state = p_saved))
    and (p_status = 'ALL' or c.status = p_status)
    and (p_lane = 'ALL' or c.origin = p_lane)
    and (p_run is null or exists (select 1 from public.ai_prospect_candidates a where a.canonical_key = c.canonical_key and a.discovery_run_id = p_run))
    and (p_quality = 'ALL' or c.inventory_quality = p_quality)
    and (nullif(trim(p_search), '') is null or concat_ws(' ', c.candidate_name, c.organiser_name, c.website, c.canonical_key, c.account_json ->> 'name') ilike '%' || trim(p_search) || '%')
), page_data as (
  select * from filtered order by last_seen_at desc, created_at desc, id desc
  offset greatest(0, p_page - 1) * greatest(10, least(100, p_page_size))
  limit greatest(10, least(100, p_page_size))
), counts as (
  select jsonb_build_object(
    'ALL', count(*),
    'NEEDS_REVIEW', count(*) filter (where inventory_state = 'NEEDS_REVIEW'),
    'QUALIFIED', count(*) filter (where inventory_state = 'QUALIFIED'),
    'CONTACTABLE', count(*) filter (where is_contactable),
    'ACTIVE', count(*) filter (where inventory_state = 'ACTIVE'),
    'REJECTED', count(*) filter (where inventory_state = 'REJECTED'),
    'BLOCKED', count(*) filter (where inventory_state = 'BLOCKED'),
    'DUPLICATES', count(*) filter (where inventory_state = 'DUPLICATES'),
    'HISTORICAL', count(*) filter (where last_seen_at < now() - interval '30 days')
  ) as value from canonical
), total_data as (select count(*)::integer as total from filtered)
select jsonb_build_object(
  'total', total_data.total,
  'page', least(greatest(1, p_page), greatest(1, ceil(total_data.total::numeric / greatest(10, least(100, p_page_size)))::integer)),
  'pageCount', greatest(1, ceil(total_data.total::numeric / greatest(10, least(100, p_page_size)))::integer),
  'inventoryCounts', counts.value,
  'candidates', coalesce((select jsonb_agg((to_jsonb(page_data) - 'canonical_rank' - 'contacts_json' - 'is_contactable' - 'account_json' - 'inventory_state' - 'inventory_quality') || jsonb_build_object('account', page_data.account_json, 'contacts', page_data.contacts_json, 'appearance_count', page_data.appearance_count, 'run_appearances', page_data.run_appearances) order by page_data.last_seen_at desc, page_data.created_at desc, page_data.id desc) from page_data), '[]'::jsonb)
) from total_data cross join counts;
$$;

revoke all on function public.list_ai_prospect_inventory(text, text, text, text, uuid, text, integer, integer) from public, anon;
grant execute on function public.list_ai_prospect_inventory(text, text, text, text, uuid, text, integer, integer) to authenticated;
