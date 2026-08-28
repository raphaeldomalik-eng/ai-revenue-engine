-- Make the activity idempotency key a named constraint so the existing
-- ON CONFLICT (incoming_submission_id) clause is valid PostgreSQL syntax.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.activities'::regclass
      and conname = 'activities_incoming_submission_unique'
  ) then
    alter table public.activities
      add constraint activities_incoming_submission_unique unique (incoming_submission_id);
  end if;
end $$;

drop index if exists public.activities_incoming_submission_uidx;
