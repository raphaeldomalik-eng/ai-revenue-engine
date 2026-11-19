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
- Stable alias: `ai-revenue-engine-pearl.vercel.app`.
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

Activation is a new specific default-off `NEXUS_COMMUNION_EVENTS_ENABLED=true`;
`NEXUS_SOURCE_DISCOVERY_ENABLED=false` stays false. No activation value has been
set by the implementation task. Existing other flags/policies remain unchanged.

The signed existing LTH request advertises 100 pages/150 requests. This exception
accepts that shape but bounds actual work to one page, at most six HTTP requests,
the existing 2 MB/response, five redirects, two retries and 30-second timeout
ceilings, and the exact `www.communionmusic.co.uk` host. External ticket links are
observed, never followed. Existing robots, public-DNS and certificate checks stay.

The deployed one-use batch reservation/receipt RPCs and result table are reused
under Communion-specific keys. Concurrent duplicates and changed semantics under
one key cannot reopen execution. A successful replay requires the separate marker
written after usage receipt completion. Receipt uncertainty stays consumed and
returns a hold, with no recrawl/refund. Existing SQL is unmodified. LTH's deployed
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

## Protection decision still required

Current project protection is `all_except_custom_domains`. The registered domain
inventory contains only the protected `ai-revenue-engine-pearl.vercel.app`; there
is no existing custom Production domain to reuse.

[Vercel automation bypass](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)
is a project credential covering all deployments, not a route credential. No
token has been issued, copied or enabled by this task. The PM's read-only LTH
metadata check found URL/HMAC/bypass/version settings only in Preview, none in
Production. The Preview bypass's AIRE binding was not read or inferred.

Two concrete access choices for the human:

1. Authorise a dedicated project-scoped automation credential for the existing
   LTH client, acknowledging its project/all-deployments protection access. Keep
   application HMAC and this exact Communion scope. This is a wider credential
   authority than a route-only request and needs explicit permission.
2. Prefer a short-lived identity path: authorise
   [Trusted Sources](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/trusted-sources)
   only from LTH project `prj_ZHdJk43l95Ep2lRr1i2EDsl0e0w5` Production to this
   AIRE project Production. Its existing LTH owner must forward the OIDC token
   header. This still grants environment-level deployment access, not route-only
   access, but avoids a shared long-lived all-deployments secret. No development,
   Preview, custom-environment or unrelated caller grant is proposed.

Neither choice disables project protection. If neither permission is acceptable,
leave the remote controls untouched; strict route-only credential authority is
not offered by the existing automation header. Do not claim this is resolved by
an OPTIONS allowlist or by adding a domain exception.

## Exact firewall, activation and recovery sequence

Current active firewall config is version 1, `waf_nthb9eIxd5XY`; its only scoped
execution hold is `rule_email_first_code_release_execution_hold_IYbHGh`, denying
the path prefix `/api/integrations/nexus/execute`.

After the human approves the exact reviewed source head, target and access choice:

1. Reconfirm stable Production alias/source, project/team and current firewall
   version; save the current rule for exact rollback. Confirm existing result and
   reservation/receipt tables/RPCs before executing. No migrations are required.
2. Build/stage this release branch head with Production configuration, keeping
   general discovery false. Do not promote a Preview build or deploy main.
3. Stage the narrow deny-rule replacement: deny the existing execute prefix when
   **host differs from the stable alias OR method differs from POST OR path
   differs from exact `/api/integrations/nexus/execute`**. All unrelated rules stay
   byte-for-byte unchanged. Thus other hosts, immutable URLs and prefix suffixes
   retain the hold; only the stable alias's exact POST can reach application auth.
4. Set only the Communion activation flag, stage/rebuild as necessary, capture
   the exact deployment ID/source, and promote under the approved release target.
   Apply the reviewed exact firewall exception and approved protection path.
5. Using existing secrets securely, verify a real bounded signed Communion call,
   its durable receipt and zero-network replay. Verify missing/invalid/stale
   signature, wrong product/entity/source/extractors, research and unregistered
   venue-email requests fail without external work. Immutable hosts retain deny.
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

This packet records preparation, not live acceptance or a human sign-off. No
Production code, activation, firewall, protection, domain or LTH setting has been
changed during preparation. The exact PR head and selected access permission must
be included in the human's release approval; no generic activation is requested.
