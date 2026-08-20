-- Prospect Contact Discovery & Verification V1.
-- Contact rows and research evidence remain the source of truth; this small
-- candidate-level snapshot also records the valid "no contact found" result.
alter table public.ai_prospect_candidates
  add column if not exists contact_research jsonb not null default '{}'::jsonb;

comment on column public.ai_prospect_candidates.contact_research is
  'Latest bounded public-contact research result. It records CONTACT_FOUND, CONTACT_ROUTE_FOUND or CONTACT_RESEARCH_REQUIRED without authorising outreach.';
