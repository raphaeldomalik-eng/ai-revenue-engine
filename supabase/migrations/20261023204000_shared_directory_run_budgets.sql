-- Opt-in bounded runs. Existing daily policies retain their existing semantics.
create table public.nexus_directory_run_budget (
 policy_id text not null references public.nexus_directory_standing_policy(policy_id),
 run_id uuid not null,
 reserved_venues integer not null default 0 check(reserved_venues between 0 and 500),
 reserved_requests integer not null default 0 check(reserved_requests between 0 and 2500),
 created_at timestamptz not null default now(),
 primary key(policy_id,run_id)
);
alter table public.nexus_directory_run_budget enable row level security;
revoke all on public.nexus_directory_run_budget from public,anon,authenticated;
grant select on public.nexus_directory_run_budget to service_role;
alter table public.nexus_directory_work_receipt add column run_id uuid;

create or replace function public.reserve_nexus_directory_work(p_reservation jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.nexus_directory_standing_policy%rowtype; b public.nexus_directory_daily_budget%rowtype;
 rb public.nexus_directory_run_budget%rowtype; run_key uuid; per_run boolean;
 req integer; d date := (now() at time zone 'UTC')::date; last_host public.nexus_directory_work_receipt%rowtype;
begin
 select * into p from public.nexus_directory_standing_policy where policy_id=p_reservation->>'policyId' for update;
 if not found then return jsonb_build_object('state','DENIED','reason','POLICY_MISSING'); end if;
 per_run:=coalesce(p.policy->>'budgetMode'='PER_RUN',false);
 if not (p.policy ?& array['enabled','validFrom','validUntil','paidProviderBudgetUsd','publicationAllowed','outreachAllowed','countries','maxRequestsPerVenue','minHostDelayMs','maxAttempts','retryBackoffHours','stopAfterConsecutiveFailures'])
  or not (p.policy ?& case when per_run then array['maxVenuesPerRun','maxRequestsPerRun'] else array['maxVenuesPerDay','maxRequestsPerDay'] end)
  then return jsonb_build_object('state','DENIED','reason','POLICY_INCOMPLETE'); end if;
 if not p.enabled or not coalesce((p.policy->>'enabled')::boolean,false) or p.policy_sha256 is distinct from p_reservation->>'policySha256'
  or now()<(p.policy->>'validFrom')::timestamptz or now()>=(p.policy->>'validUntil')::timestamptz
  then return jsonb_build_object('state','DENIED','reason','POLICY_INACTIVE_OR_CHANGED'); end if;
 if (p.policy->>'paidProviderBudgetUsd')::numeric is distinct from 0 or (p.policy->>'publicationAllowed')::boolean is distinct from false
  or (p.policy->>'outreachAllowed')::boolean is distinct from false or not coalesce(p.policy->'countries' ? (p_reservation->>'country'),false)
  then return jsonb_build_object('state','DENIED','reason','POLICY_SCOPE'); end if;
 if coalesce(p_reservation->>'action','ENRICH_VERIFIED_VENUE') not in ('ENRICH_VERIFIED_VENUE','VERIFY_WEBSITE')
  or not (coalesce(p.policy->'actions','["ENRICH_VERIFIED_VENUE"]'::jsonb) ? coalesce(p_reservation->>'action','ENRICH_VERIFIED_VENUE'))
  then return jsonb_build_object('state','DENIED','reason','POLICY_ACTION'); end if;
 req:=(p_reservation->>'requestBudget')::integer;
 if req is null or req<1 or req>least(14,(p.policy->>'maxRequestsPerVenue')::integer) or p_reservation->>'day' is distinct from d::text
  or coalesce(p_reservation->>'host','') !~ '^[a-z0-9.-]+$' or coalesce(p_reservation->>'reservationKey','') !~ '^[0-9a-f]{64}$'
  or nullif(p_reservation->>'queueId','') is null or nullif(p_reservation->>'identityKey','') is null
  then return jsonb_build_object('state','DENIED','reason','RESERVATION_SCOPE'); end if;
 if per_run then
  if coalesce(p_reservation->>'runId','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
   or coalesce((p.policy->>'maxVenuesPerRun')::integer,0) not between 1 and 500
   or coalesce((p.policy->>'maxRequestsPerRun')::integer,0) not between 1 and 2500
   or p.policy ?| array['maxVenuesPerDay','maxRequestsPerDay']
   then return jsonb_build_object('state','DENIED','reason','RUN_SCOPE'); end if;
  run_key:=(p_reservation->>'runId')::uuid;
 end if;
 if exists(select 1 from public.nexus_directory_work_receipt where reservation_key=p_reservation->>'reservationKey')
  then return jsonb_build_object('state','DENIED','reason','REPLAY'); end if;
 if exists(select 1 from public.nexus_directory_work_receipt where policy_id=p.policy_id and queue_id=p_reservation->>'queueId' and (state='QUARANTINED' or (per_run and state='COMPLETED')))
  then return jsonb_build_object('state','DENIED','reason',case when per_run then 'QUEUE_ALREADY_FINAL' else 'IDENTITY_QUARANTINED' end); end if;
 -- Never refund uncertain usage when a worker disappears.
 update public.nexus_directory_work_receipt set state='RETRYABLE',next_attempt_at=now()+((p.policy->>'retryBackoffHours')::integer*interval '1 hour'),
  receipt=jsonb_build_object('error','WORKER_LEASE_EXPIRED','requestCount',null,'costUsd',null)
  where policy_id=p.policy_id and state='RESERVED' and lease_until<=now();
 if (select count(*) from public.nexus_directory_work_receipt where policy_id=p.policy_id and queue_id=p_reservation->>'queueId') >= (p.policy->>'maxAttempts')::integer
  then return jsonb_build_object('state','DENIED','reason','ATTEMPTS_EXHAUSTED'); end if;
 select * into last_host from public.nexus_directory_work_receipt where policy_id=p.policy_id and host=p_reservation->>'host' order by reserved_at desc limit 1;
 if found and (last_host.state='RESERVED' or now()<coalesce(last_host.completed_at,last_host.reserved_at)+((p.policy->>'minHostDelayMs')::integer * interval '1 millisecond'))
  then return jsonb_build_object('state','DENIED','reason','HOST_ACTIVE_OR_COOLDOWN'); end if;
 if exists(select 1 from public.nexus_directory_work_receipt r where r.policy_id=p.policy_id and r.identity_key=p_reservation->>'identityKey' and r.host=p_reservation->>'host'
   and (r.state='RESERVED' or (r.next_attempt_at is not null and now()<r.next_attempt_at)))
  then return jsonb_build_object('state','DENIED','reason','IDENTITY_ACTIVE_OR_BACKOFF'); end if;
 if per_run then
  insert into public.nexus_directory_run_budget(policy_id,run_id) values(p.policy_id,run_key) on conflict do nothing;
  select * into rb from public.nexus_directory_run_budget where policy_id=p.policy_id and run_id=run_key for update;
  if rb.created_at<now()-interval '6 hours' or rb.reserved_venues+1>(p.policy->>'maxVenuesPerRun')::integer
   or rb.reserved_requests+req>(p.policy->>'maxRequestsPerRun')::integer then return jsonb_build_object('state','DENIED','reason','RUN_BUDGET'); end if;
 else
  insert into public.nexus_directory_daily_budget(policy_id,day) values(p.policy_id,d) on conflict do nothing;
  select * into b from public.nexus_directory_daily_budget where policy_id=p.policy_id and day=d for update;
  if b.reserved_venues+1>(p.policy->>'maxVenuesPerDay')::integer or b.reserved_requests+req>(p.policy->>'maxRequestsPerDay')::integer
   then return jsonb_build_object('state','DENIED','reason','DAILY_BUDGET'); end if;
 end if;
 insert into public.nexus_directory_work_receipt(reservation_key,policy_id,day,queue_id,identity_key,host,country,reserved_requests,run_id)
 values(p_reservation->>'reservationKey',p.policy_id,d,p_reservation->>'queueId',p_reservation->>'identityKey',p_reservation->>'host',p_reservation->>'country',req,run_key);
 if per_run then
  update public.nexus_directory_run_budget set reserved_venues=reserved_venues+1,reserved_requests=reserved_requests+req where policy_id=p.policy_id and run_id=run_key;
 else
  update public.nexus_directory_daily_budget set reserved_venues=reserved_venues+1,reserved_requests=reserved_requests+req where policy_id=p.policy_id and day=d;
 end if;
 return jsonb_build_object('state','RESERVED');
end; $$;
revoke all on function public.reserve_nexus_directory_work(jsonb) from public,anon,authenticated;
grant execute on function public.reserve_nexus_directory_work(jsonb) to service_role;
