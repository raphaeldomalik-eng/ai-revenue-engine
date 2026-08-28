-- Incoming Leads V1 corrective hardening. Forward-only after 20260828000001.

create or replace function public.incoming_submission_environment_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.is_test := new.is_test or new.environment <> 'PRODUCTION' or new.source_category = 'INTERNAL_TEST';
  return new;
end $$;

drop trigger if exists incoming_submission_environment_trigger on public.incoming_submissions;
create trigger incoming_submission_environment_trigger
before insert on public.incoming_submissions
for each row execute function public.incoming_submission_environment_guard();

update public.incoming_submissions
set is_test = true
where environment <> 'PRODUCTION' or source_category = 'INTERNAL_TEST';

create index if not exists activities_incoming_lead_idx
  on public.activities(incoming_lead_id, occurred_at desc);

revoke execute on function public.ingest_incoming_submission(jsonb) from anon;
revoke execute on function public.update_incoming_lead(uuid, text, jsonb) from anon;
