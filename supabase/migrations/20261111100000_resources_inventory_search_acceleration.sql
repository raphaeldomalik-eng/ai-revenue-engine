-- Initial-inventory search acceleration (owner-approved 2026-11-11: use available prepaid Serper and Brave credit to clear the
-- initial UK/ZA inventory without an internally imposed daily search ceiling).
-- reserve_directory_search enforces a hard-coded provider daily ceiling (least(100,..) Serper, least(50,..) Brave) in SQL, so no
-- policy edit can lift it, and editing the policy would also change the standing-policy hash that queued Nexus work is bound to.
-- This migration changes neither the policy nor its hash. It adds a staged, default-OFF control table. When (and only when) a row
-- for the policy is enabled, the run is in the INITIAL_INVENTORY phase and the policy has not completed its initial inventory,
-- the provider daily ceiling is replaced by that row's own limit (NULL = no internal daily ceiling). Everything else is unchanged
-- and still enforced: allowance state and expiry, the provider balance / conservative-remaining and account-reserve guard (no
-- negative balance), the allocation and lifetime counters, the per-run provider request cap, the per-run search spend cap, the
-- durable provider spacing (provider rate limit), cache reuse and idempotent receipts. Recurring enrichment never uses it.
-- Enabling, bounding (acceptance window) and disabling are service-role data changes recorded with an authorisation reference.
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create table if not exists public.nexus_directory_inventory_acceleration(
 policy_id text primary key references public.nexus_directory_standing_policy(policy_id) on delete restrict,
 enabled boolean not null default false,
 serper_daily_limit integer check(serper_daily_limit is null or serper_daily_limit>0),
 brave_daily_limit integer check(brave_daily_limit is null or brave_daily_limit>0),
 authorisation_ref text,
 enabled_at timestamptz,
 updated_at timestamptz not null default now(),
 check(not enabled or (authorisation_ref is not null and length(authorisation_ref)>=10))
);
alter table public.nexus_directory_inventory_acceleration enable row level security;
revoke all on public.nexus_directory_inventory_acceleration from public,anon,authenticated;
grant select,insert,update on public.nexus_directory_inventory_acceleration to service_role;
create or replace function public.directory_inventory_acceleration_allows(p_policy_id text,p_provider_id text,p_phase text,p_daily_count bigint)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select p_phase='INITIAL_INVENTORY' and exists(
  select 1 from public.nexus_directory_inventory_acceleration x join public.nexus_directory_standing_policy sp on sp.policy_id=x.policy_id
  where x.policy_id=p_policy_id and x.enabled and sp.initial_inventory_completed_at is null
   and case when p_provider_id='brave-web-search' then x.brave_daily_limit is null or p_daily_count<x.brave_daily_limit
        else x.serper_daily_limit is null or p_daily_count<x.serper_daily_limit end);
$$;
revoke all on function public.directory_inventory_acceleration_allows(text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.directory_inventory_acceleration_allows(text,text,text,bigint) to service_role;
do $migration$
declare definition text; target text; replacement text;
begin
 select pg_get_functiondef('public.reserve_directory_search(jsonb)'::regprocedure) into definition;
 if position('directory_inventory_acceleration_allows' in definition)>0 then return;end if;
 if position('PROVIDER_DAILY_BUDGET' in definition)=0 or position('DIRECTORY_SEARCH_SERVICE_ROLE_REQUIRED' in definition)=0 or position('RUN_PROVIDER_BUDGET' in definition)=0 then raise exception 'INVENTORY_ACCELERATION_SOURCE_DRIFT';end if;
 target:='if daily_count>=(case when a.provider_id=''brave-web-search''';
 replacement:='if not public.directory_inventory_acceleration_allows(a.policy_id,a.provider_id,run.execution_phase,daily_count) and daily_count>=(case when a.provider_id=''brave-web-search''';
 if (length(definition)-length(replace(definition,target,'')))/length(target)<>1 then raise exception 'INVENTORY_ACCELERATION_TARGET_DRIFT';end if;
 execute replace(definition,target,replacement);
end $migration$;
