import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import type { ResolveHost } from "./types.ts";

const PRIVATE_IPV4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as Array<[string, number]>) PRIVATE_IPV4.addSubnet(address, prefix, "ipv4");

const PRIVATE_IPV6 = new BlockList();
for (const [address, prefix] of [
  ["::", 128], ["::1", 128], ["100::", 64], ["2001:2::", 48], ["2001:db8::", 32],
  ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as Array<[string, number]>) PRIVATE_IPV6.addSubnet(address, prefix, "ipv6");

function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function embeddedIpv4(address: string): string | null {
  const value = address.toLowerCase();
  const dotted = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1]!;
  const hex = value.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const high = Number.parseInt(hex[1]!, 16);
  const low = Number.parseInt(hex[2]!, 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

export function isPublicNetworkAddress(address: string): boolean {
  const mapped = embeddedIpv4(address);
  if (mapped) return isPublicNetworkAddress(mapped);
  const family = isIP(address);
  if (family === 4) return !PRIVATE_IPV4.check(address, "ipv4");
  if (family === 6) return !PRIVATE_IPV6.check(address, "ipv6");
  return false;
}

function numericHost(hostname: string): boolean {
  return /^(?:\d+$|0x[0-9a-f]+$|\d+(?:\.\d+){1,3})$/i.test(hostname) && isIP(hostname) === 0;
}

export function isPublicHttpsUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    const hostname = hostOf(url);
    if (
      url.protocol !== "https:" || url.username || url.password || !hostname || hostname === "localhost"
      || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")
      || hostname.endsWith(".onion") || numericHost(hostname)
    ) return false;
    return isIP(hostname) === 0 || isPublicNetworkAddress(hostname);
  } catch {
    return false;
  }
}

export function canonicalHttpsUrl(value: string, base?: string): string | null {
  try {
    const url = base ? new URL(value, base) : new URL(value);
    url.hash = "";
    return isPublicHttpsUrl(url.toString()) ? url.toString() : null;
  } catch {
    return null;
  }
}

export const defaultResolveHost: ResolveHost = async (hostname) => {
  const family = isIP(hostname);
  if (family) return [{ address: hostname, family }];
  return (await lookup(hostname, { all: true, verbatim: true })).map((item) => ({ address: item.address, family: item.family }));
};

export async function resolvePublicNetworkAddresses(value: string, resolveHost: ResolveHost = defaultResolveHost) {
  if (!isPublicHttpsUrl(value)) throw new Error("Refused a non-public HTTPS URL.");
  const addresses = await resolveHost(hostOf(new URL(value)));
  if (!addresses.length || addresses.some((item) => !isPublicNetworkAddress(item.address))) {
    throw new Error("Refused a hostname resolving to a private or reserved network address.");
  }
  return addresses;
}

export async function assertPublicNetworkTarget(value: string, resolveHost: ResolveHost = defaultResolveHost): Promise<void> {
  await resolvePublicNetworkAddresses(value, resolveHost);
}

function pinLookup(addresses: Array<{ address: string; family: number }>): LookupFunction {
  const primary = addresses[0];
  return ((_: string, options: any, callback?: any) => {
    const cb = typeof options === "function" ? options : callback;
    if (typeof cb !== "function" || !primary) return;
    if (options && typeof options === "object" && options.all) cb(null, addresses);
    else cb(null, primary.address, primary.family);
  }) as LookupFunction;
}

export async function fetchPinned(args: {
  url: string;
  resolveHost: ResolveHost;
  userAgent: string;
  accept: string;
  maxBytes: number;
  timeoutMs: number;
}): Promise<Response> {
  const addresses = await resolvePublicNetworkAddresses(args.url, args.resolveHost);
  const url = new URL(args.url);
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request({
      protocol: url.protocol,
      hostname: hostOf(url),
      servername: isIP(hostOf(url)) ? undefined : hostOf(url),
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers: { Host: url.host, "User-Agent": args.userAgent, Accept: args.accept },
      family: addresses[0]?.family,
      lookup: pinLookup(addresses),
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const contentLength = Number(response.headers["content-length"]);
      if (Number.isFinite(contentLength) && contentLength > args.maxBytes) {
        request.destroy();
        reject(new Error("Response exceeded the discovery size limit."));
        return;
      }
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > args.maxBytes) {
          request.destroy();
          reject(new Error("Response exceeded the discovery size limit."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(response.headers)) {
          if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
        }
        resolve(new Response(Buffer.concat(chunks).toString("utf8"), { status: response.statusCode ?? 0, headers }));
      });
    });
    request.setTimeout(args.timeoutMs, () => request.destroy(new Error("Discovery request timed out.")));
    request.on("error", reject);
    request.end();
  });
}
