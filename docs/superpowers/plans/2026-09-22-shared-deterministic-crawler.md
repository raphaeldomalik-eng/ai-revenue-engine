# Shared Deterministic First-Party Crawler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate AI Revenue's Resources source discovery and the portable LTH event-discovery behavior into one safe deterministic crawler.

**Architecture:** Keep `crawler.ts` as the executor-facing facade while extracting network policy, HTML/link planning, Resource extractors, and event extraction into focused modules. One bounded crawl returns immutable documents that all requested extractors consume, and the existing Nexus V1 contracts remain the external boundary.

**Tech Stack:** TypeScript, Node.js network/crypto APIs, Node test runner, Next.js 15.

**Spec:** `docs/superpowers/specs/2026-09-22-shared-deterministic-crawler-design.md`

## Global Constraints

- Work only in `raphaeldomalik-eng/ai-revenue-engine` on `codex/shared-deterministic-crawler`.
- Treat Last Train Home as read-only and do not modify other repositories.
- Keep Nexus source-discovery request/result V1 and existing executor persistence.
- Require public HTTPS, same-origin crawling, SSRF protection, robots compliance, and finite budgets.
- Do not add model calls, publication, production activation, or new inventory.
- Write every behavior test first and observe the expected failure before implementation.

## Review Focus

- Mixed public/private DNS answers must reject the target before fetching.
- A high-scoring source page with no JSON-LD must discover only bounded same-origin event details.
- Observation time must not change event fingerprints or duplicate identity.
- Malformed JSON-LD must warn without suppressing valid extraction from other scripts/documents.
- Resource extractors must preserve evidence and output while sharing the same fetched documents.

---

### Task 1: Safe crawl core and compatibility facade

**Files:**
- Create: `src/nexus/source-discovery/types.ts`
- Create: `src/nexus/source-discovery/network.ts`
- Modify: `src/nexus/source-discovery/crawler.ts`
- Test: `tests/source-discovery-parity.test.ts`

**Interfaces:**
- Produces: `CrawlBudget`, `FetchedDocument`, `CrawlStats`, `CrawlOutput`, `canonicalHttpsUrl`, `assertPublicNetworkTarget`, `robotsAllows`, and `crawlVerifiedSource`.
- Preserves the exports currently imported by `executor.ts`, `public-web.ts`, and existing tests.

- [ ] **Step 1: Write failing safety and budget parity tests** for credential URLs, IPv4/IPv6 reserved ranges, mixed DNS responses, redirect revalidation, robots denial, retries, response bytes, and exact request/page limits.
- [ ] **Step 2: Run `npm test -- --test-name-pattern="shared crawl safety|shared crawl budgets"`** and confirm failures identify missing extracted-core behavior or telemetry.
- [ ] **Step 3: Extract types and network policy** without changing public behavior; keep pinned DNS and same-origin redirects.
- [ ] **Step 4: Make robots requests and retries contribute consistently to internal statistics** and retain bounded warnings/status.
- [ ] **Step 5: Run the focused parity tests and existing Nexus source-discovery tests** until green.
- [ ] **Step 6: Commit the coherent core checkpoint.**

### Task 2: Deterministic source and detail link planning

**Files:**
- Create: `src/nexus/source-discovery/html.ts`
- Create: `src/nexus/source-discovery/links.ts`
- Modify: `src/nexus/source-discovery/crawler.ts`
- Test: `tests/source-discovery-parity.test.ts`

**Interfaces:**
- Consumes: canonical same-origin URLs and fetched documents from Task 1.
- Produces: `discoverUsefulSourceUrls(document, extractors)` and `discoverLikelyEventDetailUrls(document)` with stable score/lexical ordering.

- [ ] **Step 1: Write failing LTH-derived source-ranking and event-detail tests** with external, shallow, date-signalled, duplicate, and irrelevant links.
- [ ] **Step 2: Run the focused tests** and confirm detail discovery is absent or incorrectly ordered.
- [ ] **Step 3: Implement shared HTML primitives and deterministic link planners** with no network access.
- [ ] **Step 4: Integrate source/detail planning into the finite crawl queue** so detail pages cannot bypass request, page, origin, or robots limits.
- [ ] **Step 5: Run focused and existing crawler tests** until green.
- [ ] **Step 6: Commit the link-planning checkpoint.**

### Task 3: Focused Resource and event extractors

**Files:**
- Create: `src/nexus/source-discovery/extractors/resources.ts`
- Create: `src/nexus/source-discovery/extractors/events.ts`
- Modify: `src/nexus/source-discovery/crawler.ts`
- Modify: `src/nexus/executor.ts`
- Test: `tests/source-discovery-parity.test.ts`
- Test: `tests/nexus-executor.test.ts`
- Test: `tests/public-web.test.ts`

**Interfaces:**
- Consumes: `FetchedDocument[]` and requested extractor names.
- Produces: identity facts, public contacts, venue facts, image candidates, event candidates, evidence references, and extraction warnings.

- [ ] **Step 1: Write failing Event/MusicEvent normalization tests** for nested graphs, organiser, performers, numeric price, status, description, image, missing optional facts, and malformed JSON-LD warnings.
- [ ] **Step 2: Write failing fingerprint/deduplication tests** proving different observation times are stable and canonical URL or title/date/venue suppresses duplicates.
- [ ] **Step 3: Run focused tests** and confirm the unstable current fingerprint and missing warnings fail.
- [ ] **Step 4: Implement the event extractor** with stable semantic identity, deterministic hashes, and no invented values.
- [ ] **Step 5: Move existing identity/contact/venue/image extraction into the Resource extractor** without changing output shapes.
- [ ] **Step 6: Fan all requested extractors over the single document array** and attach each fact to its own deterministic evidence reference.
- [ ] **Step 7: Run parity, executor, public-web, and all PR #37 regression tests** until green.
- [ ] **Step 8: Commit the extraction checkpoint.**

### Task 4: Whole-slice validation and Preview proof

**Files:**
- Modify only if evidence requires: files already listed above.
- Verify: AI Revenue test/build configuration and Preview route.

**Interfaces:**
- Consumes: existing Nexus V1 source-discovery request and result.
- Produces: one reviewable branch/PR with bounded live evidence.

- [ ] **Step 1: Run `npm run check`** and fix only slice-related failures using failing regression tests first.
- [ ] **Step 2: Inspect the final diff** for LTH/editorial/publication/Production or unrelated changes.
- [ ] **Step 3: Push one coherent branch checkpoint and create one PR** against `main`.
- [ ] **Step 4: Wait for Preview and PR checks** and resolve any slice-related failures in the same branch/PR.
- [ ] **Step 5: Dispatch the existing bounded SSISA source-discovery request twice through Preview.**
- [ ] **Step 6: Prove one persisted result, validated V1 output, one crawl execution, shared extractor output, and no replay refetch.**
- [ ] **Step 7: Verify Production remains fail-closed and no Resources/events/publication writes occurred.**
- [ ] **Step 8: Report `SHARED_CRAWLER_PROVEN` only if parity, regressions, Preview, replay, and safety gates all pass.**
