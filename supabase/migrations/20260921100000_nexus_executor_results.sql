-- Product-local replay ledger for the Nexus execution adapter.
-- This stores request results only; it does not store or mutate Nexus canonical entities.
create table if not exists public.nexus_executor_results (
  idempotency_key text primary key,
  contract_version text not null,
  request_id text not null,
  result_payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint nexus_executor_results_request_id_key unique (request_id)
);

comment on table public.nexus_executor_results is 'AI Revenue Engine replay ledger for Nexus research and source-discovery results; never canonical entity state.';
alter table public.nexus_executor_results enable row level security;
revoke all on table public.nexus_executor_results from public, anon, authenticated;
grant select, insert, update on table public.nexus_executor_results to service_role;
