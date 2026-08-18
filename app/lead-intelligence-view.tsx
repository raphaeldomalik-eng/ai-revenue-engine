"use client";

import { useState } from "react";
import { leadIntelligenceFixtures } from "../src/lead-intelligence/fixtures";

export function LeadIntelligenceView() {
  const [selectedName, setSelectedName] = useState(leadIntelligenceFixtures[0].name);
  const selected = leadIntelligenceFixtures.find((fixture) => fixture.name === selectedName) ?? leadIntelligenceFixtures[0];
  const assessment = selected.assessment;
  return <section className="lead-intelligence-section">
    <div className="section-heading"><span className="label">LEAD INTELLIGENCE</span><span className="muted">Deterministic fixtures · no persistence</span></div>
    <div className="lead-intelligence-layout">
      <nav className="scenario-list" aria-label="Lead Intelligence scenarios">
        {leadIntelligenceFixtures.map((fixture) => <button className={fixture.name === selected.name ? "scenario-button selected" : "scenario-button"} key={fixture.name} onClick={() => setSelectedName(fixture.name)}>{fixture.name}</button>)}
      </nav>
      <article className="intelligence-card">
        <div className="card-top"><span className="pill">ASSESSMENT</span><span className="muted">{assessment.account.organisationName}</span></div>
        <h2>{assessment.account.organisationName}</h2>
        <p className="card-meta">TERRITORY · {assessment.territory.code} · MOTION · {assessment.motionCandidate}</p>
        <div className="intelligence-grid">
          <div><span className="label">CLIENT TYPE / SEGMENT</span><strong>{assessment.clientSegments.map((segment) => `${segment.label}${segment.pricingStatus === "DEFERRED" ? " · SPECIAL PRICING TBD" : ""}`).join(" · ") || "UNKNOWN"}</strong></div>
          <div><span className="label">SIGNALS</span><strong>{assessment.signals.map((signal) => signal.code).join(" · ") || "UNKNOWN"}</strong></div>
          <div><span className="label">PLAYBOOKS</span><strong>{assessment.playbooks.map((playbook) => playbook.playbookLabel).join(" · ") || "NONE RESOLVED"}</strong></div>
          <div><span className="label">OPPORTUNITIES</span><strong>{assessment.recommendations.map((recommendation) => `${recommendation.product} / ${recommendation.salesMotion}`).join(" · ") || "NONE RECOMMENDED"}</strong></div>
        </div>
        <div className="intelligence-detail"><span className="label">RESEARCH GAPS</span><p>{assessment.researchGaps.map((gap) => gap.label).join(" · ") || "No current gaps recorded"}</p></div>
        <div className="intelligence-detail"><span className="label">WHY</span><p>{assessment.explanation.join(" ")}</p></div>
      </article>
    </div>
  </section>;
}
