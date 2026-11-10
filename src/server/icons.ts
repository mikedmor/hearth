/**
 * Icons: resolving a tile's icon to something the page can draw, and searching the library.
 *
 * A tile's icon is one of: "si:<slug>" (an app logo), "lucide:<name>" (a symbol), an emoji, a
 * picture in data/icons ("plex.png", uploaded or fetched from the site), or nothing (a monogram).
 */
import type { IconResult, IconSvg, ViewTile } from "../shared/api";
import { APPS, type AppDef } from "../shared/catalog";
import { iconData } from "./icon-data";

const IMAGE_FILE = /^[\w-]+\.(png|jpe?g|svg|webp|gif|ico|avif)$/i;

let brandIndex: Map<string, { path: string; hex: string; title: string }> | null = null;
let symbolIndex: Map<string, IconSvg> | null = null;

function brands() {
  if (!brandIndex) {
    brandIndex = new Map(
      iconData().brands.map(([slug, title, hex, path]) => [slug, { path, hex: `#${hex}`, title }]),
    );
  }
  return brandIndex;
}

function symbols() {
  if (!symbolIndex)
    symbolIndex = new Map(
      iconData().symbols.map(([name, , nodes]) => [name, { kind: "symbol", nodes }]),
    );
  return symbolIndex;
}

/** What the page needs to draw a tile's icon. Unknown library names fall back to a monogram. */
export function resolveIcon(ref: string | undefined): Pick<ViewTile, "icon" | "iconKind" | "svg"> {
  const icon = ref?.trim();
  if (!icon) return { iconKind: "monogram" };
  if (icon.startsWith("si:")) {
    const b = brands().get(icon.slice(3));
    return b
      ? { iconKind: "svg", svg: { kind: "brand", path: b.path, hex: b.hex } }
      : { iconKind: "monogram" };
  }
  if (icon.startsWith("lucide:")) {
    const s = symbols().get(icon.slice(7));
    return s ? { iconKind: "svg", svg: s } : { iconKind: "monogram" };
  }
  if (IMAGE_FILE.test(icon)) return { iconKind: "image", icon: `/icons/${icon}` };
  return { iconKind: "emoji", icon };
}

/** How light a colour is, 0 (black) to 1 (white). */
function lightness(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * The brand colour of a library logo, to colour a tile that has none. Logos that are black or white
 * (Ollama, GitHub) would vanish on a dark or light page, so those keep the page's own colour.
 */
export function iconColor(ref: string | undefined): string | undefined {
  if (!ref?.startsWith("si:")) return undefined;
  const hex = brands().get(ref.slice(3))?.hex;
  if (!hex) return undefined;
  const l = lightness(hex);
  return l < 0.12 || l > 0.92 ? undefined : hex;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function score(label: string, extra: string[], q: string): number {
  const l = norm(label);
  if (!q) return 0;
  if (l === q) return 100;
  if (l.replace(/ /g, "") === q.replace(/ /g, "")) return 95;
  if (l.startsWith(q)) return 80;
  if (l.split(" ").some((w) => w.startsWith(q))) return 65;
  if (extra.some((t) => norm(t) === q)) return 55;
  if (extra.some((t) => norm(t).startsWith(q))) return 40;
  if (l.includes(q)) return 30;
  return 0;
}

export type IconKind = "all" | "brand" | "symbol" | "emoji";

/** Search the library: logos, symbols and emoji, best matches first. */
export function searchIcons(query: string, kind: IconKind = "all", limit = 60): IconResult[] {
  const q = norm(query);
  if (!q) return [];
  const data = iconData();
  const scored: { s: number; r: IconResult }[] = [];
  if (kind === "all" || kind === "brand") {
    for (const [slug, title, hex, path] of data.brands) {
      const s = score(title, [slug], q);
      if (s)
        scored.push({
          s: s + 3,
          r: {
            ref: `si:${slug}`,
            label: title,
            kind: "brand",
            svg: { kind: "brand", path, hex: `#${hex}` },
          },
        });
    }
  }
  if (kind === "all" || kind === "symbol") {
    for (const [name, tags, nodes] of data.symbols) {
      const s = score(name.replace(/-/g, " "), tags, q);
      if (s)
        scored.push({
          s,
          r: {
            ref: `lucide:${name}`,
            label: name.replace(/-/g, " "),
            kind: "symbol",
            svg: { kind: "symbol", nodes },
          },
        });
    }
  }
  if (kind === "all" || kind === "emoji") {
    for (const [emoji, label, tags] of data.emoji) {
      const s = score(label, tags, q);
      if (s) scored.push({ s: s - 2, r: { ref: emoji, label, kind: "emoji" } });
    }
  }
  return scored
    .sort((a, b) => b.s - a.s || a.r.label.length - b.r.label.length)
    .slice(0, limit)
    .map((x) => x.r);
}

/** An app from the catalog that a name or address points at ("Sonarr", sonarr.home, :8989). */
export function appFor(name: string, url?: string, extra: AppDef[] = []): AppDef | undefined {
  const apps = [...APPS, ...extra];
  const n = norm(name);
  const byName = apps.find(
    (a) => n && (norm(a.name) === n || norm(a.id) === n || n.startsWith(`${norm(a.name)} `)),
  );
  if (byName) return byName;
  if (!url) return undefined;
  try {
    const u = new URL(url);
    const host = u.hostname.split(".")[0] ?? "";
    const byHost = apps.find(
      (a) =>
        norm(a.id).replace(/ /g, "") === host.replace(/-/g, "") ||
        norm(a.name).replace(/ /g, "") === host,
    );
    if (byHost) return byHost;
    const port = Number(u.port);
    // A port only some apps use, and only one of them: a fair guess.
    const byPort =
      port && port !== 80 && port !== 443 && port !== 8080
        ? apps.filter((a) => a.ports.includes(port))
        : [];
    return byPort.length === 1 ? byPort[0] : undefined;
  } catch {
    return undefined;
  }
}

/** Icons to suggest for a tile, from its name and address: its app's logo, then name matches. */
export function suggestIcons(name: string, url?: string, extra: AppDef[] = []): IconResult[] {
  const out: IconResult[] = [];
  const seen = new Set<string>();
  const add = (r: IconResult) => {
    if (!seen.has(r.ref)) {
      seen.add(r.ref);
      out.push(r);
    }
  };
  const app = appFor(name, url, extra);
  if (app) {
    const r = resolveIcon(app.icon);
    if (r.svg) add({ ref: app.icon, label: app.name, kind: r.svg.kind, svg: r.svg });
  }
  const words = [name, ...norm(name).split(" ")].filter((w) => w.length > 2);
  for (const w of words) for (const r of searchIcons(w, "all", 8)) add(r);
  return out.slice(0, 24);
}
