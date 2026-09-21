import { createHash } from "node:crypto";
import {
  CONTRACTS,
  validateResearchRequest,
  validateResearchResult,
  validateSourceDiscoveryResult,
} from "./contracts.ts";
import {
  executeResearchRequest,
  executeSourceDiscoveryRequest,
  type ResearchContext,
  type ResearchExecutorOptions,
  type NexusResultStore,
} from "./executor.ts";
import {
  NEXUS_MAX_AGE_SECONDS,
  NEXUS_MAX_BODY_BYTES,
  parseNexusEnvelope,
  verifyNexusSignature,
} from "./transport.ts";

type Executor = (
  input: unknown,
  options: { store: NexusResultStore },
) => Promise<Record<string, unknown>>;

export type NexusHttpOptions = {
  secret: string;
  store: NexusResultStore;
  now?: () => number;
  publicWeb?: ResearchExecutorOptions["publicWeb"];
  researchContext?: (input: Record<string, unknown>) => ResearchContext;
  researchExecutionVersion?: string;
  executeResearch?: Executor;
  executeSourceDiscovery?: Executor;
};

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status });
}

async function readBoundedBody(request: Request): Promise<string> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > NEXUS_MAX_BODY_BYTES) {
    throw new Error("NEXUS_PAYLOAD_TOO_LARGE");
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > NEXUS_MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error("NEXUS_PAYLOAD_TOO_LARGE");
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
  return body + decoder.decode();
}

function timestampStatus(timestamp: string | null, now: number) {
  if (!timestamp || !Number.isInteger(Number(timestamp))) return "NEXUS_TIMESTAMP_INVALID";
  if (Math.abs(now / 1000 - Number(timestamp)) > NEXUS_MAX_AGE_SECONDS) return "NEXUS_TIMESTAMP_EXPIRED";
  return null;
}

function versionedUuid(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16]!, 16) % 4]!;
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function retryEligibleResearchResult(result: Record<string, unknown> | null) {
  if (!result || result.status !== "UNRESOLVED") return false;
  const errors = Array.isArray(result.researchErrors) ? result.researchErrors : [];
  return errors.every((error) => !error || typeof error !== "object" || (error as Record<string, unknown>).retryable !== false);
}

async function prepareVersionedResearchInput(input: Record<string, unknown>, options: NexusHttpOptions) {
  if (!options.researchExecutionVersion) return { input };
  const request = validateResearchRequest(input);
  const prior = await options.store.get(request.idempotencyKey);
  if (!retryEligibleResearchResult(prior)) return { input };
  const requestId = versionedUuid(`nexus-research-request:${options.researchExecutionVersion}:${request.requestId}`);
  const idempotencyKey = versionedUuid(`nexus-research-idempotency:${options.researchExecutionVersion}:${request.idempotencyKey}`);
  const refreshed = await options.store.get(idempotencyKey);
  if (refreshed) return { input, stored: refreshed };
  return { input: { ...input, requestId, idempotencyKey } };
}

export async function handleNexusExecuteRequest(request: Request, options: NexusHttpOptions): Promise<Response> {
  if (!options.secret) return json(503, { code: "NEXUS_HMAC_SECRET_NOT_CONFIGURED" });

  let rawBody: string;
  try {
    rawBody = await readBoundedBody(request);
  } catch (error) {
    if (error instanceof Error && error.message === "NEXUS_PAYLOAD_TOO_LARGE") {
      return json(413, { code: "NEXUS_PAYLOAD_TOO_LARGE" });
    }
    return json(400, { code: "NEXUS_BODY_READ_FAILED" });
  }

  const timestamp = request.headers.get("x-nexus-timestamp");
  const signature = request.headers.get("x-nexus-signature");
  if (!signature) return json(401, { code: "NEXUS_SIGNATURE_REQUIRED" });
  const timestampError = timestampStatus(timestamp, options.now?.() ?? Date.now());
  if (timestampError) return json(401, { code: timestampError });
  if (!verifyNexusSignature(signature, timestamp, rawBody, options.secret, options.now?.() ?? Date.now())) {
    return json(401, { code: "NEXUS_SIGNATURE_INVALID" });
  }

  let payload: Record<string, unknown>;
  try {
    payload = parseNexusEnvelope(rawBody);
  } catch (error) {
    const code = error instanceof Error && error.message === "NEXUS_PAYLOAD_TOO_LARGE"
      ? "NEXUS_PAYLOAD_TOO_LARGE"
      : "NEXUS_ENVELOPE_INVALID";
    return json(code === "NEXUS_PAYLOAD_TOO_LARGE" ? 413 : 400, { code });
  }

  try {
    if (payload.contractVersion === CONTRACTS.RESEARCH_REQUEST) {
      const prepared = await prepareVersionedResearchInput(payload, options);
      if (prepared.stored) return json(200, validateResearchResult(prepared.stored));
      const execute = options.executeResearch ?? (async (input, context) =>
        executeResearchRequest(input, options.researchContext?.(input as Record<string, unknown>) ?? {}, { publicWeb: options.publicWeb }, context.store));
      return json(200, validateResearchResult(await execute(prepared.input, { store: options.store })));
    }
    if (payload.contractVersion === CONTRACTS.SOURCE_DISCOVERY_REQUEST) {
      const execute = options.executeSourceDiscovery ?? (async (input, context) =>
        executeSourceDiscoveryRequest(input, {}, context.store));
      return json(200, validateSourceDiscoveryResult(await execute(payload, { store: options.store })));
    }
    return json(422, { code: "NEXUS_CONTRACT_UNSUPPORTED" });
  } catch (error) {
    const code = error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : "NEXUS_CONTRACT_INVALID";
    return json(422, { code });
  }
}
