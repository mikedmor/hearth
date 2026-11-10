/**
 * A custom widget is a document, never code (like Muny's cards). People in the editor, the AI
 * designer and outside assistants all write the same JSON:
 *
 *   sources  where data comes from: an HTTP API polled every so often, a WebSocket that pushes,
 *            or Hearth's own data. They run on the server; keys stay there.
 *   values   named formulas worked out once (`$used / $total`).
 *   blocks   what the card shows, on a 12-column grid, each bound to formulas.
 *
 * Colours are tones the theme fills in, so a widget can't clash with the page.
 */
import { z } from "zod";
import { checkTemplate, FUNCTIONS, parse } from "./expr";

export const MAX_SOURCES = 8;
export const MAX_BLOCKS = 30;
export const MAX_VALUES = 30;

const id = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,29}$/, "use lowercase letters, digits and _ (start with a letter)");
const formula = z.string().min(1).max(2000);
const template = z.string().max(2000);

export const TONES = ["normal", "muted", "accent", "positive", "negative", "warning"] as const;
export type Tone = (typeof TONES)[number];

/** Values that may name a secret: `{{secret:nas_token}}`. Secrets are filled in on the server. */
const withSecrets = z.string().max(4000);

export const HttpSource = z.object({
  id,
  kind: z.literal("http"),
  url: z.string().url().max(2000),
  method: z.enum(["GET", "POST"]).default("GET"),
  headers: z.record(z.string().max(100), withSecrets).default({}),
  body: withSecrets.optional(),
  /** Seconds between fetches. */
  every: z.number().int().min(5).max(86_400).default(60),
  /** Read only this part of the answer, like `data.items`. */
  path: z.string().max(200).optional(),
  /** Keep the last so many values of `track` for sparklines: `$history.<id>`. */
  track: formula.optional(),
  keep: z.number().int().min(2).max(500).default(60),
});

export const WebSocketSource = z.object({
  id,
  kind: z.literal("websocket"),
  url: z
    .string()
    .regex(/^wss?:\/\/\S+$/, "use a ws:// or wss:// address")
    .max(2000),
  /** Sent once the socket opens (a subscribe message). May use {{secret:…}}. */
  send: withSecrets.optional(),
  /** How each message combines with what's there: replace it, or merge its fields in. */
  mode: z.enum(["replace", "merge"]).default("replace"),
  path: z.string().max(200).optional(),
  track: formula.optional(),
  keep: z.number().int().min(2).max(500).default(60),
});

export const HearthSource = z.object({
  id,
  kind: z.literal("hearth"),
  /** status: every tile's up/down; ai: the AI servers; time: the clock. */
  what: z.enum(["status", "ai", "time", "host"]),
});

export const SourceSchema = z.discriminatedUnion("kind", [
  HttpSource,
  WebSocketSource,
  HearthSource,
]);
export type Source = z.infer<typeof SourceSchema>;

export const ValueSchema = z.object({ id, label: z.string().max(60).optional(), expr: formula });

const blockBase = {
  id: z.string().regex(/^[a-z0-9_-]{1,30}$/),
  /** Columns wide, out of 12. */
  w: z.number().int().min(1).max(12).default(12),
  title: z.string().max(60).optional(),
  /** A fixed tone, or a formula giving one ("positive", "negative"…). */
  tone: z.string().max(400).optional(),
};

export const BlockSchema = z.discriminatedUnion("kind", [
  z.object({ ...blockBase, kind: z.literal("heading"), text: template }),
  z.object({
    ...blockBase,
    kind: z.literal("text"),
    text: template,
    size: z.enum(["sm", "md", "lg"]).default("md"),
  }),
  z.object({
    ...blockBase,
    kind: z.literal("stat"),
    value: formula,
    label: template.optional(),
    unit: z.string().max(20).optional(),
    /** A small line under the number. */
    sub: template.optional(),
    /** A list of numbers to draw as a small line, like $history.nas. */
    spark: formula.optional(),
    size: z.enum(["sm", "md", "lg", "xl"]).default("lg"),
  }),
  z.object({
    ...blockBase,
    kind: z.literal("gauge"),
    value: formula,
    min: z.number().default(0),
    max: z.union([z.number(), formula]).default(100),
    label: template.optional(),
    unit: z.string().max(20).optional(),
    /** Tone bands by value: warn at or above, bad at or above. */
    warnAt: z.number().optional(),
    badAt: z.number().optional(),
  }),
  z.object({
    ...blockBase,
    kind: z.literal("progress"),
    value: formula,
    max: z.union([z.number(), formula]).default(100),
    label: template.optional(),
    /** What the bar says: "{{ bytes($used) }} of {{ bytes($total) }}". */
    detail: template.optional(),
    warnAt: z.number().optional(),
    badAt: z.number().optional(),
  }),
  z.object({
    ...blockBase,
    kind: z.literal("line"),
    /** A list of numbers, or of items with `field`. */
    points: formula,
    field: z.string().max(60).optional(),
    label: template.optional(),
    /** What the big number on it says; defaults to the last point. */
    value: formula.optional(),
    unit: z.string().max(20).optional(),
    fill: z.boolean().default(true),
    height: z.number().int().min(40).max(320).default(80),
  }),
  z.object({
    ...blockBase,
    kind: z.literal("bars"),
    items: formula,
    label: z.string().max(60),
    value: z.string().max(60),
    /** How each value reads: a formula over `$item`, like bytes($item.size). */
    display: formula.optional(),
    limit: z.number().int().min(1).max(50).default(8),
  }),
  z.object({
    ...blockBase,
    kind: z.literal("list"),
    items: formula,
    /** Formulas over `$item` (and `$index`). */
    itemTitle: formula,
    itemDetail: formula.optional(),
    itemValue: formula.optional(),
    itemIcon: formula.optional(),
    itemTone: formula.optional(),
    limit: z.number().int().min(1).max(50).default(8),
    empty: z.string().max(80).optional(),
  }),
  z.object({
    ...blockBase,
    kind: z.literal("table"),
    rows: formula,
    columns: z
      .array(
        z.object({
          label: z.string().max(40),
          value: formula,
          align: z.enum(["left", "right"]).default("left"),
        }),
      )
      .min(1)
      .max(8),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  z.object({
    ...blockBase,
    kind: z.literal("lights"),
    /** One light per item: formulas over `$item` give its label and state. */
    items: formula,
    itemLabel: formula,
    /** "up", "down", "warn" or "off", or true/false. */
    itemState: formula,
    itemDetail: formula.optional(),
    limit: z.number().int().min(1).max(60).default(24),
  }),
  z.object({
    ...blockBase,
    kind: z.literal("pairs"),
    /** Label and formula pairs, shown as a neat list. */
    items: z
      .array(z.object({ label: z.string().max(40), value: template }))
      .min(1)
      .max(12),
  }),
  z.object({
    ...blockBase,
    kind: z.literal("image"),
    /** An image address on the home network (a camera snapshot); Hearth fetches it. */
    src: template,
    alt: z.string().max(100).default(""),
    fit: z.enum(["cover", "contain"]).default("cover"),
    /** Refetch every so many seconds (cameras). */
    every: z.number().int().min(2).max(3600).default(30),
    height: z.number().int().min(60).max(480).default(180),
  }),
  z.object({ ...blockBase, kind: z.literal("divider") }),
]);
export type Block = z.infer<typeof BlockSchema>;
export type BlockKind = Block["kind"];

export const WidgetDocSchema = z.object({
  v: z.literal(1),
  sources: z.array(SourceSchema).max(MAX_SOURCES).default([]),
  values: z.array(ValueSchema).max(MAX_VALUES).default([]),
  blocks: z.array(BlockSchema).min(1).max(MAX_BLOCKS),
});
export type WidgetDoc = z.infer<typeof WidgetDocSchema>;
export type WidgetDocInput = z.input<typeof WidgetDocSchema>;

// ---------------------------------------------------------------------------
// Checking

/** Which properties of each block are formulas, and which are templates. */
const FORMULA_KEYS = [
  "value",
  "spark",
  "points",
  "items",
  "rows",
  "itemTitle",
  "itemDetail",
  "itemValue",
  "itemIcon",
  "itemTone",
  "itemLabel",
  "itemState",
  "display",
];
const TEMPLATE_KEYS = ["text", "label", "sub", "detail", "src"];

export interface DocIssue {
  path: string;
  message: string;
}

/** Validate a document: its shape, ids, and every formula. Returns the parsed doc when it's fine. */
export function checkDoc(input: unknown): { doc: WidgetDoc | null; issues: DocIssue[] } {
  const parsed = WidgetDocSchema.safeParse(input);
  if (!parsed.success) {
    return {
      doc: null,
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join(".") || "(doc)",
        message: i.message,
      })),
    };
  }
  const doc = parsed.data;
  const issues: DocIssue[] = [];
  const names = new Set<string>(["history", "item", "index", "now"]);
  const dupe = (what: string, list: { id: string }[], key: string) => {
    const seen = new Set<string>();
    list.forEach((x, i) => {
      if (seen.has(x.id))
        issues.push({ path: `${key}.${i}.id`, message: `two ${what} are called "${x.id}"` });
      seen.add(x.id);
    });
  };
  dupe("sources", doc.sources, "sources");
  dupe("values", doc.values, "values");
  dupe("blocks", doc.blocks, "blocks");
  for (const s of doc.sources) {
    if (names.has(s.id)) issues.push({ path: `sources`, message: `"${s.id}" is a reserved name` });
    names.add(s.id);
  }
  const tryFormula = (path: string, src: unknown) => {
    if (typeof src !== "string") return;
    try {
      parse(src);
    } catch (e) {
      issues.push({ path, message: (e as Error).message });
    }
  };
  const tryTemplate = (path: string, src: unknown) => {
    if (typeof src !== "string") return;
    const problem = checkTemplate(src);
    if (problem) issues.push({ path, message: problem });
  };
  doc.sources.forEach((s, i) => {
    if (s.kind !== "hearth") tryFormula(`sources.${i}.track`, s.track);
  });
  doc.values.forEach((v, i) => {
    if (names.has(v.id))
      issues.push({ path: `values.${i}.id`, message: `"${v.id}" is already a source or reserved` });
    names.add(v.id);
    tryFormula(`values.${i}.expr`, v.expr);
  });
  doc.blocks.forEach((b, i) => {
    const rec = b as Record<string, unknown>;
    for (const k of FORMULA_KEYS) tryFormula(`blocks.${i}.${k}`, rec[k]);
    for (const k of TEMPLATE_KEYS) tryTemplate(`blocks.${i}.${k}`, rec[k]);
    if (typeof rec.max === "string") tryFormula(`blocks.${i}.max`, rec.max);
    if (b.tone && !(TONES as readonly string[]).includes(b.tone))
      tryFormula(`blocks.${i}.tone`, b.tone);
    if (b.kind === "table")
      for (const [j, c] of b.columns.entries())
        tryFormula(`blocks.${i}.columns.${j}.value`, c.value);
    if (b.kind === "pairs")
      for (const [j, p] of b.items.entries()) tryTemplate(`blocks.${i}.items.${j}.value`, p.value);
  });
  return { doc: issues.length ? null : doc, issues };
}

// ---------------------------------------------------------------------------
// What the page gets: every formula already worked out on the server

export type ResolvedBlock = {
  id: string;
  w: number;
  title?: string;
  tone: Tone;
  error?: string;
} & (
  | { kind: "heading"; text: string }
  | { kind: "text"; text: string; size: "sm" | "md" | "lg" }
  | {
      kind: "stat";
      value: string;
      label?: string;
      unit?: string;
      sub?: string;
      spark?: number[];
      size: "sm" | "md" | "lg" | "xl";
    }
  | {
      kind: "gauge";
      value: number | null;
      display: string;
      min: number;
      max: number;
      label?: string;
      unit?: string;
    }
  | { kind: "progress"; value: number | null; max: number; label?: string; detail?: string }
  | {
      kind: "line";
      points: number[];
      value: string;
      label?: string;
      unit?: string;
      fill: boolean;
      height: number;
    }
  | { kind: "bars"; items: { label: string; value: number; display: string }[] }
  | {
      kind: "list";
      items: { title: string; detail?: string; value?: string; icon?: string; tone: Tone }[];
      empty?: string;
    }
  | { kind: "table"; columns: { label: string; align: "left" | "right" }[]; rows: string[][] }
  | {
      kind: "lights";
      items: { label: string; state: "up" | "down" | "warn" | "off"; detail?: string }[];
    }
  | { kind: "pairs"; items: { label: string; value: string }[] }
  | {
      kind: "image";
      src: string | null;
      alt: string;
      fit: "cover" | "contain";
      every: number;
      height: number;
    }
  | { kind: "divider" }
);

export interface WidgetFrame {
  blocks: ResolvedBlock[];
  /** When the newest data arrived (ms). */
  at: number;
  /** Per source: ok, or why it isn't. */
  sources: Record<string, { ok: boolean; error?: string; at?: number }>;
}

// ---------------------------------------------------------------------------
// For the AI designer and outside assistants

export const BLOCK_HELP: Record<BlockKind, string> = {
  heading: "A title. text is a template.",
  text: 'A sentence with live values: text "CPU at {{ round($nas.cpu, 1) }}%".',
  stat: "One big number: value (formula), label, unit, sub (small line), spark (list of numbers for a small line).",
  gauge: "A round gauge: value, min, max (number or formula), unit, warnAt, badAt.",
  progress:
    'A bar towards max: value, max, label, detail ("{{ bytes($used) }} of {{ bytes($total) }}"), warnAt, badAt (percent).',
  line: "A line chart: points (a list of numbers, or items plus field), value (big number), unit.",
  bars: "Ranked bars: items (a list), label and value (field names in each item), display (formula over $item), limit.",
  list: "Rows: items (a list), itemTitle, itemDetail, itemValue, itemIcon (an emoji), itemTone; formulas over $item and $index.",
  table: "A table: rows (a list), columns [{label, value (formula over $item), align}].",
  lights:
    'Status lights: items, itemLabel, itemState ("up", "down", "warn", "off" or true/false), itemDetail.',
  pairs: "Label and value pairs: items [{label, value (template)}].",
  image:
    "A picture from the home network (a camera snapshot): src (template), every (seconds), fit, height.",
  divider: "A line between sections.",
};

export function functionHelp(): string {
  return Object.entries(FUNCTIONS)
    .map(([name, f]) => `${name}(${f.args}): ${f.doc}`)
    .join("\n");
}

export const EXAMPLE_DOC: WidgetDocInput = {
  v: 1,
  sources: [
    {
      id: "nas",
      kind: "http",
      url: "http://example.home/api/stats",
      every: 30,
      track: "$nas.cpu",
      keep: 60,
    },
  ],
  values: [{ id: "used_pct", expr: "pct($nas.disk.used, $nas.disk.total)" }],
  blocks: [
    {
      id: "cpu",
      kind: "stat",
      w: 6,
      label: "CPU",
      value: "round($nas.cpu, 0)",
      unit: "%",
      spark: "$history.nas",
    },
    {
      id: "temp",
      kind: "gauge",
      w: 6,
      label: "Temperature",
      value: "$nas.temp",
      max: 80,
      unit: "°C",
      warnAt: 55,
      badAt: 70,
    },
    {
      id: "disk",
      kind: "progress",
      w: 12,
      label: "Volume 1",
      value: "$used_pct",
      detail: "{{ bytes($nas.disk.used) }} of {{ bytes($nas.disk.total) }}",
      warnAt: 80,
      badAt: 92,
    },
  ],
};
