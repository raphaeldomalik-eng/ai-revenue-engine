-- Correct existing expired-credit accounting. No balances, counters, grants,
-- provider settings, policies or permissions are changed by this migration.
create or replace function public.directory_provider_budget_state(p_allowance_id text,p_at timestamptz default clock_timestamp()) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare a public.nexus_directory_search_allowance;s jsonb;month_ledger bigint;month_used bigint;burn bigint;debt bigint;
 projected bigint;expired_grant bigint:=0;remaining bigint;allowance_remaining bigint;denominator bigint;expiry timestamptz;stage text;reason text;
 pre_expiry_debt bigint:=0;account_basis numeric;provider_fraction numeric;internal_fraction numeric;alert_fraction numeric;policy jsonb;reserve_micro_usd bigint;
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
  -- Only journalled spending before expiry can consume the old grant.
  -- Later calls, and unexplained ledger debt, continue to reduce purchased
  -- credit rather than decreasing an already expired grant.
  select least(debt,coalesce(sum(reserved_micro_usd),0)) into pre_expiry_debt
  from public.nexus_directory_search_receipt
  where allowance_id=a.allowance_id and reserved_at>(s->>'verifiedAt')::timestamptz
   and reserved_at<(s->>'grantExpiresAt')::timestamptz and reserved_at<=p_at;
  expired_grant:=greatest(0,coalesce((s->>'grantRemainingMicroUsd')::bigint,0)-pre_expiry_debt);
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

