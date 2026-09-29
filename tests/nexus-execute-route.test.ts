import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { nexusExecutorDisabled } from "../src/nexus/http.ts";

test("preview execution version is the unclassified evidence generation", () => {
  const source = readFileSync(new URL("../app/api/integrations/nexus/execute/route.ts", import.meta.url), "utf8");
  assert.match(source, /researchExecutionVersion:\s*"resources-v2-unclassified-evidence-v6"/);
  assert.match(source, /nexusExecutorDisabled\(\)/);
});

test("production keeps the Nexus executor unavailable", () => {
  const env = (value: Record<string, string>) => value as NodeJS.ProcessEnv;
  assert.equal(nexusExecutorDisabled(env({ VERCEL_ENV: "production", NEXUS_EXECUTOR_ENABLED: "true" })), true);
  assert.equal(nexusExecutorDisabled(env({ VERCEL_ENV: "preview", NEXUS_EXECUTOR_ENABLED: "false" })), true);
  assert.equal(nexusExecutorDisabled(env({ VERCEL_ENV: "preview", NEXUS_EXECUTOR_ENABLED: "true" })), false);
});
