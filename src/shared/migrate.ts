/**
 * Upgrades older `hearth.json` files to the current version, so a config is never lost to an
 * update. Works on plain JSON before validation; the result is then validated as usual.
 */
import { type Audience, CONFIG_VERSION, canSee, type Role } from "./config";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** v1 widgets had a size; v2 places widgets per page with a width. */
const widthFor = (size: unknown) => (size === "wide" ? 8 : 4);

function v1ToV2(raw: Json): Json {
  const widgets = arr(raw.widgets).map(obj);
  const sizeOf = new Map(widgets.map((w) => [w.id, w.size]));
  const place = (ids: unknown) =>
    arr(ids)
      .filter((id): id is string => typeof id === "string")
      .map((id) => ({ id, w: widthFor(sizeOf.get(id)) }));
  const theme = (t: unknown) => (t === "dark" ? "ember" : t === "light" ? "hearth" : "system");

  const settings = obj(raw.settings);
  const { guestWidgets, ...restSettings } = settings;
  return {
    ...raw,
    version: 2,
    settings: { ...restSettings, guest: { layout: { widgets: place(guestWidgets) } } },
    widgets: widgets.map(({ size: _size, ...w }) => w),
    profiles: arr(raw.profiles).map((p) => {
      const { widgets: ids, theme: t, ...rest } = obj(p);
      return { ...rest, look: { theme: theme(t) }, layout: { widgets: place(ids) } };
    }),
  };
}

/**
 * v2 kept each person's own links in their profile, in one "my-links" group. v3 makes them
 * ordinary tiles with an owner, placed in the first section the person can see (in their
 * own order), so there's no separate "My links" section. Only someone who can see no section at
 * all gets one of their own, called "Links".
 */
function v2ToV3(raw: Json): Json {
  const groups = arr(raw.groups).map(obj);
  const tiles = arr(raw.tiles).map(obj);
  const taken = (list: Json[]) => new Set(list.map((x) => String(x.id)));
  const groupIds = taken(groups);
  const tileIds = taken(tiles);
  const unique = (ids: Set<string>, base: string) => {
    let id = base.slice(0, 40).replace(/-+$/, "");
    for (let n = 2; ids.has(id); n++) id = `${base.slice(0, 36).replace(/-+$/, "")}-${n}`;
    ids.add(id);
    return id;
  };
  const profiles = arr(raw.profiles).map((p) => {
    const { links, ...rest } = obj(p);
    const list = arr(links).map(obj);
    const pid = String(rest.id);
    const swap = (ids: unknown, map: Map<string, string>) =>
      arr(ids).map((x) => (typeof x === "string" ? (map.get(x) ?? x) : x));
    if (!list.length) {
      // Nothing of theirs: drop references to the old group.
      const drop = (ids: unknown) => arr(ids).filter((x) => x !== "my-links");
      return { ...rest, groupOrder: drop(rest.groupOrder), hiddenGroups: drop(rest.hiddenGroups) };
    }
    const role = (typeof rest.role === "string" ? rest.role : "adult") as Role;
    const order = arr(rest.groupOrder);
    const hidden = arr(rest.hiddenGroups);
    const rank = (g: Json) => (order.includes(g.id) ? order.indexOf(g.id) : order.length);
    const home = groups
      .filter(
        (g) =>
          !g.owner &&
          !hidden.includes(g.id) &&
          canSee((g.audience ?? "everyone") as Audience, role),
      )
      .sort((a, b) => rank(a) - rank(b))[0];
    const gid = home ? String(home.id) : unique(groupIds, `${pid}-links`);
    if (!home) groups.push({ id: gid, name: "Links", owner: pid });
    const ids = new Map<string, string>();
    for (const l of list) {
      const id = unique(tileIds, tileIds.has(String(l.id)) ? `${pid}-${l.id}` : String(l.id));
      ids.set(`link:${l.id}`, id);
      tiles.push({ ...l, id, group: gid, owner: pid });
    }
    // The old group's place in the order goes to a new section; an existing one keeps its own.
    const groupOrder = home
      ? order.filter((x) => x !== "my-links")
      : swap(order, new Map([["my-links", gid]]));
    return {
      ...rest,
      favorites: swap(rest.favorites, ids),
      groupOrder,
      hiddenGroups: hidden.filter((x) => x !== "my-links"),
    };
  });
  return { ...raw, version: 3, groups, tiles, profiles };
}

/** Bring any known version up to date. Returns the input untouched when it's already current. */
export function migrate(raw: unknown): { config: unknown; from: number | null } {
  const o = obj(raw);
  const from = typeof o.version === "number" ? o.version : null;
  if (from === CONFIG_VERSION || from === null) return { config: raw, from: null };
  let out = o;
  if (from === 1) out = v1ToV2(out);
  if (from <= 2) out = v2ToV3(out);
  return { config: out, from };
}
