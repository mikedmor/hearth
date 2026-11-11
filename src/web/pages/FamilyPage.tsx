/**
 * The Family page, for the admin and the parents they choose: every child at a glance (what's in
 * effect, what changes next, today's activity), what needs a look (sites their devices were
 * blocked from), and each child's own page with their activity by day and device, and their rules.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  DoorOpen,
  EyeOff,
  Globe,
  Hand,
  Lock,
  LockOpen,
  Pause,
  Play,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import type { PublicProfile } from "../../shared/api";
import type {
  AskRequest,
  AttentionRow,
  ChildDevice,
  ChildSummary,
  ChildView,
  FamilyView,
  ModeNow,
  Visitor,
} from "../../shared/internet";
import { type Act, RulesEditor } from "../components/family/RulesEditor";
import { hereKey } from "../components/internet/HereBanner";
import { Avatar } from "../components/Picker";
import { Button, ErrorNote, Modal, Segmented, useToast } from "../components/ui";
import { api } from "../lib/api";
import { cx } from "../lib/format";
import { live } from "../lib/live";
import { useHome } from "../lib/queries";

const KEY = ["family"] as const;

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** "now", "4 minutes ago", "3:40 pm", "yesterday 9:12 pm". */
function when(iso?: string): string {
  if (!iso) return "not seen yet";
  const ms = Date.now() - Date.parse(iso);
  if (ms < 2 * 60_000) return "now";
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)} minutes ago`;
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? timeOf(iso) : `${d.toLocaleDateString([], { weekday: "short" })} ${timeOf(iso)}`;
}

const MODE_WORDS = { open: "the whole internet", sites: "only their sites", paused: "paused" };

/** What's in effect, in words: "Only their sites", "Paused by Alex until 4:30 pm", "Bedtime: paused". */
function nowText(now: ModeNow, pausedBy?: string): string {
  const what =
    now.mode === "paused" ? "Paused" : now.mode === "sites" ? "Only their sites" : "Whole internet";
  if (now.because === "pause")
    return `Paused${pausedBy ? ` by ${pausedBy}` : ""}${now.until ? ` until ${timeOf(now.until)}` : " until resumed"}`;
  if (now.because === "schedule") return `${now.schedule ?? "Schedule"}: ${what.toLowerCase()}`;
  return what;
}

function nextText(next: ChildSummary["next"]): string | null {
  if (!next) return null;
  return `${next.schedule ? `${next.schedule}: ` : ""}${MODE_WORDS[next.mode]} at ${timeOf(next.at)}`;
}

const TONE = {
  open: { icon: Globe, cls: "text-good" },
  sites: { icon: ShieldCheck, cls: "text-accent" },
  paused: { icon: ShieldOff, cls: "text-bad" },
};

function useAct(): Act {
  const qc = useQueryClient();
  const toast = useToast();
  return async (fn, done) => {
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: KEY });
      await qc.invalidateQueries({ queryKey: hereKey });
      if (done) toast(done);
      return true;
    } catch (e) {
      toast((e as Error).message);
      return false;
    }
  };
}

function useFamilyLive() {
  const qc = useQueryClient();
  useEffect(
    () =>
      live.changes((what) => {
        if (what === "internet" || what === "config" || what === "session")
          void qc.invalidateQueries({ queryKey: KEY });
      }),
    [qc],
  );
}

function useNames() {
  const home = useHome();
  const profiles = home.data?.profiles ?? [];
  return {
    profile: (id: string) => profiles.find((p) => p.id === id),
    name: (id: string) =>
      id === "admin" ? "the admin" : (profiles.find((p) => p.id === id)?.name ?? id),
  };
}

// ---------------------------------------------------------------------------
// Activity by hour: one series, the accent colour, a tooltip on each bar

const HOUR = (h: number) => `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`;

export function HoursChart({ hours, big = false }: { hours: number[]; big?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...hours);
  const total = hours.reduce((a, b) => a + b, 0);
  return (
    <figure className="m-0">
      <div
        className={cx("relative flex items-end gap-0.5 border-b border-line", big ? "h-24" : "h-8")}
      >
        {hours.map((n, h) => (
          <button
            type="button"
            key={HOUR(h)}
            aria-label={`${HOUR(h)}: ${n} lookup${n === 1 ? "" : "s"}`}
            className="relative flex h-full flex-1 cursor-default items-end focus:outline-none"
            onMouseEnter={() => setHover(h)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(h)}
            onBlur={() => setHover(null)}
            title={big ? undefined : `${HOUR(h)}: ${n} lookup${n === 1 ? "" : "s"}`}
          >
            <div
              className={cx(
                "w-full bg-accent transition-opacity",
                big ? "rounded-t-sm" : "rounded-t-xs",
                hover !== null && hover !== h && "opacity-50",
              )}
              style={{ height: n ? `${Math.max(6, (n / max) * 100)}%` : 0 }}
            />
            {big && hover === h ? (
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 rounded-lg border border-line bg-surface px-2 py-1 text-[12px] whitespace-nowrap text-ink shadow-sm">
                {HOUR(h)}–{HOUR((h + 1) % 24)} · <b>{n}</b> lookup{n === 1 ? "" : "s"}
              </div>
            ) : null}
          </button>
        ))}
      </div>
      {big ? (
        <div className="mt-1 flex justify-between text-[11.5px] text-muted" aria-hidden>
          <span>12 am</span>
          <span>6 am</span>
          <span>12 pm</span>
          <span>6 pm</span>
          <span>11 pm</span>
        </div>
      ) : null}
      <figcaption className="sr-only">
        Lookups by hour, {total} in all:{" "}
        {hours
          .map((n, h) => (n ? `${HOUR(h)} ${n}` : null))
          .filter(Boolean)
          .join(", ") || "none"}
        .
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Pause and unlock

function PauseButton({ c, name, act }: { c: ChildSummary; name: string; act: Act }) {
  const [open, setOpen] = useState(false);
  if (c.pause)
    return (
      <Button
        size="sm"
        variant="secondary"
        onClick={() => act(() => api.post(`/api/family/${c.person}/resume`), `${name} is back on`)}
      >
        <Play className="size-4" /> Resume
      </Button>
    );
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Pause className="size-4" /> Pause
      </Button>
      {open ? (
        <Modal open onClose={() => setOpen(false)} title={`Pause ${name}'s internet`}>
          <div className="grid gap-2">
            <p className="text-[13.5px] text-muted">
              Every one of their devices, until then. A pause beats their schedules.
            </p>
            {[
              { m: 30, l: "For 30 minutes" },
              { m: 60, l: "For 1 hour" },
              { m: 120, l: "For 2 hours" },
              { m: null, l: "Until I resume it" },
            ].map((x) => (
              <Button
                key={x.l}
                variant="secondary"
                onClick={async () => {
                  if (
                    await act(
                      () => api.post(`/api/family/${c.person}/pause`, { minutes: x.m }),
                      `${name}'s internet is paused`,
                    )
                  )
                    setOpen(false);
                }}
              >
                {x.l}
              </Button>
            ))}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

const DURATIONS = [
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hour" },
  { value: 120, label: "2 hours" },
  { value: 240, label: "4 hours" },
];

function UnlockButton({
  devices,
  name,
  act,
  only,
}: {
  devices: ChildDevice[];
  name: string;
  act: Act;
  /** Unlock this device without asking which. */
  only?: ChildDevice;
}) {
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState(60);
  const choices = only ? [only] : devices.filter((d) => !d.unlocked);
  const [device, setDevice] = useState(choices[0]?.id ?? "");
  if (!choices.length) return null;
  const unlock = async (id: string) => {
    const d = choices.find((x) => x.id === id);
    if (
      await act(
        () => api.post(`/api/family/devices/${id}/unlock`, { minutes }),
        `${d?.name ?? "It"} is unlocked`,
      )
    )
      setOpen(false);
  };
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <LockOpen className="size-4" /> Unlock
      </Button>
      {open ? (
        <Modal
          open
          onClose={() => setOpen(false)}
          title={only ? `Unlock ${only.name}` : `Unlock one of ${name}'s devices`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={!device && !only}
                onClick={() => unlock(only?.id ?? device)}
              >
                Unlock
              </Button>
            </>
          }
        >
          <div className="grid gap-4">
            <p className="text-[13.5px] text-muted">
              Its rules lift for a while, on that device only, then come back by themselves.
            </p>
            {!only && choices.length > 1 ? (
              <Segmented
                label="Which device"
                value={device}
                onChange={setDevice}
                options={choices.map((d) => ({ value: d.id, label: d.name }))}
              />
            ) : null}
            <Segmented
              label="For how long"
              value={minutes}
              onChange={setMinutes}
              options={DURATIONS}
            />
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// The overview

export function FamilyPage() {
  useFamilyLive();
  const home = useHome();
  const act = useAct();
  const names = useNames();
  const q = useQuery({
    queryKey: KEY,
    queryFn: () => api.get<FamilyView>("/api/family"),
    refetchInterval: 20_000,
    enabled: Boolean(home.data?.family),
  });
  if (home.data && !home.data.family) return <NotForYou profile={home.data.profile} />;
  if (!q.data)
    return (
      <main className="shell pb-24">
        {q.error ? <ErrorNote error={q.error} /> : <div className="skeleton h-64" />}
      </main>
    );
  const v = q.data;
  return (
    <main className="shell grid gap-5 pb-24">
      <div>
        <h1 className="font-heading text-2xl font-bold">Family</h1>
        <p className="mt-0.5 text-[13.5px] text-muted">
          What the children's devices can reach right now, what they've been doing today, and what
          they tried that was blocked.
        </p>
      </div>
      {!v.enabled ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-[13.5px]">
          <ShieldOff className="size-5 flex-none text-muted" />
          <span className="grow">
            <b>Internet controls are off.</b> Nothing is limited yet; activity is still recorded.
          </span>
          {v.admin ? (
            <Link
              to="/settings"
              search={{ tab: "internet" }}
              className="font-semibold text-accent hover:underline"
            >
              Turn them on in Settings → Internet
            </Link>
          ) : null}
        </div>
      ) : null}

      <Requests rows={v.requests} act={act} names={names} />
      <FrontDoor rows={v.visitors} act={act} />
      <Attention rows={v.attention} act={act} names={names} />

      {v.children.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {v.children.map((c) => (
            <ChildCard key={c.person} c={c} act={act} names={names} />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-line p-6 text-center text-muted">
          No children yet. The admin gives someone the child role in Settings → People.
        </p>
      )}
    </main>
  );
}

function NotForYou({ profile }: { profile: PublicProfile | null }) {
  return (
    <main className="shell pb-24">
      <div className="card mx-auto max-w-lg p-6 text-center">
        <h1 className="text-xl font-bold">The Family page is for parents</h1>
        <p className="mt-2 text-[13.5px] text-muted">
          {profile
            ? "The admin chooses who's a parent (Settings → Internet), and a parent needs a PIN."
            : "Open your own page first (Who's here?), with your PIN."}
        </p>
      </div>
    </main>
  );
}

type Names = ReturnType<typeof useNames>;

/** Devices asking for a guest pass: let them in, or not now. */
function FrontDoor({ rows, act }: { rows: Visitor[]; act: Act }) {
  if (!rows.length) return null;
  return (
    <section className="card grid gap-3 p-5">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <DoorOpen className="size-5 text-accent" /> Asking for a guest pass
      </h2>
      <p className="text-[13px] text-muted">
        New devices on the family network, with no internet until they get a guest pass.
      </p>
      <ul className="grid gap-1.5">
        {rows.map((r) => {
          const label = r.asked?.name ?? r.name ?? "A device";
          return (
            <li
              key={r.ip}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line px-3 py-2 text-[13.5px]"
            >
              <span className="min-w-0 grow">
                <b>{label}</b>
                <span className="text-muted">
                  {" "}
                  · {r.ip}
                  {r.asked ? " · asked to come in" : ""} · {when(r.last)}
                </span>
              </span>
              <span className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() =>
                    act(
                      () =>
                        api.post(`/api/family/door/${r.ip}`, {
                          admit: true,
                          name: r.asked?.name ?? r.name,
                        }),
                      `${label} is in`,
                    )
                  }
                >
                  <Check className="size-4" /> Let in
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => act(() => api.post(`/api/family/door/${r.ip}`, { admit: false }))}
                >
                  Not now
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Children asking from their devices: more time, or a site. */
function Requests({ rows, act, names }: { rows: AskRequest[]; act: Act; names: Names }) {
  if (!rows.length) return null;
  const answer = (r: AskRequest, approve: boolean, who: string) =>
    act(
      () => api.post(`/api/family/requests/${r.id}`, { approve }),
      approve
        ? r.kind === "time"
          ? `${who} has ${r.minutes} more minutes`
          : `${r.site} is allowed for ${who}`
        : `Told ${who} not this time`,
    );
  return (
    <section className="card grid gap-3 border-accent/50 p-5">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <Hand className="size-5 text-accent" /> Asking you
      </h2>
      <ul className="grid gap-1.5">
        {rows.map((r) => {
          const p = names.profile(r.person);
          const who = p?.name ?? r.person;
          return (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line px-3 py-2 text-[13.5px]"
            >
              {p ? <Avatar p={p} size="xs" /> : null}
              <span className="min-w-0 grow">
                <b>{who}</b> asks for{" "}
                <b>{r.kind === "time" ? `${r.minutes} more minutes` : r.site}</b>
                {r.note ? <> “{r.note}”</> : null}
                <span className="text-muted"> · {when(r.at)}</span>
              </span>
              <span className="flex gap-1.5">
                <Button size="sm" variant="primary" onClick={() => answer(r, true, who)}>
                  <Check className="size-4" /> {r.kind === "time" ? "Yes" : "Allow"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => answer(r, false, who)}>
                  Not now
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Attention({ rows, act, names }: { rows: AttentionRow[]; act: Act; names: Names }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 5);
  return (
    <section className="card grid gap-3 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-bold">Needs a look</h2>
        <span className="text-[12.5px] text-muted">Blocked in the last 3 days</span>
      </div>
      {rows.length ? (
        <ul className="grid gap-1.5">
          {shown.map((r) => {
            const p = names.profile(r.person);
            return (
              <li
                key={`${r.person}:${r.site}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line px-3 py-2 text-[13.5px]"
              >
                {p ? <Avatar p={p} size="xs" /> : null}
                <span className="min-w-0 grow">
                  <b>{p?.name ?? r.person}</b> tried <b>{r.site}</b>
                  <span className="text-muted">
                    {" "}
                    · {r.blocked} time{r.blocked === 1 ? "" : "s"} · {when(r.last)}
                    {r.after ? ` · while using ${r.after}` : ""}
                  </span>
                </span>
                <span className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      act(
                        () => api.post(`/api/family/${r.person}/allow`, { site: r.site }),
                        `${r.site} is allowed for ${p?.name ?? r.person}`,
                      )
                    }
                  >
                    <Check className="size-4" /> Allow
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      act(
                        () => api.post(`/api/family/${r.person}/dismiss`, { site: r.site }),
                        "Dismissed: it stays blocked",
                      )
                    }
                  >
                    <EyeOff className="size-4" /> Dismiss
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[13px] text-muted">
          Nothing new. When a child's device is blocked from a site, it shows up here to allow or
          dismiss.
        </p>
      )}
      {rows.length > 5 ? (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="justify-self-start text-[13px] font-semibold text-accent hover:underline"
        >
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      ) : null}
    </section>
  );
}

function Status({ c, names }: { c: ChildSummary; names: Names }) {
  const tone = TONE[c.now.mode];
  const Icon = tone.icon;
  const next = nextText(c.next);
  return (
    <div className="grid gap-0.5">
      <span className={cx("flex items-center gap-1.5 font-semibold", tone.cls)}>
        <Icon className="size-4" />
        {nowText(c.now, c.pause ? names.name(c.pause.by) : undefined)}
      </span>
      {next ? (
        <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
          <Clock className="size-3.5" /> Then {next}
        </span>
      ) : null}
    </div>
  );
}

function lastSeen(c: ChildSummary): ChildDevice | undefined {
  return [...c.devices]
    .filter((d) => d.lastActive)
    .sort((a, b) => (b.lastActive ?? "").localeCompare(a.lastActive ?? ""))[0];
}

function ChildCard({ c, act, names }: { c: ChildSummary; act: Act; names: Names }) {
  const p = names.profile(c.person);
  const name = p?.name ?? c.person;
  const recent = lastSeen(c);
  const unlocked = c.devices.filter((d) => d.unlocked);
  return (
    <section className="card grid gap-3 p-5">
      <Link
        to="/family/$id"
        params={{ id: c.person }}
        className="flex items-center gap-3 rounded-xl hover:opacity-90"
      >
        {p ? <Avatar p={p} /> : null}
        <span className="grow">
          <span className="block text-[17px] font-bold">{name}</span>
          <span className="text-[12.5px] text-muted">
            {!c.devices.length
              ? "No devices yet"
              : recent
                ? `Active on ${recent.name} · ${when(recent.lastActive)}`
                : `${c.devices.length} device${c.devices.length === 1 ? "" : "s"}, not active today`}
          </span>
        </span>
        <ChevronRight className="size-5 text-muted" />
      </Link>
      <Status c={c} names={names} />
      {unlocked.map((d) => (
        <p key={d.id} className="flex items-center gap-1.5 text-[13px] text-good">
          <LockOpen className="size-4" /> {d.name} unlocked by {names.name(d.unlocked?.by ?? "")}{" "}
          until {timeOf(d.unlocked?.until ?? "")}
        </p>
      ))}
      <div className="grid gap-2 rounded-xl bg-(--c-surface-2) p-3">
        <div className="flex items-baseline justify-between gap-2 text-[13px]">
          <span className="font-semibold">Today</span>
          <span className="text-muted">
            {c.today.sites} site{c.today.sites === 1 ? "" : "s"}
            {c.today.blocked ? ` · ${c.today.blocked} blocked` : ""}
          </span>
        </div>
        <HoursChart hours={c.today.hours} />
        {c.today.top.length ? (
          <p className="truncate text-[12.5px] text-muted">{c.today.top.join(" · ")}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <PauseButton c={c} name={name} act={act} />
        <UnlockButton devices={c.devices} name={name} act={act} />
        <Link
          to="/family/$id"
          params={{ id: c.person }}
          className="ml-auto inline-flex h-8 items-center gap-1 rounded-full px-3 text-[13px] font-semibold text-accent hover:underline"
        >
          Activity and rules <ChevronRight className="size-4" />
        </Link>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// One child

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card grid gap-3 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

const shiftDay = (day: string, by: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
};

export function ChildPage() {
  useFamilyLive();
  const { id } = useParams({ strict: false }) as { id: string };
  const home = useHome();
  const act = useAct();
  const names = useNames();
  const [day, setDay] = useState<string | undefined>(undefined);
  const [device, setDevice] = useState<string>("");
  const [showDismissed, setShowDismissed] = useState(false);
  const q = useQuery({
    queryKey: [...KEY, id, day ?? "today", device],
    queryFn: () =>
      api.get<ChildView>(
        `/api/family/${encodeURIComponent(id)}?${new URLSearchParams({
          ...(day ? { day } : {}),
          ...(device ? { device } : {}),
        })}`,
      ),
    refetchInterval: 30_000,
    enabled: Boolean(home.data?.family),
  });
  if (home.data && !home.data.family) return <NotForYou profile={home.data.profile} />;
  if (!q.data)
    return (
      <main className="shell pb-24">
        {q.error ? <ErrorNote error={q.error} /> : <div className="skeleton h-64" />}
      </main>
    );
  const v = q.data;
  const c = v.summary;
  const p = names.profile(c.person);
  const name = p?.name ?? c.person;
  const deviceName = (d: string) => c.devices.find((x) => x.id === d)?.name ?? d;
  const kept = v.days;
  const today = kept[0] === v.day && !day;
  const reached = v.sites.filter((s) => s.n > s.blocked).length;
  const blocked = v.blocked.filter((b) => showDismissed || !b.dismissed);
  const dismissedCount = v.blocked.filter((b) => b.dismissed).length;

  return (
    <main className="shell grid gap-5 pb-24">
      <Link
        to="/family"
        className="flex items-center gap-1.5 text-[13.5px] font-semibold text-muted hover:text-ink"
      >
        <ArrowLeft className="size-4" /> Family
      </Link>
      <div className="flex flex-wrap items-center gap-4">
        {p ? <Avatar p={p} size="lg" /> : null}
        <div className="grid grow gap-1">
          <h1 className="font-heading text-2xl font-bold">{name}</h1>
          <Status c={c} names={names} />
        </div>
        <div className="flex flex-wrap gap-2">
          <PauseButton c={c} name={name} act={act} />
          <UnlockButton devices={c.devices} name={name} act={act} />
        </div>
      </div>
      {!v.enabled ? (
        <p className="rounded-xl bg-(--c-surface-2) px-3 py-2 text-[13px]">
          Internet controls are off, so none of this is limiting {name} yet. Activity is still
          recorded.
        </p>
      ) : null}

      <Section title="Devices">
        {c.devices.length ? (
          <ul className="grid gap-1.5">
            {c.devices.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line px-3 py-2 text-[13.5px]"
              >
                <span className="grow">
                  <b>{d.name}</b>{" "}
                  <span className="text-muted">
                    · {d.lastActive ? `active ${when(d.lastActive)}` : "not active today"}
                  </span>
                </span>
                {d.unlocked ? (
                  <>
                    <span className="text-good">
                      Unlocked by {names.name(d.unlocked.by)} until {timeOf(d.unlocked.until)}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        act(
                          () => api.post(`/api/family/devices/${d.id}/lock`),
                          `${d.name} is locked`,
                        )
                      }
                    >
                      <Lock className="size-4" /> Lock
                    </Button>
                  </>
                ) : (
                  <UnlockButton devices={c.devices} name={name} act={act} only={d} />
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">
            No devices yet. The admin says which devices are {name}'s on the Devices page; their
            rules follow those devices.
          </p>
        )}
      </Section>

      <Section
        title="Activity"
        aside={
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="The day before"
              disabled={!kept.includes(shiftDay(v.day, -1))}
              onClick={() => setDay(shiftDay(v.day, -1))}
              className="grid size-8 place-items-center rounded-full text-muted hover:text-ink disabled:opacity-30"
            >
              <ChevronLeft className="size-5" />
            </button>
            <span className="min-w-36 text-center text-[13.5px] font-semibold">
              {today
                ? "Today"
                : new Date(`${v.day}T12:00:00`).toLocaleDateString([], {
                    weekday: "long",
                    month: "short",
                    day: "numeric",
                  })}
            </span>
            <button
              type="button"
              aria-label="The day after"
              disabled={today || v.day >= (kept[0] ?? v.day)}
              onClick={() => setDay(shiftDay(v.day, 1))}
              className="grid size-8 place-items-center rounded-full text-muted hover:text-ink disabled:opacity-30"
            >
              <ChevronRight className="size-5" />
            </button>
          </div>
        }
      >
        {c.devices.length > 1 ? (
          <Segmented
            label="Device"
            value={device}
            onChange={setDevice}
            options={[
              { value: "", label: "All devices" },
              ...c.devices.map((d) => ({ value: d.id, label: d.name })),
            ]}
          />
        ) : null}
        <HoursChart hours={v.hours} big />
        <p className="text-[13px] text-muted">
          {v.sites.length
            ? `${reached} site${reached === 1 ? "" : "s"} reached${v.sites.length > reached ? `, ${v.sites.length - reached} only blocked` : ""}.`
            : "Nothing that day."}
        </p>
        {v.sites.length ? (
          <ul className="grid gap-0.5">
            {v.sites.map((s) => {
              const onlyBlocked = s.n === s.blocked;
              return (
                <li
                  key={s.site}
                  className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg px-2 py-1.5 text-[13.5px] odd:bg-(--c-surface-2)"
                >
                  <span className={cx("grow font-semibold", onlyBlocked && "text-muted")}>
                    {s.site}
                    {onlyBlocked ? (
                      <span className="ml-2 rounded-full border border-line px-2 py-0.5 text-[11px] font-semibold text-muted">
                        blocked
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[12.5px] text-muted">
                    {timeOf(s.first)}
                    {s.first !== s.last ? `–${timeOf(s.last)}` : ""} ·{" "}
                    {device ? (s.per[device] ?? 0) : s.n} lookup
                    {(device ? (s.per[device] ?? 0) : s.n) === 1 ? "" : "s"}
                    {s.blocked && !onlyBlocked ? ` · ${s.blocked} blocked` : ""}
                    {!device && c.devices.length > 1
                      ? ` · ${s.devices.map(deviceName).join(", ")}`
                      : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
        <p className="text-[12.5px] text-muted">
          A lookup is a device asking where a site is: one page can make several, and apps look
          things up in the background too.
        </p>
      </Section>

      <Section
        title="Blocked lately"
        aside={
          dismissedCount ? (
            <button
              type="button"
              onClick={() => setShowDismissed(!showDismissed)}
              className="text-[13px] font-semibold text-accent hover:underline"
            >
              {showDismissed ? "Hide dismissed" : `Show ${dismissedCount} dismissed`}
            </button>
          ) : null
        }
      >
        {blocked.length ? (
          <ul className="grid gap-1.5">
            {blocked.map((s) => (
              <li
                key={s.site}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2 text-[13.5px]"
              >
                <span className="grow">
                  <b>{s.site}</b>{" "}
                  <span className="text-muted">
                    {s.blocked} time{s.blocked === 1 ? "" : "s"} · {when(s.last)}
                    {s.after ? ` · while using ${s.after}` : ""}
                    {s.dismissed ? " · dismissed" : ""}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    act(
                      () => api.post(`/api/family/${c.person}/allow`, { site: s.site }),
                      `${s.site} is allowed`,
                    )
                  }
                >
                  <Check className="size-4" /> Allow
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    act(() =>
                      api.post(`/api/family/${c.person}/dismiss`, {
                        site: s.site,
                        on: !s.dismissed,
                      }),
                    )
                  }
                >
                  <EyeOff className="size-4" /> {s.dismissed ? "Show again" : "Dismiss"}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">Nothing blocked in the last three days.</p>
        )}
        <p className="text-[12.5px] text-muted">
          "While using" is the allowed site they were on just before: often a part that site needs
          to work.
        </p>
      </Section>

      <Section title={`${name}'s rules`}>
        <RulesEditor
          person={c.person}
          rules={v.rules}
          pageSites={v.pageSites}
          name={name}
          act={act}
        />
      </Section>
    </main>
  );
}
