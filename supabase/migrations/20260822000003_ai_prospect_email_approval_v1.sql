-- Separate supervised prospect approval and per-message Composer approval.
-- This ledger is append-only and isolated from legacy outreach sending tables.

alter table public.ai_outreach_drafts
  add column if not exists candidate_id uuid references public.ai_prospect_candidates(id) on delete set null;

create index if not exists ai_outreach_drafts_candidate_idx
  on public.ai_outreach_drafts(candidate_id, created_at desc);

alter table public.ai_outreach_draft_reviews
  drop constraint if exists ai_outreach_draft_reviews_action_check;
alter table public.ai_outreach_draft_reviews
  add constraint ai_outreach_draft_reviews_action_check
  check (action in ('APPROVE', 'REJECT', 'REQUEST_REVISION', 'EDIT', 'EDIT_APPROVE', 'RATE'));

create table if not exists public.ai_prospect_approval_reviews (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.ai_prospect_candidates(id) on delete cascade,
  decision text not null check (decision in ('APPROVED', 'REVOKED')),
  note text,
  reviewer_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint ai_prospect_approval_note_length check (note is null or char_length(note) <= 1000)
);

create index if not exists ai_prospect_approval_reviews_candidate_idx
  on public.ai_prospect_approval_reviews(candidate_id, created_at desc);

alter table public.ai_prospect_approval_reviews enable row level security;
revoke all on table public.ai_prospect_approval_reviews from anon, authenticated;
grant select, insert on table public.ai_prospect_approval_reviews to authenticated;

create policy "active members read prospect approvals"
  on public.ai_prospect_approval_reviews for select to authenticated
  using ((select private.is_active_revenue_member()));

create policy "operators create prospect approvals"
  on public.ai_prospect_approval_reviews for insert to authenticated
  with check (
    reviewer_id = (select auth.uid())
    and (select private.current_revenue_member_role()) in ('operator', 'admin')
  );

create or replace function public.record_ai_prospect_approval(
  p_candidate_id uuid,
  p_note text default null,
  p_reviewer_id uuid default auth.uid()
)
returns public.ai_prospect_approval_reviews
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  candidate public.ai_prospect_candidates;
  latest public.ai_prospect_approval_reviews;
  saved public.ai_prospect_approval_reviews;
begin
  if p_reviewer_id is distinct from (select auth.uid())
    or (select private.current_revenue_member_role()) not in ('operator', 'admin') then
    raise exception 'PROSPECT_APPROVAL_OPERATOR_REQUIRED';
  end if;
  if p_note is not null and char_length(p_note) > 1000 then raise exception 'PROSPECT_APPROVAL_NOTE_TOO_LONG'; end if;

  select * into candidate from public.ai_prospect_candidates where id = p_candidate_id for update;
  if not found then raise exception 'PROSPECT_NOT_FOUND'; end if;
  if candidate.status = 'BLOCKED' then raise exception 'PROSPECT_BLOCKED'; end if;

  select * into latest from public.ai_prospect_approval_reviews
  where candidate_id = p_candidate_id order by created_at desc limit 1;
  if latest.decision = 'APPROVED' then raise exception 'PROSPECT_ALREADY_APPROVED'; end if;

  insert into public.ai_prospect_approval_reviews (candidate_id, decision, note, reviewer_id)
  values (p_candidate_id, 'APPROVED', nullif(trim(p_note), ''), p_reviewer_id)
  returning * into saved;
  return saved;
end;
$$;

revoke all on function public.record_ai_prospect_approval(uuid, text, uuid) from public, anon;
grant execute on function public.record_ai_prospect_approval(uuid, text, uuid) to authenticated;

-- Blocking or reopening always requires a fresh prospect approval. The block
-- decision remains in its existing append-only table; this is only the linked
-- approval revocation record.
create or replace function public.record_ai_prospect_review_decision(
  p_candidate_id uuid,
  p_decision text,
  p_reason_code text default null,
  p_other_explanation text default null,
  p_note text default null,
  p_reviewer_id uuid default auth.uid()
)
returns public.ai_prospect_review_decisions
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  candidate public.ai_prospect_candidates;
  saved public.ai_prospect_review_decisions;
begin
  if p_reviewer_id is distinct from (select auth.uid())
    or (select private.current_revenue_member_role()) not in ('operator', 'admin') then
    raise exception 'PROSPECT_REVIEW_OPERATOR_REQUIRED';
  end if;
  select * into candidate from public.ai_prospect_candidates where id = p_candidate_id for update;
  if not found then raise exception 'PROSPECT_NOT_FOUND'; end if;

  if p_decision = 'BLOCKED' then
    if candidate.status = 'BLOCKED' then raise exception 'PROSPECT_ALREADY_BLOCKED'; end if;
    update public.ai_prospect_candidates set status = 'BLOCKED' where id = p_candidate_id;
    insert into public.ai_prospect_approval_reviews (candidate_id, decision, note, reviewer_id)
    select p_candidate_id, 'REVOKED', 'Prospect blocked by supervised review.', p_reviewer_id
    where exists (select 1 from public.ai_prospect_approval_reviews where candidate_id = p_candidate_id and decision = 'APPROVED');
  elsif p_decision = 'REOPENED' then
    if candidate.status <> 'BLOCKED' then raise exception 'PROSPECT_NOT_BLOCKED'; end if;
    update public.ai_prospect_candidates set status = 'REVIEW_REQUIRED' where id = p_candidate_id;
  else
    raise exception 'PROSPECT_REVIEW_DECISION_INVALID';
  end if;

  insert into public.ai_prospect_review_decisions (candidate_id, decision, reason_code, other_explanation, note, previous_status, reviewer_id)
  values (p_candidate_id, p_decision, p_reason_code, p_other_explanation, p_note, candidate.status, p_reviewer_id)
  returning * into saved;
  return saved;
end;
$$;

revoke all on function public.record_ai_prospect_review_decision(uuid, text, text, text, text, uuid) from public, anon;
grant execute on function public.record_ai_prospect_review_decision(uuid, text, text, text, text, uuid) to authenticated;

comment on table public.ai_prospect_approval_reviews is
  'Append-only supervised prospect approval ledger. Approval only permits draft preparation; it never approves or sends email.';
