/**
 * The NAS's resources over SNMP, read only. Nothing to install: DSM has SNMP built in (Control
 * Panel → Terminal & SNMP). Hearth asks for:
 *
 * - the standard host MIBs (UCD-SNMP, HOST-RESOURCES, IF-MIB): processor, load, memory, volumes,
 *   uptime and network traffic, which any Linux box with SNMP answers;
 * - Synology's own MIB (1.3.6.1.4.1.6574): model, DSM version, system temperature, fans and power,
 *   each disk's health and temperature, each storage pool's health, and whether an update waits.
 *
 * SNMP v3 (a user with a password, encrypted) is preferred; v2c (a community name) works too.
 */
import snmp from "net-snmp";
import type { DiskState, VolumeState } from "../../shared/resources";

export class SnmpError extends Error {}

export interface SnmpSettings {
  host: string;
  version: "2c" | "3";
  /** v3: the user. */
  user?: string;
  auth?: "sha" | "md5";
  priv?: "aes" | "des" | "none";
  /** v2c: the community; v3: the user's password. */
  secret?: string;
  /** v3: the encryption password (the user's password when empty). */
  privSecret?: string;
  port?: number;
}

type Value = string | number | bigint | boolean | Buffer | null | undefined;

/** What Hearth needs from an SNMP session (a fake one in tests). */
export interface SnmpLink {
  get(oids: string[]): Promise<Map<string, Value>>;
  walk(oid: string): Promise<Map<string, Value>>;
  close(): void;
}

/** A real session, through net-snmp. */
export function openLink(s: SnmpSettings): SnmpLink {
  const options = { port: s.port ?? 161, timeout: 4000, retries: 1 };
  let session: snmp.Session;
  if (s.version === "3") {
    if (!s.user) throw new SnmpError("Give the SNMP user's name.");
    if (!s.secret) throw new SnmpError("Give the SNMP user's password.");
    const priv = s.priv ?? "aes";
    session = snmp.createV3Session(
      s.host,
      {
        name: s.user,
        level: priv === "none" ? snmp.SecurityLevel.authNoPriv : snmp.SecurityLevel.authPriv,
        authProtocol: s.auth === "md5" ? snmp.AuthProtocols.md5 : snmp.AuthProtocols.sha,
        authKey: s.secret,
        ...(priv === "none"
          ? {}
          : {
              privProtocol: priv === "des" ? snmp.PrivProtocols.des : snmp.PrivProtocols.aes,
              privKey: s.privSecret || s.secret,
            }),
      },
      { ...options, version: snmp.Version3 },
    );
  } else {
    if (!s.secret) throw new SnmpError("Give the SNMP community.");
    session = snmp.createSession(s.host, s.secret, { ...options, version: snmp.Version2c });
  }
  // A UDP error (an unknown host) must not take Hearth down.
  session.on("error", () => {});
  const fail = (e: unknown) => new SnmpError(explain(e));
  return {
    get: (oids) =>
      new Promise((resolve, reject) => {
        session.get(oids, (err, vbs) => {
          if (err) return reject(fail(err));
          const out = new Map<string, Value>();
          for (const vb of vbs ?? []) if (!snmp.isVarbindError(vb)) out.set(vb.oid, vb.value);
          resolve(out);
        });
      }),
    walk: (oid) =>
      new Promise((resolve, reject) => {
        const out = new Map<string, Value>();
        session.subtree(
          oid,
          20,
          (vbs) => {
            for (const vb of vbs) if (!snmp.isVarbindError(vb)) out.set(vb.oid, vb.value);
          },
          (err) => (err ? reject(fail(err)) : resolve(out)),
        );
      }),
    close: () => {
      try {
        session.close();
      } catch {
        // Already closed.
      }
    },
  };
}

function explain(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/timed out/i.test(m))
    return "The NAS didn't answer SNMP. Is it turned on in DSM (Control Panel → Terminal & SNMP), with these settings?";
  if (/authentication|wrong digest|unknown user|notInTimeWindow|usm/i.test(m))
    return "The NAS refused the SNMP user or password.";
  if (/ENOTFOUND|EAI_AGAIN/i.test(m)) return "No device has that name on the network.";
  return `SNMP: ${m}`;
}

// ---------------------------------------------------------------------------

const SYS_DESCR = "1.3.6.1.2.1.1.1.0";
const SYS_NAME = "1.3.6.1.2.1.1.5.0";
const SYS_UPTIME = "1.3.6.1.2.1.1.3.0";
const HR_UPTIME = "1.3.6.1.2.1.25.1.1.0";
const MEM = "1.3.6.1.4.1.2021.4";
const MEM_TOTAL = `${MEM}.5.0`;
const MEM_AVAIL = `${MEM}.6.0`;
const MEM_BUFFER = `${MEM}.14.0`;
const MEM_CACHED = `${MEM}.15.0`;
const CPU = "1.3.6.1.4.1.2021.11";
const CPU_IDLE_PCT = `${CPU}.11.0`;
/** ssCpuRaw*: user, nice, system, idle, wait, interrupt, softirq. */
const CPU_RAW = [50, 51, 52, 53, 54, 56, 61].map((n) => `${CPU}.${n}.0`);
const CPU_RAW_IDLE = `${CPU}.53.0`;
const LOAD = [1, 2, 3].map((n) => `1.3.6.1.4.1.2021.10.1.3.${n}`);
const SYNO = "1.3.6.1.4.1.6574";
const SYNO_STATUS = `${SYNO}.1.1.0`;
const SYNO_TEMP = `${SYNO}.1.2.0`;
const SYNO_POWER = `${SYNO}.1.3.0`;
const SYNO_FAN = `${SYNO}.1.4.1.0`;
const SYNO_CPU_FAN = `${SYNO}.1.4.2.0`;
const SYNO_MODEL = `${SYNO}.1.5.1.0`;
const SYNO_VERSION = `${SYNO}.1.5.3.0`;
const SYNO_UPGRADE = `${SYNO}.1.5.4.0`;
const SYNO_DISKS = `${SYNO}.2.1.1`;
const SYNO_RAIDS = `${SYNO}.3.1.1`;
const HR_STORAGE = "1.3.6.1.2.1.25.2.3.1";
const HR_CPUS = "1.3.6.1.2.1.25.3.3.1.2";
const IF_X = "1.3.6.1.2.1.31.1.1.1";

const SCALARS = [
  SYS_DESCR,
  SYS_NAME,
  SYS_UPTIME,
  HR_UPTIME,
  MEM_TOTAL,
  MEM_AVAIL,
  MEM_BUFFER,
  MEM_CACHED,
  CPU_IDLE_PCT,
  ...CPU_RAW,
  ...LOAD,
  SYNO_STATUS,
  SYNO_TEMP,
  SYNO_POWER,
  SYNO_FAN,
  SYNO_CPU_FAN,
  SYNO_MODEL,
  SYNO_VERSION,
  SYNO_UPGRADE,
];

/** Numbers, counters (64-bit ones come as bytes) and numeric text, as a number. */
export function toNum(v: Value): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "bigint") return Number(v);
  if (Buffer.isBuffer(v)) {
    if (v.length === 0 || v.length > 8) return undefined;
    let n = 0n;
    for (const b of v) n = (n << 8n) | BigInt(b);
    return Number(n);
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

const str = (v: Value): string | undefined => {
  const s = Buffer.isBuffer(v) ? v.toString("utf8") : typeof v === "string" ? v : undefined;
  const t = s?.replace(/\0/g, "").trim();
  return t ? t.slice(0, 80) : undefined;
};

/** A table walk, by row index: { "1": { "2": value, "3": value }, … }. */
function rows(walked: Map<string, Value>, base: string): Map<string, Map<string, Value>> {
  const out = new Map<string, Map<string, Value>>();
  for (const [oid, v] of walked) {
    if (!oid.startsWith(`${base}.`)) continue;
    const rest = oid.slice(base.length + 1);
    const dot = rest.indexOf(".");
    if (dot < 0) continue;
    const col = rest.slice(0, dot);
    const idx = rest.slice(dot + 1);
    const row = out.get(idx) ?? new Map();
    row.set(col, v);
    out.set(idx, row);
  }
  return out;
}

const DISK_STATUS: Record<number, string> = {
  1: "Normal",
  2: "Initialized",
  3: "Not initialized",
  4: "System partition failed",
  5: "Crashed",
};
const RAID_STATUS: Record<number, string> = {
  1: "Normal",
  2: "Repairing",
  3: "Migrating",
  4: "Expanding",
  5: "Deleting",
  6: "Creating",
  7: "Syncing",
  8: "Checking parity",
  9: "Assembling",
  10: "Cancelling",
  11: "Degraded",
  12: "Crashed",
  13: "Scrubbing",
  14: "Deploying",
  15: "Undeploying",
  16: "Mounting cache",
  17: "Unmounting cache",
  18: "Expanding",
  19: "Converting",
  20: "Migrating",
  21: "Unknown",
};
const BAD_RAID = new Set([11, 12, 21]);

export interface NasReading {
  name?: string;
  model?: string;
  version?: string;
  cpu?: number;
  load?: [number, number, number];
  cores?: number;
  memTotal?: number;
  memUsed?: number;
  temp?: number;
  uptime?: number;
  rx?: number;
  tx?: number;
  volumes: VolumeState[];
  disks: DiskState[];
  /** "Normal", or what's wrong with the fans or power. */
  fans?: string;
  /** The system says it's failed. */
  systemFailed?: boolean;
  update?: boolean;
  /** Storage pools that aren't healthy: "Storage Pool 1 is degraded". */
  pools: { name: string; status: string; ok: boolean }[];
}

interface Counters {
  at: number;
  cpu?: { idle: number; total: number };
  rx?: number;
  tx?: number;
}

/** Reads one machine over SNMP, keeping the last counters to work out rates. */
export class SnmpReader {
  private link: SnmpLink | null = null;
  private prev: Counters | null = null;

  constructor(
    private readonly settings: SnmpSettings,
    private readonly open: (s: SnmpSettings) => SnmpLink = openLink,
    private readonly now: () => number = Date.now,
  ) {}

  close(): void {
    this.link?.close();
    this.link = null;
  }

  async read(): Promise<NasReading> {
    this.link ??= this.open(this.settings);
    const link = this.link;
    try {
      const scalars = await link.get(SCALARS);
      if (!scalars.size) throw new SnmpError("The NAS answered SNMP but shared nothing.");
      // Tables one after another: some agents drop requests that arrive together.
      const storage = await link.walk(HR_STORAGE).catch(() => new Map<string, Value>());
      const ifs = await link.walk(IF_X).catch(() => new Map<string, Value>());
      const disks = await link.walk(SYNO_DISKS).catch(() => new Map<string, Value>());
      const raids = await link.walk(SYNO_RAIDS).catch(() => new Map<string, Value>());
      const cpus = await link.walk(HR_CPUS).catch(() => new Map<string, Value>());
      return this.parse(scalars, storage, ifs, disks, raids, cpus);
    } catch (e) {
      // A fresh session next time (v3 sessions remember the agent's engine).
      this.close();
      throw e instanceof SnmpError ? e : new SnmpError(explain(e));
    }
  }

  private parse(
    s: Map<string, Value>,
    storage: Map<string, Value>,
    ifs: Map<string, Value>,
    diskWalk: Map<string, Value>,
    raidWalk: Map<string, Value>,
    cpus: Map<string, Value>,
  ): NasReading {
    const at = this.now();
    const g = (oid: string) => toNum(s.get(oid));

    // Processor: from the raw counters since last time; the agent's own average the first time.
    const raw = CPU_RAW.map((o) => g(o));
    const idle = g(CPU_RAW_IDLE);
    const counters: Counters = { at };
    let cpu: number | undefined;
    if (idle !== undefined && raw.some((x) => x !== undefined)) {
      const total = raw.reduce<number>((n, x) => n + (x ?? 0), 0);
      counters.cpu = { idle, total };
      const p = this.prev?.cpu;
      if (p && total > p.total) cpu = 100 * (1 - (idle - p.idle) / (total - p.total));
    }
    if (cpu === undefined) {
      const idlePct = g(CPU_IDLE_PCT);
      if (idlePct !== undefined) cpu = 100 - idlePct;
    }
    if (cpu !== undefined) cpu = Math.round(Math.min(100, Math.max(0, cpu)) * 10) / 10;

    // Memory (kilobytes): what programs use, leaving out buffers and cache.
    const kb = (oid: string) => {
      const n = g(oid);
      return n === undefined ? undefined : n * 1024;
    };
    const memTotal = kb(MEM_TOTAL);
    const avail = kb(MEM_AVAIL);
    const memUsed =
      memTotal !== undefined && avail !== undefined
        ? Math.max(0, memTotal - avail - (kb(MEM_BUFFER) ?? 0) - (kb(MEM_CACHED) ?? 0))
        : undefined;

    const la = LOAD.map((o) => g(o));
    const load = la.every((x) => x !== undefined) ? (la as [number, number, number]) : undefined;

    // Volumes: /volume1, /volume2… from the host's storage table.
    const volumes: VolumeState[] = [];
    for (const [, r] of rows(storage, HR_STORAGE)) {
      const descr = str(r.get("3"));
      const m = descr?.match(/^\/volume(\d+)$/);
      if (!m) continue;
      const unit = toNum(r.get("4")) ?? 0;
      const sz = toNum(r.get("5")) ?? 0;
      const used = toNum(r.get("6")) ?? 0;
      if (!unit || !sz) continue;
      volumes.push({ name: `Volume ${m[1]}`, total: sz * unit, used: used * unit });
    }
    volumes.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    // Storage pools (Synology's RAID table).
    const pools = [...rows(raidWalk, SYNO_RAIDS).values()].flatMap((r) => {
      const name = str(r.get("2"));
      const code = toNum(r.get("3"));
      if (!name || code === undefined) return [];
      return [{ name, status: RAID_STATUS[code] ?? `Status ${code}`, ok: !BAD_RAID.has(code) }];
    });
    for (const v of volumes) {
      const n = v.name.replace(/\D/g, "");
      const pool =
        pools.find((p) => p.name.toLowerCase() === v.name.toLowerCase()) ??
        pools.find((p) => p.name.replace(/\D/g, "") === n && /pool/i.test(p.name)) ??
        (pools.length === 1 ? pools[0] : undefined);
      if (pool) {
        v.ok = pool.ok;
        v.status = pool.status;
      }
    }

    // Disks.
    const disks: DiskState[] = [...rows(diskWalk, SYNO_DISKS).values()].flatMap((r) => {
      const name = str(r.get("2"));
      if (!name) return [];
      const code = toNum(r.get("5"));
      const temp = toNum(r.get("6"));
      return [
        {
          name,
          model: str(r.get("3")),
          temp: temp && temp > 0 ? temp : undefined,
          ok: code === undefined || code <= 2,
          status: code === undefined ? "Unknown" : (DISK_STATUS[code] ?? `Status ${code}`),
        },
      ];
    });

    // Network: the physical ports (eth0, eth1…), or bonds when that's all there is.
    const ports = [...rows(ifs, IF_X).values()].map((r) => ({
      name: str(r.get("1")) ?? "",
      rx: toNum(r.get("6")),
      tx: toNum(r.get("10")),
    }));
    const eth = ports.filter((p) => /^eth\d+$/.test(p.name));
    const chosen = eth.length ? eth : ports.filter((p) => /^(bond|ovs_eth)\d+$/.test(p.name));
    let rx: number | undefined;
    let tx: number | undefined;
    if (chosen.length && chosen.every((p) => p.rx !== undefined && p.tx !== undefined)) {
      counters.rx = chosen.reduce((n, p) => n + (p.rx ?? 0), 0);
      counters.tx = chosen.reduce((n, p) => n + (p.tx ?? 0), 0);
      const p = this.prev;
      const dt = p ? (at - p.at) / 1000 : 0;
      if (p?.rx !== undefined && p.tx !== undefined && dt > 0) {
        // A counter that went backwards (a restart) gives no rate this time.
        if (counters.rx >= p.rx) rx = Math.round((counters.rx - p.rx) / dt);
        if (counters.tx >= p.tx) tx = Math.round((counters.tx - p.tx) / dt);
      }
    }
    this.prev = counters;

    const fanBits = [
      ["Power", g(SYNO_POWER)],
      ["System fan", g(SYNO_FAN)],
      ["Processor fan", g(SYNO_CPU_FAN)],
    ] as const;
    const known = fanBits.filter(([, v]) => v !== undefined);
    const failing = known.filter(([, v]) => v !== 1).map(([k]) => k);
    const ticks = g(HR_UPTIME) ?? g(SYS_UPTIME);
    const upgrade = g(SYNO_UPGRADE);
    const temp = g(SYNO_TEMP);
    const descr = str(s.get(SYS_DESCR));
    return {
      name: str(s.get(SYS_NAME)),
      model: str(s.get(SYNO_MODEL)) ?? descr?.split(" ").slice(0, 2).join(" "),
      version: str(s.get(SYNO_VERSION)),
      cpu,
      load,
      cores: rows(cpus, HR_CPUS.split(".").slice(0, -1).join(".")).size || undefined,
      memTotal,
      memUsed,
      temp: temp && temp > 0 ? temp : undefined,
      uptime: ticks === undefined ? undefined : Math.round(ticks / 100),
      rx,
      tx,
      volumes,
      disks,
      fans: known.length
        ? failing.length
          ? `${failing.join(", ")} failing`
          : "Normal"
        : undefined,
      systemFailed: g(SYNO_STATUS) === 2,
      update: upgrade === undefined ? undefined : upgrade === 1,
      pools,
    };
  }
}
