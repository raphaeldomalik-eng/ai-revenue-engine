-- Keep historical gross reservations/counters unchanged. Charge completed,
-- validated zero-cost work by actual HTTP; retain full active/unknown work and
-- unjournalled counter debt. The same 1400 daily and 140/run ceilings remain.
do $migration$
declare opening text;reservation text;old_open text;old_reserve text;charge text;accounted text;
begin
 select pg_get_functiondef('public.open_nexus_directory_run(text,text,text,integer,integer,jsonb)'::regprocedure) into opening;
 select pg_get_functiondef('public.reserve_nexus_directory_run_work(jsonb)'::regprocedure) into reservation;
 if position('resources_confirmed_http_v1' in opening)>0 and position('resources_confirmed_http_v1' in reservation)>0 then return;end if;
 old_open:='greatest(coalesce((select b.reserved_requests from public.nexus_directory_daily_budget b where b.policy_id=p_policy_id and b.day=d),0),coalesce(sum(w.reserved_requests),0))';
 old_reserve:='if b.reserved_requests+req>least(1400,(p.policy->>''maxRequestsPerDay'')::integer)';
 if position(old_open in opening)=0 or position(old_reserve in reservation)=0
  or position('DIRECTORY_SERVICE_ROLE_REQUIRED' in opening)=0 or position('DIRECTORY_SERVICE_ROLE_REQUIRED' in reservation)=0 then raise exception 'DIRECTORY_HTTP_ACCOUNTING_SOURCE_DRIFT';end if;
 charge:='case when w.state<>''RESERVED'' and w.completed_at is not null and w.request_count between 0 and w.reserved_requests and w.cost_usd=0 then w.request_count else greatest(w.reserved_requests,coalesce(w.request_count,w.reserved_requests)) end';
 accounted:='(coalesce(sum('||charge||'),0)+greatest(0,coalesce((select b.reserved_requests from public.nexus_directory_daily_budget b where b.policy_id=p_policy_id and b.day=d),0)-coalesce(sum(w.reserved_requests),0)))';
 opening:=replace(opening,old_open,'/* resources_confirmed_http_v1 */ '||accounted);
 accounted:='(select coalesce(sum('||charge||'),0)+greatest(0,b.reserved_requests-coalesce(sum(w.reserved_requests),0)) from public.nexus_directory_work_receipt w where w.policy_id=p.policy_id and w.day=d)';
 reservation:=replace(reservation,old_reserve,'/* resources_confirmed_http_v1 */ if '||accounted||'+req>least(1400,(p.policy->>''maxRequestsPerDay'')::integer)');
 execute opening;execute reservation;
end $migration$;
