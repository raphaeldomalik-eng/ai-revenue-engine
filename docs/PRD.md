# AI Revenue Engine — Product Charter

**Status:** Active product definition V2  
**Initial commercial product:** Event Suite  
**Platform scope:** Prestige Nexus, AI Revenue Engine, Event Suite / Resources, Last Train Home, Ticket Report, Prestige Global Live Discovery  
**Primary architecture:** [AIRE Platform Pipeline & Execution PRD V1](PRD/aire-platform-pipeline-v1.md)

## Product decision

AI Revenue Engine (AIRE) is the Prestige portfolio's shared **external execution, research, graph-expansion, orchestration and communication platform**.

AIRE is not the canonical owner of real-world identity or shared facts. Prestige Nexus remains the canonical truth and evidence-governance layer. AIRE performs bounded external work on behalf of Nexus and product workflows, returns evidence and proposed conclusions, and owns product-local commercial memory and communication execution where appropriate.

AIRE is also the home of the Event Suite revenue workforce. That commercial system remains a major product capability, but it is one workflow family inside the wider AIRE execution platform rather than the architecture boundary for AIRE as a whole.

This V2 charter is primarily an **alignment of existing architecture**, not a big-bang redesign. It formalises the direction already present in:

- the Prestige Nexus cross-product architecture contract;
- AIRE's Nexus research/source-discovery contracts and shared crawler;
- AIRE's Companies House, Google Places, Apollo, public-web and OpenAI research capabilities;
- AIRE's organisation-first, event-first, venue-first and person-first research lanes;
- Last Train Home's proven self-expanding entity/source/event discovery graph;
- Ticket Report's Regional Publishing Foundation;
- Prestige Global Live Discovery's consumer-projection architecture.

Existing product behavior remains valid until replacement paths are proven. This charter does not authorise production activation, provider spend, LTH cutover, bulk estate processing or unsupervised communication.

## Portfolio role

The platform boundary is:

```text
Prestige Nexus
  = canonical identity, relationships, provider references, evidence,
    matching/deduplication and governed truth

AI Revenue Engine
  = external execution, provider calls, first-party crawling, web research,
    selective AI interpretation, work orchestration, commercial intelligence
    and communication execution

Product repositories
  = product-specific operational, editorial, publishing and consumer projections
```

The first six active product/runtime relationships are:

- **Prestige Nexus** — canonical graph and integration contracts.
- **AI Revenue Engine** — shared execution/research/orchestration.
- **Event Suite / Resources** — operations, directory/listing lifecycle, claims, enquiries, customer/tenant state.
- **Last Train Home** — UK music editorial and discovery projection; mature donor and transitional production acquisition path.
- **Ticket Report** — South African regional publishing projection and Regional Publishing Foundation incubator.
- **Prestige Global Live Discovery** — global consumer discovery projection.

Prestige Intelligence remains advisory/control-plane intelligence and does not become a crawler, canonical store or operational workflow engine.

## Core invariant

The platform must never silently collapse these concepts:

```text
OBSERVATION
!= CANONICAL ENTITY
!= PRODUCT PROJECTION
!= COMMERCIAL PROSPECT
!= CONTACT
!= OPPORTUNITY
!= COMMUNICATION
```

An entity may exist without becoming a prospect. A Resources listing may exist without sales outreach. A commercial prospect may be irrelevant to Resources. A contact may be researched without being public. A communication must have an explicit purpose before it can be composed or sent.

## Shared execution resources

AIRE may use bounded resources according to purpose, provider allowance, evidence need and cost policy:

- structured event/provider feeds such as Ticketmaster;
- verified first-party websites, JSON-LD, ICS, RSS, APIs and PDFs;
- Google Places for place/provider evidence and controlled web-identity acquisition;
- Companies House for UK legal-company discovery and validation;
- Apollo for bounded people/employment/contact research;
- public-web research/search;
- OpenAI for selective interpretation, synthesis and personalised content where deterministic methods are insufficient.

Provider access does not imply provider authority for every fact. Each provider's fact responsibility, provenance, freshness, licence/retention constraints and cost must remain attached to resulting evidence.

## Platform pipeline

The controlling full pipeline is defined in [AIRE Platform Pipeline & Execution PRD V1](PRD/aire-platform-pipeline-v1.md).

At a high level:

```text
discover / observe
  -> resolve identity
  -> classify entity and source evidence
  -> complete evidence gaps
  -> write evidence/proposals through Nexus boundaries
  -> evaluate product dispositions
  -> evaluate commercial disposition where relevant
  -> select a bounded next action
  -> execute permitted research/crawl/provider/communication work
  -> observe delivery/replies/new evidence
  -> update knowledge
  -> repeat within explicit budgets and policy
```

This is a graph-expansion system, not a single linear sales funnel. An event may reveal an artist, venue, organiser, promoter, tour or source; those discoveries may create bounded follow-on work. Expansion must always be constrained by purpose, market, entity types, freshness, provider allowances, depth, request limits and cost ceilings.

## Commercial revenue workforce

The Event Suite revenue workforce remains governed by:

- [AI Revenue Workforce V1](PRD/ai-revenue-workforce-v1.md)
- [AI Revenue Prospecting V1](PRD/ai-revenue-prospecting-v1.md)
- [Direct Prospecting & ICP V1](PRD/direct-prospecting-icp-v1.md)
- [Market Test Operating Protocol V1](PRD/market-test-operating-protocol-v1.md)
- the agent pack, deterministic gates and operator-workspace specifications.

Those documents govern the commercial subdomain where they do not conflict with this charter or the Prestige Nexus cross-product ownership contract.

Commercial classification is separate from canonical entity classification and separate from product disposition. Human approval is required at consequential boundaries according to policy; it is not required merely to reject obviously irrelevant entities or to perform low-risk deterministic routing.

## Communication

AIRE is the shared execution home for communication workflows, but "email" is not one domain.

At minimum, communication purposes include:

- listing welcome;
- listing claim;
- listing verification;
- image/content permission;
- data confirmation/correction;
- requested resource delivery;
- trial/service activation;
- inbound response;
- commercial outreach;
- marketing nurture;
- human relationship follow-up.

Operational or permission communication must not automatically create commercial outreach permission or enrolment. Communication purpose, eligibility, suppression scope, AI use, approval policy, delivery and response handling remain explicit.

## AI policy

AI is an execution resource, not the default mechanism.

Prefer deterministic rules, structured data, existing evidence and bounded providers before model interpretation. Use AI where ambiguity, synthesis, commercial interpretation, buyer-role inference, personalised commercial copy or reply interpretation materially benefits from it.

Every AI-enabled workflow must be able to answer:

- why AI is needed;
- what evidence it may consume;
- what decision/content it may produce;
- whether it may trigger external action;
- what human/policy gate applies;
- what cost/tool-call boundary applies.

## Transition policy

No big-bang migrations.

Last Train Home remains operationally independent while generic acquisition/discovery capabilities are proven in AIRE/Nexus through shadow, parity and controlled cutover. Ticket Report and Prestige Global Live Discovery are preferred early consumers of shared acquisition/canonical projections because they can prove the shared architecture without interrupting LTH production.

Event Suite / Resources consumes shared identity/evidence while retaining listing, claim, enquiry and operational customer state.

## Current implementation status

Implemented foundations include:

- Nexus research and source-discovery contracts;
- deterministic first-party crawler and extractor profiles;
- Google Places evidence/reuse controls;
- public-web research;
- Companies House support;
- Apollo support;
- selective OpenAI research and outreach composition;
- organisation-first, event-first, venue-first and person-first commercial research lanes;
- prospect/contact/commercial memory;
- inbound lead triage;
- supervised outreach drafting and a separately gated legacy send path.

Important target capabilities remain incomplete or transitional:

- durable shared graph-expansion/work orchestration at full estate scale;
- platform-wide product disposition routing;
- free-listing/claim/image-permission communication workflows;
- complete delivery/bounce/unsubscribe/reply feedback;
- reply-to-evidence intelligence;
- Ticket Report / Prestige Global shared acquisition consumption;
- full LTH dual-run/parity/cutover from legacy acquisition;
- production activation of currently gated Nexus execution paths.

The detailed target architecture and invariants are controlled by [AIRE Platform Pipeline & Execution PRD V1](PRD/aire-platform-pipeline-v1.md).
