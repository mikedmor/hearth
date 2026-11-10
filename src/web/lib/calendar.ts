/**
 * Calendar helpers for the page: days in the viewer's own zone, the month and week grids, and
 * the data, refetched when anyone changes a calendar.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { CalEvent, CalendarView } from "../../shared/calendar";
import { api } from "./api";
import { live } from "./live";

export const DAY_MS = 86_400_000;

/** A day, a time of day, or an instant, as a Date in this device's zone. */
export function parseWhen(w: string): Date {
  if (!w.includes("T")) {
    const [y, m, d] = w.split("-").map(Number) as [number, number, number];
    return new Date(y, m - 1, d);
  }
  return new Date(w);
}

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();
const pad = (n: number) => String(n).padStart(2, "0");
/** "2026-11-10" for a local day. */
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const timeKey = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** The first day of the week where this person is: Monday in most places, Sunday in some. */
export function weekStart(): number {
  try {
    const loc = new Intl.Locale(navigator.language) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const first = loc.getWeekInfo?.().firstDay ?? loc.weekInfo?.firstDay;
    if (first) return first % 7;
  } catch {
    // Older browsers.
  }
  return /^en-(US|CA)|^ja|^ko|^zh-TW|^he|^pt-BR/.test(navigator.language) ? 0 : 1;
}

export function startOfWeek(d: Date, first = weekStart()): Date {
  const day = startOfDay(d);
  return addDays(day, -((day.getDay() - first + 7) % 7));
}

/** The six weeks a month view shows. */
export function monthGrid(anchor: Date): Date[] {
  const first = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

/** The local days an event covers. A timed event ending at midnight doesn't reach the next day. */
export function eventDays(e: Pick<CalEvent, "start" | "end" | "allDay">): Date[] {
  const s = startOfDay(parseWhen(e.start));
  const endAt = parseWhen(e.end);
  const last = e.allDay
    ? addDays(startOfDay(endAt), -1)
    : endAt.getHours() || endAt.getMinutes() || endAt.getTime() <= parseWhen(e.start).getTime()
      ? startOfDay(endAt)
      : addDays(startOfDay(endAt), -1);
  const out: Date[] = [];
  for (let d = s; d <= last && out.length < 62; d = addDays(d, 1)) out.push(d);
  return out.length ? out : [s];
}

/** Events by local day, all-day ones first, then by start. */
export function byDay(events: CalEvent[]): Map<string, CalEvent[]> {
  const map = new Map<string, CalEvent[]>();
  for (const e of events)
    for (const d of eventDays(e)) {
      const k = dayKey(d);
      map.set(k, [...(map.get(k) ?? []), e]);
    }
  for (const list of map.values())
    list.sort(
      (a, b) =>
        Number(b.allDay) - Number(a.allDay) ||
        parseWhen(a.start).getTime() - parseWhen(b.start).getTime() ||
        a.title.localeCompare(b.title),
    );
  return map;
}

const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, o);
export const timeText = (d: Date) => fmt({ hour: "numeric", minute: "2-digit" }).format(d);
export const dayText = (d: Date) =>
  fmt({ weekday: "short", day: "numeric", month: "short" }).format(d);
export const longDayText = (d: Date) =>
  fmt({ weekday: "long", day: "numeric", month: "long" }).format(d);
export const monthText = (d: Date) => fmt({ month: "long", year: "numeric" }).format(d);
/** "Nov 8 – 14, 2026". */
export const weekText = (a: Date, b: Date) =>
  fmt({ month: "short", day: "numeric", year: "numeric" }).formatRange(a, b);
export const weekdayText = (d: Date, style: "short" | "narrow" = "short") =>
  fmt({ weekday: style }).format(d);

/** "Thu 12 Nov, 10:00 – 11:00", "All day, Thu 26 – Fri 27 Nov". */
export function whenText(e: Pick<CalEvent, "start" | "end" | "allDay">): string {
  const s = parseWhen(e.start);
  if (e.allDay) {
    const last = addDays(parseWhen(e.end), -1);
    return sameDay(s, last) || last < s
      ? `All day, ${dayText(s)}`
      : `All day, ${dayText(s)} – ${dayText(last)}`;
  }
  const end = parseWhen(e.end);
  return sameDay(s, end)
    ? `${dayText(s)}, ${timeText(s)} – ${timeText(end)}`
    : `${dayText(s)}, ${timeText(s)} – ${dayText(end)}, ${timeText(end)}`;
}

/** A friendly name for a day near today. */
export function relativeDay(d: Date, today = new Date()): string {
  const diff = Math.round((startOfDay(d).getTime() - startOfDay(today).getTime()) / DAY_MS);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 7) return fmt({ weekday: "long" }).format(d);
  return longDayText(d);
}

export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export const calendarKey = ["calendar"] as const;

/** A person's calendar for a range of days. */
export function useCalendar(from: Date, to: Date, enabled = true) {
  const qc = useQueryClient();
  useEffect(
    () =>
      live.changes((what) => {
        if (what === "calendar" || what === "session")
          void qc.invalidateQueries({ queryKey: calendarKey });
      }),
    [qc],
  );
  return useQuery({
    queryKey: [...calendarKey, from.toISOString(), to.toISOString()],
    queryFn: () =>
      api.get<CalendarView>(
        `/api/calendar?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
      ),
    enabled,
    placeholderData: (prev) => prev,
    refetchInterval: 5 * 60_000,
    retry: false,
  });
}
