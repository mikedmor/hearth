import { describe, expect, it } from "vitest";
import { GlancesError, parseGlances, parseUptime } from "./glances";
import { parseStatus } from "./glinet";
import { fromGlances, fromNas, fromRouter, problemsOf, ResourceMonitor } from "./resources";
import { type SnmpLink, SnmpReader, toNum } from "./snmp";

describe("the router's status", () => {
  const st = {
    network: [
      { interface: "wan", online: true, up: true },
      { interface: "wwan", online: false, up: false },
    ],
    system: {
      memory_total: 1_015_000,
      memory_free: 600_000,
      memory_buff_cache: 100_000,
      flash_total: 7_000_000,
      flash_free: 6_000_000,
      load_average: [0.42, 0.3, "0.25"],
      uptime: 86_500,
      cpu: { temperature: 61 },
    },
  };

  it("reads load, memory (kilobytes), temperature, storage and the internet", () => {
    const s = parseStatus(st, null, { model: "mt6000", firmware_version: "4.11.0" });
    expect(s.model).toBe("mt6000");
    expect(s.version).toBe("4.11.0");
    expect(s.load).toEqual([0.42, 0.3, 0.25]);
    expect(s.memTotal).toBe(1_015_000 * 1024);
    expect(s.memUsed).toBe((1_015_000 - 600_000 - 100_000) * 1024);
    expect(s.flashUsed).toBe(1_000_000 * 1024);
    expect(s.temp).toBe(61);
    expect(s.uptime).toBe(86_500);
    expect(s.internet).toBe(true);
  });

  it("takes sizes in bytes as they are, and sums what online clients move", () => {
    const s = parseStatus(
      { system: { memory_total: 1_073_741_824, memory_free: 536_870_912 }, network: [] },
      {
        clients: {
          a: { mac: "aa:bb:cc:dd:ee:01", online: true, rx: 1000, tx: 50 },
          b: { mac: "aa:bb:cc:dd:ee:02", online: true, rx: 500, tx: 25 },
          c: { mac: "aa:bb:cc:dd:ee:03", online: false, rx: 9999, tx: 9999 },
        },
      },
      null,
    );
    expect(s.memTotal).toBe(1_073_741_824);
    expect(s.memUsed).toBe(536_870_912);
    expect(s.rx).toBe(1500);
    expect(s.tx).toBe(75);
    expect(s.internet).toBeUndefined();
    expect(s.load).toBeUndefined();
  });

  it("refuses an empty answer", () => {
    expect(() => parseStatus(null, null, null)).toThrow(/how it's doing/);
  });
});

// ---------------------------------------------------------------------------

const SYNO = "1.3.6.1.4.1.6574";
const u64 = (n: number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
};

/** A Synology NAS over SNMP: scalars and four tables. Counters move between reads. */
function fakeNas(opts: { diskStatus?: number; raidStatus?: number; volUsed?: number } = {}) {
  let round = 0;
  const link: SnmpLink & { closed: number } = {
    closed: 0,
    async get(oids) {
      round++;
      const all: Record<string, unknown> = {
        "1.3.6.1.2.1.1.5.0": "nas",
        "1.3.6.1.2.1.25.1.1.0": 360_000, // an hour, in hundredths
        "1.3.6.1.4.1.2021.4.5.0": 8_000_000,
        "1.3.6.1.4.1.2021.4.6.0": 2_000_000,
        "1.3.6.1.4.1.2021.4.14.0": 500_000,
        "1.3.6.1.4.1.2021.4.15.0": 1_500_000,
        "1.3.6.1.4.1.2021.11.11.0": 80,
        // Raw processor counters: 1000 more ticks a round, 250 of them idle (75% busy).
        "1.3.6.1.4.1.2021.11.50.0": 500 * round,
        "1.3.6.1.4.1.2021.11.52.0": 250 * round,
        "1.3.6.1.4.1.2021.11.53.0": 250 * round,
        "1.3.6.1.4.1.2021.10.1.3.1": "1.50",
        "1.3.6.1.4.1.2021.10.1.3.2": "1.20",
        "1.3.6.1.4.1.2021.10.1.3.3": "0.90",
        [`${SYNO}.1.1.0`]: 1,
        [`${SYNO}.1.2.0`]: 44,
        [`${SYNO}.1.3.0`]: 1,
        [`${SYNO}.1.4.1.0`]: 1,
        [`${SYNO}.1.4.2.0`]: 1,
        [`${SYNO}.1.5.1.0`]: Buffer.from("DS224+"),
        [`${SYNO}.1.5.3.0`]: "DSM 7.2.2-72806",
        [`${SYNO}.1.5.4.0`]: 2,
      };
      return new Map(oids.filter((o) => o in all).map((o) => [o, all[o] as never]));
    },
    async walk(oid) {
      const m = new Map<string, never>();
      const put = (k: string, v: unknown) => m.set(k, v as never);
      if (oid === "1.3.6.1.2.1.25.2.3.1") {
        put(`${oid}.3.31`, "/volume1");
        put(`${oid}.4.31`, 4096);
        put(`${oid}.5.31`, 1_000_000);
        put(`${oid}.6.31`, opts.volUsed ?? 400_000);
        put(`${oid}.3.1`, "Physical memory");
        put(`${oid}.4.1`, 1024);
        put(`${oid}.5.1`, 8_000_000);
        put(`${oid}.6.1`, 6_000_000);
      }
      if (oid === "1.3.6.1.2.1.31.1.1.1") {
        put(`${oid}.1.1`, "lo");
        put(`${oid}.6.1`, u64(9_999_999 * round));
        put(`${oid}.10.1`, u64(9_999_999 * round));
        put(`${oid}.1.2`, "eth0");
        put(`${oid}.6.2`, u64(30_000 * round));
        put(`${oid}.10.2`, u64(3_000 * round));
        put(`${oid}.1.3`, "eth1");
        put(`${oid}.6.3`, u64(0));
        put(`${oid}.10.3`, u64(0));
      }
      if (oid === `${SYNO}.2.1.1`) {
        for (const [i, s] of [
          [0, 1],
          [1, opts.diskStatus ?? 1],
        ] as const) {
          put(`${oid}.2.${i}`, `Drive ${i + 1}`);
          put(`${oid}.3.${i}`, "WD40EFRX");
          put(`${oid}.5.${i}`, s);
          put(`${oid}.6.${i}`, 36 + i);
        }
      }
      if (oid === `${SYNO}.3.1.1`) {
        put(`${oid}.2.0`, "Volume 1");
        put(`${oid}.3.0`, opts.raidStatus ?? 1);
      }
      if (oid === "1.3.6.1.2.1.25.3.3.1.2") for (const i of [196608, 196609]) put(`${oid}.${i}`, 5);
      return m;
    },
    close() {
      this.closed++;
    },
  };
  return link;
}

describe("the NAS over SNMP", () => {
  it("turns counters, bytes and text into numbers", () => {
    expect(toNum(u64(5_000_000_000))).toBe(5_000_000_000);
    expect(toNum("0.42")).toBe(0.42);
    expect(toNum(12n)).toBe(12);
    expect(toNum(Buffer.from("x"))).toBe(120);
    expect(toNum(null)).toBeUndefined();
  });

  it("reads everything, and rates from the second read on", async () => {
    let now = 1_000_000;
    const link = fakeNas();
    const r = new SnmpReader(
      { host: "nas", version: "2c", secret: "c" },
      () => link,
      () => now,
    );
    const first = await r.read();
    expect(first).toMatchObject({
      name: "nas",
      model: "DS224+",
      version: "DSM 7.2.2-72806",
      cpu: 20, // 100 - ssCpuIdle, the first time
      load: [1.5, 1.2, 0.9],
      cores: 2,
      memTotal: 8_000_000 * 1024,
      memUsed: 4_000_000 * 1024,
      temp: 44,
      uptime: 3600,
      fans: "Normal",
      systemFailed: false,
      update: false,
    });
    expect(first.rx).toBeUndefined();
    expect(first.volumes).toEqual([
      {
        name: "Volume 1",
        total: 1_000_000 * 4096,
        used: 400_000 * 4096,
        ok: true,
        status: "Normal",
      },
    ]);
    expect(first.disks.map((d) => [d.name, d.ok, d.temp])).toEqual([
      ["Drive 1", true, 36],
      ["Drive 2", true, 37],
    ]);
    now += 10_000;
    const second = await r.read();
    expect(second.cpu).toBe(75);
    // Only eth0 and eth1 count, not the loopback.
    expect(second.rx).toBe(3000);
    expect(second.tx).toBe(300);
  });

  it("says what's wrong: a crashed disk, a degraded pool, a full volume", async () => {
    const link = fakeNas({ diskStatus: 5, raidStatus: 11, volUsed: 950_000 });
    const n = await new SnmpReader({ host: "nas", version: "2c", secret: "c" }, () => link).read();
    const { base, extra } = fromNas(n);
    expect(problemsOf(base, extra)).toEqual([
      "Volume 1: degraded.",
      "Drive 2: crashed.",
      "Volume 1 is 95% full.",
    ]);
  });

  it("starts a fresh session after a failure", async () => {
    let opened = 0;
    const link = fakeNas();
    link.get = async () => {
      throw new Error("Request timed out");
    };
    const r = new SnmpReader({ host: "nas", version: "2c", secret: "c" }, () => {
      opened++;
      return link;
    });
    await expect(r.read()).rejects.toThrow(/didn't answer SNMP/);
    await expect(r.read()).rejects.toThrow();
    expect(opened).toBe(2);
    expect(link.closed).toBe(2);
  });
});

// ---------------------------------------------------------------------------

describe("the resource monitor", () => {
  const router = {
    status: async () =>
      parseStatus(
        {
          system: { memory_total: 1000, memory_free: 10, load_average: [0.5, 0.4, 0.3] },
          network: [{ interface: "wan", online: false }],
        },
        null,
        { cpu_num: 4 },
      ),
  };

  it("keeps both, with problems and a short history, and the last numbers on a failure", async () => {
    let fail = false;
    const link = fakeNas();
    const nasLink = {
      ...link,
      get: (o: string[]) => (fail ? Promise.reject(new Error("Request timed out")) : link.get(o)),
    };
    const m = new ResourceMonitor({
      router: () => router as never,
      routerUrl: () => "http://192.168.1.1",
      nas: () => ({ host: "nas.home", version: "2c", secret: "c" }),
      reader: (s) => new SnmpReader(s, () => nasLink),
      resolve: async (h) => (h === "nas.home" ? "192.168.1.20" : h),
    });
    await m.refresh();
    let v = m.view();
    expect(v.router).toMatchObject({ ok: true, ip: "192.168.1.1", cores: 4 });
    expect(v.router?.problems).toEqual([
      "The router can't reach the internet.",
      "The router's memory is 99% used.",
    ]);
    // Load 0.5 on 4 cores stands in for 13% busy.
    expect(v.router?.history.cpu).toEqual([13]);
    expect(v.nas).toMatchObject({
      ok: true,
      ip: "192.168.1.20",
      model: "DS224+",
    });
    fail = true;
    await m.refresh();
    v = m.view();
    expect(v.nas).toMatchObject({ ok: false, model: "DS224+", ip: "192.168.1.20" });
    expect(v.nas?.error).toMatch(/didn't answer SNMP/);
    const w = m.widgetData() as { nas: { volume: { percent: number }; healthy: boolean } };
    expect(w.nas.volume.percent).toBe(40);
    expect(w.nas.healthy).toBe(false);
    m.stop();
  });

  it("shows nothing for what isn't connected", async () => {
    const m = new ResourceMonitor({
      router: () => null,
      routerUrl: () => undefined,
      nas: () => null,
    });
    await m.refresh();
    expect(m.view()).toEqual({ router: undefined, nas: undefined, machines: [] });
    expect(m.widgetData()).toEqual({
      router: { connected: false },
      nas: { connected: false },
      machines: [],
      problems: [],
    });
    m.stop();
  });

  it("reads added machines: an access point has no internet line, a failure keeps its name", async () => {
    let fail = false;
    const m = new ResourceMonitor({
      router: () => null,
      routerUrl: () => undefined,
      nas: () => null,
      machines: () => [
        { id: "upstairs", kind: "glinet", name: "Upstairs AP", url: "http://192.168.1.2" },
        { id: "pc", kind: "glances", name: "Sam's PC", url: "http://192.168.1.30:61208" },
      ],
      client: (spec) => ({
        read: async () => {
          if (spec.kind === "glinet")
            return {
              base: fromRouter(
                parseStatus(
                  {
                    system: { memory_total: 1000, memory_free: 500, load_average: [0.2, 0.1, 0.1] },
                    network: [{ interface: "wan", online: false }],
                  },
                  null,
                  { model: "ax1800", cpu_num: 2 },
                ),
                { key: "m:upstairs", source: "ap", name: spec.name },
              ),
            };
          if (fail) throw new GlancesError("Glances didn't answer.");
          return {
            base: fromGlances(
              { cpu: 12, memTotal: 100, memUsed: 97, volumes: [] },
              { key: "m:pc", name: spec.name },
            ),
          };
        },
      }),
      resolve: async (h) => h,
    });
    await m.refresh();
    let v = m.view();
    expect(v.machines.map((r) => [r.key, r.source, r.ip, r.model])).toEqual([
      ["m:upstairs", "ap", "192.168.1.2", "AX1800"],
      ["m:pc", "glances", "192.168.1.30", undefined],
    ]);
    // An access point's "wan" isn't the home's internet.
    expect(v.machines[0]?.internet).toBeUndefined();
    expect(v.machines[0]?.problems).toEqual([]);
    expect(v.machines[1]?.problems).toEqual(["Sam's PC's memory is 97% used."]);
    fail = true;
    await m.refresh();
    v = m.view();
    expect(v.machines[1]).toMatchObject({ ok: false, name: "Sam's PC", cpu: 12 });
    const w = m.widgetData() as { problems: string[]; machines: { kind: string }[] };
    expect(w.problems).toEqual(["Sam's PC: Glances didn't answer."]);
    expect(w.machines.map((x) => x.kind)).toEqual(["ap", "glances"]);
    m.stop();
  });
});

// ---------------------------------------------------------------------------

describe("Glances", () => {
  it("reads version 4: processor, memory, the hottest package, real disks and real ports", () => {
    const { reading } = parseGlances(
      {
        cpu: { total: 23.4 },
        load: { min1: 1.1, min5: 0.9, min15: 0.7, cpucore: 8 },
        mem: { total: 16e9, used: 9e9 },
        system: { hostname: "sams-pc", hr_name: "Ubuntu 24.04 64bit" },
        uptime: "3 days, 4:05:06",
        sensors: [
          { label: "Core 0", value: 71, type: "temperature_core" },
          { label: "Package id 0", value: 66, type: "temperature_core" },
          { label: "fan1", value: 1200, type: "fan_speed" },
        ],
        fs: [
          {
            mnt_point: "/",
            device_name: "/dev/nvme0n1p2",
            fs_type: "ext4",
            size: 500e9,
            used: 200e9,
          },
          {
            mnt_point: "/home",
            device_name: "/dev/nvme0n1p2",
            fs_type: "ext4",
            size: 500e9,
            used: 200e9,
          },
          {
            mnt_point: "/boot/efi",
            device_name: "/dev/nvme0n1p1",
            fs_type: "vfat",
            size: 5e9,
            used: 1e6,
          },
          { mnt_point: "/run", device_name: "tmpfs", fs_type: "tmpfs", size: 2e9, used: 1e6 },
        ],
        network: [
          { interface_name: "lo", bytes_recv_rate_per_sec: 9999, bytes_sent_rate_per_sec: 9999 },
          { interface_name: "enp3s0", bytes_recv_rate_per_sec: 1000, bytes_sent_rate_per_sec: 200 },
          {
            interface_name: "docker0",
            bytes_recv_rate_per_sec: 5000,
            bytes_sent_rate_per_sec: 5000,
          },
        ],
      },
      null,
      0,
    );
    expect(reading).toMatchObject({
      name: "sams-pc",
      model: "Ubuntu 24.04 64bit",
      cpu: 23.4,
      load: [1.1, 0.9, 0.7],
      cores: 8,
      memTotal: 16e9,
      memUsed: 9e9,
      temp: 66,
      uptime: 3 * 86400 + 4 * 3600 + 5 * 60 + 6,
      rx: 1000,
      tx: 200,
    });
    expect(reading.volumes).toEqual([{ name: "/", total: 500e9, used: 200e9 }]);
  });

  it("reads version 3's rates, or works them out from counters", () => {
    const v3 = parseGlances(
      { network: [{ interface_name: "eth0", rx: 3000, tx: 600, time_since_update: 3 }] },
      null,
      0,
    );
    expect([v3.reading.rx, v3.reading.tx]).toEqual([1000, 200]);
    const first = parseGlances(
      { network: [{ interface_name: "eth0", cumulative_rx: 10_000, cumulative_tx: 1000 }] },
      null,
      1000,
    );
    expect(first.reading.rx).toBeUndefined();
    const second = parseGlances(
      { network: [{ interface_name: "eth0", cumulative_rx: 30_000, cumulative_tx: 3000 }] },
      first.counters,
      11_000,
    );
    expect([second.reading.rx, second.reading.tx]).toEqual([2000, 200]);
    expect(parseUptime("0:01:02")).toBe(62);
  });
});
