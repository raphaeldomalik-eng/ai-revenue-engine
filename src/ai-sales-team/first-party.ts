import { EVENTSUITE_ORIGIN } from "./resource-offers.ts";

export const EVENTSUITE_CANONICAL_DOMAIN = new URL(EVENTSUITE_ORIGIN).hostname.replace(/^www\./, "");
export const FIRST_PARTY_SELF = "FIRST_PARTY_SELF" as const;

function hostname(value: string | null | undefined) {
  if (!value?.trim()) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return parsed.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

export function isEventSuiteFirstPartyUrl(value: string | null | undefined) {
  const host = hostname(value);
  return Boolean(host && (host === EVENTSUITE_CANONICAL_DOMAIN || host.endsWith(`.${EVENTSUITE_CANONICAL_DOMAIN}`)));
}

export function isEventSuiteFirstPartyIdentity(input: { website?: string | null; identityName?: string | null; sourceUrls?: Array<string | null | undefined> }) {
  if (isEventSuiteFirstPartyUrl(input.website)) return true;
  const exactIdentity = input.identityName?.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === "eventsuite";
  return Boolean(exactIdentity && input.sourceUrls?.some((sourceUrl) => isEventSuiteFirstPartyUrl(sourceUrl)));
}

export function isEventSuiteFirstPartyTarget(input: { accountName?: string | null; accountWebsite?: string | null; candidateName?: string | null; candidateWebsite?: string | null }) {
  return isEventSuiteFirstPartyIdentity({ website: input.accountWebsite, identityName: input.accountName })
    || isEventSuiteFirstPartyIdentity({ website: input.candidateWebsite, identityName: input.candidateName });
}
