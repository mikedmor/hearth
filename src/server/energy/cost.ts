/**
 * What the electricity costs: the rate (Hearth's own, else the one set in the Sense app, else the
 * state's average Sense looks up from the home's postal code), the billing period (from the
 * billing day), what this bill comes to so far and what it's on track for.
 */
import type { EnergyCost } from "../../shared/energy";

type Obj = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown, n = 60) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined;
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** What the Sense monitor's overview says about cost and the home. */
export interface MonitorInfo {
  solar: boolean;
  timeZone?: string;
  /** ¢/kWh as set in the Sense app (or Sense's default). */
  rate?: number;
  rateSetByUser: boolean;
  sellBack?: number;
  /** Day of the month the bill starts. */
  cycleStart?: number;
  /** The state's (or region's) average, from the home's postal code. */
  area?: string;
  areaRate?: number;
  nationalRate?: number;
}

export function parseMonitor(overview: unknown): MonitorInfo {
  const m = (((overview as Obj | null)?.monitor_overview as Obj | undefined)?.monitor ?? {}) as Obj;
  const a = (m.attributes ?? {}) as Obj;
  const ec = (a.electricity_cost ?? {}) as Obj;
  const nat = (ec.national_electricity_cost ?? {}) as Obj;
  const cycle = num(a.cycle_start);
  return {
    solar: m.solar_configured === true,
    timeZone: str(m.time_zone),
    rate: num(a.cost),
    rateSetByUser: a.user_set_cost === true,
    sellBack: num(a.sell_back_rate),
    cycleStart: cycle && cycle >= 1 && cycle <= 31 ? Math.round(cycle) : undefined,
    area: str(ec.location),
    areaRate: num(ec.cost),
    nationalRate: num(nat.cost),
  };
}

/** Hearth's own overrides (Setup → Sense). */
export interface CostSettings {
  /** ¢/kWh. */
  rate?: number;
  cycleStart?: number;
  /** A fixed charge on every bill, in dollars. */
  fixed?: number;
}

/** The rate to use, and where it came from. */
export function pickRate(
  s: CostSettings,
  m: MonitorInfo | undefined,
): Pick<EnergyCost, "rate" | "rateFrom" | "area" | "areaRate" | "nationalRate"> | null {
  const area = { area: m?.area, areaRate: m?.areaRate, nationalRate: m?.nationalRate };
  if (s.rate) return { rate: s.rate, rateFrom: "hearth", ...area };
  if (m?.rateSetByUser && m.rate) return { rate: m.rate, rateFrom: "sense", ...area };
  if (m?.areaRate) return { rate: m.areaRate, rateFrom: "average", ...area };
  if (m?.rate) return { rate: m.rate, rateFrom: "sense", ...area };
  if (m?.nationalRate) return { rate: m.nationalRate, rateFrom: "average", ...area };
  return null;
}

/** The date and time where the home is. */
export function localNow(ms: number, timeZone?: string) {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    }).formatToParts(new Date(ms));
  } catch {
    return localNow(ms);
  }
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return {
    y: get("year"),
    m: get("month"),
    d: get("day"),
    minutes: get("hour") * 60 + get("minute"),
  };
}

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const dayNum = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 86_400_000;
const ymd = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const shift = (y: number, m: number, by: number) => {
  const i = y * 12 + (m - 1) + by;
  return { y: Math.floor(i / 12), m: (i % 12) + 1 };
};

export interface BillingPeriod {
  start: string;
  /** The day the next bill starts. */
  end: string;
  days: number;
  /** Days gone, with today's part. */
  elapsed: number;
  /** The calendar months it covers so far, oldest first, and which of their days. */
  months: { y: number; m: number; from: number; to: number }[];
}

/** The bill that today is in: from the billing day (the 1st without one) to the next. */
export function billingPeriod(ms: number, timeZone: string | undefined, cycleStart = 1) {
  const now = localNow(ms, timeZone);
  const startDay = (y: number, m: number) => Math.min(Math.max(1, cycleStart), daysIn(y, m));
  let s = { y: now.y, m: now.m };
  if (now.d < startDay(now.y, now.m)) s = shift(now.y, now.m, -1);
  const sd = startDay(s.y, s.m);
  const e = shift(s.y, s.m, 1);
  const ed = startDay(e.y, e.m);
  const months =
    s.y === now.y && s.m === now.m
      ? [{ ...s, from: sd, to: now.d }]
      : [
          { ...s, from: sd, to: daysIn(s.y, s.m) },
          { y: now.y, m: now.m, from: 1, to: now.d },
        ];
  return {
    start: ymd(s.y, s.m, sd),
    end: ymd(e.y, e.m, ed),
    days: dayNum(e.y, e.m, ed) - dayNum(s.y, s.m, sd),
    elapsed: dayNum(now.y, now.m, now.d) - dayNum(s.y, s.m, sd) + now.minutes / 1440,
    months,
  } satisfies BillingPeriod;
}

/** A calendar month from `history/usage?scale=MONTH`: kWh a day (and, with solar, net a day). */
export interface MonthUsage {
  kwh: number[];
  /** Positive: sent to the grid; negative: bought. */
  net?: number[];
}

export function parseMonth(usage: unknown, solar: unknown): MonthUsage {
  const arr = (v: unknown) =>
    Array.isArray(v) ? v.map((x) => (typeof x === "number" && Number.isFinite(x) ? x : 0)) : [];
  const c = (((usage as Obj | null)?.consumption ?? {}) as Obj).usage_breakdown_kwh;
  const b = ((solar as Obj | null)?.breakdown ?? null) as Obj | null;
  return { kwh: arr(c), ...(b ? { net: arr(b.net_kwh) } : {}) };
}

/** This bill so far, and what it's on track for. */
export function billEstimate(
  period: BillingPeriod,
  months: Map<string, MonthUsage>,
  rate: { rate: number; sellBack?: number; fixed?: number; solar: boolean },
): EnergyCost["period"] {
  let kwh = 0;
  let bought = 0;
  let sold = 0;
  for (const p of period.months) {
    const u = months.get(`${p.y}-${p.m}`);
    if (!u) continue;
    for (let d = p.from; d <= p.to; d++) {
      kwh += u.kwh[d - 1] ?? 0;
      const net = u.net?.[d - 1];
      if (net !== undefined) {
        if (net < 0) bought -= net;
        else sold += net;
      }
    }
  }
  const usesNet = rate.solar && period.months.some((p) => months.get(`${p.y}-${p.m}`)?.net);
  const cents = usesNet
    ? bought * rate.rate - sold * (rate.sellBack ?? rate.rate)
    : kwh * rate.rate;
  const cost = cents / 100;
  const fixed = rate.fixed ?? 0;
  // A day in, the pace means something.
  const pace = period.elapsed >= 1 ? period.days / period.elapsed : undefined;
  return {
    start: period.start,
    end: period.end,
    days: period.days,
    elapsed: round(period.elapsed, 2),
    kwh: round(kwh, 1),
    cost: round(cost + fixed, 2),
    projectedKwh: pace ? round(kwh * pace, 0) : undefined,
    projectedCost: pace ? round(cost * pace + fixed, 2) : undefined,
  };
}
