import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { LIVE_PHASE_ONE_12_CASES, PHASE_ONE_12_SCORING, validateFrozenManifest } from "../scripts/live-phase-one-12-case-luna-v1.ts";

test("the frozen Luna acceptance manifest contains three UK cases per lane", () => {
  assert.equal(validateFrozenManifest(), true);
  assert.equal(LIVE_PHASE_ONE_12_CASES.length, 12);
  for (const lane of ["EVENT_FIRST", "ORGANISATION_FIRST", "PERSON_FIRST", "VENUE_FIRST"] as const) assert.equal(LIVE_PHASE_ONE_12_CASES.filter((item) => item.lane === lane).length, 3);
  assert.equal(LIVE_PHASE_ONE_12_CASES.every((item) => item.locality?.includes("United Kingdom") || item.locality?.includes("London") || item.locality?.includes("Glasgow") || item.locality?.includes("Halifax")), true);
  assert.equal(LIVE_PHASE_ONE_12_CASES.filter((item) => item.phaseOneEvidence.some((evidence) => evidence.kind === "ENTERPRISE_GROUP")).length, 1);
  assert.equal(LIVE_PHASE_ONE_12_CASES.find((item) => item.startingSignal === "ArcTanGent Festival")?.lane, "EVENT_FIRST");
  assert.equal(LIVE_PHASE_ONE_12_CASES.find((item) => item.startingSignal === "The Piece Hall")?.lane, "VENUE_FIRST");
});

test("the acceptance scorecard is bounded and excludes contact/persistence actions", () => {
  assert.ok(PHASE_ONE_12_SCORING.includes("discovery source/lane preservation"));
  assert.ok(PHASE_ONE_12_SCORING.includes("hard safety gates remain zero"));
  assert.equal((PHASE_ONE_12_SCORING as readonly string[]).some((criterion) => criterion.includes("contact research")), false);
});

test("an injected provider failure leaves a sanitized partial artifact", async () => {
  const artifactPath = "artifacts/live-phase-one-12-case-luna-v1.injected-test.json";
  try {
    const run = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/live-phase-one-12-case-luna-v1.ts", "--dry-run", `--artifact=${artifactPath}`, "--inject-failure-after-provider-attempt=1"], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(run.status, 1);
    const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as { status: string; executionMode: string; manifest: unknown[]; completedCaseIds: string[]; currentCase: { id: string; stage: string } | null; providerCounters: { openAi: { attempted: number; succeeded: number; failed: number } }; failure: { exceptionType: string; message: string } | null; finalExitStatus: number };
    assert.equal(artifact.status, "BLOCKED");
    assert.equal(artifact.executionMode, "DRY_RUN");
    assert.equal(artifact.manifest.length, 12);
    assert.equal(artifact.completedCaseIds.length, 0);
    assert.equal(artifact.currentCase?.id, "E01");
    assert.equal(artifact.currentCase?.stage, "OPENAI_IDENTITY_AND_COMMERCIAL_RESEARCH");
    assert.equal(artifact.providerCounters.openAi.attempted, 1);
    assert.equal(artifact.providerCounters.openAi.succeeded, 0);
    assert.equal(artifact.providerCounters.openAi.failed, 1);
    assert.equal(artifact.failure?.exceptionType, "InjectedHarnessFailure");
    assert.equal(artifact.failure?.message, "INJECTED_FAILURE_AFTER_PROVIDER_ATTEMPT");
    assert.equal(artifact.finalExitStatus, 1);
  } finally {
    await rm(artifactPath, { force: true });
    await rm(`${artifactPath}.tmp`, { force: true });
  }
});
