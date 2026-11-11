/**
 * Pie, treemap, heat map, scatter, waterfall and calendar, from Muny's card kit. Each draws a
 * worked-out query (named columns and rows of plain values), in the theme's chart colors.
 * Lines, areas and columns are in ./xychart.
 */
import { useMemo, useState } from "react";
import { formatCell, formatCompact } from "../../../../shared/cardkit/format";
import type {
  CardCell,
  ChartOptions,
  QueryResult,
  ResultColumn,
} from "../../../../shared/cardkit/result";
import { cx } from "../../../lib/format";
import { OTHER_COLOR, seriesColor } from "./series";
import { cardColor, niceTicks, useWidth } from "./xychart";

export interface ChartProps {
  title?: string;
  options: ChartOptions;
  query: QueryResult;
}

export const nothing = <p className="py-4 text-center text-sm text-muted">Nothing to show yet.</p>;

const visible = (q: QueryResult, role: ResultColumn["role"]) =>
  q.columns.filter((c) => c.role === role && !c.hidden);

const numeric = (v: CardCell | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function pairs(q: QueryResult | undefined) {
  if (!q) return null;
  const dim = visible(q, "dimension")[0];
  const measure = visible(q, "measure")[0];
  if (!dim || !measure) return null;
  const di = q.columns.indexOf(dim);
  const mi = q.columns.indexOf(measure);
  const items = q.rows.map((r) => ({
    key: String(r[di] ?? "—"),
    label: formatCell(r[di] ?? null, dim.type, dim.bucket),
    value: numeric(r[mi]) ?? 0,
    isOther: r[di] === "Other",
  }));
  return { dim, measure, items };
}

export function PieChart({ title, options: o, query }: ChartProps) {
  const [hover, setHover] = useState<string | null>(null);
  const p = pairs(query);
  const items = (p?.items ?? []).filter((i) => i.value > 0);
  if (!p || items.length === 0) return nothing;
  // A handful of slices read as parts of a whole; the rest are folded together.
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const top = sorted.length > 8 ? sorted.slice(0, 7) : sorted;
  const rest = sorted.slice(top.length);
  const named = [...top].sort((a, b) => a.key.localeCompare(b.key));
  const slices = [
    ...top.map((s) => ({ ...s, color: s.isOther ? OTHER_COLOR : seriesColor(named.indexOf(s)) })),
    ...(rest.length
      ? [
          {
            key: "__rest",
            label: "Other",
            value: rest.reduce((s, x) => s + x.value, 0),
            isOther: true,
            color: OTHER_COLOR,
          },
        ]
      : []),
  ];
  const total = slices.reduce((s, x) => s + x.value, 0);
  const size = 180;
  const thickness = o.donut === false ? size / 2 : 28;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const gap = slices.length > 1 ? 2 : 0;
  let acc = 0;
  const shown = slices.find((s) => s.key === hover);
  return (
    <div className="flex flex-wrap items-center justify-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          role="img"
          aria-label={title ?? `${p.measure.label} by ${p.dim.label}`}
          className="-rotate-90"
        >
          {slices.map((s) => {
            const len = (s.value / total) * c;
            const el = (
              <circle
                key={s.key}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
                strokeDashoffset={-acc}
                onPointerEnter={() => setHover(s.key)}
                onPointerLeave={() => setHover(null)}
              />
            );
            acc += len;
            return el;
          })}
        </svg>
        {o.donut !== false && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
            <span className="text-sm font-semibold tabular-nums">
              {shown
                ? formatCell(shown.value, p.measure.type)
                : (o.center ?? formatCell(total, p.measure.type))}
            </span>
            {shown && <span className="truncate text-xs text-muted">{shown.label}</span>}
          </div>
        )}
      </div>
      <ul className="min-w-40 flex-1 space-y-1 text-sm">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-sm"
                style={{ background: s.color }}
              />
              <span className="truncate">{s.label}</span>
            </span>
            <span className="shrink-0 tabular-nums">{formatCell(s.value, p.measure.type)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Squarified treemap layout. */
function squarify(
  items: { value: number; key: string }[],
  box: { x: number; y: number; w: number; h: number },
) {
  const out = new Map<string, { x: number; y: number; w: number; h: number }>();
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total <= 0) return out;
  const scale = (box.w * box.h) / total;
  const rest = items.map((i) => ({ ...i, area: i.value * scale }));
  let { x, y, w, h } = box;
  while (rest.length) {
    const side = Math.min(w, h);
    const row: typeof rest = [];
    let best = Number.POSITIVE_INFINITY;
    while (rest.length) {
      const next = rest[0] as (typeof rest)[number];
      const areas = [...row, next].map((r) => r.area);
      const sum = areas.reduce((s, a) => s + a, 0);
      const worst = Math.max(
        ...areas.map((a) =>
          Math.max((side * side * a) / (sum * sum), (sum * sum) / (side * side * a)),
        ),
      );
      if (worst > best) break;
      best = worst;
      row.push(next);
      rest.shift();
    }
    const sum = row.reduce((s, r) => s + r.area, 0);
    const thick = sum / side;
    let at = 0;
    for (const r of row) {
      const len = r.area / thick;
      out.set(
        r.key,
        w >= h ? { x, y: y + at, w: thick, h: len } : { x: x + at, y, w: len, h: thick },
      );
      at += len;
    }
    if (w >= h) {
      x += thick;
      w -= thick;
    } else {
      y += thick;
      h -= thick;
    }
  }
  return out;
}

export function TreemapChart({ options, query }: ChartProps) {
  const { ref, width } = useWidth();
  const p = pairs(query);
  const items = useMemo(
    () => (p?.items ?? []).filter((i) => i.value > 0).sort((a, b) => b.value - a.value),
    [p],
  );
  const height = options.height ?? 240;
  const rects = useMemo(
    () => squarify(items, { x: 0, y: 0, w: width, h: height }),
    [items, width, height],
  );
  if (!p || items.length === 0) return nothing;
  const named = items
    .slice(0, 7)
    .map((i) => i.key)
    .sort((a, b) => a.localeCompare(b));
  return (
    <div ref={ref} className="relative overflow-hidden rounded-lg" style={{ height }}>
      {items.map((i) => {
        const r = rects.get(i.key);
        if (!r) return null;
        const slot = named.indexOf(i.key);
        const room = r.w > 64 && r.h > 34;
        return (
          <div
            key={i.key}
            title={`${i.label}: ${formatCell(i.value, p.measure.type)}`}
            className="absolute overflow-hidden rounded-[4px] border-2 border-surface p-1.5 text-xs text-white"
            style={{
              left: r.x,
              top: r.y,
              width: r.w,
              height: r.h,
              background: slot >= 0 ? seriesColor(slot) : OTHER_COLOR,
            }}
          >
            {room && (
              <>
                <span className="block truncate font-medium">{i.label}</span>
                <span className="block truncate tabular-nums">
                  {formatCell(i.value, p.measure.type)}
                </span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function HeatmapChart({ query: q }: ChartProps) {
  const [xCol, yCol] = visible(q, "dimension");
  const measure = visible(q, "measure")[0];
  if (!xCol || !yCol || !measure) return nothing;
  const xi = q.columns.indexOf(xCol);
  const yi = q.columns.indexOf(yCol);
  const mi = q.columns.indexOf(measure);
  const order = (i: number) =>
    [...new Set(q.rows.map((r) => r[i] ?? null))].sort((a, b) =>
      typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b)),
    );
  const xs = order(xi);
  const ys = order(yi);
  const cells = new Map(q.rows.map((r) => [`${r[xi]}|${r[yi]}`, numeric(r[mi])]));
  const values = [...cells.values()].filter((v): v is number => v !== null);
  const max = Math.max(1, ...values.map(Math.abs));
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0.5 text-xs">
        <thead>
          <tr>
            <th />
            {xs.map((x) => (
              <th key={String(x)} scope="col" className="px-0.5 font-normal text-muted">
                {formatCell(x, xCol.type, xCol.bucket)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ys.map((y) => (
            <tr key={String(y)}>
              <th scope="row" className="max-w-28 truncate pr-2 text-right font-normal text-muted">
                {formatCell(y, yCol.type, yCol.bucket)}
              </th>
              {xs.map((x) => {
                const v = cells.get(`${x}|${y}`) ?? null;
                const pct = v === null ? 0 : Math.round((Math.abs(v) / max) * 100);
                const text = `${formatCell(x, xCol.type, xCol.bucket)}, ${formatCell(y, yCol.type, yCol.bucket)}: ${formatCell(v, measure.type)}`;
                return (
                  <td
                    key={String(x)}
                    title={text}
                    aria-label={text}
                    className="h-7 min-w-6 rounded-[4px]"
                    style={{
                      background: `color-mix(in oklab, var(--viz-series-1) ${pct}%, var(--viz-grid))`,
                    }}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ScatterChart({ options, query: q }: ChartProps) {
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const measures = visible(q, "measure");
  const dim = visible(q, "dimension")[0];
  const xCol = measures[0];
  const yCol = measures[1];
  if (!xCol || !yCol) return nothing;
  const xi = q.columns.indexOf(xCol);
  const yi = q.columns.indexOf(yCol);
  const points = q.rows
    .map((r, i) => ({ i, x: numeric(r[xi]), y: numeric(r[yi]) }))
    .filter((p): p is { i: number; x: number; y: number } => p.x !== null && p.y !== null);
  if (!points.length) return nothing;
  const height = options.height ?? 240;
  const xTicks = niceTicks(
    Math.min(0, ...points.map((p) => p.x)),
    Math.max(...points.map((p) => p.x)),
  );
  const yTicks = niceTicks(
    Math.min(0, ...points.map((p) => p.y)),
    Math.max(...points.map((p) => p.y)),
  );
  const PAD = { top: 10, right: 12, bottom: 34, left: 52 };
  const span = (t: number[]) => Math.max((t[t.length - 1] ?? 1) - (t[0] ?? 0), 1e-9);
  const px = (v: number) =>
    PAD.left + ((v - (xTicks[0] ?? 0)) / span(xTicks)) * (width - PAD.left - PAD.right);
  const py = (v: number) =>
    height - PAD.bottom - ((v - (yTicks[0] ?? 0)) / span(yTicks)) * (height - PAD.top - PAD.bottom);
  const hovered = hover !== null ? q.rows[hover] : null;
  return (
    <div ref={ref} className="relative">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${yCol.label} against ${xCol.label}`}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={py(t)}
              y2={py(t)}
              stroke="var(--viz-grid)"
            />
            <text
              x={PAD.left - 6}
              y={py(t) + 4}
              textAnchor="end"
              fontSize={11}
              fill="var(--viz-muted)"
            >
              {formatCompact(t, yCol.type)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text
            key={t}
            x={px(t)}
            y={height - PAD.bottom + 16}
            textAnchor="middle"
            fontSize={11}
            fill="var(--viz-muted)"
          >
            {formatCompact(t, xCol.type)}
          </text>
        ))}
        <text
          x={(width + PAD.left) / 2}
          y={height - 4}
          textAnchor="middle"
          fontSize={11}
          fill="var(--viz-muted)"
        >
          {xCol.label}
        </text>
        {points.map((p) => (
          <circle
            key={p.i}
            cx={px(p.x)}
            cy={py(p.y)}
            r={5}
            fill={cardColor(yCol.color, 0)}
            stroke="var(--viz-surface)"
            strokeWidth={2}
            onPointerEnter={() => setHover(p.i)}
            onPointerLeave={() => setHover(null)}
          />
        ))}
      </svg>
      {hovered && (
        <div
          role="tooltip"
          className="pointer-events-none absolute top-1 right-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-md"
        >
          {dim && (
            <p className="font-medium">
              {formatCell(hovered[q.columns.indexOf(dim)] ?? null, dim.type, dim.bucket)}
            </p>
          )}
          <p className="tabular-nums">
            {xCol.label}: {formatCell(hovered[xi] ?? null, xCol.type)}
          </p>
          <p className="tabular-nums">
            {yCol.label}: {formatCell(hovered[yi] ?? null, yCol.type)}
          </p>
        </div>
      )}
    </div>
  );
}

export function WaterfallChart({ options, query }: ChartProps) {
  const { ref, width } = useWidth();
  const p = pairs(query);
  if (!p || p.items.length === 0) return nothing;
  const height = options.height ?? 220;
  const PAD = { top: 10, right: 8, bottom: 24, left: 50 };
  let run = 0;
  const steps = p.items.map((i) => {
    const from = run;
    run += i.value;
    return { ...i, from, to: run };
  });
  const total = run;
  const bars = [
    ...steps,
    { key: "__total", label: "Total", value: total, from: 0, to: total, isOther: false },
  ];
  const ticks = niceTicks(
    Math.min(0, ...bars.map((b) => Math.min(b.from, b.to))),
    Math.max(...bars.map((b) => Math.max(b.from, b.to)), 1),
  );
  const lo = ticks[0] ?? 0;
  const hi = ticks[ticks.length - 1] ?? 1;
  const y = (v: number) =>
    PAD.top + (height - PAD.top - PAD.bottom) * (1 - (v - lo) / Math.max(hi - lo, 1e-9));
  const band = (width - PAD.left - PAD.right) / bars.length;
  const w = Math.min(44, band * 0.7);
  const every = Math.max(1, Math.ceil(bars.length / Math.max(2, Math.floor((width - 58) / 60))));
  return (
    <div ref={ref}>
      <ul className="mb-2 flex flex-wrap gap-x-3 text-xs text-muted">
        {[
          ["Up", "var(--viz-positive)"],
          ["Down", "var(--viz-negative)"],
          ["Total", "var(--viz-series-1)"],
        ].map(([label, color]) => (
          <li key={label} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-sm"
              style={{ background: color }}
            />
            {label}
          </li>
        ))}
      </ul>
      <svg width={width} height={height} role="img" aria-label={`How ${p.measure.label} builds up`}>
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"}
            />
            <text
              x={PAD.left - 6}
              y={y(t) + 4}
              textAnchor="end"
              fontSize={11}
              fill="var(--viz-muted)"
            >
              {formatCompact(t, p.measure.type)}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const cx0 = PAD.left + band * (i + 0.5);
          const top = y(Math.max(b.from, b.to));
          const bottom = y(Math.min(b.from, b.to));
          const isTotal = b.key === "__total";
          return (
            <g key={b.key}>
              <rect
                x={cx0 - w / 2}
                y={top}
                width={w}
                height={Math.max(1, bottom - top)}
                rx={Math.min(4, w / 2)}
                fill={
                  isTotal
                    ? "var(--viz-series-1)"
                    : b.value >= 0
                      ? "var(--viz-positive)"
                      : "var(--viz-negative)"
                }
              >
                <title>{`${b.label}: ${formatCell(b.value, p.measure.type)}`}</title>
              </rect>
              {i % every === 0 && (
                <text
                  x={cx0}
                  y={height - 6}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--viz-muted)"
                >
                  {b.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

export function CalendarChart({ query: q }: ChartProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [cursor, setCursor] = useState(() => ({
    y: Number(today.slice(0, 4)),
    m: Number(today.slice(5, 7)) - 1,
  }));
  const dims = visible(q, "dimension");
  const dateCol = dims.find((d) => d.type === "date") ?? dims[0];
  const nameCol = dims.find((d) => d !== dateCol);
  const measure = visible(q, "measure")[0];
  if (!dateCol) return nothing;
  const di = q.columns.indexOf(dateCol);
  const ni = nameCol ? q.columns.indexOf(nameCol) : -1;
  const mi = measure ? q.columns.indexOf(measure) : -1;
  const byDay = new Map<string, CardCell[][]>();
  for (const r of q.rows) {
    const k = String(r[di] ?? "").slice(0, 10);
    const list = byDay.get(k);
    if (list) list.push(r);
    else byDay.set(k, [r]);
  }
  const first = new Date(Date.UTC(cursor.y, cursor.m, 1));
  const days = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: first.getUTCDay() }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${cursor.y}-${pad(cursor.m + 1)}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);
  const move = (by: number) =>
    setCursor((c) => {
      const t = c.y * 12 + c.m + by;
      return { y: Math.floor(t / 12), m: t % 12 };
    });
  const nav =
    "grid size-7 place-items-center rounded-lg text-muted hover:bg-(--c-surface-2) hover:text-ink";
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" className={nav} aria-label="Previous month" onClick={() => move(-1)}>
          ‹
        </button>
        <p className="font-medium">
          {first.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })}
        </p>
        <button type="button" className={nav} aria-label="Next month" onClick={() => move(1)}>
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-line text-xs">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="bg-(--c-surface-2) py-1 text-center font-medium">
            {d}
          </div>
        ))}
        {cells.map((iso, i) => (
          <div
            key={i}
            className={cx(
              "min-h-16 min-w-0 bg-surface p-1",
              iso === today && "ring-2 ring-accent ring-inset",
            )}
          >
            {iso && (
              <>
                <p className="text-muted">{Number(iso.slice(8))}</p>
                {(byDay.get(iso) ?? []).slice(0, 3).map((r, n) => {
                  const name = ni >= 0 ? String(r[ni] ?? "") : "";
                  const amount = mi >= 0 && measure ? formatCell(r[mi] ?? null, measure.type) : "";
                  return (
                    <p
                      key={n}
                      title={`${name} ${amount}`}
                      className="truncate rounded bg-(--c-surface-2) px-1"
                    >
                      {name || amount}
                    </p>
                  );
                })}
                {(byDay.get(iso)?.length ?? 0) > 3 && (
                  <p className="text-muted">+{(byDay.get(iso)?.length ?? 0) - 3} more</p>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
