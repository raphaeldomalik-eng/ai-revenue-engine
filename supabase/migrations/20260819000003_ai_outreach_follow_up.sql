-- AI Outreach & Follow-up V1: bounded, human-approved email execution.
create table if not exists public.outreach_sequences (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  ai_sales_brief_id uuid references public.ai_sales_briefs(id) on delete set null,
  created_by uuid references auth.users(id),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CANCELLED', 'STOPPED', 'COMPLETED')),
  outreach_goal text not null,
  overall_strategy text not null,
  stop_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.outreach_messages (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.outreach_sequences(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  sequence_number integer not null check (sequence_number between 0 and 2),
  channel text not null default 'EMAIL' check (channel = 'EMAIL'),
  recipient_email text,
  subject text not null,
  body text not null,
  rationale text not null,
  evidence_references jsonb not null default '[]'::jsonb,
  cta text,
  stop_conditions jsonb not null default '[]'::jsonb,
  status text not null default 'NEEDS_APPROVAL' check (status in ('NEEDS_APPROVAL', 'APPROVED', 'SCHEDULED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  scheduled_for timestamptz,
  provider text,
  provider_message_id text,
  send_attempts integer not null default 0,
  sent_at timestamptz,
  sent_subject text,
  sent_body text,
  failure_reason text,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sequence_id, sequence_number)
);

create table if not exists public.outreach_suppressions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  reason text not null check (reason in ('DO_NOT_CONTACT', 'UNSUBSCRIBED', 'BOUNCED_INVALID', 'MANUAL_STOP', 'REPLIED_ENGAGED')),
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists outreach_sequences_account_idx on public.outreach_sequences(account_id);
create index if not exists outreach_messages_due_idx on public.outreach_messages(status, scheduled_for);
create index if not exists outreach_messages_account_idx on public.outreach_messages(account_id);
create index if not exists outreach_suppressions_lookup_idx on public.outreach_suppressions(account_id, contact_id, active);

alter table public.outreach_sequences enable row level security;
alter table public.outreach_messages enable row level security;
alter table public.outreach_suppressions enable row level security;

revoke all on table public.outreach_sequences, public.outreach_messages, public.outreach_suppressions from anon, authenticated;
grant select, insert, update, delete on table public.outreach_sequences, public.outreach_messages, public.outreach_suppressions to authenticated;

drop policy if exists "active members read outreach sequences" on public.outreach_sequences;
create policy "active members read outreach sequences" on public.outreach_sequences for select to authenticated using ((select private.is_active_revenue_member()));
drop policy if exists "operators manage outreach sequences" on public.outreach_sequences;
create policy "operators manage outreach sequences" on public.outreach_sequences for all to authenticated using ((select private.current_revenue_member_role()) in ('operator', 'admin')) with check ((select private.current_revenue_member_role()) in ('operator', 'admin'));

drop policy if exists "active members read outreach messages" on public.outreach_messages;
create policy "active members read outreach messages" on public.outreach_messages for select to authenticated using ((select private.is_active_revenue_member()));
drop policy if exists "operators manage outreach messages" on public.outreach_messages;
create policy "operators manage outreach messages" on public.outreach_messages for all to authenticated using ((select private.current_revenue_member_role()) in ('operator', 'admin')) with check ((select private.current_revenue_member_role()) in ('operator', 'admin'));

drop policy if exists "active members read outreach suppressions" on public.outreach_suppressions;
create policy "active members read outreach suppressions" on public.outreach_suppressions for select to authenticated using ((select private.is_active_revenue_member()));
drop policy if exists "operators manage outreach suppressions" on public.outreach_suppressions;
create policy "operators manage outreach suppressions" on public.outreach_suppressions for all to authenticated using ((select private.current_revenue_member_role()) in ('operator', 'admin')) with check ((select private.current_revenue_member_role()) in ('operator', 'admin'));

comment on table public.outreach_sequences is 'Bounded human-approved AI sales outreach. Not a bulk marketing campaign model.';
comment on column public.outreach_messages.recipient_email is 'Only a persisted known or explicitly operator-entered address; never inferred by the AI.';
