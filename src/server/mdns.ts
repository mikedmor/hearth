/**
 * `.local` names (motioneye.local, printer.local) from inside Hearth's container.
 *
 * Browsers find these with multicast DNS, but a container on Docker's bridge network can't: its
 * multicast never reaches the home network. Plain UDP does, though, so Hearth asks every address
 * on the home network directly ("who is motioneye.local?", a unicast mDNS question). Only the
 * device with that name answers. Answers are kept for a while, and a name nobody claimed isn't
 * asked about again straight away, so a status check every 30 s costs nothing.
 */
import dgram from "node:dgram";
import { isIPv4 } from "node:net";
import { dnsName } from "./devices/identify";
import { isLocalName } from "./net";

export interface LocalNamesDeps {
  /** The home network's ranges to ask, like "192.168.1.0/24" (only /24s are asked). */
  networks: () => string[];
  now?: () => number;
  /** Ask these addresses about the name; resolves with the first IPv4 address claimed. */
  ask?: (name: string, ips: string[], timeoutMs: number) => Promise<string | null>;
  timeoutMs?: number;
}

/** How long an answer is kept, and how long before a name nobody claimed is asked again. */
const FOUND_MS = 10 * 60_000;
const MISSING_MS = 2 * 60_000;

export class LocalNames {
  private cache = new Map<string, { ip: string | null; at: number }>();
  private pending = new Map<string, Promise<string | null>>();

  constructor(private readonly deps: LocalNamesDeps) {}

  /** The address a `.local` name has on the home network, or null when no device claims it. */
  resolve(host: string): Promise<string | null> {
    const name = host.toLowerCase().replace(/\.$/, "");
    if (!isLocalName(name)) return Promise.resolve(null);
    const now = (this.deps.now ?? Date.now)();
    const hit = this.cache.get(name);
    if (hit && now - hit.at < (hit.ip ? FOUND_MS : MISSING_MS)) return Promise.resolve(hit.ip);
    const running = this.pending.get(name);
    if (running) return running;
    const ips = this.deps.networks().flatMap(hostsOf);
    // Before the first network check there's nobody to ask: that isn't "nobody has this name".
    if (!ips.length) return Promise.resolve(hit?.ip ?? null);
    const job = (this.deps.ask ?? askAll)(name, ips, this.deps.timeoutMs ?? 1500)
      .catch(() => null)
      .then((ip) => {
        // An answer that's gone stale is kept while the device doesn't answer (it may be asleep).
        const keep = ip ?? (hit?.ip && now - hit.at < FOUND_MS * 3 ? hit.ip : null);
        this.cache.set(name, { ip: keep, at: (this.deps.now ?? Date.now)() });
        this.pending.delete(name);
        return keep;
      });
    this.pending.set(name, job);
    return job;
  }
}

/** Every address in a /24 (1 to 254). Other sizes are skipped: asking more would be a flood. */
export function hostsOf(cidr: string): string[] {
  const [net, bits] = cidr.split("/");
  if (!net || bits !== "24" || !isIPv4(net)) return [];
  const base = net.split(".").slice(0, 3).join(".");
  return Array.from({ length: 254 }, (_, i) => `${base}.${i + 1}`);
}

/** A unicast mDNS question for a name's IPv4 address. */
export function aQuery(name: string, id = 0x4845): Buffer {
  return Buffer.concat([
    Buffer.from([id >> 8, id & 0xff, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]),
    ...name.split(".").map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])),
    Buffer.from([0, 0x00, 0x01, 0x00, 0x01]), // end of name; A; IN
  ]);
}

/** The first IPv4 address an answer gives for the name, if any. */
export function aAnswer(msg: Buffer, name: string): string | null {
  try {
    const questions = msg.readUInt16BE(4);
    const answers = msg.readUInt16BE(6) + msg.readUInt16BE(8) + msg.readUInt16BE(10);
    let off = 12;
    for (let i = 0; i < questions; i++) off = dnsName(msg, off).end + 4;
    for (let i = 0; i < answers && off + 10 <= msg.length; i++) {
      const rr = dnsName(msg, off);
      const type = msg.readUInt16BE(rr.end);
      const len = msg.readUInt16BE(rr.end + 8);
      const data = rr.end + 10;
      if (type === 1 && len === 4 && rr.name.toLowerCase() === name) {
        return [...msg.subarray(data, data + 4)].join(".");
      }
      off = data + len;
    }
  } catch {
    // Not an answer we can read.
  }
  return null;
}

function askAll(name: string, ips: string[], timeoutMs: number): Promise<string | null> {
  if (!ips.length) return Promise.resolve(null);
  return new Promise((resolve) => {
    const query = aQuery(name);
    const sock = dgram.createSocket("udp4");
    let settled = false;
    const done = (v: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        sock.close();
      } catch {
        // Already closed.
      }
      resolve(v);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    sock.on("error", () => done(null));
    sock.on("message", (msg) => {
      const ip = aAnswer(msg, name);
      if (ip) done(ip);
    });
    // A dropped packet or a dozing device: ask twice, a moment apart.
    const send = () => {
      for (const ip of ips) sock.send(query, 5353, ip, () => {});
    };
    sock.bind(0, () => {
      send();
      setTimeout(() => !settled && send(), Math.min(400, timeoutMs / 3));
    });
  });
}
