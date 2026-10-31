# Resources V2 standing governance — 31 October 2026

Outcome: continue existing bounded recovery using approved prepaid credits, no repetitive zero-cost expiry windows; deliver Brave credit alerts only to raphael@allxsmedia.com through EventSuite dispatch-message.

MUST: preserve lifetime counters/receipts, exact policy/HMAC/worker fencing, retry guards, venue/page attribution, existing Product-owned consumer and LTH candidate helper. Serper first for missing sites, Brave for unresolved cases. Known URLs/evidence first.
MUST NOT: purchases/top-ups, Google paid/Pro/Enterprise, publication, venue outreach, CRM, payment changes, second crawler/queue/database, reset history or fabricate approvals.
DEFER: broad shared-runtime migration and unrelated release holds.

Policy hash: 5f6ac2ef49b0b74f698405e641b596173d58bf058ad1e95d3187eed46c9a46a4. Standing until revoked. Run: 10 venues / 140 HTTP, day: 100 / 1400, per venue14, host/provider delay1500ms, attempts3/backoff24h. Per run2 Brave /8 Serper, credit spend <=$0.05. Brave $10/month,50/day,$0.50 reserve; Serper $5 lifetime allocation,100/day. Google only existing IDs-only Essentials and paid disabled.

Provider observations (31 October, signed-in dashboards): Brave815 account requests,$4.07 displayed consumed,$5.92 available incl$0.92 free grant expiring1Nov UTC plus$5 purchased non-expiring; auto-reload off. Governed lifetime810 requests/$4.05; five earlier external requests included monthly baseline$4.075. Serper46,197 credits,1,342 account/governed requests; approved5000 total ->3658 remaining. Purchase3Oct, six-month validity inferred3Apr2027; retain conservative expiry until explicit confirmation.

Migration is additive JSON observation/history/alert metadata and replacement RPCs over current tables. Activation is separate: snapshot exact policy/allowance rows, preserve usage counters, update same policy/hash and allowance expiries/ceilings, record actual balances with exact receipt-month baselines. No paid request until both governed and actual balance admit it. No balance API documented; an existing Codex continuation may refresh visible authoritative dashboards and record observations; never invent balance or monthly grant.

Recovery: pause Resources continuation; restore captured policy/allowance configuration without decrementing counters, retain additive metadata and all receipts. Revert application commit if needed. AIRE migration does not itself enable policy or calls. Broad shared/publication flags remain false. Credential values were not printed, committed or transmitted to untrusted destinations. No evidence of exposure requiring rotation.

Nexus AGENTS.md section5 requires independent maintainer approval or exact owner signoff on the implementation PR before Production activation. Prepare CI, invariant snapshot and this rollback packet first; do not substitute bot review for human approval. AIRE code release is independent and may proceed through its existing controls.

Canteen retains queue bca2395e4630a5e395844679fbc0ffad888ebc6a34f56051d3336038022d505c and not-before 2026-11-01T00:10:50.325Z. Renewal is atomic with schedule/attempt guards; no early crawl. LTH source334 =20canonical-linked (19Resourcespublished,1draft) +314nohandoff. Bounded5/cycle stages discovered candidates through existing Product helper; no automatic qualification or publication.

Verification: AIRE typecheck/lint pass;12 real SQL governance tests and13 focused policy/provider/dashboard/API tests pass. Nexus owner-alert7, monitor3, queue8, LTH4, owned-runtime11, recovery4 and consume-only42 focused tests pass. Full local test-isolation override produced environment conflicts; Next build hit Windows spawn EPERM. Existing Linux protected CI is authoritative for full checks.
