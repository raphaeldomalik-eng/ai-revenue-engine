"use client";

import { useState } from "react";
import { canMutateCommercialData, type RevenueAccessState } from "../src/lib/auth/access";

type Message = { id: string; sequence_id: string; sequence_number: number; recipient_email: string | null; subject: string; body: string; rationale: string; evidence_references: string[]; status: string; scheduled_for: string | null; provider_message_id: string | null; failure_reason: string | null };
type Sequence = { id: string; status: string; overall_strategy: string; contact_id: string | null; stop_reason: string | null };

export function AiOutreachPanel({ accountId, briefId, access }: { accountId: string; briefId: string; access: RevenueAccessState }) {
  const [sequence, setSequence] = useState<Sequence | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [recipientKnown, setRecipientKnown] = useState<boolean | null>(null);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [message, setMessage] = useState("Outreach has not been prepared.");
  const [busy, setBusy] = useState(false);
  const canEdit = canMutateCommercialData(access);

  async function load() {
    const response = await fetch(`/api/ai-sales/outreach?accountId=${encodeURIComponent(accountId)}`);
    if (!response.ok) return;
    const value = await response.json() as { sequences: Sequence[]; messages: Message[] };
    const current = value.sequences.find((item) => item.status === "ACTIVE") ?? value.sequences[0] ?? null;
    setSequence(current); setMessages(current ? value.messages.filter((item) => item.sequence_id === current.id) : []);
    setRecipientKnown(current ? value.messages.some((item) => item.sequence_id === current.id && Boolean(item.recipient_email)) : null);
  }
  async function act(action: string, extra: Record<string, string> = {}) {
    setBusy(true);
    try {
      const response = await fetch("/api/ai-sales/outreach", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, accountId, briefId, ...extra }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.message || "Outreach action failed.");
      if (action === "prepare") setMessage("AI outreach prepared for human review.");
      else if (action === "send") setMessage("Approved message submitted to the provider.");
      else setMessage("Outreach state saved.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Outreach action failed."); } finally { setBusy(false); }
  }
  return <section className="intelligence-detail outreach-panel" aria-label="AI Outreach">
    <div className="section-heading"><span className="label">AI OUTREACH</span><span className="muted">Human approval required for every send</span></div>
    {!sequence ? <><p className="card-meta">Prepare a bounded initial message plus up to two follow-ups from this AI Sales Brief.</p><label>Known or owner-approved recipient email<input value={recipientEmail} disabled={!canEdit || busy} onChange={(event) => setRecipientEmail(event.target.value)} placeholder="Optional — never inferred" /></label><div className="header-actions"><button type="button" className="save-button" disabled={!canEdit || busy} onClick={() => void act("prepare", { recipientEmail })}>Prepare outreach</button><button type="button" disabled={busy} onClick={() => void load()}>Load saved outreach</button></div></> : <>
      <p className="card-meta"><strong>SEQUENCE STATUS · {sequence.status}</strong>{sequence.stop_reason ? ` · ${sequence.stop_reason}` : ""}</p>
      <p>{sequence.overall_strategy}</p>
      <p className="card-meta">{recipientKnown ? "Known contact recipient available." : "Email address not known — outreach prepared but cannot be sent."}</p>
      {messages.map((item) => <article className="outreach-message" key={item.id}>
        <div className="card-top"><span className="pill">{item.sequence_number === 0 ? "MESSAGE 1" : `FOLLOW-UP ${item.sequence_number}`}</span><span className="muted">{item.status}</span></div>
        <label>Subject<input defaultValue={item.subject} disabled={!canEdit || item.status === "SENT" || busy} id={`subject-${item.id}`} /></label>
        <label>Body<textarea defaultValue={item.body} disabled={!canEdit || item.status === "SENT" || busy} id={`body-${item.id}`} rows={6} /></label>
        <p className="card-meta"><strong>Why the AI wrote this:</strong> {item.rationale}</p>
        <p className="card-meta"><strong>Evidence:</strong> {item.evidence_references?.length ? item.evidence_references.join(" · ") : "No source reference returned."}</p>
        {item.scheduled_for ? <p className="card-meta">Proposed time: {new Date(item.scheduled_for).toLocaleString()}</p> : null}
        {item.provider_message_id ? <p className="card-meta">Provider accepted this message.</p> : null}
        {item.failure_reason ? <p role="alert">{item.failure_reason}</p> : null}
        {item.status !== "SENT" && canEdit ? <div className="header-actions">
          <button type="button" onClick={() => void act("edit", { messageId: item.id, subject: (document.getElementById(`subject-${item.id}`) as HTMLInputElement).value, messageBody: (document.getElementById(`body-${item.id}`) as HTMLTextAreaElement).value })}>Save edit</button>
          {item.status === "NEEDS_APPROVAL" ? <button type="button" data-message-id={item.id} onClick={() => void act("approve", { messageId: item.id })}>Approve</button> : null}
          {item.status === "APPROVED" ? <button type="button" data-message-id={item.id} onClick={() => void act("send", { messageId: item.id })}>Send approved email</button> : null}
        </div> : null}
      </article>)}
      {canEdit && sequence.status === "ACTIVE" ? <div className="header-actions"><button type="button" onClick={() => void act("cancel", { sequenceId: sequence.id, reason: "MANUAL_STOP" })}>Cancel sequence</button><button type="button" onClick={() => void act("suppress", { reason: "MANUAL_STOP" })}>Suppress further sends</button></div> : null}
    </>}
    <p role="status">{message}</p>
  </section>;
}
