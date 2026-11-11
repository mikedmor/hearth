/**
 * `data/devices.json`: the devices the admin has named, and the browsers Hearth has seen. Checked
 * on load; changes go through `update()` one at a time, each saved atomically. A file that can't be
 * read is never saved over.
 */
import { existsSync } from "node:fs";
import { copyFile, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type DevicesFile, DevicesFileSchema } from "../../shared/devices";

export class DevicesFileError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
  }
}

export class DeviceStore {
  private data: DevicesFile = DevicesFileSchema.parse({});
  private queue: Promise<unknown> = Promise.resolve();
  private broken: string | null = null;

  constructor(private readonly dataDir: string) {}

  get path() {
    return join(this.dataDir, "devices.json");
  }

  get(): DevicesFile {
    return this.data;
  }

  async load(): Promise<DevicesFile> {
    if (!existsSync(this.path)) return this.data;
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(this.path, "utf8"));
    } catch (e) {
      this.broken = `${this.path} isn't valid JSON: ${(e as Error).message}`;
      throw new DevicesFileError(this.broken);
    }
    const r = DevicesFileSchema.safeParse(raw);
    if (!r.success) {
      await copyFile(this.path, `${this.path}.broken`).catch(() => {});
      this.broken = `${this.path} doesn't fit`;
      throw new DevicesFileError(
        `${this.path} doesn't fit (a copy is in devices.json.broken).`,
        r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      );
    }
    this.data = r.data;
    return this.data;
  }

  update<T>(change: (draft: DevicesFile) => T | Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      if (this.broken)
        throw new DevicesFileError(
          `Devices can't be changed until devices.json is fixed (${this.broken}).`,
        );
      const draft = structuredClone(this.data);
      const result = await change(draft);
      const r = DevicesFileSchema.safeParse(draft);
      if (!r.success)
        throw new DevicesFileError(
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
