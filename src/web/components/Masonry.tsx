/**
 * Items packed into as many columns as fit, each next item going into the shortest column, so
 * the whole width is used and nothing waits below the fold that could sit beside it.
 */
import { useLayoutEffect, useRef, useState } from "react";

export function Masonry<T>({
  items,
  minWidth,
  weight,
  render,
}: {
  items: T[];
  minWidth: number;
  /** Roughly how tall an item is, in the same unit for every item. */
  weight: (item: T) => number;
  render: (item: T) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(3);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const gap = Number.parseFloat(getComputedStyle(el).columnGap) || 12;
    const measure = () =>
      setCols(Math.max(1, Math.floor((el.clientWidth + gap) / (minWidth + gap))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [minWidth]);
  const columns: T[][] = Array.from(
    { length: Math.min(cols, Math.max(1, items.length)) },
    () => [],
  );
  const heights = columns.map(() => 0);
  for (const item of items) {
    const i = heights.indexOf(Math.min(...heights));
    columns[i]?.push(item);
    heights[i] = (heights[i] ?? 0) + weight(item);
  }
  return (
    <div ref={ref} className="flex items-start gap-(--gap)">
      {columns.map((col, i) => (
        <div key={i} className="min-w-0 flex-1">
          {col.map(render)}
        </div>
      ))}
    </div>
  );
}
