# Initial inventory HTTP admission

The daily HTTP ceiling is an internal business-volume guard, introduced alongside
100 venues/day and documented as 100 venues / 1,400 HTTP. It is enforced in our
own AIRE SQL admission and reservation functions, not returned by a provider or
hosting service. Hosting throttles, request timeouts and access restrictions remain
independent and must still be honoured.

The owner now exempts initial inventory clearance from both recurring daily
business-volume ceilings. The existing server-derived INITIAL_INVENTORY phase
therefore omits only the daily HTTP volume rejection. It retains actual request
accounting, gross reservation history, uncertain reservation charges, one active
run, run leases, 10 jobs / 140 HTTP per run, 14 HTTP per venue, two concurrent jobs,
host delays, robots/SSRF/redirect/byte/time limits, retries and failure isolation.
The current fenced scheduled worker and its failure/deadline circuit breakers
continue; no new worker, queue, timer or provider allowance is introduced.

The existing immutable initial-inventory snapshot and completion checkpoint own
the phase transition. When initial processing completes, ONGOING_ENRICHMENT
restores the existing 100 venues/day and 1,400 HTTP/day checks automatically.
LEGACY runs also retain their normal daily ceiling. No date rollover or manual
counter reset is used to grant capacity. The previous one-day 2,800 exception is
superseded by this phase-specific policy; provider budgets remain unchanged.

The frozen 100-new-URL experiment remains the same cohort, first-pass only,
including failed cases. Capture actual AIRE results and Product decisions in its
existing private report; do not replace failures or manually advance listings.

Before applying, capture/read back the existing two function definitions and
usage/provider/role invariants. The migration fails closed on unexpected source
drift and is idempotent. Rollback restores those definitions without deleting any
queue, evidence, request counter, reservation or provider history.
