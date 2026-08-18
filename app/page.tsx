const programs = [
  ["Direct Customer Acquisition", "ZA · UK", "Self-service or qualified live demo"],
  ["Local Network Operator Recruitment", "ZA · UK", "Opportunity enquiry / application"],
];

export default function Home() {
  return <main className="shell">
    <header><span className="eyebrow">REVENUE COMMAND CENTRE · FOUNDATION</span><div className="status"><i /> Foundation ready</div></header>
    <section className="hero"><p className="kicker">AI REVENUE ENGINE</p><h1>One revenue system.<br /><em>Many products.</em></h1><p className="lede">A product-agnostic foundation for market intelligence, commercial programs, and human-led conversion.</p></section>
    <section className="context"><div><span className="label">ACTIVE PRODUCT</span><strong>Event Suite</strong><small>Product #1 · Phase 1</small></div><div><span className="label">ARCHITECTURE</span><strong>Multi-product platform</strong><small>Allxs and Prestige ID ready to add later</small></div><div><span className="label">DATABASE</span><strong>Supabase</strong><small>eu-west-2 · RLS fail-closed</small></div></section>
    <section className="programs"><div className="section-heading"><span className="label">COMMERCIAL PROGRAMS</span><span className="muted">Event Suite · initial scope</span></div>{programs.map(([name, territory, route]) => <article className="program" key={name}><div className="dot" /><div><h2>{name}</h2><p>{territory} <span>•</span> {route}</p></div><span className="arrow">↗</span></article>)}</section>
    <footer><span>DESIGNED FOR HUMAN-LED REVENUE</span><span>v0.1 FOUNDATION</span></footer>
  </main>;
}
