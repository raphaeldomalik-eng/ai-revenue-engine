import assert from "node:assert/strict";
import test from "node:test";
import { assertGooglePlacesContinuityMask } from "../src/ai-sales-team/google-places-evidence.ts";
import { createPlaceContinuityFetcher, followPlaceContinuity, placeSuccessor } from "../src/nexus/source-discovery/venue/place-continuity.ts";

const observedAt = "2026-10-03T06:00:00.000Z";

test("place continuity refuses every mask except IDs Only", () => {
  const classification = assertGooglePlacesContinuityMask();
  assert.equal(classification.sku, "Place Details Essentials (IDs Only)");
  assert.equal(classification.estimatedCostUsd, 0);
  assert.throws(() => assertGooglePlacesContinuityMask("id,websiteUri"), /MASK_REFUSED/);
});

test("a Place with no move signal is not treated as operational", async () => {
  const row = await followPlaceContinuity("ChIJoriginal1", async () => ({ ok: true, movedPlaceId: null }), observedAt);
  assert.equal(row.placeMoveStatus, "NO_MOVE_SIGNAL");
  assert.equal(row.terminalProviderPlaceId, "ChIJoriginal1");
  assert.equal(row.placeMoveHopCount, 0);
  assert.equal(await followPlaceContinuity(null, async () => ({ ok: true, movedPlaceId: null }), observedAt).then((item) => item.placeMoveStatus), "NO_PLACE_ID");
});

test("a moved Place chain resolves, cycles, or stops at five IDs", async () => {
  const resolved = await followPlaceContinuity("ChIJoriginal1", async (placeId) => ({
    ok: true,
    movedPlaceId: placeId === "ChIJoriginal1" ? "ChIJsuccessor1" : null,
  }), observedAt);
  assert.equal(resolved.placeMoveStatus, "MOVED_PLACE_RESOLVED");
  assert.deepEqual(resolved.placeMoveChain, ["ChIJoriginal1", "ChIJsuccessor1"]);
  assert.equal(resolved.placeMoveHopCount, 1);
  assert.equal(resolved.terminalProviderPlaceId, "ChIJsuccessor1");

  const cycle = await followPlaceContinuity("ChIJoriginal1", async (placeId) => ({
    ok: true,
    movedPlaceId: placeId === "ChIJoriginal1" ? "ChIJsuccessor1" : "ChIJoriginal1",
  }), observedAt);
  assert.equal(cycle.placeMoveStatus, "MOVED_PLACE_CYCLE");
  assert.deepEqual(cycle.placeMoveChain, ["ChIJoriginal1", "ChIJsuccessor1", "ChIJoriginal1"]);

  let n = 0;
  const limited = await followPlaceContinuity("ChIJplace0001", async () => {
    n += 1;
    return { ok: true, movedPlaceId: `ChIJplace000${n + 1}` };
  }, observedAt);
  assert.equal(limited.placeMoveStatus, "MOVED_PLACE_HOP_LIMIT");
  assert.equal(limited.placeMoveChain.length, 5);
  assert.equal(n, 5);
});

test("lookup failure and a malformed move stay failed", async () => {
  const failed = await followPlaceContinuity("ChIJoriginal1", async () => ({ ok: false, reason: "FAILED", message: "HTTP 404" }), observedAt);
  assert.equal(failed.placeMoveStatus, "MOVED_PLACE_LOOKUP_FAILED");
  assert.equal(failed.failureReason, "HTTP 404");
  assert.deepEqual(placeSuccessor({ id: "ChIJoriginal1", movedPlace: "places/ChIJotherplace", movedPlaceId: "ChIJdifferent" }), {
    ok: false, reason: "MALFORMED", message: "movedPlace and movedPlaceId disagreed.",
  });
  assert.deepEqual(placeSuccessor({ id: "ChIJoriginal1", movedPlaceId: "ChIJsuccessor1" }), { ok: true, movedPlaceId: "ChIJsuccessor1" });
});

test("the live fetcher sends only the continuity mask", async () => {
  const calls: Array<{ url: string; mask: string | null }> = [];
  const fetcher = createPlaceContinuityFetcher({
    apiKey: "test-key",
    originalPlaceIds: new Set(["ChIJoriginal1"]),
    fetchImpl: async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), mask: headers.get("X-Goog-FieldMask") });
      assert.equal(headers.get("X-Goog-Api-Key"), "test-key");
      return new Response(JSON.stringify({ id: "ChIJoriginal1" }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const row = await followPlaceContinuity("ChIJoriginal1", fetcher.lookup, observedAt);
  assert.equal(row.placeMoveStatus, "NO_MOVE_SIGNAL");
  assert.equal(calls[0]?.mask, "id,movedPlace,movedPlaceId");
  assert.equal(calls[0]?.url, "https://places.googleapis.com/v1/places/ChIJoriginal1");
  const stats = fetcher.instrumentation();
  assert.equal(stats.requestCount, 1);
  assert.equal(stats.followUpRequests, 0);
  assert.equal(stats.sku, "Place Details Essentials (IDs Only)");
  assert.equal(stats.estimatedPaidCostUsd, 0);
});
