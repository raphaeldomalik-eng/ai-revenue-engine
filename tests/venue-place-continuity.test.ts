import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertGooglePlacesContinuityMask } from "../src/ai-sales-team/google-places-evidence.ts";
import { classifyPlaceLookupFailure, createPlaceContinuityFetcher, followPlaceContinuity, placeSuccessor, reclassifyStoredPlaceMove, type PlaceMoveStatus } from "../src/nexus/source-discovery/venue/place-continuity.ts";

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
  const failed = await followPlaceContinuity("ChIJoriginal1", async () => ({ ok: false, reason: "FAILED", message: "HTTP 503" }), observedAt);
  assert.equal(failed.placeMoveStatus, "MOVED_PLACE_LOOKUP_FAILED");
  assert.equal(failed.failureReason, "HTTP 503");
  const malformed = await followPlaceContinuity("ChIJoriginal1", async () => ({ ok: false, reason: "MALFORMED", message: "movedPlace and movedPlaceId disagreed." }), observedAt);
  assert.equal(malformed.placeMoveStatus, "MOVED_PLACE_LOOKUP_FAILED");
  assert.deepEqual(placeSuccessor({ id: "ChIJoriginal1", movedPlace: "places/ChIJotherplace", movedPlaceId: "ChIJdifferent" }), {
    ok: false, reason: "MALFORMED", message: "movedPlace and movedPlaceId disagreed.",
  });
  assert.deepEqual(placeSuccessor({ id: "ChIJoriginal1", movedPlaceId: "ChIJsuccessor1" }), { ok: true, movedPlaceId: "ChIJsuccessor1" });
});

test("HTTP 400 is an invalid Place ID and is not retried", async () => {
  const row = await followPlaceContinuity("ChIJoriginal1", async () => ({ ok: false, reason: "FAILED", message: "HTTP 400" }), observedAt);
  assert.equal(row.placeMoveStatus, "INVALID_PLACE_ID");
  assert.equal(row.providerPlaceId, "ChIJoriginal1");
  assert.equal(row.failureReason, "HTTP 400");
  assert.equal(classifyPlaceLookupFailure("INVALID_REQUEST"), "INVALID_PLACE_ID");
  let calls = 0;
  const fetcher = createPlaceContinuityFetcher({
    apiKey: "test-key",
    originalPlaceIds: new Set(["ChIJoriginal1"]),
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { status: "INVALID_REQUEST" } }), { status: 400 });
    },
  });
  const live = await followPlaceContinuity("ChIJoriginal1", fetcher.lookup, observedAt);
  assert.equal(live.placeMoveStatus, "INVALID_PLACE_ID");
  assert.equal(calls, 1);
  assert.equal(fetcher.instrumentation().estimatedPaidCostUsd, 0);
});

test("HTTP 404 is an obsolete Place ID and does not prove a move", async () => {
  const row = await followPlaceContinuity("ChIJoriginal1", async () => ({ ok: false, reason: "FAILED", message: "HTTP 404" }), observedAt);
  assert.equal(row.placeMoveStatus, "OBSOLETE_PLACE_ID");
  assert.equal(row.terminalProviderPlaceId, "ChIJoriginal1");
  assert.equal(row.placeMoveChain.length, 1);
  assert.equal(classifyPlaceLookupFailure("NOT_FOUND"), "OBSOLETE_PLACE_ID");
  let calls = 0;
  const fetcher = createPlaceContinuityFetcher({
    apiKey: "test-key",
    originalPlaceIds: new Set(["ChIJoriginal1"]),
    fetchImpl: async () => {
      calls += 1;
      return new Response("{}", { status: 404 });
    },
  });
  const live = await followPlaceContinuity("ChIJoriginal1", fetcher.lookup, observedAt);
  assert.equal(live.placeMoveStatus, "OBSOLETE_PLACE_ID");
  assert.equal(calls, 1);
});

test("429, 5xx, and timeout stay retryable lookup failures", async () => {
  assert.equal(classifyPlaceLookupFailure("HTTP 429"), "MOVED_PLACE_LOOKUP_FAILED");
  assert.equal(classifyPlaceLookupFailure("HTTP 500"), "MOVED_PLACE_LOOKUP_FAILED");
  assert.equal(classifyPlaceLookupFailure("AbortError"), "MOVED_PLACE_LOOKUP_FAILED");
  const limited = await followPlaceContinuity("ChIJoriginal1", async () => ({ ok: false, reason: "FAILED", message: "HTTP 429" }), observedAt);
  assert.equal(limited.placeMoveStatus, "MOVED_PLACE_LOOKUP_FAILED");
  let rateCalls = 0;
  const rateLimited = createPlaceContinuityFetcher({
    apiKey: "test-key",
    originalPlaceIds: new Set(["ChIJoriginal1"]),
    fetchImpl: async () => {
      rateCalls += 1;
      return new Response("{}", { status: 429 });
    },
  });
  assert.equal((await followPlaceContinuity("ChIJoriginal1", rateLimited.lookup, observedAt)).placeMoveStatus, "MOVED_PLACE_LOOKUP_FAILED");
  assert.equal(rateCalls, 2);
  let serverCalls = 0;
  const server = createPlaceContinuityFetcher({
    apiKey: "test-key",
    originalPlaceIds: new Set(["ChIJoriginal1"]),
    fetchImpl: async () => {
      serverCalls += 1;
      return new Response("{}", { status: 503 });
    },
  });
  assert.equal((await followPlaceContinuity("ChIJoriginal1", server.lookup, observedAt)).placeMoveStatus, "MOVED_PLACE_LOOKUP_FAILED");
  assert.equal(serverCalls, 2);
  const timedOut = createPlaceContinuityFetcher({
    apiKey: "test-key",
    originalPlaceIds: new Set(["ChIJoriginal1"]),
    fetchImpl: async () => {
      const error = new Error("timed out");
      error.name = "AbortError";
      throw error;
    },
  });
  const timeoutRow = await followPlaceContinuity("ChIJoriginal1", timedOut.lookup, observedAt);
  assert.equal(timeoutRow.placeMoveStatus, "MOVED_PLACE_LOOKUP_FAILED");
  assert.equal(timeoutRow.failureReason, "AbortError");
  assert.equal(timedOut.instrumentation().estimatedPaidCostUsd, 0);
});

test("recorded place continuity totals reconcile to the READY cohort", () => {
  const rows = readFileSync(new URL("../docs/quality/2026-10-03-venue-authority-preflight.jsonl", import.meta.url), "utf8").trim().split("\n").map((line) => JSON.parse(line) as { disposition: string; placeMoveStatus: PlaceMoveStatus; failureReason: string | null });
  const report = JSON.parse(readFileSync(new URL("../docs/quality/2026-10-03-venue-authority-preflight-report.json", import.meta.url), "utf8")) as {
    input: number;
    dispositions: Record<string, number>;
    immediatelyCrawlable: number;
    googlePlaceIdRefreshRequired: number;
    placeMove: Record<string, number>;
    placeContinuity: { cumulativeProofRequests: number; cumulativeProofRequestsLabel: string; uniquePlaceIdsQueried: number; uniqueReadyPlaceIds: number; estimatedPaidCostUsd: number; fieldMask: string; finalExecutionRequestCountProvable: boolean };
  };
  const moves: Record<string, number> = {};
  for (const row of rows) moves[row.placeMoveStatus] = (moves[row.placeMoveStatus] ?? 0) + 1;
  const moveTotal = Object.values(moves).reduce((sum, count) => sum + count, 0);
  assert.equal(rows.length, report.input);
  assert.equal(moveTotal, rows.length);
  assert.deepEqual(moves, report.placeMove);
  assert.equal(rows.filter((row) => row.placeMoveStatus === "MOVED_PLACE_LOOKUP_FAILED" && (row.failureReason === "HTTP 400" || row.failureReason === "HTTP 404")).length, 0);
  assert.equal((moves.INVALID_PLACE_ID ?? 0) + (moves.OBSOLETE_PLACE_ID ?? 0), report.googlePlaceIdRefreshRequired);
  assert.equal(reclassifyStoredPlaceMove("MOVED_PLACE_LOOKUP_FAILED", "HTTP 400"), "INVALID_PLACE_ID");
  assert.equal(reclassifyStoredPlaceMove("MOVED_PLACE_LOOKUP_FAILED", "HTTP 404"), "OBSOLETE_PLACE_ID");
  assert.equal(reclassifyStoredPlaceMove("NO_MOVE_SIGNAL", null), "NO_MOVE_SIGNAL");
  assert.equal(report.dispositions.SAFE_RECOVERY_AVAILABLE, rows.filter((row) => row.disposition === "SAFE_RECOVERY_AVAILABLE").length);
  assert.equal(report.immediatelyCrawlable, (report.dispositions.HEALTHY ?? 0) + (report.dispositions.SAFE_RECOVERY_AVAILABLE ?? 0));
  assert.equal(report.placeContinuity.cumulativeProofRequestsLabel, "CUMULATIVE_PROOF_REQUESTS");
  assert.equal(report.placeContinuity.finalExecutionRequestCountProvable, false);
  assert.equal(report.placeContinuity.uniqueReadyPlaceIds, report.placeContinuity.uniquePlaceIdsQueried);
  assert.equal(report.placeContinuity.fieldMask, "id,movedPlace,movedPlaceId");
  assert.equal(report.placeContinuity.estimatedPaidCostUsd, 0);
  assert.ok(report.placeContinuity.cumulativeProofRequests > report.placeContinuity.uniquePlaceIdsQueried);
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
