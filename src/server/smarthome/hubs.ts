/**
 * Reading the home's smart-home hubs, and switching what they control.
 *
 * - **openHAB:** its REST API with an API token (Profile → API tokens). Things (devices, with
 *   their settings: often an address) and the items linked to their channels (states, commands).
 * - **Home Assistant:** its REST API with a long-lived token (Profile → Security). Its device list
 *   isn't in the REST API, so Hearth asks its template engine which entity belongs to which device
 *   (read only), then reads the states.
 *
 * Both are on the home network: requests go through the network guard, never to the internet.
 */
import { isIP } from "node:net";
import type { HubKind, SmartPoint, SmartThing } from "../../shared/smarthome";
import { guardedFetch, NetError } from "../net";

export class HubError extends Error {}

export interface HubConn {
  kind: HubKind;
  url: string;
  token?: string;
  fetch?: typeof fetch;
}

const HOME = { allowInternet: false } as const;
const base = (c: HubConn) => c.url.replace(/\/+$/, "");

async function call(
  c: HubConn,
  path: string,
  init: { method?: "GET" | "POST"; body?: string; type?: string } = {},
): Promise<unknown> {
  let r: Awaited<ReturnType<typeof guardedFetch>>;
  try {
    r = await guardedFetch(`${base(c)}${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...(c.token ? { authorization: `Bearer ${c.token}` } : {}),
        ...(init.body !== undefined ? { "content-type": init.type ?? "application/json" } : {}),
      },
      body: init.body,
      policy: HOME,
      fetch: c.fetch,
      timeoutMs: 8000,
      maxBytes: 16 * 1024 * 1024,
    });
  } catch (e) {
    throw new HubError(e instanceof NetError ? e.message : "It didn't answer.");
  }
  if (r.status === 401 || r.status === 403)
    throw new HubError("It refused the token: make a new one and save it again.");
  if (r.status >= 400) throw new HubError(`It answered ${r.status}.`);
  const text = r.body.toString("utf8");
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const str = (v: unknown, n = 120) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined;
const MAC = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;
const normalMac = (m: string) => m.toLowerCase().replace(/-/g, ":");

/** The version, to check it answers and the token works. */
export async function hubVersion(c: HubConn): Promise<string | undefined> {
  if (c.kind === "openhab") {
    const info = (await call(c, "/rest/")) as { runtimeInfo?: { version?: string } } | null;
    // The things list needs the token, so check it too.
    await call(c, "/rest/things?summary=true");
    return info?.runtimeInfo?.version;
  }
  const cfg = (await call(c, "/api/config")) as { version?: string } | null;
  return cfg?.version;
}

// ---------------------------------------------------------------------------
// openHAB

interface OhItem {
  name: string;
  label?: string;
  type?: string;
  state?: string;
  transformedState?: string;
  stateDescription?: { readOnly?: boolean; pattern?: string };
}
interface OhThing {
  UID: string;
  label?: string;
  statusInfo?: { status?: string };
  configuration?: Record<string, unknown>;
  properties?: Record<string, string>;
  channels?: { linkedItems?: string[] }[];
}

function ohPoint(item: OhItem): SmartPoint {
  const type = (item.type ?? "").split(":")[0];
  const raw = item.transformedState ?? item.state ?? "";
  const missing = raw === "NULL" || raw === "UNDEF" || raw === "";
  const kind: SmartPoint["kind"] =
    type === "Switch"
      ? "switch"
      : type === "Dimmer"
        ? "dimmer"
        : type === "Contact"
          ? "contact"
          : type === "Number" || type === "Rollershutter"
            ? "number"
            : "text";
  const state = missing
    ? "—"
    : kind === "switch"
      ? raw === "ON"
        ? "On"
        : "Off"
      : kind === "contact"
        ? raw === "OPEN"
          ? "Open"
          : "Closed"
        : kind === "dimmer"
          ? `${raw}%`
          : raw;
  return {
    id: item.name,
    label: str(item.label) ?? item.name,
    kind,
    state: state.slice(0, 60),
    on: kind === "switch" ? raw === "ON" : kind === "dimmer" ? Number(raw) > 0 : undefined,
    canControl: (kind === "switch" || kind === "dimmer") && !item.stateDescription?.readOnly,
  };
}

async function openhabThings(c: HubConn): Promise<SmartThing[]> {
  const [things, items] = (await Promise.all([
    call(c, "/rest/things"),
    call(c, "/rest/items?recursive=false"),
  ])) as [OhThing[] | null, OhItem[] | null];
  const byName = new Map((items ?? []).map((i) => [i.name, i]));
  return (things ?? []).map((t) => {
    const values = [
      ...Object.values(t.configuration ?? {}),
      ...Object.values(t.properties ?? {}),
    ].filter((v): v is string => typeof v === "string");
    const linked = [...new Set((t.channels ?? []).flatMap((ch) => ch.linkedItems ?? []))];
    return {
      hub: "openhab",
      key: `openhab:${t.UID}`,
      name: str(t.label) ?? t.UID,
      status: str(t.statusInfo?.status, 20),
      hosts: values.filter((v) => isIP(v) || /^[a-z0-9][\w.-]*\.(local|lan|home)$/i.test(v)),
      macs: values.filter((v) => MAC.test(v)).map(normalMac),
      maker: str(t.properties?.vendor),
      model: str(t.properties?.modelId ?? t.properties?.model),
      points: linked
        .map((n) => byName.get(n))
        .filter((i): i is OhItem => !!i)
        .map(ohPoint)
        .slice(0, 30),
    } satisfies SmartThing;
  });
}

// ---------------------------------------------------------------------------
// Home Assistant

/** Which entity is which device's, from the template engine (the REST API doesn't say). */
const HA_DEVICES = `{%- set ns = namespace(out=[]) -%}
{%- for s in states -%}
{%- set d = device_id(s.entity_id) -%}
{%- if d -%}
{%- set ns.out = ns.out + [[d, s.entity_id, device_attr(d, 'name_by_user') or device_attr(d, 'name'), device_attr(d, 'manufacturer'), device_attr(d, 'model'), (device_attr(d, 'connections') or []) | list]] -%}
{%- endif -%}
{%- endfor -%}
{{ ns.out | to_json }}`;

interface HaState {
  entity_id: string;
  state: string;
  attributes?: { friendly_name?: string; unit_of_measurement?: string; device_class?: string };
}

const CONTROL = new Set(["switch", "light", "fan", "input_boolean"]);

function haPoint(s: HaState): SmartPoint {
  const domain = s.entity_id.split(".")[0] ?? "";
  const a = s.attributes ?? {};
  const label = str(a.friendly_name) ?? s.entity_id;
  const missing = s.state === "unavailable" || s.state === "unknown";
  if (CONTROL.has(domain))
    return {
      id: s.entity_id,
      label,
      kind: "switch",
      state: missing ? "—" : s.state === "on" ? "On" : "Off",
      on: s.state === "on",
      canControl: !missing,
    };
  if (domain === "binary_sensor") {
    const on = s.state === "on";
    const words: Record<string, [string, string]> = {
      moisture: ["Wet", "Dry"],
      smoke: ["Smoke", "Clear"],
      door: ["Open", "Closed"],
      window: ["Open", "Closed"],
      motion: ["Motion", "Still"],
      problem: ["Problem", "OK"],
      battery: ["Low", "OK"],
    };
    const [yes, no] = words[a.device_class ?? ""] ?? ["On", "Off"];
    return {
      id: s.entity_id,
      label,
      kind: "contact",
      state: missing ? "—" : on ? yes : no,
      canControl: false,
    };
  }
  return {
    id: s.entity_id,
    label,
    kind: domain === "sensor" ? "number" : "text",
    state: missing
      ? "—"
      : `${s.state}${a.unit_of_measurement ? ` ${a.unit_of_measurement}` : ""}`.slice(0, 60),
    canControl: false,
  };
}

async function homeAssistantThings(c: HubConn): Promise<SmartThing[]> {
  const [rendered, states] = await Promise.all([
    call(c, "/api/template", { method: "POST", body: JSON.stringify({ template: HA_DEVICES }) }),
    call(c, "/api/states"),
  ]);
  let rows: unknown[] = [];
  try {
    rows =
      typeof rendered === "string" ? JSON.parse(rendered) : Array.isArray(rendered) ? rendered : [];
  } catch {
    rows = [];
  }
  const byEntity = new Map(((states as HaState[] | null) ?? []).map((s) => [s.entity_id, s]));
  const things = new Map<string, SmartThing>();
  for (const r of rows) {
    if (!Array.isArray(r)) continue;
    const [id, entity, name, maker, model, connections] = r as [
      string,
      string,
      string | null,
      string | null,
      string | null,
      [string, string][] | null,
    ];
    if (typeof id !== "string" || typeof entity !== "string") continue;
    const t =
      things.get(id) ??
      ({
        hub: "homeassistant",
        key: `homeassistant:${id}`,
        name: str(name) ?? id,
        hosts: [],
        macs: (connections ?? [])
          .filter((x) => Array.isArray(x) && x[0] === "mac" && MAC.test(String(x[1])))
          .map((x) => normalMac(String(x[1]))),
        maker: str(maker),
        model: str(model),
        points: [],
      } satisfies SmartThing);
    const s = byEntity.get(entity);
    if (s && t.points.length < 30) t.points.push(haPoint(s));
    things.set(id, t);
  }
  return [...things.values()];
}

// ---------------------------------------------------------------------------

/** Every device a hub knows, with its readings. */
export function hubThings(c: HubConn): Promise<SmartThing[]> {
  return c.kind === "openhab" ? openhabThings(c) : homeAssistantThings(c);
}

/** Switch something: on or off (a dimmer: off, or full). */
export async function hubSwitch(c: HubConn, point: string, on: boolean): Promise<void> {
  if (c.kind === "openhab") {
    if (!/^[\w-]{1,120}$/.test(point)) throw new HubError("That isn't an item.");
    await call(c, `/rest/items/${encodeURIComponent(point)}`, {
      method: "POST",
      body: on ? "ON" : "OFF",
      type: "text/plain",
    });
    return;
  }
  const domain = point.split(".")[0] ?? "";
  if (!CONTROL.has(domain) || !/^[a-z_]+\.[\w-]{1,120}$/.test(point))
    throw new HubError("That can't be switched.");
  await call(c, `/api/services/${domain}/turn_${on ? "on" : "off"}`, {
    method: "POST",
    body: JSON.stringify({ entity_id: point }),
  });
}
