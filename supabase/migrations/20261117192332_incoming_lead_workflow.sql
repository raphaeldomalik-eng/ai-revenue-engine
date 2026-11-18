-- AIRE #123: forward-only workflow extension. Not applied to any hosted database.
-- Reuses operator/admin enforcement, row locking and the existing immutable audit ledger.
alter table public.incoming_leads
  add column if not exists hold_reason text,
  add column if not exists hold_review_condition text,
  add column if not exists hold_review_at timestamptz;
alter table public.incoming_leads add constraint incoming_leads_hold_complete check (
 (hold_reason is null and hold_review_condition is null and hold_review_at is null) or
 (nullif(trim(hold_reason),'') is not null and nullif(trim(hold_review_condition),'') is not null and hold_review_at is not null));

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
  v_opp public.product_opportunities;
  v_opp_id uuid;
  v_count integer;
  v_target text;
  v_allowed text[];
  v_next text;
  v_due timestamptz;
  v_previous_opp jsonb;
begin
  if coalesce(v_role,'') not in ('operator','admin') then raise exception 'INCOMING_LEAD_OPERATOR_REQUIRED'; end if;
  select * into v_old from public.incoming_leads where id=p_lead_id for update;
  if not found then raise exception 'INCOMING_LEAD_NOT_FOUND'; end if;

  v_excluded := v_old.is_test or v_old.lead_classification in ('PARTNER','SUPPLIER','COMPETITOR','TICKETING_PROVIDER','INTERNAL','TEST_SYNTHETIC','OTHER_NON_LEAD');

  if v_old.hold_reason is not null and p_action in ('CHANGE_STAGE','QUALIFY','MOVE_TO_NURTURE','DISQUALIFY','MARK_CONVERTED','MARK_CONTACTED') then raise exception 'INCOMING_LEAD_HOLD_ACTIVE'; end if;
  if p_action in ('QUALIFY','MARK_CONTACTED') and (v_old.stage='TRIAL_ACTIVE' or v_old.lead_classification='EXISTING_CUSTOMER' or v_old.owner_id is null or nullif(trim(v_old.next_action),'') is null or v_old.follow_up_at is null) then raise exception 'INCOMING_LEAD_OPPORTUNITY_INELIGIBLE'; end if;
  if p_action='MARK_CONVERTED' then raise exception 'INCOMING_LEAD_USE_OPPORTUNITY_PROGRESSION'; end if;
  if v_old.product_opportunity_id is not null and p_action in ('CHANGE_STAGE','QUALIFY','MOVE_TO_NURTURE','DISQUALIFY','MARK_CONVERTED','MARK_CONTACTED') then raise exception 'INCOMING_LEAD_USE_OPPORTUNITY_PROGRESSION'; end if;

  if p_action='SET_WORK_PLAN' then
    v_owner := nullif(p_value->>'ownerId','')::uuid;
    if v_owner is null or not exists(select 1 from public.revenue_members where user_id=v_owner and active and member_role in ('operator','admin')) then raise exception 'INCOMING_LEAD_OWNER_INVALID'; end if;
    v_next := nullif(trim(left(p_value->>'nextAction',500)),'');
    v_due := nullif(p_value->>'followUpAt','')::timestamptz;
    if v_next is null or v_due is null then raise exception 'INCOMING_LEAD_WORK_PLAN_REQUIRED'; end if;
    update public.incoming_leads set owner_id=v_owner,next_action=v_next,follow_up_at=v_due,updated_at=now() where id=p_lead_id;
  elsif p_action='HOLD' then
    v_reason := nullif(trim(left(p_value->>'reason',1000)),'');
    v_note := nullif(trim(left(p_value->>'reviewCondition',1000)),'');
    v_due := nullif(p_value->>'reviewAt','')::timestamptz;
    if v_reason is null then raise exception 'INCOMING_LEAD_HOLD_REASON_REQUIRED'; end if;
    if v_note is null or v_due is null then raise exception 'INCOMING_LEAD_HOLD_REVIEW_REQUIRED'; end if;
    update public.incoming_leads set hold_reason=v_reason,hold_review_condition=v_note,hold_review_at=v_due,updated_at=now() where id=p_lead_id;
  elsif p_action='RELEASE_HOLD' then
    if nullif(trim(p_value->>'reason'),'') is null then raise exception 'INCOMING_LEAD_REASON_REQUIRED'; end if;
    update public.incoming_leads set hold_reason=null,hold_review_condition=null,hold_review_at=null,updated_at=now() where id=p_lead_id;
  elsif p_action in ('LINK_OPPORTUNITY','PROGRESS_OPPORTUNITY') then
    if v_excluded or v_old.lead_classification <> 'GENUINE_PROSPECT' or v_old.reviewed_at is null
      or v_old.identity_review_state <> 'RESOLVED' or v_old.account_id is null or v_old.contact_id is null
      or v_old.stage='TRIAL_ACTIVE' or v_old.originating_source_category='TRIAL_STARTED'
      or v_old.hold_reason is not null or v_old.owner_id is null or nullif(trim(v_old.next_action),'') is null or v_old.follow_up_at is null
      or not exists(select 1 from public.revenue_members where user_id=v_old.owner_id and active and member_role in ('operator','admin'))
    then raise exception 'INCOMING_LEAD_OPPORTUNITY_INELIGIBLE'; end if;
    v_reason := nullif(trim(left(p_value->>'reason',1000)),'');
    if v_reason is null then raise exception 'INCOMING_LEAD_REASON_REQUIRED'; end if;
    -- Serialize on the account, including concurrent different leads for the same account/product.
    perform id from public.accounts where id=v_old.account_id for update;
    if p_action='LINK_OPPORTUNITY' then
      v_opp_id := coalesce(v_old.product_opportunity_id,nullif(p_value->>'opportunityId','')::uuid);
      if v_opp_id is null then
        select count(*),min(id::text)::uuid into v_count,v_opp_id from public.product_opportunities
          where account_id=v_old.account_id and product_id=v_old.product_id and stage not in ('converted','disqualified','lost');
        if v_count > 0 then raise exception 'INCOMING_LEAD_OPPORTUNITY_SELECTION_REQUIRED'; end if;
        insert into public.product_opportunities(account_id,product_id,stage,conversion_route,metadata)
          values(v_old.account_id,v_old.product_id,'identified','UNDETERMINED',jsonb_build_object('incomingLead',true,'incomingLeadId',p_lead_id,'fitEvidence',v_reason)) returning id into v_opp_id;
      end if;
      select * into v_opp from public.product_opportunities where id=v_opp_id for update;
      if not found or v_opp.account_id<>v_old.account_id or v_opp.product_id<>v_old.product_id or v_opp.stage in ('converted','disqualified','lost') then raise exception 'INCOMING_LEAD_OPPORTUNITY_INVALID'; end if;
      update public.incoming_leads set product_opportunity_id=v_opp.id,updated_at=now() where id=p_lead_id;
    else
      select * into v_opp from public.product_opportunities where id=v_old.product_opportunity_id for update;
      if not found or v_opp.account_id<>v_old.account_id or v_opp.product_id<>v_old.product_id then raise exception 'INCOMING_LEAD_OPPORTUNITY_INVALID'; end if;
      v_previous_opp := to_jsonb(v_opp);
      v_target := lower(p_value->>'stage');
      v_allowed := case v_opp.stage
        when 'identified' then array['qualified','nurture','disqualified']
        when 'qualified' then array['contacted','demo_scheduled','nurture','lost','disqualified']
        when 'contacted' then array['demo_scheduled','proposal','nurture','lost','disqualified']
        when 'demo_scheduled' then array['proposal','nurture','lost','disqualified']
        when 'proposal' then array['converted','lost','nurture']
        when 'nurture' then array['qualified','lost','disqualified'] else array[]::text[] end;
      if v_target is null or not(v_target=any(v_allowed)) then raise exception 'INCOMING_LEAD_TRANSITION_INVALID'; end if;
      update public.product_opportunities set stage=v_target where id=v_opp.id returning * into v_opp;
      update public.incoming_leads set stage=upper(v_target),updated_at=now() where id=p_lead_id;
      -- Stage recording never sends a message, sets last_contacted_at, or changes product customer state.
    end if;
  elsif p_action='ASSIGN_OWNER' then
    v_owner := nullif(p_value->>'ownerId','')::uuid;
    if v_owner is not null and not exists(select 1 from public.revenue_members where user_id=v_owner and active and member_role in ('operator','admin')) then raise exception 'INCOMING_LEAD_OWNER_INVALID'; end if;
    update public.incoming_leads set owner_id=v_owner, updated_at=now() where id=p_lead_id;
  elsif p_action='MARK_REVIEWED' then
    update public.incoming_leads set reviewed_at=now(), reviewed_by=auth.uid(), updated_at=now() where id=p_lead_id;
  elsif p_action='CLASSIFY' then
    v_classification := upper(nullif(trim(p_value->>'classification'),''));
    v_reason := nullif(left(trim(p_value->>'reason'),1000),'');
    if v_classification not in ('NEEDS_REVIEW','GENUINE_PROSPECT','EXISTING_CUSTOMER','PARTNER','SUPPLIER','COMPETITOR','TICKETING_PROVIDER','INTERNAL','TEST_SYNTHETIC','OTHER_NON_LEAD') then raise exception 'INCOMING_LEAD_CLASSIFICATION_INVALID'; end if;
    if v_classification in ('EXISTING_CUSTOMER','PARTNER','SUPPLIER','COMPETITOR','TICKETING_PROVIDER','INTERNAL','TEST_SYNTHETIC','OTHER_NON_LEAD') and v_reason is null then raise exception 'INCOMING_LEAD_EXCLUSION_REASON_REQUIRED'; end if;
    if v_classification='GENUINE_PROSPECT' and (v_reason is null or v_old.identity_review_state<>'RESOLVED' or v_old.account_id is null or v_old.contact_id is null) then raise exception 'INCOMING_LEAD_PROSPECT_EVIDENCE_REQUIRED'; end if;
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
    if v_old.product_opportunity_id is not null then raise exception 'INCOMING_LEAD_USE_OPPORTUNITY_PROGRESSION'; end if;
    if v_excluded then raise exception 'INCOMING_LEAD_EXCLUDED'; end if;
    v_stage=upper(p_value->>'stage');
    if v_stage is null or v_stage not in ('NEW','REVIEWING','NURTURE','DISQUALIFIED','LOST') then raise exception 'INCOMING_LEAD_USE_OPPORTUNITY_PROGRESSION'; end if;
    if v_stage in ('NURTURE','DISQUALIFIED','LOST') and nullif(trim(p_value->>'reason'),'') is null then raise exception 'INCOMING_LEAD_REASON_REQUIRED'; end if;
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
    if nullif(trim(p_value->>'reason'),'') is null or v_old.identity_review_state<>'RESOLVED' or v_old.account_id is null or v_old.contact_id is null or v_old.lead_classification='EXISTING_CUSTOMER' then raise exception 'INCOMING_LEAD_PROSPECT_EVIDENCE_REQUIRED'; end if;
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
  values(p_lead_id,auth.uid(),p_action,to_jsonb(v_old)||jsonb_build_object('opportunity',v_previous_opp),case when p_action='ADD_NOTE' then jsonb_build_object('note',v_note) when p_action in ('LINK_OPPORTUNITY','PROGRESS_OPPORTUNITY') then to_jsonb(v_new)||jsonb_build_object('opportunity',to_jsonb(v_opp),'evidence',v_reason) when p_action='RELEASE_HOLD' then to_jsonb(v_new)||jsonb_build_object('releaseReason',p_value->>'reason') else to_jsonb(v_new) end);
  return v_new;
end $$;


-- Due work includes service follow-up and explicit hold reviews.
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
       or (p_view='follow-up-due' and not row.is_test and row.lead_classification in ('NEEDS_REVIEW','GENUINE_PROSPECT','EXISTING_CUSTOMER') and ((row.hold_reason is null and row.follow_up_at < now()) or row.hold_review_at < now()) and row.stage not in ('CONVERTED','DISQUALIFIED','LOST'))
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
    'followUpsDue', (select count(*) from prepared where not is_test and lead_classification in ('NEEDS_REVIEW','GENUINE_PROSPECT','EXISTING_CUSTOMER') and ((hold_reason is null and follow_up_at < now()) or hold_review_at < now()) and stage not in ('CONVERTED','DISQUALIFIED','LOST')),
    'needsClassification', (select count(*) from active where lead_classification='NEEDS_REVIEW'),
    'incompleteNeedsEnrichment', (select count(*) from active where cardinality(data_quality_issues)>0),
    'totalLeads', (select count(*) from prepared),
    'customers', (select count(*) from prepared where lead_classification='EXISTING_CUSTOMER' or stage='TRIAL_ACTIVE'),
    'excluded', (select count(*) from prepared where is_test or lead_classification in ('PARTNER','SUPPLIER','COMPETITOR','TICKETING_PROVIDER','INTERNAL','TEST_SYNTHETIC','OTHER_NON_LEAD'))
  );
$$;
