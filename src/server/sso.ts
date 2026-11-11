/**
 * Single sign-on through the home's identity provider (Pocket ID, Authentik, any OpenID Connect
 * provider): Hearth sends the browser there, gets a code back, swaps it for an ID token, and checks
 * that token itself (signature, issuer, audience, expiry, nonce). Authorization code flow with PKCE.
 */
import { createHash, createPublicKey, type JsonWebKey, randomBytes, verify } from "node:crypto";
import { guardedFetch, NetError } from "./net";

export class SsoError extends Error {}

export interface SsoSettings {
  issuer: string;
  clientId: string;
  clientSecret?: string;
}

/** What Hearth uses from the ID token. */
export interface SsoClaims {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  groups: string[];
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

interface Pending {
  verifier: string;
  nonce: string;
  redirectUri: string;
  intent: "signin" | "link";
  profile?: string;
  returnTo: string;
  at: number;
}

const b64url = (b: Buffer) => b.toString("base64url");
const trim = (s: string) => s.replace(/\/+$/, "");
/** A sign-in has ten minutes to come back. */
const PENDING_MS = 10 * 60_000;

export interface SsoDeps {
  settings: () => SsoSettings | null;
  fetch?: typeof fetch;
  now?: () => number;
}

export class Sso {
  private pending = new Map<string, Pending>();
  private disco?: { issuer: string; at: number; d: Discovery };
  private keys?: { uri: string; at: number; keys: (JsonWebKey & { kid?: string })[] };

  constructor(private readonly deps: SsoDeps) {}

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  get enabled(): boolean {
    const s = this.deps.settings();
    return Boolean(s?.issuer && s.clientId);
  }

  private settings(): SsoSettings {
    const s = this.deps.settings();
    if (!s?.issuer || !s.clientId) throw new SsoError("Single sign-on isn't set up.");
    return s;
  }

  private async getJson<T>(
    url: string,
    init?: { method: "POST"; body: string; headers: Record<string, string> },
  ): Promise<T> {
    let r: Awaited<ReturnType<typeof guardedFetch>>;
    try {
      r = await guardedFetch(url, {
        method: init?.method ?? "GET",
        body: init?.body,
        headers: { accept: "application/json", ...init?.headers },
        // The admin chose the provider; it's usually on the home network (id.home).
        policy: { allowInternet: true },
        fetch: this.deps.fetch,
        timeoutMs: 8000,
        maxBytes: 512 * 1024,
      });
    } catch (e) {
      throw new SsoError(e instanceof NetError ? e.message : "Couldn't reach the sign-in service.");
    }
    const text = r.body.toString("utf8");
    if (r.status >= 400) {
      let why = "";
      try {
        const j = JSON.parse(text) as { error?: string; error_description?: string };
        why = j.error_description || j.error || "";
      } catch {
        // Not JSON.
      }
      throw new SsoError(`The sign-in service answered ${r.status}${why ? `: ${why}` : ""}.`);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new SsoError("The sign-in service's answer wasn't what Hearth expected.");
    }
  }

  /** The provider's own description of itself (cached for an hour). */
  async discovery(): Promise<Discovery> {
    const issuer = trim(this.settings().issuer);
    const now = this.now();
    if (this.disco?.issuer === issuer && now - this.disco.at < 3600_000) return this.disco.d;
    const d = await this.getJson<Discovery>(`${issuer}/.well-known/openid-configuration`);
    if (trim(d.issuer ?? "") !== issuer)
      throw new SsoError(`That address says it's ${d.issuer}, not ${issuer}.`);
    if (!d.authorization_endpoint || !d.token_endpoint || !d.jwks_uri)
      throw new SsoError("That doesn't look like an OpenID Connect provider.");
    this.disco = { issuer, at: now, d };
    return d;
  }

  /** Where to send the browser to sign in. */
  async start(o: {
    redirectUri: string;
    intent: "signin" | "link";
    profile?: string;
    returnTo?: string;
  }): Promise<string> {
    const s = this.settings();
    const d = await this.discovery();
    const now = this.now();
    for (const [k, p] of this.pending) if (now - p.at > PENDING_MS) this.pending.delete(k);
    if (this.pending.size > 200) throw new SsoError("Too many sign-ins at once. Try again soon.");
    const state = b64url(randomBytes(24));
    const verifier = b64url(randomBytes(32));
    const nonce = b64url(randomBytes(16));
    const returnTo = localPath(o.returnTo);
    this.pending.set(state, {
      verifier,
      nonce,
      redirectUri: o.redirectUri,
      intent: o.intent,
      profile: o.profile,
      returnTo,
      at: now,
    });
    const q = new URLSearchParams({
      response_type: "code",
      client_id: s.clientId,
      redirect_uri: o.redirectUri,
      scope: "openid profile email groups",
      state,
      nonce,
      code_challenge: b64url(createHash("sha256").update(verifier).digest()),
      code_challenge_method: "S256",
    });
    return `${d.authorization_endpoint}?${q}`;
  }

  /** The browser is back with a code: swap it, check the token, and say who it is. */
  async finish(
    state: string,
    code: string,
  ): Promise<{ claims: SsoClaims } & Omit<Pending, "verifier" | "nonce" | "at">> {
    const p = this.pending.get(state);
    this.pending.delete(state);
    if (!p || this.now() - p.at > PENDING_MS)
      throw new SsoError("That sign-in took too long or came from somewhere else. Try again.");
    const s = this.settings();
    const d = await this.discovery();
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: p.redirectUri,
      client_id: s.clientId,
      code_verifier: p.verifier,
    });
    if (s.clientSecret) form.set("client_secret", s.clientSecret);
    const tok = await this.getJson<{ id_token?: string }>(d.token_endpoint, {
      method: "POST",
      body: form.toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    if (!tok.id_token) throw new SsoError("The sign-in service sent no ID token.");
    const claims = await this.check(tok.id_token, p.nonce);
    return {
      claims,
      intent: p.intent,
      profile: p.profile,
      returnTo: p.returnTo,
      redirectUri: p.redirectUri,
    };
  }

  private async jwks(force = false): Promise<(JsonWebKey & { kid?: string })[]> {
    const d = await this.discovery();
    const now = this.now();
    if (!force && this.keys?.uri === d.jwks_uri && now - this.keys.at < 3600_000)
      return this.keys.keys;
    const r = await this.getJson<{ keys?: (JsonWebKey & { kid?: string })[] }>(d.jwks_uri);
    this.keys = { uri: d.jwks_uri, at: now, keys: r.keys ?? [] };
    return this.keys.keys;
  }

  /** Check an ID token: its signature against the provider's keys, and what it claims. */
  async check(token: string, nonce: string): Promise<SsoClaims> {
    const parts = token.split(".");
    if (parts.length !== 3) throw new SsoError("That ID token isn't a token.");
    const [h, b, sig] = parts as [string, string, string];
    let header: { alg?: string; kid?: string };
    let c: Record<string, unknown>;
    try {
      header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
      c = JSON.parse(Buffer.from(b, "base64url").toString("utf8"));
    } catch {
      throw new SsoError("That ID token couldn't be read.");
    }
    const algs: Record<string, { hash: string | null; dsa?: "ieee-p1363" }> = {
      RS256: { hash: "sha256" },
      RS384: { hash: "sha384" },
      RS512: { hash: "sha512" },
      PS256: { hash: "sha256" },
      ES256: { hash: "sha256", dsa: "ieee-p1363" },
      ES384: { hash: "sha384", dsa: "ieee-p1363" },
      EdDSA: { hash: null },
    };
    const alg = algs[header.alg ?? ""];
    if (!alg) throw new SsoError(`Hearth doesn't take ID tokens signed with ${header.alg}.`);
    const pick = (keys: (JsonWebKey & { kid?: string })[]) =>
      keys.filter((k) => !header.kid || k.kid === header.kid);
    let keys = pick(await this.jwks());
    // A key Hearth hasn't seen: the provider may have rotated its keys.
    if (!keys.length) keys = pick(await this.jwks(true));
    const data = Buffer.from(`${h}.${b}`);
    const signature = Buffer.from(sig, "base64url");
    const ok = keys.some((jwk) => {
      try {
        const key = createPublicKey({ key: jwk, format: "jwk" });
        const opts = header.alg?.startsWith("PS")
          ? { key, padding: 6, saltLength: 32 }
          : alg.dsa
            ? { key, dsaEncoding: alg.dsa }
            : key;
        return verify(alg.hash, data, opts as Parameters<typeof verify>[2], signature);
      } catch {
        return false;
      }
    });
    if (!ok) throw new SsoError("That ID token's signature doesn't check out.");

    const s = this.settings();
    const now = this.now() / 1000;
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    if (trim(String(c.iss ?? "")) !== trim(s.issuer))
      throw new SsoError("That ID token is from another issuer.");
    if (!aud.includes(s.clientId)) throw new SsoError("That ID token is for another app.");
    if (typeof c.exp !== "number" || c.exp < now - 60)
      throw new SsoError("That ID token has expired.");
    if (c.nonce !== nonce) throw new SsoError("That ID token doesn't belong to this sign-in.");
    if (typeof c.sub !== "string" || !c.sub) throw new SsoError("That ID token says nobody.");
    const str = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 200) : undefined);
    return {
      sub: c.sub,
      email: str(c.email),
      name: str(c.name),
      preferred_username: str(c.preferred_username),
      groups: Array.isArray(c.groups)
        ? c.groups.filter((g): g is string => typeof g === "string")
        : [],
    };
  }
}

/**
 * Only a path on Hearth itself, never another site: "/calendar", not "//evil.example" or
 * "/\evil.example" (browsers read a backslash as a slash), and no control characters.
 */
export function localPath(path: string | undefined): string {
  if (!path?.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
  if (/[\u0000-\u001f\u007f]/.test(path)) return "/";
  return path.slice(0, 500);
}
