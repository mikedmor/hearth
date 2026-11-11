/**
 * The live socket, as a tiny store the page subscribes to: status dots, widget data, and a nudge
 * when the config changes. Reconnects by itself, backing off, and catches up when it's back.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { LiveServerMessage, StatusMap, WidgetUpdate } from "../../shared/api";

/** What the server says changed. */
type Changed = Extract<LiveServerMessage, { type: "changed" }>["what"];

type Listener = () => void;

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
      else if (m.type === "widget") this.widgets.set(m.update.id, m.update);
      else if (m.type === "changed") for (const fn of this.onChanged) fn(m.what);
      this.emit();
    };
    ws.onclose = () => {
      this.connected = false;
      this.ws = null;
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
