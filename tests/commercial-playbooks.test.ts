import assert from "node:assert/strict";
import test from "node:test";
import { canBeUsedAsDefensibleDifferentiator, commodityClaims, eventSuiteHypotheses, prohibitedCompetitiveClaim } from "../src/revenue/claims.ts";
import { resolveCommercialPlaybook, UnsupportedCommercialPlaybookError } from "../src/revenue/playbook-resolver.ts";

test("resolves Event Suite South Africa Direct", () => {
  const playbook = resolveCommercialPlaybook({ product: "event-suite", territory: "ZA", salesMotion: "direct" });
  assert.equal(playbook.territory, "ZA");
  assert.deepEqual(playbook.conversionGoals, ["SELF_SERVICE", "QUALIFIED_LIVE_DEMO"]);
  assert.equal(playbook.pricingGuidance.status, "CURRENT");
  if (playbook.pricingGuidance.status === "CURRENT") {
    assert.deepEqual(playbook.pricingGuidance.perEventPackages.map((item) => item.priceZar), [4995, 5995, 7995, 10995, 14995]);
    assert.equal(playbook.pricingGuidance.ticketing.paidOrderPercentage, 3.95);
  }
});

test("resolves Event Suite United Kingdom Direct without inventing pricing", () => {
  const playbook = resolveCommercialPlaybook({ product: "event-suite", territory: "GB", salesMotion: "direct" });
  assert.equal(playbook.territory, "GB");
  assert.equal(playbook.pricingGuidance.status, "DEFERRED");
  assert.equal(playbook.readiness.pricing, "DEFERRED");
});

test("resolves Event Suite South Africa LNO with opportunity enquiry as primary goal", () => {
  const playbook = resolveCommercialPlaybook({ product: "event-suite", territory: "ZA", salesMotion: "lno" });
  assert.equal(playbook.salesMotion, "lno");
  assert.deepEqual(playbook.conversionGoals, ["BUSINESS_OPPORTUNITY_ENQUIRY"]);
  assert.match(playbook.routeToConversionConsiderations.join(" "), /primary CTA/);
  assert.equal(playbook.channelGuidance?.originatingPortfolioCommissionPercentage, 20);
  assert.equal(playbook.channelGuidance?.networkLayers, 1);
});

test("resolves Event Suite United Kingdom LNO as a distinct deferred-territory playbook", () => {
  const playbook = resolveCommercialPlaybook({ product: "event-suite", territory: "GB", salesMotion: "lno" });
  assert.equal(playbook.salesMotion, "lno");
  assert.equal(playbook.pricingGuidance.status, "DEFERRED");
  assert.notEqual(playbook.id, resolveCommercialPlaybook({ product: "event-suite", territory: "ZA", salesMotion: "lno" }).id);
});

test("rejects unknown or unsupported playbooks deterministically", () => {
  assert.throws(() => resolveCommercialPlaybook({ product: "allxs", territory: "ZA", salesMotion: "direct" }), UnsupportedCommercialPlaybookError);
  assert.throws(() => resolveCommercialPlaybook({ product: "event-suite", territory: "AU", salesMotion: "direct" }), /No commercial playbook configured/);
});

test("claim governance prevents commodity, prohibited, and hypothesis claims from becoming defensible", () => {
  assert.equal(commodityClaims.every((claim) => !canBeUsedAsDefensibleDifferentiator(claim)), true);
  assert.equal(eventSuiteHypotheses.every((claim) => !canBeUsedAsDefensibleDifferentiator(claim)), true);
  assert.equal(canBeUsedAsDefensibleDifferentiator(prohibitedCompetitiveClaim), false);
});
