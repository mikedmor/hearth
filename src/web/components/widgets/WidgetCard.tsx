/** One widget on the page: its card, kept current by the live socket. */
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Cpu, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AiWidgetData,
  ClockWidgetData,
  CountdownWidgetData,
  NoteWidgetData,
  StatusWidgetData,
  ViewWidget,
  WidgetUpdate,
} from "../../../shared/api";
import type { WidgetType } from "../../../shared/config";
import { api } from "../../lib/api";
import {
  addDays,
  byDay,
  dayKey,
  parseWhen,
  relativeDay,
  sameDay,
  startOfDay,
  timeText,
  useCalendar,
} from "../../lib/calendar";
import { cx } from "../../lib/format";
import { useLive } from "../../lib/live";
import { useHome } from "../../lib/queries";
import { Blocks } from "./Blocks";

export const DEFAULT_TITLES: Record<WidgetType, string> = {
  status: "Services",
  note: "Note",
  countdown: "Coming up",
  ai: "AI computers",
  ask: "Ask",
  agenda: "Calendar",
  clock: "Clock",
  custom: "Widget",
};

export function WidgetCard({ widget, actions }: { widget: ViewWidget; actions?: React.ReactNode }) {
  const live = useLive();
  // Without the live socket (a proxy that doesn't pass WebSockets), ask every 30 seconds instead.
  const fallback = useQuery({
    queryKey: ["widget", widget.id],
    queryFn: () => api.get<WidgetUpdate>(`/api/widgets/${encodeURIComponent(widget.id)}`),
    enabled: !live.connected,
    refetchInterval: 30_000,
  });
  const update = live.widgets.get(widget.id) ?? fallback.data;
  const stale = update?.type === "custom" && Object.values(update.data.sources).some((s) => !s.ok);
  return (
    <article
      className="card widget-card relative flex h-full flex-col p-4 sm:p-[18px]"
      aria-label={widget.title ?? DEFAULT_TITLES[widget.type]}
    >
      <header className="mb-2.5 flex min-h-6 items-center justify-between gap-2">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
          {widget.title ?? DEFAULT_TITLES[widget.type]}
        </h2>
        <div className="flex items-center gap-1">
          {stale ? <SourceProblems update={update} /> : null}
          {actions}
        </div>
      </header>
      <div className="grow">
        {update ? <Body update={update} /> : <div className="skeleton h-14" />}
      </div>
    </article>
  );
}

function SourceProblems({ update }: { update: Extract<WidgetUpdate, { type: "custom" }> }) {
  const problems = Object.entries(update.data.sources).filter(([, s]) => !s.ok);
  return (
    <span
      className="rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-semibold text-warn"
      title={problems.map(([id, s]) => `${id}: ${s.error}`).join("\n")}
    >
      {problems.length === Object.keys(update.data.sources).length ? "No data" : "Partly stale"}
    </span>
  );
}

function Body({ update }: { update: WidgetUpdate }) {
  switch (update.type) {
    case "status":
      return <StatusBody d={update.data} />;
    case "note":
      return <NoteBody d={update.data} />;
    case "countdown":
      return <CountdownBody d={update.data} />;
    case "ai":
      return <AiBody d={update.data} />;
    case "ask":
      return <AskBody />;
    case "agenda":
      return <AgendaBody days={update.data.days} />;
    case "clock":
      return <ClockBody d={update.data} />;
    case "custom":
      return <Blocks blocks={update.data.blocks} />;
  }
}

function StatusBody({ d }: { d: StatusWidgetData }) {
  if (d.total === 0) return <p className="text-sm text-muted">No services are being checked.</p>;
  const checking = d.unknown === d.total;
  const tone = checking ? "text-muted" : d.down ? "text-bad" : d.slow ? "text-warn" : "text-good";
  const headline = checking
    ? "Checking…"
    : d.down
      ? `${d.down} ${d.down === 1 ? "is" : "are"} down`
      : d.slow
        ? `${d.slow} ${d.slow === 1 ? "is" : "are"} slow`
        : d.unknown
          ? `${d.up} of ${d.total} are up`
          : d.total === 1
            ? "It's up"
            : `All ${d.total} are up`;
  const segs = [
    ...Array(d.up).fill("var(--c-positive)"),
    ...Array(d.slow).fill("var(--c-warning)"),
    ...Array(d.down).fill("var(--c-negative)"),
    ...Array(d.unknown).fill("var(--c-surface-2)"),
  ] as string[];
  return (
    <div className="grid gap-2.5">
      <p className={cx("font-heading text-[22px] font-bold tracking-tight", tone)}>{headline}</p>
      <div
        className="flex gap-1"
        role="img"
        aria-label={`${d.up} up, ${d.slow} slow, ${d.down} down, ${d.unknown} not checked yet`}
      >
        {segs.map((c, i) => (
          <span key={i} className="h-2 flex-1 rounded-full" style={{ background: c }} />
        ))}
      </div>
      <p className="text-[13px] text-muted">
        {d.downNames.length
          ? `${d.downNames.join(", ")} ${d.downNames.length === 1 ? "isn't" : "aren't"} answering.`
          : checking || d.unknown
            ? `${d.unknown} still being checked.`
            : "Live, from Hearth's own checks."}
      </p>
    </div>
  );
}

function NoteBody({ d }: { d: NoteWidgetData }) {
  const emoji = { info: "📌", warning: "⚠️", celebrate: "🎉" }[d.tone];
  return (
    <div className="flex items-start gap-3">
      <span
        className={cx(
          "grid size-10 flex-none place-items-center rounded-xl text-xl",
          d.tone === "warning" ? "bg-warn/20" : "bg-accent/15",
        )}
        aria-hidden
      >
        {emoji}
      </span>
      <p className="text-[16.5px] leading-snug text-pretty">{d.text}</p>
    </div>
  );
}

function CountdownBody({ d }: { d: CountdownWidgetData }) {
  if (!d.events.length) return <p className="text-sm text-muted">Nothing coming up.</p>;
  return (
    <ul className="grid gap-2.5">
      {d.events.map((e) => (
        <li key={`${e.name}-${e.date}`} className="flex items-center gap-3">
          <span className="w-8 text-center text-2xl" aria-hidden>
            {e.emoji ?? "📅"}
          </span>
          <span className="grid min-w-0 grow">
            <span className="truncate font-semibold">{e.name}</span>
            <span className="text-[12.5px] text-muted">
              {new Date(`${e.date}T12:00:00`).toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </span>
          </span>
          <span className="flex items-baseline gap-1 tabular-nums">
            {e.days === 0 ? (
              <strong className="text-accent">Today</strong>
            ) : e.days === 1 ? (
              <strong>Tomorrow</strong>
            ) : (
              <>
                <strong className="text-xl">{e.days}</strong>
                <small className="text-muted">days</small>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function AiBody({ d }: { d: AiWidgetData }) {
  const navigate = useNavigate();
  if (!d.servers.length)
    return (
      <p className="text-sm text-muted">No AI servers yet. The admin adds them in Settings → AI.</p>
    );
  return (
    <ul className="grid gap-2">
      {d.servers.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            onClick={() => navigate({ to: "/compute" })}
            className="flex w-full items-center gap-3 rounded-xl px-1 py-1 text-left hover:bg-[var(--c-surface-2)]"
          >
            <span
              className={cx(
                "grid size-9 place-items-center rounded-xl",
                s.state === "up"
                  ? "bg-good/15 text-good"
                  : s.state === "busy"
                    ? "bg-warn/15 text-warn"
                    : "bg-bad/15 text-bad",
              )}
            >
              <Cpu className="size-5" />
            </span>
            <span className="grid min-w-0 grow">
              <span className="truncate font-semibold">{s.name}</span>
              <span className="truncate text-[12.5px] text-muted">
                {s.state === "up"
                  ? `${s.models} model${s.models === 1 ? "" : "s"}${s.loaded.length ? ` · ${s.loaded.join(", ")} loaded` : ""}`
                  : s.state === "busy"
                    ? "Busy right now"
                    : s.state === "down"
                      ? "Not answering"
                      : "Checking…"}
              </span>
            </span>
            {s.ms ? <span className="text-[12px] tabular-nums text-muted">{s.ms} ms</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

function ClockBody({ d }: { d: ClockWidgetData }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), d.seconds ? 1000 : 10_000);
    return () => clearInterval(t);
  }, [d.seconds]);
  const fmt = (tz?: string) => {
    try {
      return now.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        ...(d.seconds ? { second: "2-digit" } : {}),
        timeZone: tz,
      });
    } catch {
      return "—";
    }
  };
  return (
    <div className="grid gap-2">
      <p className="font-heading text-[40px] leading-none font-light tracking-tight tabular-nums">
        {fmt()}
      </p>
      <p className="text-[13px] text-muted">
        {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
      </p>
      {d.zones.length ? (
        <ul className="mt-1 grid gap-1 border-t border-line pt-2">
          {d.zones.map((z) => (
            <li key={z.label + z.timeZone} className="flex justify-between text-[14px]">
              <span className="text-muted">{z.label}</span>
              <span className="font-semibold tabular-nums">{fmt(z.timeZone)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The viewer's own calendar for the next few days. */
function AgendaBody({ days }: { days: number }) {
  const { data: home } = useHome();
  const today = useMemo(() => startOfDay(new Date()), []);
  const to = useMemo(() => addDays(today, days), [today, days]);
  const cal = useCalendar(today, to, Boolean(home?.profile));
  if (home && !home.profile)
    return <p className="text-[13.5px] text-muted">Pick who you are to see your calendar.</p>;
  if (cal.error) return <p className="text-[13.5px] text-bad">{(cal.error as Error).message}</p>;
  if (!cal.data) return <div className="skeleton h-20" />;
  const colors = new Map(cal.data.calendars.map((c) => [c.id, c.color]));
  const now = Date.now();
  const map = byDay(cal.data.events);
  const shown: { day: Date; events: typeof cal.data.events }[] = [];
  let count = 0;
  for (let i = 0; i < days && count < 7; i++) {
    const day = addDays(today, i);
    // Today: only what hasn't finished yet.
    const list = (map.get(dayKey(day)) ?? []).filter(
      (e) => i > 0 || e.allDay || parseWhen(e.end).getTime() > now,
    );
    if (!list.length) continue;
    const take = list.slice(0, 7 - count);
    count += take.length;
    shown.push({ day, events: take });
  }
  return (
    <div className="grid gap-2.5">
      {shown.length ? (
        shown.map(({ day, events }) => (
          <section key={dayKey(day)} className="grid gap-1">
            <h3 className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-muted">
              {relativeDay(day, today)}
            </h3>
            <ul className="grid gap-1">
              {events.map((e) => {
                const s = parseWhen(e.start);
                return (
                  <li key={e.key} className="flex items-center gap-2 text-[14px]">
                    <span
                      className="h-5 w-1 flex-none rounded-full"
                      style={{ background: colors.get(e.calendar) ?? "var(--c-muted)" }}
                    />
                    <span className="w-14 flex-none text-[12.5px] font-semibold text-muted tabular-nums">
                      {e.allDay ? "All day" : sameDay(s, day) ? timeText(s) : "…"}
                    </span>
                    <span className="truncate font-semibold">{e.title}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      ) : (
        <p className="text-[13.5px] text-muted">
          Nothing on {days === 1 ? "today" : `in the next ${days} days`}.
        </p>
      )}
      <Link to="/calendar" className="text-[13px] font-semibold text-accent">
        Open the calendar
      </Link>
    </div>
  );
}

function AskBody() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) void navigate({ to: "/chat", search: { q: q.trim() } });
      }}
    >
      <Sparkles className="size-5 flex-none text-accent" aria-hidden />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Ask the home's AI anything…"
        aria-label="Ask the AI"
        className="h-11 min-w-0 grow rounded-xl border border-line bg-[var(--c-background)] px-3 text-[15px] focus:border-accent focus:outline-none"
      />
      <button
        type="submit"
        aria-label="Ask"
        className="grid size-11 flex-none place-items-center rounded-xl bg-accent text-white disabled:opacity-40"
        disabled={!q.trim()}
      >
        <ArrowRight className="size-5" />
      </button>
    </form>
  );
}
