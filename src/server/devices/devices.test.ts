import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProfileSchema, SettingsSchema } from "../../shared/config";
import { DeviceSchema, type Identity } from "../../shared/devices";
import { SecretStore } from "../secrets";
import { ADGUARD_SECRET, agentName, DeviceService } from "./service";
import { DeviceStore } from "./store";

const people = [
  ProfileSchema.parse({ id: "alex", name: "Alex", role: "admin" }),
  ProfileSchema.parse({ id: "ava", name: "Ava", role: "child" }),
];
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1";

/** A small AdGuard Home: two devices it found itself, one it was told about, a few lookups. */
function adguard(opts: { password?: string } = {}) {
  const calls: { url: string; auth: string | null }[] = [];
  const fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get("authorization");
    calls.push({ url: url.href, auth });
    if (
      opts.password &&
      auth !== `Basic ${Buffer.from(`admin:${opts.password}`).toString("base64")}`
    )
      return new Response("", { status: 401 });
    if (url.pathname === "/control/status")
      return Response.json({ version: "v0.107.60", running: true, protection_enabled: true });
    if (url.pathname === "/control/clients")
      return Response.json({
        clients: [{ name: "Living room TV", ids: ["192.168.1.30", "aa:bb:cc:dd:ee:30"], tags: [] }],
        auto_clients: [
          { ip: "192.168.1.41", name: "Avas-iPad", source: "DHCP" },
          { ip: "192.168.1.50", name: "printer", source: "ARP" },
          { ip: "169.254.12.34", source: "ARP" },
        ],
      });
    if (url.pathname === "/control/querylog")
      return Response.json({
        data: [
          {
            client: "192.168.1.41",
            time: "2026-11-10T19:05:00Z",
            question: { name: "gateway.icloud.com" },
          },
          {
            client: "192.168.1.30",
            time: "2026-11-10T18:30:00Z",
            question: { name: "api.netflix.com" },
          },
          { client: "192.168.1.30", time: "2026-11-10T18:00:00Z" },
          { client: "192.168.1.41", time: "2026-11-10T17:00:00Z" },
        ],
      });
    return new Response("", { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

async function setup(
  withAdGuard = true,
  password?: string,
  identify?: (ip: string) => Promise<Identity | null>,
) {
  const dir = await mkdtemp(join(tmpdir(), "hearth-dev-"));
  const store = new DeviceStore(dir);
  const secrets = new SecretStore(dir, randomBytes(32));
  if (password) await secrets.set(ADGUARD_SECRET, password);
  const settings = SettingsSchema.parse({
    adguard: withAdGuard
      ? { url: "http://192.168.1.1:3000", username: password ? "admin" : undefined }
      : {},
  });
  const ag = adguard({ password });
  let now = Date.parse("2026-11-10T20:00:00Z");
  const service = new DeviceService({
    store,
    secrets,
    settings: () => settings,
    profiles: () => people,
    fetch: ag.fetch,
    now: () => now,
    identify,
  });
  return { service, store, ag, tick: (ms: number) => (now += ms) };
}

describe("the devices on the network", () => {
  it("lists what AdGuard Home and Hearth have seen, most recent first, and which one is here", async () => {
    const { service } = await setup();
    await service.see({ browser: "b1", ip: "192.168.1.41", profile: "ava", agent: IPHONE });
    const v = await service.view({ ip: "192.168.1.41", browser: "b1" });
    expect(v.adguard).toMatchObject({
      configured: true,
      ok: true,
      version: "v0.107.60",
      protection: true,
    });
    expect(v.devices.map((d) => [d.key, d.networkName, d.here])).toEqual([
      ["seen:192.168.1.41", "Avas-iPad", true],
      ["seen:192.168.1.30", "Living room TV", false],
      ["seen:192.168.1.50", "printer", false],
    ]);
    expect(v.devices[0]).toMatchObject({
      profiles: ["ava"],
      agent: "iPhone · Safari",
      lastSeen: "2026-11-10T20:00:00.000Z",
    });
    expect(v.devices[1]?.macs).toEqual(["aa:bb:cc:dd:ee:30"]);
    // Clues, and no row for a "no address assigned" placeholder.
    expect(v.devices[0]).toMatchObject({
      lookups: ["icloud.com"],
      maker: expect.stringMatching(/Apple/),
    });
    expect(v.devices[1]?.maker).toMatch(/Netflix/);
    expect(v.devices.some((d) => d.ips.includes("169.254.12.34"))).toBe(false);
  });

  it("saves a device, which then follows its browser to a new address", async () => {
    const { service, store, tick } = await setup();
    await service.see({ browser: "b1", ip: "192.168.1.41", profile: "ava" });
    const id = await service.save("seen:192.168.1.41", {
      name: "Ava's iPad",
      type: "tablet",
      treatment: "person",
      person: "ava",
      ips: ["192.168.1.41"],
      macs: ["3C-22-FB-12-34-56"],
    });
    expect(id).toBe("ava-s-ipad");
    expect(store.get().devices[0]).toMatchObject({ macs: ["3c:22:fb:12:34:56"], browsers: ["b1"] });
    // The iPad gets a new address; it opens Hearth, and is still Ava's iPad.
    tick(60_000);
    await service.see({ browser: "b1", ip: "192.168.1.77", profile: "ava" });
    expect(store.get().devices[0]?.ips).toEqual(["192.168.1.77", "192.168.1.41"]);
    const v = await service.view({ ip: "192.168.1.77", browser: "b1" });
    expect(v.devices[0]).toMatchObject({ key: "ava-s-ipad", saved: true, here: true });
    // An address belongs to one device at a time.
    await expect(
      service.save("seen:192.168.1.30", {
        name: "TV",
        type: "tv",
        treatment: "always",
        ips: ["192.168.1.77"],
        macs: [],
      }),
    ).rejects.toThrow(/already has that address/);
  });

  it("writes a browser's sighting again only when it changes, or now and then", async () => {
    const { service, store, tick } = await setup(false);
    await service.see({ browser: "b1", ip: "192.168.1.5" });
    const first = store.get().seen[0]?.at;
    tick(60_000);
    await service.see({ browser: "b1", ip: "192.168.1.5" });
    expect(store.get().seen[0]?.at).toBe(first);
    await service.see({ browser: "b1", ip: "192.168.1.5", profile: "alex" });
    expect(store.get().seen[0]?.profile).toBe("alex");
  });

  it("signs in to AdGuard Home with its password, and says plainly when it's wrong", async () => {
    const { service, ag } = await setup(true, "s3cret");
    const v = await service.view({});
    expect(v.adguard.ok).toBe(true);
    expect(ag.calls[0]?.auth).toBe(`Basic ${Buffer.from("admin:s3cret").toString("base64")}`);
    const bad = await setup(true, "s3cret");
    // Wrong password: what's saved in Hearth still shows; AdGuard Home's part says why not.
    const v2 = await new DeviceService({
      store: bad.store,
      secrets: new SecretStore(await mkdtemp(join(tmpdir(), "h-")), randomBytes(32)),
      settings: () =>
        SettingsSchema.parse({ adguard: { url: "http://192.168.1.1:3000", username: "admin" } }),
      profiles: () => people,
      fetch: bad.ag.fetch,
    }).view({});
    expect(v2.adguard).toMatchObject({ ok: false, error: expect.stringMatching(/didn't accept/) });
  });

  it("asks devices what they are, keeps their answers, and doesn't keep asking", async () => {
    const asked: string[] = [];
    const answers: Record<string, Identity> = {
      "192.168.1.30": {
        name: "Living Room display",
        model: "Google Nest Hub",
        maker: "Google",
        via: "Google Cast",
      },
      "192.168.1.50": { name: "Nanit_N301ABC12345XY_0615S", via: "Bonjour" },
    };
    const { service, store, tick } = await setup(true, undefined, async (ip) => {
      asked.push(ip);
      return answers[ip] ?? null;
    });
    const first = await service.view({});
    expect(first.asking).toBe(true);
    await service.settled();
    // Only private IPv4 addresses are asked; never "no address" placeholders.
    expect(asked.sort()).toEqual(["192.168.1.30", "192.168.1.41", "192.168.1.50"]);
    const v = await service.view({});
    expect(v.asking).toBe(false);
    const hub = v.devices.find((d) => d.ips.includes("192.168.1.30"));
    expect(hub?.identity?.name).toBe("Living Room display");
    expect(hub?.maker).toBe("Google Nest Hub");
    expect(hub?.suggest).toEqual({ name: "Living Room display", type: "speaker" });
    const cam = v.devices.find((d) => d.ips.includes("192.168.1.50"));
    expect(cam?.suggest).toEqual({ name: "Nanit", type: "camera" });
    expect(cam?.maker).toMatch(/Nanit baby camera/);
    expect(store.get().asked["192.168.1.41"]?.identity).toBeUndefined();

    // Asked again only later: a few hours for one that didn't answer, a month for one that did.
    asked.length = 0;
    await service.view({});
    await service.settled();
    expect(asked).toEqual([]);
    tick(7 * 3600_000);
    await service.view({});
    await service.settled();
    expect(asked).toEqual(["192.168.1.41"]);
    // Unless the admin asks for it.
    asked.length = 0;
    expect(service.ask(["192.168.1.30", "8.8.8.8", "fd00::1"], true)).toBe(true);
    await service.settled();
    expect(asked).toEqual(["192.168.1.30"]);
  });

  it("asks nothing when it isn't given a way to", async () => {
    const { service } = await setup();
    expect((await service.view({})).asking).toBe(false);
  });

  it("saves new devices as always allowed by themselves, when the admin says so", async () => {
    const { service, store } = await setup();
    // By default they wait for the admin.
    expect((await service.view({})).devices.every((d) => !d.saved)).toBe(true);

    // A whole network (an IoT Wi-Fi): everything on it.
    await service.setRules({ newDevices: "leave", alwaysNetworks: ["192.168.1.48/29"] });
    const v = await service.view({});
    expect(v.networks).toEqual(["192.168.1.0/24"]);
    expect(store.get().devices).toEqual([
      expect.objectContaining({
        name: "Printer",
        type: "printer",
        treatment: "always",
        ips: ["192.168.1.50"],
        auto: true,
      }),
    ]);
    expect(v.devices.find((d) => d.ips.includes("192.168.1.50"))?.saved).toBe(true);

    // Every new device, except one someone's opened Hearth on: that's a person's, for the admin.
    await service.see({ browser: "b1", ip: "192.168.1.41", profile: "ava", agent: IPHONE });
    await service.setRules({ newDevices: "always", alwaysNetworks: [] });
    await service.view({});
    expect(
      store
        .get()
        .devices.map((d) => d.name)
        .sort(),
    ).toEqual(["Living room TV", "Printer"]);
    expect(store.get().devices.find((d) => d.name === "Living room TV")?.type).toBe("tv");
  });

  it("names browsers in plain words", () => {
    expect(agentName(IPHONE)).toBe("iPhone · Safari");
    expect(
      agentName(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36 Edg/150",
      ),
    ).toBe("Windows · Edge");
    expect(agentName(undefined)).toBeUndefined();
  });
});

describe("devices that aren't on the network, and the home's certificate", () => {
  it("leaves out a device known only by this machine's own address, and keeps a browser's trust", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hearth-devices-"));
    const store = new DeviceStore(dir);
    const service = new DeviceService({
      store,
      secrets: new SecretStore(dir, randomBytes(32)),
      settings: () => SettingsSchema.parse({}),
      profiles: () => people,
    });
    await store.update((f) => {
      f.devices.push(
        {
          id: "localhost",
          name: "localhost",
          type: "desktop",
          treatment: "person",
          person: "alex",
          ips: ["127.0.0.1"],
          macs: [],
          browsers: [],
          people: [],
        },
        {
          id: "tablet",
          name: "Ava's iPad",
          type: "tablet",
          treatment: "person",
          person: "ava",
          ips: ["192.168.1.41"],
          macs: [],
          browsers: [],
          people: [],
        },
      );
    });
    let v = await service.view({ ip: "192.168.1.41" }, { ask: false });
    expect(v.devices.map((r) => r.key)).toEqual(["tablet"]);
    // Seen from this very machine (the dev server), it's still there.
    v = await service.view({ ip: "127.0.0.1" }, { ask: false });
    expect(v.devices.map((r) => r.key).sort()).toEqual(["localhost", "tablet"]);

    await service.see({ browser: "b1", ip: "192.168.1.41", agent: IPHONE });
    await service.sawTrust({ browser: "b1", ip: "192.168.1.41" }, false);
    v = await service.view({}, { ask: false });
    expect(v.devices.find((r) => r.key === "tablet")?.trust?.ok).toBe(false);
    await service.sawTrust({ browser: "b1", ip: "192.168.1.41" }, true);
    v = await service.view({}, { ask: false });
    expect(v.devices.find((r) => r.key === "tablet")?.trust?.ok).toBe(true);
    // Seen again under another profile: what its browser found out stays.
    await service.see({ browser: "b1", ip: "192.168.1.41", agent: IPHONE, profile: "sam" });
    v = await service.view({}, { ask: false });
    expect(v.devices.find((r) => r.key === "tablet")?.trust?.ok).toBe(true);
  });
});

describe("one device on two addresses, and kinds of device the admin makes", () => {
  async function make() {
    const dir = await mkdtemp(join(tmpdir(), "hearth-devices-"));
    const store = new DeviceStore(dir);
    const service = new DeviceService({
      store,
      secrets: new SecretStore(dir, randomBytes(32)),
      settings: () => SettingsSchema.parse({ adguard: { url: "http://192.168.1.1:3000" } }),
      profiles: () => people,
      fetch: adguard().fetch,
    });
    return { service, store };
  }

  it("merges two rows into the saved one, with both addresses", async () => {
    const { service, store } = await make();
    // The printer, saved by its first address; the network calls a second address the same.
    await store.update((f) => {
      f.devices.push(
        DeviceSchema.parse({
          id: "pinball",
          name: "Pinball",
          treatment: "always",
          ips: ["192.168.1.30"],
          macs: ["aa:bb:cc:dd:ee:30"],
        }),
      );
    });
    await expect(service.merge("seen:192.168.1.41", "seen:192.168.1.50")).rejects.toThrow(
      "Set one of them up first",
    );
    expect(await service.merge("seen:192.168.1.50", "pinball")).toBe("pinball");
    expect(store.get().devices[0]?.ips).toEqual(["192.168.1.30", "192.168.1.50"]);
  });

  it("makes, uses and forgets the admin's own kinds", async () => {
    const { service, store } = await make();
    const id = await service.saveKind(null, {
      label: "Pinball table",
      icon: "lucide:joystick",
      place: "entertainment",
    });
    expect(id).toBe("c-pinball-table");
    expect(
      await service.saveKind(null, { label: "Pinball table", icon: "🎯", place: "smart" }),
    ).toBe("c-pinball-table-2");
    await service.save("seen:192.168.1.50", {
      name: "Cabinet",
      type: id,
      treatment: "always",
      ips: ["192.168.1.50"],
      macs: [],
    });
    await expect(
      service.save("seen:192.168.1.41", {
        name: "X",
        type: "c-nothing",
        treatment: "always",
        ips: ["192.168.1.41"],
        macs: [],
      }),
    ).rejects.toThrow("no such kind");
    const v = await service.view({}, { ask: false });
    expect(v.kinds[0]).toMatchObject({
      id,
      label: "Pinball table",
      iconKind: "svg",
      place: "entertainment",
    });
    await service.removeKind(id);
    expect(store.get().devices.find((d) => d.name === "Cabinet")?.type).toBe("unknown");
  });

  it("changes, deletes and brings back a built-in kind", async () => {
    const { service, store } = await make();
    await service.save("seen:192.168.1.60", {
      name: "Hall thermostat",
      type: "thermostat",
      treatment: "always",
      ips: ["192.168.1.60"],
      macs: [],
    });
    expect(
      await service.saveKind("thermostat", {
        label: "Heating",
        icon: "lucide:flame",
        place: "network",
      }),
    ).toBe("thermostat");
    expect(store.get().kinds.find((k) => k.id === "thermostat")?.label).toBe("Heating");
    await service.removeKind("thermostat");
    expect(store.get().kinds.find((k) => k.id === "thermostat")?.hidden).toBe(true);
    expect(store.get().devices.find((d) => d.name === "Hall thermostat")?.type).toBe("unknown");
    await service.restoreKind("thermostat");
    expect(store.get().kinds.some((k) => k.id === "thermostat")).toBe(false);
    await expect(service.removeKind("unknown")).rejects.toThrow("stays");
  });

  it('reads an old file\'s "other" as Not sure yet', () => {
    expect(DeviceSchema.parse({ id: "x", name: "X", type: "other" }).type).toBe("unknown");
  });
});
