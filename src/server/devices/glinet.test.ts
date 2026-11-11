import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GlInet, md5Crypt } from "./glinet";

describe("MD5-crypt", () => {
  it("matches openssl passwd -1", () => {
    expect(md5Crypt("hello", "abcdefgh")).toBe("$1$abcdefgh$rwnEbRiN0agqVgZBovWNQ/");
    expect(md5Crypt("a longer password!", "Xy9")).toBe("$1$Xy9$/lLCSx95HdpzZHYtXpNTx0");
  });
});

/** A GL.iNet router: a challenge, a login that checks the hash, the two calls Hearth makes. */
function router(password: string) {
  const calls: string[] = [];
  let sessions = 0;
  let live = "";
  const fetch = (async (_input: string | URL, init?: RequestInit) => {
    const b = JSON.parse(String(init?.body)) as { method: string; params: unknown };
    calls.push(
      b.method === "call" ? `call ${(b.params as string[]).slice(1, 3).join(".")}` : b.method,
    );
    if (b.method === "challenge")
      return Response.json({
        result: { alg: 1, "hash-method": "sha256", salt: "s4lt", nonce: "n0nce" },
      });
    if (b.method === "login") {
      const want = createHash("sha256")
        .update(`root:${md5Crypt(password, "s4lt")}:n0nce`)
        .digest("hex");
      if ((b.params as { hash: string }).hash !== want)
        return Response.json({ error: { code: -32000, message: "login failed" } });
      live = `sid-${++sessions}`;
      return Response.json({ result: { sid: live } });
    }
    const [sid, object, method] = b.params as string[];
    if (sid !== live) return Response.json({ error: { code: -32000, message: "Access denied" } });
    if (object === "mesh" && method === "get_topology")
      return Response.json({
        result: {
          hostname: "GL-MT6000",
          model: "mt6000",
          mac: "94:83:c4:00:00:01",
          ip: "192.168.1.1",
          clients: [
            { iface: "cable", mac: "00:11:32:00:00:20" },
            { iface: "5G", mac: "aa:bb:cc:00:00:41" },
            { iface: "5G", mac: "94:83:c4:00:00:02" },
          ],
          son_nodes: [
            {
              node_name: "Beryl AX",
              connection: "Wi-Fi",
              serial_number: "94:83:c4:00:00:02",
              clients: [{ iface: "2.4G", mac: "cc:a7:c1:00:00:50" }],
            },
          ],
        },
      });
    if (object === "clients" && method === "get_list")
      return Response.json({
        result: {
          clients: {
            "00:11:32:00:00:20": {
              mac: "00:11:32:00:00:20",
              ip: "192.168.1.20",
              name: "NAS",
              online: true,
              rx: 1200,
              tx: 300,
            },
            "AA:BB:CC:00:00:41": { mac: "AA:BB:CC:00:00:41", ip: "192.168.1.41", online: false },
          },
        },
      });
    return Response.json({ error: { code: -32601, message: "Method not found" } });
  }) as typeof globalThis.fetch;
  return { fetch, calls, expire: () => (live = "") };
}

describe("a GL.iNet router", () => {
  it("signs in with a hash, and says who's connected to what", async () => {
    const r = router("hunter2!");
    const g = new GlInet({ url: "http://192.168.1.1", password: "hunter2!", fetch: r.fetch });
    const map = await g.map();
    expect(map.router).toMatchObject({ name: "GL-MT6000", model: "mt6000", ip: "192.168.1.1" });
    expect(map.router.links.map((l) => `${l.iface} ${l.mac}`)).toEqual([
      "cable 00:11:32:00:00:20",
      "5G aa:bb:cc:00:00:41",
      "5G 94:83:c4:00:00:02",
    ]);
    expect(map.nodes[0]).toMatchObject({
      name: "Beryl AX",
      connection: "Wi-Fi",
      mac: "94:83:c4:00:00:02",
      links: [{ iface: "2.4G", mac: "cc:a7:c1:00:00:50" }],
    });
    expect(map.clients.find((c) => c.ip === "192.168.1.41")).toMatchObject({
      mac: "aa:bb:cc:00:00:41",
      online: false,
    });
    // The session ran out: it signs in again by itself.
    r.expire();
    await g.map();
    expect(r.calls.filter((c) => c === "login")).toHaveLength(2);
  });

  it("says when the password is wrong, and stays on the home network", async () => {
    const r = router("right");
    await expect(
      new GlInet({ url: "http://192.168.1.1", password: "wrong", fetch: r.fetch }).map(),
    ).rejects.toThrow("refused that password");
    await expect(
      new GlInet({ url: "http://example.com", password: "right", fetch: r.fetch }).map(),
    ).rejects.toThrow();
  });
});
