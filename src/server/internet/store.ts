/**
 * `data/internet.json` (the internet controls) and `data/history/YYYY-MM-DD.json` (what
 * children's devices looked up, a day a file). Checked on load; changes go through `update()` one
 * at a time, each saved atomically. A file that can't be read is never saved over.
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type HistoryDay,
  HistoryDaySchema,
  type InternetFile,
  InternetFileSchema,
} from "../../shared/internet";

export class InternetFileError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
  }
}

async function atomicWrite(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

export class InternetStore {
  private data: InternetFile = InternetFileSchema.parse({});
  private queue: Promise<unknown> = Promise.resolve();
  private broken: string | null = null;

  constructor(private readonly dataDir: string) {}

  get path() {
    return join(this.dataDir, "internet.json");
  }

  get(): InternetFile {
    return this.data;
  }

  async load(): Promise<InternetFile> {
    if (!existsSync(this.path)) return this.data;
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(this.path, "utf8"));
    } catch (e) {
      this.broken = `${this.path} isn't valid JSON: ${(e as Error).message}`;
      throw new InternetFileError(this.broken);
    }
    const r = InternetFileSchema.safeParse(raw);
    if (!r.success) {
      await copyFile(this.path, `${this.path}.broken`).catch(() => {});
      this.broken = `${this.path} doesn't fit`;
      throw new InternetFileError(
        `${this.path} doesn't fit (a copy is in internet.json.broken).`,
        r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      );
    }
    this.data = r.data;
    return this.data;
  }

  update<T>(change: (draft: InternetFile) => T | Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      if (this.broken)
        throw new InternetFileError(
          `The internet controls can't be changed until internet.json is fixed (${this.broken}).`,
        );
      const draft = structuredClone(this.data);
      const result = await change(draft);
      const r = InternetFileSchema.safeParse(draft);
      if (!r.success)
        throw new InternetFileError(
          "That doesn't fit.",
          r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        );
      await atomicWrite(this.path, r.data);
      this.data = r.data;
      return result;
    });
    this.queue = next.catch(() => {});
    return next;
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Children's history, a file a day. Days are read when asked for and kept while in use. */
export class HistoryStore {
  private days = new Map<string, HistoryDay>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly dataDir: string) {}

  private get dir() {
    return join(this.dataDir, "history");
  }

  private file(day: string) {
    return join(this.dir, `${day}.json`);
  }

  async day(day: string): Promise<HistoryDay> {
    if (!DAY.test(day)) return {};
    const cached = this.days.get(day);
    if (cached) return cached;
    let d: HistoryDay = {};
    if (existsSync(this.file(day))) {
      try {
        const r = HistoryDaySchema.safeParse(JSON.parse(await readFile(this.file(day), "utf8")));
        if (r.success) d = r.data;
      } catch {
        // A day that can't be read is left alone; it starts again empty in memory.
      }
    }
    this.days.set(day, d);
    // Keep only a few days in memory.
    if (this.days.size > 8) this.days.delete(this.days.keys().next().value as string);
    return d;
  }

  /** Change some days and save them, one change at a time. */
  update(change: (day: (d: string) => Promise<HistoryDay>) => Promise<string[]>): Promise<void> {
    const next = this.queue.then(async () => {
      const touched = await change((d) => this.day(d));
      if (!touched.length) return;
      await mkdir(this.dir, { recursive: true });
      for (const d of new Set(touched)) {
        const data = this.days.get(d);
        if (data) await atomicWrite(this.file(d), data);
      }
    });
    this.queue = next.catch(() => {});
    return next;
  }

  /** Days kept, newest first. */
  async list(): Promise<string[]> {
    if (!existsSync(this.dir)) return [];
    return (await readdir(this.dir))
      .map((f) => f.replace(/\.json$/, ""))
      .filter((d) => DAY.test(d))
      .sort()
      .reverse();
  }

  /** Forget days older than `keep` days before `today`. */
  async prune(today: string, keep: number): Promise<void> {
    const cutoff = new Date(`${today}T00:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - keep + 1);
    const oldest = cutoff.toISOString().slice(0, 10);
    for (const d of await this.list())
      if (d < oldest) {
        this.days.delete(d);
        await rm(this.file(d), { force: true });
      }
  }

  /** Someone left, or was renamed: their history goes with it. */
  async rewrite(fn: (d: HistoryDay) => boolean): Promise<void> {
    const days = await this.list();
    await this.update(async (get) => {
      const touched: string[] = [];
      for (const d of days) if (fn(await get(d))) touched.push(d);
      return touched;
    });
  }
}
