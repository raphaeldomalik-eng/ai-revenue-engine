-- Reusable Resources scheduling authority. No policy is enabled or seeded by this migration.
create table public.nexus_directory_standing_policy (
 policy_id text primary key, policy_sha256 text not null check(policy_sha256 ~ '^[0-9a-f]{64}$'),
 policy jsonb not null, enabled boolean not null default false, consecutive_failures integer not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.nexus_directory_daily_budget (
 policy_id text references public.nexus_directory_standing_policy(policy_id), day date,
 reserved_venues integer not null default 0 check(reserved_venues>=0), reserved_requests integer not null default 0 check(reserved_requests>=0),
 primary key(policy_id,day)
);
create table public.nexus_directory_work_receipt (
 reservation_key text primary key check(reservation_key ~ '^[0-9a-f]{64}$'),
 policy_id text not null references public.nexus_directory_standing_policy(policy_id), day date not null,
 queue_id text not null, identity_key text not null, host text not null, country text not null,
 reserved_requests integer not null check(reserved_requests between 1 and 14),
 state text not null default 'RESERVED' check(state in ('RESERVED','COMPLETED','RETRYABLE','QUARANTINED')),
 request_count integer check(request_count>=0), cost_usd numeric check(cost_usd>=0),
 next_attempt_at timestamptz, reserved_at timestamptz not null default now(), lease_until timestamptz not null default now()+interval '6 hours', completed_at timestamptz, receipt jsonb
);
create index nexus_directory_work_host_idx on public.nexus_directory_work_receipt(policy_id,host,reserved_at desc);
create index nexus_directory_work_queue_idx on public.nexus_directory_work_receipt(policy_id,queue_id,reserved_at desc);
alter table public.nexus_directory_standing_policy enable row level security;
alter table public.nexus_directory_daily_budget enable row level security;
alter table public.nexus_directory_work_receipt enable row level security;
revoke all on public.nexus_directory_standing_policy,public.nexus_directory_daily_budget,public.nexus_directory_work_receipt from public,anon,authenticated;
grant select,insert,update on public.nexus_directory_standing_policy,public.nexus_directory_daily_budget,public.nexus_directory_work_receipt to service_role;

create function public.reserve_nexus_directory_work(p_reservation jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.nexus_directory_standing_policy%rowtype; b public.nexus_directory_daily_budget%rowtype;
 req integer; d date := (now() at time zone 'UTC')::date; last_host public.nexus_directory_work_receipt%rowtype;
begin
 select * into p from public.nexus_directory_standing_policy where policy_id=p_reservation->>'policyId' for update;
 if not found then return jsonb_build_object('state','DENIED','reason','POLICY_MISSING'); end if;
 if not (p.policy ?& array['enabled','validFrom','validUntil','paidProviderBudgetUsd','publicationAllowed','outreachAllowed','countries','maxRequestsPerVenue','maxVenuesPerDay','maxRequestsPerDay','minHostDelayMs','maxAttempts','retryBackoffHours','stopAfterConsecutiveFailures'])
  then return jsonb_build_object('state','DENIED','reason','POLICY_INCOMPLETE'); end if;
 if not p.enabled or not coalesce((p.policy->>'enabled')::boolean,false) or p.policy_sha256<>p_reservation->>'policySha256'
  or now()<(p.policy->>'validFrom')::timestamptz or now()>=(p.policy->>'validUntil')::timestamptz
  then return jsonb_build_object('state','DENIED','reason','POLICY_INACTIVE_OR_CHANGED'); end if;
 if (p.policy->>'paidProviderBudgetUsd')::numeric<>0 or (p.policy->>'publicationAllowed')::boolean is distinct from false
  or (p.policy->>'outreachAllowed')::boolean is distinct from false or not (p.policy->'countries' ? (p_reservation->>'country'))
  then return jsonb_build_object('state','DENIED','reason','POLICY_SCOPE'); end if;
 req:=(p_reservation->>'requestBudget')::integer;
 if req<1 or req>least(14,(p.policy->>'maxRequestsPerVenue')::integer) or p_reservation->>'day'<>d::text
  or coalesce(p_reservation->>'host','') !~ '^[a-z0-9.-]+$' or coalesce(p_reservation->>'reservationKey','') !~ '^[0-9a-f]{64}$'
  or nullif(p_reservation->>'queueId','') is null or nullif(p_reservation->>'identityKey','') is null
  then return jsonb_build_object('state','DENIED','reason','RESERVATION_SCOPE'); end if;
 if exists(select 1 from public.nexus_directory_work_receipt where reservation_key=p_reservation->>'reservationKey')
  then return jsonb_build_object('state','DENIED','reason','REPLAY'); end if;
 if exists(select 1 from public.nexus_directory_work_receipt where policy_id=p.policy_id and identity_key=p_reservation->>'identityKey' and state='QUARANTINED')
  then return jsonb_build_object('state','DENIED','reason','IDENTITY_QUARANTINED'); end if;
 -- A lost worker never refunds uncertain usage; expire its lease into backed-off retry state.
 update public.nexus_directory_work_receipt set state='RETRYABLE',next_attempt_at=now()+((p.policy->>'retryBackoffHours')::integer*interval '1 hour'),
  receipt=jsonb_build_object('error','WORKER_LEASE_EXPIRED','requestCount',null,'costUsd',null)
  where policy_id=p.policy_id and state='RESERVED' and lease_until<=now();
 if (select count(*) from public.nexus_directory_work_receipt where policy_id=p.policy_id and queue_id=p_reservation->>'queueId') >= (p.policy->>'maxAttempts')::integer
  then return jsonb_build_object('state','DENIED','reason','ATTEMPTS_EXHAUSTED'); end if;
 select * into last_host from public.nexus_directory_work_receipt where policy_id=p.policy_id and host=p_reservation->>'host' order by reserved_at desc limit 1;
 if found and (last_host.state='RESERVED' or now()<coalesce(last_host.completed_at,last_host.reserved_at)+((p.policy->>'minHostDelayMs')::integer * interval '1 millisecond'))
  then return jsonb_build_object('state','DENIED','reason','HOST_ACTIVE_OR_COOLDOWN'); end if;
 if exists(select 1 from public.nexus_directory_work_receipt r where r.policy_id=p.policy_id and r.identity_key=p_reservation->>'identityKey'
   and (r.state='RESERVED' or (r.next_attempt_at is not null and now()<r.next_attempt_at)))
  then return jsonb_build_object('state','DENIED','reason','IDENTITY_ACTIVE_OR_BACKOFF'); end if;
 insert into public.nexus_directory_daily_budget(policy_id,day) values(p.policy_id,d) on conflict do nothing;
 select * into b from public.nexus_directory_daily_budget where policy_id=p.policy_id and day=d for update;
 if b.reserved_venues+1>(p.policy->>'maxVenuesPerDay')::integer or b.reserved_requests+req>(p.policy->>'maxRequestsPerDay')::integer
  then return jsonb_build_object('state','DENIED','reason','DAILY_BUDGET'); end if;
 insert into public.nexus_directory_work_receipt(reservation_key,policy_id,day,queue_id,identity_key,host,country,reserved_requests)
 values(p_reservation->>'reservationKey',p.policy_id,d,p_reservation->>'queueId',p_reservation->>'identityKey',p_reservation->>'host',p_reservation->>'country',req);
 update public.nexus_directory_daily_budget set reserved_venues=reserved_venues+1,reserved_requests=reserved_requests+req where policy_id=p.policy_id and day=d;
 return jsonb_build_object('state','RESERVED');
end; $$;

create function public.complete_nexus_directory_work(p_receipt jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.nexus_directory_work_receipt%rowtype; actual integer; cost numeric; outcome text; p public.nexus_directory_standing_policy%rowtype;
begin
 select * into p from public.nexus_directory_standing_policy where policy_id=p_receipt->>'policyId' for update;
 if not found then return jsonb_build_object('state','DENIED','reason','POLICY_MISSING'); end if;
 select * into r from public.nexus_directory_work_receipt where reservation_key=p_receipt->>'reservationKey' for update;
 if not found or r.state<>'RESERVED' or r.policy_id<>p_receipt->>'policyId' or r.queue_id<>p_receipt->>'queueId'
  then return jsonb_build_object('state','DENIED','reason','RECEIPT_NOT_RESERVED'); end if;
 actual:=(p_receipt->>'requestCount')::integer;cost:=(p_receipt->>'costUsd')::numeric;outcome:=p_receipt->>'state';
 if outcome not in ('COMPLETED','RETRYABLE','QUARANTINED') or actual<0 or cost<0 then return jsonb_build_object('state','DENIED','reason','RECEIPT_INVALID'); end if;
 if actual>r.reserved_requests or cost>0 then
  outcome:='QUARANTINED';update public.nexus_directory_standing_policy set enabled=false,updated_at=now() where policy_id=r.policy_id;
 end if;
 update public.nexus_directory_work_receipt set state=outcome,request_count=actual,cost_usd=cost,
  next_attempt_at=(p_receipt->>'nextAttemptAt')::timestamptz,receipt=p_receipt,completed_at=now() where reservation_key=r.reservation_key;
 update public.nexus_directory_standing_policy set consecutive_failures=case when outcome='COMPLETED' then 0 else consecutive_failures+1 end,
  enabled=enabled and (outcome='COMPLETED' or consecutive_failures+1<(policy->>'stopAfterConsecutiveFailures')::integer),updated_at=now() where policy_id=r.policy_id;
 return jsonb_build_object('state','RECORDED');
end; $$;
revoke all on function public.reserve_nexus_directory_work(jsonb),public.complete_nexus_directory_work(jsonb) from public,anon,authenticated;
grant execute on function public.reserve_nexus_directory_work(jsonb),public.complete_nexus_directory_work(jsonb) to service_role;
