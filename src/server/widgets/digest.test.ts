import { describe, expect, it } from "vitest";
import { digestAuthorization, parseChallenge } from "./digest";

describe("HTTP Digest sign-in", () => {
  it("answers the RFC 2617 example the way the RFC does", () => {
    const challenge = parseChallenge(
      'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"',
    );
    expect(challenge).toMatchObject({ realm: "testrealm@host.com", qop: "auth,auth-int" });
    const header = digestAuthorization(
      challenge as Record<string, string>,
      "GET",
      "/dir/index.html",
      "Mufasa",
      "Circle Of Life",
      "0a4f113b",
    );
    expect(header).toContain('response="6629fae49393a05397450978507c4ef1"');
    expect(header).toContain("qop=auth, nc=00000001");
    expect(header).toContain('opaque="5ccc069c403ebaf9f0171e9517f40e41"');
  });

  it("isn't fooled by another kind of challenge", () => {
    expect(parseChallenge('Basic realm="x"')).toBeNull();
  });
});
