/**
 * The Pinball widget: the table's art and what's on, the latest high scores with each table's
 * wheel, the players' podium, and for the admin, one tap to start a table played lately, a search
 * over every table, mute and restart.
 */
import { useQuery } from "@tanstack/react-query";
import { Joystick, Play, RotateCcw, Search, Trophy, Volume2, VolumeX } from "lucide-react";
import { useMemo, useState } from "react";
import type { PinballWidgetData } from "../../../shared/api";
import { api } from "../../lib/api";
import { cx } from "../../lib/format";
import { useHome } from "../../lib/queries";
import { useToast } from "../ui";

const MEDALS = ["🥇", "🥈", "🥉"];

function ago(iso?: string): string | undefined {
  if (!iso) return undefined;
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return undefined;
  const min = Math.round(ms / 60_000);
  if (min < 2) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 2) return "yesterday";
  if (d < 45) return `${d} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

/** A table's round logo from the frontend, or the joystick when it has none. */
function Wheel({
  device,
  game,
  size,
  className,
}: {
  device?: string;
  game?: number;
  size: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (!device || !game || failed)
    return (
      <span
        style={style}
        className={cx(
          "grid flex-none place-items-center rounded-full bg-(--c-surface-2) text-muted",
          className,
        )}
      >
        <Joystick style={{ width: size * 0.45, height: size * 0.45 }} />
      </span>
    );
  return (
    <img
      src={`/api/pinball/${encodeURIComponent(device)}/wheel/${game}`}
      alt=""
      loading="lazy"
      style={style}
      onError={() => setFailed(true)}
      className={cx("flex-none object-contain drop-shadow-sm", className)}
    />
  );
}

export function PinballBody({ d }: { d: PinballWidgetData }) {
  if (d.missing)
    return (
      <p className="text-sm text-muted">
        No pinball table yet. The admin finds one on the Devices page: a table running VPin Studio
        shows up once its ports are checked.
      </p>
    );
  const shown = d.playing ?? d.last;
  const since = d.playing?.since
    ? new Date(d.playing.since).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : undefined;
  return (
    <div className="grid gap-3.5">
      {/* What's on */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <Wheel device={d.device} game={shown?.id} size={64} />
          <span
            title={d.playing ? "Playing" : d.on ? "On" : "Off"}
            className={cx(
              "absolute right-0.5 bottom-0.5 size-3 rounded-full ring-2 ring-(--c-surface)",
              d.playing ? "bg-good" : d.on ? "bg-accent" : "bg-muted/60",
            )}
          />
        </div>
        <div className="grid min-w-0 gap-0.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted">
            {d.playing ? "Playing now" : d.on ? "Ready to play" : "Switched off"}
          </span>
          <span className="truncate text-[16px] leading-tight font-semibold">
            {d.playing ? d.playing.name : d.last ? d.last.name : (d.name ?? "The pinball table")}
          </span>
          <span className="truncate text-[12.5px] text-muted">
            {[
              d.playing ? (since ? `since ${since}` : null) : d.last ? "played last" : null,
              d.name && (d.playing || d.last) ? d.name : null,
              d.tables ? `${d.tables} tables` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      </div>

      {/* High scores */}
      {d.scores.length ? (
        <section className="grid gap-1.5">
          <h4 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">
            <Trophy className="size-3.5" /> Latest high scores
          </h4>
          <ol className="grid gap-2">
            {d.scores.map((s, i) => (
              <li key={`${s.table}-${s.initials}-${i}`} className="flex items-center gap-2.5">
                <Wheel device={d.device} game={s.gameId} size={32} />
                <span className="grid min-w-0 grow">
                  <span className="truncate text-[13.5px] font-medium">{s.table}</span>
                  <span className="truncate text-[11.5px] text-muted">
                    <b className="font-semibold text-ink">{s.initials}</b>
                    {s.label ? ` · ${s.label}` : s.position ? ` · #${s.position}` : ""}
                    {s.at ? ` · ${ago(s.at)}` : ""}
                  </span>
                </span>
                <span className="text-[14px] font-bold tabular-nums">{s.score}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {/* Players */}
      {d.players.length ? (
        <section className="grid gap-1.5">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted">Players</h4>
          <ol className="grid gap-1">
            {d.players.slice(0, 3).map((p, i) => (
              <li
                key={`${p.name}-${i}`}
                className="flex items-center gap-2 rounded-xl bg-(--c-surface-2) px-2.5 py-1.5"
              >
                <span className="text-[17px] leading-none" title={`Number ${p.rank || i + 1}`}>
                  {MEDALS[i] ?? `${p.rank}.`}
                </span>
                <span className="min-w-0 grow truncate text-[13.5px] font-semibold">{p.name}</span>
                <span className="text-[11.5px] text-muted tabular-nums">
                  {p.first ? `${p.first} first · ` : ""}
                  <b className="text-[13px] font-bold text-ink">{p.points}</b> pts
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {d.on && d.device ? <PinballControls d={d} device={d.device} /> : null}
    </div>
  );
}

function PinballControls({ d, device }: { d: PinballWidgetData; device: string }) {
  const admin = Boolean(useHome().data?.session.admin);
  const toast = useToast();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const base = `/api/admin/devices/${encodeURIComponent(device)}`;
  // Ready before anyone opens it: the table answers in a moment, and the list hardly changes.
  const tables = useQuery({
    queryKey: ["pinball-tables", device],
    queryFn: () => api.get<{ tables: { id: number; name: string }[] }>(`${base}/tables`),
    enabled: admin,
    staleTime: 10 * 60_000,
  });
  const matches = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return (tables.data?.tables ?? [])
      .filter((t) => words.every((w) => t.name.toLowerCase().includes(w)))
      .slice(0, 8);
  }, [q, tables.data]);
  if (!admin) return null;

  const run = async (action: string, done: string, gameId?: number) => {
    setBusy(action + (gameId ?? ""));
    try {
      await api.post(`${base}/table`, { action, gameId });
      toast(done);
    } catch (e) {
      toast((e as Error).message, "bad");
    }
    setBusy(null);
  };
  const start = (t: { id: number; name: string }) => {
    setQ("");
    void run("launch", `Starting ${t.name}`, t.id);
  };
  const button =
    "flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12.5px] font-semibold hover:border-accent disabled:opacity-50";

  return (
    <section className="grid gap-2 border-t border-line pt-3">
      {d.recent.length ? (
        <>
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted">Play again</h4>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {d.recent.map((t) => (
              <button
                key={t.id}
                type="button"
                title={`Start ${t.name}`}
                disabled={busy !== null || d.playing?.id === t.id}
                onClick={() => start(t)}
                className="group grid w-18 flex-none justify-items-center gap-1 rounded-xl p-1 text-center hover:bg-(--c-surface-2) disabled:opacity-50"
              >
                <span className="relative">
                  <Wheel device={device} game={t.id} size={48} />
                  <span className="absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white opacity-0 transition group-hover:opacity-100">
                    <Play className="size-4 fill-current" />
                  </span>
                </span>
                <span className="line-clamp-2 text-[10.5px] leading-tight text-muted">
                  {t.name.replace(/\s*\([^)]*\)\s*$/, "")}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}
      <div className="relative">
        <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={
            tables.isLoading
              ? "Finding the tables…"
              : `Find a table to start (${tables.data?.tables.length ?? d.tables ?? 0})`
          }
          aria-label="Find a table to start"
          className="h-8 w-full rounded-lg border border-line bg-page pr-2 pl-8 text-[13px] focus:border-accent focus:outline-none"
        />
        {matches.length ? (
          <ul className="absolute inset-x-0 top-9 z-20 grid max-h-64 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-xl">
            {matches.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => start(t)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-(--c-surface-2)"
                >
                  <Wheel device={device} game={t.id} size={24} />
                  <span className="grow truncate">{t.name}</span>
                  <Play className="size-3.5 text-muted" />
                </button>
              </li>
            ))}
          </ul>
        ) : q && tables.data ? (
          <p className="mt-1 text-[12px] text-muted">No table called that.</p>
        ) : null}
        {tables.error ? (
          <p className="mt-1 text-[12px] text-bad">{(tables.error as Error).message}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className={button}
          disabled={busy !== null}
          onClick={() => (d.muted ? run("unmute", "Sound is on") : run("mute", "Muted"))}
        >
          {d.muted ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
          {d.muted ? "Unmute" : "Mute"}
        </button>
        <button
          type="button"
          className={button}
          disabled={busy !== null}
          onClick={() => run("restart", "Restarting the frontend")}
        >
          <RotateCcw className="size-3.5" /> Restart the frontend
        </button>
      </div>
    </section>
  );
}
