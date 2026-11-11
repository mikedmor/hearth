/**
 * The command center: everything on one screen.
 *
 *  PC     a strip (greeting, clock, health, search), then the launcher (favourites dock and every
 *         group, packed into columns) beside a widget rail. The page itself never scrolls; the
 *         launcher and the rail scroll on their own if they ever need to.
 *  Phone  swipe between Apps and Widgets; favourites sit in a dock at the bottom, under the thumb.
 *
 * Edit mode turns the same screen editable, and only while it's on.
 */
import { useQueryClient } from "@tanstack/react-query";
import { LayoutGrid, Palette, Pencil, Shapes } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { HomeView, ViewGroup } from "../../shared/api";
import { CommandSearch } from "../components/CommandSearch";
import { EditBar, EditDock, EditLauncher, EditRail } from "../components/EditMode";
import { FindServices } from "../components/FindServices";
import { Dock, GroupCards, GroupIcons, GroupRows, useQuickKeys } from "../components/Launcher";
import { Masonry } from "../components/Masonry";
import { contextFromView, useTileEditors } from "../components/TileEditors";
import { useToast } from "../components/ui";
import { WidgetGallery } from "../components/WidgetGallery";
import { WidgetCard } from "../components/widgets/WidgetCard";
import { api } from "../lib/api";
import { type BoardItem, boardItems, boardRuns, itemWeight } from "../lib/board";
import { cx, greeting } from "../lib/format";
import { useLive } from "../lib/live";
import { keys } from "../lib/queries";

function useNow() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function useWide() {
  const query = "(min-width: 960px)";
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

function Health({ view }: { view: HomeView }) {
  const live = useLive();
  const tiles = view.groups.flatMap((g) => g.tiles).filter((t) => t.checked);
  if (!tiles.length) return null;
  const down = tiles.filter((t) => live.status[t.id]?.state === "down");
  const slow = tiles.filter((t) => live.status[t.id]?.state === "slow");
  // Services not checked yet aren't counted as up.
  const pending = tiles.filter((t) => (live.status[t.id]?.state ?? "unknown") === "unknown").length;
  const up = tiles.length - pending - down.length - slow.length;
  const tone = down.length ? "negative" : slow.length ? "warning" : pending ? "muted" : "positive";
  const text = down.length
    ? `${down.length} down`
    : slow.length
      ? `${slow.length} slow`
      : pending
        ? `${up} of ${tiles.length} up`
        : `All ${tiles.length} up`;
  const title = down.length
    ? `Not answering: ${down.map((t) => t.name).join(", ")}`
    : slow.length
      ? `Slow: ${slow.map((t) => t.name).join(", ")}`
      : "Every service is answering";
  return (
    <span
      title={title}
      className="flex h-8 flex-none items-center gap-1.5 rounded-full px-3 text-[12.5px] font-bold"
      style={{
        color: `var(--c-${tone})`,
        background: `color-mix(in oklab, var(--c-${tone}) 14%, transparent)`,
      }}
    >
      <span
        className={cx("size-2 rounded-full", down.length > 0 && "animate-pulse")}
        style={{ background: `var(--c-${tone})` }}
      />
      {text}
    </span>
  );
}

function Strip({
  view,
  onEdit,
  onLook,
  compact,
}: {
  view: HomeView;
  onEdit: () => void;
  onLook: () => void;
  compact?: boolean;
}) {
  const now = useNow();
  const shown = (k: string) => !view.sections.find((s) => s.kind === k)?.hidden;
  const { clock, greeting: showGreeting } = view.look;
  const time = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return (
    <div className={cx("flex items-center gap-3", compact ? "flex-wrap pt-2 pb-3" : "py-3")}>
      {shown("hero") && (showGreeting || clock !== "off") ? (
        <div className={cx("min-w-0", compact ? "grow" : "w-[min(34%,420px)] flex-none")}>
          {showGreeting ? (
            <h1 className="truncate font-heading text-[clamp(20px,2.2vw,28px)] leading-tight font-bold tracking-tight">
              {greeting(view.profile?.name, now)}
            </h1>
          ) : null}
          <p className="truncate text-[13px] text-muted">
            {clock !== "off" ? <b className="font-semibold text-ink">{time}</b> : null}
            {clock !== "off" ? " · " : ""}
            {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            {view.homeName ? ` · ${view.homeName}` : ""}
          </p>
        </div>
      ) : null}
      {!compact ? <Health view={view} /> : null}
      {shown("search") ? (
        <CommandSearch
          view={view}
          className={compact ? "order-last w-full" : "mx-auto w-full max-w-xl"}
        />
      ) : (
        <span className="grow" />
      )}
      {view.canEdit ? (
        <div className="flex flex-none gap-1">
          <button
            type="button"
            onClick={onLook}
            title="Look"
            aria-label="Customize the look"
            className="grid size-9 place-items-center rounded-full text-muted hover:bg-(--c-surface-2) hover:text-ink"
          >
            <Palette className="size-4.5" />
          </button>
          <button
            type="button"
            onClick={onEdit}
            title="Edit this page"
            aria-label="Edit this page"
            className="flex h-9 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] font-semibold text-muted hover:border-accent hover:text-ink"
          >
            <Pencil className="size-4" /> Edit
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Groups({ view, phone }: { view: HomeView; phone?: boolean }) {
  const style = view.look.launcher;
  if (!view.groups.length) {
    return (
      <p className="p-6 text-center text-muted">
        {view.canEdit
          ? "Nothing here yet. Press Edit to add tiles, or to find the services on your network."
          : "Nothing here yet."}
      </p>
    );
  }
  if (phone)
    return (
      <>
        {view.groups.map((g) => (
          <GroupIcons key={g.id} group={g} plain />
        ))}
      </>
    );
  if (style === "icons")
    return (
      <Masonry
        items={view.groups}
        minWidth={300}
        weight={(g) => Math.ceil(g.tiles.length / 3) * 2 + 1}
        render={(g) => <GroupIcons key={g.id} group={g} />}
      />
    );
  if (style === "cards")
    return (
      <>
        {view.groups.map((g) => (
          <GroupCards key={g.id} group={g} />
        ))}
      </>
    );
  return (
    <Masonry
      items={view.groups}
      minWidth={230}
      weight={(g) => g.tiles.length + 1.2}
      render={(g) => <GroupRows key={g.id} group={g} />}
    />
  );
}

/** Sections and widgets packed together, in the person's order: no rail. */
function Board({ view, showWidgets }: { view: HomeView; showWidgets: boolean }) {
  const style = view.look.launcher;
  const items = boardItems(view.groups, showWidgets ? view.widgets : [], view.board);
  if (!items.length)
    return (
      <p className="p-6 text-center text-muted">
        {view.canEdit
          ? "Nothing here yet. Press Edit to add tiles and widgets, or to find the services on your network."
          : "Nothing here yet."}
      </p>
    );
  const groupWeight = (g: ViewGroup) =>
    style === "icons" ? Math.ceil(g.tiles.length / 3) * 2 + 1 : g.tiles.length + 1.2;
  const one = (i: BoardItem) =>
    i.kind === "widget" ? (
      <div key={i.key} className="mb-(--gap)">
        <WidgetCard widget={i.widget} />
      </div>
    ) : style === "icons" ? (
      <GroupIcons key={i.key} group={i.group} />
    ) : style === "cards" ? (
      <GroupCards key={i.key} group={i.group} />
    ) : (
      <GroupRows key={i.key} group={i.group} />
    );
  return (
    <Masonry
      items={boardRuns(items, view.joined)}
      minWidth={280}
      weight={(run) => run.reduce((n, i) => n + itemWeight(i, groupWeight), 0)}
      render={(run) =>
        run.length === 1 ? one(run[0] as BoardItem) : <div key={run[0]?.key}>{run.map(one)}</div>
      }
    />
  );
}

/**
 * On a phone, with widgets mixed in: sections and the widgets linked to them go on the Apps page,
 * together; the other widgets (linked ones still together) on the Widgets page.
 */
function phoneRuns(view: HomeView): { apps: BoardItem[][]; widgets: BoardItem[] } {
  const runs = boardRuns(boardItems(view.groups, view.widgets, view.board), view.joined);
  const withSection = (r: BoardItem[]) => r.some((i) => i.kind === "group");
  return {
    apps: runs.filter(withSection),
    widgets: runs.filter((r) => !withSection(r)).flat(),
  };
}

function Rail({ view, widgets: only }: { view: HomeView; widgets?: HomeView["widgets"] }) {
  const widgets = only ?? view.widgets;
  if (!widgets.length) {
    return (
      <p className="card p-5 text-center text-sm text-muted">
        No widgets yet.{view.canEdit ? " Add some with Edit." : ""}
      </p>
    );
  }
  return (
    <div
      className={cx(
        "grid grid-cols-[minmax(0,1fr)] content-start gap-(--gap)",
        view.look.railWidth === "wide" && "2xl:grid-cols-2",
      )}
    >
      {widgets.map((w) => (
        <div
          key={w.id}
          className={cx(view.look.railWidth === "wide" && w.w >= 8 && "2xl:col-span-2")}
        >
          <WidgetCard widget={w} />
        </div>
      ))}
    </div>
  );
}

/** Outside edit mode, empty sections aren't shown. */
const withoutEmpty = (v: HomeView): HomeView => ({
  ...v,
  groups: v.groups.filter((g) => g.tiles.length > 0),
});

export function CommandLayout({
  view: full,
  editing,
  onEdit,
  onDone,
  onLook,
}: {
  view: HomeView;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  onLook: () => void;
}) {
  const view = editing ? full : withoutEmpty(full);
  const wide = useWide();
  const qc = useQueryClient();
  const toast = useToast();
  const { edit, modal } = useTileEditors(contextFromView(full));
  const [gallery, setGallery] = useState(false);
  const [finding, setFinding] = useState(false);
  useQuickKeys(editing ? [] : view.favorites);
  const shown = (k: string) => !view.sections.find((s) => s.kind === k)?.hidden;
  const showRail = shown("widgets") && view.look.rail !== "off";
  /** Widgets mixed in with the sections, in one order (on a wide screen). */
  const mixed = view.look.rail === "mixed";
  const showFavs = shown("favorites") && view.favorites.length > 0;
  const showGroups = shown("groups");

  const addWidget = async (id: string) => {
    try {
      await api.put("/api/me/layout", {
        sections: view.sections,
        widgets: [...view.widgets.map((w) => ({ id: w.id, w: w.w })), { id, w: 4 }],
      });
      toast("Widget added");
    } catch (e) {
      toast((e as Error).message, "bad");
    }
    await qc.invalidateQueries({ queryKey: keys.home });
  };

  const dialogs = (
    <>
      {modal}
      {gallery ? (
        <WidgetGallery view={view} onAdd={addWidget} onClose={() => setGallery(false)} />
      ) : null}
      {finding ? <FindServices onClose={() => setFinding(false)} /> : null}
    </>
  );

  if (editing) {
    return (
      <>
        <main className={cx("shell", wide ? "command flex flex-col" : "pb-10")}>
          <EditBar
            view={view}
            edit={edit}
            onWidgets={() => setGallery(true)}
            onFind={() => setFinding(true)}
            onLook={onLook}
            onDone={onDone}
          />
          <div className={cx("gap-(--gap)", wide ? "flex grow items-start" : "grid")}>
            <section aria-label="Services" className={cx("min-w-0", wide && "grow pb-6")}>
              <EditDock view={view} />
              <EditLauncher view={view} edit={edit} mixed={mixed && wide} />
            </section>
            {mixed && wide ? null : (
              <aside
                aria-label="Widgets"
                className={cx(wide && "w-[clamp(300px,24vw,380px)] flex-none pb-6")}
              >
                <EditRail view={view} onAdd={() => setGallery(true)} />
              </aside>
            )}
          </div>
        </main>
        {dialogs}
      </>
    );
  }

  if (wide) {
    const rail =
      showRail && !mixed ? (
        <aside
          aria-label="Widgets"
          className={cx(
            "flex-none pb-6",
            view.look.railWidth === "wide"
              ? "w-[clamp(340px,32vw,640px)]"
              : "w-[clamp(300px,24vw,380px)]",
          )}
        >
          <Rail view={view} />
        </aside>
      ) : null;
    return (
      <>
        <main className="shell command flex flex-col">
          <Strip view={view} onEdit={onEdit} onLook={onLook} />
          <div className="flex grow items-start gap-(--gap)">
            {view.look.rail === "left" ? rail : null}
            <section aria-label="Services" className="min-w-0 grow pb-6">
              {showFavs ? <Dock tiles={view.favorites} className="card mb-(--gap) p-1.5" /> : null}
              {mixed ? (
                <Board
                  view={showGroups ? view : { ...view, groups: [] }}
                  showWidgets={shown("widgets")}
                />
              ) : showGroups ? (
                <Groups view={view} />
              ) : null}
            </section>
            {view.look.rail !== "left" ? rail : null}
          </div>
        </main>
        {dialogs}
      </>
    );
  }

  return (
    <>
      <PhoneLayout
        view={view}
        onEdit={onEdit}
        onLook={onLook}
        showRail={showRail}
        showFavs={showFavs}
        showGroups={showGroups}
      />
      {dialogs}
    </>
  );
}

function PhoneLayout({
  view,
  onEdit,
  onLook,
  showRail,
  showFavs,
  showGroups,
}: {
  view: HomeView;
  onEdit: () => void;
  onLook: () => void;
  showRail: boolean;
  showFavs: boolean;
  showGroups: boolean;
}) {
  const pager = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const dock = showFavs && view.look.dock;
  // Widgets mixed in with the sections: linked ones follow their section onto the Apps page.
  const split = view.look.rail === "mixed" && view.groups.length ? phoneRuns(view) : null;
  const go = (n: number) =>
    pager.current?.scrollTo({ left: n * pager.current.clientWidth, behavior: "smooth" });
  return (
    <main className={cx("shell", dock ? "pb-28" : "pb-8")}>
      <Strip view={view} onEdit={onEdit} onLook={onLook} compact />
      {showRail ? (
        <div
          role="tablist"
          aria-label="Pages"
          className="mb-3 flex gap-1 rounded-2xl border border-line bg-surface p-1"
        >
          {(
            [
              ["Apps", Shapes],
              ["Widgets", LayoutGrid],
            ] as const
          ).map(([label, Icon], i) => (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={page === i}
              onClick={() => go(i)}
              className={cx(
                "flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold",
                page === i ? "bg-accent text-white" : "text-muted",
              )}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
      ) : null}
      <div
        ref={pager}
        className="pager"
        onScroll={(e) =>
          setPage(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))
        }
      >
        <section aria-label="Apps" className="pager-page">
          {showFavs && !dock ? (
            <Dock tiles={view.favorites} numbered={false} className="card mb-3 p-1" />
          ) : null}
          {showGroups ? (
            split ? (
              split.apps.map((run) => (
                <div key={run[0]?.key}>
                  {run.map((i) =>
                    i.kind === "group" ? (
                      view.look.launcher === "cards" ? (
                        <GroupCards key={i.key} group={i.group} />
                      ) : (
                        <GroupIcons key={i.key} group={i.group} plain />
                      )
                    ) : showRail ? (
                      <div key={i.key} className="mb-3">
                        <WidgetCard widget={i.widget} />
                      </div>
                    ) : null,
                  )}
                </div>
              ))
            ) : (
              <Groups view={view} phone={view.look.launcher !== "cards"} />
            )
          ) : null}
        </section>
        {showRail ? (
          <section aria-label="Widgets" className="pager-page">
            <Rail
              view={view}
              widgets={
                split && showGroups
                  ? split.widgets.flatMap((i) => (i.kind === "widget" ? [i.widget] : []))
                  : undefined
              }
            />
          </section>
        ) : null}
      </div>
      {dock ? (
        <div className="fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(10px,env(safe-area-inset-bottom))]">
          <Dock
            tiles={view.favorites.slice(0, 5)}
            numbered={false}
            fit
            className="dock-bar card mx-auto max-w-md bg-[color-mix(in_oklab,var(--c-surface)_80%,transparent)]! p-1 backdrop-blur-xl"
          />
        </div>
      ) : null}
    </main>
  );
}
