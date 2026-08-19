"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { assessLeadIntelligence } from "../src/lead-intelligence/assessment";
import type { AccountProfile, ContactProfile, LeadIntelligenceAssessment, ResearchEvidence } from "../src/lead-intelligence/model";
import { canMutateCommercialData, type RevenueAccessState } from "../src/lib/auth/access";
import { createBrowserSupabaseClient } from "../src/lib/supabase";
import { RevenueRepository } from "../src/persistence/revenue-repository";

type Draft = { accountId?: string; profile: AccountProfile; contact: ContactProfile; evidence: ResearchEvidence; opportunityId?: string; activityId?: string; nextAction: string };
const emptyDraft = (): Draft => ({ profile: { organisationName: "", sourceEvidenceIds: [], country: "South Africa", organisationType: "SCHOOL", eventActivity: "RUNS_EVENTS", eventFrequency: "UNKNOWN" }, contact: { name: "", roleTitle: "", email: "", evidenceIds: [], verificationState: "UNKNOWN" }, evidence: { id: `draft-${crypto.randomUUID()}`, sourceType: "OWNER_INPUT", sourceReference: "owner-input", title: "Internal observation", observedFact: "", observedAt: new Date().toISOString().slice(0, 10), confidence: "HIGH", kind: "FACT" }, nextAction: "" });
function text(value: unknown) { return typeof value === "string" ? value : ""; }
function metadata(row: { metadata?: unknown }) { return row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {}; }
function countryName(value: string | null) { return value === "za" ? "South Africa" : value === "uk" ? "United Kingdom" : value ?? ""; }

function accountFromRow(row: any): AccountProfile {
  const meta = metadata(row);
  return { id: row.id, organisationName: text(row.name), website: row.website ?? undefined, country: countryName(row.country_code), region: row.region ?? undefined, organisationType: row.organisation_type ?? "UNKNOWN", eventActivity: (meta.eventActivity as AccountProfile["eventActivity"]) ?? "UNKNOWN", eventFrequency: (meta.eventFrequency as AccountProfile["eventFrequency"]) ?? "UNKNOWN", estimatedEventsPerYear: typeof meta.estimatedEventsPerYear === "number" ? meta.estimatedEventsPerYear : undefined, currentSystems: meta.currentSystems as AccountProfile["currentSystems"], operationalNeeds: Array.isArray(meta.operationalNeeds) ? meta.operationalNeeds as string[] : [], localNetworkSignal: typeof meta.localNetworkSignal === "boolean" ? meta.localNetworkSignal : undefined, customerServicingCapability: typeof meta.customerServicingCapability === "boolean" ? meta.customerServicingCapability : undefined, sourceEvidenceIds: Array.isArray(meta.sourceEvidenceIds) ? meta.sourceEvidenceIds as string[] : [] };
}
function evidenceFromRow(row: any): ResearchEvidence { return { id: row.id, sourceType: row.evidence_type ?? "OTHER", sourceReference: row.source_reference ?? row.source_url ?? "", title: row.source_title ?? "Saved evidence", observedFact: row.claim ?? "", observedAt: text(row.observed_at).slice(0, 10), confidence: row.qualitative_confidence ?? "NONE", kind: row.evidence_kind ?? "FACT", notes: row.notes ?? undefined }; }
function contactFromRow(row: any): ContactProfile { const meta = metadata(row); return { id: row.id, accountId: row.account_id, name: row.full_name ?? "", roleTitle: row.role_title ?? "", email: row.email ?? "", phone: row.phone ?? "", likelyDecisionRole: row.decision_role ?? "", seniority: row.seniority ?? "", evidenceIds: Array.isArray(meta.evidenceIds) ? meta.evidenceIds : [], verificationState: row.verification_status ?? "UNKNOWN" }; }

export function LeadIntelligenceView({ access }: { access: RevenueAccessState }) {
  const canEdit = canMutateCommercialData(access);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [assessment, setAssessment] = useState<LeadIntelligenceAssessment | null>(null);
  const [message, setMessage] = useState("Loading saved prospects…");
  const [saving, setSaving] = useState(false);
  const repository = useMemo(() => new RevenueRepository(createBrowserSupabaseClient()), []);
  const loadGeneration = useRef(0);

  async function loadAccount(accountId?: string, sourceAccounts = accounts) {
    const generation = ++loadGeneration.current;
    const row = sourceAccounts.find((item) => item.id === accountId) ?? sourceAccounts[0];
    if (!row) { setDraft(emptyDraft()); setAssessment(null); setSelectedId(null); setMessage("No saved prospects yet. Create the first internal lead below."); return; }
    const [contacts, evidence, opportunities, activities] = await Promise.all([repository.listContacts(row.id), repository.listResearchEvidence(row.id), repository.listProductOpportunities(row.id), repository.listActivities(row.id)]);
    if (generation !== loadGeneration.current) return;
    const profile = accountFromRow(row); const savedEvidence = evidence.map(evidenceFromRow); const savedContact = contacts[0] ? contactFromRow(contacts[0]) : emptyDraft().contact; const opportunity = opportunities[0];
    const nextDraft = { accountId: row.id, profile: { ...profile, sourceEvidenceIds: savedEvidence.map((item) => item.id) }, contact: savedContact, evidence: savedEvidence[0] ?? emptyDraft().evidence, opportunityId: opportunity?.id, activityId: activities[0]?.id, nextAction: text(opportunity?.next_action) || text(activities[0]?.summary) };
    setSelectedId(row.id); setDraft(nextDraft); setAssessment(savedEvidence.length ? assessLeadIntelligence({ account: nextDraft.profile, evidence: savedEvidence, contacts }) : null); setMessage(opportunity ? "Saved opportunity loaded." : "Saved prospect loaded.");
  }

  useEffect(() => { repository.listAccounts().then((rows) => { setAccounts(rows); if (rows[0]) void loadAccount(rows[0].id, rows); else setMessage("No saved prospects yet. Create the first internal lead below."); }).catch((error) => setMessage(error.message)); }, [repository]);
  function updateProfile(field: keyof AccountProfile, value: string) { setDraft((current) => ({ ...current, profile: { ...current.profile, [field]: value } })); }
  function updateContact(field: keyof ContactProfile, value: string) { setDraft((current) => ({ ...current, contact: { ...current.contact, [field]: value } })); }
  function updateEvidence(field: keyof ResearchEvidence, value: string) { setDraft((current) => ({ ...current, evidence: { ...current.evidence, [field]: value } as ResearchEvidence })); }

  async function save() {
    if (!canEdit) return;
    setSaving(true); setMessage("Saving prospect…");
    try {
      const evidence = { ...draft.evidence }; const profile = { ...draft.profile, sourceEvidenceIds: [evidence.id] }; const accountId = await repository.saveAccount(profile, draft.accountId);
      const evidenceId = await repository.saveResearchEvidence(accountId, evidence, evidence.id.startsWith("draft-") ? undefined : evidence.id); const savedProfile = { ...profile, id: accountId, sourceEvidenceIds: [evidenceId] }; await repository.saveAccount(savedProfile, accountId);
      const contactId = draft.contact.name?.trim() ? await repository.saveContact(accountId, { ...draft.contact, accountId }, draft.contact.id?.startsWith("draft-") ? undefined : draft.contact.id) : undefined;
      const savedEvidence = [{ ...evidence, id: evidenceId }]; const nextAssessment = assessLeadIntelligence({ account: savedProfile, evidence: savedEvidence, contacts: contactId ? [{ ...draft.contact, id: contactId, accountId }] : [] }); const recommendation = nextAssessment.recommendations[0];
      const opportunityId = recommendation ? await repository.saveProductOpportunity(accountId, recommendation, draft.opportunityId) : draft.opportunityId; if (opportunityId) await repository.saveResearchEvidence(accountId, { ...evidence, id: evidenceId }, evidenceId, opportunityId); const activityId = draft.nextAction.trim() ? await repository.saveActivity({ accountId, contactId, opportunityId, activityType: "NEXT_ACTION", summary: draft.nextAction }, draft.activityId) : draft.activityId;
      const nextAccounts = await repository.listAccounts(); setAccounts(nextAccounts); setSelectedId(accountId); setDraft({ ...draft, accountId, profile: savedProfile, evidence: savedEvidence[0], contact: contactId ? { ...draft.contact, id: contactId, accountId } : draft.contact, opportunityId, activityId }); setAssessment(nextAssessment); setMessage(recommendation ? "Saved. This prospect, evidence, opportunity, and next action survive refresh and re-login." : "Saved prospect and evidence. Opportunity remains deferred until territory and route are genuinely known.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The prospect could not be saved."); } finally { setSaving(false); }
  }

  const displayAssessment = assessment ?? (draft.evidence.observedFact ? assessLeadIntelligence({ account: draft.profile, evidence: [draft.evidence] }) : null);
  return <section className="lead-intelligence-section">
    <div className="section-heading"><span className="label">LEAD INTELLIGENCE</span><span className="muted">Persistent EventSuite prospects · {canEdit ? "editing enabled" : "viewer mode"}</span></div>
    <div className="lead-intelligence-layout">
      <nav className="scenario-list" aria-label="Saved prospects">{accounts.map((account) => <button className={account.id === selectedId ? "scenario-button selected" : "scenario-button"} key={account.id} onClick={() => void loadAccount(account.id)}>{account.name}</button>)}<button className="scenario-button" onClick={() => { loadGeneration.current += 1; setDraft(emptyDraft()); setSelectedId(null); setAssessment(null); setMessage("New prospect ready."); }}>+ New prospect</button></nav>
      <article className="intelligence-card">
        <div className="card-top"><span className="pill">PERSISTENT WORKFLOW</span><span className="muted">{selectedId ? "Saved record" : "New record"}</span></div>
        <div className="lead-form-grid">
          <label>Organisation name<input value={draft.profile.organisationName} disabled={!canEdit} onChange={(event) => updateProfile("organisationName", event.target.value)} /></label>
          <label>Country<select value={draft.profile.country ?? ""} disabled={!canEdit} onChange={(event) => updateProfile("country", event.target.value)}><option>South Africa</option><option>United Kingdom</option><option value="">Unknown</option></select></label>
          <label>Organisation type<select value={draft.profile.organisationType ?? "UNKNOWN"} disabled={!canEdit} onChange={(event) => updateProfile("organisationType", event.target.value)}><option>SCHOOL</option><option>VENUE</option><option>EVENT_PROMOTER</option><option>EVENT_AGENCY</option><option>EVENT_SERVICES_COMPANY</option><option>UNKNOWN</option></select></label>
          <label>Event activity<select value={draft.profile.eventActivity ?? "UNKNOWN"} disabled={!canEdit} onChange={(event) => updateProfile("eventActivity", event.target.value)}><option>RUNS_EVENTS</option><option>SERVICES_EVENT_ORGANISERS</option><option>RUNS_AND_SERVICES</option><option>UNKNOWN</option></select></label>
          <label>Contact name<input value={draft.contact.name ?? ""} disabled={!canEdit} onChange={(event) => updateContact("name", event.target.value)} /></label>
          <label>Contact email<input type="email" value={draft.contact.email ?? ""} disabled={!canEdit} onChange={(event) => updateContact("email", event.target.value)} /></label>
          <label className="wide">Research observation<input value={draft.evidence.observedFact} disabled={!canEdit} onChange={(event) => updateEvidence("observedFact", event.target.value)} placeholder="Record what is known, without inventing missing facts" /></label>
          <label>Evidence kind<select value={draft.evidence.kind} disabled={!canEdit} onChange={(event) => updateEvidence("kind", event.target.value)}><option>FACT</option><option>INFERENCE</option></select></label>
          <label>Confidence<select value={draft.evidence.confidence} disabled={!canEdit} onChange={(event) => updateEvidence("confidence", event.target.value)}><option>NONE</option><option>LOW</option><option>MEDIUM</option><option>HIGH</option></select></label>
          <label className="wide">Next action<input value={draft.nextAction} disabled={!canEdit} onChange={(event) => setDraft((current) => ({ ...current, nextAction: event.target.value }))} placeholder="e.g. Confirm the operational owner" /></label>
        </div>
        {displayAssessment ? <><h2>{displayAssessment.account.organisationName || "Unnamed prospect"}</h2><p className="card-meta">EVENTSUITE · TERRITORY · {displayAssessment.territory.code} · MOTION · {displayAssessment.motionCandidate}</p><div className="intelligence-grid"><div><span className="label">CLIENT TYPE / SEGMENT</span><strong>{displayAssessment.clientSegments.map((segment) => `${segment.label}${segment.pricingStatus === "DEFERRED" ? " · SPECIAL PRICING TBD" : ""}`).join(" · ") || "UNKNOWN"}</strong></div><div><span className="label">EVIDENCE</span><strong>{draft.evidence.kind} · {draft.evidence.confidence}</strong></div><div><span className="label">OPPORTUNITY</span><strong>{displayAssessment.recommendations[0] ? `${displayAssessment.recommendations[0].salesMotion.toUpperCase()} · ${displayAssessment.recommendations[0].conversionRoute}` : "NONE RESOLVED"}</strong></div><div><span className="label">COMMERCIAL PROGRAM</span><strong>{displayAssessment.recommendations[0]?.commercialProgram ?? "NULL / DEFERRED"}</strong></div></div></> : <p className="card-meta">Add an evidence-supported observation to preview the saved assessment.</p>}
        <div className="intelligence-detail"><span className="label">STATUS</span><p role="status">{message}</p></div><button className="save-button" type="button" disabled={!canEdit || saving || !draft.profile.organisationName.trim()} onClick={() => void save()}>{saving ? "Saving…" : selectedId ? "Save changes" : "Save prospect"}</button>{!canEdit ? <p className="card-meta">Viewer access is read-only. Admin/operator RLS permissions control commercial writes.</p> : null}
      </article>
    </div>
  </section>;
}
