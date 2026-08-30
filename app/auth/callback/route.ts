import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "../../../src/lib/supabase-server";
import { resolveAuthCallbackInput } from "../../../src/lib/auth/callback";

function failureRedirect(requestUrl: URL, reason: "missing_code" | "invalid_link") {
  return NextResponse.redirect(new URL(`/?authError=${reason}`, requestUrl.origin));
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const input = resolveAuthCallbackInput(requestUrl);
  if (input.kind === "invalid") return failureRedirect(requestUrl, input.reason);

  const response = NextResponse.redirect(new URL("/", requestUrl.origin));
  const supabase = await createServerSupabaseClient(response);
  const { error } = input.kind === "code"
    ? await supabase.auth.exchangeCodeForSession(input.code)
    : await supabase.auth.verifyOtp({ token_hash: input.tokenHash, type: "email" });
  if (error) {
    response.headers.set(
      "location",
      new URL("/?authError=invalid_link", requestUrl.origin).toString(),
    );
  }

  return response;
}
