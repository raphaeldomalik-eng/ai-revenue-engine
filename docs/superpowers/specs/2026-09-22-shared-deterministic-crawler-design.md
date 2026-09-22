# Shared Deterministic First-Party Crawler Design

## Outcome

AI Revenue Engine will host one production-quality, market-neutral first-party crawl runtime. It will preserve the Resources behavior merged in PR #37 while adding the portable event-discovery behavior proven in Last Train Home. Last Train Home remains a read-only donor and is not cut over in this slice.

## Scope contract

### Must

- Keep `nexus.source-discovery-request.v1` and `nexus.source-discovery-result.v1` as the external boundary.
- Preserve public HTTPS validation, credential rejection, DNS/IP validation, IPv4/IPv6 reserved-range rejection, DNS pinning, redirect revalidation, robots enforcement, bounded fetches, source hashing, and persisted replay.
- Produce one bounded fetched-document set and run requested identity, contact, venue, image, and event extractors over that set.
- Add same-origin event-source scoring and likely event-detail discovery without unrestricted crawling.
- Normalize schema.org `Event` and `MusicEvent` evidence without inventing missing values.
- Produce deterministic event fingerprints and suppress semantic duplicates.
- Preserve warnings and complete internal crawl telemetry, including retries.
- Prove parity with neutral cases derived from the LTH donor and preserve PR #37 regressions.
- Prove the runtime on Preview with an already-approved first-party source and verify replay.

### Must not

- Modify Last Train Home, Event-project, Prestige Nexus, Ticket Report, publication paths, or product UI.
- Add AI/model extraction, OpenAI, Apollo, Google images, a new queue, a new service, or a new canonical store.
- Accept HTTP, cross-origin crawl expansion, embedded credentials, unsafe redirects, or private/reserved network targets.
- Publish Resources or discovered events, activate Production, or apply LTH editorial policy.

### Deferred

- LTH dual-run and cutover.
- Ticket Report consumption.
- Image licensing decisions.
- Publication and editorial workflows.
- Broader unresolved-venue acquisition.

## Capability map

### AI already has

- Strict public HTTPS and network safety with DNS pinning.
- Same-origin redirect checks, robots, request/page/byte/redirect/retry/time/delay limits.
- Reusable fetched documents, source hashes, warnings, and crawl statistics.
- Identity, public-contact, venue-fact, image, and JSON-LD event extraction.
- Nexus V1 contracts and idempotent result persistence.
- Resources website acquisition and direct/facility-operator verification.

### LTH donor adds

- Explicit event-source ranking and source-page bounds.
- Likely event-detail discovery when a source page contains links rather than JSON-LD events.
- Stronger Event/MusicEvent field normalization.
- Stable candidate hashing that excludes observation time.
- Semantic deduplication by canonical event URL or normalized title/date/venue.
- Proven malformed JSON-LD and missing-optional-field behavior.

### Overlap

- URL canonicalization, private-address rejection, redirect validation, robots, bounded fetches, JSON-LD traversal, source hashing, warnings, and statistics.

### LTH-specific — do not port

- HTTP acceptance, London rules, LTH database access, entity/site IDs, profile eligibility, provider ingestion, Ticketmaster storage, listing matching, venue materialization, Gig Review, editorial state, and publication/indexability rules.

## Architecture

```text
Nexus source-discovery request
        ↓
safe network + bounded crawl core
        ↓
immutable fetched-document set
        ↓
same-origin link planner
        ↓
focused deterministic extractors
  ├─ identity
  ├─ public contacts
  ├─ venue facts
  ├─ image candidates
  └─ event candidates
        ↓
V1 source-discovery result + idempotent store
```

`crawler.ts` remains the compatibility facade used by the executor. Network policy, HTML primitives, link planning, Resource extraction, and event extraction move into focused modules. No extractor performs network I/O.

## Crawl behavior

The core fetches robots once, then processes a deterministic queue. The verified source is first. Useful Resource links and scored event-source links are added within the same origin and finite page budget. Event source pages that contain no structured event candidates may contribute likely deeper event-detail URLs, also bounded by the request's existing page/request budgets. Every candidate URL is canonicalized and checked against robots before fetching.

Redirects remain same-origin HTTPS. Every redirect target is canonicalized and DNS/IP validated before any request. A DNS answer set is rejected if any address is private or reserved. Requests use the validated pinned addresses when the runtime fetch implementation is not injected by tests.

Robots, redirects, retries, byte limits, request delay, timeout, request count, page count, bytes, blocked count, and warnings remain explicit. Internal stats retain retry count; the unchanged Nexus V1 summary continues exposing its established fields.

## Event extraction and identity

JSON-LD is the primary event evidence. Nested graphs and arrays are traversed for `Event` and `MusicEvent`. A candidate requires a non-empty title and start date. Optional end date, location name, performers, organiser, ticket URL, price text, image URL, event status, description, timezone, category, and age restriction remain null or empty when absent.

The stable fingerprint excludes `observedAt`, crawl order, and transient page state. It hashes normalized evidence fields. Semantic duplicate identity is:

1. canonical first-party event URL when present; otherwise
2. normalized title + normalized start date + normalized venue text.

When duplicate pages describe the same event, the first deterministic queue occurrence wins. Event source and detail URL scoring is deterministic, same-origin, and lexical as the final tie-breaker.

Malformed JSON-LD never creates a candidate. It adds a bounded extraction warning while leaving other documents and extractors usable.

## Resource preservation

Identity, contact, venue-fact, and image extraction retain PR #37 output shapes and evidence references. Facility/operator verification continues to consume the same identity facts, including labelled addresses and facility-page descriptions. Images remain `PERMISSION_REQUIRED`; events remain evidence candidates and are never published.

## Intentional differences from LTH

- HTTPS only rather than HTTP/HTTPS.
- Same-origin redirects rather than adopting a redirected external origin.
- Existing Nexus crawl budgets rather than LTH-specific source/detail limits.
- Existing Nexus event shape rather than LTH listing/provider fields.
- No editorial, persistence, listing-match, or publication behavior.

These differences are stricter or more general and do not weaken donor safety or deterministic extraction.

## Verification

- Neutral parity fixtures cover safe/unsafe URLs, mixed DNS answers, redirects, robots denial, source ranking, detail discovery, Event and MusicEvent JSON-LD, malformed JSON-LD, missing optional values, stable hashes, semantic duplicates, retries, response limits, and finite budgets.
- Existing PR #37 tests cover Place Details acquisition, direct and facility/operator verification, contacts, source discovery, semantic idempotency, replay, and strict unresolved outcomes.
- A bounded Preview smoke uses SSISA's already-approved first-party URL, validates the V1 output, confirms all extractors consume one document set, and replays the same request without another crawl.

## Release boundary

The slice ends with one AI Revenue branch and PR ready for review. Production remains fail-closed. No consumer is cut over and no content is published.
