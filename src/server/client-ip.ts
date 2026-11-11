/**
 * The address of the device asking. Behind DSM's reverse proxy every request comes from the proxy,
 * which says who it's for in X-Forwarded-For. That header is believed only from a trusted proxy:
 * this machine, a container bridge (172.16.0.0/12), or addresses the admin lists. A device on the
 * network that talks to Hearth directly can't pretend to be another.
 */
import { isIPv4 } from "node:net";

const plain = (a: string) =>
  a
    .trim()
    .replace(/^::ffff:/i, "")
    .replace(/^\[|\]$/g, "");

const v4 = (a: string) => a.split(".").reduce((n, p) => n * 256 + Number(p), 0);
/** Whether an IPv4 address is in a range like 192.168.2.0/24 (or is that address). */
export function inCidr(addr: string, cidr: string): boolean {
  const [net, bits = "32"] = cidr.split("/");
  if (!net || !isIPv4(addr) || !isIPv4(net)) return addr === cidr;
  const size = Number(bits);
  const mask = size === 0 ? 0 : (0xffffffff << (32 - size)) >>> 0;
  return (v4(addr) & mask) >>> 0 === (v4(net) & mask) >>> 0;
}

export function isTrustedProxy(addr: string, extra: string[] = []): boolean {
  const a = plain(addr);
  return (
    a === "::1" ||
    inCidr(a, "127.0.0.0/8") ||
    inCidr(a, "172.16.0.0/12") ||
    extra.some((x) => inCidr(a, x.trim()))
  );
}

/** The device's own address, from the connection and (only through a trusted proxy) its header. */
export function clientIp(
  peer: string | undefined,
  forwardedFor: string | undefined,
  trusted: string[] = [],
): string | undefined {
  if (!peer) return undefined;
  const from = plain(peer);
  if (!forwardedFor || !isTrustedProxy(from, trusted)) return from;
  // Walk back from the nearest hop: the first address that isn't a trusted proxy is the device.
  const hops = forwardedFor.split(",").map(plain).filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = hops[i] as string;
    if (!isTrustedProxy(hop, trusted)) return hop;
  }
  return hops[0] ?? from;
}
