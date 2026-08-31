-- Incoming Leads V1. Forward-only, review locally before activation; never apply from this change.
-- The intake ledger is immutable evidence. The lead projection is the operator's mutable work queue.

alter table public.contacts alter column account_id drop not null;
alter table public.contacts add column if not exists normalized_email text;
update public.contacts set normalized_email = lower(trim(email)) where normalized_email is null and email is not null;
create unique index if not exists contacts_normalized_email_uidx on public.contacts(normalized_email) where normalized_email is not null;

alter table public.activities add column if not exists incoming_submission_id uuid;
create unique index if not exists activities_incoming_submission_uidx on public.activities(incoming_submission_id) where incoming_submission_id is not null;

create table if not exists public.incoming_submissions (
  id uuid primary key default gen_random_uuid(),
  source_system text not null check (length(source_system) between 1 and 100),
  source_record_id text not null check (length(source_record_id) between 1 and 255),
  schema_version text not null check (length(schema_version) between 1 and 50),
  product_code text not null check (length(product_code) between 1 and 100),
  source_category text not null check (source_category in ('DEMO_REQUEST','TALK_TO_SALES','TRIAL_STARTED','PRODUCT_ENQUIRY','RESOURCE_DOWNLOAD','TEMPLATE_DOWNLOAD','NEWSLETTER_SIGNUP','INTERNAL_TEST')),
  source_detail text,
  source_page text,
  resource_identifier text,
  template_identifier text,
  campaign_identifier text,
  contact_name text,
  submitted_email text,
  normalized_contact_email text,
  phone text,
  organisation_name text,
  country_code text,
  consent_state text not null default 'UNKNOWN',
  consent_evidence jsonb not null default '{}'::jsonb,
  first_touch_attribution jsonb not null default '{}'::jsonb,
  current_touch_attribution jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  processing_state text not null default 'RECEIVED' check (processing_state in ('RECEIVED','PROCESSING','PROCESSED','FAILED')),
  processing_error text,
  account_id uuid references public.accounts(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  product_opportunity_id uuid references public.product_opportunities(id) on delete set null,
  original_payload jsonb not null default '{}'::jsonb check (octet_length(original_payload::text) <= 100000),
  environment text not null default 'PRODUCTION' check (environment in ('PRODUCTION','DEVELOPMENT','TEST')),
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_system, source_record_id)
);

create table if not exists public.incoming_leads (
  id uuid primary key default gen_random_uuid(),
  canonical_key text not null unique,
  product_id uuid not null references public.products(id),
  product_code text not null,
  account_id uuid references public.accounts(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  product_opportunity_id uuid references public.product_opportunities(id) on delete set null,
  display_name text,
  organisation_name text,
  country_code text,
  originating_source_category text not null check (originating_source_category in ('DEMO_REQUEST','TALK_TO_SALES','TRIAL_STARTED','PRODUCT_ENQUIRY','RESOURCE_DOWNLOAD','TEMPLATE_DOWNLOAD','NEWSLETTER_SIGNUP')),
  originating_source_detail text,
  latest_source_category text not null,
  latest_source_detail text,
  highest_intent_source_category text not null,
  highest_intent_rank integer not null default 0,
  current_intent text not null check (current_intent in ('VERY_HIGH','HIGH','MEDIUM','LOW','NURTURE','EXCLUDED')),
  priority text not null default 'STANDARD' check (priority in ('URGENT','HIGH','MEDIUM','STANDARD','NURTURE','EXCLUDED')),
  priority_rank integer not null default 0,
  priority_reason text not null,
  stage text not null default 'NEW' check (stage in ('NEW','REVIEWING','QUALIFIED','CONTACTED','DEMO_SCHEDULED','TRIAL_ACTIVE','PROPOSAL','NURTURE','CONVERTED','DISQUALIFIED','LOST')),
  owner_id uuid references public.revenue_members(user_id) on delete set null,
  next_action text,
  follow_up_at timestamptz,
  last_contacted_at timestamptz,
  qualification_reason text,
  conversion_reference text,
  communication_policy jsonb not null default '{}'::jsonb,
  identity_review_state text not null default 'RESOLVED' check (identity_review_state in ('RESOLVED','UNRESOLVED','AMBIGUOUS_ACCOUNT','MISSING_EMAIL')),
  activity_count integer not null default 0 check (activity_count >= 0),
  first_activity_at timestamptz not null,
  last_activity_at timestamptz not null,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.incoming_submissions add column if not exists incoming_lead_id uuid references public.incoming_leads(id) on delete set null;
alter table public.activities add column if not exists incoming_lead_id uuid references public.incoming_leads(id) on delete set null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='activities_incoming_submission_fk') then
    alter table public.activities add constraint activities_incoming_submission_fk foreign key (incoming_submission_id) references public.incoming_submissions(id) on delete set null;
  end if;
end $$;

create table if not exists public.incoming_lead_changes (
  id uuid primary key default gen_random_uuid(),
  incoming_lead_id uuid not null references public.incoming_leads(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  previous_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.incoming_lead_notes (
  id uuid primary key default gen_random_uuid(),
  incoming_lead_id uuid not null references public.incoming_leads(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  note text not null check (length(note) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists incoming_submissions_received_idx on public.incoming_submissions(received_at desc);
create index if not exists incoming_submissions_email_idx on public.incoming_submissions(normalized_contact_email);
create index if not exists incoming_leads_attention_idx on public.incoming_leads(is_test, priority_rank desc, follow_up_at, last_activity_at desc);
create index if not exists incoming_leads_list_idx on public.incoming_leads(priority_rank desc, last_activity_at desc, id desc);
create index if not exists incoming_leads_source_idx on public.incoming_leads(originating_source_category, latest_source_category);
create index if not exists incoming_leads_stage_idx on public.incoming_leads(stage, last_activity_at desc, id desc);
create index if not exists incoming_leads_owner_idx on public.incoming_leads(owner_id, last_activity_at desc, id desc);
create index if not exists incoming_leads_contact_idx on public.incoming_leads(contact_id, product_id);
create unique index if not exists incoming_active_opportunity_uidx on public.product_opportunities(account_id, product_id) where metadata->>'incomingLead'='true' and stage not in ('converted','disqualified','lost');
create index if not exists incoming_lead_changes_lead_idx on public.incoming_lead_changes(incoming_lead_id, created_at desc);
create index if not exists incoming_lead_notes_lead_idx on public.incoming_lead_notes(incoming_lead_id, created_at desc);

create or replace function public.incoming_submission_immutable_guard()
returns trigger language plpgsql set search_path = public, pg_catalog as $$
begin
  if tg_op = 'DELETE' then raise exception 'INCOMING_SUBMISSION_DELETE_FORBIDDEN'; end if;
  if tg_op = 'UPDATE' and (
    old.source_system is distinct from new.source_system or old.source_record_id is distinct from new.source_record_id or old.schema_version is distinct from new.schema_version or old.product_code is distinct from new.product_code or old.source_category is distinct from new.source_category or old.source_detail is distinct from new.source_detail or old.source_page is distinct from new.source_page or old.resource_identifier is distinct from new.resource_identifier or old.template_identifier is distinct from new.template_identifier or old.campaign_identifier is distinct from new.campaign_identifier or old.contact_name is distinct from new.contact_name or old.submitted_email is distinct from new.submitted_email or old.normalized_contact_email is distinct from new.normalized_contact_email or old.phone is distinct from new.phone or old.organisation_name is distinct from new.organisation_name or old.country_code is distinct from new.country_code or old.consent_state is distinct from new.consent_state or old.consent_evidence is distinct from new.consent_evidence or old.first_touch_attribution is distinct from new.first_touch_attribution or old.current_touch_attribution is distinct from new.current_touch_attribution or old.occurred_at is distinct from new.occurred_at or old.received_at is distinct from new.received_at or old.original_payload is distinct from new.original_payload or old.environment is distinct from new.environment or old.is_test is distinct from new.is_test
  ) then raise exception 'INCOMING_SUBMISSION_IMMUTABLE_FIELDS'; end if;
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists incoming_submission_immutable_trigger on public.incoming_submissions;
create trigger incoming_submission_immutable_trigger before update or delete on public.incoming_submissions for each row execute function public.incoming_submission_immutable_guard();

create or replace function public.incoming_communication_policy(p_category text, p_consent text)
returns jsonb language sql immutable set search_path = pg_catalog as $$
  select jsonb_build_object(
    'sourceCategory', p_category,
    'consentState', upper(coalesce(p_consent,'UNKNOWN')),
    'permittedTreatment', case when p_category='DEMO_REQUEST' then 'Transactional acknowledgement and human sales follow-up permitted.' when p_category='TALK_TO_SALES' then 'Direct response to the enquiry permitted.' when p_category='TRIAL_STARTED' then 'Service and activation communication permitted; commercial assistance is separate.' when p_category='PRODUCT_ENQUIRY' then 'Human qualification permitted.' when p_category='NEWSLETTER_SIGNUP' and upper(coalesce(p_consent,'UNKNOWN')) in ('GRANTED','OPTED_IN','VALID') then 'Marketing communication permitted with recorded consent.' when p_category='NEWSLETTER_SIGNUP' then 'No marketing communication until valid consent evidence exists.' when upper(coalesce(p_consent,'UNKNOWN')) in ('GRANTED','OPTED_IN','VALID') then 'Requested resource delivery; marketing nurture is permitted with recorded consent.' else 'Requested resource delivery only; marketing nurture requires valid consent.' end,
    'marketingConsentRequired', p_category in ('RESOURCE_DOWNLOAD','TEMPLATE_DOWNLOAD','NEWSLETTER_SIGNUP'),
    'responseUrgency', case when p_category in ('DEMO_REQUEST','TALK_TO_SALES') then 'IMMEDIATE' when p_category in ('TRIAL_STARTED','PRODUCT_ENQUIRY') then 'SAME_DAY' when p_category='INTERNAL_TEST' then 'NONE' when p_category='NEWSLETTER_SIGNUP' then 'NURTURE' else 'WITHIN_2_DAYS' end,
    'ownerRequired', p_category in ('DEMO_REQUEST','TALK_TO_SALES','PRODUCT_ENQUIRY'),
    'humanApprovalRequired', p_category <> 'INTERNAL_TEST',
    'recommendedCommunicationSet', case when p_category='INTERNAL_TEST' then '[]'::jsonb when p_category='NEWSLETTER_SIGNUP' and upper(coalesce(p_consent,'UNKNOWN')) not in ('GRANTED','OPTED_IN','VALID') then '[]'::jsonb when p_category in ('RESOURCE_DOWNLOAD','TEMPLATE_DOWNLOAD') and upper(coalesce(p_consent,'UNKNOWN')) not in ('GRANTED','OPTED_IN','VALID') then jsonb_build_array('Requested resource delivery') when p_category in ('RESOURCE_DOWNLOAD','TEMPLATE_DOWNLOAD') then jsonb_build_array('Requested resource delivery','Marketing nurture') when p_category='NEWSLETTER_SIGNUP' then jsonb_build_array('Marketing newsletter') when p_category='DEMO_REQUEST' then jsonb_build_array('Transactional acknowledgement','Human demo follow-up') when p_category='TALK_TO_SALES' then jsonb_build_array('Direct human response') when p_category='TRIAL_STARTED' then jsonb_build_array('Trial activation/service support') else jsonb_build_array('Human qualification response') end,
    'transitionCondition', case when p_category='INTERNAL_TEST' then 'Remain excluded.' when p_category in ('DEMO_REQUEST','TALK_TO_SALES') then 'Owner records contact or qualification outcome.' when p_category='TRIAL_STARTED' then 'Trial is active, qualified, or closed.' else 'Consent is confirmed, delivery is complete, or engagement becomes high intent.' end
  );
$$;

create or replace function public.ingest_incoming_submission(p_payload jsonb)
returns table(submission_id uuid, lead_id uuid, duplicate boolean)
language plpgsql security definer set search_path = public, private, pg_catalog as $$
declare
  v_submission_id uuid; v_lead_id uuid; v_product_id uuid; v_opportunity_id uuid; v_account_id uuid; v_contact_id uuid; v_contact_account_id uuid; v_account_match_count integer;
  v_source_system text := nullif(trim(p_payload->>'sourceSystem'), ''); v_source_record_id text := nullif(trim(p_payload->>'sourceRecordId'), '');
  v_product_code text := nullif(trim(p_payload->>'productCode'), ''); v_category text := upper(nullif(trim(p_payload->>'sourceCategory'), ''));
  v_email text := nullif(lower(trim(p_payload->>'submittedEmail')), ''); v_org text := nullif(trim(p_payload->>'organisationName'), '');
  v_occurred_at timestamptz := coalesce(nullif(p_payload->>'occurredAt','')::timestamptz, now()); v_environment text := upper(coalesce(nullif(p_payload->>'environment',''), 'PRODUCTION'));
  v_consent text := upper(coalesce(nullif(p_payload->>'consentState',''), 'UNKNOWN')); v_rank integer; v_intent text; v_priority text; v_activity_type text; v_identity_state text := 'RESOLVED';
  v_key text; v_activity_count integer; v_existing_category text; v_existing_stage text; v_product_name text; v_summary text; v_org_confidence text;
begin
  if coalesce(private.current_revenue_member_role(), '') not in ('operator','admin') then raise exception 'INCOMING_LEAD_OPERATOR_REQUIRED'; end if;
  if p_payload is null or octet_length(p_payload::text) > 100000 then raise exception 'INCOMING_SUBMISSION_PAYLOAD_TOO_LARGE'; end if;
  if v_source_system is null or v_source_record_id is null or v_product_code is null or v_category is null then raise exception 'INCOMING_SUBMISSION_REQUIRED_FIELDS'; end if;
  if v_category not in ('DEMO_REQUEST','TALK_TO_SALES','TRIAL_STARTED','PRODUCT_ENQUIRY','RESOURCE_DOWNLOAD','TEMPLATE_DOWNLOAD','NEWSLETTER_SIGNUP','INTERNAL_TEST') then raise exception 'INCOMING_SOURCE_CATEGORY_INVALID'; end if;
  if v_environment not in ('PRODUCTION','DEVELOPMENT','TEST') then raise exception 'INCOMING_ENVIRONMENT_INVALID'; end if;

  insert into public.incoming_submissions (source_system,source_record_id,schema_version,product_code,source_category,source_detail,source_page,resource_identifier,template_identifier,campaign_identifier,contact_name,submitted_email,normalized_contact_email,phone,organisation_name,country_code,consent_state,consent_evidence,first_touch_attribution,current_touch_attribution,occurred_at,environment,is_test,original_payload,processing_state)
  values (v_source_system,v_source_record_id,coalesce(nullif(p_payload->>'schemaVersion',''),'incoming-lead.v1'),v_product_code,v_category,p_payload->>'sourceDetail',p_payload->>'sourcePage',p_payload->>'resourceIdentifier',p_payload->>'templateIdentifier',p_payload->>'campaignIdentifier',p_payload->>'contactName',p_payload->>'submittedEmail',v_email,p_payload->>'phone',v_org,p_payload->>'countryCode',v_consent,coalesce(p_payload->'consentEvidence','{}'::jsonb),coalesce(p_payload->'firstTouchAttribution','{}'::jsonb),coalesce(p_payload->'currentTouchAttribution','{}'::jsonb),v_occurred_at,v_environment,(v_category='INTERNAL_TEST' or v_environment='TEST'),coalesce(p_payload->'originalPayload','{}'::jsonb),'PROCESSING')
  on conflict (source_system,source_record_id) do nothing returning id into v_submission_id;
  if v_submission_id is null then
    select id into v_submission_id from public.incoming_submissions where source_system=v_source_system and source_record_id=v_source_record_id;
    select id into v_lead_id from public.incoming_leads lead where lead.canonical_key = coalesce(v_email,'submission:'||v_submission_id::text)||'|'||v_product_code limit 1;
    return query select v_submission_id,v_lead_id,true; return;
  end if;
  select id,name into v_product_id,v_product_name from public.products where code=v_product_code and active=true limit 1;
  if v_product_id is null then update public.incoming_submissions set processing_state='FAILED',processing_error='PRODUCT_NOT_CONFIGURED' where id=v_submission_id; raise exception 'INCOMING_PRODUCT_NOT_CONFIGURED'; end if;
  if v_category = 'INTERNAL_TEST' or v_environment = 'TEST' then update public.incoming_submissions set processing_state='PROCESSED' where id=v_submission_id; return query select v_submission_id,null::uuid,false; return; end if;

  v_org_confidence := upper(coalesce(p_payload->'originalPayload'->>'organisationConfidence',''));
  select count(*)::integer into v_account_match_count from public.accounts where v_org is not null and lower(trim(name))=lower(v_org);
  if v_org is not null and (v_org_confidence='AMBIGUOUS' or v_account_match_count > 1) then
    v_identity_state := 'AMBIGUOUS_ACCOUNT';
  elsif v_org is not null and v_account_match_count = 1 then
    select id into v_account_id from public.accounts where lower(trim(name))=lower(v_org) order by id limit 1;
  elsif v_org is not null and v_org_confidence='HIGH' then
    insert into public.accounts(name,source,metadata) values (v_org,'incoming_lead',jsonb_build_object('createdFromIncomingLead',true)) returning id into v_account_id;
  end if;
  if v_email is not null then
    select id,account_id into v_contact_id,v_contact_account_id from public.contacts where normalized_email=v_email limit 1;
    if v_contact_id is null then
      insert into public.contacts(account_id,full_name,email,normalized_email,phone,source,metadata) values (v_account_id,p_payload->>'contactName',p_payload->>'submittedEmail',v_email,p_payload->>'phone','incoming_lead',jsonb_build_object('identityKey','exact_normalized_email')) returning id into v_contact_id;
    elsif v_contact_account_id is null and v_account_id is not null then
      update public.contacts set account_id=v_account_id where id=v_contact_id;
    elsif v_contact_account_id is not null and v_account_id is null and v_identity_state <> 'AMBIGUOUS_ACCOUNT' then
      v_account_id := v_contact_account_id;
    elsif v_contact_account_id is not null and v_account_id is not null and v_contact_account_id<>v_account_id then
      v_identity_state := 'AMBIGUOUS_ACCOUNT'; v_account_id := v_contact_account_id;
    end if;
  else v_identity_state := 'MISSING_EMAIL'; end if;
  if v_account_id is null and v_identity_state='RESOLVED' then v_identity_state := 'UNRESOLVED'; end if;
  v_key := coalesce(v_email,'submission:'||v_submission_id::text)||'|'||v_product_code;
  select id,activity_count,highest_intent_rank,highest_intent_source_category,stage into v_lead_id,v_activity_count,v_rank,v_existing_category,v_existing_stage from public.incoming_leads where canonical_key=v_key limit 1;
  v_rank := case when v_category in ('TALK_TO_SALES','DEMO_REQUEST') then 5 when v_category in ('TRIAL_STARTED','PRODUCT_ENQUIRY') then 4 when v_category in ('RESOURCE_DOWNLOAD','TEMPLATE_DOWNLOAD') then 1 else 0 end;
  v_intent := case when v_category in ('TALK_TO_SALES','DEMO_REQUEST') then 'VERY_HIGH' when v_category in ('TRIAL_STARTED','PRODUCT_ENQUIRY') then 'HIGH' when v_category='NEWSLETTER_SIGNUP' then 'NURTURE' else 'LOW' end;
  v_priority := case when v_category in ('TALK_TO_SALES','DEMO_REQUEST') then 'URGENT' when v_category in ('TRIAL_STARTED','PRODUCT_ENQUIRY') then 'HIGH' when v_category='NEWSLETTER_SIGNUP' then 'NURTURE' else 'STANDARD' end;
  v_activity_type := case v_category when 'DEMO_REQUEST' then 'demo_requested' when 'TALK_TO_SALES' then 'talk_to_sales_submitted' when 'TRIAL_STARTED' then 'trial_started' when 'PRODUCT_ENQUIRY' then 'product_enquiry_submitted' when 'RESOURCE_DOWNLOAD' then 'resource_downloaded' when 'TEMPLATE_DOWNLOAD' then 'template_downloaded' else 'newsletter_signup' end;
  v_summary := coalesce(p_payload->>'sourceDetail',initcap(replace(lower(v_category),'_',' ')));
  if v_lead_id is null then
    insert into public.incoming_leads(canonical_key,product_id,product_code,account_id,contact_id,display_name,organisation_name,country_code,originating_source_category,originating_source_detail,latest_source_category,latest_source_detail,highest_intent_source_category,highest_intent_rank,current_intent,priority,priority_rank,priority_reason,stage,communication_policy,identity_review_state,activity_count,first_activity_at,last_activity_at)
    values(v_key,v_product_id,v_product_code,v_account_id,v_contact_id,p_payload->>'contactName',v_org,p_payload->>'countryCode',v_category,p_payload->>'sourceDetail',v_category,p_payload->>'sourceDetail',v_category,v_rank,v_intent,v_priority,v_rank,case when v_category='DEMO_REQUEST' then 'Demo request requires immediate response' when v_category='TALK_TO_SALES' then 'Talk-to-sales enquiry requires immediate response' when v_category='TRIAL_STARTED' then 'Trial started and not contacted' when v_category='PRODUCT_ENQUIRY' then 'Product enquiry requires human qualification' when v_category='NEWSLETTER_SIGNUP' then 'Nurture communication only with valid consent' else 'Requested resource delivery; no sales follow-up assumed' end,case when v_category='TRIAL_STARTED' then 'TRIAL_ACTIVE' else 'NEW' end,public.incoming_communication_policy(v_category,v_consent),v_identity_state,1,v_occurred_at,v_occurred_at) returning id into v_lead_id;
  else
    select activity_count into v_activity_count from public.incoming_leads where id=v_lead_id;
    update public.incoming_leads set account_id=coalesce(account_id,v_account_id),contact_id=coalesce(contact_id,v_contact_id),display_name=coalesce(display_name,p_payload->>'contactName'),organisation_name=coalesce(organisation_name,v_org),country_code=coalesce(country_code,p_payload->>'countryCode'),latest_source_category=v_category,latest_source_detail=p_payload->>'sourceDetail',highest_intent_source_category=case when v_rank > highest_intent_rank then v_category else highest_intent_source_category end,highest_intent_rank=greatest(highest_intent_rank,v_rank),current_intent=case when v_rank>=5 then 'VERY_HIGH' when v_rank=4 then 'HIGH' when activity_count+1>=3 then 'MEDIUM' when v_category='NEWSLETTER_SIGNUP' then 'NURTURE' else current_intent end,priority=case when v_rank>=5 then 'URGENT' when v_rank=4 then 'HIGH' when activity_count+1>=3 then 'MEDIUM' else priority end,priority_rank=case when v_rank>=5 then 5 when v_rank=4 then 4 when activity_count+1>=3 then 3 else priority_rank end,priority_reason=case when v_rank>=5 then initcap(replace(lower(v_category),'_',' '))||' requires immediate response' when v_rank=4 then initcap(replace(lower(v_category),'_',' '))||' requires human qualification' when activity_count+1>=3 then 'Downloaded '||(activity_count+1)::text||' Event Suite resources recently' else priority_reason end,stage=case when v_rank>=4 and stage in ('NEW','NURTURE') then 'REVIEWING' else stage end,communication_policy=public.incoming_communication_policy(v_category,v_consent),identity_review_state=case when identity_review_state='RESOLVED' then v_identity_state else identity_review_state end,activity_count=activity_count+1,first_activity_at=least(first_activity_at,v_occurred_at),last_activity_at=greatest(last_activity_at,v_occurred_at),updated_at=now() where id=v_lead_id;
  end if;
  if v_category in ('DEMO_REQUEST','TALK_TO_SALES','TRIAL_STARTED','PRODUCT_ENQUIRY') and v_account_id is not null and v_identity_state='RESOLVED' then
    select id into v_opportunity_id from public.product_opportunities where account_id=v_account_id and product_id=v_product_id and coalesce(metadata->>'incomingLead','false')='true' and stage not in ('converted','disqualified','lost') order by created_at limit 1;
    if v_opportunity_id is null then insert into public.product_opportunities(account_id,product_id,sales_motion_id,stage,conversion_route,metadata) select v_account_id,v_product_id,id,'identified',case when v_category='TRIAL_STARTED' then 'SELF_SERVICE' else 'QUALIFIED_LIVE_DEMO' end,jsonb_build_object('incomingLead',true,'initialSourceCategory',v_category,'trialReference',p_payload->'originalPayload'->>'tenantReference') from public.sales_motions where code='direct' limit 1 returning id into v_opportunity_id; end if;
  end if;
  insert into public.activities(account_id,contact_id,product_opportunity_id,incoming_submission_id,incoming_lead_id,activity_type,occurred_at,summary,metadata) values(v_account_id,v_contact_id,v_opportunity_id,v_submission_id,v_lead_id,v_activity_type,v_occurred_at,v_summary,jsonb_build_object('sourceSystem',v_source_system,'sourceRecordId',v_source_record_id,'sourceCategory',v_category,'sourceDetail',p_payload->>'sourceDetail','sourcePage',p_payload->>'sourcePage','resourceIdentifier',p_payload->>'resourceIdentifier','templateIdentifier',p_payload->>'templateIdentifier','campaignIdentifier',p_payload->>'campaignIdentifier','consentState',v_consent,'firstTouchAttribution',coalesce(p_payload->'firstTouchAttribution','{}'::jsonb),'currentTouchAttribution',coalesce(p_payload->'currentTouchAttribution','{}'::jsonb))) on conflict (incoming_submission_id) do nothing;
  update public.incoming_submissions set incoming_lead_id=v_lead_id, processing_state='PROCESSED',account_id=v_account_id,contact_id=v_contact_id,product_opportunity_id=v_opportunity_id where id=v_submission_id;
  update public.incoming_leads set product_opportunity_id=coalesce(product_opportunity_id,v_opportunity_id),updated_at=now() where id=v_lead_id;
  return query select v_submission_id,v_lead_id,false;
exception when others then
  if v_submission_id is not null then update public.incoming_submissions set processing_state='FAILED',processing_error=left(sqlerrm,1000) where id=v_submission_id; end if;
  raise;
end $$;

create or replace function public.update_incoming_lead(p_lead_id uuid, p_action text, p_value jsonb default '{}'::jsonb)
returns public.incoming_leads
language plpgsql security definer set search_path = public, private, pg_catalog as $$
declare v_role text := private.current_revenue_member_role(); v_old public.incoming_leads; v_new public.incoming_leads; v_stage text; v_owner uuid; v_note text;
begin
  if coalesce(v_role,'') not in ('operator','admin') then raise exception 'INCOMING_LEAD_OPERATOR_REQUIRED'; end if;
  select * into v_old from public.incoming_leads where id=p_lead_id for update; if not found then raise exception 'INCOMING_LEAD_NOT_FOUND'; end if;
  if p_action='ASSIGN_OWNER' then v_owner := nullif(p_value->>'ownerId','')::uuid; if v_owner is not null and not exists(select 1 from public.revenue_members where user_id=v_owner and active) then raise exception 'INCOMING_LEAD_OWNER_INVALID'; end if; update public.incoming_leads set owner_id=v_owner,updated_at=now() where id=p_lead_id;
  elsif p_action='CHANGE_STAGE' then v_stage=upper(p_value->>'stage'); if v_stage not in ('NEW','REVIEWING','QUALIFIED','CONTACTED','DEMO_SCHEDULED','TRIAL_ACTIVE','PROPOSAL','NURTURE','CONVERTED','DISQUALIFIED','LOST') then raise exception 'INCOMING_LEAD_STAGE_INVALID'; end if; update public.incoming_leads set stage=v_stage,qualification_reason=coalesce(nullif(p_value->>'reason',''),qualification_reason),updated_at=now() where id=p_lead_id;
  elsif p_action='SET_NEXT_ACTION' then update public.incoming_leads set next_action=nullif(left(p_value->>'nextAction',500),''),updated_at=now() where id=p_lead_id;
  elsif p_action='SET_FOLLOW_UP' then update public.incoming_leads set follow_up_at=nullif(p_value->>'followUpAt','')::timestamptz,updated_at=now() where id=p_lead_id;
  elsif p_action='MARK_CONTACTED' then update public.incoming_leads set last_contacted_at=now(),stage=case when stage in ('NEW','REVIEWING') then 'CONTACTED' else stage end,updated_at=now() where id=p_lead_id;
  elsif p_action='ADD_NOTE' then v_note=left(trim(p_value->>'note'),2000); if v_note is null or v_note='' then raise exception 'INCOMING_LEAD_NOTE_REQUIRED'; end if; insert into public.incoming_lead_notes(incoming_lead_id,actor_id,note) values(p_lead_id,auth.uid(),v_note);
  elsif p_action='QUALIFY' then update public.incoming_leads set stage='QUALIFIED',qualification_reason=nullif(left(p_value->>'reason',1000),''),updated_at=now() where id=p_lead_id;
  elsif p_action='MOVE_TO_NURTURE' then update public.incoming_leads set stage='NURTURE',updated_at=now() where id=p_lead_id;
  elsif p_action='DISQUALIFY' then update public.incoming_leads set stage='DISQUALIFIED',qualification_reason=nullif(left(p_value->>'reason',1000),''),updated_at=now() where id=p_lead_id;
  elsif p_action='MARK_CONVERTED' then update public.incoming_leads set stage='CONVERTED',conversion_reference=nullif(left(p_value->>'conversionReference',500),''),updated_at=now() where id=p_lead_id;
  else raise exception 'INCOMING_LEAD_ACTION_INVALID'; end if;
  select * into v_new from public.incoming_leads where id=p_lead_id;
  insert into public.incoming_lead_changes(incoming_lead_id,actor_id,action,previous_values,new_values) values(p_lead_id,auth.uid(),p_action,to_jsonb(v_old),case when p_action='ADD_NOTE' then jsonb_build_object('note',v_note) else to_jsonb(v_new) end);
  return v_new;
end $$;

alter table public.incoming_submissions enable row level security;
alter table public.incoming_leads enable row level security;
alter table public.incoming_lead_changes enable row level security;
alter table public.incoming_lead_notes enable row level security;
revoke all on table public.incoming_submissions, public.incoming_leads, public.incoming_lead_changes, public.incoming_lead_notes from anon, authenticated;
grant select on table public.incoming_submissions, public.incoming_leads, public.incoming_lead_changes, public.incoming_lead_notes to authenticated;
revoke all on function public.ingest_incoming_submission(jsonb) from public;
revoke all on function public.update_incoming_lead(uuid,text,jsonb) from public;
grant execute on function public.ingest_incoming_submission(jsonb) to authenticated;
grant execute on function public.update_incoming_lead(uuid,text,jsonb) to authenticated;
revoke all on function public.incoming_communication_policy(text,text) from public;
create policy "active members read incoming submissions" on public.incoming_submissions for select to authenticated using ((select private.is_active_revenue_member()));
create policy "active members read incoming leads" on public.incoming_leads for select to authenticated using ((select private.is_active_revenue_member()));
create policy "active members read incoming lead changes" on public.incoming_lead_changes for select to authenticated using ((select private.is_active_revenue_member()));
create policy "active members read incoming lead notes" on public.incoming_lead_notes for select to authenticated using ((select private.is_active_revenue_member()));

comment on table public.incoming_submissions is 'Immutable inbound interaction ledger. Event Suite delivery is intentionally deferred; V1 supports controlled authenticated fixtures only.';
comment on table public.incoming_leads is 'Incoming operator projection. Separate from ai_prospect_candidates and outbound prospect review.';
comment on column public.contacts.account_id is 'Nullable so an exact-email inbound contact can remain unresolved without manufacturing an account.';
