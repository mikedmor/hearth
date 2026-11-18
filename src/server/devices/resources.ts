/**
 * Keeps the home's machines' resources while someone is looking: the router, the NAS, and any
 * added machines (a mesh access point, a computer running Glances). The Devices page or a widget
 * asks, and Hearth reads them every 30 seconds until nobody has asked for a few minutes. The last
 * half hour of readings is kept in memory for small charts.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { MachineKind, ResourceSource, Resources } from "../../shared/resources";
import { Glances, GlancesError, type GlancesReading } from "./glances";
import { GlInet, RouterError, type RouterStatus } from "./glinet";
import { type NasReading, SnmpError, SnmpReader, type SnmpSettings } from "./snmp";

const EVERY_MS = 30_000;
/** Keep reading this long after the last time someone asked. */
const WANTED_MS = 3 * 60_000;
const KEEP = 60;

type Base = Omit<Resources, "problems" | "history">;

/** An added machine, with its password. */
export interface MachineSpec {
  id: string;
  kind: MachineKind;
  name: string;
  url: string;
  user?: string;
  password?: string;
}

/** Reads one added machine (a fake in tests). */
export interface MachineClient {
  read(): Promise<{ base: Base; extra?: string[] }>;
}

export interface ResourceDeps {
  router: () => GlInet | null;
  routerUrl: () => string | undefined;
  nas: () => SnmpSettings | null;
  /** Access points and Glances computers. */
  machines?: () => MachineSpec[];
  /** A reader for some settings (a fake in tests). */
  reader?: (s: SnmpSettings) => SnmpReader;
  /** A client for an added machine (a fake in tests). */
  client?: (m: MachineSpec) => MachineClient;
  resolve?: (host: string) => Promise<string | undefined>;
  now?: () => number;
  /** New readings arrived (widgets refresh). */
  onChange?: () => void;
}

const pct = (used?: number, total?: number) =>
  used !== undefined && total ? Math.round((1000 * used) / total) / 10 : undefined;

async function resolveHost(host: string): Promise<string | undefined> {
  if (isIP(host)) return host;
  try {
    return (await lookup(host, { family: 4 })).address;
  } catch {
    return undefined;
  }
}

export const hostOf = (url?: string) => {
  try {
    return url ? new URL(url).hostname.replace(/^\[|\]$/g, "") : undefined;
  } catch {
    return undefined;
  }
};

const empty = (): Resources["history"] => ({ cpu: [], mem: [], rx: [], tx: [], temp: [] });

function push(h: Resources["history"], r: Resources) {
  const add = (k: keyof Resources["history"], v: number | undefined) => {
    if (v === undefined) return;
    h[k].push(v);
    if (h[k].length > KEEP) h[k].splice(0, h[k].length - KEEP);
  };
  // A GL.iNet has no processor percentage: its 1-minute load per core stands in.
  add("cpu", r.cpu ?? (r.load && r.cores ? Math.round((100 * r.load[0]) / r.cores) : r.load?.[0]));
  add("mem", pct(r.memUsed, r.memTotal));
  add("rx", r.rx);
  add("tx", r.tx);
  add("temp", r.temp);
}

/** How hot is too hot, by kind: a NAS's system sensor reads far lower than a processor. */
export const HOT: Record<ResourceSource, number> = { router: 90, ap: 90, nas: 65, glances: 90 };

/** Plain sentences for whatever needs a look. */
export function problemsOf(r: Base, extra: string[] = []) {
  const out = [...extra];
  const who = r.source === "router" ? "The router" : r.source === "nas" ? "The NAS" : r.name;
  if (r.internet === false) out.push("The router can't reach the internet.");
  if (r.temp !== undefined && r.temp >= HOT[r.source])
    out.push(`${who} is running hot (${r.temp} °C).`);
  const mem = pct(r.memUsed, r.memTotal);
  if (mem !== undefined && mem >= 95) out.push(`${who}'s memory is ${Math.round(mem)}% used.`);
  for (const d of r.disks) {
    if (!d.ok) out.push(`${d.name}: ${d.status.toLowerCase()}.`);
    else if (d.temp !== undefined && d.temp >= 55)
      out.push(`${d.name} is running hot (${d.temp} °C).`);
  }
  const whose = r.source === "glances" || r.source === "ap" ? `${r.name}: ` : "";
  for (const v of r.volumes) {
    const p = pct(v.used, v.total);
    if (p !== undefined && p >= 90) out.push(`${whose}${v.name} is ${Math.round(p)}% full.`);
  }
  if (r.fans && r.fans !== "Normal") out.push(`${r.fans}.`);
  return out;
}

/** A GL.iNet's readings: the main router, or an access point (no internet line of its own). */
export function fromRouter(
  s: RouterStatus,
  as: { key: string; source: "router" | "ap"; name: string } = {
    key: "router",
    source: "router",
    name: "Router",
  },
): Base {
  return {
    key: as.key,
    source: as.source,
    name: as.name,
    ok: true,
    model: s.model?.toUpperCase(),
    version: s.version,
    load: s.load,
    cores: s.cores,
    memTotal: s.memTotal,
    memUsed: s.memUsed,
    temp: s.temp,
    uptime: s.uptime,
    rx: s.rx,
    tx: s.tx,
    internet: as.source === "router" ? s.internet : undefined,
    volumes:
      s.flashTotal !== undefined && s.flashUsed !== undefined
        ? [{ name: "Its storage", total: s.flashTotal, used: s.flashUsed }]
        : [],
    disks: [],
  };
}

export function fromGlances(g: GlancesReading, as: { key: string; name: string }): Base {
  return {
    key: as.key,
    source: "glances",
    name: as.name,
    ok: true,
    model: g.model,
    cpu: g.cpu,
    load: g.load,
    cores: g.cores,
    memTotal: g.memTotal,
    memUsed: g.memUsed,
    temp: g.temp,
    uptime: g.uptime,
    rx: g.rx,
    tx: g.tx,
    volumes: g.volumes,
    disks: [],
  };
}

export function fromNas(n: NasReading): { base: Base; extra: string[] } {
  const extra: string[] = [];
  if (n.systemFailed) extra.push("The NAS says its system has failed.");
  for (const p of n.pools) if (!p.ok) extra.push(`${p.name}: ${p.status.toLowerCase()}.`);
  return {
    base: {
      key: "nas",
      source: "nas",
      name: n.name ?? "NAS",
      ok: true,
      model: n.model,
      version: n.version,
      cpu: n.cpu,
      load: n.load,
      cores: n.cores,
      memTotal: n.memTotal,
      memUsed: n.memUsed,
      temp: n.temp,
      uptime: n.uptime,
      rx: n.rx,
      tx: n.tx,
      volumes: n.volumes,
      disks: n.disks,
      fans: n.fans,
      update: n.update,
    },
    extra,
  };
}

/** The usual client for an added machine. */
export function machineClient(m: MachineSpec): MachineClient {
  const key = `m:${m.id}`;
  if (m.kind === "glinet") {
    const g = new GlInet({ url: m.url, password: m.password });
    return {
      read: async () => ({
        base: fromRouter(await g.status(), { key, source: "ap", name: m.name }),
      }),
    };
  }
  const g = new Glances({ url: m.url, user: m.user, password: m.password });
  return { read: async () => ({ base: fromGlances(await g.read(), { key, name: m.name }) }) };
}

const sourceOf = (m: MachineSpec): ResourceSource => (m.kind === "glinet" ? "ap" : "glances");

export class ResourceMonitor {
  private state = new Map<string, Resources>();
  private history = new Map<string, Resources["history"]>();
  private reader: SnmpReader | null = null;
  private readerKey = "";
  private clients = new Map<string, { sig: string; client: MachineClient }>();
  private wantedAt = 0;
  private lastRead = 0;
  private timer: NodeJS.Timeout | undefined;
  private reading: Promise<void> | null = null;

  constructor(private readonly deps: ResourceDeps) {}

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  /** Someone is looking: keep reading (and read now if it's been a while). */
  want(): void {
    this.wantedAt = this.now();
    if (this.now() - this.lastRead > EVERY_MS - 2000) void this.refresh();
    if (!this.timer) this.schedule();
  }

  private schedule() {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.now() - this.wantedAt > WANTED_MS) return;
      void this.refresh().finally(() => this.schedule());
    }, EVERY_MS);
    this.timer.unref?.();
  }

  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.reader?.close();
  }

  private specs(): MachineSpec[] {
    return this.deps.machines?.() ?? [];
  }

  /** The latest readings (none for what isn't set up). */
  view(): { router?: Resources; nas?: Resources; machines: Resources[] } {
    return {
      router: this.state.get("router"),
      nas: this.state.get("nas"),
      machines: this.specs().flatMap((m) => {
        const r = this.state.get(`m:${m.id}`);
        return r ? [r] : [];
      }),
    };
  }

  /** Settings changed: forget what was read and read again. */
  async reset(): Promise<void> {
    this.state.clear();
    this.history.clear();
    this.reader?.close();
    this.reader = null;
    this.readerKey = "";
    this.clients.clear();
    this.lastRead = 0;
    await this.refresh();
  }

  /** Read everything now (one round at a time). */
  refresh(): Promise<void> {
    this.reading ??= Promise.all([
      this.readRouter(),
      this.readNas(),
      ...this.specs().map((m) => this.readMachine(m)),
    ])
      .then(() => {
        // Forget machines that were taken off.
        const keep = new Set(["router", "nas", ...this.specs().map((m) => `m:${m.id}`)]);
        for (const k of [...this.state.keys()]) if (!keep.has(k)) this.state.delete(k);
        for (const k of [...this.history.keys()]) if (!keep.has(k)) this.history.delete(k);
        for (const k of [...this.clients.keys()]) if (!keep.has(k)) this.clients.delete(k);
        this.lastRead = this.now();
        this.deps.onChange?.();
      })
      .finally(() => {
        this.reading = null;
      });
    return this.reading;
  }

  private settle(
    key: string,
    fallback: { source: ResourceSource; name: string },
    base: Base | null,
    error: string | undefined,
    ip: string | undefined,
    extra: string[] = [],
  ) {
    const h = this.history.get(key) ?? empty();
    this.history.set(key, h);
    if (base) {
      const r: Resources = {
        ...base,
        ip,
        at: new Date(this.now()).toISOString(),
        problems: problemsOf(base, extra),
        history: h,
      };
      push(h, r);
      this.state.set(key, r);
      return;
    }
    // Keep the last good numbers on screen, and say what went wrong.
    const prev = this.state.get(key);
    this.state.set(key, {
      ...(prev ?? { key, ...fallback, volumes: [], disks: [], history: h }),
      ip: ip ?? prev?.ip,
      ok: false,
      error,
      problems: prev?.problems ?? [],
    });
  }

  private async readRouter(): Promise<void> {
    const r = this.deps.router();
    if (!r) {
      this.state.delete("router");
      return;
    }
    const host = hostOf(this.deps.routerUrl());
    const ip = host ? await (this.deps.resolve ?? resolveHost)(host) : undefined;
    const as = { source: "router" as const, name: "Router" };
    try {
      this.settle("router", as, fromRouter(await r.status()), undefined, ip);
    } catch (e) {
      const msg = e instanceof RouterError ? e.message : "The router didn't answer.";
      this.settle("router", as, null, msg, ip);
    }
  }

  private async readNas(): Promise<void> {
    const s = this.deps.nas();
    if (!s) {
      this.state.delete("nas");
      this.reader?.close();
      this.reader = null;
      return;
    }
    const key = JSON.stringify(s);
    if (key !== this.readerKey || !this.reader) {
      this.reader?.close();
      this.reader = (this.deps.reader ?? ((x) => new SnmpReader(x)))(s);
      this.readerKey = key;
    }
    const ip = await (this.deps.resolve ?? resolveHost)(s.host);
    const as = { source: "nas" as const, name: "NAS" };
    try {
      const { base, extra } = fromNas(await this.reader.read());
      this.settle("nas", as, base, undefined, ip, extra);
    } catch (e) {
      const msg = e instanceof SnmpError ? e.message : "The NAS didn't answer.";
      this.settle("nas", as, null, msg, ip);
    }
  }

  private async readMachine(m: MachineSpec): Promise<void> {
    const key = `m:${m.id}`;
    // One client per settings, so a GL.iNet's session and Glances' counters are kept.
    const sig = JSON.stringify(m);
    let c = this.clients.get(key);
    if (!c || c.sig !== sig) {
      c = { sig, client: (this.deps.client ?? machineClient)(m) };
      this.clients.set(key, c);
    }
    const host = hostOf(m.url);
    const ip = host ? await (this.deps.resolve ?? resolveHost)(host) : undefined;
    const as = { source: sourceOf(m), name: m.name };
    try {
      const { base, extra } = await c.client.read();
      this.settle(key, as, { ...base, name: m.name }, undefined, ip, extra);
    } catch (e) {
      const msg =
        e instanceof RouterError || e instanceof GlancesError
          ? e.message
          : `${m.name} didn't answer.`;
      this.settle(key, as, null, msg, ip);
    }
  }

  /** Hearth's own data for widgets: plain numbers, with percentages worked out. */
  widgetData(): unknown {
    this.want();
    const flat = (r?: Resources) => {
      if (!r) return { connected: false };
      const vols = r.volumes.map((v) => ({ ...v, percent: pct(v.used, v.total) ?? 0 }));
      return {
        connected: true,
        key: r.key,
        kind: r.source,
        ok: r.ok,
        error: r.error ?? null,
        name: r.name,
        model: r.model ?? null,
        version: r.version ?? null,
        cpu: r.cpu ?? null,
        load1: r.load?.[0] ?? null,
        load5: r.load?.[1] ?? null,
        load15: r.load?.[2] ?? null,
        cores: r.cores ?? null,
        memTotal: r.memTotal ?? null,
        memUsed: r.memUsed ?? null,
        memPct: pct(r.memUsed, r.memTotal) ?? null,
        temp: r.temp ?? null,
        uptime: r.uptime ?? null,
        rx: r.rx ?? null,
        tx: r.tx ?? null,
        internet: r.internet ?? null,
        volumes: vols,
        volume: vols[0] ?? null,
        disks: r.disks,
        fans: r.fans ?? null,
        update: r.update ?? null,
        problems: r.problems,
        healthy: r.ok && r.problems.length === 0,
        history: r.history,
        at: r.at ?? null,
      };
    };
    const v = this.view();
    return {
      router: flat(v.router),
      nas: flat(v.nas),
      machines: v.machines.map(flat),
      /** Every machine's problems together, and the ones that aren't answering. */
      problems: [v.router, v.nas, ...v.machines].flatMap((r) =>
        !r ? [] : r.ok ? r.problems : [`${r.name}: ${r.error ?? "not answering"}`],
      ),
    };
  }
}
