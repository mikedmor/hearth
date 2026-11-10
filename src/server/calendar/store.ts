/**
 * `data/calendar.json`: everyone's calendars, Hearth's own events, tags and what each person
 * turned off. Checked on load; changes go through `update()` one at a time, and every save is
 * atomic (a temporary file, then a rename).
 */
import { existsSync } from "node:fs";
import { copyFile, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type CalendarFile, CalendarFileSchema } from "../../shared/calendar";

export class CalendarFileError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
  }
}

export class CalendarStore {
  private data: CalendarFile = CalendarFileSchema.parse({});
  private queue: Promise<unknown> = Promise.resolve();
  /** The file on disk couldn't be read: nothing is saved over it until it's fixed. */
  private broken: string | null = null;

  constructor(private readonly dataDir: string) {}

  get path() {
    return join(this.dataDir, "calendar.json");
  }

  get(): CalendarFile {
    return this.data;
  }

  async load(): Promise<CalendarFile> {
    if (!existsSync(this.path)) return this.data;
    const text = await readFile(this.path, "utf8");
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      this.broken = `${this.path} isn't valid JSON: ${(e as Error).message}`;
      throw new CalendarFileError(this.broken);
    }
    const r = CalendarFileSchema.safeParse(raw);
    if (!r.success) {
      // Keep the broken file where the admin can see it, and start from what can be read.
      await copyFile(this.path, `${this.path}.broken`).catch(() => {});
      this.broken = `${this.path} doesn't fit`;
      throw new CalendarFileError(
        `${this.path} doesn't fit (a copy is in calendar.json.broken).`,
        r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      );
    }
    this.data = r.data;
    this.broken = null;
    return this.data;
  }

  /** Change the file: `change` edits a copy, which is checked and saved, or nothing changes. */
  update<T>(change: (draft: CalendarFile) => T | Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      if (this.broken)
        throw new CalendarFileError(
          `Calendars can't be changed until calendar.json is fixed (${this.broken}). Hearth's log has the details.`,
        );
      const draft = structuredClone(this.data);
      const result = await change(draft);
      const r = CalendarFileSchema.safeParse(draft);
      if (!r.success)
        throw new CalendarFileError(
          "That doesn't fit.",
          r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        );
      const tmp = `${this.path}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify(r.data, null, 2)}\n`, "utf8");
      await rename(tmp, this.path);
      this.data = r.data;
      return result;
    });
    this.queue = next.catch(() => {});
    return next;
  }
}
