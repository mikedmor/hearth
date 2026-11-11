import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { localPath, Sso } from "./sso";
import { fakeProvider, ISSUER } from "./test-sso";

/** Start a sign-in and pull out what the provider would see. */
async function begin(
  sso: Sso,
  provider: ReturnType<typeof fakeProvider>,
  intent: "signin" | "link" = "signin",
) {
  const url = new URL(
    await sso.start({
      redirectUri: "https://start.example/api/sso/callback",
      intent,
      returnTo: "/calendar",
    }),
  );
  provider.state.lastNonce = url.searchParams.get("nonce") ?? "";
  return { url, state: url.searchParams.get("state") as string };
}

function setup(alg?: "RS256" | "ES256", secret?: string) {
  const provider = fakeProvider({ alg });
  const sso = new Sso({
    settings: () => ({ issuer: ISSUER, clientId: "hearth", clientSecret: secret }),
    fetch: provider.fetch,
  });
  return { sso, provider };
}

describe("single sign-on", () => {
  it("only ever returns to a page on Hearth itself", () => {
    expect(localPath("/calendar?view=week")).toBe("/calendar?view=week");
    for (const bad of [
      "//evil.example",
      "/\\evil.example",
      "/a\\b",
      "https://evil.example",
      "evil",
      "/\tx",
      undefined,
    ])
      expect(localPath(bad)).toBe("/");
  });

  it("sends the browser to the provider with PKCE, and checks the ID token it gets back", async () => {
    const { sso, provider } = setup();
    const { url, state } = await begin(sso, provider);
    expect(url.origin + url.pathname).toBe(`${ISSUER}/authorize`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: "code",
      client_id: "hearth",
      redirect_uri: "https://start.example/api/sso/callback",
      code_challenge_method: "S256",
      scope: "openid profile email groups",
    });
    const r = await sso.finish(state, "good-code");
    expect(r).toMatchObject({
      intent: "signin",
      returnTo: "/calendar",
      claims: { sub: "user-1", email: "alex@example.com", groups: ["family"] },
    });
    // The verifier went to the token endpoint; no secret for a public client.
    expect(provider.state.tokenRequests[0]?.get("code_verifier")).toBeTruthy();
    expect(provider.state.tokenRequests[0]?.has("client_secret")).toBe(false);
    // A state is used once.
    await expect(sso.finish(state, "good-code")).rejects.toThrow(
      /too long or came from somewhere else/,
    );
  });

  it("takes ES256 tokens and sends a client's secret when it has one", async () => {
    const { sso, provider } = setup("ES256", "s3cret");
    const { state } = await begin(sso, provider);
    expect((await sso.finish(state, "good-code")).claims.sub).toBe("user-1");
    expect(provider.state.tokenRequests[0]?.get("client_secret")).toBe("s3cret");
  });

  it("refuses a token that's been tampered with, is for another app, is old, or isn't this sign-in's", async () => {
    const cases: [
      Partial<ReturnType<typeof fakeProvider>["state"]>,
      Record<string, unknown>,
      RegExp,
    ][] = [
      [{ tamper: true }, {}, /signature/],
      [{}, { aud: "someone-else" }, /another app/],
      [{}, { iss: "https://evil.example" }, /another issuer/],
      [{}, { exp: Math.floor(Date.now() / 1000) - 3600 }, /expired/],
      [{}, { nonce: "not-this-one" }, /doesn't belong to this sign-in/],
    ];
    for (const [patch, claims, why] of cases) {
      const { sso, provider } = setup();
      Object.assign(provider.state, patch, { claims });
      const { state } = await begin(sso, provider);
      await expect(sso.finish(state, "good-code"), String(why)).rejects.toThrow(why);
    }
  });

  it("fetches the keys again when the provider has rotated them", async () => {
    const { sso, provider } = setup();
    const first = await begin(sso, provider);
    await sso.finish(first.state, "good-code");
    // New key, new id: Hearth hasn't seen it.
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    provider.state.key = pair.privateKey;
    provider.state.kid = "k2";
    provider.state.publicKeys = [
      { ...pair.publicKey.export({ format: "jwk" }), kid: "k2", alg: "RS256" },
    ];
    const second = await begin(sso, provider);
    expect((await sso.finish(second.state, "good-code")).claims.sub).toBe("user-1");
  });

  it("says plainly when the code is refused, or the provider isn't one", async () => {
    const { sso, provider } = setup();
    const { state } = await begin(sso, provider);
    await expect(sso.finish(state, "bad-code")).rejects.toThrow(/answered 400: invalid_grant/);
    const wrong = new Sso({
      settings: () => ({ issuer: "https://other.example", clientId: "hearth" }),
      fetch: provider.fetch,
    });
    await expect(wrong.discovery()).rejects.toThrow(/says it's https:\/\/id.example/);
  });
});
