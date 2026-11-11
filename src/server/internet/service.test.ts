import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProfileSchema } from "../../shared/config";
import { DeviceSchema, DevicesFileSchema } from "../../shared/devices";
import { AdGuard, type AdGuardClientSettings, type AdGuardQuery } from "../devices/adguard";
import { fixture } from "../test-fixtures";
import { FENCE_START } from "./rules";
import { InternetService } from "./service";
import { HistoryStore, InternetStore } from "./store";

/** AdGuard Home's filtering and query log, enough to test against. */
function fakeAdGuard(rules: string[] = ["||ads.example^"]) {
  const state = {
    rules: [...rules],
    writes: 0,
    log: [] as AdGuardQuery[],
    // Someone's own client, which Hearth must leave alone.
    clients: [{ name: "Grandma's laptop", ids: ["192.168.1.60"] }] as AdGuardClientSettings[],
    alerts: [] as { url: string; title: string | null; body: string }[],
    // Devices AdGuard Home found by itself (DHCP, ARP).
    auto: [] as { ip: string; name?: string }[],
  };
  const respond = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/control/filtering/status")
      return Response.json({ enabled: true, user_rules: state.rules });
    if (url.pathname === "/control/filtering/set_rules") {
      state.rules = JSON.parse(String(init?.body)).rules;
      state.writes++;
      return new Response("OK");
    }
    if (url.pathname === "/control/querylog") {
      const older = url.searchParams.get("older_than");
      const limit = Number(url.searchParams.get("limit") ?? 500);
      const search = url.searchParams.get("search");
      // Like AdGuard Home: a search matches part of a client's address or a name.
      const all = [...state.log]
        .filter((q) => !search || q.client.includes(search) || q.question?.name?.includes(search))
        .sort((a, b) => b.time.localeCompare(a.time));
      const page = all.filter((q) => !older || q.time < older).slice(0, limit);
      return Response.json({ data: page, oldest: page.at(-1)?.time ?? "" });
    }
    if (url.pathname === "/control/filtering/check_host") {
      const name = url.searchParams.get("name");
      return Response.json(
        name === "pbskids.org"
          ? { reason: "NotFilteredWhiteList", rules: [{ text: "@@||pbskids.org^" }] }
          : { reason: "FilteredBlackList", rules: [{ text: "||*^" }] },
      );
    }
    if (url.pathname === "/control/clients")
      return Response.json({ clients: state.clients, auto_clients: state.auto });
    if (url.pathname === "/control/clients/add") {
      const c = JSON.parse(String(init?.body)) as AdGuardClientSettings;
      if (state.clients.some((x) => x.ids.some((id) => c.ids.includes(id))))
        return new Response("another client uses the same ID", { status: 400 });
      state.clients.push(c);
      return new Response("OK");
    }
    if (url.pathname === "/control/clients/update") {
      const b = JSON.parse(String(init?.body)) as { name: string; data: AdGuardClientSettings };
      state.clients = state.clients.map((c) => (c.name === b.name ? b.data : c));
      return new Response("OK");
    }
    if (url.pathname === "/control/clients/delete") {
      const b = JSON.parse(String(init?.body)) as { name: string };
      state.clients = state.clients.filter((c) => c.name !== b.name);
      return new Response("OK");
    }
    if (url.hostname === "ntfy.example") {
      state.alerts.push({
        url: url.href,
        title: new Headers(init?.headers).get("title"),
        body: String(init?.body),
      });
      return new Response("{}");
    }
    return new Response("", { status: 404 });
  }) as typeof globalThis.fetch;
  return {
    state,
    respond,
    ag: new AdGuard({
      url: "http://192.168.1.1:3000",
      policy: { allowInternet: false },
      fetch: respond,
    }),
  };
}

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "hearth-net-"));
  const cfg = fixture();
  cfg.settings.timeZone = "UTC";
  cfg.tiles.push({
    ...cfg.tiles[1],
    id: "pbs",
    name: "PBS Kids",
    url: "https://pbskids.org",
  } as never);
  cfg.profiles = [
    ProfileSchema.parse({ id: "alex", name: "Alex", role: "adult" }),
    ProfileSchema.parse({ id: "ava", name: "Ava", role: "child" }),
  ];
  const devices = DevicesFileSchema.parse({
    devices: [
      {
        id: "avas-ipad",
        name: "Ava's iPad",
        treatment: "person",
        person: "ava",
        ips: ["192.168.1.41"],
        browsers: ["b-ipad"],
      },
      {
        id: "alexs-phone",
        name: "Alex's phone",
        treatment: "person",
        person: "alex",
        ips: ["192.168.1.40"],
      },
      { id: "tv", name: "TV", treatment: "always", ips: ["192.168.1.30"] },
    ],
  });
  const store = new InternetStore(dir);
  const fake = fakeAdGuard();
  const secretValues = new Map<string, string>();
  let now = Date.parse("2026-11-10T15:00:00Z");
  const service = new InternetService({
    store,
    history: new HistoryStore(dir),
    config: () => cfg,
    devices: () => devices,
    adguard: () => fake.ag,
    hasPin: (p) => p === "alex",
    now: () => now,
    fetch: fake.respond,
    secrets: {
      get: (n: string) => secretValues.get(n),
      set: async (n: string, v: string | null) => {
        if (v === null) secretValues.delete(n);
        else secretValues.set(n, v);
      },
      has: (n: string) => secretValues.has(n),
    },
  });
  return { service, store, fake, devices, tick: (ms: number) => (now += ms), at: () => now };
}

describe("the Family page", () => {
  it("is for the admin and the parents they chose, each with a PIN", async () => {
    const { service } = await setup();
    const alex = ProfileSchema.parse({ id: "alex", name: "Alex", role: "adult" });
    const ava = ProfileSchema.parse({ id: "ava", name: "Ava", role: "child" });
    expect(service.isParent({ admin: true, profile: null })).toBe(true);
    expect(service.isParent({ admin: false, profile: alex })).toBe(false);
    await service.setOptions({ parents: ["alex"] });
    expect(service.isParent({ admin: false, profile: alex })).toBe(true);
    // A parent without a PIN (anyone could pick their face) isn't.
    expect(service.isParent({ admin: false, profile: { ...alex, id: "sam" } })).toBe(false);
    await expect(service.setOptions({ parents: ["ava"] })).rejects.toThrow(/adult/);
    expect(service.isParent({ admin: false, profile: ava })).toBe(false);
    // Rules are for children.
    await expect(
      service.setPerson("alex", {
        mode: "paused",
        usePage: true,
        extra: [],
        essentials: "basic",
        schedule: [],
      }),
    ).rejects.toThrow(/children/);
  });

  it("shows what's next, today's activity by hour and device, and what needs a look", async () => {
    const { service, fake, at } = await setup();
    await service.setPerson("ava", {
      mode: "sites",
      usePage: true,
      extra: [],
      essentials: "basic",
      // 15:00 UTC now; bedtime at 21:00.
      schedule: [
        {
          id: "bed",
          name: "Bedtime",
          days: [0, 1, 2, 3, 4, 5, 6],
          from: "21:00",
          to: "07:00",
          mode: "paused",
        },
      ],
    });
    const t = (s: number) => new Date(at() + s * 1000).toISOString();
    fake.state.log.push(
      { client: "192.168.1.41", time: t(1), question: { name: "pbskids.org" } },
      {
        client: "192.168.1.41",
        time: t(2),
        question: { name: "roblox.com" },
        reason: "FilteredBlackList",
      },
      {
        client: "192.168.1.41",
        time: t(3),
        question: { name: "games.example.com" },
        reason: "FilteredBlackList",
      },
    );
    await service.collect();
    const fam = await service.family(false);
    const ava = fam.children[0];
    expect(ava?.next).toMatchObject({
      mode: "paused",
      schedule: "Bedtime",
      at: "2026-11-10T21:00:00.000Z",
    });
    expect(ava?.today).toMatchObject({ sites: 1, blocked: 2, top: ["pbskids.org"] });
    expect(ava?.today.hours[15]).toBe(3);
    expect(ava?.devices[0]?.lastActive).toBe(t(3));
    expect(fam.attention.map((r) => r.site).sort()).toEqual(["example.com", "roblox.com"]);

    await service.dismiss("ava", "roblox.com");
    expect((await service.family(false)).attention.map((r) => r.site)).toEqual(["example.com"]);
    const child = await service.childView("ava");
    expect(child.blocked.find((b) => b.site === "roblox.com")?.dismissed).toBeTruthy();
    expect(child.sites.find((s) => s.site === "pbskids.org")?.per).toEqual({ "avas-ipad": 1 });
    expect((await service.childView("ava", undefined, "someone-else")).sites).toEqual([]);
    await expect(service.childView("alex")).rejects.toThrow(/children/);
  });

  it("reads back a device's past once, when it becomes a child's", async () => {
    const { service, fake, at, devices } = await setup();
    const t = (s: number) => new Date(at() + s * 1000).toISOString();
    // A new tablet, not Ava's yet: its lookups aren't kept.
    devices.devices.push(
      DeviceSchema.parse({
        id: "new-tablet",
        name: "New tablet",
        treatment: "always",
        ips: ["192.168.1.44"],
      }),
    );
    fake.state.log.push(
      { client: "192.168.1.44", time: t(-600), question: { name: "coolmathgames.com" } },
      { client: "192.168.1.4", time: t(-500), question: { name: "not-this-one.com" } },
    );
    await service.collect();
    expect(await service.historyOf("ava", "2026-11-10")).toEqual([]);
    // Now it's hers: its earlier lookups come in, by its exact address only, and only once.
    Object.assign(devices.devices[3] as object, { treatment: "person", person: "ava" });
    fake.state.log.push({ client: "192.168.1.44", time: t(5), question: { name: "pbskids.org" } });
    await service.collect();
    const sites = (await service.historyOf("ava", "2026-11-10")).map((s) => s.site).sort();
    expect(sites).toEqual(["coolmathgames.com", "pbskids.org"]);
    await service.collect();
    expect(
      (await service.historyOf("ava", "2026-11-10")).find((s) => s.site === "coolmathgames.com")?.n,
    ).toBe(1);
  });
});

describe("the guest pass", () => {
  const NET = ["192.168.1.0/24"];

  it("lets in what's already here when it opens, and stops anything new", async () => {
    const { service, fake } = await setup();
    // A printer AdGuard Home knows, and a laptop that's been looking things up.
    fake.state.auto.push({ ip: "192.168.1.50", name: "printer" });
    fake.state.log.push({
      client: "192.168.1.77",
      time: "2026-11-10T14:59:00.000Z",
      question: { name: "a.com" },
    });
    // Not without a network, nor without AdGuard Home.
    await expect(service.setDoor({ enabled: true }, {})).rejects.toThrow(/which network/);
    const r = await service.setDoor({ enabled: true, networks: NET }, { ip: "192.168.1.90" });
    expect(r.letIn).toBe(3);
    expect(
      service
        .doorView()
        .admitted.map((a) => [a.ip, a.by])
        .sort(),
    ).toEqual([
      ["192.168.1.50", "start"],
      ["192.168.1.77", "start"],
      ["192.168.1.90", "admin"],
    ]);
    const rules = fake.state.rules.join("\n");
    expect(rules).toMatch(
      /\|\|\*\^\$client=192\.168\.1\.0\/24\|~192\.168\.1\.41\|.*~192\.168\.1\.90.*,important/,
    );
    expect(rules).toContain("@@||home^$client=192.168.1.0/24,important");
    // No captive rewrites without Hearth's address.
    expect(rules).not.toContain("dnsrewrite");
    expect(service.stopped("192.168.1.123")).toBe(true);
    expect(service.stopped("192.168.1.41")).toBe(false);
    // Another network (the guest Wi-Fi): not the door's business.
    expect(service.stopped("192.168.2.5")).toBe(false);
    expect(service.captive("192.168.1.123")).toEqual({ redirect: "http://start.home/welcome" });
    expect(service.captive("192.168.1.41")).toEqual({});

    await service.setDoor({ welcomeAddress: "192.168.1.20" }, {});
    expect(fake.state.rules.join("\n")).toContain(
      "||captive.apple.com^$dnsrewrite=NOERROR;A;192.168.1.20,client=192.168.1.0/24|~",
    );
    // Off: no door lines, nobody stopped.
    await service.setDoor({ enabled: false }, {});
    expect(fake.state.rules.join("\n")).not.toContain("Guest pass");
    expect(service.stopped("192.168.1.123")).toBe(false);
  });

  it("lets a device in with the house password, slowly after wrong ones", async () => {
    const { service } = await setup();
    await service.setDoor(
      { enabled: true, networks: NET, stayDays: 7, password: "open sesame" },
      {},
    );
    expect(service.doorHere("192.168.1.123")).toMatchObject({
      guarded: true,
      inside: false,
      passwordSet: true,
    });
    for (let i = 0; i < 5; i++)
      await expect(service.enter("192.168.1.123", "nope")).rejects.toThrow(
        /isn't the house password/,
      );
    await expect(service.enter("192.168.1.123", "open sesame")).rejects.toThrow(/Too many tries/);
    // Another device isn't slowed down by this one's mistakes.
    await service.enter("192.168.1.124", "open sesame");
    expect(service.doorHere("192.168.1.124")).toMatchObject({
      inside: true,
      admitted: { by: "password", until: expect.any(String) },
    });
    await expect(service.setDoor({ password: "abc" }, {})).rejects.toThrow(/at least 4/);
  });

  it("tells the parents about a new device and lets a parent let it in", async () => {
    const { service, fake, at } = await setup();
    await service.setDoor({ enabled: true, networks: NET }, {});
    await service.setOptions({ notify: { url: "https://ntfy.example/kids", blocked: false } });
    const t = (s: number) => new Date(at() + s * 1000).toISOString();
    fake.state.log.push(
      {
        client: "192.168.1.123",
        time: t(1),
        question: { name: "x.com" },
        client_info: { name: "Grandpas-Tablet" },
        reason: "FilteredBlackList",
      },
      {
        client: "192.168.1.123",
        time: t(2),
        question: { name: "y.com" },
        reason: "FilteredBlackList",
      },
    );
    await service.collect();
    expect(fake.state.alerts.at(-1)?.body).toMatch(/"Grandpas-Tablet" \(192\.168\.1\.123\) joined/);
    expect((await service.family(false)).visitors).toMatchObject([
      { ip: "192.168.1.123", stopped: 2 },
    ]);
    await service.askIn("192.168.1.123", "Grandpa's tablet");
    expect(fake.state.alerts.at(-1)?.body).toMatch(
      /"Grandpa's tablet" \(192\.168\.1\.123\) is asking/,
    );
    await service.admit("192.168.1.123", "alex");
    expect(service.doorView().admitted.find((a) => a.ip === "192.168.1.123")).toMatchObject({
      by: "alex",
      name: "Grandpa's tablet",
    });
    expect((await service.family(false)).visitors).toEqual([]);
    await expect(service.askIn("192.168.1.123")).rejects.toThrow(/isn't waiting for a guest pass/);
  });
});

describe("safety, asking and alerts", () => {
  it("keeps one AdGuard Home client per child, with SafeSearch and blocked services", async () => {
    const { service, fake } = await setup();
    await service.setPerson("ava", { mode: "open", services: ["tiktok", "roblox"] });
    // Off: no clients.
    expect(fake.state.clients.map((c) => c.name)).toEqual(["Grandma's laptop"]);
    await service.setOptions({ enabled: true });
    const ava = fake.state.clients.find((c) => c.name === "Hearth: Ava");
    expect(ava).toMatchObject({
      ids: ["192.168.1.41"],
      use_global_settings: false,
      parental_enabled: true,
      safe_search: { enabled: true, google: true, youtube: true },
      use_global_blocked_services: false,
      blocked_services: ["roblox", "tiktok"],
    });
    await service.setPerson("ava", { mode: "open", safeSearch: false, services: [] });
    expect(fake.state.clients.find((c) => c.name === "Hearth: Ava")).toMatchObject({
      safe_search: { enabled: false },
      blocked_services: [],
    });
    // An unlocked device is a grown-up's for now: out of the client.
    await service.unlock("avas-ipad", 60, "alex");
    expect(fake.state.clients.map((c) => c.name)).toEqual(["Grandma's laptop"]);
    await service.lock("avas-ipad");
    await service.setOptions({ enabled: false });
    expect(fake.state.clients.map((c) => c.name)).toEqual(["Grandma's laptop"]);
  });

  it("says plainly when a child's address already belongs to someone's client", async () => {
    const { service, fake } = await setup();
    fake.state.clients[0]?.ids.push("192.168.1.41");
    await service.setPerson("ava", { mode: "open" });
    await service.setOptions({ enabled: true });
    expect(service.view().clientsError).toMatch(/already belong to a client/);
  });

  it("lets a child ask for more time or a site, and a parent answer", async () => {
    const { service, fake, store } = await setup();
    const ipad = { browser: "b-ipad" };
    await service.setPerson("ava", { mode: "sites" });
    // Not limited yet: nothing to ask for.
    await expect(service.ask(ipad, { kind: "time", minutes: 30 })).rejects.toThrow(/isn't limited/);
    await service.setOptions({
      enabled: true,
      notify: { url: "https://ntfy.example/kids", blocked: false },
    });

    const time = await service.ask(ipad, { kind: "time", minutes: 30, note: "homework" });
    expect(fake.state.alerts.at(-1)).toMatchObject({
      url: "https://ntfy.example/kids",
      title: "Ava is asking",
      body: expect.stringMatching(/30 more minutes on Ava's iPad: "homework"/),
    });
    // Asking again replaces the one waiting.
    const again = await service.ask(ipad, { kind: "time", minutes: 60 });
    expect(service.pending().map((r) => r.id)).toEqual([again.id]);
    expect(service.pending()).not.toContainEqual(expect.objectContaining({ id: time.id }));
    const site = await service.ask(ipad, { kind: "site", site: "https://www.roblox.com/games" });
    expect(site.site).toBe("roblox.com");
    expect((await service.family(false)).requests).toHaveLength(2);

    await service.answer(again.id, true, "alex", 45);
    expect(service.here(ipad).unlocked).toMatchObject({ by: "alex" });
    expect(store.get().requests.find((r) => r.id === again.id)).toMatchObject({
      status: "approved",
      by: "alex",
      minutes: 45,
    });
    // The device shows its latest request: the site, still waiting.
    expect(service.here(ipad).request).toMatchObject({ kind: "site", status: "pending" });
    await expect(service.answer(again.id, false, "alex")).rejects.toThrow(/already/);
    await service.answer(site.id, true, "alex");
    expect(service.rulesOf("ava").extra).toContain("roblox.com");
    expect(service.pending()).toEqual([]);

    // Too much asking is turned away.
    for (let i = 0; i < 3; i++) await service.ask(ipad, { kind: "site", site: `site${i}.com` });
    await expect(service.ask(ipad, { kind: "site", site: "more.com" })).rejects.toThrow(/a lot/);
  });

  it("alerts once a day about a new blocked site, when asked to", async () => {
    const { service, fake, at } = await setup();
    await service.setPerson("ava", { mode: "sites" });
    await service.setOptions({ notify: { url: "https://ntfy.example/kids", blocked: true } });
    const t = (s: number) => new Date(at() + s * 1000).toISOString();
    const blocked = (s: number, name: string) => ({
      client: "192.168.1.41",
      time: t(s),
      question: { name },
      reason: "FilteredBlackList",
    });
    fake.state.log.push(
      blocked(1, "roblox.com"),
      blocked(2, "www.roblox.com"),
      blocked(3, "pbskids.org"),
    );
    await service.collect();
    fake.state.log.push(blocked(10, "roblox.com"));
    await service.collect();
    // Once for roblox.com; pbskids.org is allowed, so not news.
    expect(fake.state.alerts.map((a) => a.body)).toEqual([
      "Ava tried roblox.com. Allow or dismiss it on the Family page.",
    ]);
  });
});

describe("the internet controls", () => {
  it("write nothing until they're turned on, then only their own lines", async () => {
    const { service, fake } = await setup();
    await service.setPerson("ava", {
      mode: "sites",
      usePage: true,
      extra: [],
      essentials: "basic",
      schedule: [],
    });
    expect(fake.state.writes).toBe(0);
    await service.setOptions({ enabled: true });
    expect(fake.state.rules[0]).toBe("||ads.example^");
    expect(fake.state.rules).toContain(FENCE_START);
    expect(fake.state.rules).toContain("||*^$client=192.168.1.41,important");
    expect(fake.state.rules).toContain("@@||pbskids.org^$client=192.168.1.41,important");
    // Alex is open: none of his devices are in it.
    expect(fake.state.rules.join("\n")).not.toContain("192.168.1.40");
    // Nothing changed: nothing written again.
    const writes = fake.state.writes;
    await service.tick();
    expect(fake.state.writes).toBe(writes);
    await service.setOptions({ enabled: false });
    expect(fake.state.rules).toEqual(["||ads.example^"]);
  });

  it("pauses, unlocks a device for a while, and puts it back by itself", async () => {
    const { service, fake, tick } = await setup();
    await service.setPerson("ava", {
      mode: "sites",
      usePage: true,
      extra: [],
      essentials: "basic",
      schedule: [],
    });
    await service.setOptions({ enabled: true });
    await service.pause("ava", 30, "admin");
    expect(fake.state.rules.join("\n")).not.toContain("@@||pbskids.org");
    expect((await service.family(true)).children[0]?.now.because).toBe("pause");
    // Its end is the next change.
    expect((await service.family(true)).children[0]?.next).toMatchObject({ mode: "sites" });
    tick(31 * 60_000);
    await service.tick();
    expect(fake.state.rules.join("\n")).toContain("@@||pbskids.org");

    await service.unlock("avas-ipad", 60, "alex");
    expect(fake.state.rules.join("\n")).not.toContain("192.168.1.41");
    expect(service.here({ browser: "b-ipad" })).toMatchObject({
      ruled: true,
      device: "avas-ipad",
      unlocked: { by: "alex" },
      grownUps: [{ id: "alex" }],
    });
    tick(61 * 60_000);
    await service.tick();
    expect(fake.state.rules).toContain("||*^$client=192.168.1.41,important");
    expect(service.here({ ip: "192.168.1.41" }).unlocked).toBeUndefined();
    // Not a child's device: nothing to unlock.
    expect(service.here({ ip: "192.168.1.30" }).ruled).toBe(false);
  });

  it("keeps a child's history by day, with what was blocked and what it was for", async () => {
    const { service, fake, at } = await setup();
    await service.setPerson("ava", {
      mode: "sites",
      usePage: true,
      extra: [],
      essentials: "basic",
      schedule: [],
    });
    const t = (s: number) => new Date(at() + s * 1000).toISOString();
    fake.state.log.push(
      {
        client: "192.168.1.41",
        time: t(1),
        question: { name: "pbskids.org" },
        reason: "NotFilteredWhiteList",
      },
      {
        client: "192.168.1.41",
        time: t(2),
        question: { name: "cdn.pbskids-media.com" },
        reason: "FilteredBlackList",
      },
      {
        client: "192.168.1.41",
        time: t(3),
        question: { name: "www.pbskids.org" },
        reason: "NotFilteredWhiteList",
      },
      { client: "192.168.1.41", time: t(4), question: { name: "captive.apple.com" } },
      {
        client: "192.168.1.41",
        time: t(5),
        question: { name: "41.1.168.192.in-addr.arpa", type: "PTR" },
      },
      // An adult's lookups are never kept.
      { client: "192.168.1.40", time: t(6), question: { name: "news.example.com" } },
    );
    expect(await service.collect()).toBe(3);
    const day = await service.historyOf("ava", "2026-11-10");
    expect(day.map((v) => v.site)).toEqual(["pbskids.org", "pbskids-media.com"]);
    expect(day[0]).toMatchObject({ n: 2, blocked: 0, devices: ["avas-ipad"] });
    expect(day[1]).toMatchObject({ n: 1, blocked: 1, after: "pbskids.org" });
    // Read once only; then only what's new.
    expect(await service.collect()).toBe(0);
    fake.state.log.push({ client: "192.168.1.41", time: t(60), question: { name: "pbskids.org" } });
    expect(await service.collect()).toBe(1);
    expect((await service.historyOf("ava", "2026-11-10"))[0]?.n).toBe(3);

    expect((await service.blockedLately("ava")).map((v) => v.site)).toEqual(["pbskids-media.com"]);
    await service.allow("ava", "cdn.pbskids-media.com");
    expect(service.rulesOf("ava").extra).toEqual(["pbskids-media.com"]);
    expect(await service.blockedLately("ava")).toEqual([]);
  });

  it("asks AdGuard Home what it would do with a site for a child's device", async () => {
    const { service } = await setup();
    expect(await service.check("ava", "pbskids.org")).toMatchObject({
      device: "Ava's iPad",
      blocked: false,
    });
    expect(await service.check("ava", "example.com")).toMatchObject({
      blocked: true,
      rule: "||*^",
    });
  });

  it("follows a renamed person and forgets one who left", async () => {
    const { service } = await setup();
    await service.setPerson("ava", {
      mode: "paused",
      usePage: true,
      extra: [],
      essentials: "basic",
      schedule: [],
    });
    await service.renamePerson("ava", "ava-m");
    expect(service.rulesOf("ava-m").mode).toBe("paused");
    await service.forget("ava-m");
    expect(service.rulesOf("ava-m").mode).toBe("open");
  });
});

describe("a device several people share", () => {
  it("follows the strictest rules of the children who use it, in its own group and client", async () => {
    const { service, devices } = await setup();
    const cfg = (
      service as unknown as { deps: { config: () => ReturnType<typeof fixture> } }
    ).deps.config();
    cfg.profiles.push(ProfileSchema.parse({ id: "sam", name: "Sam", role: "child" }));
    devices.devices.push(
      DeviceSchema.parse({
        id: "school-pc",
        name: "School PC",
        treatment: "shared",
        people: ["ava", "sam", "alex"],
        ips: ["192.168.1.60"],
      }),
    );
    await service.setOptions({ enabled: true });
    // No rules for either child: nothing to hold it to.
    expect(service.desired().some((g) => g.clients.includes("192.168.1.60"))).toBe(false);

    await service.setPerson("ava", {
      mode: "sites",
      usePage: false,
      extra: ["khanacademy.org", "pbskids.org"],
    });
    await service.setPerson("sam", {
      mode: "sites",
      usePage: false,
      extra: ["pbskids.org", "minecraft.net"],
      services: ["tiktok"],
    });
    let shared = service.desired().find((g) => g.clients.includes("192.168.1.60"));
    // Only the sites both may use, and it's in no child's own group.
    expect(shared).toMatchObject({ mode: "sites" });
    expect(shared?.sites).toContain("pbskids.org");
    expect(shared?.sites).not.toContain("khanacademy.org");
    expect(shared?.sites).not.toContain("minecraft.net");
    expect(service.desired().filter((g) => g.clients.includes("192.168.1.60"))).toHaveLength(1);
    const client = service.desiredClients().find((c) => c.ids.includes("192.168.1.60"));
    expect(client).toMatchObject({
      name: "Hearth: School PC (shared)",
      blocked_services: ["tiktok"],
    });

    // One of them paused: paused.
    await service.setPerson("sam", { mode: "paused" });
    shared = service.desired().find((g) => g.clients.includes("192.168.1.60"));
    expect(shared?.mode).toBe("paused");
  });
});
