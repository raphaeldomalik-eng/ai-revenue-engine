-- Autonomous Prospect Discovery V1: bounded, operator-triggered discovery memory.
create table if not exists public.ai_prospect_discovery_runs (
  id uuid primary key default gen_random_uuid(),
  territory_code text not null check (territory_code in ('ZA', 'GB')),
  focus text not null check (focus in ('ALL', 'EGS', 'TICKETING', 'ECC')),
  status text not null check (status in ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED')),
  budget jsonb not null default '{"maxCandidates":8,"maxSearchCalls":1}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  provider text,
  model text,
  error_message text,
  created_by uuid references auth.users(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_prospect_candidates (
  id uuid primary key default gen_random_uuid(),
  discovery_run_id uuid not null references public.ai_prospect_discovery_runs(id) on delete cascade,
  canonical_key text not null,
  candidate_name text not null,
  organiser_name text,
  website text,
  territory_code text not null check (territory_code in ('ZA', 'GB')),
  origin text not null check (origin in ('EVENT_FIRST', 'ORGANISATION_FIRST')),
  status text not null check (status in ('DISCOVERED', 'RESOLVED', 'RESEARCHED', 'QUALIFIED', 'REVIEW_REQUIRED', 'BLOCKED', 'REJECTED', 'DUPLICATE')),
  account_id uuid references public.accounts(id) on delete set null,
  relationship text not null check (relationship in ('PROSPECT', 'CUSTOMER', 'PARTNER', 'COMPETITOR', 'UNKNOWN')),
  facts jsonb not null default '[]'::jsonb,
  inferences jsonb not null default '[]'::jsonb,
  unknowns jsonb not null default '[]'::jsonb,
  prospect_intelligence jsonb not null default '{}'::jsonb,
  source_urls jsonb not null default '[]'::jsonb,
  dedupe_of_candidate_id uuid references public.ai_prospect_candidates(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (discovery_run_id, canonical_key)
);

create index if not exists ai_prospect_discovery_runs_created_idx on public.ai_prospect_discovery_runs(created_at desc);
create index if not exists ai_prospect_candidates_key_idx on public.ai_prospect_candidates(canonical_key);
create index if not exists ai_prospect_candidates_account_idx on public.ai_prospect_candidates(account_id);

alter table public.ai_prospect_discovery_runs enable row level security;
alter table public.ai_prospect_candidates enable row level security;
revoke all on table public.ai_prospect_discovery_runs, public.ai_prospect_candidates from anon, authenticated;
grant select, insert, update, delete on table public.ai_prospect_discovery_runs, public.ai_prospect_candidates to authenticated;

create policy "active members read discovery runs" on public.ai_prospect_discovery_runs for select to authenticated using ((select private.is_active_revenue_member()));
create policy "operators manage discovery runs" on public.ai_prospect_discovery_runs for all to authenticated using ((select private.current_revenue_member_role()) in ('operator', 'admin')) with check ((select private.current_revenue_member_role()) in ('operator', 'admin'));
create policy "active members read discovery candidates" on public.ai_prospect_candidates for select to authenticated using ((select private.is_active_revenue_member()));
create policy "operators manage discovery candidates" on public.ai_prospect_candidates for all to authenticated using ((select private.current_revenue_member_role()) in ('operator', 'admin')) with check ((select private.current_revenue_member_role()) in ('operator', 'admin'));

comment on table public.ai_prospect_discovery_runs is 'Bounded operator-triggered public-web discovery only; no scheduled crawling or outreach sending.';
comment on table public.ai_prospect_candidates is 'Discovery memory for candidates including rejected, blocked and duplicate public leads; not a generic CRM model.';
