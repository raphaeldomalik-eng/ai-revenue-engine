import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { extractFromFetchedDocuments } from "../src/nexus/source-discovery/crawler.ts";
import { buildVenueEvidencePackage } from "../src/nexus/source-discovery/venue/evidence.ts";
import type { FetchedDocument } from "../src/nexus/source-discovery/types.ts";
import { acceptVenueEmail } from "../src/nexus/venue-email.ts";

function page(url: string, body: string): FetchedDocument {
  return { url, body, contentType: "text/html", bytes: Buffer.byteLength(body), sourceHash: createHash("sha256").update(body).digest("hex"), observedAt: "2026-10-27T00:00:00.000Z", kind: "HTML" };
}

test("Grizzly Bear address requires and extracts the complete venue address", () => {
  const document = page("https://www.grizzlybearsunbury.co.uk/contact-us/", `<script type="application/ld+json">{"@context":"https://schema.org","@type":"BarOrPub","name":"Grizzly Bear","address":{"@type":"PostalAddress","streetAddress":"101 Nursery Road","addressRegion":"Middlesex","postalCode":"TW16 6LU","addressCountry":"GB"}}</script><div class="address">101 Nursery Road, Sunbury-on-Thames, Middlesex, TW16 6LU</div>`);
  const extraction = extractFromFetchedDocuments([document], ["IDENTITY"], "Grizzly Bear");
  const address = extraction.identityFacts.find((fact) => fact.fieldName === "address");
  assert.equal(address?.value, "101 Nursery Road, Sunbury-on-Thames, Middlesex, TW16 6LU");
  assert.equal(address?.sourceUrl, document.url);
  assert.ok(address?.evidenceRef.startsWith("source:"));
});

test("Faffless complete numbered street address is extracted but generic footer text is not", () => {
  const document = page("https://faffless.co/", `<h1>FAFFLESS</h1><h3>8 Golden Square, Aberdeen, Scotland</h3><footer><nav>About Us Events Contact Food and whisky</nav></footer>`);
  const extraction = extractFromFetchedDocuments([document], ["IDENTITY"], "Faffless");
  const address = extraction.identityFacts.find((fact) => fact.fieldName === "address");
  assert.equal(address?.value, "8 Golden Square, Aberdeen, Scotland");
  const noise = extractFromFetchedDocuments([page("https://venue.example/", `<footer><nav>About 8 Events, Contact Us</nav><p>Our latest news and promotions</p></footer>` )], ["IDENTITY"], "Example Venue");
  assert.equal(noise.identityFacts.some((fact) => fact.fieldName === "address"), false);
});

test("address conflicts remain as separate source-backed observations", () => {
  const document = page("https://venue.example/", `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Place","name":"Example Venue","address":{"@type":"PostalAddress","streetAddress":"8 Golden Square","addressLocality":"Aberdeen","addressCountry":"Scotland"}}</script><div class="address">10 Golden Square, Aberdeen, Scotland</div>`);
  const addresses = extractFromFetchedDocuments([document], ["IDENTITY"], "Example Venue").identityFacts.filter((fact) => fact.fieldName === "address");
  assert.deepEqual(addresses.map((fact) => fact.value), ["8 Golden Square, Aberdeen, Scotland", "10 Golden Square, Aberdeen, Scotland"]);
  assert.ok(addresses.every((fact) => fact.sourceUrl === document.url && fact.evidenceRef.startsWith("source:")));
});

test("Vivian Arms beer garden is a structured, source-backed facility", () => {
  const document = page("https://www.vivianarmspubswansea.co.uk/", `<p>Gastropub in Swansea | Great food and Sunny beer garden</p>`);
  const evidence = buildVenueEvidencePackage(extractFromFetchedDocuments([document], ["VENUE_FACTS"], "Vivian Arms Hotel"));
  const garden = evidence.practicalFacts.find((fact) => fact.fieldName === "outdoorSpace");
  assert.equal(garden?.value, "Sunny beer garden");
  assert.equal(garden?.sourceUrl, document.url);
  assert.ok(garden?.evidenceRef.startsWith("source:"));
});

test("purpose labels qualify published named staff and operator contacts without delivery verification", () => {
  const cases = [
    ["craig@fafflesswhisky.com", "https://faffless.co/contact", "Faffless", "Special requests and larger groups: drop us a note in the contact form. Email Craig at craig@fafflesswhisky.com", "ENQUIRIES"],
    ["lesley@beaconartscentre.co.uk", "https://www.beaconartscentre.co.uk/our-spaces/venue-hire/", "The Beacon Arts Centre", "To discuss venue or space hire further, please email Lesley Davidson at lesley@beaconartscentre.co.uk", "SALES_HIRE"],
    ["bwdvenuesevents@blackburn.gov.uk", "https://bwdvenues.com/your-visit/booking-information/", "King George’s Hall", "For all other enquiries: bwdvenuesevents@blackburn.gov.uk", "ENQUIRIES"],
    ["BwDVenuesBoxOffice@blackburn.gov.uk", "https://bwdvenues.com/about/contact-us/", "King George’s Hall", "Box Office: BwDVenuesBoxOffice@blackburn.gov.uk", "BOX_OFFICE"],
    ["dominic@thebeaconartscentre.co.uk", "https://www.beaconartscentre.co.uk/support-us/corporate-support/", "The Beacon Arts Centre", "For corporate support please contact Dominic at dominic@thebeaconartscentre.co.uk", "CORPORATE_SUPPORT"],
  ] as const;
  for (const [email, url, venue, context, purpose] of cases) {
    assert.equal(acceptVenueEmail(email, url, venue, context).accepted, true, email);
    assert.ok(purpose);
  }
  assert.equal(acceptVenueEmail("jo.smith@events.cornexhall.co.uk", "https://www.cornexhall.co.uk/contact/", "Cornex Hall").accepted, true);
  assert.equal(acceptVenueEmail("studio@agency.example", "https://venue.example/contact/", "Example Venue", "Website designed by Agency").accepted, false);
});

test('different source-published emails retain their actual purpose without a multiple-contact hold',()=>{
 const documents=[page('https://venue.org/contact/', '<p>Email contact: sam@venue.org</p>'),page('https://venue.org/events/', '<p>For venue hire, contact events@venue.org</p>')];
 const r=extractFromFetchedDocuments(documents,['PUBLIC_CONTACT'],'Example Venue');
 const emails=r.publicContacts.filter(c=>c.type==='EMAIL');
 assert.equal(emails.length,2);assert.ok(emails.every(c=>!c.reviewRequired));
 assert.equal(acceptVenueEmail('sam@venue.org','https://venue.org/contact/','Example Venue').accepted,true);
 assert.equal(acceptVenueEmail('office@operator.org','https://venue.org/contact/','Example Venue','Head office').accepted,true);
});

test("the saved Faffless contact context qualifies Craig's published special-requests address", () => {
  const document = page("https://faffless.co/contact", `<p>For any special requests or larger groups, feel free to drop us a note in the contact form, and we’ll take care of the rest.</p><p>Book Your Table Here W-F: 4pm-midnight weekends: midday-midnight</p><p>craig@fafflesswhisky.com</p>`);
  const extraction = extractFromFetchedDocuments([document], ["PUBLIC_CONTACT"], "Faffless");
  const contact = extraction.publicContacts.find((item) => item.type === "EMAIL" && item.value === "craig@fafflesswhisky.com");
  assert.equal(contact?.reviewRequired, false);
  assert.equal(contact?.purpose, "ENQUIRIES");
  assert.equal(contact?.original, "craig@fafflesswhisky.com");
  assert.equal(contact?.sourceUrl, document.url);
});

test("a later purpose-qualified publication supersedes an earlier held duplicate", () => {
  const privacy = page("https://venue.org/privacy/", `<p>Privacy contact: hello@operator.org</p>`);
  const enquiries = page("https://venue.org/contact/", `<p>For venue enquiries, email hello@operator.org</p>`);
  const result = extractFromFetchedDocuments([privacy, enquiries], ["PUBLIC_CONTACT"], "Example Venue");
  const contact = result.publicContacts.find((item) => item.type === "EMAIL" && item.value === "hello@operator.org");
  assert.equal(contact?.reviewRequired, false);
  assert.equal(contact?.sourceUrl, enquiries.url);
  assert.equal(contact?.purpose, "ENQUIRIES");
});
test('nearby designer attribution survives long venue context and cannot inherit venue-hire purpose',()=>{
 const body='<p>Venue hire enquiries.</p><p>'+'Ordinary venue description. '.repeat(15)+'</p><p>Website designed by Agency: <a href="mailto:studio@agency.co.uk">studio@agency.co.uk</a></p>';
 const c=extractFromFetchedDocuments([page('https://venue.org/',body)],['PUBLIC_CONTACT'],'Example Venue').publicContacts.find(c=>c.type==='EMAIL');
 assert.equal(c?.reviewRequired,true);assert.match(c?.label??'',/Website designed by Agency/);
});
test('outdoor evidence preserves negative qualification and South African footer addresses remain discoverable',()=>{
 const d=page('https://venue.org/','<p>Our garden is not available for venue hire.</p><footer>24 Long Street, Cape Town, 8001</footer>');
 const r=extractFromFetchedDocuments([d],['IDENTITY','VENUE_FACTS'],'Example Venue');
 const fact=r.venueFacts.find(f=>f.fieldName==='outdoorSpace');assert.equal(fact?.reviewRequired,true);assert.match(String(fact?.value),/not available/);
 assert.ok(r.identityFacts.some(f=>f.fieldName==='address'&&f.value==='24 Long Street, Cape Town, 8001'));
});
