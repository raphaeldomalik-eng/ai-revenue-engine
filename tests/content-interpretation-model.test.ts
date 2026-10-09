import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createContentInterpretationModel } from "../src/nexus/content-interpretation-model.ts";
import { validateContentInterpretationRequest } from "../src/nexus/content-interpretation-contracts.mjs";

const env = { OPENAI_API_KEY: "fixture-secret", CONTENT_INTERPRETATION_MODEL: "fixture-model", CONTENT_INTERPRETATION_INPUT_USD_PER_MILLION: "1", CONTENT_INTERPRETATION_OUTPUT_USD_PER_MILLION: "2", CONTENT_INTERPRETATION_PRICE_REVISION: "fixture-pricing" };
function request() {
  const text = "James McMurtry writes story songs.";
  return validateContentInterpretationRequest({ contractVersion: "nexus.content-interpretation-request.v1", requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", originatingProduct: "last_train_home", source: { provider: "ticketmaster", recordId: "S9RKXY", sourceUrl: "https://www.universe.com/events/james-mcmurtry-tickets-S9RKXY", documentFingerprint: "1".repeat(64), mappingRevision: "2".repeat(64), policy: { reference: "ticketmaster-source-prose", revision: "2026-10-09", allowInterpretation: true }, observedAt: "2026-10-09T12:00:00.000Z", expiresAt: "2026-10-16T12:00:00.000Z" }, targets: [{ product: "last_train_home", entityType: "ARTIST", entityId: "artist-1", displayName: "James McMurtry", canonicalEntityId: null }], blocks: [{ blockId: "block-1", sourceLocator: "$.description", text, textHash: createHash("sha256").update(text).digest("hex"), sourceContext: "UNCLASSIFIED", targetEntityId: null }], budget: { maxModelCalls: 1, maxOutputTokens: 1024, currency: "USD", amount: 0.1 }, requestWhyGoDraft: false });
}
test("model execution has no defaults for prices or model and makes no call when unconfigured", () => {
  assert.equal(createContentInterpretationModel({}), null);
  assert.equal(createContentInterpretationModel({ ...env, CONTENT_INTERPRETATION_INPUT_USD_PER_MILLION: "" }), null);
});
test("structured Responses request uses no external tools, stores no response and limits output", async () => {
  let body: Record<string, unknown> = {};
  const model = createContentInterpretationModel(env, async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    body = JSON.parse(String(init?.body));
    return Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify({ decisions: [{ blockId: "block-1", targetEntityId: "artist-1", scope: "STABLE", confidence: 0.99 }], whyGoDraft: null }) }] }], usage: { input_tokens: 100, output_tokens: 50 } });
  });
  assert.ok(model); const result = await model.interpret(request());
  assert.equal(body.store, false); assert.deepEqual(body.tools, []); assert.equal(body.max_output_tokens, 1024); assert.equal(body.model, "fixture-model"); assert.equal(result.usage.inputTokens, 100);
  assert.ok(model.inputTokenUpperBound!(request()) > Buffer.byteLength(JSON.stringify(body)));
});
test("incomplete, missing usage and oversized provider bodies are not treated as successful paid results", async () => {
  for (const payload of [{ status: "incomplete", usage: { input_tokens: 100, output_tokens: 50 }, output_text: "{}" }, { status: "completed", output_text: "{}" }]) {
    const model = createContentInterpretationModel(env, async () => Response.json(payload)); assert.ok(model);
    await assert.rejects(model.interpret(request()), /CONTENT_MODEL/);
  }
  const model = createContentInterpretationModel(env, async () => new Response(" ".repeat(128001))); assert.ok(model);
  await assert.rejects(model.interpret(request()), /RESPONSE_TOO_LARGE/);
});
