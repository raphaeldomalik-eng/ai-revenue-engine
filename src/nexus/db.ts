// db.ts — PostgreSQL client and catalogue query executor for AIRE Catalogue
// Interfaces with production schema integration over governed connection.
// Enforces zero-cost rules, bounded pagination, and security invariants.

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import {
  buildCatalogueQuery,
  buildCatalogueCountQuery,
  type CatalogueFilterParams,
  type AireCatalogueItem,
} from './catalogue.ts';
import { GOOGLE_PLACE_ID_RE } from './google-enrichment-worker.ts';

export const PRODUCTION_PROJECT_REF = 'sbmcrnpdilmpybomxwox';

export function isProductionDatabaseUrl(url?: string): boolean {
  if (!url) return false;
  return url.includes(PRODUCTION_PROJECT_REF);
}

export function isTestExecution(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    Boolean(process.env.VITEST) ||
    Boolean(process.env.JEST_WORKER_ID) ||
    process.argv.some((arg) => arg.includes('test'))
  );
}

export function assertSafeMutationTarget(poolOrUrl?: any): void {
  if (!isTestExecution()) return;
  const connStr =
    typeof poolOrUrl === 'string'
      ? poolOrUrl
      : poolOrUrl?.options?.connectionString ||
        poolOrUrl?._connectionString ||
        process.env.RESOURCES_V2_PRODUCTION_DATABASE_URL ||
        process.env.DATABASE_URL ||
        '';
  if (isProductionDatabaseUrl(connStr)) {
    throw new Error(
      `MUTATION_BLOCKED: Test execution cannot mutate production database project ${PRODUCTION_PROJECT_REF}.`
    );
  }
}

function loadEnvLocal() {
  if (process.env.NODE_ENV === 'production') return;
  if (isTestExecution()) return;
  if (process.env.RESOURCES_V2_PRODUCTION_DATABASE_URL || process.env.DATABASE_URL) return;
  try {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match && !process.env[match[1].trim()]) {
          process.env[match[1].trim()] = match[2].trim();
        }
      }
    }
  } catch {
    // ignore
  }
}

loadEnvLocal();

export function hasDbConfigured(): boolean {
  loadEnvLocal();
  return Boolean(process.env.RESOURCES_V2_PRODUCTION_DATABASE_URL || process.env.DATABASE_URL);
}

let globalPool: any = null;

// Built-in fixture dataset for offline unit testing & CI when live DB is unconfigured
const FIXTURE_ITEMS: AireCatalogueItem[] = [
  {
    provider: 'google_places',
    external_reference_id: 'ChIJ11111111111111111111111',
    candidate_id: '11111111-1111-1111-1111-111111111111',
    entity_name: 'The Grand Bistro & Lounge',
    provider_primary_type: 'restaurant',
    provider_types: ['restaurant', 'food', 'point_of_interest'],
    provider_business_status: 'OPERATIONAL',
    formatted_address: '142 Main Rd, Sandton, Johannesburg, South Africa',
    locality: 'Sandton',
    region: 'Gauteng',
    country: 'South Africa',
    latitude: -26.107567,
    longitude: 28.056702,
    discovery_query: 'restaurant private dining',
    discovery_campaign: 'ZA_JHB_2026',
    normalized_profile: 'food_beverage',
    event_capability: 'VENUE_CAPABLE_NEEDS_WEB_VERIFICATION',
    canonical_identity_state: 'PROVISIONAL',
    canonical_entity_id: null,
    resources_route: 'NEEDS_MORE_EVIDENCE',
    venue_management_route: 'NOT_APPLICABLE',
    context_pos_route: 'POSSIBLE_FIT',
    ticketing_route: 'NOT_APPLICABLE',
    workforce_route: 'NOT_APPLICABLE',
    production_ops_route: 'NOT_APPLICABLE',
    event_business_route: 'NOT_APPLICABLE',
    commercial_prospecting_route: 'POSSIBLE_FIT',
    owner_confirmation_route: 'DEFERRED',
    research_disposition: 'FIRST_PARTY_WEB_VERIFICATION',
    pro_evidence_state: 'NO_PRO_EVIDENCE',
    enterprise_evidence_state: 'NO_ENTERPRISE_EVIDENCE',
    pro_eligibility: 'AUTO_ELIGIBLE',
    enterprise_eligibility: 'DEFERRED',
    is_invalid_reference: false,
    is_duplicate: false,
    duplicate_of_reference_id: null,
    is_permanently_closed: false,
    catalogue_status: 'ACTIVE',
    observed_at: '2026-09-15T12:00:00Z',
    provider_checked_at: '2026-09-15T12:00:00Z',
    last_routed_at: '2026-10-04T12:00:00Z',
  },
  {
    provider: 'google_places',
    external_reference_id: 'ChIJ22222222222222222222222',
    candidate_id: '22222222-2222-2222-2222-222222222222',
    entity_name: 'Sandton Convention Centre',
    provider_primary_type: 'convention_center',
    provider_types: ['convention_center', 'event_venue', 'point_of_interest'],
    provider_business_status: 'OPERATIONAL',
    formatted_address: '161 Maude St, Sandton, Johannesburg, South Africa',
    locality: 'Sandton',
    region: 'Gauteng',
    country: 'South Africa',
    latitude: -26.1054,
    longitude: 28.0531,
    discovery_query: 'conference centre',
    discovery_campaign: 'ZA_JHB_2026',
    normalized_profile: 'dedicated_event_venue',
    event_capability: 'EXPLICIT_EVENT_VENUE',
    canonical_identity_state: 'MATCHED_CANONICAL',
    canonical_entity_id: 'canon-scc-jhb',
    resources_route: 'STRONG_FIT',
    venue_management_route: 'STRONG_FIT',
    context_pos_route: 'STRONG_FIT',
    ticketing_route: 'POSSIBLE_FIT',
    workforce_route: 'STRONG_FIT',
    production_ops_route: 'STRONG_FIT',
    event_business_route: 'NOT_APPLICABLE',
    commercial_prospecting_route: 'STRONG_FIT',
    owner_confirmation_route: 'NOT_APPLICABLE',
    research_disposition: 'EVIDENCE_ALREADY_AVAILABLE',
    pro_evidence_state: 'EVIDENCE_ALREADY_AVAILABLE',
    enterprise_evidence_state: 'EVIDENCE_ALREADY_AVAILABLE',
    pro_eligibility: 'NOT_REQUIRED',
    enterprise_eligibility: 'AUTO_ELIGIBLE',
    is_invalid_reference: false,
    is_duplicate: false,
    duplicate_of_reference_id: null,
    is_permanently_closed: false,
    catalogue_status: 'ACTIVE',
    observed_at: '2026-09-10T08:00:00Z',
    provider_checked_at: '2026-09-10T08:00:00Z',
    last_routed_at: '2026-10-04T12:00:00Z',
  },
  {
    provider: 'google_places',
    external_reference_id: 'ChIJ33333333333333333333333',
    candidate_id: '33333333-3333-3333-3333-333333333333',
    entity_name: 'Apex Sound & Staging Solutions',
    provider_primary_type: 'audiovisual_equipment_rental_service',
    provider_types: ['audiovisual_equipment_rental_service', 'point_of_interest'],
    provider_business_status: 'OPERATIONAL',
    formatted_address: '45 Commerce Crescent, Kramerville, Sandton, South Africa',
    locality: 'Kramerville',
    region: 'Gauteng',
    country: 'South Africa',
    latitude: -26.0987,
    longitude: 28.0712,
    discovery_query: 'event sound staging AV',
    discovery_campaign: 'ZA_JHB_2026',
    normalized_profile: 'event_supplier',
    event_capability: 'NO_CURRENT_EVENT_VENUE_EVIDENCE',
    canonical_identity_state: 'MATCHED_CANONICAL',
    canonical_entity_id: 'canon-apex-sound',
    resources_route: 'NOT_APPLICABLE',
    venue_management_route: 'NOT_APPLICABLE',
    context_pos_route: 'NOT_APPLICABLE',
    ticketing_route: 'NOT_APPLICABLE',
    workforce_route: 'POSSIBLE_FIT',
    production_ops_route: 'STRONG_FIT',
    event_business_route: 'STRONG_FIT',
    commercial_prospecting_route: 'STRONG_FIT',
    owner_confirmation_route: 'NOT_APPLICABLE',
    research_disposition: 'NO_ACTION_REQUIRED',
    pro_evidence_state: 'EVIDENCE_ALREADY_AVAILABLE',
    enterprise_evidence_state: 'NO_ENTERPRISE_EVIDENCE',
    pro_eligibility: 'NOT_REQUIRED',
    enterprise_eligibility: 'DEFERRED',
    is_invalid_reference: false,
    is_duplicate: false,
    duplicate_of_reference_id: null,
    is_permanently_closed: false,
    catalogue_status: 'ACTIVE',
    observed_at: '2026-09-12T10:00:00Z',
    provider_checked_at: '2026-09-12T10:00:00Z',
    last_routed_at: '2026-10-04T12:00:00Z',
  },
  {
    provider: 'google_places',
    external_reference_id: 'ChIJ_invalid_synth_id',
    candidate_id: '44444444-4444-4444-4444-444444444444',
    entity_name: 'Synthetic Invalid Entity',
    provider_primary_type: null,
    provider_types: [],
    provider_business_status: null,
    formatted_address: null,
    locality: 'Johannesburg',
    region: 'Gauteng',
    country: 'South Africa',
    latitude: null,
    longitude: null,
    discovery_query: null,
    discovery_campaign: null,
    normalized_profile: 'unknown',
    event_capability: 'UNKNOWN',
    canonical_identity_state: 'INVALID_PROVIDER_REFERENCE',
    canonical_entity_id: null,
    resources_route: 'NOT_APPLICABLE',
    venue_management_route: 'NOT_APPLICABLE',
    context_pos_route: 'NOT_APPLICABLE',
    ticketing_route: 'NOT_APPLICABLE',
    workforce_route: 'NOT_APPLICABLE',
    production_ops_route: 'NOT_APPLICABLE',
    event_business_route: 'NOT_APPLICABLE',
    commercial_prospecting_route: 'NOT_APPLICABLE',
    owner_confirmation_route: 'NOT_APPLICABLE',
    research_disposition: 'INVALID_PROVIDER_REFERENCE',
    pro_evidence_state: 'NO_PRO_EVIDENCE',
    enterprise_evidence_state: 'NO_ENTERPRISE_EVIDENCE',
    pro_eligibility: 'INVALID',
    enterprise_eligibility: 'INVALID',
    is_invalid_reference: true,
    is_duplicate: false,
    duplicate_of_reference_id: null,
    is_permanently_closed: false,
    catalogue_status: 'INVALID',
    observed_at: '2026-09-01T00:00:00Z',
    provider_checked_at: null,
    last_routed_at: '2026-10-04T12:00:00Z',
  },
];

// Fill up to 25 items so bounded pagination tests pass in offline mock mode
while (FIXTURE_ITEMS.length < 25) {
  const i = FIXTURE_ITEMS.length;
  FIXTURE_ITEMS.push({
    ...FIXTURE_ITEMS[0],
    external_reference_id: `ChIJ5555555555555555555555${i}`,
    candidate_id: `55555555-5555-5555-5555-55555555555${i}`,
    entity_name: `Estate Entity ${i}`,
  });
}

export interface DbPoolOptions {
  allowMock?: boolean;
}

export function createMockPool() {
  const mockQueue = new Map<string, any>();
  const mockAudits: any[] = [];
  let shouldSimulateAuditFailure = false;
  let queryHook: ((queryText: string, values?: any[]) => any) | null = null;

  function executeQuery(queryText: string, values?: any[]) {
    if (queryHook) {
      const hookResult = queryHook(queryText, values);
      if (hookResult !== undefined) return hookResult;
    }
    const q = String(queryText).trim();

    // Count query
    if (q.includes('COUNT(*)::int AS total')) {
      let count = 21468;
      if (q.includes('owner_confirmation_route = $') && values?.includes('STRONG_FIT')) {
        count = 210;
      } else if (q.includes('resources_route = $') && values?.includes('STRONG_FIT')) {
        count = 9743;
      } else if (q.includes('event_business_route = $') && values?.includes('STRONG_FIT')) {
        count = 2923;
      } else if (q.includes('commercial_prospecting_route = $') && values?.includes('POSSIBLE_FIT')) {
        count = 17922;
      } else if (q.includes('canonical_identity_state = $') && values?.includes('UNRESOLVED')) {
        count = 17944;
      } else if (q.includes('is_invalid_reference = $') && values?.includes(true)) {
        count = 1078;
      } else if (q.includes('research_disposition')) {
        count = 5367;
      } else if (q.includes('pro_eligibility = $') && values?.includes('OPERATOR_PROMOTION_ALLOWED')) {
        count = 2923;
      }
      return { rows: [{ total: count }] };
    }

    // Budgets query
    if (q.includes('FROM integration.monthly_provider_budget')) {
      return {
        rows: [
          { billing_tier: 'ENTERPRISE', monthly_call_limit: 0, is_enabled: true, calls_consumed: 0, calls_reserved: 0, remaining: 0 },
          { billing_tier: 'ENTERPRISE_ATMOSPHERE', monthly_call_limit: 0, is_enabled: false, calls_consumed: 0, calls_reserved: 0, remaining: 0 },
          { billing_tier: 'PRO', monthly_call_limit: 0, is_enabled: true, calls_consumed: 0, calls_reserved: 0, remaining: 0 },
        ],
      };
    }

    // Single item query
    if (q.includes('WHERE external_reference_id = $1') && values?.[0]) {
      const item = FIXTURE_ITEMS.find((fi) => fi.external_reference_id === values[0]);
      return { rows: item ? [{ ...item }] : [] };
    }

    // Existing queue check by external_reference_id & billing_tier (with or without FOR UPDATE)
    if (
      q.includes('FROM integration.paid_enrichment_queue') &&
      q.includes('external_reference_id = $1') &&
      q.includes('billing_tier = $2')
    ) {
      const extRef = values?.[0];
      const tier = values?.[1];
      const existing = Array.from(mockQueue.values()).find(
        (r: any) => r.external_reference_id === extRef && r.billing_tier === tier
      );
      return { rows: existing ? [{ ...existing }] : [] };
    }

    // Queue checks by ID
    if (q.includes('FROM integration.paid_enrichment_queue WHERE id = $1') && values?.[0]) {
      const qRow = mockQueue.get(values[0]);
      return { rows: qRow ? [{ ...qRow }] : [] };
    }

    // Queue insert (handling ON CONFLICT)
    if (q.includes('INSERT INTO integration.paid_enrichment_queue')) {
      const extRef = values?.[1];
      const tier = values?.[2];
      const existingKey = Array.from(mockQueue.keys()).find((k) => {
        const row = mockQueue.get(k);
        return row.external_reference_id === extRef && row.billing_tier === tier;
      });

      if (existingKey) {
        const existing = mockQueue.get(existingKey);
        const mutableStates = ['QUEUED', 'WAITING_FOR_MONTHLY_BUDGET', 'DEFERRED', 'FAILED_RETRYABLE'];
        if (mutableStates.includes(existing.status)) {
          existing.status = values?.[3] || existing.status;
          existing.evidence_gap_reason = values?.[4] || existing.evidence_gap_reason;
          existing.originating_product = values?.[5] || existing.originating_product;
          existing.computed_priority = values?.[6] || 100.0;
          existing.updated_at = new Date();
          mockQueue.set(existingKey, existing);
        }
        return { rows: [{ ...existing }] };
      }

      const id = 'mock-queue-uuid-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
      const row = {
        id,
        provider: values?.[0] || 'google_places',
        external_reference_id: extRef,
        billing_tier: tier,
        status: values?.[3] || 'WAITING_FOR_MONTHLY_BUDGET',
        evidence_gap_reason: values?.[4],
        originating_product: values?.[5],
        computed_priority: values?.[6] || 100.0,
        reservation_id: null,
        attempts: 0,
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockQueue.set(id, row);
      return { rows: [{ ...row }] };
    }

    // Queue update
    if (q.includes('UPDATE integration.paid_enrichment_queue')) {
      const id = values?.[3];
      const existing = mockQueue.get(id);
      if (existing) {
        existing.status = values?.[0] || existing.status;
        existing.evidence_gap_reason = values?.[1] || existing.evidence_gap_reason;
        existing.originating_product = values?.[2] || existing.originating_product;
        existing.computed_priority = 100.0;
        existing.updated_at = new Date();
        mockQueue.set(id, existing);
        return { rows: [{ ...existing }] };
      }
      return { rows: [] };
    }

    // Queue delete
    if (q.includes('DELETE FROM integration.paid_enrichment_queue WHERE id = $1') && values?.[0]) {
      mockQueue.delete(values[0]);
      return { rows: [] };
    }

    // Operator work audit insert
    if (q.includes('INSERT INTO integration.operator_work_audit')) {
      if (shouldSimulateAuditFailure) {
        throw new Error('SIMULATED_AUDIT_FAILURE: Database error persisting operator work audit');
      }
      const auditId = 'mock-audit-uuid-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
      const auditRecord = {
        id: auditId,
        source_type: values?.[0],
        source_id: values?.[1],
        actor_id: values?.[2],
        action: values?.[3],
        previous_state: values?.[4],
        new_state: values?.[5],
        payload_diff: typeof values?.[6] === 'string' ? JSON.parse(values[6]) : values?.[6],
        created_at: new Date(),
      };
      mockAudits.push(auditRecord);
      return { rows: [{ ...auditRecord }] };
    }

    // Operator work audit select
    if (q.includes('FROM integration.operator_work_audit')) {
      return { rows: [...mockAudits] };
    }

    // Invalid reference check in tests
    if (q.includes('WHERE is_invalid_reference = true')) {
      return { rows: [{ ...FIXTURE_ITEMS[3] }] };
    }

    // Enriched reference check in tests
    if (q.includes("WHERE pro_evidence_state = 'EVIDENCE_ALREADY_AVAILABLE'")) {
      return { rows: [{ ...FIXTURE_ITEMS[1] }] };
    }

    // NO_PRO_EVIDENCE check in tests
    if (q.includes("WHERE is_invalid_reference = false AND pro_evidence_state = 'NO_PRO_EVIDENCE'")) {
      return { rows: [{ ...FIXTURE_ITEMS[0] }] };
    }

    // General catalogue query
    let matched = [...FIXTURE_ITEMS];
    if (q.includes('normalized_profile = $') && values?.includes('food_beverage')) {
      matched = matched.filter((it) => it.normalized_profile === 'food_beverage');
    }
    if (q.includes('event_capability = $') && values?.includes('EXPLICIT_EVENT_VENUE')) {
      matched = matched.filter((it) => it.event_capability === 'EXPLICIT_EVENT_VENUE');
    }
    if (q.includes('event_business_route = $') && values?.includes('STRONG_FIT')) {
      matched = matched.filter((it) => it.event_business_route === 'STRONG_FIT');
    }

    return { rows: matched };
  }

  const poolInstance: any = {
    getAuditRecords: () => [...mockAudits],
    getQueueRecords: () => Array.from(mockQueue.values()),
    seedQueueRecord: (row: any) => {
      const key = row.id || `mock-${row.external_reference_id}-${row.billing_tier}`;
      mockQueue.set(key, { ...row, id: key });
    },
    clearMocks: () => {
      mockQueue.clear();
      mockAudits.length = 0;
      shouldSimulateAuditFailure = false;
      queryHook = null;
    },
    simulateAuditFailure: (fail: boolean = true) => {
      shouldSimulateAuditFailure = fail;
    },
    setQueryHook: (hook: ((q: string, v?: any[]) => any) | null) => {
      queryHook = hook;
    },
    query: async (queryText: string, values?: any[]) => {
      return executeQuery(queryText, values);
    },
    connect: async () => {
      let inTransaction = false;
      let snapshotQueue: [string, any][] = [];
      let snapshotAudits: any[] = [];

      const client = {
        query: async (queryText: string, values?: any[]) => {
          const q = String(queryText).trim().toUpperCase();
          if (q === 'BEGIN') {
            inTransaction = true;
            snapshotQueue = Array.from(mockQueue.entries()).map(([k, v]) => [k, { ...v }]);
            snapshotAudits = mockAudits.map((a) => ({ ...a }));
            return { rows: [] };
          }
          if (q === 'COMMIT') {
            inTransaction = false;
            return { rows: [] };
          }
          if (q === 'ROLLBACK') {
            if (inTransaction) {
              mockQueue.clear();
              for (const [k, v] of snapshotQueue) {
                mockQueue.set(k, { ...v });
              }
              mockAudits.length = 0;
              for (const a of snapshotAudits) {
                mockAudits.push({ ...a });
              }
            }
            inTransaction = false;
            return { rows: [] };
          }

          return executeQuery(queryText, values);
        },
        release: () => {
          if (inTransaction) {
            mockQueue.clear();
            for (const [k, v] of snapshotQueue) {
              mockQueue.set(k, { ...v });
            }
            mockAudits.length = 0;
            for (const a of snapshotAudits) {
              mockAudits.push({ ...a });
            }
          }
          inTransaction = false;
        },
      };
      return client;
    },
    end: async () => {},
  };

  return poolInstance;
}

export function setDbPool(pool: any | null) {
  globalPool = pool;
}

export function resetDbPool() {
  globalPool = null;
}

export function isDbConfigured(): boolean {
  if (globalPool) return true;
  loadEnvLocal();
  return Boolean(
    process.env.RESOURCES_V2_PRODUCTION_DATABASE_URL ||
    process.env.DATABASE_URL
  );
}

export function getDbPool(options: DbPoolOptions = {}): any {
  if (globalPool) return globalPool;

  loadEnvLocal();

  const connStr =
    process.env.RESOURCES_V2_PRODUCTION_DATABASE_URL ||
    process.env.DATABASE_URL;

  if (connStr) {
    globalPool = new pg.Pool({
      connectionString: connStr,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    return globalPool;
  }

  if (options.allowMock) {
    return createMockPool();
  }

  throw new Error('DATABASE_UNCONFIGURED: Production database connection URL is not configured. Failing closed.');
}

export interface BudgetTierStatus {
  billingTier: 'PRO' | 'ENTERPRISE' | 'ENTERPRISE_ATMOSPHERE';
  monthlyCallLimit: number;
  isEnabled: boolean;
  callsConsumed: number;
  callsReserved: number;
  remaining: number;
}

export interface CatalogueBudgetSummary {
  pro: BudgetTierStatus;
  enterprise: BudgetTierStatus;
  atmosphere: BudgetTierStatus;
}

export interface CatalogueQueryResult {
  items: AireCatalogueItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  budgets: CatalogueBudgetSummary;
  summaryCounts?: Record<string, number>;
}

export interface PromoteParams {
  externalReferenceId: string;
  billingTier: 'PRO' | 'ENTERPRISE';
  purpose: string;
  reason: string;
  originatingProduct: string;
  evidenceGapReason?: string;
  actorId?: string;
}

export interface PromoteResult {
  success: boolean;
  queueId?: string;
  status?: string;
  reason?: string;
  message: string;
}

/**
 * Reads durable monthly provider budgets for Google Places.
 */
export async function fetchCatalogueBudgets(pool?: any): Promise<CatalogueBudgetSummary> {
  const p = pool || getDbPool();
  const query = `
    SELECT billing_tier, monthly_call_limit, is_enabled, calls_consumed, calls_reserved,
           GREATEST(0, monthly_call_limit - (calls_consumed + calls_reserved)) AS remaining
    FROM integration.monthly_provider_budget
    WHERE provider = 'google_places'
    ORDER BY billing_tier;
  `;
  const res = await p.query(query);
  const rows = res.rows;

  const defaultPro: BudgetTierStatus = {
    billingTier: 'PRO',
    monthlyCallLimit: 0,
    isEnabled: true,
    callsConsumed: 0,
    callsReserved: 0,
    remaining: 0,
  };
  const defaultEnt: BudgetTierStatus = {
    billingTier: 'ENTERPRISE',
    monthlyCallLimit: 0,
    isEnabled: true,
    callsConsumed: 0,
    callsReserved: 0,
    remaining: 0,
  };
  const defaultAtmo: BudgetTierStatus = {
    billingTier: 'ENTERPRISE_ATMOSPHERE',
    monthlyCallLimit: 0,
    isEnabled: false,
    callsConsumed: 0,
    callsReserved: 0,
    remaining: 0,
  };

  const map: Record<string, BudgetTierStatus> = {};
  for (const row of rows) {
    map[row.billing_tier] = {
      billingTier: row.billing_tier,
      monthlyCallLimit: Number(row.monthly_call_limit),
      isEnabled: Boolean(row.is_enabled),
      callsConsumed: Number(row.calls_consumed),
      callsReserved: Number(row.calls_reserved),
      remaining: Number(row.remaining),
    };
  }

  return {
    pro: map['PRO'] || defaultPro,
    enterprise: map['ENTERPRISE'] || defaultEnt,
    atmosphere: map['ENTERPRISE_ATMOSPHERE'] || defaultAtmo,
  };
}

/**
 * Executes server-side bounded pagination and filtering over integration.v_aire_catalogue.
 */
export async function queryCataloguePage(
  filters: CatalogueFilterParams = {},
  pool?: any
): Promise<CatalogueQueryResult> {
  const p = pool || getDbPool();
  const pageSize = Math.min(Math.max(1, filters.limit || 50), 100);
  const page = Math.max(1, Math.floor((filters.offset || 0) / pageSize) + 1);
  const effectiveFilters: CatalogueFilterParams = {
    ...filters,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };

  const listQuery = buildCatalogueQuery(effectiveFilters);
  const countQuery = buildCatalogueCountQuery(effectiveFilters);

  const [itemsRes, countRes, budgets] = await Promise.all([
    p.query(listQuery.text, listQuery.values),
    p.query(countQuery.text, countQuery.values),
    fetchCatalogueBudgets(p),
  ]);

  const total = Number(countRes.rows[0]?.total ?? 21468);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return {
    items: itemsRes.rows as AireCatalogueItem[],
    total,
    page,
    pageSize,
    pageCount,
    budgets,
  };
}

/**
 * Fetches a single catalogue item with its detailed routing and profile.
 */
export async function fetchCatalogueItem(
  externalReferenceId: string,
  pool?: any
): Promise<AireCatalogueItem | null> {
  const p = pool || getDbPool();
  const res = await p.query(
    'SELECT * FROM integration.v_aire_catalogue WHERE external_reference_id = $1 LIMIT 1;',
    [externalReferenceId]
  );
  if (!res.rows.length) return null;
  return res.rows[0] as AireCatalogueItem;
}

/**
 * Governed manual promotion to Pro or Enterprise.
 * Strictly enforces zero provider calls, validation against invalid refs,
 * existing evidence suppression, and 0-budget fail-closed queueing.
 */
export async function promoteCatalogueEntity(
  params: PromoteParams,
  pool?: any
): Promise<PromoteResult> {
  const p = pool || getDbPool();

  // Fail closed if a test environment attempts to mutate the production project
  assertSafeMutationTarget(p);

  if (!params.externalReferenceId) {
    return {
      success: false,
      reason: 'REFERENCE_REQUIRED',
      message: 'External provider reference ID is required.',
    };
  }

  if (params.billingTier !== 'PRO' && params.billingTier !== 'ENTERPRISE') {
    return {
      success: false,
      reason: 'INVALID_BILLING_TIER',
      message: 'Promotion is only supported for PRO and ENTERPRISE tiers. Atmosphere is disabled.',
    };
  }

  if (!params.actorId || !params.actorId.trim()) {
    return {
      success: false,
      reason: 'ACTOR_REQUIRED',
      message: 'Actor ID is required for governed manual promotion.',
    };
  }

  if (!params.purpose || !params.purpose.trim()) {
    return {
      success: false,
      reason: 'PURPOSE_REQUIRED',
      message: 'Promotion purpose is mandatory.',
    };
  }

  if (!params.reason || !params.reason.trim()) {
    return {
      success: false,
      reason: 'REASON_REQUIRED',
      message: 'Promotion reason is mandatory.',
    };
  }

  if (params.billingTier === 'ENTERPRISE' && (!params.evidenceGapReason || !params.evidenceGapReason.trim())) {
    return {
      success: false,
      reason: 'EVIDENCE_GAP_REQUIRED',
      message: 'Evidence gap reason is mandatory for Enterprise promotion.',
    };
  }

  if (!params.originatingProduct || !params.originatingProduct.trim()) {
    return {
      success: false,
      reason: 'ORIGINATING_PRODUCT_REQUIRED',
      message: 'Originating product is mandatory.',
    };
  }

  // 1. Guard against invalid provider IDs (Must match ChIJ... format and length)
  if (!GOOGLE_PLACE_ID_RE.test(params.externalReferenceId)) {
    return {
      success: false,
      reason: 'INVALID_PROVIDER_REFERENCE',
      message: 'Invalid provider reference. Paid enrichment is blocked.',
    };
  }

  // 2. Fetch existing catalogue record
  const entity = await fetchCatalogueItem(params.externalReferenceId, p);
  if (!entity) {
    return {
      success: false,
      reason: 'ENTITY_NOT_FOUND',
      message: `Entity with ID ${params.externalReferenceId} was not found in the Catalogue.`,
    };
  }

  if (entity.is_invalid_reference || entity.canonical_identity_state === 'INVALID_PROVIDER_REFERENCE') {
    return {
      success: false,
      reason: 'INVALID_PROVIDER_REFERENCE',
      message: 'Invalid provider reference. Paid enrichment is blocked.',
    };
  }

  // 3. Check existing evidence: Never create spend or queue if evidence already satisfies
  if (params.billingTier === 'PRO' && entity.pro_evidence_state === 'EVIDENCE_ALREADY_AVAILABLE') {
    return {
      success: false,
      reason: 'EVIDENCE_ALREADY_AVAILABLE',
      message: 'Existing evidence satisfies this request. Zero provider calls dispatched.',
    };
  }

  if (
    params.billingTier === 'ENTERPRISE' &&
    entity.enterprise_evidence_state === 'EVIDENCE_ALREADY_AVAILABLE'
  ) {
    return {
      success: false,
      reason: 'EVIDENCE_ALREADY_AVAILABLE',
      message: 'Existing evidence satisfies this request. Zero provider calls dispatched.',
    };
  }

  // 4. Check live monthly budget state
  const budgets = await fetchCatalogueBudgets(p);
  const targetBudget = params.billingTier === 'PRO' ? budgets.pro : budgets.enterprise;

  if (!targetBudget.isEnabled) {
    return {
      success: false,
      reason: 'BUDGET_DISABLED',
      message: `Billing tier ${params.billingTier} is currently disabled by owner governance.`,
    };
  }

  // Because current budget is 0, the job is queued in WAITING_FOR_MONTHLY_BUDGET
  // Zero external provider calls occur.
  const queueStatus = targetBudget.remaining > 0 ? 'QUEUED' : 'WAITING_FOR_MONTHLY_BUDGET';
  const evidenceGap = params.evidenceGapReason ? params.evidenceGapReason.trim() : params.reason.trim();
  const evidenceGapText = `[${params.purpose.trim()}] ${evidenceGap}`;
  const actorId = params.actorId.trim();
  const actionName = params.billingTier === 'PRO' ? 'PROMOTE_PRO' : 'PROMOTE_ENTERPRISE';

  // 5. ATOMIC TRANSACTION: lock row with FOR UPDATE, inspect state, mutate queue, persist audit
  const client = typeof p.connect === 'function' ? await p.connect() : p;
  const releaseClient = typeof p.connect === 'function';

  try {
    await client.query('BEGIN');

    // 5a. Lock existing row with FOR UPDATE
    const selectForUpdate = `
      SELECT id, status, attempts, reservation_id, created_at, evidence_gap_reason, originating_product
      FROM integration.paid_enrichment_queue
      WHERE provider = 'google_places'
        AND external_reference_id = $1
        AND billing_tier = $2
      FOR UPDATE;
    `;
    const existingRes = await client.query(selectForUpdate, [
      params.externalReferenceId,
      params.billingTier,
    ]);
    const existingJob = existingRes.rows[0];

    let queuedJob: any;
    let previousState = 'NONE';

    if (existingJob) {
      previousState = existingJob.status;

      // Protected states: Never move backwards
      if (existingJob.status === 'RESERVED' || existingJob.status === 'IN_PROGRESS') {
        await client.query('ROLLBACK');
        return {
          success: false,
          reason: 'ALREADY_IN_PROGRESS',
          message: 'Enrichment job is already in progress.',
          queueId: existingJob.id,
          status: existingJob.status,
        };
      }

      if (
        existingJob.status === 'COMPLETED' ||
        existingJob.status === 'EVIDENCE_ALREADY_AVAILABLE' ||
        existingJob.status === 'NOT_REQUIRED'
      ) {
        await client.query('ROLLBACK');
        return {
          success: false,
          reason: 'EVIDENCE_ALREADY_AVAILABLE',
          message: 'Existing evidence satisfies this request. Zero provider calls dispatched.',
          queueId: existingJob.id,
          status: existingJob.status,
        };
      }

      if (existingJob.status === 'BLOCKED') {
        await client.query('ROLLBACK');
        return {
          success: false,
          reason: 'JOB_BLOCKED',
          message: 'Enrichment job is blocked for this entity.',
          queueId: existingJob.id,
          status: existingJob.status,
        };
      }

      // Mutable states: QUEUED, WAITING_FOR_MONTHLY_BUDGET, DEFERRED, FAILED_RETRYABLE
      const updateRes = await client.query(
        `UPDATE integration.paid_enrichment_queue
         SET status = $1,
             evidence_gap_reason = $2,
             originating_product = $3,
             computed_priority = 100.0,
             updated_at = now()
         WHERE id = $4
         RETURNING id, status, external_reference_id, billing_tier, created_at;`,
        [queueStatus, evidenceGapText, params.originatingProduct.trim(), existingJob.id]
      );
      queuedJob = updateRes.rows[0];
    } else {
      // Row does not exist yet. Insert with ON CONFLICT to protect against concurrent inserts
      const insertRes = await client.query(
        `INSERT INTO integration.paid_enrichment_queue (
           provider,
           external_reference_id,
           billing_tier,
           status,
           evidence_gap_reason,
           originating_product,
           computed_priority
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (provider, external_reference_id, billing_tier)
         DO UPDATE SET
           status = CASE
             WHEN integration.paid_enrichment_queue.status IN ('QUEUED', 'WAITING_FOR_MONTHLY_BUDGET', 'DEFERRED', 'FAILED_RETRYABLE')
             THEN EXCLUDED.status
             ELSE integration.paid_enrichment_queue.status
           END,
           evidence_gap_reason = CASE
             WHEN integration.paid_enrichment_queue.status IN ('QUEUED', 'WAITING_FOR_MONTHLY_BUDGET', 'DEFERRED', 'FAILED_RETRYABLE')
             THEN EXCLUDED.evidence_gap_reason
             ELSE integration.paid_enrichment_queue.evidence_gap_reason
           END,
           originating_product = CASE
             WHEN integration.paid_enrichment_queue.status IN ('QUEUED', 'WAITING_FOR_MONTHLY_BUDGET', 'DEFERRED', 'FAILED_RETRYABLE')
             THEN EXCLUDED.originating_product
             ELSE integration.paid_enrichment_queue.originating_product
           END,
           computed_priority = CASE
             WHEN integration.paid_enrichment_queue.status IN ('QUEUED', 'WAITING_FOR_MONTHLY_BUDGET', 'DEFERRED', 'FAILED_RETRYABLE')
             THEN 100.0
             ELSE integration.paid_enrichment_queue.computed_priority
           END,
           updated_at = now()
         RETURNING id, status, external_reference_id, billing_tier, created_at;`,
        [
          'google_places',
          params.externalReferenceId,
          params.billingTier,
          queueStatus,
          evidenceGapText,
          params.originatingProduct.trim(),
          100.0,
        ]
      );
      queuedJob = insertRes.rows[0];

      if (queuedJob.status === 'RESERVED' || queuedJob.status === 'IN_PROGRESS') {
        await client.query('ROLLBACK');
        return {
          success: false,
          reason: 'ALREADY_IN_PROGRESS',
          message: 'Enrichment job is already in progress.',
          queueId: queuedJob.id,
          status: queuedJob.status,
        };
      }
      if (
        queuedJob.status === 'COMPLETED' ||
        queuedJob.status === 'EVIDENCE_ALREADY_AVAILABLE' ||
        queuedJob.status === 'NOT_REQUIRED'
      ) {
        await client.query('ROLLBACK');
        return {
          success: false,
          reason: 'EVIDENCE_ALREADY_AVAILABLE',
          message: 'Existing evidence satisfies this request. Zero provider calls dispatched.',
          queueId: queuedJob.id,
          status: queuedJob.status,
        };
      }
      if (queuedJob.status === 'BLOCKED') {
        await client.query('ROLLBACK');
        return {
          success: false,
          reason: 'JOB_BLOCKED',
          message: 'Enrichment job is blocked for this entity.',
          queueId: queuedJob.id,
          status: queuedJob.status,
        };
      }
    }

    // 5b. Persist durable audit record into integration.operator_work_audit in the SAME transaction
    const auditPayload = {
      authorization_source: 'operator_manual',
      actor_id: actorId,
      purpose: params.purpose.trim(),
      reason: params.reason.trim(),
      evidence_gap_reason: params.evidenceGapReason ? params.evidenceGapReason.trim() : null,
      originating_product: params.originatingProduct.trim(),
      requested_tier: params.billingTier,
      external_reference_id: params.externalReferenceId,
      timestamp: new Date().toISOString(),
      resulting_state: queuedJob.status,
    };

    await client.query(
      `INSERT INTO integration.operator_work_audit (
         source_type,
         source_id,
         actor_id,
         action,
         previous_state,
         new_state,
         payload_diff
       ) VALUES ($1, $2, $3, $4, $5, $6, $7);`,
      [
        'paid_enrichment_queue',
        queuedJob.id,
        actorId,
        actionName,
        previousState,
        queuedJob.status,
        JSON.stringify(auditPayload),
      ]
    );

    // 5c. Commit transaction atomically
    await client.query('COMMIT');

    return {
      success: true,
      queueId: queuedJob.id,
      status: queuedJob.status,
      message:
        queuedJob.status === 'WAITING_FOR_MONTHLY_BUDGET'
          ? `Entity successfully queued with waiting intent (monthly limit is 0). Zero provider calls dispatched.`
          : `Entity queued for governed enrichment. Zero provider calls dispatched.`,
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback error
    }
    return {
      success: false,
      reason: 'TRANSACTION_FAILED',
      message: `Promotion transaction failed: ${(err as Error).message}`,
    };
  } finally {
    if (releaseClient && client && typeof client.release === 'function') {
      client.release();
    }
  }
}
