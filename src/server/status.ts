/**
 * Live status checks. The server checks every tile, so phones never probe the services.
 *
 * - Any HTTP answer below 500 counts as up (a login page or a 401 still means it's running).
 * - Slow when the answer takes longer than `slowMs`.
 * - Down only after two failures in a row, so one dropped packet doesn't flash red.
 */
import type { StatusMap, TileStatus } from "../shared/api";
import { isChecked, type Tile } from "../shared/config";

export interface StatusOptions {
  intervalMs: number;
  timeoutMs: number;
  slowMs: number;
  /** Failures in a row before a tile shows as down. */
  failuresToDown?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

interface Target {
  id: string;
  url: string;
}

interface Entry extends TileStatus {
  failures: number;
}

export class StatusChecker {
  private targets: Target[] = [];
  private entries = new Map<string, Entry>();
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | null = null;
  private listeners = new Set<() => void>();

  constructor(private opts: StatusOptions) {}

  /** Called after every round of checks. */
  onChecked(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setOptions(opts: Partial<StatusOptions>): void {
    const intervalChanged =
      opts.intervalMs !== undefined && opts.intervalMs !== this.opts.intervalMs;
    this.opts = { ...this.opts, ...opts };
    if (intervalChanged && this.timer) {
      this.stop();
      this.start();
    }
  }

  /** Replace what's checked. Keeps results for tiles whose address didn't change. */
  setTiles(tiles: Tile[]): void {
    const next = tiles.filter(isChecked).map((t) => ({ id: t.id, url: t.checkUrl ?? t.url }));
    const before = new Map(this.targets.map((t) => [t.id, t.url]));
    for (const id of this.entries.keys()) {
      const target = next.find((t) => t.id === id);
      if (!target || before.get(id) !== target.url) this.entries.delete(id);
    }
    this.targets = next;
  }

  snapshot(): StatusMap {
    const out: StatusMap = {};
    for (const { id } of this.targets) {
      const e = this.entries.get(id);
      out[id] = e ? { state: e.state, ms: e.ms, checkedAt: e.checkedAt } : { state: "unknown" };
    }
    return out;
  }

  start(): void {
    if (this.timer) return;
    void this.checkAll();
    this.timer = setInterval(() => void this.checkAll(), this.opts.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Check every target once. Overlapping calls share the same run. */
  checkAll(): Promise<void> {
    if (!this.running) {
      this.running = Promise.all(this.targets.map((t) => this.checkOne(t))).then(() => {
        this.running = null;
        for (const fn of this.listeners) fn();
      });
    }
    return this.running;
  }

  private async checkOne(target: Target): Promise<void> {
    const doFetch = this.opts.fetch ?? fetch;
    const now = this.opts.now ?? Date.now;
    const started = now();
    let ok = false;
    try {
      const res = await doFetch(target.url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(this.opts.timeoutMs),
        headers: { "user-agent": "Hearth status check" },
      });
      ok = res.status < 500;
      await res.body?.cancel().catch(() => {});
    } catch {
      ok = false;
    }
    const ms = now() - started;
    const prev = this.entries.get(target.id);
    const checkedAt = new Date(now()).toISOString();
    if (ok) {
      this.entries.set(target.id, {
        state: ms > this.opts.slowMs ? "slow" : "up",
        ms,
        checkedAt,
        failures: 0,
      });
      return;
    }
    const failures = (prev?.failures ?? 0) + 1;
    const down = failures >= (this.opts.failuresToDown ?? 2);
    this.entries.set(target.id, {
      state: down ? "down" : (prev?.state ?? "unknown"),
      ms: prev?.ms,
      checkedAt,
      failures,
    });
  }
}
