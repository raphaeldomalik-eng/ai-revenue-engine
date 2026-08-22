-- Append-only supervised review feedback. This is isolated from model prompts,
-- training and the existing outreach sending tables.
create table if not exists public.ai_prospect_review_decisions (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.ai_prospect_candidates(id) on delete cascade,
  decision text not null check (decision in ('BLOCKED', 'REOPENED')),
  reason_code text check (reason_code in ('NOT_RELEVANT', 'WRONG_IDENTITY', 'DUPLICATE', 'COMPETITOR_PROVIDER', 'NO_EVENT_ACTIVITY', 'CONTACT_NOT_USEFUL', 'TOO_LARGE', 'OTHER')),
  other_explanation text,
  note text,
  previous_status text,
  reviewer_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint ai_prospect_review_decision_shape check (
    (decision = 'BLOCKED' and reason_code is not null and
      ((reason_code = 'OTHER' and char_length(trim(coalesce(other_explanation, ''))) between 3 and 500)
        or (reason_code <> 'OTHER' and other_explanation is null)))
    or (decision = 'REOPENED' and reason_code is null and other_explanation is null)
  ),
  constraint ai_prospect_review_note_length check (note is null or char_length(note) <= 1000)
);

create index if not exists ai_prospect_review_decisions_candidate_idx
  on public.ai_prospect_review_decisions(candidate_id, created_at desc);

alter table public.ai_prospect_review_decisions enable row level security;
revoke all on table public.ai_prospect_review_decisions from anon, authenticated;
grant select, insert on table public.ai_prospect_review_decisions to authenticated;

create policy "active members read prospect review decisions"
  on public.ai_prospect_review_decisions for select to authenticated
  using ((select private.is_active_revenue_member()));

create policy "operators create prospect review decisions"
  on public.ai_prospect_review_decisions for insert to authenticated
  with check (
    reviewer_id = (select auth.uid())
    and (select private.current_revenue_member_role()) in ('operator', 'admin')
  );

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

  select * into candidate
  from public.ai_prospect_candidates
  where id = p_candidate_id
  for update;
  if not found then raise exception 'PROSPECT_NOT_FOUND'; end if;

  if p_decision = 'BLOCKED' then
    if candidate.status = 'BLOCKED' then raise exception 'PROSPECT_ALREADY_BLOCKED'; end if;
    update public.ai_prospect_candidates set status = 'BLOCKED' where id = p_candidate_id;
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

comment on table public.ai_prospect_review_decisions is
  'Append-only supervised prospect review feedback. Never used to retrain models or modify production prompts.';
