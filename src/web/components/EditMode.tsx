/**
 * Edit mode: the launcher itself becomes editable, and only while Edit is on, so nothing
 * moves by accident. Sections drag by their handle to reorder this person's page; links drag
 * within and between sections. The admin manages the house's sections and links; everyone
 * manages their own, stars, hides, orders their dock and widget rail, and adds widgets.
 */
import {
  type CollisionDetection,
  closestCenter,
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  type SortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Eye,
  EyeOff,
  GripVertical,
  LayoutGrid,
  Link2,
  Link2Off,
  Lock,
  Palette,
  Pencil,
  Plus,
  Radar,
  Settings2,
  Star,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { HomeView, PublicProfile, ViewGroup, ViewTile, ViewWidget } from "../../shared/api";
import type { SectionKind } from "../../shared/config";
import { api } from "../lib/api";
import {
  type BoardItem,
  boardItems,
  boardRuns,
  groupKey,
  itemWeight,
  linkTo,
  type Place,
  placeAt,
  runOf,
  unlink,
} from "../lib/board";
import { cx } from "../lib/format";
import { keys, useAdminConfig } from "../lib/queries";
import { WidgetSettings as WidgetSettingsWindow } from "../pages/WidgetsPage";
import { AdminSignIn } from "./AdminSignIn";
import { Masonry } from "./Masonry";
import { TileIcon } from "./Tile";
import { AccessBadge, type EditTarget } from "./TileEditors";
import { IconButton, Modal, useToast } from "./ui";
import { DEFAULT_TITLES, WidgetCard } from "./widgets/WidgetCard";

function useSave() {
  const qc = useQueryClient();
  const toast = useToast();
  return async (method: "put" | "del", path: string, body?: unknown, done?: string) => {
    try {
      if (method === "put") await api.put(path, body);
      else await api.del(path);
      if (done) toast(done);
    } catch (e) {
      toast((e as Error).message, "bad");
    }
    await qc.invalidateQueries({ queryKey: keys.home });
  };
}

// ---------------------------------------------------------------------------
// The bar at the top while editing

const SHOW: { kind: SectionKind; label: string }[] = [
  { kind: "hero", label: "Greeting" },
  { kind: "search", label: "Search" },
  { kind: "favorites", label: "Favourites" },
  { kind: "widgets", label: "Widgets" },
  { kind: "groups", label: "Sections" },
];

export function EditBar({
  view,
  edit,
  onWidgets,
  onFind,
  onLook,
  onDone,
}: {
  view: HomeView;
  edit: (t: EditTarget) => void;
  onWidgets: () => void;
  onFind: () => void;
  onLook: () => void;
  onDone: () => void;
}) {
  const save = useSave();
  const admin = view.session.admin;
  const canAdd = admin || view.canAddOwn;
  const [signIn, setSignIn] = useState(false);
  // The house's sections and links are the admin's to change. Say so, or they just look
  // like they're missing their buttons.
  const houseLocked =
    !admin && view.groups.some((g) => !g.canManage || g.tiles.some((t) => !t.canManage));
  const toggle = (kind: SectionKind) =>
    save("put", "/api/me/layout", {
      sections: view.sections.map((s) => (s.kind === kind ? { ...s, hidden: !s.hidden } : s)),
      widgets: view.widgets.map((w) => ({ id: w.id, w: w.w })),
    });
  const btn =
    "flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[13px] font-semibold hover:border-accent";
  return (
    <div className="card my-3 grid gap-2 border-accent/50 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-[13.5px]">
          <b>Editing {view.profile ? `${view.profile.name}'s page` : "the guest page"}.</b>{" "}
          <span className="text-muted">
            Drag a section by its title, or a link by its handle. Changes save as you go.
          </span>
        </p>
        {canAdd ? (
          <button type="button" className={btn} onClick={() => edit({ kind: "link", id: null })}>
            <Plus className="size-4" /> Link
          </button>
        ) : null}
        {canAdd ? (
          <button type="button" className={btn} onClick={() => edit({ kind: "section", id: null })}>
            <Plus className="size-4" /> Section
          </button>
        ) : null}
        {admin ? (
          <button type="button" className={btn} onClick={onFind}>
            <Radar className="size-4" /> Find services
          </button>
        ) : null}
        <button type="button" className={btn} onClick={onWidgets}>
          <LayoutGrid className="size-4" /> Add a widget
        </button>
        <button type="button" className={btn} onClick={onLook}>
          <Palette className="size-4" /> Look
        </button>
        <button
          type="button"
          onClick={onDone}
          className="flex h-8 items-center gap-1.5 rounded-full bg-accent px-4 text-[13px] font-bold text-white"
        >
          <Check className="size-4" /> Done
        </button>
      </div>
      {houseLocked ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-(--c-surface-2) px-2.5 py-1.5 text-[12.5px]">
          <Lock className="size-3.5 flex-none text-muted" />
          <span className="text-muted">
            Sections and links without a settings or edit button are the house's
            {view.profile?.role === "admin"
              ? ". Sign in as the admin to change them."
              : ": only the admin changes them. Yours you can change."}
          </span>
          {view.profile?.role === "admin" ? (
            <button
              type="button"
              onClick={() => setSignIn(true)}
              className="font-semibold text-accent"
            >
              Sign in as the admin
            </button>
          ) : null}
        </p>
      ) : null}
      <AdminSignIn
        open={signIn}
        needsSetup={view.session.needsSetup}
        onClose={() => setSignIn(false)}
      />
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <span className="font-semibold text-muted">Show:</span>
        {SHOW.map(({ kind, label }) => {
          const on = !view.sections.find((s) => s.kind === kind)?.hidden;
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(kind)}
              className={cx(
                "flex h-7 items-center gap-1 rounded-full border px-2.5 font-semibold",
                on ? "border-accent/60 bg-accent/10" : "border-line text-muted",
              )}
            >
              {on ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />} {label}
            </button>
          );
        })}
        {view.hiddenTiles.length ? (
          <button
            type="button"
            onClick={() =>
              save("put", "/api/me/tiles", { hiddenTiles: [] }, "Hidden links are back")
            }
            className="ml-2 font-semibold text-accent"
          >
            Show {view.hiddenTiles.length} hidden link{view.hiddenTiles.length === 1 ? "" : "s"}
          </button>
        ) : null}
        {view.hiddenGroups.length ? (
          <button
            type="button"
            onClick={() =>
              save("put", "/api/me/tiles", { hiddenGroups: [] }, "Hidden sections are back")
            }
            className="ml-2 font-semibold text-accent"
          >
            Show {view.hiddenGroups.length} hidden section
            {view.hiddenGroups.length === 1 ? "" : "s"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The launcher while editing

const SECTION = "section:";
const WIDGET = "widget:";
const ZONE = "drop:";
/** A run of linked items, carried whole by its own handle: "run:<first key>". */
const RUN = "run:";

/** A section, widget or run (a block on the page), as opposed to a link. */
const isBlock = (id: string) =>
  id.startsWith(SECTION) || id.startsWith(WIDGET) || id.startsWith(RUN);
/** The drag id of a board item, and back. */
const dragIdOf = (key: string) =>
  key.startsWith("w:") ? WIDGET + key.slice(2) : SECTION + key.slice(2);
const keyOfDrag = (id: string) =>
  id.startsWith(RUN)
    ? id.slice(RUN.length)
    : id.startsWith(WIDGET)
      ? `w:${id.slice(WIDGET.length)}`
      : `g:${id.slice(SECTION.length)}`;

/** A dragged section or widget only lands on those; a dragged link only on links and lists. */
/** Sections and widgets don't move aside while one is carried: a line shows where it goes. */
const STAY: SortingStrategy = () => null;

const collision: CollisionDetection = (args) => {
  const block = isBlock(String(args.active.id));
  // A run's box isn't a place to land: the items in it are.
  const droppableContainers = args.droppableContainers.filter(
    (c) => isBlock(String(c.id)) === block && !String(c.id).startsWith(RUN),
  );
  if (!block) return closestCorners({ ...args, droppableContainers });
  // A section or widget lands by what the pointer is over; between them, the nearest.
  const under = pointerWithin({ ...args, droppableContainers });
  return under.length ? under : closestCenter({ ...args, droppableContainers });
};

export function EditLauncher({
  view,
  edit,
  mixed,
}: {
  view: HomeView;
  edit: (t: EditTarget) => void;
  /** Widgets are mixed in with the sections: move both in one order. */
  mixed?: boolean;
}) {
  const save = useSave();
  const admin = view.session.admin;
  const initial = useMemo(
    () =>
      Object.fromEntries(view.groups.map((g) => [g.id, g.tiles.map((t) => t.id)])) as Record<
        string,
        string[]
      >,
    [view.groups],
  );
  const [cols, setCols] = useState(initial);
  useEffect(() => setCols(initial), [initial]);
  /** Board keys ("g:<section>", "w:<widget>"): sections only, unless widgets are mixed in. */
  const initialOrder = useMemo(
    () =>
      mixed
        ? boardItems(view.groups, view.widgets, view.board).map((i) => i.key)
        : view.groups.map((g) => groupKey(g.id)),
    [mixed, view.groups, view.widgets, view.board],
  );
  const [order, setOrder] = useState(initialOrder);
  useEffect(() => setOrder(initialOrder), [initialOrder]);
  /** Board keys linked to the one before them (only when widgets are mixed in). */
  const [joined, setJoined] = useState(view.joined);
  useEffect(() => setJoined(view.joined), [view.joined]);
  const [linking, setLinking] = useState<string | null>(null);
  /** Save a new order (and links): the sections' order too, when it changed. */
  const commit = (next: string[], nextJoined: string[]) => {
    setOrder(next);
    setJoined(nextJoined);
    const groups = next.filter((k) => k.startsWith("g:")).map((k) => k.slice(2));
    if (JSON.stringify(groups) !== JSON.stringify(view.groups.map((g) => g.id)))
      void save("put", "/api/me/tiles", { groupOrder: groups });
    if (mixed)
      void save("put", "/api/me/layout", {
        sections: view.sections,
        widgets: view.widgets.map((w) => ({ id: w.id, w: w.w })),
        board: next,
        joined: nextJoined,
      });
  };
  const widgetById = useMemo(() => new Map(view.widgets.map((w) => [w.id, w])), [view.widgets]);
  const byId = useMemo(
    () => new Map(view.groups.flatMap((g) => g.tiles).map((t) => [t.id, t])),
    [view.groups],
  );
  const groupById = useMemo(() => new Map(view.groups.map((g) => [g.id, g])), [view.groups]);
  const [active, setActive] = useState<string | null>(null);
  const favorites = view.favorites.map((t) => t.id);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const groupOf = (id: string) =>
    id.startsWith(ZONE)
      ? id.slice(ZONE.length)
      : Object.keys(cols).find((g) => cols[g]?.includes(id));
  /** Where a link may go: your own anywhere you can add; the house's only in the house's (admin). */
  const mayGo = (tileId: string, gid: string) => {
    const t = byId.get(tileId);
    const g = groupById.get(gid);
    if (!t?.canManage || !g) return false;
    const mine = t.access.kind === "mine";
    if (g.access.kind === "mine") return mine;
    return mine ? g.canAdd : admin;
  };

  /** Where a section, widget or run being moved would land: before, after, or with another. */
  const [dropAt, setDropAt] = useState<{ key: string; side: Place } | null>(null);
  /** What a drag carries: one item, or a whole run by its handle. */
  const carried = (id: string) =>
    id.startsWith(RUN) ? runOf(order, joined, keyOfDrag(id)) : [keyOfDrag(id)];
  const onStart = (e: DragStartEvent) => setActive(String(e.active.id));
  /**
   * The pointer's place on the item under it decides: its top edge puts it before, its bottom
   * edge after, and its middle keeps the two together (when widgets are mixed in).
   */
  const onMove = (e: DragMoveEvent) => {
    const id = String(e.active.id);
    if (!isBlock(id)) return;
    const target = e.over ? keyOfDrag(String(e.over.id)) : null;
    if (!e.over || !target || carried(id).includes(target)) {
      if (dropAt) setDropAt(null);
      return;
    }
    const pointer = e.activatorEvent as PointerEvent;
    const moved = e.active.rect.current.translated;
    const y =
      typeof pointer.clientY === "number"
        ? pointer.clientY + e.delta.y
        : moved
          ? moved.top + moved.height / 2
          : e.over.rect.top;
    const at = (y - e.over.rect.top) / Math.max(1, e.over.rect.height);
    const side: Place = mixed
      ? at < 0.28
        ? "before"
        : at > 0.72
          ? "after"
          : "join"
      : at < 0.5
        ? "before"
        : "after";
    if (dropAt?.key !== target || dropAt.side !== side) setDropAt({ key: target, side });
  };
  const onOver = (e: DragOverEvent) => {
    const id = String(e.active.id);
    if (isBlock(id)) return;
    if (!e.over) return;
    const from = groupOf(id);
    const to = groupOf(String(e.over.id));
    if (!from || !to || from === to || !mayGo(id, to)) return;
    setCols((c) => {
      const source = (c[from] ?? []).filter((x) => x !== id);
      const target = [...(c[to] ?? [])];
      const at = target.indexOf(String(e.over?.id));
      target.splice(at === -1 ? target.length : at, 0, id);
      return { ...c, [from]: source, [to]: target };
    });
  };
  const onEnd = (e: DragEndEvent) => {
    const id = String(e.active.id);
    setActive(null);
    setDropAt(null);
    if (isBlock(id)) {
      if (!dropAt || !e.over) return;
      const r = mixed
        ? placeAt(order, joined, carried(id), dropAt.key, dropAt.side)
        : {
            order: placeAt(
              order,
              [],
              carried(id),
              dropAt.key,
              dropAt.side === "join" ? "after" : dropAt.side,
            ).order,
            joined,
          };
      if (
        JSON.stringify(r.order) !== JSON.stringify(order) ||
        JSON.stringify([...r.joined].sort()) !== JSON.stringify([...joined].sort())
      )
        commit(r.order, r.joined);
      return;
    }
    const g = groupOf(id);
    let next = cols;
    if (g && e.over && groupOf(String(e.over.id)) === g && e.over.id !== id) {
      const list = cols[g] ?? [];
      const to = list.indexOf(String(e.over.id));
      if (to !== -1) next = { ...cols, [g]: arrayMove(list, list.indexOf(id), to) };
      setCols(next);
    }
    if (JSON.stringify(next) !== JSON.stringify(initial))
      void save("put", "/api/tiles-layout", { groups: next });
  };

  const toggleFav = (id: string) =>
    save("put", "/api/me/tiles", {
      favorites: favorites.includes(id) ? favorites.filter((x) => x !== id) : [...favorites, id],
    });

  const items = order
    .map((k): BoardItem | null => {
      const id = k.slice(2);
      if (k.startsWith("w:")) {
        const widget = widgetById.get(id);
        return widget ? { key: k, kind: "widget", widget } : null;
      }
      const group = groupById.get(id);
      return group ? { key: k, kind: "group", group } : null;
    })
    .filter((x): x is BoardItem => !!x);
  const runs = (mixed ? boardRuns(items, joined) : items.map((i) => [i])).map((r) =>
    r.map((i) => i.key),
  );
  const runItems = mixed ? boardRuns(items, joined) : items.map((i) => [i]);
  const nameOf = (i: BoardItem) =>
    i.kind === "group" ? i.group.name : (i.widget.title ?? DEFAULT_TITLES[i.widget.type]);
  const linkButton = (key: string, name: string) => {
    if (!mixed) return undefined;
    const run = runs.find((r) => r.includes(key)) ?? [];
    const held = run.indexOf(key) > 0;
    return held ? (
      <IconButton
        label={`Let ${name} go its own way`}
        title="Linked to the one above: press to unlink"
        className="size-7 text-accent"
        onClick={() => commit(order, unlink(joined, key))}
      >
        <Link2Off className="size-3.5" />
      </IconButton>
    ) : (
      <IconButton
        label={`Keep ${name} next to…`}
        className="size-7"
        onClick={() => setLinking(key)}
      >
        <Link2 className="size-3.5" />
      </IconButton>
    );
  };
  const activeSection = active?.startsWith(SECTION)
    ? groupById.get(active.slice(SECTION.length))
    : undefined;
  const activeWidget = active?.startsWith(WIDGET)
    ? widgetById.get(active.slice(WIDGET.length))
    : undefined;
  const activeRun = active?.startsWith(RUN)
    ? items.filter((i) => carried(active).includes(i.key))
    : undefined;
  // Everything keeps its size while a section or widget moves; a line shows where it lands.
  const folded = false;
  const activeTile = active && !folded ? byId.get(active) : undefined;
  const removeWidget = (id: string) =>
    save("put", "/api/me/layout", {
      sections: view.sections,
      widgets: view.widgets.filter((w) => w.id !== id).map((w) => ({ id: w.id, w: w.w })),
      board: order.filter((k) => k !== `w:${id}`),
    });

  const hintFor = (key: string) => (dropAt?.key === key ? dropAt.side : undefined);
  const render = (g: ViewGroup) => (
    <EditSection
      key={g.id}
      group={g}
      hint={hintFor(groupKey(g.id))}
      tiles={(cols[g.id] ?? [])
        .map((id) => byId.get(id))
        .filter((t): t is ViewTile => t !== undefined)}
      people={view.profiles}
      canStar={view.profile !== null}
      favorites={favorites}
      folded={folded}
      dropOk={activeTile ? mayGo(activeTile.id, g.id) : true}
      edit={edit}
      onHide={() =>
        save(
          "put",
          "/api/me/tiles",
          { hiddenGroups: [...view.hiddenGroups, g.id] },
          `${g.name} is hidden from your page`,
        )
      }
      onHideTile={(id) => save("put", "/api/me/tiles", { hiddenTiles: [...view.hiddenTiles, id] })}
      onStar={toggleFav}
      link={linkButton(groupKey(g.id), g.name)}
    />
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onStart}
      onDragMove={onMove}
      onDragOver={onOver}
      onDragEnd={onEnd}
      onDragCancel={() => {
        setActive(null);
        setDropAt(null);
        setCols(initial);
      }}
      // Sections fold up when one is picked up, so measure where they are as they move.
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
    >
      <SortableContext
        items={[
          ...order.map(dragIdOf),
          ...runItems.filter((r) => r.length > 1).map((r) => RUN + r[0]?.key),
        ]}
        strategy={STAY}
      >
        {items.length ? (
          <Masonry
            items={runItems}
            minWidth={mixed ? 280 : 240}
            weight={(run) =>
              run.reduce((n, i) => n + itemWeight(i, (g) => g.tiles.length + 1.5), 0)
            }
            render={(run) => {
              const one = (i: BoardItem) =>
                i.kind === "group" ? (
                  render(i.group)
                ) : (
                  <EditWidget
                    key={i.key}
                    widget={i.widget}
                    hint={hintFor(i.key)}
                    folded={folded}
                    onRemove={() => removeWidget(i.widget.id)}
                    link={linkButton(i.key, nameOf(i))}
                    admin={admin}
                  />
                );
              return run.length === 1 ? (
                one(run[0] as BoardItem)
              ) : (
                <RunBox key={run[0]?.key} id={RUN + run[0]?.key} names={run.map(nameOf)}>
                  {run.map(one)}
                </RunBox>
              );
            }}
          />
        ) : (
          <p className="card p-6 text-center text-muted">
            No sections yet. {admin || view.canAddOwn ? "Add one with + Section" : ""}
            {admin ? ", or let Hearth find your services." : "."}
          </p>
        )}
      </SortableContext>
      {linking ? (
        <LinkPicker
          name={nameOf(items.find((i) => i.key === linking) as BoardItem)}
          choices={runItems
            .filter((r) => !r.some((i) => i.key === linking))
            .map((r) => ({
              key: r.at(-1)?.key as string,
              label: r.map(nameOf).join(" + "),
              kind: r.length > 1 ? "together" : (r[0]?.kind ?? "group"),
            }))}
          onPick={(target) => {
            const r = linkTo(order, joined, linking, target);
            commit(r.order, r.joined);
            setLinking(null);
          }}
          onClose={() => setLinking(null)}
        />
      ) : null}
      <DragOverlay>
        {activeRun?.length ? (
          <div className="card flex h-10 items-center gap-2 px-3 text-[11.5px] font-bold uppercase tracking-[0.09em] shadow-2xl">
            <Link2 className="size-4 text-accent" />
            <span className="truncate">{activeRun.map(nameOf).join(" + ")}</span>
          </div>
        ) : null}
        {activeTile ? <Row tile={activeTile} people={view.profiles} overlay /> : null}
        {activeSection ? (
          <div className="card flex h-10 items-center gap-2 px-3 text-[11.5px] font-bold uppercase tracking-[0.09em] shadow-2xl">
            <GripVertical className="size-4 text-muted" /> {activeSection.name}
            <span className="ml-auto font-semibold text-muted">{activeSection.tiles.length}</span>
          </div>
        ) : null}
        {activeWidget ? (
          <div className="card flex h-10 items-center gap-2 px-3 text-[11.5px] font-bold uppercase tracking-[0.09em] shadow-2xl">
            <GripVertical className="size-4 text-muted" /> {activeWidget.title ?? "Widget"}
            <span className="ml-auto font-semibold normal-case tracking-normal text-muted">
              widget
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** A widget's settings (the admin's): its name, who sees it, its options, and its designer. */
function WidgetSettings({ widget }: { widget: ViewWidget }) {
  const config = useAdminConfig();
  const [open, setOpen] = useState(false);
  const full = config.data?.config.widgets.find((w) => w.id === widget.id);
  const name = widget.title ?? DEFAULT_TITLES[widget.type];
  return (
    <>
      <IconButton
        label={`${name}: settings`}
        className="size-7"
        disabled={!full}
        onClick={() => setOpen(true)}
      >
        <Settings2 className="size-3.5" />
      </IconButton>
      {open && full ? (
        <WidgetSettingsWindow
          widget={full}
          onClose={() => setOpen(false)}
          taken={(config.data?.config.widgets ?? []).map((w) => w.id)}
        />
      ) : null}
    </>
  );
}

/** Pick what a section or widget stays next to. */
function LinkPicker({
  name,
  choices,
  onPick,
  onClose,
}: {
  name: string;
  choices: { key: string; label: string; kind: "group" | "widget" | "together" }[];
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const shown = choices.filter((c) => c.label.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Modal open onClose={onClose} title={`Keep ${name} next to…`}>
      <div className="grid gap-3">
        <p className="text-[13px] text-muted">
          They'll move as one and stay together on every screen, a phone too. Unlink them any time
          with the same button.
        </p>
        <input
          aria-label="Find a section or widget"
          placeholder="Find a section or widget"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-10 rounded-xl border border-line bg-surface px-3 text-[14px]"
        />
        <ul className="grid max-h-[50vh] gap-1 overflow-y-auto">
          {shown.map((c) => (
            <li key={c.key}>
              <button
                type="button"
                onClick={() => onPick(c.key)}
                className="flex w-full items-center gap-2 rounded-xl border border-line px-3 py-2 text-left hover:border-accent"
              >
                {c.kind === "together" ? (
                  <Link2 className="size-4 flex-none text-accent" />
                ) : c.kind === "widget" ? (
                  <LayoutGrid className="size-4 flex-none text-muted" />
                ) : (
                  <Settings2 className="size-4 flex-none text-muted" />
                )}
                <span className="truncate font-semibold">{c.label}</span>
                <span className="ml-auto flex-none text-[12px] text-muted">
                  {c.kind === "together" ? "linked" : c.kind === "widget" ? "widget" : "section"}
                </span>
              </button>
            </li>
          ))}
          {shown.length ? null : (
            <li className="px-1 text-[13px] text-muted">Nothing called that.</li>
          )}
        </ul>
      </div>
    </Modal>
  );
}

/** A run of linked items: a dashed box, carried whole by the handle on its edge. */
function RunBox({
  id,
  names,
  children,
}: {
  id: string;
  names: string[];
  children: React.ReactNode;
}) {
  const sortable = useSortable({ id });
  return (
    <div
      ref={sortable.setNodeRef}
      className={cx(
        "relative mb-(--gap) rounded-2xl outline-2 outline-offset-4 outline-accent/45 outline-dashed transition-opacity [&>*:last-child]:mb-0",
        sortable.isDragging && "opacity-35",
      )}
    >
      <button
        type="button"
        ref={sortable.setActivatorNodeRef}
        {...sortable.listeners}
        {...sortable.attributes}
        aria-label={`Move ${names.join(" + ")} together`}
        title="Drag to move these together"
        className="absolute -top-3.5 left-1/2 z-10 flex h-5 -translate-x-1/2 cursor-grab touch-none items-center gap-1 rounded-full border border-accent/50 bg-(--c-surface) px-2 text-[10.5px] font-bold uppercase tracking-[0.08em] text-accent active:cursor-grabbing"
      >
        <GripVertical className="size-3" /> Together
      </button>
      {children}
    </div>
  );
}

/**
 * Where a section or widget being carried will land: a bright line above or below this one, or
 * "keep together" over its middle.
 */
function DropLine({ hint }: { hint?: Place }) {
  if (!hint) return null;
  if (hint === "join")
    return (
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-(--radius) bg-accent/10 ring-2 ring-accent"
      >
        <span className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-[12px] font-semibold text-white shadow-lg">
          <Link2 className="size-3.5" /> Keep together
        </span>
      </span>
    );
  return (
    <span
      aria-hidden
      className={cx(
        "pointer-events-none absolute inset-x-1 z-10 h-1 rounded-full bg-accent shadow-[0_0_0_3px_var(--c-accent-soft)]",
        hint === "before"
          ? "-top-[calc(var(--gap)/2_+_2px)]"
          : "-bottom-[calc(var(--gap)/2_+_2px)]",
      )}
    />
  );
}

/** A widget among the sections: drag it by its handle; while anything moves, only its title shows. */
function EditWidget({
  widget,
  folded,
  hint,
  onRemove,
  link,
  admin,
}: {
  widget: ViewWidget;
  folded: boolean;
  hint?: Place;
  onRemove: () => void;
  /** Keep it next to another, or let it go (widgets mixed in with the sections). */
  link?: React.ReactNode;
  /** The admin may change the widget itself. */
  admin?: boolean;
}) {
  const sortable = useSortable({ id: WIDGET + widget.id });
  return (
    <div
      ref={sortable.setNodeRef}
      className={cx("relative mb-(--gap) transition-opacity", sortable.isDragging && "opacity-35")}
    >
      <DropLine hint={hint} />
      {folded ? (
        <div
          {...sortable.listeners}
          {...sortable.attributes}
          className="card flex h-10 cursor-grab items-center gap-2 px-3 text-[11.5px] font-bold uppercase tracking-[0.09em] text-muted"
        >
          <GripVertical className="size-4" /> {widget.title ?? "Widget"}
        </div>
      ) : (
        <WidgetCard
          widget={widget}
          actions={
            <>
              {admin ? <WidgetSettings widget={widget} /> : null}
              {link}
              <IconButton label="Take off this page" className="size-7" onClick={onRemove}>
                <X className="size-4" />
              </IconButton>
              <button
                type="button"
                aria-label={`Move ${widget.title ?? "this widget"}`}
                ref={sortable.setActivatorNodeRef}
                {...sortable.listeners}
                {...sortable.attributes}
                className="grid size-7 cursor-grab touch-none place-items-center rounded-full text-muted hover:text-ink active:cursor-grabbing"
              >
                <GripVertical className="size-4" />
              </button>
            </>
          }
        />
      )}
    </div>
  );
}

function EditSection(props: {
  group: ViewGroup;
  tiles: ViewTile[];
  people: PublicProfile[];
  canStar: boolean;
  favorites: string[];
  /** A section is being moved: show only the title bars. */
  folded: boolean;
  /** The link being dragged may come here. */
  dropOk: boolean;
  /** A section or widget being moved would land just before or after this one. */
  hint?: Place;
  edit: (t: EditTarget) => void;
  onHide: () => void;
  onHideTile: (id: string) => void;
  onStar: (id: string) => void;
  /** Keep it next to another, or let it go (widgets mixed in with the sections). */
  link?: React.ReactNode;
}) {
  const { group, tiles, edit, people } = props;
  const sortable = useSortable({ id: SECTION + group.id });
  const zone = useDroppable({ id: ZONE + group.id, disabled: !props.dropOk });
  const sameAccess = (t: ViewTile) => JSON.stringify(t.access) === JSON.stringify(group.access);
  return (
    <section
      ref={sortable.setNodeRef}
      className={cx(
        "card launcher-group relative mb-(--gap) p-2 transition-opacity",
        zone.isOver && props.dropOk && "ring-2 ring-accent",
        // The one being carried stays where it was, faded, until it's dropped.
        sortable.isDragging && "opacity-35",
      )}
    >
      <DropLine hint={props.hint} />
      {/* The whole title bar picks the section up; the handle is also how keys move it. The
          name keeps its width; the controls wrap under it when the column is narrow. */}
      <header
        {...sortable.listeners}
        className={cx(
          "flex min-h-8 cursor-grab touch-none flex-wrap items-center gap-x-0.5 active:cursor-grabbing",
          !props.folded && "pb-1",
        )}
      >
        <button
          type="button"
          ref={sortable.setActivatorNodeRef}
          aria-label={`Move the ${group.name} section`}
          title="Drag to move this section"
          {...sortable.attributes}
          className="grid size-7 flex-none cursor-grab place-items-center rounded-lg text-muted hover:text-ink active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </button>
        <h3 className="flex min-w-28 grow basis-0 items-center gap-1.5 truncate text-[11.5px] font-bold uppercase tracking-[0.09em] text-muted">
          <span className="truncate">{group.name}</span>
          <AccessBadge access={group.access} people={people} compact />
          {props.folded ? (
            <span className="ml-auto font-semibold normal-case tracking-normal">
              {tiles.length}
            </span>
          ) : null}
        </h3>
        <div className={cx("ml-auto flex items-center gap-0.5", props.folded && "hidden")}>
          {group.canAdd ? (
            <IconButton
              label={`Add a link to ${group.name}`}
              className="size-7 text-accent"
              onClick={() => edit({ kind: "link", id: null, group: group.id })}
            >
              <Plus className="size-4" />
            </IconButton>
          ) : null}
          {group.canManage ? (
            <IconButton
              label={`${group.name}: name, who sees it, delete`}
              className="size-7"
              onClick={() => edit({ kind: "section", id: group.id })}
            >
              <Settings2 className="size-3.5" />
            </IconButton>
          ) : null}
          {props.link}
          <IconButton
            label={`Hide ${group.name} from my page`}
            className="size-7"
            onClick={props.onHide}
          >
            <EyeOff className="size-3.5" />
          </IconButton>
        </div>
      </header>
      <SortableContext
        id={group.id}
        items={tiles.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul ref={zone.setNodeRef} className={cx("min-h-10", props.folded && "hidden")}>
          {tiles.map((t) => (
            <SortableRow
              key={t.id}
              tile={t}
              people={people}
              badge={!sameAccess(t)}
              starred={props.favorites.includes(t.id)}
              onStar={props.canStar ? () => props.onStar(t.id) : undefined}
              onEdit={t.canManage ? () => edit({ kind: "link", id: t.id }) : undefined}
              onHide={t.access.kind === "mine" ? undefined : () => props.onHideTile(t.id)}
            />
          ))}
          {tiles.length === 0 ? (
            <li className="grid h-10 place-items-center rounded-lg border border-dashed border-line text-[12px] text-muted">
              {group.canAdd ? "Empty: drop links here, or press +" : "Empty"}
            </li>
          ) : null}
        </ul>
      </SortableContext>
    </section>
  );
}

function SortableRow({
  tile,
  people,
  badge,
  starred,
  onStar,
  onEdit,
  onHide,
}: {
  tile: ViewTile;
  people: PublicProfile[];
  badge: boolean;
  starred: boolean;
  onStar?: () => void;
  onEdit?: () => void;
  onHide?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tile.id,
    disabled: !tile.canManage,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cx(isDragging && "opacity-30")}
    >
      <Row
        tile={tile}
        people={people}
        badge={badge}
        handle={tile.canManage ? { ...attributes, ...listeners } : undefined}
        starred={starred}
        onStar={onStar}
        onEdit={onEdit}
        onHide={onHide}
      />
    </li>
  );
}

function Row({
  tile,
  people,
  badge,
  handle,
  overlay,
  starred,
  onStar,
  onEdit,
  onHide,
}: {
  tile: ViewTile;
  people: PublicProfile[];
  badge?: boolean;
  handle?: Record<string, unknown>;
  overlay?: boolean;
  starred?: boolean;
  onStar?: () => void;
  onEdit?: () => void;
  onHide?: () => void;
}) {
  return (
    <div
      className={cx(
        "flex h-10 items-center gap-1.5 rounded-xl px-1 transition hover:bg-(--c-surface-2)",
        overlay && "card shadow-2xl",
      )}
      style={tile.color ? ({ "--tile": tile.color } as React.CSSProperties) : undefined}
    >
      {handle ? (
        <button
          type="button"
          aria-label={`Move ${tile.name}`}
          {...handle}
          className="grid size-7 flex-none cursor-grab touch-none place-items-center rounded-lg text-muted hover:text-ink active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </button>
      ) : (
        <span className="w-1" />
      )}
      <span className="row-icon">
        <TileIcon tile={tile} />
      </span>
      <span className="min-w-0 grow truncate text-[14px] font-semibold">{tile.name}</span>
      {badge ? <AccessBadge access={tile.access} people={people} compact /> : null}
      {onStar ? (
        <IconButton
          label={starred ? "Take out of favourites" : "Add to favourites"}
          className="size-7"
          onClick={onStar}
        >
          <Star className={cx("size-3.5", starred && "fill-accent text-accent")} />
        </IconButton>
      ) : null}
      {onEdit ? (
        <IconButton label={`Edit ${tile.name}`} className="size-7" onClick={onEdit}>
          <Pencil className="size-3.5" />
        </IconButton>
      ) : null}
      {onHide ? (
        <IconButton label="Hide from my page" className="size-7" onClick={onHide}>
          <EyeOff className="size-3.5" />
        </IconButton>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The dock and the widget rail while editing

export function EditDock({ view }: { view: HomeView }) {
  const save = useSave();
  const ids = view.favorites.map((t) => t.id);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  if (!view.profile) return null;
  return (
    <div className="card mb-(--gap) p-1.5">
      <p className="px-2 pt-1 text-[11.5px] font-bold uppercase tracking-[0.09em] text-muted">
        Favourites · drag to order · keys 1 to 9 open them
      </p>
      {ids.length ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragEnd={(e) => {
            if (!e.over || e.over.id === e.active.id) return;
            void save("put", "/api/me/tiles", {
              favorites: arrayMove(
                ids,
                ids.indexOf(String(e.active.id)),
                ids.indexOf(String(e.over.id)),
              ),
            });
          }}
        >
          <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
            <div className="flex gap-1 overflow-x-auto">
              {view.favorites.map((t) => (
                <DockItem
                  key={t.id}
                  tile={t}
                  onRemove={() =>
                    save("put", "/api/me/tiles", { favorites: ids.filter((x) => x !== t.id) })
                  }
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <p className="px-2 py-3 text-[13px] text-muted">Star tiles below to put them here.</p>
      )}
    </div>
  );
}

function DockItem({ tile, onRemove }: { tile: ViewTile; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tile.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={
        {
          transform: CSS.Transform.toString(transform),
          transition,
          ...(tile.color ? { "--tile": tile.color } : {}),
        } as React.CSSProperties
      }
      className={cx(
        "dock-item relative flex w-21 flex-none cursor-grab touch-none flex-col items-center gap-1.5 rounded-2xl px-1 py-2 text-center active:cursor-grabbing",
        isDragging && "z-10 opacity-70",
      )}
      {...attributes}
      {...listeners}
    >
      <TileIcon tile={tile} />
      <span className="w-full truncate text-[12.5px] font-semibold">{tile.name}</span>
      <button
        type="button"
        aria-label={`Take ${tile.name} out of favourites`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onRemove}
        className="absolute top-0.5 right-1 grid size-5 place-items-center rounded-full bg-surface text-muted shadow ring-1 ring-line hover:text-bad"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

export function EditRail({ view, onAdd }: { view: HomeView; onAdd: () => void }) {
  const save = useSave();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const placements = view.widgets.map((w) => ({ id: w.id, w: w.w }));
  const put = (widgets: typeof placements) =>
    save("put", "/api/me/layout", { sections: view.sections, widgets });
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-(--gap)">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragEnd={(e) => {
          if (!e.over || e.over.id === e.active.id) return;
          const ids = placements.map((p) => p.id);
          void put(
            arrayMove(placements, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))),
          );
        }}
      >
        <SortableContext items={placements.map((p) => p.id)} strategy={verticalListSortingStrategy}>
          {view.widgets.map((w) => (
            <RailItem
              key={w.id}
              id={w.id}
              onRemove={() => put(placements.filter((p) => p.id !== w.id))}
            >
              {(handle) => (
                <WidgetCard
                  widget={w}
                  actions={
                    <>
                      {view.session.admin ? <WidgetSettings widget={w} /> : null}
                      <IconButton
                        label="Take off this page"
                        className="size-7"
                        onClick={() => put(placements.filter((p) => p.id !== w.id))}
                      >
                        <X className="size-4" />
                      </IconButton>
                      <button
                        type="button"
                        aria-label="Move"
                        {...handle}
                        className="grid size-7 cursor-grab touch-none place-items-center rounded-full text-muted hover:text-ink active:cursor-grabbing"
                      >
                        <GripVertical className="size-4" />
                      </button>
                    </>
                  }
                />
              )}
            </RailItem>
          ))}
        </SortableContext>
      </DndContext>
      <button
        type="button"
        onClick={onAdd}
        className="grid h-20 place-items-center rounded-(--radius) border-2 border-dashed border-line font-semibold text-muted hover:border-accent hover:text-accent"
      >
        <span className="flex items-center gap-2">
          <Plus className="size-5" /> Add a widget
        </span>
      </button>
    </div>
  );
}

function RailItem({
  id,
  children,
}: {
  id: string;
  onRemove: () => void;
  children: (handle: Record<string, unknown>) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cx(isDragging && "z-10 opacity-80")}
    >
      {children({ ...attributes, ...listeners })}
    </div>
  );
}
