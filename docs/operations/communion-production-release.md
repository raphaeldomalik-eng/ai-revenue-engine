# Communion-only AIRE integration release packet

Owner scope: AIRE issue #115, requests 7003700479/7004026477 and the explicit
19 November 2026 owner authorisation in the existing AIRE owner/PM chats. LTH
remains owned by Cursor session `e122bb36-ed2d-4b1a-94a1-21c1ad25d2d9`.

## Source and exact target

- Branch: `codex/communion-only-production`; its reviewed PR head is the release
  candidate. Record that exact SHA and the resulting deployment ID in #115.
- Parent: actual serving Production source
  `0f6826ca36d78dff4a8e27663ce6f2ba7e39650f` (PR #120).
- Current Production/rollback deployment: `dpl_Zr2xCpuLA4KTi9Hs1K4dwdKGrNfg`,
  immutable URL `ai-revenue-engine-o4o3arh76-event-suite-team.vercel.app`.
- Public stable alias: `ai-revenue-engine-pearl.vercel.app`. Preserve its
  execute-prefix deny. Release Communion on its separately approved, protected
  immutable Production hostname.
- Project: `prj_zCAVzqxUl0ucWokSD6BL1WzlHO17`; team:
  `team_7e0dqKmLkWnN0A6MM3GVklEe` (`event-suite-team`). Environment: Production.
- Main `aa178214da0c2db2d08d2439ac6bfe53beab0f8b` includes source-only changes;
  do not deploy main or bundle #123/#125 runtime or migrations. The only reused
  later-main change here is a deterministic clock in an existing test fixture.

Read-back before preparing this packet: stable alias still points to the above
Production deployment, auto domain assignment is false, and main automatic
deployment remains disabled by `vercel.json`. Recheck before promotion.

## Application boundary and evidence

MUST: authenticate the existing `timestamp.body` HMAC with the existing secret,
validate the envelope/contract, then admit only `last_train_home`, organisation
candidate `last_train_home:communion`, `ORGANISATION`, `EVENTS` alone, and the raw
URL exactly `https://www.communionmusic.co.uk/tickets`. The actor remains the
existing LTH product actor. Query/fragment/port/alternate-host variants, extra
extractors, venue-email goals and injected paid-provider fields are excluded.

MUST NOT: open general source discovery/research, change Resources/venue-email
rules, purchase provider usage, enable rendering, change schema/RLS, mutate live
customer records, send messages to customers, publish events or edit LTH.

Activation uses the default-off `NEXUS_COMMUNION_EVENTS_ENABLED` flag, enabled
only on the scoped release deployment. Keep `NEXUS_SOURCE_DISCOVERY_ENABLED=false`.

The signed existing LTH request advertises 100 pages/150 requests. This exception
accepts that shape but bounds actual work to one page, at most six HTTP requests,
the existing 2 MB/response, five redirects, two retries and 30-second timeout
ceilings, and the exact `www.communionmusic.co.uk` host. External ticket links are
observed, never followed. Existing robots, public-DNS and certificate checks stay.

The deployed one-use batch reservation/receipt RPCs and result table are reused
under Communion-specific keys. Concurrent duplicates and changed semantics under
one key cannot reopen execution. Persist one replay result after the usage receipt
is recorded. Production enforces a unique request ID on the result table. If the
receipt or result write fails, the reservation stays consumed and denies recrawl.
Existing SQL is unmodified. LTH's deployed
client validates result v1, so this exception projects the already-supported v1
response; the retained execution evidence remains v2. Other consumers keep v2.

Focused acceptance: 60 passed, including actual route, HMAC/scope negatives,
v1-compatible events, zero-network replay, concurrency, receipt outage and the
actual deployed SQL migration in isolated PGlite. Required gate: typecheck/lint,
1,020 passed, one optional skip, zero failures, optimized build and replay bundle.
The read-only review's receipt finding was reproduced, corrected and rechecked.
Hosted AIRE project `cdcfmnlmshnustrqficy` is ACTIVE_HEALTHY; read-only schema proof
confirms both existing RPCs exist with service-role execution and no anonymous or
authenticated execution. No hosted schema or data was changed for this proof.

One initial local actual-route test used the pinned HTTPS transport instead of
its intended fetch stub and made a Communion-only read (148 event observations,
within the enforced six-request limit; exact live HTTP count was not retained).
Persistence was mocked; no paid provider/Production state was touched. The final
route test stubs HTTPS, DNS and persistence and performs no external HTTP.

## Deployment protection and caller

AIRE uses Vercel Standard Protection (`all_except_custom_domains`). The public
stable alias serves requests without Vercel authentication. The approved
immutable Production hostname must require Vercel authentication.

Use [Vercel Trusted Sources](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/trusted-sources)
only from LTH project `prj_ZHdJk43l95Ep2lRr1i2EDsl0e0w5` Production to AIRE
Production. The LTH owner forwards the short-lived
`x-vercel-trusted-oidc-idp-token` header and the existing HMAC signature.
Trusted Sources grants access at the environment level. The firewall restricts
the Nexus execute route to the approved hostname, method and path, and AIRE
enforces the exact signed Communion payload. Keep project protection enabled.

## Exact firewall, activation and recovery sequence

The full execution hold in firewall config `waf_nthb9eIxd5XY` belongs to
`rule_email_first_code_release_execution_hold_IYbHGh`. It denies the prefix
`/api/integrations/nexus/execute`. Confirm the live version before editing.

Stage under the full hold, then apply access after the exact hostname and
release commit are approved:

1. Reconfirm stable Production alias/source, project/team and current firewall
   version; save the current rule for exact rollback. Confirm existing result and
   reservation/receipt tables/RPCs before executing. No migrations are required.
2. Stage the exact reviewed release head as a Production deployment with
   `--skip-domain` and the deployment-scoped flag
   `NEXUS_COMMUNION_EVENTS_ENABLED=true`. Keep general discovery false. Verify
   the immutable hostname requires Vercel authentication and record its SHA and
   deployment ID in #115 before seeking or applying exact-host authority.
3. Stage the narrow deny-rule replacement: deny the existing execute prefix when
   **host differs from the approved immutable hostname OR method differs from POST OR path
   differs from exact `/api/integrations/nexus/execute`**. All unrelated rules stay
   in place. The public alias and every other hostname retain the full hold.
4. Apply the Production-to-Production trust rule and publish the reviewed
   firewall diff. Confirm the public alias still returns the firewall denial and
   the exact pinned POST requires Vercel identity. Leave the public alias on its
   existing release when releasing Communion on the protected hostname alone.
5. Using existing secrets securely, verify a real bounded signed Communion call,
   its durable receipt and zero-network replay. Verify missing/invalid/stale
   signature, wrong product/entity/source/extractors, research and unregistered
   venue-email requests fail without external work. Verify the hold on other
   hostnames and on wrong methods and paths at the pin.
   Do not write credentials in logs, comments, URL query strings or artifacts.
6. Post deployed source/target, runtime statuses/counts, receipt/replay proof and
   the remaining LTH configuration dependency in #115. Only then does the LTH
   owner configure its Production consumer and perform its import.

Rollback first restores the original full execute-prefix firewall deny, then
disables the specific Communion flag and any newly granted access. Return the
stable alias to the recorded old Production deployment if needed. Keep project
protection and immutable target protection on. Preserve result/reservation/usage
records, including uncertainty; never refund/delete them to permit another crawl.
Because there is no schema change, application rollback requires no DB restore.

## Rotate the pinned URL with AIRE releases

Each new AIRE deployment has a different immutable hostname. Record and approve
the replacement commit, deployment ID and protected hostname in #115 before
retiring the old deployment. In a coordinated window, pause Communion ingestion,
prepare the new exact-host firewall rule and update the pinned endpoint in the
LTH Production release through its existing owner. Keep the public alias denied
throughout. Verify a real signed request, stored receipt and replay from LTH
Production on the replacement, then resume ingestion and verify the resulting
import. Preserve the prior deployment until acceptance so the owners can restore
both the previous firewall host and LTH pin if a rollback is required. Record the
final AIRE and LTH commits, active hostname and verification in #115.
