/**
 * Calendars: everyone has their own calendar, made of sources they
 * add (Hearth's own, calendar links, CalDAV and Google accounts) and the ones shared with them.
 *
 * Kept in `data/calendar.json`, apart from `hearth.json`: it's the family's own data, not the
 * house's setup, and it changes all the time. Passwords, calendar links and Google's tokens are
 * secrets (`calendar:<id>`), never in this file and never sent to a page.
 */
import { z } from "zod";

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "lowercase letters, digits and -");
const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "lowercase letters, digits and -");
const color = z.string().regex(/^#[0-9a-f]{6}$/i, "a colour like #3b82f6");
/** A day ("2026-11-10"), a time here ("2026-11-10T09:00:00"), or an instant ("…Z" or "+01:00"). */
export const WHEN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const when = z.string().regex(WHEN, "a date or a date and time");

export const CAL_KINDS = ["hearth", "ics", "caldav", "google"] as const;
export type CalKind = (typeof CAL_KINDS)[number];
export const REPEATS = ["daily", "weekly", "monthly", "yearly"] as const;
export type Repeat = (typeof REPEATS)[number];

/** A connection to someone's calendars elsewhere: a CalDAV server or a Google account. */
export const AccountSchema = z.object({
  id,
  owner: slug,
  kind: z.enum(["caldav", "google"]),
  /** "alex@example.com", "iCloud". */
  name: z.string().min(1).max(120),
  /** CalDAV: the server's address, as given. */
  url: z.string().max(500).optional(),
  username: z.string().max(200).optional(),
});
export type Account = z.infer<typeof AccountSchema>;

export const CalendarSchema = z.object({
  id,
  owner: slug,
  kind: z.enum(CAL_KINDS),
  name: z.string().min(1).max(60),
  color,
  /** CalDAV and Google calendars come from an account. */
  account: id.optional(),
  /** Which calendar there: a CalDAV collection's address, or Google's calendar id. */
  remote: z.string().max(1000).optional(),
  /** The other end won't take changes (a calendar link always; some shared calendars). */
  readOnly: z.boolean().default(false),
  /** Who else sees it. They can each turn it off on their own page. */
  shareWith: z.array(slug).max(50).default([]),
  /** Those people may add and change its events too (a family calendar). */
  shareEdit: z.boolean().default(false),
  /** How often a calendar from elsewhere is fetched again, in minutes. */
  refreshMinutes: z.number().int().min(5).max(1440).default(15),
});
export type Calendar = z.infer<typeof CalendarSchema>;

/** An event kept in Hearth's own calendar. */
export const HearthEventSchema = z.object({
  id,
  calendar: id,
  title: z.string().min(1).max(200),
  start: when,
  /** Exclusive: an all-day event on the 10th ends on the 11th. */
  end: when,
  allDay: z.boolean().default(false),
  /** Where the times were set, so a repeating event keeps its time of day across clock changes. */
  timeZone: z.string().max(60).optional(),
  location: z.string().max(300).optional(),
  notes: z.string().max(4000).optional(),
  repeat: z.enum(REPEATS).optional(),
  /** The last day it repeats on. */
  until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Starts of the times it was skipped ("Delete just this one"). */
  except: z.array(when).max(500).default([]),
  /**
   * A repeat rule from an imported file that Hearth's simple choices can't say ("every other
   * Tuesday", "10 times"): an iCalendar RRULE, used instead of `repeat` and `until`.
   */
  rrule: z.string().max(500).optional(),
  /** The event's id in the file it was imported from, so importing it again adds nothing. */
  uid: z.string().max(300).optional(),
  createdBy: slug,
  updated: z.string().max(40),
});
export type HearthEvent = z.infer<typeof HearthEventSchema>;

/** People tagged on one event (or one repeating series), so they see it even if the calendar isn't shared. */
export const TagSchema = z.object({
  calendar: id,
  /** The event's series id: the same for every time a repeating event happens. */
  series: z.string().min(1).max(1000),
  people: z.array(slug).min(1).max(50),
});
export type Tag = z.infer<typeof TagSchema>;

export const CalendarFileSchema = z.object({
  version: z.literal(1).default(1),
  accounts: z.array(AccountSchema).default([]),
  calendars: z.array(CalendarSchema).default([]),
  events: z.array(HearthEventSchema).default([]),
  tags: z.array(TagSchema).default([]),
  /** Per person: what they turned off (calendar ids, or "from:<person>" for events tagged to them). */
  off: z.record(slug, z.array(z.string().max(80)).max(200)).default({}),
});
export type CalendarFile = z.infer<typeof CalendarFileSchema>;

export const FROM = "from:";
export const secretOf = (accountOrCalendar: string) => `calendar:${accountOrCalendar}`;
export const GOOGLE_CLIENT_SECRET = "calendar:google-client";

// ---------------------------------------------------------------------------
// Who may do what

/** Whether `person` sees this calendar at all (before their own on/off choice). */
export const canRead = (c: Calendar, person: string) =>
  c.owner === person || c.shareWith.includes(person);

/** Whether `person` may add and change events in it. */
export const canWrite = (c: Calendar, person: string) =>
  !c.readOnly && (c.owner === person || (c.shareEdit && c.shareWith.includes(person)));

// ---------------------------------------------------------------------------
// What the page is sent

export interface CalendarInfo {
  /** A calendar's id, or "from:<person>" for the events people tagged you on. */
  id: string;
  name: string;
  color: string;
  kind: CalKind | "tagged";
  owner: string;
  mine: boolean;
  /** Shown on this person's calendar now. */
  on: boolean;
  /** This person may add events to it. */
  canWrite: boolean;
  /** Only for the owner. */
  shareWith?: string[];
  shareEdit?: boolean;
  readOnly?: boolean;
  account?: { id: string; name: string; kind: "caldav" | "google" };
  refreshMinutes?: number;
  /** The last fetch failed; what's shown may be older. */
  error?: string;
}

export interface CalEvent {
  /** Unique on the page. */
  key: string;
  /** The calendar it's shown under (a calendar id or "from:<person>"). */
  calendar: string;
  /** The calendar it really lives in. */
  source: string;
  /** How its home calendar knows it: an event id, a CalDAV address, Google's id. */
  ref: string;
  /** The same for every time a repeating event happens (tags are kept per series). */
  series: string;
  /** For a repeating event: when this time starts, as its calendar has it. */
  instance?: string;
  etag?: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  notes?: string;
  repeat?: Repeat;
  repeating: boolean;
  /** It repeats by a rule from an imported file, which the event form keeps as it is. */
  customRepeat?: boolean;
  /** People tagged on it. */
  people: string[];
  canEdit: boolean;
  /** Repeating events from CalDAV and calendar links are changed in their own app. */
  readOnlyReason?: string;
}

export interface AccountInfo {
  id: string;
  kind: "caldav" | "google";
  name: string;
  url?: string;
  username?: string;
}

/** `GET /api/calendar?from&to`. */
export interface CalendarView {
  me: string;
  calendars: CalendarInfo[];
  events: CalEvent[];
  accounts: AccountInfo[];
  /** The admin has set up Google sign-in. */
  google: boolean;
  /** Google's sign-in comes back to Hearth by itself (a return page is set up); else it's pasted. */
  googleReturns: boolean;
  /** Calendars may reach the internet (Settings → Calendars). */
  internet: boolean;
  /** This person's page is locked: they can't add sources. */
  locked: boolean;
  /** Their profile has no PIN, so anyone on the network can open their calendar. */
  noPin: boolean;
}

/** A calendar found in an account, to add. */
/** What importing a file would do, or did. */
export interface ImportSummary {
  /** Events in the file (a repeating event counts once). */
  events: number;
  repeating: number;
  /** Times of a repeating event that were moved or cancelled in the file. */
  changedTimes: number;
  /** Already in that calendar from an earlier import: left alone. */
  duplicates: number;
  /** Added (0 when only looking). */
  added: number;
  /** The first and last day of anything in it ("…" for a series with no end). */
  first?: string;
  last?: string;
  /** Things in the file Hearth can't bring over, in plain words. */
  notes: string[];
}

export interface RemoteCalendar {
  remote: string;
  name: string;
  color?: string;
  readOnly: boolean;
  /** Already on this person's calendar. */
  added: boolean;
}

export const EventInputSchema = z
  .object({
    calendar: id,
    title: z.string().trim().min(1, "Give it a name").max(200),
    start: when,
    end: when,
    allDay: z.boolean().default(false),
    timeZone: z.string().max(60).optional(),
    location: z.string().max(300).optional(),
    notes: z.string().max(4000).optional(),
    repeat: z.enum(REPEATS).optional(),
    until: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    people: z.array(slug).max(50).default([]),
    /** Changing every time of an imported event: keep its own repeat rule. */
    keepRule: z.boolean().optional(),
  })
  .refine((e) => e.allDay === !e.start.includes("T") && e.allDay === !e.end.includes("T"), {
    message: "An all-day event has dates only; others have times",
    path: ["start"],
  })
  .refine((e) => toMs(e.end) > toMs(e.start), {
    message: "It has to end after it starts",
    path: ["end"],
  });
export type EventInput = z.infer<typeof EventInputSchema>;

/** Milliseconds for ordering: days and times here are read as UTC, which is enough to compare. */
export function toMs(w: string): number {
  if (!w.includes("T")) return Date.parse(`${w}T00:00:00Z`);
  return /Z|[+-]\d{2}:\d{2}$/.test(w) ? Date.parse(w) : Date.parse(`${w}Z`);
}

/** Colours offered for a new calendar. */
export const CAL_COLORS = [
  "#e8590c",
  "#2f9e44",
  "#1c7ed6",
  "#9c36b5",
  "#e64980",
  "#f08c00",
  "#0c8599",
  "#5c7cfa",
  "#868e96",
] as const;
