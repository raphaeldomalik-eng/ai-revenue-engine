-- Additive budgets for the existing standing-directory receipt/outbox pipeline.
-- No policy, allowance, provider call or communication is activated here.
alter table public.nexus_directory_search_allowance add column provider_id text not null default 'brave-web-search'
 check(provider_id in ('brave-web-search','serper-google-search'));
alter table public.nexus_directory_search_allowance add column requires_run boolean not null default false;
alter table public.nexus_directory_search_allowance add column policy_id text references public.nexus_directory_standing_policy;
alter table public.nexus_directory_search_allowance add constraint directory_run_allowance_policy check(not requires_run or policy_id is not null);
-- Retire the historical 100-call test cap; finite account-verified allocations
-- remain mandatory, with only one active allocation per configured provider.
alter table public.nexus_directory_search_allowance drop constraint nexus_directory_search_allowance_allocated_micro_usd_check;
alter table public.nexus_directory_search_allowance add check(allocated_micro_usd between 1 and 5000000);
alter table public.nexus_directory_search_allowance drop constraint nexus_directory_search_allowance_max_requests_check;
alter table public.nexus_directory_search_allowance add check(max_requests between 1 and 10000);
create unique index directory_one_active_provider_allowance on public.nexus_directory_search_allowance(provider_id) where enabled;

create table public.nexus_directory_run (
 run_id uuid primary key default gen_random_uuid(),policy_id text not null references public.nexus_directory_standing_policy,
 policy_sha256 text not null,worker_id text not null,state text not null default 'RUNNING' check(state in ('RUNNING','COMPLETED','EXPIRED')),
 max_venues integer not null check(max_venues between 1 and 500),max_requests integer not null check(max_requests between 1 and 2500),
 reserved_venues integer not null default 0,reserved_requests integer not null default 0,
 brave_max_requests integer not null default 0 check(brave_max_requests between 0 and 500),serper_max_requests integer not null default 0 check(serper_max_requests between 0 and 500),
 brave_requests integer not null default 0,serper_requests integer not null default 0,
 started_at timestamptz not null default now(),lease_until timestamptz not null default now()+interval '30 minutes',completed_at timestamptz,receipt jsonb,
 check(reserved_venues between 0 and max_venues),check(reserved_requests between 0 and max_requests),check(brave_requests between 0 and brave_max_requests),check(serper_requests between 0 and serper_max_requests)
);
create unique index nexus_directory_one_active_run on public.nexus_directory_run(policy_id) where state='RUNNING';
alter table public.nexus_directory_work_receipt add column run_id uuid references public.nexus_directory_run;
alter table public.nexus_directory_run enable row level security;
revoke all on public.nexus_directory_run from public,anon,authenticated;
grant select,insert,update on public.nexus_directory_run to service_role;

create function public.open_nexus_directory_run(p_policy_id text,p_hash text,p_worker text,p_max_venues integer,p_max_requests integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.nexus_directory_standing_policy; run public.nexus_directory_run;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'DIRECTORY_SERVICE_ROLE_REQUIRED';end if;
 select * into p from public.nexus_directory_standing_policy where policy_id=p_policy_id for update;
 if not found or not p.enabled or not coalesce((p.policy->>'enabled')::boolean,false) or p.policy_sha256<>p_hash
 or p.policy->>'quotaMode' is distinct from 'PER_RUN' or now()<(p.policy->>'validFrom')::timestamptz or now()>=(p.policy->>'validUntil')::timestamptz
 then return jsonb_build_object('state','DENIED','reason','POLICY_INACTIVE');end if;
 if nullif(p_worker,'') is null or p_max_venues is null or p_max_requests is null or p_max_venues<1 or p_max_requests<1
 or p_max_venues>least(500,(p.policy->>'maxVenuesPerRun')::integer) or p_max_requests>least(2500,(p.policy->>'maxRequestsPerRun')::integer)
 or p.policy->>'maxVenuesPerRun' is null or p.policy->>'maxRequestsPerRun' is null
 then return jsonb_build_object('state','DENIED','reason','RUN_SCOPE');end if;
 update public.nexus_directory_run active_run set state='EXPIRED',completed_at=now() where policy_id=p_policy_id and state='RUNNING' and lease_until<=now()
 and not exists(select 1 from public.nexus_directory_work_receipt work where work.run_id=active_run.run_id and work.state='RESERVED' and work.lease_until>now());
 if exists(select 1 from public.nexus_directory_run where policy_id=p_policy_id and state='RUNNING') then return jsonb_build_object('state','DENIED','reason','RUN_ACTIVE');end if;
 insert into public.nexus_directory_run(policy_id,policy_sha256,worker_id,max_venues,max_requests,brave_max_requests,serper_max_requests)
 values(p_policy_id,p_hash,p_worker,p_max_venues,p_max_requests,coalesce((p.policy->>'braveMaxRequestsPerRun')::integer,0),coalesce((p.policy->>'serperMaxRequestsPerRun')::integer,0)) returning * into run;
 return jsonb_build_object('state','OPENED','runId',run.run_id,'leaseUntil',run.lease_until);
end;$$;

create function public.reserve_nexus_directory_run_work(p_reservation jsonb) returns jsonb
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
 if exists(select 1 from public.nexus_directory_work_receipt where policy_id=p.policy_id and identity_key=p_reservation->>'identityKey' and state='QUARANTINED') then return jsonb_build_object('state','DENIED','reason','IDENTITY_QUARANTINED');end if;
 if (select count(*) from public.nexus_directory_work_receipt where policy_id=p.policy_id and queue_id=p_reservation->>'queueId')>=(p.policy->>'maxAttempts')::integer then return jsonb_build_object('state','DENIED','reason','ATTEMPTS_EXHAUSTED');end if;
 if exists(select 1 from public.nexus_directory_work_receipt where identity_key=p_reservation->>'identityKey' and ((state='RESERVED' and lease_until>now()) or next_attempt_at>now())) then return jsonb_build_object('state','DENIED','reason','IDENTITY_ACTIVE_OR_BACKOFF');end if;
 select * into last_host from public.nexus_directory_work_receipt where host=p_reservation->>'host' and (state<>'RESERVED' or lease_until>now()) order by reserved_at desc limit 1;
 if found and (last_host.state='RESERVED' or now()<coalesce(last_host.completed_at,last_host.reserved_at)+((p.policy->>'minHostDelayMs')::integer*interval '1 millisecond')) then return jsonb_build_object('state','DENIED','reason','HOST_ACTIVE_OR_COOLDOWN');end if;
 if run.reserved_venues+1>run.max_venues or run.reserved_requests+req>run.max_requests then return jsonb_build_object('state','DENIED','reason','RUN_BUDGET');end if;
 insert into public.nexus_directory_work_receipt(reservation_key,policy_id,day,queue_id,identity_key,host,country,reserved_requests,run_id,lease_until)
 values(p_reservation->>'reservationKey',p.policy_id,d,p_reservation->>'queueId',p_reservation->>'identityKey',p_reservation->>'host',p_reservation->>'country',req,run.run_id,now()+interval '10 minutes');
 update public.nexus_directory_run set reserved_venues=reserved_venues+1,reserved_requests=reserved_requests+req where run_id=run.run_id;
 return jsonb_build_object('state','RESERVED');
end;$$;

create function public.finish_nexus_directory_run(p_run_id uuid,p_worker text,p_receipt jsonb,p_policy_id text,p_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare run public.nexus_directory_run;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'DIRECTORY_SERVICE_ROLE_REQUIRED';end if;
 select * into run from public.nexus_directory_run where run_id=p_run_id for update;
 if not found or run.worker_id is distinct from p_worker or run.policy_id is distinct from p_policy_id or run.policy_sha256 is distinct from p_hash then return jsonb_build_object('state','DENIED','reason','RUN_OWNER');end if;
 if run.state='COMPLETED' then return jsonb_build_object('state','COMPLETED','reused',true);end if;
 if run.state<>'RUNNING' then return jsonb_build_object('state','DENIED','reason','RUN_INACTIVE');end if;
 if exists(select 1 from public.nexus_directory_work_receipt where run_id=p_run_id and state='RESERVED') then return jsonb_build_object('state','DENIED','reason','WORK_ACTIVE');end if;
 update public.nexus_directory_run set state='COMPLETED',completed_at=now(),lease_until=now(),receipt=p_receipt where run_id=p_run_id;
 return jsonb_build_object('state','COMPLETED');
end;$$;
revoke all on function public.open_nexus_directory_run(text,text,text,integer,integer),public.reserve_nexus_directory_run_work(jsonb),public.finish_nexus_directory_run(uuid,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.open_nexus_directory_run(text,text,text,integer,integer),public.reserve_nexus_directory_run_work(jsonb),public.finish_nexus_directory_run(uuid,text,jsonb,text,text) to service_role;

create or replace function public.reserve_directory_search(p_reservation jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.nexus_directory_search_allowance; r public.nexus_directory_search_receipt; run public.nexus_directory_run;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'DIRECTORY_SEARCH_SERVICE_ROLE_REQUIRED'; end if;
 if coalesce(p_reservation->>'querySha256','')!~'^[a-f0-9]{64}$' or nullif(p_reservation->>'requestKey','') is null then raise exception 'DIRECTORY_SEARCH_RESERVATION_INVALID'; end if;
 -- All workers sharing the allowance lock this row before inspecting or reserving credit.
 select * into a from public.nexus_directory_search_allowance where allowance_id=p_reservation->>'allowanceId' for update;

 if a.allowance_id is not null and coalesce(p_reservation#>>'{parameters,provider}','brave-web-search') is distinct from a.provider_id then return jsonb_build_object('state','DENIED','reason','PROVIDER_MISMATCH');end if;
 select * into r from public.nexus_directory_search_receipt where query_sha256=p_reservation->>'querySha256';
 if found then
  if r.state='COMPLETED' and r.cache_expires_at>now() and r.results is not null then return jsonb_build_object('state','CACHED','results',r.results,'observedAt',r.completed_at); end if;
  return jsonb_build_object('state','DENIED','reason','IN_FLIGHT_OR_UNKNOWN');
 end if;
 if a.allowance_id is null or not a.enabled or a.verified_at>now() or a.expires_at<=now() then return jsonb_build_object('state','DENIED','reason','ALLOWANCE_INACTIVE');end if;
 if a.requires_run then
  select * into run from public.nexus_directory_run where run_id=(p_reservation->>'runId')::uuid for update;
  if not found or run.state<>'RUNNING' or run.lease_until<=now() or run.policy_id is distinct from a.policy_id
   or not exists(select 1 from public.nexus_directory_standing_policy p where p.policy_id=run.policy_id and p.enabled and p.policy_sha256=run.policy_sha256 and coalesce((p.policy->>'enabled')::boolean,false) and now()>=(p.policy->>'validFrom')::timestamptz and now()<(p.policy->>'validUntil')::timestamptz)
   then return jsonb_build_object('state','DENIED','reason','RUN_INACTIVE');end if;
  if (a.provider_id='brave-web-search' and run.brave_requests>=run.brave_max_requests) or (a.provider_id='serper-google-search' and run.serper_requests>=run.serper_max_requests)
   then return jsonb_build_object('state','DENIED','reason','RUN_PROVIDER_BUDGET');end if;
 end if;
 if a.request_count>=a.max_requests or a.reserved_micro_usd+a.price_per_request_micro_usd>a.allocated_micro_usd then return jsonb_build_object('state','DENIED','reason','ALLOCATION_EXHAUSTED'); end if;
 insert into public.nexus_directory_search_receipt(query_sha256,allowance_id,request_key,parameters,reserved_micro_usd)
 values(p_reservation->>'querySha256',a.allowance_id,p_reservation->>'requestKey',p_reservation->'parameters',a.price_per_request_micro_usd)
 on conflict do nothing;
 if not found then return jsonb_build_object('state','DENIED','reason','IN_FLIGHT_OR_UNKNOWN'); end if;
 update public.nexus_directory_search_allowance set request_count=request_count+1,reserved_micro_usd=reserved_micro_usd+price_per_request_micro_usd where allowance_id=a.allowance_id;
 if a.requires_run then update public.nexus_directory_run set brave_requests=brave_requests+case when a.provider_id='brave-web-search' then 1 else 0 end,serper_requests=serper_requests+case when a.provider_id='serper-google-search' then 1 else 0 end where run_id=run.run_id;end if;
 return jsonb_build_object('state','RESERVED','reservedMicroUsd',a.price_per_request_micro_usd);
end; $$;
