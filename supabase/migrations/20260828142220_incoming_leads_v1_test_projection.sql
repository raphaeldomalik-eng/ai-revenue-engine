-- Propagate the immutable submission's test boundary to the operator projection.

create or replace function public.sync_incoming_lead_test_state()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.incoming_lead_id is not null and new.is_test then
    update public.incoming_leads
    set is_test = true, updated_at = now()
    where id = new.incoming_lead_id;
  end if;
  return new;
end $$;

drop trigger if exists incoming_submission_test_projection_trigger on public.incoming_submissions;
create trigger incoming_submission_test_projection_trigger
after update of incoming_lead_id, is_test on public.incoming_submissions
for each row execute function public.sync_incoming_lead_test_state();

update public.incoming_leads lead
set is_test = true, updated_at = now()
from public.incoming_submissions submission
where submission.incoming_lead_id = lead.id
  and submission.is_test;
