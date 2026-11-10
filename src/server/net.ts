/**
 * Every request Hearth makes for a widget goes through here:
 * - only to the home network, unless the admin allowed the internet (Settings → Network);
 * - redirects are followed by hand, and each hop is checked again;
 * - answers are capped in size and time.
 */
import { isLocalUrl } from "../shared/config";

export class NetError extends Error {}

const CERT_CODES = new Set([
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

export interface NetPolicy {
  allowInternet: boolean;
}

const PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"]);

export function checkTarget(address: string, policy: NetPolicy): URL {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new NetError("That isn't a full address (it needs http:// or ws://).");
  }
  if (!PROTOCOLS.has(url.protocol))
    throw new NetError(`${url.protocol} addresses aren't supported.`);
  if (!policy.allowInternet && !isLocalUrl(url.href)) {
    throw new NetError(
      `${url.hostname} is on the internet. Hearth only calls the home network unless the admin allows the internet (Settings).`,
    );
  }
  return url;
}

export interface FetchOptions {
  /** Calendars also use PROPFIND, REPORT, PUT, PATCH and DELETE. */
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "PROPFIND" | "REPORT";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  policy: NetPolicy;
  fetch?: typeof fetch;
}

export interface FetchResult {
  status: number;
  contentType: string;
  body: Buffer;
  ms: number;
  headers: Headers;
}

/** GET or POST with the guard, a timeout and a size cap. */
export async function guardedFetch(address: string, opts: FetchOptions): Promise<FetchResult> {
  const doFetch = opts.fetch ?? fetch;
  const started = Date.now();
  let url = checkTarget(address, opts.policy);
  const origin = url.origin;
  const method = opts.method ?? "GET";
  // A POST that's redirected becomes a GET, as browsers do; the others (CalDAV's) keep going as
  // they are, so a server's /.well-known/caldav can point elsewhere.
  const keeps = method !== "GET" && method !== "POST";
  for (let hop = 0; hop < 4; hop++) {
    let res: Response;
    const again = hop > 0 && !keeps;
    const headers: Record<string, string> = {
      "user-agent": "Hearth",
      accept: "application/json, */*",
      ...opts.headers,
    };
    // A password or token never goes on to another site.
    if (url.origin !== origin)
      for (const k of Object.keys(headers))
        if (k.toLowerCase() === "authorization") delete headers[k];
    try {
      res = await doFetch(url, {
        method: again ? "GET" : method,
        headers,
        body: again || method === "GET" ? undefined : opts.body,
        redirect: "manual",
        signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
      });
    } catch (e) {
      const err = e as Error & { cause?: { code?: string } };
      if (err.name === "TimeoutError") throw new NetError(`${url.host} didn't answer in time.`);
      if (CERT_CODES.has(err.cause?.code ?? "")) {
        throw new NetError(
          `Hearth doesn't trust ${url.host}'s certificate. Give it the home's root certificate (NODE_EXTRA_CA_CERTS; the NAS's compose file does), or use the service's http:// address on the NAS.`,
        );
      }
      throw new NetError(
        `Couldn't reach ${url.host}${err.cause?.code ? ` (${err.cause.code})` : ""}.`,
      );
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel().catch(() => {});
      url = checkTarget(new URL(res.headers.get("location") as string, url).href, opts.policy);
      continue;
    }
    const body = await readLimited(res, opts.maxBytes ?? 2 * 1024 * 1024);
    return {
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      body,
      ms: Date.now() - started,
      headers: res.headers,
    };
  }
  throw new NetError("Too many redirects.");
}

async function readLimited(res: Response, max: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new NetError(`The answer is bigger than ${Math.round(max / 1024)} KB.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Parse an answer as JSON; text that isn't JSON comes back as a string. */
export function parseBody(r: FetchResult): unknown {
  const text = r.body.toString("utf8");
  if (r.contentType.includes("json") || /^\s*[[{"]/.test(text)) {
    try {
      return JSON.parse(text);
    } catch {
      // Fall through to text.
    }
  }
  if (r.contentType.includes("xml") || /^\s*<\?xml|^\s*<(rss|feed)[\s>]/i.test(text)) {
    const x = parseXml(text);
    if (x) return x;
  }
  return text;
}

const XML_TOKEN =
  /<!\[CDATA\[([\s\S]*?)\]\]>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const XML_ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");

interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  kids: [string, unknown][];
  text: string;
}

function finishXml(n: XmlNode): unknown {
  const attrs = Object.entries(n.attrs);
  const text = n.text.trim();
  if (!n.kids.length && !attrs.length) return text;
  const out: Record<string, unknown> = {};
  for (const [k, v] of attrs) out[`@${k}`] = v;
  for (const [k, v] of n.kids) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    if (Object.hasOwn(out, k))
      out[k] = Array.isArray(out[k]) ? [...(out[k] as unknown[]), v] : [out[k], v];
    else out[k] = v;
  }
  if (text) out["#text"] = text;
  return out;
}

/**
 * Small XML to data, enough for RSS and Atom: elements become fields, repeated ones lists,
 * attributes "@name", text "#text" (or the element itself when it has nothing else). CDATA is text.
 */
export function parseXml(xml: string): Record<string, unknown> | null {
  const src = xml.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>/gi, "");
  const root: XmlNode = { name: "#root", attrs: {}, kids: [], text: "" };
  const stack: XmlNode[] = [root];
  let steps = 0;
  const close = () => {
    const done = stack.pop() as XmlNode;
    (stack[stack.length - 1] as XmlNode).kids.push([done.name, finishXml(done)]);
  };
  for (const m of src.matchAll(XML_TOKEN)) {
    if (++steps > 200_000) break;
    const top = stack[stack.length - 1] as XmlNode;
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2] !== undefined) {
      if (stack.length > 1) close();
    } else if (m[3] !== undefined) {
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? "").matchAll(XML_ATTR))
        attrs[a[1] as string] = decodeXml(a[2] ?? a[3] ?? "");
      const node: XmlNode = { name: m[3], attrs, kids: [], text: "" };
      if (m[5] === "/") top.kids.push([node.name, finishXml(node)]);
      else if (stack.length < 64) stack.push(node);
    } else if (m[6] !== undefined) top.text += decodeXml(m[6]);
  }
  while (stack.length > 1) close();
  const out = finishXml(root);
  return out && typeof out === "object" ? (out as Record<string, unknown>) : null;
}

/** A short copy of some data for the designer: long lists and texts are cut. */
export function sample(value: unknown, depth = 0): unknown {
  if (depth > 6) return "…";
  if (Array.isArray(value)) {
    const head = value.slice(0, 3).map((v) => sample(v, depth + 1));
    return value.length > 3 ? [...head, `…${value.length - 3} more`] : head;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).slice(0, 40);
    return Object.fromEntries(entries.map(([k, v]) => [k, sample(v, depth + 1)]));
  }
  if (typeof value === "string" && value.length > 200) return `${value.slice(0, 200)}…`;
  return value;
}

/** Pick a part of a value by a dotted path: "data.items.0". */
export function pick(value: unknown, path: string | undefined): unknown {
  if (!path) return value;
  let cur: unknown = value;
  for (const key of path.split(".").filter(Boolean)) {
    if (cur === null || cur === undefined) return undefined;
    if (key === "__proto__" || key === "constructor" || key === "prototype") return undefined;
    cur = Array.isArray(cur)
      ? cur[Number(key)]
      : typeof cur === "object" && Object.hasOwn(cur, key)
        ? (cur as Record<string, unknown>)[key]
        : undefined;
  }
  return cur;
}
