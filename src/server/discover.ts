/**
 * Finding services: recognising what an address is, and scanning the network for apps.
 *
 * Probes only read a page's title, headers and first few KB, and send no keys, so they accept
 * self-signed certificates (a NAS on :5001, Proxmox on :8006). Scans stay inside private address
 * ranges the admin chose, and are capped in size.
 */
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, Socket } from "node:net";
import { networkInterfaces } from "node:os";
import { APPS, type AppDef } from "../shared/catalog";
import { isLocalUrl } from "../shared/config";

export interface Probe {
  url: string;
  status: number;
  title: string;
  body: string;
  headers: Record<string, string>;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  middot: "·",
};

/** A page title as people read it: "HomeNAS&nbsp;-&nbsp;Synology" → "HomeNAS - Synology". */
export function decodeTitle(s: string): string {
  return s
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e.startsWith("#")) {
        const n = /^#x/i.test(e) ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** GET an address and read a little of it. Follows a redirect or two on the same host. */
export function probe(url: string, timeoutMs = 3000, hops = 2): Promise<Probe | null> {
  return new Promise((resolve) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      resolve(null);
      return;
    }
    const req = (u.protocol === "https:" ? httpsRequest : httpRequest)(
      u,
      {
        method: "GET",
        timeout: timeoutMs,
        rejectUnauthorized: false,
        headers: { "user-agent": "Hearth", accept: "text/html,application/json,*/*" },
      },
      (res) => {
        const loc = res.headers.location;
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc && hops > 0) {
          res.resume();
          const next = new URL(loc, u);
          if (next.hostname === u.hostname) {
            void probe(next.href, timeoutMs, hops - 1).then(resolve);
            return;
          }
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
          if (body.length > 96_000) res.destroy();
        });
        const done = () =>
          resolve({
            url: u.href,
            status: res.statusCode ?? 0,
            title: decodeTitle(/<title[^>]*>([^<]*)<\/title>/i.exec(body)?.[1] ?? "").slice(0, 120),
            body,
            headers: Object.fromEntries(
              Object.entries(res.headers).map(([k, v]) => [k, String(v)]),
            ),
          });
        res.on("end", done);
        res.on("close", done);
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
    req.end();
  });
}

function matches(app: AppDef, p: Probe): boolean {
  const m = app.match;
  if (m.title && p.title && new RegExp(m.title, "i").test(p.title)) return true;
  if (m.body && new RegExp(m.body, "i").test(p.body)) return true;
  if (
    m.header &&
    Object.entries(p.headers).some(([k, v]) =>
      new RegExp(m.header as string, "i").test(`${k}: ${v}`),
    )
  )
    return true;
  return false;
}

/**
 * Which app an address is, by its page and, when that doesn't say, the apps' own probe paths.
 * `port` limits the probes to apps that usually use it (a scan); without it every app's probe is
 * tried (an address typed in, maybe on an unusual port).
 */
export async function recognise(
  url: string,
  extra: AppDef[] = [],
  port?: number,
): Promise<{ app: AppDef | null; title: string; reachable: boolean }> {
  const apps = [...APPS, ...extra];
  const first = await probe(url);
  if (!first) return { app: null, title: "", reachable: false };
  const direct = apps.find((a) => matches(a, first));
  if (direct) return { app: direct, title: first.title, reachable: true };
  const base = new URL(url);
  const candidates = apps.filter(
    (x) => x.match.probe && (port === undefined || x.ports.includes(port)),
  );
  // All at once; the first in catalog order that answers wins.
  const answers = await Promise.all(
    candidates.map(async (a) => {
      const pr = a.match.probe as { path: string; body: string };
      const p = await probe(new URL(pr.path, base).href, 2000, 0);
      return p !== null && p.status < 400 && p.body.includes(pr.body);
    }),
  );
  return { app: candidates[answers.indexOf(true)] ?? null, title: first.title, reachable: true };
}

// ---------------------------------------------------------------------------
// Scanning

const MAX_HOSTS = 1024;
const COMMON_WEB = [80, 443, 3000, 5000, 5001, 8000, 8080, 8081, 8443, 8888, 9000, 9090, 9443];

export function scanPorts(extra: AppDef[] = []): number[] {
  return [...new Set([...COMMON_WEB, ...[...APPS, ...extra].flatMap((a) => a.ports)])].sort(
    (a, b) => a - b,
  );
}

const ipToNum = (ip: string) => ip.split(".").reduce((n, o) => n * 256 + Number(o), 0);
const numToIp = (n: number) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");

/** "192.168.1.0/24, 10.0.0.5, nas.home" → the hosts to try. Only private addresses and names. */
export function parseTargets(text: string): { hosts: string[]; refused: string[] } {
  const hosts = new Set<string>();
  const refused: string[] = [];
  for (const raw of text.split(/[\s,;]+/).filter(Boolean)) {
    const [addr, bitsText] = raw.split("/");
    if (!addr) continue;
    if (isIP(addr) === 4) {
      if (!isLocalUrl(`http://${addr}`)) {
        refused.push(raw);
        continue;
      }
      const bits = bitsText ? Number(bitsText) : 32;
      if (!(bits >= 22 && bits <= 32)) {
        refused.push(raw);
        continue;
      }
      const size = 2 ** (32 - bits);
      const start = Math.floor(ipToNum(addr) / size) * size;
      for (let i = size > 2 ? 1 : 0; i < (size > 2 ? size - 1 : size); i++)
        hosts.add(numToIp(start + i));
    } else if (/^[a-z0-9.-]+$/i.test(addr) && isLocalUrl(`http://${addr}`))
      hosts.add(addr.toLowerCase());
    else refused.push(raw);
    if (hosts.size > MAX_HOSTS) break;
  }
  return { hosts: [...hosts].slice(0, MAX_HOSTS), refused };
}

/** Where to look by default: this machine's networks, and the hosts the tiles already use. */
export function defaultTargets(tileUrls: string[]): string {
  const nets = new Set<string>();
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family !== "IPv4" || i.internal) continue;
      // Docker's own bridges, VPNs like Tailscale (100.64/10) and link-local addresses aren't
      // the home network. They can still be typed in.
      if (/^172\.(1[7-9]|2\d|3[01])\./.test(i.address)) continue;
      if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(i.address)) continue;
      if (/^169\.254\./.test(i.address)) continue;
      nets.add(`${i.address.split(".").slice(0, 3).join(".")}.0/24`);
    }
  }
  for (const u of tileUrls) {
    try {
      const h = new URL(u).hostname;
      if (isIP(h) === 4 && isLocalUrl(u)) nets.add(`${h.split(".").slice(0, 3).join(".")}.0/24`);
    } catch {
      // Not an address.
    }
  }
  return [...nets].join(", ");
}

function portOpen(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = new Socket();
    const done = (open: boolean) => {
      s.destroy();
      resolve(open);
    };
    s.setTimeout(timeoutMs);
    s.once("connect", () => done(true));
    s.once("timeout", () => done(false));
    s.once("error", () => done(false));
    s.connect(port, host);
  });
}

export interface Found {
  url: string;
  host: string;
  port: number;
  title: string;
  app?: { id: string; name: string; icon: string; category: string; color?: string };
}

/** Run jobs with at most `n` at a time. */
async function pool<T>(
  items: T[],
  n: number,
  fn: (item: T) => Promise<void>,
  signal?: AbortSignal,
) {
  let next = 0;
  const worker = async () => {
    while (next < items.length && !signal?.aborted) await fn(items[next++] as T);
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

/** Try every port on every host, then look at what answered. Reports as it goes. */
export async function scan(
  hosts: string[],
  ports: number[],
  onProgress: (done: number, total: number) => void,
  onFound: (f: Found) => void,
  signal?: AbortSignal,
  extra: AppDef[] = [],
  /** While looking at what answered: how many of them so far. */
  onLooking?: (done: number, total: number) => void,
): Promise<void> {
  const jobs = hosts.flatMap((host) => ports.map((port) => ({ host, port })));
  let done = 0;
  const open: { host: string; port: number }[] = [];
  await pool(
    jobs,
    256,
    async (job) => {
      if (await portOpen(job.host, job.port, 450)) open.push(job);
      if (++done % 200 === 0) onProgress(done, jobs.length);
    },
    signal,
  );
  onProgress(jobs.length, jobs.length);
  const apps = [...APPS, ...extra];
  let looked = 0;
  onLooking?.(0, open.length);
  await pool(
    open,
    48,
    async ({ host, port }) => {
      const likelyHttps =
        port === 443 ||
        port === 8443 ||
        port === 5001 ||
        port === 9443 ||
        apps.some((a) => a.https && a.ports.includes(port));
      const schemes = likelyHttps ? ["https", "http"] : ["http", "https"];
      for (const scheme of schemes) {
        if (signal?.aborted) return;
        const url = `${scheme}://${host}${(scheme === "http" && port === 80) || (scheme === "https" && port === 443) ? "" : `:${port}`}`;
        const r = await recognise(url, extra, port);
        if (!r.reachable) continue;
        onFound({
          url,
          host,
          port,
          title: r.title,
          app: r.app
            ? {
                id: r.app.id,
                name: r.app.name,
                icon: r.app.icon,
                category: r.app.category,
                color: r.app.color,
              }
            : undefined,
        });
        break;
      }
      onLooking?.(++looked, open.length);
    },
    signal,
  );
}
