-- Operator prospect queue performance. This migration is committed for review;
-- it must be applied through the normal deployment migration process and is not
-- run by the application or this delivery checkpoint.
alter table public.ai_prospect_candidates
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.touch_ai_prospect_candidate_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ai_prospect_candidates_updated_at on public.ai_prospect_candidates;
create trigger ai_prospect_candidates_updated_at
before update on public.ai_prospect_candidates
for each row execute function public.touch_ai_prospect_candidate_updated_at();

create index if not exists ai_prospect_candidates_status_territory_updated_idx
  on public.ai_prospect_candidates(status, territory_code, updated_at desc);
create index if not exists ai_prospect_candidates_updated_idx
  on public.ai_prospect_candidates(updated_at desc);
create index if not exists ai_prospect_candidates_origin_status_idx
  on public.ai_prospect_candidates(origin, status, updated_at desc);

create index if not exists ai_prospect_review_decisions_state_idx
  on public.ai_prospect_review_decisions(decision, created_at desc, candidate_id);
create index if not exists ai_prospect_candidates_email_state_idx
  on public.ai_prospect_candidates((contact_research ->> 'status'), updated_at desc);

-- Review and approval history indexes already exist in the approval migrations:
-- ai_prospect_review_decisions_candidate_idx and
-- ai_prospect_approval_reviews_candidate_idx. No RLS or approval policy changes
-- are made here.
