# Resources identity corrections — retained evidence

This slice corrects the three R02 identity false negatives reproduced by the
Resources V2 forensic audit of 2 November 2026. AIRE gathers and assesses source
evidence; Nexus retains canonical identity/classification and EventSuite retains
contact routing and publication authority.

## Scope and source

- MUST: reuse the existing subject/site association and fetched identity evidence;
  recognize corroborated page titles and a shortened name with a trailing branch
  qualifier; record the exact property proof URL in verification signals.
- MUST NOT: change HTTP budgets, provider spending, queues, extractor rules,
  canonical/publication authority, rejection memory or Nexus PR #120/#121.
- DEFER: historical quarantined-result reconsideration and any Production
  execution or release. This change does not evict terminal cached results or
  restore contacts that were manually rejected.

The committed fixture retains the audit's subject/request bindings, source URLs,
identity values, evidence references and relevant contact observations. It is a
selected subset of `identity-unresolved-evidence.json` and
`evidence/offline-probes.json` from `resources-forensic-audit-20261102`. It contains
neither credentials nor raw HTML. The signed integration tests reconstruct minimal
HTML from those facts to exercise the real extractor and handlers; reconstructed
HTML is not represented as the original page bytes or a live-site measurement.

## Exact before and after

Base main: `4b5dfdb8ca2756fdb5fcdd41db348b5f1c7da652` (PR #114).
The new regression on an untouched copy of this main failed all three retained
positive identity assessments and all three corresponding signed handoffs.
The same final regression file produced 14 passed and 6 failed on main; all 20
pass with the correction.

| Retained venue | Before | Corroborated proof | After |
|---|---|---|---|
| Clapham Grand | `NO_SAME_ENTITY_IDENTITY_EVIDENCE`; signed result `UNVERIFIED` | `The Clapham Grand – Private Hire \| Clapham Grand` and `SW11 1TT` on `https://claphamgrand.com/private-hire/` | `VERIFIED_DIRECT`; same-crawl `info@claphamgrand.com` handoff |
| Amazing Grace London Bridge | `NO_SAME_ENTITY_IDENTITY_EVIDENCE`; signed result `UNVERIFIED` | `Amazing Grace` and `SE1 9RY` on `https://amazinggraceldn.com/contact-london-bridge/`; missing trailing branch words are in that path | `VERIFIED_DIRECT`; same-crawl `booking.londonbridge@amazinggraceldn.com` handoff |
| The Half Moon, Putney | `NO_SAME_ENTITY_IDENTITY_EVIDENCE`; signed result `UNVERIFIED` | `The Half Moon Putney \| Live Music Venue & Pub in London` and `SW15 1EU` on `https://www.halfmoon.co.uk/` | `VERIFIED_DIRECT`; same-crawl off-domain `halfmoon@youngs.co.uk` handoff |

The two omissions were independent: the name verifier did not use page titles or
corroborated branch aliases, and verification-only callers omitted the existing
`SOURCE_CLASSIFICATION` extractor that already supplies `pageTitle`. The fix adds
one bounded proof path to the existing verifier and requests that metadata from
already fetched documents at the existing verification calls.

An additional review regression reproduced an inverted alias: `London Bridge Bar`
with the target name only in `/amazing-grace/`. It is rejected. The fetched page
must establish the name prefix; the path can supply only the trailing qualifier.

## Preserved protections and verification

Seven retained negative cases remain unverified: Boom Battle Bar O2, Mr Fogg's
Pawnbrokers, the ambiguous London Marriott root (including its unrelated legal,
recruitment and insurance observations), The Live Room pointing to The Waiting
Room, Hotel du Vin Wimbledon at the group root, Temple Pier pointing to Westminster
Pier, and Drill Shed's conflicting postcode.

Additional regressions cover a postcode borrowed from another property page,
missing/mismatched address proof, a missing branch path, a sibling outside an
accepted branch, an unrelated origin, an empty core name, and the inverted alias.
Existing accepted-association, purpose, recruitment/privacy, property navigation,
extraction and quarantine/terminal-replay tests are retained. The mailbox domain
is never used to reject the legitimate Half Moon operator address.

For each positive case the signed integration asserts the original request
ceiling (at most six mocked HTTP requests), one durable reservation, structured
same-crawl contacts, neutral `UNKNOWN` subjects and
`canonicalIdentityEstablished=false`. Replay executes zero HTTP requests and
does not reserve again. The separate official-website-discovery path also returns
the observed enquiry email. No external websites/providers or Production
databases were contacted for this proof.

Required acceptance commands:

```powershell
node --test --experimental-strip-types tests/resources-identity-audit.test.ts tests/accepted-site-association.test.ts tests/source-discovery-contact-review-reasons.test.ts tests/source-discovery-observed-navigation.test.ts tests/visible-email-extraction.test.ts tests/venue-extraction-defect-regression.test.ts tests/continuous-directory-verification.test.ts
npm run check
node scripts/check-architecture-boundary.mjs
git diff --check
```

Results: the focused selection passed all 79 tests. `npm run check` passed
typecheck, lint, 909 tests (one optional SQL test skipped, zero failed) and the
optimized build/replay-bundle check. A focused read-only review identified the
inverted-alias case above; its failing regression was reproduced and corrected.
The retained fixture values and evidence references were compared with the
original audit source: no mismatches.

## Superseded work and release boundary

Main includes merged PR #86's authoritative Resources PER_RUN budgets and provider
allowance/fallback controls, plus PR #90's v2 result storage and queue-scoped
PER_RUN backoff. Their merge commits are ancestors of the base above. PR #85 was
closed as superseded without merge or conflict resolution; its branch remains.
Unique LTH signed-request and isolated policy-selection requirements are preserved
separately in [issue #115](https://github.com/raphaeldomalik-eng/ai-revenue-engine/issues/115).

This PR changes code and regression evidence only. It contains no migrations,
activation flags, provider allocations, queue changes or Production mutations.
CI/review and the existing protected release process still apply. Production
activation requires the actual authorisation for the exact reviewed target;
this evidence grants none. Existing code-only execution safeguards are preserved.
