import { describe, expect, it } from "vitest";
import { parseRealtime, parseToday, SenseService, type SenseSettings } from "./sense";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Sense's servers, as far as Hearth uses them. */
function fakeSense(opts: { mfa?: boolean; oldMonitor?: boolean; expired?: boolean } = {}) {
  const calls: { path: string; form?: Record<string, string>; auth?: string; device?: string }[] =
    [];
  let expired = opts.expired ?? false;
  const fetch = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const path = u.pathname.replace("/apiservice/api/v1/", "") + u.search;
    const headers = init.headers as Record<string, string>;
    const form = init.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : undefined;
    calls.push({ path, form, auth: headers.authorization, device: headers["x-sense-device-id"] });
    const ok = {
      access_token: "t1",
      refresh_token: "r1",
      user_id: 42,
      monitors: [{ id: 777 }],
    };
    if (path === "authenticate") {
      if (form?.password !== "right") return json(400, { error_reason: "bad" });
      return opts.mfa ? json(401, { mfa_token: "m1" }) : json(200, ok);
    }
    if (path === "authenticate/mfa") return form?.totp === "123456" ? json(200, ok) : json(401, {});
    if (path === "renew") {
      expired = false;
      return form?.refresh_token === "r1"
        ? json(200, { ...ok, access_token: "t2" })
        : json(401, {});
    }
    if (expired) return json(401, {});
    if (path === "app/777/realtime_update")
      return opts.oldMonitor
        ? json(404, {})
        : json(200, {
            w: 1834.6,
            solar_w: 420.2,
            hz: 59.98,
            voltage: [121.33, 120.81],
            devices: [
              { id: "a", name: "Fridge", w: 120 },
              { id: "b", name: "Dryer", w: 1500.4 },
              { id: "c", name: "TV", w: 0 },
            ],
          });
    if (path === "app/monitors/777/overview")
      return json(200, {
        monitor_overview: {
          monitor: {
            solar_configured: true,
            time_zone: "America/New_York",
            attributes: {
              cost: 10,
              sell_back_rate: 5,
              user_set_cost: true,
              cycle_start: 1,
              electricity_cost: { location: "Oregon", cost: 14.26 },
            },
          },
        },
      });
    // A month, a day at a time: 10 kWh every day.
    if (path.startsWith("app/monitors/777/history/usage?scale=MONTH"))
      return json(200, { consumption: { usage_breakdown_kwh: Array(31).fill(10) } });
    if (path.startsWith("app/monitors/777/history/usage/solar"))
      return json(200, {
        total: { production_kwh: 4.2, from_grid_kwh: 10.1, to_grid_kwh: 1.3, solar_percentage: 28 },
      });
    if (path.startsWith("app/monitors/777/history/usage"))
      return json(200, {
        consumption: { usage_total_kwh: 13.456 },
        device_breakdown: [
          { name: "Dryer", consumption: { usage_total_kwh: 3.2 } },
          { name: "Fridge", consumption: { usage_total_kwh: 1.1 } },
        ],
      });
    return json(404, {});
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

function service(
  f: ReturnType<typeof fakeSense>,
  socket?: (url: string) => Promise<unknown>,
  cost: { rate?: number; cycleStart?: number; fixed?: number } = {},
) {
  let settings: SenseSettings = {};
  const tokens: Record<string, string | undefined> = {};
  const s = new SenseService({
    costSettings: () => cost,
    settings: () => settings,
    token: (n) => tokens[n],
    save: async (next, t) => {
      if (next) settings = next;
      for (const [k, v] of Object.entries(t)) if (v !== undefined) tokens[k] = v ?? undefined;
    },
    fetch: f.fetch,
    socket,
  });
  return { s, settings: () => settings, tokens };
}

describe("Sense", () => {
  it("reads a realtime message: watts, solar, and what's on, biggest first", () => {
    expect(
      parseRealtime({
        w: 512.4,
        solar_w: 0,
        voltage: [120.04],
        hz: 60.001,
        devices: [
          { name: "Always On", w: 210 },
          { name: "Furnace", w: "300.2" },
          { name: "Off", w: 0 },
        ],
      }),
    ).toEqual({
      watts: 512,
      solarWatts: 0,
      solar: true,
      voltage: [120],
      hz: 60,
      devices: [
        { name: "Furnace", watts: 300, icon: undefined },
        { name: "Always On", watts: 210, icon: undefined },
      ],
    });
    expect(parseRealtime({ w: 100 }).solar).toBe(false);
    expect(parseToday({ consumption: { usage_total_kwh: 2 } }, null)).toEqual({ kwh: 2, top: [] });
  });

  it("signs in without keeping the password, then reads now and today", async () => {
    const f = fakeSense();
    const { s, settings, tokens } = service(f);
    expect(await s.signIn("alex@example.com", "right")).toEqual({ code: false });
    expect(settings()).toMatchObject({ email: "alex@example.com", userId: "42", monitorId: "777" });
    expect(tokens).toEqual({ access: "t1", refresh: "r1" });
    expect(JSON.stringify(settings())).not.toContain("right");
    await s.refresh();
    const v = s.view();
    expect(v.connected).toBe(true);
    expect(v.now).toMatchObject({
      ok: true,
      watts: 1835,
      solarWatts: 420,
      solar: true,
      devices: [
        { name: "Dryer", watts: 1500 },
        { name: "Fridge", watts: 120 },
      ],
      today: { kwh: 13.46, solarKwh: 4.2, fromGridKwh: 10.1, toGridKwh: 1.3, solarPct: 28 },
    });
    expect(v.now?.today?.top[0]).toEqual({ name: "Dryer", kwh: 3.2 });
    const w = s.widgetData() as { kw: number; gridWatts: number; on: number };
    expect([w.kw, w.gridWatts, w.on]).toEqual([1.8, 1415, 2]);
    // One device id for Sense throughout.
    expect(new Set(f.calls.map((c) => c.device)).size).toBe(1);
    expect(f.calls.find((c) => c.path === "app/777/realtime_update")?.auth).toBe("bearer t1");
    s.stop();
  });

  it("works out today's cost and this bill from Sense's rate, or Hearth's", async () => {
    const cost: { rate?: number; fixed?: number } = {};
    const { s } = service(fakeSense(), undefined, cost);
    await s.signIn("alex@example.com", "right");
    await s.refresh();
    let c = s.view().now?.cost;
    // Solar: 10.1 kWh bought at 10 ¢, 1.3 sold at 5 ¢.
    expect(c).toMatchObject({
      rate: 10,
      rateFrom: "sense",
      area: "Oregon",
      fixed: 0,
      today: 0.95,
    });
    expect(c?.period.start.slice(8)).toBe("01");
    const days = new Date().getDate();
    expect(c?.period.kwh).toBeGreaterThanOrEqual(10 * (days - 1));
    expect(c?.period.cost).toBeCloseTo((c?.period.kwh ?? 0) / 10, 1);
    expect(s.view().senseCost).toMatchObject({ rate: 10, rateSetByUser: true, cycleStart: 1 });
    // Hearth's own rate and fixed charge win once set.
    cost.rate = 20;
    cost.fixed = 9.5;
    s.costChanged();
    await s.refresh();
    c = s.view().now?.cost;
    expect(c).toMatchObject({ rate: 20, rateFrom: "hearth", fixed: 9.5 });
    expect(c?.period.cost).toBeCloseTo((c?.period.kwh ?? 0) / 5 + 9.5, 1);
    const w = s.widgetData() as { cost: { bill: number; rateFrom: string; daysLeft: number } };
    expect(w.cost.rateFrom).toBe("hearth");
    expect(w.cost.bill).toBe(c?.period.cost);
    expect(w.cost.daysLeft).toBeGreaterThanOrEqual(0);
    s.stop();
  });

  it("asks for the authenticator code when the account wants one", async () => {
    const f = fakeSense({ mfa: true });
    const { s, tokens } = service(f);
    await expect(s.signIn("alex@example.com", "wrong")).rejects.toThrow(/didn't accept/);
    expect(await s.signIn("alex@example.com", "right")).toEqual({ code: true });
    expect(s.view().codePending).toBe(true);
    await expect(s.verify("000000")).rejects.toThrow(/that code/);
    await s.verify("123456");
    expect(tokens.access).toBe("t1");
    expect(s.view().codePending).toBe(false);
    s.stop();
  });

  it("renews an expired token, and uses the live feed on older monitors", async () => {
    const f = fakeSense({ oldMonitor: true });
    const opened: string[] = [];
    const { s, tokens } = service(f, async (url) => {
      opened.push(url);
      return { w: 300, devices: [] };
    });
    await s.signIn("alex@example.com", "right");
    await s.refresh();
    expect(s.view().now).toMatchObject({ ok: true, watts: 300 });
    expect(opened[0]).toBe("wss://clientrt.sense.com/monitors/777/realtimefeed?access_token=t1");
    s.stop();

    const g = fakeSense({ expired: true });
    const two = service(g);
    await two.s.signIn("alex@example.com", "right");
    await two.s.refresh();
    expect(two.tokens.access).toBe("t2");
    expect(two.s.view().now?.ok).toBe(true);
    expect(tokens.access).toBe("t1");
    two.s.stop();
  });

  it("says when Sense has signed Hearth out, and disconnects cleanly", async () => {
    const f = fakeSense();
    const { s, tokens } = service(f);
    await s.signIn("alex@example.com", "right");
    // Signing in reads once in the background: let it finish.
    await s.refresh();
    tokens.refresh = "stale";
    tokens.access = "old";
    // Every call is refused now, and renewing fails.
    const g = fakeSense({ expired: true });
    (s as unknown as { deps: { fetch: typeof fetch } }).deps.fetch = g.fetch;
    await s.refresh();
    expect(s.view()).toMatchObject({ needsSignIn: true, now: { ok: false } });
    expect(s.view().now?.error).toMatch(/connect it again/);
    await s.disconnect();
    expect(s.view()).toMatchObject({ connected: false, now: undefined });
    expect(tokens.access).toBeUndefined();
    s.stop();
  });
});
