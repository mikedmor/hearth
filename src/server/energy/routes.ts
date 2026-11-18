/** The Sense energy monitor's routes: the admin's only. */
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { ConfigStore } from "../config-store";
import { DeviceError } from "../devices/service";
import { SenseError, type SenseService } from "./sense";

export interface EnergyRouteDeps {
  sense: SenseService;
  config: ConfigStore;
  requireAdmin: (c: Context) => unknown;
  body: <T>(c: Context, schema: z.ZodType<T>) => Promise<T>;
}

const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    throw new DeviceError(e instanceof SenseError ? e.message : "Couldn't reach Sense.");
  }
};

export function energyRoutes(app: Hono, d: EnergyRouteDeps): void {
  app.get("/api/admin/sense", (c) => {
    d.requireAdmin(c);
    return c.json(d.sense.view());
  });

  /** Sign in to Sense: done, or `{ code: true }` when the account wants an authenticator code. */
  app.put("/api/admin/sense", async (c) => {
    d.requireAdmin(c);
    const b = await d.body(
      c,
      z.object({
        email: z.string().trim().email("Give the email you sign in to Sense with").max(200),
        password: z.string().min(1, "Give the password").max(200),
      }),
    );
    const r = await wrap(() => d.sense.signIn(b.email, b.password));
    return c.json({ ok: true, ...r });
  });

  app.post("/api/admin/sense/code", async (c) => {
    d.requireAdmin(c);
    const b = await d.body(
      c,
      z.object({
        code: z
          .string()
          .trim()
          .regex(/^\d{6,8}$/, "The six-digit code"),
      }),
    );
    await wrap(() => d.sense.verify(b.code));
    return c.json({ ok: true });
  });

  /** What electricity costs, when it should differ from Sense. Each left empty uses Sense's. */
  app.put("/api/admin/sense/cost", async (c) => {
    d.requireAdmin(c);
    const b = await d.body(
      c,
      z.object({
        rate: z.number().positive("The rate is more than 0").max(500).nullable().optional(),
        cycleStart: z.number().int().min(1).max(31).nullable().optional(),
        fixed: z.number().min(0).max(1000).nullable().optional(),
      }),
    );
    await d.config.update((draft) => {
      draft.settings.energy = {
        rate: b.rate ?? undefined,
        cycleStart: b.cycleStart ?? undefined,
        fixed: b.fixed ?? undefined,
      };
    });
    d.sense.costChanged();
    return c.json({ ok: true });
  });

  app.delete("/api/admin/sense", async (c) => {
    d.requireAdmin(c);
    await d.sense.disconnect();
    return c.json({ ok: true });
  });
}
