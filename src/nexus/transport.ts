import { createHmac, timingSafeEqual } from "node:crypto";

export const NEXUS_MAX_BODY_BYTES = 100_000;
export const NEXUS_MAX_AGE_SECONDS = 300;

export function nexusSignatureFor(timestamp: string, body: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}
export function verifyNexusSignature(actual: string | null, timestamp: string | null, body: string, secret: string, now = Date.now()): boolean {
  if (!actual || !timestamp || !Number.isInteger(Number(timestamp)) || Math.abs(now / 1000 - Number(timestamp)) > NEXUS_MAX_AGE_SECONDS) return false;
  const expected = nexusSignatureFor(timestamp, body, secret); if (actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
export function buildNexusEnvelope(payload: Record<string, unknown>, secret: string, timestamp = String(Math.floor(Date.now() / 1000))) {
  const body = JSON.stringify({ payload });
  return { body, timestamp, signature: nexusSignatureFor(timestamp, body, secret) };
}
export function parseNexusEnvelope(raw: string): Record<string, unknown> {
  if (Buffer.byteLength(raw, "utf8") > NEXUS_MAX_BODY_BYTES) throw new Error("NEXUS_PAYLOAD_TOO_LARGE");
  const parsed = JSON.parse(raw) as { payload?: unknown };
  if (!parsed.payload || typeof parsed.payload !== "object" || Array.isArray(parsed.payload)) throw new Error("NEXUS_PAYLOAD_INVALID");
  return parsed.payload as Record<string, unknown>;
}
