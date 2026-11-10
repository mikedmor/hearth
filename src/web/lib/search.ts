/** Quick launch ranking. Pure, so it's tested without a browser. */
import type { ViewTile } from "../../shared/api";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/** Higher is better; 0 means no match. */
export function score(tile: ViewTile, query: string, groupName = ""): number {
  const q = norm(query.trim());
  if (!q) return 0;
  const name = norm(tile.name);
  if (tile.short && norm(tile.short) === q) return 100;
  if (name === q) return 95;
  if (name.startsWith(q)) return 90;
  if (name.split(/\s+/).some((w) => w.startsWith(q))) return 80;
  if (tile.keywords.some((k) => norm(k).startsWith(q))) return 70;
  if (name.includes(q)) return 60;
  if (tile.short?.startsWith(q)) return 55;
  if (tile.description && norm(tile.description).includes(q)) return 40;
  if (norm(hostOf(tile.url)).includes(q)) return 35;
  if (groupName && norm(groupName).startsWith(q)) return 20;
  return 0;
}

export function search(tiles: { tile: ViewTile; group: string }[], query: string): ViewTile[] {
  return tiles
    .map(({ tile, group }) => ({ tile, s: score(tile, query, group) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.tile.name.localeCompare(b.tile.name))
    .map((r) => r.tile);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
