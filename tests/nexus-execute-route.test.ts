import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { nexusExecutorDisabled, nexusSourceDiscoveryDisabled } from "../src/nexus/http.ts";

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

test("source discovery has its own production flag and does not open research", () => {
  const env = (value: Record<string, string>) => value as NodeJS.ProcessEnv;
  const productionResearchOn = env({ VERCEL_ENV: "production", NEXUS_EXECUTOR_ENABLED: "true" });
  assert.equal(nexusExecutorDisabled(productionResearchOn), true);
  assert.equal(nexusSourceDiscoveryDisabled(productionResearchOn), true);
  const productionDiscoveryOn = env({ VERCEL_ENV: "production", NEXUS_EXECUTOR_ENABLED: "true", NEXUS_SOURCE_DISCOVERY_ENABLED: "true" });
  assert.equal(nexusExecutorDisabled(productionDiscoveryOn), true);
  assert.equal(nexusSourceDiscoveryDisabled(productionDiscoveryOn), false);
  assert.equal(nexusSourceDiscoveryDisabled(env({ VERCEL_ENV: "production", NEXUS_SOURCE_DISCOVERY_ENABLED: " TRUE " })), false);
  assert.equal(nexusSourceDiscoveryDisabled(env({ VERCEL_ENV: "production", NEXUS_SOURCE_DISCOVERY_ENABLED: "false" })), true);
  assert.equal(nexusSourceDiscoveryDisabled(env({ VERCEL_ENV: "preview", NEXUS_EXECUTOR_ENABLED: "true" })), false);
  assert.equal(nexusSourceDiscoveryDisabled(env({ VERCEL_ENV: "preview", NEXUS_EXECUTOR_ENABLED: "false" })), true);
  const source = readFileSync(new URL("../app/api/integrations/nexus/execute/route.ts", import.meta.url), "utf8");
  assert.match(source, /nexusSourceDiscoveryDisabled\(\)/);
  assert.match(source, /allowResearch: !researchDisabled/);
  assert.match(source, /allowSourceDiscovery: !sourceDiscoveryDisabled/);
  assert.match(source, /researchDisabled && sourceDiscoveryDisabled/);
});
