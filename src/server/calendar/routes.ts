/**
 * The calendar's routes. Everything is for the person whose page is open: their own
 * calendars, what's shared with them, and their events. The admin sets up the internet switch
 * and Google's client, and sees nobody's calendar.
 */
import type { Context, Hono } from "hono";
import { z } from "zod";
import { EventInputSchema, GOOGLE_CLIENT_SECRET } from "../../shared/calendar";
import { type HearthConfig, isLocalUrl, type Profile } from "../../shared/config";
import type { ConfigStore } from "../config-store";
import type { SecretStore } from "../secrets";
import { CalendarError, type CalendarService } from "./service";

export interface CalendarRouteDeps {
  service: CalendarService;
  config: ConfigStore;
  secrets: SecretStore;
  /** The open profile, or null; and whether the admin is signed in. */
  who: (c: Context) => { profile: Profile | null; admin: boolean };
  hasPin: (profile: string) => boolean;
  body: <T>(c: Context, schema: z.ZodType<T>) => Promise<T>;
  /** Tell open pages to look again. */
  changed: () => void;
}

const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const person = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const where = z.object({
  calendar: id,
  ref: z.string().min(1).max(1000),
  instance: z.string().max(40).optional(),
  etag: z.string().max(200).optional(),
  scope: z.enum(["one", "all"]).default("all"),
});

export function calendarRoutes(app: Hono, d: CalendarRouteDeps): void {
  const me = (c: Context): Profile => {
    const w = d.who(c);
    const p = w.profile;
    if (!p)
      throw new CalendarError("Pick who you are first: calendars are each person's own.", 403);
    if (!w.admin && !d.config.get().settings.features.calendar.includes(p.role))
      throw new CalendarError("The calendar isn't turned on for you.", 403);
    return p;
  };
  const done = (c: Context, extra: Record<string, unknown> = {}) => {
    d.changed();
    return c.json({ ok: true, ...extra });
  };

  app.get("/api/calendar", async (c) => {
    const p = me(c);
    const from = Date.parse(c.req.query("from") ?? "");
    const to = Date.parse(c.req.query("to") ?? "");
    if (!Number.isFinite(from) || !Number.isFinite(to))
      throw new CalendarError("Say which days: ?from=…&to=… (ISO dates).");
    return c.json(await d.service.view(p, from, to, d.hasPin(p.id)));
  });

  // Events ------------------------------------------------------------------

  app.post("/api/calendar/events", async (c) => {
    const made = await d.service.createEvent(me(c), await d.body(c, EventInputSchema));
    return done(c, made);
  });

  app.put("/api/calendar/events", async (c) => {
    const b = await d.body(c, z.object({ at: where, event: EventInputSchema }));
    await d.service.updateEvent(me(c), b.at, b.event);
    return done(c);
  });

  app.post("/api/calendar/events/delete", async (c) => {
    await d.service.deleteEvent(me(c), await d.body(c, where));
    return done(c);
  });

  app.put("/api/calendar/tags", async (c) => {
    const b = await d.body(
      c,
      z.object({
        calendar: id,
        series: z.string().min(1).max(1000),
        people: z.array(person).max(50),
      }),
    );
    await d.service.setTags(me(c), b.calendar, b.series, b.people);
    return done(c);
  });

  // Calendars ---------------------------------------------------------------

  app.post("/api/calendar/calendars", async (c) => {
    const b = await d.body(
      c,
      z.object({
        kind: z.enum(["hearth", "ics"]),
        name: z.string().trim().min(1, "Give it a name").max(60),
        color,
        url: z.string().trim().max(2000).optional(),
        shareWith: z.array(person).max(50).default([]),
        shareEdit: z.boolean().default(false),
      }),
    );
    const cal = await d.service.createCalendar(me(c), b);
    return done(c, { id: cal.id });
  });

  app.put("/api/calendar/calendars/:id", async (c) => {
    const b = await d.body(
      c,
      z.object({
        name: z.string().trim().min(1, "Give it a name").max(60).optional(),
        color: color.optional(),
        shareWith: z.array(person).max(50).optional(),
        shareEdit: z.boolean().optional(),
        refreshMinutes: z.number().int().min(5).max(1440).optional(),
        url: z.string().trim().max(2000).optional(),
      }),
    );
    await d.service.updateCalendar(me(c), c.req.param("id"), b);
    return done(c);
  });

  app.delete("/api/calendar/calendars/:id", async (c) => {
    await d.service.deleteCalendar(me(c), c.req.param("id"));
    return done(c);
  });

  /** Import a calendar file into one of your calendars (or a new one). `dryRun` only looks. */
  app.post("/api/calendar/import", async (c) => {
    const b = await d.body(
      c,
      z
        .object({
          calendar: id.optional(),
          newCalendar: z
            .object({ name: z.string().trim().min(1, "Give it a name").max(60), color })
            .optional(),
          ics: z
            .string()
            .min(1)
            .max(6 * 1024 * 1024, "Files can be up to 6 MB"),
          timeZone: z.string().max(60).default("UTC"),
          dryRun: z.boolean().default(false),
        })
        .refine((x) => x.calendar || x.newCalendar, "Choose which calendar to import into"),
    );
    const r = await d.service.importIcs(me(c), b);
    if (b.dryRun) return c.json(r);
    return done(c, { ...r });
  });

  /** A Hearth calendar as an .ics file. */
  app.get("/api/calendar/calendars/:id/export.ics", (c) => {
    const { name, ics } = d.service.exportIcs(me(c), c.req.param("id"));
    const file = `${name.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "calendar"}.ics`;
    return c.body(ics, 200, {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${file.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(file)}`,
      "cache-control": "no-store",
    });
  });

  /** What this person turned off: calendars, and "from:<person>" groups. */
  app.put("/api/calendar/off", async (c) => {
    const b = await d.body(c, z.object({ off: z.array(z.string().max(80)).max(200) }));
    await d.service.setOff(me(c), b.off);
    return c.json({ ok: true });
  });

  // Accounts ----------------------------------------------------------------

  app.post("/api/calendar/accounts/caldav", async (c) => {
    const b = await d.body(
      c,
      z.object({
        url: z.string().trim().min(1, "Give the server's address").max(500),
        username: z.string().trim().min(1, "Give your username").max(200),
        password: z.string().min(1, "Give your password").max(500),
        name: z.string().trim().max(120).optional(),
      }),
    );
    const r = await d.service.addCalDav(me(c), b);
    return done(c, r);
  });

  app.get("/api/calendar/accounts/:id/calendars", async (c) =>
    c.json({ calendars: await d.service.remoteCalendars(me(c), c.req.param("id")) }),
  );

  app.post("/api/calendar/accounts/:id/calendars", async (c) => {
    const b = await d.body(
      c,
      z.object({
        calendars: z
          .array(
            z.object({
              remote: z.string().min(1).max(1000),
              name: z.string().max(200),
              color: z.string().max(20).optional(),
              readOnly: z.boolean().default(false),
            }),
          )
          .min(1, "Pick at least one calendar")
          .max(50),
      }),
    );
    await d.service.addFromAccount(me(c), c.req.param("id"), b.calendars);
    return done(c);
  });

  app.delete("/api/calendar/accounts/:id", async (c) => {
    await d.service.deleteAccount(me(c), c.req.param("id"));
    return done(c);
  });

  app.post("/api/calendar/google/start", (c) => {
    // Where this page was opened (https://start.home), for Google's answer to come back to.
    // The cross-site check has already made sure the Origin is this site.
    const origin = c.req.header("origin");
    const home = origin && /^https?:\/\/[^/]+$/.test(origin) ? origin : undefined;
    return c.json(d.service.googleStart(me(c), home));
  });

  app.post("/api/calendar/google/finish", async (c) => {
    const b = await d.body(c, z.object({ pasted: z.string().min(1).max(4000) }));
    const r = await d.service.googleFinish(me(c), b.pasted);
    return done(c, r);
  });

  // The admin's part --------------------------------------------------------

  app.get("/api/admin/calendar", (c) => {
    if (!d.who(c).admin) throw new CalendarError("Sign in as the admin first.", 403);
    const s = d.config.get().settings.calendar;
    return c.json({
      allowInternet: s.allowInternet,
      googleClientId: s.googleClientId ?? "",
      googleSecret: d.secrets.has(GOOGLE_CLIENT_SECRET),
      googleReturnPage: s.googleReturnPage ?? "",
    });
  });

  app.put("/api/admin/calendar", async (c) => {
    if (!d.who(c).admin) throw new CalendarError("Sign in as the admin first.", 403);
    const b = await d.body(
      c,
      z.object({
        allowInternet: z.boolean().optional(),
        googleClientId: z.string().trim().max(200).optional(),
        /** null removes it; leaving it out keeps it. */
        googleSecret: z.string().trim().max(500).nullable().optional(),
        /** "" removes it (back to pasting the address). */
        googleReturnPage: z.string().trim().max(300).optional(),
      }),
    );
    if (b.googleClientId && !/\.apps\.googleusercontent\.com$/.test(b.googleClientId))
      throw new CalendarError("A Google client ID ends in .apps.googleusercontent.com.");
    if (b.googleReturnPage) {
      let page: URL | null = null;
      try {
        page = new URL(b.googleReturnPage);
      } catch {
        // Said below.
      }
      if (page?.protocol !== "https:" || isLocalUrl(page.href) || page.search || page.hash)
        throw new CalendarError(
          "The return page has to be a public https:// address, like https://you.github.io/hearth-public/google/.",
        );
    }
    await d.config.update((draft: HearthConfig) => {
      if (b.allowInternet !== undefined) draft.settings.calendar.allowInternet = b.allowInternet;
      if (b.googleClientId !== undefined)
        draft.settings.calendar.googleClientId = b.googleClientId || undefined;
      if (b.googleReturnPage !== undefined)
        draft.settings.calendar.googleReturnPage = b.googleReturnPage || undefined;
    });
    if (b.googleSecret !== undefined)
      await d.secrets.set(GOOGLE_CLIENT_SECRET, b.googleSecret || null);
    return done(c);
  });
}
