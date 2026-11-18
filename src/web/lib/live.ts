/**
 * The live socket, as a tiny store the page subscribes to: status dots, widget data, and a nudge
 * when the config changes. Reconnects by itself, backing off, and catches up when it's back.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { LiveServerMessage, StatusMap, WidgetUpdate } from "../../shared/api";

/** What the server says changed. */
type Changed = Extract<LiveServerMessage, { type: "changed" }>["what"];

type Listener = () => void;

const KEPT_WIDGETS = "hearth:kept-widgets";

class LiveStore {
  status: StatusMap = {};
  widgets = new Map<string, WidgetUpdate>();
  connected = false;
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private watching: string[] = [];
  private retry = 0;
  private timer: number | undefined;
  private onChanged = new Set<(what: Changed) => void>();
  private version = 0;
  /** This page may keep its widgets' last data for when the phone is away from home. */
  private keep = false;
  private saveTimer: number | undefined;
  /** When the widgets on screen were saved, if they're a kept copy. */
  keptAt: number | null = null;

  /** Whether this page may be kept (no PIN, not the admin). Off forgets what was kept. */
  setKeep(on: boolean): void {
    this.keep = on;
    if (!on) {
      try {
        localStorage.removeItem(KEPT_WIDGETS);
      } catch {}
      return;
    }
    if (!this.connected) this.restore();
  }

  private save() {
    if (!this.keep || this.saveTimer) return;
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = undefined;
      try {
        localStorage.setItem(
          KEPT_WIDGETS,
          JSON.stringify({ at: Date.now(), widgets: [...this.widgets.values()] }),
        );
      } catch {}
    }, 5000);
  }

  /** Home can't be reached: show the widgets as they were last time, if nothing's on screen. */
  private restore() {
    if (this.widgets.size || !this.keep) return;
    try {
      const raw = JSON.parse(localStorage.getItem(KEPT_WIDGETS) ?? "null") as {
        at: number;
        widgets: WidgetUpdate[];
      } | null;
      if (!raw?.widgets?.length) return;
      for (const w of raw.widgets) this.widgets.set(w.id, w);
      this.keptAt = raw.at;
      this.emit();
    } catch {}
  }

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    if (!this.ws) this.connect();
    return () => this.listeners.delete(fn);
  };

  snapshot = () => this.version;

  private emit() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  changes(fn: (what: Changed) => void): () => void {
    this.onChanged.add(fn);
    return () => this.onChanged.delete(fn);
  }

  watch(ids: string[]): void {
    this.watching = ids;
    this.send({ type: "watch", widgets: ids });
  }

  private send(m: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  /** While the socket is down, status dots still update (every reconnect attempt, at most 30 s). */
  private async pollStatus() {
    try {
      const res = await fetch("/api/status", { credentials: "same-origin" });
      if (res.ok) {
        this.status = (await res.json()) as StatusMap;
        this.emit();
      }
    } catch {
      // Offline: keep the last dots.
    }
  }

  /**
   * Someone else is using the page now (another profile): connect again as them, so the status
   * they get is theirs (their own links), and the last person's goes.
   */
  private who: string | null | undefined;
  reconnectAs(profile: string | null): void {
    if (this.who === undefined) {
      this.who = profile;
      return;
    }
    if (this.who === profile) return;
    this.who = profile;
    this.status = {};
    this.retry = 0;
    const old = this.ws;
    this.ws = null;
    if (old) {
      old.onclose = null;
      old.close();
    }
    clearTimeout(this.timer);
    this.connect();
  }

  private connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/api/live`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.connected = true;
      if (this.keptAt) {
        // Home again: what comes next is live.
        this.keptAt = null;
        this.widgets.clear();
      }
      this.send({ type: "watch", widgets: this.watching });
      this.emit();
    };
    ws.onmessage = (ev) => {
      let m: LiveServerMessage;
      try {
        m = JSON.parse(ev.data as string) as LiveServerMessage;
      } catch {
        return;
      }
      if (m.type === "status") this.status = m.data;
      else if (m.type === "widget") {
        this.widgets.set(m.update.id, m.update);
        this.save();
      } else if (m.type === "changed") for (const fn of this.onChanged) fn(m.what);
      this.emit();
    };
    ws.onclose = () => {
      this.connected = false;
      this.ws = null;
      this.restore();
      this.emit();
      void this.pollStatus();
      const wait = Math.min(30_000, 1000 * 2 ** this.retry++);
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.connect(), wait);
    };
  }
}

export const live = new LiveStore();

/** Re-render when anything live changes. */
export function useLive(): LiveStore {
  useSyncExternalStore(live.subscribe, live.snapshot);
  return live;
}

/** Ask the server to push these widgets' data. */
export function useWatch(ids: string[]): void {
  const key = ids.join(",");
  useEffect(() => {
    live.watch(key ? key.split(",") : []);
  }, [key]);
}
