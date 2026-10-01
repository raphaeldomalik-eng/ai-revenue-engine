import { parse } from "tldts";

/**
 * A published mailbox domain must have a registrable name under a recognised public suffix.
 * The suffix list is bundled locally. Unknown alphabetic tails such as `.zzzz` are not emails.
 */
export function recognisedEmailDomain(domain: string): boolean {
  const host = domain.trim().toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host)) return false;
  const parsed = parse(host);
  return Boolean(parsed.domain && parsed.publicSuffix && (parsed.isIcann || parsed.isPrivate));
}
