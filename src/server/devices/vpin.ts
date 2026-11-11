/**
 * VPin Studio, on a pinball table: its server's REST API (port 8089, `/api/v1/`), the same one its
 * own Studio client uses on the network. It has no sign-in, so Hearth only calls it from the
 * server, and only the admin can use the controls.
 *
 * Read: what the table is, whether the frontend (PinUP Popper) runs, what's being played, the
 * tables, the latest high scores and the players' ranking. Controls: start a table, mute,
 * restart the frontend, shut the table down.
 */
import type { VpinView } from "../../shared/devices";
import { guardedFetch, NetError } from "../net";

export const VPIN_PORT = 8089;
const API = "/api/v1/";

export class VpinError extends Error {}

export interface VpinGame {
  id: number;
  name: string;
}

const HOME = { allowInternet: false } as const;

/** The base address for an address on the network: `http://192.168.1.40:8089`. */
export const vpinBase = (ip: string) => `http://${ip.includes(":") ? `[${ip}]` : ip}:${VPIN_PORT}`;

async function get(
  base: string,
  path: string,
  f?: typeof fetch,
  timeoutMs = 5000,
): Promise<unknown> {
  let r: Awaited<ReturnType<typeof guardedFetch>>;
  try {
    r = await guardedFetch(`${base}${API}${path}`, {
      policy: HOME,
      fetch: f,
      timeoutMs,
      maxBytes: 8 * 1024 * 1024,
    });
  } catch (e) {
    throw new VpinError(e instanceof NetError ? e.message : "VPin Studio didn't answer.");
  }
  if (r.status >= 400) throw new VpinError(`VPin Studio answered ${r.status}.`);
  const text = r.body.toString("utf8").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Some answers are a bare word ("true").
    return text;
  }
}

const str = (v: unknown, n = 120) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const bool = (v: unknown) =>
  typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : undefined;
/** Jackson writes times as ISO text, or as seconds (with a fraction) since 1970. */
function when(v: unknown): string | undefined {
  if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString();
  if (typeof v === "number" && Number.isFinite(v))
    return new Date(v > 1e12 ? v : v * 1000).toISOString();
  return undefined;
}

/**
 * "12,345,670": a score as people read it. The number when there is one; VPin Studio's own text
 * ("5) DAD      431,740") repeats the place and initials, so those come off it.
 */
export function scoreText(raw: unknown, score: unknown, initials?: string): string {
  const n = num(score);
  if (n !== undefined && n > 0) return n.toLocaleString("en-US");
  let s = str(raw, 60) ?? "";
  s = s.replace(/^\s*#?\d+[).:]?\s+/, "");
  const ini = initials?.replace(/[^A-Za-z0-9]/g, "");
  if (ini) s = s.replace(new RegExp(`^${ini}\\s+`, "i"), "");
  return s.replace(/\s+/g, " ").trim();
}

/** "GRAND CHAMPION" → "Grand champion". */
const label = (v: unknown) => {
  const s = str(v, 40);
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : undefined;
};

/** The tables, by id (for names in scores and what's being played, and the launch list). */
export async function vpinGames(base: string, f?: typeof fetch): Promise<VpinGame[]> {
  const list = await get(base, "games", f, 15_000);
  if (!Array.isArray(list)) return [];
  return list
    .flatMap((g: Record<string, unknown>) => {
      const id = num(g?.id);
      const name = str(g?.gameDisplayName) ?? str(g?.gameName) ?? str(g?.gameFileName);
      if (id === undefined || !name || g?.disabled === true) return [];
      return [{ id, name }];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Everything the devices page shows about the table. `games` names the tables by id. */
export async function vpinState(
  base: string,
  games: Map<number, string>,
  f?: typeof fetch,
): Promise<Omit<VpinView, "url" | "ok" | "error" | "tables">> {
  // What it is first: if this doesn't answer, nothing else will.
  const system = (await get(base, "system", f)) as Record<string, unknown> | null;
  const [running, status, muted, recent, ranked] = await Promise.all([
    get(base, "frontend/running", f).catch(() => undefined),
    get(base, "gamestatus", f).catch(() => undefined),
    get(base, "system/muted", f).catch(() => undefined),
    get(base, "games/recent/10", f).catch(() => undefined),
    get(base, "players/ranked", f).catch(() => undefined),
  ]);
  const st = (status ?? {}) as Record<string, unknown>;
  const gameId = num(st.gameId);
  const playing =
    gameId !== undefined && gameId > 0
      ? { id: gameId, name: games.get(gameId) ?? `Table ${gameId}`, since: when(st.started) }
      : undefined;
  const lastId = num(st.lastActiveId);
  const last =
    lastId !== undefined && lastId > 0 && games.has(lastId)
      ? { id: lastId, name: games.get(lastId) as string }
      : undefined;
  const scores = (
    Array.isArray((recent as Record<string, unknown>)?.scores)
      ? ((recent as Record<string, unknown>).scores as Record<string, unknown>[])
      : []
  )
    .slice(0, 10)
    .map((s) => {
      const player = (s.player ?? {}) as Record<string, unknown>;
      const id = num(s.gameId);
      const initials = str(s.playerInitials, 8) ?? str(player.initials, 8) ?? "???";
      return {
        initials,
        name: str(player.name, 60),
        score: scoreText(s.formattedScore ?? s.rawScore, s.score, initials),
        gameId: id,
        label: label(s.label),
        table: (id !== undefined ? games.get(id) : undefined) ?? (id ? `Table ${id}` : "A table"),
        position: num(s.position),
        at: when(s.createdAt),
      };
    });
  const players = (Array.isArray(ranked) ? (ranked as Record<string, unknown>[]) : [])
    .slice(0, 10)
    .map((p) => ({
      name: str(p.name, 60) ?? str(p.initials, 8) ?? "Player",
      initials: str(p.initials, 8),
      rank: num(p.rank) ?? 0,
      points: num(p.points) ?? 0,
      first: num(p.first) ?? 0,
      second: num(p.second) ?? 0,
      third: num(p.third) ?? 0,
    }));
  return {
    system: { name: str(system?.systemName, 60), version: str(system?.version, 30) },
    frontendRunning: bool(running),
    muted: bool(muted),
    playing,
    last,
    scores,
    players,
    checkedAt: new Date().toISOString(),
  };
}

/** A table's wheel art as VPin Studio keeps it (a PNG), or null when it has none. */
export async function vpinWheel(
  base: string,
  gameId: number,
  f?: typeof fetch,
): Promise<Buffer | null> {
  let r: Awaited<ReturnType<typeof guardedFetch>>;
  try {
    r = await guardedFetch(`${base}${API}media/${Math.trunc(gameId)}/Wheel`, {
      policy: HOME,
      fetch: f,
      timeoutMs: 15_000,
      maxBytes: 12 * 1024 * 1024,
    });
  } catch (e) {
    throw new VpinError(e instanceof NetError ? e.message : "VPin Studio didn't answer.");
  }
  if (r.status === 404) return null;
  if (r.status >= 400) throw new VpinError(`VPin Studio answered ${r.status}.`);
  return r.body;
}

export type VpinAction = "launch" | "mute" | "unmute" | "restart" | "shutdown";

/** Do something on the table. Each is a GET in VPin Studio's API. */
export async function vpinDo(
  base: string,
  action: VpinAction,
  gameId?: number,
  f?: typeof fetch,
): Promise<void> {
  const path =
    action === "launch"
      ? `frontend/launch/${Math.trunc(gameId ?? -1)}`
      : action === "mute"
        ? "system/mute/1"
        : action === "unmute"
          ? "system/mute/0"
          : action === "restart"
            ? "frontend/restart"
            : "system/systemshutdown";
  if (action === "launch" && !(gameId && gameId > 0)) throw new VpinError("Pick a table.");
  const ok = await get(base, path, f, 20_000);
  if (ok === false || ok === "false") throw new VpinError("VPin Studio said it couldn't.");
}
