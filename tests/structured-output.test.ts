import assert from "node:assert/strict";
import test from "node:test";
import { StructuredOutputError, parseStrictStructuredOutput } from "../src/ai-sales-team/structured-output.ts";
import { ENRICHMENT_STRUCTURED_OUTPUT_FORMAT } from "../src/ai-sales-team/discovery.ts";

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
