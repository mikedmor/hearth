/** Draws a custom widget's blocks. Everything arrives worked out; this only paints it. */
import { CameraOff } from "lucide-react";
import { useEffect, useState } from "react";
import type { ResolvedBlock, Tone } from "../../../shared/widget-doc";
import { cx } from "../../lib/format";
import {
  CalendarChart,
  HeatmapChart,
  PieChart,
  ScatterChart,
  TreemapChart,
  WaterfallChart,
} from "./cardkit/charts";
import { XYChart } from "./cardkit/xychart";

const TONE_TEXT: Record<Tone, string> = {
  normal: "text-ink",
  muted: "text-muted",
  accent: "text-accent",
  positive: "text-good",
  negative: "text-bad",
  warning: "text-warn",
};
const TONE_VAR: Record<Tone, string> = {
  normal: "var(--c-text)",
  muted: "var(--c-muted)",
  accent: "var(--c-accent)",
  positive: "var(--c-positive)",
  negative: "var(--c-negative)",
  warning: "var(--c-warning)",
};

export function Blocks({ blocks }: { blocks: ResolvedBlock[] }) {
  return (
    <div className="block-grid">
      {blocks.map((b) => (
        <div
          key={b.id}
          style={{ gridColumn: `span ${b.w}` }}
          title={b.error ? `Problem: ${b.error}` : undefined}
        >
          {b.title && b.kind !== "heading" ? (
            <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wider text-muted">
              {b.title}
            </p>
          ) : null}
          <BlockView b={b} />
        </div>
      ))}
    </div>
  );
}

export function BlockView({ b }: { b: ResolvedBlock }) {
  switch (b.kind) {
    case "heading":
      return <h3 className={cx("text-[17px] font-bold", TONE_TEXT[b.tone])}>{b.text}</h3>;
    case "text":
      return (
        <p
          className={cx(
            b.size === "sm"
              ? "text-[13px]"
              : b.size === "lg"
                ? "text-[19px] leading-snug"
                : "text-[15px]",
            TONE_TEXT[b.tone],
          )}
        >
          {b.text}
        </p>
      );
    case "divider":
      return <hr className="border-line" />;
    case "columns":
    case "area":
      return (
        <XYChart
          queries={[b.query]}
          kind={b.kind === "area" ? "area" : "column"}
          options={b.options}
          references={b.options.references}
          ariaLabel={b.title ?? "Chart"}
        />
      );
    case "pie":
      return <PieChart title={b.title} options={b.options} query={b.query} />;
    case "treemap":
      return <TreemapChart title={b.title} options={b.options} query={b.query} />;
    case "heatmap":
      return <HeatmapChart title={b.title} options={b.options} query={b.query} />;
    case "scatter":
      return <ScatterChart title={b.title} options={b.options} query={b.query} />;
    case "waterfall":
      return <WaterfallChart title={b.title} options={b.options} query={b.query} />;
    case "calendar":
      return <CalendarChart title={b.title} options={b.options} query={b.query} />;
    case "stat":
      return (
        <div className="grid gap-0.5">
          {b.label ? <span className="text-[13px] font-medium text-muted">{b.label}</span> : null}
          <div className="flex items-end justify-between gap-3">
            <span
              className={cx(
                "font-heading font-bold tracking-tight tabular-nums",
                TONE_TEXT[b.tone],
                {
                  sm: "text-xl",
                  md: "text-2xl",
                  lg: "text-[32px] leading-none",
                  xl: "text-[44px] leading-none",
                }[b.size],
              )}
            >
              {b.value}
              {b.unit ? (
                <span className="ml-1 text-[0.5em] font-semibold text-muted">{b.unit}</span>
              ) : null}
            </span>
            {b.spark && b.spark.length > 1 ? (
              <Spark
                points={b.spark}
                color={TONE_VAR[b.tone === "normal" ? "accent" : b.tone]}
                className="h-9 w-28"
              />
            ) : null}
          </div>
          {b.sub ? <span className="text-[12.5px] text-muted">{b.sub}</span> : null}
        </div>
      );
    case "gauge":
      return <Gauge b={b} />;
    case "progress": {
      const pct =
        b.value === null || !b.max ? 0 : Math.max(0, Math.min(100, (b.value / b.max) * 100));
      return (
        <div className="grid gap-1.5">
          <div className="flex items-baseline justify-between gap-2 text-[13px]">
            <span className="font-semibold">{b.label}</span>
            <span className="text-muted tabular-nums">{b.detail ?? `${Math.round(pct)}%`}</span>
          </div>
          <div
            className="h-2.5 overflow-hidden rounded-full bg-(--c-surface-2)"
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={b.label}
          >
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${pct}%`, background: TONE_VAR[b.tone] }}
            />
          </div>
        </div>
      );
    }
    case "line":
      return (
        <div className="grid gap-1">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] font-medium text-muted">{b.label}</span>
            <span className={cx("text-xl font-bold tabular-nums", TONE_TEXT[b.tone])}>
              {b.value}
              {b.unit ? <span className="ml-1 text-xs text-muted">{b.unit}</span> : null}
            </span>
          </div>
          {b.points.length > 1 ? (
            <Spark
              points={b.points}
              color={TONE_VAR[b.tone]}
              fill={b.fill}
              style={{ height: b.height }}
              className="w-full"
            />
          ) : (
            <p className="text-[13px] text-muted">Collecting points…</p>
          )}
        </div>
      );
    case "bars": {
      const max = Math.max(1, ...b.items.map((i) => Math.abs(i.value)));
      return (
        <ul className="grid gap-2">
          {b.items.map((i) => (
            <li key={i.label} className="grid gap-1">
              <div className="flex justify-between gap-2 text-[13px]">
                <span className="truncate">{i.label}</span>
                <span className="tabular-nums text-muted">{i.display}</span>
              </div>
              <div className="h-2 rounded-full bg-(--c-surface-2)">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(Math.abs(i.value) / max) * 100}%`,
                    background: TONE_VAR[b.tone],
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      );
    }
    case "list":
      if (b.items.length === 0)
        return <p className="text-[13px] text-muted">{b.empty ?? "Nothing here."}</p>;
      return (
        <ul className="grid divide-y divide-line">
          {b.items.map((i, n) => (
            <li
              key={`${i.title}-${n}`}
              className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
            >
              {i.icon ? <span className="w-7 text-center text-xl">{i.icon}</span> : null}
              <span className="grid min-w-0 grow">
                <span className={cx("truncate text-[14.5px] font-semibold", TONE_TEXT[i.tone])}>
                  {i.title}
                </span>
                {i.detail ? (
                  <span className="truncate text-[12.5px] text-muted">{i.detail}</span>
                ) : null}
              </span>
              {i.value ? (
                <span className="text-[14px] font-semibold tabular-nums">{i.value}</span>
              ) : null}
            </li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="text-left text-[12px] uppercase tracking-wider text-muted">
                {b.columns.map((c) => (
                  <th
                    key={c.label}
                    className={cx("pb-1.5 font-semibold", c.align === "right" && "text-right")}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {b.rows.map((row, r) => (
                <tr key={`${row[0]}-${r}`}>
                  {row.map((cell, i) => (
                    <td
                      key={`${b.columns[i]?.label}`}
                      className={cx(
                        "py-1.5",
                        b.columns[i]?.align === "right" && "text-right tabular-nums",
                      )}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "lights":
      return (
        <ul className="flex flex-wrap gap-1.5">
          {b.items.map((i, n) => (
            <li
              key={`${i.label}-${n}`}
              className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[12.5px]"
              title={i.detail || undefined}
            >
              <span
                className={cx("size-2 rounded-full", i.state === "down" && "animate-pulse")}
                style={{
                  background:
                    i.state === "up"
                      ? "var(--c-positive)"
                      : i.state === "down"
                        ? "var(--c-negative)"
                        : i.state === "warn"
                          ? "var(--c-warning)"
                          : "var(--c-muted)",
                }}
              />
              <span className="font-medium">{i.label}</span>
            </li>
          ))}
        </ul>
      );
    case "pairs":
      return (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
          {b.items.map((p) => (
            <div key={p.label} className="contents">
              <dt className="text-muted">{p.label}</dt>
              <dd className="text-right font-semibold tabular-nums">{p.value}</dd>
            </div>
          ))}
        </dl>
      );
    case "image":
      return <LiveImage b={b} />;
  }
}

/** "just now", "3 min ago", "2 h ago". */
function ago(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.floor(h / 24)} days ago`;
}

/**
 * A picture that refreshes (a camera's snapshot). Each new one is loaded in the background first,
 * so a camera that stops answering keeps its last picture, dimmed and marked offline, instead of
 * turning into a broken image; it's tried again on the usual schedule and comes back by itself.
 */
function LiveImage({ b }: { b: Extract<ResolvedBlock, { kind: "image" }> }) {
  const [tick, setTick] = useState(0);
  const [shown, setShown] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [failing, setFailing] = useState(false);
  useEffect(() => {
    const t = setInterval(
      () => document.visibilityState === "visible" && setTick((n) => n + 1),
      b.every * 1000,
    );
    return () => clearInterval(t);
  }, [b.every]);
  useEffect(() => {
    if (!b.src) return;
    const url = `${b.src}&t=${tick}`;
    const img = new Image();
    let live = true;
    img.onload = () => {
      if (!live) return;
      setShown(url);
      setLastOk(Date.now());
      setFailing(false);
    };
    img.onerror = () => live && setFailing(true);
    img.src = url;
    return () => {
      live = false;
    };
  }, [b.src, tick]);
  if (!b.src)
    return (
      <div
        className="grid place-items-center rounded-xl bg-(--c-surface-2) text-[13px] text-muted"
        style={{ height: b.height }}
      >
        The picture shows once the widget is saved.
      </div>
    );
  if (!shown)
    return failing ? (
      <div
        className="grid place-items-center content-center gap-1.5 rounded-xl bg-(--c-surface-2) px-4 text-center"
        style={{ height: b.height }}
      >
        <CameraOff className="size-7 text-muted" />
        <span className="text-[13.5px] font-semibold">Not answering right now</span>
        <span className="text-[12px] text-muted">Trying again every {b.every} s</span>
      </div>
    ) : (
      <div className="skeleton rounded-xl" style={{ height: b.height }} />
    );
  return (
    <div className="relative">
      <img
        src={shown}
        alt={b.alt}
        className={cx(
          "w-full rounded-xl bg-(--c-surface-2) transition-[filter,opacity] duration-500",
          failing && "opacity-45 grayscale",
        )}
        style={{ height: b.height, objectFit: b.fit }}
      />
      {failing ? (
        <span className="absolute top-2 left-2 flex items-center gap-1.5 rounded-full bg-black/65 px-2.5 py-1 text-[12px] font-semibold text-white backdrop-blur">
          <CameraOff className="size-3.5" />
          Offline{lastOk ? ` · last picture ${ago(Date.now() - lastOk)}` : ""}
        </span>
      ) : null}
    </div>
  );
}

function Gauge({ b }: { b: Extract<ResolvedBlock, { kind: "gauge" }> }) {
  const pct =
    b.value === null || b.max === b.min
      ? 0
      : Math.max(0, Math.min(1, (b.value - b.min) / (b.max - b.min)));
  const r = 42;
  const arc = Math.PI * r;
  return (
    <div className="grid justify-items-center">
      <svg
        viewBox="0 0 100 58"
        className="w-full max-w-45"
        role="img"
        aria-label={`${b.label ?? "Gauge"}: ${b.display}${b.unit ?? ""}`}
      >
        <path
          d="M8 50 A42 42 0 0 1 92 50"
          fill="none"
          stroke="var(--c-surface-2)"
          strokeWidth="9"
          strokeLinecap="round"
        />
        <path
          d="M8 50 A42 42 0 0 1 92 50"
          fill="none"
          stroke={TONE_VAR[b.tone]}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${arc * pct} ${arc}`}
          style={{ transition: "stroke-dasharray .6s" }}
        />
        <text x="50" y="46" textAnchor="middle" fontSize="17" fontWeight="700" fill="var(--c-text)">
          {b.display}
          {b.unit ? <tspan fontSize="9" fill="var(--c-muted)">{` ${b.unit}`}</tspan> : null}
        </text>
      </svg>
      {b.label ? <span className="-mt-1 text-[13px] font-medium text-muted">{b.label}</span> : null}
    </div>
  );
}

export function Spark({
  points,
  color,
  fill = true,
  className,
  style,
}: {
  points: number[];
  color: string;
  fill?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const w = 100;
  const h = 32;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const xy = points.map(
    (p, i) => [(i / (points.length - 1)) * w, h - 2 - ((p - min) / span) * (h - 4)] as const,
  );
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const id = `g${Math.abs(points.length * 7919 + Math.round(min * 13))}`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={className}
      style={style}
      aria-hidden
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.32" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill ? <path d={`${line} L${w} ${h} L0 ${h} Z`} fill={`url(#${id})`} /> : null}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
