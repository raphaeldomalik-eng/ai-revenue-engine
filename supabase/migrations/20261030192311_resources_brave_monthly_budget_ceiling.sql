-- Owner-approved Brave monthly ceiling: USD 10. Other provider ceilings stay USD 5.
-- This changes no allocation, usage, receipt, enabled state, policy or expiry.
alter table public.nexus_directory_search_allowance
 drop constraint nexus_directory_search_allowance_allocated_micro_usd_check;
alter table public.nexus_directory_search_allowance
 add constraint nexus_directory_search_allowance_allocated_micro_usd_check
 check (allocated_micro_usd between 1 and
   case when provider_id='brave-web-search' then 10000000 else 5000000 end);
