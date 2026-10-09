import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { validateContentInterpretationRequest, type ContentRequest } from "../src/nexus/content-interpretation-contracts.mjs";
import { executeContentInterpretation, type ContentExecutionStore } from "../src/nexus/content-interpretation.ts";
import { handleNexusExecuteRequest } from "../src/nexus/http.ts";
import { buildNexusEnvelope } from "../src/nexus/transport.ts";

const now = () => Date.parse("2026-10-09T12:01:00.000Z");
function fixture(): ContentRequest {
  const text = "James McMurtry's new album explores richly drawn characters.";
  return validateContentInterpretationRequest({ contractVersion: "nexus.content-interpretation-request.v1", requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", originatingProduct: "last_train_home", source: { provider: "ticketmaster", recordId: "S9RKXY", sourceUrl: "https://www.universe.com/events/james-mcmurtry-tickets-S9RKXY", documentFingerprint: "1".repeat(64), mappingRevision: "2".repeat(64), policy: { reference: "ticketmaster-source-prose", revision: "2026-10-09", allowInterpretation: true }, observedAt: "2026-10-09T12:00:00.000Z", expiresAt: "2026-10-16T12:00:00.000Z" }, targets: [{ product: "last_train_home", entityType: "ARTIST", entityId: "lth-artist-1", displayName: "James McMurtry", canonicalEntityId: null }], blocks: [{ blockId: "block-1", sourceLocator: "$.description", text, textHash: createHash("sha256").update(text).digest("hex"), sourceContext: "UNCLASSIFIED", targetEntityId: null }], budget: { maxModelCalls: 0, maxOutputTokens: 1024, currency: "USD", amount: 0 }, requestWhyGoDraft: false });
}
function store(): ContentExecutionStore {
  const results = new Map<string, Record<string, unknown>>(); const reserved = new Map<string, string>();
  return { get: async key => results.get(key) ?? null, set: async (key, result) => { results.set(key, result); }, reserveModelCall: async (key, fingerprint) => { if (reserved.has(key)) return false; reserved.set(key, fingerprint); return true; } };
}
test("unknown root prose is held without paying; embedded artist campaign stays dated and reviewed", async () => {
  const input = fixture();
  const held = await executeContentInterpretation(input, { now }, store());
  assert.equal(held.heldBlocks[0]?.reasonCode, "MODEL_NOT_ALLOWED"); assert.deepEqual(held.proposals, []);
  input.blocks[0]!.sourceContext = "ARTIST"; input.blocks[0]!.targetEntityId = "lth-artist-1";
  const routed = await executeContentInterpretation(input, { now }, store());
  assert.equal(routed.proposals[0]?.section, "CAMPAIGN"); assert.equal(routed.proposals[0]?.scope, "DATED"); assert.equal(routed.status, "REVIEW_REQUIRED"); assert.equal(routed.execution.modelCalls, 0);
});
test("freshness and idempotency collisions reject instead of replaying old meaning", async () => {
  const input = fixture(); const persisted = store();
  await executeContentInterpretation(input, { now }, persisted);
  input.source.mappingRevision = "3".repeat(64);
  await assert.rejects(executeContentInterpretation(input, { now }, persisted), /IDEMPOTENCY_COLLISION/);
  await assert.rejects(executeContentInterpretation(fixture(), { now: () => Date.parse("2026-10-17T12:00:00.000Z") }, store()), /SOURCE_STALE/);
});
test("a paid ambiguous paragraph gets one reserved call, measured cost and validated proposal", async () => {
  const input = fixture(); input.budget.maxModelCalls = 1; input.budget.amount = 0.1;
  let calls = 0; const persisted = store();
  const model = { name: "fixture-model", inputUSDPerMillion: 1, outputUSDPerMillion: 2, interpret: async () => { calls++; return { decisions: [{ blockId: "block-1", targetEntityId: "lth-artist-1", scope: "DATED", confidence: 0.95 }], whyGoDraft: null, usage: { inputTokens: 100, outputTokens: 50 } }; } };
  const first = await executeContentInterpretation(input, { now, model }, persisted);
  const second = await executeContentInterpretation(input, { now, model }, persisted);
  assert.deepEqual(second, first); assert.equal(calls, 1); assert.equal(first.execution.costUSD, 0.0002); assert.equal(first.proposals[0]?.section, "CAMPAIGN");
});
test("concurrent delivery cannot reserve the same model budget twice", async () => {
  const input = fixture(); input.budget.maxModelCalls = 1; input.budget.amount = 0.1;
  let calls = 0;
  const model = { name: "fixture-model", inputUSDPerMillion: 1, outputUSDPerMillion: 2, interpret: async () => { calls++; await new Promise(resolve => setTimeout(resolve, 30)); return { decisions: [{ blockId: "block-1", targetEntityId: "lth-artist-1", scope: "DATED", confidence: 0.95 }], whyGoDraft: null, usage: { inputTokens: 100, outputTokens: 50 } }; } };
  const outcomes = await Promise.allSettled([executeContentInterpretation(input, { now, model }, storeShared), executeContentInterpretation(input, { now, model }, storeShared)]);
  assert.equal(calls, 1); assert.equal(outcomes.filter(o => o.status === "fulfilled").length, 1);
});
const storeShared = store();
test("untrusted model cannot invent targets or turn album context into evergreen biography", async () => {
  const input = fixture(); input.budget.maxModelCalls = 1; input.budget.amount = 0.1;
  const model = { name: "fixture-model", inputUSDPerMillion: 1, outputUSDPerMillion: 2, interpret: async () => ({ decisions: [{ blockId: "block-1", targetEntityId: "guessed", scope: "STABLE", confidence: 0.95 }], whyGoDraft: null, usage: { inputTokens: 100, outputTokens: 50 } }) };
  const result = await executeContentInterpretation(input, { now, model }, store());
  assert.deepEqual(result.proposals, []); assert.equal(result.heldBlocks[0]?.reasonCode, "MODEL_UNRESOLVED");
});
test("the real signed HTTP handler admits content only under its separate capability flag", async () => {
  const input = fixture(); const envelope = buildNexusEnvelope(input, "test-secret", String(now() / 1000));
  const request = () => new Request("https://preview.example/api/integrations/nexus/execute", { method: "POST", headers: { "x-nexus-signature": envelope.signature, "x-nexus-timestamp": envelope.timestamp }, body: envelope.body });
  const base = { secret: "test-secret", store: store(), now };
  const denied = await handleNexusExecuteRequest(request(), base); assert.equal(denied.status, 404);
  const admitted = await handleNexusExecuteRequest(request(), { ...base, allowContentInterpretation: true }); assert.equal(admitted.status, 200);
  assert.equal((await admitted.json()).status, "REVIEW_REQUIRED");
});
