export const APPROVED_OUTREACH_COMPOSER_LINKEDIN_URL = "https://www.linkedin.com/in/raphaeldomalik/";

export const OUTREACH_COMPOSER_SENDER = Object.freeze({
  fromName: "Raphael Domalik",
  fromEmail: "raphael@eventsuite.pro",
  replyTo: "raphael@eventsuite.pro",
  companyName: "EventSuite",
  demoUrl: "https://app.eventsuite.pro/book-demo",
  linkedinUrl: APPROVED_OUTREACH_COMPOSER_LINKEDIN_URL,
});

export const OUTREACH_COMPOSER_APPROVED_URL_ALLOWLIST = Object.freeze([
  OUTREACH_COMPOSER_SENDER.demoUrl,
  OUTREACH_COMPOSER_SENDER.linkedinUrl,
]);

export function isApprovedOutreachComposerUrl(value: string) {
  return (OUTREACH_COMPOSER_APPROVED_URL_ALLOWLIST as readonly string[]).includes(value);
}

export function renderApprovedOutreachComposerSignature() {
  return [
    OUTREACH_COMPOSER_SENDER.fromName,
    OUTREACH_COMPOSER_SENDER.companyName,
    OUTREACH_COMPOSER_SENDER.fromEmail,
    `LinkedIn: ${OUTREACH_COMPOSER_SENDER.linkedinUrl}`,
    "eventsuite.pro",
  ].join("\n");
}
