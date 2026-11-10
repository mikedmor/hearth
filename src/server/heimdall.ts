/**
 * Import from Heimdall: its apps become tiles, its tags become groups.
 *
 * Heimdall keeps everything in `www/app.sqlite`: apps and tags share the `items` table (`type` 0 is
 * an app, 1 is a tag) and `item_tag` links them. Icons sit next to it, in `www/icons/`.
 *
 * Only names, addresses, colours, icons, tags and order are read. Heimdall's `description` column
 * holds "enhanced app" settings, which can include API keys and passwords, so it is never read.
 */

import { extname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type HearthConfig, isLocalUrl, PAGE_PATHS, type Tile } from "../shared/config";

export interface HeimdallApp {
  id: number;
  title: string;
  url: string;
  colour: string | null;
  icon: string | null;
  order: number;
  pinned: boolean;
  tagIds: number[];
}

export interface HeimdallTag {
  id: number;
  title: string;
}

export interface HeimdallData {
  apps: HeimdallApp[];
  tags: HeimdallTag[];
}

/** Heimdall's "home dashboard" tag, which every app on the front page carries. */
const DASHBOARD_TAG = 0;
/** Heimdall's default tile colour, which says nothing about the app. */
const DEFAULT_COLOURS = new Set(["#161b1f", "#222222", "#000000"]);
const ICON_TYPES = new Set([".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif", ".ico"]);

/** Read Heimdall's database, read-only. Throws a plain message if it isn't one. */
export function readHeimdall(path: string): HeimdallData {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const columns = new Set(
      (db.prepare("PRAGMA table_info(items)").all() as { name: string }[]).map((c) => c.name),
    );
    if (!columns.has("title") || !columns.has("url")) {
      throw new Error(`${path} doesn't look like Heimdall's app.sqlite (no items table)`);
    }
    const has = (c: string) => columns.has(c);
    const select = [
      "id",
      "title",
      "url",
      has("colour") ? "colour" : "NULL AS colour",
      has("icon") ? "icon" : "NULL AS icon",
      has("order") ? '"order" AS ord' : "0 AS ord",
      has("pinned") ? "pinned" : "1 AS pinned",
      has("type") ? "type" : "0 AS type",
    ].join(", ");
    const where = has("deleted_at") ? "WHERE deleted_at IS NULL" : "";
    const rows = db.prepare(`SELECT ${select} FROM items ${where}`).all() as {
      id: number;
      title: string | null;
      url: string | null;
      colour: string | null;
      icon: string | null;
      ord: number | null;
      pinned: number | null;
      type: number | null;
    }[];

    const tables = new Set(
      (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
          name: string;
        }[]
      ).map((t) => t.name),
    );
    const links = tables.has("item_tag")
      ? (db.prepare("SELECT item_id, tag_id FROM item_tag").all() as {
          item_id: number;
          tag_id: number;
        }[])
      : [];
    const tagsOf = new Map<number, number[]>();
    for (const l of links) tagsOf.set(l.item_id, [...(tagsOf.get(l.item_id) ?? []), l.tag_id]);

    const tags = rows
      .filter((r) => r.type === 1 && r.id !== DASHBOARD_TAG && r.title)
      .map((r) => ({ id: r.id, title: (r.title as string).trim() }));
    const apps = rows
      .filter((r) => (r.type ?? 0) === 0 && r.title && r.url)
      .map((r) => ({
        id: r.id,
        title: (r.title as string).trim(),
        url: (r.url as string).trim(),
        colour: r.colour,
        icon: r.icon,
        order: r.ord ?? 0,
        pinned: (r.pinned ?? 1) !== 0,
        tagIds: tagsOf.get(r.id) ?? [],
      }))
      .sort((a, b) => a.order - b.order || a.id - b.id);
    return { apps, tags };
  } finally {
    db.close();
  }
}

export interface ImportPlan {
  config: HearthConfig;
  added: { tile: Tile; from: string }[];
  skipped: { title: string; reason: string }[];
  newGroups: string[];
  /** Icon files to copy into data/icons: Heimdall's relative path → new file name. */
  icons: { from: string; to: string }[];
}

/**
 * Work out what importing would change, without touching anything. Tiles whose address is already
 * on a tile are skipped, so running the import twice adds nothing the second time.
 */
export function planImport(cfg: HearthConfig, data: HeimdallData): ImportPlan {
  const config: HearthConfig = structuredClone(cfg);
  const plan: ImportPlan = { config, added: [], skipped: [], newGroups: [], icons: [] };

  const takenIds = new Set(config.tiles.map((t) => t.id));
  const takenShorts = new Set(
    config.tiles.map((t) => (t.short === false ? null : (t.short ?? t.id))),
  );
  const knownUrls = new Set(config.tiles.map((t) => normalizeUrl(t.url)));

  const groupFor = (name: string): string => {
    const existing = config.groups.find((g) => g.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing.id;
    const id = uniqueSlug(name, new Set(config.groups.map((g) => g.id)), "group");
    config.groups.push({ id, name: name.slice(0, 40), audience: "everyone" });
    plan.newGroups.push(name);
    return id;
  };
  const tagName = new Map(data.tags.map((t) => [t.id, t.title]));

  for (const app of data.apps) {
    let url: URL;
    try {
      url = new URL(app.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    } catch {
      plan.skipped.push({ title: app.title, reason: `address isn't http(s): ${app.url}` });
      continue;
    }
    if (knownUrls.has(normalizeUrl(app.url))) {
      plan.skipped.push({ title: app.title, reason: "already a tile with that address" });
      continue;
    }

    const tag = app.tagIds.map((id) => tagName.get(id)).find((n): n is string => Boolean(n));
    const group = groupFor(tag ?? "From Heimdall");
    const id = uniqueSlug(app.title, new Set([...takenIds, ...PAGE_PATHS]), "tile");
    takenIds.add(id);

    const tile: Tile = {
      id,
      name: app.title.slice(0, 40),
      url: url.href,
      group,
      audience: "everyone",
      // Internet sites are never checked (no outbound calls); say so in the file too.
      check: isLocalUrl(url.href),
      newTab: false,
      keywords: [],
    };
    // A short link only if nothing else uses it.
    if (takenShorts.has(id)) tile.short = false;
    else takenShorts.add(id);

    const colour = app.colour?.trim().toLowerCase();
    if (colour && /^#[0-9a-f]{6}$/.test(colour) && !DEFAULT_COLOURS.has(colour)) {
      tile.color = colour;
    }
    const iconExt = app.icon ? extname(app.icon).toLowerCase() : "";
    if (app.icon && ICON_TYPES.has(iconExt) && !app.icon.includes("..")) {
      const to = `${id}${iconExt === ".jpeg" ? ".jpg" : iconExt}`;
      plan.icons.push({ from: app.icon, to });
      tile.icon = to;
    }

    config.tiles.push(tile);
    knownUrls.add(normalizeUrl(url.href));
    plan.added.push({ tile, from: app.title });
  }
  return plan;
}

/** "Plex Media Server!" → "plex-media-server", unique among `taken`. */
export function uniqueSlug(name: string, taken: Set<string>, fallback: string): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 36)
      .replace(/-+$/, "") || fallback;
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  return slug;
}

function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}${url.search}`.toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
}
