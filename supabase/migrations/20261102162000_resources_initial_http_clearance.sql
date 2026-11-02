-- Owner policy correction: initial inventory is bounded by each run/site/host,
-- not recurring daily business volume. Keep usage accounting and every other
-- guard. On completion, the existing trusted phase restores 100/day and 1400/day.
do $migration$
declare signature text;definition text;dated_limit text;normal_limit text;old_gate text;new_gate text;
begin
 normal_limit:='least(1400,(p.policy->>''maxRequestsPerDay'')::integer)';
 dated_limit:='/* resources_one_time_http_20261102 */ ('||normal_limit||'+case when d=date ''2026-11-02'' and p.policy_id=''resources-sa-uk-per-run-20261025'' then 1400 else 0 end)';
 foreach signature in array array['public.open_nexus_directory_run(text,text,text,integer,integer,jsonb)','public.reserve_nexus_directory_run_work(jsonb)'] loop
  select pg_get_functiondef(signature::regprocedure) into definition;
  if position('resources_initial_inventory_http_v1' in definition)>0 then continue;end if;
  if position(dated_limit in definition)=0 or position('resources_confirmed_http_v1' in definition)=0 or position('DIRECTORY_SERVICE_ROLE_REQUIRED' in definition)=0 then raise exception 'DIRECTORY_INITIAL_HTTP_SOURCE_DRIFT';end if;
  definition:=replace(definition,dated_limit,normal_limit);
  if signature like 'public.open_nexus_directory_run%' then
   old_gate:='case when requests_reserved+least(14,';
   new_gate:='case when /* resources_initial_inventory_http_v1 */ phase<>''INITIAL_INVENTORY'' and requests_reserved+least(14,';
  else
   old_gate:='/* resources_confirmed_http_v1 */ if ';
   new_gate:='/* resources_confirmed_http_v1 */ /* resources_initial_inventory_http_v1 */ if run.execution_phase<>''INITIAL_INVENTORY'' and ';
  end if;
  if position(old_gate in definition)=0 then raise exception 'DIRECTORY_INITIAL_HTTP_GATE_DRIFT';end if;
  definition:=replace(definition,old_gate,new_gate);execute definition;
 end loop;
end $migration$;
