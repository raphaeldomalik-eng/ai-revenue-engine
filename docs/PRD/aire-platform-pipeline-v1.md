# AIRE Platform Pipeline & Execution PRD V1

**Status:** Controlling target architecture for review and phased implementation  
**Date:** 30 September 2026  
**Repository:** `raphaeldomalik-eng/ai-revenue-engine`  
**Architecture owner:** AI Revenue Engine for execution; Prestige Nexus for canonical truth  
**Governing cross-product authority:** `Prestige-Nexus/docs/architecture/cross-product-architecture-contract.md`  
**Baseline AIRE main:** `e9c6459258495d1f39ea593f5190b27a02525035`

## 1. Purpose

This document preserves the full intended role of AI Revenue Engine (AIRE) across the Prestige portfolio so that implementation work does not regress AIRE into a narrow sales tool, duplicate shared capabilities in product repositories, or lose the relationship between discovery, canonical truth, product projections, commercial intelligence and communication.

It defines the target platform pipeline from external observation through canonical evidence, graph expansion, product routing, commercial routing, communication and response learning.

This document is primarily an **architecture alignment**, not a wholesale rewrite. The current system already contains many of the required components:

- Prestige Nexus already defines AIRE as the shared execution/research boundary.
- AIRE already has versioned Nexus research and source-discovery contracts.
- AIRE already executes deterministic first-party crawling.
- AIRE already has Google Places, public-web, Companies House, Apollo and OpenAI capabilities.
- AIRE's prospecting architecture already supports organisation-first, event-first, venue-first and person-first research.
- Last Train Home already proves a self-expanding event/artist/venue/source discovery graph.
- Ticket Report already incubates neutral regional publishing mechanics.
- Prestige Global Live Discovery is already designed as a consumer of canonical Nexus data rather than a duplicate data owner.

The material alignment in this PRD is to place those capabilities under one coherent platform model and make their boundaries explicit before the next implementation phases.

## 2. Product definition

AIRE is the Prestige portfolio's shared:

- external execution runtime;
- research execution runtime;
- first-party source-discovery crawler;
- provider-call boundary;
- graph-expansion orchestrator;
- selective AI interpretation layer;
- commercial intelligence and commercial-memory system;
- communication orchestration and delivery system.

AIRE is **not**:

- the canonical identity registry;
- the canonical owner of shared real-world facts;
- a public event directory;
- a public venue directory;
- the Event Suite operational database;
- a replacement for product editorial state;
- a generic CRM;
- a bulk-email engine;
- an unconstrained web spider;
- an excuse to invoke AI when deterministic methods are sufficient.

Prestige Nexus remains the canonical truth and evidence-governance layer.

## 3. Core architecture

```text
                         EXTERNAL WORLD
              providers / websites / public web
                 legal data / people / replies
                              |
                              v
+------------------------------------------------------------------+
|                              AIRE                                |
|                                                                  |
|  acquisition | research | crawling | graph expansion | work       |
|  provider calls | selective AI | commercial intelligence          |
|  communication | response processing                              |
+-------------------------------+----------------------------------+
                                |
                     evidence / proposals /
                     execution results / usage
                                |
                                v
+------------------------------------------------------------------+
|                         PRESTIGE NEXUS                           |
|                                                                  |
| canonical entities | relationships | external references          |
| raw evidence | proposed facts | matching / dedupe / merge         |
| governed classifications | cross-product contracts               |
+-------------------------------+----------------------------------+
                                |
                     governed projections / events
                                |
          +---------------------+----------------------+
          |                     |                      |
          v                     v                      v
  LAST TRAIN HOME          TICKET REPORT        PRESTIGE GLOBAL
  UK music editorial       ZA publishing        global discovery
          |
          +---------------------+----------------------+
                                |
                                v
                    EVENT SUITE / RESOURCES
                    operations / claims /
                    listings / customers
```

Prestige Intelligence sits beside this architecture as advisory/control-plane intelligence. It may recommend work but does not become canonical truth or operational execution.

## 4. Non-negotiable invariants

1. **Nexus owns canonical truth.** AIRE may discover, research, extract, interpret and propose; it does not silently promote provider output into canonical truth.
2. **Execution does not imply ownership.** AIRE may perform a crawl/provider call whose result belongs canonically in Nexus or operationally in a product.
3. **Products own product state.** LTH owns LTH editorial/publication state; Ticket Report owns ZA editorial/publication state; Prestige Global owns consumer discovery presentation; Event Suite owns operational/customer/Resources state.
4. **One shared execution layer.** Product repositories must not grow competing generic crawlers or provider-research cores.
5. **Observations are not prospects.** The existence of an observed entity must not automatically create an AIRE account, contact, opportunity or message.
6. **Product eligibility is not commercial qualification.** A Resources venue may be commercially irrelevant. A commercial prospect may be irrelevant to Resources.
7. **Communication purpose is separate from prospect status.** A listing welcome or image-permission request is not sales outreach.
8. **Structured/deterministic before AI.** AI is selective and justified by ambiguity/value, not used by default.
9. **Graph expansion is bounded.** New evidence may spawn follow-on work only inside explicit market, entity, depth, request, provider, freshness and cost limits.
10. **No big-bang cutovers.** Mature product pipelines remain authoritative until shared replacements pass explicit parity gates.
11. **Provenance survives routing.** Every reusable fact/evidence item retains source, observation time, provider/source identity and applicable restrictions.
12. **Cost is a policy input.** Provider and AI work must be purpose-authorised and measurable.

## 5. Six-system operating model

### 5.1 Prestige Nexus — canonical graph and truth

Nexus owns:

- canonical Organisation, Place, Venue, Event and Creative Entity identity;
- future canonical Tour/Festival identities when implemented;
- canonical relationships;
- external/provider references;
- evidence and proposed facts;
- source/entity classification where cross-product;
- match/dedup/merge governance;
- contract definitions and integration boundaries.

Nexus answers:

> What real-world entities and relationships do we currently believe exist, based on governed evidence?

Nexus must not become a crawler, sales workflow engine, public directory or product publication system.

### 5.2 AI Revenue Engine — execution, research and orchestration

AIRE owns execution of bounded external work, including:

- structured provider calls;
- deterministic first-party crawling;
- source/event extraction;
- public-web research;
- Google Places;
- Companies House;
- Apollo;
- selective OpenAI interpretation and web-enabled research where policy allows;
- durable work orchestration;
- commercial fit/buyer research;
- communications;
- response processing;
- provider/model usage telemetry;
- AIRE-local commercial memory.

AIRE answers:

> Given what we know and what a product or Nexus needs, what external work should be done next, with which tool, under which limits?

### 5.3 Last Train Home — UK music editorial projection and mature donor

LTH remains:

- an active production product;
- the UK music editorial/publication authority;
- a proven donor of event/source discovery logic;
- a transitional acquisition source while shared paths are proven.

LTH must not be broken merely to make the shared architecture cleaner.

### 5.4 Ticket Report — South African regional publishing projection

Ticket Report owns:

- ZA publishing/editorial state;
- market-specific publication behavior;
- the current Regional Publishing Foundation incubation.

It should consume shared Nexus/AIRE acquisition rather than build a new generic research/crawler core.

### 5.5 Prestige Global Live Discovery — consumer discovery projection

Prestige Global owns:

- consumer discovery UX;
- ranking/presentation;
- location context;
- DiscoveryArea projection;
- follows/saves/travel features as they are implemented.

It consumes canonical Nexus graph data and shared publishing mechanics. It does not own canonical entities or shared acquisition.

### 5.6 Event Suite / Resources — operational and industry projection

Event Suite owns:

- tenant/customer operational state;
- ticketing/RSVP/workforce/production/event operations;
- Resources listing lifecycle;
- claims;
- enquiries;
- publication/commercial listing state;
- product-specific media and permissions state where applicable.

It consumes Nexus canonical identity and AIRE execution, but does not become the generic research/crawling layer.

## 6. The platform graph

The shared live-event graph is not only a list of venues.

Core nodes include:

- Organisation;
- Place;
- Venue;
- Event / scheduled occurrence;
- Creative Entity / Artist / Production;
- Person where justified;
- Tour / Tour Leg (target Nexus capability);
- Festival / Festival Edition (target Nexus capability);
- Source / verified first-party web identity;
- Provider record.

Important relationship families include:

- event OCCURS_AT venue/place;
- artist/creative entity PERFORMS_AT event;
- organisation ORGANISES event;
- promoter PROMOTES event;
- organisation OPERATES venue;
- event BELONGS_TO series/tour/festival where supported;
- organisation REPRESENTS artist/person where supported;
- source IS_OFFICIAL_SOURCE_FOR entity;
- provider record REFERENCES canonical entity.

AIRE may discover evidence for these nodes/edges. Nexus decides canonical promotion.

## 7. Observation and evidence model

Everything entering the platform begins as an observation/evidence item, not as a prospect.

Examples:

- Ticketmaster event/provider response;
- Google Place ID and place details;
- JSON-LD Event on an artist site;
- Companies House legal-company result;
- Apollo employment/contact result;
- official venue PDF;
- reply from a venue operator;
- Event Suite claim verification.

An observation should retain enough information to answer:

- who/what produced it;
- when it was observed;
- which subject it may concern;
- provider/source identifier;
- raw or retained evidence reference where allowed;
- source URL where applicable;
- licence/data classification;
- freshness/expiry;
- hash or integrity reference where useful;
- which workflow requested it;
- provider/model/request usage.

Observation does not imply canonical acceptance.

## 8. Acquisition and research resources

AIRE has multiple execution resources. Provider selection must follow fact responsibility and purpose rather than convenience.

### 8.1 Structured event/provider feeds

Examples:

- Ticketmaster;
- future ticketing/event provider APIs;
- partner feeds;
- documented venue/promoter feeds.

Strong uses:

- provider event identity;
- event dates/status;
- venue/artist provider identity;
- provider URLs and source facts.

Restrictions:

- provider categories are evidence, not canonical truth;
- event/provider records do not automatically publish to products;
- provider output must retain provenance/licensing/freshness.

### 8.2 Verified first-party sources

Examples:

- artist websites;
- venue websites;
- promoter/organiser sites;
- festival sites;
- official organisation sites;
- JSON-LD;
- ICS;
- RSS;
- documented public APIs;
- sitemaps;
- PDFs.

Strong uses:

- official web identity;
- events/calendars;
- venue facts;
- public contact routes;
- operator/organiser evidence;
- image candidates/rights signals;
- event changes/cancellations;
- technical/capacity/accessibility evidence.

The shared crawler should fetch once per freshness need and expose documents to multiple extractors where practical.

### 8.3 Google Places

Use for:

- place discovery;
- durable Place ID provider reference;
- name/address/location/type/status evidence;
- controlled website acquisition when current governed eligibility permits.

Do not treat Google Place ID as canonical identity. Do not use a paid higher-tier call when reusable evidence or verified first-party data already satisfies the need. Provider cost policy remains explicit.

### 8.4 Companies House

Use for UK legal-company discovery/validation:

- legal name;
- company number;
- status/type;
- incorporation date;
- SIC;
- registered region;
- minimised officer facts where policy allows.

Companies House does not prove:

- trading domain;
- venue operation;
- event organisation;
- commercial fit;
- buyer responsibility.

### 8.5 Apollo

Use for bounded commercial people/employment/contact research after:

- organisation identity/domain is sufficiently resolved;
- commercial purpose warrants buyer research;
- role families are defined.

Apollo evidence is commercial/contact intelligence. It does not define canonical organisation identity.

### 8.6 Public web and web search

Use for questions that cannot be answered by existing evidence or deterministic first-party crawling, such as:

- official-domain resolution;
- operator/organiser relationships;
- current trading/activity validation;
- event/promoter discovery;
- ambiguity resolution.

Search is research, not truth. Findings return as evidence/proposals.

### 8.7 OpenAI / AI

Use selectively for:

- ambiguity interpretation;
- synthesis across evidence;
- commercial-fit interpretation;
- buyer-role inference;
- complex relationship interpretation;
- personalised commercial copy;
- future bounded reply interpretation.

Do not use AI for work that deterministic logic already answers reliably.

## 9. AIRE execution lanes

AIRE is one platform with multiple purpose-specific lanes sharing infrastructure.

### 9.1 Event discovery lane

Purpose:

- discover event candidates;
- refresh event evidence;
- discover related artists, venues, organisations and sources.

Typical resources:

- Ticketmaster/structured providers;
- artist websites;
- venue/promoter sites;
- public web;
- selective AI only when deterministic extraction is insufficient and policy permits.

Outputs:

- event evidence;
- source evidence;
- new entity/relationship candidates;
- follow-on bounded work requests.

### 9.2 Entity/source discovery lane

Purpose:

- resolve official sources;
- crawl verified first-party sites;
- discover reusable entity facts.

Typical resources:

- first-party crawler;
- Google Places;
- public web;
- source classification.

### 9.3 Identity/legal research lane

Purpose:

- resolve organisation/place/venue/operator identity;
- validate UK legal entities;
- reconcile ambiguity.

Typical resources:

- Nexus existing evidence;
- Companies House;
- first-party web;
- Google Places;
- public web;
- selective AI.

### 9.4 Commercial research lane

Purpose:

- assess Event Suite relevance;
- identify product opportunities;
- determine whether more research is justified.

Typical resources:

- Nexus canonical facts;
- first-party evidence;
- public web;
- Companies House context;
- selective AI.

### 9.5 Buyer/contact research lane

Purpose:

- identify a legitimate role/person/contact route only after commercial relevance warrants it.

Typical resources:

- first-party public contact;
- Apollo;
- public web;
- selective AI.

### 9.6 Communication lane

Purpose:

- execute operational, rights, inbound, marketing and sales communication under explicit purpose/policy.

Typical resources:

- deterministic templates;
- AI Composer for personalised commercial content;
- SendGrid/approved delivery provider;
- inbound mailbox/provider events.

### 9.7 Response intelligence lane

Purpose:

- turn delivery events and replies into suppression, evidence, commercial memory and next actions.

Typical resources:

- provider webhooks;
- deterministic event handling;
- human review;
- selective AI for semantic reply interpretation.

## 10. Self-expanding graph discovery

The proven LTH model becomes a platform primitive.

Current LTH concept:

```text
Ticketmaster
  -> artist identities
  -> official artist sites
  -> performances
  -> venue evidence
  -> canonical venue match
  -> Google Places only if needed
  -> verified venue site
  -> venue calendar
  -> more performances / artists / venues
  -> cross-source reconciliation
  -> repeat
```

The shared AIRE form generalises this:

```text
observation
  -> canonical match / candidate
  -> evidence gaps
  -> bounded execution
  -> new evidence
  -> new nodes/edges?
       no  -> product/commercial routing
       yes -> create bounded follow-on work
               -> repeat
```

Possible discoveries by subject:

- **Event** may reveal venue, artists, promoter, organiser, festival/tour, ticketing provider, source.
- **Venue** may reveal events, operator, spaces, public contact routes, promoter relationships.
- **Artist** may reveal events, venues, tour, official sources, management/representation evidence.
- **Organisation** may reveal operated venues, organised events, legal identity, brands, people.
- **Source** may reveal additional source surfaces, feeds, sitemaps, PDFs or event calendars.

### 10.1 Expansion limits

No workflow may recursively expand without explicit bounds.

Every expandable job must carry or derive:

- originating purpose;
- originating product;
- subject ID/ref;
- market/geographic scope;
- allowed new entity types;
- maximum graph depth;
- maximum spawned subjects/jobs;
- maximum pages/requests/bytes;
- provider allowances;
- provider/model cost ceiling;
- freshness horizon;
- retry policy;
- stop conditions.

A discovery result must be able to end in STOP/NO_FURTHER_EXPANSION without being considered a failure.

## 11. Classification model

Four separate decisions are required.

### 11.1 Entity / graph classification — "What is this?"

This describes the real-world subject.

It should support layered/multi-role classification rather than one flat enum:

- broad entity kind;
- business/place type;
- roles/capabilities;
- authority/confidence;
- evidence references.

Example:

```text
kind: PLACE
businessType: HOTEL
roles:
  - EVENT_VENUE
  - CONFERENCE_HOST
  - WEDDING_VENUE
authority: NEXUS_CANONICAL
```

A provider label such as `event_venue` is evidence, not the canonical conclusion.

### 11.2 Source / evidence classification — "What source/evidence is this?"

Examples:

- provider API;
- official first-party page;
- official feed;
- official PDF;
- public contact;
- secondary public-web source;
- legal registry;
- commercial people provider;
- AI-derived interpretation.

Source classification determines what can be inferred from it and how strongly.

### 11.3 Product disposition — "Which product cares?"

Product-specific dispositions remain separate.

Examples:

- LTH music relevance/editorial intake;
- Ticket Report ZA publication relevance;
- Prestige Global discoverability;
- Resources venue eligibility/listing state;
- Event Suite operational relevance.

No product disposition becomes canonical identity truth.

### 11.4 Commercial disposition — "Is there an Event Suite opportunity?"

Commercial classification should keep separate dimensions:

- relationship: unknown/prospect/customer/partner/competitor/first-party;
- commercial fit: unassessed/relevant/not relevant/ambiguous;
- product opportunity: zero/one/multiple Event Suite product lenses;
- readiness: research/buyer research/review/engagement/defer/stop;
- lifecycle: discovered/researched/engaged/contacted/conversation/opportunity/proposal/converted/lost;
- decision basis: deterministic/provider/AI-assisted/human.

Commercial fit is not a synonym for human approval.

Obvious irrelevant entities may stop automatically. Human approval is reserved for consequential external action or genuine ambiguity according to policy.

## 12. Product routing examples

### 12.1 Hotel/conference venue

```text
Nexus:
  PLACE + HOTEL + EVENT_VENUE

Resources:
  ELIGIBLE

Prestige Global:
  potentially discoverable as venue

LTH:
  only if relevant to UK music projection

Commercial:
  RELEVANT or NOT_RELEVANT independently

Next action:
  depends on evidence/product/commercial gaps
```

### 12.2 Event agency

```text
Nexus:
  ORGANISATION + EVENT_AGENCY + EVENT_ORGANISER

Resources venue directory:
  NOT_APPLICABLE

Commercial:
  potentially high relevance

Next:
  COMMERCIAL_RESEARCH / BUYER_RESEARCH when warranted
```

### 12.3 Petrol station

```text
Nexus:
  PLACE + OTHER_BUSINESS

Products:
  generally not relevant

Commercial:
  NOT_RELEVANT

Next:
  STOP
```

No AI, human review, account or contact is required merely to stop an obvious irrelevant record.

## 13. Next-action engine

Classification does not perform side effects. It authorises work.

A bounded next-action vocabulary should ultimately cover concepts such as:

- STOP;
- NO_ACTION;
- IDENTITY_REVIEW;
- ENTITY_CLASSIFICATION;
- SOURCE_DISCOVERY;
- WEBSITE_RESOLUTION;
- EVENT_DISCOVERY;
- RESOURCES_REVIEW;
- RESOURCES_CREATE_LISTING;
- COMMERCIAL_CLASSIFICATION;
- COMMERCIAL_RESEARCH;
- BUYER_RESEARCH;
- HUMAN_REVIEW;
- COMMUNICATION_READY;
- DEFER.

Exact enum names are implementation details to be finalised in the relevant delivery slice.

The next-action engine should consider:

- canonical identity state;
- evidence freshness/coverage;
- source availability;
- product dispositions;
- commercial disposition;
- active work;
- contactability;
- provider/model budgets;
- suppression;
- communication history;
- retries/previous failures.

## 14. Durable work orchestration

AIRE should evolve toward a durable shared work model rather than independent cron systems for every workflow.

A work item conceptually needs:

- work ID;
- purpose;
- originating product;
- subject type and stable subject ID/ref;
- trigger/evidence reference;
- requested fact/output types;
- allowed providers/tools;
- graph depth/expansion budget;
- cost/request budget;
- priority;
- available/retry time;
- state;
- claim/lease metadata;
- attempt count;
- last error;
- result reference;
- created/completed timestamps.

Physical schema design is deferred to implementation.

Operational requirements:

- idempotent submission;
- checkpoint/resume;
- bounded global concurrency;
- per-origin politeness/exclusion for crawling;
- provider rate limits;
- retry/backoff;
- dead/review states;
- pause/kill switch;
- deterministic cost accounting;
- no duplicate active work for the same effective purpose/subject/freshness window.

## 15. AI invocation policy

AIRE must not invoke AI merely because a workflow lives in the AI Revenue Engine.

Execution modes:

- `DETERMINISTIC`
- `PROVIDER_LOOKUP`
- `AI_ASSISTED`
- `HUMAN_DECISION`
- `AI_ASSISTED_HUMAN_DECISION`

### 15.1 Prefer deterministic

Normally deterministic:

- Place ID reconciliation;
- exact external-reference matching;
- URL normalisation;
- HTTP->HTTPS validation;
- robots/sitemap handling;
- crawling/fetch budgets;
- JSON-LD/ICS/RSS parsing;
- PDF text extraction;
- source hashing/dedupe;
- delivery scheduling;
- suppression checks;
- bounce/unsubscribe event handling;
- standard listing welcome/claim/permission templates.

### 15.2 AI where it adds material value

Potentially AI-assisted:

- ambiguous entity/relationship interpretation;
- commercial fit synthesis;
- buyer-role inference;
- complex organisation/operator relationships;
- evidence synthesis;
- personalised commercial outreach copy;
- semantic reply classification.

### 15.3 AI budget/policy

Every AI call must have:

- an explicit workflow purpose;
- defined input evidence;
- permitted tools;
- model/tool-call/request budget;
- output schema or bounded expected output;
- persistence/provenance rules;
- downstream authority boundary;
- external-action/human-approval policy.

## 16. Communication domain

Communication is a first-class domain separate from entity and prospect classification.

Every message must have an explicit purpose before composition.

Initial purpose taxonomy:

- `LISTING_WELCOME`
- `LISTING_CLAIM`
- `LISTING_VERIFICATION`
- `IMAGE_PERMISSION`
- `DATA_CONFIRMATION`
- `RESOURCE_DELIVERY`
- `TRIAL_ACTIVATION`
- `INBOUND_RESPONSE`
- `COMMERCIAL_OUTREACH`
- `MARKETING_NURTURE`
- `HUMAN_FOLLOW_UP`

### 16.1 Operational/listing communications

Example listing welcome:

- trigger: Resources listing created/eligible;
- sales prospect required: no;
- AI: normally no;
- template: deterministic;
- sales sequence: never;
- owner of listing state: Event Suite;
- sender/orchestrator target: AIRE.

### 16.2 Rights/permission communications

Example image permission:

- trigger: exact image candidate has PERMISSION_REQUIRED;
- recipient: legitimate rights-holder/operator route;
- sales prospect required: no;
- AI: normally no;
- result: permission evidence linked to exact image(s)/scope;
- product state: Event Suite Resources;
- communication execution target: AIRE.

### 16.3 Commercial outreach

- trigger: commercially relevant prospect + legitimate contact route + applicable prospect approval;
- AI: useful for personalised composition;
- approval: according to supervised/autonomy policy;
- sales suppression: applies;
- sequence: permitted only in sales workflow.

Operational contact does not automatically imply commercial permission or enrolment.

## 17. Suppression and policy scopes

Suppression should be purpose-aware.

Conceptual scopes:

- SALES;
- MARKETING;
- LISTING_OPERATIONAL;
- RIGHTS_PERMISSION;
- SERVICE;
- ALL_NONESSENTIAL;
- ALL_COMMUNICATION.

Exact legal/compliance policy is not finalised by this architecture document. The architecture requirement is that one communication category must not accidentally inherit another category's semantics.

## 18. Delivery and response loop

Target communication flow:

```text
purpose
  -> policy/eligibility
  -> deterministic or AI composition
  -> approval if required
  -> delivery
  -> provider events / reply
  -> update message state
  -> suppression if applicable
  -> response interpretation
  -> evidence/commercial memory
  -> next action
```

Delivery events should eventually include:

- sent;
- delivered;
- deferred;
- bounced;
- dropped;
- opened;
- clicked;
- unsubscribed;
- spam complaint;
- replied.

Reply ingestion is separate from SendGrid delivery events and requires an inbound mailbox/reply path.

A reply may become evidence, for example:

- "Speak to Sarah, she handles ticketing" -> person/role/route-to-buyer evidence;
- "We use Provider X until May" -> competitor/system/timing commercial evidence;
- image permission granted -> rights evidence;
- listing correction -> product/canonical evidence depending on fact ownership.

Replies do not automatically mutate canonical truth; they enter the relevant governed evidence/policy flow.

## 19. Commercial workflow as one AIRE workflow family

The commercial route remains:

```text
entity/organisation
  -> commercial fit
  -> opportunity hypothesis
  -> bounded commercial research
  -> buyer-role/contact research
  -> prospect review/approval
  -> Composer
  -> message approval/policy
  -> send
  -> response
  -> commercial memory
  -> next action
```

Commercial research must not begin merely because an entity exists.

Contact research must occur late enough to avoid spending on entities without plausible commercial relevance.

Named-person/contact data remains internal/commercial unless an explicit product contract says otherwise.

## 20. Last Train Home transition strategy

LTH is the mature production system and must not be destabilised.

### Stage A — current

```text
LTH existing acquisition -> LTH production
          |
          +-> evidence/donor learning for AIRE/Nexus
```

LTH remains authoritative for its production acquisition/editorial behavior.

### Stage B — shared shadow

```text
LTH production path -----------------> LTH
          |
          +-> AIRE shared acquisition/execution
                      |
                      v
                    Nexus
                      |
                 parity compare
```

Generic/shared work is proven without affecting LTH publication.

### Stage C — capability-by-capability cutover

Only after explicit parity gates:

```text
AIRE acquisition
    -> Nexus canonical graph
    -> LTH projection
    -> LTH editorial/publication decision
```

Cutover is granular. LTH-specific editorial/publication behavior remains in LTH.

### What is left behind deliberately

During transition LTH may retain:

- production adapters;
- compatibility mappings;
- source-specific editorial logic;
- parity/shadow instrumentation;
- temporary donor implementations.

Transitional debt may not expand into a second permanent platform.

## 21. Ticket Report adoption

Ticket Report is a preferred early shared consumer.

Target direction:

```text
AIRE shared event/source acquisition
      -> Nexus canonical graph/evidence
      -> Ticket Report ZA projection
      -> Regional Publishing Foundation
      -> Ticket Report editorial/publication
```

Ticket Report must not grow a competing generic crawler/provider layer.

Regional Publishing Foundation extraction is separate from AIRE acquisition but complementary: AIRE/Nexus answer what evidence/entities exist; the Foundation helps products decide how regional publishing behaves.

## 22. Prestige Global Live Discovery adoption

Prestige Global is a pure consumer-discovery projection.

Target:

```text
AIRE acquisition/research
      -> Nexus canonical live graph
      -> shared regional publishing/readiness mechanics
      -> Prestige Global market/discovery projection
```

Prestige Global owns:

- consumer ranking;
- location context;
- DiscoveryArea projection;
- editorial/personalised/popular/sponsored presentation.

It must not create a private canonical event/venue/artist registry or generic crawler.

## 23. Event Suite / Resources adoption

Resources uses the same canonical/execution core for a different outcome.

Example:

```text
Place observation
 -> Nexus entity resolution/classification
 -> AIRE website/source discovery
 -> Nexus reusable venue/operator evidence
 -> Resources venue eligibility
 -> listing projection
 -> optional listing welcome/claim/image-permission work in AIRE
```

Separately:

```text
same canonical organisation/place
 -> AIRE commercial classification
 -> commercial research if relevant
 -> buyer/contact research if warranted
 -> commercial communication under sales policy
```

The two routes may coexist but neither implies the other.

Public Resources phone exposure remains prohibited; phone/contact data may be retained internally for governed commercial/operational use.

## 24. Provider/evidence reuse

The platform should avoid rebuying or re-fetching the same evidence.

Principles:

- exact provider IDs and evidence references are reused cross-product where licensing allows;
- fresh first-party document cache may be reused;
- stale documents should prefer HTTP revalidation;
- one crawl may serve multiple extractors;
- one provider request should request only the highest justified field tier;
- known negative evidence should suppress pointless immediate retries within its governed freshness window;
- provider usage/cost is recorded against purpose and request.

AIRE's dedicated database may hold durable work state, execution results, commercial memory and cache metadata. Large raw binaries such as PDFs should not be stored indefinitely in ordinary Postgres merely because AIRE executed the fetch; retain metadata/evidence/hash and use suitable object storage if long-term binary retention is required.

## 25. Capacity and operational scaling

The platform must scale by reducing work before adding compute.

Order of operations:

1. reuse existing evidence;
2. classify/rule out work deterministically;
3. crawl verified first-party sources;
4. use provider lookups only for explicit gaps;
5. use AI only for unresolved/high-value interpretation;
6. research contacts only after commercial relevance;
7. execute communications only after purpose/policy.

Large cohorts should run through durable checkpointed work, not synchronous request chains.

Scale controls include:

- bounded worker concurrency;
- per-origin crawl limits;
- provider-specific rate limits;
- cost ceilings;
- retry/backoff;
- pause switches;
- idempotency;
- lease/claim semantics;
- progress accounting;
- cohort disposition accounting;
- telemetry by requests, bytes, provider calls, AI calls and results.

## 26. Full-estate processing principle

The current 18,507 Google Place IDs are a **discovery estate**, not 18,507 confirmed venues and not 18,507 prospects.

A future estate run must be able to account for every record through stages such as:

```text
observation
 -> identity status
 -> entity classification
 -> evidence gaps
 -> product dispositions
 -> commercial disposition
 -> next action
```

Possible exits:

- irrelevant -> STOP;
- unresolved -> identity/evidence review;
- Resources-relevant -> Resources route;
- commercially relevant -> bounded commercial route;
- both -> both routes independently;
- neither -> no further work.

The cohort must reconcile back to the input count; records do not silently disappear.

## 27. Data ownership matrix

| Data / state | Canonical owner |
|---|---|
| Canonical entity identity | Nexus |
| Provider/external references | Nexus |
| Shared evidence/proposed facts | Nexus |
| Canonical event/venue/artist/org relationships | Nexus |
| Research execution/work status | AIRE |
| Provider/model usage/cost | AIRE |
| Commercial fit/readiness/lifecycle | AIRE |
| Buyer/contact commercial intelligence | AIRE |
| AIRE communication/approval/delivery state | AIRE |
| LTH editorial/publication state | LTH |
| Ticket Report editorial/publication state | Ticket Report |
| Prestige Global discovery presentation/state | Prestige Global |
| Resources listing/claim/enquiry state | Event Suite |
| Event Suite tenant/customer operational state | Event Suite |
| Advisory portfolio recommendations | Prestige Intelligence |

Some product-originated facts may be proposed back to Nexus; ownership remains determined by fact type, not by where the fact was first observed.

## 28. Current-to-target alignment

### Already aligned / implemented foundations

- Nexus cross-product ownership contract;
- AIRE as external research execution boundary;
- Nexus research/source-discovery contracts;
- shared deterministic crawler;
- multiple extractors including EVENTS;
- Google Places evidence controls;
- Companies House research;
- Apollo people research;
- OpenAI selective research/composition;
- public-web research;
- commercial memory and prospecting;
- supervised Composer;
- incoming lead policy;
- LTH proven graph discovery donor;
- Ticket Report regional publishing foundation direction;
- Prestige Global consumer-only canonical boundary.

### Needs alignment/implementation

- broaden AIRE top-level charter beyond revenue-only wording;
- durable generic work/graph-expansion orchestration;
- explicit product-disposition routing;
- explicit shared event-discovery lane;
- shared provider/source registry/policies where contracts require them;
- listing/claim/image-permission communication workflows;
- delivery/reply feedback;
- response-to-evidence loop;
- Ticket Report and Prestige Global shared acquisition consumption;
- capability-by-capability LTH parity/cutover;
- production activation and worker architecture for currently gated Nexus execution.

This is therefore primarily alignment plus missing orchestration/integration, not a rewrite of the working cores.

## 29. Delivery sequence

The target architecture should be delivered in coherent phases without skipping current proof work.

### Phase 0 — architecture alignment

- adopt this PRD;
- update product charter and agent preflight;
- no runtime changes.

### Phase 1 — disposition/routing contract

- observation can exist without prospect creation;
- entity/source/product/commercial dispositions are separate;
- machine-readable next action;
- no large estate execution yet.

### Phase 2 — durable work orchestration

- idempotent work model;
- leases/checkpoints/retries;
- graph-expansion budgets;
- provider/model usage telemetry;
- production execution activation only after explicit gates.

### Phase 3 — shared event-discovery pipeline

- formalise structured-provider + first-party event acquisition;
- use LTH donor capabilities without disrupting LTH;
- establish Nexus event/entity relationship handoffs;
- prove with Ticket Report / Prestige Global consumer paths.

### Phase 4 — Resources operational communications

- listing welcome;
- claim;
- image permission;
- data verification;
- purpose-scoped policy/suppression;
- deterministic templates by default.

### Phase 5 — commercial handoff and engagement

- commercial disposition consumes canonical/product evidence;
- buyer/contact research only when warranted;
- Composer -> approval -> controlled delivery.

### Phase 6 — response intelligence

- provider delivery events;
- unsubscribe/bounce/suppression;
- inbound reply ingestion;
- governed reply-to-evidence and next-action flow.

### Phase 7 — LTH shared-path parity and controlled cutover

- dual-run;
- acceptance-based parity;
- capability-by-capability cutover;
- preserve editorial sovereignty.

### Phase 8 — estate and market scale

- process large discovery estates;
- multi-market event graph expansion;
- controlled provider/AI budgets;
- Ticket Report and Prestige Global continuous acquisition;
- ongoing Resources/commercial routing.

Phases may overlap only where dependencies are proven and scope remains coherent.

## 30. Explicit non-goals of this PRD

This document does not:

- authorise the 18,507-place run;
- authorise new Google/provider spend;
- activate production Nexus executor;
- change current LTH production ingestion;
- create migrations;
- change legal/compliance policy;
- declare final communication consent rules;
- define final enum names;
- replace detailed product-specific PRDs;
- turn Nexus into an execution engine;
- turn AIRE into canonical truth;
- turn product repositories into shared research engines.

## 31. Acceptance for future implementation work

A future AIRE/platform change is architecturally aligned only if it can answer:

1. What workflow purpose caused this work?
2. What stable subject/entity/ref does it concern?
3. Who owns the resulting truth/state?
4. Which provider/tool is allowed and why?
5. What evidence already exists and can be reused?
6. What are the request/cost/freshness/expansion limits?
7. Does this work create new graph nodes/edges?
8. If so, what bounds follow-on work?
9. Which products care, independently?
10. Is there a commercial implication, independently?
11. Is AI actually needed?
12. Does any external communication have an explicit purpose/policy?
13. What stops, retries, defers or escalates the workflow?
14. What evidence/result is persisted and where?
15. Can the change be introduced without disrupting an already-proven product path?

If these questions cannot be answered, implementation should stop at the smallest architecture/contract decision needed rather than inventing a parallel mechanism.
