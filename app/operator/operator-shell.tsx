"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const items = [
  ["/operator", "AI Sales Team"],
  ["/operator/runs", "Runs"],
  ["/operator/prospects", "Prospects"],
  ["/operator/review", "Needs Review"],
  ["/operator/historical", "Historical / Calibration"],
  ["/operator/outreach", "Outreach Drafts"],
] as const;

export function OperatorShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<"checking" | "ready" | "denied">("checking");
  useEffect(() => {
    fetch("/api/operator?view=meta").then((response) => setState(response.ok ? "ready" : "denied")).catch(() => setState("denied"));
  }, []);
  if (state === "checking") return <main className="operator-auth-state"><span className="operator-kicker">AI REVENUE ENGINE · OPERATOR</span><p>Loading the AI Sales Team workspace…</p></main>;
  if (state === "denied") return <main className="operator-auth-state"><span className="operator-kicker">AI REVENUE ENGINE · OPERATOR</span><h1>Internal access required</h1><p>Sign in with an approved Revenue Engine account to inspect runs and prospect evidence.</p><Link className="operator-button" href="/">Return to sign in</Link></main>;
  return <div className="operator-app">
    <aside className="operator-sidebar">
      <Link href="/operator" className="operator-brand"><span className="brand-mark">RE</span><span><strong>AI Revenue Engine</strong><small>Operator workspace</small></span></Link>
      <nav aria-label="Primary navigation" className="operator-nav">{items.map(([href, label]) => {
        const active = href === "/operator" ? pathname === href : pathname.startsWith(href);
        return <Link className={active ? "operator-nav-link active" : "operator-nav-link"} href={href} key={href} aria-current={active ? "page" : undefined}><span className="nav-marker" />{label}</Link>;
      })}</nav>
      <div className="operator-sidebar-note"><span className="operator-label">SUPERVISED PILOT</span><p>Review evidence and decide the next action.</p></div>
    </aside>
    <main className="operator-main">{children}</main>
  </div>;
}
