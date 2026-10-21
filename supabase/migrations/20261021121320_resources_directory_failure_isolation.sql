-- Website-specific failures stay scoped to their queue/host. Unknown usage and budget violations retain the circuit breaker.
create or replace function public.reserve_nexus_directory_work(p_reservation jsonb) returns jsonb
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
 if coalesce(p_reservation->>'action','ENRICH_VERIFIED_VENUE') not in ('ENRICH_VERIFIED_VENUE','VERIFY_WEBSITE')
  or not (coalesce(p.policy->'actions','["ENRICH_VERIFIED_VENUE"]'::jsonb) ? coalesce(p_reservation->>'action','ENRICH_VERIFIED_VENUE'))
  then return jsonb_build_object('state','DENIED','reason','POLICY_ACTION'); end if;
 req:=(p_reservation->>'requestBudget')::integer;
 if req<1 or req>least(14,(p.policy->>'maxRequestsPerVenue')::integer) or p_reservation->>'day'<>d::text
  or coalesce(p_reservation->>'host','') !~ '^[a-z0-9.-]+$' or coalesce(p_reservation->>'reservationKey','') !~ '^[0-9a-f]{64}$'
  or nullif(p_reservation->>'queueId','') is null or nullif(p_reservation->>'identityKey','') is null
  then return jsonb_build_object('state','DENIED','reason','RESERVATION_SCOPE'); end if;
 if exists(select 1 from public.nexus_directory_work_receipt where reservation_key=p_reservation->>'reservationKey')
  then return jsonb_build_object('state','DENIED','reason','REPLAY'); end if;
 if exists(select 1 from public.nexus_directory_work_receipt where policy_id=p.policy_id and queue_id=p_reservation->>'queueId' and state='QUARANTINED')
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
 if exists(select 1 from public.nexus_directory_work_receipt r where r.policy_id=p.policy_id and r.identity_key=p_reservation->>'identityKey' and r.host=p_reservation->>'host'
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

create or replace function public.complete_nexus_directory_work(p_receipt jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.nexus_directory_work_receipt%rowtype; actual integer; cost numeric; outcome text; p public.nexus_directory_standing_policy%rowtype;
begin
 select * into p from public.nexus_directory_standing_policy where policy_id=p_receipt->>'policyId' for update;
 if not found then return jsonb_build_object('state','DENIED','reason','POLICY_MISSING'); end if;
 select * into r from public.nexus_directory_work_receipt where reservation_key=p_receipt->>'reservationKey' for update;
 if not found or r.policy_id is distinct from p_receipt->>'policyId' or r.queue_id is distinct from p_receipt->>'queueId'
  or r.identity_key is distinct from p_receipt->>'identityKey' or r.host is distinct from p_receipt->>'host'
  then return jsonb_build_object('state','DENIED','reason','RECEIPT_NOT_RESERVED'); end if;
 actual:=(p_receipt->>'requestCount')::integer;cost:=(p_receipt->>'costUsd')::numeric;outcome:=p_receipt->>'state';
 if r.state=outcome and r.request_count is not distinct from actual and r.cost_usd is not distinct from cost then return jsonb_build_object('state','RECORDED','reused',true); end if;
 if r.state<>'RESERVED' and not (r.state='RETRYABLE' and r.request_count is null and r.cost_usd is null) then return jsonb_build_object('state','DENIED','reason','RECEIPT_ALREADY_FINAL'); end if;
 if outcome not in ('COMPLETED','RETRYABLE','QUARANTINED') or actual<0 or cost<0 then return jsonb_build_object('state','DENIED','reason','RECEIPT_INVALID'); end if;
 if actual>r.reserved_requests or cost>0 then
  outcome:='QUARANTINED';update public.nexus_directory_standing_policy set enabled=false,updated_at=now() where policy_id=r.policy_id;
 end if;
 update public.nexus_directory_work_receipt set state=outcome,request_count=actual,cost_usd=cost,
  next_attempt_at=(p_receipt->>'nextAttemptAt')::timestamptz,receipt=p_receipt,completed_at=now() where reservation_key=r.reservation_key;
 update public.nexus_directory_standing_policy set consecutive_failures=case when actual is not null and cost=0 and actual<=r.reserved_requests then 0 else consecutive_failures+case when r.state='RETRYABLE' then 0 else 1 end end,
  enabled=enabled and ((actual is not null and cost=0 and actual<=r.reserved_requests) or consecutive_failures+case when r.state='RETRYABLE' then 0 else 1 end<(policy->>'stopAfterConsecutiveFailures')::integer),updated_at=now() where policy_id=r.policy_id;
 return jsonb_build_object('state','RECORDED');
end; $$;
revoke all on function public.reserve_nexus_directory_work(jsonb),public.complete_nexus_directory_work(jsonb) from public,anon,authenticated;
grant execute on function public.reserve_nexus_directory_work(jsonb),public.complete_nexus_directory_work(jsonb) to service_role;
