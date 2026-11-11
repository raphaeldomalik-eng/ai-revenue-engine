CREATE OR REPLACE FUNCTION public.reserve_directory_search(p_reservation jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare a public.nexus_directory_search_allowance;r public.nexus_directory_search_receipt;run public.nexus_directory_run;
 p public.nexus_directory_standing_policy;status jsonb;standing boolean:=false;spent bigint;daily_count bigint;last_reserved timestamptz;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'DIRECTORY_SEARCH_SERVICE_ROLE_REQUIRED';end if;
 if coalesce(p_reservation->>'querySha256','')!~'^[a-f0-9]{64}$' or nullif(p_reservation->>'requestKey','') is null then raise exception 'DIRECTORY_SEARCH_RESERVATION_INVALID';end if;
 select * into a from public.nexus_directory_search_allowance where allowance_id=p_reservation->>'allowanceId' for update;
 if a.allowance_id is not null and coalesce(p_reservation#>>'{parameters,provider}','brave-web-search') is distinct from a.provider_id then return jsonb_build_object('state','DENIED','reason','PROVIDER_MISMATCH');end if;
 select * into r from public.nexus_directory_search_receipt where query_sha256=p_reservation->>'querySha256';
 if found then
  if a.allowance_id is null or r.allowance_id is distinct from a.allowance_id then return jsonb_build_object('state','DENIED','reason','CACHE_PROVIDER_MISMATCH');end if;
  if r.state='COMPLETED' and r.cache_expires_at>now() and r.results is not null then return jsonb_build_object('state','CACHED','results',r.results,'observedAt',r.completed_at);end if;
  return jsonb_build_object('state','DENIED','reason','IN_FLIGHT_OR_UNKNOWN');
 end if;
 if a.allowance_id is null or not a.enabled or a.verified_at>now() or a.expires_at<=now() then return jsonb_build_object('state','DENIED','reason','ALLOWANCE_INACTIVE');end if;
 if a.policy_id is not null then
  select * into p from public.nexus_directory_standing_policy where policy_id=a.policy_id;
  standing:=coalesce((p.policy->>'standing')::boolean,false);
 end if;
 if standing and not a.requires_run then return jsonb_build_object('state','DENIED','reason','RUN_REQUIRED');end if;
 if a.requires_run then
  select * into run from public.nexus_directory_run where run_id=(p_reservation->>'runId')::uuid for update;
  if not found or run.state<>'RUNNING' or run.lease_until<=now() or run.policy_id is distinct from a.policy_id
   or p.policy_sha256 is distinct from run.policy_sha256 or not coalesce(p.enabled,false) or not public.policy_is_active(p.policy)
   then return jsonb_build_object('state','DENIED','reason','RUN_INACTIVE');end if;
  if (a.provider_id='brave-web-search' and run.brave_requests>=run.brave_max_requests)
  or (a.provider_id='serper-google-search' and run.serper_requests>=run.serper_max_requests)
  then return jsonb_build_object('state','DENIED','reason','RUN_PROVIDER_BUDGET');end if;
 end if;
 if standing then
  -- The allowance row lock serializes provider admissions; the run lock also
  -- serializes Brave/Serper competing for the same per-run USD budget.
  status:=public.directory_provider_budget_state(a.allowance_id);
  if (status->>'conservativeRemainingMicroUsd')::bigint<a.price_per_request_micro_usd
  then return jsonb_build_object('state','DENIED','reason',coalesce(status->>'reason','ALLOCATION_EXHAUSTED'),'budget',status);end if;
  select coalesce(sum(reserved_micro_usd),0) into spent from public.nexus_directory_search_receipt where parameters->>'runId'=run.run_id::text;
  if spent+a.price_per_request_micro_usd>least(50000,((p.policy->>'paidProviderBudgetUsd')::numeric*1000000)::bigint)
  then return jsonb_build_object('state','DENIED','reason','RUN_SEARCH_SPEND_BUDGET');end if;
  select count(*) filter(where sr.reserved_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),max(sr.reserved_at)
   into daily_count,last_reserved from public.nexus_directory_search_receipt sr
   join public.nexus_directory_search_allowance own on own.allowance_id=sr.allowance_id
   where own.provider_id=a.provider_id;
  if daily_count>=(case when a.provider_id='brave-web-search' then least(50,coalesce((p.policy#>>'{providerLimits,brave,dailyRequests}')::integer,(p.policy->>'braveMaxRequestsPerDay')::integer,50))
   else least(100,coalesce((p.policy#>>'{providerLimits,serper,dailyRequests}')::integer,(p.policy->>'serperMaxRequestsPerDay')::integer,100)) end)
   then return jsonb_build_object('state','DENIED','reason','PROVIDER_DAILY_BUDGET');end if;
  if last_reserved is not null and clock_timestamp()<last_reserved+greatest(1500,coalesce((p.policy->>'minHostDelayMs')::integer,1500))*interval '1 millisecond'
   then return jsonb_build_object('state','DENIED','reason','PROVIDER_RATE_LIMIT','retryAt',last_reserved+greatest(1500,coalesce((p.policy->>'minHostDelayMs')::integer,1500))*interval '1 millisecond');end if;
 elsif a.request_count>=a.max_requests or a.reserved_micro_usd+a.price_per_request_micro_usd>a.allocated_micro_usd
 then return jsonb_build_object('state','DENIED','reason','ALLOCATION_EXHAUSTED');end if;
 insert into public.nexus_directory_search_receipt(query_sha256,allowance_id,request_key,parameters,reserved_micro_usd)
 values(p_reservation->>'querySha256',a.allowance_id,p_reservation->>'requestKey',
  coalesce(p_reservation->'parameters','{}'::jsonb)||case when a.requires_run then jsonb_build_object('runId',run.run_id) else '{}'::jsonb end,a.price_per_request_micro_usd) on conflict do nothing;
 if not found then return jsonb_build_object('state','DENIED','reason','IN_FLIGHT_OR_UNKNOWN');end if;
 update public.nexus_directory_search_allowance set request_count=request_count+1,reserved_micro_usd=reserved_micro_usd+price_per_request_micro_usd where allowance_id=a.allowance_id;
 if a.requires_run then update public.nexus_directory_run set brave_requests=brave_requests+case when a.provider_id='brave-web-search' then 1 else 0 end,serper_requests=serper_requests+case when a.provider_id='serper-google-search' then 1 else 0 end where run_id=run.run_id;end if;
 return jsonb_build_object('state','RESERVED','reservedMicroUsd',a.price_per_request_micro_usd);
end;$function$
