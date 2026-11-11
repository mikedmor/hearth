/**
 * iCalendar (ICS) in and out: reading calendar links and CalDAV objects into events for a range
 * of days, with repeating events expanded, and writing events for CalDAV servers.
 *
 * Times: an all-day event is a day ("2026-11-10"); a time in a known zone becomes an instant
 * ("…Z"); a "floating" time, with no zone, stays a time of day ("2026-11-10T09:00:00") that the
 * page reads in its own zone. A zone is known if it's an IANA name (most calendars) or the file
 * describes it (VTIMEZONE, as Outlook does with names like "Eastern Standard Time").
 */
import ICAL from "ical.js";
import type { Repeat } from "../../shared/calendar";

export interface Occurrence {
  uid: string;
  /** For one time of a repeating event: its start, as the calendar has it (RECURRENCE-ID). */
  instance?: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  notes?: string;
  repeating: boolean;
  repeat?: Repeat;
}

/** A repeating event is expanded at most this many times, so a bad rule can't run away. */
const MAX_STEPS = 20_000;
const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Zones

const formatters = new Map<string, Intl.DateTimeFormat | null>();
function formatter(tz: string): Intl.DateTimeFormat | null {
  if (!formatters.has(tz)) {
    try {
      formatters.set(
        tz,
        new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          hourCycle: "h23",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    } catch {
      formatters.set(tz, null);
    }
  }
  return formatters.get(tz) ?? null;
}

export const isZone = (tz: string | undefined): tz is string => !!tz && formatter(tz) !== null;

/** The zone's offset from UTC at an instant, in ms. */
export function offsetAt(tz: string, ms: number): number {
  const f = formatter(tz);
  if (!f) return 0;
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = Number(x.value);
  const n = (k: string) => p[k] ?? 0;
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The instant a wall-clock time happens in a zone (the later one when clocks go back). */
export function wallToUtc(wall: number, tz: string): number {
  const first = wall - offsetAt(tz, wall);
  const second = wall - offsetAt(tz, first);
  return second === first ? first : wall - offsetAt(tz, second);
}

/** The wall-clock time in a zone at an instant, as ms read as UTC. */
export const utcToWall = (ms: number, tz: string) => ms + offsetAt(tz, ms);

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const wallMs = (t: ICAL.Time) => Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
const dayString = (t: { year: number; month: number; day: number }) =>
  `${pad(t.year, 4)}-${pad(t.month)}-${pad(t.day)}`;
const floating = (ms: number) => new Date(ms).toISOString().slice(0, 19);

type Zones = Map<string, ICAL.Timezone>;

/** How to turn one property's times into instants. */
function zoneOf(prop: ICAL.Property | null, zones: Zones): string | ICAL.Timezone | "utc" | null {
  if (!prop) return null;
  const value = prop.getFirstValue() as ICAL.Time | null;
  if (value && typeof value === "object" && value.zone === ICAL.Timezone.utcTimezone) return "utc";
  const tzid = prop.getParameter("tzid");
  const name = Array.isArray(tzid) ? tzid[0] : tzid;
  if (typeof name !== "string") return null;
  const clean = name.replace(/^\//, "");
  if (isZone(clean)) return clean;
  return zones.get(name) ?? null;
}

/** One time as the page wants it. */
function render(t: ICAL.Time, zone: string | ICAL.Timezone | "utc" | null): string {
  if (t.isDate) return dayString(t);
  if (t.zone === ICAL.Timezone.utcTimezone || zone === "utc")
    return new Date(wallMs(t)).toISOString();
  if (typeof zone === "string") return new Date(wallToUtc(wallMs(t), zone)).toISOString();
  if (zone) return new Date(wallMs(t) - zone.utcOffset(t) * 1000).toISOString();
  return floating(wallMs(t));
}

/** Roughly when, to decide what falls in a range (a day either side covers any zone). */
const roughMs = (t: ICAL.Time) => (t.isDate ? Date.UTC(t.year, t.month - 1, t.day) : wallMs(t));

// ---------------------------------------------------------------------------
// Reading

const text = (c: ICAL.Component, name: string) => {
  const v = c.getFirstPropertyValue(name);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};

function simpleRepeat(rule: ICAL.Recur | null): Repeat | undefined {
  if (!rule) return undefined;
  const parts = rule.toJSON() as Record<string, unknown>;
  const extra = Object.keys(parts).filter((k) => !["freq", "until", "count"].includes(k));
  if (extra.length) return undefined;
  return (
    {
      DAILY: "daily",
      WEEKLY: "weekly",
      MONTHLY: "monthly",
      YEARLY: "yearly",
    } as const satisfies Record<string, Repeat>
  )[rule.freq as "DAILY"];
}

export class IcsError extends Error {}

/** Parse ICS text into its components, or say why it isn't a calendar. */
export function parseCalendar(ics: string): ICAL.Component {
  let comp: ICAL.Component;
  try {
    comp = new ICAL.Component(ICAL.parse(ics));
  } catch (e) {
    throw new IcsError(`That isn't a calendar file (${(e as Error).message.slice(0, 80)}).`);
  }
  if (comp.name !== "vcalendar") throw new IcsError("That isn't a calendar file.");
  return comp;
}

/**
 * Every time an event in this calendar happens between `from` and `to` (ms). Repeating events are
 * expanded, with their skipped and moved times (EXDATE, RECURRENCE-ID); cancelled ones are left out.
 */
export function occurrences(ics: string | ICAL.Component, from: number, to: number): Occurrence[] {
  const comp = typeof ics === "string" ? parseCalendar(ics) : ics;
  const zones: Zones = new Map();
  for (const z of comp.getAllSubcomponents("vtimezone")) {
    const tz = new ICAL.Timezone(z);
    if (tz.tzid) zones.set(tz.tzid, tz);
  }
  const lo = from - DAY;
  const hi = to + DAY;
  const out: Occurrence[] = [];
  const byUid = new Map<string, { master?: ICAL.Event; moved: ICAL.Event[] }>();
  for (const v of comp.getAllSubcomponents("vevent")) {
    const e = new ICAL.Event(v);
    const uid = e.uid || `no-uid-${byUid.size}`;
    const entry = byUid.get(uid) ?? { moved: [] };
    if (v.hasProperty("recurrence-id")) entry.moved.push(e);
    else entry.master = e;
    byUid.set(uid, entry);
  }

  const push = (
    item: ICAL.Event,
    start: ICAL.Time,
    end: ICAL.Time,
    uid: string,
    master: ICAL.Event,
    instance?: ICAL.Time,
  ) => {
    if (item.component.getFirstPropertyValue("status") === "CANCELLED") return;
    if (roughMs(start) >= hi || roughMs(end) <= lo) return;
    const startZone = zoneOf(item.component.getFirstProperty("dtstart"), zones);
    const endZone = item.component.hasProperty("dtend")
      ? zoneOf(item.component.getFirstProperty("dtend"), zones)
      : startZone;
    const s = render(start, startZone);
    let e = render(end, endZone);
    if (e <= s && start.isDate) {
      // An all-day event with no end lasts the day.
      const next = start.clone();
      next.adjust(1, 0, 0, 0);
      e = dayString(next);
    }
    const rule = master.component.getFirstPropertyValue("rrule") as ICAL.Recur | null;
    out.push({
      uid,
      instance: instance
        ? render(instance, zoneOf(master.component.getFirstProperty("dtstart"), zones))
        : undefined,
      title: text(item.component, "summary") ?? "(No title)",
      start: s,
      end: e,
      allDay: start.isDate,
      location: text(item.component, "location"),
      notes: text(item.component, "description"),
      repeating: master.isRecurring(),
      repeat: simpleRepeat(rule),
    });
  };

  for (const [uid, { master, moved: all }] of byUid) {
    // A cancelled time often has no start of its own: it's only a gap in the series.
    const gone = (m: ICAL.Event) =>
      m.component.getFirstPropertyValue("status") === "CANCELLED" ||
      !m.component.hasProperty("dtstart");
    const cancelled = new Set(all.filter(gone).map((m) => m.recurrenceId?.toString()));
    const moved = all.filter((m) => !gone(m));
    if (!master) {
      // Only moved times, without their series (some servers send just the changed ones).
      for (const m of moved) push(m, m.startDate, m.endDate, uid, m, m.recurrenceId);
      continue;
    }
    for (const m of moved) master.relateException(m);
    if (!master.isRecurring()) {
      push(master, master.startDate, master.endDate, uid, master);
      continue;
    }
    const it = master.iterator();
    for (let step = 0; step < MAX_STEPS; step++) {
      const next = it.next();
      if (!next || roughMs(next) >= hi) break;
      if (cancelled.has(next.toString())) continue;
      const d = master.getOccurrenceDetails(next);
      push(d.item, d.startDate, d.endDate, uid, master, d.recurrenceId);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Writing (CalDAV)

export interface IcsEventInput {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  timeZone?: string;
  location?: string;
  notes?: string;
  repeat?: Repeat;
  until?: string;
}

const RRULE_FREQ: Record<Repeat, string> = {
  daily: "DAILY",
  weekly: "WEEKLY",
  monthly: "MONTHLY",
  yearly: "YEARLY",
};

function dateTimeProp(name: string, when: string, allDay: boolean, tz: string | undefined) {
  const prop = new ICAL.Property(name);
  if (allDay) {
    prop.setValue(ICAL.Time.fromDateString(when.slice(0, 10)));
    return prop;
  }
  const ms = Date.parse(/Z|[+-]\d{2}:\d{2}$/.test(when) ? when : `${when}Z`);
  if (tz && isZone(tz)) {
    // A repeating event keeps its time of day in its zone, across clock changes.
    prop.setParameter("tzid", tz);
    prop.setValue(ICAL.Time.fromDateTimeString(floating(utcToWall(ms, tz))));
  } else {
    prop.setValue(ICAL.Time.fromJSDate(new Date(ms), true));
  }
  return prop;
}

/** "Every week until the 9th" as an RRULE. The last day counts whole: a timed rule ends at its end, in UTC. */
function simpleRule(
  repeat: Repeat,
  until: string | undefined,
  allDay: boolean,
  tz: string | undefined,
): ICAL.Recur {
  const rule: Record<string, unknown> = { freq: RRULE_FREQ[repeat] };
  if (until) {
    const [y, m, d] = until.split("-").map(Number) as [number, number, number];
    rule.until = allDay
      ? ICAL.Time.fromDateString(until)
      : ICAL.Time.fromJSDate(
          new Date(wallToUtc(Date.UTC(y, m - 1, d, 23, 59, 59), tz ?? "UTC")),
          true,
        );
  }
  return ICAL.Recur.fromData(rule);
}

/**
 * A rule kept from an imported file, written out for others: its end (UNTIL), kept as a time of
 * day in the event's zone inside Hearth, goes back to UTC as the standard wants.
 */
export function utcRule(rrule: string, tz: string | undefined): ICAL.Recur {
  const rule = ICAL.Recur.fromString(rrule);
  if (rule.until && !rule.until.isDate && rule.until.zone !== ICAL.Timezone.utcTimezone) {
    const ms = wallToUtc(wallMs(rule.until), tz && isZone(tz) ? tz : "UTC");
    rule.until = ICAL.Time.fromJSDate(new Date(ms), true);
  }
  return rule;
}

/**
 * An event as ICS for a CalDAV server. Given the object it came from, only the fields Hearth
 * edits are changed, so reminders, invitees and the rest stay as they were.
 */
export function eventIcs(input: IcsEventInput, uid: string, existing?: string): string {
  const now = ICAL.Time.fromJSDate(new Date(), true);
  let cal: ICAL.Component;
  let ev: ICAL.Component;
  if (existing) {
    cal = parseCalendar(existing);
    const master = cal.getAllSubcomponents("vevent").find((v) => !v.hasProperty("recurrence-id"));
    if (!master) throw new IcsError("That event isn't in a form Hearth can change.");
    ev = master;
    const seq = Number(ev.getFirstPropertyValue("sequence") ?? 0);
    ev.updatePropertyWithValue("sequence", Number.isFinite(seq) ? seq + 1 : 1);
  } else {
    cal = new ICAL.Component(["vcalendar", [], []]);
    cal.updatePropertyWithValue("prodid", "-//Hearth//Calendar//EN");
    cal.updatePropertyWithValue("version", "2.0");
    ev = new ICAL.Component("vevent");
    ev.updatePropertyWithValue("uid", uid);
    ev.updatePropertyWithValue("created", now);
    cal.addSubcomponent(ev);
  }
  ev.updatePropertyWithValue("dtstamp", now);
  ev.updatePropertyWithValue("last-modified", now);
  ev.updatePropertyWithValue("summary", input.title);
  for (const [name, value] of [
    ["location", input.location],
    ["description", input.notes],
  ] as const) {
    if (value?.trim()) ev.updatePropertyWithValue(name, value.trim());
    else ev.removeAllProperties(name);
  }
  const tz = input.repeat && !input.allDay ? input.timeZone : undefined;
  for (const name of ["dtstart", "dtend", "duration"]) ev.removeAllProperties(name);
  ev.addProperty(dateTimeProp("dtstart", input.start, input.allDay, tz));
  ev.addProperty(dateTimeProp("dtend", input.end, input.allDay, tz));
  ev.removeAllProperties("rrule");
  if (input.repeat)
    ev.updatePropertyWithValue("rrule", simpleRule(input.repeat, input.until, input.allDay, tz));
  if (tz) {
    for (const z of cal.getAllSubcomponents("vtimezone"))
      if (z.getFirstPropertyValue("tzid") === tz) cal.removeSubcomponent(z);
    cal.addSubcomponent(vtimezone(tz, new Date(Date.parse(input.start)).getUTCFullYear()));
  }
  return cal.toString();
}

// ---------------------------------------------------------------------------
// Importing a file, and exporting Hearth's own calendars

/** One event from an imported file, as Hearth keeps it. */
export interface ImportedEvent {
  /** The file's UID; for a moved time of a repeating event, `<uid>#<its original start>`. */
  uid: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  /** The zone it repeats in, keeping its time of day ("UTC" for a series fixed to UTC). */
  timeZone?: string;
  location?: string;
  notes?: string;
  repeat?: Repeat;
  /** A rule Hearth's simple choices can't say, its end as a time of day in `timeZone`. */
  rrule?: string;
  /** Starts of the times taken out of the series (EXDATE, and moved or cancelled times). */
  except: string[];
}

export interface ImportedFile {
  events: ImportedEvent[];
  /** Each original event with its moved times, as its own calendar file, for a CalDAV server. */
  objects: { uid: string; ics: string }[];
  repeating: number;
  changedTimes: number;
  first?: string;
  /** "…" when something repeats without end. */
  last?: string;
  notes: string[];
}

/** How many events one file may bring in. */
export const MAX_IMPORT = 5000;

/**
 * Read a calendar file to import. Times with no zone are read in `fallbackTz` (the importing
 * person's). Repeating events keep their rule; moved and cancelled times become events of their
 * own and gaps in the series, as Hearth keeps "just this time" changes.
 */
export function readImport(ics: string, fallbackTz: string): ImportedFile {
  const comp = parseCalendar(ics);
  const home = isZone(fallbackTz) ? fallbackTz : "UTC";
  const zones: Zones = new Map();
  for (const z of comp.getAllSubcomponents("vtimezone")) {
    const tz = new ICAL.Timezone(z);
    if (tz.tzid) zones.set(tz.tzid, tz);
  }
  const notes: string[] = [];
  const todos = comp.getAllSubcomponents("vtodo").length;
  if (todos)
    notes.push(
      `${todos} to-do${todos === 1 ? " isn't an event" : "s aren't events"}, so ${todos === 1 ? "it was" : "they were"} left out.`,
    );

  /** A time in the file as Hearth keeps it: a day, or an instant. */
  const when = (t: ICAL.Time, zone: ReturnType<typeof zoneOf>): string => {
    if (t.isDate) return dayString(t);
    if (zone === null) return new Date(wallToUtc(wallMs(t), home)).toISOString();
    return render(t, zone);
  };
  /** The zone a repeating event keeps its time of day in. */
  const zoneName = (zone: ReturnType<typeof zoneOf>, allDay: boolean): string | undefined => {
    if (allDay) return undefined;
    if (zone === "utc") return "UTC";
    if (typeof zone === "string") return zone;
    return home;
  };

  const groups = new Map<string, { master?: ICAL.Component; moved: ICAL.Component[] }>();
  for (const v of comp.getAllSubcomponents("vevent")) {
    // A cancelled time often has no start of its own; anything else needs one.
    if (!v.hasProperty("dtstart") && !v.hasProperty("recurrence-id")) continue;
    const uid = String(v.getFirstPropertyValue("uid") ?? "").trim() || `no-uid-${groups.size}`;
    const g = groups.get(uid) ?? { moved: [] };
    if (v.hasProperty("recurrence-id")) g.moved.push(v);
    else g.master = v;
    groups.set(uid, g);
  }

  const events: ImportedEvent[] = [];
  const objects: { uid: string; ics: string }[] = [];
  let repeating = 0;
  let changedTimes = 0;
  let extraDates = 0;
  let open = false;
  const seriesEnds: string[] = [];

  const plain = (v: ICAL.Component, uid: string): ImportedEvent | null => {
    if (v.getFirstPropertyValue("status") === "CANCELLED" || !v.hasProperty("dtstart")) return null;
    const e = new ICAL.Event(v);
    const startZone = zoneOf(v.getFirstProperty("dtstart"), zones);
    const endZone = v.hasProperty("dtend") ? zoneOf(v.getFirstProperty("dtend"), zones) : startZone;
    const allDay = e.startDate.isDate;
    const start = when(e.startDate, startZone);
    let end = when(e.endDate, endZone);
    if (end <= start) {
      // No end, or a broken one: an all-day event lasts the day; anything else, an hour.
      if (allDay) {
        const next = e.startDate.clone();
        next.adjust(1, 0, 0, 0);
        end = dayString(next);
      } else end = new Date(Date.parse(start) + 3600_000).toISOString();
    }
    return {
      uid,
      title: (text(v, "summary") ?? "(No title)").slice(0, 200),
      start,
      end,
      allDay,
      timeZone: zoneName(startZone, allDay),
      location: text(v, "location")?.slice(0, 300),
      notes: text(v, "description")?.slice(0, 4000),
      except: [],
    };
  };

  for (const [uid, { master, moved }] of groups) {
    // The original components, for a CalDAV server.
    const own = new ICAL.Component(["vcalendar", [], []]);
    own.updatePropertyWithValue("prodid", "-//Hearth//Calendar//EN");
    own.updatePropertyWithValue("version", "2.0");
    for (const z of comp.getAllSubcomponents("vtimezone"))
      own.addSubcomponent(new ICAL.Component(z.toJSON()));
    for (const v of [master, ...moved]) if (v) own.addSubcomponent(new ICAL.Component(v.toJSON()));
    objects.push({ uid, ics: own.toString() });

    const base = master ? plain(master, uid) : null;
    const rule = master?.getFirstPropertyValue("rrule") as ICAL.Recur | null | undefined;
    if (base && master && rule) {
      repeating++;
      if (master.hasProperty("rdate")) extraDates++;
      const startZone = zoneOf(master.getFirstProperty("dtstart"), zones);
      const tz = base.timeZone;
      const parts = rule.toJSON() as Record<string, unknown>;
      const simple = Object.keys(parts).every((k) => k === "freq") && simpleRepeat(rule);
      if (simple) {
        base.repeat = simple;
        open = true;
      } else {
        // Keep the rule, with its end as a time of day in the event's zone (how Hearth repeats).
        const r = ICAL.Recur.fromString(rule.toString());
        if (r.until && !base.allDay) {
          const untilMs = r.until.isDate
            ? wallToUtc(
                Date.UTC(r.until.year, r.until.month - 1, r.until.day, 23, 59, 59),
                tz ?? home,
              )
            : r.until.zone === ICAL.Timezone.utcTimezone
              ? wallMs(r.until)
              : wallToUtc(wallMs(r.until), tz ?? home);
          r.until = ICAL.Time.fromDateTimeString(floating(utcToWall(untilMs, tz ?? home)));
        }
        if (!r.until && !r.count) open = true;
        else {
          // The series' last time, for the summary's range.
          const it = new ICAL.Event(master).iterator();
          let last: ICAL.Time | null = null;
          for (let step = 0; step < MAX_STEPS; step++) {
            const next = it.next();
            if (!next) break;
            last = next;
          }
          if (last) seriesEnds.push(dayString(last));
        }
        base.rrule = r.toString();
      }
      // Times taken out of the series.
      for (const prop of master.getAllProperties("exdate")) {
        const z = zoneOf(prop, zones) ?? startZone;
        for (const t of prop.getValues() as ICAL.Time[]) base.except.push(when(t, z));
      }
    }
    if (base) events.push(base);

    // Moved or cancelled times: a gap in the series, and (if moved) an event of their own.
    for (const m of moved) {
      const rid = m.getFirstPropertyValue("recurrence-id") as ICAL.Time;
      const ridWhen = when(rid, zoneOf(m.getFirstProperty("recurrence-id"), zones));
      changedTimes++;
      if (base) base.except.push(ridWhen);
      const own2 = plain(m, `${uid}#${ridWhen}`);
      if (own2) events.push(own2);
    }
    if (base) base.except = [...new Set(base.except)].slice(0, 500);
  }

  if (extraDates)
    notes.push(
      `${extraDates} repeating event${extraDates === 1 ? " has" : "s have"} extra one-off dates (RDATE), which weren't brought over.`,
    );
  if (events.length > MAX_IMPORT)
    throw new IcsError(
      `That file has ${events.length} events; Hearth imports up to ${MAX_IMPORT} at a time.`,
    );
  const starts = events.map((e) => e.start.slice(0, 10)).sort();
  // An all-day event's end is the day after its last day.
  const lastDay = (e: ImportedEvent) =>
    e.allDay
      ? new Date(Date.parse(`${e.end.slice(0, 10)}T00:00:00Z`) - DAY).toISOString().slice(0, 10)
      : e.end.slice(0, 10);
  const ends = [...events.map(lastDay), ...seriesEnds].sort();
  return {
    events,
    objects,
    repeating,
    changedTimes,
    first: starts[0],
    last: open ? "…" : ends[ends.length - 1],
    notes,
  };
}

/** What `calendarIcs` needs of each event: Hearth's own events. */
export interface ExportEvent {
  id: string;
  uid?: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  timeZone?: string;
  location?: string;
  notes?: string;
  repeat?: Repeat;
  until?: string;
  rrule?: string;
  except: string[];
  updated: string;
}

/** A whole Hearth calendar as an .ics file, for any calendar app. */
export function calendarIcs(name: string, events: ExportEvent[]): string {
  const cal = new ICAL.Component(["vcalendar", [], []]);
  cal.updatePropertyWithValue("prodid", "-//Hearth//Calendar//EN");
  cal.updatePropertyWithValue("version", "2.0");
  cal.updatePropertyWithValue("calscale", "GREGORIAN");
  cal.updatePropertyWithValue("x-wr-calname", name);
  const zonesUsed = new Map<string, number>();
  for (const e of events) {
    const ev = new ICAL.Component("vevent");
    ev.updatePropertyWithValue("uid", e.uid ?? `${e.id}@hearth`);
    const stamp = Date.parse(e.updated);
    ev.updatePropertyWithValue(
      "dtstamp",
      ICAL.Time.fromJSDate(new Date(Number.isFinite(stamp) ? stamp : Date.now()), true),
    );
    ev.updatePropertyWithValue("summary", e.title);
    if (e.location) ev.updatePropertyWithValue("location", e.location);
    if (e.notes) ev.updatePropertyWithValue("description", e.notes);
    const repeats = Boolean(e.repeat || e.rrule);
    const tz = repeats && !e.allDay && e.timeZone && isZone(e.timeZone) ? e.timeZone : undefined;
    ev.addProperty(dateTimeProp("dtstart", e.start, e.allDay, tz));
    ev.addProperty(dateTimeProp("dtend", e.end, e.allDay, tz));
    if (e.rrule)
      ev.updatePropertyWithValue(
        "rrule",
        e.allDay ? ICAL.Recur.fromString(e.rrule) : utcRule(e.rrule, tz),
      );
    else if (e.repeat)
      ev.updatePropertyWithValue("rrule", simpleRule(e.repeat, e.until, e.allDay, tz));
    if (repeats)
      for (const x of e.except) {
        const prop = new ICAL.Property("exdate");
        if (e.allDay) prop.setValue(ICAL.Time.fromDateString(x.slice(0, 10)));
        else prop.setValue(ICAL.Time.fromJSDate(new Date(x), true));
        ev.addProperty(prop);
      }
    if (tz && !zonesUsed.has(tz)) zonesUsed.set(tz, new Date(Date.parse(e.start)).getUTCFullYear());
    cal.addSubcomponent(ev);
  }
  for (const [tz, year] of zonesUsed) cal.addSubcomponent(vtimezone(tz, year));
  return cal.toString();
}

const offsetText = (ms: number) => {
  const m = Math.round(ms / 60_000);
  const a = Math.abs(m);
  return `${m < 0 ? "-" : "+"}${pad(Math.floor(a / 60))}${pad(a % 60)}`;
};
const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/**
 * A VTIMEZONE for an IANA zone, worked out from the system's zone data for one year: its standard
 * time, and its summer time with the rule for when clocks change ("2nd Sunday of March").
 */
export function vtimezone(tz: string, year: number): ICAL.Component {
  const z = new ICAL.Component("vtimezone");
  z.updatePropertyWithValue("tzid", tz);
  const start = Date.UTC(year, 0, 1);
  const changes: { at: number; from: number; to: number }[] = [];
  let prev = offsetAt(tz, start);
  for (let d = 1; d <= 366; d++) {
    const at = start + d * DAY;
    const off = offsetAt(tz, at);
    if (off === prev) continue;
    // Narrow it down to the minute.
    let lo = at - DAY;
    let hi = at;
    while (hi - lo > 60_000) {
      const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
      if (offsetAt(tz, mid) === prev) lo = mid;
      else hi = mid;
    }
    changes.push({ at: hi, from: prev, to: off });
    prev = off;
  }
  const part = (kind: "standard" | "daylight", from: number, to: number, at?: number) => {
    const c = new ICAL.Component(kind);
    c.updatePropertyWithValue("tzoffsetfrom", ICAL.UtcOffset.fromString(offsetText(from)));
    c.updatePropertyWithValue("tzoffsetto", ICAL.UtcOffset.fromString(offsetText(to)));
    if (at === undefined) {
      c.updatePropertyWithValue("dtstart", ICAL.Time.fromDateTimeString("1970-01-01T00:00:00"));
    } else {
      const wall = new Date(at + from);
      c.updatePropertyWithValue("dtstart", ICAL.Time.fromDateTimeString(floating(at + from)));
      const day = wall.getUTCDate();
      const month = wall.getUTCMonth();
      const last = new Date(Date.UTC(wall.getUTCFullYear(), month + 1, 0)).getUTCDate();
      const nth = day + 7 > last ? -1 : Math.ceil(day / 7);
      c.updatePropertyWithValue(
        "rrule",
        ICAL.Recur.fromString(
          `FREQ=YEARLY;BYMONTH=${month + 1};BYDAY=${nth}${DAYS[wall.getUTCDay()]}`,
        ),
      );
    }
    z.addSubcomponent(c);
  };
  if (changes.length < 2) {
    const off = offsetAt(tz, start);
    part("standard", off, off);
    return z;
  }
  for (const ch of changes.slice(0, 2))
    part(ch.to > ch.from ? "daylight" : "standard", ch.from, ch.to, ch.at);
  return z;
}
