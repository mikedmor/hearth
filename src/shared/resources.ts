/**
 * How the home's own machines are doing: processor, memory, temperature, storage and traffic.
 * Read without installing anything on them: the router and the mesh's access points through their
 * own admin API, the NAS through SNMP (read only). A computer running Glances is read through
 * Glances' web API.
 */

/** Where the readings come from: the main router, the NAS, another GL.iNet (an access point), Glances. */
export type ResourceSource = "router" | "nas" | "ap" | "glances";

/** The kinds of machine that can be added besides the router and the NAS. */
export const MACHINE_KINDS = ["glinet", "glances"] as const;
export type MachineKind = (typeof MACHINE_KINDS)[number];

/** A disk in the NAS. */
export interface DiskState {
  name: string;
  model?: string;
  /** °C. */
  temp?: number;
  ok: boolean;
  /** "Normal", "Crashed"… as the NAS says. */
  status: string;
}

/** A volume (or the router's storage): space used of total, in bytes. */
export interface VolumeState {
  name: string;
  total: number;
  used: number;
  /** The storage pool behind it is healthy (unknown: not said). */
  ok?: boolean;
  status?: string;
}

/** One machine's resources, now. */
export interface Resources {
  /** "router", "nas", or "m:<id>" for an added machine. */
  key: string;
  source: ResourceSource;
  /** "Router", "NAS", or the name it gives itself. */
  name: string;
  /** The address Hearth reads it at (for matching it to a device). */
  ip?: string;
  /** Read just now. */
  ok: boolean;
  error?: string;
  /** When it was last read well (ISO). */
  at?: string;
  model?: string;
  version?: string;
  /** Processor busy, 0–100 (the NAS; the router only says its load). */
  cpu?: number;
  /** Load average over 1, 5 and 15 minutes. */
  load?: [number, number, number];
  cores?: number;
  /** Bytes. */
  memTotal?: number;
  memUsed?: number;
  /** °C: the system's (the NAS) or the processor's (the router). */
  temp?: number;
  /** Seconds since it started. */
  uptime?: number;
  /** Bytes a second, in and out: the NAS's network ports, or everything the router's clients move. */
  rx?: number;
  tx?: number;
  /** The router reaches the internet. */
  internet?: boolean;
  volumes: VolumeState[];
  disks: DiskState[];
  /** Fans and power, as the NAS says ("Normal"…). */
  fans?: string;
  /** A DSM update is waiting. */
  update?: boolean;
  /** Plain sentences: "Disk 2 is crashed", "Volume 1 is 93% full". */
  problems: string[];
  /** The last readings, oldest first (about one every 30 seconds): for small charts. */
  history: { cpu: number[]; mem: number[]; rx: number[]; tx: number[]; temp: number[] };
}

/** An added machine's settings, for the Setup card (its password is never sent back). */
export interface MachineSetup {
  id: string;
  kind: MachineKind;
  name: string;
  url: string;
  user?: string;
  secretSaved: boolean;
}

/** `GET /api/admin/resources`. */
export interface ResourcesView {
  router?: Resources;
  nas?: Resources;
  /** Access points and Glances computers, in the order they were added. */
  machines: Resources[];
  /** What's set up, for the Setup card. */
  setup: {
    routerConnected: boolean;
    nas: {
      host?: string;
      version: "2c" | "3";
      user?: string;
      auth: "sha" | "md5";
      priv: "aes" | "des" | "none";
      /** The community (v2c) or the user's password (v3) is saved (never sent back). */
      secretSaved: boolean;
      privSaved: boolean;
    };
    machines: MachineSetup[];
  };
}
