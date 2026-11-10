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
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  horizontalListSortingStrategy,
  rectSortingStrategy,
  SortableContext,
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
import type { HomeView, PublicProfile, ViewGroup, ViewTile } from "../../shared/api";
import type { SectionKind } from "../../shared/config";
import { api } from "../lib/api";
import { cx } from "../lib/format";
import { keys } from "../lib/queries";
import { AdminSignIn } from "./AdminSignIn";
import { TileIcon } from "./Tile";
import { AccessBadge, type EditTarget } from "./TileEditors";
import { IconButton, useToast } from "./ui";
import { WidgetCard } from "./widgets/WidgetCard";

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
const ZONE = "drop:";

/** A dragged section only lands on sections; a dragged link only on links and sections' lists. */
const collision: CollisionDetection = (args) => {
  const section = String(args.active.id).startsWith(SECTION);
  const droppableContainers = args.droppableContainers.filter(
    (c) => String(c.id).startsWith(SECTION) === section,
  );
  return (section ? closestCenter : closestCorners)({ ...args, droppableContainers });
};

export function EditLauncher({
  view,
  edit,
  columns,
}: {
  view: HomeView;
  edit: (t: EditTarget) => void;
  /** `folded`: every section is the same height, so they lie in reading order. */
  columns: (
    groups: ViewGroup[],
    render: (g: ViewGroup) => React.ReactNode,
    folded: boolean,
  ) => React.ReactNode;
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
  const initialOrder = useMemo(() => view.groups.map((g) => g.id), [view.groups]);
  const [order, setOrder] = useState(initialOrder);
  useEffect(() => setOrder(initialOrder), [initialOrder]);
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

  const onStart = (e: DragStartEvent) => setActive(String(e.active.id));
  const onOver = (e: DragOverEvent) => {
    const id = String(e.active.id);
    if (id.startsWith(SECTION) || !e.over) return;
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
    if (id.startsWith(SECTION)) {
      const over = e.over ? String(e.over.id).slice(SECTION.length) : null;
      const from = order.indexOf(id.slice(SECTION.length));
      const to = over ? order.indexOf(over) : -1;
      if (from === -1 || to === -1 || from === to) return;
      const next = arrayMove(order, from, to);
      setOrder(next);
      void save("put", "/api/me/tiles", { groupOrder: next });
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

  const ordered = order.map((id) => groupById.get(id)).filter((g): g is ViewGroup => !!g);
  const activeSection = active?.startsWith(SECTION)
    ? groupById.get(active.slice(SECTION.length))
    : undefined;
  const activeTile = active && !activeSection ? byId.get(active) : undefined;

  const render = (g: ViewGroup) => (
    <EditSection
      key={g.id}
      group={g}
      tiles={(cols[g.id] ?? [])
        .map((id) => byId.get(id))
        .filter((t): t is ViewTile => t !== undefined)}
      people={view.profiles}
      canStar={view.profile !== null}
      favorites={favorites}
      folded={!!activeSection}
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
    />
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onStart}
      onDragOver={onOver}
      onDragEnd={onEnd}
      onDragCancel={() => {
        setActive(null);
        setCols(initial);
      }}
      // Sections fold up when one is picked up, so measure where they are as they move.
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
    >
      <SortableContext items={order.map((id) => SECTION + id)} strategy={rectSortingStrategy}>
        {ordered.length ? (
          columns(ordered, render, !!activeSection)
        ) : (
          <p className="card p-6 text-center text-muted">
            No sections yet. {admin || view.canAddOwn ? "Add one with + Section" : ""}
            {admin ? ", or let Hearth find your services." : "."}
          </p>
        )}
      </SortableContext>
      <DragOverlay>
        {activeTile ? <Row tile={activeTile} people={view.profiles} overlay /> : null}
        {activeSection ? (
          <div className="card flex h-10 items-center gap-2 px-3 text-[11.5px] font-bold uppercase tracking-[0.09em] shadow-2xl">
            <GripVertical className="size-4 text-muted" /> {activeSection.name}
            <span className="ml-auto font-semibold text-muted">{activeSection.tiles.length}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
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
  edit: (t: EditTarget) => void;
  onHide: () => void;
  onHideTile: (id: string) => void;
  onStar: (id: string) => void;
}) {
  const { group, tiles, edit, people } = props;
  const sortable = useSortable({ id: SECTION + group.id });
  const zone = useDroppable({ id: ZONE + group.id, disabled: !props.dropOk });
  const sameAccess = (t: ViewTile) => JSON.stringify(t.access) === JSON.stringify(group.access);
  return (
    <section
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Translate.toString(sortable.transform),
        transition: sortable.transition,
      }}
      className={cx(
        "card launcher-group mb-(--gap) p-2",
        zone.isOver && props.dropOk && "ring-2 ring-accent",
        // Where the section will land.
        sortable.isDragging && "border-2 border-dashed border-accent bg-accent/5 [&>*]:invisible",
      )}
    >
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
        "dock-item relative flex w-[84px] flex-none cursor-grab touch-none flex-col items-center gap-1.5 rounded-2xl px-1 py-2 text-center active:cursor-grabbing",
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
