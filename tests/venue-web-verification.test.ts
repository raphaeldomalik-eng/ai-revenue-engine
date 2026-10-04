import test from "node:test";
import assert from "node:assert/strict";
import { verifyVenueCapability } from "../src/nexus/venue-web-verification.ts";

test("Venue Web Verification — Category-Aware Event Suitability", async (t) => {
  await t.test("1. Hotel with multiple event signals confirmed as event venue", () => {
    const res = verifyVenueCapability({
      websiteUrl: "https://luxuryhotel.example.com",
      primaryType: "hotel",
      htmlContent: "<html><body><h1>Grand Hotel</h1><p>We host conferences, weddings, and private hire events.</p></body></html>",
    });
    assert.equal(res.outcome, "WEB_CONFIRMED_EVENT_VENUE");
    assert.ok(res.matchedSignals.includes("weddings"));
    assert.ok(res.matchedSignals.includes("private hire"));
  });

  await t.test("2. Restaurant with private dining room confirmed as event venue", () => {
    const res = verifyVenueCapability({
      websiteUrl: "https://seafoodbistro.example.com",
      primaryType: "restaurant",
      htmlContent: "<html><body><p>Enjoy our exclusive private dining room for family celebrations.</p></body></html>",
    });
    assert.equal(res.outcome, "WEB_CONFIRMED_EVENT_VENUE");
    assert.ok(res.matchedSignals.includes("private dining") || res.matchedSignals.includes("private dining room"));
  });

  await t.test("3. Single ambiguous signal routes to OWNER_CONFIRMATION_REQUIRED", () => {
    const res = verifyVenueCapability({
      websiteUrl: "https://bedandbreakfast.example.com",
      primaryType: "lodging",
      htmlContent: "<html><body><p>Quiet retreat. Small meeting room available on request.</p></body></html>",
    });
    assert.equal(res.outcome, "OWNER_CONFIRMATION_REQUIRED");
  });

  await t.test("4. No event mention routes to NO_EVENT_VENUE_EVIDENCE", () => {
    const res = verifyVenueCapability({
      websiteUrl: "https://cornercafe.example.com",
      primaryType: "restaurant",
      htmlContent: "<html><body><p>Fast takeaway coffee, fresh croissants and toast.</p></body></html>",
    });
    assert.equal(res.outcome, "NO_EVENT_VENUE_EVIDENCE");
  });

  await t.test("5. Unreachable site routes to WEB_VERIFICATION_BLOCKED", () => {
    const res = verifyVenueCapability({
      websiteUrl: "",
      isReachable: false,
    });
    assert.equal(res.outcome, "WEB_VERIFICATION_BLOCKED");
  });
});
