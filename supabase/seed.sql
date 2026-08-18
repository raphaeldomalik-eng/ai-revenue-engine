insert into public.products (slug, name, status) values
  ('event-suite', 'Event Suite', 'active'), ('allxs', 'Allxs', 'future'), ('prestige-id', 'Prestige ID', 'future')
on conflict (slug) do nothing;
insert into public.territories (code, name) values ('ZA', 'South Africa'), ('GB', 'United Kingdom') on conflict (code) do nothing;
insert into public.sales_motions (slug, name) values ('direct', 'Direct Customer Acquisition'), ('lno', 'Local Network Operator Recruitment') on conflict (slug) do nothing;
