/**
 * Search as a command palette: results open in a panel over the page (nothing moves), arrows pick,
 * Enter opens, Ctrl+Enter opens in a new tab. `/` or Ctrl+K focuses it from anywhere. Under the
 * home's own links: open what was typed, if it's an address, and search the web for it.
 */
import { CornerDownLeft, Globe, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { HomeView, ViewTile } from "../../shared/api";
import { webSearchUrl } from "../../shared/web-search";
import { cx } from "../lib/format";
import { addressIn, search } from "../lib/search";
import { TileIcon } from "./Tile";

export function open(tile: Pick<ViewTile, "url" | "newTab">, newTab = false) {
  if (newTab || tile.newTab) window.open(tile.url, "_blank", "noopener");
  else location.href = tile.url;
}

/** Going somewhere that isn't one of the home's links: an address typed in, or a web search. */
export interface WebAction {
  id: "go" | "web";
  url: string;
  label: string;
}

/** What a search offers besides the home's links. */
export function webActions(view: HomeView, query: string): WebAction[] {
  const q = query.trim();
  if (!q) return [];
  const out: WebAction[] = [];
  const address = addressIn(q);
  if (address) out.push({ id: "go", url: address, label: `Open ${host(address)}` });
  if (view.webSearch)
    out.push({
      id: "web",
      url: webSearchUrl(view.webSearch, q),
      label: `Search ${view.webSearch.name} for “${q}”`,
    });
  return out;
}

export function go(url: string, newTab = false) {
  if (newTab) window.open(url, "_blank", "noopener");
  else location.href = url;
}

/** One way out of the home's links, as a row in search results. */
export function WebActionRow({
  action,
  active,
  onHover,
}: {
  action: WebAction;
  active?: boolean;
  onHover?: () => void;
}) {
  return (
    <a
      id={`result-${action.id}`}
      role="option"
      aria-selected={active}
      href={action.url}
      rel="noopener noreferrer"
      onMouseEnter={onHover}
      className={cx(
        "flex items-center gap-3 rounded-xl px-2.5 py-2",
        active && "bg-(--c-surface-2)",
      )}
    >
      <span className="grid size-9 flex-none place-items-center rounded-xl bg-(--c-surface-2) text-muted">
        {action.id === "web" ? <Search className="size-4.5" /> : <Globe className="size-4.5" />}
      </span>
      <span className="grid min-w-0 grow">
        <span className="truncate font-semibold">{action.label}</span>
        <span className="truncate text-[12px] text-muted">
          {action.id === "web" ? "Opens the search engine" : action.url}
        </span>
      </span>
      {active ? <CornerDownLeft className="size-4 text-muted" aria-hidden /> : null}
    </a>
  );
}

const host = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};

export function CommandSearch({ view, className }: { view: HomeView; className?: string }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const all = useMemo(
    () => view.groups.flatMap((g) => g.tiles.map((tile) => ({ tile, group: g.name }))),
    [view.groups],
  );
  const groupOf = useMemo(() => new Map(all.map((a) => [a.tile.id, a.group])), [all]);
  const results = useMemo(() => (query.trim() ? search(all, query).slice(0, 8) : []), [all, query]);
  const actions = useMemo(() => webActions(view, query), [view, query]);
  const count = results.length + actions.length;
  /** Enter on row i: one of the home's links, then the address and web search. */
  const choose = (i: number, newTab: boolean) => {
    const t = results[i];
    if (t) return open(t, newTab);
    const a = actions[i - results.length];
    if (a) go(a.url, newTab);
  };
  const activeId = results[active]?.id ?? actions[active - results.length]?.id;

  // biome-ignore lint/correctness/useExhaustiveDependencies: start at the top whenever the search changes
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.matches("input, textarea, select, [contenteditable]");
      if (document.querySelector('[role="dialog"]')) return;
      if ((e.key === "/" && !typing) || (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const showPanel = focused && query.trim().length > 0;

  return (
    <div className={cx("relative", className)}>
      <label className="relative flex items-center">
        <Search className="pointer-events-none absolute left-3.5 size-4.5 text-muted" aria-hidden />
        <input
          ref={input}
          type="search"
          value={query}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="search-results"
          aria-activedescendant={showPanel && activeId ? `result-${activeId}` : undefined}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, count - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              if (active < count) {
                e.preventDefault();
                choose(active, e.ctrlKey || e.metaKey);
              }
            } else if (e.key === "Escape") {
              setQuery("");
              input.current?.blur();
            }
          }}
          placeholder="Search or jump to…"
          aria-label={
            view.webSearch ? "Search the home's services or the web" : "Search the home's services"
          }
          autoComplete="off"
          spellCheck={false}
          className="h-11 w-full rounded-2xl border border-line bg-surface pr-16 pl-10 text-[15px] text-ink shadow-sm placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-4 focus:ring-(--c-accent-soft)"
        />
        <kbd className="pointer-events-none absolute right-3 hidden rounded-md border border-(--c-line-strong) px-1.5 py-0.5 text-[11px] font-semibold text-muted [@media(hover:hover)]:block">
          Ctrl K
        </kbd>
      </label>
      {showPanel ? (
        <div
          id="search-results"
          role="listbox"
          className="card absolute inset-x-0 top-[calc(100%+6px)] z-40 overflow-hidden p-1.5 fade-in"
        >
          {results.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-muted">Nothing called “{query.trim()}” here.</p>
          ) : (
            results.map((t, i) => (
              <a
                key={t.id}
                id={`result-${t.id}`}
                role="option"
                aria-selected={i === active}
                href={t.url}
                target={t.newTab ? "_blank" : undefined}
                rel={t.newTab ? "noopener" : undefined}
                onMouseEnter={() => setActive(i)}
                className={cx(
                  "flex items-center gap-3 rounded-xl px-2.5 py-2",
                  i === active && "bg-(--c-surface-2)",
                )}
                style={t.color ? ({ "--tile": t.color } as React.CSSProperties) : undefined}
              >
                <span className="scale-75">
                  <TileIcon tile={t} />
                </span>
                <span className="grid min-w-0 grow">
                  <span className="truncate font-semibold">{t.name}</span>
                  <span className="truncate text-[12px] text-muted">
                    {groupOf.get(t.id)} · {host(t.url)}
                  </span>
                </span>
                {i === active ? <CornerDownLeft className="size-4 text-muted" aria-hidden /> : null}
              </a>
            ))
          )}
          {actions.length ? (
            <div className={cx(results.length > 0 && "mt-1 border-t border-line pt-1")}>
              {actions.map((a, j) => (
                <WebActionRow
                  key={a.id}
                  action={a}
                  active={results.length + j === active}
                  onHover={() => setActive(results.length + j)}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
