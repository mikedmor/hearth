/**
 * Works out a custom widget's blocks from its sources' latest data. Runs on the server; the page
 * only gets the result. A failing block shows its own error and never breaks the others.
 */
import { display, type ExprContext, fillTemplate, run, toNumber, truthy } from "./expr";
import { type Block, type ResolvedBlock, TONES, type Tone, type WidgetDoc } from "./widget-doc";

export interface EvalInput {
  /** The latest value of each source, by id. */
  sources: Record<string, unknown>;
  /** Tracked numbers per source, oldest first. */
  history: Record<string, number[]>;
  locale?: string;
  timeZone?: string;
  now?: () => number;
}

export function resolveDoc(doc: WidgetDoc, input: EvalInput): ResolvedBlock[] {
  const vars: Record<string, unknown> = { ...input.sources, history: input.history };
  const base: Omit<ExprContext, "vars"> = {
    locale: input.locale,
    timeZone: input.timeZone,
    now: input.now,
  };
  for (const v of doc.values) {
    try {
      vars[v.id] = run(v.expr, { ...base, vars });
    } catch {
      vars[v.id] = null;
    }
  }
  const ctx: ExprContext = { ...base, vars };
  return doc.blocks.map((b) => {
    try {
      return resolveBlock(b, ctx);
    } catch (e) {
      return {
        id: b.id,
        w: b.w,
        title: b.title,
        tone: "muted",
        kind: "text",
        text: "—",
        size: "md",
        error: (e as Error).message,
      } satisfies ResolvedBlock;
    }
  });
}

const tmpl = (t: string | undefined, ctx: ExprContext) =>
  t === undefined ? undefined : fillTemplate(t, ctx);

function toneOf(src: string | undefined, ctx: ExprContext, fallback: Tone = "normal"): Tone {
  if (!src) return fallback;
  if ((TONES as readonly string[]).includes(src)) return src as Tone;
  const v = run(src, ctx);
  return (TONES as readonly string[]).includes(String(v)) ? (v as Tone) : fallback;
}

function bandTone(pct: number | null, warnAt?: number, badAt?: number): Tone {
  if (pct === null) return "muted";
  if (badAt !== undefined && pct >= badAt) return "negative";
  if (warnAt !== undefined && pct >= warnAt) return "warning";
  return "accent";
}

function items(src: string, ctx: ExprContext, limit: number): unknown[] {
  const v = run(src, ctx);
  const arr = Array.isArray(v)
    ? v
    : v && typeof v === "object"
      ? Object.entries(v).map(([key, value]) => ({ key, value }))
      : [];
  return arr.slice(0, limit);
}

const each = (ctx: ExprContext, item: unknown, index: number): ExprContext => ({
  ...ctx,
  vars: { ...ctx.vars, item, index },
});

function numbers(v: unknown, field?: string): number[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(-500)
    .map((x) =>
      toNumber(field && x && typeof x === "object" ? (x as Record<string, unknown>)[field] : x),
    )
    .filter((x): x is number => x !== null);
}

function resolveBlock(b: Block, ctx: ExprContext): ResolvedBlock {
  const common = { id: b.id, w: b.w, title: b.title };
  switch (b.kind) {
    case "heading":
      return {
        ...common,
        kind: "heading",
        tone: toneOf(b.tone, ctx),
        text: fillTemplate(b.text, ctx),
      };
    case "text":
      return {
        ...common,
        kind: "text",
        tone: toneOf(b.tone, ctx),
        text: fillTemplate(b.text, ctx),
        size: b.size,
      };
    case "divider":
      return { ...common, kind: "divider", tone: "muted" };
    case "stat": {
      const v = run(b.value, ctx);
      return {
        ...common,
        kind: "stat",
        tone: toneOf(b.tone, ctx),
        value: display(v, ctx),
        label: tmpl(b.label, ctx),
        unit: b.unit,
        sub: tmpl(b.sub, ctx),
        spark: b.spark ? numbers(run(b.spark, ctx)) : undefined,
        size: b.size,
      };
    }
    case "gauge": {
      const value = toNumber(run(b.value, ctx));
      const max = typeof b.max === "number" ? b.max : (toNumber(run(b.max, ctx)) ?? 100);
      return {
        ...common,
        kind: "gauge",
        tone: b.tone ? toneOf(b.tone, ctx) : bandTone(value, b.warnAt, b.badAt),
        value,
        display: display(value === null ? null : Math.round(value * 10) / 10, ctx),
        min: b.min,
        max,
        label: tmpl(b.label, ctx),
        unit: b.unit,
      };
    }
    case "progress": {
      const value = toNumber(run(b.value, ctx));
      const max = typeof b.max === "number" ? b.max : (toNumber(run(b.max, ctx)) ?? 100);
      const pct = value === null || !max ? null : (value / max) * 100;
      return {
        ...common,
        kind: "progress",
        tone: b.tone ? toneOf(b.tone, ctx) : bandTone(pct, b.warnAt, b.badAt),
        value,
        max,
        label: tmpl(b.label, ctx),
        detail: tmpl(b.detail, ctx),
      };
    }
    case "line": {
      const points = numbers(run(b.points, ctx), b.field);
      const value = b.value ? run(b.value, ctx) : points.at(-1);
      return {
        ...common,
        kind: "line",
        tone: toneOf(b.tone, ctx, "accent"),
        points,
        value: display(value, ctx),
        label: tmpl(b.label, ctx),
        unit: b.unit,
        fill: b.fill,
        height: b.height,
      };
    }
    case "bars": {
      const rows = items(b.items, ctx, b.limit).map((item, i) => {
        const rec = (item ?? {}) as Record<string, unknown>;
        const value = toNumber(rec[b.value]) ?? 0;
        return {
          label: display(rec[b.label], ctx),
          value,
          display: b.display
            ? display(run(b.display, each(ctx, item, i)), ctx)
            : display(value, ctx),
        };
      });
      return { ...common, kind: "bars", tone: toneOf(b.tone, ctx, "accent"), items: rows };
    }
    case "list": {
      const rows = items(b.items, ctx, b.limit).map((item, i) => {
        const c = each(ctx, item, i);
        const opt = (src?: string) => (src ? display(run(src, c), ctx) : undefined);
        return {
          title: display(run(b.itemTitle, c), ctx),
          detail: opt(b.itemDetail),
          value: opt(b.itemValue),
          icon: opt(b.itemIcon),
          tone: toneOf(b.itemTone, c),
        };
      });
      return { ...common, kind: "list", tone: toneOf(b.tone, ctx), items: rows, empty: b.empty };
    }
    case "table": {
      const rows = items(b.rows, ctx, b.limit).map((item, i) => {
        const c = each(ctx, item, i);
        return b.columns.map((col) => display(run(col.value, c), ctx));
      });
      return {
        ...common,
        kind: "table",
        tone: toneOf(b.tone, ctx),
        columns: b.columns.map((c) => ({ label: c.label, align: c.align })),
        rows,
      };
    }
    case "lights": {
      const rows = items(b.items, ctx, b.limit).map((item, i) => {
        const c = each(ctx, item, i);
        return {
          label: display(run(b.itemLabel, c), ctx),
          state: lightState(run(b.itemState, c)),
          detail: b.itemDetail ? display(run(b.itemDetail, c), ctx) : undefined,
        };
      });
      return { ...common, kind: "lights", tone: toneOf(b.tone, ctx), items: rows };
    }
    case "pairs":
      return {
        ...common,
        kind: "pairs",
        tone: toneOf(b.tone, ctx),
        items: b.items.map((p) => ({ label: p.label, value: fillTemplate(p.value, ctx) })),
      };
    case "image": {
      const src = fillTemplate(b.src, ctx).trim();
      return {
        ...common,
        kind: "image",
        tone: "normal",
        src: src && !src.includes("—") ? src : null,
        alt: b.alt,
        fit: b.fit,
        every: b.every,
        height: b.height,
      };
    }
  }
}

function lightState(v: unknown): "up" | "down" | "warn" | "off" {
  if (v === "up" || v === "down" || v === "warn" || v === "off") return v;
  if (typeof v === "string") {
    const s = v.toLowerCase();
    if (["ok", "on", "online", "running", "healthy", "good", "active", "true", "yes"].includes(s))
      return "up";
    if (["warning", "degraded", "slow", "busy"].includes(s)) return "warn";
    if (["off", "stopped", "disabled", "unknown", "idle"].includes(s)) return "off";
    return "down";
  }
  if (v === null || v === undefined) return "off";
  return truthy(v) ? "up" : "down";
}
