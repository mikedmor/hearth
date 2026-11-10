/**
 * Each person's calendar: their own calendars, the ones shared with them and
 * events they're tagged on, as a month, a week or a list. Calendars are on the left (a drawer
 * on a phone); a new event starts from + or from an empty day or hour.
 */

import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, KeyRound, ListFilter, Plus, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CalEvent, CalendarInfo } from "../../shared/calendar";
import { DayList, EventDetails, EventEditor } from "../components/calendar/EventDialogs";
import {
  AddCalendar,
  CalendarList,
  CalendarSettings,
  type Found,
} from "../components/calendar/Sources";
import { AgendaView, dayEvents, MonthView, WeekView } from "../components/calendar/Views";
import { Button, Drawer, ErrorNote, IconButton, Modal, Segmented, Spinner } from "../components/ui";
import { api, local } from "../lib/api";
import {
  addDays,
  calendarKey,
  longDayText,
  monthGrid,
  monthText,
  startOfDay,
  startOfWeek,
  useCalendar,
  weekText,
} from "../lib/calendar";
import { useHome } from "../lib/queries";

type Mode = "month" | "week" | "agenda";
const MODE_KEY = "hearth:calendar-mode";
const AGENDA_DAYS = 31;

type Open =
  | { kind: "event"; event: CalEvent }
  | { kind: "edit"; event?: CalEvent; start?: { day: Date; hour?: number } }
  | { kind: "day"; day: Date }
  | { kind: "add"; found?: Found }
  | { kind: "settings"; calendar: CalendarInfo }
  | null;

export function CalendarPage() {
  const { data: home } = useHome();
  const [mode, setModeState] = useState<Mode>(() =>
    local.get<Mode>(MODE_KEY, window.matchMedia("(min-width: 768px)").matches ? "month" : "agenda"),
  );
  const setMode = (m: Mode) => {
    local.set(MODE_KEY, m);
    setModeState(m);
  };
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [open, setOpen] = useState<Open>(null);
  const [drawer, setDrawer] = useState(false);
  const [returnError, setReturnError] = useState<unknown>(null);
  const qc = useQueryClient();

  // Back from Google's sign-in, through the return page: finish it, then pick calendars.
  const returned = useRef(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (returned.current || !q.get("state") || !(q.get("code") || q.get("error"))) return;
    returned.current = true;
    // The code is used once; take it out of the address bar and history straight away.
    window.history.replaceState(null, "", "/calendar");
    api
      .post<Found>("/api/calendar/google/finish", { pasted: `?${q.toString()}` })
      .then(async (found) => {
        await qc.invalidateQueries({ queryKey: calendarKey });
        setOpen({ kind: "add", found });
      })
      .catch(setReturnError);
  }, [qc]);

  const range = useMemo(() => {
    if (mode === "month") {
      const grid = monthGrid(anchor);
      return { from: grid[0] as Date, to: addDays(grid[41] as Date, 1) };
    }
    if (mode === "week") {
      const s = startOfWeek(anchor);
      return { from: s, to: addDays(s, 7) };
    }
    return { from: anchor, to: addDays(anchor, AGENDA_DAYS) };
  }, [mode, anchor]);
  const me = home?.profile;
  const cal = useCalendar(range.from, range.to, Boolean(me));
  const view = cal.data;

  const colors = useMemo(
    () => new Map((view?.calendars ?? []).map((c) => [c.id, c.color])),
    [view?.calendars],
  );
  const colorOf = useCallback(
    (e: CalEvent) => colors.get(e.calendar) ?? "var(--c-muted)",
    [colors],
  );
  const people = home?.profiles ?? [];

  if (home && !me)
    return (
      <main className="shell grid place-items-center py-20 text-center">
        <div className="grid max-w-sm gap-2">
          <h1 className="font-heading text-2xl font-bold">Whose calendar?</h1>
          <p className="text-muted">
            Everyone has their own. Pick who you are (top right) to see yours.
          </p>
        </div>
      </main>
    );

  const step = (dir: 1 | -1) =>
    setAnchor((a) =>
      mode === "month"
        ? new Date(a.getFullYear(), a.getMonth() + dir, 1)
        : addDays(a, dir * (mode === "week" ? 7 : AGENDA_DAYS)),
    );
  const title =
    mode === "month"
      ? monthText(anchor)
      : mode === "week"
        ? weekText(range.from, addDays(range.to, -1))
        : `From ${longDayText(anchor)}`;
  const canAdd = view?.calendars.some((c) => c.canWrite) ?? false;
  const onNew = canAdd
    ? (day: Date, hour?: number) => setOpen({ kind: "edit", start: { day, hour } })
    : undefined;
  const props = {
    events: view?.events ?? [],
    colorOf,
    onOpen: (event: CalEvent) => setOpen({ kind: "event", event }),
    onNew,
    // Your own face on your own events says nothing.
    people: people.filter((p) => p.id !== me?.id),
  };
  const problems = (view?.calendars ?? []).filter((c) => c.on && c.error);

  const list = view ? (
    <CalendarList
      view={view}
      people={people}
      onSettings={(calendar) => setOpen({ kind: "settings", calendar })}
      onAdd={() => setOpen({ kind: "add" })}
    />
  ) : null;

  return (
    <main className="shell grid gap-4 pt-4 pb-16 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="hidden content-start gap-4 lg:grid" aria-label="Calendars">
        <Button
          variant="primary"
          disabled={!canAdd}
          onClick={() => setOpen({ kind: "edit", start: { day: anchor } })}
        >
          <Plus className="size-4" /> New event
        </Button>
        {list}
      </aside>

      <section className="grid min-w-0 content-start gap-3" aria-label="Calendar">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setAnchor(startOfDay(new Date()))}>
            Today
          </Button>
          <IconButton label="Earlier" onClick={() => step(-1)}>
            <ChevronLeft className="size-5" />
          </IconButton>
          <IconButton label="Later" onClick={() => step(1)}>
            <ChevronRight className="size-5" />
          </IconButton>
          <h1 className="mr-auto font-heading text-[19px] font-bold tracking-tight sm:text-[22px]">
            {title}
          </h1>
          {cal.isFetching ? <Spinner className="size-4 text-muted" /> : null}
          <div className="w-[min(100%,260px)]">
            <Segmented
              label="View"
              value={mode}
              onChange={setMode}
              options={[
                { value: "month", label: "Month" },
                { value: "week", label: "Week" },
                { value: "agenda", label: "List" },
              ]}
            />
          </div>
          <IconButton label="Calendars" className="lg:hidden" onClick={() => setDrawer(true)}>
            <ListFilter className="size-5" />
          </IconButton>
          <Button
            size="sm"
            variant="primary"
            className="lg:hidden"
            disabled={!canAdd}
            onClick={() => setOpen({ kind: "edit", start: { day: anchor } })}
          >
            <Plus className="size-4" /> Event
          </Button>
        </div>

        {view?.noPin ? (
          <p className="flex items-center gap-2 rounded-xl bg-(--c-surface-2) px-3 py-2 text-[13px]">
            <KeyRound className="size-4 flex-none text-muted" />
            <span>
              Your page has no PIN, so anyone on the home network can open it and see your calendar.
              Add one in Look on your start page to keep it yours.
            </span>
          </p>
        ) : null}
        {problems.length ? (
          <p className="flex items-start gap-2 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-[13px]">
            <TriangleAlert className="mt-0.5 size-4 flex-none text-warn" />
            <span>
              {problems.map((c) => (
                <span key={c.id} className="block">
                  <b>{c.name}:</b> {c.error}
                </span>
              ))}
            </span>
          </p>
        ) : null}
        {cal.error ? (
          <p className="card p-6 text-center text-bad">{(cal.error as Error).message}</p>
        ) : !view ? (
          <div className="skeleton h-120" />
        ) : mode === "month" ? (
          <MonthView {...props} anchor={anchor} onMore={(day) => setOpen({ kind: "day", day })} />
        ) : mode === "week" ? (
          <WeekView {...props} start={range.from} />
        ) : (
          <AgendaView
            {...props}
            from={anchor}
            days={AGENDA_DAYS}
            empty={
              <>
                <span className="font-semibold text-ink">Nothing on for the next month.</span>
                {canAdd ? <span>Press + to add something.</span> : null}
              </>
            }
          />
        )}
      </section>

      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Calendars">
        {list}
      </Drawer>

      {open?.kind === "event" && view ? (
        <EventDetails
          event={open.event}
          calendar={view.calendars.find((c) => c.id === open.event.calendar)}
          owner={people.find(
            (p) => p.id === view.calendars.find((c) => c.id === open.event.calendar)?.owner,
          )}
          people={people}
          me={view.me}
          onEdit={() => setOpen({ kind: "edit", event: open.event })}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open?.kind === "edit" && view && me ? (
        <EventEditor
          event={open.event}
          start={open.start}
          calendars={view.calendars}
          defaultCalendar={local.get<string>("hearth:calendar-last", "")}
          people={people}
          me={me.id}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open?.kind === "day" && view ? (
        <DayList
          title={longDayText(open.day)}
          events={dayEvents(view.events, open.day)}
          colorOf={colorOf}
          onOpen={(event) => setOpen({ kind: "event", event })}
          onNew={onNew ? () => setOpen({ kind: "edit", start: { day: open.day } }) : undefined}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open?.kind === "add" && view ? (
        <AddCalendar view={view} people={people} found={open.found} onClose={() => setOpen(null)} />
      ) : null}
      {returnError ? (
        <Modal open onClose={() => setReturnError(null)} title="Google didn't connect">
          <ErrorNote error={returnError} />
          <p className="mt-3 text-[13.5px] text-muted">
            Try again from Add a calendar → Google Calendar.
          </p>
        </Modal>
      ) : null}
      {open?.kind === "settings" && view ? (
        <CalendarSettings
          calendar={open.calendar}
          people={people}
          me={view.me}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </main>
  );
}
