/**
 * Keeps an eye on the AI servers for the compute page and the AI widget: up, busy or down, how
 * fast, which models they have and which are loaded right now.
 */
import type { AiServerStatus } from "../../shared/api";
import type { AiServer } from "../../shared/config";
import { AiError, type Conn, listLoaded, listModels, serverVersion } from "./client";

export interface MonitorDeps {
  servers: () => AiServer[];
  keyFor: (id: string) => string | undefined;
  fetch?: typeof fetch;
  intervalMs?: number;
}

export class AiMonitor {
  private statuses = new Map<string, AiServerStatus>();
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | null = null;
  private listeners = new Set<() => void>();

  constructor(private deps: MonitorDeps) {}

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  start(): void {
    if (this.timer) return;
    void this.checkAll();
    this.timer = setInterval(() => void this.checkAll(), this.deps.intervalMs ?? 30_000);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  conn(server: AiServer): Conn {
    return { server, key: this.deps.keyFor(server.id), fetch: this.deps.fetch };
  }

  /** Every server, as last checked (unknown before the first check). */
  list(): AiServerStatus[] {
    return this.deps.servers().map(
      (s) =>
        this.statuses.get(s.id) ?? {
          id: s.id,
          name: s.name,
          kind: s.kind,
          url: s.url,
          defaultModel: s.model,
          state: "unknown",
          models: [],
          loaded: [],
          hasKey: Boolean(this.deps.keyFor(s.id)),
        },
    );
  }

  checkAll(): Promise<void> {
    if (!this.running) {
      const servers = this.deps.servers();
      const ids = new Set(servers.map((s) => s.id));
      for (const id of this.statuses.keys()) if (!ids.has(id)) this.statuses.delete(id);
      this.running = Promise.all(servers.map((s) => this.checkOne(s))).then(() => {
        this.running = null;
        for (const fn of this.listeners) fn();
      });
    }
    return this.running;
  }

  async checkOne(server: AiServer): Promise<AiServerStatus> {
    const c = this.conn(server);
    const started = Date.now();
    const status: AiServerStatus = {
      id: server.id,
      name: server.name,
      kind: server.kind,
      url: server.url,
      defaultModel: server.model,
      state: "down",
      models: [],
      loaded: [],
      checkedAt: new Date().toISOString(),
      hasKey: Boolean(c.key),
    };
    try {
      status.models = await listModels(c);
      status.ms = Date.now() - started;
      status.state = "up";
      [status.loaded, status.version] = await Promise.all([listLoaded(c), serverVersion(c)]);
      if (status.models.length === 0) status.note = "It answers, but has no models yet.";
    } catch (e) {
      const err = e instanceof AiError ? e : new AiError(String(e));
      status.state = err.retryAfter !== null ? "busy" : "down";
      status.note = err.message;
    }
    this.statuses.set(server.id, status);
    return status;
  }
}
