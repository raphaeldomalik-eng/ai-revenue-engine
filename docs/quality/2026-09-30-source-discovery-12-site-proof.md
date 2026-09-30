# Source-discovery 12-site execution proof

Label: PREVIEW_EXECUTION_PROVEN. Run at 2026-09-30T03:55:11.845Z. Candidate code, in-memory store, no production deployment. Node was started with --use-system-ca, the same certificate requirement recorded by the 28 September quality pilot.

Selection: the 11 sites in `docs/quality/2026-09-28-master-crawler-quality-pilot.md`, in table order, plus Communion Music from `tests/communion-source-discovery.test.ts`. No site was taken from the 18,507-place estate. No HTTP-only candidate exists in that frozen cohort, so no scheme-upgrade pass was run.

Budget per site: {"maxPages":20,"maxRequests":40,"maxBytesPerResponse":15000000,"maxRedirects":5,"maxRetries":2,"timeoutMs":20000,"minRequestDelayMs":250}. Extractors: IDENTITY, PUBLIC_CONTACT, VENUE_FACTS, IMAGE_CANDIDATES, EVENTS, SOURCE_CLASSIFICATION.

## Sites

| Site | Disposition | Duration ms | Requests | Bytes | HTML | PDF | Stop | Render needed |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| Beach Blanket Bohemia | partial | 1295 | 5 | 140973 | 1 | 0 | NO_GAP_CANDIDATES | 0 |
| Artscape | partial | 6722 | 25 | 879986 | 20 | 0 | PAGE_BUDGET | 0 |
| CTICC | success | 5549 | 14 | 4119055 | 13 | 0 | GAPS_EXHAUSTED | 0 |
| Events at NCG | success | 2434 | 6 | 114999 | 3 | 0 | NO_GAP_CANDIDATES | 0 |
| Johannesburg Expo Centre | success | 20231 | 19 | 1741607 | 13 | 0 | NO_GAP_CANDIDATES | 0 |
| Southbank Centre | review | 375 | 2 | 0 | 0 | 0 | ENTRY_FAILED | 0 |
| Barbican | partial | 3349 | 13 | 1744299 | 12 | 0 | GAPS_EXHAUSTED | 0 |
| Roundhouse | partial | 4126 | 14 | 1983172 | 13 | 0 | GAPS_EXHAUSTED | 0 |
| National Theatre | blocked | 293 | 1 | 0 | 0 | 0 | ROBOTS_UNAVAILABLE | 0 |
| Troxy | success | 6483 | 17 | 961984 | 12 | 0 | NO_GAP_CANDIDATES | 0 |
| The Brewery | partial | 13215 | 18 | 1943782 | 11 | 0 | NO_GAP_CANDIDATES | 0 |
| Communion Music | success | 3994 | 4 | 167058 | 1 | 0 | NO_GAP_CANDIDATES | 0 |

## Aggregate

```json
{
  "sites": 12,
  "medianDurationMs": 4060,
  "p90DurationMs": 13215,
  "maxDurationMs": 20231,
  "averageRequests": 11.5,
  "medianRequests": 13.5,
  "averageBytes": 1149742.9166666667,
  "totalBytes": 13796915,
  "usefulEvidenceYield": 0.8333333333333334,
  "pdfSiteFrequency": 0,
  "pdfDocuments": 0,
  "robotsBlockedRate": 0.08333333333333333,
  "retryRate": 0,
  "totalRetries": 0,
  "renderRequiredRate": 0,
  "sourceInsufficientRate": 1,
  "cacheFreshHits": 0,
  "revalidatedNotModified": 0,
  "dispositions": {
    "success": 5,
    "partial": 5,
    "blocked": 1,
    "review": 1
  }
}
```

Rendering decision: RENDERING_NOT_A_BLOCKER. Zero sites set `renderNeededButUnavailable`, so rendering did not materially block this cohort.

Robots: 10 origins FETCHED, Events at NCG ABSENT (no robots.txt, crawl continued), National Theatre UNAVAILABLE because robots.txt returned HTTP 403 and the crawl stopped before any HTML. Southbank Centre fetched robots, then the HTML entry returned HTTP 403 (`ENTRY_FAILED`, disposition review). No site was `ROBOTS_BLOCKED` by a Disallow rule. The robots-blocked rate in the aggregate counts National Theatre's fail-closed 403 only (1/12).

PDFs: 0 discovered, 0 fetched, 0 bytes, 0 pages, 0 rejected. The frozen quality-pilot cohort is not labelled as PDF-bearing, and this budget did not surface an approved PDF. PDF extraction itself remains covered by the existing crawler tests, including the 15 MB ceiling. No OCR was added.

Cache: this proof supplied no document cache. Fresh hits 0 and 304 reuses 0 are the cold-run result, not a production cache measurement.

`sourceInsufficientRate` is 1 because every site still had at least one requested dimension missing. Useful evidence (identity, contact, venue fact, image, or event) was present on 10 of 12 sites. The two without it are Southbank Centre (HTML 403) and National Theatre (robots 403).

Provider calls are in the JSON report. This sample does not estimate an 18,507 completion time: Nexus has not yet said which records need a crawl. A 12-site timing range only: median 4.1s, p90 13.2s, max 20.2s per site at this budget.
