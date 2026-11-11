/** Quick launch ranking. Pure, so it's tested without a browser. */
import type { ViewTile } from "../../shared/api";
import { isLocalUrl } from "../../shared/config";

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

/**
 * The address a search is, if it looks like one ("nas.home:5000", "example.com/news"), ready to
 * open: http for the home's own names and addresses, https for the rest.
 */
export function addressIn(query: string): string | null {
  const s = query.trim();
  if (!s || /\s/.test(s)) return null;
  if (/^https?:\/\/[^/\s]+/i.test(s)) return s;
  const m = /^([a-z0-9-]+(?:\.[a-z0-9-]+)+)(:\d{1,5})?(\/\S*)?$/i.exec(s);
  if (!m) return null;
  const host = m[1] ?? "";
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  // "3.14" isn't an address; a name ends in letters.
  if (!ipv4 && !/[a-z]/i.test(host.split(".").pop() ?? "")) return null;
  return isLocalUrl(`http://${s}`) ? `http://${s}` : `https://${s}`;
}
