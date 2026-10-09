import { createHash } from 'node:crypto';

export const CONTENT_CONTRACTS = Object.freeze({ REQUEST: 'nexus.content-interpretation-request.v1', RESULT: 'nexus.content-interpretation-result.v1' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
function requireValue(ok, code) { if (!ok) { const error = new Error(code); error.code = code; throw error; } }
function object(value, keys) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), 'CONTENT_OBJECT_INVALID');
  requireValue(Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key)), 'CONTENT_FIELDS_INVALID');
  return value;
}
function text(value, max = 2048) { requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= max, 'CONTENT_TEXT_INVALID'); return value; }
function array(value, max, min = 0) { requireValue(Array.isArray(value) && value.length >= min && value.length <= max, 'CONTENT_ARRAY_INVALID'); return value; }
function unique(values) { requireValue(new Set(values).size === values.length, 'CONTENT_DUPLICATE_REFERENCE'); }
function integer(value, max) { requireValue(Number.isInteger(value) && value >= 0 && value <= max, 'CONTENT_BUDGET_INVALID'); }
function number(value, max) { requireValue(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max, 'CONTENT_COST_INVALID'); }
function enumValue(value, allowed) { requireValue(allowed.includes(value), 'CONTENT_ENUM_INVALID'); }
function hash(value) { requireValue(typeof value === 'string' && HASH.test(value), 'CONTENT_HASH_INVALID'); }
function uuid(value) { requireValue(typeof value === 'string' && UUID.test(value), 'CONTENT_UUID_INVALID'); }
function instant(value) { text(value, 32); requireValue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && new Date(value).toISOString() === value, 'CONTENT_TIME_INVALID'); return Date.parse(value); }
function safeUrl(value) { const url = new URL(text(value, 4096)); requireValue(url.protocol === 'https:' && !url.username && !url.password, 'CONTENT_SOURCE_URL_INVALID'); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`; if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`; return JSON.stringify(value); }
export function contentRequestFingerprint(request) { return createHash('sha256').update(stableJson(request)).digest('hex'); }

export function validateContentInterpretationRequest(input) {
  const r = object(input, ['contractVersion', 'requestId', 'idempotencyKey', 'originatingProduct', 'source', 'targets', 'blocks', 'budget', 'requestWhyGoDraft']);
  requireValue(r.contractVersion === CONTENT_CONTRACTS.REQUEST && r.originatingProduct === 'last_train_home', 'CONTENT_CONTRACT_INVALID');
  uuid(r.requestId); uuid(r.idempotencyKey); requireValue(typeof r.requestWhyGoDraft === 'boolean', 'CONTENT_DRAFT_INVALID');
  const s = object(r.source, ['provider', 'recordId', 'sourceUrl', 'documentFingerprint', 'mappingRevision', 'policy', 'observedAt', 'expiresAt']);
  text(s.provider, 100); text(s.recordId, 256); safeUrl(s.sourceUrl); hash(s.documentFingerprint); hash(s.mappingRevision);
  const policy = object(s.policy, ['reference', 'revision', 'allowInterpretation']);
  text(policy.reference, 256); text(policy.revision, 100); requireValue(policy.allowInterpretation === true, 'CONTENT_POLICY_NOT_APPROVED');
  const observed = instant(s.observedAt); const expiry = instant(s.expiresAt);
  requireValue(expiry > observed && expiry - observed <= 7 * 86400000, 'CONTENT_RETENTION_INVALID');
  const targets = array(r.targets, 25, 1);
  for (const t of targets) { object(t, ['product', 'entityType', 'entityId', 'displayName', 'canonicalEntityId']); requireValue(t.product === 'last_train_home', 'CONTENT_PRODUCT_INVALID'); enumValue(t.entityType, ['EVENT', 'ARTIST', 'VENUE']); text(t.entityId, 256); text(t.displayName, 256); if (t.canonicalEntityId !== null) uuid(t.canonicalEntityId); }
  unique(targets.map(t => t.entityId));
  const blocks = array(r.blocks, 100, 1); let total = 0;
  for (const b of blocks) {
    object(b, ['blockId', 'sourceLocator', 'text', 'textHash', 'sourceContext', 'targetEntityId']); text(b.blockId, 256); text(b.sourceLocator, 1024); text(b.text, 20000); hash(b.textHash);
    requireValue(createHash('sha256').update(b.text).digest('hex') === b.textHash, 'CONTENT_BODY_HASH_MISMATCH');
    total += Buffer.byteLength(b.text); enumValue(b.sourceContext, ['UNCLASSIFIED', 'EVENT', 'ARTIST', 'VENUE']);
    if (b.sourceContext === 'UNCLASSIFIED') requireValue(b.targetEntityId === null, 'CONTENT_CONTEXT_INVALID');
    else requireValue(targets.some(t => t.entityId === b.targetEntityId && t.entityType === b.sourceContext), 'CONTENT_CONTEXT_INVALID');
  }
  requireValue(total <= 60000 && Buffer.byteLength(JSON.stringify(r)) <= 95000, 'CONTENT_PAYLOAD_TOO_LARGE'); unique(blocks.map(b => b.blockId));
  object(r.budget, ['maxModelCalls', 'maxOutputTokens', 'currency', 'amount']); integer(r.budget.maxModelCalls, 1); integer(r.budget.maxOutputTokens, 2048); requireValue(r.budget.maxOutputTokens >= 256 && r.budget.currency === 'USD', 'CONTENT_BUDGET_INVALID'); number(r.budget.amount, 1);
  requireValue(r.budget.maxModelCalls > 0 || r.budget.amount === 0, 'CONTENT_BUDGET_INVALID');
  return structuredClone(r);
}

export function validateContentInterpretationResult(input, request) {
  const r = object(input, ['contractVersion', 'requestId', 'idempotencyKey', 'requestFingerprint', 'sourceExpiresAt', 'status', 'proposals', 'heldBlocks', 'whyGoDraft', 'execution']);
  requireValue(r.contractVersion === CONTENT_CONTRACTS.RESULT && r.status === 'REVIEW_REQUIRED', 'CONTENT_RESULT_INVALID'); uuid(r.requestId); uuid(r.idempotencyKey); hash(r.requestFingerprint);
  instant(r.sourceExpiresAt);
  if (request) requireValue(r.requestId === request.requestId && r.idempotencyKey === request.idempotencyKey && r.requestFingerprint === contentRequestFingerprint(request) && r.sourceExpiresAt === request.source.expiresAt, 'CONTENT_CORRELATION_MISMATCH');
  const refs = [];
  for (const p of array(r.proposals, 100)) {
    object(p, ['blockId', 'targetEntityId', 'targetType', 'section', 'scope', 'evidenceTextHash', 'reasonCode']); text(p.blockId, 256); text(p.targetEntityId, 256); hash(p.evidenceTextHash); text(p.reasonCode, 100);
    enumValue(p.targetType, ['EVENT', 'ARTIST', 'VENUE']); enumValue(p.scope, ['EVENT', 'STABLE', 'DATED']); enumValue(p.section, ['DETAILS', 'ABOUT', 'CAMPAIGN', 'VISITING']);
    requireValue(p.targetType === 'EVENT' ? p.scope === 'EVENT' && p.section === 'DETAILS' : p.targetType === 'ARTIST' ? (p.scope === 'STABLE' && p.section === 'ABOUT') || (p.scope === 'DATED' && p.section === 'CAMPAIGN') : p.scope === 'STABLE' && p.section === 'VISITING', 'CONTENT_PLACEMENT_INVALID');
    if (request) requireValue(request.targets.some(t => t.entityId === p.targetEntityId && t.entityType === p.targetType) && request.blocks.some(b => b.blockId === p.blockId && b.textHash === p.evidenceTextHash), 'CONTENT_EVIDENCE_INVALID');
    refs.push(p.blockId);
  }
  for (const h of array(r.heldBlocks, 100)) { object(h, ['blockId', 'reasonCode']); text(h.blockId, 256); text(h.reasonCode, 100); refs.push(h.blockId); }
  unique(refs);
  if (request) requireValue(refs.length === request.blocks.length && refs.every(id => request.blocks.some(b => b.blockId === id)), 'CONTENT_DISPOSITION_INCOMPLETE');
  if (r.whyGoDraft !== null) {
    const d = object(r.whyGoDraft, ['text', 'evidenceBlockIds', 'status']); text(d.text, 600); requireValue(d.status === 'REVIEW_REQUIRED' && (!request || request.requestWhyGoDraft), 'CONTENT_DRAFT_INVALID');
    const evidence = array(d.evidenceBlockIds, 100, 1); unique(evidence); evidence.forEach(id => text(id, 256));
    if (request) requireValue(evidence.every(id => request.blocks.some(b => b.blockId === id)) && request.targets.some(t => t.entityType === 'EVENT'), 'CONTENT_DRAFT_EVIDENCE_INVALID');
  }
  const e = object(r.execution, ['version', 'model', 'modelCalls', 'inputTokens', 'outputTokens', 'costUSD']); text(e.version, 100); if (e.model !== null) text(e.model, 100); integer(e.modelCalls, request?.budget.maxModelCalls ?? 1); integer(e.inputTokens, 100000); integer(e.outputTokens, request?.budget.maxOutputTokens ?? 2048); number(e.costUSD, request?.budget.amount ?? 1);
  requireValue(e.modelCalls !== 0 || (e.model === null && e.costUSD === 0 && e.inputTokens === 0 && e.outputTokens === 0), 'CONTENT_USAGE_INVALID');
  return structuredClone(r);
}
