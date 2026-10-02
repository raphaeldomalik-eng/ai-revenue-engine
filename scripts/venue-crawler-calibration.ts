import { mkdirSync, writeFileSync } from "node:fs";
import { crawlVenue } from "../src/nexus/venue-crawler/crawl.ts";
import { playwrightRenderAdapter } from "../src/nexus/venue-crawler/playwright-adapter.ts";
import type { RenderAdapter } from "../src/nexus/source-discovery/render.ts";

type Baseline = {
  name: string;
  city: string;
  region: string | null;
  website: string;
  role: string;
  summary: string;
  description: string;
  images: number;
  knownYesFacts: number;
  parkingMarkedYes: boolean;
};

const cohort: Baseline[] = [
  { name: "137 Murray street guest house", city: "Pretoria", region: null, website: "http://www.murray137.co.za/", role: "guest house", images: 0, knownYesFacts: 5, parkingMarkedYes: true, summary: "137 Murray street guest house is a guest house located in Pretoria, South Africa, providing facilities suitable for corporate_event, banquet.", description: "137 Murray street guest house operates in Pretoria, Western Cape/Gauteng region. Discovered and verified as part of the Resources South Africa regional acquisition inventory for event, function, and meeting bookings." },
  { name: "180 Lounger", city: "Cape Town", region: "Western Cape", website: "https://180lounger.com/", role: "rooftop", images: 0, knownYesFacts: 5, parkingMarkedYes: false, summary: "Rooftop venue on the 16th floor of The Terraces, 34 Bree Street, Cape Town, with indoor and outdoor terrace space.", description: "180 Lounger Rooftop Venue operates in Cape Town, Western Cape/Gauteng region. Discovered and verified as part of the Resources South Africa regional acquisition inventory for event, function, and meeting bookings." },
  { name: "1st Boksburg (Cameron) Scout Hall", city: "Boksburg", region: null, website: "https://1stboksburgcameron.wixsite.com/1st-boksburg-cameron", role: "js-heavy small hall", images: 0, knownYesFacts: 2, parkingMarkedYes: false, summary: "1st Boksburg (Cameron) Scout Hall is a event venue located in Boksburg, South Africa, providing facilities suitable for corporate_event, banquet, conference.", description: "1st Boksburg (Cameron) Scout Hall operates in Boksburg, Western Cape/Gauteng region. Discovered and verified as part of the Resources South Africa regional acquisition inventory for event, function, and meeting bookings." },
  { name: "1st Bryanston Scout Hall", city: "Sandton", region: null, website: "http://www.1stbryanston.co.za/", role: "small hall", images: 0, knownYesFacts: 1, parkingMarkedYes: true, summary: "1st Bryanston Scout Hall is a event venue located in Sandton, South Africa, providing facilities suitable for corporate_event, banquet.", description: "1st Bryanston Scout Hall operates in Sandton, Western Cape/Gauteng region. Discovered and verified as part of the Resources South Africa regional acquisition inventory for event, function, and meeting bookings." },
  { name: "2nd Hout Bay Sea Scout Group", city: "Cape Town", region: null, website: "http://2ndhoutbay.co.za/", role: "small hall", images: 0, knownYesFacts: 1, parkingMarkedYes: true, summary: "2nd Hout Bay Sea Scout Group is a event venue located in Cape Town, South Africa, providing facilities suitable for corporate_event, banquet.", description: "2nd Hout Bay Sea Scout Group operates in Cape Town, Western Cape/Gauteng region. Discovered and verified as part of the Resources South Africa regional acquisition inventory for event, function, and meeting bookings." },
  { name: "4 Every Event", city: "Grabouw", region: null, website: "http://www.4everyevent.co.za/", role: "event venue", images: 0, knownYesFacts: 1, parkingMarkedYes: true, summary: "4 Every Event is a event venue located in Grabouw, South Africa, providing facilities suitable for corporate_event.", description: "4 Every Event operates in Grabouw, Western Cape/Gauteng region. Discovered and verified as part of the Resources South Africa regional acquisition inventory for event, function, and meeting bookings." },
  { name: "ABRU MOTOR Studio", city: "Cape Town", region: null, website: "https://abrumotorstudio.co.za/", role: "studio", images: 0, knownYesFacts: 1, parkingMarkedYes: false, summary: "ABRU MOTOR Studio is a event venue located in Cape Town, South Africa, providing facilities suitable for corporate_event, banquet, theatre.", description: "ABRU MOTOR Studio operates in Cape Town, Western Cape/Gauteng region. Discovered and verified as part of the Resources South Africa regional acquisition inventory for event, function, and meeting bookings." },
  { name: "Accent on Functions", city: "Benoni", region: null, website: "http://www.aof.co.za/", role: "functions", images: 0, knownYesFacts: 1, parkingMarkedYes: true, summary: "Accent on Functions is a service located in Benoni, South Africa, providing facilities suitable for wedding, corporate_event, banquet.", description: "Accent on Functions operates in Benoni, Western Cape/Gauteng region. Discovered and verified as part of the Resources South Africa regional acquisition inventory for event, function, and meeting bookings." },
  { name: "Accolades Boutique Venue", city: "Midrand", region: null, website: "http://www.accolades.co.za/", role: "boutique wedding", images: 0, knownYesFacts: 1, parkingMarkedYes: true, summary: "Accolades Boutique Venue is a event venue located in Midrand, South Africa, providing facilities suitable for wedding, corporate_event, banquet.", description: "Accolades Boutique Venue operates in Midrand, Western Cape/Gauteng region. Discovered and verified as part of the Resources South Africa regional acquisition inventory for event, function, and meeting bookings." },
  { name: "ACSA International Indaba Conference Centre", city: "Kempton Park", region: null, website: "https://www.airports.co.za/", role: "conference centre", images: 0, knownYesFacts: 1, parkingMarkedYes: true, summary: "ACSA International Indaba Conference Centre is a event venue located in Kempton Park, South Africa, providing facilities suitable for corporate_event, banquet.", description: "ACSA International Indaba Conference Centre operates in Kempton Park, Western Cape/Gauteng region. Discovered and verified as part of the Resources South Africa regional acquisition inventory for event, function, and meeting bookings." },
  { name: "113 Loop Rooftop Event Venue", city: "Cape Town", region: "Western Cape", website: "https://113loop.co.za", role: "rooftop", images: 0, knownYesFacts: 6, parkingMarkedYes: true, summary: "113 Loop Rooftop Event Venue is a event venue located in Cape Town City Centre, South Africa, providing facilities suitable for corporate_event, banquet.", description: "113 Loop Rooftop Event Venue operates in Cape Town City Centre, Western Cape/Gauteng region. Discovered and verified as part of the Resources South Africa regional acquisition inventory for event, function, and meeting bookings." },
  { name: "Apollo Conferencing Hotel", city: "Randburg", region: null, website: "https://apollohotel.co.za/", role: "hotel", images: 0, knownYesFacts: 6, parkingMarkedYes: true, summary: "Apollo Conferencing Hotel is a hotel located in Randburg, South Africa, providing facilities suitable for conference, corporate_event, banquet.", description: "Apollo Conferencing Hotel operates in Randburg, Western Cape/Gauteng region. Discovered and verified as part of the Resources South Africa regional acquisition inventory for event, function, and meeting bookings." },
  { name: "Artscape Theatre Centre", city: "Cape Town", region: null, website: "http://www.artscape.co.za/", role: "theatre", images: 2, knownYesFacts: 1, parkingMarkedYes: true, summary: "Artscape Theatre Centre is a performing arts theater located in Cape Town, South Africa, providing facilities suitable for live_music, theatre, corporate_event.", description: "Artscape Theatre Centre operates in Cape Town, Western Cape/Gauteng region. Discovered and verified as part of the Resources South Africa regional acquisition inventory for event, function, and meeting bookings." },
  { name: "Casablanca Manor Wedding, Function and Conference Venue", city: "Pretoria", region: null, website: "http://www.casablancamanor.co.za/", role: "multi-space wedding", images: 3, knownYesFacts: 1, parkingMarkedYes: true, summary: "Casablanca Manor Wedding, Function and Conference Venue is a wedding venue located in Pretoria, South Africa, providing facilities suitable for wedding, corporate_event, banquet.", description: "Casablanca Manor Wedding, Function and Conference Venue operates in Pretoria, Western Cape/Gauteng region. Discovered and verified as part of the Resources South Africa regional acquisition inventory for event, function, and meeting bookings." },
  { name: "Houw Hoek Hotel", city: "Grabouw", region: null, website: "https://houwhoekhotel.com/", role: "hotel", images: 3, knownYesFacts: 7, parkingMarkedYes: false, summary: "Houw Hoek Hotel is a hotel located in Grabouw, South Africa, providing facilities suitable for wedding, corporate_event, banquet.", description: "Houw Hoek Hotel operates in Grabouw, Western Cape/Gauteng region. Discovered and verified as part of the Resources South Africa regional acquisition inventory for event, function, and meeting bookings." },
  { name: "La Merveille Wedding & Function Venue", city: "Roodeplaat", region: null, website: "https://www.lamerveillevenue.com/", role: "gallery wedding", images: 0, knownYesFacts: 1, parkingMarkedYes: true, summary: "La Merveille Wedding & Function Venue is a wedding venue located in Roodeplaat, South Africa, providing facilities suitable for wedding, corporate_event, banquet.", description: "La Merveille Wedding & Function Venue operates in Roodeplaat, Western Cape/Gauteng region. Discovered and verified as part of the Resources South Africa regional acquisition inventory for event, function, and meeting bookings." },
  { name: "Achterbergh Lodge & Conference Centre", city: "Krugersdorp", region: null, website: "https://achterbergh.co.za/", role: "conference centre", images: 3, knownYesFacts: 5, parkingMarkedYes: false, summary: "Achterbergh Lodge & Conference Centre is a event venue located in Krugersdorp, South Africa, providing facilities suitable for corporate_event, banquet, wedding.", description: "Achterbergh Lodge & Conference Centre operates in Krugersdorp, Western Cape/Gauteng region. Discovered and verified as part of the Resources South Africa regional acquisition inventory for event, function, and meeting bookings." },
  { name: "Amorosa Wedding & Conference Venue", city: "Vontina AH", region: null, website: "http://www.amorosa-venue.com/", role: "wedding", images: 0, knownYesFacts: 1, parkingMarkedYes: true, summary: "Amorosa Wedding & Conference Venue is a wedding venue located in Vontina AH, South Africa, providing facilities suitable for wedding, corporate_event, banquet.", description: "Amorosa Wedding & Conference Venue operates in Vontina AH, Western Cape/Gauteng region. Discovered and verified as part of the Resources South Africa regional acquisition inventory for event, function, and meeting bookings." },
  { name: "Lethabo Estate", city: "Lanseria", region: null, website: "https://www.lethaboestate.com/", role: "large multi-space", images: 0, knownYesFacts: 5, parkingMarkedYes: false, summary: "Lethabo Estate is a lodging located in Lanseria, South Africa, providing facilities suitable for wedding, corporate_event, banquet.", description: "Lethabo Estate operates in Lanseria, Western Cape/Gauteng region. Discovered and verified as part of the Resources South Africa regional acquisition inventory for event, function, and meeting bookings." },
  { name: "55 Tulbagh Events and Wedding Venue", city: "Kempton Park", region: null, website: "http://www.55tulbagh.co.za/", role: "wedding", images: 3, knownYesFacts: 1, parkingMarkedYes: true, summary: "55 Tulbagh Events and Wedding Venue is a event venue located in Kempton Park, South Africa, providing facilities suitable for corporate_event, banquet.", description: "55 Tulbagh Events and Wedding Venue operates in Kempton Park, Western Cape/Gauteng region. Discovered and verified as part of the Resources South Africa regional acquisition inventory for event, function, and meeting bookings." },
];

function failures(text: string) {
  const found: string[] = [];
  if (/\b(?:discovered|acquisition|inventory|verified as part of|enrichment)\b/i.test(text)) found.push("internal-language");
  if (/\b[a-z]+_[a-z]+\b/.test(text)) found.push("raw-enum");
  if (/Western Cape\/Gauteng/i.test(text)) found.push("fake-region");
  if (/\ba event\b/i.test(text)) found.push("grammar");
  return found;
}

function maskEmail(value: string) {
  return value.replace(/[A-Z0-9._%+-]+@/gi, "***@");
}

let renderAdapter: RenderAdapter | undefined;
try {
  renderAdapter = playwrightRenderAdapter();
} catch {
  renderAdapter = undefined;
}

const rows = [];
for (const venue of cohort) {
  const started = Date.now();
  try {
    const result = await crawlVenue({
      subjectEntityType: "VENUE",
      sourceType: "OFFICIAL_ENTITY_WEBSITE",
      classificationState: "CONFIRMED",
      verifiedOfficialUrl: venue.website,
      venueName: venue.name,
      candidateReference: { sourceSystem: "event_suite_resources", sourceRecordId: venue.name },
      locality: venue.city,
      region: venue.region,
      country: "South Africa",
    }, { renderAdapter, probeImages: true });
    const copy = `${result.summary} ${result.description}`;
    rows.push({
      name: venue.name,
      role: venue.role,
      durationMs: Date.now() - started,
      current: {
        summary: venue.summary,
        description: venue.description,
        images: venue.images,
        knownYesFacts: venue.knownYesFacts,
        parkingMarkedYes: venue.parkingMarkedYes,
        qualityFailures: failures(`${venue.summary} ${venue.description}`),
      },
      crawler: {
        pagesFetched: result.pagesFetched,
        pageTypes: result.pageTypes,
        sitemapConsulted: result.sitemapConsulted,
        stopReason: result.stopReason,
        renderedPages: result.renderedPages,
        renderNeededButUnavailable: result.renderNeededButUnavailable,
        spaces: result.spaces,
        capacities: result.capacities,
        suitability: result.suitability.map((item) => item.label),
        practical: result.practical.map((item) => item.key),
        contacts: result.contacts.filter((item) => !item.reviewRequired).map((item) => ({ type: item.type, value: item.type === "EMAIL" ? maskEmail(item.value) : item.value })),
        imageCandidates: result.images.candidates,
        rights: result.images.rights,
        hero: result.images.hero?.sourceImageUrl ?? null,
        ownerReviewHero: result.images.ownerReviewHero?.sourceImageUrl ?? null,
        gallery: result.images.gallery.length,
        summary: result.summary,
        description: result.description,
        qualityFailures: failures(copy),
        rejectedSentences: result.rejectedSentences,
      },
    });
  } catch (error) {
    rows.push({ name: venue.name, role: venue.role, durationMs: Date.now() - started, error: error instanceof Error ? error.message : "unknown error", current: { summary: venue.summary, description: venue.description, images: venue.images, knownYesFacts: venue.knownYesFacts, parkingMarkedYes: venue.parkingMarkedYes, qualityFailures: failures(`${venue.summary} ${venue.description}`) } });
  }
  process.stdout.write(`${venue.name}\n`);
}

const report = {
  generatedAt: new Date().toISOString(),
  productionMutations: 0,
  venues: rows,
};
mkdirSync("docs/quality", { recursive: true });
writeFileSync("docs/quality/2026-10-02-dedicated-venue-crawler-calibration.json", JSON.stringify(report, null, 2));
process.stdout.write(`venues=${rows.length}\n`);
