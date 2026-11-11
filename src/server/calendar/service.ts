/**
 * Calendars for each person: what they see, fetched and cached; and changes, sent to the
 * calendar each event lives in (Hearth's own file, a CalDAV server, or Google).
 *
 * - A person sees their own calendars, the ones shared with them, and events they're tagged on
 *   (grouped as "From <owner>"). Each can be turned off on their own page.
 * - Calendars from elsewhere are fetched a month at a time and kept for their refresh time; when a
 *   fetch fails, the last good copy is shown with the problem.
 * - Nothing here reaches the internet unless the admin allowed it for calendars.
 */
import { randomBytes } from "node:crypto";
import type ICAL from "ical.js";
import {
  type Account,
  type AccountInfo,
  CAL_COLORS,
  type CalEvent,
  type Calendar,
  type CalendarFile,
  type CalendarInfo,
  type CalendarView,
  canRead,
  canWrite,
  type EventInput,
  FROM,
  GOOGLE_CLIENT_SECRET,
  type HearthEvent,
  type ImportSummary,
  type RemoteCalendar,
  type Repeat,
  secretOf,
  toMs,
} from "../../shared/calendar";
import { isLocked, type Profile, type Settings } from "../../shared/config";
import { guardedFetch, NetError, type NetPolicy } from "../net";
import type { SecretStore } from "../secrets";
import { CalDav, CalDavError, type DavObject, sameHref } from "./caldav";
import {
  finishSignIn,
  GoogleAccount,
  type GoogleClient,
  GoogleError,
  type GoogleEvent,
  googleWhen,
  type PendingSignIn,
  plainText,
  readPasted,
  startSignIn,
} from "./google";
import {
  calendarIcs,
  eventIcs,
  IcsError,
  isZone,
  occurrences,
  parseCalendar,
  readImport,
  utcToWall,
  wallToUtc,
} from "./ics";
import type { CalendarStore } from "./store";

/** Something the person can fix, said in plain words. */
export class CalendarError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

export interface CalendarDeps {
  store: CalendarStore;
  secrets: SecretStore;
  settings: () => Settings;
  profiles: () => Profile[];
  fetch?: typeof fetch;
  now?: () => number;
  log?: (msg: string) => void;
}

/** One event as its calendar has it, before it's dressed for a person. */
interface Raw {
  ref: string;
  series: string;
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
  readOnlyReason?: string;
  customRepeat?: boolean;
}

interface Cached<T> {
  at: number;
  value?: T;
  error?: string;
}

const DAY = 86_400_000;
const MAX_RANGE = 400 * DAY;
const newId = (person: string) => `${person}-${randomBytes(4).toString("hex")}`;

/** The months a range touches, each widened by two days so every zone is covered. */
function months(from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  const d = new Date(from);
  let y = d.getUTCFullYear();
  let m = d.getUTCMonth();
  for (let i = 0; i < 24; i++) {
    const start = Date.UTC(y, m, 1);
    if (start >= to) break;
    out.push([start - 2 * DAY, Date.UTC(y, m + 1, 1) + 2 * DAY]);
    m++;
    if (m === 12) {
      m = 0;
      y++;
    }
  }
  return out;
}

const overlaps = (e: { start: string; end: string }, from: number, to: number) =>
  toMs(e.start) < to + DAY && toMs(e.end) > from - DAY;

export class CalendarService {
  private ics = new Map<string, Cached<ICAL.Component>>();
  private dav = new Map<string, Cached<DavObject[]>>();
  private google = new Map<string, Cached<GoogleEvent[]>>();
  private running = new Map<string, Promise<void>>();
  private accounts = new Map<string, GoogleAccount>();
  private pending = new Map<string, PendingSignIn>();

  constructor(private readonly deps: CalendarDeps) {}

  private get file(): CalendarFile {
    return this.deps.store.get();
  }
  private now() {
    return (this.deps.now ?? Date.now)();
  }
  private policy(): NetPolicy {
    return { allowInternet: this.deps.settings().calendar.allowInternet };
  }
  private person(id: string) {
    return this.deps.profiles().find((p) => p.id === id);
  }

  // -------------------------------------------------------------------------
  // What a person sees

  /** Everyone has a calendar of their own: made the first time they look. */
  async ensureOwn(person: Profile): Promise<void> {
    if (this.file.calendars.some((c) => c.owner === person.id)) return;
    await this.deps.store.update((f) => {
      if (f.calendars.some((c) => c.owner === person.id)) return;
      f.calendars.push({
        id: `${person.id}-own`.slice(0, 64),
        owner: person.id,
        kind: "hearth",
        name: person.name,
        color: /^#[0-9a-f]{6}$/i.test(person.color) ? person.color : CAL_COLORS[0],
        readOnly: false,
        shareWith: [],
        shareEdit: false,
        refreshMinutes: 15,
      });
    });
  }

  async view(person: Profile, from: number, to: number, hasPin: boolean): Promise<CalendarView> {
    if (!(to > from)) throw new CalendarError("The range has to end after it starts.");
    if (to - from > MAX_RANGE) throw new CalendarError("Ask for at most 400 days at a time.");
    await this.ensureOwn(person);
    const me = person.id;
    const people = new Set(this.deps.profiles().map((p) => p.id));
    const f = this.file;
    const off = new Set(f.off[me] ?? []);
    const seen = f.calendars.filter((c) => people.has(c.owner) && canRead(c, me));
    const seenIds = new Set(seen.map((c) => c.id));
    const accountOf = new Map(f.accounts.map((a) => [a.id, a]));

    const calendars: CalendarInfo[] = seen.map((c) => {
      const mine = c.owner === me;
      const account = c.account ? accountOf.get(c.account) : undefined;
      return {
        id: c.id,
        name: c.name,
        color: c.color,
        kind: c.kind,
        owner: c.owner,
        mine,
        on: !off.has(c.id),
        canWrite: canWrite(c, me) && c.kind !== "ics",
        readOnly: c.readOnly || c.kind === "ics",
        ...(mine
          ? {
              shareWith: c.shareWith,
              shareEdit: c.shareEdit,
              refreshMinutes: c.refreshMinutes,
              account: account
                ? { id: account.id, name: account.name, kind: account.kind }
                : undefined,
            }
          : {}),
      };
    });

    // Events people tagged this person on, in calendars they can't otherwise see.
    const tagged = f.tags.filter((t) => t.people.includes(me) && !seenIds.has(t.calendar));
    const taggedByOwner = new Map<string, { calendar: Calendar; series: Set<string> }[]>();
    for (const t of tagged) {
      const c = f.calendars.find((x) => x.id === t.calendar);
      if (!c || !people.has(c.owner)) continue;
      const list = taggedByOwner.get(c.owner) ?? [];
      const entry = list.find((x) => x.calendar.id === c.id);
      if (entry) entry.series.add(t.series);
      else list.push({ calendar: c, series: new Set([t.series]) });
      taggedByOwner.set(c.owner, list);
    }
    for (const owner of taggedByOwner.keys()) {
      const p = this.person(owner);
      calendars.push({
        id: `${FROM}${owner}`,
        name: `From ${p?.name ?? owner}`,
        color: p?.color && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : "#868e96",
        kind: "tagged",
        owner,
        mine: false,
        on: !off.has(`${FROM}${owner}`),
        canWrite: false,
      });
    }

    const tagsOf = (cal: string, series: string) =>
      f.tags.find((t) => t.calendar === cal && t.series === series)?.people ?? [];
    const dress = (c: Calendar, shownAs: string, r: Raw): CalEvent => ({
      key: `${shownAs}|${r.ref}|${r.instance ?? ""}`,
      calendar: shownAs,
      source: c.id,
      ref: r.ref,
      series: r.series,
      instance: r.instance,
      etag: r.etag,
      title: r.title,
      start: r.start,
      end: r.end,
      allDay: r.allDay,
      location: r.location,
      notes: r.notes,
      repeat: r.repeat,
      repeating: r.repeating,
      customRepeat: r.customRepeat,
      people: tagsOf(c.id, r.series),
      canEdit: canWrite(c, me) && c.kind !== "ics" && !r.readOnlyReason,
      readOnlyReason: r.readOnlyReason,
    });

    const events: CalEvent[] = [];
    const errors = new Map<string, string>();
    const jobs: Promise<void>[] = [];
    for (const c of seen) {
      if (off.has(c.id)) continue;
      jobs.push(
        this.raw(c, from, to).then(({ events: list, error }) => {
          if (error) errors.set(c.id, error);
          for (const r of list) if (overlaps(r, from, to)) events.push(dress(c, c.id, r));
        }),
      );
    }
    for (const [owner, list] of taggedByOwner) {
      const shownAs = `${FROM}${owner}`;
      if (off.has(shownAs)) continue;
      for (const { calendar, series } of list)
        jobs.push(
          this.raw(calendar, from, to).then(({ events: rs }) => {
            for (const r of rs)
              if (series.has(r.series) && overlaps(r, from, to))
                events.push({ ...dress(calendar, shownAs, r), canEdit: false });
          }),
        );
    }
    await Promise.all(jobs);
    for (const c of calendars) {
      const e = errors.get(c.id);
      if (e) c.error = e;
    }
    events.sort((a, b) => toMs(a.start) - toMs(b.start) || a.title.localeCompare(b.title));

    const settings = this.deps.settings().calendar;
    return {
      me,
      calendars,
      events,
      accounts: f.accounts.filter((a) => a.owner === me).map(accountInfo),
      google: Boolean(settings.googleClientId && this.deps.secrets.has(GOOGLE_CLIENT_SECRET)),
      googleReturns: Boolean(settings.googleReturnPage),
      internet: settings.allowInternet,
      locked: isLocked(person),
      noPin: !hasPin,
    };
  }

  // -------------------------------------------------------------------------
  // Fetching, with caches

  /** Run `job` once for `key` even when several pages ask at the same moment. */
  private once(key: string, job: () => Promise<void>): Promise<void> {
    const running = this.running.get(key);
    if (running) return running;
    const p = job().finally(() => this.running.delete(key));
    this.running.set(key, p);
    return p;
  }

  private fresh(c: Calendar, cached: Cached<unknown> | undefined) {
    return !!cached && this.now() - cached.at < c.refreshMinutes * 60_000;
  }

  private problem(e: unknown): string {
    if (
      e instanceof CalDavError ||
      e instanceof GoogleError ||
      e instanceof IcsError ||
      e instanceof NetError ||
      e instanceof CalendarError
    )
      return this.deps.secrets.redact(e.message);
    this.deps.log?.(`calendar: ${(e as Error).message}`);
    return "Something went wrong fetching it.";
  }

  async raw(c: Calendar, from: number, to: number): Promise<{ events: Raw[]; error?: string }> {
    try {
      switch (c.kind) {
        case "hearth":
          return { events: this.hearthEvents(c, from, to) };
        case "ics":
          return await this.icsEvents(c, from, to);
        case "caldav":
          return await this.davEvents(c, from, to);
        case "google":
          return await this.googleEvents(c, from, to);
      }
    } catch (e) {
      return { events: [], error: this.problem(e) };
    }
  }

  private hearthEvents(c: Calendar, from: number, to: number): Raw[] {
    const out: Raw[] = [];
    for (const e of this.file.events) {
      if (e.calendar !== c.id) continue;
      const base = {
        ref: e.id,
        series: e.id,
        title: e.title,
        allDay: e.allDay,
        location: e.location,
        notes: e.notes,
        repeat: e.repeat,
        repeating: Boolean(e.repeat || e.rrule),
        customRepeat: e.rrule ? true : undefined,
      };
      if (!e.repeat && !e.rrule) {
        out.push({ ...base, start: e.start, end: e.end });
        continue;
      }
      const skip = new Set(e.except);
      for (const o of expandHearth(e, from, to)) {
        if (skip.has(o.start)) continue;
        out.push({ ...base, instance: o.start, start: o.start, end: o.end });
      }
    }
    return out;
  }

  private async icsEvents(c: Calendar, from: number, to: number) {
    const cached = this.ics.get(c.id);
    if (!this.fresh(c, cached)) {
      await this.once(`ics|${c.id}`, async () => {
        const url = this.deps.secrets.get(secretOf(c.id));
        try {
          if (!url) throw new CalendarError("This calendar's address is missing. Add it again.");
          const comp = parseCalendar(await this.fetchIcs(url));
          this.ics.set(c.id, { at: this.now(), value: comp });
        } catch (e) {
          this.ics.set(c.id, { at: this.now(), value: cached?.value, error: this.problem(e) });
        }
      });
    }
    const now = this.ics.get(c.id);
    const events = now?.value
      ? occurrences(now.value, from, to).map(
          (o): Raw => ({
            ref: o.uid,
            series: o.uid,
            instance: o.instance,
            title: o.title,
            start: o.start,
            end: o.end,
            allDay: o.allDay,
            location: o.location,
            notes: o.notes,
            repeat: o.repeat,
            repeating: o.repeating,
            readOnlyReason: "This calendar is a link: change it where it comes from.",
          }),
        )
      : [];
    return { events, error: now?.error };
  }

  private async fetchIcs(url: string): Promise<string> {
    const address = url.replace(/^webcals?:\/\//i, (m) =>
      m.toLowerCase() === "webcals://" ? "https://" : "https://",
    );
    const res = await guardedFetch(address, {
      policy: this.policy(),
      fetch: this.deps.fetch,
      timeoutMs: 20_000,
      maxBytes: 20 * 1024 * 1024,
      headers: { accept: "text/calendar, */*" },
    });
    if (res.status === 404)
      throw new CalendarError("That calendar link isn't there any more (404).");
    if (res.status === 401 || res.status === 403)
      throw new CalendarError(
        "That calendar link needs a sign-in, or it was reset. Copy it again.",
      );
    if (res.status >= 400) throw new CalendarError(`The calendar link answered ${res.status}.`);
    return res.body.toString("utf8");
  }

  private davClient(account: Account): CalDav {
    const secret = this.deps.secrets.get(secretOf(account.id));
    const password = secret ? ((JSON.parse(secret) as { password?: string }).password ?? "") : "";
    return new CalDav(
      { username: account.username ?? "", password },
      { policy: this.policy(), fetch: this.deps.fetch },
    );
  }

  private accountOf(c: Calendar): Account {
    const a = this.file.accounts.find((x) => x.id === c.account);
    if (!a || !c.remote) throw new CalendarError("This calendar's account is gone. Add it again.");
    return a;
  }

  private async davEvents(c: Calendar, from: number, to: number) {
    const account = this.accountOf(c);
    const remote = c.remote as string;
    const buckets = months(from, to);
    let error: string | undefined;
    const objects = new Map<string, DavObject>();
    await Promise.all(
      buckets.map(async ([a, b]) => {
        const key = `${c.id}|${a}`;
        const cached = this.dav.get(key);
        if (!this.fresh(c, cached))
          await this.once(`dav|${key}`, async () => {
            try {
              const value = await this.davClient(account).query(remote, a, b);
              this.dav.set(key, { at: this.now(), value });
            } catch (e) {
              this.dav.set(key, { at: this.now(), value: cached?.value, error: this.problem(e) });
            }
          });
        const now = this.dav.get(key);
        if (now?.error) error = now.error;
        for (const o of now?.value ?? []) objects.set(o.href, o);
      }),
    );
    const events: Raw[] = [];
    for (const o of objects.values()) {
      let list: ReturnType<typeof occurrences>;
      try {
        list = occurrences(o.ics, from, to);
      } catch {
        continue;
      }
      for (const x of list)
        events.push({
          ref: o.href,
          series: o.href,
          instance: x.instance,
          etag: o.etag,
          title: x.title,
          start: x.start,
          end: x.end,
          allDay: x.allDay,
          location: x.location,
          notes: x.notes,
          repeat: x.repeat,
          repeating: x.repeating,
          readOnlyReason: x.repeating
            ? "Repeating events from this calendar are changed in its own app."
            : undefined,
        });
    }
    return { events, error };
  }

  private googleClient(): GoogleClient {
    const settings = this.deps.settings().calendar;
    const secret = this.deps.secrets.get(GOOGLE_CLIENT_SECRET);
    if (!settings.googleClientId || !secret)
      throw new CalendarError("The admin hasn't set up Google sign-in yet (Settings → Calendars).");
    return { clientId: settings.googleClientId, clientSecret: secret };
  }

  private googleAccount(account: Account): GoogleAccount {
    const known = this.accounts.get(account.id);
    if (known) return known;
    const secret = this.deps.secrets.get(secretOf(account.id));
    const refresh = secret ? (JSON.parse(secret) as { refresh?: string }).refresh : undefined;
    if (!refresh) throw new CalendarError("This Google account needs connecting again.");
    const g = new GoogleAccount(this.googleClient(), refresh, {
      policy: this.policy(),
      fetch: this.deps.fetch,
    });
    this.accounts.set(account.id, g);
    return g;
  }

  private async googleEvents(c: Calendar, from: number, to: number) {
    const account = this.accountOf(c);
    const remote = c.remote as string;
    let error: string | undefined;
    const byId = new Map<string, GoogleEvent>();
    await Promise.all(
      months(from, to).map(async ([a, b]) => {
        const key = `${c.id}|${a}`;
        const cached = this.google.get(key);
        if (!this.fresh(c, cached))
          await this.once(`google|${key}`, async () => {
            try {
              const value = await this.googleAccount(account).events(remote, a, b);
              this.google.set(key, { at: this.now(), value });
            } catch (e) {
              this.google.set(key, {
                at: this.now(),
                value: cached?.value,
                error: this.problem(e),
              });
            }
          });
        const now = this.google.get(key);
        if (now?.error) error = now.error;
        for (const e of now?.value ?? []) byId.set(e.id, e);
      }),
    );
    const events: Raw[] = [...byId.values()].map((e) => ({
      ref: e.id,
      series: e.recurringEventId ?? e.id,
      instance: e.recurringEventId ? googleWhen(e.originalStartTime) : undefined,
      etag: e.etag,
      title: e.summary?.trim() || "(No title)",
      start: googleWhen(e.start),
      end: googleWhen(e.end),
      allDay: Boolean(e.start?.date),
      location: e.location?.trim() || undefined,
      notes: plainText(e.description),
      repeating: Boolean(e.recurringEventId),
    }));
    return { events: events.filter((e) => e.start && e.end), error };
  }

  /** Forget what was fetched for a calendar, after a change, so the next look is current. */
  private forgetCache(id: string) {
    this.ics.delete(id);
    for (const m of [this.dav, this.google])
      for (const k of [...m.keys()]) if (k.startsWith(`${id}|`)) m.delete(k);
  }

  // -------------------------------------------------------------------------
  // Events

  private calendarFor(person: Profile, id: string, write: boolean): Calendar {
    const c = this.file.calendars.find((x) => x.id === id);
    if (!c || !canRead(c, person.id)) throw new CalendarError("There's no such calendar.", 404);
    if (write && (!canWrite(c, person.id) || c.kind === "ics"))
      throw new CalendarError(
        c.kind === "ics" || c.readOnly
          ? `${c.name} can't be changed from Hearth.`
          : `You can see ${c.name}, but not add to it.`,
        403,
      );
    return c;
  }

  private checkPeople(people: string[]) {
    const known = new Set(this.deps.profiles().map((p) => p.id));
    const unknown = people.filter((p) => !known.has(p));
    if (unknown.length) throw new CalendarError(`There's nobody called ${unknown.join(", ")}.`);
  }

  async createEvent(person: Profile, input: EventInput): Promise<{ ref: string; series: string }> {
    const c = this.calendarFor(person, input.calendar, true);
    this.checkPeople(input.people);
    let ref: string;
    if (c.kind === "hearth") {
      ref = newId(person.id);
      const id = ref;
      await this.deps.store.update((f) => {
        f.events.push(hearthEvent(id, c.id, input, person.id, this.now()));
      });
    } else if (c.kind === "caldav") {
      const uid = `${randomBytes(12).toString("hex")}@hearth`;
      const saved = await this.davClient(this.accountOf(c)).put(
        c.remote as string,
        eventIcs(input, uid),
        { uid },
      );
      ref = saved.href;
    } else {
      const made = await this.googleAccount(this.accountOf(c)).create(c.remote as string, input);
      ref = made.id;
    }
    this.forgetCache(c.id);
    await this.setTags(person, c.id, ref, input.people, false);
    return { ref, series: ref };
  }

  async updateEvent(
    person: Profile,
    at: { calendar: string; ref: string; instance?: string; etag?: string; scope: "one" | "all" },
    input: EventInput,
  ): Promise<void> {
    const c = this.calendarFor(person, at.calendar, true);
    if (input.calendar !== at.calendar) {
      // Moving to another calendar: make it there, then take it out of here.
      this.calendarFor(person, input.calendar, true);
      await this.createEvent(person, input);
      await this.deleteEvent(person, { ...at, scope: "all" });
      return;
    }
    this.checkPeople(input.people);
    let series = at.ref;
    if (c.kind === "hearth") {
      const old = this.file.events.find((e) => e.id === at.ref && e.calendar === c.id);
      if (!old) throw new CalendarError("That event is gone. It may have been deleted.", 404);
      if ((old.repeat || old.rrule) && at.scope === "one" && at.instance) {
        // Just this time: it becomes an event of its own, and the series skips it.
        const instance = at.instance;
        const id = newId(person.id);
        await this.deps.store.update((f) => {
          const e = f.events.find((x) => x.id === old.id);
          if (e) e.except = [...new Set([...e.except, instance])];
          f.events.push(
            hearthEvent(id, c.id, { ...input, repeat: undefined }, person.id, this.now()),
          );
        });
        series = id;
      } else {
        await this.deps.store.update((f) => {
          const e = f.events.find((x) => x.id === old.id);
          if (!e) return;
          // An imported event keeps its own repeat rule when asked ("every time", rule unchanged).
          const keep = input.keepRule && !input.repeat && e.rrule ? e.rrule : undefined;
          Object.assign(e, hearthEvent(e.id, c.id, input, e.createdBy, this.now()), {
            rrule: keep,
            uid: e.uid,
            except: input.repeat || keep ? e.except : [],
          });
        });
      }
    } else if (c.kind === "caldav") {
      const obj = this.davObject(c, at.ref);
      if (!obj) throw new CalendarError("Look at the calendar again: that event has changed.", 409);
      const uid = parseCalendar(obj.ics)
        .getFirstSubcomponent("vevent")
        ?.getFirstPropertyValue("uid");
      await this.davClient(this.accountOf(c)).put(
        c.remote as string,
        eventIcs(input, String(uid ?? randomBytes(12).toString("hex")), obj.ics),
        { href: at.ref, etag: at.etag ?? obj.etag },
      );
    } else {
      const g = this.googleAccount(this.accountOf(c));
      const raw = this.googleCached(c, at.ref);
      series = raw?.recurringEventId ?? at.ref;
      // A repeating Google event is changed one time at a time from here.
      await g.update(c.remote as string, at.ref, input, !raw?.recurringEventId);
    }
    this.forgetCache(c.id);
    await this.setTags(person, c.id, series, input.people, false);
  }

  private davObject(c: Calendar, href: string): DavObject | undefined {
    for (const [k, v] of this.dav)
      if (k.startsWith(`${c.id}|`)) {
        const o = v.value?.find((x) => sameHref(x.href, href));
        if (o) return o;
      }
    return undefined;
  }

  private googleCached(c: Calendar, id: string): GoogleEvent | undefined {
    for (const [k, v] of this.google)
      if (k.startsWith(`${c.id}|`)) {
        const e = v.value?.find((x) => x.id === id);
        if (e) return e;
      }
    return undefined;
  }

  async deleteEvent(
    person: Profile,
    at: { calendar: string; ref: string; instance?: string; etag?: string; scope: "one" | "all" },
  ): Promise<void> {
    const c = this.calendarFor(person, at.calendar, true);
    let series = at.ref;
    let whole = true;
    if (c.kind === "hearth") {
      const e = this.file.events.find((x) => x.id === at.ref && x.calendar === c.id);
      if (!e) return;
      if ((e.repeat || e.rrule) && at.scope === "one" && at.instance) {
        const instance = at.instance;
        whole = false;
        await this.deps.store.update((f) => {
          const x = f.events.find((y) => y.id === e.id);
          if (x) x.except = [...new Set([...x.except, instance])];
        });
      } else {
        await this.deps.store.update((f) => {
          f.events = f.events.filter((x) => x.id !== e.id);
        });
      }
    } else if (c.kind === "caldav") {
      const obj = this.davObject(c, at.ref);
      if (at.scope === "one" && at.instance)
        throw new CalendarError(
          "Delete one time of a repeating event in the calendar's own app, or delete them all.",
        );
      await this.davClient(this.accountOf(c)).remove(at.ref, at.etag ?? obj?.etag);
    } else {
      const raw = this.googleCached(c, at.ref);
      const g = this.googleAccount(this.accountOf(c));
      if (raw?.recurringEventId && at.scope === "all") {
        series = raw.recurringEventId;
        await g.remove(c.remote as string, raw.recurringEventId);
      } else {
        if (raw?.recurringEventId) whole = false;
        await g.remove(c.remote as string, at.ref);
      }
    }
    this.forgetCache(c.id);
    if (whole)
      await this.deps.store.update((f) => {
        f.tags = f.tags.filter((t) => !(t.calendar === c.id && t.series === series));
      });
  }

  /** Who's tagged on an event (or a repeating series). Only someone who may change it may. */
  async setTags(
    person: Profile,
    calendar: string,
    series: string,
    people: string[],
    check = true,
  ): Promise<void> {
    if (check) {
      this.calendarFor(person, calendar, true);
      this.checkPeople(people);
    }
    const list = [...new Set(people)];
    const current = this.file.tags.find((t) => t.calendar === calendar && t.series === series);
    if (!list.length && !current) return;
    if (current && JSON.stringify(current.people) === JSON.stringify(list)) return;
    await this.deps.store.update((f) => {
      f.tags = f.tags.filter((t) => !(t.calendar === calendar && t.series === series));
      if (list.length) f.tags.push({ calendar, series, people: list });
    });
  }

  // -------------------------------------------------------------------------
  // Calendars and accounts

  private mustOwn(person: Profile, id: string): Calendar {
    const c = this.file.calendars.find((x) => x.id === id);
    if (!c || c.owner !== person.id)
      throw new CalendarError("That isn't one of your calendars.", 404);
    return c;
  }

  private unlocked(person: Profile) {
    if (isLocked(person))
      throw new CalendarError("This page is locked. Ask the admin to add calendars.", 403);
  }

  async createCalendar(
    person: Profile,
    b: {
      kind: "hearth" | "ics";
      name: string;
      color: string;
      url?: string;
      shareWith: string[];
      shareEdit: boolean;
    },
  ): Promise<Calendar> {
    this.unlocked(person);
    this.checkPeople(b.shareWith);
    const id = newId(person.id);
    if (b.kind === "ics") {
      if (!b.url)
        throw new CalendarError("Paste the calendar's address (it ends in .ics, usually).");
      // Check it's really a calendar before keeping it.
      parseCalendar(await this.fetchIcs(b.url));
      await this.deps.secrets.set(secretOf(id), b.url.trim());
    }
    const cal: Calendar = {
      id,
      owner: person.id,
      kind: b.kind,
      name: b.name,
      color: b.color,
      readOnly: b.kind === "ics",
      shareWith: b.shareWith.filter((p) => p !== person.id),
      shareEdit: b.kind === "hearth" ? b.shareEdit : false,
      refreshMinutes: b.kind === "ics" ? 60 : 15,
    };
    await this.deps.store.update((f) => {
      f.calendars.push(cal);
    });
    return cal;
  }

  async updateCalendar(
    person: Profile,
    id: string,
    b: {
      name?: string;
      color?: string;
      shareWith?: string[];
      shareEdit?: boolean;
      refreshMinutes?: number;
      url?: string;
    },
  ): Promise<void> {
    const c = this.mustOwn(person, id);
    if (b.shareWith || b.url) this.unlocked(person);
    if (b.shareWith) this.checkPeople(b.shareWith);
    if (b.url && c.kind === "ics") {
      parseCalendar(await this.fetchIcs(b.url));
      await this.deps.secrets.set(secretOf(id), b.url.trim());
      this.forgetCache(id);
    }
    await this.deps.store.update((f) => {
      const x = f.calendars.find((y) => y.id === id);
      if (!x) return;
      if (b.name !== undefined) x.name = b.name;
      if (b.color !== undefined) x.color = b.color;
      if (b.shareWith !== undefined) x.shareWith = b.shareWith.filter((p) => p !== person.id);
      if (b.shareEdit !== undefined) x.shareEdit = b.shareEdit && !x.readOnly;
      if (b.refreshMinutes !== undefined) x.refreshMinutes = b.refreshMinutes;
    });
    if (b.refreshMinutes !== undefined) this.forgetCache(id);
  }

  async deleteCalendar(person: Profile, id: string): Promise<void> {
    this.mustOwn(person, id);
    await this.removeCalendars([id]);
  }

  private async removeCalendars(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const gone = new Set(ids);
    await this.deps.store.update((f) => {
      f.calendars = f.calendars.filter((c) => !gone.has(c.id));
      f.events = f.events.filter((e) => !gone.has(e.calendar));
      f.tags = f.tags.filter((t) => !gone.has(t.calendar));
      for (const [p, list] of Object.entries(f.off)) f.off[p] = list.filter((x) => !gone.has(x));
    });
    for (const id of ids) {
      this.forgetCache(id);
      if (this.deps.secrets.has(secretOf(id))) await this.deps.secrets.set(secretOf(id), null);
    }
  }

  async setOff(person: Profile, off: string[]): Promise<void> {
    await this.deps.store.update((f) => {
      f.off[person.id] = [...new Set(off)].slice(0, 200);
    });
  }

  /** Connect a CalDAV account: check the sign-in, and list its calendars. */
  async addCalDav(
    person: Profile,
    b: { url: string; username: string; password: string; name?: string },
  ): Promise<{ account: AccountInfo; calendars: RemoteCalendar[] }> {
    this.unlocked(person);
    const account: Account = {
      id: newId(person.id),
      owner: person.id,
      kind: "caldav",
      name: b.name?.trim() || `${b.username} at ${hostOf(b.url)}`.slice(0, 120),
      url: b.url.trim(),
      username: b.username,
    };
    const found = await new CalDav(
      { username: b.username, password: b.password },
      { policy: this.policy(), fetch: this.deps.fetch },
    ).discover(account.url as string);
    await this.deps.secrets.set(secretOf(account.id), JSON.stringify({ password: b.password }));
    await this.deps.store.update((f) => {
      f.accounts.push(account);
    });
    return {
      account: accountInfo(account),
      calendars: found.map((d) => ({
        remote: d.url,
        name: d.name,
        color: d.color,
        readOnly: d.readOnly,
        added: false,
      })),
    };
  }

  /** The calendars in one of this person's accounts, marking those already added. */
  async remoteCalendars(person: Profile, accountId: string): Promise<RemoteCalendar[]> {
    const a = this.file.accounts.find((x) => x.id === accountId && x.owner === person.id);
    if (!a) throw new CalendarError("That isn't one of your accounts.", 404);
    const added = new Set(
      this.file.calendars.filter((c) => c.account === a.id).map((c) => c.remote),
    );
    if (a.kind === "caldav") {
      const found = await this.davClient(a).discover(a.url as string);
      return found.map((d) => ({
        remote: d.url,
        name: d.name,
        color: d.color,
        readOnly: d.readOnly,
        added: added.has(d.url),
      }));
    }
    const list = await this.googleAccount(a).calendars();
    return list.map((g) => ({
      remote: g.id,
      name: g.summaryOverride ?? g.summary ?? g.id,
      color: g.backgroundColor,
      readOnly: !["owner", "writer"].includes(g.accessRole ?? ""),
      added: added.has(g.id),
    }));
  }

  /** Put an account's calendars on this person's calendar. */
  async addFromAccount(
    person: Profile,
    accountId: string,
    picks: { remote: string; name: string; color?: string; readOnly: boolean }[],
  ): Promise<void> {
    this.unlocked(person);
    const a = this.file.accounts.find((x) => x.id === accountId && x.owner === person.id);
    if (!a) throw new CalendarError("That isn't one of your accounts.", 404);
    const have = new Set(
      this.file.calendars.filter((c) => c.account === a.id).map((c) => c.remote),
    );
    let n = this.file.calendars.filter((c) => c.owner === person.id).length;
    await this.deps.store.update((f) => {
      for (const p of picks) {
        if (have.has(p.remote)) continue;
        f.calendars.push({
          id: newId(person.id),
          owner: person.id,
          kind: a.kind,
          name: p.name.slice(0, 60) || "Calendar",
          color:
            p.color && /^#[0-9a-f]{6}$/i.test(p.color.slice(0, 7))
              ? p.color.slice(0, 7)
              : (CAL_COLORS[n++ % CAL_COLORS.length] as string),
          account: a.id,
          remote: p.remote,
          readOnly: p.readOnly,
          shareWith: [],
          shareEdit: false,
          refreshMinutes: 15,
        });
      }
    });
  }

  async deleteAccount(person: Profile, accountId: string): Promise<void> {
    const a = this.file.accounts.find((x) => x.id === accountId && x.owner === person.id);
    if (!a) throw new CalendarError("That isn't one of your accounts.", 404);
    await this.removeCalendars(
      this.file.calendars.filter((c) => c.account === a.id).map((c) => c.id),
    );
    await this.deps.store.update((f) => {
      f.accounts = f.accounts.filter((x) => x.id !== a.id);
    });
    this.accounts.delete(a.id);
    await this.deps.secrets.set(secretOf(a.id), null);
  }

  /** The address to send this person to, to connect a Google account. */
  /**
   * Start connecting a Google account. `home` is the address this page was opened at
   * (https://start.home): with a return page set up, Google's answer comes back there.
   */
  googleStart(person: Profile, home?: string): { url: string; returns: boolean } {
    this.unlocked(person);
    const settings = this.deps.settings().calendar;
    if (!settings.allowInternet)
      throw new CalendarError(
        "Calendars can't reach the internet yet. The admin can allow it in Settings → Calendars.",
      );
    const via =
      settings.googleReturnPage && home ? { page: settings.googleReturnPage, home } : undefined;
    const { url, pending } = startSignIn(this.googleClient(), person.id, this.now(), via);
    for (const [k, v] of this.pending) if (v.expires < this.now()) this.pending.delete(k);
    this.pending.set(pending.state, pending);
    return { url, returns: Boolean(via) };
  }

  async googleFinish(
    person: Profile,
    pasted: string,
  ): Promise<{ account: AccountInfo; calendars: RemoteCalendar[] }> {
    this.unlocked(person);
    const got = readPasted(pasted);
    if (got.error === "access_denied")
      throw new CalendarError("Google says access wasn't allowed. Start again and press Allow.");
    if (got.error)
      throw new CalendarError(`Google stopped the sign-in (${got.error}). Start again.`);
    if (!got.code) throw new CalendarError("Paste the whole address Google sent you to.");
    let pending: PendingSignIn | undefined;
    if (got.state) pending = this.pending.get(got.state);
    else {
      // Only the code: fine if this person has exactly one sign-in going.
      const mine = [...this.pending.values()].filter((p) => p.person === person.id);
      pending = mine.length === 1 ? mine[0] : undefined;
    }
    if (!pending || pending.person !== person.id || pending.expires < this.now())
      throw new CalendarError("That sign-in is old or isn't yours. Start again.");
    this.pending.delete(pending.state);
    const client = this.googleClient();
    const tokens = await finishSignIn(
      client,
      got.code,
      pending.verifier,
      { policy: this.policy(), fetch: this.deps.fetch },
      pending.redirect,
    );
    const g = new GoogleAccount(client, tokens.refresh, {
      policy: this.policy(),
      fetch: this.deps.fetch,
    }).prime(tokens.access, tokens.expires);
    const list = await g.calendars();
    const primary = list.find((c) => c.primary);
    const name = (primary?.id ?? "Google").slice(0, 120);
    // Signing in again to an account already here (its sign-in ran out, as a test app's does
    // after 7 days) renews it, and its calendars carry on as they were.
    const known = this.file.accounts.find(
      (a) => a.owner === person.id && a.kind === "google" && a.name === name,
    );
    const account: Account = known ?? {
      id: newId(person.id),
      owner: person.id,
      kind: "google",
      name,
    };
    await this.deps.secrets.set(secretOf(account.id), JSON.stringify({ refresh: tokens.refresh }));
    if (!known)
      await this.deps.store.update((f) => {
        f.accounts.push(account);
      });
    this.accounts.set(account.id, g);
    const added = new Set(
      this.file.calendars.filter((c) => c.account === account.id).map((c) => c.remote),
    );
    for (const c of this.file.calendars) if (c.account === account.id) this.forgetCache(c.id);
    return {
      account: accountInfo(account),
      calendars: list.map((c) => ({
        remote: c.id,
        name: c.summaryOverride ?? c.summary ?? c.id,
        color: c.backgroundColor,
        readOnly: !["owner", "writer"].includes(c.accessRole ?? ""),
        added: added.has(c.id),
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Importing a file, and downloading a Hearth calendar

  /**
   * Bring a calendar file's events into one of this person's calendars: Hearth's own (kept here),
   * or a CalDAV or Google calendar (sent there). With `dryRun`, only says what it would do.
   * Importing the same file again adds nothing: events are known by the file's own ids.
   */
  async importIcs(
    person: Profile,
    b: {
      calendar?: string;
      newCalendar?: { name: string; color: string };
      ics: string;
      timeZone: string;
      dryRun: boolean;
    },
  ): Promise<ImportSummary & { calendar?: string }> {
    const file = readImport(b.ics, b.timeZone);
    const summary: ImportSummary = {
      events: file.events.filter((e) => !e.uid.includes("#")).length,
      repeating: file.repeating,
      changedTimes: file.changedTimes,
      duplicates: 0,
      added: 0,
      first: file.first,
      last: file.last,
      notes: file.notes,
    };
    if (!file.events.length) throw new CalendarError("That file has no events in it.");

    let target: Calendar | undefined;
    if (b.calendar) target = this.calendarFor(person, b.calendar, true);
    else if (!b.newCalendar) throw new CalendarError("Choose which calendar to import into.");
    else this.unlocked(person);

    if (!target || target.kind === "hearth") {
      const known = new Set(
        this.file.events
          .filter((e) => target && e.calendar === target.id && e.uid)
          .map((e) => e.uid),
      );
      const fresh = file.events.filter((e) => !known.has(e.uid));
      summary.duplicates = file.events.length - fresh.length;
      if (b.dryRun) return summary;
      if (!target && b.newCalendar)
        target = await this.createCalendar(person, {
          kind: "hearth",
          name: b.newCalendar.name,
          color: b.newCalendar.color,
          shareWith: [],
          shareEdit: false,
        });
      const into = target as Calendar;
      const now = new Date(this.now()).toISOString();
      await this.deps.store.update((f) => {
        for (const e of fresh)
          f.events.push({
            id: newId(person.id),
            calendar: into.id,
            title: e.title,
            start: e.start,
            end: e.end,
            allDay: e.allDay,
            timeZone: e.timeZone,
            location: e.location,
            notes: e.notes,
            repeat: e.repeat,
            rrule: e.rrule,
            except: e.except,
            uid: e.uid,
            createdBy: person.id,
            updated: now,
          });
      });
      summary.added = fresh.length;
      this.forgetCache(into.id);
      return { ...summary, calendar: into.id };
    }

    if (target.kind === "ics")
      throw new CalendarError(`${target.name} can't be changed from Hearth.`);
    if (b.dryRun) return summary;
    const account = this.accountOf(target);
    let failed = 0;
    let problem = "";
    if (target.kind === "caldav") {
      const dav = this.davClient(account);
      for (const o of file.objects) {
        try {
          await dav.put(target.remote as string, o.ics, { uid: o.uid });
          summary.added++;
        } catch (e) {
          if (e instanceof CalDavError && /changed that event elsewhere/.test(e.message))
            summary.duplicates++;
          else {
            failed++;
            problem ||= this.problem(e);
          }
        }
      }
      // The summary counts events; the server takes each with its moved times, as one.
      summary.added = Math.min(summary.added, summary.events);
    } else {
      const g = this.googleAccount(account);
      for (const e of file.events) {
        try {
          await g.importEvent(target.remote as string, e);
          if (!e.uid.includes("#")) summary.added++;
        } catch (err) {
          failed++;
          problem ||= this.problem(err);
        }
      }
    }
    this.forgetCache(target.id);
    if (failed) summary.notes.push(`${failed} couldn't be added${problem ? `: ${problem}` : ""}.`);
    return { ...summary, calendar: target.id };
  }

  /** A Hearth calendar as an .ics file, for anyone who may see it. */
  exportIcs(person: Profile, id: string): { name: string; ics: string } {
    const c = this.calendarFor(person, id, false);
    if (c.kind !== "hearth")
      throw new CalendarError(
        `${c.name} lives in ${c.kind === "google" ? "Google" : "its own app"}; download it there.`,
      );
    const events = this.file.events.filter((e) => e.calendar === c.id);
    return { name: c.name, ics: calendarIcs(c.name, events) };
  }

  /** Someone's id changed in Settings: everything of theirs follows. */
  async renamePerson(from: string, to: string): Promise<void> {
    if (from === to) return;
    const swap = (x: string) => (x === from ? to : x);
    await this.deps.store.update((d) => {
      for (const a of d.accounts) a.owner = swap(a.owner);
      for (const c of d.calendars) {
        c.owner = swap(c.owner);
        c.shareWith = c.shareWith.map(swap);
      }
      for (const e of d.events) e.createdBy = swap(e.createdBy);
      for (const t of d.tags) t.people = t.people.map(swap);
      if (d.off[from]) {
        d.off[to] = d.off[from].map((x) => (x === `${FROM}${from}` ? `${FROM}${to}` : x));
        delete d.off[from];
      }
      for (const [p, list] of Object.entries(d.off))
        d.off[p] = list.map((x) => (x === `${FROM}${from}` ? `${FROM}${to}` : x));
    });
  }

  /** Someone was taken out of Hearth: their calendars, accounts and tags go too. */
  async forget(personId: string): Promise<void> {
    const f = this.file;
    const accounts = f.accounts.filter((a) => a.owner === personId).map((a) => a.id);
    await this.removeCalendars(f.calendars.filter((c) => c.owner === personId).map((c) => c.id));
    await this.deps.store.update((d) => {
      d.accounts = d.accounts.filter((a) => a.owner !== personId);
      delete d.off[personId];
      for (const c of d.calendars) c.shareWith = c.shareWith.filter((p) => p !== personId);
      d.tags = d.tags
        .map((t) => ({ ...t, people: t.people.filter((p) => p !== personId) }))
        .filter((t) => t.people.length);
    });
    for (const id of accounts) {
      this.accounts.delete(id);
      if (this.deps.secrets.has(secretOf(id))) await this.deps.secrets.set(secretOf(id), null);
    }
  }
}

const hostOf = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};

const accountInfo = (a: Account): AccountInfo => ({
  id: a.id,
  kind: a.kind,
  name: a.name,
  url: a.url,
  username: a.username,
});

function hearthEvent(
  id: string,
  calendar: string,
  input: EventInput,
  by: string,
  now: number,
): HearthEvent {
  const instant = (w: string) => (input.allDay ? w.slice(0, 10) : new Date(toMs(w)).toISOString());
  return {
    id,
    calendar,
    title: input.title,
    start: instant(input.start),
    end: instant(input.end),
    allDay: input.allDay,
    timeZone: input.timeZone,
    location: input.location?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    repeat: input.repeat,
    until: input.repeat ? input.until : undefined,
    except: [],
    createdBy: by,
    updated: new Date(now).toISOString(),
  };
}

const FREQ: Record<Repeat, string> = {
  daily: "DAILY",
  weekly: "WEEKLY",
  monthly: "MONTHLY",
  yearly: "YEARLY",
};

/**
 * The times a repeating Hearth event happens in a range. It repeats at the same time of day in
 * the zone it was made in, so a weekly 9:00 stays 9:00 after the clocks change.
 */
export function expandHearth(e: HearthEvent, from: number, to: number) {
  const tz = e.allDay ? undefined : e.timeZone && isZone(e.timeZone) ? e.timeZone : "UTC";
  const wall = (w: string) =>
    e.allDay
      ? w.slice(0, 10).replace(/-/g, "")
      : new Date(utcToWall(toMs(w), tz as string)).toISOString().slice(0, 19).replace(/[-:]/g, "");
  const value = e.allDay ? ";VALUE=DATE" : "";
  const until = e.until ? `;UNTIL=${e.until.replace(/-/g, "")}${e.allDay ? "" : "T235959"}` : "";
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:x",
    `DTSTART${value}:${wall(e.start)}`,
    `DTEND${value}:${wall(e.end)}`,
    e.rrule ? `RRULE:${e.rrule}` : `RRULE:FREQ=${FREQ[e.repeat as Repeat]}${until}`,
    "SUMMARY:x",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  // Widen the range by a day each way: the times here are wall-clock times, not yet instants.
  return occurrences(ics, from - DAY, to + DAY).map((o) =>
    e.allDay
      ? { start: o.start, end: o.end }
      : {
          start: new Date(wallToUtc(toMs(o.start), tz as string)).toISOString(),
          end: new Date(wallToUtc(toMs(o.end), tz as string)).toISOString(),
        },
  );
}
