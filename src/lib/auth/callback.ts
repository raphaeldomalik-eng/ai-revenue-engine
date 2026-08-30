export type AuthCallbackInput =
  | { kind: "code"; code: string }
  | { kind: "token_hash"; tokenHash: string; type: "email" | "magiclink" }
  | { kind: "invalid"; reason: "missing_code" | "invalid_link" };

export function resolveAuthCallbackInput(requestUrl: URL): AuthCallbackInput {
  const code = requestUrl.searchParams.get("code");
  if (code) return { kind: "code", code };

  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type");
  if (tokenHash && (type === "email" || type === "magiclink")) return { kind: "token_hash", tokenHash, type };

  return { kind: "invalid", reason: tokenHash || type ? "invalid_link" : "missing_code" };
}
