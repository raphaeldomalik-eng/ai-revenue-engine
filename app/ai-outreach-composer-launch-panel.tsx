"use client";

import Link from "next/link";
import { useState } from "react";
import { canMutateCommercialData, type RevenueAccessState } from "../src/lib/auth/access";

export function AiOutreachComposerLaunchPanel({ accountId, briefId, access }: { accountId: string; briefId: string; access: RevenueAccessState }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Composer is draft-only and disabled by default.");
  async function prepare() {
    if (!canMutateCommercialData(access)) return;
    setBusy(true);
    try {
      const response = await fetch("/api/ai-sales/outreach-composer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "prepare", accountId, briefId, sequenceStage: "EMAIL_1" }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.message ?? "Composer is disabled or unavailable.");
      setMessage("Three draft stages were prepared for separate human review.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Composer preparation failed."); } finally { setBusy(false); }
  }
  return <section className="intelligence-detail composer-launch"><div className="section-heading"><span className="label">OUTREACH COMPOSER V1</span><span className="muted">Draft-only · no sending path</span></div><p className="card-meta">Prepare up to three evidence-grounded drafts. Each message is separately reviewed and approved in the isolated Composer workspace.</p><p role="status">{message}</p><div className="header-actions"><button type="button" className="save-button" disabled={!canMutateCommercialData(access) || busy} onClick={() => void prepare()}>{busy ? "Preparing drafts…" : "Prepare draft sequence"}</button><Link className="save-button" href="/operator/outreach">Open Composer review</Link></div></section>;
}
