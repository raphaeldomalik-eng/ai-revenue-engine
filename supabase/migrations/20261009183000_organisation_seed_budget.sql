-- Owner-approved, zero incremental cost source discovery. No canonical identity writes.
create table public.nexus_organisation_seed_programmes(
  id uuid primary key,
  account_allowance_ref text not null check(length(account_allowance_ref) between 1 and 200),
  max_search_calls int not null check(max_search_calls between 1 and 1000),
  active boolean not null default false,
  expires_at timestamptz not null,
  approved_by uuid not null,
  approved_at timestamptz not null,
  check(expires_at>approved_at and expires_at<=approved_at+interval '7 days')
);
create table public.nexus_organisation_seed_search_reservations(
  idempotency_key uuid primary key,
  programme_id uuid not null references public.nexus_organisation_seed_programmes(id),
  request_fingerprint text not null check(request_fingerprint ~ '^[0-9a-f]{64}$'),
  reserved_at timestamptz not null default now()
);
create index nexus_organisation_seed_reservations_programme_idx on public.nexus_organisation_seed_search_reservations(programme_id);
alter table public.nexus_organisation_seed_programmes enable row level security;
alter table public.nexus_organisation_seed_search_reservations enable row level security;
revoke all on public.nexus_organisation_seed_programmes,public.nexus_organisation_seed_search_reservations from public,anon,authenticated;
grant select,insert,update on public.nexus_organisation_seed_programmes to service_role;
grant select,insert on public.nexus_organisation_seed_search_reservations to service_role;
create function public.reserve_organisation_seed_search(p_programme_id uuid,p_idempotency_key uuid,p_request_fingerprint text)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_programme public.nexus_organisation_seed_programmes;v_prior public.nexus_organisation_seed_search_reservations;v_count int;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'SOURCE_SEED_SERVICE_ROLE_REQUIRED'; end if;
  if p_request_fingerprint is null or p_request_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'SOURCE_SEED_FINGERPRINT_REQUIRED'; end if;
  -- Serialize the complete programme quota, not just individual request identities.
  select * into v_programme from public.nexus_organisation_seed_programmes where id=p_programme_id for update;
  if not found or not v_programme.active or v_programme.expires_at<=now() or v_programme.approved_at>now() then return jsonb_build_object('state','PROGRAMME_INACTIVE'); end if;
  select * into v_prior from public.nexus_organisation_seed_search_reservations where idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_fingerprint<>p_request_fingerprint or v_prior.programme_id<>p_programme_id then raise exception 'SOURCE_SEED_IDEMPOTENCY_COLLISION'; end if;
    return jsonb_build_object('state','ALREADY_RESERVED');
  end if;
  select count(*) into v_count from public.nexus_organisation_seed_search_reservations where programme_id=p_programme_id;
  if v_count>=v_programme.max_search_calls then return jsonb_build_object('state','CAP_EXHAUSTED'); end if;
  insert into public.nexus_organisation_seed_search_reservations(idempotency_key,programme_id,request_fingerprint) values(p_idempotency_key,p_programme_id,p_request_fingerprint);
  return jsonb_build_object('state','RESERVED','accountAllowanceRef',v_programme.account_allowance_ref);
end; $$;
revoke all on function public.reserve_organisation_seed_search(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_organisation_seed_search(uuid,uuid,text) to service_role;
comment on table public.nexus_organisation_seed_programmes is 'Operator must verify free account allowance before activating. A zero-priced adapter alone is not evidence of free billing. No automatic programme creation or renewal.';
