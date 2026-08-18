"use client";

import { FormEvent, useState } from "react";
import { passwordlessSignInOptions } from "../../src/lib/auth/otp";
import { createBrowserSupabaseClient } from "../../src/lib/supabase";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase.auth.signInWithOtp({ email, options: passwordlessSignInOptions(window.location.origin) });
    setMessage(error ? error.message : "If this address is already provisioned, a secure sign-in link has been sent.");
  }

  return <form className="auth-form" onSubmit={submit}>
    <label htmlFor="email">Internal email</label>
    <input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
    <button type="submit">Send sign-in link</button>
    <p>Only pre-provisioned internal Revenue Engine users can sign in.</p>
    {message ? <p role="status">{message}</p> : null}
  </form>;
}
