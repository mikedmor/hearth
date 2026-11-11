/**
 * Asking a device what it is. Many answer on the home network, often with the name given to them
 * in their own app: Google Cast devices (Nest speakers and displays, Chromecast, many TVs), Roku,
 * Sonos, Philips Hue, Shelly, WLED, Tasmota, and anything that answers Bonjour/mDNS (Apple devices,
 * cameras, printers). Only private addresses are asked, each question with a short time limit.
 */
import dgram from "node:dgram";
import https from "node:https";
import { isLocalUrl } from "../../shared/config";
import type { Identity } from "../../shared/devices";
import { guardedFetch, parseXml } from "../net";
import { genericTitle } from "./clues";

const LOCAL = { allowInternet: false };
const SHORT = 2500;

/** A device's private IPv4 address, or nothing to ask (never this machine, never the internet). */
export function privateIp(ip: string): string | null {
  if (!/^(10|172\.(1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}(\.\d{1,3})?$/.test(ip))
    return null;
  if (ip.split(".").length !== 4) return null;
  return isLocalUrl(`http://${ip}/`) ? ip : null;
}

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await guardedFetch(url, { policy: LOCAL, timeoutMs: SHORT, maxBytes: 256 * 1024 });
    if (r.status !== 200) return null;
    return JSON.parse(r.body.toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function getText(url: string): Promise<string | null> {
  try {
    const r = await guardedFetch(url, { policy: LOCAL, timeoutMs: SHORT, maxBytes: 256 * 1024 });
    return r.status === 200 ? r.body.toString("utf8") : null;
  } catch {
    return null;
  }
}

/** Google Cast's own page. Newer devices only offer it over HTTPS on 8443, with their own certificate. */
function castHttps(ip: string): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const req = https.get(
      {
        host: ip,
        port: 8443,
        path: "/setup/eureka_info?params=name,device_info",
        // A Cast device's own certificate; this is only ever a private address on the home network.
        rejectUnauthorized: false,
        timeout: SHORT,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (d: string) => {
          body += d;
          if (body.length > 256 * 1024) req.destroy();
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(body) as Record<string, unknown>);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
  });
}

async function cast(ip: string): Promise<Identity | null> {
  // Newer devices give only their name over http, and the rest over https: ask both.
  const [plain, secure] = await Promise.all([
    getJson(`http://${ip}:8008/setup/eureka_info?params=name,device_info`),
    castHttps(ip),
  ]);
  const name = [plain?.name, secure?.name].find((n): n is string => typeof n === "string");
  if (!name) return null;
  const info = (secure?.device_info ?? plain?.device_info ?? {}) as Record<string, unknown>;
  return {
    name,
    model: typeof info.model_name === "string" ? info.model_name : undefined,
    maker: typeof info.manufacturer === "string" ? info.manufacturer : undefined,
    via: "Google Cast",
  };
}

const text = (v: unknown): string | undefined => {
  if (typeof v === "string") return v.trim() || undefined;
  if (v && typeof v === "object" && typeof (v as Record<string, unknown>)["#text"] === "string")
    return ((v as Record<string, unknown>)["#text"] as string).trim() || undefined;
  return undefined;
};

async function roku(ip: string): Promise<Identity | null> {
  const x = await getText(`http://${ip}:8060/query/device-info`);
  const d = x ? (parseXml(x)?.["device-info"] as Record<string, unknown> | undefined) : undefined;
  if (!d) return null;
  return {
    name: text(d["user-device-name"]) ?? text(d["friendly-device-name"]),
    model: text(d["model-name"]),
    maker: "Roku",
    via: "Roku",
  };
}

async function sonos(ip: string): Promise<Identity | null> {
  const x = await getText(`http://${ip}:1400/xml/device_description.xml`);
  const root = x ? (parseXml(x)?.root as Record<string, unknown> | undefined) : undefined;
  const d = root?.device as Record<string, unknown> | undefined;
  if (!d) return null;
  return { name: text(d.roomName), model: text(d.modelName), maker: "Sonos", via: "Sonos" };
}

async function hue(ip: string): Promise<Identity | null> {
  const j = await getJson(`http://${ip}/api/config`);
  if (!j || typeof j.bridgeid !== "string") return null;
  return { name: text(j.name), model: text(j.modelid), maker: "Philips Hue", via: "Hue" };
}

async function shelly(ip: string): Promise<Identity | null> {
  const j = await getJson(`http://${ip}/shelly`);
  if (!j || !(j.type || j.model || j.gen)) return null;
  return {
    name: text(j.name) ?? undefined,
    model: text(j.model) ?? text(j.type),
    maker: "Shelly",
    via: "Shelly",
  };
}

async function wled(ip: string): Promise<Identity | null> {
  const j = await getJson(`http://${ip}/json/info`);
  if (!j || typeof j.ver !== "string" || typeof j.leds !== "object") return null;
  return { name: text(j.name), model: "WLED", maker: "WLED", via: "WLED" };
}

async function tasmota(ip: string): Promise<Identity | null> {
  const j = await getJson(`http://${ip}/cm?cmnd=Status`);
  const s = j?.Status as Record<string, unknown> | undefined;
  if (!s) return null;
  const names = s.DeviceName ?? s.FriendlyName;
  return {
    name: Array.isArray(names) ? text(names[0]) : text(names),
    model: "Tasmota",
    maker: "Tasmota",
    via: "Tasmota",
  };
}

/** Its own web page's title, as a last clue (printers, routers, cameras often have one). */
async function webTitle(ip: string): Promise<Identity | null> {
  const html = await getText(`http://${ip}/`);
  const t = html?.match(/<title[^>]*>([^<]{2,80})<\/title>/i)?.[1]?.trim();
  return t && !genericTitle(t) ? { name: t, via: "its web page" } : null;
}

// ---------------------------------------------------------------------------
// Bonjour / mDNS: "what's the name for this address?", asked of the device itself

export function dnsName(buf: Buffer, start: number): { name: string; end: number } {
  const parts: string[] = [];
  let off = start;
  let end = -1;
  for (let i = 0; i < 128 && off < buf.length; i++) {
    const len = buf[off] as number;
    if (len === 0) {
      if (end < 0) end = off + 1;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (end < 0) end = off + 2;
      off = ((len & 0x3f) << 8) | (buf[off + 1] as number);
      continue;
    }
    parts.push(buf.subarray(off + 1, off + 1 + len).toString("utf8"));
    off += 1 + len;
  }
  return { name: parts.join("."), end: end < 0 ? off : end };
}

/** Ask the device on port 5353 for its own name (a unicast mDNS question: it answers just us). */
export function mdnsName(ip: string, timeoutMs = SHORT, port = 5353): Promise<string | null> {
  return new Promise((resolve) => {
    const labels = `${ip.split(".").reverse().join(".")}.in-addr.arpa`.split(".");
    const query = Buffer.concat([
      Buffer.from([0x48, 0x45, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]),
      ...labels.map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])),
      Buffer.from([0, 0x00, 0x0c, 0x00, 0x01]), // end of name; PTR; IN
    ]);
    const sock = dgram.createSocket("udp4");
    let settled = false;
    const done = (v: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const r of resends) clearTimeout(r);
      try {
        sock.close();
      } catch {
        // Already closed.
      }
      resolve(v);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    sock.on("error", () => done(null));
    sock.on("message", (msg, from) => {
      if (from.address !== ip) return;
      try {
        if (msg.readUInt16BE(6) < 1) return done(null);
        let off = 12;
        for (let i = 0; i < msg.readUInt16BE(4); i++) off = dnsName(msg, off).end + 4;
        const answer = dnsName(msg, off);
        const name = dnsName(msg, answer.end + 10).name.replace(/\.local\.?$/i, "");
        done(name || null);
      } catch {
        done(null);
      }
    });
    // A question can be lost (a Wi-Fi device dozing, or the first packet sent before the network
    // knows where the device is), and UDP doesn't resend by itself: ask three times, a moment apart.
    const send = () =>
      sock.send(query, port, ip, (err) => {
        if (err) done(null);
      });
    const resends = [timeoutMs / 4, timeoutMs / 2].map((ms) =>
      setTimeout(() => {
        if (!settled) send();
      }, ms),
    );
    send();
  });
}

/** Everything a device will say about itself. The device's own words win over its web page. */
export async function identify(address: string): Promise<Identity | null> {
  const ip = privateIp(address);
  if (!ip) return null;
  const [c, r, s, h, sh, w, t, m] = await Promise.all([
    cast(ip),
    roku(ip),
    sonos(ip),
    hue(ip),
    shelly(ip),
    wled(ip),
    tasmota(ip),
    mdnsName(ip),
  ]);
  const own = [c, r, s, h, sh, w, t].find((x) => x?.name || x?.model);
  if (own) return own.name ? own : { ...own, name: m ?? undefined };
  if (m) return { name: m, via: "Bonjour" };
  return webTitle(ip);
}
