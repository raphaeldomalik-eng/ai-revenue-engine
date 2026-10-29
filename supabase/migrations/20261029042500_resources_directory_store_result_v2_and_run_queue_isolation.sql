-- Allow nexus.source-discovery-result.v2 in store_nexus_directory_result and scope PER_RUN retry backoff/quarantine to queue_id
create or replace function public.store_nexus_directory_result(p_key text,p_result jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare prior jsonb; retryable boolean;
begin
 if p_key !~ '^[a-f0-9-]{36}$' or p_result->>'contractVersion' not in ('nexus.research-result.v1','nexus.source-discovery-result.v1','nexus.source-discovery-result.v2')
  or nullif(coalesce(p_result->>'requestId',p_result->>'discoveryRequestId'),'') is null then raise exception 'DIRECTORY_RESULT_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_key,0));
 select result_payload into prior from public.nexus_executor_results where idempotency_key=p_key for update;
 if found then
  if prior->'subjectReference' is distinct from p_result->'subjectReference'
   or prior#>'{source,verifiedUrl}' is distinct from p_result#>'{source,verifiedUrl}'
   or prior->'directoryRequestSha256' is distinct from p_result->'directoryRequestSha256'
   or coalesce(prior->>'requestId',prior->>'discoveryRequestId') is distinct from coalesce(p_result->>'requestId',p_result->>'discoveryRequestId')
   then raise exception 'DIRECTORY_RESULT_IDEMPOTENCY_COLLISION'; end if;
  retryable:=prior#>>'{crawl,retryable}'='true' or (prior->>'status'='UNRESOLVED'
   and jsonb_array_length(coalesce(prior->'researchErrors','[]'::jsonb))>0
   and not exists(select 1 from jsonb_array_elements(prior->'researchErrors') e where e->>'retryable' is distinct from 'true'));
  if not coalesce(retryable,false) then return jsonb_build_object('state','REUSED'); end if;
  update public.nexus_executor_results set contract_version=p_result->>'contractVersion',result_payload=p_result where idempotency_key=p_key;
 else
  insert into public.nexus_executor_results(idempotency_key,contract_version,request_id,result_payload)
   values(p_key,p_result->>'contractVersion',coalesce(p_result->>'requestId',p_result->>'discoveryRequestId'),p_result)
   on conflict (request_id) do update
    set idempotency_key=excluded.idempotency_key,
        contract_version=excluded.contract_version,
        result_payload=excluded.result_payload
    where public.nexus_executor_results.result_payload->'subjectReference' is not distinct from excluded.result_payload->'subjectReference';
  if not found then raise exception 'DIRECTORY_RESULT_IDEMPOTENCY_COLLISION'; end if;
 end if;
 return jsonb_build_object('state','STORED');
end; $$;

create or replace function public.reserve_nexus_directory_run_work(p_reservation jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.nexus_directory_standing_policy; run public.nexus_directory_run;req integer;last_host public.nexus_directory_work_receipt;d date:=(now() at time zone 'UTC')::date;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'DIRECTORY_SERVICE_ROLE_REQUIRED';end if;
 select * into p from public.nexus_directory_standing_policy where policy_id=p_reservation->>'policyId' for update;
 if not found or not p.enabled or not coalesce((p.policy->>'enabled')::boolean,false) or p.policy_sha256 is distinct from p_reservation->>'policySha256'
 or p.policy->>'quotaMode' is distinct from 'PER_RUN' or now()<(p.policy->>'validFrom')::timestamptz or now()>=(p.policy->>'validUntil')::timestamptz
 then return jsonb_build_object('state','DENIED','reason','POLICY_INACTIVE');end if;
 if (p.policy->>'paidProviderBudgetUsd')::numeric is distinct from 0 or (p.policy->>'publicationAllowed')::boolean is distinct from false
 or (p.policy->>'outreachAllowed')::boolean is distinct from false or not coalesce(p.policy->'countries' ? (p_reservation->>'country'),false)
 or coalesce(p_reservation->>'action','') not in ('VERIFY_WEBSITE','ENRICH_VERIFIED_VENUE') or not coalesce(p.policy->'actions' ? (p_reservation->>'action'),false)
 then return jsonb_build_object('state','DENIED','reason','POLICY_SCOPE');end if;
 select * into run from public.nexus_directory_run where run_id=(p_reservation->>'runId')::uuid for update;
 if not found or run.policy_id<>p.policy_id or run.policy_sha256<>p.policy_sha256 or run.state<>'RUNNING' or run.lease_until<=now()
 then return jsonb_build_object('state','DENIED','reason','RUN_INACTIVE');end if;
 req:=(p_reservation->>'requestBudget')::integer;
 if req is null or req<1 or req>least(14,(p.policy->>'maxRequestsPerVenue')::integer) or p_reservation->>'day' is distinct from d::text
 or coalesce(p_reservation->>'host','')!~'^[a-z0-9.-]+$' or coalesce(p_reservation->>'reservationKey','')!~'^[a-f0-9]{64}$'
 or nullif(p_reservation->>'queueId','') is null or nullif(p_reservation->>'identityKey','') is null
 then return jsonb_build_object('state','DENIED','reason','RESERVATION_SCOPE');end if;
 perform pg_advisory_xact_lock(hashtext('directory-host:'||(p_reservation->>'host')));
 perform pg_advisory_xact_lock(hashtext('directory-identity:'||(p_reservation->>'identityKey')));
 update public.nexus_directory_work_receipt set state='RETRYABLE',next_attempt_at=now()+((p.policy->>'retryBackoffHours')::integer*interval '1 hour'),receipt=jsonb_build_object('error','WORKER_LEASE_EXPIRED','requestCount',null,'costUsd',null) where policy_id=p.policy_id and state='RESERVED' and lease_until<=now();
 if exists(select 1 from public.nexus_directory_work_receipt where reservation_key=p_reservation->>'reservationKey') then return jsonb_build_object('state','DENIED','reason','REPLAY');end if;
 if exists(select 1 from public.nexus_directory_work_receipt where policy_id=p.policy_id and queue_id=p_reservation->>'queueId' and state='QUARANTINED') then return jsonb_build_object('state','DENIED','reason','IDENTITY_QUARANTINED');end if;
 if (select count(*) from public.nexus_directory_work_receipt where policy_id=p.policy_id and queue_id=p_reservation->>'queueId')>=(p.policy->>'maxAttempts')::integer then return jsonb_build_object('state','DENIED','reason','ATTEMPTS_EXHAUSTED');end if;
 if exists(select 1 from public.nexus_directory_work_receipt where identity_key=p_reservation->>'identityKey' and ((state='RESERVED' and lease_until>now()) or (queue_id=p_reservation->>'queueId' and next_attempt_at>now()))) then return jsonb_build_object('state','DENIED','reason','IDENTITY_ACTIVE_OR_BACKOFF');end if;
 select * into last_host from public.nexus_directory_work_receipt where host=p_reservation->>'host' and (state<>'RESERVED' or lease_until>now()) order by reserved_at desc limit 1;
 if found and (last_host.state='RESERVED' or now()<coalesce(last_host.completed_at,last_host.reserved_at)+((p.policy->>'minHostDelayMs')::integer*interval '1 millisecond')) then return jsonb_build_object('state','DENIED','reason','HOST_ACTIVE_OR_COOLDOWN');end if;
 if run.reserved_venues+1>run.max_venues or run.reserved_requests+req>run.max_requests then return jsonb_build_object('state','DENIED','reason','RUN_BUDGET');end if;
 insert into public.nexus_directory_work_receipt(reservation_key,policy_id,day,queue_id,identity_key,host,country,reserved_requests,run_id,lease_until)
 values(p_reservation->>'reservationKey',p.policy_id,d,p_reservation->>'queueId',p_reservation->>'identityKey',p_reservation->>'host',p_reservation->>'country',req,run.run_id,now()+interval '10 minutes');
 update public.nexus_directory_run set reserved_venues=reserved_venues+1,reserved_requests=reserved_requests+req where run_id=run.run_id;
 return jsonb_build_object('state','RESERVED');
end;$$;
