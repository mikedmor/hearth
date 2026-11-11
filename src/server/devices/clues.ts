/**
 * Clues to what a device is, from what it looks up: an iPhone asks for apple.com and icloud.com,
 * a Fire TV for amazon, a smart plug for tuya. Only names, as AdGuard Home's log has them.
 */
import { networkInterfaces } from "node:os";
import type { DeviceType, Identity } from "../../shared/devices";
import { inCidr } from "../client-ip";

/** Lookups that say nothing about the device (every device makes them, or they're the house's). */
const NOISE_END =
  /(\.arpa|\.local|\.lan|\.home|\.internal|\.localdomain|use-application-dns\.net|msftconnecttest\.com|captive\.apple\.com|detectportal\.firefox\.com)$/;
const NOISE_START = /^(localhost|wpad|_|time\d*\.|ntp\d*\.|pool\.ntp|connectivitycheck)/;
export const noise = (n: string) => NOISE_END.test(n) || NOISE_START.test(n) || !n.includes(".");

const TWO_PART = new Set(["co.uk", "com.au", "co.jp", "co.nz", "com.br", "co.in", "org.uk"]);

/** "e1234.dscb.akamaiedge.net" → "akamaiedge.net"; "www.bbc.co.uk" → "bbc.co.uk". */
export function baseDomain(name: string): string {
  const parts = name.toLowerCase().replace(/\.$/, "").split(".");
  if (parts.length <= 2) return parts.join(".");
  const last2 = parts.slice(-2).join(".");
  return TWO_PART.has(last2) ? parts.slice(-3).join(".") : last2;
}

/** The sites a device looks up most, busiest first, leaving out the noise. */
export function topLookups(names: string[], take = 4): string[] {
  const counts = new Map<string, number>();
  for (const n of names) {
    if (!n || noise(n.toLowerCase())) continue;
    const b = baseDomain(n);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, take)
    .map(([d]) => d);
}

const GOOGLE = "an Android or Google device";
const AMAZON = "an Amazon device (Echo, Fire TV, Ring)";

/**
 * Brands that live on a bigger company's servers: a Nest camera talks to Google more than to
 * nest.com, so nest.com anywhere in its lookups says more than google.com at the top.
 */
const UNDER: [RegExp, string, string][] = [
  [
    /^nest\.com$|dropcam|nestlabs/,
    "a Google Nest device (thermostat, camera or smoke alarm)",
    GOOGLE,
  ],
  [/^ring\.com$/, "a Ring doorbell or camera", AMAZON],
  [/^blinkforhome|immedia-semi/, "a Blink camera", AMAZON],
];

/** Who probably made it, from the sites it talks to. The first match wins, most specific first. */
const MAKERS: [RegExp, string][] = [
  [/nanit/, "a Nanit baby camera"],
  [/wyze/, "a Wyze camera or sensor"],
  [/arlo/, "an Arlo camera"],
  [/eufy|anker/, "a eufy camera or doorbell"],
  [/ecobee/, "an ecobee thermostat"],
  [/myq|chamberlain|liftmaster/, "a garage door opener (myQ)"],
  [/tplinkcloud|tp-link|kasasmart/, "a TP-Link Kasa or Tapo device"],
  [/lifx/, "a LIFX bulb"],
  [/roborock|irobot|ecovacs|dreame/, "a robot vacuum"],
  [/oculus/, "a Meta Quest headset"],
  [/tuya|smartlife|tuyaus|tuyaeu/, "a Tuya smart device (plug, bulb or switch)"],
  [/shelly/, "a Shelly smart switch"],
  [/wled|espressif|esphome/, "an ESP-based gadget (WLED, ESPHome)"],
  [/meethue|philips-hue/, "Philips Hue"],
  [/sonos/, "a Sonos speaker"],
  [/roku/, "a Roku"],
  [/xboxlive|xbox/, "an Xbox"],
  [/playstation|sonyentertainmentnetwork/, "a PlayStation"],
  [/nintendo/, "a Nintendo Switch"],
  [/ring\.com|amazonvideo|amazon-adsystem|amazonalexa|\balexa\b|amazon\.com|amazonaws/, AMAZON],
  [/samsungcloud|samsungotn|samsungelectronics|samsung/, "a Samsung device"],
  [/synology|quickconnect/, "a Synology NAS"],
  [/hp\.com|hpeprint|epson|brother|canon/, "a printer"],
  [/apple\.com|icloud\.com|mzstatic|apple-dns|aaplimg/, "an Apple device (iPhone, iPad, Mac)"],
  [/microsoft\.com|windowsupdate|msedge|live\.com|office\.com|bing\.com/, "a Windows computer"],
  [/googleapis|gstatic|android|googleusercontent|1e100\.net|youtube|google\.com/, GOOGLE],
  [/netflix|nflx/, "something that plays Netflix (a TV?)"],
];

/** Who probably made it: from the busiest site that says (so a PC that once visited apple.com stays a PC). */
export function makerFrom(lookups: string[]): string | undefined {
  let found: string | undefined;
  for (const d of lookups) {
    const hit = MAKERS.find(([re]) => re.test(d));
    if (hit) {
      found = hit[1];
      break;
    }
  }
  // A Nest under Google, a Ring under Amazon: the brand says more than the company's servers.
  for (const [re, label, parent] of UNDER)
    if (found === parent && lookups.some((d) => re.test(d))) return label;
  return found;
}

// ---------------------------------------------------------------------------
// What a device says about itself

/** "Nanit_N301ABC12345XY_0615S" → "Nanit"; "Alexs-iPhone" → "Alexs iPhone". Serial numbers go. */
export function tidyName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const words = raw
    .replace(/\.(local|lan|home)\.?$/i, "")
    .split(/[\s_-]+/)
    .filter(Boolean);
  const serial = (w: string) =>
    w.length >= 8 && /\d/.test(w) && /[a-z]/i.test(w) && w === w.toUpperCase();
  const cut = words.findIndex(
    (w, i) => i > 0 && (serial(w) || (/\d/.test(w) && /^[0-9a-f]{8,}$/i.test(w))),
  );
  const kept = (cut > 0 ? words.slice(0, cut) : words).join(" ").trim();
  return kept.slice(0, 60) || undefined;
}

const TYPE_HINTS: [RegExp, DeviceType][] = [
  [/iphone|pixel \d|galaxy s|android phone|phone/i, "phone"],
  [/ipad|tablet|galaxy tab|fire hd/i, "tablet"],
  [/macbook|laptop|notebook|chromebook/i, "laptop"],
  [/imac|mac mini|mac studio|desktop|-pc\b/i, "desktop"],
  [/chromecast|google tv|roku|fire ?tv|apple tv|appletv|\btv\b|bravia|shield/i, "tv"],
  [/xbox|playstation|ps[45]\b|nintendo|switch/i, "console"],
  [/sonos|nest (mini|audio|hub)|google home|echo|homepod|speaker|display/i, "speaker"],
  [/nanit|camera|\bcam\b|doorbell|arlo|wyze|\bring\b|blink|eufy|dropcam/i, "camera"],
  [
    /prusa|bambu|creality|octoprint|klipper|mainsail|fluidd|anycubic|elegoo|3d ?printer/i,
    "printer3d",
  ],
  [/thermostat|ecobee|honeywell|\bsensi\b|nest (learning|e\b)/i, "thermostat"],
  [
    /roborock|roomba|irobot|vacuum|ecovacs|dreame|washer|dryer|fridge|refrigerator|dishwasher|\boven\b|gemodule|ge appliance|smarthq|whirlpool|maytag|thinq|appliance/i,
    "appliance",
  ],
  [
    /leak|water sensor|dch-s1|smoke|co detector|motion sensor|contact sensor|sensor|\bsense\b|sense-|flume/i,
    "sensor",
  ],
  [/printer|laserjet|officejet|deskjet|epson|brother|canon/i, "printer"],
  [/shelly|tasmota|wled|plug|switch|bulb|kasa|tapo|tuya|lifx|hue/i, "plug"],
  [/synology|diskstation|nas\b|server/i, "server"],
  [/router|access point|mesh|gl-|eero|unifi/i, "network"],
];

/** What type it probably is. Hints come most trusted first: the first that says wins. */
export function typeFrom(...hints: (string | undefined)[]): DeviceType | undefined {
  for (const h of hints) {
    const hit = h ? TYPE_HINTS.find(([re]) => re.test(h)) : undefined;
    if (hit) return hit[1];
  }
  return undefined;
}

/** A maker phrase from what it said ("a Google Nest Hub"), when it said enough. */
export function makerFromIdentity(id: Identity | undefined): string | undefined {
  if (!id) return undefined;
  // "Google Inc." → "Google", so "Google Nest Hub" doesn't say Google twice.
  const maker = id.maker?.replace(/,?\s+(inc|ltd|llc|corp|co|gmbh|corporation)\.?$/i, "").trim();
  if (id.model && maker && !id.model.toLowerCase().includes(maker.toLowerCase()))
    return `${maker} ${id.model}`;
  if (id.model) return id.model;
  if (maker) return maker;
  return id.name ? MAKERS.find(([re]) => re.test(id.name?.toLowerCase() ?? ""))?.[1] : undefined;
}

/** Addresses that aren't a device to name: this machine, and "no address assigned" placeholders. */
export function notADevice(ip: string): boolean {
  const a = ip.toLowerCase();
  return (
    dockerNets().some((n) => inCidr(a, n)) ||
    a === "::1" ||
    a.startsWith("127.") ||
    a.startsWith("169.254.") ||
    a.startsWith("fe80:") ||
    a === "0.0.0.0" ||
    a === "::"
  );
}

let bridges: string[] | null = null;

/**
 * The Docker networks Hearth's own container sits on (Docker's pool, 172.17–31): an address there
 * is the NAS as seen from inside, never a device on the home network.
 */
export function dockerNets(): string[] {
  bridges ??= Object.values(networkInterfaces())
    .flat()
    .filter(
      (i) =>
        i &&
        i.family === "IPv4" &&
        !i.internal &&
        /^172\.(1[7-9]|2\d|3[01])\./.test(i.address) &&
        Boolean(i.cidr),
    )
    .map((i) => i?.cidr as string);
  return bridges;
}

/**
 * A page title that says nothing about the device ("Welcome to nginx!", "Login", "404"): not a
 * name to give it.
 */
export function genericTitle(t: string): boolean {
  return /welcome|^hello\b|it works|index of|^log ?in\b|sign ?in|default (web )?page|^home( page)?$|^untitled|^(nginx|apache|iis)\b|redirect|loading|^\d{3}\b|not found|forbidden|unauthori[sz]ed|^error|web station|test page/i.test(
    t.trim(),
  );
}
