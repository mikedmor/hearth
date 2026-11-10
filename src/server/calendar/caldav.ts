/**
 * A small CalDAV client (RFC 4791): find someone's calendars from a server's address, read the
 * events in a range, and save or delete one. Works with Synology Calendar, Nextcloud, iCloud,
 * Fastmail, Radicale and the like. Every request goes through the network guard.
 */
import { type FetchResult, guardedFetch, type NetPolicy, parseXml } from "../net";

export class CalDavError extends Error {}

export interface DavAuth {
  username: string;
  password: string;
}

export interface DavOptions {
  policy: NetPolicy;
  fetch?: typeof fetch;
}

export interface DavCalendar {
  url: string;
  name: string;
  color?: string;
  readOnly: boolean;
}

export interface DavObject {
  href: string;
  etag?: string;
  ics: string;
}

type Xml = Record<string, unknown>;

/** Drop namespace prefixes ("d:response" → "response"), so any server's XML reads the same. */
function bare(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(bare);
  if (!v || typeof v !== "object") return v;
  const out: Xml = {};
  for (const [k, val] of Object.entries(v)) {
    const at = k.startsWith("@") ? "@" : "";
    const raw = at ? k.slice(1) : k;
    const name = at + (raw.includes(":") ? raw.slice(raw.indexOf(":") + 1) : raw);
    const value = bare(val);
    if (Object.hasOwn(out, name))
      out[name] = ([] as unknown[]).concat(out[name] as unknown[], value as unknown[]);
    else out[name] = value;
  }
  return out;
}
const list = (v: unknown): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const obj = (v: unknown): Xml => (v && typeof v === "object" ? (v as Xml) : {});
const str = (v: unknown): string | undefined =>
  typeof v === "string"
    ? v
    : typeof obj(v)["#text"] === "string"
      ? (obj(v)["#text"] as string)
      : undefined;

interface DavResponse {
  href: string;
  props: Xml;
}

/** A multistatus answer: each resource with the properties that came back 200 OK. */
function responses(xml: string): DavResponse[] {
  const doc = obj(bare(parseXml(xml)));
  return list(obj(doc.multistatus).response).map((r) => {
    const resp = obj(r);
    const props: Xml = {};
    for (const ps of list(resp.propstat)) {
      const p = obj(ps);
      if (str(p.status) && !/\s200\s/.test(` ${str(p.status)} `)) continue;
      Object.assign(props, obj(p.prop));
    }
    return { href: str(resp.href) ?? "", props };
  });
}

const PROPFIND_START = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:current-user-principal/><c:calendar-home-set/><d:resourcetype/><d:displayname/></d:prop>
</d:propfind>`;

const PROPFIND_CALENDARS = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/" xmlns:cs="http://calendarserver.org/ns/">
  <d:prop>
    <d:resourcetype/><d:displayname/><a:calendar-color/>
    <c:supported-calendar-component-set/><d:current-user-privilege-set/>
  </d:prop>
</d:propfind>`;

const davTime = (ms: number) =>
  new Date(ms)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

const queryBody = (from: number, to: number) => `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">
    <c:time-range start="${davTime(from)}" end="${davTime(to)}"/>
  </c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`;

/** The same address, however each side encoded it ("%40" or "@"). */
export function sameHref(a: string, b: string): boolean {
  const norm = (x: string) => {
    try {
      return decodeURIComponent(new URL(x).pathname);
    } catch {
      return x;
    }
  };
  return a === b || norm(a) === norm(b);
}

export class CalDav {
  constructor(
    private readonly auth: DavAuth,
    private readonly opts: DavOptions,
  ) {}

  private async request(
    method: "PROPFIND" | "REPORT" | "PUT" | "DELETE" | "GET",
    url: string,
    extra: { body?: string; depth?: "0" | "1"; headers?: Record<string, string> } = {},
  ): Promise<FetchResult & { url: string }> {
    const basic = Buffer.from(`${this.auth.username}:${this.auth.password}`).toString("base64");
    const res = await guardedFetch(url, {
      method,
      policy: this.opts.policy,
      fetch: this.opts.fetch,
      timeoutMs: 15_000,
      maxBytes: 20 * 1024 * 1024,
      body: extra.body,
      headers: {
        authorization: `Basic ${basic}`,
        accept: "application/xml, text/xml, text/calendar, */*",
        ...(extra.body
          ? {
              "content-type":
                method === "PUT"
                  ? "text/calendar; charset=utf-8"
                  : "application/xml; charset=utf-8",
            }
          : {}),
        ...(extra.depth ? { depth: extra.depth } : {}),
        ...extra.headers,
      },
    });
    if (res.status === 401 || res.status === 403)
      throw new CalDavError(
        "The server didn't accept that username and password. (iCloud and Google need an app-specific password.)",
      );
    return { ...res, url };
  }

  private async propfind(url: string, body: string, depth: "0" | "1") {
    const res = await this.request("PROPFIND", url, { body, depth });
    if (res.status === 404) return null;
    if (res.status !== 207)
      throw new CalDavError(
        `${new URL(url).host} answered ${res.status} (is this a CalDAV address?).`,
      );
    return responses(res.body.toString("utf8"));
  }

  /**
   * The calendars at a server, from almost any address: the server itself (it's asked for
   * /.well-known/caldav), the account's home, or one calendar.
   */
  async discover(address: string): Promise<DavCalendar[]> {
    const start = new URL(address);
    let found = await this.propfind(start.href, PROPFIND_START, "0");
    let at = start.href;
    if (!found?.length || (!hasCalendar(found[0]) && !homeOf(found) && !principalOf(found))) {
      const known = new URL("/.well-known/caldav", start).href;
      found = await this.propfind(known, PROPFIND_START, "0");
      at = known;
    }
    if (!found?.length) throw new CalDavError("No CalDAV calendars were found at that address.");
    if (hasCalendar(found[0])) {
      const one = await this.calendarsIn(at, "0");
      if (one.length) return one;
    }
    let home = homeOf(found);
    const principal = principalOf(found);
    if (!home && principal) {
      const p = await this.propfind(new URL(principal, at).href, PROPFIND_START, "0");
      home = p ? homeOf(p) : undefined;
    }
    if (!home) throw new CalDavError("The server didn't say where this account's calendars are.");
    const calendars = await this.calendarsIn(new URL(home, at).href, "1");
    if (!calendars.length) throw new CalDavError("That account has no calendars with events.");
    return calendars;
  }

  private async calendarsIn(url: string, depth: "0" | "1"): Promise<DavCalendar[]> {
    const rs = (await this.propfind(url, PROPFIND_CALENDARS, depth)) ?? [];
    return rs
      .filter((r) => hasCalendar(r) && takesEvents(r))
      .map((r) => {
        const color = str(r.props["calendar-color"])?.match(/^#[0-9a-f]{6}/i)?.[0];
        return {
          url: new URL(r.href, url).href,
          name: str(r.props.displayname)?.trim() || lastPart(r.href),
          color,
          readOnly: !writable(r),
        };
      });
  }

  /** Every event object that has something between `from` and `to`. */
  async query(calendarUrl: string, from: number, to: number): Promise<DavObject[]> {
    const res = await this.request("REPORT", calendarUrl, {
      body: queryBody(from, to),
      depth: "1",
    });
    if (res.status !== 207)
      throw new CalDavError(`The calendar answered ${res.status} when asked for its events.`);
    return responses(res.body.toString("utf8")).flatMap((r) => {
      const ics = str(r.props["calendar-data"]);
      if (!ics) return [];
      return [{ href: new URL(r.href, calendarUrl).href, etag: str(r.props.getetag), ics }];
    });
  }

  /** Save an event: a new one with `href` unset (it goes in as `<uid>.ics`), or a change. */
  async put(
    calendarUrl: string,
    ics: string,
    target: { uid: string } | { href: string; etag?: string },
  ): Promise<{ href: string; etag?: string }> {
    const href =
      "href" in target
        ? target.href
        : new URL(`${encodeURIComponent(target.uid)}.ics`, withSlash(calendarUrl)).href;
    const res = await this.request("PUT", href, {
      body: ics,
      headers:
        "href" in target
          ? target.etag
            ? { "if-match": target.etag }
            : {}
          : { "if-none-match": "*" },
    });
    if (res.status === 412)
      throw new CalDavError("Someone changed that event elsewhere just now. Look again and retry.");
    if (res.status < 200 || res.status >= 300)
      throw new CalDavError(`The calendar wouldn't save it (it answered ${res.status}).`);
    return { href, etag: res.headers.get("etag") ?? undefined };
  }

  async remove(href: string, etag?: string): Promise<void> {
    const res = await this.request("DELETE", href, { headers: etag ? { "if-match": etag } : {} });
    if (res.status === 404) return;
    if (res.status === 412)
      throw new CalDavError("Someone changed that event elsewhere just now. Look again and retry.");
    if (res.status < 200 || res.status >= 300)
      throw new CalDavError(`The calendar wouldn't delete it (it answered ${res.status}).`);
  }
}

const withSlash = (u: string) => (u.endsWith("/") ? u : `${u}/`);
const lastPart = (href: string) => href.replace(/\/+$/, "").split("/").pop() || "Calendar";

const hasCalendar = (r: DavResponse | undefined) =>
  !!r && Object.hasOwn(obj(r.props.resourcetype), "calendar");
/** Calendars that hold events (not only to-dos). Saying nothing means it takes anything. */
const takesEvents = (r: DavResponse) => {
  const comps = list(obj(r.props["supported-calendar-component-set"]).comp);
  return !comps.length || comps.some((c) => String(obj(c)["@name"]).toUpperCase() === "VEVENT");
};
const writable = (r: DavResponse) => {
  const privs = r.props["current-user-privilege-set"];
  if (privs === undefined) return true;
  const text = JSON.stringify(privs);
  return /"(write|write-content|all|bind)"/.test(text);
};
function homeOf(rs: DavResponse[]): string | undefined {
  for (const r of rs) {
    const h = str(obj(r.props["calendar-home-set"]).href);
    if (h) return h;
  }
  return undefined;
}
function principalOf(rs: DavResponse[]): string | undefined {
  for (const r of rs) {
    const p = str(obj(r.props["current-user-principal"]).href);
    if (p) return p;
  }
  return undefined;
}
