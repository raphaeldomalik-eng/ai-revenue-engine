# AI Revenue Prospecting Strategy V1

> This PRD is the controlling product policy for autonomous prospect discovery, commercial qualification and prospect research in the AI Revenue Engine. Prospecting implementation must not conflict with this document.

## Status and scope

This is the canonical product policy for Direct Prospecting and ICP Intelligence V1. It describes durable product behaviour and commercial boundaries, not a particular implementation.

The AI Revenue Engine is building an AI Sales Team, not a traditional CRM. Accounts, contacts, opportunities, evidence and activities are persistent commercial memory for the AI. Humans should primarily see prospects discovered, why they matter, what the AI learned, supported commercial hypotheses, material unknowns, recommended actions, and approvals or exceptions requiring attention.

The system is not optimised to find as many events as possible. Its purpose is to find active organisations with credible EventSuite problems and build enough evidence for an AI sales team to advance them intelligently.

The canonical workflow is:

`DISCOVER → RESOLVE ORGANISATION → VALIDATE → BUILD EVENT / ACTIVITY CONTEXT → DIAGNOSE COMMERCIAL NEED → IDENTIFY BUYER ROLE → VERIFY CONTACT ROUTE → QUALIFY / REVIEW / REJECT → RECOMMEND NEXT ACTION`

### Revenue intelligence principle

The AI Revenue Engine owns commercial intelligence and sales memory. EventSuite owns tenant and product operational state. Gig Guide owns its public content and discovery graph. SendGrid owns email delivery and engagement events. Systems exchange only narrowly scoped facts and signals through explicit server-side contracts; the Revenue Engine must not receive unrestricted cross-database access.

## 1. Primary commercial entity

The primary commercial entity is normally the organisation: organiser, promoter, festival operator, conference or exhibition organiser, recurring event business, venue operating a meaningful programme, event agency, association or institution running recurring events, or community event operator.

An event is normally evidence about the organisation. Individual performances, isolated listings, ticketing pages and venue calendar entries must not automatically become Accounts. Multiple events belonging to one organiser should strengthen one commercial identity rather than create separate account silos.

Individual artists and performers are not normal V1 targets unless a future, explicit sales motion activates that segment.

EventSuite itself and authoritative EventSuite-owned first-party identities or domains are not prospects. First-party properties may be used as source, product or reference material, but must never become autonomous prospect Accounts, commercial Opportunities, contact-research targets or outreach targets. Identity is determined from authoritative first-party identity, especially the official `eventsuite.pro` domain and its appropriate subdomains; loose name or substring matching is not sufficient.

## 2. Discovery paths

The strategy supports three conceptual paths, with no fixed quota or required ratio:

- **EVENT_FIRST:** event → responsible organisation → validation → commercial diagnosis.
- **ORGANISATION_FIRST:** organisation → active event or activity portfolio → commercial diagnosis.
- **SIGNAL_FIRST:** commercial or timing signal → organisation → validation → opportunity diagnosis.

Signals may include a new event launch, expansion, additional stages or venues, vendor or volunteer recruitment, registration opening, venue launch, a new event series, programme growth, or procurement/provider-change evidence.

## 3. Target hierarchy and territories

Primary targets are organisers, promoters, festival operators, conference and exhibition organisers, recurring event businesses, venues with meaningful owned programmes, associations and institutions with substantial recurring activity.

Universities, sports operators, cultural and tourism organisations, charities, event agencies and community operators are situational targets where event evidence supports them.

Initial territories are South Africa and the United Kingdom. Discovery should deliberately include grassroots, regional, community, independent-promoter and smaller-town activity, not only nationally visible events. Europe is deferred.

## 4. Source strategy and compliance

The source model is intentionally multi-source:

- official event, organiser, venue, company and institutional websites;
- ticketing and registration platforms;
- legitimate social and community discovery;
- venue calendars;
- event, tourism, convention and association directories;
- industry publications and trade sources;
- search engines;
- news and announcements;
- public professional and company sources.

Future first-party source families must also use this bounded model. Gig Guide is a future discovery/source family whose first intended use is venue prospecting. Its public graph may connect venues, gigs/events, artists, locations, ticket links/providers and recurring programmes. Artists are primarily discovery graph nodes in this use case, not automatic sales prospects. A Gig Guide listing alone is not sufficient Account qualification.

Future adapters must fit this source model rather than create a separate prospecting architecture.

Meta initially means Facebook and Instagram; LinkedIn initially means organisation, company-context, role and permitted professional intelligence. These are the first dedicated social source families to explore after the core engine is quality-proven.

The product must not bypass authentication, scrape protected or gated platforms without permission, automate personal accounts, collect private-group content, circumvent technical controls, or fabricate private contact details. Native Meta and LinkedIn integrations require authorised/permitted access. Until an official integration exists, legitimate public-web references may act as DISCOVERY evidence and should normally be validated elsewhere.

## 5. Evidence roles

Every retained source or evidence item should explicitly support one or more roles:

- **DISCOVERY:** indicates that a candidate may exist.
- **VALIDATION:** confirms organisation identity, event existence, organiser responsibility, current activity, recurrence or portfolio.
- **COMMERCIAL_EVIDENCE:** supports an EventSuite-relevant problem or opportunity.
- **CONTACT:** supports a public person or contact route.
- **SIGNAL:** supports timing, growth, change or intent.

Discovery evidence is not a sales angle. A ticketing listing may be DISCOVERY or a provider FACT; an official organiser site may be VALIDATION; a four-stage programme with accreditation may be COMMERCIAL_EVIDENCE for ECC; an official team page may be CONTACT; and an expansion announcement may be SIGNAL. Evidence must not be mechanically relabelled into every role.

## 6. Confidence and validation

Confidence attaches to the claim, not merely to the URL.

- **HIGH** generally requires direct authoritative evidence: official organiser, event, venue, company, programme or contact information.
- **MEDIUM** may describe credible industry, tourism, association, recognised-directory or reliable third-party evidence.
- **LOW / discovery-only** applies to weak aggregators, reposts, unsupported social mentions or unclear listings.

A source may be HIGH confidence for “the event exists” while being LOW or insufficient for “this organisation organises the event.” Discovery-only evidence must not automatically receive HIGH confidence for commercial claims.

Before strong qualification, establish where relevant: organisation identity, organisation/event relationship, current or recurring activity, recurrence or portfolio, territory and relevant commercial facts.

An event listing proves an event exists, not who owns it. A venue calendar proves an event occurs at a venue, not that the venue organises it. An artist appearance proves participation, not organiser responsibility. A ticketing page proves provider or event evidence, not organiser ownership or ticketing pain.

## 7. Event Connection and freshness

Retain the Event Connection states **CONFIRMED**, **STRONG**, **WEAK** and **NONE**.

CONFIRMED or STRONG requires defensible evidence that the organisation owns, organises, promotes, operates or is commercially responsible for the event or activity. Topic or sector similarity alone is insufficient.

Use dynamic dates and the conceptual freshness states **ACTIVE / UPCOMING**, **RECENT_RECURRING_EVIDENCE**, **HISTORICAL**, and **CANCELLED / DEAD / UNSUPPORTED**.

- Active/upcoming activity may support live qualification.
- Recently completed recurring activity may strengthen organisation intelligence without inventing an upcoming edition.
- Historical one-off activity alone must not create a live opportunity.
- Dead, cancelled or unsupported noise should normally be rejected rather than create review workload.
- The current calendar year must never be hardcoded.

## 8. Organisation portfolio

When an organisation is resolved, consider its wider public portfolio where evidence allows: number and type of events, recurrence, venues, territories, programme complexity, digital presence, providers, growth and operating scale. Do not invent portfolio facts. One event may discover an organisation, but qualification should reason about the organisation rather than treating every event as a separate account.

## 9. Commercial diagnosis

Qualification is problem-led, not event-led. Event existence is insufficient. A commercially meaningful prospect needs at least one defensible EventSuite problem or opportunity hypothesis.

EGS, Ticketing and ECC are assessed independently. The system must not force all products to POSSIBLE and must not optimise toward a qualification quota.

### EGS — Get Discovered

Positive evidence includes no meaningful owned event destination, social-first promotion with weak or no owned site, a ticketing page acting as the primary destination, fragmented event information, weak event-specific owned presence, a disconnected portfolio, or poor discoverability/owned digital control.

Negative evidence includes a mature coherent owned event website, strong event information architecture and a credible owned destination. Event fame or size does not create an EGS opportunity. Social activity or third-party ticketing alone is not EGS proof.

### Ticketing — Monetise and operate attendance

Provider use is commercial intelligence, not automatically a Ticketing opportunity. Potential positive evidence includes fragmented ticketing or registration, multiple disconnected arrangements, registration or admissions complexity, manual workflow or operational pain, procurement/evaluation, or a credible provider-switch or upgrade signal.

The system must never invent dissatisfaction or switching intent. If a competitor provider is known, retain the provider relationship as FACT and treat satisfaction, contract status and future procurement as UNKNOWN unless sourced.

### ECC — Run the event

Potential evidence includes multiple stages, zones or venues, concurrent programmes, accreditation, vendor/exhibitor complexity, workforce or volunteers, production teams, complex schedules, access coordination and substantial event-day operations. Supported operational complexity may justify a STRONG_HYPOTHESIS without direct evidence that the prospect already asks for ECC.

### Broader EventSuite signals

Research may retain credible evidence about future capabilities such as workforce, vendors, accreditation, communications, RSVP, venue operations, procurement, inventory, promotion and reporting. These remain research memory until an explicit commercial motion is activated. This V1 policy does not add sales motions for them.

## 10. FACT, INFERENCE and UNKNOWN

- **FACT:** directly supported by a source.
- **INFERENCE:** a commercially useful interpretation reasonably derived from sourced facts.
- **UNKNOWN:** an important unanswered commercial question.

Example:

- FACT: a festival has four stages.
- INFERENCE: cross-stage event-day coordination is likely operationally significant.
- UNKNOWN: the current event operations platform or workflow is not publicly evidenced.

Fields must not be populated merely to satisfy counts, but the architecture must genuinely support useful inference and unknown generation where justified.

## 11. Product strength and primary opportunity

Preserve the meanings of **CONFIRMED_NEED**, **STRONG_HYPOTHESIS**, **POSSIBLE**, **NO_EVIDENCE** and **NOT_APPLICABLE**:

- CONFIRMED_NEED: direct supported evidence of need.
- STRONG_HYPOTHESIS: strong or multiple facts support a credible problem hypothesis.
- POSSIBLE: some defensible product-relevant evidence exists.
- NO_EVIDENCE: the product could apply, but research found no supported need.
- NOT_APPLICABLE: the product genuinely does not fit the context.

UNKNOWN must not be used merely because research is incomplete when one product is materially better supported. Where one product is better supported, select it as the primary opportunity. Priority may remain LOW when evidence is weak; validated current activity with strong commercial evidence may become MEDIUM or HIGH.

## 12. Competitors, providers and noise

Distinguish:

- **COMPETITOR:** the organisation itself provides a competing product or service.
- **COMPETITOR_CUSTOMER:** the organisation uses a competing provider and remains a valid prospect.
- **UNKNOWN_PROVIDER_RELATIONSHIP:** evidence is insufficient.

“Tickets via X” does not make the organiser X or a competitor. Actual competitors remain blocked from prospect outreach.

Ticketing platforms, event-tech providers, recruitment businesses, suppliers, venues, participants and directories must be classified as prospect organisation, competitor, ecosystem/provider, participant, discovery source or irrelevant noise. They must not automatically dominate the review queue.

Canonicalisation should prefer one commercial identity per real organisation using normalised name, authoritative domain, verified organiser identity, known aliases or authoritative identifiers. Name-only fuzzy matching must not merge unrelated organisations.

## 13. Discovery memory, qualification and account gate

Discovery memory comes first. Do not create an Account merely because a candidate was discovered or marked REVIEW_REQUIRED.

An Account normally requires credible organisation identity, relevant current or recurring activity, adequate Event Connection, a non-blocked relationship and at least one credible EventSuite commercial signal or hypothesis. Weak review candidates remain discovery memory.

A candidate may qualify when evidence supports a real commercial organisation, relevant activity, adequate connection, credible EventSuite opportunity and no blocking safety condition. Qualification does not require every product to fit, a named buyer, a verified email or a fixed candidate quota.

## 14. Review, buyer and contact research

REVIEW_REQUIRED must identify the actual unresolved issue: organiser responsibility, current edition, source confidence, incomplete commercial signal, provider relationship, duplicate identity, or buyer/contact after strong commercial qualification. Avoid generic “more evidence required.”

Buyer roles may be inferred from the supported hypothesis: marketing/digital/event marketing for EGS; commercial/ticketing/event director for Ticketing; operations/production/event leadership for ECC. A role inference is not a named-person FACT. Named people require public evidence.

Contact research occurs only after sufficient commercial qualification, in this order:

1. named relevant buyer with public work email;
2. named buyer with legitimate public route;
3. relevant official organisation route;
4. named buyer without a verified route;
5. CONTACT_RESEARCH_REQUIRED.

Never guess people, emails, LinkedIn URLs or private contact information. A contact does not authorise outreach.

## 15. Autonomy, authority and outreach safety

AI may discover, research, validate, classify, retain evidence, generate supported inferences, identify unknowns, diagnose commercial hypotheses, research permitted public contacts and recommend actions.

Account creation remains evidence-gated. Outreach remains governed by existing approval, suppression, competitor and send controls. Prospecting must not bypass them.

Scheduled/background prospecting is deferred until quality calibration demonstrates commercially useful prospects, acceptable review workload, low pollution, safe canonicalisation, meaningful product diagnosis, safe contact gating and no outreach regression.

## 16. Research stages and cost control

Bounded staged research is permitted:

1. **First pass:** discovery and early rejection.
2. **Second pass:** organisation validation, commercial evidence, product diagnosis and material unknowns.

Do not spend enrichment budget on obvious competitors, rejected noise, stale unsupported one-offs, unnecessary duplicates or NONE-connection candidates except for a minimal identity check. Bound candidates, searches and provider cost. A second stage must change search intent toward unresolved commercial questions rather than repeat generic discovery.

## 17. Quality and operator experience

Quality is measured by discovery precision, validation quality, commercial-signal rate, qualification usefulness, review burden, noise/rejection rate, duplicate rate, account pollution, source yield/diversity, event-first versus organisation-first usefulness, contactability and product differentiation. Real production output determines quality, not test count alone.

The eventual operator experience should present the AI Sales Team rather than CRM maintenance: prospects found, why they matter, what changed, hypotheses, evidence, FACT versus INFERENCE, unknowns, buyer/contact readiness, next action and approvals or exceptions. Accounts, contacts, opportunities, evidence and activities are AI memory/state.

## 18. Explicitly deferred

The following are deferred from this policy’s current implementation stage:

- Meta native integration;
- LinkedIn native integration;
- TikTok, Reddit, Meetup, YouTube and X;
- paid enrichment vendors;
- Europe expansion;
- autonomous social messaging;
- scheduled prospecting;
- predictive ML lead scoring;
- mass historical account cleanup;
- unrelated UI redesign;
- new partner/channel or outreach motions.

The following revenue-intelligence capabilities are also explicitly future roadmap items, not production capability in this slice:

- EventSuite Lifecycle Bridge;
- tenant, trial and customer lifecycle matching;
- shared commercial identity mapping;
- Local Operator Network integration;
- Gig Guide venue prospect graph;
- SendGrid Revenue Engine event-webhook feedback;
- Signal-first source expansion;
- Meta and LinkedIn source integrations;
- scheduled or background prospecting.

## 19. Revenue intelligence and first-party integration roadmap

The Revenue Engine should eventually connect commercial intelligence to first-party lifecycle signals without duplicating operational systems. This section establishes boundaries and sequencing only; it authorises no integration, schema, credential or runtime work.

### EventSuite Lifecycle Bridge

The future EventSuite Lifecycle Bridge should allow the Revenue Engine to recognise when a researched organisation starts a trial, becomes an EventSuite tenant, activates products, becomes a paying customer, converts through another acquisition source, expands, churns or otherwise changes lifecycle state where appropriate. A prospect that independently starts a trial or becomes a customer must stop being treated as an ordinary outbound prospect. The conceptual lifecycle is:

`DISCOVERED → RESEARCHED → CONTACTED where applicable → TRIAL → TENANT → CUSTOMER`

Lifecycle matching must work regardless of acquisition source and must not require outreach attribution. The bridge should exchange the smallest useful server-side facts and retain commercial state in the Revenue Engine; it must not copy EventSuite tenant data wholesale.

### Commercial identity and attribution

The future commercial identity map is conceptually:

`Revenue Engine Account ↔ EventSuite Tenant / Organisation ↔ first-party source identities`

Matching should prefer authoritative identifiers and domains. Fuzzy company-name matching must not be the primary key. The Revenue Engine should retain only the commercial facts and signals needed for sales reasoning.

Future attribution should distinguish original discovery source, first commercial signal, outreach involvement, known trial source, known conversion source, time from discovery to trial/customer, the product hypothesis at discovery and eventual product adoption. `UNKNOWN ATTRIBUTION` must remain distinct from `REVENUE ENGINE ATTRIBUTION`; the existence of a prospect in Revenue Engine memory does not prove that Revenue Engine outreach caused a conversion.

This identity and lifecycle boundary is also foundational for the future Local Operator Network. It must be capable of distinguishing a direct EventSuite prospect/customer, a Local Operator Network relationship, an operator-influenced or operator-referred conversion and other future commercial channels. The full Local Operator Network data model belongs in its own future product specification and is not defined here.

### Gig Guide venue prospect graph

After quality proof, a future Gig Guide Venue Prospect Graph may use limited server/API contracts to derive venue discovery signals such as event frequency, recurring programmes, unique artists, programme breadth, city/territory, ticketing-provider mix, listing/activity growth and an active but weak owned destination. Gig Guide facts should normally begin as DISCOVERY and/or SIGNAL evidence; public or official sources must still validate commercial claims where appropriate. The graph may support loops such as:

`VENUE → events → artists → other venues → validate venue → commercial research`

and:

`ARTIST → performances → venues → venue programme → commercial research`

Revenue Engine access must remain limited to the facts needed for prospect discovery and commercial reasoning, not unrelated Gig Guide or EventSuite operational data.

### SendGrid outreach feedback

The future SendGrid Event Webhook integration for Revenue Engine outreach may retain processed, delivered, deferred, bounce, dropped, open, click, spam-report and unsubscribe events. Where architecture permits, it should reuse proven EventSuite patterns for signature validation, correlation/custom arguments, webhook deduplication and idempotency, delivery/failure persistence and unsubscribe suppression. This is distinct from EventSuite’s existing SendGrid implementation and is not implemented by this PRD update.

Telemetry should treat hard bounces, unsubscribes, replies, meaningful link clicks, trial starts and conversions as strong/actionable signals. Opens are weaker evidence and must not independently drive strong sales conclusions.

### Closed-loop learning

The intended future feedback loop is:

`prospect discovery → validation → commercial hypothesis → approved outreach where applicable → engagement → trial → tenant/customer → commercial outcome → prospecting-quality learning`

Initially this means durable measurable data and product analytics that can later improve prospecting rules and AI reasoning. It does not approve autonomous model retraining.

### Approved sequencing

After core public-web prospecting is quality-proven, the current roadmap is:

1. Operator Experience V1;
2. EventSuite Lifecycle Bridge V1;
3. Gig Guide Venue Prospect Graph V1;
4. SendGrid Outreach Feedback V1;
5. Meta source feasibility/integration;
6. LinkedIn source feasibility/integration;
7. Signal-first expansion;
8. scheduled/background autonomous prospecting only after later quality gates.

This order may evolve from evidence, but represents the current approved product sequencing. The immediate runtime sequence remains:

`PR #15 production complete → Quality Calibration V4 → quality decision`

The current quality gate is not weakened by this future roadmap.

## Non-normative implementation status

Implemented or proven so far:

- EVENT_FIRST and ORGANISATION_FIRST discovery;
- dynamic freshness and rejection improvements;
- account-pollution protection;
- competitor/customer distinction;
- cautious canonicalisation;
- gated contact research;
- one bounded second-stage enrichment pass in PR #14 when merged;
- first-party self-exclusion and enrichment observability in PR #15 when merged.

Not yet quality-proven at real-world production scale:

- positive commercial enrichment rate;
- commercially useful qualification rate;
- source-role diversity;
- meaningful live inference and unknown output at scale.

PR #14 is governed by this PRD and remains limited to bounded evidence enrichment. It does not implement Signal-first discovery, Meta, LinkedIn, UI redesign or scheduled discovery. Production quality calibration remains a separate post-merge gate.

PR #15 is governed by this PRD and remains limited to first-party self-exclusion and bounded enrichment observability. It does not implement the EventSuite Lifecycle Bridge, lifecycle matching, Local Operator Network integration, Gig Guide prospect graph, SendGrid Revenue Engine webhook feedback, Meta, LinkedIn, Signal-first expansion or scheduled prospecting. All such capabilities remain planned, not implemented.
