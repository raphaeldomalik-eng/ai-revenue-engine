-- Incoming Leads operator workspace: deliberate classification, exclusion and
-- database-side queue retrieval. Source submissions remain immutable.

alter table public.incoming_leads
  add column if not exists lead_classification text not null default 'NEEDS_REVIEW',
  add column if not exists classification_reason text,
  add column if not exists classified_at timestamptz,
  add column if not exists classified_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists excluded_at timestamptz,
  add column if not exists excluded_by uuid references auth.users(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'incoming_leads_classification_check') then
    alter table public.incoming_leads add constraint incoming_leads_classification_check check (
      lead_classification in (
        'NEEDS_REVIEW','GENUINE_PROSPECT','EXISTING_CUSTOMER','PARTNER','SUPPLIER',
        'COMPETITOR','TICKETING_PROVIDER','INTERNAL','TEST_SYNTHETIC','OTHER_NON_LEAD'
      )
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'incoming_leads_nonlead_reason_check') then
    alter table public.incoming_leads add constraint incoming_leads_nonlead_reason_check check (
      lead_classification not in ('EXISTING_CUSTOMER','PARTNER','SUPPLIER','COMPETITOR','TICKETING_PROVIDER','INTERNAL','TEST_SYNTHETIC','OTHER_NON_LEAD')
      or nullif(trim(coalesce(classification_reason,'')), '') is not null
    );
  end if;
end $$;

update public.incoming_leads
set lead_classification = case when is_test then 'TEST_SYNTHETIC' else 'NEEDS_REVIEW' end,
    classification_reason = case when is_test then coalesce(nullif(classification_reason,''), 'Marked as a controlled test record.') else classification_reason end,
    excluded_at = case when is_test then coalesce(excluded_at, now()) else excluded_at end
where lead_classification is null or (is_test and lead_classification = 'NEEDS_REVIEW');

create index if not exists incoming_leads_classification_idx on public.incoming_leads(lead_classification, last_activity_at desc, id desc);
create index if not exists incoming_leads_review_idx on public.incoming_leads(reviewed_at, lead_classification, last_activity_at desc, id desc);

create or replace function public.update_incoming_lead(p_lead_id uuid, p_action text, p_value jsonb default '{}'::jsonb)
returns public.incoming_leads
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_role text := private.current_revenue_member_role();
  v_old public.incoming_leads;
  v_new public.incoming_leads;
  v_stage text;
  v_owner uuid;
  v_note text;
  v_classification text;
  v_reason text;
  v_excluded boolean;
begin
  if coalesce(v_role,'') not in ('operator','admin') then raise exception 'INCOMING_LEAD_OPERATOR_REQUIRED'; end if;
  select * into v_old from public.incoming_leads where id=p_lead_id for update;
  if not found then raise exception 'INCOMING_LEAD_NOT_FOUND'; end if;

  v_excluded := v_old.is_test or v_old.lead_classification in ('PARTNER','SUPPLIER','COMPETITOR','TICKETING_PROVIDER','INTERNAL','TEST_SYNTHETIC','OTHER_NON_LEAD');

  if p_action='ASSIGN_OWNER' then
    v_owner := nullif(p_value->>'ownerId','')::uuid;
    if v_owner is not null and not exists(select 1 from public.revenue_members where user_id=v_owner and active) then raise exception 'INCOMING_LEAD_OWNER_INVALID'; end if;
    update public.incoming_leads set owner_id=v_owner, updated_at=now() where id=p_lead_id;
  elsif p_action='MARK_REVIEWED' then
    update public.incoming_leads set reviewed_at=now(), reviewed_by=auth.uid(), updated_at=now() where id=p_lead_id;
  elsif p_action='CLASSIFY' then
    v_classification := upper(nullif(trim(p_value->>'classification'),''));
    v_reason := nullif(left(trim(p_value->>'reason'),1000),'');
    if v_classification not in ('NEEDS_REVIEW','GENUINE_PROSPECT','EXISTING_CUSTOMER','PARTNER','SUPPLIER','COMPETITOR','TICKETING_PROVIDER','INTERNAL','TEST_SYNTHETIC','OTHER_NON_LEAD') then raise exception 'INCOMING_LEAD_CLASSIFICATION_INVALID'; end if;
    if v_classification in ('EXISTING_CUSTOMER','PARTNER','SUPPLIER','COMPETITOR','TICKETING_PROVIDER','INTERNAL','TEST_SYNTHETIC','OTHER_NON_LEAD') and v_reason is null then raise exception 'INCOMING_LEAD_EXCLUSION_REASON_REQUIRED'; end if;
    update public.incoming_leads
    set lead_classification=v_classification,
        classification_reason=v_reason,
        classified_at=now(),
        classified_by=auth.uid(),
        reviewed_at=coalesce(reviewed_at,now()),
        reviewed_by=coalesce(reviewed_by,auth.uid()),
        excluded_at=case when v_classification in ('PARTNER','SUPPLIER','COMPETITOR','TICKETING_PROVIDER','INTERNAL','TEST_SYNTHETIC','OTHER_NON_LEAD') then now() else null end,
        excluded_by=case when v_classification in ('PARTNER','SUPPLIER','COMPETITOR','TICKETING_PROVIDER','INTERNAL','TEST_SYNTHETIC','OTHER_NON_LEAD') then auth.uid() else null end,
        updated_at=now()
    where id=p_lead_id;
  elsif p_action='RESTORE' then
    if not v_excluded and v_old.lead_classification <> 'EXISTING_CUSTOMER' then raise exception 'INCOMING_LEAD_RESTORE_NOT_REQUIRED'; end if;
    update public.incoming_leads
    set lead_classification='NEEDS_REVIEW', classification_reason=null,
        classified_at=now(), classified_by=auth.uid(), excluded_at=null, excluded_by=null,
        reviewed_at=null, reviewed_by=null, updated_at=now()
    where id=p_lead_id;
  elsif p_action='CHANGE_STAGE' then
    if v_excluded then raise exception 'INCOMING_LEAD_EXCLUDED'; end if;
    v_stage=upper(p_value->>'stage');
    if v_stage not in ('NEW','REVIEWING','QUALIFIED','CONTACTED','DEMO_SCHEDULED','TRIAL_ACTIVE','PROPOSAL','NURTURE','CONVERTED','DISQUALIFIED','LOST') then raise exception 'INCOMING_LEAD_STAGE_INVALID'; end if;
    update public.incoming_leads set stage=v_stage,qualification_reason=coalesce(nullif(p_value->>'reason',''),qualification_reason),updated_at=now() where id=p_lead_id;
  elsif p_action='SET_NEXT_ACTION' then
    update public.incoming_leads set next_action=nullif(left(p_value->>'nextAction',500),''),updated_at=now() where id=p_lead_id;
  elsif p_action='SET_FOLLOW_UP' then
    update public.incoming_leads set follow_up_at=nullif(p_value->>'followUpAt','')::timestamptz,updated_at=now() where id=p_lead_id;
  elsif p_action='MARK_CONTACTED' then
    if v_excluded then raise exception 'INCOMING_LEAD_EXCLUDED'; end if;
    update public.incoming_leads set last_contacted_at=now(),stage=case when stage in ('NEW','REVIEWING') then 'CONTACTED' else stage end,updated_at=now() where id=p_lead_id;
  elsif p_action='ADD_NOTE' then
    v_note=left(trim(p_value->>'note'),2000);
    if v_note is null or v_note='' then raise exception 'INCOMING_LEAD_NOTE_REQUIRED'; end if;
    insert into public.incoming_lead_notes(incoming_lead_id,actor_id,note) values(p_lead_id,auth.uid(),v_note);
  elsif p_action='QUALIFY' then
    if v_excluded then raise exception 'INCOMING_LEAD_EXCLUDED'; end if;
    update public.incoming_leads set lead_classification='GENUINE_PROSPECT',classification_reason=coalesce(nullif(left(p_value->>'reason',1000),''),classification_reason),classified_at=now(),classified_by=auth.uid(),reviewed_at=coalesce(reviewed_at,now()),reviewed_by=coalesce(reviewed_by,auth.uid()),stage='QUALIFIED',qualification_reason=nullif(left(p_value->>'reason',1000),''),updated_at=now() where id=p_lead_id;
  elsif p_action='MOVE_TO_NURTURE' then
    if v_excluded then raise exception 'INCOMING_LEAD_EXCLUDED'; end if;
    update public.incoming_leads set stage='NURTURE',updated_at=now() where id=p_lead_id;
  elsif p_action='DISQUALIFY' then
    update public.incoming_leads set stage='DISQUALIFIED',qualification_reason=nullif(left(p_value->>'reason',1000),''),updated_at=now() where id=p_lead_id;
  elsif p_action='MARK_CONVERTED' then
    if v_excluded then raise exception 'INCOMING_LEAD_EXCLUDED'; end if;
    update public.incoming_leads set stage='CONVERTED',conversion_reference=nullif(left(p_value->>'conversionReference',500),''),updated_at=now() where id=p_lead_id;
  else raise exception 'INCOMING_LEAD_ACTION_INVALID'; end if;

  select * into v_new from public.incoming_leads where id=p_lead_id;
  insert into public.incoming_lead_changes(incoming_lead_id,actor_id,action,previous_values,new_values)
  values(p_lead_id,auth.uid(),p_action,to_jsonb(v_old),case when p_action='ADD_NOTE' then jsonb_build_object('note',v_note) else to_jsonb(v_new) end);
  return v_new;
end $$;

create or replace function public.bulk_update_incoming_leads(p_lead_ids uuid[], p_action text, p_value jsonb default '{}'::jsonb)
returns integer
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare v_id uuid; v_count integer := 0;
begin
  if coalesce(private.current_revenue_member_role(), '') not in ('operator','admin') then raise exception 'INCOMING_LEAD_OPERATOR_REQUIRED'; end if;
  if cardinality(p_lead_ids) is null or cardinality(p_lead_ids) < 1 or cardinality(p_lead_ids) > 100 then raise exception 'INCOMING_LEAD_BULK_SELECTION_INVALID'; end if;
  if p_action not in ('ASSIGN_OWNER','MARK_REVIEWED','CLASSIFY') then raise exception 'INCOMING_LEAD_BULK_ACTION_INVALID'; end if;
  foreach v_id in array p_lead_ids loop
    perform public.update_incoming_lead(v_id,p_action,p_value);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create or replace function public.list_incoming_lead_queue(
  p_view text default 'needs-review', p_search text default null, p_source text default 'ALL',
  p_classification text default 'ALL', p_intent text default 'ALL', p_owner_id uuid default null,
  p_owner_unassigned boolean default false, p_stage text default 'ALL', p_date_from timestamptz default null,
  p_date_to timestamptz default null, p_follow_up_state text default 'ALL', p_data_quality_state text default 'ALL',
  p_enrichment_state text default 'ALL', p_limit integer default 25, p_offset integer default 0
)
returns table(
  id uuid, display_name text, organisation_name text, product_code text, account_id uuid, contact_id uuid,
  product_opportunity_id uuid, originating_source_category text, originating_source_detail text,
  latest_source_category text, latest_source_detail text, highest_intent_source_category text,
  current_intent text, priority text, priority_reason text, stage text, owner_id uuid, next_action text,
  follow_up_at timestamptz, last_contacted_at timestamptz, identity_review_state text, activity_count integer,
  first_activity_at timestamptz, last_activity_at timestamptz, is_test boolean, lead_classification text,
  classification_reason text, reviewed_at timestamptz, excluded_at timestamptz, account_website text,
  contact_email text, contact_role_title text, enrichment_evidence_count integer, data_quality_issues text[],
  enrichment_state text, total_count bigint
)
language sql stable security invoker set search_path = public, pg_catalog
as $$
  with prepared as (
    select l.*, a.website as account_website, c.email as contact_email, c.role_title as contact_role_title,
      (select count(*)::integer from public.research_evidence evidence where evidence.account_id=l.account_id) as enrichment_evidence_count
    from public.incoming_leads l
    left join public.accounts a on a.id=l.account_id
    left join public.contacts c on c.id=l.contact_id
  ), annotated as (
    select prepared.*, array_remove(array[
      case when nullif(trim(coalesce(organisation_name,'')), '') is null then 'Organisation unresolved' end,
      case when identity_review_state='AMBIGUOUS_ACCOUNT' then 'Account match ambiguous' when account_id is null then 'Account match unresolved' end,
      case when nullif(trim(coalesce(account_website,'')), '') is null then 'Website or domain missing' end,
      case when nullif(trim(coalesce(contact_role_title,'')), '') is null then 'Role unknown' end,
      case when nullif(trim(coalesce(country_code,'')), '') is null then 'Location missing' end,
      case when current_intent in ('LOW','NURTURE') then 'No meaningful commercial signal yet' end
    ], null) as data_quality_issues,
    case
      when is_test or lead_classification in ('EXISTING_CUSTOMER','PARTNER','SUPPLIER','COMPETITOR','TICKETING_PROVIDER','INTERNAL','TEST_SYNTHETIC','OTHER_NON_LEAD') then 'NOT_ELIGIBLE'
      when account_id is null or identity_review_state <> 'RESOLVED' then 'BLOCKED_UNTIL_IDENTITY_RESOLVED'
      when enrichment_evidence_count > 0 then 'EVIDENCE_AVAILABLE'
      else 'NOT_ENRICHED'
    end as enrichment_state
    from prepared
  ), filtered as (
    select * from annotated row
    where
      (p_view='all'
       or (p_view='needs-review' and not row.is_test and row.lead_classification='NEEDS_REVIEW')
       or (p_view='active-leads' and not row.is_test and row.lead_classification='GENUINE_PROSPECT')
       or (p_view='high-intent' and not row.is_test and row.lead_classification in ('NEEDS_REVIEW','GENUINE_PROSPECT') and row.current_intent in ('VERY_HIGH','HIGH'))
       or (p_view='follow-up-due' and not row.is_test and row.lead_classification in ('NEEDS_REVIEW','GENUINE_PROSPECT') and row.follow_up_at < now() and row.stage not in ('CONVERTED','DISQUALIFIED','LOST'))
       or (p_view='incomplete-data' and not row.is_test and row.lead_classification in ('NEEDS_REVIEW','GENUINE_PROSPECT') and cardinality(row.data_quality_issues)>0)
       or (p_view='existing-customers' and row.lead_classification='EXISTING_CUSTOMER')
       or (p_view='excluded' and (row.is_test or row.lead_classification in ('PARTNER','SUPPLIER','COMPETITOR','TICKETING_PROVIDER','INTERNAL','TEST_SYNTHETIC','OTHER_NON_LEAD'))))
      and (coalesce(nullif(trim(p_search),''),'')='' or lower(concat_ws(' ',row.display_name,row.organisation_name,row.contact_email,row.originating_source_detail,row.latest_source_detail)) like '%' || lower(trim(p_search)) || '%')
      and (p_source='ALL' or row.originating_source_category=p_source or row.latest_source_category=p_source)
      and (p_classification='ALL' or row.lead_classification=p_classification)
      and (p_intent='ALL' or row.current_intent=p_intent)
      and (p_owner_id is null or row.owner_id=p_owner_id)
      and (not p_owner_unassigned or row.owner_id is null)
      and (p_stage='ALL' or row.stage=p_stage)
      and (p_date_from is null or row.last_activity_at>=p_date_from)
      and (p_date_to is null or row.last_activity_at<=p_date_to)
      and (p_follow_up_state='ALL' or (p_follow_up_state='DUE' and row.follow_up_at < now() and row.stage not in ('CONVERTED','DISQUALIFIED','LOST')) or (p_follow_up_state='SCHEDULED' and row.follow_up_at is not null) or (p_follow_up_state='NONE' and row.follow_up_at is null))
      and (p_data_quality_state='ALL' or (p_data_quality_state='INCOMPLETE' and cardinality(row.data_quality_issues)>0) or (p_data_quality_state='COMPLETE' and cardinality(row.data_quality_issues)=0))
      and (p_enrichment_state='ALL' or row.enrichment_state=p_enrichment_state)
  )
  select id,display_name,organisation_name,product_code,account_id,contact_id,product_opportunity_id,
    originating_source_category,originating_source_detail,latest_source_category,latest_source_detail,
    highest_intent_source_category,current_intent,priority,priority_reason,stage,owner_id,next_action,
    follow_up_at,last_contacted_at,identity_review_state,activity_count,first_activity_at,last_activity_at,
    is_test,lead_classification,classification_reason,reviewed_at,excluded_at,account_website,contact_email,
    contact_role_title,enrichment_evidence_count,data_quality_issues,enrichment_state,count(*) over()
  from filtered order by priority_rank desc nulls last,last_activity_at desc,id desc
  limit greatest(1,least(p_limit,100)) offset greatest(0,p_offset);
$$;

create or replace function public.incoming_lead_operational_metrics()
returns jsonb
language sql stable security invoker set search_path = public, pg_catalog
as $$
  with prepared as (
    select l.*, a.website as account_website, c.role_title as contact_role_title,
      array_remove(array[
        case when nullif(trim(coalesce(l.organisation_name,'')), '') is null then 'Organisation unresolved' end,
        case when l.identity_review_state='AMBIGUOUS_ACCOUNT' then 'Account match ambiguous' when l.account_id is null then 'Account match unresolved' end,
        case when nullif(trim(coalesce(a.website,'')), '') is null then 'Website or domain missing' end,
        case when nullif(trim(coalesce(c.role_title,'')), '') is null then 'Role unknown' end,
        case when nullif(trim(coalesce(l.country_code,'')), '') is null then 'Location missing' end,
        case when l.current_intent in ('LOW','NURTURE') then 'No meaningful commercial signal yet' end
      ],null) as data_quality_issues
    from public.incoming_leads l left join public.accounts a on a.id=l.account_id left join public.contacts c on c.id=l.contact_id
  ), active as (
    select * from prepared where not is_test and lead_classification in ('NEEDS_REVIEW','GENUINE_PROSPECT')
  )
  select jsonb_build_object(
    'newUnreviewed', (select count(*) from active where lead_classification='NEEDS_REVIEW' and reviewed_at is null),
    'activeGenuineLeads', (select count(*) from active where lead_classification='GENUINE_PROSPECT'),
    'highIntentLeads', (select count(*) from active where current_intent in ('VERY_HIGH','HIGH')),
    'followUpsDue', (select count(*) from active where follow_up_at < now() and stage not in ('CONVERTED','DISQUALIFIED','LOST')),
    'needsClassification', (select count(*) from active where lead_classification='NEEDS_REVIEW'),
    'incompleteNeedsEnrichment', (select count(*) from active where cardinality(data_quality_issues)>0),
    'excluded', (select count(*) from prepared where is_test or lead_classification in ('PARTNER','SUPPLIER','COMPETITOR','TICKETING_PROVIDER','INTERNAL','TEST_SYNTHETIC','OTHER_NON_LEAD'))
  );
$$;

revoke all on function public.bulk_update_incoming_leads(uuid[],text,jsonb) from public;
revoke all on function public.list_incoming_lead_queue(text,text,text,text,text,uuid,boolean,text,timestamptz,timestamptz,text,text,text,integer,integer) from public;
revoke all on function public.incoming_lead_operational_metrics() from public;
grant execute on function public.bulk_update_incoming_leads(uuid[],text,jsonb) to authenticated;
grant execute on function public.list_incoming_lead_queue(text,text,text,text,text,uuid,boolean,text,timestamptz,timestamptz,text,text,text,integer,integer) to authenticated;
grant execute on function public.incoming_lead_operational_metrics() to authenticated;
revoke execute on function public.bulk_update_incoming_leads(uuid[],text,jsonb) from anon;
revoke execute on function public.list_incoming_lead_queue(text,text,text,text,text,uuid,boolean,text,timestamptz,timestamptz,text,text,text,integer,integer) from anon;
revoke execute on function public.incoming_lead_operational_metrics() from anon;

comment on column public.incoming_leads.lead_classification is 'Operator-owned disposition. Non-lead categories are excluded from active queues, metrics, enrichment eligibility and future inbound opportunity creation.';
