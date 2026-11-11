/**
 * A GL.iNet router (firmware 4.x): who's connected to what. Its web API (`/rpc`, JSON-RPC) is the
 * one its own admin page uses: sign in with the admin password (a challenge, so the password
 * itself never crosses the network), then two read-only calls:
 *
 * - `mesh get_topology`: the router's clients by link (cable, 5G, 2.4G, IoT Wi-Fi), and each mesh
 *   node (how it reaches the router, and its own clients);
 * - `clients get_list`: every client's address, name, whether it's online, and its speed.
 *
 * Hearth only reads. The password is the admin's and is kept encrypted.
 */
import { createHash } from "node:crypto";
import { guardedFetch, NetError } from "../net";

export class RouterError extends Error {}

// ---------------------------------------------------------------------------
// MD5-crypt ("$1$"), as the router's challenge asks for (crypt(3), Poul-Henning Kamp's design).

const ITOA64 = "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function to64(v: number, n: number): string {
  let out = "";
  let x = v;
  for (let i = 0; i < n; i++) {
    out += ITOA64[x & 0x3f];
    x >>>= 6;
  }
  return out;
}

const md5 = (...parts: (Buffer | string)[]) => {
  const h = createHash("md5");
  for (const p of parts) h.update(p);
  return h.digest();
};

/** crypt(password, "$1$salt$"), like `openssl passwd -1 -salt salt password`. */
export function md5Crypt(password: string, salt: string): string {
  const pw = Buffer.from(password, "utf8");
  const s = Buffer.from(salt.slice(0, 8), "utf8");
  const magic = Buffer.from("$1$");
  let alt = md5(pw, s, pw);
  const ctx = createHash("md5");
  ctx.update(pw);
  ctx.update(magic);
  ctx.update(s);
  for (let left = pw.length; left > 0; left -= 16) ctx.update(alt.subarray(0, Math.min(16, left)));
  for (let i = pw.length; i; i >>= 1) ctx.update(i & 1 ? Buffer.from([0]) : pw.subarray(0, 1));
  let fin = ctx.digest();
  for (let i = 0; i < 1000; i++) {
    const c = createHash("md5");
    c.update(i & 1 ? pw : fin);
    if (i % 3) c.update(s);
    if (i % 7) c.update(pw);
    c.update(i & 1 ? fin : pw);
    fin = c.digest();
  }
  alt = fin;
  const b = (i: number) => alt[i] as number;
  const out =
    to64((b(0) << 16) | (b(6) << 8) | b(12), 4) +
    to64((b(1) << 16) | (b(7) << 8) | b(13), 4) +
    to64((b(2) << 16) | (b(8) << 8) | b(14), 4) +
    to64((b(3) << 16) | (b(9) << 8) | b(15), 4) +
    to64((b(4) << 16) | (b(10) << 8) | b(5), 4) +
    to64(b(11), 2);
  return `$1$${salt.slice(0, 8)}$${out}`;
}

// ---------------------------------------------------------------------------

/** A device connected to the router or a mesh node. */
export interface RouterLink {
  mac: string;
  /** "cable", "5G", "2.4G", "2.4G_Iot"… as the router says. */
  iface: string;
}

export interface RouterNode {
  name: string;
  model?: string;
  mac?: string;
  ip?: string;
  /** How a mesh node reaches the main router ("Wi-Fi", "Cable"); none for the main router. */
  connection?: string;
  links: RouterLink[];
}

export interface RouterClient {
  mac: string;
  ip?: string;
  name?: string;
  online: boolean;
  iface?: string;
  /** Bytes a second, now. */
  rx?: number;
  tx?: number;
}

export interface RouterMap {
  router: RouterNode;
  nodes: RouterNode[];
  clients: RouterClient[];
}

const mac = (v: unknown) =>
  typeof v === "string" && /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(v)
    ? v.toLowerCase().replace(/-/g, ":")
    : undefined;
const text = (v: unknown, n = 80) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined;

function links(list: unknown): RouterLink[] {
  return (Array.isArray(list) ? list : []).flatMap((c: Record<string, unknown>) => {
    const m = mac(c?.mac);
    return m ? [{ mac: m, iface: text(c.iface, 20) ?? "unknown" }] : [];
  });
}

export class GlInet {
  private sid: string | null = null;

  constructor(
    private readonly opts: {
      url: string;
      password?: string;
      username?: string;
      fetch?: typeof fetch;
    },
  ) {}

  private async rpc(method: string, params: unknown): Promise<unknown> {
    let r: Awaited<ReturnType<typeof guardedFetch>>;
    try {
      r = await guardedFetch(`${this.opts.url.replace(/\/+$/, "")}/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        policy: { allowInternet: false },
        fetch: this.opts.fetch,
        timeoutMs: 8000,
        maxBytes: 8 * 1024 * 1024,
      });
    } catch (e) {
      throw new RouterError(e instanceof NetError ? e.message : "The router didn't answer.");
    }
    if (r.status >= 400) throw new RouterError(`The router answered ${r.status}.`);
    let body: { result?: unknown; error?: { code?: number; message?: string } };
    try {
      body = JSON.parse(r.body.toString("utf8"));
    } catch {
      throw new RouterError("That doesn't look like a GL.iNet router (version 4).");
    }
    if (body.error) {
      const e = new RouterError(body.error.message ?? "The router said no.");
      (e as RouterError & { code?: number }).code = body.error.code;
      throw e;
    }
    return body.result;
  }

  /** Sign in: the router sends a salt and a one-time nonce; only a hash of the password goes back. */
  async login(): Promise<void> {
    if (!this.opts.password) throw new RouterError("Give the router's admin password.");
    const username = this.opts.username ?? "root";
    const ch = (await this.rpc("challenge", { username })) as {
      alg?: number;
      salt?: string;
      nonce?: string;
      "hash-method"?: string;
    };
    if (ch?.alg !== 1 || !ch.salt || !ch.nonce)
      throw new RouterError("This router signs in a way Hearth doesn't know yet.");
    const cipher = md5Crypt(this.opts.password, ch.salt);
    const hash = createHash(ch["hash-method"] === "sha256" ? "sha256" : "md5")
      .update(`${username}:${cipher}:${ch.nonce}`)
      .digest("hex");
    try {
      const res = (await this.rpc("login", { username, hash })) as { sid?: string };
      if (!res?.sid) throw new RouterError("The router didn't let Hearth in.");
      this.sid = res.sid;
    } catch (e) {
      throw new RouterError(
        e instanceof RouterError && /login|denied|failed/i.test(e.message)
          ? "The router refused that password."
          : (e as Error).message,
      );
    }
  }

  /** A read-only call, signing in first (and again if the session ran out). */
  private signingIn: Promise<void> | null = null;

  /** One sign-in at a time: calls made together share it. */
  private signIn(): Promise<void> {
    this.signingIn ??= this.login().finally(() => {
      this.signingIn = null;
    });
    return this.signingIn;
  }

  private async call(object: string, method: string): Promise<unknown> {
    if (!this.sid) await this.signIn();
    const used = this.sid;
    try {
      return await this.rpc("call", [used, object, method, {}]);
    } catch (e) {
      if (!(e instanceof RouterError) || (e as RouterError & { code?: number }).code !== -32000)
        throw e;
      // The session ran out: sign in again (unless another call already has).
      if (this.sid === used) {
        this.sid = null;
        await this.signIn();
      } else if (!this.sid) await this.signIn();
      return this.rpc("call", [this.sid, object, method, {}]);
    }
  }

  /** Who's connected to what, and every client's address and state. */
  async map(): Promise<RouterMap> {
    const [topo, list] = (await Promise.all([
      this.call("mesh", "get_topology"),
      this.call("clients", "get_list"),
    ])) as [Record<string, unknown> | null, { clients?: unknown } | null];
    if (!topo) throw new RouterError("The router didn't say what's connected.");
    const nodes = (Array.isArray(topo.son_nodes) ? topo.son_nodes : []).map(
      (n: Record<string, unknown>): RouterNode => ({
        name: text(n.node_name) ?? text(n.hostname) ?? "Mesh node",
        model: text(n.model, 40),
        mac: mac(n.mac) ?? mac(n.serial_number),
        ip: text(n.ip, 45),
        connection: text(n.connection, 20),
        links: links(n.clients),
      }),
    );
    const raw = list?.clients;
    const entries = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object"
        ? Object.values(raw)
        : [];
    const clients = entries.flatMap((c: Record<string, unknown>): RouterClient[] => {
      const m = mac(c?.mac);
      if (!m) return [];
      return [
        {
          mac: m,
          ip: text(c.ip, 45),
          name: text(c.name),
          online: c.online === true,
          iface: text(c.iface, 20),
          rx: typeof c.rx === "number" ? c.rx : undefined,
          tx: typeof c.tx === "number" ? c.tx : undefined,
        },
      ];
    });
    return {
      router: {
        name: text(topo.hostname) ?? text(topo.node_name) ?? "Router",
        model: text(topo.model, 40),
        mac: mac(topo.mac),
        ip: text(topo.ip, 45),
        links: links(topo.clients),
      },
      nodes,
      clients,
    };
  }
}
