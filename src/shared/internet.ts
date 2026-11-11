/**
 * The internet controls: what each person's devices may reach, kept in `data/internet.json`.
 * Hearth turns this into AdGuard Home rules for those devices' addresses. Nothing applies until
 * the admin turns the controls on.
 *
 * - "open": the whole internet (AdGuard Home's usual filtering still applies).
 * - "sites": only the sites on their Hearth page, the extra ones the admin added, and what a
 *   device needs to work.
 * - "paused": nothing.
 */
import { z } from "zod";

export const MODES = ["open", "sites", "paused"] as const;
export type Mode = (typeof MODES)[number];

/** A site to allow: a name like "pbskids.org" (its subdomains come with it). */
export const SiteSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/,
    "a site's name, like pbskids.org",
  );

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "a time like 21:00");

/** A time of the week with its own mode: "school nights 21:00 to 07:00, paused". */
export const ScheduleSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  /** 0 is Sunday. */
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  from: time,
  /** Earlier than `from` runs past midnight, into the next day. */
  to: time,
  mode: z.enum(MODES),
  name: z.string().max(40).optional(),
});
export type Schedule = z.infer<typeof ScheduleSchema>;

/**
 * What a device needs besides its sites. "basic": the "is there internet?" checks, the time,
 * the home's own names. "device": also its maker's services (updates, app store, push), so
 * the device keeps working.
 */
export const ESSENTIALS = ["basic", "device"] as const;

export const PersonRulesSchema = z.object({
  mode: z.enum(MODES).default("open"),
  /** The sites on their Hearth page count as allowed. */
  usePage: z.boolean().default(true),
  /** More allowed sites. */
  extra: z.array(SiteSchema).max(300).default([]),
  essentials: z.enum(ESSENTIALS).default("device"),
  schedule: z.array(ScheduleSchema).max(20).default([]),
  /** Google, Bing, DuckDuckGo and the rest show safe results; YouTube is in Restricted Mode. */
  safeSearch: z.boolean().default(true),
  /** AdGuard Home's adult-content filter. */
  adult: z.boolean().default(true),
  /** Apps and services blocked whatever the mode (AdGuard Home's ids: "tiktok", "roblox"…). */
  services: z
    .array(z.string().regex(/^[a-z0-9_]{1,40}$/))
    .max(200)
    .default([]),
});
export type PersonRules = z.infer<typeof PersonRulesSchema>;

export const PauseSchema = z.object({
  /** Until when; absent: until someone resumes it. */
  until: z.string().max(40).optional(),
  by: z.string().max(40),
  at: z.string().max(40),
});
export type Pause = z.infer<typeof PauseSchema>;

/** A grown-up lifted a device's rules for a while. */
export const UnlockSchema = z.object({
  device: z.string().max(64),
  by: z.string().max(40),
  until: z.string().max(40),
  at: z.string().max(40),
});
export type Unlock = z.infer<typeof UnlockSchema>;

/** A child asking from their device: more time, or a site. */
export const RequestSchema = z.object({
  id: z.string().regex(/^[a-z0-9]{1,24}$/),
  person: z.string().max(40),
  device: z.string().max(64),
  kind: z.enum(["time", "site"]),
  minutes: z.number().int().min(5).max(720).optional(),
  site: z.string().max(253).optional(),
  note: z.string().max(140).optional(),
  at: z.string().max(40),
  status: z.enum(["pending", "approved", "denied"]),
  /** Who answered, and when. */
  by: z.string().max(40).optional(),
  answered: z.string().max(40).optional(),
});
export type AskRequest = z.infer<typeof RequestSchema>;

/** Where alerts go besides Hearth itself: a web address (ntfy, Home Assistant, Gotify…). */
export const NotifySchema = z.object({
  url: z.string().url().max(500).optional(),
  /** Also when a child is first blocked from a site that day. */
  blocked: z.boolean().default(false),
});

const ipv4 = z
  .string()
  .regex(
    /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/,
    "an address like 192.168.1.20",
  );
const cidr = z
  .string()
  .regex(
    /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}\/([12]?\d|3[0-2])$/,
    "a network like 192.168.1.0/24",
  );

/**
 * The front door: on these networks, a device Hearth doesn't know gets no internet until it's let
 * in: with the house password on the welcome page, or by a parent. Off until the admin turns it on.
 */
export const DoorSchema = z.object({
  enabled: z.boolean().default(false),
  /** The family network(s) it guards, like 192.168.1.0/24. Not the guest Wi-Fi. */
  networks: z.array(cidr).max(5).default([]),
  /** How long a device let in stays in: days, or 0 for until someone removes it. */
  stayDays: z.number().int().min(0).max(365).default(0),
  /**
   * Hearth's own address on port 80 (the NAS's), for the phone's "is there internet?" checks: a
   * stopped device is sent there and its "Sign in to network" page opens by itself. Optional.
   */
  welcomeAddress: ipv4.optional(),
  /** Where the welcome page is, as a stopped device opens it. */
  welcomeUrl: z.string().url().max(200).default("http://start.home/welcome"),
});
export type Door = z.infer<typeof DoorSchema>;

/**
 * A change to the guest pass's settings: only what's sent changes. (DoorSchema.partial() would
 * still fill in its defaults, so saving one setting would reset the others.) A null welcome
 * address clears it.
 */
export const DoorPatchSchema = z.object({
  enabled: z.boolean().optional(),
  networks: z.array(cidr).max(5).optional(),
  stayDays: z.number().int().min(0).max(365).optional(),
  welcomeAddress: ipv4.nullable().optional(),
  welcomeUrl: z.string().url().max(200).optional(),
});
export type DoorPatch = z.infer<typeof DoorPatchSchema>;

/** A device let in through the front door. */
export const AdmittedSchema = z.object({
  ip: ipv4,
  at: z.string().max(40),
  until: z.string().max(40).optional(),
  /** "password", "start" (here when the door opened), a grown-up's id, or "admin". */
  by: z.string().max(40),
  name: z.string().max(80).optional(),
});
export type Admitted = z.infer<typeof AdmittedSchema>;

export const InternetFileSchema = z.object({
  version: z.literal(1).default(1),
  /** The controls apply. Off: Hearth's rules are taken out of AdGuard Home. */
  enabled: z.boolean().default(false),
  /** How many days of children's history to keep. */
  historyDays: z.number().int().min(1).max(365).default(30),
  people: z.record(z.string(), PersonRulesSchema).default({}),
  pauses: z.record(z.string(), PauseSchema).default({}),
  unlocks: z.array(UnlockSchema).max(200).default([]),
  /** The newest query-log time already read into history. */
  cursor: z.string().max(40).optional(),
  /** Adults who may use the Family page (with a PIN), besides the admin. */
  parents: z.array(z.string().max(40)).max(30).default([]),
  /** Blocked sites a parent dismissed from "Needs a look": person → site → when. */
  dismissed: z.record(z.string(), z.record(z.string(), z.string().max(40))).default({}),
  /**
   * When history started for each child's device (the cursor then). Lookups from before it are
   * read back once, by that device's address, so a device just marked as a child's has its past.
   */
  tracked: z.record(z.string(), z.string().max(40)).default({}),
  requests: z.array(RequestSchema).max(300).default([]),
  notify: NotifySchema.prefault({}),
  door: DoorSchema.prefault({}),
  admitted: z.array(AdmittedSchema).max(1000).default([]),
});
export type InternetFile = z.infer<typeof InternetFileSchema>;

// ---------------------------------------------------------------------------
// History: one file a day, `data/history/YYYY-MM-DD.json`

export const SiteVisitSchema = z.object({
  /** Lookups of it that day. */
  n: z.number().int().min(0),
  /** Of those, blocked. */
  blocked: z.number().int().min(0).default(0),
  first: z.string().max(40),
  last: z.string().max(40),
  /** Saved devices it was looked up on. */
  devices: z.array(z.string().max(64)).max(20).default([]),
  /** For a blocked site: an allowed site looked up just before it ("while using youtube.com"). */
  after: z.string().max(253).optional(),
  /** Lookups by device. */
  per: z.record(z.string(), z.number().int().min(0)).default({}),
  /** Lookups by hour of the day (the home's time zone), 24 of them. */
  hours: z.array(z.number().int().min(0)).length(24).optional(),
});
export type SiteVisit = z.infer<typeof SiteVisitSchema>;

/** A day: by person, by site. */
export const HistoryDaySchema = z.record(z.string(), z.record(z.string(), SiteVisitSchema));
export type HistoryDay = z.infer<typeof HistoryDaySchema>;

// ---------------------------------------------------------------------------
// What the pages are sent

/** Where a person's mode comes from right now. */
export interface ModeNow {
  mode: Mode;
  /** "paused" by someone, a schedule's name, or their usual mode. */
  because: "pause" | "schedule" | "usual";
  schedule?: string;
  /** A pause's end (a moment), if it has one. */
  until?: string;
  /** A schedule's end, as a time of day in the home's time zone ("07:00"). */
  untilTime?: string;
}

/** One site on a day, for the history list. */
export interface VisitRow extends SiteVisit {
  site: string;
}

/** A child's device, as the Family page shows it. */
export interface ChildDevice {
  id: string;
  name: string;
  type: string;
  ips: string[];
  unlocked?: Unlock;
  /** Its last lookup Hearth saw. */
  lastActive?: string;
}

/** A child at a glance. */
export interface ChildSummary {
  person: string;
  now: ModeNow;
  /** The next time their mode changes by itself, and to what. */
  next?: { at: string; mode: Mode; schedule?: string };
  pause?: Pause;
  devices: ChildDevice[];
  today: {
    /** Sites reached (looked up and not only blocked). */
    sites: number;
    /** Blocked lookups. */
    blocked: number;
    /** The busiest sites reached. */
    top: string[];
    /** Lookups by hour. */
    hours: number[];
  };
}

/** A blocked site for "Needs a look". */
export interface AttentionRow extends VisitRow {
  person: string;
}

/** `GET /api/family`. */
export interface FamilyView {
  /** The internet controls are on. */
  enabled: boolean;
  /** The viewer is the admin (they also see house-wide settings). */
  admin: boolean;
  children: ChildSummary[];
  attention: AttentionRow[];
  /** Children's requests waiting for an answer. */
  requests: AskRequest[];
  /** Devices stopped at the front door lately (it's on). */
  visitors: Visitor[];
}

/** `GET /api/family/:child`. */
export interface ChildView {
  enabled: boolean;
  summary: ChildSummary;
  rules: PersonRules;
  /** The sites from their page (worked out from its links). */
  pageSites: string[];
  /** The day shown, the days kept, and that day's sites (for one device, if asked). */
  day: string;
  days: string[];
  device?: string;
  sites: VisitRow[];
  hours: number[];
  /** Blocked in the last few days and not allowed; dismissed ones say so. */
  blocked: (VisitRow & { dismissed?: string })[];
}

/** `GET /api/admin/internet`: the house-wide part. */
export interface InternetView {
  enabled: boolean;
  historyDays: number;
  adguard: { configured: boolean; ok: boolean; error?: string };
  /** The last time Hearth wrote its rules, and how many lines. */
  applied?: { at: string; lines: number; error?: string };
  /** Adults who may use the Family page. */
  parents: string[];
  notify: { url?: string; blocked: boolean; error?: string };
  /** Hearth's AdGuard Home clients (SafeSearch, blocked services), if one couldn't be saved. */
  clientsError?: string;
}

/** A device stopped at the front door. */
export interface Visitor {
  ip: string;
  /** What the network calls it, if anything. */
  name?: string;
  first: string;
  last: string;
  /** Lookups it made that the door stopped. */
  stopped: number;
  /** It asked to be let in from the welcome page, maybe saying what it is. */
  asked?: { at: string; name?: string };
}

/** `GET /api/admin/door`. */
export interface DoorView {
  door: Door;
  passwordSet: boolean;
  admitted: Admitted[];
  visitors: Visitor[];
}

/** `GET /api/door/here`: the welcome page's view of the device it's open on. */
export interface DoorHere {
  /** The door is on and guards this device's network. */
  guarded: boolean;
  /** This device can go on the internet (known, or let in). */
  inside: boolean;
  admitted?: Admitted;
  /** It asked a parent already. */
  asked: boolean;
  home: string;
  passwordSet: boolean;
}

/** An app or service AdGuard Home can block. */
export interface ServiceInfo {
  id: string;
  name: string;
  group: string;
}

/** `GET /api/internet/here`: the device this page is open on. */
export interface HereInternet {
  /** This device follows someone's rules. */
  ruled: boolean;
  person?: string;
  device?: string;
  now?: ModeNow;
  unlocked?: Unlock;
  /** The grown-ups who can unlock it (adults and the admin with a PIN). */
  grownUps: { id: string; name: string; avatar?: string; color: string }[];
  /** This device's latest request, from the last 12 hours. */
  request?: AskRequest;
}
