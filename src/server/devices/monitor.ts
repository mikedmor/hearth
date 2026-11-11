/**
 * Watching the devices: what runs on each, whether it's on the network, and telling the admin
 * when something they watch stops answering.
 *
 * - **Services** come from the tiles (a tile leads to the device its address resolves to, so
 *   every `.home` name behind the NAS's web server is on the NAS), the AI servers, and port
 *   checks of each device (the app catalog's ports; a recognised app gets its name and icon).
 * - **AI machines:** a shared AI server that lists its computers for apps says where each one
 *   connects from; that's its device.
 * - **Pinball tables:** a device with VPin Studio answering on its port gets its status, high
 *   scores and players, and the admin's controls.
 * - **Online:** it asked AdGuard Home for something lately, answered a quick connection (even a
 *   refused one means it's there), or one of its services answered.
 *
 * Nothing here changes a device. Port checks only connect and read a page's title.
 */
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, Socket } from "node:net";
import type { AiMachine, PinballWidgetData, StatusMap } from "../../shared/api";
import { type HearthConfig, isChecked, isLocalUrl } from "../../shared/config";
import type {
  DevicesView,
  DeviceView,
  FoundService,
  MachineView,
  MapLink,
  MapNode,
  NetworkMap,
  Presence,
  ServiceState,
  VpinView,
} from "../../shared/devices";
import { SCAN_VERSION } from "../../shared/devices";
import { listMachines } from "../ai/client";
import type { AiMonitor } from "../ai/monitor";
import { scan as scanNetwork, scanPorts } from "../discover";
import { resolveIcon } from "../icons";
import type { SmartHomeService } from "../smarthome/service";
import { StatusChecker } from "../status";
import { makerFromIdentity, tidyName, typeFrom } from "./clues";
import { type GlInet, RouterError, type RouterMap, type RouterNode } from "./glinet";
import { privateIp } from "./identify";
import { DeviceError } from "./service";
import type { DeviceStore } from "./store";
import {
  type VpinAction,
  VpinError,
  type VpinGame,
  vpinBase,
  vpinDo,
  vpinGames,
  vpinState,
  vpinWheel,
} from "./vpin";
import { WheelCache } from "./wheel";

/** Something watched has been down this long before the admin is told. */
export const ALERT_AFTER_MS = 3 * 60_000;
/** A port check is done again after this long. */
const SCAN_AGAIN_MS = 24 * 3600_000;
/** One that showed nothing may have been asleep (a printer on Wi-Fi): look again sooner. */
const SCAN_EMPTY_AGAIN_MS = 2 * 3600_000;
/** A device that asked AdGuard Home for something this recently is on the network. */
const ACTIVE_MS = 10 * 60_000;
/** A connection answer (or refusal) this recent says whether it's there. */
const REACH_FRESH_MS = 5 * 60_000;
/** Names are looked up again after this long. */
const DNS_MS = 10 * 60_000;
/** A table's list of tables is fetched again after this long. */
const GAMES_MS = 10 * 60_000;
/** Ports tried to see whether a device is there: web, SSH, file sharing, phones, printers, Cast. */
const REACH_PORTS = [80, 443, 22, 445, 139, 8080, 62078, 8008, 9100, 5000];
/** Types that are moved, sleep or are tiny: not port-checked by themselves (the admin still can). */
const NOT_SCANNED_BY_ITSELF = new Set(["phone", "tablet", "speaker", "plug", "camera"]);

export interface MonitorDeps {
  store: DeviceStore;
  /** The devices as the network sees them (DeviceService.view). */
  view: () => Promise<DevicesView>;
  config: () => HearthConfig;
  /** The tiles' status checks. */
  tileStatus: () => StatusMap;
  ai: AiMonitor;
  /** Send an alert (Settings → Internet → Alerts); the second says whether one is set up. */
  tell?: (title: string, text: string, tag?: string) => Promise<void>;
  alertsOn?: () => boolean;
  fetch?: typeof fetch;
  now?: () => number;
  /** Look up a name's addresses. */
  resolve?: (host: string) => Promise<string[]>;
  /** Whether something answers at this address. */
  reach?: (ip: string) => Promise<boolean>;
  /** The services on this address. */
  scan?: (ip: string) => Promise<FoundService[]>;
  /** The names (with port) browsers reach Hearth by: its own pages aren't services. */
  ownHosts?: () => Set<string>;
  /** The router, for who's connected to what (none until the admin connects it). */
  router?: () => GlInet | null;
  /** The router's address and whether its password is saved, for the Setup card. */
  routerSettings?: () => { url?: string; passwordSaved: boolean };
  /** The smart-home hubs (openHAB, Home Assistant), read each round. */
  smart?: SmartHomeService;
  /** Ask these addresses what they are (DeviceService.ask), for devices only a tile revealed. */
  ask?: (ips: string[]) => void;
  log?: (msg: string) => void;
}

interface Alert {
  since: number;
  told: boolean;
}

const firstLabel = (name?: string) =>
  name
    ?.toLowerCase()
    .trim()
    .replace(/^“|”$/g, "")
    .split(".")[0]
    ?.replace(/[^a-z0-9-]/g, "") || undefined;

const toState = (s: string | undefined): ServiceState =>
  s === "up" || s === "slow" || s === "down" ? s : s === "busy" ? "slow" : "unknown";

/** The port an address uses, written or not. */
function portOf(u: URL): number {
  return u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
}

/** Connect to a few usual ports: an answer, or a refusal, means something is at that address. */
export function reachable(ip: string, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    let left = REACH_PORTS.length;
    let done = false;
    const sockets: Socket[] = [];
    const finish = (up: boolean) => {
      if (done) return;
      if (up || --left === 0) {
        done = true;
        for (const s of sockets) s.destroy();
        resolve(up);
      }
    };
    for (const port of REACH_PORTS) {
      const s = new Socket();
      sockets.push(s);
      s.setTimeout(timeoutMs);
      s.once("connect", () => finish(true));
      s.once("timeout", () => finish(false));
      s.once("error", (e: NodeJS.ErrnoException) => finish(e.code === "ECONNREFUSED"));
      s.connect(port, ip);
    }
  });
}

/**
 * A fetch for checking services on devices: any answer below 500 is up, and a device's own
 * self-signed certificate (a NAS's https port, a TV's) is fine, since nothing is sent to it.
 */
const lenientFetch = ((input: string | URL, init?: RequestInit) =>
  new Promise<Response>((resolve, reject) => {
    const u = new URL(String(input));
    const req = (u.protocol === "https:" ? httpsRequest : httpRequest)(
      u,
      {
        method: "GET",
        rejectUnauthorized: false,
        headers: { "user-agent": "Hearth status check" },
      },
      (res) => {
        res.resume();
        const status = res.statusCode ?? 500;
        resolve(new Response(null, { status: status < 200 ? 200 : Math.min(status, 599) }));
      },
    );
    init?.signal?.addEventListener("abort", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  })) as typeof fetch;

/** The better of two states: one port answering is enough for an app on two. */
const RANK: Record<ServiceState, number> = { up: 3, slow: 2, unknown: 1, down: 0 };

/** Every port the catalog knows, on one address. */
async function scanAddress(ip: string): Promise<FoundService[]> {
  const found: FoundService[] = [];
  await scanNetwork(
    [ip],
    scanPorts(),
    () => {},
    (f) =>
      found.push({
        port: f.port,
        url: f.url,
        title: f.title.slice(0, 120),
        app: f.app
          ? { id: f.app.id, name: f.app.name, icon: f.app.icon, color: f.app.color }
          : undefined,
      }),
  );
  return found.sort((a, b) => a.port - b.port).slice(0, 40);
}

async function resolveName(host: string): Promise<string[]> {
  const list = await lookup(host, { all: true });
  return list.map((a) => a.address);
}

export class DeviceMonitor {
  private machines: { server: string; list: AiMachine[] }[] = [];
  private machinesError: string | undefined;
  private reach = new Map<string, { up: boolean; at: number }>();
  private vpin = new Map<string, VpinView>();
  private games = new Map<string, { at: number; list: VpinGame[] }>();
  private scanning = new Set<string>();
  private alerts = new Map<string, Alert>();
  private names = new Map<string, { at: number; ips: string[] }>();
  private checker: StatusChecker;
  private last: DevicesView | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking: Promise<void> | null = null;
  private ticks = 0;
  private listeners = new Set<() => void>();

  constructor(private readonly deps: MonitorDeps) {
    this.checker = new StatusChecker({
      intervalMs: 60_000,
      timeoutMs: 5000,
      slowMs: 1500,
      fetch: deps.fetch ?? lenientFetch,
      now: deps.now,
    });
  }

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  /** Called whenever what the monitor knows changes. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  start(everyMs = 60_000): void {
    if (this.timer) return;
    this.checker.start();
    void this.tick();
    this.timer = setInterval(() => void this.tick(), everyMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.checker.stop();
  }

  /** One round: the AI machines, who's there, the tables, the services, then the alerts. */
  tick(): Promise<void> {
    if (!this.ticking)
      this.ticking = this.round()
        .catch((e) => this.deps.log?.(`devices: ${(e as Error).message}`))
        .finally(() => {
          this.ticking = null;
        });
    return this.ticking;
  }

  private async round(): Promise<void> {
    this.ticks++;
    await Promise.all([
      this.refreshMachines(),
      this.deps.smart?.refresh().catch(() => {}),
      this.refreshRouter(),
    ]);
    const f = this.deps.store.get();
    // Services found by port checks are checked like tiles, and so are tiles whose status dot is
    // off (on the start page that only hides the dot; here it's worth knowing they answer).
    this.checker.setTargets([
      ...Object.entries(f.found).flatMap(([ip, s]) =>
        s.services.map((x) => ({ id: `port:${ip}:${x.port}`, url: x.url })),
      ),
      ...this.deps
        .config()
        .tiles.filter((t) => !isChecked(t) && isLocalUrl(t.url) && /^https?:/.test(t.url))
        .map((t) => ({ id: `tile:${t.id}`, url: t.checkUrl ?? t.url })),
    ]);
    const saved = f.devices.flatMap((d) => d.ips.filter((ip) => isIP(ip) === 4).slice(0, 1));
    // Who's there: every other round (about two minutes).
    if (this.ticks % 2 === 1) await this.probeReach(saved);
    await Promise.all([this.refreshTables(), this.checker.checkAll()]);
    const view = await this.decorate(await this.deps.view());
    this.last = view;
    await this.undismissRecovered(view);
    await this.checkAlerts(view);
    this.scanDue();
    for (const fn of this.listeners) fn();
  }

  private routerMap: RouterMap | null = null;
  private routerError: string | undefined;
  private routerAt = 0;

  private async refreshRouter(): Promise<void> {
    const r = this.deps.router?.();
    if (!r) {
      this.routerMap = null;
      this.routerError = undefined;
      return;
    }
    try {
      this.routerMap = await r.map();
      this.routerAt = this.now();
      this.routerError = undefined;
    } catch (e) {
      this.routerError = e instanceof RouterError ? e.message : "The router didn't answer.";
    }
  }

  /** Read the router again now (after its settings change). */
  async refreshRouterNow(): Promise<void> {
    await this.refreshRouter();
  }

  private async refreshMachines(): Promise<void> {
    const out: { server: string; list: AiMachine[] }[] = [];
    const errors: string[] = [];
    for (const server of this.deps.config().settings.ai.servers) {
      try {
        const list = await listMachines(this.deps.ai.conn(server));
        if (list) out.push({ server: server.name, list });
      } catch (e) {
        errors.push(`${server.name}: ${(e as Error).message}`);
      }
    }
    this.machines = out;
    this.machinesError = errors[0];
  }

  private async probeReach(ips: string[]): Promise<void> {
    const reach = this.deps.reach ?? reachable;
    const queue = ips.filter((ip) => privateIp(ip));
    await Promise.all(
      Array.from({ length: Math.min(8, queue.length) }, async () => {
        for (let ip = queue.shift(); ip; ip = queue.shift()) {
          const up = await reach(ip).catch(() => false);
          this.reach.set(ip, { up, at: this.now() });
        }
      }),
    );
  }

  /** The addresses where VPin Studio was found. */
  private tables(): string[] {
    return Object.entries(this.deps.store.get().found)
      .filter(([, s]) => s.services.some((x) => x.app?.id === "vpin-studio"))
      .map(([ip]) => ip);
  }

  private async tableGames(ip: string, force = false): Promise<VpinGame[]> {
    const cached = this.games.get(ip);
    if (cached && !force && this.now() - cached.at < GAMES_MS) return cached.list;
    const list = await vpinGames(vpinBase(ip), this.deps.fetch);
    this.games.set(ip, { at: this.now(), list });
    return list;
  }

  private async refreshTable(ip: string): Promise<void> {
    const url = vpinBase(ip);
    try {
      const games = await this.tableGames(ip).catch(() => this.games.get(ip)?.list ?? []);
      const state = await vpinState(
        url,
        new Map(games.map((g) => [g.id, g.name])),
        this.deps.fetch,
      );
      this.vpin.set(ip, { url, ok: true, tables: games.length || undefined, ...state });
    } catch (e) {
      const before = this.vpin.get(ip);
      this.vpin.set(ip, {
        url,
        ok: false,
        error: e instanceof VpinError ? e.message : "VPin Studio didn't answer.",
        // Keep the last scores and players: the table being off doesn't make them wrong.
        scores: before?.scores ?? [],
        players: before?.players ?? [],
        system: before?.system,
        tables: before?.tables,
      });
    }
  }

  private async refreshTables(): Promise<void> {
    await Promise.all(this.tables().map((ip) => this.refreshTable(ip)));
  }

  /** A name's private addresses, looked up now and then. */
  private async addresses(host: string): Promise<string[]> {
    if (isIP(host)) return [host];
    const cached = this.names.get(host);
    if (cached && this.now() - cached.at < DNS_MS) return cached.ips;
    let ips: string[] = [];
    try {
      ips = (await (this.deps.resolve ?? resolveName)(host)).filter((ip) => privateIp(ip));
    } catch {
      // Not a name this server can look up (a .local name, say).
    }
    this.names.set(host, { at: this.now(), ips });
    return ips;
  }

  /** The devices view with what runs on each device, who's there, the AI machines and tables. */
  async decorate(view: DevicesView): Promise<DevicesView> {
    const cfg = this.deps.config();
    const f = this.deps.store.get();
    const status = this.deps.tileStatus();
    const ports = this.checker.snapshot();
    const watch = new Set(f.watch);
    const hidden = new Set(f.hidden);
    const rows: DeviceView[] = view.devices.map((r) => ({ ...r, services: [...r.services] }));
    let adguardHost: string | undefined;
    try {
      adguardHost = cfg.settings.adguard.url
        ? new URL(cfg.settings.adguard.url).hostname
        : undefined;
    } catch {
      // Not an address.
    }
    const asking: string[] = [];

    /** A device the network doesn't list but a tile or the AI server leads to (the router, say). */
    const loose = (ip: string, name?: string, hint?: string): DeviceView => {
      const identity = f.asked[ip]?.identity;
      // AdGuard Home runs on the router, which asks itself and never shows up in its own list.
      const router = ip === adguardHost ? "Router" : undefined;
      asking.push(ip);
      const row: DeviceView = {
        key: `seen:${ip}`,
        saved: false,
        networkName: name,
        identity,
        maker: makerFromIdentity(identity),
        ips: [ip],
        macs: [],
        profiles: [],
        lookups: [],
        suggest: {
          name: tidyName(identity?.name) ?? name ?? router ?? hint,
          type: typeFrom(identity?.model, identity?.name, identity?.maker, name, router, hint),
        },
        ipv6Only: ip.includes(":"),
        here: false,
        presence: "unknown",
        services: [],
        scanning: false,
        watched: false,
      };
      rows.push(row);
      return row;
    };
    const byIp = (ip: string) => rows.find((r) => r.ips.includes(ip));
    const byLabel = (label?: string) =>
      label
        ? rows.find((r) =>
            [r.networkName, r.device?.name, r.identity?.name, r.suggest.name].some(
              (n) => firstLabel(n) === label,
            ),
          )
        : undefined;
    /** The device an address leads to: by its address, or for a name its network calls it. */
    const deviceFor = async (
      host: string,
      makeIfMissing: boolean,
      hint?: string,
    ): Promise<DeviceView | undefined> => {
      const h = host.toLowerCase().replace(/^\[|\]$/g, "");
      if (isIP(h))
        return byIp(h) ?? (makeIfMissing && privateIp(h) ? loose(h, undefined, hint) : undefined);
      // "pinball.local" or "nas" is the device the network calls pinball / nas.
      if (/\.(local|lan|home\.arpa)$/.test(h) || !h.includes("."))
        return byLabel(firstLabel(h)) ?? this.firstOf(await this.addresses(h), byIp);
      const ips = await this.addresses(h);
      const found = this.firstOf(ips, byIp);
      if (found) return found;
      const ip = ips[0];
      return makeIfMissing && ip ? loose(ip, h) : undefined;
    };

    // AI servers, keyed by where they are, so a tile at the same address shows their models.
    const aiStatus = new Map(this.deps.ai.list().map((s) => [s.id, s]));
    const aiDetail = (id: string) => {
      const s = aiStatus.get(id);
      if (!s) return undefined;
      if (s.state === "busy") return "Busy right now";
      if (s.state !== "up") return s.note;
      const loaded = s.loaded.map((m) => m.name);
      return `${s.models.length} model${s.models.length === 1 ? "" : "s"}${loaded.length ? ` · ${loaded.join(", ")} loaded` : ""}`;
    };
    const aiOrigins = new Map<string, string>();
    for (const s of cfg.settings.ai.servers) {
      try {
        aiOrigins.set(new URL(s.url).origin, s.id);
      } catch {
        // Not an address.
      }
    }

    // Tiles: a service on whichever device their address leads to. A tile to one of Hearth's own
    // pages (the trust page) isn't a service; Hearth itself is one, below.
    const own = this.deps.ownHosts?.() ?? new Set<string>();
    for (const t of cfg.tiles) {
      let u: URL;
      try {
        u = new URL(t.url);
      } catch {
        continue;
      }
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      if (!isLocalUrl(t.url) || own.has(u.host.toLowerCase())) continue;
      const row = await deviceFor(u.hostname, true, t.name);
      if (!row) continue;
      const key = `tile:${t.id}`;
      const s = isChecked(t) ? status[t.id] : ports[key];
      const ai = aiOrigins.get(u.origin);
      row.services.push({
        key,
        kind: "tile",
        name: t.name,
        ...resolveIcon(t.icon),
        color: t.color,
        url: t.url,
        state: toState(s?.state),
        ms: s?.ms,
        checked: true,
        detail: (ai ? aiDetail(ai) : undefined) ?? u.host,
        watched: watch.has(key),
        hidden: hidden.has(key),
        minor: false,
      });
      if (ai) aiOrigins.delete(u.origin);
    }
    // AI servers no tile already shows.
    for (const s of cfg.settings.ai.servers) {
      let u: URL;
      try {
        u = new URL(s.url);
      } catch {
        continue;
      }
      if (!aiOrigins.has(u.origin)) continue;
      const row = await deviceFor(u.hostname, true);
      if (!row) continue;
      const st = aiStatus.get(s.id);
      const key = `ai:${s.id}`;
      row.services.push({
        key,
        kind: "ai",
        name: s.name,
        ...resolveIcon("lucide:cpu"),
        state: toState(st?.state),
        ms: st?.ms,
        checked: true,
        detail: aiDetail(s.id),
        watched: watch.has(key),
        hidden: hidden.has(key),
        minor: false,
      });
    }

    // Hearth itself, on the device the names it's reached by lead to.
    for (const host of [...own].sort(
      (a, b) => Number(isIP(a.split(":")[0] ?? "") > 0) - Number(isIP(b.split(":")[0] ?? "") > 0),
    )) {
      const name = host.replace(/:\d+$/, "");
      const row = await deviceFor(name, false);
      if (!row) continue;
      row.services.unshift({
        key: "hearth",
        kind: "hearth",
        name: "Hearth",
        ...resolveIcon("lucide:flame"),
        url: `http://${host}/`,
        state: "up",
        checked: true,
        detail: "This start page",
        watched: false,
        hidden: false,
        minor: false,
      });
      break;
    }

    // What port checks found: one service per app (DSM on 5000 and 5001 is one), and a port
    // that answered without saying what it is marked minor (it's usually part of the device).
    for (const [ip, scanned] of Object.entries(f.found)) {
      const row = byIp(ip);
      if (!row) continue;
      const groups = new Map<string, FoundService[]>();
      for (const x of scanned.services) {
        let u: URL;
        try {
          u = new URL(x.url);
        } catch {
          continue;
        }
        // A tile already shows this one.
        const shown = row.services.some((s) => {
          if (!s.url) return false;
          try {
            const t = new URL(s.url);
            return portOf(t) === portOf(u);
          } catch {
            return false;
          }
        });
        if (shown) continue;
        const name = x.app?.name ?? x.title;
        const group = name ? `app:${name}` : `port:${x.port}`;
        groups.set(group, [...(groups.get(group) ?? []), x]);
      }
      for (const list of groups.values()) {
        const x = list[0] as FoundService;
        const key = `port:${ip}:${x.port}`;
        // The best answer of its ports, and the address of the one that gave it.
        const states = list.map((y) => ({ y, s: ports[`port:${ip}:${y.port}`] }));
        const best = states.sort(
          (a, b) => RANK[toState(b.s?.state)] - RANK[toState(a.s?.state)],
        )[0];
        const portList = list.map((y) => y.port).join(", ");
        row.services.push({
          key,
          kind: "port",
          name: x.app?.name ?? (x.title || `Port ${x.port}`),
          ...resolveIcon(x.app?.icon ?? "lucide:globe"),
          color: x.app?.color,
          url: best?.y.url ?? x.url,
          state: toState(best?.s?.state),
          ms: best?.s?.ms,
          checked: true,
          detail: [
            x.app && x.title && x.title !== x.app.name ? x.title : null,
            `port${list.length > 1 ? "s" : ""} ${portList}`,
          ]
            .filter(Boolean)
            .join(" · "),
          watched: watch.has(key),
          hidden: hidden.has(key),
          minor: !x.app && !x.title,
        });
      }
    }

    // The AI server's computers, on the device each connects from.
    for (const { server, list } of this.machines) {
      for (const m of list) {
        const row =
          (m.address ? byIp(m.address) : undefined) ??
          (m.mac ? rows.find((r) => r.macs.includes(m.mac as string)) : undefined) ??
          byLabel(firstLabel(m.name)) ??
          (m.address && privateIp(m.address) ? loose(m.address, undefined, m.name) : undefined);
        if (row) row.machine = { ...m, server } satisfies MachineView;
      }
    }

    // What the smart-home hubs know: linked by hand, or found by address, hardware id or name.
    const things = this.deps.smart?.all() ?? [];
    if (things.length) {
      const linked = new Map(Object.entries(f.smartLinks));
      const taken = new Set(linked.values());
      for (const t of things) {
        const device = [...linked].find(([, key]) => key === t.key)?.[0];
        const row =
          (device ? rows.find((r) => r.device?.id === device) : undefined) ??
          (taken.has(t.key)
            ? undefined
            : (rows.find((r) => t.hosts.some((h) => r.ips.includes(h))) ??
              rows.find((r) => t.macs.some((m) => r.macs.includes(m))) ??
              rows.find((r) =>
                t.hosts.some(
                  (h) =>
                    !isIP(h) &&
                    [r.networkName, r.device?.name].some((n) => firstLabel(n) === firstLabel(h)),
                ),
              )));
        if (row) row.smart = [...(row.smart ?? []), t];
      }
    }

    // The router: hardware ids for devices that have none, and who's connected to what.
    const map = this.routerMap;
    let networkMap: NetworkMap | undefined;
    if (map) {
      const clientOf = new Map(map.clients.map((c) => [c.mac, c]));
      for (const c of map.clients) {
        const row = c.ip ? byIp(c.ip) : undefined;
        if (row && !row.macs.includes(c.mac)) row.macs = [...row.macs, c.mac];
      }
      const rowOfMac = (m?: string) =>
        m ? (rows.find((r) => r.macs.includes(m)) ?? byIp(clientOf.get(m)?.ip ?? "")) : undefined;
      const nodeMacs = new Set(map.nodes.map((n) => n.mac).filter(Boolean));
      const link = (l: { mac: string; iface: string }): MapLink => {
        const c = clientOf.get(l.mac);
        const row = rowOfMac(l.mac);
        return {
          mac: l.mac,
          iface: l.iface,
          key: row?.key,
          name: row?.device?.name ?? c?.name ?? row?.networkName ?? row?.suggest.name ?? l.mac,
          ip: c?.ip ?? row?.ips[0],
          online: c?.online ?? row?.presence === "online",
          rx: c?.rx,
          tx: c?.tx,
        };
      };
      const node = (n: RouterNode): MapNode => {
        const row = rowOfMac(n.mac) ?? (n.ip ? byIp(n.ip) : undefined);
        return {
          name: row?.device?.name ?? n.name,
          model: n.model,
          key: row?.key,
          connection: n.connection,
          // A mesh node shows as the node, not as one of the router's clients.
          links: n.links.filter((l) => !nodeMacs.has(l.mac)).map(link),
        };
      };
      networkMap = {
        router: node(map.router),
        nodes: map.nodes.map(node),
        checkedAt: new Date(this.routerAt).toISOString(),
      };
    }

    // Tables, scans, presence and watches.
    const at = this.now();
    const activeSince = new Date(at - ACTIVE_MS).toISOString();
    const tables = this.tables();
    for (const row of rows) {
      const tableIp = row.ips.find((ip) => this.vpin.has(ip));
      if (tableIp) row.vpin = this.vpin.get(tableIp);
      else if (row.ips.some((ip) => tables.includes(ip)))
        row.vpin = { url: vpinBase(row.ips[0] as string), ok: false, scores: [], players: [] };
      const scans = row.ips.map((ip) => f.found[ip]?.at).filter((x): x is string => !!x);
      row.scannedAt = scans.sort().at(-1);
      row.scanning = row.ips.some((ip) => this.scanning.has(ip));
      row.watched = Boolean(row.device && watch.has(`device:${row.device.id}`));
      row.presence = this.presenceOf(row, activeSince, at);
    }
    // Devices only a tile or the AI server revealed: ask what they are (now and then).
    if (asking.length) this.deps.ask?.(asking);
    const rs = this.deps.routerSettings?.();
    return {
      ...view,
      devices: rows,
      map: networkMap,
      router: rs
        ? {
            configured: Boolean(rs.url),
            url: rs.url,
            passwordSaved: rs.passwordSaved,
            ok: Boolean(this.routerMap) && !this.routerError,
            error: this.routerError,
          }
        : undefined,
      dismissed: f.dismissed,
      alerts: this.deps.alertsOn?.() ?? false,
      machinesError: this.machinesError,
    };
  }

  private firstOf(ips: string[], byIp: (ip: string) => DeviceView | undefined) {
    for (const ip of ips) {
      const r = byIp(ip);
      if (r) return r;
    }
    return undefined;
  }

  private presenceOf(row: DeviceView, activeSince: string, at: number): Presence {
    if (row.lastSeen && row.lastSeen >= activeSince) return "online";
    const probes = row.ips
      .map((ip) => this.reach.get(ip))
      .filter((p): p is { up: boolean; at: number } => !!p && at - p.at < REACH_FRESH_MS);
    if (probes.some((p) => p.up)) return "online";
    if (row.services.some((s) => s.state === "up" || s.state === "slow")) return "online";
    if (row.machine?.online || row.vpin?.ok) return "online";
    if (probes.length) return "offline";
    // Not asked lately and not heard from in an hour: probably off.
    if (row.lastSeen && at - Date.parse(row.lastSeen) > 3600_000) return "offline";
    return "unknown";
  }

  /** The AI servers' computers, as last asked (for the AI servers widget). */
  aiMachines(): { server: string; list: AiMachine[] }[] {
    return this.machines;
  }

  /** Apps port checks found, with where: for "Your apps" in the widget gallery. */
  foundApps(): { app: string; url: string; device: string }[] {
    const rows = this.last?.devices ?? [];
    return Object.entries(this.deps.store.get().found).flatMap(([ip, scan]) => {
      const row = rows.find((r) => r.ips.includes(ip));
      const device = row?.device?.name ?? row?.networkName ?? ip;
      return scan.services.flatMap((s) => (s.app ? [{ app: s.app.id, url: s.url, device }] : []));
    });
  }

  /** Pinball tables found (VPin Studio), for the Pinball widget. */
  tablesFound(): { device?: string; name: string }[] {
    return (this.last?.devices ?? [])
      .filter((r) => r.vpin)
      .map((r) => ({
        device: r.device?.id,
        name: r.device?.name ?? r.vpin?.system?.name ?? r.networkName ?? "Pinball table",
      }));
  }

  /** The latest view, decorated (for the widget and alerts), or null before the first round. */
  latest(): DevicesView | null {
    return this.last;
  }

  // -------------------------------------------------------------------------
  // Alerts

  private async checkAlerts(view: DevicesView): Promise<void> {
    const tell = this.deps.tell;
    const at = this.now();
    const items = new Map<
      string,
      { name: string; down: boolean; known: boolean; device: boolean }
    >();
    for (const row of view.devices) {
      if (row.device && row.watched)
        items.set(`device:${row.device.id}`, {
          name: row.device.name,
          down: row.presence === "offline",
          known: row.presence !== "unknown",
          device: true,
        });
      const where = row.device?.name ?? row.networkName;
      for (const s of row.services)
        if (s.watched && !s.hidden)
          items.set(s.key, {
            name: where && s.kind === "port" ? `${s.name} on ${where}` : s.name,
            down: s.state === "down",
            known: s.state !== "unknown",
            device: false,
          });
    }
    for (const key of this.alerts.keys()) if (!items.has(key)) this.alerts.delete(key);
    const clock = (ms: number) =>
      new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    for (const [key, it] of items) {
      const a = this.alerts.get(key);
      if (it.down) {
        if (!a) this.alerts.set(key, { since: at, told: false });
        else if (!a.told && at - a.since >= ALERT_AFTER_MS) {
          a.told = true;
          await tell?.(
            it.device ? `${it.name} is offline` : `${it.name} is down`,
            it.device
              ? `It hasn't been on the network since ${clock(a.since)}.`
              : `It hasn't answered since ${clock(a.since)}.`,
            "warning",
          ).catch(() => {});
        }
      } else if (it.known && a) {
        if (a.told) {
          const min = Math.max(1, Math.round((at - a.since) / 60_000));
          await tell?.(
            it.device ? `${it.name} is back online` : `${it.name} is back`,
            `It was ${it.device ? "offline" : "down"} for about ${min < 90 ? `${min} minute${min === 1 ? "" : "s"}` : `${Math.round(min / 60)} hours`}.`,
            "white_check_mark",
          ).catch(() => {});
        }
        this.alerts.delete(key);
      }
    }
  }

  /** Watch a device ("device:<id>") or a service (its key), or stop. */
  async setWatch(key: string, on: boolean): Promise<void> {
    if (!/^(device|tile|ai|port):[\w.:-]{1,110}$/.test(key))
      throw new DeviceError("That isn't something Hearth can watch.");
    await this.deps.store.update((d) => {
      d.watch = d.watch.filter((k) => k !== key);
      if (on) d.watch.push(key);
    });
    if (!on) this.alerts.delete(key);
  }

  /** Link a saved device to a hub's device by hand (or unlink it). */
  async linkSmart(device: string, thing: string | null): Promise<void> {
    const f = this.deps.store.get();
    if (!f.devices.some((d) => d.id === device)) throw new DeviceError("That device is gone.", 404);
    if (thing && !(this.deps.smart?.all() ?? []).some((t) => t.key === thing))
      throw new DeviceError("The hub doesn't know that device (any more).", 404);
    await this.deps.store.update((d) => {
      for (const [k, v] of Object.entries(d.smartLinks))
        if (k === device || v === thing) delete d.smartLinks[k];
      if (thing) d.smartLinks[device] = thing;
    });
  }

  /** Take "Needs a look" off the list for something that's down (until it's up again). */
  async dismiss(key: string): Promise<void> {
    if (!/^(device|tile|ai|port):[\w.:-]{1,110}$/.test(key))
      throw new DeviceError("That isn't something Hearth lists.");
    await this.deps.store.update((d) => {
      if (!d.dismissed.includes(key)) d.dismissed.push(key);
    });
  }

  /** Dismissed things that are up (or online) again come back off the dismissed list. */
  private async undismissRecovered(view: DevicesView): Promise<void> {
    const f = this.deps.store.get();
    if (!f.dismissed.length) return;
    const up = new Set<string>();
    const known = new Set<string>();
    for (const row of view.devices) {
      if (row.device) {
        known.add(`device:${row.device.id}`);
        if (row.presence === "online") up.add(`device:${row.device.id}`);
      }
      for (const s of row.services) {
        known.add(s.key);
        if (s.state === "up" || s.state === "slow") up.add(s.key);
      }
    }
    const keep = f.dismissed.filter((k) => known.has(k) && !up.has(k));
    if (keep.length !== f.dismissed.length)
      await this.deps.store.update((d) => {
        d.dismissed = keep;
      });
  }

  /** Hide a service (a port that's part of a device, say), or show it again. */
  async setHidden(key: string, on: boolean): Promise<void> {
    if (!/^(tile|ai|port):[\w.:-]{1,110}$/.test(key))
      throw new DeviceError("That isn't a service Hearth can hide.");
    await this.deps.store.update((d) => {
      d.hidden = d.hidden.filter((k) => k !== key);
      if (on) d.hidden.push(key);
    });
  }

  // -------------------------------------------------------------------------
  // Port checks

  /** The address to check for a row's key: a saved device's first IPv4, or a seen one's. */
  private ipFor(key: string): string {
    const f = this.deps.store.get();
    const ip = key.startsWith("seen:")
      ? key.slice(5)
      : f.devices.find((d) => d.id === key)?.ips.find((x) => isIP(x) === 4);
    if (!ip || !privateIp(ip))
      throw new DeviceError("That device has no address on the home network.");
    return ip;
  }

  /** Whether something answers at a device's address right now (the "unplug it" test). */
  async knock(key: string): Promise<boolean> {
    const ip = this.ipFor(key);
    const up = await (this.deps.reach ?? reachable)(ip).catch(() => false);
    this.reach.set(ip, { up, at: this.now() });
    return up;
  }

  /** Check a device's ports for services now, in the background. */
  scanNow(key: string): void {
    this.scanOne(this.ipFor(key));
  }

  private scanOne(ip: string): void {
    if (this.scanning.has(ip)) return;
    this.scanning.add(ip);
    for (const fn of this.listeners) fn();
    void (async () => {
      try {
        const services = await (this.deps.scan ?? scanAddress)(ip);
        const at = new Date(this.now()).toISOString();
        await this.deps.store.update((d) => {
          d.found[ip] = { at, v: SCAN_VERSION, services };
          // Keep the newest few hundred.
          const keys = Object.keys(d.found);
          if (keys.length > 300)
            for (const k of keys
              .sort((a, b) => (d.found[b]?.at ?? "").localeCompare(d.found[a]?.at ?? ""))
              .slice(300))
              delete d.found[k];
        });
        if (services.some((s) => s.app?.id === "vpin-studio")) await this.refreshTable(ip);
      } catch (e) {
        this.deps.log?.(`devices: checking ${ip} failed: ${(e as Error).message}`);
      } finally {
        this.scanning.delete(ip);
        for (const fn of this.listeners) fn();
      }
    })();
  }

  /** One saved device whose ports haven't been checked lately (one at a time, in the background). */
  private scanDue(): void {
    if (this.scanning.size) return;
    const f = this.deps.store.get();
    const at = this.now();
    for (const d of f.devices) {
      if (NOT_SCANNED_BY_ITSELF.has(d.type)) continue;
      const ip = d.ips.find((x) => isIP(x) === 4 && privateIp(x));
      if (!ip) continue;
      const last = f.found[ip];
      const again = last?.services.length ? SCAN_AGAIN_MS : SCAN_EMPTY_AGAIN_MS;
      if (last && (last.v ?? 1) >= SCAN_VERSION && at - Date.parse(last.at) < again) continue;
      // Only one that's there now: a switched-off PC is checked once it's back.
      if (this.reach.get(ip)?.up === false) continue;
      this.scanOne(ip);
      return;
    }
  }

  /** Wait for port checks under way (tests). */
  async settled(): Promise<void> {
    while (this.scanning.size) await new Promise((r) => setTimeout(r, 10));
  }

  // -------------------------------------------------------------------------
  // Pinball tables

  private tableFor(key: string): string {
    const f = this.deps.store.get();
    const ips = key.startsWith("seen:")
      ? [key.slice(5)]
      : (f.devices.find((d) => d.id === key)?.ips ?? []);
    const ip = ips.find((x) => this.tables().includes(x));
    if (!ip) throw new DeviceError("VPin Studio isn't on that device.", 404);
    return ip;
  }

  /** The tables on a device, for "Start a table". */
  async tableList(key: string): Promise<VpinGame[]> {
    const ip = this.tableFor(key);
    try {
      return await this.tableGames(ip, true);
    } catch (e) {
      throw new DeviceError(e instanceof VpinError ? e.message : "VPin Studio didn't answer.");
    }
  }

  /** Do something on a table, then look at it again. */
  async tableDo(key: string, action: VpinAction, gameId?: number): Promise<VpinView | undefined> {
    const ip = this.tableFor(key);
    try {
      await vpinDo(vpinBase(ip), action, gameId, this.deps.fetch);
    } catch (e) {
      throw new DeviceError(e instanceof VpinError ? e.message : "VPin Studio didn't answer.");
    }
    if (action !== "shutdown") {
      // Starting a table takes a moment to show.
      if (action === "launch") await new Promise((r) => setTimeout(r, 1500));
      await this.refreshTable(ip);
    }
    for (const fn of this.listeners) fn();
    return this.vpin.get(ip);
  }

  /** The pinball widget's data: the chosen table, or the first one found. */
  pinball(device?: string): PinballWidgetData {
    const rows = (this.last?.devices ?? []).filter((r) => r.vpin);
    const row = device ? rows.find((r) => r.device?.id === device) : rows[0];
    const v = row?.vpin;
    if (!row || !v) return { missing: true, on: false, recent: [], scores: [], players: [] };
    // Played lately: what's on, the last one, then the tables with the newest scores.
    const recent: { id: number; name: string }[] = [];
    const push = (id: number | undefined, name: string) => {
      if (id && id > 0 && !recent.some((r) => r.id === id) && recent.length < 6)
        recent.push({ id, name });
    };
    if (v.playing) push(v.playing.id, v.playing.name);
    if (v.last) push(v.last.id, v.last.name);
    for (const s of v.scores) push(s.gameId, s.table);
    return {
      name: row.device?.name ?? v.system?.name ?? row.networkName,
      device: row.key,
      muted: v.muted,
      on: v.ok,
      playing: v.playing,
      last: v.playing ? undefined : v.last,
      frontendRunning: v.frontendRunning,
      tables: v.tables,
      recent,
      scores: v.scores.slice(0, 6).map((s) => ({
        initials: s.initials,
        score: s.score,
        table: s.table,
        gameId: s.gameId,
        position: s.position,
        label: s.label,
        at: s.at,
      })),
      players: v.players.slice(0, 5).map((p) => ({
        name: p.name,
        initials: p.initials,
        rank: p.rank,
        points: p.points,
        first: p.first,
        second: p.second,
        third: p.third,
      })),
    };
  }

  /**
   * Hearth's own data for widgets: the saved devices (and who's home), the router's map, the
   * smart home's readings. Plain lists for formulas; no keys, no hardware ids.
   */
  widgetData(what: "devices" | "network" | "smarthome"): unknown {
    const view = this.last;
    if (what === "smarthome") {
      const things = (this.deps.smart?.all() ?? []).map((t) => ({
        name: t.name,
        hub: t.hub,
        online: t.status === undefined ? null : /online/i.test(t.status),
        maker: t.maker,
        model: t.model,
        points: t.points.map((p) => ({ label: p.label, kind: p.kind, state: p.state, on: p.on })),
        // "Temperature" → "21.5 °C", for $home.things[0].readings.Temperature.
        readings: Object.fromEntries(t.points.map((p) => [p.label, p.state])),
      }));
      return { things, total: things.length };
    }
    if (!view) return null;
    if (what === "network") {
      const m = view.map;
      if (!m) return { connected: false, nodes: [], clients: [], total: 0, online: 0 };
      const nodes = [m.router, ...m.nodes].map((n) => ({
        name: n.name,
        model: n.model,
        connection: n.connection,
        clients: n.links.length,
        online: n.links.filter((l) => l.online).length,
        links: n.links.map((l) => ({
          name: l.name,
          ip: l.ip,
          band: l.iface,
          online: l.online,
          rx: l.rx,
          tx: l.tx,
        })),
      }));
      const clients = nodes.flatMap((n) => n.links.map((l) => ({ ...l, node: n.name })));
      return {
        connected: true,
        router: nodes[0],
        nodes,
        clients,
        total: clients.length,
        online: clients.filter((c) => c.online).length,
        checkedAt: m.checkedAt,
      };
    }
    const cfg = this.deps.config();
    const names = new Map(cfg.profiles.map((p) => [p.id, p.name]));
    const devices = view.devices.flatMap((r) => {
      const d = r.device;
      if (!d) return [];
      const services = r.services
        .filter((s) => !s.hidden && !s.minor)
        .map((s) => ({ name: s.name, state: s.state, ms: s.ms ?? null }));
      return [
        {
          name: d.name,
          type: d.type,
          online: r.presence === "online",
          presence: r.presence,
          people: d.people.map((id) => names.get(id) ?? id),
          shared: d.treatment === "shared",
          ip: r.ips.find((x) => isIP(x) === 4) ?? r.ips[0] ?? null,
          lastSeen: r.lastSeen ?? null,
          watched: r.watched,
          services,
          down: services.filter((s) => s.state === "down").length,
        },
      ];
    });
    // Who's home: anyone with one of their own devices online.
    const people = cfg.profiles.map((p) => {
      const own = devices.filter((d) => !d.shared && d.people.includes(p.name));
      return {
        name: p.name,
        home: own.some((d) => d.online),
        devices: own.length,
        online: own.filter((d) => d.online).length,
      };
    });
    return {
      devices,
      people,
      total: devices.length,
      online: devices.filter((d) => d.online).length,
      offline: devices.filter((d) => !d.online).length,
      servicesDown: devices.reduce((n, d) => n + d.down, 0),
    };
  }

  private wheels = new WheelCache();

  /** A table's wheel art, shrunk (for the widget). Null when it has none or isn't there. */
  async wheel(key: string, gameId: number): Promise<Buffer | null> {
    let ip: string;
    try {
      ip = this.tableFor(key);
    } catch {
      return null;
    }
    return this.wheels.get(`${ip}:${gameId}`, () =>
      vpinWheel(vpinBase(ip), gameId, this.deps.fetch),
    );
  }
}
