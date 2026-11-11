import { describe, expect, it } from "vitest";
import { accessId } from "../../shared/access";
import { APPS, authWays, throughAccess } from "../../shared/catalog";
import { CONFIG_VERSION, HearthConfigSchema } from "../../shared/config";
import { checkDoc } from "../../shared/widget-doc";
import {
  connections,
  connectionUrl,
  publicConnections,
  readConnection,
  signIn,
} from "./connections";

describe("access to apps", () => {
  const prusa = APPS.find((a) => a.id === "prusalink");
  it("offers PrusaLink's API key and its user and password", () => {
    const ways = authWays(prusa as never);
    expect(ways.map((w) => `${w.kind}:${w.header ?? ""}`)).toEqual(["header:X-Api-Key", "digest:"]);
  });

  it("asks for a token, not a password, when a widget's key is a bearer token", () => {
    const muny = APPS.find((a) => a.id === "muny");
    expect(authWays(muny as never).map((w) => w.kind)).toEqual(["bearer"]);
  });

  it("turns an app's widget into one that reads through Hearth's access", () => {
    const wd = prusa?.widgets?.[0];
    const doc = throughAccess(wd?.doc as never, accessId("prusalink", "http://192.168.1.30"));
    expect(doc.sources?.[0]).toMatchObject({
      kind: "connection",
      to: "app:prusalink-192-168-1-30",
      get: "/api/v1/status",
    });
    expect(JSON.stringify(doc)).not.toContain("secret:");
    expect(checkDoc(doc).issues).toEqual([]);
  });

  it("signs in each way an app takes", () => {
    expect(signIn({ kind: "header", header: "X-Api-Key" }, "k").headers).toEqual({
      "X-Api-Key": "k",
    });
    expect(signIn({ kind: "bearer" }, "t").headers.Authorization).toBe("Bearer t");
    expect(signIn({ kind: "basic" }, "u:p").headers.Authorization).toBe(
      `Basic ${Buffer.from("u:p").toString("base64")}`,
    );
    expect(signIn({ kind: "digest" }, "u:p").digest).toBe("u:p");
    expect(signIn({ kind: "query", param: "apikey" }, "k").query).toEqual({
      param: "apikey",
      value: "k",
    });
  });

  it("answers a Digest challenge, and puts a key in the address", async () => {
    const seen: { url: string; auth?: string }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>)?.Authorization;
      seen.push({ url: String(url), auth });
      if (!auth && String(url).includes("/digest"))
        return new Response("no", {
          status: 401,
          headers: { "www-authenticate": 'Digest realm="Printer API", nonce="abc", qop="auth"' },
        });
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const base = "http://192.168.1.30";
    const r = await readConnection(
      { base, ...signIn({ kind: "digest" }, "maker:pw") },
      "/digest",
      f,
    );
    expect(r.status).toBe(200);
    expect(seen[1]?.auth).toMatch(/^Digest username="maker"/);
    await readConnection({ base, ...signIn({ kind: "query", param: "apikey" }, "k") }, "/q", f);
    expect(seen.at(-1)?.url).toBe("http://192.168.1.30/q?apikey=k");
  });
});

const secrets = (map: Record<string, string>) =>
  ({ get: (k: string) => map[k] }) as unknown as Parameters<typeof connections>[1];

describe("widget connections", () => {
  it("keeps a path on the system's own address", () => {
    expect(connectionUrl("http://192.168.1.1:3000/", "/control/stats")).toBe(
      "http://192.168.1.1:3000/control/stats",
    );
    expect(connectionUrl("http://192.168.1.5/v1", "/models")).toBe("http://192.168.1.5/v1/models");
    // A path that looks like another host stays on this one.
    expect(new URL(connectionUrl("http://192.168.1.1/", "//evil.example/x")).host).toBe(
      "192.168.1.1",
    );
  });

  it("signs in to what's connected, and never shows the sign-in", () => {
    const cfg = HearthConfigSchema.parse({
      version: CONFIG_VERSION,
      groups: [{ id: "home", name: "Home" }],
      settings: {
        adguard: { url: "http://192.168.1.1:3000/", username: "hearth" },
        ai: {
          servers: [{ id: "lab", name: "Lab", kind: "ollama", url: "http://192.168.1.9:11434" }],
        },
      },
    });
    const s = secrets({ "adguard:password": "pw", "ai:lab": "k" });
    const all = connections(cfg, s);
    expect(all.map((c) => c.to)).toEqual(["adguard", "ai:lab"]);
    expect(all[0]?.headers.Authorization).toMatch(/^Basic /);
    expect(all[1]?.headers.Authorization).toBe("Bearer k");
    expect(JSON.stringify(publicConnections(cfg, s))).not.toMatch(/Basic|Bearer/);
  });

  it("checks connection and new Hearth sources", () => {
    const doc = {
      v: 1,
      sources: [
        { id: "ag", kind: "connection", to: "adguard", get: "/control/stats" },
        { id: "home", kind: "hearth", what: "devices" },
      ],
      blocks: [{ id: "n", kind: "stat", value: "$home.online" }],
    };
    expect(checkDoc(doc).issues).toEqual([]);
    const bad = { ...doc, sources: [{ id: "ag", kind: "connection", to: "adguard", get: "x" }] };
    expect(checkDoc(bad).issues.length).toBeGreaterThan(0);
  });
});
