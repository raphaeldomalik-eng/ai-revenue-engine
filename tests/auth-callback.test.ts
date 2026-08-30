import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveAuthCallbackInput } from "../src/lib/auth/callback.ts";
import { resolveApplicationOrigin } from "../src/lib/auth/otp.ts";

test("callback input supports both PKCE codes and Supabase email token hashes", () => {
  assert.deepEqual(
    resolveAuthCallbackInput(new URL("http://localhost:3000/auth/callback?code=pkce-code")),
    { kind: "code", code: "pkce-code" },
  );
  assert.deepEqual(
    resolveAuthCallbackInput(new URL("http://localhost:3000/auth/callback?token_hash=one-time-hash&type=email")),
    { kind: "token_hash", tokenHash: "one-time-hash" },
  );
  assert.deepEqual(
    resolveAuthCallbackInput(new URL("http://localhost:3000/auth/callback")),
    { kind: "invalid", reason: "missing_code" },
  );
});

test("passwordless redirect origin is canonicalized to one local origin", () => {
  assert.equal(
    resolveApplicationOrigin("http://localhost:3000/login", { siteUrl: "http://localhost:3000/" }),
    "http://localhost:3000",
  );
  assert.equal(
    resolveApplicationOrigin("http://localhost:3000/login", {}),
    "http://localhost:3000",
  );
});

test("server auth callback writes session cookies to the returned response", async () => {
  const serverClient = await readFile(new URL("../src/lib/supabase-server.ts", import.meta.url), "utf8");
  const callbackRoute = await readFile(new URL("../app/auth/callback/route.ts", import.meta.url), "utf8");

  assert.match(serverClient, /response\?\.cookies\.set\(name, value, options\)/);
  assert.match(serverClient, /cookieStore\.getAll\(\)/);
  assert.match(callbackRoute, /const response = NextResponse\.redirect/);
  assert.match(callbackRoute, /createServerSupabaseClient\(response\)/);
  assert.match(callbackRoute, /return response/);
  assert.doesNotMatch(callbackRoute, /console\.(log|error|warn)/);
  assert.doesNotMatch(serverClient, /console\.(log|error|warn)/);
});
