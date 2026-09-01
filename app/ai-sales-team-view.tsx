"use client";

import { useEffect, useState } from "react";
import type { AiSalesBrief } from "../src/ai-sales-team/model";
import { operatorSourceUrl } from "../src/operator-ui/logic";
import { canMutateCommercialData, type RevenueAccessState } from "../src/lib/auth/access";
import { AiOutreachComposerLaunchPanel } from "./ai-outreach-composer-launch-panel";

export function AiSalesTeamView({ access }: { access: RevenueAccessState }) {
  const [companyName, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [briefs, setBriefs] = useState<AiSalesBrief[]>([]);
  const [message, setMessage] = useState("Loading saved AI Sales Briefs…");
  const [busy, setBusy] = useState(false);
  const canEdit = canMutateCommercialData(access);

  useEffect(() => {
    fetch("/api/ai-sales/research").then(async (response) => {
      const value = await response.json();
      if (!response.ok) throw new Error(value.message);
      setBriefs(value.briefs ?? []);
      setMessage(value.briefs?.length ? "Saved briefs loaded." : "No AI Sales Briefs yet.");
    }).catch((error) => setMessage(error instanceof Error ? error.message : "Saved briefs could not be loaded."));
  }, []);

  async function research() {
    if (!companyName.trim() || !canEdit) return;
    setBusy(true);
    setMessage("Researching event activity and building the prospect decision…");
    try {
      const response = await fetch("/api/ai-sales/research", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyName, website }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.message);
      setBriefs((current) => [value.brief, ...current]);
      setCompanyName("");
      setWebsite("");
      setMessage("Prospect Intelligence decision saved to the Revenue Engine memory.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Research failed.");
    } finally { setBusy(false); }
  }

  return <section className="lead-intelligence-section" aria-label="AI Sales Team">
    <div className="section-heading"><span className="label">AI SALES TEAM · DIRECT PROSPECT INTELLIGENCE V1</span><span className="muted">Event-first research · human review · controlled outreach</span></div>
    <article className="intelligence-card">
      <div className="lead-form-grid"><label>Prospect or company name<input value={companyName} disabled={!canEdit || busy} onChange={(event) => setCompanyName(event.target.value)} placeholder="e.g. Company name" /></label><label>Website or domain<input value={website} disabled={!canEdit || busy} onChange={(event) => setWebsite(event.target.value)} placeholder="Optional public website" /></label></div>
      <p className="card-meta">Research starts with actual event activity. Shared topics, industry relevance or organisation size do not qualify an EventSuite opportunity.</p>
      <p role="status">{message}</p>
      <button className="save-button" type="button" disabled={!canEdit || busy || !companyName.trim()} onClick={() => void research()}>{busy ? "Researching…" : "Research prospect"}</button>
      {!canEdit ? <p className="card-meta">Viewer access is read-only.</p> : null}
    </article>
    {briefs.map((brief: any, index) => {
      const prospect = brief.eventsuite_opportunity?.prospectIntelligence;
      const action = prospect?.nextBestCommercialAction;
      return <article className="intelligence-card" key={`${brief.account_id}-${brief.created_at}-${index}`}>
        <div className="card-top"><span className="pill">AI SALES BRIEF</span><span className="muted">{brief.territory?.code ?? "UNKNOWN"} · {brief.qualification?.fit ?? "UNKNOWN"} FIT</span></div>
        <h2>{brief.company_summary}</h2><p>{brief.why_it_matters}</p>
        <div className="intelligence-grid">
          <div><span className="label">EVENT CONNECTION</span><strong>{prospect?.eventConnection?.state ?? "REVIEW_REQUIRED"} · {prospect?.eventConnection?.reasons?.[0] ?? "Event relevance not yet established."}</strong></div>
          <div><span className="label">PRIMARY OPPORTUNITY</span><strong>{prospect?.primaryEntryOpportunity ?? "UNKNOWN"} · {prospect?.outreachEligibility ?? "REVIEW_REQUIRED"}</strong></div>
          <div><span className="label">EGS / TICKETING / ECC</span><strong>{prospect ? `${prospect.egs.opportunityStrength} · ${prospect.ticketing.opportunityStrength} · ${prospect.ecc.opportunityStrength}` : "Not assessed"}</strong></div>
          <div><span className="label">BUYER / PROBLEM OWNER</span><strong>{prospect?.buyerProblemOwner?.likelyRoles?.join(" · ") ?? "Unknown — review required"}</strong></div>
          <div><span className="label">NEXT BEST COMMERCIAL ACTION</span><strong>{action ? `${action.type} · ${action.ctaLabel}` : "Review required"}</strong></div>
          <div><span className="label">PRODUCT DESTINATION</span><strong>{action?.productDestinationUrl ? "Explore EventSuite" : "Review required"}</strong></div>
        </div>
        {prospect?.eventConnection?.evidence?.length ? <div className="intelligence-detail"><span className="label">WHY IT IS EVENT-RELEVANT</span>{prospect.eventConnection.evidence.map((item: string, evidenceIndex: number) => <p key={`event-${evidenceIndex}`}>FACT · {item}</p>)}</div> : null}
        <div className="intelligence-detail"><span className="label">PEOPLE / CONTACTS</span><p>{(brief.people ?? []).length ? brief.people.map((person: any) => `${person.name}${person.role ? ` · ${person.role}` : ""} · ${person.kind}`).join(" · ") : "No people identified from public evidence."}</p><span className="label">PAINS / USE CASES / SIGNALS</span><p>{[...(brief.pains ?? []), ...(brief.use_cases ?? []), ...(brief.signals ?? [])].join(" · ") || "Unknown / needs validation."}</p><span className="label">ACCOUNT STRATEGY</span><p>{brief.account_strategy?.positioning || "Unknown"} {brief.account_strategy?.approach || ""}</p></div>
        <div className="intelligence-detail"><span className="label">FACT EVIDENCE / SOURCES</span>{(brief.facts ?? []).length ? brief.facts.map((fact: any, factIndex: number) => { const sourceUrl = operatorSourceUrl(fact.sourceUrl); return <p key={`fact-${factIndex}`}>FACT · {fact.claim} {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer">{fact.sourceTitle || sourceUrl}</a> : "· source unknown"} · {fact.confidence}</p>; }) : <p>None returned.</p>}<span className="label">INFERENCE EVIDENCE</span>{(brief.inferences ?? []).length ? brief.inferences.map((item: any, itemIndex: number) => <p key={`inference-${itemIndex}`}>INFERENCE · {item.claim} · {item.confidence}</p>) : <p>None returned; no inference was invented.</p>}</div>
        {action ? <><p className="card-meta">NEXT BEST COMMERCIAL ACTION · {action.rationale} {action.targetUrlIfVerified ? <a href={action.targetUrlIfVerified} target="_blank" rel="noreferrer">Primary route</a> : null} · Call now: {action.callRecommended ? "Yes" : "No"}</p>{action.productDestinationUrl ? <p className="card-meta">PRODUCT DESTINATION · <a href={action.productDestinationUrl} target="_blank" rel="noreferrer">Explore EventSuite</a></p> : <p className="card-meta">PRODUCT DESTINATION · Re-research this saved brief to apply the current cold-prospect routing policy.</p>}{action.resourceOffer ? <p className="card-meta">FREE RESOURCE OFFER · <a href={action.resourceOffer.canonicalUrl} target="_blank" rel="noreferrer">{action.resourceOffer.title}</a> · {action.resourceOffer.resourceType} · {action.resourceOffer.relevanceReason}</p> : <p className="card-meta">FREE RESOURCE OFFER · Re-research this saved brief to select a current verified resource.</p>}</> : null}
        {prospect?.outreachBlockOrReviewReason ? <p className="card-meta">OUTREACH · {prospect.outreachBlockOrReviewReason}</p> : null}
        {(brief.unknowns ?? []).length ? <p className="card-meta">UNKNOWNS / NEEDS VALIDATION · {brief.unknowns.join(" · ")}</p> : <p className="card-meta">No additional unknowns returned.</p>}
        <p className="card-meta">NEXT ACTION · {prospect?.recommendedNextAction ?? brief.next_best_action?.action ?? "Human review required."}</p>
        <AiOutreachComposerLaunchPanel accountId={brief.account_id} briefId={brief.id} access={access} />
      </article>;
    })}
  </section>;
}
