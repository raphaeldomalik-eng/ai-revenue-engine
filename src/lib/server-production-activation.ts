/**
 * Server-route activation controls. These names intentionally do not use the
 * NEXT_PUBLIC_ prefix and this module is imported only by server handlers.
 * Every flag is opt-in: only the literal value "true" enables it.
 */
export const PRODUCTION_ACTIVATION_FLAGS = {
  discoveryPilot: "AI_REVENUE_DISCOVERY_PILOT_ENABLED",
  discoveryPersistence: "AI_REVENUE_DISCOVERY_PERSISTENCE_ENABLED",
  contactResearchPilot: "AI_REVENUE_CONTACT_RESEARCH_PILOT_ENABLED",
  contactPersistence: "AI_REVENUE_CONTACT_PERSISTENCE_ENABLED",
  outreachComposer: "AI_OUTREACH_COMPOSER_ENABLED",
  outreachComposerPersistence: "AI_OUTREACH_COMPOSER_PERSISTENCE_ENABLED",
  outreachSending: "AI_OUTREACH_SENDING_ENABLED",
} as const;

type ServerEnvironment = Record<string, string | undefined>;

function explicitlyEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export function productionActivation(env: ServerEnvironment = process.env) {
  // This is a server-only module. Fail closed if it is ever imported by a
  // browser bundle despite the route-only import boundary.
  if (typeof window !== "undefined") return { discoveryPilot: false, discoveryPersistence: false, contactResearchPilot: false, contactPersistence: false, outreachComposer: false, outreachComposerPersistence: false, outreachSending: false };
  return {
    discoveryPilot: explicitlyEnabled(env[PRODUCTION_ACTIVATION_FLAGS.discoveryPilot]),
    discoveryPersistence: explicitlyEnabled(env[PRODUCTION_ACTIVATION_FLAGS.discoveryPersistence]),
    contactResearchPilot: explicitlyEnabled(env[PRODUCTION_ACTIVATION_FLAGS.contactResearchPilot]),
    contactPersistence: explicitlyEnabled(env[PRODUCTION_ACTIVATION_FLAGS.contactPersistence]),
    outreachComposer: explicitlyEnabled(env[PRODUCTION_ACTIVATION_FLAGS.outreachComposer]),
    outreachComposerPersistence: explicitlyEnabled(env[PRODUCTION_ACTIVATION_FLAGS.outreachComposerPersistence]),
    outreachSending: explicitlyEnabled(env[PRODUCTION_ACTIVATION_FLAGS.outreachSending]),
  };
}

export function discoveryProductionEnabled(env: ServerEnvironment = process.env) {
  const flags = productionActivation(env);
  return flags.discoveryPilot && flags.discoveryPersistence;
}

export function contactResearchProductionEnabled(env: ServerEnvironment = process.env) {
  const flags = productionActivation(env);
  return flags.contactResearchPilot && flags.contactPersistence;
}

export function outreachComposerProductionEnabled(env: ServerEnvironment = process.env) {
  const flags = productionActivation(env);
  return flags.outreachComposer && flags.outreachComposerPersistence;
}

export function outreachSendingProductionEnabled(env: ServerEnvironment = process.env) {
  return productionActivation(env).outreachSending;
}
