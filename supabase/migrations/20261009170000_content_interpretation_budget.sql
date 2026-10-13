-- AIRE-owned budget reservations; no shared canonical or publication writes.
create table public.nexus_content_model_reservations (
  idempotency_key uuid primary key,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  reserved_at timestamptz not null default now()
);
alter table public.nexus_content_model_reservations enable row level security;
revoke all on public.nexus_content_model_reservations from public, anon, authenticated;
grant select, insert on public.nexus_content_model_reservations to service_role;
comment on table public.nexus_content_model_reservations is
  'At-most-once model budget reservation. Never automatically release a possibly charged request after an uncertain provider response. Explicit operator replay requires a new governed request/budget.';

create or replace function public.purge_expired_content_interpretation_results()
returns integer language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_count integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'CONTENT_EXECUTION_SERVICE_ROLE_REQUIRED'; end if;
  with expired as (select idempotency_key from public.nexus_executor_results
    where contract_version='nexus.content-interpretation-result.v1'
      and result_payload->>'sourceExpiresAt'<=to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      and result_payload->'whyGoDraft' is distinct from 'null'::jsonb
    order by created_at for update skip locked limit 1000)
  update public.nexus_executor_results r set result_payload=jsonb_set(r.result_payload,'{whyGoDraft}','null'::jsonb)
    from expired where r.idempotency_key=expired.idempotency_key;
  get diagnostics v_count=row_count; return v_count;
end; $$;
revoke all on function public.purge_expired_content_interpretation_results() from public,anon,authenticated;
grant execute on function public.purge_expired_content_interpretation_results() to service_role;
