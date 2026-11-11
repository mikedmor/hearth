/** The devices page's routes: the admin's only. */
import type { Context, Hono } from "hono";
import { z } from "zod";
import {
  DEVICE_TYPES,
  KIND_ID,
  NewDeviceRulesSchema,
  PLACES,
  TREATMENTS,
} from "../../shared/devices";
import { HUB_NAMES, HUBS, type HubKind } from "../../shared/smarthome";
import type { ConfigStore } from "../config-store";
import type { SecretStore } from "../secrets";
import { type SmartHomeService, tokenSecret } from "../smarthome/service";
import { AdGuard } from "./adguard";
import { GlInet, RouterError } from "./glinet";
import type { DeviceMonitor } from "./monitor";

export const ROUTER_SECRET = "router:password";

import { ADGUARD_SECRET, DeviceError, type DeviceService } from "./service";

export interface DeviceRouteDeps {
  service: DeviceService;
  /** Services, presence, AI machines, pinball tables and watches. */
  monitor?: DeviceMonitor;
  /** The smart-home hubs. */
  smart?: SmartHomeService;
  config: ConfigStore;
  secrets: SecretStore;
  requireAdmin: (c: Context) => unknown;
  body: <T>(c: Context, schema: z.ZodType<T>) => Promise<T>;
  /** Where this request comes from: its address, and the browser's device cookie. */
  here: (c: Context) => { ip?: string; browser?: string };
  fetch?: typeof fetch;
}

const mac = z
  .string()
  .regex(/^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/, "a hardware address like 3c:22:fb:12:34:56");

export function deviceRoutes(app: Hono, d: DeviceRouteDeps): void {
  app.get("/api/admin/devices", async (c) => {
    d.requireAdmin(c);
    const view = await d.service.view(d.here(c));
    return c.json(d.monitor ? await d.monitor.decorate(view) : view);
  });

  /** Check a device's ports for services now (in the background; the page looks again). */
  app.post("/api/admin/devices/:key/scan", async (c) => {
    d.requireAdmin(c);
    if (!d.monitor) throw new DeviceError("Checking devices isn't running.");
    d.monitor.scanNow(c.req.param("key"));
    return c.json({ ok: true });
  });

  /** Two rows are one device (wired and Wi-Fi): merge them into the saved one. */
  app.post("/api/admin/devices/:key/merge", async (c) => {
    d.requireAdmin(c);
    const b = await d.body(c, z.object({ with: z.string().max(80) }));
    return c.json({ ok: true, id: await d.service.merge(c.req.param("key"), b.with) });
  });

  // Kinds of device the admin makes ("Pinball table").

  const kindBody = z.object({
    label: z.string().trim().min(1, "Give it a name").max(40),
    icon: z.string().max(80).default("lucide:circle-help"),
    place: z.enum(PLACES).default("entertainment"),
  });
  app.post("/api/admin/device-kinds", async (c) => {
    d.requireAdmin(c);
    return c.json({ ok: true, id: await d.service.saveKind(null, await d.body(c, kindBody)) });
  });
  app.put("/api/admin/device-kinds/:id", async (c) => {
    d.requireAdmin(c);
    await d.service.saveKind(c.req.param("id"), await d.body(c, kindBody));
    return c.json({ ok: true });
  });
  app.delete("/api/admin/device-kinds/:id", async (c) => {
    d.requireAdmin(c);
    await d.service.removeKind(c.req.param("id"));
    return c.json({ ok: true });
  });
  /** A built-in kind back as it came. */
  app.post("/api/admin/device-kinds/:id/restore", async (c) => {
    d.requireAdmin(c);
    await d.service.restoreKind(c.req.param("id"));
    return c.json({ ok: true });
  });

  // The router, for the network map.

  /** Connect the router: its address and admin password, checked (signed in) before saving. */
  app.put("/api/admin/router", async (c) => {
    d.requireAdmin(c);
    const b = await d.body(
      c,
      z.object({
        url: z.string().trim().max(300),
        /** null removes it; left out keeps it. */
        password: z.string().max(200).nullable().optional(),
      }),
    );
    if (b.url) {
      let u: URL;
      try {
        u = new URL(b.url);
      } catch {
        throw new DeviceError("Give the router's full address, like http://192.168.1.1.");
      }
      const password =
        b.password === undefined ? d.secrets.get(ROUTER_SECRET) : (b.password ?? undefined);
      try {
        await new GlInet({ url: u.origin, password, fetch: d.fetch }).map();
      } catch (e) {
        throw new DeviceError(e instanceof RouterError ? e.message : "The router didn't answer.");
      }
    }
    await d.config.update((draft) => {
      draft.settings.router.url = b.url ? new URL(b.url).origin : undefined;
    });
    if (b.password !== undefined) await d.secrets.set(ROUTER_SECRET, b.password || null);
    await d.monitor?.refreshRouterNow();
    return c.json({ ok: true });
  });

  // Smart-home hubs.

  app.get("/api/admin/smarthome", (c) => {
    d.requireAdmin(c);
    if (!d.smart) throw new DeviceError("Smart-home hubs aren't available.");
    return c.json(d.smart.view());
  });

  /** Connect a hub: its address and (optionally new) token, checked before saving. */
  app.put("/api/admin/smarthome/:kind", async (c) => {
    d.requireAdmin(c);
    const kind = c.req.param("kind");
    if (!d.smart || !HUBS.includes(kind as HubKind)) throw new DeviceError("No such hub.", 404);
    const hub = kind as HubKind;
    const b = await d.body(
      c,
      z.object({
        url: z.string().trim().max(300),
        /** null removes it; left out keeps it. */
        token: z.string().max(4000).nullable().optional(),
      }),
    );
    if (b.url) {
      let u: URL;
      try {
        u = new URL(b.url);
      } catch {
        throw new DeviceError(
          `Give ${HUB_NAMES[hub]}'s full address, like http://192.168.1.20:8080.`,
        );
      }
      if (u.protocol !== "http:" && u.protocol !== "https:")
        throw new DeviceError("The address starts with http:// or https://.");
      const token =
        b.token === undefined ? d.secrets.get(tokenSecret(hub)) : (b.token ?? undefined);
      try {
        await d.smart.check(hub, u.href, token);
      } catch (e) {
        throw new DeviceError((e as Error).message);
      }
    }
    await d.config.update((draft) => {
      draft.settings.smarthome[hub] = b.url ? { url: b.url } : undefined;
    });
    if (b.token !== undefined) await d.secrets.set(tokenSecret(hub), b.token || null);
    await d.smart.refresh();
    return c.json({ ok: true });
  });

  /** Switch something a hub controls. */
  app.post("/api/admin/smarthome/switch", async (c) => {
    d.requireAdmin(c);
    if (!d.smart) throw new DeviceError("Smart-home hubs aren't available.");
    const b = await d.body(
      c,
      z.object({ thing: z.string().max(300), point: z.string().max(200), on: z.boolean() }),
    );
    try {
      await d.smart.switch(b.thing, b.point, b.on);
    } catch (e) {
      throw new DeviceError((e as Error).message);
    }
    return c.json({ ok: true });
  });

  /** Link a saved device to a hub's device by hand, or unlink it (null). */
  app.put("/api/admin/devices/:id/smart", async (c) => {
    d.requireAdmin(c);
    if (!d.monitor) throw new DeviceError("Checking devices isn't running.");
    const b = await d.body(c, z.object({ thing: z.string().max(300).nullable() }));
    await d.monitor.linkSmart(c.req.param("id"), b.thing);
    return c.json({ ok: true });
  });

  /** Knock on a device now: does it answer? (Unplug it and watch, to tell which one it is.) */
  app.post("/api/admin/devices/:key/knock", async (c) => {
    d.requireAdmin(c);
    if (!d.monitor) throw new DeviceError("Checking devices isn't running.");
    return c.json({ up: await d.monitor.knock(c.req.param("key")) });
  });

  /** Be told when a device goes offline or a service stops answering, or stop. */
  app.put("/api/admin/watch", async (c) => {
    d.requireAdmin(c);
    if (!d.monitor) throw new DeviceError("Checking devices isn't running.");
    const b = await d.body(c, z.object({ key: z.string().max(120), on: z.boolean() }));
    await d.monitor.setWatch(b.key, b.on);
    return c.json({ ok: true });
  });

  /** Dismiss something from "Needs a look" until it's up again. */
  app.post("/api/admin/dismiss", async (c) => {
    d.requireAdmin(c);
    if (!d.monitor) throw new DeviceError("Checking devices isn't running.");
    const b = await d.body(c, z.object({ key: z.string().max(120) }));
    await d.monitor.dismiss(b.key);
    return c.json({ ok: true });
  });

  /** Hide a service (a port that's part of a device, not something anyone uses), or show it. */
  app.put("/api/admin/hide", async (c) => {
    d.requireAdmin(c);
    if (!d.monitor) throw new DeviceError("Checking devices isn't running.");
    const b = await d.body(c, z.object({ key: z.string().max(120), on: z.boolean() }));
    await d.monitor.setHidden(b.key, b.on);
    return c.json({ ok: true });
  });

  /**
   * A table's wheel art for the Pinball widget, shrunk. Anyone who can open Hearth may see it
   * (it's a game's logo); nothing is sent to the table but the game's number.
   */
  app.get("/api/pinball/:key/wheel/:game", async (c) => {
    const game = Number(c.req.param("game"));
    if (!d.monitor || !Number.isInteger(game) || game <= 0) return c.body(null, 404);
    const png = await d.monitor.wheel(c.req.param("key"), game);
    if (!png) return c.body(null, 404);
    return c.body(new Uint8Array(png), 200, {
      "content-type": "image/png",
      "cache-control": "public, max-age=604800",
    });
  });

  /** A pinball table's tables, for "Start a table". */
  app.get("/api/admin/devices/:key/tables", async (c) => {
    d.requireAdmin(c);
    if (!d.monitor) throw new DeviceError("Checking devices isn't running.");
    return c.json({ tables: await d.monitor.tableList(c.req.param("key")) });
  });

  /** Do something on a pinball table: start a table, mute, restart the frontend, shut down. */
  app.post("/api/admin/devices/:key/table", async (c) => {
    d.requireAdmin(c);
    if (!d.monitor) throw new DeviceError("Checking devices isn't running.");
    const b = await d.body(
      c,
      z.object({
        action: z.enum(["launch", "mute", "unmute", "restart", "shutdown"]),
        gameId: z.number().int().positive().optional(),
      }),
    );
    const vpin = await d.monitor.tableDo(c.req.param("key"), b.action, b.gameId);
    return c.json({ ok: true, vpin });
  });

  /** Ask devices again what they are: these addresses, or every one on the page. */
  app.post("/api/admin/devices/ask", async (c) => {
    d.requireAdmin(c);
    const b = await d.body(c, z.object({ ips: z.array(z.string().max(45)).max(300).optional() }));
    const ips =
      b.ips ??
      (await d.service.view(d.here(c), { ask: false })).devices
        .filter((r) => !r.ipv6Only)
        .flatMap((r) => r.ips);
    return c.json({ ok: true, asking: d.service.ask(ips, true) });
  });

  /** What happens to new devices: left for the admin, or saved as always allowed. */
  app.put("/api/admin/devices/rules", async (c) => {
    d.requireAdmin(c);
    await d.service.setRules(await d.body(c, NewDeviceRulesSchema));
    return c.json({ ok: true });
  });

  app.put("/api/admin/devices/:key", async (c) => {
    d.requireAdmin(c);
    const b = await d.body(
      c,
      z.object({
        name: z.string().trim().min(1, "Give it a name").max(60),
        type: z.union([
          z.enum(DEVICE_TYPES),
          z.custom<`c-${string}`>((v) => typeof v === "string" && KIND_ID.test(v)),
        ]),
        treatment: z.enum(TREATMENTS),
        person: z.string().max(40).optional(),
        /** Who shares it, when it's shared. */
        people: z.array(z.string().max(40)).max(12).optional(),
        ips: z.array(z.string().trim().min(2).max(45)).max(8).default([]),
        macs: z.array(mac).max(8).default([]),
        notes: z.string().max(300).optional(),
      }),
    );
    const id = await d.service.save(c.req.param("key"), {
      ...b,
      person: b.treatment === "person" ? b.person || undefined : undefined,
      people: b.treatment === "shared" ? [...new Set(b.people ?? [])] : [],
      notes: b.notes?.trim() || undefined,
    });
    return c.json({ ok: true, id });
  });

  app.delete("/api/admin/devices/:id", async (c) => {
    d.requireAdmin(c);
    await d.service.remove(c.req.param("id"));
    return c.json({ ok: true });
  });

  /** Connect AdGuard Home: its address, and optionally a username and password. Checked first. */
  app.put("/api/admin/adguard", async (c) => {
    d.requireAdmin(c);
    const b = await d.body(
      c,
      z.object({
        url: z.string().trim().max(300),
        username: z.string().trim().max(100).optional(),
        /** null removes it; leaving it out keeps it. */
        password: z.string().max(200).nullable().optional(),
      }),
    );
    if (b.url) {
      let u: URL;
      try {
        u = new URL(b.url);
      } catch {
        throw new DeviceError("Give AdGuard Home's full address, like http://192.168.1.1:3000.");
      }
      if (u.protocol !== "http:" && u.protocol !== "https:")
        throw new DeviceError("AdGuard Home's address starts with http:// or https://.");
      // Check it answers before keeping it.
      const password =
        b.password === undefined ? d.secrets.get(ADGUARD_SECRET) : (b.password ?? undefined);
      await new AdGuard({
        url: u.href,
        username: b.username || undefined,
        password,
        policy: { allowInternet: false },
        fetch: d.fetch,
      }).status();
    }
    await d.config.update((draft) => {
      draft.settings.adguard.url = b.url || undefined;
      draft.settings.adguard.username = b.username || undefined;
    });
    if (b.password !== undefined) await d.secrets.set(ADGUARD_SECRET, b.password || null);
    return c.json({ ok: true });
  });
}
