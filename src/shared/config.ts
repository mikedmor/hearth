/**
 * The shape of `hearth.json` (version 2): tiles, groups, widgets, themes, profiles, AI servers.
 *
 * The server validates the file on every load, so a typo gives a clear error instead of a broken
 * page. Secrets (API keys, PINs, the admin password) are never in this file: they live in
 * `secrets.json` and `auth.json`, so this one can be shown, shared and edited in the page.
 */
import { z } from "zod";
import { LookSchema, ThemeSchema } from "./themes";
import { WidgetDocSchema } from "./widget-doc";

export const CONFIG_VERSION = 3;

export const slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "use lowercase letters, digits and dashes (max 40)");

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "use a colour like #e8743b");
const httpUrl = z.url({ protocol: /^https?$/ });

/** Paths a short link may never take, because the app serves them itself. */
export const RESERVED_PATHS = new Set([
  "api",
  "assets",
  "icons",
  "media",
  "trust",
  "admin",
  "login",
  "logout",
  "setup",
  "chat",
  "compute",
  "widgets",
  "themes",
  "settings",
  "tiles",
  "favicon.ico",
  "favicon.svg",
  "manifest.webmanifest",
  "robots.txt",
  "index.html",
]);
/**
 * What new ids and short links avoid: the reserved paths and pages added since. Those are kept
 * out of RESERVED_PATHS so a config with a tile called "calendar" still loads; the page wins.
 */
export const PAGE_PATHS = new Set([...RESERVED_PATHS, "calendar"]);

export const Audience = z.enum(["everyone", "adults", "admin"]);
export type Audience = z.infer<typeof Audience>;

export const Role = z.enum(["admin", "adult", "child"]);
export type Role = z.infer<typeof Role>;

/**
 * Who sees a section or a link: an audience by role, or only some people, or only its
 * owner. The admin sees everything except other people's own things.
 */
const visibility = {
  audience: Audience.default("everyone"),
  /** Only these people (profile ids), and the admin. Overrides `audience` when set. */
  people: z.array(slug).max(30).optional(),
  /** Someone's own (a profile id): only they see it, and they can change it. */
  owner: slug.optional(),
};

export const GroupSchema = z.object({
  id: slug,
  name: z.string().min(1).max(40),
  ...visibility,
});
export type Group = z.infer<typeof GroupSchema>;

export const TileSchema = z.object({
  id: slug,
  name: z.string().min(1).max(40),
  url: httpUrl,
  group: slug,
  description: z.string().max(80).optional(),
  /**
   * An icon: "si:<slug>" (an app logo), "lucide:<name>" (a symbol), an emoji, a file in data/icons
   * ("plex.png"), or omitted for a coloured monogram.
   */
  icon: z.string().max(80).optional(),
  color: hexColor.optional(),
  /** Which app from the catalog this is, when Hearth recognised it (for its widgets). */
  app: z.string().max(40).optional(),
  ...visibility,
  /** Set false for services that wake up or log every visit. */
  check: z.boolean().default(true),
  /** Check this address instead of `url`, e.g. the NAS port behind the proxy. */
  checkUrl: httpUrl.optional(),
  /** `start.home/<short>` redirects here. Defaults to the tile's id; false turns it off. */
  short: z.union([slug, z.literal(false)]).optional(),
  /** Extra words search should match ("budget", "money"). */
  keywords: z.array(z.string().max(30)).max(10).default([]),
  /** Open in a new tab. */
  newTab: z.boolean().default(false),
});
export type Tile = z.infer<typeof TileSchema>;

// ---------------------------------------------------------------------------
// Widgets

const widgetBase = {
  id: slug,
  title: z.string().max(40).optional(),
  audience: Audience.default("everyone"),
};

export const WidgetSchema = z.discriminatedUnion("type", [
  z.object({ ...widgetBase, type: z.literal("status") }),
  z.object({
    ...widgetBase,
    type: z.literal("note"),
    options: z.object({
      text: z.string().max(500),
      tone: z.enum(["info", "warning", "celebrate"]).default("info"),
    }),
  }),
  z.object({
    ...widgetBase,
    type: z.literal("countdown"),
    options: z.object({
      events: z
        .array(
          z.object({
            name: z.string().min(1).max(40),
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD"),
            emoji: z.string().max(8).optional(),
            /** Birthdays and holidays roll over to next year once passed. */
            yearly: z.boolean().default(false),
          }),
        )
        .max(30),
      show: z.number().int().min(1).max(8).default(3),
    }),
  }),
  /** The time here, and in other places (family abroad, a server's time zone). */
  z.object({
    ...widgetBase,
    type: z.literal("clock"),
    options: z
      .object({
        zones: z
          .array(
            z.object({ label: z.string().min(1).max(30), timeZone: z.string().min(1).max(60) }),
          )
          .max(8)
          .default([]),
        seconds: z.boolean().default(false),
      })
      .prefault({}),
  }),
  /** The AI servers at a glance: up, busy, models loaded. */
  z.object({ ...widgetBase, type: z.literal("ai") }),
  /** A quick box to ask the AI, which opens the chat. */
  z.object({ ...widgetBase, type: z.literal("ask") }),
  /** What's on the viewer's own calendar: each person sees theirs. */
  z.object({
    ...widgetBase,
    type: z.literal("agenda"),
    options: z.object({ days: z.number().int().min(1).max(14).default(7) }).prefault({}),
  }),
  z.object({
    ...widgetBase,
    type: z.literal("custom"),
    description: z.string().max(200).optional(),
    doc: WidgetDocSchema,
  }),
]);
export type Widget = z.infer<typeof WidgetSchema>;
export type WidgetType = Widget["type"];

// ---------------------------------------------------------------------------
// Layouts

export const SECTION_KINDS = ["hero", "search", "widgets", "favorites", "groups"] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];
export const WIDGET_WIDTHS = [3, 4, 6, 8, 12] as const;

export const LayoutSchema = z.object({
  sections: z
    .array(z.object({ kind: z.enum(SECTION_KINDS), hidden: z.boolean().default(false) }))
    .default(SECTION_KINDS.map((kind) => ({ kind, hidden: false })))
    // Every section appears once, in the chosen order; missing ones go at the end.
    .transform((list) => {
      const seen = new Set<string>();
      const out = list.filter((s) => !seen.has(s.kind) && seen.add(s.kind));
      for (const kind of SECTION_KINDS) if (!seen.has(kind)) out.push({ kind, hidden: false });
      return out;
    }),
  /** Widgets on the page, in order, each so many columns of 12 wide. */
  widgets: z
    .array(z.object({ id: slug, w: z.union(WIDGET_WIDTHS.map((n) => z.literal(n))).default(4) }))
    .default([]),
});
export type Layout = z.infer<typeof LayoutSchema>;

export const ProfileSchema = z.object({
  id: slug,
  name: z.string().min(1).max(30),
  /** An emoji; the page falls back to the first letter of the name. */
  avatar: z.string().max(8).optional(),
  color: hexColor.default("#e8743b"),
  role: Role.default("adult"),
  /** Only the admin can change this page (a child's). */
  locked: z.boolean().default(false),
  look: LookSchema.prefault({}),
  layout: LayoutSchema.prefault({}),
  /** Tile ids shown in the favourites dock. */
  favorites: z.array(slug).default([]),
  /** Group ids in the order this person wants; groups left out come after. */
  groupOrder: z.array(slug).default([]),
  hiddenGroups: z.array(slug).default([]),
  hiddenTiles: z.array(slug).default([]),
});
export type Profile = z.infer<typeof ProfileSchema>;

// ---------------------------------------------------------------------------
// AI servers

export const AiServerSchema = z.object({
  id: slug,
  name: z.string().min(1).max(40),
  /** Which API it speaks. Ollama servers also answer the OpenAI one, but Ollama's says more. */
  kind: z.enum(["ollama", "openai"]),
  /** Ollama: http://host:11434. OpenAI-compatible: the base, usually ending in /v1. */
  url: httpUrl,
  /** The model to use when none is chosen. */
  model: z.string().max(120).optional(),
});
export type AiServer = z.infer<typeof AiServerSchema>;

export const SettingsSchema = z.object({
  title: z.string().max(40).default("Hearth"),
  /** "The Morgan home"; shown under the greeting. */
  homeName: z.string().max(60).optional(),
  /** For numbers and dates in widgets. */
  locale: z.string().max(20).default("en-US"),
  timeZone: z.string().max(60).optional(),
  /** What a visitor who hasn't picked a profile sees. */
  guest: z
    .object({ look: LookSchema.prefault({}), layout: LayoutSchema.prefault({}) })
    .prefault({}),
  status: z
    .object({
      intervalSeconds: z.number().int().min(10).max(3600).default(30),
      timeoutMs: z.number().int().min(500).max(30000).default(3000),
      slowMs: z.number().int().min(100).max(30000).default(2000),
    })
    .prefault({}),
  network: z
    .object({
      /** Let widget sources reach the internet (weather, public APIs). Off: home network only. */
      allowInternet: z.boolean().default(false),
    })
    .prefault({}),
  /** Calendars. */
  calendar: z
    .object({
      /** Let calendars reach the internet: Google, and calendar links on the internet. */
      allowInternet: z.boolean().default(false),
      /**
       * Two-way Google Calendar: a Google Cloud OAuth client of the "Desktop app" kind. Its secret
       * is kept as the secret "calendar:google-client".
       */
      googleClientId: z.string().max(200).optional(),
      /**
       * A public page that forwards Google's answer home (public-site/). With it the client
       * is a "Web application" with this page as its redirect URI, and nothing is pasted.
       */
      googleReturnPage: z.string().url().max(300).optional(),
    })
    .prefault({}),
  ai: z
    .object({
      servers: z.array(AiServerSchema).max(12).default([]),
      /** The server chat starts on. */
      defaultServer: slug.optional(),
      /** Who may chat. */
      chatRoles: z.array(Role).default(["admin", "adult"]),
      /** Added to every chat, e.g. "Answer briefly. We live in Ohio." */
      systemPrompt: z.string().max(4000).default(""),
    })
    .prefault({}),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const HearthConfigSchema = z
  .object({
    version: z.literal(CONFIG_VERSION),
    settings: SettingsSchema.prefault({}),
    groups: z.array(GroupSchema).min(1),
    tiles: z.array(TileSchema).default([]),
    widgets: z.array(WidgetSchema).default([]),
    themes: z.array(ThemeSchema).max(50).default([]),
    profiles: z.array(ProfileSchema).default([]),
  })
  .superRefine((cfg, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });

    const unique = (items: { id: string }[], what: string, key: string) => {
      const seen = new Set<string>();
      items.forEach((item, i) => {
        if (seen.has(item.id)) issue([key, i, "id"], `duplicate ${what} id "${item.id}"`);
        seen.add(item.id);
      });
      return seen;
    };
    const groups = unique(cfg.groups, "group", "groups");
    const tiles = unique(cfg.tiles, "tile", "tiles");
    const widgets = unique(cfg.widgets, "widget", "widgets");
    const profiles = unique(cfg.profiles, "profile", "profiles");
    const checkPeople = (
      item: { owner?: string; people?: string[] },
      path: (string | number)[],
    ) => {
      if (item.owner && !profiles.has(item.owner))
        issue([...path, "owner"], `no profile "${item.owner}"`);
      item.people?.forEach((id, j) => {
        if (!profiles.has(id)) issue([...path, "people", j], `no profile "${id}"`);
      });
    };
    const groupById = new Map(cfg.groups.map((g) => [g.id, g]));
    cfg.groups.forEach((g, i) => {
      checkPeople(g, ["groups", i]);
    });
    unique(cfg.themes, "theme", "themes");
    const servers = unique(cfg.settings.ai.servers, "AI server", "settings.ai.servers");

    const shorts = new Map<string, string>();
    cfg.tiles.forEach((tile, i) => {
      checkPeople(tile, ["tiles", i]);
      const group = groupById.get(tile.group);
      if (!group) issue(["tiles", i, "group"], `no group "${tile.group}"`);
      // Someone's own section holds only their own links.
      else if (group.owner && tile.owner !== group.owner)
        issue(
          ["tiles", i, "group"],
          `"${group.name}" is ${group.owner}'s own section; only their own links go there`,
        );
      const short = shortLinkOf(tile);
      if (short === null) return;
      if (RESERVED_PATHS.has(short)) issue(["tiles", i, "short"], `"${short}" is reserved`);
      const other = shorts.get(short);
      if (other)
        issue(["tiles", i, "short"], `short link "${short}" is already used by "${other}"`);
      shorts.set(short, tile.id);
    });

    const checkRefs = (
      ids: string[],
      known: Set<string>,
      what: string,
      path: (string | number)[],
    ) =>
      ids.forEach((id, j) => {
        if (!known.has(id)) issue([...path, j], `no ${what} "${id}"`);
      });
    checkRefs(
      cfg.settings.guest.layout.widgets.map((w) => w.id),
      widgets,
      "widget",
      ["settings", "guest", "layout", "widgets"],
    );
    if (cfg.settings.ai.defaultServer && !servers.has(cfg.settings.ai.defaultServer)) {
      issue(["settings", "ai", "defaultServer"], `no AI server "${cfg.settings.ai.defaultServer}"`);
    }
    cfg.profiles.forEach((p, i) => {
      checkRefs(
        p.layout.widgets.map((w) => w.id),
        widgets,
        "widget",
        ["profiles", i, "layout", "widgets"],
      );
      checkRefs(p.favorites, tiles, "tile", ["profiles", i, "favorites"]);
      checkRefs(p.hiddenTiles, tiles, "tile", ["profiles", i, "hiddenTiles"]);
      checkRefs(p.groupOrder, groups, "group", ["profiles", i, "groupOrder"]);
      checkRefs(p.hiddenGroups, groups, "group", ["profiles", i, "hiddenGroups"]);
    });
  });
export type HearthConfig = z.infer<typeof HearthConfigSchema>;
export type HearthConfigInput = z.input<typeof HearthConfigSchema>;

/** The tile's short link, or null when it has none. Someone's own links have none. */
export function shortLinkOf(tile: Pick<Tile, "id" | "short" | "owner">): string | null {
  if (tile.short === false || tile.owner) return null;
  return tile.short ?? tile.id;
}

const LOCAL_SUFFIXES = [".home", ".local", ".lan", ".internal", ".home.arpa", ".localhost"];

/**
 * Whether an address is on the home network: a `.home`/`.local`/… name, a one-word name, or a
 * private IP. Status checks and widget sources only go to these unless the admin allows the
 * internet (CLAUDE.md: no outbound internet calls unless opt-in).
 */
export function isLocalUrl(address: string): boolean {
  let host: string;
  try {
    host = new URL(address).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  if (host.includes(":")) {
    return host === "::1" || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
  }
  if (host === "localhost" || !host.includes(".")) return true;
  if (LOCAL_SUFFIXES.some((s) => host.endsWith(s))) return true;
  const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ip) return false;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT, used by Tailscale
  );
}

/**
 * Whether the server checks this tile: switched on, and on the home network. Someone's own links
 * aren't checked: the status map goes to every page, and their ids are private.
 */
export function isChecked(tile: Pick<Tile, "check" | "url" | "checkUrl" | "owner">): boolean {
  return tile.check && !tile.owner && isLocalUrl(tile.checkUrl ?? tile.url);
}

/** Whether someone with this role (or a guest, `null`) may see something for this audience. */
export function canSee(audience: Audience, role: Role | null): boolean {
  switch (audience) {
    case "everyone":
      return true;
    case "adults":
      return role === "adult" || role === "admin";
    case "admin":
      return role === "admin";
  }
}

/** Who is looking: their role, and which profile (null for a guest or the admin alone). */
export interface Viewer {
  role: Role | null;
  profile: string | null;
}

/** Whether this viewer may see a section, tile or link. */
export function visibleTo(
  item: { audience: Audience; people?: string[]; owner?: string },
  v: Viewer,
): boolean {
  if (item.owner) return v.profile === item.owner;
  if (item.people?.length)
    return v.role === "admin" || (v.profile !== null && item.people.includes(v.profile));
  return canSee(item.audience, v.role);
}
