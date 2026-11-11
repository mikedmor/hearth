/** Builds what one person (or a guest) sees: layouts, looks, audiences, and what they may change. */

import type {
  Access,
  HomeView,
  PublicProfile,
  Session,
  ViewGroup,
  ViewTile,
  ViewWidget,
} from "../shared/api";
import {
  canSee,
  type Group,
  type HearthConfig,
  isChecked,
  isLocked,
  type Layout,
  type Profile,
  type Role,
  shortLinkOf,
  type Tile,
  type Viewer,
  visibleTo,
  type Widget,
} from "../shared/config";
import { pickWebSearch } from "../shared/web-search";
import { iconColor, resolveIcon } from "./icons";

/** Who sees something, as the page shows it. */
export function accessOf(item: Pick<Group, "audience" | "people" | "owner">): Access {
  if (item.owner) return { kind: "mine" };
  if (item.people?.length) return { kind: "people", people: item.people };
  return { kind: "audience", audience: item.audience };
}

/**
 * Whether this person may change a section or link: the admin may change anything; anyone else
 * only their own, and only when their page isn't locked.
 */
export function mayManage(
  item: { owner?: string },
  who: { admin: boolean; profile: Profile | null },
): boolean {
  if (who.admin) return true;
  return Boolean(
    item.owner && who.profile && !isLocked(who.profile) && item.owner === who.profile.id,
  );
}

export function toViewTile(tile: Tile, canManage = false): ViewTile {
  return {
    id: tile.id,
    name: tile.name,
    url: tile.url,
    description: tile.description,
    ...resolveIcon(tile.icon),
    // A logo brings its brand colour when the tile has none.
    color: tile.color ?? iconColor(tile.icon),
    checked: isChecked(tile),
    keywords: tile.keywords,
    short: shortLinkOf(tile),
    newTab: tile.newTab,
    group: tile.group,
    access: accessOf(tile),
    canManage,
  };
}

export function publicProfile(p: Profile, hasPin: boolean): PublicProfile {
  return { id: p.id, name: p.name, avatar: p.avatar, color: p.color, role: p.role, hasPin };
}

export function findProfile(cfg: HearthConfig, id: string | undefined | null): Profile | null {
  if (!id) return null;
  return cfg.profiles.find((p) => p.id === id) ?? null;
}

/** Tiles this viewer may see, ignoring personal hiding (used for widgets and search). */
export function visibleTiles(cfg: HearthConfig, viewer: Viewer): Tile[] {
  const groups = new Map(cfg.groups.map((g) => [g.id, g]));
  return cfg.tiles.filter((t) => {
    const g = groups.get(t.group);
    return g !== undefined && visibleTo(t, viewer) && visibleTo(g, viewer);
  });
}

export function layoutOf(cfg: HearthConfig, profile: Profile | null): Layout {
  return profile ? profile.layout : cfg.settings.guest.layout;
}

/** The widgets on this person's page, that they're allowed to see. */
export function visibleWidgets(cfg: HearthConfig, profile: Profile | null): Widget[] {
  const role = profile?.role ?? null;
  return layoutOf(cfg, profile)
    .widgets.map((p) => cfg.widgets.find((w) => w.id === p.id))
    .filter((w): w is Widget => w !== undefined && canSee(w.audience, role));
}

/** Whether this person may use a feature: by their role, or as the admin, signed in. */
export function mayUse(
  cfg: HearthConfig,
  feature: "files" | "calendar",
  role: Role | null,
  admin: boolean,
): boolean {
  return admin || (role !== null && cfg.settings.features[feature].includes(role));
}

export function canChat(cfg: HearthConfig, role: Role | null): boolean {
  return (
    role !== null && cfg.settings.ai.servers.length > 0 && cfg.settings.ai.chatRoles.includes(role)
  );
}

export interface ViewContext {
  profile: Profile | null;
  session: Session;
  hasPin: (profileId: string) => boolean;
}

export function buildHomeView(cfg: HearthConfig, ctx: ViewContext): HomeView {
  const { profile, session } = ctx;
  const role = profile?.role ?? null;
  const viewer: Viewer = { role, profile: profile?.id ?? null };
  const who = { admin: session.admin, profile };
  const hiddenTiles = new Set(profile?.hiddenTiles ?? []);
  const hiddenGroups = new Set(profile?.hiddenGroups ?? []);
  const tiles = visibleTiles(cfg, viewer).filter((t) => !hiddenTiles.has(t.id));
  const canEdit = session.admin || (profile !== null && !isLocked(profile));
  const canAddOwn = profile !== null && canEdit;

  const order = profile?.groupOrder ?? [];
  // Empty sections are included: the page hides them, except while editing.
  const groups: ViewGroup[] = [...cfg.groups]
    .filter((g) => visibleTo(g, viewer) && !hiddenGroups.has(g.id))
    .sort((a, b) => rank(order, a.id) - rank(order, b.id))
    .map((g) => ({
      id: g.id,
      name: g.name,
      tiles: tiles.filter((t) => t.group === g.id).map((t) => toViewTile(t, mayManage(t, who))),
      access: accessOf(g),
      canManage: mayManage(g, who),
      // Anyone with a page may put their own link in a house section they can see; only the admin
      // adds the house's links; someone's own section takes only theirs.
      canAdd: g.owner ? mayManage(g, who) : session.admin || canAddOwn,
    }));

  const byId = new Map(tiles.map((t) => [t.id, t]));
  const favorites = (profile?.favorites ?? [])
    .map((id) => byId.get(id))
    .filter((t): t is Tile => t !== undefined)
    .map((t) => toViewTile(t, mayManage(t, who)));

  const layout = layoutOf(cfg, profile);
  const shown = new Set<string>();
  const widgets: ViewWidget[] = [];
  for (const p of layout.widgets) {
    const w = cfg.widgets.find((x) => x.id === p.id);
    if (!w || !canSee(w.audience, role) || shown.has(w.id)) continue;
    shown.add(w.id);
    widgets.push({ id: w.id, type: w.type, title: w.title, w: p.w });
  }
  const library = cfg.widgets
    .filter((w) => canSee(w.audience, role) && !shown.has(w.id))
    .map((w) => ({ id: w.id, type: w.type, title: w.title }));

  return {
    title: cfg.settings.title,
    homeName: cfg.settings.homeName,
    session,
    profile: profile
      ? { ...publicProfile(profile, ctx.hasPin(profile.id)), locked: isLocked(profile) }
      : null,
    profiles: cfg.profiles.map((p) => publicProfile(p, ctx.hasPin(p.id))),
    canEdit,
    canAddOwn,
    canChat: canChat(cfg, role),
    canFiles: mayUse(cfg, "files", role, session.admin),
    canCalendar: role !== null && mayUse(cfg, "calendar", role, session.admin),
    webSearch: pickWebSearch(
      cfg.settings.webSearch,
      (profile ? profile.look : cfg.settings.guest.look).search,
    ),
    look: profile ? profile.look : cfg.settings.guest.look,
    themes: cfg.themes,
    sections: layout.sections,
    favorites,
    hiddenTiles: profile?.hiddenTiles ?? [],
    hiddenGroups: profile?.hiddenGroups ?? [],
    groupOrder: profile?.groupOrder ?? [],
    groups,
    widgets,
    board: layout.board,
    joined: layout.joined,
    library,
  };
}

/** Position in a preferred order; ids not listed keep their config order after the listed ones. */
function rank(order: string[], id: string): number {
  const i = order.indexOf(id);
  return i === -1 ? order.length : i;
}
