export type StructuredOutputPayload = {
  status?: string;
  incomplete_details?: { reason?: string | null } | null;
  error?: { code?: string | null; message?: string | null } | null;
  refusal?: string | null;
  output_text?: string | null;
  output?: Array<{ type?: string; status?: string; content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
};

export type StructuredOutputTelemetry = {
  responseStatus: string | null;
  incompleteReason: string | null;
  refusalStatus: string | null;
  outputItemTypes: string[];
  schemaValidationError: string | null;
  truncation: boolean;
  parserPath: string;
};

export class StructuredOutputError extends Error {
  readonly telemetry: StructuredOutputTelemetry;
  constructor(message: string, telemetry: StructuredOutputTelemetry) {
    super(message);
    this.telemetry = telemetry;
    this.name = "StructuredOutputError";
  }
}

function providerError(payload: StructuredOutputPayload) {
  const error = payload.error;
  if (!error) return null;
  return [error.code, error.message].filter((item): item is string => Boolean(item?.trim())).join(": ") || "provider_error";
}

function outputText(payload: StructuredOutputPayload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return { text: payload.output_text.trim(), path: "responses.output_text" };
  const messages = (payload.output ?? []).filter((item) => item.type === "message").flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text" || item.type === "text").map((item) => item.text ?? "").filter(Boolean);
  if (messages.length) return { text: messages.join(""), path: "responses.output[].message.content[].text" };
  return { text: "", path: "none" };
}

export function structuredOutputTelemetry(payload: StructuredOutputPayload, parserPath?: string, schemaValidationError?: string | null): StructuredOutputTelemetry {
  const incompleteReason = payload.incomplete_details?.reason ?? null;
  const refusalStatus = (payload.refusal || (payload.output ?? []).flatMap((item) => item.content ?? []).map((item) => item.refusal).find(Boolean)) ?? null;
  const itemTypes = [...new Set((payload.output ?? []).map((item) => item.type).filter((item): item is string => Boolean(item)))];
  const providerFailure = providerError(payload);
  return { responseStatus: payload.status ?? null, incompleteReason, refusalStatus: refusalStatus ? "REFUSED" : null, outputItemTypes: itemTypes, schemaValidationError: schemaValidationError ?? providerFailure, truncation: incompleteReason === "max_output_tokens" || incompleteReason === "max_output_tokens_exceeded", parserPath: parserPath ?? outputText(payload).path };
}

export function parseStrictStructuredOutput<T>(payload: StructuredOutputPayload): { value: T; telemetry: StructuredOutputTelemetry } {
  const selected = outputText(payload);
  const initial = structuredOutputTelemetry(payload, selected.path);
  if (payload.error) throw new StructuredOutputError("Structured output provider error.", initial);
  if (initial.refusalStatus) throw new StructuredOutputError("Structured output was refused.", initial);
  if (initial.incompleteReason) throw new StructuredOutputError("Structured output was incomplete.", initial);
  if (!selected.text) throw new StructuredOutputError("Structured output contained no message text.", initial);
  try {
    return { value: JSON.parse(selected.text) as T, telemetry: initial };
  } catch (error) {
    const parseError = error instanceof SyntaxError ? error.message : "strict JSON parse failed";
    throw new StructuredOutputError("Structured output was not valid JSON.", { ...initial, schemaValidationError: parseError });
  }
}
