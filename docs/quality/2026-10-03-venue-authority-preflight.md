# Venue authority preflight

READY input: 1368

## Website dispositions
- HEALTHY: 345
- SAFE_RECOVERY_AVAILABLE: 609
- TRANSIENT_NETWORK: 97
- CROSS_DOMAIN_REVIEW: 55
- ROBOTS_BLOCKED: 41
- DEAD_HOST: 84
- STATIC_SHELL: 36
- STALE_PATH_UNRECOVERED: 40
- AUTHORITY_MISMATCH: 61

Immediately crawlable (healthy + safe recovery): 954
Authority review (cross-domain + mismatch + stale + dead host): 240
Robots blocked: 41
Static rendering candidates: 36
Transient retry: 97

## Place continuity
- NO_MOVE_SIGNAL: 1216
- INVALID_PLACE_ID: 123
- OBSOLETE_PLACE_ID: 29
- Provider response HTTP 400: 123
- Provider response HTTP 404: 29

- Field mask: id,movedPlace,movedPlaceId
- SKU: Place Details Essentials (IDs Only)
- Unique READY Place IDs: 1368
- Unique Place IDs queried: 1368
- Follow-up requests: 0
- CUMULATIVE_PROOF_REQUESTS: 2477
- Final-run request count: not provable from the stored instrumentation
- Final-run retries: not provable from the stored instrumentation
- Estimated paid cost USD: 0
- GOOGLE_PLACE_ID_REFRESH_REQUIRED: 152
- INVALID_PLACE_ID means the stored identifier was rejected. It is not retried as a transient failure.
- OBSOLETE_PLACE_ID means Google no longer resolves that stored Place ID. It does not prove the venue closed, moved, or has a successor.
- MOVED_PLACE_LOOKUP_FAILED remains the retryable or unresolved provider/network result.
- EventSuite production writes: 0
- NO_MOVE_SIGNAL means Google returned no successor Place ID. It is not a business-status result.
- Certificate failures are counted inside STALE_PATH_UNRECOVERED.
- An HTTP or host recovery that still ends as a static shell, robots block, or transient response is not an authority projection.
- Safe to bulk crawl now: NO

## Breakdowns
- With Place ID: 1368
- Without Place ID: 0
- Place IDs replaced by a successor: 0
- Multi-hop moves: 0
- Listing-backed: 1362
- Candidate-only: 6
- Stored HTTP: 681
- Stored HTTPS: 687
- ZA: HEALTHY 321, SAFE_RECOVERY_AVAILABLE 579, TRANSIENT_NETWORK 95, CROSS_DOMAIN_REVIEW 51, ROBOTS_BLOCKED 36, DEAD_HOST 84, STATIC_SHELL 34, STALE_PATH_UNRECOVERED 38, AUTHORITY_MISMATCH 60
- GB: SAFE_RECOVERY_AVAILABLE 30, HEALTHY 24, CROSS_DOMAIN_REVIEW 4, STALE_PATH_UNRECOVERED 2, ROBOTS_BLOCKED 5, STATIC_SHELL 2, TRANSIENT_NETWORK 2, AUTHORITY_MISMATCH 1
- Provenance resources_listing_official_website: 1362
- Provenance stored_google_website_uri: 5
- Provenance verified_resources_evidence: 1
- Recovery http_to_https: 494
- Recovery apex_www: 110
- Recovery same_site_homepage: 39
- Failure TRANSIENT: 22
- Failure ROBOTS_UNAVAILABLE: 16
- Failure DNS: 84
- Failure CERTIFICATE: 18
- Failure HTTP_5XX: 10
- Failure TIMEOUT: 49

## Known cases
- Alexandra Palace: ROBOTS_BLOCKED; recovery none; place INVALID_PLACE_ID; url https://alexandrapalace.com/; recovered none
- Tshwane North Outreach: CROSS_DOMAIN_REVIEW; recovery none; place NO_MOVE_SIGNAL; url http://wolmercommunityproject.co.za/; recovered none
- Prinschurch: CROSS_DOMAIN_REVIEW; recovery none; place NO_MOVE_SIGNAL; url http://012central.co.za/; recovered none
- SSISA Conference Centre: SAFE_RECOVERY_AVAILABLE; recovery same_site_homepage; place INVALID_PLACE_ID; url https://ssisa.com/venue-hire/; recovered https://www.ssisa.com/
- Pavilion Conference Centre: STATIC_SHELL; recovery none; place INVALID_PLACE_ID; url https://pavilion.co.za/; recovered none
- Shepstone Gardens: STATIC_SHELL; recovery none; place INVALID_PLACE_ID; url https://shepstonegardens.co.za/; recovered none
- The Empire - Conference and Events Venue in Johannesburg: DEAD_HOST; recovery none; place NO_MOVE_SIGNAL; url https://theempirevenue.co.za/; recovered none
- SSISA Conference Centre: HEALTHY; recovery none; place NO_MOVE_SIGNAL; url https://www.ssisa.com/; recovered none
- Shepstone Gardens: STATIC_SHELL; recovery none; place NO_MOVE_SIGNAL; url https://shepstonegardens.co.za/; recovered none
- Dassie Palace - Lapa & Rest: SAFE_RECOVERY_AVAILABLE; recovery http_to_https; place NO_MOVE_SIGNAL; url http://www.dassiepaleis.co.za/; recovered https://www.dassiepaleis.co.za/
- Country Sjiek: SAFE_RECOVERY_AVAILABLE; recovery http_to_https; place NO_MOVE_SIGNAL; url http://www.countrysjiek.co.za/; recovered https://countrysjiek.co.za/
- The Rose Shed @ Ludwig's Roses: AUTHORITY_MISMATCH; recovery none; place NO_MOVE_SIGNAL; url https://www.ludwigsroses.co.za/; recovered none

Authority projection required: 609
