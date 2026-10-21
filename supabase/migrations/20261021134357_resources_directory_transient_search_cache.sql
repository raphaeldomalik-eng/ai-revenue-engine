-- Transient operational cache only. Hash/spend tombstones never expire or refund.
alter table public.nexus_directory_search_receipt add column cache_expires_at timestamptz;
update public.nexus_directory_search_receipt set cache_expires_at=completed_at+interval '24 hours' where state='COMPLETED';
create function public.purge_expired_directory_search_cache() returns integer
language plpgsql security definer set search_path=pg_catalog,public as $$
declare n integer;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'DIRECTORY_SEARCH_SERVICE_ROLE_REQUIRED'; end if;
 update public.nexus_directory_search_receipt set results=null,provider_usage=provider_usage-'responsePayload',error_code='TRANSIENT_CACHE_EXPIRED'
 where state='COMPLETED' and cache_expires_at<=now() and (results is not null or provider_usage?'responsePayload');
 get diagnostics n=row_count;
 return n;
end; $$;
revoke all on function public.purge_expired_directory_search_cache() from public,anon,authenticated;
grant execute on function public.purge_expired_directory_search_cache() to service_role;

create or replace function public.reserve_directory_search(p_reservation jsonb) returns jsonb
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
  if r.state='COMPLETED' and r.cache_expires_at>now() and r.results is not null then return jsonb_build_object('state','CACHED','results',r.results,'observedAt',r.completed_at); end if;
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

create or replace function public.complete_directory_search(p_query_sha256 text,p_request_key text,p_results jsonb,p_usage jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.nexus_directory_search_receipt;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'DIRECTORY_SEARCH_SERVICE_ROLE_REQUIRED'; end if;
 select * into r from public.nexus_directory_search_receipt where query_sha256=p_query_sha256 for update;
 if not found or r.request_key is distinct from p_request_key then raise exception 'DIRECTORY_SEARCH_RECEIPT_SCOPE'; end if;
 if r.state='COMPLETED' then return jsonb_build_object('state','REUSED'); end if;
 if r.state<>'RESERVED' or jsonb_typeof(p_results)<>'array' or jsonb_array_length(p_results)>10 or octet_length(p_usage::text)>140000 then raise exception 'DIRECTORY_SEARCH_RESULT_INVALID'; end if;
 update public.nexus_directory_search_receipt set state='COMPLETED',results=p_results,provider_usage=p_usage,completed_at=clock_timestamp(),cache_expires_at=clock_timestamp()+interval '24 hours' where query_sha256=p_query_sha256;
 return jsonb_build_object('state','RECORDED');
end; $$;

