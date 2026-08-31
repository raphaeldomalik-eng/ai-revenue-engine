-- Correct the inherited anon EXECUTE privilege on the new operator-only RPCs.

revoke execute on function public.bulk_update_incoming_leads(uuid[],text,jsonb) from anon;
revoke execute on function public.list_incoming_lead_queue(text,text,text,text,text,uuid,boolean,text,timestamptz,timestamptz,text,text,text,integer,integer) from anon;
revoke execute on function public.incoming_lead_operational_metrics() from anon;
