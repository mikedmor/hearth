/**
 * The calendar's views: a month grid, a week of hours, and an agenda list. Each event is
 * coloured by its calendar; pressing an empty day or hour starts a new event there.
 */
import { MapPin, Repeat } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PublicProfile } from "../../../shared/api";
import type { CalEvent } from "../../../shared/calendar";
import {
  addDays,
  byDay,
  dayKey,
  eventDays,
  monthGrid,
  parseWhen,
  relativeDay,
  sameDay,
  startOfDay,
  timeText,
  weekdayText,
} from "../../lib/calendar";
import { cx } from "../../lib/format";
import { Avatar } from "../Picker";

export interface ViewProps {
  events: CalEvent[];
  colorOf: (e: CalEvent) => string;
  onOpen: (e: CalEvent) => void;
  /** Start a new event: a day (all day), or a day and hour. */
  onNew?: (day: Date, hour?: number) => void;
  people: PublicProfile[];
}

const tint = (color: string, pct: number) =>
  `color-mix(in oklab, ${color} ${pct}%, var(--c-surface))`;

function Chip({
  e,
  color,
  onOpen,
  day,
}: {
  e: CalEvent;
  color: string;
  onOpen: () => void;
  day?: Date;
}) {
  const s = parseWhen(e.start);
  // A timed event shows its time on its first day only.
  const showTime = !e.allDay && (!day || sameDay(s, day));
  return (
    <button
      type="button"
      onClick={(ev) => {
        ev.stopPropagation();
        onOpen();
      }}
      title={e.title}
      className={cx(
        "flex w-full min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-[12px] leading-tight font-semibold transition hover:brightness-105",
      )}
      style={
        e.allDay ? { background: tint(color, 30), boxShadow: `inset 3px 0 0 ${color}` } : undefined
      }
    >
      {!e.allDay ? (
        <span className="size-2 flex-none rounded-full" style={{ background: color }} />
      ) : null}
      {showTime ? <span className="flex-none text-muted tabular-nums">{timeText(s)}</span> : null}
      <span className="truncate">{e.title}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Month

export function MonthView({
  anchor,
  onMore,
  ...p
}: ViewProps & { anchor: Date; onMore: (day: Date) => void }) {
  const days = useMemo(() => monthGrid(anchor), [anchor]);
  const map = useMemo(() => byDay(p.events), [p.events]);
  const today = new Date();
  const LIMIT = 3;
  return (
    <div className="card overflow-hidden p-0">
      <div className="grid grid-cols-7 border-b border-line">
        {days.slice(0, 7).map((d) => (
          <div
            key={d.getDay()}
            className="px-2 py-1.5 text-center text-[11.5px] font-bold uppercase tracking-[0.08em] text-muted"
          >
            <span className="hidden sm:inline">{weekdayText(d)}</span>
            <span className="sm:hidden">{weekdayText(d, "narrow")}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6">
        {days.map((d, i) => {
          const list = map.get(dayKey(d)) ?? [];
          const inMonth = d.getMonth() === anchor.getMonth();
          const isToday = sameDay(d, today);
          return (
            // biome-ignore lint/a11y/useSemanticElements: a day cell holds buttons of its own
            <div
              key={dayKey(d)}
              role="button"
              tabIndex={-1}
              // A phone shows dots, so a day opens its list; wider, an empty spot starts an event.
              onClick={() =>
                window.matchMedia("(min-width: 640px)").matches ? p.onNew?.(d) : onMore(d)
              }
              onKeyDown={() => {}}
              className={cx(
                "group relative flex min-h-[92px] min-w-0 flex-col gap-0.5 border-line p-1 sm:min-h-[112px]",
                i % 7 !== 6 && "border-r",
                i < 35 && "border-b",
                !inMonth && "bg-(--c-surface-2)/40",
                p.onNew && "cursor-pointer hover:bg-(--c-surface-2)/60",
              )}
            >
              <span
                className={cx(
                  "mb-0.5 grid size-6 place-items-center self-start rounded-full text-[12.5px] font-bold tabular-nums",
                  isToday ? "bg-accent text-white" : inMonth ? "" : "text-muted",
                )}
              >
                {d.getDate()}
              </span>
              {/* Phones: dots. Wider: the events themselves. */}
              <div className="flex flex-wrap gap-0.5 sm:hidden">
                {list.slice(0, 4).map((e) => (
                  <span
                    key={e.key}
                    className="size-1.5 rounded-full"
                    style={{ background: p.colorOf(e) }}
                  />
                ))}
              </div>
              <div className="hidden min-w-0 flex-col gap-0.5 sm:flex">
                {list.slice(0, LIMIT).map((e) => (
                  <Chip key={e.key} e={e} day={d} color={p.colorOf(e)} onOpen={() => p.onOpen(e)} />
                ))}
              </div>
              {list.length > LIMIT ? (
                <button
                  type="button"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onMore(d);
                  }}
                  className="mt-auto hidden self-start rounded px-1 text-[11.5px] font-semibold text-muted hover:text-ink sm:block"
                >
                  {list.length - LIMIT} more
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Week

const HOUR = 46;

interface Placed {
  e: CalEvent;
  top: number;
  height: number;
  col: number;
  cols: number;
}

/** Lay out one day's timed events: overlapping ones side by side. */
function place(events: CalEvent[], day: Date): Placed[] {
  const dayStart = startOfDay(day).getTime();
  const items = events
    .map((e) => {
      const s = Math.max(parseWhen(e.start).getTime(), dayStart);
      const end = Math.min(parseWhen(e.end).getTime(), dayStart + 24 * 3600_000);
      return { e, s, end: Math.max(end, s + 20 * 60_000) };
    })
    .sort((a, b) => a.s - b.s || b.end - a.end);
  const out: Placed[] = [];
  let group: ((typeof items)[number] & { col: number })[] = [];
  let groupEnd = 0;
  const flush = () => {
    const cols = Math.max(1, ...group.map((g) => g.col + 1));
    for (const g of group)
      out.push({
        e: g.e,
        top: ((g.s - dayStart) / 3600_000) * HOUR,
        height: Math.max(((g.end - g.s) / 3600_000) * HOUR - 2, 18),
        col: g.col,
        cols,
      });
    group = [];
  };
  for (const it of items) {
    if (group.length && it.s >= groupEnd) flush();
    const used = new Set(group.filter((g) => g.end > it.s).map((g) => g.col));
    let col = 0;
    while (used.has(col)) col++;
    group.push({ ...it, col });
    groupEnd = Math.max(groupEnd, it.end);
  }
  if (group.length) flush();
  return out;
}

export function WeekView({ start, days = 7, ...p }: ViewProps & { start: Date; days?: number }) {
  const list = useMemo(
    () => Array.from({ length: days }, (_, i) => addDays(start, i)),
    [start, days],
  );
  const map = useMemo(() => byDay(p.events), [p.events]);
  const scroller = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    // Open at the start of the day's waking hours, or just before the first event.
    const el = scroller.current;
    if (!el) return;
    const firsts = list
      .flatMap((d) => (map.get(dayKey(d)) ?? []).filter((e) => !e.allDay))
      .map((e) => parseWhen(e.start).getHours());
    el.scrollTop = Math.max(0, Math.min(7, ...firsts) - 0.5) * HOUR;
  }, [list, map]);
  const cols = `3.25rem repeat(${days}, minmax(0, 1fr))`;
  const allDay = list.map((d) => (map.get(dayKey(d)) ?? []).filter((e) => e.allDay));
  return (
    <div className="card flex flex-col overflow-hidden p-0">
      <div className="grid border-b border-line" style={{ gridTemplateColumns: cols }}>
        <span />
        {list.map((d) => {
          const isToday = sameDay(d, now);
          return (
            <div key={dayKey(d)} className="grid justify-items-center py-1.5">
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
                {weekdayText(d)}
              </span>
              <span
                className={cx(
                  "grid size-7 place-items-center rounded-full text-[14px] font-bold tabular-nums",
                  isToday && "bg-accent text-white",
                )}
              >
                {d.getDate()}
              </span>
            </div>
          );
        })}
      </div>
      {allDay.some((l) => l.length) ? (
        <div className="grid border-b border-line py-1" style={{ gridTemplateColumns: cols }}>
          <span className="self-center pr-1.5 text-right text-[10.5px] font-semibold text-muted">
            All day
          </span>
          {allDay.map((l, i) => (
            <div key={dayKey(list[i] as Date)} className="grid min-w-0 gap-0.5 px-0.5">
              {l.map((e) => (
                <Chip key={e.key} e={e} color={p.colorOf(e)} onOpen={() => p.onOpen(e)} />
              ))}
            </div>
          ))}
        </div>
      ) : null}
      <div ref={scroller} className="cmd-scroll max-h-[min(68dvh,720px)] overflow-y-auto">
        <div className="relative grid" style={{ gridTemplateColumns: cols, height: HOUR * 24 }}>
          <div className="relative">
            {Array.from({ length: 23 }, (_, h) => (
              <span
                key={h}
                className="absolute right-1.5 -translate-y-1/2 text-[10.5px] font-semibold text-muted tabular-nums"
                style={{ top: (h + 1) * HOUR }}
              >
                {timeText(new Date(2026, 0, 1, h + 1))}
              </span>
            ))}
          </div>
          {list.map((d) => {
            const timed = (map.get(dayKey(d)) ?? []).filter((e) => !e.allDay);
            const isToday = sameDay(d, now);
            return (
              // biome-ignore lint/a11y/useSemanticElements: the hours are a surface to press, with buttons on it
              <div
                key={dayKey(d)}
                role="button"
                tabIndex={-1}
                onKeyDown={() => {}}
                onClick={(ev) => {
                  const r = ev.currentTarget.getBoundingClientRect();
                  p.onNew?.(d, Math.floor((ev.clientY - r.top) / HOUR));
                }}
                className={cx(
                  "relative border-l border-line",
                  p.onNew && "cursor-pointer",
                  isToday && "bg-accent/[0.04]",
                )}
                style={{
                  backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR - 1}px, var(--c-line) ${HOUR - 1}px, var(--c-line) ${HOUR}px)`,
                }}
              >
                {place(timed, d).map(({ e, top, height, col, cols: n }) => {
                  const color = p.colorOf(e);
                  return (
                    <button
                      key={e.key}
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        p.onOpen(e);
                      }}
                      className="absolute overflow-hidden rounded-md px-1.5 py-0.5 text-left text-[11.5px] leading-tight transition hover:brightness-105"
                      style={{
                        top,
                        height,
                        left: `calc(${(col / n) * 100}% + 1px)`,
                        width: `calc(${100 / n}% - 3px)`,
                        background: tint(color, 32),
                        boxShadow: `inset 3px 0 0 ${color}`,
                      }}
                      title={e.title}
                    >
                      <span className="block truncate font-semibold">{e.title}</span>
                      {height > 30 ? (
                        <span className="block truncate text-muted tabular-nums">
                          {timeText(parseWhen(e.start))}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
                {isToday ? (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute right-0 left-0 h-0.5 bg-bad"
                    style={{ top: ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR }}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agenda

export function AgendaView({
  from,
  days,
  empty,
  ...p
}: ViewProps & { from: Date; days: number; empty?: React.ReactNode }) {
  const map = useMemo(() => byDay(p.events), [p.events]);
  const list = Array.from({ length: days }, (_, i) => addDays(from, i)).filter(
    (d) => (map.get(dayKey(d)) ?? []).length,
  );
  if (!list.length)
    return (
      <div className="card grid place-items-center gap-1 p-10 text-center text-muted">
        {empty ?? "Nothing on for these days."}
      </div>
    );
  const people = new Map(p.people.map((x) => [x.id, x]));
  return (
    <div className="card overflow-hidden p-0">
      {list.map((d) => (
        <section key={dayKey(d)} className="border-b border-line last:border-b-0">
          <h3 className="sticky top-0 bg-surface px-4 pt-3 pb-1 text-[12px] font-bold uppercase tracking-[0.08em] text-muted">
            {relativeDay(d)}
          </h3>
          <ul className="px-2 pb-2">
            {(map.get(dayKey(d)) ?? []).map((e) => {
              const s = parseWhen(e.start);
              const first = sameDay(s, d) || e.allDay;
              const continues = !e.allDay && !first;
              return (
                <li key={`${e.key}|${dayKey(d)}`}>
                  <button
                    type="button"
                    onClick={() => p.onOpen(e)}
                    className="flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left hover:bg-(--c-surface-2)"
                  >
                    <span className="w-[4.6rem] flex-none pt-0.5 text-[12.5px] font-semibold text-muted tabular-nums">
                      {e.allDay ? "All day" : continues ? "…" : timeText(s)}
                      {!e.allDay && !continues ? (
                        <span className="block text-[11.5px] font-normal">
                          {timeText(parseWhen(e.end))}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className="mt-1 h-8 w-1 flex-none self-stretch rounded-full"
                      style={{ background: p.colorOf(e) }}
                    />
                    <span className="grid min-w-0 grow gap-0.5">
                      <span className="flex items-center gap-1.5 text-[14.5px] font-semibold">
                        <span className="truncate">{e.title}</span>
                        {e.repeating ? <Repeat className="size-3.5 flex-none text-muted" /> : null}
                      </span>
                      {e.location ? (
                        <span className="flex items-center gap-1 truncate text-[12.5px] text-muted">
                          <MapPin className="size-3.5 flex-none" /> {e.location}
                        </span>
                      ) : null}
                    </span>
                    {e.people.length ? (
                      <span className="flex flex-none -space-x-1.5 pt-0.5">
                        {e.people.slice(0, 4).map((id) => {
                          const who = people.get(id);
                          return who ? <Avatar key={id} p={who} size="xs" /> : null;
                        })}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Everything on one day, for "N more" in the month. */
export function dayEvents(events: CalEvent[], day: Date): CalEvent[] {
  return events.filter((e) => eventDays(e).some((d) => sameDay(d, day)));
}
