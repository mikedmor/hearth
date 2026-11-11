/** A small OpenID Connect provider for tests: discovery, keys, and a token endpoint. */
import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";

export const ISSUER = "https://id.example";

export function fakeProvider(opts: { alg?: "RS256" | "ES256" } = {}) {
  const alg = opts.alg ?? "RS256";
  const pair =
    alg === "RS256"
      ? generateKeyPairSync("rsa", { modulusLength: 2048 })
      : generateKeyPairSync("ec", { namedCurve: "P-256" });
  const state = {
    kid: "k1",
    key: pair.privateKey as KeyObject,
    publicKeys: [{ ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg }],
    /** What the next ID token says (tests change it). */
    claims: {} as Record<string, unknown>,
    tamper: false,
    lastNonce: "",
    tokenRequests: [] as URLSearchParams[],
  };
  const token = (claims: Record<string, unknown>) => {
    const h = Buffer.from(JSON.stringify({ alg, kid: state.kid, typ: "JWT" })).toString(
      "base64url",
    );
    const b = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const sig = sign(
      "sha256",
      Buffer.from(`${h}.${b}`),
      alg === "ES256" ? { key: state.key, dsaEncoding: "ieee-p1363" } : state.key,
    );
    const s = sig.toString("base64url");
    return `${h}.${b}.${state.tamper ? `${s.slice(0, -4)}AAAA` : s}`;
  };
  const fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/.well-known/openid-configuration")
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/api/oidc/token`,
        jwks_uri: `${ISSUER}/.well-known/jwks.json`,
      });
    if (url.pathname === "/.well-known/jwks.json") return Response.json({ keys: state.publicKeys });
    if (url.pathname === "/api/oidc/token") {
      const form = new URLSearchParams(String(init?.body));
      state.tokenRequests.push(form);
      if (form.get("code") !== "good-code")
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      const now = Math.floor(Date.now() / 1000);
      return Response.json({
        id_token: token({
          iss: ISSUER,
          aud: "hearth",
          sub: "user-1",
          exp: now + 300,
          iat: now,
          nonce: state.lastNonce,
          email: "alex@example.com",
          groups: ["family"],
          ...state.claims,
        }),
      });
    }
    return new Response("", { status: 404 });
  }) as typeof globalThis.fetch;
  return { state, fetch, token };
}
