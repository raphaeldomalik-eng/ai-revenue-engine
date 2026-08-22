-- Outreach Composer V1: isolated, draft-only, append-only review memory.
create table if not exists public.ai_outreach_drafts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  ai_sales_brief_id uuid references public.ai_sales_briefs(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  prompt_version text not null check (prompt_version = 'outreach-composer-v1'),
  originating_lane text,
  recipient_name text,
  recipient_role text,
  recipient_email text,
  evidence_snapshot jsonb not null default '[]'::jsonb,
  stop_state text not null default 'CLEAR',
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'STOPPED', 'COMPLETED', 'BLOCKED')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.ai_outreach_draft_versions (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.ai_outreach_drafts(id) on delete cascade,
  sequence_number integer not null check (sequence_number between 0 and 2),
  revision_number integer not null default 0 check (revision_number >= 0),
  source_kind text not null check (source_kind in ('MODEL_DRAFT', 'AI_REVISION', 'HUMAN_EDIT')),
  prompt_version text not null check (prompt_version = 'outreach-composer-v1'),
  sequence_stage text not null check (sequence_stage in ('EMAIL_1', 'EMAIL_2', 'EMAIL_3', 'REVISION')),
  model_status text not null check (model_status in ('DRAFT_READY', 'HUMAN_REVIEW_REQUIRED', 'DO_NOT_DRAFT')),
  message_type text not null,
  subject text not null,
  body_plain_text text not null,
  rendered_body text not null,
  structured_output jsonb not null default '{}'::jsonb,
  human_instruction text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (draft_id, sequence_number, revision_number)
);

create table if not exists public.ai_outreach_draft_reviews (
  id uuid primary key default gen_random_uuid(),
  draft_version_id uuid not null references public.ai_outreach_draft_versions(id) on delete cascade,
  action text not null check (action in ('APPROVE', 'REJECT', 'REQUEST_REVISION', 'EDIT_APPROVE', 'RATE')),
  edited_subject text,
  edited_body_plain_text text,
  relevance_rating integer check (relevance_rating between 1 and 5),
  tone_rating integer check (tone_rating between 1 and 5),
  reason_tags jsonb not null default '[]'::jsonb,
  note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists ai_outreach_drafts_account_idx on public.ai_outreach_drafts(account_id, created_at desc);
create index if not exists ai_outreach_versions_draft_idx on public.ai_outreach_draft_versions(draft_id, sequence_number, revision_number desc);
create index if not exists ai_outreach_reviews_version_idx on public.ai_outreach_draft_reviews(draft_version_id, created_at desc);

alter table public.ai_outreach_drafts enable row level security;
alter table public.ai_outreach_draft_versions enable row level security;
alter table public.ai_outreach_draft_reviews enable row level security;

revoke all on table public.ai_outreach_drafts, public.ai_outreach_draft_versions, public.ai_outreach_draft_reviews from anon, authenticated;
grant select, insert on table public.ai_outreach_drafts, public.ai_outreach_draft_versions, public.ai_outreach_draft_reviews to authenticated;

create policy "active members read composer drafts" on public.ai_outreach_drafts for select to authenticated using ((select private.is_active_revenue_member()));
create policy "operators create composer drafts" on public.ai_outreach_drafts for insert to authenticated with check ((select private.current_revenue_member_role()) in ('operator', 'admin'));
create policy "active members read composer versions" on public.ai_outreach_draft_versions for select to authenticated using ((select private.is_active_revenue_member()));
create policy "operators create composer versions" on public.ai_outreach_draft_versions for insert to authenticated with check ((select private.current_revenue_member_role()) in ('operator', 'admin'));
create policy "active members read composer reviews" on public.ai_outreach_draft_reviews for select to authenticated using ((select private.is_active_revenue_member()));
create policy "operators create composer reviews" on public.ai_outreach_draft_reviews for insert to authenticated with check ((select private.current_revenue_member_role()) in ('operator', 'admin'));

comment on table public.ai_outreach_drafts is 'Draft-only Outreach Composer V1 memory. Deliberately isolated from outreach_messages and all sending infrastructure.';
comment on table public.ai_outreach_draft_versions is 'Append-only Composer model/revision/edit versions. No current text is updated in place.';
comment on table public.ai_outreach_draft_reviews is 'Append-only human review, approval, rejection and feedback records. Never authorises sending.';
