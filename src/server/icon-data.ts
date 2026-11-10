/**
 * The icon library: about 3,400 app and brand logos (Simple Icons, CC0), 2,000 symbols
 * (Lucide, ISC) and 1,900 emoji (Emojibase, MIT). All of it ships with Hearth: nothing is fetched
 * from the web to show or search an icon.
 *
 * The packages are large, so a build step writes one compact `icons.json` next to the server
 * bundle; in development it's built from node_modules on first use. The page never downloads the
 * library: it searches through the API, and tiles arrive with their icon already resolved.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** [slug, title, hex, path] */
export type BrandRow = [string, string, string, string];
/** [name, tags, nodes] where nodes are [tag, attributes] */
export type SymbolRow = [string, string[], [string, Record<string, string>][]];
/** [emoji, label, tags] */
export type EmojiRow = [string, string, string[]];

export interface IconData {
  brands: BrandRow[];
  symbols: SymbolRow[];
  emoji: EmojiRow[];
}

/** Build the compact data from the packages (the build script, and development). */
export function buildIconData(req: NodeRequire): IconData {
  const si = req("simple-icons") as Record<
    string,
    { slug: string; title: string; hex: string; path: string }
  >;
  const brands: BrandRow[] = Object.values(si)
    .filter((i) => i && typeof i === "object" && "path" in i)
    .map((i) => [i.slug, i.title, i.hex, i.path]);
  const nodes = req("lucide-static/icon-nodes.json") as Record<
    string,
    [string, Record<string, string>][]
  >;
  const tags = req("lucide-static/tags.json") as Record<string, string[]>;
  const symbols: SymbolRow[] = Object.entries(nodes).map(([name, n]) => [
    name,
    tags[name] ?? [],
    // Lucide nodes carry a "key" we don't need.
    n.map(
      ([tag, attrs]) =>
        [tag, Object.fromEntries(Object.entries(attrs).filter(([k]) => k !== "key"))] as [
          string,
          Record<string, string>,
        ],
    ),
  ]);
  const em = req("emojibase-data/en/compact.json") as {
    unicode: string;
    label: string;
    tags?: string[];
    group?: number;
  }[];
  // Group 2 is skin tones and components: not useful as icons.
  const emoji: EmojiRow[] = em
    .filter((e) => e.group !== 2)
    .map((e) => [e.unicode, e.label, e.tags ?? []]);
  return { brands, symbols, emoji };
}

let cached: IconData | null = null;

export function iconData(): IconData {
  if (cached) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  const built = join(here, "icons.json");
  if (existsSync(built)) cached = JSON.parse(readFileSync(built, "utf8")) as IconData;
  else cached = buildIconData(createRequire(import.meta.url));
  return cached;
}
