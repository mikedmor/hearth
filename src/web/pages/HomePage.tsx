/** The start page: hero, search, widgets, favourites and groups, in this person's order and look. */
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, GripVertical, Palette, Pencil, Plus, Search, Star, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { HomeView, ViewTile, ViewWidget } from "../../shared/api";
import { type SectionKind, WIDGET_WIDTHS } from "../../shared/config";
import { go, WebActionRow, webActions } from "../components/CommandSearch";
import { Tile } from "../components/Tile";
import { contextFromView, useTileEditors } from "../components/TileEditors";
import { Button, IconButton, Modal, useToast } from "../components/ui";
import { DEFAULT_TITLES, WidgetCard } from "../components/widgets/WidgetCard";
import { api } from "../lib/api";
import { cx, greeting } from "../lib/format";
import { useWatch } from "../lib/live";
import { keys, useHome } from "../lib/queries";
import { search } from "../lib/search";
import { CommandLayout } from "./CommandLayout";
import { CustomizePanel } from "./CustomizePanel";

const SECTION_NAMES: Record<SectionKind, string> = {
  hero: "Greeting and clock",
  search: "Search",
  widgets: "Widgets",
  favorites: "Favourites",
  groups: "Groups of tiles",
};

export function HomePage() {
  const { data: view } = useHome();
  const [editing, setEditing] = useState(false);
  const [customize, setCustomize] = useState(false);
  const [query, setQuery] = useState("");
  useWatch(view?.widgets.map((w) => w.id) ?? []);

  useEffect(() => {
    if (!view?.canEdit) setEditing(false);
  }, [view?.canEdit]);

  if (!view) return null;

  if (view.look.layout === "command") {
    return (
      <>
        <CommandLayout
          view={view}
          editing={editing}
          onEdit={() => setEditing(true)}
          onDone={() => setEditing(false)}
          onLook={() => setCustomize(true)}
        />
        <CustomizePanel open={customize} onClose={() => setCustomize(false)} view={view} />
      </>
    );
  }

  const results = query.trim()
    ? search(
        view.groups.flatMap((g) => g.tiles.map((tile) => ({ tile, group: g.name }))),
        query,
      )
    : null;

  return (
    <main className="shell pb-24">
      {editing ? (
        <EditBar
          onDone={() => setEditing(false)}
          onCustomize={() => setCustomize(true)}
          who={view.profile?.name ?? "the guest page"}
        />
      ) : null}
      {editing ? (
        <EditableSections view={view} />
      ) : (
        view.sections
          .filter((s) => !s.hidden)
          .map((s) => {
            if (results && s.kind !== "hero" && s.kind !== "search") return null;
            return (
              <Section key={s.kind} kind={s.kind} view={view} query={query} setQuery={setQuery} />
            );
          })
      )}
      {results ? <Results results={results} query={query} view={view} /> : null}
      {!editing && view.canEdit ? (
        <div className="fixed right-4 bottom-[max(16px,env(safe-area-inset-bottom))] z-30 flex gap-2">
          <button
            type="button"
            onClick={() => setCustomize(true)}
            className="card grid size-12 place-items-center text-muted hover:text-ink"
            aria-label="Customize the look"
            title="Customize the look"
          >
            <Palette className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex h-12 items-center gap-2 rounded-full bg-accent px-5 font-semibold text-white shadow-lg hover:brightness-110"
          >
            <Pencil className="size-4" /> Arrange
          </button>
        </div>
      ) : null}
      <CustomizePanel open={customize} onClose={() => setCustomize(false)} view={view} />
    </main>
  );
}

function Section({
  kind,
  view,
  query,
  setQuery,
}: {
  kind: SectionKind;
  view: HomeView;
  query: string;
  setQuery: (q: string) => void;
}) {
  switch (kind) {
    case "hero":
      return <Hero view={view} />;
    case "search":
      return <SearchBox query={query} setQuery={setQuery} view={view} />;
    case "widgets":
      return view.widgets.length ? (
        <section aria-label="Widgets" className="widget-grid mb-7">
          {view.widgets.map((w) => (
            <div key={w.id} data-w={w.w}>
              <WidgetCard widget={w} />
            </div>
          ))}
        </section>
      ) : null;
    case "favorites":
      return view.favorites.length ? (
        <TileSection title="Favourites" tiles={view.favorites} />
      ) : null;
    case "groups":
      return view.groups.some((g) => g.tiles.length) ? (
        view.groups
          .filter((g) => g.tiles.length)
          .map((g) => <TileSection key={g.id} title={g.name} tiles={g.tiles} />)
      ) : (
        <div className="card p-8 text-center text-muted">
          Nothing here yet. The admin adds tiles in Settings.
        </div>
      );
  }
}

function Hero({ view }: { view: HomeView }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);
  const { clock, greeting: showGreeting } = view.look;
  if (!showGreeting && clock === "off") return null;
  const time = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return (
    <section
      className={cx(
        "hero flex flex-wrap items-end justify-between gap-x-6 gap-y-1 pt-6 pb-5",
        clock === "big" && "max-sm:flex-col-reverse max-sm:items-start",
      )}
    >
      <div>
        {showGreeting ? (
          <h1 className="font-heading text-[clamp(28px,7vw,48px)] leading-[1.06] font-bold tracking-[-0.03em] text-balance">
            {greeting(view.profile?.name, now)}
          </h1>
        ) : null}
        <p className="mt-2 flex flex-wrap gap-x-2 text-[15px] text-muted">
          <span>
            {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </span>
          {clock === "small" ? <span>· {time}</span> : null}
          {view.homeName ? <span>· {view.homeName}</span> : null}
        </p>
      </div>
      {clock === "big" ? (
        <time className="font-heading text-[clamp(17px,6vw,60px)] font-light leading-none tracking-[-0.04em] text-muted tabular-nums max-sm:font-semibold max-sm:text-accent max-sm:tracking-normal">
          {time}
        </time>
      ) : null}
    </section>
  );
}

function SearchBox({
  query,
  setQuery,
  view,
}: {
  query: string;
  setQuery: (q: string) => void;
  view: HomeView;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        e.key === "/" &&
        !t.matches("input, textarea, select, [contenteditable]") &&
        !document.querySelector('[role="dialog"]')
      ) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const first = () =>
    search(
      view.groups.flatMap((g) => g.tiles.map((tile) => ({ tile, group: g.name }))),
      query,
    )[0];
  return (
    <label className="relative mb-7 flex items-center">
      <Search className="pointer-events-none absolute left-4 size-5 text-muted" aria-hidden />
      <input
        ref={ref}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const t = first();
            const newTab = e.ctrlKey || e.metaKey;
            if (t) {
              e.preventDefault();
              go(t.url, newTab || t.newTab);
            } else {
              const a = webActions(view, query)[0];
              if (a) {
                e.preventDefault();
                go(a.url, newTab);
              }
            }
          } else if (e.key === "Escape") setQuery("");
        }}
        placeholder="Search or jump to…"
        aria-label={
          view.webSearch ? "Search the home's services or the web" : "Search the home's services"
        }
        autoComplete="off"
        spellCheck={false}
        className="card h-13 w-full rounded-2xl! pr-12 pl-12 text-[16px] text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-4 focus:ring-(--c-accent-soft)"
      />
      <kbd className="pointer-events-none absolute right-4 hidden h-6 min-w-6 place-items-center rounded-md border border-(--c-line-strong) px-1.5 text-xs font-semibold text-muted [@media(hover:hover)]:grid">
        /
      </kbd>
    </label>
  );
}

function TileSection({
  title,
  tiles,
  first,
}: {
  title: string;
  tiles: ViewTile[];
  first?: boolean;
}) {
  return (
    <section className="mb-7">
      <h2 className="mx-0.5 mb-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">
        {title}
      </h2>
      <div className="tiles">
        {tiles.map((t, i) => (
          <Tile key={t.id} tile={t} first={first && i === 0} />
        ))}
      </div>
    </section>
  );
}

function Results({ results, query, view }: { results: ViewTile[]; query: string; view: HomeView }) {
  const actions = webActions(view, query);
  const web = actions.length ? (
    <div className="card mb-7 grid p-1.5">
      {actions.map((a, i) => (
        <WebActionRow key={a.id} action={a} active={!results.length && i === 0} />
      ))}
    </div>
  ) : null;
  if (!results.length) {
    return web ? (
      <>
        <p className="mx-0.5 mb-3 text-[13px] text-muted">
          Nothing called “{query.trim()}” here. Enter takes the first choice below.
        </p>
        {web}
      </>
    ) : (
      <div className="card p-8 text-center">
        <p className="font-semibold">Nothing called “{query.trim()}” here.</p>
        <p className="mt-1 text-sm text-muted">Try another word, or press Esc to see everything.</p>
      </div>
    );
  }
  return (
    <>
      <TileSection title="Results · Enter opens the first" tiles={results} first />
      {web}
    </>
  );
}

// ---------------------------------------------------------------------------
// Arranging the page

function EditBar({
  onDone,
  onCustomize,
  who,
}: {
  onDone: () => void;
  onCustomize: () => void;
  who: string;
}) {
  return (
    <div className="card sticky top-2 z-30 mt-3 mb-5 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <p className="text-sm">
        <b>Arranging {who}.</b>{" "}
        <span className="text-muted">Drag to reorder. Changes save as you go.</span>
      </p>
      <div className="flex gap-2">
        <Button size="sm" onClick={onCustomize}>
          <Palette className="size-4" /> Look
        </Button>
        <Button size="sm" variant="primary" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

function useSave() {
  const qc = useQueryClient();
  const toast = useToast();
  return async (path: string, body: unknown, optimistic?: (v: HomeView) => HomeView) => {
    if (optimistic) qc.setQueryData<HomeView>(keys.home, (v) => (v ? optimistic(v) : v));
    try {
      await api.put(path, body);
    } catch (e) {
      toast((e as Error).message, "bad");
    }
    await qc.invalidateQueries({ queryKey: keys.home });
  };
}

function useLayout(view: HomeView) {
  const save = useSave();
  const layout: LayoutDraft = {
    sections: view.sections,
    widgets: view.widgets.map((w) => ({ id: w.id, w: w.w })),
  };
  const saveLayout = (next: LayoutDraft) =>
    save("/api/me/layout", next, (v) => ({
      ...v,
      sections: next.sections,
      widgets: next.widgets.map((p) => ({
        ...(v.widgets.find((w) => w.id === p.id) ??
          (v.library.find((w) => w.id === p.id) as ViewWidget)),
        w: p.w,
      })),
    }));
  return { layout, saveLayout };
}

function EditableSections({ view }: { view: HomeView }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const { layout, saveLayout } = useLayout(view);

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = view.sections.map((s) => s.kind as string);
    const from = ids.indexOf(String(e.active.id));
    const to = ids.indexOf(String(e.over.id));
    if (from < 0 || to < 0) return;
    void saveLayout({ ...layout, sections: arrayMove(view.sections, from, to) });
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext
        items={view.sections.map((s) => s.kind)}
        strategy={verticalListSortingStrategy}
      >
        {view.sections.map((s) => (
          <SortableSection
            key={s.kind}
            id={s.kind}
            hidden={s.hidden}
            title={SECTION_NAMES[s.kind]}
            onToggle={() =>
              saveLayout({
                ...layout,
                sections: view.sections.map((x) =>
                  x.kind === s.kind ? { ...x, hidden: !x.hidden } : x,
                ),
              })
            }
          >
            {s.kind === "widgets" ? (
              <EditWidgets view={view} layout={layout} saveLayout={saveLayout} />
            ) : s.kind === "favorites" || s.kind === "groups" ? (
              <EditTiles view={view} kind={s.kind} />
            ) : (
              <Section kind={s.kind} view={view} query="" setQuery={() => {}} />
            )}
          </SortableSection>
        ))}
      </SortableContext>
    </DndContext>
  );
}

function SortableSection({
  id,
  title,
  hidden,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  hidden: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cx(
        "relative mb-4 rounded-[calc(var(--radius)+6px)] border-2 border-dashed border-line p-3",
        isDragging && "z-20 border-accent bg-page shadow-2xl",
        hidden && "opacity-55",
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="flex cursor-grab items-center gap-1.5 rounded-lg px-1.5 py-1 text-[13px] font-semibold text-muted hover:text-ink active:cursor-grabbing"
          aria-label={`Move ${title}`}
        >
          <GripVertical className="size-4" /> {title}
        </button>
        <IconButton label={hidden ? `Show ${title}` : `Hide ${title}`} onClick={onToggle}>
          {hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </IconButton>
      </div>
      {!hidden ? children : null}
    </div>
  );
}

type LayoutDraft = { sections: HomeView["sections"]; widgets: { id: string; w: number }[] };

function EditWidgets({
  view,
  layout,
  saveLayout,
}: {
  view: HomeView;
  layout: LayoutDraft;
  saveLayout: (l: LayoutDraft) => void;
}) {
  const [adding, setAdding] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const setWidgets = (widgets: LayoutDraft["widgets"]) => saveLayout({ ...layout, widgets });
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = layout.widgets.map((w) => w.id);
    setWidgets(
      arrayMove(layout.widgets, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))),
    );
  };
  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={view.widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
          <div className="widget-grid">
            {view.widgets.map((w) => (
              <SortableWidget
                key={w.id}
                widget={w}
                onWidth={() => {
                  const next =
                    WIDGET_WIDTHS[
                      (WIDGET_WIDTHS.indexOf(w.w as (typeof WIDGET_WIDTHS)[number]) + 1) %
                        WIDGET_WIDTHS.length
                    ] ?? 4;
                  setWidgets(layout.widgets.map((x) => (x.id === w.id ? { ...x, w: next } : x)));
                }}
                onRemove={() => setWidgets(layout.widgets.filter((x) => x.id !== w.id))}
              />
            ))}
            <div data-w="4">
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="grid h-full min-h-28 w-full place-items-center rounded-(--radius) border-2 border-dashed border-line text-muted transition hover:border-accent hover:text-accent"
              >
                <span className="flex items-center gap-2 font-semibold">
                  <Plus className="size-5" /> Add a widget
                </span>
              </button>
            </div>
          </div>
        </SortableContext>
      </DndContext>
      <Modal open={adding} onClose={() => setAdding(false)} title="Add a widget">
        {view.library.length === 0 ? (
          <p className="text-sm text-muted">
            Every widget is already on this page. The admin can make new ones in Widgets.
          </p>
        ) : (
          <ul className="grid gap-2">
            {view.library.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  className="card flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:border-accent"
                  onClick={() => {
                    setWidgets([...layout.widgets, { id: w.id, w: 4 }]);
                    setAdding(false);
                  }}
                >
                  <span className="grid">
                    <span className="font-semibold">{w.title ?? DEFAULT_TITLES[w.type]}</span>
                    <span className="text-[12.5px] text-muted">
                      {w.type === "custom"
                        ? "Custom widget"
                        : `Built in: ${DEFAULT_TITLES[w.type].toLowerCase()}`}
                    </span>
                  </span>
                  <Plus className="size-5 text-accent" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
}

function SortableWidget({
  widget,
  onWidth,
  onRemove,
}: {
  widget: ViewWidget;
  onWidth: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id,
  });
  return (
    <div
      ref={setNodeRef}
      data-w={widget.w}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cx(isDragging && "z-20 opacity-80")}
    >
      <WidgetCard
        widget={widget}
        actions={
          <>
            <button
              type="button"
              onClick={onWidth}
              className="h-7 rounded-full border border-line px-2 text-[11px] font-bold text-muted hover:text-ink"
              title="Change the width"
            >
              {widget.w}/12
            </button>
            <IconButton label="Remove from this page" onClick={onRemove} className="size-7">
              <X className="size-4" />
            </IconButton>
            <button
              type="button"
              {...attributes}
              {...listeners}
              aria-label="Move"
              className="grid size-7 cursor-grab place-items-center rounded-full text-muted hover:text-ink active:cursor-grabbing"
            >
              <GripVertical className="size-4" />
            </button>
          </>
        }
      />
    </div>
  );
}

function EditTiles({ view, kind }: { view: HomeView; kind: "favorites" | "groups" }) {
  const save = useSave();
  const { edit, modal } = useTileEditors(contextFromView(view));
  const admin = view.session.admin;
  const editOf = (t: ViewTile) =>
    t.canManage ? () => edit({ kind: "link", id: t.id }) : undefined;
  const favorites = view.favorites.map((t) => t.id);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const toggleFav = (id: string) =>
    save("/api/me/tiles", {
      favorites: favorites.includes(id) ? favorites.filter((x) => x !== id) : [...favorites, id],
    });
  const hide = (id: string) => save("/api/me/tiles", { hiddenTiles: [...hiddenNow(view), id] });

  if (!view.profile)
    return (
      <p className="text-sm text-muted">
        The guest page has no favourites. Pick a profile to choose some.
      </p>
    );

  if (kind === "favorites") {
    const onDragEnd = (e: DragEndEvent) => {
      if (!e.over || e.active.id === e.over.id) return;
      void save("/api/me/tiles", {
        favorites: arrayMove(
          favorites,
          favorites.indexOf(String(e.active.id)),
          favorites.indexOf(String(e.over.id)),
        ),
      });
    };
    return favorites.length ? (
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={favorites} strategy={rectSortingStrategy}>
          <div className="tiles">
            {view.favorites.map((t) => (
              <SortableTile key={t.id} tile={t} starred onStar={() => toggleFav(t.id)} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    ) : (
      <p className="text-sm text-muted">Star tiles below to put them here.</p>
    );
  }
  return (
    <>
      {view.groups.map((g) => {
        return (
          <section key={g.id} className="mb-5">
            <h3 className="mb-2 flex items-center justify-between gap-2 text-[13px] font-semibold uppercase tracking-wider text-muted">
              <span className="flex items-center gap-1.5">
                {g.name}
                {g.canManage ? (
                  <IconButton
                    label={`${g.name}: name, who sees it, delete`}
                    className="size-7"
                    onClick={() => edit({ kind: "section", id: g.id })}
                  >
                    <Pencil className="size-3.5" />
                  </IconButton>
                ) : null}
              </span>
              {g.canAdd ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => edit({ kind: "link", id: null, group: g.id })}
                >
                  <Plus className="size-4" /> Add a link
                </Button>
              ) : null}
            </h3>
            <div className="tiles">
              {g.tiles.map((t) => (
                <EditTile
                  key={t.id}
                  tile={t}
                  starred={favorites.includes(t.id)}
                  onStar={() => toggleFav(t.id)}
                  onHide={t.access.kind === "mine" ? undefined : () => hide(t.id)}
                  onEdit={editOf(t)}
                />
              ))}
            </div>
          </section>
        );
      })}
      <div className="flex flex-wrap gap-2">
        {admin || view.canAddOwn ? (
          <Button onClick={() => edit({ kind: "link", id: null })}>
            <Plus className="size-4" /> Add a link
          </Button>
        ) : null}
        {admin || view.canAddOwn ? (
          <Button onClick={() => edit({ kind: "section", id: null })}>
            <Plus className="size-4" /> New section
          </Button>
        ) : null}
      </div>
      <HiddenTiles view={view} />
      {!admin ? (
        <p className="mt-3 text-[12.5px] text-muted">
          The house's links are added by the admin. Your own sections and links are yours: only you
          see them.
        </p>
      ) : null}
      {modal}
    </>
  );
}

const hiddenNow = (view: HomeView) => view.hiddenTiles;

function HiddenTiles({ view }: { view: HomeView }) {
  const save = useSave();
  const hidden = hiddenNow(view);
  if (!hidden.length) return null;
  return (
    <p className="text-sm text-muted">
      {hidden.length} hidden tile{hidden.length === 1 ? "" : "s"}.{" "}
      <button
        type="button"
        className="font-semibold text-accent"
        onClick={() => save("/api/me/tiles", { hiddenTiles: [] })}
      >
        Show them again
      </button>
    </p>
  );
}

function EditTile({
  tile,
  starred,
  onStar,
  onHide,
  onEdit,
}: {
  tile: ViewTile;
  starred: boolean;
  onStar: () => void;
  onHide?: () => void;
  onEdit?: () => void;
}) {
  return (
    <Tile tile={tile} onClick={(e) => e.preventDefault()}>
      <span className="-mb-1 mt-auto flex justify-end gap-0.5 border-t border-line pt-1">
        {onEdit ? (
          <IconButton
            label={`Edit ${tile.name}`}
            onClick={(e) => {
              e.preventDefault();
              onEdit();
            }}
            className="size-8 bg-surface"
          >
            <Pencil className="size-4" />
          </IconButton>
        ) : null}
        <IconButton
          label={starred ? "Remove from favourites" : "Add to favourites"}
          onClick={(e) => {
            e.preventDefault();
            onStar();
          }}
          className="size-8 bg-surface"
        >
          <Star className={cx("size-4", starred && "fill-accent text-accent")} />
        </IconButton>
        {onHide ? (
          <IconButton
            label="Hide from my page"
            onClick={(e) => {
              e.preventDefault();
              onHide();
            }}
            className="size-8 bg-surface"
          >
            <EyeOff className="size-4" />
          </IconButton>
        ) : null}
      </span>
    </Tile>
  );
}

function SortableTile({
  tile,
  starred,
  onStar,
}: {
  tile: ViewTile;
  starred: boolean;
  onStar: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: tile.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className="cursor-grab active:cursor-grabbing"
    >
      <Tile tile={tile} onClick={(e) => e.preventDefault()}>
        <span className="-mb-1 mt-auto flex justify-end border-t border-line pt-1">
          <IconButton
            label="Remove from favourites"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onStar();
            }}
            className="size-8 bg-surface"
          >
            <Star className={cx("size-4", starred && "fill-accent text-accent")} />
          </IconButton>
        </span>
      </Tile>
    </div>
  );
}
