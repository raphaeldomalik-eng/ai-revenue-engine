import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { CONTRACTS } from "../src/nexus/contracts.ts";
import { executeSourceDiscoveryRequest, InMemoryNexusResultStore, sourceDiscoveryExecutionKey } from "../src/nexus/executor.ts";
import { deriveEmailAcquisitionOutcome } from "../src/nexus/source-discovery/email-outcome.ts";
import { hrefTags } from "../src/nexus/source-discovery/html.ts";
import { canonicalHttpsUrl } from "../src/nexus/source-discovery/network.ts";

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];
const budget = { maxPages: 4, maxRequests: 10, maxBytesPerResponse: 100000, maxRedirects: 2, maxRetries: 0, timeoutMs: 1000, minRequestDelayMs: 0 };

function request(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: CONTRACTS.SOURCE_DISCOVERY_REQUEST,
    discoveryRequestId: "44444444-4444-4444-8444-444444444441",
    idempotencyKey: "22222222-2222-4222-8222-222222222221",
    correlationId: "33333333-3333-4333-8333-333333333331",
    originatingProduct: "event_suite_resources",
    subjectReference: { canonicalEntityId: null, candidateReference: { sourceSystem: "event_suite_resources", sourceRecordId: "Example Venue" }, entityType: "VENUE" },
    verifiedSourceUrl: "https://venue.org/",
    requestedExtractors: ["IDENTITY"],
    acquisitionGoal: null,
    venueName: "Example Venue",
    freshnessRequirements: { maxAgeHours: 24 },
    crawlBudget: budget,
    existingEvidenceRefs: [],
    requestedBy: { actorType: "PRODUCT", actorId: "resources" },
    createdAt: "2026-09-30T00:00:00Z",
    ...overrides,
  };
}

function html(body: string) {
  return new Response(`<html><body>${body}</body></html>`, { headers: { "content-type": "text/html" } });
}

function site(pages: Record<string, Response>) {
  const requested: string[] = [];
  const fetchImpl = async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requested.push(url.pathname);
    if (url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /");
    return pages[url.pathname] ?? new Response("missing", { status: 404 });
  };
  return { fetchImpl, requested };
}

test("email outcome names the stop without redefining crawl status", () => {
  const open = { emailGoal: true, emailFound: false, status: "COMPLETED" as const, retryable: false, stopReason: "PAGE_BUDGET" as const, renderNeeded: false, contactPathsRemaining: 2 };
  assert.equal(deriveEmailAcquisitionOutcome(open), "PAGE_BUDGET_REACHED");
  assert.equal(deriveEmailAcquisitionOutcome({ ...open, stopReason: "REQUEST_BUDGET" }), "REQUEST_BUDGET_REACHED");
  assert.equal(deriveEmailAcquisitionOutcome({ ...open, stopReason: "NO_GAP_CANDIDATES", contactPathsRemaining: 1 }), "CONTACT_PATHS_REMAIN");
  assert.equal(deriveEmailAcquisitionOutcome({ ...open, stopReason: "QUEUE_EXHAUSTED", contactPathsRemaining: 0 }), "EMAIL_SEARCH_EXHAUSTED");
  assert.equal(deriveEmailAcquisitionOutcome({ ...open, status: "FAILED", retryable: true, stopReason: "ENTRY_FAILED" }), "TRANSIENT_FAILURE");
  assert.equal(deriveEmailAcquisitionOutcome({ ...open, status: "BLOCKED", stopReason: "ROBOTS_BLOCKED" }), "BLOCKED");
  assert.equal(deriveEmailAcquisitionOutcome({ ...open, emailFound: true }), "EMAIL_FOUND");
  assert.equal(deriveEmailAcquisitionOutcome({ ...open, emailGoal: false }), "EMAIL_NOT_REQUESTED");
});

test("a Resources venue identity request searches for an accepted email", async () => {
  const { fetchImpl } = site({
    "/": html('<a href="mailto:info@venue.org">info@venue.org</a><a href="tel:+27123456789">Bookings 012 345 6789</a>'),
  });
  const result = await executeSourceDiscoveryRequest(request(), { resolveHost: publicResolver, fetchImpl }) as any;
  assert.equal(result.crawl.emailOutcome, "EMAIL_FOUND");
  assert.equal(result.guideEmailReady, true);
  assert.equal(result.publicContacts.some((item: { type: string; value: string }) => item.type === "EMAIL" && item.value === "info@venue.org"), true);
  assert.equal(result.publicContacts.some((item: { type: string }) => item.type === "PHONE"), true);
});

test("a generic identity crawl does not claim an email search completed", async () => {
  const { fetchImpl } = site({
    "/": html('<a href="mailto:info@venue.org">info@venue.org</a>'),
  });
  const result = await executeSourceDiscoveryRequest(request({
    originatingProduct: "last_train_home",
    idempotencyKey: "22222222-2222-4222-8222-222222222222",
    subjectReference: { canonicalEntityId: null, candidateReference: { sourceSystem: "last_train_home", sourceRecordId: "Example Venue" }, entityType: "VENUE" },
  }), { resolveHost: publicResolver, fetchImpl }) as any;
  assert.equal(result.crawl.emailOutcome, "EMAIL_NOT_REQUESTED");
  assert.equal(result.guideEmailReady, false);
  assert.equal(result.publicContacts.length, 0);
  assert.equal(result.crawl.status, "COMPLETED");
});

test("phone, a contact form, and WhatsApp do not satisfy the email goal", async () => {
  const { fetchImpl, requested } = site({
    "/": html('<a href="tel:+27123456789">Bookings 012 345 6789</a><a href="https://wa.me/27123456789">WhatsApp</a><form action="/enquire"><textarea name="message"></textarea><input type="email"></form><a href="/contact/">Contact</a>'),
    "/contact/": html('<a href="mailto:events@venue.org">events@venue.org</a>'),
  });
  const result = await executeSourceDiscoveryRequest(request({
    idempotencyKey: "22222222-2222-4222-8222-222222222223",
    requestedExtractors: ["PUBLIC_CONTACT"],
  }), { resolveHost: publicResolver, fetchImpl }) as any;
  assert.equal(requested.includes("/contact/"), true);
  assert.equal(result.crawl.pageCount >= 2, true);
  assert.equal(result.crawl.emailOutcome, "EMAIL_FOUND");
  assert.equal(result.publicContacts.some((item: { type: string; value: string }) => item.type === "EMAIL" && item.value === "events@venue.org"), true);
  assert.equal(result.publicContacts.some((item: { type: string }) => item.type === "PHONE"), true);
  assert.equal(result.publicContacts.some((item: { type: string }) => item.type === "WHATSAPP"), true);
});

test("script-escaped anchors are not fetched and do not make a successful crawl partial", async () => {
  const poisoned = `<html><body><script><a href="/script-only">Script</a></script><a href=\\"https:\\/\\/venue.org\\/auditorium\\/\\">Auditorium</a><a href="/contact/">Contact</a></body></html>`;
  assert.equal(hrefTags(poisoned).some((tag) => (tag.attrs.href ?? "").includes("script-only")), false);
  assert.equal(canonicalHttpsUrl(String.raw`\"https:\/\/venue.org\/auditorium\/\"`, "https://venue.org/"), null);
  const { fetchImpl, requested } = site({
    "/": new Response(poisoned, { headers: { "content-type": "text/html" } }),
    "/contact/": html('<a href="mailto:events@venue.org">events@venue.org</a>'),
  });
  const result = await executeSourceDiscoveryRequest(request({
    idempotencyKey: "22222222-2222-4222-8222-222222222224",
  }), { resolveHost: publicResolver, fetchImpl }) as any;
  assert.equal(requested.some((path) => path.includes("auditorium") || path.includes("%22") || path.includes("script-only")), false);
  assert.equal(requested.includes("/contact/"), true);
  assert.equal(result.crawl.emailOutcome, "EMAIL_FOUND");
  assert.equal(result.publicContacts.some((item: { value: string }) => item.value === "events@venue.org"), true);
  assert.equal(result.crawl.warnings.some((warning: string) => /auditorium|%22|script-only/i.test(warning)), false);
  assert.equal(result.crawl.status, "COMPLETED");
});

test("an email goal keeps the held path and follows its contact link", async () => {
  const { fetchImpl, requested } = site({
    "/eventsvenue/": html('<a href="/contact/">Contact the venue</a>'),
    "/contact/": html('<a href="mailto:events@venue.org">events@venue.org</a>'),
  });
  const result = await executeSourceDiscoveryRequest(request({
    idempotencyKey: "22222222-2222-4222-8222-222222222225",
    verifiedSourceUrl: "https://venue.org/eventsvenue/",
  }), { resolveHost: publicResolver, fetchImpl }) as any;
  assert.equal(requested[1], "/eventsvenue/");
  assert.equal(requested.includes("/contact/"), true);
  assert.equal(result.crawl.pageCount >= 2, true);
  assert.equal(result.crawl.emailOutcome, "EMAIL_FOUND");
  assert.equal(result.source.finalUrl, "https://venue.org/eventsvenue/");
});

test("gzip HTML is parsed and a gzip archive is still rejected", async () => {
  const page = gzipSync(Buffer.from('<html><body><a href="mailto:info@venue.org">info@venue.org</a></body></html>'));
  const gzipSite = site({
    "/": new Response(page, { headers: { "content-type": "text/html", "content-encoding": "gzip" } }),
  });
  const found = await executeSourceDiscoveryRequest(request({
    idempotencyKey: "22222222-2222-4222-8222-222222222226",
  }), { resolveHost: publicResolver, fetchImpl: gzipSite.fetchImpl }) as any;
  assert.equal(found.crawl.emailOutcome, "EMAIL_FOUND");
  assert.equal(found.publicContacts.some((item: { value: string }) => item.value === "info@venue.org"), true);

  const archive = site({
    "/pack.gz": new Response(gzipSync(Buffer.from("not a page")), { headers: { "content-type": "application/gzip" } }),
  });
  const rejected = await executeSourceDiscoveryRequest(request({
    idempotencyKey: "22222222-2222-4222-8222-222222222227",
    verifiedSourceUrl: "https://venue.org/pack.gz",
  }), { resolveHost: publicResolver, fetchImpl: archive.fetchImpl }) as any;
  assert.equal(rejected.crawl.emailOutcome, "BLOCKED");
  assert.notEqual(rejected.crawl.emailOutcome, "EMAIL_SEARCH_EXHAUSTED");
  assert.equal(rejected.guideEmailReady, false);
  assert.match(rejected.crawl.warnings.join(" "), /Compressed archive|could not be decoded|Unsupported content type/i);
});

test("a static email needs no renderer and a thin shell is RENDER_NEEDED", async () => {
  const staticSite = site({
    "/": html('<h1>Example Venue</h1><a href="mailto:info@venue.org">info@venue.org</a>'),
  });
  const ready = await executeSourceDiscoveryRequest(request({
    idempotencyKey: "22222222-2222-4222-8222-222222222228",
  }), { resolveHost: publicResolver, fetchImpl: staticSite.fetchImpl }) as any;
  assert.equal(ready.crawl.emailOutcome, "EMAIL_FOUND");
  assert.equal(ready.crawl.warnings.some((warning: string) => /rendering adapter/i.test(warning)), false);

  const shell = site({
    "/": new Response('<html><body><div id="root"></div></body></html>', { headers: { "content-type": "text/html" } }),
  });
  const rendered = await executeSourceDiscoveryRequest(request({
    idempotencyKey: "22222222-2222-4222-8222-222222222229",
  }), { resolveHost: publicResolver, fetchImpl: shell.fetchImpl }) as any;
  assert.equal(rendered.crawl.emailOutcome, "RENDER_NEEDED");
  assert.notEqual(rendered.crawl.emailOutcome, "EMAIL_SEARCH_EXHAUSTED");
  assert.equal(rendered.guideEmailReady, false);
});

test("a previous source-discovery generation is not replayed", async () => {
  const store = new InMemoryNexusResultStore();
  const idempotencyKey = "22222222-2222-4222-8222-22222222222a";
  const completed = { crawl: { status: "COMPLETED", retryable: false, pageCount: 1, warnings: [] }, idempotencyKey, publicContacts: [] };
  const completedKey = sourceDiscoveryExecutionKey(idempotencyKey, "resources-v2-source-discovery-v2");
  await store.set(completedKey, completed);
  const failedKey = sourceDiscoveryExecutionKey("22222222-2222-4222-8222-22222222222b", "resources-v2-source-discovery-v2");
  const failed = { crawl: { status: "FAILED", retryable: false, warnings: ["Compressed archive bodies are not parsed as documents."] }, idempotencyKey: "22222222-2222-4222-8222-22222222222b" };
  await store.set(failedKey, failed);
  const { fetchImpl, requested } = site({
    "/": html('<a href="mailto:info@venue.org">info@venue.org</a>'),
  });
  const fresh = await executeSourceDiscoveryRequest(request({ idempotencyKey }), { resolveHost: publicResolver, fetchImpl }, store) as any;
  assert.equal(requested.length > 0, true);
  assert.equal(fresh.crawl.emailOutcome, "EMAIL_FOUND");
  assert.notEqual(fresh, completed);
  assert.equal(await store.get(completedKey), completed);

  const again = site({
    "/": html('<a href="mailto:info@venue.org">info@venue.org</a>'),
  });
  const recovered = await executeSourceDiscoveryRequest(request({
    idempotencyKey: "22222222-2222-4222-8222-22222222222b",
    discoveryRequestId: "44444444-4444-4444-8444-444444444442",
  }), { resolveHost: publicResolver, fetchImpl: again.fetchImpl }, store) as any;
  assert.equal(recovered.crawl.emailOutcome, "EMAIL_FOUND");
  assert.notEqual(recovered, failed);
  assert.equal(await store.get(failedKey), failed);
});

test("an unversioned completed result is not replayed into a venue-email acquisition", async () => {
  const store = new InMemoryNexusResultStore();
  const idempotencyKey = "22222222-2222-4222-8222-22222222222c";
  const legacy = { crawl: { status: "COMPLETED", retryable: false, pageCount: 1, warnings: [] }, idempotencyKey, publicContacts: [] };
  await store.set(idempotencyKey, legacy);
  const { fetchImpl, requested } = site({
    "/": html('<a href="mailto:info@venue.org">info@venue.org</a>'),
  });
  const result = await executeSourceDiscoveryRequest(request({
    idempotencyKey,
    discoveryRequestId: "44444444-4444-4444-8444-444444444443",
  }), { resolveHost: publicResolver, fetchImpl }, store) as any;
  assert.equal(requested.length > 0, true);
  assert.notEqual(result, legacy);
  assert.equal(result.crawl.emailOutcome, "EMAIL_FOUND");
  assert.equal(await store.get(idempotencyKey), legacy);

  const kept = new InMemoryNexusResultStore();
  const otherKey = "22222222-2222-4222-8222-22222222222d";
  const otherLegacy = { crawl: { status: "COMPLETED", retryable: false }, idempotencyKey: otherKey };
  await kept.set(otherKey, otherLegacy);
  let calls = 0;
  const replayed = await executeSourceDiscoveryRequest(request({
    originatingProduct: "last_train_home",
    idempotencyKey: otherKey,
    discoveryRequestId: "44444444-4444-4444-8444-444444444444",
    subjectReference: { canonicalEntityId: null, candidateReference: { sourceSystem: "last_train_home", sourceRecordId: "Example Venue" }, entityType: "VENUE" },
    requestedExtractors: ["IDENTITY"],
  }), {
    resolveHost: publicResolver,
    fetchImpl: async () => { calls += 1; return html("<h1>Example Venue</h1>"); },
  }, kept);
  assert.equal(replayed, otherLegacy);
  assert.equal(calls, 0);
  assert.equal(await kept.get(otherKey), otherLegacy);
});
