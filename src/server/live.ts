/**
 * The live socket (`/api/live`): one WebSocket per open page. The page says which widgets
 * it shows; Hearth pushes their data as it changes, status dots as checks finish, and a nudge when
 * the config changes. Same-origin only, and the page's cookies decide what it may watch.
 */
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type { LiveClientMessage, LiveServerMessage, StatusMap } from "../shared/api";
import type { Role } from "../shared/config";
import type { WidgetHub } from "./widgets/runtime";

export interface LiveDeps {
  hub: WidgetHub;
  status: () => StatusMap;
  /** Who's on the other end, from the upgrade request's cookies. */
  roleOf: (req: IncomingMessage) => Role | null;
  log?: (msg: string) => void;
}

const MAX_WATCH = 60;

export class Live {
  private wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  private clients = new Set<WebSocket>();
  private beat: NodeJS.Timeout;

  constructor(private deps: LiveDeps) {
    this.beat = setInterval(() => {
      for (const ws of this.clients) {
        const alive = ws as WebSocket & { alive?: boolean };
        if (alive.alive === false) {
          ws.terminate();
          continue;
        }
        alive.alive = false;
        ws.ping();
      }
    }, 30_000);
    this.beat.unref();
  }

  attach(server: Server): void {
    server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const path = (req.url ?? "").split("?")[0];
      if (path !== "/api/live") return; // Vite's dev socket and others: not ours.
      if (!sameOrigin(req)) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.connected(ws, req));
    });
  }

  private connected(ws: WebSocket, req: IncomingMessage) {
    this.clients.add(ws);
    const role = this.deps.roleOf(req);
    let unwatch: (() => void)[] = [];
    const send = (m: LiveServerMessage) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
    };
    (ws as WebSocket & { alive?: boolean }).alive = true;
    ws.on("pong", () => {
      (ws as WebSocket & { alive?: boolean }).alive = true;
    });
    send({ type: "status", data: this.deps.status() });

    ws.on("message", (raw) => {
      let msg: LiveClientMessage;
      try {
        msg = JSON.parse(String(raw)) as LiveClientMessage;
      } catch {
        return;
      }
      if (msg.type === "ping") send({ type: "pong" });
      if (msg.type === "watch" && Array.isArray(msg.widgets)) {
        for (const u of unwatch) u();
        unwatch = [...new Set(msg.widgets)]
          .filter((id): id is string => typeof id === "string")
          .slice(0, MAX_WATCH)
          .map((id) =>
            this.deps.hub.subscribe(id, role, (update) => send({ type: "widget", update })),
          );
      }
    });
    ws.on("close", () => {
      for (const u of unwatch) u();
      this.clients.delete(ws);
    });
    ws.on("error", () => ws.terminate());
  }

  broadcast(m: LiveServerMessage): void {
    const text = JSON.stringify(m);
    for (const ws of this.clients) if (ws.readyState === WebSocket.OPEN) ws.send(text);
  }

  close(): void {
    clearInterval(this.beat);
    for (const ws of this.clients) ws.terminate();
    this.wss.close();
  }
}

function sameOrigin(req: IncomingMessage): boolean {
  const fwd = req.headers["x-forwarded-host"];
  return sameSite(req.headers.origin, req.headers.host, Array.isArray(fwd) ? fwd[0] : fwd);
}

/**
 * Whether a browser's Origin is this site. A proxy in front (DSM's, or Vite's in development) may
 * rewrite Host to Hearth's own address; then X-Forwarded-Host carries the name the browser used.
 * No Origin means not a browser (tests, curl), where cookies alone decide.
 */
export function sameSite(
  origin: string | undefined,
  host: string | undefined,
  forwardedHost?: string,
): boolean {
  if (!origin) return true;
  let from: string;
  try {
    from = new URL(origin).host;
  } catch {
    return false;
  }
  const names = [host, ...(forwardedHost ?? "").split(",")].map((h) => h?.trim()).filter(Boolean);
  return names.includes(from);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
