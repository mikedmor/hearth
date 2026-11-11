/**
 * Turning the internet controls into AdGuard Home rules. Pure: what a person may reach, what
 * mode they're in right now, and the block of custom filtering rules that says so.
 *
 * For each person who isn't "open", their devices' addresses get:
 *
 *     ||*^$client=192.168.1.41|192.168.1.42,important        everything is blocked…
 *     @@||pbskids.org^$client=192.168.1.41|192.168.1.42,important   …but these
 *
 * Both are `important`, so the person's own allowed sites win over the block, and the block wins
 * over any ordinary allow rule. Hearth's lines sit between two comment lines and are the only
 * lines it ever changes.
 */
import { type HearthConfig, isLocalUrl, type Profile } from "../../shared/config";
import type { ModeNow, Pause, PersonRules } from "../../shared/internet";
import { baseDomain } from "../devices/clues";
import { visibleTiles } from "../view";

export const FENCE_START =
  "! Hearth internet controls: start. Hearth rewrites these lines; change them in Hearth.";
export const FENCE_END = "! Hearth internet controls: end";

/** "https://www.pbskids.org/games" → "pbskids.org". Home-network links aren't internet sites. */
export function siteOf(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (isLocalUrl(u.href)) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":")) return null;
  return baseDomain(host);
}

/** The internet sites linked from a person's page (sections and links they can see). */
export function pageSites(cfg: HearthConfig, p: Profile): string[] {
  const hiddenTiles = new Set(p.hiddenTiles);
  const hiddenGroups = new Set(p.hiddenGroups);
  const sites = visibleTiles(cfg, { role: p.role, profile: p.id })
    .filter((t) => !hiddenTiles.has(t.id) && !hiddenGroups.has(t.group))
    .map((t) => siteOf(t.url))
    .filter((s): s is string => Boolean(s));
  return [...new Set(sites)].sort();
}

/** Sites that need others to work: a video site's video servers, an app's image servers. */
export const COMPANIONS: Record<string, string[]> = {
  "youtube.com": ["googlevideo.com", "ytimg.com", "ggpht.com", "youtube-nocookie.com", "youtu.be"],
  "youtubekids.com": ["youtube.com", "googlevideo.com", "ytimg.com", "ggpht.com"],
  "netflix.com": ["nflxvideo.net", "nflximg.net", "nflxext.com", "nflxso.net"],
  "disneyplus.com": ["bamgrid.com", "disney-plus.net", "dssott.com"],
  "roblox.com": ["rbxcdn.com"],
  "minecraft.net": ["mojang.com", "minecraftservices.com", "xboxlive.com"],
  "khanacademy.org": ["kastatic.org", "kasandbox.org"],
  "pbskids.org": ["pbs.org"],
  "wikipedia.org": ["wikimedia.org"],
  "spotify.com": ["scdn.co", "spotifycdn.com"],
  "twitch.tv": ["ttvnw.net", "jtvnw.net"],
};

/** What every device needs: the "is there internet?" checks, the time, the home's own names. */
const BASIC = [
  "home",
  "lan",
  "local",
  "arpa",
  "captive.apple.com",
  "connectivitycheck.gstatic.com",
  "connectivitycheck.android.com",
  "clients3.google.com",
  "msftconnecttest.com",
  "msftncsi.com",
  "detectportal.firefox.com",
  "time.apple.com",
  "time.google.com",
  "time.windows.com",
  "pool.ntp.org",
];

/** Its maker's services: updates, the app store, sign-in, notifications. Not web search. */
const DEVICE = [
  // Apple
  "apple.com",
  "icloud.com",
  "mzstatic.com",
  "apple-dns.net",
  "aaplimg.com",
  "cdn-apple.com",
  "apple-cloudkit.com",
  // Android and Google sign-in (not google.com itself: that's search)
  "googleapis.com",
  "gvt1.com",
  "gvt2.com",
  "android.com",
  "gstatic.com",
  "accounts.google.com",
  "play.google.com",
  "android.clients.google.com",
  // Windows
  "windowsupdate.com",
  "update.microsoft.com",
  "delivery.mp.microsoft.com",
  "login.live.com",
  "login.microsoftonline.com",
];

export function essentials(level: PersonRules["essentials"]): string[] {
  return level === "device" ? [...BASIC, ...DEVICE] : [...BASIC];
}

/** Everything a person may reach in "sites" mode. */
export function allowedSites(rules: PersonRules, page: string[]): string[] {
  const chosen = [...(rules.usePage ? page : []), ...rules.extra];
  const all = new Set<string>(chosen);
  for (const s of chosen) for (const c of COMPANIONS[s] ?? []) all.add(c);
  for (const s of essentials(rules.essentials)) all.add(s);
  return [...all].sort();
}

// ---------------------------------------------------------------------------
// Right now

const clocks = new Map<string, Intl.DateTimeFormat>();
const days = new Map<string, Intl.DateTimeFormat>();

/** The weekday (0 Sunday) and minutes past midnight, in a time zone. */
export function localClock(ms: number, timeZone?: string): { day: number; minutes: number } {
  const key = timeZone ?? "";
  let fmt = clocks.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    clocks.set(key, fmt);
  }
  const parts = fmt.formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** "YYYY-MM-DD" in a time zone. */
export function localDay(ms: number, timeZone?: string): string {
  const key = timeZone ?? "";
  let fmt = days.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    days.set(key, fmt);
  }
  return fmt.format(new Date(ms));
}

const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** A pause still on. */
export const pauseOn = (p: Pause | undefined, now: number): boolean =>
  Boolean(p && (!p.until || Date.parse(p.until) > now));

/** The mode a person is in right now: a pause, else the first schedule that covers now, else theirs. */
export function modeNow(
  rules: PersonRules,
  pause: Pause | undefined,
  now: number,
  timeZone?: string,
): ModeNow {
  if (pauseOn(pause, now)) return { mode: "paused", because: "pause", until: pause?.until };
  const { day, minutes } = localClock(now, timeZone);
  for (const s of rules.schedule) {
    const from = mins(s.from);
    const to = mins(s.to);
    const today = s.days.includes(day);
    const yesterday = s.days.includes((day + 6) % 7);
    const on =
      from < to
        ? today && minutes >= from && minutes < to
        : (today && minutes >= from) || (yesterday && minutes < to);
    if (on) return { mode: s.mode, because: "schedule", schedule: s.name, untilTime: s.to };
  }
  return { mode: rules.mode, because: "usual" };
}

/**
 * When a person's mode next changes by itself (a pause ending, a schedule starting or ending),
 * within two days. Found by stepping five minutes at a time, then to the minute.
 */
export function nextChange(
  rules: PersonRules,
  pause: Pause | undefined,
  now: number,
  timeZone?: string,
): { at: number; now: ModeNow } | undefined {
  const at = (t: number) => modeNow(rules, pause, t, timeZone);
  const key = (m: ModeNow) => `${m.mode}|${m.because}|${m.schedule ?? ""}`;
  const start = key(at(now));
  const STEP = 5 * 60_000;
  // Start on a whole minute, so changes land on the minute.
  const base = Math.floor(now / 60_000) * 60_000;
  for (let t = base + STEP; t <= now + 2 * 86_400_000; t += STEP) {
    if (key(at(t)) === start) continue;
    for (let m = t - STEP + 60_000; m <= t; m += 60_000) {
      const there = at(m);
      if (key(there) !== start) return { at: m, now: there };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The rules

export interface RuleGroup {
  /** For the comment line: "Ava: only her sites". */
  label: string;
  /** Addresses of the devices. */
  clients: string[];
  mode: "sites" | "paused";
  sites: string[];
}

/** An address as `$client` takes it. */
const client = (ip: string) => ip.replace(/[^0-9a-fA-F.:/]/g, "");

/** The names phones and computers ask to see if there's internet (and a sign-in page in the way). */
export const CAPTIVE = [
  "captive.apple.com",
  "www.appleiphonecell.com",
  "connectivitycheck.gstatic.com",
  "connectivitycheck.android.com",
  "clients3.google.com",
  "www.msftconnecttest.com",
  "www.msftncsi.com",
  "detectportal.firefox.com",
  "nmcheck.gnome.org",
  "connectivity-check.ubuntu.com",
];

/**
 * The front door: on its networks, every device but the known ones is blocked, except the home's
 * own names (so the welcome page opens). With Hearth's address given, their "is there internet?"
 * checks go to Hearth, which sends them to the welcome page.
 */
export function doorRules(networks: string[], known: string[], welcomeAddress?: string): string[] {
  if (!networks.length) return [];
  const nets = networks.map(client).join("|");
  const except = [...new Set(known.map(client).filter((ip) => ip && !ip.includes(":")))]
    .map((ip) => `~${ip}`)
    .join("|");
  const who = except ? `${nets}|${except}` : nets;
  const lines = [
    `! Guest pass: devices Hearth doesn't know on ${networks.join(", ")} (${known.length} known)`,
    `||*^$client=${who},important`,
    ...["home", "lan", "local", "arpa"].map((n) => `@@||${n}^$client=${nets},important`),
  ];
  if (welcomeAddress)
    for (const name of CAPTIVE)
      lines.push(`||${name}^$dnsrewrite=NOERROR;A;${client(welcomeAddress)},client=${who}`);
  return lines;
}

/** Hearth's lines, fence included (none when there's nothing to say). */
export function buildRules(groups: RuleGroup[], door: string[] = []): string[] {
  const lines: string[] = [...door];
  for (const g of groups) {
    const ips = [...new Set(g.clients.map(client).filter(Boolean))];
    if (!ips.length) continue;
    const who = `$client=${ips.join("|")},important`;
    lines.push(`! ${g.label.replace(/[\r\n]/g, " ")}`);
    lines.push(`||*^${who}`);
    if (g.mode === "sites") for (const s of g.sites) lines.push(`@@||${s}^${who}`);
  }
  return lines.length ? [FENCE_START, ...lines, FENCE_END] : [];
}

/** Someone's custom rules with Hearth's block swapped for `ours` (their own lines untouched). */
export function withOurs(existing: string[], ours: string[]): string[] {
  const kept: string[] = [];
  let inside = false;
  for (const line of existing) {
    if (line === FENCE_START) inside = true;
    else if (line === FENCE_END) inside = false;
    else if (!inside) kept.push(line);
  }
  // Drop blank lines left at the end where the block was.
  while (kept.length && !kept[kept.length - 1]?.trim()) kept.pop();
  return [...kept, ...ours];
}

/** Hearth's block as it is in AdGuard Home now. */
export function oursIn(existing: string[]): string[] {
  const start = existing.indexOf(FENCE_START);
  if (start < 0) return [];
  const end = existing.indexOf(FENCE_END, start);
  return end < 0 ? existing.slice(start) : existing.slice(start, end + 1);
}
