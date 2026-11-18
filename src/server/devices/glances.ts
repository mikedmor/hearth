/**
 * A computer's resources through Glances (https://nicolargo.github.io/glances/), its web API on
 * port 61208: processor, load, memory, temperatures, disks and network. Version 4 is read at
 * /api/4, version 3 at /api/3. Read only; a password (Glances' --password) is sent as Basic auth.
 */
import { guardedFetch, NetError } from "../net";

export class GlancesError extends Error {}

export interface GlancesReading {
  name?: string;
  model?: string;
  cpu?: number;
  load?: [number, number, number];
  cores?: number;
  memTotal?: number;
  memUsed?: number;
  temp?: number;
  uptime?: number;
  rx?: number;
  tx?: number;
  volumes: { name: string; total: number; used: number }[];
}

type Obj = Record<string, unknown>;
const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};
const str = (v: unknown, n = 80) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined;
const list = (v: unknown): Obj[] =>
  Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : [];

/** "3 days, 4:05:06", "1 day, 0:01:02" or "4:05:06", in seconds. */
export function parseUptime(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return undefined;
  const m = /(?:(\d+)\s+days?,\s*)?(\d+):(\d{2}):(\d{2})/.exec(v);
  if (!m) return undefined;
  return Number(m[1] ?? 0) * 86400 + Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

/** Network ports that aren't real traffic: loopback, containers, bridges, tunnels. */
const VIRTUAL =
  /^(lo|docker|veth|br-|virbr|vmnet|vEthernet|Loopback|isatap|teredo|tun|tap|wg|tailscale|zt|utun|awdl|llw|bridge|cni|flannel|kube)/i;
/** Filesystems that aren't disks. */
const NOT_DISK =
  /^(tmpfs|devtmpfs|overlay|squashfs|proc|sysfs|nsfs|autofs|efivarfs|fuse\.snapfuse)$/i;

/** Work out the readings from Glances' answers. `prev` holds byte counters for rates. */
export function parseGlances(
  a: {
    cpu?: unknown;
    load?: unknown;
    mem?: unknown;
    fs?: unknown;
    network?: unknown;
    sensors?: unknown;
    uptime?: unknown;
    system?: unknown;
    core?: unknown;
  },
  prev: { at: number; rx: number; tx: number } | null,
  now: number,
): { reading: GlancesReading; counters: { at: number; rx: number; tx: number } | null } {
  const cpu = (a.cpu ?? {}) as Obj;
  const load = (a.load ?? {}) as Obj;
  const mem = (a.mem ?? {}) as Obj;
  const sys = (a.system ?? {}) as Obj;
  const core = (a.core ?? {}) as Obj;

  // Network: Glances 4 gives a rate per second; 3 gives bytes since its last update. Without
  // either, the cumulative counters between two reads.
  let rx = 0;
  let tx = 0;
  let rated = false;
  let cumRx = 0;
  let cumTx = 0;
  let cumulative = true;
  for (const n of list(a.network)) {
    const name = str(n.interface_name) ?? "";
    if (!name || VIRTUAL.test(name) || n.is_up === false) continue;
    const rr = num(n.bytes_recv_rate_per_sec);
    const tr = num(n.bytes_sent_rate_per_sec);
    const since = num(n.time_since_update);
    if (rr !== undefined && tr !== undefined) {
      rx += rr;
      tx += tr;
      rated = true;
    } else if (num(n.rx) !== undefined && since) {
      rx += (num(n.rx) ?? 0) / since;
      tx += (num(n.tx) ?? 0) / since;
      rated = true;
    }
    const cr = num(n.bytes_recv_gauge) ?? num(n.cumulative_rx);
    const ct = num(n.bytes_sent_gauge) ?? num(n.cumulative_tx);
    if (cr === undefined || ct === undefined) cumulative = false;
    else {
      cumRx += cr;
      cumTx += ct;
    }
  }
  const counters = cumulative ? { at: now, rx: cumRx, tx: cumTx } : null;
  if (!rated && counters && prev && now > prev.at && counters.rx >= prev.rx) {
    const s = (now - prev.at) / 1000;
    rx = (counters.rx - prev.rx) / s;
    tx = (counters.tx - prev.tx) / s;
    rated = true;
  }

  // Temperature: the processor package if it says, else the hottest core.
  const temps = list(a.sensors).filter(
    (s) => /temperature/i.test(str(s.type) ?? "") && num(s.value) !== undefined,
  );
  const pkg = temps.find((s) => /package|tctl|tdie|cpu/i.test(str(s.label) ?? ""));
  const hottest = temps.reduce<number | undefined>(
    (m, s) => Math.max(m ?? Number.NEGATIVE_INFINITY, num(s.value) ?? Number.NEGATIVE_INFINITY),
    undefined,
  );
  const temp = num(pkg?.value) ?? (temps.length ? hottest : undefined);

  // Disks: real filesystems, each device once, a gigabyte or more.
  const seen = new Set<string>();
  const volumes = list(a.fs).flatMap((f) => {
    const total = num(f.size);
    const used = num(f.used);
    const dev = str(f.device_name, 200) ?? str(f.mnt_point, 200) ?? "";
    if (total === undefined || used === undefined || total < 1e9) return [];
    if (NOT_DISK.test(str(f.fs_type) ?? "") || seen.has(dev)) return [];
    if (/^\/(snap|boot|run|sys|proc|dev)\b/.test(str(f.mnt_point) ?? "")) return [];
    seen.add(dev);
    return [{ name: str(f.mnt_point, 60) ?? dev, total, used }];
  });

  const os = [str(sys.os_name, 30), str(sys.linux_distro, 60) ?? str(sys.os_version, 40)];
  const reading: GlancesReading = {
    name: str(sys.hostname, 60),
    model: str(sys.hr_name, 80) ?? (os.filter(Boolean).join(" ") || undefined),
    cpu: num(cpu.total),
    load:
      num(load.min1) !== undefined
        ? [num(load.min1) ?? 0, num(load.min5) ?? 0, num(load.min15) ?? 0]
        : undefined,
    cores: num(load.cpucore) ?? num(core.log) ?? num(cpu.cpucore),
    memTotal: num(mem.total),
    memUsed: num(mem.used),
    temp: temp !== undefined ? Math.round(temp) : undefined,
    uptime: parseUptime(a.uptime),
    rx: rated ? Math.round(rx) : undefined,
    tx: rated ? Math.round(tx) : undefined,
    volumes,
  };
  return { reading, counters };
}

const PARTS = [
  "cpu",
  "load",
  "mem",
  "fs",
  "network",
  "sensors",
  "uptime",
  "system",
  "core",
] as const;

export class Glances {
  private api: string | null = null;
  private counters: { at: number; rx: number; tx: number } | null = null;

  constructor(
    private readonly opts: {
      url: string;
      user?: string;
      password?: string;
      fetch?: typeof fetch;
      now?: () => number;
    },
  ) {}

  private async get(path: string): Promise<{ status: number; data: unknown }> {
    const headers: Record<string, string> = {};
    if (this.opts.password)
      headers.authorization = `Basic ${Buffer.from(`${this.opts.user || "glances"}:${this.opts.password}`).toString("base64")}`;
    let r: Awaited<ReturnType<typeof guardedFetch>>;
    try {
      r = await guardedFetch(`${this.opts.url.replace(/\/+$/, "")}${path}`, {
        headers,
        policy: { allowInternet: false },
        fetch: this.opts.fetch,
        timeoutMs: 6000,
        maxBytes: 4 * 1024 * 1024,
      });
    } catch (e) {
      throw new GlancesError(
        e instanceof NetError
          ? e.message
          : "Glances didn't answer. Is it running in web mode (glances -w)?",
      );
    }
    if (r.status === 401)
      throw new GlancesError("Glances wants a password: give the one it was started with.");
    if (r.status >= 400) return { status: r.status, data: null };
    try {
      return { status: r.status, data: JSON.parse(r.body.toString("utf8")) };
    } catch {
      throw new GlancesError("That doesn't look like Glances' web API.");
    }
  }

  /** Which API it speaks: 4, then 3. */
  private async version(): Promise<string> {
    if (this.api) return this.api;
    for (const v of ["/api/4", "/api/3"]) {
      const r = await this.get(`${v}/cpu`);
      if (r.status < 400 && r.data && typeof r.data === "object") {
        this.api = v;
        return v;
      }
    }
    throw new GlancesError("That address doesn't answer like Glances (version 3 or 4).");
  }

  async read(): Promise<GlancesReading> {
    const v = await this.version();
    const got = await Promise.all(
      PARTS.map((p) => this.get(`${v}/${p}`).then((r) => (r.status < 400 ? r.data : undefined))),
    );
    const parts = Object.fromEntries(PARTS.map((p, i) => [p, got[i]]));
    if (!parts.cpu && !parts.mem) {
      this.api = null;
      throw new GlancesError("Glances didn't say how the computer is doing.");
    }
    const { reading, counters } = parseGlances(parts, this.counters, (this.opts.now ?? Date.now)());
    this.counters = counters;
    return reading;
  }
}
