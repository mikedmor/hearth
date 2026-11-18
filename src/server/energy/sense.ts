/**
 * The Sense energy monitor. Sense has no API on the home network: its app, and this, talk to
 * Sense's servers (api.sense.com). Not an official API: it's the one Sense's own app uses, as the
 * open-source sense_energy library (scottbonline/sense) documents, so it can change.
 *
 * - Sign in once with the account's email and password (and a code from an authenticator app if
 *   the account asks). The password is never kept: Sense answers with tokens, kept as secrets,
 *   and renews them with the refresh token.
 * - Now: `app/<monitor>/realtime_update` (monitors on software 1.64 or newer), else one message
 *   from the realtime WebSocket. At most once a minute, and only while someone is looking.
 * - Today: `app/monitors/<monitor>/history/usage` (and `/solar`), every ten minutes.
 */
import { randomBytes } from "node:crypto";
import type { EnergyCost, EnergyNow, EnergyToday, EnergyView } from "../../shared/energy";
import { guardedFetch, NetError } from "../net";
import {
  billEstimate,
  billingPeriod,
  type CostSettings,
  type MonitorInfo,
  type MonthUsage,
  parseMonitor,
  parseMonth,
  pickRate,
} from "./cost";

const API = "https://api.sense.com/apiservice/api/v1/";
const SOCKET = "wss://clientrt.sense.com/monitors/";
const NOW_EVERY_MS = 60_000;
const TODAY_EVERY_MS = 10 * 60_000;
const MONITOR_EVERY_MS = 60 * 60_000;
const WANTED_MS = 3 * 60_000;
const KEEP = 60;

export class SenseError extends Error {}

export interface SenseSettings {
  email?: string;
  userId?: string;
  monitorId?: string;
  deviceId?: string;
}

export interface SenseDeps {
  settings: () => SenseSettings;
  token: (name: "access" | "refresh") => string | undefined;
  /** Keep new settings and tokens (null removes a token). */
  save: (
    settings: SenseSettings | null,
    tokens: { access?: string | null; refresh?: string | null },
  ) => Promise<void>;
  fetch?: typeof fetch;
  /** One realtime message over the WebSocket (a fake in tests). */
  socket?: (url: string) => Promise<unknown>;
  now?: () => number;
  /** Hearth's own cost settings (the rate, billing day, fixed charge). */
  costSettings?: () => CostSettings;
  onChange?: () => void;
  log?: (msg: string) => void;
}

type Obj = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown, n = 80) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined;
const round = (n: number | undefined, d = 2) =>
  n === undefined ? undefined : Math.round(n * 10 ** d) / 10 ** d;

/** A realtime message's payload, in Hearth's words. */
export function parseRealtime(p: unknown): Omit<EnergyNow, "ok" | "at" | "history" | "today"> {
  const o = (p && typeof p === "object" ? p : {}) as Obj;
  const devices = (Array.isArray(o.devices) ? o.devices : [])
    .flatMap((d: Obj) => {
      const w = num(d?.w) ?? (typeof d?.w === "string" ? Number(d.w) : undefined);
      const name = str(d?.name);
      return name && w !== undefined && Number.isFinite(w) && w > 0
        ? [{ name, watts: Math.round(w), icon: str(d.icon, 40) }]
        : [];
    })
    .sort((a, b) => b.watts - a.watts);
  const solarWatts = num(o.solar_w);
  return {
    watts: num(o.w) !== undefined ? Math.round(num(o.w) as number) : undefined,
    solarWatts: solarWatts !== undefined ? Math.round(solarWatts) : undefined,
    solar: solarWatts !== undefined,
    voltage: Array.isArray(o.voltage)
      ? o.voltage.flatMap((v) => (num(v) !== undefined ? [round(num(v), 1) as number] : []))
      : undefined,
    hz: round(num(o.hz), 2),
    devices,
  };
}

/** Today's totals from `history/usage` (and `history/usage/solar`). */
export function parseToday(usage: unknown, solar: unknown): EnergyToday {
  const u = (usage && typeof usage === "object" ? usage : {}) as Obj;
  const c = (u.consumption ?? {}) as Obj;
  const top = (Array.isArray(u.device_breakdown) ? u.device_breakdown : [])
    .flatMap((d: Obj) => {
      const kwh = num((d?.consumption as Obj | undefined)?.usage_total_kwh);
      const name = str(d?.name);
      return name && kwh ? [{ name, kwh: round(kwh) as number }] : [];
    })
    .sort((a, b) => b.kwh - a.kwh)
    .slice(0, 10);
  const t = ((solar as Obj | null)?.total ?? null) as Obj | null;
  return {
    kwh: round(num(c.usage_total_kwh) ?? 0) as number,
    ...(t
      ? {
          solarKwh: round(num(t.production_kwh)),
          fromGridKwh: round(num(t.from_grid_kwh)),
          toGridKwh: round(num(t.to_grid_kwh)),
          solarPct: num(t.solar_percentage),
        }
      : {}),
    top,
  };
}

/** One realtime message over Sense's WebSocket (Node's own WebSocket; JSON, not msgpack). */
async function socketOnce(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const done = (fn: () => void) => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {}
      fn();
    };
    const timer = setTimeout(
      () => done(() => reject(new SenseError("Sense didn't send a reading."))),
      10_000,
    );
    ws.onmessage = (ev) => {
      let m: Obj;
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (m.type === "realtime_update") done(() => resolve(m.payload));
      else if (m.type === "error") {
        const p = (m.payload ?? {}) as Obj;
        done(() =>
          reject(
            Object.assign(new SenseError(str(p.error_reason, 200) ?? "Sense said no."), {
              unauthorized: !p.authorized,
            }),
          ),
        );
      }
    };
    ws.onerror = () => done(() => reject(new SenseError("Couldn't reach Sense's live feed.")));
  });
}

export class SenseService {
  private now_: EnergyNow | undefined;
  private history = { watts: [] as number[], solar: [] as number[] };
  private today: EnergyToday | undefined;
  private todayAt = 0;
  private monitor: MonitorInfo | undefined;
  private monitorAt = 0;
  private months = new Map<string, MonthUsage>();
  private viaSocket = false;
  private needsSignIn = false;
  /** Between the password and the authenticator code. */
  private pending: { email: string; mfaToken: string; at: number } | null = null;
  private wantedAt = 0;
  private lastRead = 0;
  private timer: NodeJS.Timeout | undefined;
  private reading: Promise<void> | null = null;
  private renewing: Promise<void> | null = null;

  constructor(private readonly deps: SenseDeps) {}

  private clock() {
    return (this.deps.now ?? Date.now)();
  }

  connected(): boolean {
    const s = this.deps.settings();
    return Boolean(s.monitorId && this.deps.token("access"));
  }

  /** Until one is saved (at sign-in), the same new one for every call. */
  private readonly freshId = randomBytes(16).toString("hex");

  private deviceId(): string {
    return this.deps.settings().deviceId ?? this.freshId;
  }

  private async call(
    path: string,
    opts: { form?: Record<string, string>; auth?: boolean; again?: boolean } = {},
  ): Promise<{ status: number; data: Obj }> {
    const headers: Record<string, string> = { "x-sense-device-id": this.deviceId() };
    if (opts.auth !== false) {
      const t = this.deps.token("access");
      if (!t) throw new SenseError("Connect Sense first.");
      headers.authorization = `bearer ${t}`;
    }
    if (opts.form) headers["content-type"] = "application/x-www-form-urlencoded";
    let r: Awaited<ReturnType<typeof guardedFetch>>;
    try {
      r = await guardedFetch(API + path, {
        method: opts.form ? "POST" : "GET",
        headers,
        body: opts.form ? new URLSearchParams(opts.form).toString() : undefined,
        // Connecting Sense is the opt-in: it lives only on the internet.
        policy: { allowInternet: true },
        fetch: this.deps.fetch,
        timeoutMs: 10_000,
        maxBytes: 4 * 1024 * 1024,
      });
    } catch (e) {
      throw new SenseError(
        e instanceof NetError ? `Couldn't reach Sense: ${e.message}` : "Couldn't reach Sense.",
      );
    }
    let data: Obj = {};
    try {
      data = JSON.parse(r.body.toString("utf8") || "{}");
    } catch {}
    if (r.status === 401 && opts.auth !== false && !opts.again) {
      await this.renew();
      return this.call(path, { ...opts, again: true });
    }
    return { status: r.status, data };
  }

  /** New tokens from the refresh token; one renewal at a time. */
  private renew(): Promise<void> {
    this.renewing ??= (async () => {
      const s = this.deps.settings();
      const refresh = this.deps.token("refresh");
      if (!s.userId || !refresh) throw this.signedOut();
      const r = await this.call("renew", {
        auth: false,
        form: { user_id: s.userId, refresh_token: refresh },
      });
      const access = str(r.data.access_token, 4000);
      if (r.status !== 200 || !access) throw this.signedOut();
      await this.deps.save(null, {
        access,
        refresh: str(r.data.refresh_token, 4000) ?? refresh,
      });
    })().finally(() => {
      this.renewing = null;
    });
    return this.renewing;
  }

  private signedOut() {
    this.needsSignIn = true;
    return new SenseError("Sense signed Hearth out: connect it again in Setup.");
  }

  private async signedIn(email: string, data: Obj, deviceId: string): Promise<void> {
    const access = str(data.access_token, 4000);
    const monitors = Array.isArray(data.monitors) ? (data.monitors as Obj[]) : [];
    const monitorId = monitors[0]?.id;
    if (!access || monitorId === undefined)
      throw new SenseError("Sense let Hearth in, but didn't name a monitor on the account.");
    await this.deps.save(
      { email, userId: String(data.user_id ?? ""), monitorId: String(monitorId), deviceId },
      { access, refresh: str(data.refresh_token, 4000) ?? null },
    );
    this.needsSignIn = false;
    this.pending = null;
    this.reset();
  }

  /** Sign in with the account's email and password: done, or a code is needed. */
  async signIn(email: string, password: string): Promise<{ code: boolean }> {
    const deviceId = this.deviceId();
    const r = await this.call("authenticate", { auth: false, form: { email, password } });
    if (r.status === 401 && typeof r.data.mfa_token === "string") {
      this.pending = { email, mfaToken: r.data.mfa_token, at: this.clock() };
      // Keep the device id, so the code is checked for the same device.
      if (!this.deps.settings().deviceId)
        await this.deps.save({ ...this.deps.settings(), deviceId }, {});
      return { code: true };
    }
    if (r.status !== 200)
      throw new SenseError(
        r.status === 401 || r.status === 400
          ? "Sense didn't accept that email and password."
          : `Sense answered ${r.status}.`,
      );
    await this.signedIn(email, r.data, deviceId);
    return { code: false };
  }

  /** The code from the authenticator app, after `signIn` asked for one. */
  async verify(code: string): Promise<void> {
    const p = this.pending;
    if (!p || this.clock() - p.at > 10 * 60_000)
      throw new SenseError("Start again: give the email and password first.");
    const r = await this.call("authenticate/mfa", {
      auth: false,
      form: {
        totp: code,
        mfa_token: p.mfaToken,
        client_time: new Date(this.clock()).toISOString().replace(/\.\d+Z$/, "Z"),
      },
    });
    if (r.status !== 200) throw new SenseError("Sense didn't accept that code.");
    await this.signedIn(p.email, r.data, this.deviceId());
  }

  async disconnect(): Promise<void> {
    this.pending = null;
    this.needsSignIn = false;
    await this.deps.save({}, { access: null, refresh: null });
    this.reset();
  }

  private reset() {
    this.now_ = undefined;
    this.history = { watts: [], solar: [] };
    this.today = undefined;
    this.todayAt = 0;
    this.monitor = undefined;
    this.monitorAt = 0;
    this.months = new Map();
    this.viaSocket = false;
    this.lastRead = 0;
    if (this.connected()) this.want();
  }

  /** Someone is looking: keep reading (and read now if it's been a while). */
  want(): void {
    if (!this.connected()) return;
    this.wantedAt = this.clock();
    if (this.clock() - this.lastRead > NOW_EVERY_MS - 2000) void this.refresh();
    if (!this.timer) this.schedule();
  }

  private schedule() {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.clock() - this.wantedAt > WANTED_MS || !this.connected()) return;
      void this.refresh().finally(() => this.schedule());
    }, NOW_EVERY_MS);
    this.timer.unref?.();
  }

  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async realtime(monitor: string): Promise<unknown> {
    if (!this.viaSocket) {
      const r = await this.call(`app/${monitor}/realtime_update`);
      if (r.status === 200) return r.data;
      if (r.status !== 404 && r.status !== 400 && r.status !== 405)
        throw new SenseError(`Sense answered ${r.status}.`);
      // Older monitor software: the live feed instead.
      this.viaSocket = true;
    }
    const open = this.deps.socket ?? socketOnce;
    const url = () =>
      `${SOCKET}${monitor}/realtimefeed?access_token=${encodeURIComponent(this.deps.token("access") ?? "")}`;
    try {
      return await open(url());
    } catch (e) {
      if (!(e as { unauthorized?: boolean }).unauthorized) throw e;
      await this.renew();
      return open(url());
    }
  }

  private async readToday(monitor: string): Promise<void> {
    // The monitor's details (solar, the rate, the billing day, the area's average): hourly.
    if (!this.monitor || this.clock() - this.monitorAt >= MONITOR_EVERY_MS) {
      const o = await this.call(`app/monitors/${monitor}/overview`);
      if (o.status === 200) {
        this.monitor = parseMonitor(o.data);
        this.monitorAt = this.clock();
      }
    }
    const solarOn = this.monitor?.solar === true;
    const start = new Date(this.clock()).toISOString().slice(0, 19);
    const q = `?scale=DAY&start=${start}`;
    const usage = await this.call(`app/monitors/${monitor}/history/usage${q}`);
    if (usage.status !== 200) throw new SenseError(`Sense answered ${usage.status}.`);
    const solar = solarOn
      ? await this.call(`app/monitors/${monitor}/history/usage/solar${q}`)
      : null;
    this.today = parseToday(usage.data, solar?.status === 200 ? solar.data : null);
    this.todayAt = this.clock();
    // The bill so far: each calendar month it covers, a day at a time.
    const period = this.period();
    const months = new Map<string, MonthUsage>();
    for (const p of period.months) {
      const mq = `?scale=MONTH&start=${p.y}-${String(p.m).padStart(2, "0")}-15T12:00:00`;
      const u = await this.call(`app/monitors/${monitor}/history/usage${mq}`);
      if (u.status !== 200) continue;
      const s = solarOn
        ? await this.call(`app/monitors/${monitor}/history/usage/solar${mq}`)
        : null;
      months.set(`${p.y}-${p.m}`, parseMonth(u.data, s?.status === 200 ? s.data : null));
    }
    if (months.size) this.months = months;
  }

  private period() {
    const s = this.deps.costSettings?.() ?? {};
    return billingPeriod(
      this.clock(),
      this.monitor?.timeZone,
      s.cycleStart ?? this.monitor?.cycleStart ?? 1,
    );
  }

  /** What it costs: today, this bill so far, and what it's on track for. */
  private cost(): EnergyCost | undefined {
    const s = this.deps.costSettings?.() ?? {};
    const r = pickRate(s, this.monitor);
    if (!r || !this.months.size) return undefined;
    const solar = this.monitor?.solar === true;
    const sellBack = this.monitor?.sellBack ?? r.rate;
    const t = this.today;
    const todayCents = !t
      ? undefined
      : solar && t.fromGridKwh !== undefined
        ? (t.fromGridKwh ?? 0) * r.rate - (t.toGridKwh ?? 0) * sellBack
        : t.kwh * r.rate;
    return {
      ...r,
      fixed: s.fixed ?? 0,
      today: todayCents === undefined ? undefined : Math.round(todayCents) / 100,
      period: billEstimate(this.period(), this.months, {
        rate: r.rate,
        sellBack,
        fixed: s.fixed,
        solar,
      }),
    };
  }

  /** Cost settings changed: work the cost out again. */
  costChanged(): void {
    if (this.now_?.ok) this.now_ = { ...this.now_, cost: this.cost() };
    this.todayAt = 0;
    this.deps.onChange?.();
  }

  /** Read now (one round at a time). */
  refresh(): Promise<void> {
    this.reading ??= (async () => {
      const monitor = this.deps.settings().monitorId;
      if (!monitor || !this.deps.token("access")) return;
      try {
        if (this.needsSignIn) throw this.signedOut();
        const live = parseRealtime(await this.realtime(monitor));
        if (this.clock() - this.todayAt >= TODAY_EVERY_MS)
          await this.readToday(monitor).catch((e) => this.deps.log?.(`sense: today: ${e.message}`));
        const add = (k: "watts" | "solar", v?: number) => {
          if (v === undefined) return;
          this.history[k].push(v);
          if (this.history[k].length > KEEP) this.history[k].shift();
        };
        add("watts", live.watts);
        add("solar", live.solarWatts);
        this.now_ = {
          ...live,
          solar: live.solar || this.monitor?.solar === true,
          ok: true,
          at: new Date(this.clock()).toISOString(),
          today: this.today,
          cost: this.cost(),
          history: this.history,
        };
      } catch (e) {
        const error = e instanceof SenseError ? e.message : "Sense didn't answer.";
        this.now_ = {
          ...(this.now_ ?? { solar: false, devices: [], history: this.history }),
          ok: false,
          error,
        };
      }
      this.lastRead = this.clock();
      this.deps.onChange?.();
    })().finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  view(): EnergyView {
    this.want();
    return {
      connected: this.connected(),
      email: this.deps.settings().email,
      needsSignIn: this.needsSignIn,
      codePending: Boolean(this.pending),
      now: this.connected() ? this.now_ : undefined,
      costSettings: this.deps.costSettings?.() ?? {},
      senseCost: this.monitor
        ? {
            rate: this.monitor.rate,
            rateSetByUser: this.monitor.rateSetByUser,
            cycleStart: this.monitor.cycleStart,
            area: this.monitor.area,
            areaRate: this.monitor.areaRate,
          }
        : undefined,
    };
  }

  /** Hearth's own data for widgets. */
  widgetData(): unknown {
    this.want();
    const n = this.now_;
    if (!this.connected()) return { connected: false };
    return {
      connected: true,
      ok: n?.ok ?? false,
      error: n?.error ?? (n ? null : "Reading Sense…"),
      watts: n?.watts ?? null,
      kw: n?.watts !== undefined ? Math.round(n.watts / 100) / 10 : null,
      solar: n?.solar ?? false,
      solarWatts: n?.solarWatts ?? null,
      /** Watts bought from the grid now (negative: sold). */
      gridWatts:
        n?.watts !== undefined && n.solarWatts !== undefined ? n.watts - n.solarWatts : null,
      voltage: n?.voltage ?? [],
      hz: n?.hz ?? null,
      devices: n?.devices ?? [],
      on: n?.devices.length ?? 0,
      today: n?.today ?? null,
      cost: n?.cost
        ? {
            rate: n.cost.rate,
            rateFrom: n.cost.rateFrom,
            area: n.cost.area ?? null,
            today: n.cost.today ?? null,
            /** This bill so far (with the fixed charge), and what it's on track for. */
            bill: n.cost.period.cost,
            billKwh: n.cost.period.kwh,
            projected: n.cost.period.projectedCost ?? null,
            projectedKwh: n.cost.period.projectedKwh ?? null,
            since: n.cost.period.start,
            until: n.cost.period.end,
            daysLeft: Math.max(0, Math.ceil(n.cost.period.days - n.cost.period.elapsed)),
            fixed: n.cost.fixed,
          }
        : null,
      history: n?.history ?? { watts: [], solar: [] },
      at: n?.at ?? null,
    };
  }
}
