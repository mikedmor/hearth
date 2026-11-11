/**
 * The internet controls: keeps AdGuard Home's rules matching what the parents chose (each
 * child's mode, schedules, pauses, unlocks), and reads its query log into children's history.
 *
 * Every tick (20 seconds) it reads new lookups, lets expired pauses and unlocks go, and checks
 * that AdGuard Home's block of Hearth rules is what it should be, writing it only when it isn't.
 * If Hearth stops, the rules stay as they were last written.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import type { HearthConfig, Profile } from "../../shared/config";
import type { Device, DevicesFile } from "../../shared/devices";
import type { Admitted, Door, DoorHere, DoorPatch, DoorView, Visitor } from "../../shared/internet";
import {
  type AskRequest,
  type AttentionRow,
  type ChildSummary,
  type ChildView,
  type FamilyView,
  type HereInternet,
  type InternetFile,
  type InternetView,
  type PersonRules,
  PersonRulesSchema,
  type ServiceInfo,
  type SiteVisit,
  type VisitRow,
} from "../../shared/internet";
import { inCidr } from "../client-ip";
import {
  type AdGuard,
  type AdGuardClientSettings,
  AdGuardError,
  type AdGuardQuery,
  HEARTH_CLIENT,
  isBlocked,
} from "../devices/adguard";
import { baseDomain, noise } from "../devices/clues";
import { guardedFetch, NetError } from "../net";
import {
  allowedSites,
  buildRules,
  doorRules,
  essentials,
  localClock,
  localDay,
  modeNow,
  nextChange,
  oursIn,
  pageSites,
  pauseOn,
  type RuleGroup,
  siteOf,
  withOurs,
} from "./rules";
import type { HistoryStore, InternetStore } from "./store";

export class InternetError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

export interface InternetDeps {
  store: InternetStore;
  history: HistoryStore;
  config: () => HearthConfig;
  devices: () => DevicesFile;
  adguard: () => AdGuard | null;
  /** Whether a profile has a PIN (a grown-up needs one to unlock a device or be a parent here). */
  hasPin: (profile: string) => boolean;
  now?: () => number;
  /** For alerts; swapped out in tests. */
  fetch?: typeof fetch;
  /** Where the front door's house password is kept (encrypted). */
  secrets?: {
    get(name: string): string | undefined;
    set(name: string, value: string | null): Promise<void>;
    has(name: string): boolean;
  };
}

export const DOOR_SECRET = "door:password";

const TICK = 20_000;
/** A blocked lookup this soon after an allowed one is probably that site's. */
const AFTER_MS = 30_000;
/** At most this many pages of 500 lookups are read at a time. */
const PAGES = 10;
const PAGE = 500;
/** "Blocked lately" and "Needs a look" go back this many days. */
const LATELY = 3;

/** At most this many requests a device may make in an hour. */
const ASKS_PER_HOUR = 6;
/** A request is shown to the child for this long after it's answered. */
const REQUEST_SHOWN = 12 * 3600_000;

const isGrownUp = (p: Profile) => p.role === "adult" || p.role === "admin";
const sameLines = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);
const noHours = () => Array.from({ length: 24 }, () => 0);

/** Whose a device's lookups are: one child, or each child who shares it (`people`). */
type Owner = { person: string; people: string[]; device: string };

/** How strict a mode is, for a device several children share. */
const STRICT = { open: 0, sites: 1, paused: 2 } as const;

export class InternetService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> = Promise.resolve();
  private applied?: InternetView["applied"];
  private adguardState: InternetView["adguard"] = { configured: false, ok: false };
  private lastPrune = "";
  /** Each child's device's last lookup (kept in memory; it fills in again within seconds). */
  private active = new Map<string, number>();
  /** Why Hearth's AdGuard Home clients couldn't be saved, if they couldn't. */
  private clientsError?: string;
  /** Why the last alert couldn't be sent, if it couldn't. */
  private notifyError?: string;
  /** "person|site|day" already alerted about, so a block is told once a day. */
  private told = new Set<string>();
  private serviceCache?: { at: number; list: ServiceInfo[] };
  /** When each device asked for something lately. */
  private asks = new Map<string, number[]>();
  /** Devices stopped at the front door lately, by address. */
  private visitors = new Map<string, Visitor>();
  /** Wrong house passwords, by address. */
  private doorTries = new Map<string, { fails: number; until: number }>();

  constructor(private readonly deps: InternetDeps) {}

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  private tz() {
    return this.deps.config().settings.timeZone || undefined;
  }

  /** "YYYY-MM-DD" in the home's time zone. */
  dayOf(ms: number): string {
    return localDay(ms, this.tz());
  }

  rulesOf(person: string): PersonRules {
    return this.deps.store.get().people[person] ?? PersonRulesSchema.parse({});
  }

  private profile(id: string): Profile {
    const p = this.deps.config().profiles.find((x) => x.id === id);
    if (!p) throw new InternetError("There's nobody by that name.", 404);
    return p;
  }

  /** A child, for the Family page: anyone else is refused. */
  private child(id: string): Profile {
    const p = this.profile(id);
    if (p.role !== "child") throw new InternetError("The Family page is for children.", 404);
    return p;
  }

  /** A person's saved devices. */
  private devicesOf(person: string): Device[] {
    return this.deps
      .devices()
      .devices.filter((d) => d.treatment === "person" && d.person === person);
  }

  /** Devices shared by several people, with `person` among them. */
  private sharedOf(person: string): Device[] {
    return this.deps
      .devices()
      .devices.filter((d) => d.treatment === "shared" && d.people.includes(person));
  }

  private children(): Set<string> {
    return new Set(
      this.deps
        .config()
        .profiles.filter((p) => p.role === "child")
        .map((p) => p.id),
    );
  }

  /** Children's devices, by address (a shared one counts for each child who uses it). */
  private childDevices(): Map<string, Owner> {
    const children = this.children();
    const who = new Map<string, Owner>();
    for (const d of this.deps.devices().devices) {
      const kids =
        d.treatment === "person" && d.person
          ? [d.person].filter((p) => children.has(p))
          : d.treatment === "shared"
            ? d.people.filter((p) => children.has(p))
            : [];
      if (kids.length)
        for (const ip of d.ips)
          who.set(ip, { person: kids[0] as string, people: kids, device: d.id });
    }
    return who;
  }

  private unlockOf(device: string, f: InternetFile = this.deps.store.get()) {
    const now = this.now();
    return f.unlocks.find((u) => u.device === device && Date.parse(u.until) > now);
  }

  // -------------------------------------------------------------------------
  // Who may use the Family page

  /** The admin, or a parent the admin chose who has a PIN (else anyone could pick their face). */
  isParent(viewer: { admin: boolean; profile: Profile | null }): boolean {
    if (viewer.admin) return true;
    const p = viewer.profile;
    return Boolean(
      p && isGrownUp(p) && this.deps.store.get().parents.includes(p.id) && this.deps.hasPin(p.id),
    );
  }

  // -------------------------------------------------------------------------
  // Running

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One round: read new lookups, tidy expired pauses and unlocks, and set the rules right. */
  tick(): Promise<void> {
    this.running = this.running.then(async () => {
      await this.collect().catch(() => {});
      await this.expire().catch(() => {});
      await this.apply().catch(() => {});
    });
    return this.running;
  }

  private async expire(): Promise<void> {
    const f = this.deps.store.get();
    const now = this.now();
    const oldUnlocks = f.unlocks.some((u) => Date.parse(u.until) <= now);
    const oldPauses = Object.values(f.pauses).some((p) => p.until && Date.parse(p.until) <= now);
    // Requests go after a week.
    const keep = (r: AskRequest) => now - Date.parse(r.at) < 7 * 86_400_000;
    const oldRequests = f.requests.some((r) => !keep(r));
    const oldAdmitted = f.admitted.some((a) => a.until && Date.parse(a.until) <= now);
    if (!oldUnlocks && !oldPauses && !oldRequests && !oldAdmitted) return;
    await this.deps.store.update((d) => {
      d.unlocks = d.unlocks.filter((u) => Date.parse(u.until) > now);
      for (const [k, p] of Object.entries(d.pauses)) if (!pauseOn(p, now)) delete d.pauses[k];
      d.requests = d.requests.filter(keep);
      d.admitted = d.admitted.filter((a) => !a.until || Date.parse(a.until) > now);
    });
  }

  /** The rule groups that should be in AdGuard Home right now. */
  desired(): RuleGroup[] {
    const f = this.deps.store.get();
    if (!f.enabled) return [];
    const cfg = this.deps.config();
    const now = this.now();
    const groups: RuleGroup[] = [];
    for (const p of cfg.profiles) {
      const rules = f.people[p.id];
      if (!rules) continue;
      const m = modeNow(rules, f.pauses[p.id], now, this.tz());
      if (m.mode === "open") continue;
      const devices = this.devicesOf(p.id).filter((d) => !this.unlockOf(d.id, f));
      groups.push({
        label: `${p.name}: ${m.mode === "paused" ? "paused" : "only their sites"} (${devices.map((d) => d.name).join(", ") || "no devices"})`,
        clients: devices.flatMap((d) => d.ips),
        mode: m.mode,
        sites: m.mode === "sites" ? allowedSites(rules, pageSites(cfg, p)) : [],
      });
    }
    // A shared device follows the strictest rules of the children who use it: paused if any of
    // them is, else only the sites every one of them may use.
    const children = this.children();
    for (const d of this.deps.devices().devices) {
      if (d.treatment !== "shared" || this.unlockOf(d.id, f)) continue;
      const kids = cfg.profiles.filter((p) => d.people.includes(p.id) && children.has(p.id));
      const modes = kids.flatMap((p) => {
        const rules = f.people[p.id];
        if (!rules) return [];
        const m = modeNow(rules, f.pauses[p.id], now, this.tz());
        return [{ p, rules, mode: m.mode }];
      });
      const strictest = modes.reduce<"open" | "sites" | "paused">(
        (a, x) => (STRICT[x.mode] > STRICT[a] ? x.mode : a),
        "open",
      );
      if (strictest === "open") continue;
      const lists = modes
        .filter((x) => x.mode === "sites")
        .map((x) => new Set(allowedSites(x.rules, pageSites(cfg, x.p))));
      const sites =
        strictest === "sites"
          ? [...(lists[0] ?? [])].filter((s) => lists.every((l) => l.has(s)))
          : [];
      groups.push({
        label: `${d.name} (shared by ${kids.map((p) => p.name).join(", ")}): ${strictest === "paused" ? "paused" : "only the sites they all may use"}`,
        clients: d.ips,
        mode: strictest,
        sites,
      });
    }
    return groups;
  }

  /** Make AdGuard Home's block of Hearth rules what it should be. Writes only on a change. */
  async apply(): Promise<void> {
    const ag = this.deps.adguard();
    this.adguardState = { configured: Boolean(ag), ok: false };
    if (!ag) return;
    const ours = buildRules(this.desired(), this.doorLines());
    try {
      const existing = await ag.userRules();
      this.adguardState.ok = true;
      if (!sameLines(oursIn(existing), ours)) {
        await ag.setUserRules(withOurs(existing, ours));
        this.applied = { at: new Date(this.now()).toISOString(), lines: ours.length };
      } else if (!this.applied || this.applied.error)
        this.applied = { at: new Date(this.now()).toISOString(), lines: ours.length };
    } catch (e) {
      const msg =
        e instanceof AdGuardError || e instanceof NetError
          ? e.message
          : "Couldn't reach AdGuard Home.";
      this.adguardState.error = msg;
      this.applied = { at: new Date(this.now()).toISOString(), lines: ours.length, error: msg };
      return;
    }
    await this.applyClients(ag);
  }

  /**
   * The AdGuard Home clients each child's devices need: SafeSearch, the adult-content filter and
   * blocked services, whatever their mode. Unlocked devices are left out (a grown-up is using them).
   */
  desiredClients(): AdGuardClientSettings[] {
    const f = this.deps.store.get();
    if (!f.enabled) return [];
    const out: AdGuardClientSettings[] = [];
    for (const p of this.deps.config().profiles) {
      const rules = f.people[p.id];
      if (!rules || p.role !== "child") continue;
      const ids = [
        ...new Set(
          this.devicesOf(p.id)
            .filter((d) => !this.unlockOf(d.id, f))
            .flatMap((d) => d.ips),
        ),
      ].sort();
      if (!ids.length) continue;
      const safe = rules.safeSearch;
      out.push({
        name: `${HEARTH_CLIENT}${p.name}`.slice(0, 60),
        ids,
        tags: ["user_child"],
        use_global_settings: false,
        filtering_enabled: true,
        parental_enabled: rules.adult,
        safebrowsing_enabled: true,
        safe_search: {
          enabled: safe,
          bing: safe,
          duckduckgo: safe,
          ecosia: safe,
          google: safe,
          pixabay: safe,
          yandex: safe,
          youtube: safe,
        },
        use_global_blocked_services: false,
        blocked_services: [...rules.services].sort(),
      });
    }
    // A shared device: its own client, as strict as the strictest of its children.
    const children = this.children();
    for (const d of this.deps.devices().devices) {
      if (d.treatment !== "shared" || this.unlockOf(d.id, f)) continue;
      const kids = this.deps
        .config()
        .profiles.filter((p) => d.people.includes(p.id) && children.has(p.id) && f.people[p.id]);
      const ids = [...new Set(d.ips)].sort();
      if (!kids.length || !ids.length) continue;
      const all = kids.map((p) => f.people[p.id] as NonNullable<(typeof f.people)[string]>);
      const safe = all.some((r) => r.safeSearch);
      out.push({
        name: `${HEARTH_CLIENT}${d.name} (shared)`.slice(0, 60),
        ids,
        tags: ["user_child"],
        use_global_settings: false,
        filtering_enabled: true,
        parental_enabled: all.some((r) => r.adult),
        safebrowsing_enabled: true,
        safe_search: {
          enabled: safe,
          bing: safe,
          duckduckgo: safe,
          ecosia: safe,
          google: safe,
          pixabay: safe,
          yandex: safe,
          youtube: safe,
        },
        use_global_blocked_services: false,
        blocked_services: [...new Set(all.flatMap((r) => r.services))].sort(),
      });
    }
    return out;
  }

  /** Add, change or remove Hearth's clients (and only those) to match. */
  private async applyClients(ag: AdGuard): Promise<void> {
    const want = this.desiredClients();
    const key = (c: AdGuardClientSettings) =>
      JSON.stringify([
        [...c.ids].sort(),
        c.use_global_settings,
        c.filtering_enabled,
        c.parental_enabled,
        c.safebrowsing_enabled,
        c.safe_search?.enabled,
        c.safe_search?.google,
        c.safe_search?.youtube,
        c.use_global_blocked_services,
        [...(c.blocked_services ?? [])].sort(),
      ]);
    try {
      const have = (await ag.persistentClients()).filter((c) => c.name.startsWith(HEARTH_CLIENT));
      for (const c of have) if (!want.some((w) => w.name === c.name)) await ag.deleteClient(c.name);
      for (const w of want) {
        const now = have.find((c) => c.name === w.name);
        if (!now) await ag.addClient(w);
        else if (key(now) !== key(w)) await ag.updateClient(w.name, w);
      }
      this.clientsError = undefined;
    } catch (e) {
      const msg =
        e instanceof AdGuardError || e instanceof NetError
          ? e.message
          : "Couldn't save Hearth's clients in AdGuard Home.";
      // The usual reason: one of the addresses already belongs to a client someone made there.
      this.clientsError = /same|already|exists|uses/i.test(msg)
        ? `${msg} One of a child's device addresses may already belong to a client in AdGuard Home (Settings → Client settings); remove it there.`
        : msg;
    }
  }

  /** The apps and services AdGuard Home can block (asked now and then). */
  async services(): Promise<ServiceInfo[]> {
    const now = this.now();
    if (this.serviceCache && now - this.serviceCache.at < 3600_000) return this.serviceCache.list;
    const ag = this.deps.adguard();
    if (!ag) throw new InternetError("Connect AdGuard Home first (Devices → Setup).", 409);
    const list = (await ag.services())
      .map((s) => ({ id: s.id, name: s.name, group: s.group_id ?? "other" }))
      .sort((a, b) => a.name.localeCompare(b.name));
    this.serviceCache = { at: now, list };
    return list;
  }

  /** After a change: apply it now, not at the next tick. */
  private async changed(): Promise<void> {
    this.running = this.running.then(() => this.apply().catch(() => {}));
    await this.running;
  }

  // -------------------------------------------------------------------------
  // History

  /** Pages of the query log, newest first, until `stop` says so or it runs out. */
  private async read(
    ag: AdGuard,
    keep: (q: AdGuardQuery, at: number) => "keep" | "skip" | "stop",
    search?: string,
  ): Promise<{ at: number; q: AdGuardQuery }[]> {
    const out: { at: number; q: AdGuardQuery }[] = [];
    let older: string | undefined;
    for (let page = 0; page < PAGES; page++) {
      const r = await ag.queryLog({ olderThan: older, limit: PAGE, search });
      let stop = false;
      for (const q of r.data) {
        const at = Date.parse(q.time);
        if (Number.isNaN(at)) continue;
        const k = keep(q, at);
        if (k === "stop") {
          stop = true;
          break;
        }
        if (k === "keep") out.push({ at, q });
      }
      if (stop || !r.oldest || r.data.length < PAGE) break;
      older = r.oldest;
    }
    return out;
  }

  /**
   * Read lookups since last time into children's history. A device that's just become a
   * child's also gets its earlier lookups, read back by its address once.
   */
  async collect(): Promise<number> {
    const ag = this.deps.adguard();
    if (!ag) return 0;
    const who = this.childDevices();
    const f = this.deps.store.get();
    const since = f.cursor ? Date.parse(f.cursor) : 0;

    // New lookups (the first time ever: as far back as PAGES goes).
    const fresh = await this.read(ag, (_q, at) => (at <= since ? "stop" : "keep"));

    // Devices history hasn't started for: their lookups up to now come from the log, once.
    const newly = [...new Set([...who.values()].map((o) => o.device))].filter(
      (id) => !f.tracked[id],
    );
    const back: { at: number; q: AdGuardQuery }[] = [];
    if (since)
      for (const id of newly)
        for (const [ip, o] of who)
          if (o.device === id && !ip.includes(":"))
            back.push(
              ...(await this.read(
                ag,
                (q, at) => (q.client === ip && at <= since ? "keep" : "skip"),
                ip,
              )),
            );

    const all = [...fresh, ...back].sort((a, b) => a.at - b.at);
    const added = all.length ? await this.record(all, who) : 0;
    if (fresh.length) await this.tellBlocked(fresh, who).catch(() => {});
    if (fresh.length) await this.watchDoor(fresh).catch(() => {});
    for (const { at, q } of fresh) {
      const o = who.get(q.client);
      if (o && at > (this.active.get(o.device) ?? 0)) this.active.set(o.device, at);
    }

    const newest = fresh.length ? Math.max(...fresh.map((x) => x.at)) : since;
    if (newest !== since || newly.length)
      await this.deps.store.update((d) => {
        if (newest) d.cursor = new Date(newest).toISOString();
        const from = new Date(since || this.now()).toISOString();
        // Kept even if a device stops being a child's, so its past is never read back twice.
        for (const id of newly) d.tracked[id] = from;
      });

    const today = this.dayOf(this.now());
    if (this.lastPrune !== today) {
      this.lastPrune = today;
      await this.deps.history.prune(today, f.historyDays);
    }
    return added;
  }

  /** Add lookups (oldest first) to the days they happened on. */
  private async record(all: { at: number; q: AdGuardQuery }[], who: Map<string, Owner>) {
    const basic = new Set(essentials("basic"));
    const lastAllowed = new Map<string, { site: string; at: number }>();
    const tz = this.tz();
    let added = 0;
    await this.deps.history.update(async (day) => {
      const touched: string[] = [];
      for (const { at, q } of all) {
        const owner = who.get(q.client);
        const name = q.question?.name?.toLowerCase().replace(/\.$/, "");
        if (!owner || !name || q.question?.type === "PTR" || noise(name)) continue;
        const site = baseDomain(name);
        if (basic.has(site) || basic.has(name)) continue;
        const blocked = isBlocked(q.reason);
        const d = this.dayOf(at);
        const days = await day(d);
        // What it was on just before a block (once per lookup, whoever's history it goes in).
        const prev = lastAllowed.get(q.client);
        const after =
          blocked && prev && prev.site !== site && at - prev.at < AFTER_MS ? prev.site : undefined;
        if (!blocked) lastAllowed.set(q.client, { site, at });
        // A shared device's lookups go in each child's history who uses it.
        for (const person of owner.people) {
          const mine = days[person] ?? {};
          days[person] = mine;
          const iso = new Date(at).toISOString();
          const v: SiteVisit = mine[site] ?? {
            n: 0,
            blocked: 0,
            first: iso,
            last: iso,
            devices: [],
            per: {},
          };
          v.n += 1;
          if (blocked) v.blocked += 1;
          if (after) v.after = after;
          if (iso < v.first) v.first = iso;
          if (iso > v.last) v.last = iso;
          if (!v.devices.includes(owner.device))
            v.devices = [...v.devices, owner.device].slice(-20);
          v.per = { ...v.per, [owner.device]: (v.per[owner.device] ?? 0) + 1 };
          const hours = v.hours ?? noHours();
          const h = Math.floor(localClock(at, tz).minutes / 60);
          hours[h] = (hours[h] ?? 0) + 1;
          v.hours = hours;
          mine[site] = v;
        }
        touched.push(d);
        added++;
      }
      return touched;
    });
    return added;
  }

  /** A person's sites on a day, latest first; for one device, if asked. */
  async historyOf(person: string, day: string, device?: string): Promise<VisitRow[]> {
    const d = await this.deps.history.day(day);
    return Object.entries(d[person] ?? {})
      .map(([site, v]) => ({ site, ...v }))
      .filter((v) => !device || v.devices.includes(device))
      .sort((a, b) => b.last.localeCompare(a.last));
  }

  /** Sites blocked on a person's devices in the last few days that still aren't allowed. */
  async blockedLately(person: string, days = LATELY): Promise<VisitRow[]> {
    const p = this.profile(person);
    const allowed = new Set(allowedSites(this.rulesOf(person), pageSites(this.deps.config(), p)));
    const out = new Map<string, VisitRow>();
    const now = this.now();
    for (let i = 0; i < days; i++) {
      for (const row of await this.historyOf(person, this.dayOf(now - i * 86_400_000))) {
        if (!row.blocked || allowed.has(row.site)) continue;
        const had = out.get(row.site);
        if (!had) out.set(row.site, { ...row });
        else {
          had.blocked += row.blocked;
          had.n += row.n;
          had.after ??= row.after;
          if (row.last > had.last) had.last = row.last;
          if (row.first < had.first) had.first = row.first;
        }
      }
    }
    return [...out.values()].sort((a, b) => b.last.localeCompare(a.last)).slice(0, 60);
  }

  async days(): Promise<string[]> {
    return this.deps.history.list();
  }

  // -------------------------------------------------------------------------
  // The Family page

  private async summary(p: Profile): Promise<ChildSummary> {
    const f = this.deps.store.get();
    const rules = this.rulesOf(p.id);
    const now = this.now();
    const pause = pauseOn(f.pauses[p.id], now) ? f.pauses[p.id] : undefined;
    const next = nextChange(rules, pause, now, this.tz());
    const sites = await this.historyOf(p.id, this.dayOf(now));
    const reached = sites.filter((s) => s.n > s.blocked);
    const hours = noHours();
    for (const s of sites)
      for (const [h, n] of (s.hours ?? []).entries()) hours[h] = (hours[h] ?? 0) + n;
    return {
      person: p.id,
      now: modeNow(rules, pause, now, this.tz()),
      next: next
        ? {
            // A pause ends at its own moment, not the minute after.
            at: new Date(
              pause?.until && Date.parse(pause.until) <= next.at
                ? Date.parse(pause.until)
                : next.at,
            ).toISOString(),
            mode: next.now.mode,
            schedule: next.now.schedule,
          }
        : undefined,
      pause,
      devices: [...this.devicesOf(p.id), ...this.sharedOf(p.id)].map((d) => ({
        id: d.id,
        name: d.name,
        type: d.type,
        ips: d.ips,
        unlocked: this.unlockOf(d.id, f),
        lastActive: this.active.has(d.id)
          ? new Date(this.active.get(d.id) as number).toISOString()
          : undefined,
      })),
      today: {
        sites: reached.length,
        blocked: sites.reduce((n, s) => n + s.blocked, 0),
        top: [...reached]
          .sort((a, b) => b.n - b.blocked - (a.n - a.blocked))
          .slice(0, 5)
          .map((s) => s.site),
        hours,
      },
    };
  }

  async family(admin: boolean): Promise<FamilyView> {
    const f = this.deps.store.get();
    const children = this.deps.config().profiles.filter((p) => p.role === "child");
    const attention: AttentionRow[] = [];
    for (const p of children)
      for (const row of await this.blockedLately(p.id))
        if (!f.dismissed[p.id]?.[row.site]) attention.push({ ...row, person: p.id });
    attention.sort((a, b) => b.last.localeCompare(a.last));
    return {
      enabled: f.enabled,
      admin,
      children: await Promise.all(children.map((p) => this.summary(p))),
      attention: attention.slice(0, 40),
      requests: f.requests.filter((r) => r.status === "pending"),
      visitors: this.doorVisitors(),
    };
  }

  async childView(person: string, day?: string, device?: string): Promise<ChildView> {
    const p = this.child(person);
    const f = this.deps.store.get();
    const on = day ?? this.dayOf(this.now());
    const sites = await this.historyOf(person, on, device);
    const hours = noHours();
    for (const s of sites) {
      // For one device, its share of each hour isn't kept: show its lookups, spread as the site's.
      const share = device && s.n ? (s.per[device] ?? 0) / s.n : 1;
      for (const [h, n] of (s.hours ?? []).entries()) hours[h] = (hours[h] ?? 0) + n * share;
    }
    const days = await this.days();
    return {
      enabled: f.enabled,
      summary: await this.summary(p),
      rules: this.rulesOf(person),
      pageSites: pageSites(this.deps.config(), p),
      day: on,
      days: days.includes(on) ? days : [on, ...days].sort().reverse(),
      device,
      sites,
      hours: hours.map((n) => Math.round(n)),
      blocked: (await this.blockedLately(person)).map((r) => ({
        ...r,
        dismissed: f.dismissed[person]?.[r.site],
      })),
    };
  }

  // -------------------------------------------------------------------------
  // The admin's part, and the device's own

  view(): InternetView {
    const f = this.deps.store.get();
    return {
      enabled: f.enabled,
      historyDays: f.historyDays,
      adguard: { ...this.adguardState, configured: Boolean(this.deps.adguard()) },
      applied: this.applied,
      parents: f.parents,
      notify: { url: f.notify.url, blocked: f.notify.blocked, error: this.notifyError },
      clientsError: this.clientsError,
    };
  }

  /** The device a page is open on: whose rules it follows, and who could unlock it. */
  here(at: { ip?: string; browser?: string }): HereInternet {
    const cfg = this.deps.config();
    const f = this.deps.store.get();
    const grownUps = cfg.profiles
      .filter((p) => isGrownUp(p) && this.deps.hasPin(p.id))
      .map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, color: p.color }));
    const d = this.deps
      .devices()
      .devices.find(
        (x) => (at.browser && x.browsers.includes(at.browser)) || (at.ip && x.ips.includes(at.ip)),
      );
    const rules = d?.person ? f.people[d.person] : undefined;
    if (!f.enabled || !d || d.treatment !== "person" || !d.person || !rules)
      return { ruled: false, grownUps };
    const now = modeNow(rules, f.pauses[d.person], this.now(), this.tz());
    const ruled = rules.mode !== "open" || rules.schedule.length > 0 || now.mode !== "open";
    return {
      ruled,
      person: d.person,
      device: d.id,
      now,
      unlocked: this.unlockOf(d.id, f),
      grownUps,
      request: [...f.requests]
        .reverse()
        .find(
          (r) => r.device === d.id && this.now() - Date.parse(r.answered ?? r.at) < REQUEST_SHOWN,
        ),
    };
  }

  // -------------------------------------------------------------------------
  // Changes

  async setOptions(o: {
    enabled?: boolean;
    historyDays?: number;
    parents?: string[];
    notify?: { url?: string; blocked: boolean };
  }) {
    if (o.parents) {
      const adults = new Set(
        this.deps
          .config()
          .profiles.filter((p) => p.role === "adult")
          .map((p) => p.id),
      );
      for (const id of o.parents)
        if (!adults.has(id)) throw new InternetError("Only an adult can be a parent here.");
    }
    await this.deps.store.update((d) => {
      if (o.enabled !== undefined) d.enabled = o.enabled;
      if (o.historyDays !== undefined) d.historyDays = o.historyDays;
      if (o.parents) d.parents = [...new Set(o.parents)];
      if (o.notify) d.notify = { url: o.notify.url || undefined, blocked: o.notify.blocked };
    });
    await this.changed();
  }

  async setPerson(person: string, rules: z.input<typeof PersonRulesSchema>): Promise<void> {
    this.child(person);
    await this.deps.store.update((d) => {
      d.people[person] = PersonRulesSchema.parse(rules);
    });
    await this.changed();
  }

  async allow(person: string, site: string): Promise<void> {
    this.child(person);
    const s = siteOf(`https://${site}/`) ?? site;
    await this.deps.store.update((d) => {
      const r = d.people[person] ?? PersonRulesSchema.parse({});
      if (!r.extra.includes(s)) r.extra = [...r.extra, s].sort();
      d.people[person] = r;
      if (d.dismissed[person]) delete d.dismissed[person][s];
    });
    await this.changed();
  }

  /** Stop showing a blocked site in "Needs a look" (it stays blocked). */
  async dismiss(person: string, site: string, on = true): Promise<void> {
    this.child(person);
    await this.deps.store.update((d) => {
      const mine = d.dismissed[person] ?? {};
      if (on) mine[site] = new Date(this.now()).toISOString();
      else delete mine[site];
      d.dismissed[person] = mine;
    });
  }

  async pause(person: string, minutes: number | null, by: string): Promise<void> {
    this.child(person);
    const now = this.now();
    await this.deps.store.update((d) => {
      d.pauses[person] = {
        until: minutes ? new Date(now + minutes * 60_000).toISOString() : undefined,
        by,
        at: new Date(now).toISOString(),
      };
    });
    await this.changed();
  }

  async resume(person: string): Promise<void> {
    await this.deps.store.update((d) => {
      delete d.pauses[person];
    });
    await this.changed();
  }

  /** A child's device (the Family page acts on these only). */
  childDevice(id: string): Device {
    const d = this.deps.devices().devices.find((x) => x.id === id);
    const children = this.children();
    const ok =
      (d?.treatment === "person" && d.person && children.has(d.person)) ||
      (d?.treatment === "shared" && d.people.some((p) => children.has(p)));
    if (!d || !ok) throw new InternetError("That isn't a child's device.", 404);
    return d;
  }

  /** Lift a device's rules for a while. `by` is the grown-up (already checked). */
  async unlock(device: string, minutes: number, by: string): Promise<void> {
    if (!this.deps.devices().devices.some((d) => d.id === device))
      throw new InternetError("That device is gone.", 404);
    const now = this.now();
    await this.deps.store.update((d) => {
      d.unlocks = [
        ...d.unlocks.filter((u) => u.device !== device),
        {
          device,
          by,
          at: new Date(now).toISOString(),
          until: new Date(now + minutes * 60_000).toISOString(),
        },
      ];
    });
    await this.changed();
  }

  async lock(device: string): Promise<void> {
    await this.deps.store.update((d) => {
      d.unlocks = d.unlocks.filter((u) => u.device !== device);
    });
    await this.changed();
  }

  /** Ask AdGuard Home what it would do with a site for one of a person's devices. */
  async check(
    person: string,
    site: string,
  ): Promise<{ device?: string; blocked: boolean; rule?: string }> {
    const ag = this.deps.adguard();
    if (!ag) throw new InternetError("Connect AdGuard Home first (Devices → Setup).", 409);
    const d = this.devicesOf(person).find((x) => x.ips.some((ip) => !ip.includes(":")));
    if (!d) throw new InternetError("Add one of their devices first, on the Devices page.", 409);
    const ip = d.ips.find((x) => !x.includes(":")) as string;
    const r = await ag.checkHost(site, ip);
    return { device: d.name, blocked: isBlocked(r.reason), rule: r.rules?.[0]?.text };
  }

  // -------------------------------------------------------------------------
  // The front door

  /** Addresses that may go on the internet through the door: saved devices, and those let in. */
  knownIps(): string[] {
    const now = this.now();
    return [
      ...new Set([
        ...this.deps.devices().devices.flatMap((d) => d.ips),
        ...this.deps.store
          .get()
          .admitted.filter((a) => !a.until || Date.parse(a.until) > now)
          .map((a) => a.ip),
      ]),
    ];
  }

  /** The door guards this address (it's on, and the address is on a guarded network). */
  guards(ip: string | undefined): boolean {
    const door = this.deps.store.get().door;
    return Boolean(ip && door.enabled && door.networks.some((n) => inCidr(ip, n)));
  }

  /** Stopped at the door right now. */
  stopped(ip: string | undefined): boolean {
    return Boolean(ip && this.guards(ip) && !this.knownIps().includes(ip));
  }

  private doorLines(): string[] {
    const door = this.deps.store.get().door;
    return door.enabled ? doorRules(door.networks, this.knownIps(), door.welcomeAddress) : [];
  }

  /** Notice devices stopped at the door, and tell the parents about new ones once a day. */
  private async watchDoor(fresh: { at: number; q: AdGuardQuery }[]): Promise<void> {
    const door = this.deps.store.get().door;
    if (!door.enabled) return;
    const known = new Set(this.knownIps());
    const fresh2: Visitor[] = [];
    for (const { at, q } of fresh) {
      if (known.has(q.client) || !door.networks.some((n) => inCidr(q.client, n))) continue;
      const iso = new Date(at).toISOString();
      const v = this.visitors.get(q.client);
      if (!v) {
        const nv: Visitor = {
          ip: q.client,
          name: q.client_info?.name || undefined,
          first: iso,
          last: iso,
          stopped: 1,
        };
        this.visitors.set(q.client, nv);
        fresh2.push(nv);
      } else {
        v.stopped += 1;
        if (iso > v.last) v.last = iso;
        v.name ??= q.client_info?.name || undefined;
      }
    }
    for (const v of fresh2)
      await this.tell(
        "A new device is asking for a guest pass",
        `${v.name ? `"${v.name}"` : "A device"} (${v.ip}) joined the family network and is waiting. Let it in on the Family page.`,
        "door",
      );
    // Forget visitors not seen for a day, and any that are known now.
    const now = this.now();
    for (const [ip, v] of this.visitors)
      if (known.has(ip) || now - Date.parse(v.last) > 86_400_000) this.visitors.delete(ip);
  }

  /** Stopped devices seen lately, newest first. */
  doorVisitors(): Visitor[] {
    if (!this.deps.store.get().door.enabled) return [];
    const known = new Set(this.knownIps());
    return [...this.visitors.values()]
      .filter((v) => !known.has(v.ip))
      .sort((a, b) => b.last.localeCompare(a.last));
  }

  doorView(): DoorView {
    const f = this.deps.store.get();
    const now = this.now();
    return {
      door: f.door,
      passwordSet: Boolean(this.deps.secrets?.has(DOOR_SECRET)),
      admitted: f.admitted.filter((a) => !a.until || Date.parse(a.until) > now),
      visitors: this.doorVisitors(),
    };
  }

  /** The welcome page's view of the device it's open on. */
  doorHere(ip: string | undefined): DoorHere {
    const cfg = this.deps.config();
    const f = this.deps.store.get();
    return {
      guarded: this.guards(ip),
      inside: !this.stopped(ip),
      admitted: f.admitted.find((a) => a.ip === ip),
      asked: Boolean(ip && this.visitors.get(ip)?.asked),
      home: cfg.settings.homeName ?? cfg.settings.title,
      passwordSet: Boolean(this.deps.secrets?.has(DOOR_SECRET)),
    };
  }

  /** Let a device in. */
  async admit(ip: string, by: string, name?: string, days?: number): Promise<void> {
    const stay = days ?? this.deps.store.get().door.stayDays;
    const now = this.now();
    const entry: Admitted = {
      ip,
      by,
      at: new Date(now).toISOString(),
      until: stay ? new Date(now + stay * 86_400_000).toISOString() : undefined,
      name: (name ?? this.visitors.get(ip)?.asked?.name ?? this.visitors.get(ip)?.name)?.slice(
        0,
        80,
      ),
    };
    await this.deps.store.update((d) => {
      d.admitted = [...d.admitted.filter((a) => a.ip !== ip), entry];
    });
    this.visitors.delete(ip);
    await this.changed();
  }

  async unadmit(ip: string): Promise<void> {
    await this.deps.store.update((d) => {
      d.admitted = d.admitted.filter((a) => a.ip !== ip);
    });
    await this.changed();
  }

  /** A parent said not now: it stays out, and leaves the list until it's seen again tomorrow. */
  dismissVisitor(ip: string): void {
    this.visitors.delete(ip);
  }

  /** The house password, typed on the welcome page. Wrong ones slow the next try down. */
  async enter(ip: string | undefined, password: string): Promise<void> {
    if (!ip || !this.guards(ip))
      throw new InternetError("This device isn't waiting for a guest pass.", 409);
    if (!this.stopped(ip)) return;
    const stored = this.deps.secrets?.get(DOOR_SECRET);
    if (!stored)
      throw new InternetError("There's no house password yet. Ask a parent to let you in.", 409);
    const now = this.now();
    const t = this.doorTries.get(ip);
    if (t && t.until > now)
      throw new InternetError(
        `Too many tries. Wait ${Math.ceil((t.until - now) / 1000)} seconds.`,
        409,
      );
    const hash = (s: string) => createHash("sha256").update(s).digest();
    if (!timingSafeEqual(hash(password), hash(stored))) {
      const next = { fails: (t?.fails ?? 0) + 1, until: 0 };
      if (next.fails >= 5) next.until = now + Math.min(15 * 60_000, 30_000 * 2 ** (next.fails - 5));
      this.doorTries.set(ip, next);
      throw new InternetError("That isn't the house password.", 403);
    }
    this.doorTries.delete(ip);
    await this.admit(ip, "password");
  }

  /** A stopped device asks a parent to let it in, saying what it is. */
  async askIn(ip: string | undefined, name?: string): Promise<void> {
    if (!ip || !this.stopped(ip))
      throw new InternetError("This device isn't waiting for a guest pass.", 409);
    const now = new Date(this.now()).toISOString();
    const v: Visitor = this.visitors.get(ip) ?? { ip, first: now, last: now, stopped: 0 };
    if (v.asked && this.now() - Date.parse(v.asked.at) < 5 * 60_000) return;
    v.asked = { at: now, name: name?.trim().slice(0, 80) || undefined };
    this.visitors.set(ip, v);
    await this.tell(
      "Someone wants to come in",
      `${v.asked.name ? `"${v.asked.name}"` : "A device"} (${ip}) is asking to use the internet. Let it in on the Family page.`,
      "door",
    );
  }

  /**
   * Change the front door. Turning it on lets in every device already on the network (so the house
   * isn't cut off) and the device doing it.
   */
  async setDoor(
    input: DoorPatch & { password?: string | null },
    by: { ip?: string },
  ): Promise<{ letIn: number }> {
    const f = this.deps.store.get();
    // Only what was sent changes.
    const { password: _password, welcomeAddress, ...rest } = input;
    const next: Door = { ...f.door };
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) Object.assign(next, { [k]: v });
    if (welcomeAddress !== undefined) next.welcomeAddress = welcomeAddress ?? undefined;
    if (input.password !== undefined) {
      if (!this.deps.secrets) throw new InternetError("Hearth can't keep a password here.", 409);
      if (input.password !== null && input.password.trim().length < 4)
        throw new InternetError("The house password needs at least 4 characters.");
      await this.deps.secrets.set(
        DOOR_SECRET,
        input.password === null ? null : input.password.trim(),
      );
    }
    let letIn = 0;
    const opening = next.enabled && !f.door.enabled;
    if (next.enabled) {
      if (!next.networks.length)
        throw new InternetError("Say which network needs guest passes first.");
      const ag = this.deps.adguard();
      if (!ag) throw new InternetError("Connect AdGuard Home first (Devices → Setup).", 409);
      if (opening) {
        // Everything on the network now, from AdGuard Home's devices and its recent lookups.
        const [clients, recent] = await Promise.all([ag.clients(), ag.recent(1000)]);
        const here = new Map<string, string | undefined>();
        for (const a of clients.auto) here.set(a.ip, a.name);
        for (const q of recent) if (!here.has(q.client)) here.set(q.client, q.client_info?.name);
        if (by.ip) here.set(by.ip, here.get(by.ip));
        const known = new Set(this.knownIps());
        const now = new Date(this.now()).toISOString();
        const add: Admitted[] = [];
        for (const [ip, name] of here)
          if (!known.has(ip) && next.networks.some((n) => inCidr(ip, n)))
            add.push({
              ip,
              at: now,
              by: ip === by.ip ? "admin" : "start",
              name: name || undefined,
            });
        letIn = add.length;
        await this.deps.store.update((d) => {
          d.admitted = [...d.admitted.filter((a) => !add.some((x) => x.ip === a.ip)), ...add];
        });
      }
    }
    await this.deps.store.update((d) => {
      d.door = next;
    });
    if (!next.enabled) this.visitors.clear();
    await this.changed();
    return { letIn };
  }

  /** For the phone's "is there internet?" check: send a stopped device to the welcome page. */
  captive(ip: string | undefined): { redirect?: string } {
    return this.stopped(ip) ? { redirect: this.deps.store.get().door.welcomeUrl } : {};
  }

  // -------------------------------------------------------------------------
  // Asking, and telling the parents

  /** Requests waiting for an answer. */
  pending(): AskRequest[] {
    return this.deps.store.get().requests.filter((r) => r.status === "pending");
  }

  /** A child asks from their device: more time, or a site. Returns the request. */
  async ask(
    at: { ip?: string; browser?: string },
    q: { kind: "time" | "site"; minutes?: number; site?: string; note?: string },
  ): Promise<AskRequest> {
    const here = this.here(at);
    if (!here.ruled || !here.device || !here.person)
      throw new InternetError("This device isn't limited, so there's nothing to ask for.", 409);
    const now = this.now();
    // Every ask counts, even one that replaced another (else asking again and again would do).
    const lately = (this.asks.get(here.device) ?? []).filter((t) => now - t < 3600_000);
    if (lately.length >= ASKS_PER_HOUR)
      throw new InternetError("That's a lot of asking. Wait a little, or ask a grown-up.", 409);
    this.asks.set(here.device, [...lately, now]);
    // A name ("roblox.com") or a whole link pasted in ("https://www.roblox.com/games").
    const raw = q.site?.trim() ?? "";
    const site =
      q.kind === "site"
        ? (siteOf(raw.includes("://") ? raw : `https://${raw}/`) ?? undefined)
        : undefined;
    if (q.kind === "site" && !site) throw new InternetError("That isn't a site's name.");
    const req: AskRequest = {
      id: randomBytes(6).toString("hex"),
      person: here.person,
      device: here.device,
      kind: q.kind,
      minutes: q.kind === "time" ? (q.minutes ?? 30) : undefined,
      site,
      note: q.note?.trim() || undefined,
      at: new Date(now).toISOString(),
      status: "pending",
    };
    await this.deps.store.update((d) => {
      // A new ask of the same kind from the same device replaces one still waiting.
      d.requests = [
        ...d.requests.filter(
          (r) => !(r.status === "pending" && r.device === req.device && r.kind === req.kind),
        ),
        req,
      ];
    });
    const who = this.profile(here.person).name;
    const device = this.deps.devices().devices.find((x) => x.id === here.device)?.name;
    void this.tell(
      `${who} is asking`,
      `${who} asks for ${req.kind === "time" ? `${req.minutes} more minutes` : req.site}${device ? ` on ${device}` : ""}${req.note ? `: "${req.note}"` : ""}. Answer on the Family page.`,
      "raising_hand",
    );
    return req;
  }

  /** A parent answers a request: yes unlocks the device or allows the site. */
  async answer(id: string, approve: boolean, by: string, minutes?: number): Promise<AskRequest> {
    const req = this.deps.store.get().requests.find((r) => r.id === id);
    if (!req) throw new InternetError("That request is gone.", 404);
    if (req.status !== "pending") throw new InternetError("That's already been answered.", 409);
    if (approve) {
      if (req.kind === "time") await this.unlock(req.device, minutes ?? req.minutes ?? 30, by);
      else if (req.site) await this.allow(req.person, req.site);
    }
    let done = req;
    await this.deps.store.update((d) => {
      const r = d.requests.find((x) => x.id === id);
      if (!r) return;
      r.status = approve ? "approved" : "denied";
      r.by = by;
      r.answered = new Date(this.now()).toISOString();
      if (approve && r.kind === "time" && minutes) r.minutes = minutes;
      done = { ...r };
    });
    return done;
  }

  /** Send an alert to the address the admin gave (ntfy, Home Assistant, Gotify…), if any. */
  async tell(title: string, text: string, tag = "house"): Promise<void> {
    const url = this.deps.store.get().notify.url;
    if (!url) return;
    // Header values must be plain ASCII; anything else goes in the message itself.
    const ascii = /^[\x20-\x7e]*$/.test(title);
    try {
      const r = await guardedFetch(url, {
        method: "POST",
        headers: {
          "content-type": "text/plain; charset=utf-8",
          ...(ascii ? { title } : {}),
          tags: tag,
        },
        body: ascii ? text : `${title}\n${text}`,
        // The admin chose this address, so it may be on the internet (ntfy.sh, say).
        policy: { allowInternet: true },
        fetch: this.deps.fetch,
        timeoutMs: 6000,
        maxBytes: 64 * 1024,
      });
      this.notifyError = r.status >= 400 ? `It answered ${r.status}.` : undefined;
    } catch (e) {
      this.notifyError = e instanceof NetError ? e.message : "Couldn't send it.";
    }
  }

  /** Alert about sites a child was first blocked from today (if the admin asked for that). */
  private async tellBlocked(
    fresh: { at: number; q: AdGuardQuery }[],
    who: Map<string, Owner>,
  ): Promise<void> {
    const f = this.deps.store.get();
    if (!f.notify.url || !f.notify.blocked) return;
    const today = this.dayOf(this.now());
    const allowed = new Map<string, Set<string>>();
    for (const { q } of fresh) {
      const owner = who.get(q.client);
      const name = q.question?.name?.toLowerCase().replace(/\.$/, "");
      if (!owner || !name || !isBlocked(q.reason) || noise(name)) continue;
      const site = baseDomain(name);
      const key = `${owner.person}|${site}|${today}`;
      if (this.told.has(key) || f.dismissed[owner.person]?.[site]) continue;
      let ok = allowed.get(owner.person);
      if (!ok) {
        const p = this.deps.config().profiles.find((x) => x.id === owner.person);
        ok = new Set(p ? allowedSites(this.rulesOf(p.id), pageSites(this.deps.config(), p)) : []);
        allowed.set(owner.person, ok);
      }
      if (ok.has(site)) continue;
      this.told.add(key);
      const name2 =
        this.deps.config().profiles.find((x) => x.id === owner.person)?.name ?? owner.person;
      await this.tell(
        `${name2} was blocked`,
        `${name2} tried ${site}. Allow or dismiss it on the Family page.`,
        "no_entry",
      );
    }
    if (this.told.size > 2000) this.told.clear();
  }

  /** A profile was renamed. */
  async renamePerson(from: string, to: string): Promise<void> {
    await this.deps.store.update((d) => {
      for (const map of [d.people, d.pauses, d.dismissed] as Record<string, unknown>[])
        if (map[from]) {
          map[to] = map[from];
          delete map[from];
        }
      d.parents = d.parents.map((x) => (x === from ? to : x));
    });
    await this.deps.history.rewrite((day) => {
      if (!day[from]) return false;
      day[to] = day[from];
      delete day[from];
      return true;
    });
  }

  /** Someone left: their rules and history go. */
  async forget(person: string): Promise<void> {
    await this.deps.store.update((d) => {
      delete d.people[person];
      delete d.pauses[person];
      delete d.dismissed[person];
      d.parents = d.parents.filter((x) => x !== person);
    });
    await this.deps.history.rewrite((day) => {
      if (!day[person]) return false;
      delete day[person];
      return true;
    });
    await this.changed();
  }
}
