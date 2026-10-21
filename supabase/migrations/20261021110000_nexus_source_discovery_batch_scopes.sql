-- Durable one-use execution ledger for explicitly manifest-scoped source discovery.
-- It does not enable global discovery; callers must separately pass the exact short-lived scope.
create table if not exists public.nexus_source_discovery_batch_scopes (
  scope_id uuid primary key,
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  valid_from timestamptz not null,
  valid_until timestamptz not null check (valid_until > valid_from),
  max_venues integer not null check (max_venues between 1 and 50),
  max_requests_per_venue integer not null check (max_requests_per_venue between 1 and 14),
  max_total_requests integer not null check (max_total_requests between 1 and 700),
  reserved_requests integer not null default 0 check (reserved_requests between 0 and max_total_requests),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','COMPLETED','EXPIRED')),
  receipt jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  check (max_total_requests <= max_venues * max_requests_per_venue)
);

create table if not exists public.nexus_source_discovery_batch_receipts (
  scope_id uuid not null references public.nexus_source_discovery_batch_scopes(scope_id),
  listing_id uuid not null,
  host text not null,
  idempotency_key uuid not null,
  reserved_requests integer not null check (reserved_requests between 1 and 14),
  request_count integer not null default 0 check (request_count between 0 and reserved_requests),
  bytes_read bigint not null default 0 check (bytes_read >= 0),
  provider_cost_usd numeric(12,4) not null default 0 check (provider_cost_usd = 0),
  status text not null default 'RESERVED' check (status in ('RESERVED','COMPLETED','FAILED')),
  result_status text,
  receipt jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (scope_id, listing_id),
  unique (scope_id, idempotency_key)
);

alter table public.nexus_source_discovery_batch_scopes enable row level security;
alter table public.nexus_source_discovery_batch_receipts enable row level security;
revoke all on public.nexus_source_discovery_batch_scopes, public.nexus_source_discovery_batch_receipts from public, anon, authenticated;
grant select, insert, update on public.nexus_source_discovery_batch_scopes, public.nexus_source_discovery_batch_receipts to service_role;

create or replace function public.reserve_nexus_source_discovery_batch_request(
  p_scope_id uuid, p_manifest_sha256 text, p_valid_from timestamptz, p_valid_until timestamptz,
  p_max_venues integer, p_max_requests_per_venue integer, p_max_total_requests integer,
  p_listing_id uuid, p_host text, p_idempotency_key uuid, p_request_budget integer
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare s public.nexus_source_discovery_batch_scopes%rowtype; existing_count integer;
begin
  insert into public.nexus_source_discovery_batch_scopes(scope_id,manifest_sha256,valid_from,valid_until,max_venues,max_requests_per_venue,max_total_requests)
  values(p_scope_id,lower(p_manifest_sha256),p_valid_from,p_valid_until,p_max_venues,p_max_requests_per_venue,p_max_total_requests)
  on conflict (scope_id) do nothing;
  select * into s from public.nexus_source_discovery_batch_scopes where scope_id=p_scope_id for update;
  if s.manifest_sha256 <> lower(p_manifest_sha256) or s.valid_from <> p_valid_from or s.valid_until <> p_valid_until
     or s.max_venues <> p_max_venues or s.max_requests_per_venue <> p_max_requests_per_venue or s.max_total_requests <> p_max_total_requests then
    return jsonb_build_object('state','DENIED','reason','SCOPE_IDENTITY_MISMATCH');
  end if;
  if now() >= s.valid_until then
    update public.nexus_source_discovery_batch_scopes set status='EXPIRED',closed_at=coalesce(closed_at,now()) where scope_id=p_scope_id and status='ACTIVE';
    return jsonb_build_object('state','DENIED','reason','SCOPE_EXPIRED');
  end if;
  if now() < s.valid_from or s.status <> 'ACTIVE' then return jsonb_build_object('state','DENIED','reason','SCOPE_CLOSED_OR_NOT_YET_VALID'); end if;
  if p_request_budget < 1 or p_request_budget > s.max_requests_per_venue then return jsonb_build_object('state','DENIED','reason','HOST_BUDGET_EXCEEDED'); end if;
  select count(*) into existing_count from public.nexus_source_discovery_batch_receipts where scope_id=p_scope_id;
  if existing_count >= s.max_venues or s.reserved_requests + p_request_budget > s.max_total_requests then return jsonb_build_object('state','DENIED','reason','BATCH_BUDGET_EXCEEDED'); end if;
  insert into public.nexus_source_discovery_batch_receipts(scope_id,listing_id,host,idempotency_key,reserved_requests)
  values(p_scope_id,p_listing_id,lower(p_host),p_idempotency_key,p_request_budget)
  on conflict do nothing;
  if not found then return jsonb_build_object('state','DENIED','reason','DUPLICATE_VENUE_OR_REPLAY'); end if;
  update public.nexus_source_discovery_batch_scopes set reserved_requests=reserved_requests+p_request_budget,receipt=receipt||jsonb_build_object('lastReservation',now()) where scope_id=p_scope_id;
  return jsonb_build_object('state','RESERVED');
end; $$;

create or replace function public.complete_nexus_source_discovery_batch_request(
  p_scope_id uuid, p_listing_id uuid, p_idempotency_key uuid, p_status text,
  p_request_count integer, p_bytes_read bigint, p_result_status text
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare r public.nexus_source_discovery_batch_receipts%rowtype; total_venues integer; completed_venues integer;
begin
  update public.nexus_source_discovery_batch_receipts set status=case when p_status='COMPLETED' then 'COMPLETED' else 'FAILED' end,
    request_count=p_request_count,bytes_read=p_bytes_read,provider_cost_usd=0,result_status=p_result_status,completed_at=now(),
    receipt=jsonb_build_object('requestCount',p_request_count,'bytesRead',p_bytes_read,'providerCostUsd',0,'resultStatus',p_result_status)
  where scope_id=p_scope_id and listing_id=p_listing_id and idempotency_key=p_idempotency_key and status='RESERVED'
    and p_request_count between 0 and reserved_requests and p_bytes_read >= 0;
  if not found then return jsonb_build_object('state','DENIED','reason','RECEIPT_NOT_RESERVED_OR_INVALID'); end if;
  select count(*) into total_venues from public.nexus_source_discovery_batch_scopes s join public.nexus_source_discovery_batch_receipts x using(scope_id) where s.scope_id=p_scope_id;
  select count(*) into completed_venues from public.nexus_source_discovery_batch_receipts where scope_id=p_scope_id and status in ('COMPLETED','FAILED');
  if total_venues >= (select max_venues from public.nexus_source_discovery_batch_scopes where scope_id=p_scope_id) and completed_venues=total_venues then
    update public.nexus_source_discovery_batch_scopes set status='COMPLETED',closed_at=now(),receipt=jsonb_build_object('venueCount',total_venues,'completedCount',completed_venues) where scope_id=p_scope_id and status='ACTIVE';
  end if;
  return jsonb_build_object('state','RECORDED');
end; $$;

revoke all on function public.reserve_nexus_source_discovery_batch_request(uuid,text,timestamptz,timestamptz,integer,integer,integer,uuid,text,uuid,integer) from public, anon, authenticated;
revoke all on function public.complete_nexus_source_discovery_batch_request(uuid,uuid,uuid,text,integer,bigint,text) from public, anon, authenticated;
grant execute on function public.reserve_nexus_source_discovery_batch_request(uuid,text,timestamptz,timestamptz,integer,integer,integer,uuid,text,uuid,integer) to service_role;
grant execute on function public.complete_nexus_source_discovery_batch_request(uuid,uuid,uuid,text,integer,bigint,text) to service_role;
