import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { contactResearchProductionEnabled, discoveryProductionEnabled, PRODUCTION_ACTIVATION_FLAGS, productionActivation } from "../src/lib/server-production-activation.ts";

const emptyEnvironment = {};

test("production activation is default-off and requires both scope flags", () => {
  assert.deepEqual(productionActivation(emptyEnvironment), { discoveryPilot: false, discoveryPersistence: false, contactResearchPilot: false, contactPersistence: false });
  assert.equal(discoveryProductionEnabled(emptyEnvironment), false);
  assert.equal(contactResearchProductionEnabled(emptyEnvironment), false);
  assert.equal(discoveryProductionEnabled({ [PRODUCTION_ACTIVATION_FLAGS.discoveryPilot]: "true" }), false);
  assert.equal(contactResearchProductionEnabled({ [PRODUCTION_ACTIVATION_FLAGS.contactPersistence]: "true" }), false);
  assert.equal(discoveryProductionEnabled({ [PRODUCTION_ACTIVATION_FLAGS.discoveryPilot]: " TRUE ", [PRODUCTION_ACTIVATION_FLAGS.discoveryPersistence]: "true" }), true);
  assert.equal(contactResearchProductionEnabled({ [PRODUCTION_ACTIVATION_FLAGS.contactResearchPilot]: "true", [PRODUCTION_ACTIVATION_FLAGS.contactPersistence]: "true" }), true);
  for (const value of [undefined, "", " ", "false", "1", "yes"]) {
    const env = { [PRODUCTION_ACTIVATION_FLAGS.discoveryPilot]: value, [PRODUCTION_ACTIVATION_FLAGS.discoveryPersistence]: value, [PRODUCTION_ACTIVATION_FLAGS.contactResearchPilot]: value, [PRODUCTION_ACTIVATION_FLAGS.contactPersistence]: value };
    assert.equal(discoveryProductionEnabled(env), false);
    assert.equal(contactResearchProductionEnabled(env), false);
  }
});

test("default-disabled route gates produce PILOT_NOT_ENABLED with zero provider calls and writes", () => {
  const effects = { providerCalls: 0, databaseWrites: 0 };
  const runBlockedRoute = (enabled: boolean) => {
    if (!enabled) return { status: 503, body: { code: "PILOT_NOT_ENABLED" } };
    effects.providerCalls += 1;
    effects.databaseWrites += 1;
    return { status: 200, body: {} };
  };
  assert.deepEqual(runBlockedRoute(discoveryProductionEnabled(emptyEnvironment)), { status: 503, body: { code: "PILOT_NOT_ENABLED" } });
  assert.deepEqual(runBlockedRoute(contactResearchProductionEnabled(emptyEnvironment)), { status: 503, body: { code: "PILOT_NOT_ENABLED" } });
  assert.deepEqual(effects, { providerCalls: 0, databaseWrites: 0 });
});

test("route source places the activation gate before Supabase auth, provider calls and writes", () => {
  const discovery = readFileSync("app/api/ai-sales/discovery/route.ts", "utf8");
  const contact = readFileSync("app/api/ai-sales/contact-research/route.ts", "utf8");
  for (const [source, gate, auth, providerOrRead, write] of [
    [discovery, "discoveryProductionEnabled", "const state = await operatorClient();", "discoverProspects", ".insert("],
    [contact, "contactResearchProductionEnabled", "const state = await operatorClient();", "researchEligibleProspectContact", ".update("],
  ] as const) {
    const postSource = source.slice(source.indexOf("export async function POST"));
    assert.ok(postSource.includes(`if (!${gate}())`));
    assert.ok(postSource.includes('code: "PILOT_NOT_ENABLED"'));
    assert.ok(postSource.indexOf(`if (!${gate}())`) < postSource.indexOf(auth));
    assert.ok(postSource.indexOf(`if (!${gate}())`) < postSource.indexOf(providerOrRead));
    assert.ok(postSource.indexOf(`if (!${gate}())`) < postSource.indexOf(write));
  }
});
