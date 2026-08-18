"use client";

import { useEffect, useState } from "react";
import { canMutateCommercialData, revenueAccessState, type RevenueAccessState } from "../../src/lib/auth/access";
import { createBrowserSupabaseClient } from "../../src/lib/supabase";

export default function InternalPage() {
  const [access, setAccess] = useState<RevenueAccessState>("ANON");
  const [message, setMessage] = useState("Checking internal access…");

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    supabase.auth.getUser().then(async ({ data, error }) => {
      if (error || !data.user) { setMessage("Sign-in required."); return; }
      const { data: member } = await supabase.from("revenue_members").select("member_role, active").eq("user_id", data.user.id).maybeSingle();
      const nextAccess = revenueAccessState(member, true);
      setAccess(nextAccess);
      setMessage(nextAccess === "NON_MEMBER" ? "Authenticated, but not authorised as an active internal Revenue Member." : `Internal access: ${nextAccess}.`);
    });
  }, []);

  async function signOut() {
    await createBrowserSupabaseClient().auth.signOut();
    window.location.replace("/login");
  }

  return <main className="auth-shell"><span className="eyebrow">AI REVENUE ENGINE · INTERNAL ACCESS</span><h1>Persistence readiness</h1><p>{message}</p><p>Commercial data writes are {canMutateCommercialData(access) ? "permitted by role, subject to RLS." : "not permitted for this access state."}</p><p>This page does not create prospect data. Production migration activation and first-member provisioning remain separate administrative steps.</p><button type="button" onClick={signOut}>Sign out</button></main>;
}
