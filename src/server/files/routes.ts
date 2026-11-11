/**
 * Files: the NAS's shared folders, each person through their own NAS account.
 *
 * Only someone whose profile has a PIN (so the cookie proves it's them), or the admin, may connect
 * an account or browse: a profile without a PIN can be opened by anyone in the house.
 */
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { Profile } from "../../shared/config";
import { isLocalUrl } from "../../shared/config";
import type { FilesStatus } from "../../shared/files";
import type { ConfigStore } from "../config-store";
import { guardedFetch } from "../net";
import type { SecretStore } from "../secrets";
import { type FileStation, FileStationError, type NasLogin } from "./filestation";

export interface FilesRouteDeps {
  files: FileStation;
  config: ConfigStore;
  secrets: SecretStore;
  who: (c: Context) => { profile: Profile | null; admin: boolean };
  hasPin: (profile: string) => boolean;
  requireAdmin: (c: Context) => void;
  body: <T>(c: Context, schema: z.ZodType<T>) => Promise<T>;
}

const LoginSchema = z.object({
  account: z.string().min(1).max(100),
  password: z.string().min(1).max(500),
  did: z.string().max(500).optional(),
});

const path = z.string().min(1).max(2000).startsWith("/");

/** Where a person's sign-in is kept: `files:p.<profile>`, or `files:admin`. */
export const filesSecret = (key: string) => `files:${key}`;

export function filesRoutes(app: Hono, d: FilesRouteDeps): void {
  /** Who may use Files on this request, and why not. */
  const access = (c: Context): { key: string; label: string } | { reason: string } => {
    const w = d.who(c);
    const roles = d.config.get().settings.features.files;
    if (w.profile && !w.admin && !roles.includes(w.profile.role))
      return { reason: "Files isn't turned on for you. The admin can turn it on in Settings." };
    if (w.profile) {
      if (d.hasPin(w.profile.id) || w.admin)
        return { key: `p.${w.profile.id}`, label: w.profile.name };
      return {
        reason:
          "Files needs a PIN on your profile, so nobody else in the house can open your files from your page. Set one in your profile.",
      };
    }
    if (w.admin) return { key: "admin", label: "Admin" };
    return { reason: "Pick who you are first: files are each person's own." };
  };
  const me = (c: Context): string => {
    const a = access(c);
    if ("reason" in a) throw new FileStationError(a.reason, 0, { status: 403 });
    return a.key;
  };
  const loginOf = (key: string): NasLogin => {
    const raw = d.secrets.get(filesSecret(key));
    const parsed = raw ? LoginSchema.safeParse(JSON.parse(raw)) : null;
    if (!parsed?.success)
      throw new FileStationError("Connect your NAS account first.", 0, {
        needsSignIn: true,
        status: 401,
      });
    return parsed.data;
  };
  const settings = () => d.config.get().settings.files;

  app.get("/api/files", (c) => {
    const a = access(c);
    const s = settings();
    let host = s.smbHost;
    try {
      host ||= s.url ? new URL(s.url).hostname : undefined;
    } catch {
      // Not an address.
    }
    const status: FilesStatus = {
      configured: Boolean(s.url),
      smbHost: host,
      allowed: !("reason" in a),
      reason: "reason" in a ? a.reason : undefined,
      connected: false,
    };
    if (!("reason" in a)) {
      const raw = d.secrets.get(filesSecret(a.key));
      if (raw) {
        const parsed = LoginSchema.safeParse(JSON.parse(raw));
        if (parsed.success) {
          status.connected = true;
          status.account = parsed.data.account;
        }
      }
    }
    c.header("Cache-Control", "no-store");
    return c.json(status);
  });

  app.post("/api/files/connect", async (c) => {
    const key = me(c);
    const b = await d.body(
      c,
      z.object({
        account: z.string().trim().min(1).max(100),
        password: z.string().min(1).max(500),
        code: z
          .string()
          .regex(/^\d{6,8}$/)
          .optional(),
      }),
    );
    const login: NasLogin = { account: b.account, password: b.password };
    // A device token from before still saves asking for a code, if it's the same account.
    const before = d.secrets.get(filesSecret(key));
    if (before && !b.code) {
      const old = LoginSchema.safeParse(JSON.parse(before));
      if (old.success && old.data.account === b.account) login.did = old.data.did;
    }
    const { did } = await d.files.signIn(key, login, b.code);
    await d.secrets.set(filesSecret(key), JSON.stringify({ ...login, did }));
    return c.json({ ok: true, account: login.account });
  });

  app.delete("/api/files/connect", async (c) => {
    const key = me(c);
    d.files.forget(key);
    await d.secrets.set(filesSecret(key), null);
    return c.json({ ok: true });
  });

  app.get("/api/files/shares", async (c) => {
    const key = me(c);
    c.header("Cache-Control", "no-store");
    return c.json({ shares: await d.files.shares(key, loginOf(key)) });
  });

  app.get("/api/files/list", async (c) => {
    const key = me(c);
    const p = path.safeParse(c.req.query("path"));
    if (!p.success) throw new FileStationError("Say which folder: ?path=/share/folder", 0);
    const offset = Math.max(0, Number(c.req.query("offset") ?? 0) || 0);
    c.header("Cache-Control", "no-store");
    return c.json(await d.files.list(key, loginOf(key), p.data, offset));
  });

  /** A file straight from the NAS to the browser; a folder comes as a zip. */
  app.get("/api/files/download", async (c) => {
    const key = me(c);
    const p = path.safeParse(c.req.query("path"));
    if (!p.success) throw new FileStationError("Say which file: ?path=/share/file", 0);
    const res = await d.files.download(key, loginOf(key), p.data);
    const name = p.data.split("/").filter(Boolean).at(-1) ?? "download";
    const headers = new Headers({
      "content-type": res.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition":
        res.headers.get("content-disposition") ??
        `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    const length = res.headers.get("content-length");
    if (length) headers.set("content-length", length);
    return new Response(res.body, { status: 200, headers });
  });

  /** The admin checks an address before saving it: is it a NAS with File Station? */
  app.post("/api/admin/files/check", async (c) => {
    d.requireAdmin(c);
    const b = await d.body(c, z.object({ url: z.string().trim().min(1).max(300) }));
    const url = b.url.replace(/\/+$/, "");
    if (!isLocalUrl(url)) throw new FileStationError("That address isn't on the home network.", 0);
    const r = await guardedFetch(
      `${url}/webapi/query.cgi?api=SYNO.API.Info&version=1&method=query&query=SYNO.API.Auth,SYNO.FileStation.List,SYNO.FileStation.Download`,
      { policy: { allowInternet: false }, timeoutMs: 8000 },
    );
    let data: Record<string, unknown> = {};
    try {
      data = (JSON.parse(r.body.toString("utf8")) as { data?: Record<string, unknown> }).data ?? {};
    } catch {
      // Not DSM.
    }
    const ok = ["SYNO.API.Auth", "SYNO.FileStation.List", "SYNO.FileStation.Download"].every(
      (k) => k in data,
    );
    return c.json({
      ok,
      message: ok
        ? "That's a Synology NAS with File Station."
        : "That address answers, but not as a Synology NAS with File Station.",
    });
  });
}
