import { assertPublicNetworkTarget } from "./network.ts";
import type { ResolveHost } from "./types.ts";

/**
 * A rendering adapter loads one URL in an isolated, stateless browser context and returns the settled DOM.
 * Adapters must block every sub-request that fails `allowRequest`, never click, type, submit, log in, or download,
 * and must discard all storage when the call returns.
 */
export type RenderAdapter = {
  name: string;
  render(args: {
    url: string;
    timeoutMs: number;
    maxBytes: number;
    userAgent: string;
    allowRequest: (url: string, resourceType: string) => Promise<boolean>;
  }): Promise<{ finalUrl: string; html: string }>;
};

export type RenderPolicy = { maxRenderedPages: number; timeoutMs: number };
export const DEFAULT_RENDER_POLICY: RenderPolicy = { maxRenderedPages: 2, timeoutMs: 15_000 };

export class RenderRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderRefusal";
  }
}

const BLOCKED_RESOURCE_TYPES = new Set(["media", "font", "websocket", "eventsource", "manifest", "other", "ping", "download"]);

/** Enforces the crawler's site, robots, and public-network rules on the navigation and every sub-request. */
export async function guardedRender(args: {
  adapter: RenderAdapter;
  url: string;
  policy: RenderPolicy;
  maxBytes: number;
  userAgent: string;
  resolveHost: ResolveHost;
  isAllowedOrigin: (origin: string) => boolean;
  robotsAllows: (url: string) => boolean;
}): Promise<{ finalUrl: string; html: string; blockedSubrequests: number }> {
  if (!args.isAllowedOrigin(new URL(args.url).origin) || !args.robotsAllows(args.url)) throw new RenderRefusal("Render target is outside the verified site or disallowed by robots.txt.");
  await assertPublicNetworkTarget(args.url, args.resolveHost);
  let blockedSubrequests = 0;
  const allowRequest = async (target: string, resourceType: string) => {
    try {
      const url = new URL(target);
      const document = resourceType === "document";
      if (BLOCKED_RESOURCE_TYPES.has(resourceType) || url.protocol !== "https:" || !args.isAllowedOrigin(url.origin) || (document && !args.robotsAllows(target))) {
        blockedSubrequests += 1;
        return false;
      }
      await assertPublicNetworkTarget(target, args.resolveHost);
      return true;
    } catch {
      blockedSubrequests += 1;
      return false;
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new RenderRefusal("Rendered fallback timed out.")), args.policy.timeoutMs); });
  try {
    const result = await Promise.race([args.adapter.render({ url: args.url, timeoutMs: args.policy.timeoutMs, maxBytes: args.maxBytes, userAgent: args.userAgent, allowRequest }), timeout]);
    const final = new URL(result.finalUrl);
    if (final.protocol !== "https:" || !args.isAllowedOrigin(final.origin)) throw new RenderRefusal("Rendered navigation left the verified site.");
    if (Buffer.byteLength(result.html, "utf8") > args.maxBytes) throw new RenderRefusal("Rendered DOM exceeded the discovery size limit.");
    return { finalUrl: final.toString(), html: result.html, blockedSubrequests };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
