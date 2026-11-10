/** The HTTP app. Built as a function so tests can drive it with `app.request()`. */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { ChatEvent, ChatMessage, DesignEvent, Session, StatusMap } from "../shared/api";
import { APPS, type AppDef, fillTemplate, GENERAL_TEMPLATES } from "../shared/catalog";
import {
  AiServerSchema,
  Audience,
  canSee,
  type Group,
  GroupSchema,
  type HearthConfig,
  LayoutSchema,
  PAGE_PATHS,
  type Profile,
  ProfileSchema,
  RESERVED_PATHS,
  type Role,
  SettingsSchema,
  shortLinkOf,
  type Tile,
  TileSchema,
  type Viewer,
  visibleTo,
  WidgetSchema,
} from "../shared/config";
import { LookSchema, ThemeSchema } from "../shared/themes";
import type { WidgetDocInput } from "../shared/widget-doc";
import { AiError, chatStream, withRetries } from "./ai/client";
import { design, widgetGuide } from "./ai/designer";
import type { AiMonitor } from "./ai/monitor";
import { ADMIN_COOKIE, AuthError, type AuthStore, PROFILE_COOKIE } from "./auth";
import { CalDavError } from "./calendar/caldav";
import { GoogleError } from "./calendar/google";
import { IcsError } from "./calendar/ics";
import { calendarRoutes } from "./calendar/routes";
import { CalendarError, type CalendarService } from "./calendar/service";
import { CalendarFileError } from "./calendar/store";
import { ConfigError, type ConfigStore } from "./config-store";
import { defaultTargets, parseTargets, recognise, scan, scanPorts } from "./discover";
import { fetchFavicon } from "./favicon";
import { appFor, type IconKind, iconColor, resolveIcon, searchIcons, suggestIcons } from "./icons";
import { parseCookies, sameSite } from "./live";
import { checkTarget, NetError } from "./net";
import { isPersonalSecret, type SecretStore } from "./secrets";
import { buildHomeView, canChat, findProfile, mayManage, visibleWidgets } from "./view";
import type { WidgetHub } from "./widgets/runtime";

export interface AppDeps {
  config: ConfigStore;
  auth: AuthStore;
  secrets: SecretStore;
  hub: WidgetHub;
  ai: AiMonitor;
  /** Everyone's calendars. */
  calendar?: CalendarService;
  status: () => StatusMap;
  dataDir: string;
  /** Built page (dist/web). Missing in dev, where Vite serves the page. */
  webDir?: string;
  /** A config change happened: tell open pages. */
  onChange?: (what: "config" | "session" | "calendar") => void;
  /** The admin's own catalog entries (data/catalog/*.json). */
  extraApps?: () => AppDef[];
  /** The secret key lives in the data folder (no HEARTH_SECRET_KEY). */
  keyInDataDir?: boolean;
  version?: string;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self'",
  "script-src 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

const COLLECTIONS = {
  tiles: TileSchema,
  groups: GroupSchema,
  widgets: WidgetSchema,
  profiles: ProfileSchema,
  themes: ThemeSchema,
} as const;
type Collection = keyof typeof COLLECTIONS;

const slugOf = (s: string, fallback: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36)
    .replace(/-+$/, "") || fallback;

/**
 * Server-sent events written in order without waiting at each one; `flush()` waits for all of them
 * (call it last, or the final events can be lost when the stream closes). Failed writes (a page
 * that went away) are ignored.
 */
function queued(stream: { writeSSE: (m: { data: string }) => Promise<void> }) {
  let last: Promise<void> = Promise.resolve();
  const send = (e: unknown) => {
    last = last.then(() => stream.writeSSE({ data: JSON.stringify(e) })).catch(() => {});
  };
  return Object.assign(send, { flush: () => last });
}

class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 429,
    message: string,
    readonly issues?: string[],
  ) {
    super(message);
  }
}

interface Who {
  admin: boolean;
  profile: Profile | null;
  role: Role | null;
  session: Session;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const cfg = () => deps.config.get();

  const who = (c: Context): Who => {
    const cookies = parseCookies(c.req.header("cookie"));
    const admin = deps.auth.isAdmin(cookies[ADMIN_COOKIE]);
    const profile = findProfile(cfg(), deps.auth.profileOf(cookies[PROFILE_COOKIE]));
    return {
      admin,
      profile,
      role: profile?.role ?? (admin ? "admin" : null),
      session: { needsSetup: deps.auth.needsSetup, admin, profile: profile?.id ?? null },
    };
  };
  const requireAdmin = (c: Context): Who => {
    const w = who(c);
    if (!w.admin)
      throw new HttpError(deps.auth.needsSetup ? 403 : 401, "Sign in as the admin first.");
    return w;
  };
  const secure = (c: Context) =>
    c.req.header("x-forwarded-proto") === "https" || c.req.url.startsWith("https:");
  const setCookie = (c: Context, name: string, value: string, days: number) => {
    const attrs = [
      `${name}=${encodeURIComponent(value)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      `Max-Age=${days * 86400}`,
    ];
    if (secure(c)) attrs.push("Secure");
    c.header("Set-Cookie", attrs.join("; "), { append: true });
  };
  const clearCookie = (c: Context, name: string) =>
    c.header("Set-Cookie", `${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`, {
      append: true,
    });
  const changed = (what: "config" | "session" | "calendar" = "config") => deps.onChange?.(what);
  const body = async <T>(c: Context, schema: z.ZodType<T>): Promise<T> => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw new HttpError(400, "That wasn't JSON.");
    }
    const r = schema.safeParse(raw);
    if (!r.success)
      throw new HttpError(
        400,
        "Some of that isn't right.",
        r.error.issues.map((i) => `${i.path.join(".") || "(body)"}: ${i.message}`),
      );
    return r.data;
  };

  // ---------------------------------------------------------------------------
  // Headers, errors, and cross-site protection

  app.use("*", async (c, next) => {
    // Changes must come from Hearth's own page: a custom header can't be sent cross-site without
    // permission, and the Origin, when there is one, must be this site.
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.path.startsWith("/api/")) {
      const fromHere = sameSite(
        c.req.header("origin"),
        c.req.header("host"),
        c.req.header("x-forwarded-host"),
      );
      if (c.req.header("x-hearth") !== "1" || !fromHere) {
        return c.json({ error: "Not from Hearth's page." }, 403);
      }
    }
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "same-origin");
    c.header("X-Frame-Options", "DENY");
    if (c.res.headers.get("content-type")?.startsWith("text/html"))
      c.header("Content-Security-Policy", CSP);
  });

  app.onError((err, c) => {
    if (err instanceof HttpError)
      return c.json({ error: err.message, issues: err.issues }, err.status);
    if (err instanceof AuthError) return c.json({ error: err.message }, err.status);
    if (err instanceof ConfigError)
      return c.json({ error: "That would break the config.", issues: err.issues }, 400);
    if (err instanceof CalendarError) return c.json({ error: err.message }, err.status);
    if (err instanceof CalendarFileError)
      return c.json({ error: err.message, issues: err.issues }, 400);
    // A calendar elsewhere said no, or couldn't be reached: say why, without any secret in it.
    if (
      err instanceof CalDavError ||
      err instanceof GoogleError ||
      err instanceof IcsError ||
      err instanceof NetError
    )
      return c.json({ error: deps.secrets.redact(err.message) }, 400);
    console.error("[hearth]", err);
    return c.json({ error: "Something went wrong on Hearth's side." }, 500);
  });

  // ---------------------------------------------------------------------------
  // Session

  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      version: deps.version ?? "dev",
      configError: deps.config.error?.message ?? null,
    }),
  );

  app.get("/api/session", (c) => c.json(who(c).session));

  app.post("/api/setup", async (c) => {
    const b = await body(c, z.object({ code: z.string().max(20), password: z.string().max(200) }));
    setCookie(c, ADMIN_COOKIE, await deps.auth.setup(b.code, b.password), 30);
    changed("session");
    return c.json({ ok: true });
  });

  app.post("/api/login", async (c) => {
    const b = await body(c, z.object({ password: z.string().max(200) }));
    setCookie(c, ADMIN_COOKIE, await deps.auth.login(b.password), 30);
    return c.json({ ok: true });
  });

  app.post("/api/logout", (c) => {
    clearCookie(c, ADMIN_COOKIE);
    return c.json({ ok: true });
  });

  /** Open a profile on this device (or go back to the guest view with null). */
  app.post("/api/profile", async (c) => {
    const b = await body(
      c,
      z.object({ id: z.string().max(40).nullable(), pin: z.string().max(12).optional() }),
    );
    if (b.id === null) {
      clearCookie(c, PROFILE_COOKIE);
      return c.json({ ok: true });
    }
    const profile = findProfile(cfg(), b.id);
    if (!profile) throw new HttpError(404, "There's no such profile.");
    setCookie(c, PROFILE_COOKIE, await deps.auth.openProfile(profile.id, b.pin, who(c).admin), 365);
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // The page

  app.get("/api/home", (c) => {
    const w = who(c);
    c.header("Cache-Control", "no-store");
    return c.json(
      buildHomeView(cfg(), {
        profile: w.profile,
        session: w.session,
        hasPin: (id) => deps.auth.hasPin(id),
      }),
    );
  });

  app.get("/api/status", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(deps.status());
  });

  app.get("/api/widgets/:id", async (c) => {
    const w = who(c);
    const widget = cfg().widgets.find((x) => x.id === c.req.param("id"));
    // Widgets on this person's page, or any they may see while arranging it.
    if (!widget || !canSee(widget.audience, w.role))
      throw new HttpError(404, "There's no such widget.");
    c.header("Cache-Control", "no-store");
    return c.json(await deps.hub.current(widget, w.role));
  });

  app.get("/api/widgets/:id/image/:block", async (c) => {
    const img = await deps.hub
      .image(c.req.param("id"), c.req.param("block"), who(c).role)
      .catch(() => null);
    if (!img) return c.body(null, 404);
    return c.body(new Uint8Array(img.body), 200, {
      "content-type": img.type,
      "cache-control": "private, max-age=2",
    });
  });

  /** This person's own CSS, as a stylesheet (CSP keeps it from loading anything from outside). */
  app.get("/api/look.css", (c) => {
    const w = who(c);
    const css = w.profile ? w.profile.look.css : cfg().settings.guest.look.css;
    return c.body(css.replace(/<\/?style/gi, ""), 200, {
      "content-type": "text/css; charset=utf-8",
      "cache-control": "no-store",
    });
  });

  // ---------------------------------------------------------------------------
  // Your own page: look, layout, favourites, PIN

  /** The profile this request may change: their own (if not locked), or any for the admin. */
  const editable = (c: Context): { w: Who; profileId: string | null } => {
    const w = who(c);
    const asked = c.req.query("profile");
    if (asked && asked !== w.profile?.id) {
      if (!w.admin) throw new HttpError(403, "Only the admin can change someone else's page.");
      if (asked === "guest") return { w, profileId: null };
      if (!findProfile(cfg(), asked)) throw new HttpError(404, "There's no such profile.");
      return { w, profileId: asked };
    }
    if (!w.profile) {
      if (!w.admin) throw new HttpError(403, "Pick who you are first.");
      return { w, profileId: null }; // The admin arranging the guest page.
    }
    if (w.profile.locked && !w.admin)
      throw new HttpError(403, "This page is locked. Ask the admin to change it.");
    return { w, profileId: w.profile.id };
  };
  const editPage = (
    profileId: string | null,
    fn: (
      target: {
        look: HearthConfig["settings"]["guest"]["look"];
        layout: HearthConfig["settings"]["guest"]["layout"];
      },
      profile: Profile | null,
    ) => void,
  ) =>
    deps.config.update((draft) => {
      if (profileId === null) fn(draft.settings.guest, null);
      else {
        const p = draft.profiles.find((x) => x.id === profileId);
        if (!p) throw new HttpError(404, "There's no such profile.");
        fn(p, p);
      }
    });

  app.put("/api/me/look", async (c) => {
    const { profileId } = editable(c);
    const look = await body(c, LookSchema);
    await editPage(profileId, (t) => {
      t.look = look;
    });
    changed();
    return c.json({ ok: true });
  });

  app.put("/api/me/layout", async (c) => {
    const { profileId } = editable(c);
    const layout = await body(c, LayoutSchema);
    const role = profileId ? (findProfile(cfg(), profileId)?.role ?? null) : null;
    for (const p of layout.widgets) {
      const widget = cfg().widgets.find((x) => x.id === p.id);
      if (!widget || !canSee(widget.audience, role))
        throw new HttpError(400, `There's no widget "${p.id}" for this page.`);
    }
    await editPage(profileId, (t) => {
      t.layout = layout;
    });
    changed();
    return c.json({ ok: true });
  });

  app.put("/api/me/tiles", async (c) => {
    const { profileId } = editable(c);
    if (profileId === null) throw new HttpError(400, "The guest page has no favourites.");
    const b = await body(
      c,
      z.object({
        favorites: z.array(z.string()).max(60).optional(),
        hiddenTiles: z.array(z.string()).max(500).optional(),
        hiddenGroups: z.array(z.string()).max(100).optional(),
        groupOrder: z.array(z.string()).max(100).optional(),
      }),
    );
    await editPage(profileId, (_t, p) => {
      if (!p) return;
      if (b.favorites) p.favorites = [...new Set(b.favorites)];
      if (b.hiddenTiles) p.hiddenTiles = [...new Set(b.hiddenTiles)];
      if (b.hiddenGroups) p.hiddenGroups = [...new Set(b.hiddenGroups)];
      if (b.groupOrder) p.groupOrder = [...new Set(b.groupOrder)];
    });
    changed();
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // Sections and links: the admin manages the house's; everyone manages their own.

  /** Someone who may add or change things: the admin, or a profile whose page isn't locked. */
  const actor = (c: Context): Who => {
    const w = who(c);
    if (w.admin) return w;
    if (!w.profile) throw new HttpError(403, "Pick who you are first.");
    if (w.profile.locked)
      throw new HttpError(403, "This page is locked. Ask the admin to change it.");
    return w;
  };
  const viewerOf = (w: Who): Viewer => ({ role: w.role, profile: w.profile?.id ?? null });
  /** What a change may set: only the admin decides who sees the house's things. */
  const ownership = <T extends { audience: Tile["audience"]; people?: string[]; owner?: string }>(
    w: Who,
    item: T,
  ): T => {
    if (!w.admin) {
      if (!w.profile) throw new HttpError(403, "Pick who you are first.");
      return { ...item, owner: w.profile.id, audience: "everyone", people: undefined };
    }
    if (item.owner) return { ...item, audience: "everyone", people: undefined };
    return { ...item, people: item.people?.length ? item.people : undefined };
  };
  const uniqueId = (taken: { id: string }[], base: string) => {
    let id = base;
    for (let n = 2; taken.some((x) => x.id === id) || PAGE_PATHS.has(id); n++)
      id = `${base.slice(0, 36).replace(/-+$/, "")}-${n}`;
    return id;
  };
  /** A tile may go in this section: one the person can see, and someone's own takes only theirs. */
  const checkPlace = (draft: HearthConfig, w: Who, tile: Tile, groupId: string) => {
    const g = draft.groups.find((x) => x.id === groupId);
    if (!g || (!w.admin && !visibleTo(g, viewerOf(w))))
      throw new HttpError(400, "There's no such section.");
    if (g.owner && tile.owner !== g.owner)
      throw new HttpError(400, `"${g.name}" is someone's own section: only their links go there.`);
    if (!g.owner && !tile.owner && !w.admin)
      throw new HttpError(403, "Only the admin changes the house's links.");
  };

  /** One link, in full, for its form. */
  app.get("/api/tiles/:id", (c) => {
    const w = actor(c);
    const tile = cfg().tiles.find((x) => x.id === c.req.param("id"));
    if (!tile || !mayManage(tile, w)) throw new HttpError(404, "There's no such link.");
    return c.json(tile);
  });

  /** Add (when the id is new) or change a link. Returns its id. */
  app.put("/api/tiles/:id", async (c) => {
    const w = actor(c);
    const input = ownership(w, await body(c, TileSchema));
    const oldId = c.req.param("id");
    let id = oldId;
    await deps.config.update((draft) => {
      const at = draft.tiles.findIndex((x) => x.id === oldId);
      const old = draft.tiles[at];
      if (old && !mayManage(old, w)) throw new HttpError(403, "That isn't yours to change.");
      // Ids are kept on change; a new one is made unique (other people's ids are private).
      id = old ? old.id : uniqueId(draft.tiles, slugOf(input.id || input.name, "link"));
      const tile: Tile = { ...input, id };
      checkPlace(draft, w, tile, tile.group);
      if (old) draft.tiles[at] = tile;
      else draft.tiles.push(tile);
    });
    changed();
    return c.json({ id });
  });

  app.delete("/api/tiles/:id", async (c) => {
    const w = actor(c);
    const id = c.req.param("id");
    await deps.config.update((draft) => {
      const tile = draft.tiles.find((x) => x.id === id);
      if (!tile || !mayManage(tile, w)) throw new HttpError(404, "There's no such link.");
      draft.tiles = draft.tiles.filter((x) => x.id !== id);
      removeRefs(draft, "tiles", id);
    });
    changed();
    return c.json({ ok: true });
  });

  /** Add (when the id is new) or change a section. Returns its id. */
  app.put("/api/groups/:id", async (c) => {
    const w = actor(c);
    const input = ownership(w, await body(c, GroupSchema.extend({ id: z.string().max(40) })));
    const oldId = c.req.param("id");
    let id = oldId;
    await deps.config.update((draft) => {
      const at = draft.groups.findIndex((x) => x.id === oldId);
      const old = draft.groups[at];
      if (old && !mayManage(old, w)) throw new HttpError(403, "That isn't yours to change.");
      id = old ? old.id : uniqueId(draft.groups, slugOf(input.id || input.name, "section"));
      const group: Group = { ...input, id };
      if (group.owner && draft.tiles.some((x) => x.group === id && x.owner !== group.owner))
        throw new HttpError(
          409,
          "It has links that aren't yours. Move them out first, or let others see it.",
        );
      if (old) draft.groups[at] = group;
      else {
        draft.groups.push(group);
        // A new section of your own goes first on your page, where you'll see it.
        const p = draft.profiles.find((x) => x.id === w.profile?.id);
        if (p?.groupOrder.length) p.groupOrder = [id, ...p.groupOrder];
      }
    });
    changed();
    return c.json({ id });
  });

  /** Delete a section; `?withLinks=1` deletes its links too (they must all be yours to delete). */
  app.delete("/api/groups/:id", async (c) => {
    const w = actor(c);
    const id = c.req.param("id");
    const withLinks = c.req.query("withLinks") === "1";
    await deps.config.update((draft) => {
      const group = draft.groups.find((x) => x.id === id);
      if (!group || !mayManage(group, w)) throw new HttpError(404, "There's no such section.");
      const inside = draft.tiles.filter((x) => x.group === id);
      if (inside.length && !withLinks)
        throw new HttpError(409, "It still has links. Move them out, or delete them with it.");
      if (inside.some((x) => !mayManage(x, w)))
        throw new HttpError(403, "Some of its links aren't yours to delete.");
      if (draft.groups.length === 1) throw new HttpError(409, "Hearth needs at least one section.");
      draft.tiles = draft.tiles.filter((x) => x.group !== id);
      for (const x of inside) removeRefs(draft, "tiles", x.id);
      draft.groups = draft.groups.filter((x) => x.id !== id);
      removeRefs(draft, "groups", id);
    });
    changed();
    return c.json({ ok: true });
  });

  app.put("/api/me/pin", async (c) => {
    const { profileId } = editable(c);
    if (profileId === null) throw new HttpError(400, "The guest page can't have a PIN.");
    const b = await body(c, z.object({ pin: z.string().max(12).nullable() }));
    const openHere = who(c).profile?.id === profileId;
    await deps.auth.setPin(profileId, b.pin);
    // Keep this device signed in to the profile under its new PIN.
    if (openHere)
      setCookie(
        c,
        PROFILE_COOKIE,
        await deps.auth.openProfile(profileId, b.pin ?? undefined, true),
        365,
      );
    changed("session");
    return c.json({ ok: true });
  });

  app.post("/api/me/background", async (c) => {
    const { profileId } = editable(c);
    const file = await upload(c, join(deps.dataDir, "backgrounds"), 12 * 1024 * 1024);
    await editPage(profileId, (t) => {
      t.look = { ...t.look, background: "image", backgroundImage: file };
    });
    changed();
    return c.json({ file });
  });

  app.get("/media/backgrounds/:file", (c) =>
    serveFile(c, join(deps.dataDir, "backgrounds"), c.req.param("file"), "public, max-age=86400"),
  );
  app.get("/icons/:file", (c) =>
    serveFile(c, join(deps.dataDir, "icons"), c.req.param("file"), "public, max-age=3600", true),
  );

  // ---------------------------------------------------------------------------
  // The admin: everything shared

  app.get("/api/admin/config", (c) => {
    requireAdmin(c);
    return c.json({
      config: cfg(),
      secrets: deps.secrets.names(),
      keyInDataDir: deps.keyInDataDir ?? false,
      pins: Object.fromEntries(cfg().profiles.map((p) => [p.id, deps.auth.hasPin(p.id)])),
    });
  });

  app.put("/api/admin/config", async (c) => {
    requireAdmin(c);
    const b = await body(c, z.object({ config: z.unknown() }));
    await deps.config.update((draft) => {
      Object.assign(draft, b.config as object);
    });
    changed();
    return c.json({ ok: true });
  });

  app.put("/api/admin/settings", async (c) => {
    requireAdmin(c);
    const settings = await body(c, SettingsSchema);
    await deps.config.update((draft) => {
      // The guest page is changed through /api/me/* (as the admin, without a profile open).
      draft.settings = { ...settings, guest: draft.settings.guest };
    });
    changed();
    return c.json({ ok: true });
  });

  /** Add or replace one tile, group, widget, profile or theme. */
  app.put("/api/admin/:collection{(?:tiles|groups|widgets|profiles|themes)}/:id", async (c) => {
    requireAdmin(c);
    const collection = c.req.param("collection") as Collection;
    const schema = COLLECTIONS[collection];
    if (!schema) throw new HttpError(404, "Unknown kind of thing.");
    const item = (await body(c, schema as z.ZodType<{ id: string }>)) as { id: string };
    const oldId = c.req.param("id");
    await deps.config.update((draft) => {
      const list = draft[collection] as { id: string }[];
      const at = list.findIndex((x) => x.id === oldId);
      if (item.id !== oldId && list.some((x) => x.id === item.id))
        throw new HttpError(409, `"${item.id}" is already taken.`);
      if (at === -1) list.push(item);
      else list[at] = item;
      if (item.id !== oldId && at !== -1) renameRefs(draft, collection, oldId, item.id);
    });
    if (collection === "profiles" && item.id !== oldId)
      await deps.calendar?.renamePerson(oldId, item.id);
    changed();
    return c.json({ ok: true });
  });

  app.delete("/api/admin/:collection{(?:tiles|groups|widgets|profiles|themes)}/:id", async (c) => {
    requireAdmin(c);
    const collection = c.req.param("collection") as Collection;
    if (!COLLECTIONS[collection]) throw new HttpError(404, "Unknown kind of thing.");
    const id = c.req.param("id");
    await deps.config.update((draft) => {
      if (collection === "groups" && draft.tiles.some((t) => t.group === id))
        throw new HttpError(409, "Move or delete this group's tiles first.");
      (draft as Record<Collection, { id: string }[]>)[collection] = (
        draft[collection] as { id: string }[]
      ).filter((x) => x.id !== id);
      removeRefs(draft, collection, id);
    });
    if (collection === "profiles") {
      await deps.auth.forgetProfile(id);
      await deps.calendar?.forget(id);
    }
    changed();
    return c.json({ ok: true });
  });

  app.put("/api/admin/order/:collection{(?:tiles|groups|widgets|profiles|themes)}", async (c) => {
    requireAdmin(c);
    const collection = c.req.param("collection") as Collection;
    if (!COLLECTIONS[collection]) throw new HttpError(404, "Unknown kind of thing.");
    const { ids } = await body(c, z.object({ ids: z.array(z.string()).max(1000) }));
    await deps.config.update((draft) => {
      const list = draft[collection] as { id: string }[];
      const pos = (id: string) => {
        const i = ids.indexOf(id);
        return i === -1 ? ids.length : i;
      };
      list.sort((a, b) => pos(a.id) - pos(b.id));
    });
    changed();
    return c.json({ ok: true });
  });

  app.put("/api/admin/pins/:profile", async (c) => {
    requireAdmin(c);
    if (!findProfile(cfg(), c.req.param("profile")))
      throw new HttpError(404, "There's no such profile.");
    const b = await body(c, z.object({ pin: z.string().max(12).nullable() }));
    await deps.auth.setPin(c.req.param("profile"), b.pin);
    changed("session");
    return c.json({ ok: true });
  });

  app.post("/api/admin/password", async (c) => {
    requireAdmin(c);
    const b = await body(c, z.object({ password: z.string().max(200) }));
    setCookie(c, ADMIN_COOKIE, await deps.auth.changePassword(b.password), 30);
    return c.json({ ok: true });
  });

  app.put("/api/admin/secrets/:name", async (c) => {
    requireAdmin(c);
    const b = await body(c, z.object({ value: z.string().min(1).max(8000).nullable() }));
    if (isPersonalSecret(c.req.param("name")))
      throw new HttpError(403, "That's someone's own calendar sign-in.");
    try {
      await deps.secrets.set(c.req.param("name"), b.value);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    return c.json({ ok: true, names: deps.secrets.names() });
  });

  app.post("/api/admin/icons", async (c) => {
    requireAdmin(c);
    return c.json({ file: await upload(c, join(deps.dataDir, "icons"), 2 * 1024 * 1024) });
  });

  // AI servers: their settings live in the config, their keys in the secrets.
  app.put("/api/admin/ai/servers/:id", async (c) => {
    requireAdmin(c);
    const b = await body(
      c,
      AiServerSchema.extend({ key: z.string().max(4000).nullable().optional() }),
    );
    const { key, ...server } = b;
    const oldId = c.req.param("id");
    await deps.config.update((draft) => {
      const list = draft.settings.ai.servers;
      const at = list.findIndex((s) => s.id === oldId);
      if (server.id !== oldId && list.some((s) => s.id === server.id))
        throw new HttpError(409, `"${server.id}" is already taken.`);
      if (at === -1) list.push(server);
      else list[at] = server;
      if (!draft.settings.ai.defaultServer || draft.settings.ai.defaultServer === oldId)
        draft.settings.ai.defaultServer = server.id;
    });
    if (key !== undefined) await deps.secrets.set(`ai:${server.id}`, key);
    if (server.id !== oldId && deps.secrets.has(`ai:${oldId}`)) {
      if (key === undefined)
        await deps.secrets.set(`ai:${server.id}`, deps.secrets.get(`ai:${oldId}`) as string);
      await deps.secrets.set(`ai:${oldId}`, null);
    }
    void deps.ai.checkAll();
    changed();
    return c.json({ ok: true });
  });

  app.delete("/api/admin/ai/servers/:id", async (c) => {
    requireAdmin(c);
    const id = c.req.param("id");
    await deps.config.update((draft) => {
      draft.settings.ai.servers = draft.settings.ai.servers.filter((s) => s.id !== id);
      if (draft.settings.ai.defaultServer === id)
        draft.settings.ai.defaultServer = draft.settings.ai.servers[0]?.id;
    });
    if (deps.secrets.has(`ai:${id}`)) await deps.secrets.set(`ai:${id}`, null);
    changed();
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // Widget editor and AI designer (admin)

  app.post("/api/widgets/preview", async (c) => {
    requireAdmin(c);
    const b = await body(c, z.object({ doc: z.unknown() }));
    return c.json(await deps.hub.preview(b.doc));
  });

  app.get("/api/widgets-guide", (c) => {
    requireAdmin(c);
    const guide = widgetGuide({
      secrets: deps.secrets.names(),
      allowInternet: cfg().settings.network.allowInternet,
    });
    return c.text(
      `Write one widget for Hearth, the start page of a home network. Reply with only the widget JSON document.\n\nWhat I want on it: <describe it here, with the API's address>\n\n${guide}`,
    );
  });

  const pickServer = (id: string | undefined) => {
    const s = cfg().settings;
    const server = s.ai.servers.find((x) => x.id === (id || s.ai.defaultServer)) ?? s.ai.servers[0];
    if (!server) throw new HttpError(400, "Add an AI server first (Settings → AI).");
    return server;
  };

  app.post("/api/ai/design", async (c) => {
    requireAdmin(c);
    const b = await body(
      c,
      z.object({
        server: z.string().max(40).optional(),
        model: z.string().max(120).optional(),
        messages: z
          .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(20_000) }))
          .max(40),
        draft: z.unknown().optional(),
      }),
    );
    const server = pickServer(b.server);
    const model = b.model || server.model || "";
    if (!model) throw new HttpError(400, `Choose a model for ${server.name}.`);
    return streamSSE(c, async (stream) => {
      const controller = new AbortController();
      stream.onAbort(() => controller.abort());
      // A page that went away mustn't take the server with it: a failed write is ignored.
      const emit: ((e: DesignEvent) => void) & { flush: () => Promise<void> } = queued(stream);
      emit({ type: "start", server: server.name, model });
      try {
        await design(
          {
            conn: deps.ai.conn(server),
            model,
            hub: deps.hub,
            secrets: deps.secrets,
            allowInternet: cfg().settings.network.allowInternet,
            homeName: cfg().settings.homeName,
            services: cfg().tiles.map((t) => ({ name: t.name, url: t.url, checkUrl: t.checkUrl })),
            log: (msg) => console.log(`[hearth] ${msg}`),
          },
          b.messages as ChatMessage[],
          b.draft,
          emit,
          controller.signal,
        );
      } catch (e) {
        console.error("[hearth] the AI designer failed:", e);
        emit({
          type: "error",
          message: "The designer hit a problem on Hearth's side (it's in the log). Try again.",
        });
      }
      await emit.flush();
    });
  });

  // ---------------------------------------------------------------------------
  // AI chat and the compute page

  app.get("/api/ai/servers", (c) => {
    const w = who(c);
    if (!canChat(cfg(), w.role) && !w.admin)
      throw new HttpError(403, "AI isn't turned on for this profile.");
    return c.json(deps.ai.list().map((s) => (w.admin ? s : { ...s, url: undefined })));
  });

  app.post("/api/ai/servers/check", async (c) => {
    const w = who(c);
    if (!canChat(cfg(), w.role) && !w.admin)
      throw new HttpError(403, "AI isn't turned on for this profile.");
    await deps.ai.checkAll();
    return c.json(deps.ai.list().map((s) => (w.admin ? s : { ...s, url: undefined })));
  });

  app.post("/api/ai/chat", async (c) => {
    const w = who(c);
    if (!canChat(cfg(), w.role))
      throw new HttpError(403, "AI chat isn't turned on for this profile.");
    const b = await body(
      c,
      z.object({
        server: z.string().max(40).optional(),
        model: z.string().max(120).optional(),
        messages: z
          .array(
            z.object({
              role: z.enum(["system", "user", "assistant"]),
              content: z.string().max(50_000),
            }),
          )
          .min(1)
          .max(100),
      }),
    );
    const server = pickServer(b.server);
    const model = b.model || server.model || "";
    if (!model) throw new HttpError(400, `Choose a model for ${server.name}.`);
    const s = cfg().settings;
    const who_ = w.profile
      ? `You're talking with ${w.profile.name}${w.profile.role === "child" ? ", a child: keep answers kind, simple and safe" : ""}.`
      : "";
    const system = [
      `You're the assistant on ${s.homeName ?? "the family's"} home network start page.`,
      who_,
      s.ai.systemPrompt,
    ]
      .filter(Boolean)
      .join(" ");
    const messages: ChatMessage[] = [
      { role: "system", content: system },
      ...b.messages.filter((m) => m.role !== "system"),
    ];
    return streamSSE(c, async (stream) => {
      const controller = new AbortController();
      stream.onAbort(() => controller.abort());
      const emit = (e: ChatEvent) => stream.writeSSE({ data: JSON.stringify(e) }).catch(() => {});
      const started = Date.now();
      await emit({ type: "start", server: server.name, model });
      try {
        const out = await withRetries(
          () =>
            chatStream(
              deps.ai.conn(server),
              model,
              messages,
              (text) => void emit({ type: "text", text }),
              controller.signal,
            ),
          (reason, seconds) => void emit({ type: "wait", reason, seconds }),
        );
        await emit({ type: "done", ms: Date.now() - started, tokens: out.tokens });
      } catch (e) {
        await emit({
          type: "error",
          message: e instanceof AiError ? e.message : "The AI server didn't answer.",
        });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Icons

  app.get("/api/icons", (c) => {
    const kind = (c.req.query("kind") ?? "all") as IconKind;
    const limit = Math.min(120, Number(c.req.query("limit") ?? 60) || 60);
    return c.json(
      searchIcons(
        c.req.query("q") ?? "",
        ["all", "brand", "symbol", "emoji"].includes(kind) ? kind : "all",
        limit,
      ),
    );
  });

  /** What a stored icon looks like, for previews. */
  app.get("/api/icons/resolve", (c) => c.json(resolveIcon(c.req.query("ref") ?? "")));

  app.get("/api/icons/suggest", (c) =>
    c.json(suggestIcons(c.req.query("name") ?? "", c.req.query("url") ?? undefined, extraApps())),
  );

  /** Fetch a site's own icon into data/icons. Anyone arranging their own page may. */
  app.post("/api/icons/fetch", async (c) => {
    const w = who(c);
    if (!w.admin && !(w.profile && !w.profile.locked))
      throw new HttpError(403, "Pick who you are first.");
    const b = await body(c, z.object({ url: z.url({ protocol: /^https?$/ }) }));
    // Like widgets, only the home network unless the admin allowed the internet.
    const policy = cfg().settings.network;
    try {
      checkTarget(b.url, policy);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    const allowed = (u: string) => {
      try {
        checkTarget(u, policy);
        return true;
      } catch {
        return false;
      }
    };
    const file = await fetchFavicon(b.url, join(deps.dataDir, "icons"), allowed);
    if (!file)
      throw new HttpError(
        404,
        "That site doesn't offer an icon Hearth can use. Pick one from the library instead.",
      );
    return c.json({ file });
  });

  // ---------------------------------------------------------------------------
  // Finding services and the app catalog

  const extraApps = () => deps.extraApps?.() ?? [];
  const appSummary = (a: AppDef) => ({
    id: a.id,
    name: a.name,
    icon: a.icon,
    svg: resolveIcon(a.icon).svg,
    color: a.color ?? iconColor(a.icon),
    category: a.category,
    description: a.description,
    widgets: (a.widgets ?? []).map((wd) => ({
      id: wd.id,
      name: wd.name,
      description: wd.description,
      secret: wd.secret,
      params: wd.params,
      private: wd.private ?? false,
    })),
  });

  app.post("/api/admin/recognize", async (c) => {
    requireAdmin(c);
    const b = await body(c, z.object({ url: z.url({ protocol: /^https?$/ }) }));
    try {
      checkTarget(b.url, cfg().settings.network);
    } catch {
      // An internet address while the internet isn't allowed: name it by its address alone.
      const app = appFor("", b.url, extraApps());
      return c.json({
        checked: false,
        reachable: false,
        title: "",
        app: app ? appSummary(app) : null,
      });
    }
    const r = await recognise(b.url, extraApps());
    return c.json({
      checked: true,
      reachable: r.reachable,
      title: r.title,
      app: r.app ? appSummary(r.app) : null,
    });
  });

  app.get("/api/admin/discover", (c) => {
    requireAdmin(c);
    const tiles = cfg().tiles.flatMap((t) =>
      [t.url, t.checkUrl].filter((u): u is string => Boolean(u)),
    );
    return c.json({ targets: defaultTargets(tiles), ports: scanPorts(extraApps()).length });
  });

  app.post("/api/admin/discover", async (c) => {
    requireAdmin(c);
    const b = await body(c, z.object({ targets: z.string().max(2000) }));
    const { hosts, refused } = parseTargets(b.targets);
    if (!hosts.length)
      throw new HttpError(
        400,
        `Nothing to scan. Use private addresses like 192.168.1.0/24${refused.length ? ` (skipped ${refused.join(", ")})` : ""}.`,
      );
    const known = new Map<string, string>();
    for (const t of cfg().tiles) {
      for (const u of [t.url, t.checkUrl]) {
        if (!u) continue;
        try {
          const x = new URL(u);
          known.set(`${x.hostname}:${x.port || (x.protocol === "https:" ? "443" : "80")}`, t.id);
        } catch {
          // Not an address.
        }
      }
    }
    return streamSSE(c, async (stream) => {
      const controller = new AbortController();
      stream.onAbort(() => controller.abort());
      const send = queued(stream);
      const ports = scanPorts(extraApps());
      send({ type: "start", hosts: hosts.length, ports: ports.length, refused });
      await scan(
        hosts,
        ports,
        (done, total) => send({ type: "progress", done, total }),
        (f) =>
          send({
            type: "found",
            found: {
              ...f,
              app: f.app
                ? {
                    ...f.app,
                    svg: resolveIcon(f.app.icon).svg,
                    color: f.app.color ?? iconColor(f.app.icon),
                  }
                : undefined,
              tile: known.get(`${f.host}:${f.port}`) ?? null,
            },
          }),
        controller.signal,
        extraApps(),
        (done, total) => send({ type: "looking", done, total }),
      );
      send({ type: "done" });
      // The last events must go out before the stream closes, or the page thinks it was stopped.
      await send.flush();
    });
  });

  /** Several tiles at once (from a scan), creating their groups by name when needed. */
  app.post("/api/admin/tiles/add-many", async (c) => {
    requireAdmin(c);
    const b = await body(
      c,
      z.object({
        items: z
          .array(
            z.object({
              name: z.string().min(1).max(40),
              url: z.url({ protocol: /^https?$/ }),
              group: z.string().min(1).max(40),
              icon: z.string().max(80).optional(),
              color: z.string().optional(),
              app: z.string().max(40).optional(),
            }),
          )
          .min(1)
          .max(200),
      }),
    );
    const added: string[] = [];
    await deps.config.update((draft) => {
      for (const item of b.items) {
        let group = draft.groups.find(
          (g) => g.id === item.group || g.name.toLowerCase() === item.group.toLowerCase(),
        );
        if (!group) {
          let gid = slugOf(item.group, "group");
          for (let n = 2; draft.groups.some((g) => g.id === gid); n++)
            gid = `${slugOf(item.group, "group")}-${n}`;
          group = { id: gid, name: item.group.slice(0, 40), audience: "everyone" };
          draft.groups.push(group);
        }
        const taken = new Set([
          ...draft.tiles.map((t) => t.id),
          ...draft.tiles.map((t) => shortLinkOf(t) ?? ""),
        ]);
        let id = slugOf(item.name, "tile");
        for (let n = 2; taken.has(id) || PAGE_PATHS.has(id); n++)
          id = `${slugOf(item.name, "tile")}-${n}`;
        draft.tiles.push({
          id,
          name: item.name,
          url: item.url,
          group: group.id,
          icon: item.icon,
          color: /^#[0-9a-f]{6}$/i.test(item.color ?? "") ? item.color : undefined,
          app: item.app,
          audience: "everyone",
          check: true,
          keywords: [],
          newTab: false,
        });
        added.push(id);
      }
    });
    changed();
    return c.json({ added });
  });

  /**
   * Move links between sections and reorder them, in one go (dragging in edit mode). Only links
   * this person may change move; they're reordered among the places they already had, so things
   * they can't see keep theirs.
   */
  app.put("/api/tiles-layout", async (c) => {
    const w = actor(c);
    const b = await body(
      c,
      z.object({ groups: z.record(z.string(), z.array(z.string()).max(1000)).default({}) }),
    );
    await deps.config.update((draft) => {
      const byId = new Map(draft.tiles.map((x) => [x.id, x]));
      const moved: Tile[] = [];
      for (const [gid, ids] of Object.entries(b.groups)) {
        for (const id of ids) {
          const tile = byId.get(id);
          if (!tile || moved.includes(tile) || !mayManage(tile, w)) continue;
          if (tile.group !== gid) checkPlace(draft, w, tile, gid);
          tile.group = gid;
          moved.push(tile);
        }
      }
      const slots = draft.tiles.map((x, i) => (moved.includes(x) ? i : -1)).filter((i) => i !== -1);
      slots.forEach((slot, k) => {
        draft.tiles[slot] = moved[k] as Tile;
      });
    });
    changed();
    return c.json({ ok: true });
  });

  app.get("/api/admin/catalog", (c) => {
    requireAdmin(c);
    const all = [...APPS, ...extraApps()];
    return c.json({
      apps: all.map(appSummary),
      general: GENERAL_TEMPLATES.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        icon: g.icon,
        svg: resolveIcon(g.icon).svg,
        needsInternet: g.needsInternet ?? false,
        params: g.params ?? [],
      })),
      yours: cfg()
        .tiles.filter((t) => t.app)
        .map((t) => ({ tile: t.id, name: t.name, url: t.url, app: t.app })),
      allowInternet: cfg().settings.network.allowInternet,
    });
  });

  /** Add a widget from the catalog: fill its template, keep its key as a secret, put it on a page. */
  app.post("/api/admin/widgets/install", async (c) => {
    requireAdmin(c);
    const b = await body(
      c,
      z.object({
        app: z.string().max(40).optional(),
        widget: z.string().max(40).optional(),
        general: z.string().max(40).optional(),
        base: z.string().max(500).optional(),
        secret: z.string().max(4000).optional(),
        params: z.record(z.string(), z.string().max(500)).default({}),
        title: z.string().max(40).optional(),
        audience: Audience.optional(),
        /** Put it on this page: a profile id, "guest", or nothing. */
        page: z.string().max(40).optional(),
      }),
    );
    let template: WidgetDocInput;
    let name: string;
    let needsSecret = false;
    let privateWidget = false;
    if (b.general) {
      const g = GENERAL_TEMPLATES.find((x) => x.id === b.general);
      if (!g) throw new HttpError(404, "There's no such template.");
      template = g.doc;
      name = g.name;
    } else {
      const a = [...APPS, ...extraApps()].find((x) => x.id === b.app);
      const wd = a?.widgets?.find((x) => x.id === b.widget);
      if (!a || !wd) throw new HttpError(404, "There's no such widget.");
      template = wd.doc;
      name = wd.name.replace(/^[^:]+:\s*/, `${a.name}: `);
      needsSecret = Boolean(wd.secret);
      privateWidget = wd.private ?? false;
      if (!b.base) throw new HttpError(400, `Where is ${a.name}? Give its address.`);
    }
    const title = (b.title?.trim() || name).slice(0, 40);
    let id = slugOf(title, "widget");
    for (let n = 2; cfg().widgets.some((w) => w.id === id); n++)
      id = `${slugOf(title, "widget")}-${n}`;
    const secretName = needsSecret ? `widget:${id}` : undefined;
    if (needsSecret && !b.secret) throw new HttpError(400, "This widget needs its key.");
    const doc = fillTemplate(template, { base: b.base, secretName, params: b.params });
    const widget = {
      id,
      type: "custom" as const,
      title,
      audience: b.audience ?? (privateWidget ? "admin" : "everyone"),
      doc,
    };
    const parsed = WidgetSchema.safeParse(widget);
    if (!parsed.success)
      throw new HttpError(
        400,
        "That doesn't make a working widget.",
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      );
    if (secretName && b.secret) await deps.secrets.set(secretName, b.secret);
    await deps.config.update((draft) => {
      draft.widgets.push(parsed.data);
      const page =
        b.page === "guest" ? draft.settings.guest : draft.profiles.find((p) => p.id === b.page);
      if (page) page.layout.widgets.push({ id, w: 4 });
    });
    changed();
    return c.json({ id });
  });

  // ---------------------------------------------------------------------------
  // Calendars

  if (deps.calendar)
    calendarRoutes(app, {
      service: deps.calendar,
      config: deps.config,
      secrets: deps.secrets,
      who: (c) => who(c),
      hasPin: (p) => deps.auth.hasPin(p),
      body,
      changed: () => changed("calendar"),
    });

  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

  // ---------------------------------------------------------------------------
  // The built page, and short links

  if (deps.webDir) {
    const webDir = deps.webDir;
    app.get("/assets/*", async (c) => {
      const file = await readSafe(webDir, c.req.path.slice(1));
      if (!file) return c.notFound();
      // Vite puts a content hash in every asset name, so they can be cached for good.
      return c.body(file.body, 200, {
        "content-type": file.type,
        "cache-control": "public, max-age=31536000, immutable",
      });
    });
    for (const f of ["favicon.svg", "manifest.webmanifest"]) {
      app.get(`/${f}`, async (c) => {
        const file = await readSafe(webDir, f);
        return file
          ? c.body(file.body, 200, {
              "content-type": file.type,
              "cache-control": "public, max-age=86400",
            })
          : c.notFound();
      });
    }
    const page = async (c: Context) => {
      const file = await readSafe(webDir, "index.html");
      if (!file) return c.text("The page hasn't been built. Run `npm run build`.", 500);
      return c.body(file.body, 200, { "content-type": file.type, "cache-control": "no-cache" });
    };
    app.get("/", page);
    // The page's own routes (the app decides what to show).
    for (const route of [
      "/calendar",
      "/chat",
      "/compute",
      "/widgets",
      "/widgets/*",
      "/themes",
      "/settings",
      "/settings/*",
      "/setup",
      "/admin",
    ])
      app.get(route, page);
  } else {
    // Dev: Vite serves the page on its own port. Say so instead of showing a blank page.
    app.get("/", (c) =>
      c.html(
        `<!doctype html><meta charset="utf-8"><title>Hearth (API only)</title>` +
          `<h1>This is Hearth's API server.</h1>` +
          `<p>In development, open the page at <a href="http://localhost:5173">http://localhost:5173</a>.</p>` +
          `<p>To serve the page from here, run <code>npm run build</code> and <code>npm start</code>.</p>`,
      ),
    );
  }

  // Short links: start.home/muny → https://muny.home
  app.get("/:short{[a-z0-9][a-z0-9-]{0,39}}", (c) => {
    const short = c.req.param("short");
    if (RESERVED_PATHS.has(short)) return c.notFound();
    const tile = cfg().tiles.find((t) => shortLinkOf(t) === short);
    if (!tile) return c.notFound();
    c.header("Cache-Control", "no-store");
    return c.redirect(tile.url, 302);
  });

  app.notFound((c) => c.text("Not found. Try start.home", 404));

  return app;
}

// ---------------------------------------------------------------------------
// Keeping references right when something is renamed or removed

function renameRefs(cfg: HearthConfig, collection: Collection, from: string, to: string) {
  const swap = (list: string[]) => list.map((x) => (x === from ? to : x));
  const pages = [cfg.settings.guest, ...cfg.profiles];
  if (collection === "tiles") {
    for (const p of cfg.profiles) {
      p.favorites = swap(p.favorites);
      p.hiddenTiles = swap(p.hiddenTiles);
    }
  } else if (collection === "groups") {
    for (const t of cfg.tiles) if (t.group === from) t.group = to;
    for (const p of cfg.profiles) {
      p.groupOrder = swap(p.groupOrder);
      p.hiddenGroups = swap(p.hiddenGroups);
    }
  } else if (collection === "widgets") {
    for (const p of pages) for (const w of p.layout.widgets) if (w.id === from) w.id = to;
  } else if (collection === "themes") {
    for (const p of pages) if (p.look.theme === from) p.look.theme = to;
  } else if (collection === "profiles") {
    for (const x of [...cfg.groups, ...cfg.tiles]) {
      if (x.owner === from) x.owner = to;
      if (x.people) x.people = swap(x.people);
    }
  }
}

function removeRefs(cfg: HearthConfig, collection: Collection, id: string) {
  const drop = (list: string[]) => list.filter((x) => x !== id);
  const pages = [cfg.settings.guest, ...cfg.profiles];
  if (collection === "tiles") {
    for (const p of cfg.profiles) {
      p.favorites = drop(p.favorites);
      p.hiddenTiles = drop(p.hiddenTiles);
    }
  } else if (collection === "groups") {
    for (const p of cfg.profiles) {
      p.groupOrder = drop(p.groupOrder);
      p.hiddenGroups = drop(p.hiddenGroups);
    }
  } else if (collection === "widgets") {
    for (const p of pages) p.layout.widgets = p.layout.widgets.filter((w) => w.id !== id);
  } else if (collection === "themes") {
    for (const p of pages) if (p.look.theme === id) p.look.theme = "system";
  } else if (collection === "profiles") {
    // Their own sections and links go with them.
    const tiles = cfg.tiles.filter((t) => t.owner === id).map((t) => t.id);
    const groups = cfg.groups.filter((g) => g.owner === id).map((g) => g.id);
    cfg.tiles = cfg.tiles.filter((t) => t.owner !== id && !groups.includes(t.group));
    cfg.groups = cfg.groups.filter((g) => g.owner !== id);
    for (const t of tiles) removeRefs(cfg, "tiles", t);
    for (const g of groups) removeRefs(cfg, "groups", g);
    for (const x of [...cfg.groups, ...cfg.tiles])
      if (x.people) {
        x.people = drop(x.people);
        if (!x.people.length) {
          // Nobody left on the list: keep it to the admin rather than showing it to everyone.
          x.people = undefined;
          x.audience = "admin";
        }
      }
  }
}

// ---------------------------------------------------------------------------
// Files

/** Only real pictures: checked by their first bytes, not their name. SVG is refused (it can hold script). */
function imageType(buf: Buffer): string | null {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return ".png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ".jpg";
  if (buf.subarray(0, 4).toString("ascii") === "GIF8") return ".gif";
  if (
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return ".webp";
  if (buf.subarray(4, 12).toString("ascii") === "ftypavif") return ".avif";
  if (buf.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))) return ".ico";
  return null;
}

async function upload(c: Context, dir: string, maxBytes: number): Promise<string> {
  const form = await c.req.parseBody().catch(() => null);
  const file = form?.file;
  if (!(file instanceof File)) throw new HttpError(400, 'Send the picture as "file".');
  if (file.size > maxBytes)
    throw new HttpError(413, `Pictures can be up to ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  const buf = Buffer.from(await file.arrayBuffer());
  const ext = imageType(buf);
  if (!ext) throw new HttpError(400, "That isn't a PNG, JPEG, GIF, WebP, AVIF or ICO picture.");
  await mkdir(dir, { recursive: true });
  const name = `${randomBytes(6).toString("hex")}${ext}`;
  await writeFile(join(dir, name), buf);
  return name;
}

async function serveFile(c: Context, root: string, name: string, cache: string, allowSvg = false) {
  const file = await readSafe(root, name);
  if (!file || file.type.startsWith("text/") || (file.type === MIME[".svg"] && !allowSvg)) {
    return c.body(null, 404);
  }
  // A picture can't run anything, even an SVG someone opens directly.
  return c.body(file.body, 200, {
    "content-type": file.type,
    "cache-control": cache,
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  });
}

/** Read a file inside `root`, refusing anything that would step outside it. */
async function readSafe(
  root: string,
  relative: string,
): Promise<{ body: Uint8Array<ArrayBuffer>; type: string } | null> {
  const path = normalize(join(root, relative));
  if (!path.startsWith(normalize(root) + sep)) return null;
  const type = MIME[extname(path).toLowerCase()];
  if (!type) return null;
  try {
    if (!(await stat(path)).isFile()) return null;
    return { body: new Uint8Array(await readFile(path)), type };
  } catch {
    return null;
  }
}

export { visibleWidgets };
