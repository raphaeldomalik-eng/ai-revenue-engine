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

### Steynshoop Mountain Lodge — COMPLETED

Pages: home, contact, weddings, directions. Description evidence says it is a country hotel in the Magaliesberg with wedding and conference use. Named spaces include Valley Suite, Corner Cottage, Chapel Cottage, and Harmony Hall, plus weaker headings (Honeymoon Suite, Guest Accommodation, Chapel). One capacity: Guest Accommodation 50. Booking email and phones. 25 non-logo images. Airport-direction variants were not fetched.

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

Home, contact, venue hire, getting here, accessibility. Hire page states the theatre can seat up to 1,002 people. Parking, public transport, and accessibility evidence. General email and phone. 5 non-logo images. A venue-hire PDF was discovered and refused because it exceeded the response size limit, so its text was not extracted.

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
| Steynshoop | PASS | PASS | PASS | PASS | PASS | PASS | PASS | NOT_APPLICABLE | FAIL | PASS |
| Drama Experience | PASS | PASS | PASS | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | PASS | NOT_APPLICABLE | PASS | PASS |
| Qurtuba | FAIL | FAIL | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | FAIL | NOT_APPLICABLE | PASS | PASS |
| Pavilion | FAIL | FAIL | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | FAIL | NOT_APPLICABLE | PASS | PASS |
| De Toren | PASS | PASS | PASS | NOT_APPLICABLE | NOT_APPLICABLE | PASS | PASS | NOT_APPLICABLE | PASS | PASS |
| Tshwane North | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | PASS | PASS |
| Alexandra Palace | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | PASS | PASS |
| Assembly Hall | PASS | PASS | PASS | PASS | PASS | PASS | PASS | FAIL | PASS | PASS |
| St John at Hackney | PASS | PASS | PASS | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | PASS | NOT_APPLICABLE | PASS | PASS |
| Rose Shed | FAIL | FAIL | FAIL | NOT_APPLICABLE | NOT_APPLICABLE | PASS | PASS | NOT_APPLICABLE | FAIL | PASS |
| Dassie Palace | PASS | PASS | PASS | PASS | NOT_APPLICABLE | PASS | FAIL | NOT_APPLICABLE | PASS | PASS |
| SSISA | FAIL | FAIL | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | FAIL | NOT_APPLICABLE | PASS | PASS |
| Shepstone Gardens | FAIL | FAIL | NOT_APPLICABLE | FAIL | NOT_APPLICABLE | NOT_APPLICABLE | FAIL | NOT_APPLICABLE | PASS | PASS |
| Empire candidate | FAIL | FAIL | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | NOT_APPLICABLE | FAIL | NOT_APPLICABLE | PASS | PASS |

Steynshoop precision fails because headings such as Guest Accommodation and Chapel are kept beside the real cottage names. Rose Shed precision fails because the nursery's general mailboxes are not a venue-hire contact set. Assembly Hall PDF discovery found the hire pack and then refused it on size, so PDF recall fails. Shepstone fails description and images because the static shell does not contain the venue pages a browser would show. Dassie image recall fails because the room photos are not in the static gallery HTML.

## Decision

Not quality-proven for a bulk crawl of the 1,404. Reachable venue sites with static hire content did return useful description, image, contact, and some space and capacity evidence. The estate also contains cross-site redirects, robots denials, dead hosts, 404 paths, and JavaScript-only homepages. Those must stay failed-closed. Browser rendering was not added: two shells in this sample are not enough to justify a rendering vendor, and no paid renderer was available.
