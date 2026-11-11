import { RESOURCE_PRACTICAL_FIELDS, type ResourceExtraction } from './extractors/resources.ts';
import type { SourceExtractor } from '../contracts.ts';
import type { CrawlStopReason } from './types.ts';

export type ContentFieldCoverage = {
  status: 'OBSERVED' | 'REVIEW_REQUIRED' | 'NOT_OBSERVED' | 'BUDGET_LIMITED' | 'RETRIEVAL_BLOCKED' | 'NOT_RETRIEVED' | 'NOT_REQUESTED';
  count: number;
  sourceUrls: string[];
  evidenceRefs: string[];
};
export type ContentCoverage = {
  version: 'venue-content-v1';
  complete: boolean;
  stopReason: CrawlStopReason | null;
  fields: Record<string, ContentFieldCoverage>;
  gaps: string[];
};
type Observation = { sourceUrl?: string; evidenceRef?: string; reviewRequired?: boolean };
/** Retrieval coverage only. NOT_OBSERVED is not an absence claim or a publication rule. */
export function contentCoverage(
  extracted: ResourceExtraction & { eventCandidates: unknown[] },
  context: { requestedExtractors: readonly SourceExtractor[]; stopReason?: CrawlStopReason | null; retrievalStatus?: string; documentCount?: number },
): ContentCoverage {
  const fields: Record<string, ContentFieldCoverage> = {};
  const bounded = context.stopReason === 'PAGE_BUDGET' || context.stopReason === 'REQUEST_BUDGET';
  const blocked = context.retrievalStatus === 'BLOCKED' || ['ROBOTS_BLOCKED','ROBOTS_UNAVAILABLE','ENTRY_FAILED'].includes(context.stopReason ?? '');
  const add = (field: string, extractor: SourceExtractor, observations: Observation[]) => {
    const requested = context.requestedExtractors.includes(extractor);
    fields[field] = {
      status: !requested ? 'NOT_REQUESTED' : observations.length ? observations.some(row => !row.reviewRequired) ? 'OBSERVED' : 'REVIEW_REQUIRED' : blocked ? 'RETRIEVAL_BLOCKED' : context.documentCount === 0 ? 'NOT_RETRIEVED' : bounded ? 'BUDGET_LIMITED' : 'NOT_OBSERVED',
      count: observations.length,
      sourceUrls: [...new Set(observations.flatMap(row => row.sourceUrl ? [row.sourceUrl] : []))].slice(0, 100),
      evidenceRefs: [...new Set(observations.flatMap(row => row.evidenceRef ? [row.evidenceRef] : []))].slice(0, 100),
    };
  };
  add('name', 'IDENTITY', extracted.identityFacts.filter(row => ['siteName', 'name', 'explicitVenueName', 'placeName'].includes(row.fieldName)));
  add('description', 'IDENTITY', extracted.identityFacts.filter(row => ['siteDescription', 'description', 'metaDescription'].includes(row.fieldName)));
  add('address', 'IDENTITY', extracted.identityFacts.filter(row => ['address', 'formattedAddress'].includes(row.fieldName)));
  for (const [field, type] of [['email', 'EMAIL'], ['phone', 'PHONE'], ['contactForm', 'CONTACT_FORM']] as const) {
    add(field, 'PUBLIC_CONTACT', extracted.publicContacts.filter(row => row.type === type));
  }
  for (const field of ['geo', 'spaces', 'capacity', ...RESOURCE_PRACTICAL_FIELDS]) {
    add(field, 'VENUE_FACTS', extracted.venueFacts.filter(row => row.fieldName === field));
  }
  add('images', 'IMAGE_CANDIDATES', extracted.imageCandidates.map(row => ({ sourceUrl: row.sourcePageUrl, evidenceRef: row.rightsEvidence?.evidenceRef, reviewRequired: row.rightsState !== 'VERIFIED_REUSABLE' || row.exactVenue !== true })));
  add('events', 'EVENTS', extracted.eventCandidates.map(value => {
    const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const eventFingerprint = typeof row.sourceFingerprint === 'string' ? row.sourceFingerprint.slice(0,16) : null;
    return { sourceUrl: typeof row.sourcePageUrl === 'string' ? row.sourcePageUrl : undefined,
      evidenceRef: eventFingerprint ? extracted.evidenceRefs.find(ref => ref.endsWith(':event:'+eventFingerprint)) : undefined,
      reviewRequired: row.state === 'REVIEW_REQUIRED' };
  }));
  const gaps = Object.entries(fields).filter(([, value]) => value.status !== 'OBSERVED' && value.status !== 'NOT_REQUESTED').map(([field]) => field);
  return { version: 'venue-content-v1', complete: gaps.length === 0, stopReason: context.stopReason ?? null, fields, gaps };
}
