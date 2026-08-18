-- Secure Persistence Foundation V1.
-- Targets the current production schema; review and test locally before activation.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table if not exists public.revenue_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  member_role text not null check (member_role in ('admin', 'operator', 'viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Compatibility additions mirror the current live schema without rewriting existing tables.
alter table public.accounts
  add column if not exists country_code text,
  add column if not exists region text,
  add column if not exists organisation_type text,
  add column if not exists source text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.contacts
  add column if not exists full_name text,
  add column if not exists role_title text,
  add column if not exists seniority text,
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists decision_role text,
  add column if not exists verification_status text,
  add column if not exists source text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- A Direct opportunity may be known before self-service versus demo routing is selected.
alter table public.product_opportunities
  alter column commercial_program_id drop not null,
  add column if not exists product_id uuid references public.products(id),
  add column if not exists territory_id uuid references public.territories(id),
  add column if not exists sales_motion_id uuid references public.sales_motions(id),
  add column if not exists client_segment text,
  add column if not exists conversion_route text,
  add column if not exists qualitative_confidence text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.research_evidence
  add column if not exists evidence_type text,
  add column if not exists claim text,
  add column if not exists source_url text,
  add column if not exists source_title text,
  add column if not exists observed_at timestamptz,
  add column if not exists source_reference text,
  add column if not exists evidence_kind text,
  add column if not exists qualitative_confidence text,
  add column if not exists notes text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.activities
  add column if not exists opportunity_id uuid references public.product_opportunities(id),
  add column if not exists summary text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.product_opportunities
  drop constraint if exists product_opportunities_conversion_route_check,
  add constraint product_opportunities_conversion_route_check
    check (conversion_route is null or conversion_route in ('UNDETERMINED', 'SELF_SERVICE', 'QUALIFIED_LIVE_DEMO', 'BUSINESS_OPPORTUNITY_ENQUIRY'));

alter table public.product_opportunities
  drop constraint if exists product_opportunities_qualitative_confidence_check,
  add constraint product_opportunities_qualitative_confidence_check
    check (qualitative_confidence is null or qualitative_confidence in ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'));

alter table public.research_evidence
  drop constraint if exists research_evidence_evidence_kind_check,
  add constraint research_evidence_evidence_kind_check
    check (evidence_kind is null or evidence_kind in ('FACT', 'INFERENCE')),
  drop constraint if exists research_evidence_qualitative_confidence_check,
  add constraint research_evidence_qualitative_confidence_check
    check (qualitative_confidence is null or qualitative_confidence in ('NONE', 'LOW', 'MEDIUM', 'HIGH'));

create index if not exists product_opportunities_account_id_idx on public.product_opportunities(account_id);
create index if not exists product_opportunities_context_idx on public.product_opportunities(product_id, territory_id, sales_motion_id);
create index if not exists research_evidence_account_id_idx on public.research_evidence(account_id);
create index if not exists activities_account_id_idx on public.activities(account_id);
create index if not exists activities_opportunity_id_idx on public.activities(opportunity_id);

create or replace function private.is_active_revenue_member()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.revenue_members member
    where member.user_id = (select auth.uid())
      and member.active
  );
$$;

create or replace function private.current_revenue_member_role()
returns text
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select member.member_role
  from public.revenue_members member
  where member.user_id = (select auth.uid())
    and member.active;
$$;

revoke all on function private.is_active_revenue_member() from public;
revoke all on function private.current_revenue_member_role() from public;
grant execute on function private.is_active_revenue_member() to authenticated;
grant execute on function private.current_revenue_member_role() to authenticated;

alter table public.revenue_members enable row level security;
alter table public.products enable row level security;
alter table public.territories enable row level security;
alter table public.sales_motions enable row level security;
alter table public.icps enable row level security;
alter table public.commercial_programs enable row level security;
alter table public.accounts enable row level security;
alter table public.contacts enable row level security;
alter table public.product_opportunities enable row level security;
alter table public.research_evidence enable row level security;
alter table public.activities enable row level security;

revoke all on table public.revenue_members from anon, authenticated;
revoke all on table public.products, public.territories, public.sales_motions, public.icps, public.commercial_programs from anon, authenticated;
revoke all on table public.accounts, public.contacts, public.product_opportunities, public.research_evidence, public.activities from anon, authenticated;

grant select on table public.revenue_members to authenticated;
grant select on table public.products, public.territories, public.sales_motions, public.icps, public.commercial_programs to authenticated;
grant select, insert, update, delete on table public.accounts, public.contacts, public.product_opportunities, public.research_evidence, public.activities to authenticated;

drop policy if exists "revenue members read own membership" on public.revenue_members;
create policy "revenue members read own membership" on public.revenue_members for select to authenticated
  using ((select auth.uid()) = user_id and (select private.is_active_revenue_member()));

drop policy if exists "active members read products" on public.products;
drop policy if exists "active members read territories" on public.territories;
drop policy if exists "active members read sales motions" on public.sales_motions;
drop policy if exists "active members read icps" on public.icps;
drop policy if exists "active members read commercial programs" on public.commercial_programs;
create policy "active members read products" on public.products for select to authenticated using ((select private.is_active_revenue_member()));
create policy "active members read territories" on public.territories for select to authenticated using ((select private.is_active_revenue_member()));
create policy "active members read sales motions" on public.sales_motions for select to authenticated using ((select private.is_active_revenue_member()));
create policy "active members read icps" on public.icps for select to authenticated using ((select private.is_active_revenue_member()));
create policy "active members read commercial programs" on public.commercial_programs for select to authenticated using ((select private.is_active_revenue_member()));

drop policy if exists "active members read accounts" on public.accounts;
drop policy if exists "operators manage accounts" on public.accounts;
drop policy if exists "active members read contacts" on public.contacts;
drop policy if exists "operators manage contacts" on public.contacts;
drop policy if exists "active members read product opportunities" on public.product_opportunities;
drop policy if exists "operators manage product opportunities" on public.product_opportunities;
drop policy if exists "active members read research evidence" on public.research_evidence;
drop policy if exists "operators manage research evidence" on public.research_evidence;
drop policy if exists "active members read activities" on public.activities;
drop policy if exists "operators manage activities" on public.activities;

create policy "active members read accounts" on public.accounts for select to authenticated using ((select private.is_active_revenue_member()));
create policy "operators manage accounts" on public.accounts for all to authenticated using ((select private.current_revenue_member_role()) in ('operator', 'admin')) with check ((select private.current_revenue_member_role()) in ('operator', 'admin'));
create policy "active members read contacts" on public.contacts for select to authenticated using ((select private.is_active_revenue_member()));
create policy "operators manage contacts" on public.contacts for all to authenticated using ((select private.current_revenue_member_role()) in ('operator', 'admin')) with check ((select private.current_revenue_member_role()) in ('operator', 'admin'));
create policy "active members read product opportunities" on public.product_opportunities for select to authenticated using ((select private.is_active_revenue_member()));
create policy "operators manage product opportunities" on public.product_opportunities for all to authenticated using ((select private.current_revenue_member_role()) in ('operator', 'admin')) with check ((select private.current_revenue_member_role()) in ('operator', 'admin'));
create policy "active members read research evidence" on public.research_evidence for select to authenticated using ((select private.is_active_revenue_member()));
create policy "operators manage research evidence" on public.research_evidence for all to authenticated using ((select private.current_revenue_member_role()) in ('operator', 'admin')) with check ((select private.current_revenue_member_role()) in ('operator', 'admin'));
create policy "active members read activities" on public.activities for select to authenticated using ((select private.is_active_revenue_member()));
create policy "operators manage activities" on public.activities for all to authenticated using ((select private.current_revenue_member_role()) in ('operator', 'admin')) with check ((select private.current_revenue_member_role()) in ('operator', 'admin'));

comment on table public.revenue_members is 'Internal AI Revenue Engine company users only. Future Local Operator/partner users require a separate partner domain.';
comment on column public.product_opportunities.commercial_program_id is 'Nullable until a final conversion route/program is selected; Direct UNDETERMINED opportunities must not be forced into self-service or demo.';
