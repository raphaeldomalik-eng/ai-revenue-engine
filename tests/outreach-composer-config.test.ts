import assert from "node:assert/strict";
import test from "node:test";
import {
  APPROVED_OUTREACH_COMPOSER_LINKEDIN_URL,
  OUTREACH_COMPOSER_APPROVED_URL_ALLOWLIST,
  OUTREACH_COMPOSER_SENDER,
  isApprovedOutreachComposerUrl,
  renderApprovedOutreachComposerSignature,
} from "../src/ai-sales-team/outreach-composer-config.ts";

test("approved sender configuration uses Raphael's exact LinkedIn URL", () => {
  assert.equal(APPROVED_OUTREACH_COMPOSER_LINKEDIN_URL, "https://www.linkedin.com/in/raphaeldomalik/");
  assert.equal(OUTREACH_COMPOSER_SENDER.linkedinUrl, APPROVED_OUTREACH_COMPOSER_LINKEDIN_URL);
  assert.ok(OUTREACH_COMPOSER_APPROVED_URL_ALLOWLIST.includes(APPROVED_OUTREACH_COMPOSER_LINKEDIN_URL));
  assert.equal(isApprovedOutreachComposerUrl(APPROVED_OUTREACH_COMPOSER_LINKEDIN_URL), true);
  assert.equal(isApprovedOutreachComposerUrl(`${APPROVED_OUTREACH_COMPOSER_LINKEDIN_URL}?utm_source=test`), false);
  assert.equal(OUTREACH_COMPOSER_SENDER.trialUrl, "https://app.eventsuite.pro/onboarding");
  assert.equal(OUTREACH_COMPOSER_SENDER.demoUrl, "https://app.eventsuite.pro/book-demo");
});

test("approved LinkedIn URL is rendered only by the deterministic signature", () => {
  assert.equal(
    renderApprovedOutreachComposerSignature(),
    "Raphael Domalik\nEventSuite\nraphael@eventsuite.pro\nLinkedIn: https://www.linkedin.com/in/raphaeldomalik/\neventsuite.pro",
  );
});
