import { commercialPlaybooks } from "../src/revenue/playbooks";

const programs = [
  ["Direct Customer Acquisition", "ZA · UK", "Self-service or qualified live demo"],
  ["Local Network Operator Recruitment", "ZA · UK", "Opportunity enquiry / application"],
];

const territoryLabels = { ZA: "South Africa", GB: "United Kingdom" } as const;
const motionLabels = { direct: "Direct", lno: "LNO" } as const;

function readinessClass(value: string) {
  return value.toLowerCase().replaceAll("_", "-");
}

export default function Home() {
  return <main className="shell">
    <header><span className="eyebrow">REVENUE COMMAND CENTRE · FOUNDATION</span><div className="status"><i /> Foundation ready</div></header>
    <section className="hero"><p className="kicker">AI REVENUE ENGINE</p><h1>One revenue system.<br /><em>Many products.</em></h1><p className="lede">A product-agnostic foundation for market intelligence, commercial programs, and human-led conversion.</p></section>
    <section className="context"><div><span className="label">ACTIVE PRODUCT</span><strong>Event Suite</strong><small>Product #1 · Phase 1</small></div><div><span className="label">ARCHITECTURE</span><strong>Multi-product platform</strong><small>Allxs and Prestige ID ready to add later</small></div><div><span className="label">DATABASE</span><strong>Supabase</strong><small>eu-west-2 · RLS fail-closed</small></div></section>
    <section className="programs"><div className="section-heading"><span className="label">COMMERCIAL PROGRAMS</span><span className="muted">Event Suite · initial scope</span></div>{programs.map(([name, territory, route]) => <article className="program" key={name}><div className="dot" /><div><h2>{name}</h2><p>{territory} <span>•</span> {route}</p></div><span className="arrow">↗</span></article>)}</section>
    <section className="playbook-section"><div className="section-heading"><span className="label">PLAYBOOKS / READINESS</span><span className="muted">Loaded deterministically · outreach disabled</span></div><div className="playbook-grid">{commercialPlaybooks.map((playbook) => <article className="playbook-card" key={playbook.id}><div className="card-top"><span className="pill">{motionLabels[playbook.salesMotion as keyof typeof motionLabels]}</span><span className="muted">{playbook.version}</span></div><h2>{territoryLabels[playbook.territory as keyof typeof territoryLabels]}</h2><p className="card-route">{playbook.conversionGoals.map((goal) => goal.replaceAll("_", " ")).join(" · ")}</p><p className="card-meta">{playbook.pricingGuidance.currency} · {playbook.pricingGuidance.pricingVersion} · VAT {playbook.pricingGuidance.vat === "EXCLUSIVE" ? "excl." : "incl."}</p><div className="readiness-grid"><div><span className="label">PLAYBOOK</span><strong className={readinessClass(playbook.readiness.playbook)}>{playbook.readiness.playbook}</strong></div><div><span className="label">PRICING</span><strong className={readinessClass(playbook.readiness.pricing)}>{playbook.readiness.pricing}</strong></div><div><span className="label">ICP PRIORITY</span><strong className={readinessClass(playbook.readiness.icpPriority)}>{playbook.readiness.icpPriority}</strong></div><div><span className="label">EVIDENCE</span><strong className={readinessClass(playbook.readiness.differentiationEvidence)}>{playbook.readiness.differentiationEvidence}</strong></div></div><footer className="card-footer"><span>OUTREACH READY</span><span className="no">{playbook.readiness.outreachReady}</span></footer></article>)}</div></section>
    <footer><span>DESIGNED FOR HUMAN-LED REVENUE</span><span>v0.1 FOUNDATION</span></footer>
  </main>;
}
