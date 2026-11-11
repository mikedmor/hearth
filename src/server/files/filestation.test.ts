import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { Profile } from "../../shared/config";
import type { ConfigStore } from "../config-store";
import type { SecretStore } from "../secrets";
import { FileStation, FileStationError } from "./filestation";
import { filesRoutes } from "./routes";

/** A pretend DSM: one account (alex / pw), sessions that can be ended, two shares. */
function fakeDsm(opts: { code?: string } = {}) {
  const calls: Record<string, string>[] = [];
  let sessions = 0;
  const live = new Set<string>();
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  const fetch = (async (_url: string, init?: RequestInit) => {
    const p = Object.fromEntries(new URLSearchParams(String(init?.body ?? "")));
    calls.push(p);
    if (p.api === "SYNO.API.Auth") {
      if (p.account !== "alex" || p.passwd !== "pw")
        return json({ success: false, error: { code: 400 } });
      if (opts.code && p.device_id !== "trusted") {
        if (!p.otp_code) return json({ success: false, error: { code: 403 } });
        if (p.otp_code !== opts.code) return json({ success: false, error: { code: 404 } });
      }
      const sid = `sid${++sessions}`;
      live.add(sid);
      return json({ success: true, data: { sid, ...(p.otp_code ? { did: "trusted" } : {}) } });
    }
    if (!live.has(p._sid ?? "")) return json({ success: false, error: { code: 119 } });
    if (p.method === "list_share")
      return json({
        success: true,
        data: {
          shares: [
            { name: "photos", path: "/photos", additional: { perm: { acl: { write: true } } } },
            { name: "music", path: "/music", additional: { perm: { acl: { write: false } } } },
          ],
        },
      });
    if (p.method === "list") {
      if (p.folder_path === "/secret") return json({ success: false, error: { code: 407 } });
      return json({
        success: true,
        data: {
          total: 3,
          files: [
            { name: "b.jpg", path: "/photos/b.jpg", isdir: false, additional: { size: 10 } },
            { name: "Zoo", path: "/photos/Zoo", isdir: true },
            { name: "a.jpg", path: "/photos/a.jpg", isdir: false, additional: { size: 5 } },
          ],
        },
      });
    }
    if (p.method === "download")
      return new Response("JPEGDATA", {
        headers: {
          "content-type": "image/jpeg",
          "content-disposition": 'attachment; filename="a.jpg"',
        },
      });
    return json({ success: false, error: { code: 101 } });
  }) as typeof globalThis.fetch;
  const end = () => live.clear();
  return { fetch, calls, end };
}

const login = { account: "alex", password: "pw" };

describe("File Station", () => {
  it("signs in, lists shares and folders (folders first)", async () => {
    const dsm = fakeDsm();
    const fs = new FileStation({ url: () => "http://nas.home/", fetch: dsm.fetch });
    expect(await fs.shares("p.alex", login)).toEqual([
      { name: "photos", path: "/photos", readOnly: false },
      { name: "music", path: "/music", readOnly: true },
    ]);
    const { entries, total } = await fs.list("p.alex", login, "/photos");
    expect(total).toBe(3);
    expect(entries.map((e) => e.name)).toEqual(["Zoo", "a.jpg", "b.jpg"]);
    // Signed in once, and the password went in the form body, never an address.
    expect(dsm.calls.filter((c) => c.api === "SYNO.API.Auth")).toHaveLength(1);
  });

  it("signs in again once when DSM ends the session", async () => {
    const dsm = fakeDsm();
    const fs = new FileStation({ url: () => "http://nas.home", fetch: dsm.fetch });
    await fs.shares("p.alex", login);
    dsm.end();
    expect((await fs.list("p.alex", login, "/photos")).entries).toHaveLength(3);
    expect(dsm.calls.filter((c) => c.api === "SYNO.API.Auth")).toHaveLength(2);
  });

  it("says plainly when the password is wrong, or a code is needed", async () => {
    const dsm = fakeDsm({ code: "123456" });
    const fs = new FileStation({ url: () => "http://nas.home", fetch: dsm.fetch });
    const wrong = await fs.signIn("p.alex", { ...login, password: "no" }).catch((e) => e);
    expect(wrong).toBeInstanceOf(FileStationError);
    expect(wrong).toMatchObject({ needsSignIn: true, needsCode: false });
    const code = await fs.signIn("p.alex", login).catch((e) => e);
    expect(code).toMatchObject({ needsCode: true, message: expect.stringMatching(/code/) });
    // With the code, DSM trusts this device from then on.
    expect(await fs.signIn("p.alex", login, "123456")).toEqual({ did: "trusted" });
    fs.forget("p.alex");
    expect(await fs.signIn("p.alex", { ...login, did: "trusted" })).toEqual({ did: "trusted" });
  });

  it("passes on the NAS's no, in plain words", async () => {
    const dsm = fakeDsm();
    const fs = new FileStation({ url: () => "http://nas.home", fetch: dsm.fetch });
    await expect(fs.list("p.alex", login, "/secret")).rejects.toThrow(/permission/);
    await expect(fs.list("p.alex", login, "photos")).rejects.toThrow(/folder/);
    await expect(
      new FileStation({ url: () => undefined, fetch: dsm.fetch }).shares("x", login),
    ).rejects.toThrow(/address/);
  });

  it("streams a download", async () => {
    const dsm = fakeDsm();
    const fs = new FileStation({ url: () => "http://nas.home", fetch: dsm.fetch });
    const res = await fs.download("p.alex", login, "/photos/a.jpg");
    expect(await res.text()).toBe("JPEGDATA");
    expect(dsm.calls.at(-1)).toMatchObject({ path: '["/photos/a.jpg"]', mode: "download" });
  });
});

describe("the Files routes", () => {
  const profile = (id: string, role: Profile["role"] = "adult") =>
    ({ id, name: id, role }) as Profile;
  function app(asWho: { profile: Profile | null; admin: boolean }, pins: string[]) {
    const dsm = fakeDsm();
    const store = new Map<string, string>();
    const secrets = {
      get: (n: string) => store.get(n),
      set: async (n: string, v: string | null) => {
        if (v === null) store.delete(n);
        else store.set(n, v);
      },
    } as unknown as SecretStore;
    const a = new Hono();
    a.onError((err, c) =>
      err instanceof FileStationError
        ? c.json({ error: err.message, needsCode: err.needsCode }, err.status)
        : c.json({ error: String(err) }, 500),
    );
    filesRoutes(a, {
      files: new FileStation({ url: () => "http://nas.home", fetch: dsm.fetch }),
      config: {
        get: () => ({
          settings: {
            files: { url: "http://nas.home:5000" },
            features: { files: ["admin", "adult"], calendar: ["admin", "adult", "child"] },
          },
        }),
      } as unknown as ConfigStore,
      secrets,
      who: () => asWho,
      hasPin: (p) => pins.includes(p),
      requireAdmin: () => {},
      body: async <T>(c: { req: { json: () => Promise<unknown> } }, s: z.ZodType<T>) =>
        s.parse(await c.req.json()),
    } as Parameters<typeof filesRoutes>[1]);
    const req = (method: string, path: string, body?: unknown) =>
      a.request(path, {
        method,
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
    return { req, store };
  }

  it("is off for children until the admin turns it on", async () => {
    const { req } = app({ profile: profile("kid", "child"), admin: false }, ["kid"]);
    const s = await (await req("GET", "/api/files")).json();
    expect(s).toMatchObject({ allowed: false, reason: expect.stringMatching(/turned on/) });
    expect((await req("GET", "/api/files/shares")).status).toBe(403);
  });

  it("needs a PIN on the profile: anyone can open a profile without one", async () => {
    const { req } = app({ profile: profile("sam"), admin: false }, []);
    const s = await (await req("GET", "/api/files")).json();
    expect(s).toMatchObject({ configured: true, allowed: false, smbHost: "nas.home" });
    expect((await req("GET", "/api/files/shares")).status).toBe(403);
  });

  it("connects, browses, downloads and disconnects, keeping the password out of the page", async () => {
    const { req, store } = app({ profile: profile("alex"), admin: false }, ["alex"]);
    expect((await req("GET", "/api/files/shares")).status).toBe(401);
    const bad = await req("POST", "/api/files/connect", { account: "alex", password: "no" });
    expect(bad.status).toBe(400);
    const ok = await req("POST", "/api/files/connect", { account: "alex", password: "pw" });
    expect(await ok.json()).toEqual({ ok: true, account: "alex" });
    expect(JSON.parse(store.get("files:p.alex") ?? "{}")).toMatchObject({ account: "alex" });
    const status = await (await req("GET", "/api/files")).text();
    expect(status).toContain('"connected":true');
    expect(status).not.toContain("pw");
    const shares = await (await req("GET", "/api/files/shares")).json();
    expect(shares.shares).toHaveLength(2);
    const list = await (await req("GET", "/api/files/list?path=%2Fphotos")).json();
    expect(list.entries[0]).toMatchObject({ name: "Zoo", dir: true });
    const file = await req("GET", "/api/files/download?path=%2Fphotos%2Fa.jpg");
    expect(file.headers.get("content-disposition")).toContain("a.jpg");
    expect(await file.text()).toBe("JPEGDATA");
    expect((await req("DELETE", "/api/files/connect")).status).toBe(200);
    expect(store.has("files:p.alex")).toBe(false);
  });
});
