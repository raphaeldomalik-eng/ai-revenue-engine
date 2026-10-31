import type { StandingPolicy } from './continuous-directory-policy.ts';

export type RecoveryEntry = {
  sourcePolicyId: string;
  sourcePolicySha256: string;
  queueId: string;
  requestId: string;
  identityKey: string;
  host: string;
  mode: 'UNRESERVED' | 'RETRYABLE';
  priorRequestCount: number;
};
export type RecoveryPolicy = StandingPolicy & {
  recovery?: { originalRequestBudget: number; additionalRequestBudget: number; entries: RecoveryEntry[] };
};

const sources = new Map([
  ['resources-directory-uk-verify-50-20261024', 'c49c05bfccd52774aad3e0231b6bc0de766cef51dd1dd175d69aba7fabae1923'],
  ['resources-directory-uk-verify-canary-20261022', '6d8346510acdbf4fb6e28fba5264b2270ef8914c8a8d64d57fcb3632717ded26'],
]);

/** A fresh signed policy may recover only exact old queue identities, with no extra providers or authority. */
export function validatedVerificationRecovery(policy: RecoveryPolicy) {
  const recovery = policy.recovery;
  if (!recovery) return null;
  const window = Date.parse(policy.validUntil??'') - Date.parse(policy.validFrom);
  const entries = recovery.entries;
  if (recovery.originalRequestBudget !== 6 || recovery.additionalRequestBudget !== 3
    || !Array.isArray(entries) || entries.length < 1 || entries.length > 11
    || new Set(entries.map(entry => entry.queueId)).size !== entries.length
    || new Set(entries.map(entry => entry.requestId)).size !== entries.length
    || entries.some(entry => sources.get(entry.sourcePolicyId) !== entry.sourcePolicySha256
      || !/^[a-f0-9]{64}$/.test(entry.queueId) || !/^[0-9a-f-]{36}$/.test(entry.requestId)
      || !entry.identityKey.startsWith('event_suite_resources:') || !/^[a-z0-9.-]+$/.test(entry.host)
      || !['UNRESERVED', 'RETRYABLE'].includes(entry.mode)
      || (entry.mode === 'UNRESERVED' ? entry.priorRequestCount !== 0 : !Number.isInteger(entry.priorRequestCount) || entry.priorRequestCount < 1 || entry.priorRequestCount > 6))
    || JSON.stringify(policy.actions) !== '["VERIFY_WEBSITE","ENRICH_VERIFIED_VENUE"]'
    || JSON.stringify(policy.countries) !== '["GB"]'
    || !Number.isSafeInteger(policy.maxVenuesPerDay) || !Number.isSafeInteger(policy.maxRequestsPerDay)
    || Number(policy.maxVenuesPerDay) > 22 || Number(policy.maxRequestsPerDay) > 132
    || Number(policy.maxVenuesPerDay) < entries.length || Number(policy.maxRequestsPerDay) < entries.length * 6
    || policy.maxRequestsPerVenue !== 6 || policy.maxBatchVenues > 11 || policy.maxAttempts !== 1
    || policy.minHostDelayMs < 2000 || !Number.isFinite(window) || window <= 0 || window > 48 * 3600000
    || policy.paidProviderBudgetUsd !== 0 || policy.publicationAllowed !== false || policy.outreachAllowed !== false)
    throw Error('DIRECTORY_RECOVERY_SCOPE_INVALID');
  return recovery;
}
