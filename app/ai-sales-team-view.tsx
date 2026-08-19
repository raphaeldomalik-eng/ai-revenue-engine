"use client";

import { useEffect, useState } from "react";
import type { AiSalesBrief } from "../src/ai-sales-team/model";
import { canMutateCommercialData, type RevenueAccessState } from "../src/lib/auth/access";

export function AiSalesTeamView({ access }: { access: RevenueAccessState }) {
  const [companyName, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [briefs, setBriefs] = useState<AiSalesBrief[]>([]);
  const [message, setMessage] = useState("Loading saved AI Sales Briefs…");
  const [busy, setBusy] = useState(false);
  const canEdit = canMutateCommercialData(access);
  useEffect(() => { fetch("/api/ai-sales/research").then(async (response) => { const value = await response.json(); if (!response.ok) throw new Error(value.message); setBriefs(value.briefs ?? []); setMessage(value.briefs?.length ? "Saved briefs loaded." : "No AI Sales Briefs yet."); }).catch((error) => setMessage(error instanceof Error ? error.message : "Saved briefs could not be loaded.")); }, []);
  async function research() {
    if (!companyName.trim() || !canEdit) return;
    setBusy(true); setMessage("Researching public sources and building the brief…");
    try { const response = await fetch("/api/ai-sales/research", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyName, website }) }); const value = await response.json(); if (!response.ok) throw new Error(value.message); setBriefs((current) => [value.brief, ...current]); setCompanyName(""); setWebsite(""); setMessage("AI Sales Brief saved to the Revenue Engine memory."); } catch (error) { setMessage(error instanceof Error ? error.message : "Research failed."); } finally { setBusy(false); }
  }
  return <section className="lead-intelligence-section" aria-label="AI Sales Team"><div className="section-heading"><span className="label">AI SALES TEAM · MVP V1</span><span className="muted">Public research · human review · outreach disabled</span></div><article className="intelligence-card"><div className="lead-form-grid"><label>Prospect or company name<input value={companyName} disabled={!canEdit || busy} onChange={(event) => setCompanyName(event.target.value)} placeholder="e.g. Company name" /></label><label>Website or domain<input value={website} disabled={!canEdit || busy} onChange={(event) => setWebsite(event.target.value)} placeholder="Optional public website" /></label></div><p className="card-meta">Research uses only configured provider credentials and public sources. Unknowns remain unknown.</p><p role="status">{message}</p><button className="save-button" type="button" disabled={!canEdit || busy || !companyName.trim()} onClick={() => void research()}>{busy ? "Researching…" : "Research prospect"}</button>{!canEdit ? <p className="card-meta">Viewer access is read-only.</p> : null}</article>{briefs.map((brief: any, index) => <article className="intelligence-card" key={`${brief.account_id}-${brief.created_at}-${index}`}><div className="card-top"><span className="pill">AI SALES BRIEF</span><span className="muted">{brief.territory?.code ?? "UNKNOWN"} · {brief.qualification?.fit ?? "UNKNOWN"} FIT</span></div><h2>{brief.company_summary}</h2><p>{brief.why_it_matters}</p><div className="intelligence-grid"><div><span className="label">QUALIFICATION</span><strong>{brief.qualification?.rationale ?? "Unknown"}</strong></div><div><span className="label">EVENTSUITE</span><strong>{brief.eventsuite_opportunity?.salesMotion ?? "UNKNOWN"} · {brief.eventsuite_opportunity?.conversionRoute ?? "UNDETERMINED"}</strong></div><div><span className="label">NEXT BEST ACTION</span><strong>{brief.next_best_action?.action ?? "Unknown"}</strong></div><div><span className="label">EVIDENCE</span><strong>{(brief.facts ?? []).length} FACT · {(brief.inferences ?? []).length} INFERENCE</strong></div></div><p className="card-meta">{brief.next_best_action?.reason ?? "Human review required."}</p>{(brief.unknowns ?? []).length ? <p className="card-meta">UNKNOWNS · {brief.unknowns.join(" · ")}</p> : null}</article>)}</section>;
}
