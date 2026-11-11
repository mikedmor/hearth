/** Small helpers the widget editor uses on a draft document, kept loose like the JSON it edits. */
import type { BlockKind } from "../../../../shared/widget-doc";
import { BLOCK_SPECS } from "./spec";

export type Rec = Record<string, unknown>;
export interface Draft {
  v: 1;
  sources: Rec[];
  values: Rec[];
  blocks: Rec[];
}

/** A draft from whatever the JSON holds, with the lists always there. */
export function toDraft(doc: unknown): Draft {
  const d = (doc && typeof doc === "object" ? doc : {}) as Rec;
  const list = (x: unknown) => (Array.isArray(x) ? (x as Rec[]) : []);
  return { v: 1, sources: list(d.sources), values: list(d.values), blocks: list(d.blocks) };
}

/** What goes back into the JSON: empty optional lists left out, as people write it. */
export function fromDraft(d: Draft): Rec {
  const out: Rec = { v: 1 };
  if (d.sources.length) out.sources = d.sources;
  if (d.values.length) out.values = d.values;
  out.blocks = d.blocks;
  return out;
}

/** The first free id like `stat`, `stat2`, `stat3`. */
export function freeId(base: string, taken: Iterable<string>, pattern = /[^a-z0-9_]/g): string {
  const set = new Set(taken);
  const clean = base.toLowerCase().replace(pattern, "_").slice(0, 26) || "x";
  if (!set.has(clean)) return clean;
  for (let i = 2; ; i++) if (!set.has(`${clean}${i}`)) return `${clean}${i}`;
}

export function newBlock(kind: BlockKind, d: Draft): Rec {
  const spec = BLOCK_SPECS[kind];
  const src = String(d.sources[0]?.id ?? "");
  return {
    id: freeId(
      kind,
      d.blocks.map((b) => String(b.id)),
    ),
    kind,
    w: spec.w,
    ...spec.starter(src),
  };
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface FieldPath {
  /** What to insert: `$nas.cpu.load`, or `$item.name` for a list's items. */
  path: string;
  /** What it looked like in the sample. */
  example: string;
  /** A list: its items' fields follow. */
  list?: FieldPath[];
}

const show = (v: unknown) => {
  if (v === null) return "null";
  if (Array.isArray(v)) return `${v.length} items`;
  if (typeof v === "object") return "{…}";
  const s = String(v);
  return s.length > 28 ? `${s.slice(0, 27)}…` : s;
};

/** Every field in a source's sample, so a click can bind to it. Lists offer their items' fields. */
export function fieldPaths(sample: unknown, prefix: string, depth = 0): FieldPath[] {
  if (depth > 4 || !sample || typeof sample !== "object") return [];
  if (Array.isArray(sample)) return [];
  const out: FieldPath[] = [];
  for (const [k, v] of Object.entries(sample as Rec).slice(0, 60)) {
    if (!IDENT.test(k)) continue;
    const path = `${prefix}.${k}`;
    if (Array.isArray(v)) {
      const first = v.find((x) => x && typeof x === "object" && !Array.isArray(x));
      out.push({
        path,
        example: show(v),
        list: first ? fieldPaths(first, "$item", depth + 1) : [],
      });
    } else if (v && typeof v === "object") {
      out.push(...fieldPaths(v, path, depth + 1));
    } else out.push({ path, example: show(v) });
  }
  return out;
}

/** A source whose whole answer is a list: its items' fields. */
export function rootList(sample: unknown): FieldPath[] | null {
  if (!Array.isArray(sample)) return null;
  const first = sample.find((x) => x && typeof x === "object" && !Array.isArray(x));
  return first ? fieldPaths(first, "$item") : [];
}

/** Which block an issue path like `blocks.2.value` belongs to. */
export function issueBlock(path: string): number | null {
  const m = /^blocks\.(\d+)/.exec(path);
  return m ? Number(m[1]) : null;
}
