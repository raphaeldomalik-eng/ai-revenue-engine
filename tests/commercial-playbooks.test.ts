import assert from "node:assert/strict";
import test from "node:test";
import { canBeUsedAsDefensibleDifferentiator, commodityClaims, eventSuiteHypotheses, prohibitedCompetitiveClaim } from "../src/revenue/claims.ts";
import { resolveCommercialPlaybook, UnsupportedCommercialPlaybookError } from "../src/revenue/playbook-resolver.ts";
import { commercialPlaybooks } from "../src/revenue/playbooks.ts";

test("resolves Event Suite South Africa Direct", () => {
  const playbook = resolveCommercialPlaybook({ product: "event-suite", territory: "ZA", salesMotion: "direct" });
  assert.equal(playbook.territory, "ZA");
  assert.deepEqual(playbook.conversionGoals, ["SELF_SERVICE", "QUALIFIED_LIVE_DEMO"]);
  assert.equal(playbook.pricingGuidance.status, "CURRENT");
  if (playbook.pricingGuidance.status === "CURRENT") {
    assert.deepEqual(playbook.pricingGuidance.perEventPackages.map((item) => item.price), [4995, 5995, 7995, 10995, 14995]);
    assert.equal(playbook.pricingGuidance.ticketing.paidOrderPercentage, 3.95);
  }
});

test("South African Direct exposes Schools as a deferred special-pricing segment", () => {
  const playbook = resolveCommercialPlaybook({ product: "event-suite", territory: "ZA", salesMotion: "direct" });
  const schools = playbook.clientSegments?.find((segment) => segment.code === "schools");
  assert.ok(schools);
  assert.equal(schools.name, "Schools / Education");
  assert.equal(schools.status, "DRAFT");
  assert.equal(schools.commercialTreatment, "SPECIAL_DISCOUNT");
  assert.equal(schools.pricingStatus, "DEFERRED");
  assert.equal(schools.numericDiscount, undefined);
  assert.match(schools.pricingInstruction, /current approved school pricing schedule or human confirmation/);
  assert.deepEqual(schools.territoryRelevance, ["ZA"]);
  assert.deepEqual(schools.salesMotionRelevance, ["direct"]);
  assert.ok(schools.eventExamples.includes("School sports events"));
  assert.ok(schools.buyerRoleHypotheses.includes("School leadership"));
});

test("Schools remain a South African Direct segment and do not alter standard SA pricing", () => {
  const schoolPlaybooks = commercialPlaybooks.filter((playbook) => playbook.clientSegments?.some((segment) => segment.code === "schools"));
  assert.equal(schoolPlaybooks.length, 1);
  assert.equal(schoolPlaybooks[0].product, "event-suite");
  assert.equal(schoolPlaybooks[0].territory, "ZA");
  assert.equal(schoolPlaybooks[0].salesMotion, "direct");
  assert.deepEqual(schoolPlaybooks[0].pricingGuidance.perEventPackages.map((item) => item.price), [4995, 5995, 7995, 10995, 14995]);
});

test("resolves Event Suite United Kingdom Direct with proposed pricing metadata", () => {
  const playbook = resolveCommercialPlaybook({ product: "event-suite", territory: "GB", salesMotion: "direct" });
  assert.equal(playbook.territory, "GB");
  assert.equal(playbook.pricingGuidance.status, "PROPOSED");
  assert.equal(playbook.readiness.pricing, "PROPOSED");
  assert.equal(playbook.pricingGuidance.pricingVersion, "UK-1.0");
  assert.equal(playbook.pricingGuidance.sourceDate, "2026-08");
  assert.deepEqual(playbook.pricingGuidance.perEventPackages.map((item) => item.price), [495, 595, 795, 1095, 1495]);
});

test("resolves Event Suite South Africa LNO with opportunity enquiry as primary goal", () => {
  const playbook = resolveCommercialPlaybook({ product: "event-suite", territory: "ZA", salesMotion: "lno" });
  assert.equal(playbook.salesMotion, "lno");
  assert.deepEqual(playbook.conversionGoals, ["BUSINESS_OPPORTUNITY_ENQUIRY"]);
  assert.match(playbook.routeToConversionConsiderations.join(" "), /primary CTA/);
  assert.equal(playbook.channelGuidance?.originatingPortfolioCommissionPercentage, 20);
  assert.equal(playbook.channelGuidance?.networkLayers, 1);
});

test("resolves Event Suite United Kingdom LNO with proposed operator economics", () => {
  const playbook = resolveCommercialPlaybook({ product: "event-suite", territory: "GB", salesMotion: "lno" });
  assert.equal(playbook.salesMotion, "lno");
  assert.equal(playbook.pricingGuidance.status, "PROPOSED");
  assert.deepEqual(playbook.pricingGuidance.annualPortfolio.packages["Event Essentials"], [495, 449, 425, 395]);
  assert.equal(playbook.pricingGuidance.operatorEconomics?.packageCommissionPercentage, 20);
  assert.equal(playbook.pricingGuidance.portfolioRules?.commissionDecay, "NONE");
  assert.equal(playbook.pricingGuidance.operatorParticipation?.selfCommissionAllowed, false);
  assert.deepEqual(playbook.pricingGuidance.perEventPackages.map((item) => item.price), resolveCommercialPlaybook({ product: "event-suite", territory: "GB", salesMotion: "direct" }).pricingGuidance.perEventPackages.map((item) => item.price));
  assert.notEqual(playbook.id, resolveCommercialPlaybook({ product: "event-suite", territory: "ZA", salesMotion: "lno" }).id);
});

test("UK operator-managed economics do not double count delivery price and commission", () => {
  const playbook = resolveCommercialPlaybook({ product: "event-suite", territory: "GB", salesMotion: "lno" });
  const firstPackage = playbook.pricingGuidance.perEventPackages[0];
  assert.equal(firstPackage.operatorDeliveryPrice, 396);
  assert.equal(firstPackage.operatorOriginatedCommission, 99);
  assert.equal(playbook.pricingGuidance.operatorEconomics?.noSelfCommissionOnOperatorManagedPurchase, true);
});

test("UK ticketing and review rules preserve allocation semantics", () => {
  const pricing = resolveCommercialPlaybook({ product: "event-suite", territory: "GB", salesMotion: "direct" }).pricingGuidance;
  assert.equal(pricing.ticketing.corePercentage, 2);
  assert.equal(pricing.ticketing.servicingPercentage, 1);
  assert.equal(pricing.ticketing.servicingCapPerTicket, 1);
  assert.equal(pricing.ticketing.freeStandardServiceFee, 0);
  assert.equal(pricing.largeEventReview?.semantics, "REVIEW_NOT_SURCHARGE");
  assert.equal(pricing.portfolioRules?.assignedPortfolioSupportSharePercentage, 10);
  assert.equal(pricing.operatorEconomics?.operatorOriginatedTicketingServicingPercentage, 1);
  assert.equal(pricing.operatorEconomics?.operatorOriginatedTicketingServicingCap, 1);
  assert.equal(pricing.operatorEconomics?.assignedOperatorServicingPercentage, 0.5);
  assert.equal(pricing.operatorEconomics?.assignedOperatorServicingCap, 0.5);
});

test("UK configurable commercial items stay unresolved", () => {
  const pricing = resolveCommercialPlaybook({ product: "event-suite", territory: "GB", salesMotion: "direct" }).pricingGuidance;
  assert.ok(pricing.configurableItems?.includes("SMS pricing"));
  assert.equal(pricing.ticketing.highVolume, "APPROVED_CUSTOM_COMMERCIAL_TERMS");
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
