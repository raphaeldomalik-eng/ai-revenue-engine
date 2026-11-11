-- Production-shaped AIRE schema for the release-runner tests.
-- The four tables below are generated from the Production catalog (columns, defaults, NOT NULL, primary keys, check constraints) of
-- project cdcfmnlmshnustrqficy on 2026-11-11, the tables public.reserve_directory_search reads and writes. Production row data is not copied.
-- The two helper functions at the end are TEST DOUBLES: the release does not touch them (Production's are 6,092 and 1,360 characters and
-- are unchanged by the acceleration migration); they only let reserve_directory_search run against this fixture.
create table public.nexus_directory_run(
  run_id uuid not null default gen_random_uuid(),
  policy_id text not null,
  policy_sha256 text not null,
  worker_id text not null,
  state text not null default 'RUNNING'::text,
  max_venues integer not null,
  max_requests integer not null,
  reserved_venues integer not null default 0,
  reserved_requests integer not null default 0,
  brave_max_requests integer not null default 0,
  serper_max_requests integer not null default 0,
  brave_requests integer not null default 0,
  serper_requests integer not null default 0,
  started_at timestamp with time zone not null default now(),
  lease_until timestamp with time zone not null default (now() + '00:30:00'::interval),
  completed_at timestamp with time zone,
  receipt jsonb,
  execution_phase text not null default 'LEGACY'::text,
  constraint nexus_directory_run_pkey PRIMARY KEY (run_id),
  constraint nexus_directory_run_brave_max_requests_check CHECK (((brave_max_requests >= 0) AND (brave_max_requests <= 500))),
  constraint nexus_directory_run_check CHECK (((reserved_venues >= 0) AND (reserved_venues <= max_venues))),
  constraint nexus_directory_run_check1 CHECK (((reserved_requests >= 0) AND (reserved_requests <= max_requests))),
  constraint nexus_directory_run_check2 CHECK (((brave_requests >= 0) AND (brave_requests <= brave_max_requests))),
  constraint nexus_directory_run_check3 CHECK (((serper_requests >= 0) AND (serper_requests <= serper_max_requests))),
  constraint nexus_directory_run_execution_phase_check CHECK ((execution_phase = ANY (ARRAY['LEGACY'::text, 'INITIAL_INVENTORY'::text, 'ONGOING_ENRICHMENT'::text]))),
  constraint nexus_directory_run_max_requests_check CHECK (((max_requests >= 1) AND (max_requests <= 2500))),
  constraint nexus_directory_run_max_venues_check CHECK (((max_venues >= 1) AND (max_venues <= 500))),
  constraint nexus_directory_run_serper_max_requests_check CHECK (((serper_max_requests >= 0) AND (serper_max_requests <= 500))),
  constraint nexus_directory_run_state_check CHECK ((state = ANY (ARRAY['RUNNING'::text, 'COMPLETED'::text, 'EXPIRED'::text]))));
create table public.nexus_directory_search_allowance(
  allowance_id text not null,
  allocated_micro_usd bigint not null,
  price_per_request_micro_usd bigint not null,
  max_requests integer not null,
  reserved_micro_usd bigint not null default 0,
  request_count integer not null default 0,
  verified_at timestamp with time zone not null,
  expires_at timestamp with time zone not null,
  verification_ref text not null,
  enabled boolean not null default false,
  provider_id text not null default 'brave-web-search'::text,
  requires_run boolean not null default false,
  policy_id text,
  provider_account_snapshot jsonb not null default '{}'::jsonb,
  provider_account_history jsonb not null default '[]'::jsonb,
  provider_alert_state jsonb not null default '{}'::jsonb,
  constraint nexus_directory_search_allowance_pkey PRIMARY KEY (allowance_id),
  constraint directory_provider_lifetime_calls CHECK (((request_count >= 0) AND ((provider_id = 'brave-web-search'::text) OR (request_count <= max_requests)))),
  constraint directory_provider_lifetime_credit CHECK (((reserved_micro_usd >= 0) AND ((provider_id = 'brave-web-search'::text) OR (reserved_micro_usd <= allocated_micro_usd)))),
  constraint directory_run_allowance_policy CHECK (((NOT requires_run) OR (policy_id IS NOT NULL))),
  constraint nexus_directory_search_allowa_price_per_request_micro_usd_check CHECK ((price_per_request_micro_usd > 0)),
  constraint nexus_directory_search_allowanc_provider_account_snapshot_check CHECK ((jsonb_typeof(provider_account_snapshot) = 'object'::text)),
  constraint nexus_directory_search_allowance_allocated_micro_usd_check CHECK (((allocated_micro_usd >= 1) AND (allocated_micro_usd <=
CASE
    WHEN (provider_id = 'brave-web-search'::text) THEN 10000000
    ELSE 5000000
END))),
  constraint nexus_directory_search_allowance_check CHECK ((expires_at > verified_at)),
  constraint nexus_directory_search_allowance_max_requests_check CHECK (((max_requests >= 1) AND (max_requests <= 10000))),
  constraint nexus_directory_search_allowance_provider_account_history_check CHECK ((jsonb_typeof(provider_account_history) = 'array'::text)),
  constraint nexus_directory_search_allowance_provider_alert_state_check CHECK ((jsonb_typeof(provider_alert_state) = 'object'::text)),
  constraint nexus_directory_search_allowance_provider_id_check CHECK ((provider_id = ANY (ARRAY['brave-web-search'::text, 'serper-google-search'::text]))),
  constraint nexus_directory_search_allowance_request_count_check CHECK ((request_count >= 0)),
  constraint nexus_directory_search_allowance_reserved_micro_usd_check CHECK ((reserved_micro_usd >= 0)),
  constraint nexus_directory_search_allowance_verification_ref_check CHECK ((length(verification_ref) > 0)));
create table public.nexus_directory_search_receipt(
  query_sha256 text not null,
  allowance_id text not null,
  request_key text not null,
  parameters jsonb not null,
  reserved_micro_usd bigint not null,
  state text not null default 'RESERVED'::text,
  results jsonb,
  provider_usage jsonb,
  error_code text,
  reserved_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone,
  cache_expires_at timestamp with time zone,
  constraint nexus_directory_search_receipt_pkey PRIMARY KEY (query_sha256),
  constraint nexus_directory_search_receipt_query_sha256_check CHECK ((query_sha256 ~ '^[a-f0-9]{64}$'::text)),
  constraint nexus_directory_search_receipt_reserved_micro_usd_check CHECK ((reserved_micro_usd > 0)),
  constraint nexus_directory_search_receipt_state_check CHECK ((state = ANY (ARRAY['RESERVED'::text, 'COMPLETED'::text, 'FAILED'::text]))));
create table public.nexus_directory_standing_policy(
  policy_id text not null,
  policy_sha256 text not null,
  policy jsonb not null,
  enabled boolean not null default false,
  consecutive_failures integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  initial_inventory_snapshot_sha256 text,
  initial_inventory_completed_at timestamp with time zone,
  constraint nexus_directory_standing_policy_pkey PRIMARY KEY (policy_id),
  constraint nexus_directory_standing_pol_initial_inventory_snapshot_s_check CHECK ((initial_inventory_snapshot_sha256 ~ '^[a-f0-9]{64}$'::text)),
  constraint nexus_directory_standing_policy_policy_sha256_check CHECK ((policy_sha256 ~ '^[0-9a-f]{64}$'::text)));
-- TEST DOUBLES (see header)
create function public.policy_is_active(p_policy jsonb) returns boolean language sql stable as $$ select true $$;
create function public.directory_provider_budget_state(p_allowance_id text,p_at timestamp with time zone default now()) returns jsonb language sql stable as
 $$ select jsonb_build_object('conservativeRemainingMicroUsd',1000000000) $$;
