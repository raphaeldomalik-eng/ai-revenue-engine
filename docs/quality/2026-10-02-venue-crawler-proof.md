# Venue crawler proof — 2 October 2026

Frozen sample: `docs/quality/2026-10-02-venue-crawler-sample.json`.
Machine result: `docs/quality/2026-10-02-venue-crawler-proof.json`.

The crawl used only the authorised official URL for each READY record. No Google, OpenAI, Apollo, Companies House, search, or rendering vendor was called. Paid-provider calls: 0. EventSuite production was not written.

Node was started with `--use-system-ca` so TLS uses the operating-system trust store. Certificate verification stayed on.

## HTTP authority contract

EventSuite may store an official site as `http://` or `https://`. The shared transport fetches public HTTPS only.

- An authorised HTTPS URL is fetched as given.
- An authorised HTTP URL is rewritten to HTTPS on the same host, path, and query. The original URL stays the authority provenance.
- Apex and `www` of that host are the same site.
- A redirect to any other registrable domain is refused.
- Credentials, local hosts, and non-HTTP schemes are refused.
- If HTTPS does not answer, the crawl fails. It does not fall back to cleartext HTTP.

Two stored HTTP records, Country Sjiek and Dassie Palace, upgraded and were fetched on HTTPS. Prinschurch and Tshwane North Outreach also upgraded, then stopped because the HTTPS host redirected to a different registrable domain.

## Per venue

### Country Sjiek — COMPLETED, HTTP upgraded

One page, the homepage. It is a single-page site: Gallery and Enquiry are in-page anchors, and the photos are direct image links. 372 image candidates (336 gallery, 36 other, 1 logo), a general email, a contact form, and outdoor-space evidence. No separate named rooms or capacities are on that page. Manual check: the page does describe a working farm and shows a large photo set.

### Prinschurch — BLOCKED, HTTP upgraded

`http://012central.co.za/` redirects to `www.cityproperty.co.za`. Cross-site redirect refused. No extraction.

### Steynshoop Mountain Lodge — spaces corrected; last full pass timed out

The last script pass recorded `robots.txt could not be checked: fetch failed`. That is a connection timeout, not a robots denial. The same code, minutes earlier, completed the site.

Confirmed spaces from that completed pass, checked against the weddings navigation: Manor House, Valley Suite, Corner Cottage, Gatehouse Cottages, Arbour Cottage, Chapel Cottage, Harmony Hall, and Mountain Lodge. Mountain Lodge is a named lodge area: the conference page says it accommodates up to 9 people. Guest Accommodation is review-only, not a confirmed room. Chapel, Your Wedding Chapel, and Honeymoon Suite are no longer confirmed spaces. Guest Accommodation still carries the explicit “up to 50 people” statement. A false “Dinner 2” reading of “2 x Three-Course Dinner” is no longer kept.

### The Drama Experience — COMPLETED

Homepage only. The visible site is a drama-class studio, not a hire brochure. 21 images and one general email. No rooms or capacities are stated.

### Qurtuba Convention Center — FAILED

Robots fetch failed on the final run (timeout / fetch failed). An earlier attempt in this session did reach the weddings page, the corporate contact page, and an accommodation page before later hotel URLs failed. The final artifact does not treat that earlier attempt as success.

### Pavilion Conference Centre — COMPLETED, not useful

`https://pavilion.co.za/` is a client-rendered shell whose visible text is a holding page ("We're getting things ready"). No venue photos, rooms, or contacts in the static HTML.

### De Toren Private Cellar — COMPLETED

Home, contact, and four conference pages. Address in Stellenbosch. WhatsApp and phone contacts. Wi-Fi and AV evidence. 25 non-logo images. The conference pages do not state named rooms or numeric capacities in the fetched text.

### Tshwane North Outreach — BLOCKED, HTTP upgraded

`http://wolmercommunityproject.co.za/` redirects to `www.tshwanenorthoutreach.co.za`. Cross-site redirect refused.

### Alexandra Palace — BLOCKED

`robots.txt` returned HTTP 403. The crawl stopped. It was not bypassed.

### Assembly Hall Theatre — COMPLETED

Home, contact, venue hire, getting here, accessibility. The hire page states the theatre can seat up to 1,002 people. The venue-hire pack (`Venue_Hire_Pack_2026.pdf`, about 5.2MB) was fetched under the venue PDF ceiling and read. Page 2 states up to 1,010 seated and 1,250 standing. Those counts stay separate from the hire-page 1,002. Parking, public transport, and accessibility evidence remain. The ordinary 1.5MB response cap was not raised.

### St John at Hackney — COMPLETED

Home, venue hire, and about pages. Hire email and phone. 37 non-logo images, including nave photographs. The hire page describes the restored church and does not state a numeric capacity or a separate room list.

### The Rose Shed @ Ludwig's Roses — COMPLETED, weak venue fit

The authorised URL is the rose nursery, not a Rose Shed hire page. The crawl read the nursery about and history pages. 41 non-logo images and many general emails. No Rose Shed room or capacity. This is an authority mismatch, not a missing hire page on this host.

### Dassie Palace — COMPLETED, HTTP upgraded

Home, contact, rooms, gallery. Address in Brits, one general email, and the named room Jakkalsbessie Chalet from the rooms page. The gallery HTML contains the logo and an SVG placeholder, not the room photographs. Those images are not in the static response.

### SSISA Conference Centre — FAILED

Authorised URL `https://ssisa.com/venue-hire/` returns HTTP 404 on `https://www.ssisa.com/venue-hire/`.

### Shepstone Gardens — COMPLETED, candidate-only

Static HTML is a JavaScript shell ("You need to enable JavaScript"). One Open Graph hero image and a meta description. No rooms, capacities, contacts, or gallery in the static document.

### The Empire candidate — FAILED

`https://theempirevenue.co.za` does not resolve (ENOTFOUND).

## Quality dimensions

| Venue | Page selection | Description | Contact | Spaces | Capacity | Practical | Images | PDF | Precision | Provenance |
|---|---|---|---|---|---|---|---|---|---|---|
| Country Sjiek | PASS | PASS | PASS | NOT_APPLICABLE | NOT_APPLICABLE | PASS | PASS | NOT_APPLICABLE | PASS | PASS |
| Prinschurch | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | PASS | PASS |
| Steynshoop | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NOT_APPLICABLE | PASS | PASS |
| Drama Experience | PASS | PASS | PASS | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | PASS | NOT_APPLICABLE | PASS | PASS |
| Qurtuba | FAIL | FAIL | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | FAIL | NOT_APPLICABLE | PASS | PASS |
| Pavilion | FAIL | FAIL | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | FAIL | NOT_APPLICABLE | PASS | PASS |
| De Toren | PASS | PASS | PASS | NOT_APPLICABLE | NOT_APPLICABLE | PASS | PASS | NOT_APPLICABLE | PASS | PASS |
| Tshwane North | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | PASS | PASS |
| Alexandra Palace | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | PASS | PASS |
| Assembly Hall | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| St John at Hackney | PASS | PASS | PASS | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | PASS | NOT_APPLICABLE | PASS | PASS |
| Rose Shed | FAIL | FAIL | FAIL | NOT_APPLICABLE | NOT_APPLICABLE | PASS | PASS | NOT_APPLICABLE | FAIL | PASS |
| Dassie Palace | PASS | PASS | PASS | PASS | NOT_APPLICABLE | PASS | FAIL | NOT_APPLICABLE | PASS | PASS |
| SSISA | FAIL | FAIL | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | FAIL | NOT_APPLICABLE | PASS | PASS |
| Shepstone Gardens | FAIL | FAIL | NOT_APPLICABLE | FAIL | NOT_APPLICABLE | NOT_APPLICABLE | FAIL | NOT_APPLICABLE | PASS | PASS |
| Empire candidate | FAIL | FAIL | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | FAIL | NOT_APPLICABLE | PASS | PASS |

Steynshoop no longer promotes Guest Accommodation, Chapel, or honeymoon-suite marketing lines as confirmed rooms. The real cottage, suite, hall, and manor names remain. Assembly Hall’s hire pack is now extracted inside an 8MB venue-PDF ceiling; HTML and unrelated PDFs stay on the 1.5MB cap. Rose Shed precision still fails because the authorised host is the nursery. Shepstone and Pavilion remain static shells. Dassie image recall still fails because the room photos are not in the static gallery HTML.

## Decision

The two crawler-quality defects in this slice are fixed. The 1,404 estate is still not safe to bulk-crawl.

Remaining blockers, unchanged by this slice:

- AUTHORITY_DATA: Prinschurch and Tshwane North cross-site redirects; Rose Shed nursery URL; SSISA 404; Empire candidate dead DNS.
- ROBOTS_OR_SITE_POLICY: Alexandra Palace robots.txt HTTP 403. Not bypassed.
- STATIC_RETRIEVAL_LIMIT: Pavilion and Shepstone Gardens are JavaScript shells. No renderer was added.
- TRANSIENT_NETWORK: Qurtuba and, on the last pass, Steynshoop and Rose Shed connection timeouts. Not a new retry policy.

Paid-provider calls: 0. EventSuite production writes: 0.
