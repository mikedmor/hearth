/**
 * The devices on the home network, and whose each one is. Kept in
 * `data/devices.json`, for the admin only: addresses and hardware ids never reach other pages.
 *
 * A device can be known by several things at once (any one is enough): its addresses, its
 * hardware (MAC) addresses, an AdGuard ClientID, and the browsers Hearth has seen it as.
 */
import { z } from "zod";
import type { AiMachine, ViewTile } from "./api";
import type { SmartThing } from "./smarthome";

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "lowercase letters, digits and -");
const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "lowercase letters, digits and -");
const mac = z
  .string()
  .regex(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/, "a hardware address like 3c:22:fb:12:34:56");
const ip = z.string().min(2).max(45);

export const DEVICE_TYPES = [
  "phone",
  "tablet",
  "laptop",
  "desktop",
  "tv",
  "console",
  "speaker",
  "camera",
  "printer",
  "printer3d",
  "plug",
  "thermostat",
  "appliance",
  "sensor",
  "network",
  "server",
  "unknown",
] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

/** A kind of device the admin made: "c-" and a slug ("c-pinball-table"). */
export const KIND_ID = /^c-[a-z0-9][a-z0-9-]{0,39}$/;
/** A built-in type or one the admin made. */
export type DeviceKindId = DeviceType | `c-${string}`;
export const isCustomKind = (t: string): t is `c-${string}` => KIND_ID.test(t);

/** Where a kind of device goes on the Devices page. */
export const PLACES = ["network", "entertainment", "computers", "smart", "unknown"] as const;
export type Place = (typeof PLACES)[number];

export const isBuiltinKind = (t: string): t is DeviceType =>
  (DEVICE_TYPES as readonly string[]).includes(t);

/**
 * A kind of device the admin made, like "Pinball table", with its icon and where it goes; or a
 * built-in one the admin changed (its name, icon or place) or deleted (hidden).
 */
export const DeviceKindSchema = z.object({
  id: z
    .string()
    .refine((v) => KIND_ID.test(v) || isBuiltinKind(v), "a kind's id: c-<name> or a built-in one"),
  label: z.string().trim().min(1, "Give it a name").max(40),
  /** An icon reference, as tiles have: "lucide:joystick", "si:…", an emoji, or a picture. */
  icon: z.string().max(80).default("lucide:circle-help"),
  place: z.enum(PLACES).default("entertainment"),
  /** A built-in kind the admin deleted: not offered, its devices are "Not sure yet". */
  hidden: z.boolean().optional(),
});
export type DeviceKind = z.infer<typeof DeviceKindSchema>;

/** A type, accepting the old name for "unknown" ("other") from before it was renamed. */
const deviceType = z.preprocess(
  (v) => (v === "other" ? "unknown" : v),
  z.union([
    z.enum(DEVICE_TYPES),
    z.custom<`c-${string}`>((v) => typeof v === "string" && KIND_ID.test(v)),
  ]),
);

/**
 * How the network treats it. "person": it's someone's (a child's devices follow that child's
 * rules). "shared": several people use it (the school PC); with a child among them it follows the
 * strictest of their rules. "always": part of the house (smart plugs, TVs, printers, the NAS):
 * never limited, and never asked for a guest pass.
 */
export const TREATMENTS = ["person", "shared", "always"] as const;
export type Treatment = (typeof TREATMENTS)[number];

export const DeviceSchema = z.object({
  id,
  name: z.string().trim().min(1, "Give it a name").max(60),
  type: deviceType.default("unknown"),
  treatment: z.enum(TREATMENTS).default("person"),
  /** Whose it is (a profile), when it's a person's. */
  person: slug.optional(),
  /** Who uses it, when it's shared. */
  people: z.array(slug).max(12).default([]),
  ips: z.array(ip).max(8).default([]),
  macs: z.array(mac).max(8).default([]),
  /** An AdGuard ClientID, from a device's encrypted-DNS setting (later). */
  clientId: z
    .string()
    .regex(/^[a-z0-9-]{1,63}$/)
    .optional(),
  /** Browsers Hearth has seen on this device (their device cookie). */
  browsers: z.array(z.string().max(40)).max(10).default([]),
  notes: z.string().max(300).optional(),
  firstSeen: z.string().max(40).optional(),
  /** Saved by itself, by the rules for new devices (not by the admin). */
  auto: z.boolean().optional(),
});
export type Device = z.infer<typeof DeviceSchema>;

/** A range of addresses, like 192.168.2.0/24 (a whole network), or one address. */
export const CidrSchema = z
  .string()
  .trim()
  .regex(
    /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}(\/([12]?\d|3[0-2]))?$/,
    "a network like 192.168.2.0/24",
  );

/**
 * What happens to a device Hearth hasn't seen before. "leave": it waits in the list, not set up.
 * "always": it's saved as always allowed by itself. Devices on `alwaysNetworks` (an IoT Wi-Fi,
 * say) are always saved as always allowed, whatever `newDevices` says.
 */
export const NewDeviceRulesSchema = z.object({
  newDevices: z.enum(["leave", "always"]).default("leave"),
  alwaysNetworks: z.array(CidrSchema).max(10).default([]),
});
export type NewDeviceRules = z.infer<typeof NewDeviceRulesSchema>;

/** A browser that opened Hearth: where it was, and as whom. */
export const SightingSchema = z.object({
  browser: z.string().max(40),
  ip,
  profile: slug.optional(),
  agent: z.string().max(200).optional(),
  at: z.string().max(40),
  /** Whether this browser trusts the home's certificate, as it last found out. */
  trust: z.object({ ok: z.boolean(), at: z.string().max(40) }).optional(),
});
export type Sighting = z.infer<typeof SightingSchema>;

/** What a device said about itself when Hearth asked it (Google Cast, Bonjour, Roku…). */
export const IdentitySchema = z.object({
  name: z.string().max(120).optional(),
  model: z.string().max(120).optional(),
  maker: z.string().max(120).optional(),
  /** How it said so: "Google Cast", "Bonjour", "Sonos", "its web page". */
  via: z.string().max(40).optional(),
});
export type Identity = z.infer<typeof IdentitySchema>;

/** An answer, or that it didn't answer, and when it was asked. */
export const AskedSchema = z.object({
  at: z.string().max(40),
  identity: IdentitySchema.optional(),
});
export type Asked = z.infer<typeof AskedSchema>;

/** A service a port check found on a device. */
export const FoundServiceSchema = z.object({
  port: z.number().int().min(1).max(65535),
  url: z.string().max(300),
  title: z.string().max(120).default(""),
  /** The app it is, when Hearth recognised it. */
  app: z
    .object({
      id: z.string().max(60),
      name: z.string().max(60),
      icon: z.string().max(80),
      color: z.string().max(20).optional(),
    })
    .optional(),
});
export type FoundService = z.infer<typeof FoundServiceSchema>;

/** What a port check of one address found, and when. */
export const ScanSchema = z.object({
  at: z.string().max(40),
  /** Which recogniser checked it (SCAN_VERSION): a better one checks everything again. */
  v: z.number().int().optional(),
  services: z.array(FoundServiceSchema).max(40).default([]),
});
export type Scan = z.infer<typeof ScanSchema>;

/** Raise it when recognising apps gets better, so every device is checked again once. */
export const SCAN_VERSION = 2;

export const DevicesFileSchema = z.object({
  version: z.literal(1).default(1),
  devices: z.array(DeviceSchema).default([]),
  /** The latest sighting of each browser, newest first. */
  seen: z.array(SightingSchema).max(500).default([]),
  /** What each address answered when asked what it is, by address. */
  asked: z.record(ip, AskedSchema).default({}),
  /** What happens to new devices. */
  rules: NewDeviceRulesSchema.prefault({}),
  /** What port checks found on each address. */
  found: z.record(ip, ScanSchema).default({}),
  /**
   * What the admin is told about when it stops answering: "device:<id>" or a service's key
   * ("tile:<id>", "ai:<id>", "port:<ip>:<port>").
   */
  watch: z.array(z.string().max(120)).max(200).default([]),
  /** Services the admin hid (a port that's part of a device, not something they use). */
  hidden: z.array(z.string().max(120)).max(300).default([]),
  /** "Needs a look" items the admin dismissed; each comes back off the list once it's up again. */
  dismissed: z.array(z.string().max(120)).max(300).default([]),
  /** Kinds of device the admin made ("Pinball table"). */
  kinds: z.array(DeviceKindSchema).max(60).default([]),
  /** A saved device's smart-home device, linked by hand: device id → "<hub>:<the hub's id>". */
  smartLinks: z.record(z.string().max(64), z.string().max(300)).default({}),
});
export type DevicesFile = z.infer<typeof DevicesFileSchema>;

export const normalMac = (m: string) => m.trim().toLowerCase().replace(/-/g, ":");

// ---------------------------------------------------------------------------
// What the admin's page is sent

/** One row on the devices page: a saved device, or one seen on the network but not saved yet. */
export interface DeviceView {
  /** The saved device's id, or "seen:<ip>" for one that isn't saved yet. */
  key: string;
  saved: boolean;
  device?: Device;
  /** What it's called on the network (AdGuard Home's name for it, its DHCP name). */
  networkName?: string;
  ips: string[];
  macs: string[];
  /** When it last asked AdGuard Home for something, or opened Hearth. */
  lastSeen?: string;
  /** Profiles opened on it in Hearth, most recent first. */
  profiles: string[];
  /** What its browser says it is ("iPhone", "Windows"), from Hearth's sightings. */
  agent?: string;
  /** The sites it looks up most, from AdGuard Home's log: a clue to what it is. */
  lookups: string[];
  /** Who probably made it, from those ("an Apple device"), or from what it said itself. */
  maker?: string;
  /** What it said about itself when asked ("Living Room display", a Google Nest Hub). */
  identity?: Identity;
  /** A name and type to start with when saving it, from everything above. */
  suggest: { name?: string; type?: DeviceKindId };
  /** Only IPv6 addresses, which phones and computers change for privacy: usually a device that's also listed by its IPv4 address. */
  ipv6Only: boolean;
  /** The device this page is being looked at on. */
  here: boolean;
  /** On the network now: it answered, asked AdGuard Home for something lately, or a service did. */
  presence: Presence;
  /** What runs on it. */
  services: ServiceView[];
  /** When its ports were last checked for services. */
  scannedAt?: string;
  /** Being checked for services right now. */
  scanning: boolean;
  /** It lends work to an AI server. */
  machine?: MachineView;
  /** It's a pinball table running VPin Studio. */
  vpin?: VpinView;
  /** The admin is told when it goes offline. */
  watched: boolean;
  /** Whether it trusts the home's certificate, as its browser found out (none: no browser told). */
  trust?: { ok: boolean; at: string };
  /** Other rows that look like the same device (the same name on the network): merge them. */
  twins?: string[];
  /** What the smart-home hubs know about it: its readings and switches. */
  smart?: SmartThing[];
}

export type ServiceState = "up" | "slow" | "down" | "unknown";

/** A service running on a device: a tile that leads there, an AI server, or one a port check found. */
export interface ServiceView {
  /** "tile:<id>", "ai:<id>", "port:<ip>:<port>", or "hearth" (Hearth itself). */
  key: string;
  kind: "tile" | "ai" | "port" | "hearth";
  name: string;
  /** Its icon, ready to draw (as a tile's is). */
  icon?: string;
  iconKind: ViewTile["iconKind"];
  svg?: ViewTile["svg"];
  color?: string;
  url?: string;
  state: ServiceState;
  ms?: number;
  /** Hearth checks it (a tile can be set not to be). */
  checked: boolean;
  /** "3 models · qwen loaded", a page's title, "ports 5000, 5001". */
  detail?: string;
  watched: boolean;
  /** The admin hid it. */
  hidden: boolean;
  /** An open port with no name: part of the device more likely than an app someone uses. */
  minor: boolean;
}

/** A computer that lends work to one of the AI servers. */
export interface MachineView extends AiMachine {
  /** The AI server it works for. */
  server: string;
}

/** A pinball table's VPin Studio: what it's doing, high scores and players. */
export interface VpinView {
  url: string;
  ok: boolean;
  error?: string;
  system?: { name?: string; version?: string };
  frontendRunning?: boolean;
  muted?: boolean;
  playing?: { id: number; name: string; since?: string };
  /** The table played last. */
  last?: { id: number; name: string };
  tables?: number;
  scores: {
    initials: string;
    name?: string;
    score: string;
    table: string;
    gameId?: number;
    position?: number;
    /** Its place on the table's list, as the table says: "Grand champion". */
    label?: string;
    at?: string;
  }[];
  players: {
    name: string;
    initials?: string;
    rank: number;
    points: number;
    first: number;
    second: number;
    third: number;
  }[];
  checkedAt?: string;
}

/** Whether a device is on the network now. */
export type Presence = "online" | "offline" | "unknown";

/** One device on the network map: what it's connected to, and how. */
export interface MapLink {
  mac: string;
  /** "cable", "5G", "2.4G", "2.4G_Iot"… as the router says. */
  iface: string;
  /** Its row on the page, when Hearth knows it. */
  key?: string;
  name: string;
  ip?: string;
  online: boolean;
  /** Bytes a second, now. */
  rx?: number;
  tx?: number;
}

/** The main router, or a mesh node, and what's connected to it. */
export interface MapNode {
  name: string;
  model?: string;
  key?: string;
  /** How a mesh node reaches the router: "Wi-Fi", "Cable". */
  connection?: string;
  links: MapLink[];
}

/** Who's connected to what, from the router. */
export interface NetworkMap {
  router: MapNode;
  nodes: MapNode[];
  checkedAt: string;
}

export interface RouterState {
  configured: boolean;
  url?: string;
  passwordSaved: boolean;
  ok: boolean;
  error?: string;
}

export interface AdGuardState {
  configured: boolean;
  url?: string;
  username?: string;
  /** Its password is saved (never sent back). */
  passwordSaved: boolean;
  /** Reached it just now. */
  ok: boolean;
  version?: string;
  protection?: boolean;
  error?: string;
}

/** `GET /api/admin/devices`. */
export interface DevicesView {
  adguard: AdGuardState;
  devices: DeviceView[];
  /** The address Hearth sees this browser at. */
  hereIp?: string;
  /** Hearth is still asking devices what they are; ask for the page again shortly. */
  asking: boolean;
  /** What happens to new devices. */
  rules: NewDeviceRules;
  /** The private networks devices were seen on (192.168.1.0/24…), to offer for `alwaysNetworks`. */
  networks: string[];
  /** Alerts have somewhere to go (Settings → Internet → Alerts). */
  alerts: boolean;
  /** An AI server that lists its computers couldn't be asked just now. */
  machinesError?: string;
  /** "Needs a look" items the admin dismissed (until they're up again). */
  dismissed: string[];
  /** The kinds of device the admin made, with their icons ready to draw. */
  kinds: (DeviceKind & Pick<ViewTile, "iconKind" | "svg"> & { iconRef: string })[];
  /** The router, for the map. */
  router?: RouterState;
  /** Who's connected to what, when the router is connected. */
  map?: NetworkMap;
}
