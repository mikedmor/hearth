import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { AiServerStatus, StatusMap } from "../../shared/api";
import type { HearthConfig } from "../../shared/config";
import type { DevicesView, DeviceView, FoundService } from "../../shared/devices";
import type { AiMonitor } from "../ai/monitor";
import type { SmartHomeService } from "../smarthome/service";
import { fixture } from "../test-fixtures";
import { ALERT_AFTER_MS, DeviceMonitor, type MonitorDeps } from "./monitor";
import { DeviceStore } from "./store";

const NOW = Date.parse("2026-11-10T20:00:00Z");

function row(key: string, ips: string[], more: Partial<DeviceView> = {}): DeviceView {
  return {
    key,
    saved: !key.startsWith("seen:"),
    ips,
    macs: [],
    profiles: [],
    lookups: [],
    suggest: {},
    ipv6Only: false,
    here: false,
    presence: "unknown",
    services: [],
    scanning: false,
    watched: false,
    ...more,
  };
}

function devicesView(rows: DeviceView[]): DevicesView {
  return {
    adguard: { configured: true, ok: true, passwordSaved: false },
    devices: rows,
    asking: false,
    rules: { newDevices: "leave", alwaysNetworks: [] },
    networks: [],
    alerts: false,
    dismissed: [],
    kinds: [],
  };
}

/** The NAS (every .home name), a desktop that lends compute, and a pinball table. */
const ROWS = () => [
  row("nas", ["192.168.1.20"], {
    device: {
      id: "nas",
      name: "NAS",
      type: "server",
      treatment: "always",
      ips: ["192.168.1.20"],
      macs: [],
      browsers: [],
      people: [],
    },
    lastSeen: new Date(NOW - 60_000).toISOString(),
  }),
  row("desk", ["192.168.1.30"], {
    device: {
      id: "desk",
      name: "Desk PC",
      type: "desktop",
      treatment: "always",
      ips: ["192.168.1.30"],
      macs: [],
      browsers: [],
      people: [],
    },
  }),
  row("pinball", ["192.168.1.40"], {
    networkName: "pinball.lan",
    device: {
      id: "pinball",
      name: "Pinball",
      type: "console",
      treatment: "always",
      ips: ["192.168.1.40"],
      macs: [],
      browsers: [],
      people: [],
    },
  }),
];

const MACHINES = {
  machines: [
    {
      id: "m1",
      name: "Desk PC",
      online: true,
      available: true,
      busy: true,
      jobs: 1,
      served: 12,
      avgMs: 2400,
      connectedSecs: 3600,
      version: "0.1.0",
      os: "windows",
      models: ["qwen"],
      loaded: "qwen",
      address: "192.168.1.30",
      canWake: false,
      hardware: {
        cpu: "Ryzen 7",
        cores: 16,
        memoryMib: 32768,
        gpus: [{ name: "RTX 3080", vramMib: 10240 }],
      },
    },
    // A machine on an address Hearth hasn't listed yet.
    { id: "m2", name: "Garage PC", online: true, available: false, address: "192.168.1.77" },
  ],
};

/** The AI server (with its machine list), and VPin Studio on the pinball table. */
function network(opts: { machines?: boolean; vpinUp?: () => boolean; calls?: string[] } = {}) {
  return (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    opts.calls?.push(`${init?.method ?? "GET"} ${url.href}`);
    if (url.host === "192.168.1.20:11434") {
      if (url.pathname === "/api/machines")
        return opts.machines === false
          ? new Response("404 page not found", { status: 404 })
          : Response.json(MACHINES);
      return new Response("", { status: 404 });
    }
    if (url.host === "192.168.1.40:8089") {
      if (opts.vpinUp && !opts.vpinUp()) throw new TypeError("fetch failed");
      const p = url.pathname.replace("/api/v1/", "");
      const answers: Record<string, unknown> = {
        system: { systemName: "PINBALL", version: "4.2.0" },
        "frontend/running": true,
        gamestatus: { gameId: 7, started: "2026-11-10T19:50:00Z" },
        "system/muted": false,
        "games/recent/10": {
          scores: [
            {
              playerInitials: "SAM",
              score: 12345670,
              gameId: 7,
              createdAt: "2026-11-10T19:00:00Z",
            },
            { playerInitials: "ALX", rawScore: "9,000,000", gameId: 3 },
          ],
        },
        "players/ranked": [{ name: "Sam", initials: "SAM", rank: 1, points: 30, first: 2 }],
        games: [
          { id: 3, gameDisplayName: "Attack From Mars" },
          { id: 7, gameDisplayName: "Medieval Madness" },
          { id: 9, gameDisplayName: "Broken", disabled: true },
        ],
        "frontend/launch/3": true,
        "system/mute/1": true,
      };
      if (p in answers) return Response.json(answers[p]);
      return new Response("", { status: 404 });
    }
    // Services found by port checks: DSM's https port doesn't answer.
    if (url.host === "192.168.1.20:8096") return new Response("ok");
    if (url.host === "192.168.1.20:5001") throw new TypeError("fetch failed");
    return new Response("", { status: 404 });
  }) as typeof globalThis.fetch;
}

function fakeAi(fetch: typeof globalThis.fetch): AiMonitor {
  const status: AiServerStatus = {
    id: "home-ai",
    name: "Home AI",
    kind: "ollama",
    state: "up",
    ms: 20,
    models: [{ name: "qwen" }, { name: "llama3.1" }],
    loaded: [{ name: "qwen" }],
    hasKey: true,
  };
  return {
    list: () => [status],
    conn: (server: HearthConfig["settings"]["ai"]["servers"][number]) => ({
      server,
      key: "k",
      fetch,
    }),
  } as unknown as AiMonitor;
}

describe("DeviceMonitor", () => {
  let store: DeviceStore;
  let now: number;
  let told: { title: string; text: string }[];
  let reachUp: Set<string>;
  let asked: string[][];

  beforeEach(async () => {
    store = new DeviceStore(await mkdtemp(join(tmpdir(), "hearth-monitor-")));
    now = NOW;
    told = [];
    reachUp = new Set(["192.168.1.30"]);
    asked = [];
    // The saved devices, as on a real install.
    await store.update((d) => {
      d.devices = ROWS().flatMap((r) => (r.device ? [r.device] : []));
    });
  });

  function make(
    over: Partial<MonitorDeps> & {
      cfg?: HearthConfig;
      rows?: DeviceView[];
      status?: StatusMap;
    } = {},
  ) {
    const cfg =
      over.cfg ??
      fixture({
        tiles: [
          ...(fixture().tiles as unknown[]),
          { id: "router", name: "Router", url: "http://192.168.1.1", group: "everyday" },
          { id: "popper", name: "Pinup Popper", url: "http://pinball.local/", group: "everyday" },
          { id: "ai", name: "AI server", url: "http://192.168.1.20:11434", group: "everyday" },
          { id: "mail", name: "Mail", url: "https://mail.example.com", group: "everyday" },
        ],
      });
    const fetch = over.fetch ?? network();
    const rows = over.rows ?? ROWS();
    return new DeviceMonitor({
      store,
      view: async () => devicesView(structuredClone(rows)),
      config: () => cfg,
      tileStatus: () => over.status ?? { muny: { state: "up", ms: 40 }, router: { state: "down" } },
      ai: fakeAi(fetch),
      fetch,
      now: () => now,
      tell: async (title, text) => {
        told.push({ title, text });
      },
      alertsOn: () => true,
      resolve: async (host) => (host.endsWith(".home") ? ["192.168.1.20"] : ["93.184.215.14"]),
      reach: async (ip) => reachUp.has(ip),
      scan: async () => [],
      ask: (ips) => {
        asked.push(ips);
      },
      ...over,
    });
  }

  const find = (v: DevicesView, key: string) => v.devices.find((d) => d.key === key) as DeviceView;

  it("puts each tile on the device its address leads to", async () => {
    const m = make();
    await m.tick();
    const v = m.latest() as DevicesView;
    const nas = find(v, "nas");
    expect(nas.services.map((s) => s.key)).toEqual(["tile:muny", "tile:gg", "tile:nas", "tile:ai"]);
    expect(nas.services[0]).toMatchObject({ name: "Muny", state: "up", ms: 40, checked: true });
    // A tile at the AI server's address says what it's doing.
    expect(nas.services[3]?.detail).toBe("2 models · qwen loaded");
    // A tile whose status dot is off is still checked here.
    expect(find(v, "seen:192.168.1.50").services[0]).toMatchObject({
      name: "Printer",
      checked: true,
      state: "up",
    });
    // A device only a tile revealed is named after it, and asked what it is.
    expect(find(v, "seen:192.168.1.1").suggest.name).toBe("Router");
    expect(asked.flat()).toEqual(expect.arrayContaining(["192.168.1.1", "192.168.1.50"]));
    // A .local name is the device the network calls by that name.
    expect(find(v, "pinball").services.map((s) => s.key)).toEqual(["tile:popper"]);
    // The router isn't listed, so it shows up, with its tile.
    expect(find(v, "seen:192.168.1.1").services[0]).toMatchObject({
      name: "Router",
      state: "down",
    });
    // Sites on the internet aren't anyone's device.
    expect(v.devices.flatMap((d) => d.services).some((s) => s.key === "tile:mail")).toBe(false);
  });

  it("shows the AI server's computers on the devices they connect from", async () => {
    const m = make();
    await m.tick();
    const v = m.latest() as DevicesView;
    expect(find(v, "desk").machine).toMatchObject({
      name: "Desk PC",
      server: "Home AI",
      busy: true,
      loaded: "qwen",
      hardware: { cpu: "Ryzen 7", memoryMib: 32768, gpus: [{ name: "RTX 3080", vramMib: 10240 }] },
    });
    // One on an address that isn't listed yet gets a row of its own.
    expect(find(v, "seen:192.168.1.77").machine?.name).toBe("Garage PC");
  });

  it("asks a plain Ollama server for no computers, and doesn't count that as a problem", async () => {
    const m = make({ fetch: network({ machines: false }) });
    await m.tick();
    const v = m.latest() as DevicesView;
    expect(v.devices.some((d) => d.machine)).toBe(false);
    expect(v.machinesError).toBeUndefined();
  });

  it("says who's on the network: lately active, answering, or neither", async () => {
    const m = make();
    await m.tick();
    const v = m.latest() as DevicesView;
    expect(find(v, "nas").presence).toBe("online"); // asked AdGuard a minute ago
    expect(find(v, "desk").presence).toBe("online"); // answered a connection
    expect(find(v, "pinball").presence).toBe("offline"); // didn't
  });

  it("adds what port checks find, skipping ports a tile already shows", async () => {
    const found: FoundService[] = [
      {
        port: 8096,
        url: "http://192.168.1.20:8096",
        title: "Jellyfin",
        app: { id: "jellyfin", name: "Jellyfin", icon: "si:jellyfin" },
      },
      { port: 11434, url: "http://192.168.1.20:11434", title: "" },
    ];
    const m = make({ scan: async () => found });
    m.scanNow("nas");
    await m.settled();
    expect(store.get().found["192.168.1.20"]?.services).toHaveLength(2);
    await m.tick();
    const nas = find(m.latest() as DevicesView, "nas");
    expect(nas.scannedAt).toBe(new Date(NOW).toISOString());
    const port = nas.services.filter((s) => s.kind === "port");
    expect(port).toHaveLength(1);
    expect(port[0]).toMatchObject({ key: "port:192.168.1.20:8096", name: "Jellyfin", state: "up" });
  });

  it("reads a pinball table's VPin Studio, and runs its controls", async () => {
    const calls: string[] = [];
    const fetch = network({ calls });
    const m = make({
      fetch,
      scan: async (ip) =>
        ip === "192.168.1.40"
          ? [
              {
                port: 8089,
                url: "http://192.168.1.40:8089",
                title: "",
                app: { id: "vpin-studio", name: "VPin Studio", icon: "lucide:joystick" },
              },
            ]
          : [],
    });
    m.scanNow("pinball");
    await m.settled();
    await m.tick();
    const pin = find(m.latest() as DevicesView, "pinball");
    expect(pin.presence).toBe("online");
    expect(pin.vpin).toMatchObject({
      ok: true,
      system: { name: "PINBALL", version: "4.2.0" },
      frontendRunning: true,
      muted: false,
      tables: 2,
      playing: { id: 7, name: "Medieval Madness", since: "2026-11-10T19:50:00.000Z" },
    });
    expect(pin.vpin?.scores.map((s) => [s.initials, s.score, s.table])).toEqual([
      ["SAM", "12,345,670", "Medieval Madness"],
      ["ALX", "9,000,000", "Attack From Mars"],
    ]);
    expect(pin.vpin?.players[0]).toMatchObject({ name: "Sam", rank: 1, points: 30, first: 2 });
    // The widget sees the same table.
    expect(m.pinball()).toMatchObject({ on: true, playing: { name: "Medieval Madness" } });
    expect(m.pinball("nas")).toMatchObject({ missing: true });

    expect((await m.tableList("pinball")).map((t) => t.name)).toEqual([
      "Attack From Mars",
      "Medieval Madness",
    ]);
    await m.tableDo("pinball", "mute");
    expect(calls).toContain("GET http://192.168.1.40:8089/api/v1/system/mute/1");
    await expect(m.tableDo("nas", "mute")).rejects.toThrow("VPin Studio isn't on that device.");
    await expect(m.tableDo("pinball", "launch")).rejects.toThrow("Pick a table.");
  });

  it("tells the admin once when something watched stops, and when it's back", async () => {
    const status: StatusMap = { muny: { state: "down" } };
    const m = make({ status });
    await m.setWatch("tile:muny", true);
    await m.setWatch("device:pinball", true);
    await m.tick();
    expect(told).toEqual([]);
    now += ALERT_AFTER_MS + 1000;
    await m.tick();
    expect(told.map((t) => t.title).sort()).toEqual(["Muny is down", "Pinball is offline"]);
    await m.tick();
    expect(told).toHaveLength(2); // once, not every round
    status.muny = { state: "up" };
    reachUp.add("192.168.1.40");
    // Connections are tried every other round (about two minutes).
    for (let i = 0; i < 2; i++) {
      now += 60_000;
      await m.tick();
    }
    expect(
      told
        .slice(2)
        .map((t) => t.title)
        .sort(),
    ).toEqual(["Muny is back", "Pinball is back online"]);
    expect(told[2]?.text).toMatch(/for about \d+ minutes/);
  });

  it("leaves Hearth's own pages out, and shows Hearth itself on its device", async () => {
    const cfg = fixture({
      tiles: [
        ...(fixture().tiles as unknown[]),
        {
          id: "padlock",
          name: "Get the padlock",
          url: "http://start.home/trust",
          group: "everyday",
        },
      ],
    });
    const m = make({ cfg, ownHosts: () => new Set(["start.home"]) });
    await m.tick();
    const nas = find(m.latest() as DevicesView, "nas");
    expect(nas.services[0]).toMatchObject({ key: "hearth", name: "Hearth", state: "up" });
    expect(nas.services.some((s) => s.key === "tile:padlock")).toBe(false);
  });

  it("shows an app on two ports once, marks nameless ports, and hides what the admin hides", async () => {
    const dsm = { id: "synology", name: "Synology DSM", icon: "si:synology" };
    const m = make({
      scan: async () => [
        { port: 5000, url: "http://192.168.1.20:5000", title: "Synology DSM", app: dsm },
        { port: 5001, url: "https://192.168.1.20:5001", title: "Synology DSM", app: dsm },
        { port: 8443, url: "https://192.168.1.20:8443", title: "" },
      ],
    });
    m.scanNow("nas");
    await m.settled();
    await m.tick();
    let ports = find(m.latest() as DevicesView, "nas").services.filter((s) => s.kind === "port");
    expect(ports.map((s) => [s.key, s.detail, s.state, s.minor])).toEqual([
      // One answering port is enough; the other port is listed with it.
      ["port:192.168.1.20:5000", "ports 5000, 5001", "up", false],
      ["port:192.168.1.20:8443", "port 8443", "up", true],
    ]);
    await m.setHidden("port:192.168.1.20:8443", true);
    await expect(m.setHidden("device:nas", true)).rejects.toThrow("isn't a service");
    ports = find(await m.decorate(devicesView(ROWS())), "nas").services.filter(
      (s) => s.kind === "port",
    );
    expect(ports.find((s) => s.minor)?.hidden).toBe(true);
    expect(store.get().hidden).toEqual(["port:192.168.1.20:8443"]);
  });

  it("puts a smart-home hub's devices on theirs: by address, or linked by hand", async () => {
    const things = [
      {
        hub: "openhab",
        key: "openhab:shelly:1",
        name: "Desk plug",
        hosts: ["192.168.1.30"],
        macs: [],
        points: [
          {
            id: "Desk_Power",
            label: "Power",
            kind: "switch",
            state: "On",
            on: true,
            canControl: true,
          },
        ],
      },
      {
        hub: "homeassistant",
        key: "homeassistant:dev1",
        name: "Table sensor",
        hosts: [],
        macs: [],
        points: [],
      },
    ];
    const smart = { refresh: async () => {}, all: () => things } as unknown as SmartHomeService;
    const m = make({ smart });
    await m.tick();
    let v = m.latest() as DevicesView;
    expect(find(v, "desk").smart?.map((t) => t.key)).toEqual(["openhab:shelly:1"]);
    expect(find(v, "pinball").smart).toBeUndefined();
    await m.linkSmart("pinball", "homeassistant:dev1");
    await expect(m.linkSmart("pinball", "openhab:gone")).rejects.toThrow(
      "doesn't know that device",
    );
    await m.tick();
    v = m.latest() as DevicesView;
    expect(find(v, "pinball").smart?.map((t) => t.name)).toEqual(["Table sensor"]);
  });

  it("keeps a dismissed item off the list until it's up again", async () => {
    const status: StatusMap = { muny: { state: "down" } };
    const m = make({ status });
    await m.tick();
    await m.dismiss("tile:muny");
    await expect(m.dismiss("anything")).rejects.toThrow("isn't something Hearth lists");
    await m.tick();
    expect((m.latest() as DevicesView).dismissed).toEqual(["tile:muny"]);
    status.muny = { state: "up" };
    await m.tick();
    expect(store.get().dismissed).toEqual([]);
  });

  it("only watches what it can, and forgets a watch that's turned off", async () => {
    const m = make();
    await expect(m.setWatch("rm -rf", true)).rejects.toThrow("isn't something Hearth can watch");
    await m.setWatch("port:192.168.1.20:8096", true);
    expect(store.get().watch).toEqual(["port:192.168.1.20:8096"]);
    await m.setWatch("port:192.168.1.20:8096", false);
    expect(store.get().watch).toEqual([]);
  });
});
