-- A server-to-server-only intake path. It writes through the same immutable
-- ledger/projection tables as the operator intake, without granting public ingest.
create or replace function public.ingest_event_suite_incoming_submission(p_payload jsonb)
returns table(submission_id uuid, lead_id uuid, duplicate boolean)
language plpgsql security definer set search_path = public, private, pg_catalog as $$
declare
  v_submission_id uuid; v_lead_id uuid; v_product_id uuid; v_account_id uuid; v_contact_id uuid; v_contact_account_id uuid; v_matches integer;
  v_source_record_id text := nullif(trim(p_payload->>'sourceRecordId'),''); v_category text := upper(nullif(trim(p_payload->>'sourceCategory'),''));
  v_email text := nullif(lower(trim(p_payload->>'submittedEmail')),''); v_org text := nullif(trim(p_payload->>'organisationName'),'');
  v_occurred_at timestamptz := coalesce(nullif(p_payload->>'occurredAt','')::timestamptz, now()); v_consent text := upper(coalesce(nullif(p_payload->>'consentState',''),'UNKNOWN'));
  v_environment text := upper(coalesce(nullif(p_payload->>'environment',''),'PRODUCTION')); v_rank integer; v_identity text := 'RESOLVED'; v_key text; v_count integer;
  v_existing_rank integer; v_existing_classification text; v_initial_classification text := upper(coalesce(nullif(p_payload->>'initialClassification',''),'NEEDS_REVIEW'));
  v_initial_reason text := nullif(trim(p_payload->>'initialClassificationReason'),''); v_confidence text := upper(coalesce(p_payload->'originalPayload'->>'organisationConfidence',''));
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'EVENT_SUITE_SERVICE_ROLE_REQUIRED'; end if;
  if p_payload is null or octet_length(p_payload::text) > 100000 then raise exception 'INCOMING_SUBMISSION_PAYLOAD_TOO_LARGE'; end if;
  if p_payload->>'sourceSystem' <> 'event_suite' or v_source_record_id is null or p_payload->>'productCode' <> 'event-suite' or v_category is null then raise exception 'EVENT_SUITE_INCOMING_SUBMISSION_INVALID'; end if;
  if v_category not in ('DEMO_REQUEST','TALK_TO_SALES','TRIAL_STARTED','RESOURCE_DOWNLOAD') or v_environment <> 'PRODUCTION' then raise exception 'EVENT_SUITE_INCOMING_SUBMISSION_INVALID'; end if;
  if v_initial_classification not in ('NEEDS_REVIEW','EXISTING_CUSTOMER') then raise exception 'EVENT_SUITE_CLASSIFICATION_INVALID'; end if;

  insert into public.incoming_submissions (source_system,source_record_id,schema_version,product_code,source_category,source_detail,source_page,resource_identifier,campaign_identifier,contact_name,submitted_email,normalized_contact_email,phone,organisation_name,country_code,consent_state,consent_evidence,first_touch_attribution,current_touch_attribution,occurred_at,environment,is_test,original_payload,processing_state)
  values ('event_suite',v_source_record_id,coalesce(nullif(p_payload->>'schemaVersion',''),'event-suite.incoming-lead.v1'),'event-suite',v_category,p_payload->>'sourceDetail',p_payload->>'sourcePage',p_payload->>'resourceIdentifier',p_payload->>'campaignIdentifier',p_payload->>'contactName',p_payload->>'submittedEmail',v_email,p_payload->>'phone',v_org,p_payload->>'countryCode',v_consent,coalesce(p_payload->'consentEvidence','{}'::jsonb),coalesce(p_payload->'firstTouchAttribution','{}'::jsonb),coalesce(p_payload->'currentTouchAttribution','{}'::jsonb),v_occurred_at,'PRODUCTION',false,coalesce(p_payload->'originalPayload','{}'::jsonb),'PROCESSING')
  on conflict (source_system,source_record_id) do nothing returning id into v_submission_id;
  if v_submission_id is null then
    select id,incoming_lead_id into v_submission_id,v_lead_id from public.incoming_submissions where source_system='event_suite' and source_record_id=v_source_record_id;
    return query select v_submission_id,v_lead_id,true; return;
  end if;
  select id into v_product_id from public.products where code='event-suite' and active=true limit 1;
  if v_product_id is null then raise exception 'INCOMING_PRODUCT_NOT_CONFIGURED'; end if;

  select count(*)::integer into v_matches from public.accounts where v_org is not null and lower(trim(name))=lower(v_org);
  if v_org is not null and (v_confidence='AMBIGUOUS' or v_matches > 1) then v_identity := 'AMBIGUOUS_ACCOUNT';
  elsif v_org is not null and v_matches = 1 then select id into v_account_id from public.accounts where lower(trim(name))=lower(v_org) limit 1;
  elsif v_org is not null and v_confidence='HIGH' then insert into public.accounts(name,source,metadata) values(v_org,'incoming_lead',jsonb_build_object('createdFromIncomingLead',true)) returning id into v_account_id; end if;
  if v_email is null then v_identity := 'MISSING_EMAIL'; else
    select id,account_id into v_contact_id,v_contact_account_id from public.contacts where normalized_email=v_email limit 1;
    if v_contact_id is null then insert into public.contacts(account_id,full_name,email,normalized_email,phone,source,metadata) values(v_account_id,p_payload->>'contactName',p_payload->>'submittedEmail',v_email,p_payload->>'phone','incoming_lead',jsonb_build_object('identityKey','exact_normalized_email')) returning id into v_contact_id;
    elsif v_contact_account_id is null and v_account_id is not null then update public.contacts set account_id=v_account_id where id=v_contact_id;
    elsif v_contact_account_id is not null and v_account_id is null and v_identity <> 'AMBIGUOUS_ACCOUNT' then v_account_id := v_contact_account_id;
    elsif v_contact_account_id is not null and v_account_id is not null and v_contact_account_id<>v_account_id then v_identity := 'AMBIGUOUS_ACCOUNT'; v_account_id := v_contact_account_id; end if;
  end if;
  if v_account_id is null and v_identity='RESOLVED' then v_identity := 'UNRESOLVED'; end if;
  v_key := coalesce(v_email,'submission:'||v_submission_id::text)||'|event-suite';
  v_rank := case when v_category in ('TALK_TO_SALES','DEMO_REQUEST') then 5 when v_category='TRIAL_STARTED' then 4 else 1 end;
  select id,activity_count,highest_intent_rank,lead_classification into v_lead_id,v_count,v_existing_rank,v_existing_classification from public.incoming_leads where canonical_key=v_key limit 1;
  if v_lead_id is null then
    insert into public.incoming_leads(canonical_key,product_id,product_code,account_id,contact_id,display_name,organisation_name,country_code,originating_source_category,originating_source_detail,latest_source_category,latest_source_detail,highest_intent_source_category,highest_intent_rank,current_intent,priority,priority_rank,priority_reason,stage,communication_policy,identity_review_state,activity_count,first_activity_at,last_activity_at,is_test,lead_classification,classification_reason)
    values(v_key,v_product_id,'event-suite',v_account_id,v_contact_id,p_payload->>'contactName',v_org,p_payload->>'countryCode',v_category,p_payload->>'sourceDetail',v_category,p_payload->>'sourceDetail',v_category,v_rank,case when v_rank=5 then 'VERY_HIGH' when v_rank=4 then 'HIGH' else 'LOW' end,case when v_rank=5 then 'URGENT' when v_rank=4 then 'HIGH' else 'STANDARD' end,v_rank,case when v_rank=5 then 'Event Suite high-intent request requires immediate response' when v_rank=4 then 'Event Suite trial activity requires qualification' else 'Requested Event Suite resource; no sales follow-up assumed' end,case when v_category='TRIAL_STARTED' then 'TRIAL_ACTIVE' else 'NEW' end,public.incoming_communication_policy(v_category,v_consent),v_identity,1,v_occurred_at,v_occurred_at,false,v_initial_classification,v_initial_reason) returning id into v_lead_id;
  else
    update public.incoming_leads set account_id=coalesce(account_id,v_account_id),contact_id=coalesce(contact_id,v_contact_id),latest_source_category=v_category,latest_source_detail=p_payload->>'sourceDetail',highest_intent_source_category=case when v_rank>highest_intent_rank then v_category else highest_intent_source_category end,highest_intent_rank=greatest(highest_intent_rank,v_rank),current_intent=case when v_rank>=5 then 'VERY_HIGH' when v_rank=4 then 'HIGH' when activity_count+1>=3 then 'MEDIUM' else current_intent end,priority=case when v_rank>=5 then 'URGENT' when v_rank=4 then 'HIGH' when activity_count+1>=3 then 'MEDIUM' else priority end,priority_rank=greatest(priority_rank,v_rank),stage=case when v_rank>=4 and stage in ('NEW','NURTURE') then 'REVIEWING' else stage end,communication_policy=public.incoming_communication_policy(v_category,v_consent),identity_review_state=case when identity_review_state='RESOLVED' then v_identity else identity_review_state end,activity_count=activity_count+1,first_activity_at=least(first_activity_at,v_occurred_at),last_activity_at=greatest(last_activity_at,v_occurred_at),lead_classification=case when lead_classification='NEEDS_REVIEW' and v_initial_classification='EXISTING_CUSTOMER' then 'EXISTING_CUSTOMER' else lead_classification end,classification_reason=case when lead_classification='NEEDS_REVIEW' and v_initial_classification='EXISTING_CUSTOMER' then v_initial_reason else classification_reason end,updated_at=now() where id=v_lead_id;
  end if;
  insert into public.activities(account_id,contact_id,incoming_submission_id,incoming_lead_id,activity_type,occurred_at,summary,metadata)
  values(v_account_id,v_contact_id,v_submission_id,v_lead_id,case v_category when 'DEMO_REQUEST' then 'demo_requested' when 'TALK_TO_SALES' then 'talk_to_sales_submitted' when 'TRIAL_STARTED' then 'trial_started' else 'resource_downloaded' end,v_occurred_at,coalesce(p_payload->>'sourceDetail',initcap(replace(lower(v_category),'_',' '))),jsonb_build_object('sourceSystem','event_suite','sourceRecordId',v_source_record_id,'sourceCategory',v_category,'consentState',v_consent)) on conflict (incoming_submission_id) do nothing;
  update public.incoming_submissions set incoming_lead_id=v_lead_id,processing_state='PROCESSED',account_id=v_account_id,contact_id=v_contact_id where id=v_submission_id;
  return query select v_submission_id,v_lead_id,false;
exception when others then
  if v_submission_id is not null then update public.incoming_submissions set processing_state='FAILED',processing_error=left(sqlerrm,1000) where id=v_submission_id; end if;
  raise;
end;
$$;
revoke all on function public.ingest_event_suite_incoming_submission(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_event_suite_incoming_submission(jsonb) to service_role;
