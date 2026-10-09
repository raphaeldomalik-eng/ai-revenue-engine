import { contentRequestFingerprint, CONTENT_CONTRACTS, validateContentInterpretationRequest, validateContentInterpretationResult, type ContentRequest, type ContentResult, type ContentProposal } from "./content-interpretation-contracts.mjs";
import type { NexusResultStore } from "./executor.ts";

export interface ContentExecutionStore extends NexusResultStore {
  /** Durable, at-most-once budget reservation. An uncertain call is never automatically rebought. */
  reserveModelCall(key: string, fingerprint: string): Promise<boolean>;
}
export type ContentModelOutput = { decisions: Array<{ blockId: string; targetEntityId: string | null; scope: string | null; confidence: number }>; whyGoDraft: ContentResult["whyGoDraft"]; usage: { inputTokens: number; outputTokens: number } };
export type ContentModel = { name: string; inputUSDPerMillion: number; outputUSDPerMillion: number; inputTokenUpperBound?: (request: ContentRequest) => number; interpret(request: ContentRequest): Promise<ContentModelOutput> };
export type ContentExecutionOptions = { now?: () => number; model?: ContentModel | null };
export const CONTENT_EXECUTION_VERSION = "provider-content-v1";
const dated = /\b(?:new|latest|forthcoming|upcoming|recent)\s+(?:album|record|release|tour)|\b(?:album|tour)\s+(?:launch|campaign)|\b(?:19|20)\d{2}\b/i;

function proposal(request: ContentRequest, blockId: string, targetId: string, scope: string, reasonCode: string): ContentProposal | null {
  const block = request.blocks.find(b => b.blockId === blockId); const target = request.targets.find(t => t.entityId === targetId);
  if (!block || !target) return null;
  if (target.entityType === "ARTIST" && dated.test(block.text)) scope = "DATED";
  const section = target.entityType === "EVENT" ? "DETAILS" : target.entityType === "VENUE" ? "VISITING" : scope === "DATED" ? "CAMPAIGN" : "ABOUT";
  if (target.entityType === "EVENT" ? scope !== "EVENT" : target.entityType === "VENUE" ? scope !== "STABLE" : !["STABLE", "DATED"].includes(scope)) return null;
  return { blockId, targetEntityId: targetId, targetType: target.entityType, section, scope: scope as ContentProposal["scope"], evidenceTextHash: block.textHash, reasonCode };
}
function inputBound(request: ContentRequest, model: ContentModel) {
  return model.inputTokenUpperBound?.(request) ?? Buffer.byteLength(JSON.stringify(request)) + 4096;
}
export async function executeContentInterpretation(input: unknown, options: ContentExecutionOptions, store: NexusResultStore): Promise<ContentResult> {
  const request = validateContentInterpretationRequest(input); const fingerprint = contentRequestFingerprint(request); const now = options.now?.() ?? Date.now();
  if (Date.parse(request.source.observedAt) > now || Date.parse(request.source.expiresAt) <= now) throw new Error("CONTENT_SOURCE_STALE");
  const prior = await store.get(request.idempotencyKey);
  if (prior) {
    if (prior.requestFingerprint !== fingerprint) throw new Error("CONTENT_IDEMPOTENCY_COLLISION");
    return validateContentInterpretationResult(prior, request);
  }
  const result: ContentResult = { contractVersion: CONTENT_CONTRACTS.RESULT, requestId: request.requestId, idempotencyKey: request.idempotencyKey, requestFingerprint: fingerprint, sourceExpiresAt: request.source.expiresAt, status: "REVIEW_REQUIRED", proposals: [], heldBlocks: [], whyGoDraft: null, execution: { version: CONTENT_EXECUTION_VERSION, model: null, modelCalls: 0, inputTokens: 0, outputTokens: 0, costUSD: 0 } };
  const unresolved = [];
  for (const block of request.blocks) {
    const p = block.sourceContext === "UNCLASSIFIED" || !block.targetEntityId ? null : proposal(request, block.blockId, block.targetEntityId, block.sourceContext === "EVENT" ? "EVENT" : "STABLE", "EXPLICIT_SOURCE_CONTEXT");
    if (p) result.proposals.push(p); else unresolved.push(block);
  }
  const model = options.model;
  const eligible = unresolved.length > 0 || (request.requestWhyGoDraft && request.targets.some(t => t.entityType === "EVENT"));
  let holdReason = request.budget.maxModelCalls === 0 ? "MODEL_NOT_ALLOWED" : "MODEL_NOT_CONFIGURED";
  if (eligible && model && request.budget.maxModelCalls === 1) {
    const upperInput = inputBound(request, model);
    const upperCost = (upperInput * model.inputUSDPerMillion + request.budget.maxOutputTokens * model.outputUSDPerMillion) / 1e6;
    if (![model.inputUSDPerMillion, model.outputUSDPerMillion].every(rate => Number.isFinite(rate) && rate > 0 && rate <= 1000) || !Number.isSafeInteger(upperInput) || upperInput <= 0 || upperInput > 100000) throw new Error("CONTENT_MODEL_PRICE_INVALID");
    if (upperCost > request.budget.amount) holdReason = "COST_CEILING_EXCEEDED";
    else {
      if (!("reserveModelCall" in store) || typeof store.reserveModelCall !== "function") throw new Error("CONTENT_DURABLE_BUDGET_STORE_REQUIRED");
      const reserved = await (store as ContentExecutionStore).reserveModelCall(request.idempotencyKey, fingerprint);
      if (!reserved) throw new Error("CONTENT_MODEL_BUDGET_ALREADY_RESERVED");
      // Provider failure propagates without releasing the reservation. A retry may inspect a
      // persisted result, but cannot repeat a possibly charged call after a lost response.
      const output = await model.interpret(request);
      const usage = output.usage;
      if (!usage || ![usage.inputTokens, usage.outputTokens].every(Number.isSafeInteger) || usage.inputTokens < 0 || usage.inputTokens > upperInput || usage.outputTokens < 0 || usage.outputTokens > request.budget.maxOutputTokens) throw new Error("CONTENT_MODEL_USAGE_INVALID");
      result.execution = { version: CONTENT_EXECUTION_VERSION, model: model.name, modelCalls: 1, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUSD: (usage.inputTokens * model.inputUSDPerMillion + usage.outputTokens * model.outputUSDPerMillion) / 1e6 };
      if (!Array.isArray(output.decisions) || output.decisions.length > request.blocks.length || new Set(output.decisions.map(d => d.blockId)).size !== output.decisions.length) throw new Error("CONTENT_MODEL_DECISIONS_INVALID");
      for (const block of unresolved) {
        const decision = output.decisions.find(d => d.blockId === block.blockId);
        const p = decision && typeof decision.confidence === "number" && decision.confidence >= 0.9 && decision.confidence <= 1 && decision.targetEntityId && decision.scope ? proposal(request, block.blockId, decision.targetEntityId, decision.scope, "MODEL_PROPOSAL") : null;
        if (p) result.proposals.push(p); else result.heldBlocks.push({ blockId: block.blockId, reasonCode: "MODEL_UNRESOLVED" });
      }
      if (output.whyGoDraft && request.requestWhyGoDraft && !request.blocks.some(b => b.text.trim().toLowerCase() === output.whyGoDraft!.text.trim().toLowerCase())) result.whyGoDraft = output.whyGoDraft;
    }
  }
  for (const block of unresolved) if (!result.proposals.some(p => p.blockId === block.blockId) && !result.heldBlocks.some(h => h.blockId === block.blockId)) result.heldBlocks.push({ blockId: block.blockId, reasonCode: holdReason });
  const validated = validateContentInterpretationResult(result, request);
  await store.set(request.idempotencyKey, validated);
  return validated;
}
