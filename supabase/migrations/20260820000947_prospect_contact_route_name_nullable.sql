-- A public organisation-level contact route may be valid without a named person.
-- Keeping this nullable prevents the application from fabricating a person merely
-- to persist a published generic email address, phone number or contact page.
alter table public.contacts
  alter column full_name drop not null;
