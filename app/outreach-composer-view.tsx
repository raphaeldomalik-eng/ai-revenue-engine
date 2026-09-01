"use client";

import { useEffect, useState } from "react";
import { operatorSourceUrl } from "../src/operator-ui/logic";

type Draft = { id: string; candidate_id: string | null; account_id: string; ai_sales_brief_id: string | null; contact_id: string | null; recipient_name: string | null; recipient_role: string | null; originating_lane: string | null; status: string; evidence_snapshot: Array<{ id: string; claim: string; sourceUrl: string | null; sourceTitle: string | null }> };
type Version = { id: string; draft_id: string; sequence_number: number; revision_number: number; sequence_stage: string; source_kind: string; model_status: string; subject: string; body_plain_text: string; rendered_body: string; structured_output: { humanReviewSummary?: string; personalisationEvidenceIds?: string[]; claimEvidence?: Array<{ claim: string }> } };
type Review = { draft_version_id: string; action: string; relevance_rating: number | null; tone_rating: number | null; reason_tags: string[]; note: string | null };

const stageForReview = (version: Version) => version.sequence_stage === "REVISION" ? (["EMAIL_1", "EMAIL_2", "EMAIL_3"] as const)[version.sequence_number] : version.sequence_stage;

export function OutreachComposerView() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState("Draft-only Composer review workspace.");
  const [busy, setBusy] = useState(false);
  async function load() {
    const response = await fetch("/api/ai-sales/outreach-composer");
    if (!response.ok) { setMessage("Outreach Composer is disabled or unavailable."); return; }
    const value = await response.json() as { drafts: Draft[]; versions: Version[]; reviews: Review[] };
    setDrafts(value.drafts); setVersions(value.versions); setReviews(value.reviews);
    if (!selected && value.drafts[0]) setSelected(value.drafts[0].id);
  }
  useEffect(() => { void load(); }, []);
  async function review(version: Version, action: string, extra: Record<string, unknown> = {}) {
    if (!current?.candidate_id) { setMessage("This Composer draft is not linked to an approved prospect."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/ai-sales/outreach-composer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "review", reviewAction: action, candidateId: current.candidate_id, versionId: version.id, sequenceStage: stageForReview(version), ...extra }) });
      const value = await response.json(); if (!response.ok) throw new Error(value.message ?? "Review failed.");
      setMessage(action === "APPROVE" ? "Email approved." : action === "REJECT" ? "Not approved." : action === "EDIT" ? "Edited draft saved. It needs approval again." : `${action} recorded. Approval applies only to this message version.`); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Review failed."); } finally { setBusy(false); }
  }
  async function revise(version: Version, instruction: string) {
    if (!current || !current.candidate_id || !instruction.trim()) return;
    setBusy(true);
    try {
      const response = await fetch("/api/ai-sales/outreach-composer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "revise", candidateId: current.candidate_id, draftId: current.id, accountId: current.account_id, briefId: current.ai_sales_brief_id, contactId: current.contact_id, versionId: version.id, revisionNumber: version.revision_number, humanInstruction: instruction }) });
      const value = await response.json(); if (!response.ok) throw new Error(value.message ?? "Revision failed.");
      setMessage("Regenerated draft recorded as a new pending version."); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Revision failed."); } finally { setBusy(false); }
  }
  const current = drafts.find((draft) => draft.id === selected) ?? null;
  const currentVersions = versions.filter((version) => version.draft_id === selected);
  return <><header className="operator-page-header"><div><span className="operator-kicker">OUTREACH COMPOSER</span><h1>Drafts for human review</h1><p>Every message is isolated from sending infrastructure. Review, edit, rate or reject each message separately.</p></div></header><div className="outreach-draft-layout"><aside className="outreach-draft-list">{drafts.length ? drafts.map((draft) => <button type="button" className={draft.id === selected ? "outreach-draft-select selected" : "outreach-draft-select"} onClick={() => setSelected(draft.id)} key={draft.id}><strong>{draft.recipient_name ?? "Organisation route"}</strong><span>{draft.recipient_role ?? "Role not recorded"}</span><small>{draft.originating_lane ?? "UNKNOWN"} · {draft.status}</small></button>) : <p className="muted">No persisted Composer drafts.</p>}</aside>{current ? <main className="outreach-review-main"><div className="section-heading"><span className="operator-kicker">{current.recipient_name ?? "Organisation route"} · {current.recipient_role ?? "Role not recorded"}</span><span className="muted">{current.status} · no sending action exists here</span></div><section className="outreach-evidence"><h2>Evidence and sources</h2>{current.evidence_snapshot?.length ? current.evidence_snapshot.map((item) => { const sourceUrl = operatorSourceUrl(item.sourceUrl); return <article key={item.id}><strong>{item.id}</strong><p>{item.claim}</p>{sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer">{item.sourceTitle ?? sourceUrl} ↗</a> : null}</article>; }) : <p className="muted">No evidence snapshot recorded.</p>}</section>{currentVersions.map((version) => { const versionReviews = reviews.filter((review) => review.draft_version_id === version.id); const stage = stageForReview(version); return <article className="outreach-version" key={version.id}><div className="card-top"><span className="pill">EMAIL {version.sequence_number + 1} · REVISION {version.revision_number}</span><span className="muted">{version.source_kind} · {version.model_status}</span></div><label>Subject<input defaultValue={version.subject} disabled={busy} id={`composer-subject-${version.id}`} /></label><label>Body<textarea defaultValue={version.body_plain_text} disabled={busy} id={`composer-body-${version.id}`} rows={9} /></label><p className="card-meta"><strong>Recipient:</strong> {current.recipient_name ?? "No named recipient selected"} · {current.recipient_role ?? "Route to buyer"}</p><p className="card-meta"><strong>Complete rendered email:</strong></p><pre className="email-body-preview">{version.rendered_body}</pre><p className="card-meta"><strong>Claims and evidence:</strong> {version.structured_output?.claimEvidence?.map((item) => item.claim).join(" · ") ?? "Not recorded"}</p><div className="outreach-review-fields"><label>Relevance (1–5)<input type="number" min="1" max="5" id={`composer-relevance-${version.id}`} /></label><label>Tone (1–5)<input type="number" min="1" max="5" id={`composer-tone-${version.id}`} /></label><label>Reason tags<input placeholder="GOOD_TONE, TOO_LONG" id={`composer-tags-${version.id}`} /></label><label>Reviewer note<textarea id={`composer-note-${version.id}`} rows={2} /></label></div><div className="outreach-review-actions"><button type="button" disabled={busy} onClick={() => void review(version, "APPROVE")}>Approve email</button><button type="button" disabled={busy} onClick={() => void review(version, "REJECT", { reasonTags: ["DO_NOT_CONTACT"] })}>Reject</button><button type="button" disabled={busy} onClick={() => void review(version, "EDIT", { editedSubject: (document.getElementById(`composer-subject-${version.id}`) as HTMLInputElement).value, editedBody: (document.getElementById(`composer-body-${version.id}`) as HTMLTextAreaElement).value, reasonTags: ["MANUAL_REWRITE"] })}>Save edit for approval</button><button type="button" disabled={busy} onClick={() => void review(version, "RATE", { relevanceRating: Number((document.getElementById(`composer-relevance-${version.id}`) as HTMLInputElement).value) || undefined, toneRating: Number((document.getElementById(`composer-tone-${version.id}`) as HTMLInputElement).value) || undefined, reasonTags: (document.getElementById(`composer-tags-${version.id}`) as HTMLInputElement).value.split(",").map((tag) => tag.trim()).filter(Boolean), note: (document.getElementById(`composer-note-${version.id}`) as HTMLTextAreaElement).value })}>Save rating / feedback</button><button type="button" disabled={busy} onClick={() => void revise(version, (document.getElementById(`composer-note-${version.id}`) as HTMLTextAreaElement).value)}>Regenerate</button></div>{versionReviews.map((reviewItem, index) => <p className="card-meta" key={`${reviewItem.draft_version_id}-${index}`}>REVIEW · {reviewItem.action}{reviewItem.note ? ` · ${reviewItem.note}` : ""}</p>)}</article>; })}<p role="status">{message}</p></main> : <main className="outreach-review-main"><p className="muted">Select a draft to review. No draft or review action sends, schedules or enrols email.</p></main>}</div></>;
}
