# Master crawler quality pilot — 28 September 2026

## Method

The existing AIRE `crawlVerifiedSource` fetched public first-party HTTPS pages only. Each site had a ceiling of four HTML pages, six total requests, 750 kB per response, no retries, and a ten-second request timeout. Robots and network safety remained enabled. The old Resource extractor from `origin/main` and the new extractor processed the **same in-memory fetched HTML documents** for each site. The existing event extractor processed the same documents in both cases; no second crawler or persistent fetched-document cache was introduced. Node's system certificate store was used for the pilot. Nothing was sent to Nexus, Resources, staging, or production databases.

The old/new count pairs below are evidence counts, not accuracy scores. Old contacts include unrelated directory vendors and search/comment forms; old spaces and practical facts include broad snippets. New outputs were inspected for representative contacts, room names, capacity statements, rights evidence, and warnings. Counts alone do not establish recall or precision.

| Official site | Status | Pages/requests | Contacts old/new | Spaces old/new | Capacity facts old/new | Practical facts old/new | Images | Rights U/P/R/V | Events | Warnings |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| [Beach Blanket Bohemia](https://beachblanketbohemia.co.za/) · ZA | Complete | 1/2 | 3/4 | 0/0 | 0/0 | 1/1 | 3 | 0/0/3/0 | 0 | 0 |
| [Artscape](https://www.artscape.co.za/) · ZA | Complete | 4/5 | 4/1 | 4/0 | 0/0 | 6/0 | 6 | 6/0/0/0 | 23 | 1 |
| [CTICC](https://www.cticc.co.za/) · ZA | Complete | 4/5 | 8/7 | 4/0 | 0/0 | 18/1 | 41 | 0/0/41/0 | 0 | 0 |
| [Events at NCG](https://www.eventsatncg.co.za/index.html) · ZA | Complete | 4/5 | 7/4 | 4/3 | 1/2 | 7/1 | 205 | 0/0/205/0 | 0 | 0 |
| [Johannesburg Expo Centre](https://expocentre.co.za/) · ZA | Complete | 4/5 | 66/3 | 2/1 | 1/0 | 16/2 | 104 | 104/0/0/0 | 0 | 0 |
| [Southbank Centre](https://www.southbankcentre.co.uk/) · UK | HTTP 403 | 0/2 | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0/0/0/0 | 0 | 1 |
| [Barbican](https://www.barbican.org.uk/) · UK | Complete | 4/5 | 6/2 | 4/6 | 0/0 | 23/1 | 49 | 49/0/0/0 | 0 | 0 |
| [Roundhouse](https://www.roundhouse.org.uk/) · UK | Complete | 4/5 | 5/0 | 4/3 | 4/5 | 18/2 | 66 | 66/0/0/0 | 0 | 0 |
| [National Theatre](https://www.nationaltheatre.org.uk/) · UK | Robots fetch HTTP 403 | 0/1 | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0/0/0/0 | 0 | 1 |
| [Troxy](https://troxy.co.uk/) · UK | Complete | 4/5 | 1/2 | 3/0 | 1/1 | 9/3 | 59 | 59/0/0/0 | 0 | 0 |
| [The Brewery](https://www.thebrewery.co.uk/) · UK | Complete | 4/5 | 7/5 | 4/6 | 2/8 | 24/13 | 105 | 105/0/0/0 | 0 | 2 |

U = `UNKNOWN_RIGHTS`; P = `PERMISSION_REQUIRED`; R = `RIGHTS_RESERVED`; V = `VERIFIED_REUSABLE`. On the nine reachable sites: 33 pages, 42 requests, contacts 107→28, named spaces 29→19, capacity facts 9→16, practical facts 122→24, 638 image candidates (389 U, 249 R), and 23 events. No live page in this sample supplied explicit permission or verified reusable terms; deterministic fixtures cover those states.

## Precision review

- Beach Blanket Bohemia currently has linked public phone and email contacts; both extractors found the same three. The new extractor also found a visibly labelled WhatsApp number on the same official page. The two phone numbers are separately stated there, so both remain evidence, without a spurious cross-page warning.
- Johannesburg Expo Centre's accommodation page lists outside hotels. The old extractor emitted 66 contacts across the fetched set, including hotel reservations and a WhatsApp share link. The new extractor kept the venue's contact endpoint, general email, and phone. The old `capacity` hit referred to years and event counts, so its removal improved precision.
- Search, comments, and newsletter forms are excluded from public-contact output. Barbican's navigable contact endpoint remains. Roundhouse's five old “contact forms” were ordinary page/search form actions, so the new output contains no asserted contact. A relevant Roundhouse hire contact may still require deeper discovery or a different first-party page.
- Named spaces inspected include NCG's Wicket Hall, Barbican Hall and Frobisher Auditoriums, Roundhouse's Main Space and Balcony, and The Brewery's Porter Tun, Smeaton Vaults, and Sugar Rooms. Broad headings such as “Newsletter Signup,” “Don't miss an event,” and “Conference Venue” were removed during the pilot. Counts fell on Artscape and CTICC because the old outputs were broad page snippets, not verified room names.
- Troxy's explicit “capacity of 3,600” and Roundhouse's “capacity of 1,800” retain their full comma-separated values. The Brewery's room list yields the stated counts without making up layouts. Porter Tun is stated as 1,000 on one fetched page and 700 on another; both facts remain, require review, and produce a warning. This could reflect different configurations, which AIRE does not reconcile.
- Artscape has 23 event candidates on the fetched pages. The event extractor was unchanged, and the old/new comparison used that same extractor. Other zero event counts reflect this page budget and fetched page set, not a conclusion that those sites have no events.
- Southbank Centre returned HTTP 403 for the homepage; National Theatre returned HTTP 403 for robots.txt. The crawler stopped or failed closed. These cases were not bypassed and provide no extraction comparison.

## Decision and boundaries

`RENDERED_FALLBACK_NOT_JUSTIFIED`: this pilot did not establish a material fact accessible only through client-side rendering. The observed misses are bounded page selection, ambiguous HTML, or HTTP/robots denial. Browser rendering and a persistent document cache remain deferred. No Event-project, Nexus, LTH, Ticket Report, PI, EGS, or PGLD repository was changed, and no staging or production database write occurred.
