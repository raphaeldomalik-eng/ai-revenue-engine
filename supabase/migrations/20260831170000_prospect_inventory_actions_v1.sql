-- Prospect Inventory V2: append-only operator classifications and next actions.
-- The function remains SECURITY INVOKER so existing RLS and operator checks apply.

alter table public.ai_prospect_review_decisions
  drop constraint if exists ai_prospect_review_decisions_decision_check;
alter table public.ai_prospect_review_decisions
  add constraint ai_prospect_review_decisions_decision_check
  check (decision in ('BLOCKED', 'REOPENED', 'QUALIFIED', 'REJECTED', 'DUPLICATED', 'NEXT_ACTION_SET'));

alter table public.ai_prospect_review_decisions
  drop constraint if exists ai_prospect_review_decision_shape;
alter table public.ai_prospect_review_decisions
  add constraint ai_prospect_review_decision_shape check (
    (decision in ('BLOCKED', 'REJECTED', 'DUPLICATED') and reason_code is not null and
      ((reason_code = 'OTHER' and char_length(trim(coalesce(other_explanation, ''))) between 3 and 500)
        or (reason_code <> 'OTHER' and other_explanation is null)))
    or (decision in ('REOPENED', 'QUALIFIED', 'NEXT_ACTION_SET') and reason_code is null and other_explanation is null)
  );

create or replace function public.record_ai_prospect_inventory_action(
  p_candidate_id uuid,
  p_action text,
  p_reason_code text default null,
  p_other_explanation text default null,
  p_note text default null,
  p_next_action text default null,
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
  decision_value text;
begin
  if p_reviewer_id is distinct from (select auth.uid())
    or (select private.current_revenue_member_role()) not in ('operator', 'admin') then
    raise exception 'PROSPECT_REVIEW_OPERATOR_REQUIRED';
  end if;
  if p_action not in ('QUALIFY', 'REJECT', 'BLOCK', 'MARK_DUPLICATE', 'RESTORE', 'SET_NEXT_ACTION') then
    raise exception 'PROSPECT_REVIEW_ACTION_INVALID';
  end if;
  if p_note is not null and char_length(p_note) > 1000 then raise exception 'PROSPECT_BLOCK_NOTE_TOO_LONG'; end if;
  if p_action = 'SET_NEXT_ACTION' and (nullif(trim(p_next_action), '') is null or char_length(trim(p_next_action)) > 500) then
    raise exception 'PROSPECT_NEXT_ACTION_INVALID';
  end if;

  select * into candidate from public.ai_prospect_candidates where id = p_candidate_id for update;
  if not found then raise exception 'PROSPECT_NOT_FOUND'; end if;

  if p_action = 'QUALIFY' then
    update public.ai_prospect_candidates set status = 'QUALIFIED' where id = p_candidate_id;
    decision_value := 'QUALIFIED';
  elsif p_action = 'REJECT' then
    update public.ai_prospect_candidates set status = 'REJECTED' where id = p_candidate_id;
    decision_value := 'REJECTED';
  elsif p_action = 'BLOCK' then
    update public.ai_prospect_candidates set status = 'BLOCKED' where id = p_candidate_id;
    insert into public.ai_prospect_approval_reviews (candidate_id, decision, note, reviewer_id)
    select p_candidate_id, 'REVOKED', 'Prospect blocked by supervised review.', p_reviewer_id
    where exists (select 1 from public.ai_prospect_approval_reviews where candidate_id = p_candidate_id and decision = 'APPROVED');
    decision_value := 'BLOCKED';
  elsif p_action = 'MARK_DUPLICATE' then
    update public.ai_prospect_candidates set status = 'DUPLICATE' where id = p_candidate_id;
    decision_value := 'DUPLICATED';
  elsif p_action = 'RESTORE' then
    update public.ai_prospect_candidates set status = 'REVIEW_REQUIRED' where id = p_candidate_id;
    decision_value := 'REOPENED';
  else
    update public.ai_prospect_candidates
      set prospect_intelligence = jsonb_set(coalesce(prospect_intelligence, '{}'::jsonb), '{recommendedNextAction}', to_jsonb(trim(p_next_action)), true)
      where id = p_candidate_id;
    decision_value := 'NEXT_ACTION_SET';
  end if;

  insert into public.ai_prospect_review_decisions (candidate_id, decision, reason_code, other_explanation, note, previous_status, reviewer_id)
  values (p_candidate_id, decision_value, p_reason_code, p_other_explanation, nullif(trim(p_note), ''), candidate.status, p_reviewer_id)
  returning * into saved;
  return saved;
end;
$$;

revoke all on function public.record_ai_prospect_inventory_action(uuid, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.record_ai_prospect_inventory_action(uuid, text, text, text, text, text, uuid) to authenticated;

comment on function public.record_ai_prospect_inventory_action(uuid, text, text, text, text, text, uuid) is
  'Append-only, operator-gated classifications and next-action updates for the prospect inventory. It never initiates enrichment or outreach.';
