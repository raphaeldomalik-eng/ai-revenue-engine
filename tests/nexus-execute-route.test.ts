import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { nexusExecutorDisabled, nexusSourceDiscoveryDisabled } from "../src/nexus/http.ts";

test("actual production execute route rejects before persistence or network access", () => {
  // The actual route imports parameter-property classes: isolate Node's transform
  // mode here without changing the repository's strip-only test contract.
  const route = new URL('../app/api/integrations/nexus/execute/route.ts', import.meta.url).href;
  const script = `import assert from 'node:assert/strict';
    globalThis.fetch = async () => { throw new Error('Network prohibited'); };
    const { POST } = await import(${JSON.stringify(route)});
    const response = await POST(new Request('https://fixture.example/api/integrations/nexus/execute', {method:'POST',body:'{}'}));
    assert.equal(response.status,404);
    assert.deepEqual(await response.json(),{code:'NEXUS_EXECUTOR_NOT_AVAILABLE'});`;
  execFileSync(process.execPath, ['--experimental-transform-types', '--input-type=module', '-e', script], {
    stdio: 'pipe', env: { ...process.env, VERCEL_ENV: 'production', NEXUS_EXECUTOR_ENABLED: 'true', NEXUS_SOURCE_DISCOVERY_ENABLED: 'true', NEXUS_CONTENT_INTERPRETATION_ENABLED: 'false' },
  });
});

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

test("code-only release holds production discovery even with stale enabled flags", () => {
  const env = (value: Record<string, string>) => value as NodeJS.ProcessEnv;
  const productionResearchOn = env({ VERCEL_ENV: "production", NEXUS_EXECUTOR_ENABLED: "true" });
  assert.equal(nexusExecutorDisabled(productionResearchOn), true);
  assert.equal(nexusSourceDiscoveryDisabled(productionResearchOn), true);
  const productionDiscoveryOn = env({ VERCEL_ENV: "production", NEXUS_EXECUTOR_ENABLED: "true", NEXUS_SOURCE_DISCOVERY_ENABLED: "true" });
  assert.equal(nexusExecutorDisabled(productionDiscoveryOn), true);
  assert.equal(nexusSourceDiscoveryDisabled(productionDiscoveryOn), true);
  assert.equal(nexusSourceDiscoveryDisabled(env({ VERCEL_ENV: "production", NEXUS_SOURCE_DISCOVERY_ENABLED: " TRUE " })), true);
  assert.equal(nexusSourceDiscoveryDisabled(env({ VERCEL_ENV: "production", NEXUS_SOURCE_DISCOVERY_ENABLED: "false" })), true);
  assert.equal(nexusSourceDiscoveryDisabled(env({ VERCEL_ENV: "preview", NEXUS_EXECUTOR_ENABLED: "true" })), false);
  assert.equal(nexusSourceDiscoveryDisabled(env({ VERCEL_ENV: "preview", NEXUS_EXECUTOR_ENABLED: "false" })), true);
  const source = readFileSync(new URL("../app/api/integrations/nexus/execute/route.ts", import.meta.url), "utf8");
  assert.match(source, /nexusSourceDiscoveryDisabled\(\)/);
  assert.match(source, /allowResearch: !researchDisabled/);
  assert.match(source, /allowSourceDiscovery: !sourceDiscoveryDisabled/);
  assert.match(source, /researchDisabled && sourceDiscoveryDisabled/);
});
