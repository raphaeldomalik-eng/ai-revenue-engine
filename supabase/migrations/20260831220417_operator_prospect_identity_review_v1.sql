-- Operator Workspace V1: canonical prospect identity resolution and one atomic review save.
-- This migration creates prospect organisations only in the outbound prospect domain.
-- It never creates an Event Suite account, tenant, opportunity, contact or outreach record.

create table if not exists public.ai_prospect_organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 300),
  website text,
  territory_code text check (territory_code in ('ZA', 'GB')),
  source_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(source_refs) = 'array'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_prospect_identity_resolutions (
  id uuid primary key default gen_random_uuid(),
  event_prospect_id uuid not null references public.ai_prospect_candidates(id) on delete cascade,
  canonical_organisation_id uuid references public.ai_prospect_organisations(id) on delete set null,
  relationship_type text not null check (relationship_type in ('ORGANISES', 'OPERATES', 'PROMOTES', 'OWNS', 'NOT_APPLICABLE')),
  resolution_status text not null check (resolution_status in ('UNRESOLVED', 'RESOLVED', 'CONFLICTING_EVIDENCE', 'NOT_APPLICABLE')),
  evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  operator_note text check (operator_note is null or char_length(operator_note) <= 1000),
  actor_id uuid not null references auth.users(id),
  resolved_at timestamptz,
  idempotency_key text not null check (char_length(trim(idempotency_key)) between 8 and 200),
  created_at timestamptz not null default now()
);

create unique index if not exists ai_prospect_identity_resolutions_idempotency_idx
  on public.ai_prospect_identity_resolutions(event_prospect_id, idempotency_key);
create index if not exists ai_prospect_identity_resolutions_current_idx
  on public.ai_prospect_identity_resolutions(event_prospect_id, created_at desc, id desc);

create table if not exists public.ai_prospect_review_operations (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.ai_prospect_candidates(id) on delete cascade,
  idempotency_key text not null check (char_length(trim(idempotency_key)) between 8 and 200),
  response jsonb not null,
  created_at timestamptz not null default now(),
  unique (candidate_id, idempotency_key)
);

alter table public.ai_prospect_organisations enable row level security;
alter table public.ai_prospect_identity_resolutions enable row level security;
alter table public.ai_prospect_review_operations enable row level security;
revoke all on table public.ai_prospect_organisations, public.ai_prospect_identity_resolutions, public.ai_prospect_review_operations from anon, authenticated;
grant select on table public.ai_prospect_organisations, public.ai_prospect_identity_resolutions to authenticated;
grant select, insert on table public.ai_prospect_review_operations to authenticated;
grant insert on table public.ai_prospect_organisations, public.ai_prospect_identity_resolutions to authenticated;

drop policy if exists "active members read prospect organisations" on public.ai_prospect_organisations;
create policy "active members read prospect organisations"
  on public.ai_prospect_organisations for select to authenticated
  using ((select private.is_active_revenue_member()));
drop policy if exists "operators create prospect organisations" on public.ai_prospect_organisations;
create policy "operators create prospect organisations"
  on public.ai_prospect_organisations for insert to authenticated
  with check (created_by = (select auth.uid()) and (select private.current_revenue_member_role()) in ('operator', 'admin'));

drop policy if exists "active members read identity resolutions" on public.ai_prospect_identity_resolutions;
create policy "active members read identity resolutions"
  on public.ai_prospect_identity_resolutions for select to authenticated
  using ((select private.is_active_revenue_member()));
drop policy if exists "operators create identity resolutions" on public.ai_prospect_identity_resolutions;
create policy "operators create identity resolutions"
  on public.ai_prospect_identity_resolutions for insert to authenticated
  with check (actor_id = (select auth.uid()) and (select private.current_revenue_member_role()) in ('operator', 'admin'));

drop policy if exists "operators read review operations" on public.ai_prospect_review_operations;
create policy "operators read review operations"
  on public.ai_prospect_review_operations for select to authenticated
  using ((select private.current_revenue_member_role()) in ('operator', 'admin'));
drop policy if exists "operators create review operations" on public.ai_prospect_review_operations;
create policy "operators create review operations"
  on public.ai_prospect_review_operations for insert to authenticated
  with check ((select private.current_revenue_member_role()) in ('operator', 'admin'));

alter table public.ai_prospect_review_decisions
  drop constraint if exists ai_prospect_review_decisions_decision_check;
alter table public.ai_prospect_review_decisions
  add constraint ai_prospect_review_decisions_decision_check
  check (decision in ('BLOCKED', 'REOPENED', 'QUALIFIED', 'REJECTED', 'DUPLICATED', 'NEXT_ACTION_SET', 'REVIEW_SAVED'));
alter table public.ai_prospect_review_decisions
  drop constraint if exists ai_prospect_review_decision_shape;
alter table public.ai_prospect_review_decisions
  add constraint ai_prospect_review_decision_shape check (
    (decision in ('BLOCKED', 'REJECTED', 'DUPLICATED') and reason_code is not null and
      ((reason_code = 'OTHER' and char_length(trim(coalesce(other_explanation, ''))) between 3 and 500)
        or (reason_code <> 'OTHER' and other_explanation is null)))
    or (decision in ('REOPENED', 'QUALIFIED', 'NEXT_ACTION_SET', 'REVIEW_SAVED') and reason_code is null and other_explanation is null)
  );

create or replace function public.record_ai_prospect_review(
  p_candidate_id uuid,
  p_resolution_status text,
  p_canonical_organisation_id uuid default null,
  p_relationship_type text default null,
  p_evidence_refs jsonb default '[]'::jsonb,
  p_operator_note text default null,
  p_new_organisation jsonb default null,
  p_next_action text default null,
  p_outcome text default null,
  p_reason_code text default null,
  p_other_explanation text default null,
  p_review_note text default null,
  p_idempotency_key text default null,
  p_reviewer_id uuid default auth.uid()
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  candidate public.ai_prospect_candidates;
  existing_response jsonb;
  saved_decision public.ai_prospect_review_decisions;
  organisation public.ai_prospect_organisations;
  resolution_status_value text := upper(trim(coalesce(p_resolution_status, '')));
  relationship_value text := upper(trim(coalesce(p_relationship_type, '')));
  outcome_value text := upper(trim(coalesce(p_outcome, '')));
  reason_value text := upper(trim(coalesce(p_reason_code, '')));
  organisation_name_value text;
  organisation_website_value text;
  organisation_sources jsonb;
  canonical_organisation_id_value uuid := p_canonical_organisation_id;
  decision_value text := 'REVIEW_SAVED';
  response_value jsonb;
begin
  if p_reviewer_id is distinct from (select auth.uid())
    or (select private.current_revenue_member_role()) not in ('operator', 'admin') then
    raise exception 'PROSPECT_REVIEW_OPERATOR_REQUIRED';
  end if;
  if p_candidate_id is null then raise exception 'PROSPECT_ID_REQUIRED'; end if;
  if nullif(trim(p_idempotency_key), '') is null or char_length(trim(p_idempotency_key)) > 200 then
    raise exception 'PROSPECT_REVIEW_IDEMPOTENCY_REQUIRED';
  end if;
  if p_review_note is not null and char_length(p_review_note) > 1000 then raise exception 'PROSPECT_BLOCK_NOTE_TOO_LONG'; end if;
  if p_operator_note is not null and char_length(p_operator_note) > 1000 then raise exception 'PROSPECT_IDENTITY_NOTE_TOO_LONG'; end if;
  if p_next_action is not null and char_length(trim(p_next_action)) > 500 then raise exception 'PROSPECT_NEXT_ACTION_INVALID'; end if;
  if jsonb_typeof(coalesce(p_evidence_refs, '[]'::jsonb)) <> 'array' then raise exception 'PROSPECT_EVIDENCE_REFS_INVALID'; end if;
  if resolution_status_value not in ('UNRESOLVED', 'RESOLVED', 'CONFLICTING_EVIDENCE', 'NOT_APPLICABLE') then raise exception 'PROSPECT_IDENTITY_STATUS_INVALID'; end if;
  if relationship_value not in ('ORGANISES', 'OPERATES', 'PROMOTES', 'OWNS', 'NOT_APPLICABLE') then raise exception 'PROSPECT_RELATIONSHIP_INVALID'; end if;
  if outcome_value not in ('', 'QUALIFY', 'REJECT', 'BLOCK', 'DUPLICATE') then raise exception 'PROSPECT_REVIEW_OUTCOME_INVALID'; end if;

  select response into existing_response
  from public.ai_prospect_review_operations
  where candidate_id = p_candidate_id and idempotency_key = trim(p_idempotency_key);
  if existing_response is not null then return existing_response; end if;

  select * into candidate from public.ai_prospect_candidates where id = p_candidate_id for update;
  if not found then raise exception 'PROSPECT_NOT_FOUND'; end if;
  if candidate.origin = 'EVENT_FIRST' and resolution_status_value = 'NOT_APPLICABLE' then
    raise exception 'PROSPECT_EVENT_IDENTITY_REQUIRED';
  end if;

  if p_new_organisation is not null then
    if canonical_organisation_id_value is not null or jsonb_typeof(p_new_organisation) <> 'object' then
      raise exception 'PROSPECT_ORGANISATION_INPUT_INVALID';
    end if;
    organisation_name_value := nullif(trim(p_new_organisation ->> 'name'), '');
    organisation_website_value := nullif(trim(p_new_organisation ->> 'website'), '');
    organisation_sources := coalesce(p_new_organisation -> 'sourceRefs', p_evidence_refs, '[]'::jsonb);
    if organisation_name_value is null or char_length(organisation_name_value) > 300 then raise exception 'PROSPECT_ORGANISATION_NAME_REQUIRED'; end if;
    if jsonb_typeof(organisation_sources) <> 'array' or jsonb_array_length(organisation_sources) = 0 then raise exception 'PROSPECT_ORGANISATION_SOURCE_REQUIRED'; end if;
    insert into public.ai_prospect_organisations (name, website, territory_code, source_refs, created_by)
    values (organisation_name_value, organisation_website_value, candidate.territory_code, organisation_sources, p_reviewer_id)
    returning * into organisation;
    canonical_organisation_id_value := organisation.id;
  end if;
  if resolution_status_value = 'RESOLVED' and canonical_organisation_id_value is null then raise exception 'PROSPECT_CANONICAL_ORGANISATION_REQUIRED'; end if;
  if resolution_status_value = 'RESOLVED' and jsonb_array_length(p_evidence_refs) = 0 then raise exception 'PROSPECT_IDENTITY_EVIDENCE_REQUIRED'; end if;
  if resolution_status_value in ('UNRESOLVED', 'CONFLICTING_EVIDENCE', 'NOT_APPLICABLE') and canonical_organisation_id_value is not null then raise exception 'PROSPECT_ORGANISATION_INPUT_INVALID'; end if;

  if p_next_action is not null or p_operator_note is not null or resolution_status_value is not null then
    insert into public.ai_prospect_identity_resolutions (event_prospect_id, canonical_organisation_id, relationship_type, resolution_status, evidence_refs, operator_note, actor_id, resolved_at, idempotency_key)
    values (p_candidate_id, canonical_organisation_id_value, relationship_value, resolution_status_value, p_evidence_refs, nullif(trim(p_operator_note), ''), p_reviewer_id, case when resolution_status_value = 'RESOLVED' then now() else null end, trim(p_idempotency_key));
    update public.ai_prospect_candidates
      set prospect_intelligence = jsonb_set(
        coalesce(prospect_intelligence, '{}'::jsonb),
        '{organisationResolution}',
        coalesce(prospect_intelligence -> 'organisationResolution', '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
          'status', resolution_status_value,
          'canonicalOrganisationId', canonical_organisation_id_value,
          'relationshipType', relationship_value,
          'evidenceRefs', p_evidence_refs,
          'operatorNote', nullif(trim(p_operator_note), ''),
          'resolvedAt', case when resolution_status_value = 'RESOLVED' then now() else null end
        )),
        true
      )
    where id = p_candidate_id;
  end if;

  if outcome_value = 'QUALIFY' then
    if candidate.status in ('REJECTED', 'BLOCKED', 'DUPLICATE') then raise exception 'PROSPECT_RESTORE_REQUIRED'; end if;
    if resolution_status_value in ('UNRESOLVED', 'CONFLICTING_EVIDENCE') then raise exception 'PROSPECT_IDENTITY_GATE_FAILED'; end if;
    if candidate.origin in ('EVENT_FIRST', 'ORGANISATION_FIRST') and canonical_organisation_id_value is null then raise exception 'PROSPECT_IDENTITY_GATE_FAILED'; end if;
    if jsonb_array_length(p_evidence_refs) = 0 then raise exception 'PROSPECT_EVIDENCE_GATE_FAILED'; end if;
    update public.ai_prospect_candidates set status = 'QUALIFIED' where id = p_candidate_id;
    decision_value := 'QUALIFIED';
  elsif outcome_value in ('REJECT', 'BLOCK', 'DUPLICATE') then
    if reason_value not in ('NOT_RELEVANT', 'WRONG_IDENTITY', 'DUPLICATE', 'COMPETITOR_PROVIDER', 'NO_EVENT_ACTIVITY', 'CONTACT_NOT_USEFUL', 'TOO_LARGE', 'OTHER') then raise exception 'PROSPECT_BLOCK_REASON_INVALID'; end if;
    if reason_value = 'OTHER' and char_length(trim(coalesce(p_other_explanation, ''))) not between 3 and 500 then raise exception 'PROSPECT_BLOCK_OTHER_EXPLANATION_REQUIRED'; end if;
    if reason_value <> 'OTHER' and p_other_explanation is not null then raise exception 'PROSPECT_BLOCK_OTHER_EXPLANATION_INVALID'; end if;
    if outcome_value = 'REJECT' then update public.ai_prospect_candidates set status = 'REJECTED' where id = p_candidate_id; decision_value := 'REJECTED';
    elsif outcome_value = 'BLOCK' then update public.ai_prospect_candidates set status = 'BLOCKED' where id = p_candidate_id; decision_value := 'BLOCKED';
    else update public.ai_prospect_candidates set status = 'DUPLICATE' where id = p_candidate_id; decision_value := 'DUPLICATED'; end if;
  end if;

  insert into public.ai_prospect_review_decisions (candidate_id, decision, reason_code, other_explanation, note, previous_status, reviewer_id)
  values (p_candidate_id, decision_value, case when outcome_value in ('REJECT', 'BLOCK', 'DUPLICATE') then reason_value else null end, case when reason_value = 'OTHER' then nullif(trim(p_other_explanation), '') else null end, nullif(trim(p_review_note), ''), candidate.status, p_reviewer_id)
  returning * into saved_decision;

  response_value := jsonb_build_object(
    'candidateId', p_candidate_id,
    'status', (select status from public.ai_prospect_candidates where id = p_candidate_id),
    'resolutionStatus', resolution_status_value,
    'canonicalOrganisationId', canonical_organisation_id_value,
    'relationshipType', relationship_value,
    'outcome', nullif(outcome_value, ''),
    'decision', saved_decision,
    'savedAt', now()
  );
  insert into public.ai_prospect_review_operations (candidate_id, idempotency_key, response)
  values (p_candidate_id, trim(p_idempotency_key), response_value);
  return response_value;
end;
$$;

revoke all on function public.record_ai_prospect_review(uuid, text, uuid, text, jsonb, text, jsonb, text, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.record_ai_prospect_review(uuid, text, uuid, text, jsonb, text, jsonb, text, text, text, text, text, text, uuid) to authenticated;

comment on table public.ai_prospect_organisations is 'Canonical organisations in the outbound prospect domain; never an Event Suite account by default.';
comment on table public.ai_prospect_identity_resolutions is 'Append-only operator identity decisions with evidence, actor, server timestamp and idempotency key.';
comment on table public.ai_prospect_review_operations is 'Idempotency ledger for atomic prospect review saves.';
comment on function public.record_ai_prospect_review(uuid, text, uuid, text, jsonb, text, jsonb, text, text, text, text, text, text, uuid) is
  'Atomically persists prospect identity resolution, review fields and optional lifecycle outcome. It never initiates enrichment or outreach.';
