/**
 * The admin's own catalog entries: `data/catalog/*.json`, each an app or a list of apps, in the
 * same shape as src/shared/catalog.ts. For apps Hearth doesn't know yet, or a home's own tools.
 * Each entry is checked; a broken file is skipped with a note in the log.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { type AppDef, CATEGORIES } from "../shared/catalog";

const AppEntry = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
  name: z.string().min(1).max(40),
  icon: z.string().max(80),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  category: z.enum(CATEGORIES),
  description: z.string().max(120).default(""),
  ports: z.array(z.number().int().min(1).max(65535)).max(10).default([]),
  https: z.boolean().optional(),
  match: z.object({
    title: z.string().max(200).optional(),
    body: z.string().max(200).optional(),
    header: z.string().max(200).optional(),
    probe: z.object({ path: z.string().max(200), body: z.string().max(200) }).optional(),
  }),
  widgets: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]{1,40}$/),
        name: z.string().max(60),
        description: z.string().max(200).default(""),
        secret: z
          .object({
            label: z.string().max(60),
            hint: z.string().max(200),
            kind: z.enum(["key", "basic", "bearer"]).optional(),
          })
          .optional(),
        params: z
          .array(
            z.object({
              key: z.string().regex(/^[a-z0-9_]{1,30}$/i),
              label: z.string().max(60),
              hint: z.string().max(200).optional(),
              default: z.string().max(200).optional(),
            }),
          )
          .max(8)
          .optional(),
        private: z.boolean().optional(),
        // Templates hold placeholders, so they're checked as documents only once filled in.
        doc: z.object({ v: z.literal(1) }).passthrough(),
      }),
    )
    .max(10)
    .optional(),
});

export function loadExtraApps(dir: string, log: (msg: string) => void = () => {}): AppDef[] {
  if (!existsSync(dir)) return [];
  const out: AppDef[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, file), "utf8")) as unknown;
      for (const entry of Array.isArray(raw) ? raw : [raw]) {
        const r = AppEntry.safeParse(entry);
        if (!r.success) {
          log(
            `catalog/${file}: skipped an entry: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
          );
          continue;
        }
        // Regular expressions that don't compile would break recognition: drop them.
        for (const k of ["title", "body", "header"] as const) {
          const src = r.data.match[k];
          if (src === undefined) continue;
          try {
            new RegExp(src, "i");
          } catch {
            log(`catalog/${file}: ${r.data.id}: match.${k} isn't a valid pattern`);
            delete r.data.match[k];
          }
        }
        out.push(r.data as unknown as AppDef);
      }
    } catch (e) {
      log(`catalog/${file}: not valid JSON (${(e as Error).message})`);
    }
  }
  return out;
}
