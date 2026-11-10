/**
 * Runs widgets and pushes their data to the page.
 *
 * - A widget's sources only run while someone is looking at it, and stop a minute after the last
 *   page closes, so the NAS isn't polling for nobody.
 * - HTTP sources are fetched on their schedule; WebSocket sources stay connected and push; Hearth
 *   sources follow the status checks and AI servers.
 * - Formulas are worked out here, and only the finished blocks go to the page. Images (camera
 *   snapshots) are fetched by Hearth too, so the page never sees a camera's address or password.
 */
import { createHash } from "node:crypto";
import { statfsSync } from "node:fs";
import { cpus, freemem, hostname, loadavg, uptime as osUptime, totalmem } from "node:os";
import type { PreviewResult, StatusMap, WidgetUpdate } from "../../shared/api";
import { canSee, type HearthConfig, isChecked, type Role, type Widget } from "../../shared/config";
import { run, toNumber } from "../../shared/expr";
import { checkDoc, type Source, type WidgetDoc, type WidgetFrame } from "../../shared/widget-doc";
import { resolveDoc } from "../../shared/widget-eval";
import type { AiMonitor } from "../ai/monitor";
import {
  checkTarget,
  guardedFetch,
  NetError,
  type NetPolicy,
  parseBody,
  pick,
  sample,
} from "../net";
import type { SecretStore } from "../secrets";
import { visibleTiles } from "../view";

export interface HubDeps {
  config: () => HearthConfig;
  status: () => StatusMap;
  ai: AiMonitor;
  secrets: SecretStore;
  now?: () => number;
  fetch?: typeof fetch;
  /** Hearth's data folder, for the host source's disk numbers. */
  dataDir?: string;
  /** How long sources keep running after the last viewer leaves. */
  idleMs?: number;
  log?: (msg: string) => void;
}

type Listener = (u: WidgetUpdate) => void;
interface Sub {
  role: Role | null;
  fn: Listener;
}

// ---------------------------------------------------------------------------
// One custom widget's sources

interface SourceState {
  data: unknown;
  ok: boolean;
  error?: string;
  at?: number;
}

export class CustomRunner {
  private states = new Map<string, SourceState>();
  private history = new Map<string, number[]>();
  private timers: NodeJS.Timeout[] = [];
  private sockets: WebSocket[] = [];
  private stopped = true;
  private frameTimer: NodeJS.Timeout | undefined;
  private lastFrameJson = "";
  /** Real image addresses, by block id. The page gets a Hearth address instead. */
  readonly images = new Map<string, string>();
  frame: WidgetFrame | null = null;

  constructor(
    readonly widgetId: string,
    readonly doc: WidgetDoc,
    private readonly deps: HubDeps,
    private readonly onFrame: (f: WidgetFrame) => void,
  ) {}

  private policy(): NetPolicy {
    return { allowInternet: this.deps.config().settings.network.allowInternet };
  }

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    for (const s of this.doc.sources) this.startSource(s);
    this.recompute();
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    for (const ws of this.sockets) {
      try {
        ws.close();
      } catch {
        // Already closed.
      }
    }
    this.sockets = [];
    clearTimeout(this.frameTimer);
  }

  /** Hearth's own data changed (status checks, AI servers). */
  hearthChanged(): void {
    if (this.stopped) return;
    for (const s of this.doc.sources)
      if (s.kind === "hearth") this.set(s, hearthData(s.what, this.deps), true);
  }

  /** Fetch everything once (for a page that asks before the socket is up, and previews). */
  async once(waitForSockets = 2500): Promise<WidgetFrame> {
    await Promise.all(
      this.doc.sources.map(async (s) => {
        if (s.kind === "http") await this.fetchHttp(s);
        else if (s.kind === "hearth") this.set(s, hearthData(s.what, this.deps), true);
        else await this.firstMessage(s, waitForSockets);
      }),
    );
    return this.compute();
  }

  samples(): PreviewResult["samples"] {
    const out: PreviewResult["samples"] = {};
    for (const s of this.doc.sources) {
      const st = this.states.get(s.id);
      out[s.id] = st
        ? { ok: st.ok, error: st.error, sample: st.ok ? sample(st.data) : undefined }
        : { ok: false, error: "No data yet." };
    }
    return out;
  }

  private startSource(s: Source) {
    if (s.kind === "hearth") {
      this.set(s, hearthData(s.what, this.deps), true);
      if (s.what === "time" || s.what === "host") {
        const tick = () => {
          if (this.stopped) return;
          this.set(s, hearthData(s.what, this.deps), true);
          this.timers.push(setTimeout(tick, 30_000));
        };
        this.timers.push(setTimeout(tick, 30_000));
      }
      return;
    }
    if (s.kind === "http") {
      const loop = async () => {
        if (this.stopped) return;
        await this.fetchHttp(s);
        if (!this.stopped) this.timers.push(setTimeout(loop, s.every * 1000));
      };
      void loop();
      return;
    }
    this.connect(s, 0);
  }

  private set(s: Source, data: unknown, ok: boolean, error?: string) {
    if (ok) {
      this.states.set(s.id, { data, ok: true, at: this.now() });
      if (s.kind !== "hearth" && s.track) this.track(s.id, s.track, s.keep, data);
    } else {
      // Keep the last good data on screen, and say what went wrong.
      const prev = this.states.get(s.id);
      this.states.set(s.id, { data: prev?.data, ok: false, error, at: prev?.at });
    }
    this.recompute();
  }

  private lastTracked = new Map<string, number>();
  private track(id: string, expr: string, keep: number, data: unknown) {
    // A busy socket can send many messages a second; one point a second is plenty.
    const last = this.lastTracked.get(id) ?? 0;
    if (this.now() - last < 1000) return;
    this.lastTracked.set(id, this.now());
    let v: number | null = null;
    try {
      v = toNumber(run(expr, { vars: { [id]: data } }));
    } catch {
      v = null;
    }
    if (v === null) return;
    const list = this.history.get(id) ?? [];
    list.push(v);
    if (list.length > keep) list.splice(0, list.length - keep);
    this.history.set(id, list);
  }

  private async fetchHttp(s: Extract<Source, { kind: "http" }>) {
    const missing: string[] = [];
    const fill = (t: string) => {
      const r = this.deps.secrets.fill(t);
      missing.push(...r.missing);
      return r.text;
    };
    try {
      const url = fill(s.url);
      const headers = Object.fromEntries(Object.entries(s.headers).map(([k, v]) => [k, fill(v)]));
      const body = s.body ? fill(s.body) : undefined;
      if (missing.length)
        throw new NetError(
          `No secret called ${missing.join(", ")} (add it in Settings → Secrets).`,
        );
      const res = await guardedFetch(url, {
        method: s.method,
        headers,
        body,
        policy: this.policy(),
        fetch: this.deps.fetch,
      });
      if (res.status >= 400) throw new NetError(`It answered ${res.status}.`);
      this.set(s, pick(parseBody(res), s.path), true);
    } catch (e) {
      this.set(s, undefined, false, this.deps.secrets.redact((e as Error).message));
    }
  }

  private openSocket(s: Extract<Source, { kind: "websocket" }>): WebSocket {
    const filled = this.deps.secrets.fill(s.url);
    if (filled.missing.length) throw new NetError(`No secret called ${filled.missing.join(", ")}.`);
    checkTarget(filled.text, this.policy());
    return new WebSocket(filled.text);
  }

  private onSocketMessage(s: Extract<Source, { kind: "websocket" }>, raw: unknown) {
    let msg: unknown = raw;
    if (typeof raw === "string") {
      try {
        msg = JSON.parse(raw);
      } catch {
        msg = raw;
      }
    }
    const part = pick(msg, s.path);
    if (part === undefined) return;
    const prev = this.states.get(s.id)?.data;
    const merged =
      s.mode === "merge" &&
      prev &&
      typeof prev === "object" &&
      part &&
      typeof part === "object" &&
      !Array.isArray(part)
        ? { ...(prev as object), ...(part as object) }
        : part;
    this.set(s, merged, true);
  }

  private connect(s: Extract<Source, { kind: "websocket" }>, attempt: number) {
    if (this.stopped) return;
    let ws: WebSocket;
    try {
      ws = this.openSocket(s);
    } catch (e) {
      this.set(s, undefined, false, (e as Error).message);
      return;
    }
    this.sockets.push(ws);
    let opened = false;
    ws.addEventListener("open", () => {
      opened = true;
      if (s.send) ws.send(this.deps.secrets.fill(s.send).text);
    });
    ws.addEventListener("message", (ev) => {
      const data =
        typeof ev.data === "string"
          ? ev.data
          : Buffer.from(ev.data as ArrayBuffer).toString("utf8");
      this.onSocketMessage(s, data);
    });
    ws.addEventListener("close", () => {
      this.sockets = this.sockets.filter((x) => x !== ws);
      if (this.stopped) return;
      this.set(
        s,
        undefined,
        false,
        opened ? "The connection closed; reconnecting." : `Couldn't connect to ${safeHost(s.url)}.`,
      );
      const next = opened ? 0 : attempt + 1;
      const wait = Math.min(60_000, 2000 * 2 ** Math.min(next, 5));
      this.timers.push(setTimeout(() => this.connect(s, next), wait));
    });
  }

  private firstMessage(
    s: Extract<Source, { kind: "websocket" }>,
    timeoutMs: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      let ws: WebSocket;
      try {
        ws = this.openSocket(s);
      } catch (e) {
        this.set(s, undefined, false, (e as Error).message);
        resolve();
        return;
      }
      const finish = (error?: string) => {
        clearTimeout(timer);
        if (error) this.set(s, undefined, false, error);
        try {
          ws.close();
        } catch {
          // Fine.
        }
        resolve();
      };
      const timer = setTimeout(() => finish("No message arrived within a few seconds."), timeoutMs);
      ws.addEventListener("open", () => {
        if (s.send) ws.send(this.deps.secrets.fill(s.send).text);
      });
      ws.addEventListener("message", (ev) => {
        this.onSocketMessage(
          s,
          typeof ev.data === "string"
            ? ev.data
            : Buffer.from(ev.data as ArrayBuffer).toString("utf8"),
        );
        finish();
      });
      ws.addEventListener("error", () => finish(`Couldn't connect to ${safeHost(s.url)}.`));
    });
  }

  /** At most a few frames a second, however chatty the sources are. */
  private recompute() {
    if (this.stopped || this.frameTimer) return;
    this.frameTimer = setTimeout(() => {
      this.frameTimer = undefined;
      const f = this.compute();
      const json = JSON.stringify(f.blocks) + JSON.stringify(f.sources);
      if (json !== this.lastFrameJson) {
        this.lastFrameJson = json;
        this.onFrame(f);
      }
    }, 200);
  }

  compute(): WidgetFrame {
    const cfg = this.deps.config();
    const sources: Record<string, unknown> = {};
    const status: WidgetFrame["sources"] = {};
    for (const s of this.doc.sources) {
      const st = this.states.get(s.id);
      sources[s.id] = st?.data ?? null;
      status[s.id] = {
        ok: st?.ok ?? false,
        error: st ? st.error : "Waiting for data.",
        at: st?.at,
      };
    }
    const blocks = resolveDoc(this.doc, {
      sources,
      history: Object.fromEntries(this.history),
      locale: cfg.settings.locale,
      timeZone: cfg.settings.timeZone,
      now: this.deps.now,
    });
    this.images.clear();
    for (const b of blocks) {
      if (b.kind === "image" && b.src) {
        this.images.set(b.id, b.src);
        const v = createHash("sha256").update(b.src).digest("hex").slice(0, 10);
        b.src = `/api/widgets/${this.widgetId}/image/${b.id}?v=${v}`;
      }
    }
    const at = Math.max(0, ...Object.values(status).map((s) => s.at ?? 0));
    this.frame = { blocks, at, sources: status };
    return this.frame;
  }
}

const safeHost = (u: string) => {
  try {
    return new URL(u.replace(/\{\{[^}]*\}\}/g, "x")).host;
  } catch {
    return "the server";
  }
};

function hearthData(what: "status" | "ai" | "time" | "host", deps: HubDeps): unknown {
  if (what === "host") return hostData(deps);
  if (what === "time") {
    const d = new Date((deps.now ?? Date.now)());
    return {
      now: d.getTime(),
      iso: d.toISOString(),
      hour: d.getHours(),
      minute: d.getMinutes(),
      weekday: d.getDay(),
      date: d.toISOString().slice(0, 10),
    };
  }
  if (what === "ai") {
    return {
      servers: deps.ai.list().map((s) => ({
        id: s.id,
        name: s.name,
        state: s.state,
        ms: s.ms ?? null,
        models: s.models.map((m) => m.name),
        loaded: s.loaded.map((m) => m.name),
      })),
    };
  }
  const status = deps.status();
  const tiles = deps
    .config()
    .tiles.filter(isChecked)
    .map((t) => ({
      id: t.id,
      name: t.name,
      state: status[t.id]?.state ?? "unknown",
      ms: status[t.id]?.ms ?? null,
    }));
  return {
    tiles,
    total: tiles.length,
    up: tiles.filter((t) => t.state === "up").length,
    down: tiles.filter((t) => t.state === "down").length,
  };
}

/** The machine Hearth runs on (in a container, the NAS's load and memory). */
function hostData(deps: HubDeps) {
  let disk = { diskTotal: 0, diskUsed: 0 };
  try {
    const s = statfsSync(deps.dataDir ?? ".");
    disk = { diskTotal: s.blocks * s.bsize, diskUsed: (s.blocks - s.bfree) * s.bsize };
  } catch {
    // Not every system can say.
  }
  const total = totalmem();
  return {
    hostname: hostname(),
    cpus: cpus().length,
    load1: loadavg()[0],
    load5: loadavg()[1],
    memTotal: total,
    memUsed: total - freemem(),
    uptime: osUptime(),
    ...disk,
  };
}

// ---------------------------------------------------------------------------
// All widgets

export class WidgetHub {
  private subs = new Map<string, Set<Sub>>();
  private runners = new Map<string, { runner: CustomRunner; key: string; idle?: NodeJS.Timeout }>();

  constructor(private deps: HubDeps) {}

  private widget(id: string): Widget | undefined {
    return this.deps.config().widgets.find((w) => w.id === id);
  }

  /** Watch a widget; the listener gets every new value. Returns a function that stops watching. */
  subscribe(widgetId: string, role: Role | null, fn: Listener): () => void {
    const w = this.widget(widgetId);
    if (!w || !canSee(w.audience, role)) return () => {};
    const set = this.subs.get(widgetId) ?? new Set();
    const sub = { role, fn };
    set.add(sub);
    this.subs.set(widgetId, set);
    if (w.type === "custom") this.ensureRunner(w);
    void this.current(w, role).then((u) => set.has(sub) && fn(u));
    return () => {
      set.delete(sub);
      if (set.size === 0) {
        this.subs.delete(widgetId);
        this.scheduleIdle(widgetId);
      }
    };
  }

  private ensureRunner(w: Extract<Widget, { type: "custom" }>): CustomRunner {
    const key = JSON.stringify(w.doc);
    const existing = this.runners.get(w.id);
    if (existing && existing.key === key) {
      clearTimeout(existing.idle);
      existing.idle = undefined;
      return existing.runner;
    }
    existing?.runner.stop();
    const runner = new CustomRunner(w.id, w.doc, this.deps, (frame) =>
      this.push(w.id, { id: w.id, type: "custom", data: frame }),
    );
    this.runners.set(w.id, { runner, key });
    runner.start();
    return runner;
  }

  private scheduleIdle(widgetId: string) {
    const r = this.runners.get(widgetId);
    if (!r) return;
    clearTimeout(r.idle);
    r.idle = setTimeout(() => {
      if (this.subs.has(widgetId)) return;
      r.runner.stop();
      this.runners.delete(widgetId);
    }, this.deps.idleMs ?? 60_000);
    r.idle.unref?.();
  }

  private push(widgetId: string, update: WidgetUpdate) {
    for (const s of this.subs.get(widgetId) ?? []) s.fn(update);
  }

  /** The widget's data now, for one viewer. */
  async current(w: Widget, role: Role | null): Promise<WidgetUpdate> {
    switch (w.type) {
      case "status":
        return { id: w.id, type: "status", data: statusData(this.deps, role) };
      case "note":
        return { id: w.id, type: "note", data: { text: w.options.text, tone: w.options.tone } };
      case "countdown":
        return {
          id: w.id,
          type: "countdown",
          data: {
            events: upcoming(
              w.options.events,
              new Date((this.deps.now ?? Date.now)()),
              w.options.show,
            ),
          },
        };
      case "ai":
        return { id: w.id, type: "ai", data: aiData(this.deps) };
      case "ask":
        return { id: w.id, type: "ask", data: {} };
      case "agenda":
        // The page fetches the viewer's own calendar: it's theirs, not the widget's.
        return { id: w.id, type: "agenda", data: { days: w.options.days } };
      case "clock":
        return {
          id: w.id,
          type: "clock",
          data: { zones: w.options.zones, seconds: w.options.seconds },
        };
      case "custom": {
        const running = this.runners.get(w.id);
        if (running?.runner.frame && running.key === JSON.stringify(w.doc)) {
          return { id: w.id, type: "custom", data: running.runner.frame };
        }
        const once = new CustomRunner(w.id, w.doc, this.deps, () => {});
        return { id: w.id, type: "custom", data: await once.once() };
      }
    }
  }

  /** Status checks finished: refresh what depends on them. */
  statusChanged(): void {
    this.refreshBuiltins("status");
    for (const { runner } of this.runners.values()) runner.hearthChanged();
  }

  aiChanged(): void {
    this.refreshBuiltins("ai");
    for (const { runner } of this.runners.values()) runner.hearthChanged();
  }

  private refreshBuiltins(type: "status" | "ai") {
    for (const [id, set] of this.subs) {
      const w = this.widget(id);
      if (!w || w.type !== type) continue;
      for (const s of set) void this.current(w, s.role).then(s.fn);
    }
  }

  /** The config changed: restart widgets whose document changed, refresh the rest. */
  configChanged(): void {
    const cfg = this.deps.config();
    for (const [id, r] of this.runners) {
      const w = cfg.widgets.find((x) => x.id === id);
      if (w?.type !== "custom") {
        r.runner.stop();
        this.runners.delete(id);
      } else if (JSON.stringify(w.doc) !== r.key && this.subs.has(id)) this.ensureRunner(w);
    }
    for (const [id, set] of this.subs) {
      const w = cfg.widgets.find((x) => x.id === id);
      if (!w) continue;
      for (const s of set) {
        if (!canSee(w.audience, s.role)) continue;
        if (w.type !== "custom") void this.current(w, s.role).then(s.fn);
      }
    }
  }

  stopAll(): void {
    for (const { runner, idle } of this.runners.values()) {
      clearTimeout(idle);
      runner.stop();
    }
    this.runners.clear();
  }

  /** Run a document once, for the editor and the AI designer. */
  async preview(input: unknown): Promise<PreviewResult> {
    const { doc, issues } = checkDoc(input);
    if (!doc) return { issues, frame: null, samples: {} };
    const runner = new CustomRunner("preview", doc, this.deps, () => {});
    const frame = await runner.once();
    // Images in a draft aren't fetched; they show once the widget is saved.
    for (const b of frame.blocks) if (b.kind === "image") b.src = null;
    return { issues, frame, samples: runner.samples() };
  }

  /** Fetch a widget's image for the page. */
  async image(
    widgetId: string,
    blockId: string,
    role: Role | null,
  ): Promise<{ type: string; body: Buffer } | null> {
    const w = this.widget(widgetId);
    if (w?.type !== "custom" || !canSee(w.audience, role)) return null;
    let runner = this.runners.get(widgetId)?.runner;
    if (!runner?.frame) {
      runner = new CustomRunner(w.id, w.doc, this.deps, () => {});
      await runner.once();
    }
    const src = runner.images.get(blockId);
    if (!src) return null;
    const filled = this.deps.secrets.fill(src).text;
    const res = await guardedFetch(filled, {
      policy: { allowInternet: this.deps.config().settings.network.allowInternet },
      maxBytes: 8 * 1024 * 1024,
      timeoutMs: 10_000,
      fetch: this.deps.fetch,
    });
    if (res.status >= 400 || !/^image\/(png|jpe?g|gif|webp|avif|bmp)/.test(res.contentType))
      return null;
    return { type: res.contentType, body: res.body };
  }
}

function statusData(deps: HubDeps, role: Role | null) {
  const status = deps.status();
  // Only the role is known here: tiles kept for some people count for the admin alone.
  const tiles = visibleTiles(deps.config(), { role, profile: null }).filter(isChecked);
  const counts = { total: tiles.length, up: 0, slow: 0, down: 0, unknown: 0 };
  const downNames: string[] = [];
  for (const t of tiles) {
    const state = status[t.id]?.state ?? "unknown";
    counts[state]++;
    if (state === "down") downNames.push(t.name);
  }
  return { ...counts, downNames };
}

function aiData(deps: HubDeps) {
  return {
    servers: deps.ai.list().map((s) => ({
      id: s.id,
      name: s.name,
      state: s.state,
      models: s.models.length,
      loaded: s.loaded.map((m) => m.name),
      ms: s.ms,
    })),
  };
}

/** Upcoming events, soonest first. Yearly ones that have passed move to next year. */
export function upcoming(
  events: { name: string; date: string; emoji?: string; yearly: boolean }[],
  now: Date,
  show: number,
): { name: string; date: string; emoji?: string; days: number }[] {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const day = 86_400_000;
  return events
    .map((e) => {
      const [y, m, d] = e.date.split("-").map(Number) as [number, number, number];
      let when = Date.UTC(y, m - 1, d);
      if (e.yearly) {
        when = Date.UTC(now.getFullYear(), m - 1, d);
        if (when < today) when = Date.UTC(now.getFullYear() + 1, m - 1, d);
      }
      return {
        name: e.name,
        emoji: e.emoji,
        date: new Date(when).toISOString().slice(0, 10),
        days: Math.round((when - today) / day),
      };
    })
    .filter((e) => e.days >= 0)
    .sort((a, b) => a.days - b.days)
    .slice(0, show);
}
