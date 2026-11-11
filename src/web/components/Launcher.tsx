/**
 * The launcher: what the family clicks most, made to fit. Favourites as a dock of big icons (keys 1
 * to 9 open them), and every group as compact rows, an icon grid, or cards.
 */
import { Plus } from "lucide-react";
import { useEffect } from "react";
import type { ViewGroup, ViewTile } from "../../shared/api";
import { cx } from "../lib/format";
import { useLive } from "../lib/live";
import { open } from "./CommandSearch";
import { Tile, TileIcon } from "./Tile";

const STATE_WORDS = {
  up: "Up",
  slow: "Slow",
  down: "Not answering",
  unknown: "Checking…",
} as const;

/** A tile's status dot: in line (rows), or on the icon's corner (icons and the dock). */
export function StatusDot({ tile, corner }: { tile: ViewTile; corner?: boolean }) {
  const live = useLive();
  if (!tile.checked) return null;
  const s = live.status[tile.id] ?? { state: "unknown" as const };
  const label = `${STATE_WORDS[s.state]}${s.ms !== undefined && s.state !== "down" ? ` (${s.ms} ms)` : ""}`;
  return (
    <span
      className={cx(`dot dot-${s.state}`, corner ? "dot-corner" : "dot-inline")}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}

const linkProps = (t: ViewTile) => ({
  href: t.url,
  target: t.newTab ? "_blank" : undefined,
  rel: t.newTab ? "noopener" : undefined,
  style: t.color ? ({ "--tile": t.color } as React.CSSProperties) : undefined,
  title: t.description ? `${t.name}: ${t.description}` : t.name,
});

/** Keys 1 to 9 open the first nine favourites, when nothing is being typed. */
export function useQuickKeys(favorites: ViewTile[]) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (
        t.matches("input, textarea, select, [contenteditable]") ||
        document.querySelector('[role="dialog"]')
      )
        return;
      const n = Number(e.key);
      const tile = Number.isInteger(n) && n >= 1 ? favorites[n - 1] : undefined;
      if (tile) {
        e.preventDefault();
        open(tile, e.shiftKey);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [favorites]);
}

export function Dock({
  tiles,
  className,
  numbered = true,
  fit = false,
}: {
  tiles: ViewTile[];
  className?: string;
  numbered?: boolean;
  /** Share the width (the phone dock) instead of fixed-width items that scroll. */
  fit?: boolean;
}) {
  return (
    <nav aria-label="Favourites" className={cx("flex gap-1 overflow-x-auto", className)}>
      {tiles.map((t, i) => (
        <a
          key={t.id}
          {...linkProps(t)}
          className={cx(
            "dock-item group relative flex flex-col items-center gap-1.5 rounded-2xl px-1 py-2 text-center transition hover:bg-(--c-surface-2)",
            fit ? "min-w-0 flex-1" : "w-21 flex-none",
          )}
        >
          <span className="relative block">
            <TileIcon tile={t} />
            <StatusDot tile={t} corner />
          </span>
          <span className="w-full truncate text-[12.5px] font-semibold">{t.name}</span>
          {numbered && i < 9 ? (
            <kbd
              className="absolute top-1 left-1.5 hidden text-[10px] font-bold text-muted opacity-0 transition group-hover:opacity-100 [@media(hover:hover)]:block"
              aria-hidden
            >
              {i + 1}
            </kbd>
          ) : null}
        </a>
      ))}
    </nav>
  );
}

/** A group's name, with a + to add to it when this person may. */
function GroupHeader({
  group,
  onAdd,
  className,
}: {
  group: ViewGroup;
  onAdd?: () => void;
  className?: string;
}) {
  return (
    <h3
      className={cx(
        "group/head flex items-center justify-between gap-2 text-[11.5px] font-bold uppercase tracking-[0.09em] text-muted",
        className,
      )}
    >
      <span className="truncate">{group.name}</span>
      {onAdd ? (
        <button
          type="button"
          onClick={onAdd}
          aria-label={`Add a link to ${group.name}`}
          title={`Add a link to ${group.name}`}
          className="grid size-6 flex-none place-items-center rounded-full text-muted transition hover:bg-accent hover:text-white [@media(hover:hover)]:opacity-50 [@media(hover:hover)]:group-hover/section:opacity-100 focus-visible:opacity-100"
        >
          <Plus className="size-4" />
        </button>
      ) : (
        <span className="font-semibold">{group.tiles.length}</span>
      )}
    </h3>
  );
}

export function GroupRows({ group, onAdd }: { group: ViewGroup; onAdd?: () => void }) {
  return (
    <section className="group/section card launcher-group mb-(--gap) p-2">
      <GroupHeader group={group} onAdd={onAdd} className="min-h-7 px-2 pt-1 pb-1" />
      <ul>
        {group.tiles.map((t) => (
          <li key={t.id}>
            <a
              {...linkProps(t)}
              className="row-link flex h-10 items-center gap-2.5 rounded-xl px-2 transition hover:bg-(--c-surface-2)"
            >
              <span className="row-icon">
                <TileIcon tile={t} />
              </span>
              <span className="min-w-0 grow truncate text-[14px] font-semibold">{t.name}</span>
              <StatusDot tile={t} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function GroupIcons({
  group,
  plain,
  onAdd,
}: {
  group: ViewGroup;
  plain?: boolean;
  onAdd?: () => void;
}) {
  return (
    <section className={cx("group/section", plain ? "mb-4" : "card launcher-group mb-(--gap) p-3")}>
      <GroupHeader group={group} onAdd={onAdd} className="mb-1.5 min-h-6 px-1" />
      <div className="icon-grid">
        {group.tiles.map((t) => (
          <a
            key={t.id}
            {...linkProps(t)}
            className="flex flex-col items-center gap-1.5 rounded-2xl px-1 py-2 text-center transition hover:bg-(--c-surface-2)"
          >
            <span className="relative block">
              <TileIcon tile={t} />
              <StatusDot tile={t} corner />
            </span>
            <span className="line-clamp-2 w-full text-[12px] leading-tight font-semibold">
              {t.name}
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}

export function GroupCards({ group }: { group: ViewGroup }) {
  return (
    <section className="launcher-group mb-(--gap)">
      <h3 className="mb-2 px-1 text-[11.5px] font-bold uppercase tracking-[0.09em] text-muted">
        {group.name}
      </h3>
      <div className="tiles">
        {group.tiles.map((t) => (
          <Tile key={t.id} tile={t} />
        ))}
      </div>
    </section>
  );
}
