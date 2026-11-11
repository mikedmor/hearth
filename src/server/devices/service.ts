/**
 * The devices on the network and whose each one is. Read from AdGuard Home (what's on the
 * network and when it was last active) and from Hearth's own sightings (browsers that opened the
 * start page, and as whom), and kept as the admin names them in `devices.json`.
 */
import { randomBytes } from "node:crypto";
import type { Profile, Settings } from "../../shared/config";
import {
  type Device,
  type DeviceKind,
  type DeviceKindId,
  DeviceKindSchema,
  DeviceSchema,
  type DevicesView,
  type DeviceView,
  type Identity,
  isBuiltinKind,
  isCustomKind,
  type NewDeviceRules,
  normalMac,
  type Sighting,
} from "../../shared/devices";
import { inCidr } from "../client-ip";
import { resolveIcon } from "../icons";
import { NetError } from "../net";
import type { SecretStore } from "../secrets";
import { AdGuard, AdGuardError, type AdGuardQuery, HEARTH_CLIENT } from "./adguard";
import { makerFrom, makerFromIdentity, notADevice, tidyName, topLookups, typeFrom } from "./clues";
import { privateIp } from "./identify";
import type { DeviceStore } from "./store";

export const ADGUARD_SECRET = "adguard:password";

/** What a row starts with before the monitor (./monitor) adds services, presence and watches. */
const UNWATCHED = {
  presence: "unknown",
  services: [],
  scanning: false,
  watched: false,
} satisfies Pick<DeviceView, "presence" | "services" | "scanning" | "watched">;

export class DeviceError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

export interface DeviceDeps {
  store: DeviceStore;
  secrets: SecretStore;
  settings: () => Settings;
  profiles: () => Profile[];
  fetch?: typeof fetch;
  now?: () => number;
  /** Asks a device what it is (Google Cast, Bonjour…): `identify` from ./identify. Without it, nothing is asked. */
  identify?: (ip: string) => Promise<Identity | null>;
}

/** An address that answered is asked again after a month; one that didn't, after a few hours. */
const ASK_AGAIN = 30 * 24 * 3600_000;
const ASK_AGAIN_SILENT = 6 * 3600_000;
/** How many devices are asked at once. */
const ASK_AT_ONCE = 6;

/** A browser's latest sighting is written again only after this long, unless something changed. */
const SIGHTING_EVERY = 15 * 60_000;

/** "iPhone · Safari", "Windows · Edge": enough to tell devices apart, from a browser's own words. */
export function agentName(ua: string | undefined): string | undefined {
  if (!ua) return undefined;
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? /Mobile/.test(ua)
          ? "Android phone"
          : "Android tablet"
        : /CrOS/.test(ua)
          ? "Chromebook"
          : /Windows/.test(ua)
            ? "Windows"
            : /Macintosh|Mac OS X/.test(ua)
              ? "Mac"
              : /Linux/.test(ua)
                ? "Linux"
                : undefined;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /OPR\//.test(ua)
        ? "Opera"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : undefined;
  return [os, browser].filter(Boolean).join(" · ") || undefined;
}

const slugOf = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "") || "device";

export class DeviceService {
  private asking: Promise<void> | null = null;

  constructor(private readonly deps: DeviceDeps) {}

  /** Hearth is asking devices what they are right now. */
  get busy(): boolean {
    return this.asking !== null;
  }

  /**
   * Ask devices what they are, in the background, a few at a time, and keep their answers.
   * Without `force`, only addresses not asked lately. Returns whether it's asking.
   */
  ask(ips: string[], force = false): boolean {
    if (this.asking) return true;
    const asked = this.deps.store.get().asked;
    const now = this.now();
    const due = [...new Set(ips)].filter((ip) => {
      if (!privateIp(ip)) return false;
      const a = asked[ip];
      if (!a || force) return true;
      return now - Date.parse(a.at) > (a.identity ? ASK_AGAIN : ASK_AGAIN_SILENT);
    });
    const ask = this.deps.identify;
    if (!ask || !due.length) return false;
    this.asking = (async () => {
      const answers = new Map<string, Identity | null>();
      const queue = [...due];
      await Promise.all(
        Array.from({ length: Math.min(ASK_AT_ONCE, queue.length) }, async () => {
          for (let ip = queue.shift(); ip; ip = queue.shift())
            answers.set(ip, await ask(ip).catch(() => null));
        }),
      );
      const at = new Date(this.now()).toISOString();
      await this.deps.store.update((d) => {
        for (const [ip, identity] of answers)
          d.asked[ip] = identity ? { at, identity: clean(identity) } : { at };
        // Keep the newest few hundred.
        const keys = Object.keys(d.asked);
        if (keys.length > 400)
          for (const k of keys
            .sort((a, b) => (d.asked[b]?.at ?? "").localeCompare(d.asked[a]?.at ?? ""))
            .slice(400))
            delete d.asked[k];
      });
    })()
      .catch(() => {})
      .finally(() => {
        this.asking = null;
      });
    return true;
  }

  /** Wait for any asking under way (tests, and before shutting down). */
  async settled(): Promise<void> {
    await this.asking;
  }

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  /** The saved devices. */
  devices(): Device[] {
    return this.deps.store.get().devices;
  }

  /** AdGuard Home, if the admin connected it. */
  adguard(): AdGuard | null {
    const s = this.deps.settings().adguard;
    if (!s.url) return null;
    return new AdGuard({
      url: s.url,
      username: s.username,
      password: this.deps.secrets.get(ADGUARD_SECRET),
      // The router is on the home network; this is never the internet.
      policy: { allowInternet: false },
      fetch: this.deps.fetch,
    });
  }

  /** A browser opened Hearth: remember where, and as whom. Cheap to call on every page load. */
  async see(s: Omit<Sighting, "at">): Promise<void> {
    // Docker's own address (a request through the container's port): not where the browser is.
    if (notADevice(s.ip) && !s.ip.startsWith("127.") && s.ip !== "::1") return;
    const f = this.deps.store.get();
    const last = f.seen.find((x) => x.browser === s.browser);
    const same = last && last.ip === s.ip && last.profile === s.profile;
    if (same && this.now() - Date.parse(last.at) < SIGHTING_EVERY) return;
    await this.deps.store.update((d) => {
      // What its browser found out about the home's certificate stays with it.
      const before = d.seen.find((x) => x.browser === s.browser);
      d.seen = [
        {
          ...s,
          at: new Date(this.now()).toISOString(),
          ...(before?.trust ? { trust: before.trust } : {}),
        },
        ...d.seen.filter((x) => x.browser !== s.browser),
      ].slice(0, 500);
      // A named device follows its browser to a new address (a phone whose address changed).
      for (const dev of d.devices)
        if (dev.browsers.includes(s.browser) && !dev.ips.includes(s.ip))
          dev.ips = [s.ip, ...dev.ips].slice(0, 8);
    });
  }

  /** Whether this browser has said if it trusts the home's certificate. */
  trustKnown(browser: string): boolean {
    return Boolean(this.deps.store.get().seen.find((x) => x.browser === browser)?.trust);
  }

  /**
   * A browser found out whether it trusts the home's certificate (it tries Hearth's https
   * address). Kept with its latest sighting, so its device can say so.
   */
  async sawTrust(s: { browser: string; ip: string }, ok: boolean): Promise<void> {
    const at = new Date(this.now()).toISOString();
    const last = this.deps.store.get().seen.find((x) => x.browser === s.browser);
    if (last?.trust?.ok === ok && this.now() - Date.parse(last.trust.at) < SIGHTING_EVERY) return;
    await this.deps.store.update((d) => {
      const mine = d.seen.find((x) => x.browser === s.browser);
      if (mine) mine.trust = { ok, at };
      else d.seen = [{ ...s, at, trust: { ok, at } }, ...d.seen].slice(0, 500);
    });
  }

  async view(
    here: { ip?: string; browser?: string },
    opts: { ask?: boolean } = {},
  ): Promise<DevicesView> {
    const s = this.deps.settings().adguard;
    const ag = this.adguard();
    const state: DevicesView["adguard"] = {
      configured: Boolean(ag),
      url: s.url,
      username: s.username,
      passwordSaved: this.deps.secrets.has(ADGUARD_SECRET),
      ok: false,
    };
    // What AdGuard Home knows: names for addresses, and when each was last active.
    const names = new Map<string, string>();
    const lastSeen = new Map<string, string>();
    const macsOf = new Map<string, string[]>();
    const asked = new Map<string, string[]>();
    if (ag) {
      try {
        const [status, clients, recent] = await Promise.all([
          ag.status(),
          ag.clients(),
          ag.recent(),
        ]);
        state.ok = true;
        state.version = status.version;
        state.protection = status.protection_enabled;
        for (const a of clients.auto) if (a.name) names.set(a.ip, a.name);
        // Hearth's own clients (one per child) aren't names for devices.
        for (const c of clients.clients.filter((x) => !x.name.startsWith(HEARTH_CLIENT))) {
          const ips = c.ids.filter(
            (x) => /^[0-9a-f.:]+$/i.test(x) && !/^([0-9a-f]{2}:){5}/i.test(x),
          );
          const macs = c.ids
            .filter((x) => /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(x))
            .map(normalMac);
          for (const ip of ips) {
            names.set(ip, c.name);
            if (macs.length) macsOf.set(ip, macs);
          }
        }
        for (const q of recent as AdGuardQuery[]) {
          if (!lastSeen.has(q.client)) lastSeen.set(q.client, q.time);
          if (q.question?.name)
            asked.set(q.client, [...(asked.get(q.client) ?? []), q.question.name]);
          if (q.client_info?.name && !names.has(q.client)) names.set(q.client, q.client_info.name);
        }
      } catch (e) {
        state.error =
          e instanceof AdGuardError || e instanceof NetError
            ? this.deps.secrets.redact(e.message)
            : "Couldn't reach AdGuard Home.";
      }
    }
    const f = this.deps.store.get();
    const identityOf = (ips: string[]) => ips.map((ip) => f.asked[ip]?.identity).find(Boolean);
    const clues = (ips: string[], networkName?: string, agent?: string, saved?: boolean) => {
      const identity = identityOf(ips);
      const looked = ips.flatMap((ip) => asked.get(ip) ?? []);
      const maker = makerFromIdentity(identity) ?? makerFrom(topLookups(looked, 12));
      return {
        identity,
        lookups: topLookups(looked),
        maker,
        suggest: {
          name: saved ? undefined : (tidyName(identity?.name) ?? networkName),
          type: typeFrom(
            identity?.model,
            identity?.name,
            identity?.maker,
            maker,
            agent,
            networkName,
          ),
        },
      };
    };
    const newest = (a?: string, b?: string) => (!a ? b : !b ? a : a > b ? a : b);

    const rows: DeviceView[] = [];
    const covered = new Set<string>();
    /** The newest thing a browser on it said about the home's certificate. */
    const trustOf = (sightings: Sighting[]) =>
      sightings
        .map((x) => x.trust)
        .filter((t): t is NonNullable<Sighting["trust"]> => !!t)
        .sort((a, b) => b.at.localeCompare(a.at))[0];
    for (const d of f.devices) {
      // A device known only by this machine's own address (saved while running on a PC, say)
      // isn't on the network: it's wherever Hearth runs.
      const here_ = Boolean(here.ip && d.ips.includes(here.ip));
      if (d.ips.length && d.ips.every((ip) => notADevice(ip)) && !here_) continue;
      const sightings = f.seen.filter(
        (x) => d.browsers.includes(x.browser) || d.ips.includes(x.ip),
      );
      let seen: string | undefined;
      for (const ip of d.ips) {
        covered.add(ip);
        seen = newest(seen, lastSeen.get(ip));
      }
      for (const x of sightings) seen = newest(seen, x.at);
      const networkName = d.ips.map((ip) => names.get(ip)).find(Boolean);
      const agent = agentName(sightings[0]?.agent);
      rows.push({
        key: d.id,
        saved: true,
        device: d,
        networkName,
        ips: d.ips,
        macs: d.macs,
        lastSeen: seen,
        profiles: [...new Set(sightings.map((x) => x.profile).filter((p): p is string => !!p))],
        ...clues(d.ips, networkName, agent, true),
        ipv6Only: d.ips.length > 0 && d.ips.every((ip) => ip.includes(":")),
        agent,
        here: Boolean(
          (here.ip && d.ips.includes(here.ip)) ||
            (here.browser && d.browsers.includes(here.browser)),
        ),
        ...UNWATCHED,
        trust: trustOf(sightings),
      });
    }

    // Everything else seen on the network or in Hearth, not saved yet.
    const loose = new Set<string>([
      ...names.keys(),
      ...lastSeen.keys(),
      ...f.seen.map((x) => x.ip),
    ]);
    for (const ip of loose) {
      if (covered.has(ip) || !/^[0-9a-f.:]+$/i.test(ip)) continue;
      // This machine and "no address assigned" placeholders aren't devices to name.
      if (notADevice(ip) && ip !== here.ip) continue;
      const sightings = f.seen.filter((x) => x.ip === ip);
      const agent = agentName(sightings[0]?.agent);
      rows.push({
        key: `seen:${ip}`,
        saved: false,
        networkName: names.get(ip),
        ips: [ip],
        macs: macsOf.get(ip) ?? [],
        lastSeen: newest(lastSeen.get(ip), sightings[0]?.at),
        profiles: [...new Set(sightings.map((x) => x.profile).filter((p): p is string => !!p))],
        ...clues([ip], names.get(ip), agent),
        ipv6Only: ip.includes(":"),
        agent,
        here: ip === here.ip,
        ...UNWATCHED,
        trust: trustOf(sightings),
      });
    }
    // One device on two addresses (wired and Wi-Fi) shows the same name twice: say so.
    const nameOf = (r: DeviceView) =>
      r.networkName
        ?.toLowerCase()
        .replace(/\.(lan|local|home)$/, "")
        .trim();
    const byName = new Map<string, DeviceView[]>();
    for (const r of rows) {
      const n = nameOf(r);
      // An IPv6-only row counts when it's saved (someone saved the printer twice, by each address).
      if (!n || n.length < 3 || (r.ipv6Only && !r.saved)) continue;
      byName.set(n, [...(byName.get(n) ?? []), r]);
    }
    for (const same of byName.values()) {
      // A name shared by many is a model name ("android"), not one device.
      if (same.length < 2 || same.length > 3) continue;
      for (const r of same) r.twins = same.filter((x) => x !== r).map((x) => x.key);
    }
    rows.sort(
      (a, b) =>
        Number(b.here) - Number(a.here) ||
        (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "") ||
        a.ips[0]?.localeCompare(b.ips[0] ?? "", undefined, { numeric: true }) ||
        0,
    );
    // Devices not asked lately are asked what they are, in the background (the page asks again).
    if (opts.ask !== false) this.ask(rows.filter((r) => !r.ipv6Only).flatMap((r) => r.ips));
    await this.autoAdd(rows).catch(() => {});
    const networks = [
      ...new Set(
        rows
          .flatMap((r) => r.ips)
          .filter((ip) => privateIp(ip))
          .map((ip) => `${ip.split(".").slice(0, 3).join(".")}.0/24`),
      ),
    ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return {
      adguard: state,
      devices: rows,
      hereIp: here.ip,
      asking: this.busy,
      rules: this.deps.store.get().rules,
      networks,
      alerts: false,
      dismissed: this.deps.store.get().dismissed,
      kinds: this.deps.store.get().kinds.map((k) => {
        const icon = resolveIcon(k.icon);
        return { ...k, iconRef: k.icon, ...icon, icon: icon.icon ?? k.icon };
      }),
    };
  }

  /**
   * Save new devices by themselves, as the rules for new devices say: everything on an
   * always-allowed network, and every new device if the admin chose that. A device waits until
   * it's been asked what it is (for a better name), and one that's opened Hearth as someone is
   * left for the admin, unless it's on an always-allowed network.
   */
  private async autoAdd(rows: DeviceView[]): Promise<void> {
    const f = this.deps.store.get();
    const r = f.rules;
    if (r.newDevices === "leave" && !r.alwaysNetworks.length) return;
    const picked = rows.filter((row) => {
      const ip = row.ips[0];
      if (row.saved || row.ipv6Only || row.here || !ip || !privateIp(ip)) return false;
      if (this.deps.identify && !f.asked[ip]) return false;
      if (r.alwaysNetworks.some((n) => inCidr(ip, n))) return true;
      return r.newDevices === "always" && !row.profiles.length;
    });
    if (!picked.length) return;
    const at = new Date(this.now()).toISOString();
    await this.deps.store.update((d) => {
      for (const row of picked) {
        const ip = row.ips[0] as string;
        if (d.devices.some((x) => x.ips.includes(ip) || x.macs.some((m) => row.macs.includes(m))))
          continue;
        const what = row.maker ? row.maker.replace(/^(a|an) /, "") : undefined;
        const name = (row.suggest.name ?? row.networkName ?? what ?? `Device ${ip}`).slice(0, 60);
        const base = slugOf(name);
        let id = base;
        for (let n = 2; d.devices.some((x) => x.id === id); n++) id = `${base}-${n}`;
        const device = DeviceSchema.parse({
          id,
          name: name.charAt(0).toUpperCase() + name.slice(1),
          type: row.suggest.type ?? "unknown",
          treatment: "always",
          ips: [ip],
          macs: row.macs,
          firstSeen: at,
          auto: true,
        });
        d.devices.push(device);
        Object.assign(row, { key: id, saved: true, device });
      }
    });
  }

  /** Change what happens to new devices. */
  async setRules(rules: NewDeviceRules): Promise<void> {
    await this.deps.store.update((d) => {
      d.rules = rules;
    });
  }

  private refresher: ReturnType<typeof setInterval> | null = null;

  /** Look at the network now and then, so new devices are asked and saved without the page open. */
  start(everyMs = 120_000): void {
    if (this.refresher) return;
    void this.forgetNonDevices().catch(() => {});
    this.refresher = setInterval(() => void this.view({}).catch(() => {}), everyMs);
    this.refresher.unref?.();
  }

  /**
   * Addresses that were never devices (Docker's own, the NAS seen from inside its container):
   * forget them, and devices saved by themselves from them. Ones the admin saved stay.
   */
  async forgetNonDevices(): Promise<void> {
    const f = this.deps.store.get();
    const gone = (ip: string) => notADevice(ip) && !ip.startsWith("127.") && ip !== "::1";
    const any =
      f.seen.some((x) => gone(x.ip)) ||
      Object.keys(f.found).some(gone) ||
      f.devices.some((d) => d.auto && d.ips.length && d.ips.every(gone));
    if (!any) return;
    await this.deps.store.update((d) => {
      d.seen = d.seen.filter((x) => !gone(x.ip));
      for (const ip of Object.keys(d.found)) if (gone(ip)) delete d.found[ip];
      d.devices = d.devices.filter((x) => !(x.auto && x.ips.length && x.ips.every(gone)));
    });
  }

  stop(): void {
    if (this.refresher) clearInterval(this.refresher);
    this.refresher = null;
  }

  /** Save a device: a new one from a row that's only been seen ("seen:<ip>"), or a change. */
  async save(
    key: string,
    input: Omit<Device, "id" | "browsers" | "firstSeen" | "people"> & { people?: string[] },
  ): Promise<string> {
    const people = new Set(this.deps.profiles().map((p) => p.id));
    if (input.person && !people.has(input.person))
      throw new DeviceError("There's nobody by that name.");
    if (input.people?.some((p) => !people.has(p)))
      throw new DeviceError("There's nobody by that name.");
    if (input.treatment === "shared" && !input.people?.length)
      throw new DeviceError("Say who shares it.");
    if (isCustomKind(input.type) && !this.deps.store.get().kinds.some((k) => k.id === input.type))
      throw new DeviceError("There's no such kind of device.");
    const f = this.deps.store.get();
    const macs = [...new Set(input.macs.map(normalMac))];
    const ips = [...new Set(input.ips.map((x) => x.trim()).filter(Boolean))];
    // An address or hardware id belongs to one device at a time.
    const clash = f.devices.find(
      (d) =>
        d.id !== key &&
        (d.ips.some((x) => ips.includes(x)) || d.macs.some((m) => macs.includes(m))),
    );
    if (clash) throw new DeviceError(`${clash.name} already has that address.`, 409);
    let id = key;
    await this.deps.store.update((d) => {
      const existing = d.devices.find((x) => x.id === key);
      if (existing) {
        Object.assign(existing, DeviceSchema.parse({ ...existing, ...input, ips, macs }));
        return;
      }
      if (!key.startsWith("seen:")) throw new DeviceError("That device is gone.", 404);
      const base = slugOf(input.name);
      id = base;
      for (let n = 2; d.devices.some((x) => x.id === id); n++) id = `${base}-${n}`;
      const browsers = d.seen
        .filter((x) => ips.includes(x.ip))
        .map((x) => x.browser)
        .slice(0, 10);
      d.devices.push(
        DeviceSchema.parse({
          ...input,
          id,
          ips,
          macs,
          browsers,
          firstSeen: new Date(this.now()).toISOString(),
        }),
      );
    });
    return id;
  }

  async remove(id: string): Promise<void> {
    await this.deps.store.update((d) => {
      d.devices = d.devices.filter((x) => x.id !== id);
    });
  }

  /**
   * Two rows are one device (wired and Wi-Fi, say): keep the saved one, with both addresses and
   * hardware ids, and forget the other. Returns the kept device's id.
   */
  async merge(a: string, b: string): Promise<string> {
    if (a === b) throw new DeviceError("That's the same one.");
    let kept = "";
    await this.deps.store.update((d) => {
      const find = (key: string) => d.devices.find((x) => x.id === key);
      const ipOf = (key: string) => (key.startsWith("seen:") ? key.slice(5) : undefined);
      let keep = find(a);
      let other: string = b;
      if (!keep) {
        keep = find(b);
        other = a;
      }
      if (!keep) throw new DeviceError("Set one of them up first, then merge them.");
      const gone = find(other);
      const ips = gone ? gone.ips : [ipOf(other)].filter((x): x is string => !!x);
      if (!ips.length && !gone) throw new DeviceError("That device is gone.", 404);
      keep.ips = [...new Set([...keep.ips, ...ips])].slice(0, 8);
      if (gone) {
        keep.macs = [...new Set([...keep.macs, ...gone.macs])].slice(0, 8);
        keep.browsers = [...new Set([...keep.browsers, ...gone.browsers])].slice(0, 10);
        d.devices = d.devices.filter((x) => x.id !== gone.id);
        d.watch = d.watch.filter((k) => k !== `device:${gone.id}`);
        delete d.smartLinks[gone.id];
      }
      kept = keep.id;
    });
    return kept;
  }

  /** Make or change a kind of device (a built-in one too: its name, icon, place). Its id. */
  async saveKind(id: string | null, input: Omit<DeviceKind, "id">): Promise<DeviceKindId> {
    let kindId = id ?? "";
    await this.deps.store.update((d) => {
      if (id && isBuiltinKind(id)) {
        const next = DeviceKindSchema.parse({ ...input, id, hidden: undefined });
        d.kinds = [...d.kinds.filter((x) => x.id !== id), next];
        return;
      }
      if (id) {
        const k = d.kinds.find((x) => x.id === id);
        if (!k) throw new DeviceError("That kind is gone.", 404);
        Object.assign(k, DeviceKindSchema.parse({ ...k, ...input, id }));
        return;
      }
      const base = `c-${slugOf(input.label)}`.slice(0, 42).replace(/-+$/, "");
      kindId = base;
      for (let n = 2; d.kinds.some((x) => x.id === kindId); n++) kindId = `${base}-${n}`;
      d.kinds.push(DeviceKindSchema.parse({ ...input, id: kindId }));
    });
    return kindId as DeviceKindId;
  }

  /**
   * Delete a kind: its devices become "Not sure yet". A built-in one stays hidden (it can come
   * back); "Not sure yet" itself can't go.
   */
  async removeKind(id: string): Promise<void> {
    if (id === "unknown") throw new DeviceError("“Not sure yet” is where the others go: it stays.");
    await this.deps.store.update((d) => {
      const before = d.kinds.find((k) => k.id === id);
      d.kinds = d.kinds.filter((k) => k.id !== id);
      if (isBuiltinKind(id))
        d.kinds.push(
          DeviceKindSchema.parse({
            id,
            label: before?.label ?? id,
            icon: before?.icon,
            place: before?.place,
            hidden: true,
          }),
        );
      for (const dev of d.devices) if (dev.type === id) dev.type = "unknown";
    });
  }

  /** A built-in kind as it came: its name, icon and place, and back if it was deleted. */
  async restoreKind(id: string): Promise<void> {
    if (!isBuiltinKind(id)) throw new DeviceError("Only a built-in kind can be brought back.");
    await this.deps.store.update((d) => {
      d.kinds = d.kinds.filter((k) => k.id !== id);
    });
  }

  /** Someone left Hearth: their devices stay, belonging to nobody. */
  async forget(person: string): Promise<void> {
    if (!this.deps.store.get().devices.some((d) => d.person === person)) return;
    await this.deps.store.update((d) => {
      for (const dev of d.devices) if (dev.person === person) dev.person = undefined;
    });
  }
}

/** What a device said, trimmed to fit (its own words can be anything). */
function clean(id: Identity): Identity {
  const cut = (v?: string, n = 120) =>
    v
      ?.replace(/[\p{Cc}]/gu, " ")
      .trim()
      .slice(0, n) || undefined;
  return { name: cut(id.name), model: cut(id.model), maker: cut(id.maker), via: cut(id.via, 40) };
}

/** A new browser's id, for the `hearth_device` cookie. */
export const newBrowserId = () => randomBytes(12).toString("hex");
