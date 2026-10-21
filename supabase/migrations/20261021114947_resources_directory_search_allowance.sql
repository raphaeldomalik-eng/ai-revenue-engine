-- Finite, account-verified TEST allocation. No seeded allowance and no automatic renewal.
-- Integer micro-USD prevents confusing dollar credit with request units.
create table public.nexus_directory_search_allowance (
 allowance_id text primary key,
 allocated_micro_usd bigint not null check(allocated_micro_usd between 1 and 500000),
 price_per_request_micro_usd bigint not null check(price_per_request_micro_usd>0),
 max_requests integer not null check(max_requests between 1 and 100),
 reserved_micro_usd bigint not null default 0 check(reserved_micro_usd>=0),
 request_count integer not null default 0 check(request_count>=0),
 verified_at timestamptz not null, expires_at timestamptz not null,
 verification_ref text not null check(length(verification_ref)>0), enabled boolean not null default false,
 check(expires_at>verified_at),check(reserved_micro_usd<=allocated_micro_usd),check(request_count<=max_requests)
);
create table public.nexus_directory_search_receipt (
 query_sha256 text primary key check(query_sha256~'^[a-f0-9]{64}$'),
 allowance_id text not null references public.nexus_directory_search_allowance,
 request_key text not null, parameters jsonb not null,
 reserved_micro_usd bigint not null check(reserved_micro_usd>0),
 state text not null default 'RESERVED' check(state in ('RESERVED','COMPLETED','FAILED')),
 results jsonb, provider_usage jsonb, error_code text,
 reserved_at timestamptz not null default now(), completed_at timestamptz
);
alter table public.nexus_directory_search_allowance enable row level security;
alter table public.nexus_directory_search_receipt enable row level security;
revoke all on public.nexus_directory_search_allowance,public.nexus_directory_search_receipt from public,anon,authenticated;
grant select,insert,update on public.nexus_directory_search_allowance,public.nexus_directory_search_receipt to service_role;

create function public.reserve_directory_search(p_reservation jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.nexus_directory_search_allowance; r public.nexus_directory_search_receipt;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'DIRECTORY_SEARCH_SERVICE_ROLE_REQUIRED'; end if;
 if coalesce(p_reservation->>'querySha256','')!~'^[a-f0-9]{64}$' or nullif(p_reservation->>'requestKey','') is null then raise exception 'DIRECTORY_SEARCH_RESERVATION_INVALID'; end if;
 -- All workers sharing the allowance lock this row before inspecting or reserving credit.
 select * into a from public.nexus_directory_search_allowance where allowance_id=p_reservation->>'allowanceId' for update;
 if not found or not a.enabled or a.verified_at>now() or a.expires_at<=now() then return jsonb_build_object('state','DENIED','reason','ALLOWANCE_INACTIVE'); end if;
 select * into r from public.nexus_directory_search_receipt where query_sha256=p_reservation->>'querySha256';
 if found then
  if r.state='COMPLETED' then return jsonb_build_object('state','CACHED','results',r.results,'observedAt',r.completed_at); end if;
  return jsonb_build_object('state','DENIED','reason','IN_FLIGHT_OR_UNKNOWN');
 end if;
 if a.request_count>=a.max_requests or a.reserved_micro_usd+a.price_per_request_micro_usd>a.allocated_micro_usd then return jsonb_build_object('state','DENIED','reason','ALLOCATION_EXHAUSTED'); end if;
 insert into public.nexus_directory_search_receipt(query_sha256,allowance_id,request_key,parameters,reserved_micro_usd)
 values(p_reservation->>'querySha256',a.allowance_id,p_reservation->>'requestKey',p_reservation->'parameters',a.price_per_request_micro_usd)
 on conflict do nothing;
 if not found then return jsonb_build_object('state','DENIED','reason','IN_FLIGHT_OR_UNKNOWN'); end if;
 update public.nexus_directory_search_allowance set request_count=request_count+1,reserved_micro_usd=reserved_micro_usd+price_per_request_micro_usd where allowance_id=a.allowance_id;
 return jsonb_build_object('state','RESERVED','reservedMicroUsd',a.price_per_request_micro_usd);
end; $$;

create function public.complete_directory_search(p_query_sha256 text,p_request_key text,p_results jsonb,p_usage jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.nexus_directory_search_receipt;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'DIRECTORY_SEARCH_SERVICE_ROLE_REQUIRED'; end if;
 select * into r from public.nexus_directory_search_receipt where query_sha256=p_query_sha256 for update;
 if not found or r.request_key is distinct from p_request_key then raise exception 'DIRECTORY_SEARCH_RECEIPT_SCOPE'; end if;
 if r.state='COMPLETED' then return jsonb_build_object('state','REUSED'); end if;
 if r.state<>'RESERVED' or jsonb_typeof(p_results)<>'array' or jsonb_array_length(p_results)>10 or octet_length(p_usage::text)>140000 then raise exception 'DIRECTORY_SEARCH_RESULT_INVALID'; end if;
 update public.nexus_directory_search_receipt set state='COMPLETED',results=p_results,provider_usage=p_usage,completed_at=clock_timestamp() where query_sha256=p_query_sha256;
 return jsonb_build_object('state','RECORDED');
end; $$;

create function public.fail_directory_search(p_query_sha256 text,p_request_key text,p_code text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'DIRECTORY_SEARCH_SERVICE_ROLE_REQUIRED'; end if;
 update public.nexus_directory_search_receipt set state='FAILED',error_code=left(p_code,120),completed_at=clock_timestamp()
 where query_sha256=p_query_sha256 and request_key=p_request_key and state='RESERVED';
 -- Unknown/failed requests retain their full reservation. They are never automatically repurchased.
 return jsonb_build_object('state','RECORDED');
end; $$;
revoke all on function public.reserve_directory_search(jsonb),public.complete_directory_search(text,text,jsonb,jsonb),public.fail_directory_search(text,text,text) from public,anon,authenticated;
grant execute on function public.reserve_directory_search(jsonb),public.complete_directory_search(text,text,jsonb,jsonb),public.fail_directory_search(text,text,text) to service_role;
