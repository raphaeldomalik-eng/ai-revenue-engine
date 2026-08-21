import assert from "node:assert/strict";
import test from "node:test";
import { StructuredOutputError, parseStrictStructuredOutput } from "../src/ai-sales-team/structured-output.ts";
import { ENRICHMENT_STRUCTURED_OUTPUT_FORMAT, enrichDiscoveryCandidatesWithOpenAI, evaluateDiscoveryCandidate } from "../src/ai-sales-team/discovery.ts";

test("strict structured output exposes bounded incomplete and refusal telemetry", () => {
  assert.throws(() => parseStrictStructuredOutput({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [{ type: "message" }] }), (error: unknown) => error instanceof StructuredOutputError && error.telemetry.truncation && error.telemetry.incompleteReason === "max_output_tokens" && error.telemetry.outputItemTypes[0] === "message");
  assert.throws(() => parseStrictStructuredOutput({ status: "completed", refusal: "policy refusal", output: [{ type: "message", content: [{ type: "refusal", refusal: "policy refusal" }] }] }), (error: unknown) => error instanceof StructuredOutputError && error.telemetry.refusalStatus === "REFUSED");
  assert.throws(() => parseStrictStructuredOutput({ status: "completed", output_text: "{invalid" }), (error: unknown) => error instanceof StructuredOutputError && error.telemetry.parserPath === "responses.output_text" && Boolean(error.telemetry.schemaValidationError));
});

test("discovery enrichment uses the actual strict JSON schema response format", () => {
  assert.equal(ENRICHMENT_STRUCTURED_OUTPUT_FORMAT.type, "json_schema");
  assert.equal(ENRICHMENT_STRUCTURED_OUTPUT_FORMAT.strict, true);
  assert.equal(ENRICHMENT_STRUCTURED_OUTPUT_FORMAT.name, "prospecting_evidence_enrichment");
  assert.equal(ENRICHMENT_STRUCTURED_OUTPUT_FORMAT.schema.type, "object");
  assert.equal(ENRICHMENT_STRUCTURED_OUTPUT_FORMAT.schema.additionalProperties, false);
});

test("discovery enrichment sends the strict format under text.format", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  const seen: Request[] = [];
  process.env.OPENAI_API_KEY = "test-key";
  globalThis.fetch = async (input, init) => {
    seen.push(new Request(input, init));
    return new Response(JSON.stringify({ status: "completed", output_text: JSON.stringify({ candidates: [] }) }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const candidate = evaluateDiscoveryCandidate({ canonicalName: "ArcTanGent Festival", organiserName: "ArcTanGent", website: null, origin: "EVENT_FIRST", relationshipHint: "PROSPECT", laneContext: { organisation: null, person: null, venue: null }, facts: [{ claim: "ArcTanGent Festival is a current recurring event and ArcTanGent organises it.", sourceUrl: "https://arctangent.co.uk", sourceTitle: "Official source", kind: "FACT", confidence: "HIGH", sourceRoles: ["DISCOVERY"], eventFreshness: "ACTIVE_UPCOMING" }], inferences: [], unknowns: [], phaseOneEvidence: [{ kind: "INDEPENDENT_ORGANISER", value: "Independent organiser", sourceUrl: "https://arctangent.co.uk", confidence: "HIGH" }] }, "GB");
    await enrichDiscoveryCandidatesWithOpenAI([candidate], "GB");
    const body = await seen[0].clone().json() as Record<string, any>;
    assert.equal(body.text?.format?.type, "json_schema");
    assert.equal(body.text?.format?.strict, true);
    assert.equal(body.text?.format?.name, "prospecting_evidence_enrichment");
    assert.equal(body.max_tool_calls, 3);
    assert.deepEqual(body.tools, [{ type: "web_search" }]);
    assert.equal(seen.length, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
  }
});
