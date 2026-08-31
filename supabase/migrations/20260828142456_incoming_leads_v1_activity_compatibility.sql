-- Use the live foundation schema's activities.opportunity_id column.

create or replace function public.ingest_incoming_submission(p_payload jsonb)
returns table(submission_id uuid, lead_id uuid, duplicate boolean)
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
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
  values (v_source_system,v_source_record_id,coalesce(nullif(p_payload->>'schemaVersion',''),'incoming-lead.v1'),v_product_code,v_category,p_payload->>'sourceDetail',p_payload->>'sourcePage',p_payload->>'resourceIdentifier',p_payload->>'templateIdentifier',p_payload->>'campaignIdentifier',p_payload->>'contactName',p_payload->>'submittedEmail',v_email,p_payload->>'phone',v_org,p_payload->>'countryCode',v_consent,coalesce(p_payload->'consentEvidence','{}'::jsonb),coalesce(p_payload->'firstTouchAttribution','{}'::jsonb),coalesce(p_payload->'currentTouchAttribution','{}'::jsonb),v_occurred_at,v_environment,(v_category='INTERNAL_TEST' or v_environment <> 'PRODUCTION'),coalesce(p_payload->'originalPayload','{}'::jsonb),'PROCESSING')
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
    insert into public.incoming_leads(canonical_key,product_id,product_code,account_id,contact_id,display_name,organisation_name,country_code,originating_source_category,originating_source_detail,latest_source_category,latest_source_detail,highest_intent_source_category,highest_intent_rank,current_intent,priority,priority_rank,priority_reason,stage,communication_policy,identity_review_state,activity_count,first_activity_at,last_activity_at,is_test)
    values(v_key,v_product_id,v_product_code,v_account_id,v_contact_id,p_payload->>'contactName',v_org,p_payload->>'countryCode',v_category,p_payload->>'sourceDetail',v_category,p_payload->>'sourceDetail',v_category,v_rank,v_intent,v_priority,v_rank,case when v_category='DEMO_REQUEST' then 'Demo request requires immediate response' when v_category='TALK_TO_SALES' then 'Talk-to-sales enquiry requires immediate response' when v_category='TRIAL_STARTED' then 'Trial started and not contacted' when v_category='PRODUCT_ENQUIRY' then 'Product enquiry requires human qualification' when v_category='NEWSLETTER_SIGNUP' then 'Nurture communication only with valid consent' else 'Requested resource delivery; no sales follow-up assumed' end,case when v_category='TRIAL_STARTED' then 'TRIAL_ACTIVE' else 'NEW' end,public.incoming_communication_policy(v_category,v_consent),v_identity_state,1,v_occurred_at,v_occurred_at,(v_environment <> 'PRODUCTION')) returning id into v_lead_id;
  else
    select activity_count into v_activity_count from public.incoming_leads where id=v_lead_id;
    update public.incoming_leads set account_id=coalesce(account_id,v_account_id),contact_id=coalesce(contact_id,v_contact_id),display_name=coalesce(display_name,p_payload->>'contactName'),organisation_name=coalesce(organisation_name,v_org),country_code=coalesce(country_code,p_payload->>'countryCode'),latest_source_category=v_category,latest_source_detail=p_payload->>'sourceDetail',highest_intent_source_category=case when v_rank > highest_intent_rank then v_category else highest_intent_source_category end,highest_intent_rank=greatest(highest_intent_rank,v_rank),current_intent=case when v_rank>=5 then 'VERY_HIGH' when v_rank=4 then 'HIGH' when activity_count+1>=3 then 'MEDIUM' when v_category='NEWSLETTER_SIGNUP' then 'NURTURE' else current_intent end,priority=case when v_rank>=5 then 'URGENT' when v_rank=4 then 'HIGH' when activity_count+1>=3 then 'MEDIUM' else priority end,priority_rank=case when v_rank>=5 then 5 when v_rank=4 then 4 when activity_count+1>=3 then 3 else priority_rank end,priority_reason=case when v_rank>=5 then initcap(replace(lower(v_category),'_',' '))||' requires immediate response' when v_rank=4 then initcap(replace(lower(v_category),'_',' '))||' requires human qualification' when activity_count+1>=3 then 'Downloaded '||(activity_count+1)::text||' Event Suite resources recently' else priority_reason end,stage=case when v_rank>=4 and stage in ('NEW','NURTURE') then 'REVIEWING' else stage end,communication_policy=public.incoming_communication_policy(v_category,v_consent),identity_review_state=case when identity_review_state='RESOLVED' then v_identity_state else identity_review_state end,activity_count=activity_count+1,first_activity_at=least(first_activity_at,v_occurred_at),last_activity_at=greatest(last_activity_at,v_occurred_at),is_test=is_test or (v_environment <> 'PRODUCTION'),updated_at=now() where id=v_lead_id;
  end if;
  if v_category in ('DEMO_REQUEST','TALK_TO_SALES','TRIAL_STARTED','PRODUCT_ENQUIRY') and v_account_id is not null and v_identity_state='RESOLVED' then
    select id into v_opportunity_id from public.product_opportunities where account_id=v_account_id and product_id=v_product_id and coalesce(metadata->>'incomingLead','false')='true' and stage not in ('converted','disqualified','lost') order by created_at limit 1;
    if v_opportunity_id is null then insert into public.product_opportunities(account_id,product_id,sales_motion_id,stage,conversion_route,metadata) select v_account_id,v_product_id,id,'identified',case when v_category='TRIAL_STARTED' then 'SELF_SERVICE' else 'QUALIFIED_LIVE_DEMO' end,jsonb_build_object('incomingLead',true,'initialSourceCategory',v_category,'trialReference',p_payload->'originalPayload'->>'tenantReference') from public.sales_motions where code='direct' limit 1 returning id into v_opportunity_id; end if;
  end if;
  insert into public.activities(account_id,contact_id,opportunity_id,incoming_submission_id,incoming_lead_id,activity_type,occurred_at,summary,metadata) values(v_account_id,v_contact_id,v_opportunity_id,v_submission_id,v_lead_id,v_activity_type,v_occurred_at,v_summary,jsonb_build_object('sourceSystem',v_source_system,'sourceRecordId',v_source_record_id,'sourceCategory',v_category,'sourceDetail',p_payload->>'sourceDetail','sourcePage',p_payload->>'sourcePage','resourceIdentifier',p_payload->>'resourceIdentifier','templateIdentifier',p_payload->>'templateIdentifier','campaignIdentifier',p_payload->>'campaignIdentifier','consentState',v_consent,'firstTouchAttribution',coalesce(p_payload->'firstTouchAttribution','{}'::jsonb),'currentTouchAttribution',coalesce(p_payload->'currentTouchAttribution','{}'::jsonb))) on conflict (incoming_submission_id) do nothing;
  update public.incoming_submissions set incoming_lead_id=v_lead_id, processing_state='PROCESSED',account_id=v_account_id,contact_id=v_contact_id,product_opportunity_id=v_opportunity_id where id=v_submission_id;
  update public.incoming_leads set product_opportunity_id=coalesce(product_opportunity_id,v_opportunity_id),updated_at=now() where id=v_lead_id;
  return query select v_submission_id,v_lead_id,false;
exception when others then
  if v_submission_id is not null then update public.incoming_submissions set processing_state='FAILED',processing_error=left(sqlerrm,1000) where id=v_submission_id; end if;
  raise;
end $$;
