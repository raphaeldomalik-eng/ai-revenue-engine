// catalogue.ts — AIRE Catalogue Query and Routing Projection Client
// Provides high-performance querying and filtering for the AIRE Catalogue UI over integration.v_aire_catalogue.
// Preserves architectural boundaries: AIRE consumes Nexus canonical and provider profiles while managing channel routing.

export type NormalizedProfile =
  | 'dedicated_event_venue'
  | 'hospitality'
  | 'accommodation'
  | 'food_beverage'
  | 'nightlife'
  | 'sports_recreation'
  | 'culture_entertainment'
  | 'education'
  | 'religious_community'
  | 'retail'
  | 'health_wellness'
  | 'professional_services'
  | 'event_supplier'
  | 'attraction_destination'
  | 'general_organisation'
  | 'other_business'
  | 'unknown';

export type EventCapability =
  | 'EXPLICIT_EVENT_VENUE'
  | 'VENUE_CAPABLE_NEEDS_WEB_VERIFICATION'
  | 'OWNER_CONFIRMATION_LIKELY'
  | 'NO_CURRENT_EVENT_VENUE_EVIDENCE'
  | 'UNKNOWN';

export type CanonicalIdentityState =
  | 'MATCHED_CANONICAL'
  | 'PROVISIONAL'
  | 'UNRESOLVED'
  | 'CONFLICTING'
  | 'INVALID_PROVIDER_REFERENCE'
  | 'DUPLICATE';

export type RouteState =
  | 'STRONG_FIT'
  | 'POSSIBLE_FIT'
  | 'NEEDS_MORE_EVIDENCE'
  | 'NOT_CURRENTLY_RELEVANT'
  | 'NOT_APPLICABLE'
  | 'DEFERRED';

export type ResearchDisposition =
  | 'EVIDENCE_ALREADY_AVAILABLE'
  | 'NO_ACTION_REQUIRED'
  | 'FIRST_PARTY_WEB_VERIFICATION'
  | 'OWNER_CONFIRMATION'
  | 'PRO_ELIGIBLE_LATER'
  | 'ENTERPRISE_ELIGIBLE_LATER'
  | 'WAITING_FOR_BUDGET'
  | 'DEFERRED'
  | 'INVALID_PROVIDER_REFERENCE'
  | 'HUMAN_IDENTITY_REVIEW';

export type PaidEligibility =
  | 'AUTO_ELIGIBLE'
  | 'DEFERRED'
  | 'OPERATOR_PROMOTION_ALLOWED'
  | 'NOT_REQUIRED'
  | 'INVALID';

export interface AireCatalogueItem {
  provider: string;
  external_reference_id: string;
  candidate_id: string | null;
  entity_name: string | null;
  provider_primary_type: string | null;
  provider_types: string[];
  provider_business_status: string | null;
  formatted_address: string | null;
  locality: string | null;
  region: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  discovery_query: string | null;
  discovery_campaign: string | null;
  normalized_profile: NormalizedProfile;
  event_capability: EventCapability;
  canonical_identity_state: CanonicalIdentityState;
  canonical_entity_id: string | null;
  resources_route: RouteState;
  venue_management_route: RouteState;
  context_pos_route: RouteState;
  ticketing_route: RouteState;
  workforce_route: RouteState;
  production_ops_route: RouteState;
  event_business_route: RouteState;
  commercial_prospecting_route: RouteState;
  owner_confirmation_route: RouteState;
  research_disposition: ResearchDisposition;
  pro_evidence_state: 'EVIDENCE_ALREADY_AVAILABLE' | 'NO_PRO_EVIDENCE';
  enterprise_evidence_state: string;
  pro_eligibility: PaidEligibility;
  enterprise_eligibility: PaidEligibility;
  is_invalid_reference: boolean;
  is_duplicate: boolean;
  duplicate_of_reference_id: string | null;
  is_permanently_closed: boolean;
  catalogue_status: string;
  observed_at: string | null;
  provider_checked_at: string | null;
  last_routed_at: string;
}

export interface CatalogueFilterParams {
  provider?: string;
  providerPrimaryType?: string;
  normalizedProfile?: NormalizedProfile | NormalizedProfile[];
  country?: string;
  region?: string;
  locality?: string;
  discoveryIntent?: string;
  canonicalIdentityState?: CanonicalIdentityState;
  eventCapability?: EventCapability | EventCapability[];
  resourcesRoute?: RouteState;
  venueManagementRoute?: RouteState;
  contextPosRoute?: RouteState;
  ticketingRoute?: RouteState;
  workforceRoute?: RouteState;
  productionOpsRoute?: RouteState;
  eventBusinessRoute?: RouteState;
  commercialProspectingRoute?: RouteState;
  ownerConfirmationRoute?: RouteState;
  researchDisposition?: ResearchDisposition | ResearchDisposition[];
  proEvidenceState?: 'EVIDENCE_ALREADY_AVAILABLE' | 'NO_PRO_EVIDENCE';
  proEligibility?: PaidEligibility;
  enterpriseEligibility?: PaidEligibility;
  isInvalidReference?: boolean;
  isDuplicate?: boolean;
  isPermanentlyClosed?: boolean;
  externalReferenceId?: string;
  candidateId?: string;
  searchQuery?: string;
  limit?: number;
  offset?: number;
  sortBy?: keyof AireCatalogueItem;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Builds parameterized SQL query for querying the unified AIRE Catalogue view.
 */
export function buildCatalogueQuery(filters: CatalogueFilterParams = {}): { text: string; values: unknown[] } {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (filters.provider) {
    conditions.push(`provider = $${paramIdx++}`);
    values.push(filters.provider);
  }

  if (filters.providerPrimaryType) {
    conditions.push(`provider_primary_type = $${paramIdx++}`);
    values.push(filters.providerPrimaryType);
  }

  if (filters.normalizedProfile) {
    if (Array.isArray(filters.normalizedProfile)) {
      conditions.push(`normalized_profile = ANY($${paramIdx++})`);
      values.push(filters.normalizedProfile);
    } else {
      conditions.push(`normalized_profile = $${paramIdx++}`);
      values.push(filters.normalizedProfile);
    }
  }

  if (filters.country) {
    conditions.push(`country = $${paramIdx++}`);
    values.push(filters.country);
  }

  if (filters.region) {
    conditions.push(`region ILIKE $${paramIdx++}`);
    values.push(`%${filters.region}%`);
  }

  if (filters.locality) {
    conditions.push(`locality ILIKE $${paramIdx++}`);
    values.push(`%${filters.locality}%`);
  }

  if (filters.canonicalIdentityState) {
    conditions.push(`canonical_identity_state = $${paramIdx++}`);
    values.push(filters.canonicalIdentityState);
  }

  if (filters.eventCapability) {
    if (Array.isArray(filters.eventCapability)) {
      conditions.push(`event_capability = ANY($${paramIdx++})`);
      values.push(filters.eventCapability);
    } else {
      conditions.push(`event_capability = $${paramIdx++}`);
      values.push(filters.eventCapability);
    }
  }

  if (filters.resourcesRoute) {
    conditions.push(`resources_route = $${paramIdx++}`);
    values.push(filters.resourcesRoute);
  }

  if (filters.venueManagementRoute) {
    conditions.push(`venue_management_route = $${paramIdx++}`);
    values.push(filters.venueManagementRoute);
  }

  if (filters.contextPosRoute) {
    conditions.push(`context_pos_route = $${paramIdx++}`);
    values.push(filters.contextPosRoute);
  }

  if (filters.ticketingRoute) {
    conditions.push(`ticketing_route = $${paramIdx++}`);
    values.push(filters.ticketingRoute);
  }

  if (filters.workforceRoute) {
    conditions.push(`workforce_route = $${paramIdx++}`);
    values.push(filters.workforceRoute);
  }

  if (filters.productionOpsRoute) {
    conditions.push(`production_ops_route = $${paramIdx++}`);
    values.push(filters.productionOpsRoute);
  }

  if (filters.eventBusinessRoute) {
    conditions.push(`event_business_route = $${paramIdx++}`);
    values.push(filters.eventBusinessRoute);
  }

  if (filters.commercialProspectingRoute) {
    conditions.push(`commercial_prospecting_route = $${paramIdx++}`);
    values.push(filters.commercialProspectingRoute);
  }

  if (filters.ownerConfirmationRoute) {
    conditions.push(`owner_confirmation_route = $${paramIdx++}`);
    values.push(filters.ownerConfirmationRoute);
  }

  if (filters.externalReferenceId) {
    conditions.push(`external_reference_id = $${paramIdx++}`);
    values.push(filters.externalReferenceId);
  }

  if (filters.candidateId) {
    conditions.push(`candidate_id = $${paramIdx++}`);
    values.push(filters.candidateId);
  }

  if (filters.researchDisposition) {
    if (Array.isArray(filters.researchDisposition)) {
      conditions.push(`research_disposition = ANY($${paramIdx++})`);
      values.push(filters.researchDisposition);
    } else {
      conditions.push(`research_disposition = $${paramIdx++}`);
      values.push(filters.researchDisposition);
    }
  }

  if (filters.proEvidenceState) {
    conditions.push(`pro_evidence_state = $${paramIdx++}`);
    values.push(filters.proEvidenceState);
  }

  if (filters.proEligibility) {
    conditions.push(`pro_eligibility = $${paramIdx++}`);
    values.push(filters.proEligibility);
  }

  if (filters.enterpriseEligibility) {
    conditions.push(`enterprise_eligibility = $${paramIdx++}`);
    values.push(filters.enterpriseEligibility);
  }

  if (filters.isInvalidReference !== undefined) {
    conditions.push(`is_invalid_reference = $${paramIdx++}`);
    values.push(filters.isInvalidReference);
  }

  if (filters.isDuplicate !== undefined) {
    conditions.push(`is_duplicate = $${paramIdx++}`);
    values.push(filters.isDuplicate);
  }

  if (filters.isPermanentlyClosed !== undefined) {
    conditions.push(`is_permanently_closed = $${paramIdx++}`);
    values.push(filters.isPermanentlyClosed);
  }

  if (filters.searchQuery) {
    conditions.push(`(entity_name ILIKE $${paramIdx} OR locality ILIKE $${paramIdx} OR discovery_query ILIKE $${paramIdx} OR external_reference_id ILIKE $${paramIdx})`);
    values.push(`%${filters.searchQuery}%`);
    paramIdx++;
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortBy = filters.sortBy || 'entity_name';
  const sortOrder = filters.sortOrder === 'desc' ? 'DESC' : 'ASC';
  const limit = Math.min(Math.max(1, filters.limit || 50), 1000);
  const offset = Math.max(0, filters.offset || 0);

  const text = `
    SELECT *
    FROM integration.v_aire_catalogue
    ${whereClause}
    ORDER BY ${String(sortBy)} ${sortOrder} NULLS LAST
    LIMIT ${limit} OFFSET ${offset};
  `.trim();

  return { text, values };
}

/**
 * Builds parameterized count query for pagination over integration.v_aire_catalogue.
 */
export function buildCatalogueCountQuery(filters: CatalogueFilterParams = {}): { text: string; values: unknown[] } {
  const query = buildCatalogueQuery(filters);
  // Extract where clause from generated query
  const whereMatch = query.text.match(/FROM integration\.v_aire_catalogue\s+(WHERE[\s\S]+?)\s+ORDER BY/i);
  const whereClause = whereMatch ? whereMatch[1] : '';

  const text = `
    SELECT COUNT(*)::int AS total
    FROM integration.v_aire_catalogue
    ${whereClause};
  `.trim();

  return { text, values: query.values };
}

