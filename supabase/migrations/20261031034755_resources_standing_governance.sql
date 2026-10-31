-- Additive standing governance over existing allowance, receipt and run ledgers.
-- No policy/allowance is enabled, no balance is invented and no usage is reset.
alter table public.nexus_directory_search_allowance
 add column provider_account_snapshot jsonb not null default '{}'::jsonb check(jsonb_typeof(provider_account_snapshot)='object'),
 add column provider_account_history jsonb not null default '[]'::jsonb check(jsonb_typeof(provider_account_history)='array'),
 add column provider_alert_state jsonb not null default '{}'::jsonb check(jsonb_typeof(provider_alert_state)='object');
-- Brave lifetime counters are retained; its finite ceiling is enforced by UTC
-- receipt month plus the observed external baseline. Serper remains lifetime stock.
-- Read-only Production catalog check 2026-10-31 confirmed separate upper/lower
-- checks. Also accept only these equivalent combined legacy nonnegative forms;
-- preserve nonnegative bounds explicitly in both replacement constraints.
do $$declare c record;begin
 for c in select conname from pg_constraint where conrelid='public.nexus_directory_search_allowance'::regclass and contype='c'
 and regexp_replace(pg_get_constraintdef(oid),'[[:space:]()]','','g') in
 ('CHECKreserved_micro_usd<=allocated_micro_usd','CHECKrequest_count<=max_requests',
 'CHECKreserved_micro_usd>=0ANDreserved_micro_usd<=allocated_micro_usd','CHECKreserved_micro_usd<=allocated_micro_usdANDreserved_micro_usd>=0',
 'CHECKrequest_count>=0ANDrequest_count<=max_requests','CHECKrequest_count<=max_requestsANDrequest_count>=0')
 loop execute format('alter table public.nexus_directory_search_allowance drop constraint %I',c.conname);end loop;
end;$$;
alter table public.nexus_directory_search_allowance
 add constraint directory_provider_lifetime_credit check(reserved_micro_usd>=0 and (provider_id='brave-web-search' or reserved_micro_usd<=allocated_micro_usd)),
 add constraint directory_provider_lifetime_calls check(request_count>=0 and (provider_id='brave-web-search' or request_count<=max_requests));

create function public.policy_is_active(p_policy jsonb) returns boolean
language plpgsql stable set search_path=pg_catalog as $$
begin
 if not coalesce((p_policy->>'enabled')::boolean,false) or p_policy->>'validFrom' is null
 or now()<(p_policy->>'validFrom')::timestamptz then return false;end if;
 if p_policy->>'validUntil' is not null and now()>=(p_policy->>'validUntil')::timestamptz then return false;end if;
 if not coalesce((p_policy->>'standing')::boolean,false) then return p_policy->>'validUntil' is not null;end if;
 return coalesce((p_policy->>'quotaMode'='PER_RUN'
 and (p_policy->>'paidProviderBudgetUsd')::numeric between 0 and 0.05
 and (p_policy->>'maxVenuesPerRun')::integer between 1 and 10
 and (p_policy->>'maxRequestsPerRun')::integer between 1 and 140
 and (p_policy->>'maxVenuesPerDay')::integer between 1 and 100
 and (p_policy->>'maxRequestsPerDay')::integer between 1 and 1400
 and (p_policy->>'braveMaxRequestsPerRun')::integer between 0 and 2
 and (p_policy->>'serperMaxRequestsPerRun')::integer between 0 and 8
 and (p_policy->>'minHostDelayMs')::integer>=1500
 and p_policy->'publicationAllowed'='false'::jsonb and p_policy->'productPublicationAllowed'='false'::jsonb
 and p_policy->'outreachAllowed'='false'::jsonb),false);
exception when others then return false;
end;$$;

-- Internal service-only calculation accepts an explicit instant for deterministic
-- rollover verification. Production reservation always supplies clock_timestamp().
create function public.directory_provider_budget_state(p_allowance_id text,p_at timestamptz default clock_timestamp()) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare a public.nexus_directory_search_allowance;s jsonb;month_ledger bigint;month_used bigint;burn bigint;debt bigint;
 projected bigint;expired_grant bigint:=0;remaining bigint;allowance_remaining bigint;denominator bigint;expiry timestamptz;stage text;reason text;
 account_basis numeric;provider_fraction numeric;internal_fraction numeric;alert_fraction numeric;policy jsonb;reserve_micro_usd bigint;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'DIRECTORY_SERVICE_ROLE_REQUIRED';end if;
 select * into a from public.nexus_directory_search_allowance where allowance_id=p_allowance_id;
 if not found then return jsonb_build_object('state','DENIED','reason','ALLOWANCE_MISSING');end if;
 select p.policy into policy from public.nexus_directory_standing_policy p where p.policy_id=a.policy_id;
 s:=a.provider_account_snapshot;
 select coalesce(sum(reserved_micro_usd) filter(where reserved_at>=date_trunc('month',p_at at time zone 'UTC') at time zone 'UTC' and reserved_at<=p_at),0),
 coalesce(sum(reserved_micro_usd) filter(where reserved_at>=p_at-interval '24 hours' and reserved_at<=p_at),0)
 into month_ledger,burn from public.nexus_directory_search_receipt where allowance_id=a.allowance_id;
 month_used:=month_ledger;
 if s->>'providerMonth'=to_char(p_at at time zone 'UTC','YYYY-MM') then
  month_used:=greatest(month_ledger,coalesce((s->>'providerMonthConsumedMicroUsd')::bigint,0)+greatest(0,month_ledger-coalesce((s->>'ledgerMonthReservedMicroUsd')::bigint,0)));
 end if;
 debt:=greatest(0,a.reserved_micro_usd-coalesce((s->>'ledgerReservedMicroUsd')::bigint,0));
 if s->>'grantExpiresAt' is not null and p_at>=(s->>'grantExpiresAt')::timestamptz then
  expired_grant:=greatest(0,coalesce((s->>'grantRemainingMicroUsd')::bigint,0)-debt);
 end if;
 projected:=greatest(0,coalesce((s->>'availableMicroUsd')::bigint,0)-debt-expired_grant);
 expiry:=least(a.expires_at,coalesce((s->>'creditExpiresAt')::timestamptz,a.expires_at));
 if a.provider_id='brave-web-search' then
  denominator:=least(a.allocated_micro_usd,10000000,a.max_requests::bigint*a.price_per_request_micro_usd,
   greatest(0,(coalesce((policy#>>'{providerLimits,brave,monthlyUsd}')::numeric,(policy->>'braveMonthlyBudgetUsd')::numeric,10)*1000000)::bigint));
  reserve_micro_usd:=greatest(500000,(coalesce((policy#>>'{providerLimits,brave,reserveUsd}')::numeric,0.5)*1000000)::bigint);
  allowance_remaining:=greatest(0,denominator-month_used);
  remaining:=least(allowance_remaining,greatest(0,projected-reserve_micro_usd));
 else
  denominator:=least(a.allocated_micro_usd,5000000,a.max_requests::bigint*a.price_per_request_micro_usd,
   greatest(0,(coalesce((policy#>>'{providerLimits,serper,allocationUsd}')::numeric,5)*1000000)::bigint));
  allowance_remaining:=least(greatest(0,denominator-a.reserved_micro_usd),greatest(0,(a.max_requests-a.request_count)::bigint*a.price_per_request_micro_usd));
  remaining:=least(allowance_remaining,projected);
 end if;
 reason:=case when s='{}'::jsonb then 'PROVIDER_BALANCE_UNVERIFIED'
 when not a.enabled or a.verified_at>p_at or expiry<=p_at then 'ALLOWANCE_INACTIVE'
 when a.provider_id='brave-web-search' and projected<reserve_micro_usd+a.price_per_request_micro_usd then 'PROVIDER_ACCOUNT_RESERVE'
 when remaining<a.price_per_request_micro_usd then 'ALLOCATION_EXHAUSTED' else null end;
 if reason is not null then remaining:=0;end if;
 -- Alert thresholds describe actual credit/stock fractions. The USD 0.50
 -- spend reserve still blocks admission immediately, but does not advance
 -- 25%/10% alerts to 30%/15% of the original credit balance.
 account_basis:=coalesce((s->>'accountCreditBasisMicroUsd')::numeric,
  coalesce((s->>'availableMicroUsd')::numeric,0)+coalesce((s->>'providerMonthConsumedMicroUsd')::numeric,0));
 provider_fraction:=case when account_basis>0 then least(1,projected::numeric/account_basis) else 0 end;
 internal_fraction:=case when denominator>0 then least(1,allowance_remaining::numeric/denominator) else 0 end;
 alert_fraction:=least(provider_fraction,internal_fraction);
 stage:=case when remaining<a.price_per_request_micro_usd then 'blocked' when alert_fraction<=0.10 then '10_percent'
 when alert_fraction<=0.25 then '25_percent' else 'healthy' end;
 return jsonb_build_object('providerId',a.provider_id,'allowanceId',a.allowance_id,'authoritativeBalanceMicroUsd',s->'availableMicroUsd',
 'verifiedAt',s->'verifiedAt','verificationRef',s->'verificationRef','projectedBalanceMicroUsd',projected,
 'ledgerDebtMicroUsd',debt,'expiredGrantMicroUsd',expired_grant,'conservativeRemainingMicroUsd',remaining,
 'actualRemainingAllowanceMicroUsd',allowance_remaining,'budgetPeriod',case when a.provider_id='brave-web-search' then 'MONTHLY' else 'LIFETIME' end,
 'providerRemainingFraction',provider_fraction,'internalRemainingFraction',internal_fraction,'accountCreditBasisMicroUsd',account_basis,
 'reserveMicroUsd',coalesce(reserve_micro_usd,0),'internalCeilingMicroUsd',denominator,
 'currentMonthConsumptionMicroUsd',month_used,'last24hBurnMicroUsd',burn,
 'remainingRequests',remaining/a.price_per_request_micro_usd,'expiresAt',expiry,'grantExpiresAt',s->'grantExpiresAt',
 'currentStage',stage,'reason',reason,'lifetimeRequestCount',a.request_count,'lifetimeReservedMicroUsd',a.reserved_micro_usd);
end;$$;

create function public.read_directory_provider_budget_status(p_policy_id text,p_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare providers jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'DIRECTORY_SERVICE_ROLE_REQUIRED';end if;
 if not exists(select 1 from public.nexus_directory_standing_policy where policy_id=p_policy_id and policy_sha256=p_hash)
 then return jsonb_build_object('state','DENIED','reason','POLICY_SCOPE');end if;
 select coalesce(jsonb_agg(public.directory_provider_budget_state(allowance_id) order by provider_id),'[]'::jsonb) into providers
 from public.nexus_directory_search_allowance where policy_id=p_policy_id;
 return jsonb_build_object('state','READ','policyId',p_policy_id,'observedAt',clock_timestamp(),'providers',providers);
end;$$;

create function public.observe_directory_provider_balance(p_policy_id text,p_hash text,p_provider text,p_observation jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.nexus_directory_search_allowance;v timestamptz; k text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'DIRECTORY_SERVICE_ROLE_REQUIRED';end if;
 if not exists(select 1 from public.nexus_directory_standing_policy where policy_id=p_policy_id and policy_sha256=p_hash)
 then return jsonb_build_object('state','DENIED','reason','POLICY_SCOPE');end if;
 select * into a from public.nexus_directory_search_allowance where policy_id=p_policy_id and provider_id=p_provider and enabled for update;
 if not found then return jsonb_build_object('state','DENIED','reason','ALLOWANCE_MISSING');end if;
 if jsonb_typeof(p_observation) is distinct from 'object' or nullif(p_observation->>'verificationRef','') is null
 or p_observation->>'verifiedAt' is null or coalesce(p_observation->>'providerMonth','')!~'^[0-9]{4}-[0-9]{2}$'
 then raise exception 'DIRECTORY_PROVIDER_OBSERVATION_INVALID';end if;
 foreach k in array array['availableMicroUsd','ledgerReservedMicroUsd','ledgerRequestCount','ledgerMonthReservedMicroUsd','providerMonthConsumedMicroUsd'] loop
  if coalesce(p_observation->>k,'')!~'^[0-9]+$' then raise exception 'DIRECTORY_PROVIDER_OBSERVATION_INVALID';end if;
 end loop;
 if p_observation?'accountCreditBasisMicroUsd' and (coalesce(p_observation->>'accountCreditBasisMicroUsd','')!~'^[0-9]+$'
 or (p_observation->>'accountCreditBasisMicroUsd')::numeric<=0) then raise exception 'DIRECTORY_PROVIDER_OBSERVATION_INVALID';end if;
 v:=(p_observation->>'verifiedAt')::timestamptz;
 if v>clock_timestamp() or (a.provider_account_snapshot->>'verifiedAt' is not null and v<(a.provider_account_snapshot->>'verifiedAt')::timestamptz)
 or (p_observation->>'ledgerReservedMicroUsd')::bigint>a.reserved_micro_usd
 or (p_observation->>'ledgerRequestCount')::bigint>a.request_count
 or (p_observation->>'ledgerMonthReservedMicroUsd')::bigint>(p_observation->>'ledgerReservedMicroUsd')::bigint
 then raise exception 'DIRECTORY_PROVIDER_OBSERVATION_SCOPE';end if;
 if (p_provider='brave-web-search' and coalesce(p_observation->>'grantRemainingMicroUsd','')!~'^[0-9]+$')
 or (p_observation?'grantRemainingMicroUsd' and (coalesce(p_observation->>'grantRemainingMicroUsd','')!~'^[0-9]+$'
 or ((p_observation->>'grantRemainingMicroUsd')::numeric>0 and p_observation->>'grantExpiresAt' is null)
 or (p_observation->>'grantRemainingMicroUsd')::numeric>(p_observation->>'availableMicroUsd')::numeric))
 then raise exception 'DIRECTORY_PROVIDER_GRANT_INVALID';end if;
 if p_observation->>'grantExpiresAt' is not null then perform (p_observation->>'grantExpiresAt')::timestamptz;end if;
 if p_observation->>'creditExpiresAt' is not null then perform (p_observation->>'creditExpiresAt')::timestamptz;end if;
 if a.provider_account_snapshot=p_observation then return jsonb_build_object('state','REUSED');end if;
 update public.nexus_directory_search_allowance set provider_account_snapshot=p_observation,
 provider_account_history=provider_account_history||jsonb_build_array(p_observation) where allowance_id=a.allowance_id;
 return jsonb_build_object('state','RECORDED','allowanceId',a.allowance_id);
end;$$;

create function public.claim_directory_provider_alert(p_policy_id text,p_hash text,p_provider text,p_stage text,p_period text,p_alert jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.nexus_directory_search_allowance;prior jsonb;key text; id uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'DIRECTORY_SERVICE_ROLE_REQUIRED';end if;
 if p_provider is distinct from 'brave-web-search' then return jsonb_build_object('state','DENIED','reason','PROVIDER_NOT_ALERTABLE');end if;
 if p_stage not in ('25_percent','10_percent','blocked') or p_period is distinct from to_char(clock_timestamp() at time zone 'UTC','YYYY-MM')
 or jsonb_typeof(p_alert) is distinct from 'object' or octet_length(p_alert::text)>16000 then raise exception 'DIRECTORY_ALERT_SCOPE';end if;
 if not exists(select 1 from public.nexus_directory_standing_policy where policy_id=p_policy_id and policy_sha256=p_hash)
 then return jsonb_build_object('state','DENIED','reason','POLICY_SCOPE');end if;
 select * into a from public.nexus_directory_search_allowance where policy_id=p_policy_id and provider_id=p_provider and enabled for update;
 if not found then return jsonb_build_object('state','DENIED','reason','ALLOWANCE_MISSING');end if;
 key:=p_period||':'||p_stage;prior:=a.provider_alert_state->key;
 if prior->>'messageQueueId' is not null then return prior||jsonb_build_object('state','REUSED');end if;
 if prior->>'state'='CLAIMED' and (prior->>'leaseUntil')::timestamptz>clock_timestamp() then return prior||jsonb_build_object('state','INFLIGHT');end if;
 id:=coalesce((prior->>'idempotencyKey')::uuid,gen_random_uuid());
 prior:=jsonb_build_object('state','CLAIMED','idempotencyKey',id,'stage',p_stage,'period',p_period,'leaseUntil',clock_timestamp()+interval '5 minutes','alert',p_alert);
 update public.nexus_directory_search_allowance set provider_alert_state=jsonb_set(provider_alert_state,array[key],prior) where allowance_id=a.allowance_id;
 return prior;
end;$$;

create function public.complete_directory_provider_alert(p_policy_id text,p_hash text,p_provider text,p_stage text,p_period text,p_message_queue_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.nexus_directory_search_allowance;prior jsonb;key text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'DIRECTORY_SERVICE_ROLE_REQUIRED';end if;
 if p_provider is distinct from 'brave-web-search' then return jsonb_build_object('state','DENIED','reason','PROVIDER_NOT_ALERTABLE');end if;
 if not exists(select 1 from public.nexus_directory_standing_policy where policy_id=p_policy_id and policy_sha256=p_hash)
 then return jsonb_build_object('state','DENIED','reason','POLICY_SCOPE');end if;
 select * into a from public.nexus_directory_search_allowance where policy_id=p_policy_id and provider_id=p_provider and enabled for update;
 key:=p_period||':'||p_stage;prior:=a.provider_alert_state->key;
 if prior is null then return jsonb_build_object('state','DENIED','reason','ALERT_NOT_CLAIMED');end if;
 if prior->>'messageQueueId' is not null then
  if p_message_queue_id is distinct from (prior->>'messageQueueId')::uuid then raise exception 'DIRECTORY_ALERT_QUEUE_COLLISION';end if;
  return prior||jsonb_build_object('state','REUSED');end if;
 prior:=prior||jsonb_build_object('state',case when p_message_queue_id is null then 'FAILED' else 'COMPLETED' end,'messageQueueId',p_message_queue_id,'completedAt',clock_timestamp());
 update public.nexus_directory_search_allowance set provider_alert_state=jsonb_set(provider_alert_state,array[key],prior) where allowance_id=a.allowance_id;
 return prior;
end;$$;

create or replace function public.open_nexus_directory_run(p_policy_id text,p_hash text,p_worker text,p_max_venues integer,p_max_requests integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.nexus_directory_standing_policy; run public.nexus_directory_run;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'DIRECTORY_SERVICE_ROLE_REQUIRED';end if;
 select * into p from public.nexus_directory_standing_policy where policy_id=p_policy_id for update;
 if not found or not p.enabled or not coalesce((p.policy->>'enabled')::boolean,false) or p.policy_sha256<>p_hash
 or p.policy->>'quotaMode' is distinct from 'PER_RUN' or not public.policy_is_active(p.policy)
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

create or replace function public.reserve_nexus_directory_run_work(p_reservation jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.nexus_directory_standing_policy; run public.nexus_directory_run;b public.nexus_directory_daily_budget;req integer;last_host public.nexus_directory_work_receipt;d date:=(now() at time zone 'UTC')::date;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'DIRECTORY_SERVICE_ROLE_REQUIRED';end if;
 select * into p from public.nexus_directory_standing_policy where policy_id=p_reservation->>'policyId' for update;
 if not found or not p.enabled or not coalesce((p.policy->>'enabled')::boolean,false) or p.policy_sha256 is distinct from p_reservation->>'policySha256'
 or p.policy->>'quotaMode' is distinct from 'PER_RUN' or not public.policy_is_active(p.policy)
 then return jsonb_build_object('state','DENIED','reason','POLICY_INACTIVE');end if;
 if ((p.policy->>'paidProviderBudgetUsd')::numeric is distinct from 0 and not (coalesce((p.policy->>'standing')::boolean,false) and public.policy_is_active(p.policy))) or (p.policy->>'publicationAllowed')::boolean is distinct from false
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
 if coalesce((p.policy->>'standing')::boolean,false) then
  insert into public.nexus_directory_daily_budget(policy_id,day) values(p.policy_id,d) on conflict do nothing;
  select * into b from public.nexus_directory_daily_budget where policy_id=p.policy_id and day=d for update;
  -- Earlier PER_RUN receipts may precede this additive daily guard. Reconcile
  -- upward only; never clear earlier reservations or refund uncertain work.
  update public.nexus_directory_daily_budget set
   reserved_venues=greatest(reserved_venues,(select count(*)::integer from public.nexus_directory_work_receipt w where w.policy_id=p.policy_id and w.day=d)),
   reserved_requests=greatest(reserved_requests,(select coalesce(sum(w.reserved_requests),0)::integer from public.nexus_directory_work_receipt w where w.policy_id=p.policy_id and w.day=d))
   where policy_id=p.policy_id and day=d returning * into b;
  if b.reserved_venues+1>least(100,(p.policy->>'maxVenuesPerDay')::integer) or b.reserved_requests+req>least(1400,(p.policy->>'maxRequestsPerDay')::integer)
  then return jsonb_build_object('state','DENIED','reason','DAILY_BUDGET');end if;
  update public.nexus_directory_daily_budget set reserved_venues=reserved_venues+1,reserved_requests=reserved_requests+req where policy_id=p.policy_id and day=d;
 end if;
 insert into public.nexus_directory_work_receipt(reservation_key,policy_id,day,queue_id,identity_key,host,country,reserved_requests,run_id,lease_until)
 values(p_reservation->>'reservationKey',p.policy_id,d,p_reservation->>'queueId',p_reservation->>'identityKey',p_reservation->>'host',p_reservation->>'country',req,run.run_id,now()+interval '10 minutes');
 update public.nexus_directory_run set reserved_venues=reserved_venues+1,reserved_requests=reserved_requests+req where run_id=run.run_id;
 return jsonb_build_object('state','RESERVED');
end;$$;

create or replace function public.reserve_directory_search(p_reservation jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
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
end;$$;

revoke all on function public.policy_is_active(jsonb) from public,anon,authenticated;
grant execute on function public.policy_is_active(jsonb) to service_role;
revoke all on function public.directory_provider_budget_state(text,timestamptz) from public,anon,authenticated;
grant execute on function public.directory_provider_budget_state(text,timestamptz) to service_role;
revoke all on function public.read_directory_provider_budget_status(text,text) from public,anon,authenticated;
grant execute on function public.read_directory_provider_budget_status(text,text) to service_role;
revoke all on function public.observe_directory_provider_balance(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.observe_directory_provider_balance(text,text,text,jsonb) to service_role;
revoke all on function public.claim_directory_provider_alert(text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_directory_provider_alert(text,text,text,text,text,jsonb) to service_role;
revoke all on function public.complete_directory_provider_alert(text,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.complete_directory_provider_alert(text,text,text,text,text,uuid) to service_role;

