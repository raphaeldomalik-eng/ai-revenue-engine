"use client";

import { useEffect, useState } from "react";
import { createBrowserSupabaseClient } from "../../../src/lib/supabase";

export default function AuthCallbackPage() {
  const [message, setMessage] = useState("Completing secure sign-in…");

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    if (!code) { setMessage("The sign-in link is missing its confirmation code."); return; }
    createBrowserSupabaseClient().auth.exchangeCodeForSession(code).then(({ error }) => {
      if (error) { setMessage(error.message); return; }
      window.location.replace("/");
    });
  }, []);

  return <main className="auth-shell"><span className="eyebrow">AI REVENUE ENGINE · INTERNAL ACCESS</span><p>{message}</p></main>;
}
