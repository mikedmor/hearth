/**
 * The internet controls' routes.
 *
 * - /api/family: the Family page, for the admin and the parents they chose (each with a PIN).
 * - /api/admin/internet: the house-wide part (on or off, history length, who the parents are).
 * - /api/internet: the device's own (what rules it follows, a grown-up unlocking it).
 */
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { Profile } from "../../shared/config";
import { DoorPatchSchema, PersonRulesSchema, SiteSchema } from "../../shared/internet";
import { InternetError, type InternetService } from "./service";

export interface InternetRouteDeps {
  service: InternetService;
  requireAdmin: (c: Context) => unknown;
  who: (c: Context) => { admin: boolean; profile: Profile | null };
  body: <T>(c: Context, schema: z.ZodType<T>) => Promise<T>;
  here: (c: Context) => { ip?: string; browser?: string };
  profiles: () => Profile[];
  checkPin: (profile: string, pin: string) => Promise<void>;
  changed: () => void;
}

/** 5 minutes to 12 hours. */
const minutes = z.number().int().min(5).max(720);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function internetRoutes(app: Hono, d: InternetRouteDeps): void {
  const done = (c: Context) => {
    d.changed();
    return c.json({ ok: true });
  };

  /** The admin or a parent; returns who, for "paused by". */
  const parent = (c: Context): string => {
    const w = d.who(c);
    if (!d.service.isParent(w)) {
      if (w.profile && !w.admin)
        throw new InternetError(
          "The Family page is for the admin and the parents they choose (with a PIN).",
          403,
        );
      throw new InternetError("Sign in as a parent first.", 403);
    }
    return w.admin && !w.profile ? "admin" : (w.profile?.id ?? "admin");
  };

  // -------------------------------------------------------------------------
  // The Family page

  app.get("/api/family", async (c) => {
    parent(c);
    c.header("Cache-Control", "no-store");
    return c.json(await d.service.family(d.who(c).admin));
  });

  app.get("/api/family/:id", async (c) => {
    parent(c);
    c.header("Cache-Control", "no-store");
    const which = day.safeParse(c.req.query("day"));
    const device = c.req.query("device")?.slice(0, 64) || undefined;
    return c.json(
      await d.service.childView(c.req.param("id"), which.success ? which.data : undefined, device),
    );
  });

  app.put("/api/family/:id/rules", async (c) => {
    parent(c);
    await d.service.setPerson(c.req.param("id"), await d.body(c, PersonRulesSchema));
    return done(c);
  });

  app.post("/api/family/:id/allow", async (c) => {
    parent(c);
    const b = await d.body(c, z.object({ site: SiteSchema }));
    await d.service.allow(c.req.param("id"), b.site);
    return done(c);
  });

  app.post("/api/family/:id/dismiss", async (c) => {
    parent(c);
    const b = await d.body(c, z.object({ site: SiteSchema, on: z.boolean().default(true) }));
    await d.service.dismiss(c.req.param("id"), b.site, b.on);
    return done(c);
  });

  app.post("/api/family/:id/pause", async (c) => {
    const by = parent(c);
    const b = await d.body(c, z.object({ minutes: minutes.nullable() }));
    await d.service.pause(c.req.param("id"), b.minutes, by);
    return done(c);
  });

  app.post("/api/family/:id/resume", async (c) => {
    parent(c);
    await d.service.resume(c.req.param("id"));
    return done(c);
  });

  app.post("/api/family/:id/check", async (c) => {
    parent(c);
    const b = await d.body(c, z.object({ site: SiteSchema }));
    return c.json(await d.service.check(c.req.param("id"), b.site));
  });

  /** Answer a child's request: yes (unlock for the time asked, or allow the site) or no. */
  app.post("/api/family/requests/:id", async (c) => {
    const by = parent(c);
    const b = await d.body(c, z.object({ approve: z.boolean(), minutes: minutes.optional() }));
    await d.service.answer(c.req.param("id"), b.approve, by, b.minutes);
    return done(c);
  });

  /** Let a device in at the front door, or say not now. */
  app.post("/api/family/door/:ip", async (c) => {
    const by = parent(c);
    const b = await d.body(
      c,
      z.object({
        admit: z.boolean(),
        name: z.string().trim().max(80).optional(),
        days: z.number().int().min(0).max(365).optional(),
      }),
    );
    const ip = c.req.param("ip");
    if (b.admit) await d.service.admit(ip, by, b.name, b.days);
    else d.service.dismissVisitor(ip);
    return done(c);
  });

  /** The apps and services AdGuard Home can block. */
  app.get("/api/family/services", async (c) => {
    parent(c);
    return c.json({ services: await d.service.services() });
  });

  app.post("/api/family/devices/:id/unlock", async (c) => {
    const by = parent(c);
    const b = await d.body(c, z.object({ minutes }));
    const dev = d.service.childDevice(c.req.param("id"));
    await d.service.unlock(dev.id, b.minutes, by);
    return done(c);
  });

  app.post("/api/family/devices/:id/lock", async (c) => {
    parent(c);
    const dev = d.service.childDevice(c.req.param("id"));
    await d.service.lock(dev.id);
    return done(c);
  });

  // -------------------------------------------------------------------------
  // House-wide (the admin's)

  app.get("/api/admin/internet", (c) => {
    d.requireAdmin(c);
    return c.json(d.service.view());
  });

  app.put("/api/admin/internet", async (c) => {
    d.requireAdmin(c);
    const b = await d.body(
      c,
      z.object({
        enabled: z.boolean().optional(),
        historyDays: z.number().int().min(1).max(365).optional(),
        parents: z.array(z.string().max(40)).max(30).optional(),
        notify: z
          .object({
            url: z
              .string()
              .trim()
              .max(500)
              .refine(
                (u) => !u || /^https?:\/\/[^\s]+$/.test(u),
                "a web address (http:// or https://)",
              )
              .optional(),
            blocked: z.boolean().default(false),
          })
          .optional(),
      }),
    );
    await d.service.setOptions(b);
    return done(c);
  });

  // -------------------------------------------------------------------------
  // The front door (the admin's)

  app.get("/api/admin/door", (c) => {
    d.requireAdmin(c);
    return c.json(d.service.doorView());
  });

  app.put("/api/admin/door", async (c) => {
    d.requireAdmin(c);
    const b = await d.body(
      c,
      DoorPatchSchema.extend({
        /** A new house password; null takes it away; left out keeps it. */
        password: z.string().max(100).nullable().optional(),
      }),
    );
    const r = await d.service.setDoor(b, d.here(c));
    d.changed();
    return c.json({ ok: true, ...r });
  });

  app.delete("/api/admin/door/admitted/:ip", async (c) => {
    d.requireAdmin(c);
    await d.service.unadmit(c.req.param("ip"));
    return done(c);
  });

  /** Send a test alert to the address the admin gave. */
  app.post("/api/admin/internet/notify/test", async (c) => {
    d.requireAdmin(c);
    await d.service.tell("Hearth test", "Alerts from Hearth's Family page will arrive here.");
    const v = d.service.view();
    if (!v.notify.url) throw new InternetError("Give an address first.", 400);
    if (v.notify.error) throw new InternetError(v.notify.error, 400);
    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // The device this page is open on

  app.get("/api/internet/here", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(d.service.here(d.here(c)));
  });

  /** A grown-up lifts this device's rules for a while, with their own PIN (or as the admin). */
  app.post("/api/internet/unlock", async (c) => {
    const b = await d.body(
      c,
      z.object({
        profile: z.string().max(40).optional(),
        pin: z.string().max(8).optional(),
        minutes,
      }),
    );
    const here = d.service.here(d.here(c));
    if (!here.ruled || !here.device)
      throw new InternetError("This device isn't limited, so there's nothing to unlock.", 409);
    let by: string;
    if (d.who(c).admin && !b.profile) by = "admin";
    else {
      const p = d.profiles().find((x) => x.id === b.profile);
      if (!p || (p.role !== "adult" && p.role !== "admin"))
        throw new InternetError("Only a grown-up can unlock this device.", 403);
      if (!b.pin) throw new InternetError("Type your PIN.", 400);
      await d.checkPin(p.id, b.pin);
      by = p.id;
    }
    await d.service.unlock(here.device, b.minutes, by);
    return done(c);
  });

  /** A child asks from their device: more time, or a site. Parents see it on the Family page. */
  app.post("/api/internet/ask", async (c) => {
    const b = await d.body(
      c,
      z.object({
        kind: z.enum(["time", "site"]),
        minutes: z.number().int().min(15).max(240).optional(),
        site: z.string().trim().max(253).optional(),
        note: z.string().trim().max(140).optional(),
      }),
    );
    const req = await d.service.ask(d.here(c), b);
    d.changed();
    return c.json({ ok: true, request: req });
  });

  // -------------------------------------------------------------------------
  // The welcome page (anyone on the network)

  app.get("/api/door/here", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(d.service.doorHere(d.here(c).ip));
  });

  app.post("/api/door/enter", async (c) => {
    const b = await d.body(c, z.object({ password: z.string().max(100) }));
    await d.service.enter(d.here(c).ip, b.password);
    return done(c);
  });

  app.post("/api/door/ask", async (c) => {
    const b = await d.body(c, z.object({ name: z.string().trim().max(80).optional() }));
    await d.service.askIn(d.here(c).ip, b.name);
    d.changed();
    return c.json({ ok: true });
  });

  /** Put this device's rules back now (anyone on it may). */
  app.post("/api/internet/lock", async (c) => {
    const here = d.service.here(d.here(c));
    if (here.device) await d.service.lock(here.device);
    return done(c);
  });
}
