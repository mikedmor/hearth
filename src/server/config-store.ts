/**
 * Loads and saves `hearth.json` in the data folder.
 *
 * - On first run, the file is seeded from the bundled example so the page is never empty.
 * - An older version is upgraded, and the old file kept next to it (`hearth.json.v1`).
 * - Every load is validated. A broken file keeps the last good config running and reports why.
 * - Saves are atomic (a temporary file, then a rename), and edits go through `update()`, one at a
 *   time, so two people saving at once can't lose each other's change.
 */
import { watch } from "node:fs";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import example from "../../config/hearth.example.json" with { type: "json" };
import { type HearthConfig, HearthConfigSchema } from "../shared/config";
import { migrate } from "../shared/migrate";

export const CONFIG_FILE = "hearth.json";

export class ConfigError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message);
  }
}

/** Validate a config object, with readable errors ("tiles.3.group: no group "media""). */
export function validateConfig(raw: unknown): HearthConfig {
  const result = HearthConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new ConfigError(`${CONFIG_FILE} has ${issues.length} problem(s)`, issues);
  }
  return result.data;
}

/** Parse, upgrade and validate config text. */
export function parseConfig(text: string): HearthConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`${CONFIG_FILE} is not valid JSON: ${(err as Error).message}`, []);
  }
  return validateConfig(migrate(raw).config);
}

export class ConfigStore {
  private current: HearthConfig | null = null;
  private lastError: ConfigError | null = null;
  private listeners = new Set<(cfg: HearthConfig) => void>();
  private lastWritten = "";
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly dataDir: string) {}

  get path(): string {
    return join(this.dataDir, CONFIG_FILE);
  }

  /** The last good config. Throws only if none has ever loaded. */
  get(): HearthConfig {
    if (!this.current) throw this.lastError ?? new Error("config not loaded");
    return this.current;
  }

  get error(): ConfigError | null {
    return this.lastError;
  }

  onChange(listener: (cfg: HearthConfig) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async load(): Promise<HearthConfig> {
    await mkdir(this.dataDir, { recursive: true });
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      text = `${JSON.stringify(example, null, 2)}\n`;
      await this.writeAtomic(text);
    }
    try {
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch (err) {
        throw new ConfigError(`${CONFIG_FILE} is not valid JSON: ${(err as Error).message}`, []);
      }
      const { config, from } = migrate(raw);
      const cfg = validateConfig(config);
      if (from !== null) {
        await copyFile(this.path, `${this.path}.v${from}`);
        await this.writeAtomic(`${JSON.stringify(cfg, null, 2)}\n`);
      }
      this.current = cfg;
      this.lastError = null;
      for (const listener of this.listeners) listener(cfg);
      return cfg;
    } catch (err) {
      this.lastError = err instanceof ConfigError ? err : new ConfigError(String(err), []);
      throw this.lastError;
    }
  }

  async save(cfg: HearthConfig): Promise<HearthConfig> {
    const valid = validateConfig(JSON.parse(JSON.stringify(cfg)));
    await this.writeAtomic(`${JSON.stringify(valid, null, 2)}\n`);
    this.current = valid;
    this.lastError = null;
    for (const listener of this.listeners) listener(valid);
    return valid;
  }

  /**
   * Change the config: `change` gets a copy to edit. Changes run one after another, and an edit
   * that makes the config invalid is refused with the reasons, leaving the file as it was.
   */
  update(change: (draft: HearthConfig) => void | Promise<void>): Promise<HearthConfig> {
    const next = this.queue.then(async () => {
      const draft = structuredClone(this.get());
      await change(draft);
      return this.save(draft);
    });
    this.queue = next.catch(() => {});
    return next;
  }

  /** Reload when the file is edited by hand. Returns a function that stops watching. */
  watch(log: (msg: string) => void): () => void {
    let timer: NodeJS.Timeout | undefined;
    const watcher = watch(this.dataDir, (_event, file) => {
      if (file !== CONFIG_FILE) return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        // Our own saves come through here too; only a change made outside Hearth reloads.
        const text = await readFile(this.path, "utf8").catch(() => "");
        if (text === this.lastWritten) return;
        this.load().then(
          () => log(`reloaded ${CONFIG_FILE}`),
          (err: ConfigError) =>
            log(`kept the last good config: ${err.message}\n  ${err.issues.join("\n  ")}`),
        );
      }, 200);
    });
    return () => {
      clearTimeout(timer);
      watcher.close();
    };
  }

  private async writeAtomic(text: string): Promise<void> {
    const tmp = `${this.path}.${process.pid}.tmp`;
    this.lastWritten = text;
    await writeFile(tmp, text, "utf8");
    await rename(tmp, this.path);
  }
}
