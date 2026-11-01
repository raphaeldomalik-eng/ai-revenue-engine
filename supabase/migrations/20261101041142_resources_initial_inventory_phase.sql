-- Additive phase metadata in the existing policy/run ledger; no new worker or queue.
alter table public.nexus_directory_run add column execution_phase text not null default 'LEGACY' check(execution_phase in('LEGACY','INITIAL_INVENTORY','ONGOING_ENRICHMENT'));
alter table public.nexus_directory_standing_policy add column initial_inventory_snapshot_sha256 text check(initial_inventory_snapshot_sha256 ~ '^[a-f0-9]{64}$'),add column initial_inventory_completed_at timestamptz;
create function public.open_nexus_directory_run(p_policy_id text,p_hash text,p_worker text,p_max_venues integer,p_max_requests integer,p_inventory jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.nexus_directory_standing_policy; opened jsonb;phase text;requests_reserved integer;venues_reserved integer;reason text;d date:=(now() at time zone 'UTC')::date;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'DIRECTORY_SERVICE_ROLE_REQUIRED';end if;
 select * into p from public.nexus_directory_standing_policy where policy_id=p_policy_id for update;
 if not found or p.policy_sha256 is distinct from p_hash or not p.enabled or not coalesce((p.policy->>'standing')::boolean,false) or not public.policy_is_active(p.policy) then return jsonb_build_object('state','DENIED','reason','POLICY_INACTIVE');end if;
 if coalesce(p_inventory->>'snapshotSha256','')!~'^[a-f0-9]{64}$' or coalesce(p_inventory->>'total','')!~'^[0-9]+$' or coalesce(p_inventory->>'remaining','')!~'^[0-9]+$' or coalesce(p_inventory#>>'{byCountry,GB}','')!~'^[0-9]+$' or coalesce(p_inventory#>>'{byCountry,ZA}','')!~'^[0-9]+$' then return jsonb_build_object('state','DENIED','reason','INVENTORY_SCOPE');end if;
 if (p_inventory->>'total')::integer<1 or (p_inventory->>'remaining')::integer>(p_inventory->>'total')::integer or (p_inventory->>'remaining')::integer<>(p_inventory#>>'{byCountry,GB}')::integer+(p_inventory#>>'{byCountry,ZA}')::integer then return jsonb_build_object('state','DENIED','reason','INVENTORY_SCOPE');end if;
 if p.initial_inventory_snapshot_sha256 is not null and p.initial_inventory_snapshot_sha256<>p_inventory->>'snapshotSha256' then return jsonb_build_object('state','DENIED','reason','INVENTORY_SNAPSHOT_MISMATCH');end if;
 phase:=case when (p_inventory->>'remaining')::integer>0 then 'INITIAL_INVENTORY' else 'ONGOING_ENRICHMENT' end;
 if p.initial_inventory_completed_at is not null and phase='INITIAL_INVENTORY' then return jsonb_build_object('state','DENIED','reason','INVENTORY_ALREADY_COMPLETED');end if;
 opened:=public.open_nexus_directory_run(p_policy_id,p_hash,p_worker,p_max_venues,p_max_requests);if opened->>'state'<>'OPENED' then return opened;end if;
 update public.nexus_directory_standing_policy set initial_inventory_snapshot_sha256=p_inventory->>'snapshotSha256',initial_inventory_completed_at=case when phase='ONGOING_ENRICHMENT' then coalesce(initial_inventory_completed_at,now()) else initial_inventory_completed_at end where policy_id=p_policy_id returning * into p;
 update public.nexus_directory_run set execution_phase=phase,receipt=jsonb_build_object('initialInventory',p_inventory) where run_id=(opened->>'runId')::uuid;
 select greatest(coalesce((select b.reserved_requests from public.nexus_directory_daily_budget b where b.policy_id=p_policy_id and b.day=d),0),coalesce(sum(w.reserved_requests),0))::integer into requests_reserved from public.nexus_directory_work_receipt w where w.policy_id=p_policy_id and w.day=d;
 select count(*)::integer into venues_reserved from public.nexus_directory_work_receipt w join public.nexus_directory_run r using(run_id) where w.policy_id=p_policy_id and w.day=d and r.execution_phase='ONGOING_ENRICHMENT' and r.started_at>=p.initial_inventory_completed_at;
 reason:=case when requests_reserved+least(14,(p.policy->>'maxRequestsPerVenue')::integer)>least(1400,(p.policy->>'maxRequestsPerDay')::integer) then 'DAILY_REQUEST_BUDGET' when phase='ONGOING_ENRICHMENT' and venues_reserved>=least(100,(p.policy->>'maxVenuesPerDay')::integer) then 'DAILY_VENUE_BUDGET' else null end;
 return opened||jsonb_build_object('executionPhase',phase,'websiteCapacity',jsonb_build_object('available',reason is null,'reason',reason,'nextEligibleAt',((d+1)::timestamp at time zone 'UTC')));
end;$$;
revoke all on function public.open_nexus_directory_run(text,text,text,integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.open_nexus_directory_run(text,text,text,integer,integer,jsonb) to service_role;

create or replace function public.reserve_nexus_directory_run_work(p_reservation jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.nexus_directory_standing_policy; run public.nexus_directory_run;b public.nexus_directory_daily_budget;req integer;last_host public.nexus_directory_work_receipt;ongoing_count integer;d date:=(now() at time zone 'UTC')::date;
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
  if b.reserved_requests+req>least(1400,(p.policy->>'maxRequestsPerDay')::integer) then return jsonb_build_object('state','DENIED','reason',case when run.execution_phase='LEGACY' then 'DAILY_BUDGET' else 'DAILY_REQUEST_BUDGET' end);end if;
  if run.execution_phase<>'INITIAL_INVENTORY' then
   ongoing_count:=b.reserved_venues;
   if run.execution_phase='ONGOING_ENRICHMENT' and p.initial_inventory_completed_at is not null then
    select count(*)::integer into ongoing_count from public.nexus_directory_work_receipt w join public.nexus_directory_run r using(run_id) where w.policy_id=p.policy_id and w.day=d and r.execution_phase='ONGOING_ENRICHMENT' and r.started_at>=p.initial_inventory_completed_at;
   end if;
   if ongoing_count+1>least(100,(p.policy->>'maxVenuesPerDay')::integer) then return jsonb_build_object('state','DENIED','reason',case when run.execution_phase='LEGACY' then 'DAILY_BUDGET' else 'DAILY_VENUE_BUDGET' end);end if;
  end if;
  update public.nexus_directory_daily_budget set reserved_venues=reserved_venues+1,reserved_requests=reserved_requests+req where policy_id=p.policy_id and day=d;
 end if;
 insert into public.nexus_directory_work_receipt(reservation_key,policy_id,day,queue_id,identity_key,host,country,reserved_requests,run_id,lease_until)
 values(p_reservation->>'reservationKey',p.policy_id,d,p_reservation->>'queueId',p_reservation->>'identityKey',p_reservation->>'host',p_reservation->>'country',req,run.run_id,now()+interval '10 minutes');
 update public.nexus_directory_run set reserved_venues=reserved_venues+1,reserved_requests=reserved_requests+req where run_id=run.run_id;
 return jsonb_build_object('state','RESERVED');
end;$$;


-- Product publication is executed only by EventSuite; AIRE publication remains forbidden.
create or replace function public.policy_is_active(p_policy jsonb) returns boolean
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
 and p_policy->'publicationAllowed'='false'::jsonb and p_policy->'productPublicationAllowed' in ('false'::jsonb,'true'::jsonb)
 and p_policy->'outreachAllowed'='false'::jsonb),false);
exception when others then return false;
end;$$;


-- Retain the phase/census opening receipt when closing the existing run.
create or replace function public.finish_nexus_directory_run(p_run_id uuid,p_worker text,p_receipt jsonb,p_policy_id text,p_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare run public.nexus_directory_run;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'DIRECTORY_SERVICE_ROLE_REQUIRED';end if;
 select * into run from public.nexus_directory_run where run_id=p_run_id for update;
 if not found or run.worker_id is distinct from p_worker or run.policy_id is distinct from p_policy_id or run.policy_sha256 is distinct from p_hash then return jsonb_build_object('state','DENIED','reason','RUN_OWNER');end if;
 if run.state='COMPLETED' then return jsonb_build_object('state','COMPLETED','reused',true);end if;
 if run.state<>'RUNNING' then return jsonb_build_object('state','DENIED','reason','RUN_INACTIVE');end if;
 if exists(select 1 from public.nexus_directory_work_receipt where run_id=p_run_id and state='RESERVED') then return jsonb_build_object('state','DENIED','reason','WORK_ACTIVE');end if;
 update public.nexus_directory_run set state='COMPLETED',completed_at=now(),lease_until=now(),receipt=coalesce(receipt,'{}'::jsonb)||p_receipt where run_id=p_run_id;
 return jsonb_build_object('state','COMPLETED');
end;$$;
