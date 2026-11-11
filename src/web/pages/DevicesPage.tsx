/**
 * The Devices page (admins only): everything on the home network, whether it's there, what runs
 * on it (the tiles that lead there, the AI servers, what port checks found), the computers that
 * lend work to the AI server, pinball tables, and what the admin is told about.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Bell,
  BellOff,
  Cpu,
  ExternalLink,
  Eye,
  EyeOff,
  Joystick,
  Lock,
  LockKeyhole,
  LockOpen,
  Power,
  RefreshCw,
  RotateCcw,
  ScanSearch,
  Search,
  Settings2,
  ShieldCheck,
  Unplug,
  Users,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { PublicProfile } from "../../shared/api";
import type {
  DeviceKindId,
  DevicesView,
  DeviceType,
  DeviceView,
  MachineView,
  ServiceState,
  ServiceView,
  VpinView,
} from "../../shared/devices";
import { AccessButton, AccessCard, accessForUrl, useAccess } from "../components/devices/Access";
import { NetworkMapView, RouterCard } from "../components/devices/NetworkMap";
import {
  AdGuardCard,
  ago,
  DeviceEditor,
  guessType,
  KEY,
  KindIcon,
  type Kinds,
  KindsCard,
  KindsContext,
  NewDevicesCard,
  title,
  what,
} from "../components/devices/parts";
import { SmartSection, smartLine } from "../components/devices/SmartHome";
import { Avatar } from "../components/Picker";
import { TileIcon } from "../components/Tile";
import { Button, Drawer, ErrorNote, Input, Segmented, Select, useToast } from "../components/ui";
import { api } from "../lib/api";
import { cx } from "../lib/format";
import { live } from "../lib/live";
import { useHome } from "../lib/queries";

const STATE_TEXT: Record<ServiceState, string> = {
  up: "Up",
  slow: "Slow",
  down: "Down",
  unknown: "Checking",
};
const STATE_TONE: Record<ServiceState, string> = {
  up: "bg-good",
  slow: "bg-warn",
  down: "bg-bad",
  unknown: "bg-(--c-line-strong)",
};

/** The services worth showing on the list: not hidden, not a nameless port. */
const notable = (d: DeviceView) => d.services.filter((s) => !s.hidden && !s.minor);

/** A row runs something worth monitoring: services, an AI machine, a pinball table. */
const busyRow = (d: DeviceView) => notable(d).length > 0 || Boolean(d.machine || d.vpin);

const gb = (mib: number) => (mib >= 1024 ? `${Math.round(mib / 1024)} GB` : `${mib} MB`);

function since(secs?: number): string | undefined {
  if (secs === undefined) return undefined;
  const m = Math.round(secs / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
}

const clock = (iso?: string) =>
  iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";

type Filter = "all" | "online" | "offline" | "services";

/** Where a device sits in the house, on the page. */
type Place = "network" | "people" | "entertainment" | "computers" | "smart" | "unknown" | "sort";

const GROUPS: {
  id: "entertainment" | "computers" | "smart" | "unknown";
  title: string;
  hint: string;
  types: DeviceType[];
}[] = [
  {
    id: "entertainment",
    title: "Entertainment",
    hint: "TVs, speakers, consoles, the arcade and pinball",
    types: ["tv", "speaker", "console"],
  },
  {
    id: "computers",
    title: "Computers and printers",
    hint: "Computers nobody owns, printers and 3D printers",
    types: ["desktop", "laptop", "phone", "tablet", "printer", "printer3d"],
  },
  {
    id: "smart",
    title: "Smart home",
    hint: "Plugs and lights, thermostats, appliances, sensors and cameras",
    types: ["plug", "thermostat", "appliance", "sensor", "camera"],
  },
  {
    id: "unknown",
    title: "Not sure yet",
    hint: "Open one for help working out what it is",
    types: ["unknown"],
  },
];

const typeOf = (d: DeviceView): DeviceKindId => d.device?.type ?? d.suggest.type ?? guessType(d);

/** The admin's kinds, as last loaded (where a device of one of them goes). */
let kindsNow: Kinds = [];

function placeOf(d: DeviceView): Place {
  if (!d.saved) return "sort";
  const t = typeOf(d);
  // The admin's version of its kind (one they made, or a built-in one they moved) says where.
  const own = kindsNow.find((k) => k.id === t && !k.hidden);
  if (own?.place === "network") return "network";
  if (!own && (t === "network" || t === "server")) return "network";
  if (d.device?.treatment === "shared") return "people";
  if (d.device?.treatment === "person") return d.device.person ? "people" : "sort";
  if (own) return own.place;
  return GROUPS.find((g) => (g.types as string[]).includes(t))?.id ?? "unknown";
}

const ipOrder = (a: DeviceView, b: DeviceView) =>
  (a.ips[0] ?? "").localeCompare(b.ips[0] ?? "", undefined, { numeric: true });

export function DevicesPage() {
  const home = useHome();
  const admin = Boolean(home.data?.session.admin);
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: KEY,
    queryFn: () => api.get<DevicesView>("/api/admin/devices"),
    enabled: admin,
    // While Hearth asks devices what they are or checks one's ports, look again soon.
    refetchInterval: (query) =>
      query.state.data?.asking || query.state.data?.devices.some((d) => d.scanning) ? 3000 : 30_000,
  });
  // The monitor says when it's looked at everything again (about once a minute).
  useEffect(
    () =>
      live.changes((what) => {
        if (what === "devices") void qc.invalidateQueries({ queryKey: KEY });
      }),
    [qc],
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [find, setFind] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<"house" | "map" | "apps" | "setup">("house");
  const setup = tab === "setup";
  const people = home.data?.profiles ?? [];
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  if (home.data && !admin)
    return (
      <main className="shell py-16 text-center text-muted">
        Sign in as the admin to see the devices.
      </main>
    );
  if (!q.data)
    return (
      <main className="shell pt-6 pb-16">
        {q.error ? <ErrorNote error={q.error} /> : <div className="skeleton h-64" />}
      </main>
    );
  const v = q.data;
  kindsNow = v.kinds;
  const all = v.devices;
  // IPv6-only rows: addresses phones and computers change for privacy, usually also listed by
  // their IPv4 address. Kept out of the way.
  const loose6 = (d: DeviceView) => d.ipv6Only && !d.saved && !d.here;
  const real = all.filter((d) => !loose6(d));
  const matches = (d: DeviceView) => {
    const s = find.trim().toLowerCase();
    if (!s) return true;
    return [title(d), d.networkName, ...d.ips, ...d.services.map((x) => x.name), d.machine?.name]
      .filter(Boolean)
      .some((x) => (x as string).toLowerCase().includes(s));
  };
  const shown = real.filter(
    (d) =>
      matches(d) &&
      (filter === "online"
        ? d.presence === "online"
        : filter === "offline"
          ? d.presence === "offline"
          : filter === "services"
            ? busyRow(d)
            : true),
  );
  const at = (p: Place) => shown.filter((d) => placeOf(d) === p);
  const network = at("network").sort(
    (a, b) => Number(typeOf(b) === "network") - Number(typeOf(a) === "network") || ipOrder(a, b),
  );
  const peopleRows = at("people");
  const sorting = at("sort").sort(
    (a, b) => Number(b.presence === "online") - Number(a.presence === "online") || ipOrder(a, b),
  );
  const v6 = all.filter(loose6).filter(matches);

  const online = real.filter((d) => d.presence === "online").length;
  const services = real.flatMap((d) => notable(d)).filter((s) => s.kind !== "hearth");
  const down = services.filter((s) => s.state === "down");
  const machines = real.flatMap((d) => (d.machine ? [d.machine] : []));
  const dismissed = new Set(v.dismissed);
  const attention = real
    .flatMap((d) => [
      ...(d.device && d.watched && d.presence === "offline"
        ? [{ key: `device:${d.device.id}`, row: d, text: `${title(d)} is offline`, where: "" }]
        : []),
      // What you chose (tiles, AI servers) or watch. Not on a device that's switched off: its
      // services are off with it (watch the device to hear about that).
      ...(d.presence === "offline"
        ? []
        : notable(d)
            .filter(
              (s) => s.state === "down" && (s.watched || s.kind === "tile" || s.kind === "ai"),
            )
            .map((s) => ({ key: s.key, row: d, text: `${s.name} is down`, where: title(d) }))),
    ])
    .filter((a) => !dismissed.has(a.key));
  const watching = real.filter((d) => d.watched).length + services.filter((s) => s.watched).length;
  const openRow = open ? all.find((d) => d.key === open) : undefined;

  const askAgain = async () => {
    try {
      await api.post("/api/admin/devices/ask", {});
      await qc.invalidateQueries({ queryKey: KEY });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't ask them.");
    }
  };
  const dismiss = async (key: string) => {
    try {
      await api.post("/api/admin/dismiss", { key });
      await qc.invalidateQueries({ queryKey: KEY });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't dismiss it.");
    }
  };
  const tile = (d: DeviceView) => <DeviceTile key={d.key} d={d} onOpen={() => setOpen(d.key)} />;

  return (
    <KindsContext.Provider value={v.kinds}>
      <main className="shell pt-6 pb-16">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-heading text-3xl font-bold tracking-tight">Devices</h1>
            <p className="mt-1 text-muted">
              The house at a glance: the network, the people, and everything else that's on.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={askAgain}
              busy={v.asking}
              title="Ask each device what it is: many say their own name (Google Cast, Bonjour, Roku, Sonos, Hue, Shelly)"
            >
              {v.asking ? null : <RefreshCw className="size-4" />}
              {v.asking ? "Asking devices…" : "Ask them again"}
            </Button>
          </div>
        </div>

        {tab === "house" ? <AccessNudge onOpen={() => setTab("apps")} /> : null}
        {tab === "house" && !v.adguard.configured ? (
          <button
            type="button"
            onClick={() => setTab("setup")}
            className="mb-5 flex w-full items-center gap-2.5 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-left text-[13.5px]"
          >
            <Settings2 className="size-4 flex-none text-accent" />
            <span className="grow">
              <b>Connect AdGuard Home</b> to see every device on the network.
            </span>
            <span className="font-semibold text-accent">Setup</span>
          </button>
        ) : null}

        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="On the network"
            value={`${online}`}
            note={`of ${real.length} devices`}
            onClick={() => setFilter("online")}
          />
          <Stat
            label="Services"
            value={down.length ? `${down.length} down` : `${services.length}`}
            tone={down.length ? "bad" : undefined}
            note={
              down.length
                ? `${services.length - down.length} of ${services.length} up`
                : services.some((s) => s.state === "unknown")
                  ? "being checked"
                  : "all up"
            }
            onClick={() => setFilter("services")}
          />
          <Stat
            label="Watching"
            value={`${watching}`}
            note={
              !v.alerts
                ? "alerts aren't set up"
                : attention.length
                  ? "something needs a look"
                  : "you'll be told if one stops"
            }
            tone={!v.alerts && watching ? "warn" : undefined}
          />
          <Stat
            label="AI computers"
            value={machines.length ? `${machines.filter((m) => m.online).length}` : "—"}
            note={
              machines.length
                ? `of ${machines.length} online · ${machines.filter((m) => m.busy).length} busy`
                : v.machinesError
                  ? "the AI server didn't answer"
                  : "none listed"
            }
          />
        </div>

        {!v.alerts && watching ? (
          <p className="mb-5 rounded-xl bg-warn/12 px-4 py-2.5 text-[13.5px]">
            You're watching {watching} thing{watching === 1 ? "" : "s"}, but alerts have nowhere to
            go yet.{" "}
            <Link to="/settings" search={{ tab: "internet" }} className="font-semibold text-accent">
              Settings → Internet → Alerts
            </Link>
          </p>
        ) : null}

        {attention.length ? (
          <section className="card mb-5 p-4" aria-label="Needs a look">
            <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wider text-bad">
              Needs a look
            </h2>
            <ul className="grid gap-1">
              {attention.map((a) => (
                <li key={a.key} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setOpen(a.row.key)}
                    className="flex min-w-0 grow items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-(--c-surface-2)"
                  >
                    <span className="size-2.5 flex-none rounded-full bg-bad" />
                    <span className="truncate font-semibold">{a.text}</span>
                    {a.where ? (
                      <span className="truncate text-[12.5px] text-muted">on {a.where}</span>
                    ) : null}
                  </button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => dismiss(a.key)}
                    title="Take it off the list until it's up again"
                  >
                    Dismiss
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="w-full max-w-lg">
            <Segmented
              label="View"
              value={tab}
              onChange={setTab}
              options={[
                { value: "house", label: "The house" },
                { value: "map", label: "Network map" },
                { value: "apps", label: "Services" },
                { value: "setup", label: "Setup" },
              ]}
            />
          </div>
          <div className={cx("w-full max-w-xl", tab !== "house" && "hidden")}>
            <Segmented
              label="Show"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "Everything" },
                { value: "online", label: "Online" },
                { value: "offline", label: "Offline" },
                { value: "services", label: "Running services" },
              ]}
            />
          </div>
          <div
            className={cx(
              "relative flex min-w-48 grow items-center sm:max-w-xs",
              tab !== "house" && "hidden",
            )}
          >
            <Search className="pointer-events-none absolute left-3 size-4 text-muted" aria-hidden />
            <Input
              aria-label="Find a device"
              placeholder="Find a device or service"
              className="pl-9"
              value={find}
              onChange={(e) => setFind(e.target.value)}
            />
          </div>
        </div>

        {tab === "map" ? <NetworkMapView view={v} onOpen={(k) => setOpen(k)} /> : null}
        {tab === "apps" ? <AccessCard /> : null}
        {setup ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <RouterCard view={v} />
            <AdGuardCard view={v} />
            <NewDevicesCard view={v} />
            <KindsCard />
          </div>
        ) : null}
        <div className={cx("grid gap-5", tab !== "house" && "hidden")}>
          {sorting.length ? (
            <SortTray rows={sorting} people={people} onOpen={(k) => setOpen(k)} />
          ) : null}

          {network.length ? (
            <Section
              title="The network"
              hint="Router, access points and servers: what everything else depends on"
            >
              <ul className="flex flex-wrap items-stretch gap-2">
                {network.map((d, i) => (
                  <li key={d.key} className="flex min-w-0 grow items-center gap-2 sm:grow-0">
                    {i > 0 ? (
                      <span className="hidden h-px w-4 bg-(--c-line-strong) sm:block" aria-hidden />
                    ) : null}
                    <DeviceTile d={d} onOpen={() => setOpen(d.key)} big />
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {peopleRows.length ? (
            <PeopleSection rows={peopleRows} byId={byId} onOpen={(k) => setOpen(k)} />
          ) : null}

          <div className="grid items-start gap-5 md:grid-cols-2 xl:grid-cols-4">
            {GROUPS.map((g) => {
              const rows = at(g.id).sort(
                (a, b) =>
                  Number(busyRow(b)) - Number(busyRow(a)) ||
                  Number(b.presence === "online") - Number(a.presence === "online") ||
                  title(a).localeCompare(title(b)),
              );
              return rows.length ? (
                <Section key={g.id} title={g.title} hint={g.hint} count={rows.length}>
                  <ul className="grid gap-1.5">
                    {rows.map((d) => (
                      <li key={d.key}>{tile(d)}</li>
                    ))}
                  </ul>
                </Section>
              ) : null;
            })}
          </div>

          {!shown.length ? (
            <p className="rounded-xl border border-dashed border-line p-6 text-center text-muted">
              {find || filter !== "all"
                ? "Nothing matches."
                : v.adguard.ok
                  ? "Nothing here."
                  : "Connect AdGuard Home (Setup) to see every device on the network. Until then, only browsers that open Hearth show up."}
            </p>
          ) : null}

          {v6.length ? (
            <details className="rounded-xl border border-line px-3 py-2">
              <summary className="cursor-pointer text-[13px] font-semibold text-muted">
                {v6.length} IPv6 address{v6.length === 1 ? "" : "es"} not matched to a device
              </summary>
              <p className="mt-2 text-[12.5px] text-muted">
                Phones and computers make up new IPv6 addresses now and then, for privacy, so one
                device can show up here several times. Each is usually also listed by its IPv4
                address. Turning off IPv6 DNS on the router makes every device ask by IPv4.
              </p>
              <ul className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {v6.map((d) => (
                  <li key={d.key}>{tile(d)}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>

        {openRow ? (
          <DeviceSheet
            row={openRow}
            owner={openRow.device?.person ? byId.get(openRow.device.person) : undefined}
            people={people}
            all={all}
            onClose={() => setOpen(null)}
          />
        ) : null}
      </main>
    </KindsContext.Provider>
  );
}

function Section({
  title: heading,
  hint,
  count,
  children,
}: {
  title: string;
  hint?: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-4" aria-label={heading}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-bold">
            {heading}
            {count ? (
              <span className="ml-1.5 text-[13px] font-semibold text-muted">{count}</span>
            ) : null}
          </h2>
          {hint ? <p className="text-[12.5px] text-muted">{hint}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

/** A card per person with their devices, and one for the devices people share. */
function PeopleSection({
  rows,
  byId,
  onOpen,
}: {
  rows: DeviceView[];
  byId: Map<string, PublicProfile>;
  onOpen: (key: string) => void;
}) {
  const shared = rows.filter((d) => d.device?.treatment === "shared");
  const owned = rows.filter((d) => d.device?.treatment === "person");
  const owners = [...new Set(owned.map((d) => d.device?.person as string))].sort((a, b) =>
    (byId.get(a)?.name ?? a).localeCompare(byId.get(b)?.name ?? b),
  );
  const order = (list: DeviceView[]) =>
    [...list].sort(
      (a, b) =>
        Number(b.presence === "online") - Number(a.presence === "online") ||
        title(a).localeCompare(title(b)),
    );
  return (
    <section aria-label="People">
      <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wider text-muted">People</h2>
      <ul className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
        {owners.map((p) => {
          const person = byId.get(p);
          const mine = order(owned.filter((d) => d.device?.person === p));
          const phone = mine.find((d) => typeOf(d) === "phone" && d.lastSeen);
          return (
            <li key={p} className="card p-3">
              <div className="mb-2 flex items-center gap-2 px-1">
                {person ? <Avatar p={person} size="sm" /> : null}
                <div className="grid min-w-0">
                  <span className="truncate font-bold">{person?.name ?? p}</span>
                  <span className="truncate text-[12px] text-muted">
                    {mine.length} device{mine.length === 1 ? "" : "s"}
                    {phone ? ` · phone ${ago(phone.lastSeen)}` : ""}
                  </span>
                </div>
              </div>
              <ul className="grid gap-0.5">
                {mine.map((d) => (
                  <li key={d.key}>
                    <DeviceLine d={d} onOpen={() => onOpen(d.key)} />
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
        {shared.length ? (
          <li className="card p-3">
            <div className="mb-2 flex items-center gap-2 px-1">
              <span className="grid size-8 place-items-center rounded-full bg-accent/12 text-accent">
                <Users className="size-4" />
              </span>
              <div className="grid min-w-0">
                <span className="font-bold">Shared</span>
                <span className="text-[12px] text-muted">Used by more than one person</span>
              </div>
            </div>
            <ul className="grid gap-0.5">
              {order(shared).map((d) => (
                <li key={d.key}>
                  <DeviceLine
                    d={d}
                    onOpen={() => onOpen(d.key)}
                    note={(d.device?.people ?? []).map((p) => byId.get(p)?.name ?? p).join(", ")}
                  />
                </li>
              ))}
            </ul>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

/** A device as a row in a person's card: icon and status, name, what it's doing. */
function DeviceLine({ d, onOpen, note }: { d: DeviceView; onOpen: () => void; note?: string }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-(--c-surface-2)"
    >
      <span className="relative flex-none">
        <span className="grid size-8 place-items-center rounded-lg bg-accent/12 text-accent">
          <KindIcon type={typeOf(d)} className="size-4" />
        </span>
        <PresenceDot d={d} className="absolute -right-0.5 -bottom-0.5 size-2.5" />
      </span>
      <span className="flex min-w-0 grow items-center gap-1.5">
        <span className="truncate text-[14px] font-semibold">{title(d)}</span>
        {d.trust ? <TrustMark ok={d.trust.ok} /> : null}
      </span>
      <span className="max-w-[55%] flex-none truncate text-right text-[12px] text-muted">
        {note ? `${note} · ` : ""}
        {tileLine(d)}
      </span>
    </button>
  );
}

/** New devices, and ones whose owner isn't said: answer with one tap, or open one for more. */
function SortTray({
  rows,
  people,
  onOpen,
}: {
  rows: DeviceView[];
  people: PublicProfile[];
  onOpen: (key: string) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const save = async (d: DeviceView, who: string | null) => {
    setBusy(d.key);
    try {
      const type = typeOf(d);
      await api.put(`/api/admin/devices/${encodeURIComponent(d.key)}`, {
        name: (d.device?.name ?? title(d)).slice(0, 60),
        type,
        treatment: who ? "person" : "always",
        person: who ?? undefined,
        ips: d.ips,
        macs: d.macs,
        notes: d.device?.notes,
      });
      toast(
        who
          ? `${title(d)} is ${people.find((p) => p.id === who)?.name ?? who}'s`
          : `${title(d)} is part of the house`,
      );
      await qc.invalidateQueries({ queryKey: KEY });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save it.", "bad");
    }
    setBusy(null);
  };
  return (
    <Section
      title="To sort"
      count={rows.length}
      hint="New on the network, or nobody's said whose. Tap whose it is, or that it's part of the house (TVs, plugs, the printer): it's never limited by the internet controls."
    >
      <ul className="grid gap-2 lg:grid-cols-2">
        {rows.map((d) => (
          <li key={d.key} className="grid gap-2 rounded-xl border border-dashed border-line p-2.5">
            <DeviceTile d={d} onOpen={() => onOpen(d.key)} plain />
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] text-muted">Whose?</span>
              {people.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={busy === d.key}
                  onClick={() => save(d, p.id)}
                  className="flex items-center gap-1 rounded-full border border-line py-0.5 pr-2.5 pl-0.5 text-[12px] font-semibold hover:border-accent disabled:opacity-50"
                >
                  <Avatar p={p} size="xs" /> {p.name}
                </button>
              ))}
              <button
                type="button"
                disabled={busy === d.key}
                onClick={() => save(d, null)}
                className="flex items-center gap-1 rounded-full border border-line px-2.5 py-0.5 text-[12px] font-semibold text-good hover:border-good disabled:opacity-50"
              >
                <ShieldCheck className="size-3.5" /> Part of the house
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Stat({
  label,
  value,
  note,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  note: string;
  tone?: "bad" | "warn";
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="text-[12px] font-bold uppercase tracking-wider text-muted">{label}</span>
      <span
        className={cx(
          "font-heading text-2xl font-bold tabular-nums",
          tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-ink",
        )}
      >
        {value}
      </span>
      <span className="text-[12.5px] text-muted">{note}</span>
    </>
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="card grid gap-0.5 p-4 text-left transition hover:border-accent"
    >
      {body}
    </button>
  ) : (
    <div className="card grid gap-0.5 p-4">{body}</div>
  );
}

function PresenceDot({ d, className }: { d: DeviceView; className?: string }) {
  return (
    <span
      className={cx(
        "size-3 rounded-full ring-2 ring-surface",
        d.presence === "online"
          ? "bg-good"
          : d.presence === "offline"
            ? "bg-bad"
            : "bg-(--c-line-strong)",
        className,
      )}
      title={d.presence === "online" ? "Online" : d.presence === "offline" ? "Offline" : "Not sure"}
    />
  );
}

function presenceText(d: DeviceView): string {
  if (d.presence === "online") return d.lastSeen ? `Online · ${ago(d.lastSeen)}` : "Online";
  if (d.presence === "offline") return d.lastSeen ? `Offline · seen ${ago(d.lastSeen)}` : "Offline";
  return ago(d.lastSeen);
}

function machineText(m: MachineView): string {
  if (!m.online) return m.canWake ? "AI: asleep, can be woken" : "AI: not connected";
  if (m.busy) return `AI: answering${m.loaded ? ` · ${m.loaded}` : ""}`;
  if (!m.available) return `AI: not lending${m.reason ? ` (${m.reason})` : ""}`;
  return `AI: ready${m.loaded ? ` · ${m.loaded} loaded` : ""}`;
}

function vpinText(v: VpinView): string {
  if (!v.ok) return "Pinball: off";
  if (v.playing) return `Playing ${v.playing.name}`;
  return v.frontendRunning ? "Pinball: in the menu" : "Pinball: on, frontend closed";
}

/** What's going on with a device, in a few words for its tile. */
function tileLine(d: DeviceView): string {
  const list = notable(d).filter((s) => s.kind !== "hearth");
  const downCount = list.filter((s) => s.state === "down").length;
  const bits = [
    d.vpin ? vpinText(d.vpin) : null,
    d.machine ? machineText(d.machine) : null,
    smartLine(d) ?? null,
    list.length
      ? `${list.length} service${list.length === 1 ? "" : "s"}${downCount ? ` · ${downCount} down` : ""}`
      : null,
  ].filter(Boolean);
  return bits.length ? bits.join(" · ") : presenceText(d);
}

/** One device: its icon and whether it's on, its name, and what's going on. */
function DeviceTile({
  d,
  onOpen,
  big,
  plain,
}: {
  d: DeviceView;
  onOpen: () => void;
  /** On the network strip: a little more room. */
  big?: boolean;
  /** Inside the To sort tray: no border of its own. */
  plain?: boolean;
}) {
  const named = title(d);
  const list = notable(d).filter((s) => s.kind !== "hearth");
  const anyDown = d.presence !== "offline" && list.some((s) => s.state === "down");
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx(
        "flex w-full min-w-0 items-center gap-2.5 rounded-xl text-left transition",
        plain
          ? "hover:opacity-80"
          : "border border-line bg-surface px-2.5 py-2 hover:border-accent",
        big && "sm:min-w-56",
      )}
    >
      <span className="relative flex-none">
        <span
          className={cx(
            "grid place-items-center rounded-lg",
            big ? "size-11" : "size-9",
            d.saved ? "bg-accent/12 text-accent" : "bg-(--c-surface-2) text-muted",
          )}
        >
          <KindIcon type={typeOf(d)} className={big ? "size-5.5" : "size-4.5"} />
        </span>
        <PresenceDot d={d} className="absolute -right-0.5 -bottom-0.5" />
      </span>
      <span className="grid min-w-0 grow">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[14px] font-semibold">{named}</span>
          {d.here ? (
            <span className="flex-none rounded-full bg-accent px-1.5 text-[10.5px] font-bold text-white">
              This device
            </span>
          ) : null}
          {d.watched ? (
            <Bell className="size-3.5 flex-none text-accent" aria-label="Watching" />
          ) : null}
          {d.trust ? <TrustMark ok={d.trust.ok} /> : null}
        </span>
        <span className={cx("truncate text-[12px]", anyDown ? "text-bad" : "text-muted")}>
          {tileLine(d)}
        </span>
        {big && list.length ? (
          <span className="mt-1 flex flex-wrap gap-1">
            {list.slice(0, 8).map((s) => (
              <span
                key={s.key}
                title={`${s.name}: ${STATE_TEXT[s.state]}`}
                className={cx("size-2 rounded-full", STATE_TONE[s.state])}
              />
            ))}
          </span>
        ) : null}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// One device, opened

function TrustMark({ ok }: { ok: boolean }) {
  const text = ok ? "Trusts the home's certificate" : "Doesn't trust the home's certificate yet";
  return (
    <span title={text} className="flex-none">
      {ok ? (
        <Lock className="size-3.5 text-good" aria-label={text} />
      ) : (
        <LockOpen className="size-3.5 text-warn" aria-label={text} />
      )}
    </span>
  );
}

/**
 * A device: whether it's on and trusts the home, its AI computer or pinball table, its details
 * (name, whose, addresses), and what runs on it. Everything about it in one place.
 */
function DeviceSheet({
  row,
  owner,
  people,
  all,
  onClose,
}: {
  row: DeviceView;
  owner?: PublicProfile;
  people: PublicProfile[];
  all: DeviceView[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<unknown>(null);
  const put = async (path: string, key: string, on: boolean, done: string) => {
    setError(null);
    try {
      await api.put(path, { key, on });
      toast(done);
      await qc.invalidateQueries({ queryKey: KEY });
    } catch (e) {
      setError(e);
    }
  };
  const watch = (key: string, on: boolean, name: string) =>
    put(
      "/api/admin/watch",
      key,
      on,
      on ? `You'll be told if ${name} stops` : `Not watching ${name}`,
    );
  const hide = (key: string, on: boolean, name: string) =>
    put("/api/admin/hide", key, on, on ? `${name} is hidden` : `${name} is shown again`);
  const scan = async () => {
    setError(null);
    try {
      await api.post(`/api/admin/devices/${encodeURIComponent(row.key)}/scan`, {});
      await qc.invalidateQueries({ queryKey: KEY });
    } catch (e) {
      setError(e);
    }
  };
  const named = title(row);
  const w = what(row);
  const main = row.services.filter((x) => !x.hidden && !x.minor);
  const ports = row.services.filter((x) => !x.hidden && x.minor);
  const hidden = row.services.filter((x) => x.hidden);
  const canScan = row.ips.some((ip) => !ip.includes(":"));
  return (
    <Drawer
      open
      wide
      onClose={onClose}
      title={row.saved ? named : `${named} · not set up`}
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="grid gap-5">
        <section className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <span className="flex flex-wrap items-center gap-2 font-semibold">
              <PresenceDot d={row} />
              {row.presence === "online"
                ? "On the network"
                : row.presence === "offline"
                  ? "Not on the network"
                  : "Not sure whether it's on"}
              <span className="font-normal text-muted">· last active {ago(row.lastSeen)}</span>
            </span>
            <span className="text-[13px] text-muted">
              {[
                row.ips.join(", "),
                row.macs[0],
                w,
                row.networkName ? `“${row.networkName}”` : null,
                owner
                  ? `${owner.name}'s`
                  : row.device?.treatment === "always"
                    ? "always allowed"
                    : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <span className="flex items-center gap-1.5 text-[13px]">
              {row.trust ? (
                <>
                  <TrustMark ok={row.trust.ok} />
                  {row.trust.ok
                    ? "Trusts the home's certificate"
                    : "Doesn't trust the home's certificate yet"}
                  <span className="text-muted">· its browser said so {ago(row.trust.at)}</span>
                  {row.trust.ok ? null : (
                    <Link to="/trust" className="font-semibold text-accent">
                      The trust page
                    </Link>
                  )}
                </>
              ) : (
                <span className="text-muted">
                  Home certificate: unknown (no browser on it has opened Hearth by its name yet)
                </span>
              )}
            </span>
          </div>
          {row.device ? (
            <Button
              size="sm"
              variant={row.watched ? "primary" : "secondary"}
              onClick={() => watch(`device:${row.device?.id}`, !row.watched, named)}
              title="Be told when it goes offline, and when it's back"
            >
              {row.watched ? <Bell className="size-4" /> : <BellOff className="size-4" />}
              {row.watched ? "Watching" : "Watch it"}
            </Button>
          ) : null}
        </section>

        <SameDevice row={row} all={all} onMerged={onClose} />
        {!row.saved || typeOf(row) === "unknown" ? <IdentifyHelp row={row} /> : null}
        <SmartSection row={row} />
        {row.machine ? <MachineSection m={row.machine} /> : null}
        {row.vpin ? <PinballSection row={row} v={row.vpin} /> : null}

        <section>
          <h3 className="mb-2 text-[12px] font-bold uppercase tracking-wider text-muted">
            {row.saved ? "Details" : "Set it up"}
          </h3>
          <DeviceEditor key={row.key} row={row} people={people} onDone={onClose} />
        </section>

        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[12px] font-bold uppercase tracking-wider text-muted">
              Services {main.length ? `(${main.length})` : ""}
            </h3>
            {canScan ? (
              <Button size="sm" variant="ghost" onClick={scan} busy={row.scanning}>
                {row.scanning ? null : <RefreshCw className="size-4" />}
                {row.scanning ? "Checking its ports…" : "Look for services"}
              </Button>
            ) : null}
          </div>
          {main.length ? (
            <ul className="grid gap-1.5">
              {main.map((x) => (
                <ServiceRow
                  key={x.key}
                  s={x}
                  onWatch={() => watch(x.key, !x.watched, x.name)}
                  onHide={() => hide(x.key, true, x.name)}
                />
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">
              {row.scanning
                ? "Looking…"
                : row.scannedAt
                  ? `Nothing named answered on its usual ports (checked ${ago(row.scannedAt)}).`
                  : "None known. Look for services to check its usual ports."}
            </p>
          )}
          {ports.length ? (
            <details className="mt-2 rounded-xl border border-line px-3 py-2">
              <summary className="cursor-pointer text-[13px] font-semibold text-muted">
                {ports.length} other open port{ports.length === 1 ? "" : "s"}: usually part of the
                device itself
              </summary>
              <ul className="mt-2 grid gap-1.5">
                {ports.map((x) => (
                  <ServiceRow
                    key={x.key}
                    s={x}
                    onWatch={() => watch(x.key, !x.watched, x.name)}
                    onHide={() => hide(x.key, true, x.name)}
                  />
                ))}
              </ul>
            </details>
          ) : null}
          {hidden.length ? (
            <details className="mt-2 rounded-xl border border-line px-3 py-2">
              <summary className="cursor-pointer text-[13px] font-semibold text-muted">
                {hidden.length} hidden
              </summary>
              <ul className="mt-2 grid gap-1">
                {hidden.map((x) => (
                  <li key={x.key} className="flex items-center gap-2 text-[13px]">
                    <span className="grow truncate">
                      {x.name} <span className="text-muted">· {x.detail}</span>
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => hide(x.key, false, x.name)}>
                      <Eye className="size-4" /> Show
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {main.length || ports.length ? (
            <p className="mt-2 text-[12px] text-muted">
              {row.scannedAt ? `Ports checked ${ago(row.scannedAt)}. ` : ""}
              Services are your tiles that lead here, the AI servers, and apps found on its ports.
            </p>
          ) : null}
        </section>
        <ErrorNote error={error} />
      </div>
    </Drawer>
  );
}

/** Services on the network Hearth can't read yet: one line, opening the Services tab. */
function AccessNudge({ onOpen }: { onOpen: () => void }) {
  const items = useAccess().data?.items ?? [];
  const needed = items.filter((i) => i.status === "needed" || i.status === "settings");
  if (!needed.length) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mb-5 flex w-full items-center gap-2.5 rounded-xl border border-warn/30 bg-warn/10 px-3 py-2 text-left text-[13.5px] hover:border-warn/60"
    >
      <LockKeyhole className="size-4 flex-none text-warn" />
      <span className="grow">
        <b>
          {needed.length} service{needed.length === 1 ? "" : "s"} on your network
        </b>{" "}
        Hearth can't read yet:{" "}
        {needed
          .map((i) => i.appName)
          .slice(0, 4)
          .join(", ")}
        {needed.length > 4 ? "…" : ""}
      </span>
      <span className="font-semibold text-accent">Give access</span>
    </button>
  );
}

function ServiceRow({
  s,
  onWatch,
  onHide,
}: {
  s: ServiceView;
  onWatch: () => void;
  onHide: () => void;
}) {
  const own = s.kind === "hearth";
  const access = accessForUrl(useAccess().data?.items, s.url);
  return (
    <li
      className="flex items-center gap-3 rounded-xl border border-line px-3 py-2"
      style={s.color ? ({ "--tile": s.color } as React.CSSProperties) : undefined}
    >
      <span className="scale-75">
        <TileIcon tile={s} />
      </span>
      <span className="grid min-w-0 grow">
        <span className="truncate font-semibold">{s.name}</span>
        <span className="truncate text-[12.5px] text-muted">{s.detail}</span>
      </span>
      <span className="flex flex-none items-center gap-1.5 text-[12.5px] font-semibold">
        <span className={cx("size-2.5 rounded-full", STATE_TONE[s.state])} />
        {STATE_TEXT[s.state]}
        {s.ms !== undefined && s.state !== "down" ? (
          <span className="font-normal text-muted tabular-nums">{s.ms} ms</span>
        ) : null}
      </span>
      {own ? null : (
        <>
          {access ? <AccessButton item={access} /> : null}
          <button
            type="button"
            onClick={onWatch}
            aria-pressed={s.watched}
            aria-label={s.watched ? `Stop watching ${s.name}` : `Watch ${s.name}`}
            title={s.watched ? "Watching: you'll be told if it stops" : "Watch it"}
            className={cx(
              "grid size-8 flex-none place-items-center rounded-lg hover:bg-(--c-surface-2)",
              s.watched ? "text-accent" : "text-muted",
            )}
          >
            {s.watched ? <Bell className="size-4" /> : <BellOff className="size-4" />}
          </button>
          {s.kind === "port" ? (
            <button
              type="button"
              onClick={onHide}
              aria-label={`Hide ${s.name}`}
              title="Hide it: part of the device, not something you use"
              className="grid size-8 flex-none place-items-center rounded-lg text-muted hover:bg-(--c-surface-2) hover:text-ink"
            >
              <EyeOff className="size-4" />
            </button>
          ) : null}
        </>
      )}
      {s.url ? (
        <a
          href={s.url}
          target="_blank"
          rel="noopener"
          aria-label={`Open ${s.name}`}
          className="grid size-8 flex-none place-items-center rounded-lg text-muted hover:bg-(--c-surface-2) hover:text-ink"
        >
          <ExternalLink className="size-4" />
        </a>
      ) : null}
    </li>
  );
}

function MachineSection({ m }: { m: MachineView }) {
  const state = !m.online
    ? m.canWake
      ? "Asleep (the AI server can wake it)"
      : "Not connected"
    : m.busy
      ? `Answering${m.jobs > 1 ? ` ${m.jobs} questions` : ""}`
      : m.available
        ? "Ready"
        : `Not lending right now${m.reason ? `: ${m.reason}` : ""}`;
  const facts: [string, string | undefined][] = [
    ["Loaded", m.loaded],
    [
      "Downloading",
      m.fetching ? `${m.fetching.model} · ${Math.round(m.fetching.percent)}%` : undefined,
    ],
    [
      "Answers",
      m.online
        ? `${m.served} since it connected${m.avgMs ? ` · about ${(m.avgMs / 1000).toFixed(1)} s each` : ""}`
        : undefined,
    ],
    ["Connected", since(m.connectedSecs)],
    ["Version", [m.version, m.os].filter(Boolean).join(" · ") || undefined],
    [
      "Processor",
      m.hardware
        ? `${m.hardware.cpu}${m.hardware.cores ? ` · ${m.hardware.cores} cores` : ""}`
        : undefined,
    ],
    ["Memory", m.hardware?.memoryMib ? gb(m.hardware.memoryMib) : undefined],
    [
      "Graphics",
      m.hardware?.gpus.length
        ? m.hardware.gpus
            .map((g) => `${g.name}${g.vramMib ? ` (${gb(g.vramMib)})` : ""}`)
            .join(", ")
        : undefined,
    ],
  ];
  return (
    <section className="rounded-2xl bg-(--c-surface-2) p-4">
      <h3 className="mb-1 flex items-center gap-2 font-bold">
        <Cpu className="size-4.5 text-accent" /> Lends compute to {m.server}
      </h3>
      <p className={cx("mb-3 text-[13.5px]", m.online && m.available ? "text-good" : "text-muted")}>
        {state}
      </p>
      <dl className="grid gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-[auto_1fr]">
        {facts
          .filter(([, value]) => value)
          .map(([k, value]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="font-semibold">{value}</dd>
            </div>
          ))}
      </dl>
      {m.models.length ? (
        <p className="mt-3 text-[12.5px] text-muted">Models: {m.models.join(", ")}</p>
      ) : null}
    </section>
  );
}

function PinballSection({ row, v }: { row: DeviceView; v: VpinView }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [tables, setTables] = useState<{ id: number; name: string }[] | null>(null);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const base = `/api/admin/devices/${encodeURIComponent(row.key)}`;
  const loadTables = async () => {
    if (tables) return;
    try {
      setTables(
        (await api.get<{ tables: { id: number; name: string }[] }>(`${base}/tables`)).tables,
      );
    } catch (e) {
      setError(e);
    }
  };
  const run = async (action: string, done: string, gameId?: number) => {
    setBusy(action);
    setError(null);
    try {
      await api.post(`${base}/table`, { action, gameId });
      toast(done);
      await qc.invalidateQueries({ queryKey: KEY });
    } catch (e) {
      setError(e);
    }
    setBusy(null);
    setSure(false);
  };
  return (
    <section className="rounded-2xl bg-(--c-surface-2) p-4">
      <h3 className="mb-1 flex items-center gap-2 font-bold">
        <Joystick className="size-4.5 text-accent" /> Pinball table
        {v.system?.version ? (
          <span className="text-[12.5px] font-normal text-muted">
            VPin Studio {v.system.version}
          </span>
        ) : null}
      </h3>
      <p className={cx("mb-3 text-[13.5px]", v.ok ? "text-good" : "text-muted")}>
        {!v.ok
          ? `Off, or VPin Studio isn't running${v.error ? ` (${v.error})` : ""}.`
          : v.playing
            ? `Playing ${v.playing.name}${v.playing.since ? ` since ${clock(v.playing.since)}` : ""}`
            : v.frontendRunning
              ? "On, in the menu"
              : "On, the frontend is closed"}
        {v.ok && v.tables ? ` · ${v.tables} tables` : ""}
      </p>

      {v.ok ? (
        <div className="mb-4 grid gap-2">
          <div className="flex flex-wrap gap-2">
            <Select
              aria-label="A table to start"
              className="max-w-64"
              value={pick}
              onFocus={loadTables}
              onPointerDown={loadTables}
              onChange={(e) => setPick(e.target.value)}
            >
              <option value="">{tables ? "Start a table…" : "Start a table… (loading)"}</option>
              {(tables ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              variant="primary"
              disabled={!pick}
              busy={busy === "launch"}
              onClick={() => {
                const t = tables?.find((x) => String(x.id) === pick);
                void run("launch", `Starting ${t?.name ?? "the table"}`, Number(pick));
              }}
            >
              Start
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              busy={busy === "mute" || busy === "unmute"}
              onClick={() => (v.muted ? run("unmute", "Sound is on") : run("mute", "Muted"))}
            >
              {v.muted ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
              {v.muted ? "Unmute" : "Mute"}
            </Button>
            <Button
              size="sm"
              busy={busy === "restart"}
              onClick={() => run("restart", "Restarting the frontend")}
            >
              <RotateCcw className="size-4" /> Restart the frontend
            </Button>
            <Button
              size="sm"
              variant={sure ? "danger" : "secondary"}
              busy={busy === "shutdown"}
              onClick={() => (sure ? run("shutdown", "Shutting the table down") : setSure(true))}
              onBlur={() => setSure(false)}
            >
              <Power className="size-4" /> {sure ? "Shut it down?" : "Shut down"}
            </Button>
          </div>
          <ErrorNote error={error} />
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="mb-1.5 text-[12px] font-bold uppercase tracking-wider text-muted">
            Latest high scores
          </h4>
          {v.scores.length ? (
            <ol className="grid gap-1 text-[13px]">
              {v.scores.slice(0, 8).map((s, i) => (
                <li key={`${s.table}-${s.initials}-${s.score}-${i}`} className="flex gap-2">
                  <span className="w-9 flex-none font-bold">{s.initials}</span>
                  <span className="min-w-0 grow truncate text-muted">{s.table}</span>
                  <span className="font-semibold tabular-nums">{s.score}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[13px] text-muted">None yet.</p>
          )}
        </div>
        <div>
          <h4 className="mb-1.5 text-[12px] font-bold uppercase tracking-wider text-muted">
            Players
          </h4>
          {v.players.length ? (
            <ol className="grid gap-1 text-[13px]">
              {v.players.slice(0, 8).map((p) => (
                <li key={`${p.rank}-${p.name}`} className="flex gap-2">
                  <span className="w-6 flex-none text-muted tabular-nums">{p.rank}.</span>
                  <span className="min-w-0 grow truncate font-semibold">{p.name}</span>
                  <span className="text-muted tabular-nums">
                    {p.points} pts · 🥇{p.first} 🥈{p.second} 🥉{p.third}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[13px] text-muted">No players yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Working out what a device is: everything Hearth has noticed, and tests to try (ask it again,
 * check its ports, open its page, or unplug it and watch it go).
 */
function IdentifyHelp({ row }: { row: DeviceView }) {
  const qc = useQueryClient();
  const [watching, setWatching] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const base = `/api/admin/devices/${encodeURIComponent(row.key)}`;
  const page = row.services.find((s) => s.url && /^https?:/.test(s.url) && s.kind === "port");
  const clues = [
    row.identity?.name ? `It calls itself “${row.identity.name}”` : null,
    row.identity?.model || row.identity?.maker
      ? `It says it's ${[row.identity.maker, row.identity.model].filter(Boolean).join(" ")}`
      : null,
    row.networkName ? `The network calls it “${row.networkName}”` : null,
    row.maker && !row.identity ? `What it looks up says it's ${what(row)}` : null,
    row.lookups.length ? `It looks up ${row.lookups.slice(0, 6).join(", ")}` : null,
    row.agent ? `Its browser says ${row.agent}` : null,
    row.macs[0] ? `Its hardware address is ${row.macs[0]}` : null,
    row.services.length
      ? `It answers on ${row.services.map((s) => s.detail ?? s.name).join("; ")}`
      : null,
  ].filter((x): x is string => !!x);

  // Knock every few seconds while the admin unplugs it: it's the one that stops answering.
  useEffect(() => {
    if (!watching) return;
    let live = true;
    let answered = false;
    let tries = 0;
    const knock = async () => {
      if (!live) return;
      try {
        const { up } = await api.post<{ up: boolean }>(`${base}/knock`, {});
        if (!live) return;
        tries++;
        if (up) {
          answered = true;
          setSaid("It's answering. Unplug it (or switch it off) now, and keep this open.");
        } else if (answered) {
          setSaid("It stopped answering: that was it. Plug it back in, and give it a name below.");
          setWatching(false);
          return;
        } else if (tries === 1) {
          setSaid(
            "It doesn't answer knocks (some devices never do), so this test can't tell. Try the other clues.",
          );
          setWatching(false);
          return;
        }
      } catch (e) {
        setError(e);
        setWatching(false);
        return;
      }
      if (tries < 40) setTimeout(knock, 3000);
      else {
        setSaid("Still answering after two minutes: it wasn't the one you unplugged.");
        setWatching(false);
      }
    };
    void knock();
    return () => {
      live = false;
    };
  }, [watching, base]);

  const askAgain = async () => {
    setError(null);
    try {
      await api.post("/api/admin/devices/ask", { ips: row.ips.filter((ip) => !ip.includes(":")) });
      setSaid("Asking it what it is. Its answer shows up here in a few seconds, if it gives one.");
      await qc.invalidateQueries({ queryKey: KEY });
    } catch (e) {
      setError(e);
    }
  };
  return (
    <section className="rounded-2xl bg-(--c-surface-2) p-4">
      <h3 className="mb-2 flex items-center gap-2 font-bold">
        <ScanSearch className="size-4.5 text-accent" /> What is it?
      </h3>
      {clues.length ? (
        <ul className="mb-3 grid list-disc gap-0.5 pl-5 text-[13px]">
          {clues.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-[13px] text-muted">
          No clues yet: it hasn't said what it is, and nothing it looks up gives it away.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={askAgain}>
          <RefreshCw className="size-4" /> Ask it again
        </Button>
        <Button
          size="sm"
          variant={watching ? "primary" : "secondary"}
          onClick={() => {
            setSaid(null);
            setWatching((w) => !w);
          }}
          title="Hearth knocks every few seconds; unplug the device you suspect and see if this one stops"
        >
          <Unplug className="size-4" /> {watching ? "Watching… (stop)" : "Unplug it and watch"}
        </Button>
        {page?.url ? (
          <a
            href={page.url}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-[13px] font-semibold hover:border-accent"
          >
            <ExternalLink className="size-4" /> Open its page
          </a>
        ) : null}
      </div>
      {said ? <p className="mt-2 text-[13px] font-semibold">{said}</p> : null}
      <ErrorNote error={error} />
    </section>
  );
}

/**
 * One device on two addresses (wired and Wi-Fi): a suggestion when another row has the same
 * name on the network, and merging by hand with any other row.
 */
function SameDevice({
  row,
  all,
  onMerged,
}: {
  row: DeviceView;
  all: DeviceView[];
  onMerged: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [pick, setPick] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const twins = (row.twins ?? [])
    .map((k) => all.find((d) => d.key === k))
    .filter((d): d is DeviceView => !!d);
  const merge = async (other: string) => {
    setError(null);
    try {
      await api.post(`/api/admin/devices/${encodeURIComponent(row.key)}/merge`, { with: other });
      toast("Merged: one device, both addresses");
      await qc.invalidateQueries({ queryKey: KEY });
      onMerged();
    } catch (e) {
      setError(e);
    }
  };
  const others = all.filter((d) => d.key !== row.key && !d.ipv6Only);
  return (
    <section className="grid gap-2">
      {twins.map((t) => (
        <div
          key={t.key}
          className="flex flex-wrap items-center gap-2 rounded-xl bg-accent/10 px-3 py-2 text-[13.5px]"
        >
          <span className="grow">
            <b>{title(t)}</b> at {t.ips.join(", ")} looks like this same device (the same name on
            the network): wired and Wi-Fi, say.
          </span>
          <Button size="sm" variant="primary" onClick={() => merge(t.key)}>
            Merge them
          </Button>
        </div>
      ))}
      {open ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="The device it's the same as"
            className="max-w-72"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
          >
            <option value="">It's the same device as…</option>
            {others.map((d) => (
              <option key={d.key} value={d.key}>
                {title(d)} ({d.ips.join(", ")})
              </option>
            ))}
          </Select>
          <Button size="sm" disabled={!pick} onClick={() => merge(pick)}>
            Merge
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      ) : twins.length ? null : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="justify-self-start text-[12.5px] font-semibold text-muted hover:text-ink"
        >
          Same device as another one on the list? Merge them
        </button>
      )}
      <ErrorNote error={error} />
    </section>
  );
}
