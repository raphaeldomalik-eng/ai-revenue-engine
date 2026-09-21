import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryNexusResultStore } from "../src/nexus/executor.ts";
import { handleNexusExecuteRequest } from "../src/nexus/http.ts";
import { buildNexusEnvelope, nexusSignatureFor, NEXUS_MAX_BODY_BYTES } from "../src/nexus/transport.ts";

const secret = "test-nexus-secret";
const nowSeconds = 1_800_000_000;
const ids = {
  requestId: "11111111-1111-4111-8111-111111111111",
  idempotencyKey: "22222222-2222-4222-8222-222222222222",
  correlationId: "33333333-3333-4333-8333-333333333333",
};

function research(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "nexus.research-request.v1",
    requestId: ids.requestId,
    idempotencyKey: ids.idempotencyKey,
    correlationId: ids.correlationId,
    originatingProduct: "event_suite_resources",
    subject: {
      canonicalEntityId: null,
      candidateReference: { sourceSystem: "event_suite_resources", sourceRecordId: "Transport Proof Venue" },
      entityType: "VENUE",
    },
    researchPurpose: "OFFICIAL_WEBSITE",
    requestedFactTypes: ["officialWebsite"],
    providerAllowances: ["PUBLIC_WEB"],
    costCeiling: { currency: "USD", amount: 0 },
    freshnessRequirements: { maxAgeHours: 24 },
    existingEvidenceRefs: [],
    requestedBy: { actorType: "SYSTEM", actorId: "nexus-transport-proof" },
    createdAt: "2027-01-15T08:00:00.000Z",
    ...overrides,
  };
}

function signedRequest(payload: Record<string, unknown>, options: { secret?: string; timestamp?: string; body?: string; signature?: string | null } = {}) {
  const timestamp = options.timestamp ?? String(nowSeconds);
  const envelope = buildNexusEnvelope(payload, options.secret ?? secret, timestamp);
  const body = options.body ?? envelope.body;
  const signature = options.signature === undefined
    ? (options.body === undefined ? envelope.signature : nexusSignatureFor(timestamp, body, options.secret ?? secret))
    : options.signature;
  const headers = new Headers({ "content-type": "application/json", "x-nexus-timestamp": timestamp });
  if (signature !== null) headers.set("x-nexus-signature", signature);
  return new Request("https://preview.example/api/integrations/nexus/execute", { method: "POST", headers, body });
}

const options = (store = new InMemoryNexusResultStore()) => ({ secret, store, now: () => nowSeconds * 1000 });

test("accepts a signed supported request and returns a validated result", async () => {
  const response = await handleNexusExecuteRequest(signedRequest(research()), options());
  const body = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 200);
  assert.equal(body.contractVersion, "nexus.research-result.v1");
  assert.equal(body.requestId, ids.requestId);
  assert.equal(body.idempotencyKey, ids.idempotencyKey);
});

test("returns the stored result for an identical idempotency key", async () => {
  const store = new InMemoryNexusResultStore();
  const first = await handleNexusExecuteRequest(signedRequest(research()), options(store));
  const second = await handleNexusExecuteRequest(signedRequest(research()), options(store));
  assert.equal(first.status, 200);
  assert.deepEqual(await second.json(), await first.json());
});

test("rejects missing and incorrect signatures", async () => {
  const missing = await handleNexusExecuteRequest(signedRequest(research(), { signature: null }), options());
  const incorrect = await handleNexusExecuteRequest(signedRequest(research(), { secret: "wrong-secret" }), options());
  assert.equal(missing.status, 401);
  assert.equal(incorrect.status, 401);
});

test("rejects stale timestamps", async () => {
  const response = await handleNexusExecuteRequest(signedRequest(research(), { timestamp: String(nowSeconds - 301) }), options());
  assert.equal(response.status, 401);
  assert.equal((await response.json() as { code: string }).code, "NEXUS_TIMESTAMP_EXPIRED");
});

test("rejects oversized bodies before contract execution", async () => {
  const body = JSON.stringify({ payload: research(), padding: "x".repeat(NEXUS_MAX_BODY_BYTES) });
  const response = await handleNexusExecuteRequest(signedRequest(research(), { body }), options());
  assert.equal(response.status, 413);
});

test("rejects malformed envelopes, unsupported contracts, and invalid payloads", async () => {
  const malformed = "{";
  const malformedRequest = signedRequest(research(), { body: malformed });
  const unsupported = signedRequest({ contractVersion: "nexus.arbitrary-job.v1" });
  const invalid = signedRequest(research({ requestId: "not-a-uuid" }));
  assert.equal((await handleNexusExecuteRequest(malformedRequest, options())).status, 400);
  assert.equal((await handleNexusExecuteRequest(unsupported, options())).status, 422);
  assert.equal((await handleNexusExecuteRequest(invalid, options())).status, 422);
});
