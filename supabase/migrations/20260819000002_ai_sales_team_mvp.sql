-- AI Sales Team MVP V1: durable research runs and structured sales briefs.
create table if not exists public.ai_research_runs (
  id uuid primary key default gen_random_uuid(), account_id uuid references public.accounts(id) on delete cascade,
  requested_name text not null, requested_website text, status text not null check (status in ('RUNNING','COMPLETED','FAILED')),
  provider text, model text, error_message text, result jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id), started_at timestamptz not null default now(), completed_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.ai_sales_briefs (
  id uuid primary key default gen_random_uuid(), account_id uuid not null references public.accounts(id) on delete cascade,
  research_run_id uuid not null references public.ai_research_runs(id) on delete cascade, company_summary text not null,
  why_it_matters text not null, territory jsonb not null default '{}'::jsonb, qualification jsonb not null default '{}'::jsonb,
  people jsonb not null default '[]'::jsonb, facts jsonb not null default '[]'::jsonb, inferences jsonb not null default '[]'::jsonb,
  pains jsonb not null default '[]'::jsonb, use_cases jsonb not null default '[]'::jsonb, signals jsonb not null default '[]'::jsonb,
  eventsuite_opportunity jsonb not null default '{}'::jsonb, account_strategy jsonb not null default '{}'::jsonb,
  next_best_action jsonb not null default '{}'::jsonb, unknowns jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists ai_research_runs_account_idx on public.ai_research_runs(account_id);
create index if not exists ai_sales_briefs_account_idx on public.ai_sales_briefs(account_id);
alter table public.ai_research_runs enable row level security;
alter table public.ai_sales_briefs enable row level security;
revoke all on table public.ai_research_runs, public.ai_sales_briefs from anon, authenticated;
grant select, insert, update, delete on table public.ai_research_runs, public.ai_sales_briefs to authenticated;
create policy "active members read research runs" on public.ai_research_runs for select to authenticated using ((select private.is_active_revenue_member()));
create policy "operators manage research runs" on public.ai_research_runs for all to authenticated using ((select private.current_revenue_member_role()) in ('operator','admin')) with check ((select private.current_revenue_member_role()) in ('operator','admin'));
create policy "active members read sales briefs" on public.ai_sales_briefs for select to authenticated using ((select private.is_active_revenue_member()));
create policy "operators manage sales briefs" on public.ai_sales_briefs for all to authenticated using ((select private.current_revenue_member_role()) in ('operator','admin')) with check ((select private.current_revenue_member_role()) in ('operator','admin'));
