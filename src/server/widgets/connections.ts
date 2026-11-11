/**
 * What widgets can read without anyone typing an address or a key: Hearth's own data, and the
 * systems already connected in Settings (AdGuard Home, the smart-home hubs, the AI servers).
 *
 * A "connection" source asks one of those systems' APIs with the sign-in Hearth keeps for it. The
 * key is added on the server and never reaches the widget or the page, and only GET is allowed, so
 * a widget can read but never change anything.
 */
import { type Access, accessSecret } from "../../shared/access";
import { APPS, type AppDef } from "../../shared/catalog";
import type { HearthConfig } from "../../shared/config";
import type { HearthWhat } from "../../shared/widget-doc";
import { guardedFetch } from "../net";
import type { SecretStore } from "../secrets";
import { digestAuthorization, parseChallenge } from "./digest";

/** How the server signs in to a connection: headers, a digest, or a key in the address. */
export interface SignIn {
  headers: Record<string, string>;
  /** "user:password" for an HTTP Digest challenge. */
  digest?: string;
  query?: { param: string; value: string };
}

export interface Connection {
  /** What a source names: "adguard", "homeassistant", "openhab", "ai:<server id>". */
  to: string;
  name: string;
  /** Its address (shown to the admin, who set it). */
  base: string;
  /** Paths worth starting from, with what they hold. */
  paths: { get: string; label: string }[];
  /** Whether Hearth has its sign-in. */
  signedIn: boolean;
}

/** Hearth's own data a widget can use, and what's in it. */
export const HEARTH_DATA: { what: HearthWhat; name: string; hint: string }[] = [
  { what: "status", name: "Services", hint: "Every tile's status: up, slow or down" },
  { what: "devices", name: "Devices", hint: "Every saved device: online or not, its services" },
  { what: "network", name: "Network map", hint: "What's connected to the router and each node" },
  { what: "machines", name: "AI computers", hint: "The computers an AI server shares work with" },
  { what: "ai", name: "AI servers", hint: "Each AI server: up, its models, what's loaded" },
  { what: "pinball", name: "Pinball", hint: "What's playing, high scores and players" },
  {
    what: "smarthome",
    name: "Smart home",
    hint: "Readings and switches from openHAB or Home Assistant",
  },
  { what: "host", name: "This server", hint: "Hearth's machine: load, memory and disk" },
  { what: "time", name: "The time", hint: "Now, the hour, the weekday" },
];

const basic = (user: string, pass: string) =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

/** The connected systems, each with how to sign in to it (for the server only). */
export function connections(
  cfg: HearthConfig,
  secrets: SecretStore,
  extra: AppDef[] = [],
): (Connection & SignIn)[] {
  const s = cfg.settings;
  const out: (Connection & SignIn)[] = [];
  if (s.adguard.url) {
    const pass = secrets.get("adguard:password");
    const signedIn = Boolean(s.adguard.username && pass);
    out.push({
      to: "adguard",
      name: "AdGuard Home",
      base: s.adguard.url,
      signedIn,
      headers: signedIn
        ? { Authorization: basic(s.adguard.username as string, pass as string) }
        : {},
      paths: [
        { get: "/control/stats", label: "Lookups and blocks, today and by hour" },
        { get: "/control/status", label: "Running, protection on, version" },
        { get: "/control/filtering/status", label: "Block lists and their rules" },
      ],
    });
  }
  const hub = (kind: "homeassistant" | "openhab", name: string, paths: Connection["paths"]) => {
    const url = s.smarthome[kind]?.url;
    if (!url) return;
    const token = secrets.get(`smarthome:${kind}`);
    out.push({
      to: kind,
      name,
      base: url,
      signedIn: Boolean(token),
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      paths,
    });
  };
  hub("homeassistant", "Home Assistant", [
    { get: "/api/states", label: "Every entity and its state" },
    { get: "/api/config", label: "Its name, place and version" },
  ]);
  hub("openhab", "openHAB", [
    { get: "/rest/items", label: "Every item and its state" },
    { get: "/rest/things", label: "Every thing and whether it's online" },
    { get: "/rest/systeminfo", label: "The machine it runs on" },
  ]);
  for (const ai of s.ai.servers) {
    const key = secrets.get(`ai:${ai.id}`);
    out.push({
      to: `ai:${ai.id}`,
      name: ai.name,
      base: ai.url,
      signedIn: true,
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      paths:
        ai.kind === "ollama"
          ? [
              { get: "/api/ps", label: "Models loaded now" },
              { get: "/api/tags", label: "Every model it has" },
              { get: "/api/machines", label: "Its computers (a shared AI server)" },
            ]
          : [{ get: "/models", label: "Every model it has" }],
    });
  }
  // Apps given access on the Devices page.
  const apps = [...APPS, ...extra];
  for (const a of s.access) {
    const app = apps.find((x) => x.id === a.app);
    let host = a.base;
    try {
      host = new URL(a.base).host;
    } catch {
      // Shown as saved.
    }
    const secret = secrets.get(accessSecret(a.id));
    out.push({
      to: `app:${a.id}`,
      name: `${app?.name ?? a.app} (${host})`,
      base: a.base,
      signedIn: Boolean(secret),
      ...(secret ? signIn(a, secret) : { headers: {} }),
      paths: appPaths(app),
    });
  }
  return out;
}

/** How to send an access's key: as its app takes it. */
export function signIn(a: Pick<Access, "kind" | "header" | "param">, secret: string): SignIn {
  switch (a.kind) {
    case "header":
      return { headers: { [a.header ?? "X-Api-Key"]: secret } };
    case "bearer":
      return { headers: { Authorization: `Bearer ${secret}` } };
    case "basic": {
      const at = secret.indexOf(":");
      return {
        headers: {
          Authorization: basic(secret.slice(0, Math.max(0, at)), secret.slice(at + 1)),
        },
      };
    }
    case "digest":
      return { headers: {}, digest: secret };
    case "query":
      return { headers: {}, query: { param: a.param ?? "apikey", value: secret } };
  }
}

/** The API paths an app's own widgets read, as places to start. */
export function appPaths(app?: AppDef): Connection["paths"] {
  const out: Connection["paths"] = [];
  for (const wd of app?.widgets ?? [])
    for (const src of wd.doc.sources ?? []) {
      if (src.kind !== "http" || !src.url.startsWith("{{base}}")) continue;
      const get = src.url
        .slice("{{base}}".length)
        .replace(/[?&][A-Za-z0-9_.-]+=\{\{secret:key\}\}/, "")
        .replace(/\{\{param:[a-z0-9_]+\}\}/gi, "");
      if (get && !out.some((x) => x.get === get))
        out.push({ get, label: wd.name.replace(/^[^:]+:\s*/, "") });
    }
  return out.slice(0, 8);
}

/**
 * The address a connection source asks: its path on the system's own address, and nowhere else
 * (a path can't lead to another host).
 */
export function connectionUrl(base: string, get: string): string {
  const root = new URL(base.endsWith("/") ? base : `${base}/`);
  const url = new URL(get.replace(/^\/+/, ""), root);
  if (url.origin !== root.origin) throw new Error("That path leads somewhere else.");
  return url.href;
}

/** The connected systems as the admin and the designer see them: no sign-ins. */
export function publicConnections(cfg: HearthConfig, secrets: SecretStore): Connection[] {
  return connections(cfg, secrets).map(({ headers: _h, digest: _d, query: _q, ...rest }) => rest);
}

/**
 * Ask a connection's path, signed in as it takes it (headers, a key in the address, or a Digest
 * challenge answered). GET only, home network only.
 */
export async function readConnection(
  conn: { base: string } & SignIn,
  get: string,
  f?: typeof fetch,
): Promise<Awaited<ReturnType<typeof guardedFetch>>> {
  let url = connectionUrl(conn.base, get);
  if (conn.query) {
    const u = new URL(url);
    u.searchParams.set(conn.query.param, conn.query.value);
    url = u.href;
  }
  const headers = { accept: "application/json", ...conn.headers };
  const ask = (extra: Record<string, string> = {}) =>
    guardedFetch(url, {
      method: "GET",
      headers: { ...headers, ...extra },
      // Connected systems are on the home network, whatever the internet setting says.
      policy: { allowInternet: false },
      fetch: f,
    });
  let res = await ask();
  const challenge =
    conn.digest && res.status === 401
      ? parseChallenge(res.headers.get("www-authenticate") ?? "")
      : null;
  if (conn.digest && challenge) {
    const at = conn.digest.indexOf(":");
    const u = new URL(url);
    res = await ask({
      Authorization: digestAuthorization(
        challenge,
        "GET",
        `${u.pathname}${u.search}`,
        conn.digest.slice(0, Math.max(0, at)),
        conn.digest.slice(at + 1),
      ),
    });
  }
  return res;
}
