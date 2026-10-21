-- Additive local commercial intelligence. Nexus IDs are references to the remote
-- canonical registry, never newly generated canonical identities. No backfill.
create table public.organisation_contact_intelligence (
  nexus_organisation_id uuid primary key,
  identity jsonb not null check (jsonb_typeof(identity)='object'
    and identity ?& array['entityType','nexusOrganisationId','domain']
    and jsonb_typeof(identity->'entityType')='string'
    and jsonb_typeof(identity->'nexusOrganisationId')='string'
    and jsonb_typeof(identity->'domain')='string'
    and identity->>'entityType'='ORGANISATION'
    and identity->>'nexusOrganisationId'=nexus_organisation_id::text
    and length(identity->>'domain')>0),
  revision bigint not null default 1 check (revision>0),
  shortlist jsonb not null default '[]'::jsonb check (jsonb_typeof(shortlist)='array' and jsonb_array_length(shortlist)<=5),
  selections jsonb not null default '[]'::jsonb check (jsonb_typeof(selections)='array' and jsonb_array_length(selections)<=50
    and not jsonb_path_exists(selections, '$[*] ? (!exists(@.sourceMode) || @.sourceMode != "REPLAY" || !exists(@.emailReady) || @.emailReady != false || !exists(@.enrichmentAuthorised) || @.enrichmentAuthorised != false || !exists(@.outreachAuthorised) || @.outreachAuthorised != false)')),
  replay_fingerprint text check (replay_fingerprint is null or replay_fingerprint ~ '^[a-f0-9]{64}$'),
  replay_observed_at timestamptz,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (octet_length(identity::text)+octet_length(shortlist::text)+octet_length(selections::text)<=200000)
);
alter table public.organisation_contact_intelligence enable row level security;
revoke all on public.organisation_contact_intelligence from public,anon,authenticated;
grant select,insert on public.organisation_contact_intelligence to authenticated;
grant update(identity,revision,shortlist,selections,replay_fingerprint,replay_observed_at,updated_by,updated_at)
  on public.organisation_contact_intelligence to authenticated;
create policy "active members read organisation contact intelligence"
  on public.organisation_contact_intelligence for select to authenticated
  using ((select private.is_active_revenue_member()));
create policy "operators create organisation contact intelligence"
  on public.organisation_contact_intelligence for insert to authenticated
  with check ((select private.current_revenue_member_role()) in ('operator','admin') and created_by=(select auth.uid()) and updated_by=(select auth.uid()));
create policy "operators update organisation contact intelligence"
  on public.organisation_contact_intelligence for update to authenticated
  using ((select private.current_revenue_member_role()) in ('operator','admin'))
  with check ((select private.current_revenue_member_role()) in ('operator','admin') and updated_by=(select auth.uid()));
comment on table public.organisation_contact_intelligence is
  'AIRE-local replay research and human selection; no verified contact, enrichment or outreach authority. Nexus retains canonical identity ownership.';
