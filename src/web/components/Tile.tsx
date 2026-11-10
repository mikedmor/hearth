import type { IconSvg, ViewTile } from "../../shared/api";
import { cx, monogram } from "../lib/format";
import { useLive } from "../lib/live";

const STATE_WORDS = {
  up: "Up",
  slow: "Slow",
  down: "Not answering",
  unknown: "Checking…",
} as const;

export function Tile({
  tile,
  first,
  children,
  onClick,
}: {
  tile: ViewTile;
  first?: boolean;
  children?: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const live = useLive();
  const s = tile.checked ? (live.status[tile.id] ?? { state: "unknown" as const }) : null;
  const label = s
    ? `${STATE_WORDS[s.state]}${s.ms !== undefined && s.state !== "down" ? ` (${s.ms} ms)` : ""}`
    : undefined;
  return (
    <a
      href={tile.url}
      target={tile.newTab ? "_blank" : undefined}
      rel={tile.newTab ? "noopener" : undefined}
      onClick={onClick}
      className={cx("card tile", first && "is-first")}
      style={tile.color ? ({ "--tile": tile.color } as React.CSSProperties) : undefined}
    >
      <TileIcon tile={tile} />
      <span className="grid min-w-0 gap-0.5">
        <span className="truncate text-[15.5px] font-semibold tracking-tight">{tile.name}</span>
        {tile.description ? (
          <span className="tile-desc line-clamp-2 text-[13px] leading-snug text-muted">
            {tile.description}
          </span>
        ) : null}
      </span>
      {s ? (
        <span className={`dot dot-${s.state}`} role="img" aria-label={label} title={label} />
      ) : null}
      {children}
    </a>
  );
}

/** A library icon: an app's logo (filled) or a symbol (stroked), in the current colour. */
export function SvgIcon({ svg, className }: { svg: IconSvg; className?: string }) {
  if (svg.kind === "brand") {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <path d={svg.path} fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {svg.nodes.map(([tag, attrs], i) => {
        const Tag = tag as "path";
        return <Tag key={i} {...(attrs as React.SVGProps<SVGPathElement>)} />;
      })}
    </svg>
  );
}

export function TileIcon({ tile }: { tile: Pick<ViewTile, "icon" | "iconKind" | "name" | "svg"> }) {
  if (tile.iconKind === "svg" && tile.svg) {
    return (
      <span className="tile-icon lib" aria-hidden>
        <SvgIcon svg={tile.svg} className="lib-svg" />
      </span>
    );
  }
  if (tile.iconKind === "image" && tile.icon) {
    return (
      <span className="tile-icon">
        <img src={tile.icon} alt="" loading="lazy" />
      </span>
    );
  }
  if (tile.iconKind === "emoji" && tile.icon)
    return (
      <span className="tile-icon" aria-hidden>
        {tile.icon}
      </span>
    );
  return (
    <span className="tile-icon mono" aria-hidden>
      {monogram(tile.name)}
    </span>
  );
}
