-- Raphael approved one additional 1400 HTTP requests on 2 November only.
-- Preserve the standing policy/hash, actual usage, gross reservations, provider
-- allowances, per-run/per-site limits and all host/identity/retry guards.
-- The date uses each existing function's UTC server day, never client input.
do $migration$
declare signature text;definition text;old_limit text;new_limit text;
begin
 old_limit:='least(1400,(p.policy->>''maxRequestsPerDay'')::integer)';
 new_limit:='(least(1400,(p.policy->>''maxRequestsPerDay'')::integer)+case when d=date ''2026-11-02'' and p.policy_id=''resources-sa-uk-per-run-20261025'' then 1400 else 0 end)';
 foreach signature in array array['public.open_nexus_directory_run(text,text,text,integer,integer,jsonb)','public.reserve_nexus_directory_run_work(jsonb)'] loop
  select pg_get_functiondef(signature::regprocedure) into definition;
  if position('resources_one_time_http_20261102' in definition)>0 then continue;end if;
  if position(old_limit in definition)=0 or position('resources_confirmed_http_v1' in definition)=0 or position('DIRECTORY_SERVICE_ROLE_REQUIRED' in definition)=0 then raise exception 'DIRECTORY_ONE_TIME_HTTP_SOURCE_DRIFT';end if;
  definition:=replace(definition,old_limit,'/* resources_one_time_http_20261102 */ '||new_limit);
  execute definition;
 end loop;
end $migration$;
