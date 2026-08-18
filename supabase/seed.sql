insert into public.products (code, name, active) values
  ('event-suite', 'Event Suite', true), ('allxs', 'Allxs', false), ('prestige-id', 'Prestige ID', false)
on conflict (code) do nothing;
insert into public.territories (code, name) values ('za', 'South Africa'), ('uk', 'United Kingdom') on conflict (code) do nothing;
insert into public.sales_motions (code, name) values ('direct', 'Direct Customer Acquisition'), ('lno', 'Local Network Operator Recruitment') on conflict (code) do nothing;
