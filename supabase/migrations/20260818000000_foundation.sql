create extension if not exists pgcrypto;

create table if not exists public.products (id uuid primary key default gen_random_uuid(), slug text unique not null, name text not null, status text not null check (status in ('active','future')), created_at timestamptz not null default now());
create table if not exists public.territories (id uuid primary key default gen_random_uuid(), code text unique not null, name text not null);
create table if not exists public.sales_motions (id uuid primary key default gen_random_uuid(), slug text unique not null, name text not null);
create table if not exists public.icps (id uuid primary key default gen_random_uuid(), name text not null, status text not null default 'placeholder', notes text);
create table if not exists public.commercial_programs (id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products(id), territory_id uuid not null references public.territories(id), sales_motion_id uuid not null references public.sales_motions(id), icp_id uuid references public.icps(id), conversion_goal text not null, created_at timestamptz not null default now());
create table if not exists public.accounts (id uuid primary key default gen_random_uuid(), name text not null, website text, created_at timestamptz not null default now());
create table if not exists public.contacts (id uuid primary key default gen_random_uuid(), account_id uuid not null references public.accounts(id), name text, email text, title text, created_at timestamptz not null default now());
create table if not exists public.product_opportunities (id uuid primary key default gen_random_uuid(), account_id uuid not null references public.accounts(id), product_id uuid not null references public.products(id), commercial_program_id uuid references public.commercial_programs(id), stage text not null default 'identified', created_at timestamptz not null default now());
create table if not exists public.research_evidence (id uuid primary key default gen_random_uuid(), account_id uuid references public.accounts(id), contact_id uuid references public.contacts(id), source_url text, evidence text, created_at timestamptz not null default now());
create table if not exists public.activities (id uuid primary key default gen_random_uuid(), account_id uuid references public.accounts(id), contact_id uuid references public.contacts(id), product_opportunity_id uuid references public.product_opportunities(id), activity_type text not null, occurred_at timestamptz not null default now(), notes text);

do $$ declare t text; begin foreach t in array array['products','territories','sales_motions','icps','commercial_programs','accounts','contacts','product_opportunities','research_evidence','activities'] loop execute format('alter table public.%I enable row level security', t); end loop; end $$;

comment on schema public is 'Revenue foundation. RLS is enabled on all revenue tables and browser policies are intentionally absent until authentication/access roles are designed.';
