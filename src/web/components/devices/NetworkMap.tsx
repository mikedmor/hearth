/**
 * The network map: the router, what's plugged into it and on each of its Wi-Fi bands, and each
 * mesh node with its own. From the router (GL.iNet), connected in Devices → Setup.
 */
import { useQueryClient } from "@tanstack/react-query";
import { Cable, Globe, Router as RouterIcon, Wifi } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { DevicesView, DeviceView, MapLink, MapNode } from "../../../shared/devices";
import { api } from "../../lib/api";
import { cx } from "../../lib/format";
import { Button, ErrorNote, Field, Input, useToast } from "../ui";
import { guessType, KEY, KindIcon } from "./parts";

/** A band or the wires, in words. */
function laneOf(iface: string): { id: string; label: string; wired: boolean; order: number } {
  const i = iface.toLowerCase();
  if (i === "cable" || i.includes("lan") || i.includes("eth"))
    return { id: "cable", label: "Wired", wired: true, order: 0 };
  if (i.includes("iot")) return { id: "iot", label: "IoT Wi-Fi", wired: false, order: 3 };
  if (i.includes("guest")) return { id: "guest", label: "Guest Wi-Fi", wired: false, order: 4 };
  if (i.startsWith("5") || i.startsWith("6"))
    return { id: i, label: `${i.replace(/g$/i, "")} GHz Wi-Fi`, wired: false, order: 1 };
  if (i.startsWith("2.4")) return { id: "2.4g", label: "2.4 GHz Wi-Fi", wired: false, order: 2 };
  return { id: i, label: iface, wired: false, order: 5 };
}

function lanes(links: MapLink[]) {
  const by = new Map<string, { lane: ReturnType<typeof laneOf>; links: MapLink[] }>();
  for (const l of links) {
    const lane = laneOf(l.iface);
    const entry = by.get(lane.id) ?? { lane, links: [] };
    entry.links.push(l);
    by.set(lane.id, entry);
  }
  return [...by.values()]
    .sort((a, b) => a.lane.order - b.lane.order)
    .map((x) => ({
      ...x,
      links: x.links.sort(
        (a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name),
      ),
    }));
}

const rate = (bps?: number) =>
  !bps
    ? ""
    : bps > 1_000_000
      ? `${(bps / 1_000_000).toFixed(1)} MB/s`
      : bps > 1000
        ? `${Math.round(bps / 1000)} KB/s`
        : "";

export function NetworkMapView({
  view,
  onOpen,
}: {
  view: DevicesView;
  onOpen: (key: string) => void;
}) {
  const map = view.map;
  const rows = new Map(view.devices.map((d) => [d.key, d]));
  const wrap = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const kids = useRef(new Map<string, HTMLElement>());
  const [lines, setLines] = useState<
    { id: string; d: string; wired: boolean; label?: string; x: number; y: number }[]
  >([]);
  const routerLanes = map ? lanes(map.router.links) : [];

  // Lines from the router to each band and each mesh node, drawn where they are on the page.
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el || !root.current) return;
    const draw = () => {
      const base = el.getBoundingClientRect();
      const r = root.current?.getBoundingClientRect();
      if (!r) return;
      const x1 = r.left + r.width / 2 - base.left;
      const y1 = r.bottom - base.top;
      const out: typeof lines = [];
      for (const [id, node] of kids.current) {
        const k = node.getBoundingClientRect();
        const x2 = k.left + k.width / 2 - base.left;
        const y2 = k.top - base.top;
        const mid = (y1 + y2) / 2;
        const mesh = map?.nodes.find((n) => `node:${n.name}` === id);
        out.push({
          id,
          d: `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`,
          wired: id === "lane:cable" || /cable|ethernet/i.test(mesh?.connection ?? ""),
          label: mesh?.connection,
          x: (x1 + x2) / 2,
          y: mid,
        });
      }
      setLines(out);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);

  if (!map)
    return (
      <div className="card p-6 text-center">
        <p className="font-semibold">
          {view.router?.configured
            ? (view.router.error ?? "Reading the router…")
            : "Connect the router to see who's connected to what."}
        </p>
        <p className="mt-1 text-[13.5px] text-muted">
          Devices → Setup → Router: its address and admin password (a GL.iNet router). Hearth only
          reads from it.
        </p>
      </div>
    );

  const register = (id: string) => (node: HTMLElement | null) => {
    if (node) kids.current.set(id, node);
    else kids.current.delete(id);
  };

  return (
    <div ref={wrap} className="relative">
      <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
        {lines.map((l) => (
          <g key={l.id}>
            <path
              d={l.d}
              fill="none"
              stroke="var(--c-line-strong)"
              strokeWidth={2}
              strokeDasharray={l.wired ? undefined : "6 5"}
            />
            {l.label ? (
              <text
                x={l.x}
                y={l.y - 4}
                textAnchor="middle"
                className="fill-(--c-muted) text-[11px] font-semibold"
              >
                {l.label}
              </text>
            ) : null}
          </g>
        ))}
      </svg>

      <div className="flex flex-col items-center gap-1">
        <span className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-[12px] font-semibold text-muted">
          <Globe className="size-3.5" /> Internet
        </span>
        <span className="h-4 w-px bg-(--c-line-strong)" aria-hidden />
        <div ref={root}>
          <NodeHeader
            node={map.router}
            row={map.router.key ? rows.get(map.router.key) : undefined}
            onOpen={onOpen}
            main
          />
        </div>
      </div>

      <div className="mt-12 flex flex-wrap items-start justify-center gap-4">
        {routerLanes.map(({ lane, links }) => (
          <div key={lane.id} ref={register(`lane:${lane.id}`)} className="card w-full p-3 sm:w-72">
            <LaneTitle wired={lane.wired} label={lane.label} count={links.length} />
            <Links links={links} rows={rows} onOpen={onOpen} />
          </div>
        ))}
        {map.nodes.map((n) => (
          <div
            key={n.name}
            ref={register(`node:${n.name}`)}
            className="card w-full border-accent/40 p-3 sm:w-80"
          >
            <NodeHeader node={n} row={n.key ? rows.get(n.key) : undefined} onOpen={onOpen} />
            <div className="mt-2 grid gap-3">
              {lanes(n.links).map(({ lane, links }) => (
                <div key={lane.id}>
                  <LaneTitle wired={lane.wired} label={lane.label} count={links.length} />
                  <Links links={links} rows={rows} onOpen={onOpen} />
                </div>
              ))}
              {!n.links.length ? (
                <p className="text-[12.5px] text-muted">Nothing connected.</p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-center text-[12px] text-muted">
        From the router,{" "}
        {new Date(map.checkedAt).toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        })}
        . Solid lines are cables, dashed ones Wi-Fi. A switch between the router and a device isn't
        seen: what's behind it shows as wired to the router.
      </p>
    </div>
  );
}

function NodeHeader({
  node,
  row,
  onOpen,
  main,
}: {
  node: MapNode;
  row?: DeviceView;
  onOpen: (key: string) => void;
  main?: boolean;
}) {
  const count = node.links.length;
  return (
    <button
      type="button"
      onClick={() => node.key && onOpen(node.key)}
      className={cx(
        "flex items-center gap-3 rounded-2xl text-left",
        main ? "card border-accent px-4 py-3 shadow-sm" : "w-full",
        node.key && "hover:opacity-90",
      )}
    >
      <span className="grid size-10 flex-none place-items-center rounded-xl bg-accent/15 text-accent">
        <RouterIcon className="size-5" />
      </span>
      <span className="grid min-w-0">
        <span className="truncate font-bold">{row?.device?.name ?? node.name}</span>
        <span className="truncate text-[12px] text-muted">
          {[main ? "Main router" : "Mesh node", node.model?.toUpperCase(), `${count} connected`]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
    </button>
  );
}

function LaneTitle({ wired, label, count }: { wired: boolean; label: string; count: number }) {
  const Icon = wired ? Cable : Wifi;
  return (
    <h3 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wider text-muted">
      <Icon className="size-3.5" /> {label}
      <span className="ml-auto font-semibold normal-case tracking-normal">{count}</span>
    </h3>
  );
}

function Links({
  links,
  rows,
  onOpen,
}: {
  links: MapLink[];
  rows: Map<string, DeviceView>;
  onOpen: (key: string) => void;
}) {
  return (
    <ul className="grid gap-0.5">
      {links.map((l) => {
        const row = l.key ? rows.get(l.key) : undefined;
        const type = row ? (row.device?.type ?? row.suggest.type ?? guessType(row)) : "unknown";
        const speed = rate((l.rx ?? 0) + (l.tx ?? 0));
        return (
          <li key={l.mac}>
            <button
              type="button"
              disabled={!l.key}
              onClick={() => l.key && onOpen(l.key)}
              title={[l.ip, l.mac].filter(Boolean).join(" · ")}
              className="flex w-full min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-(--c-surface-2) disabled:hover:bg-transparent"
            >
              <span className="relative flex-none">
                <KindIcon
                  type={type}
                  className={cx("size-4", l.online ? "text-accent" : "text-muted")}
                />
                <span
                  className={cx(
                    "absolute -right-1 -bottom-1 size-2 rounded-full ring-2 ring-surface",
                    l.online ? "bg-good" : "bg-(--c-line-strong)",
                  )}
                />
              </span>
              <span
                className={cx(
                  "min-w-0 grow truncate text-[13px]",
                  l.online ? "font-semibold" : "text-muted",
                )}
              >
                {l.name}
              </span>
              {speed ? (
                <span className="flex-none text-[11px] text-muted tabular-nums">{speed}</span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Setup: the router, for the map. */
export function RouterCard({ view }: { view: DevicesView }) {
  const qc = useQueryClient();
  const toast = useToast();
  const r = view.router;
  const [open, setOpen] = useState(!r?.configured);
  const [url, setUrl] = useState(r?.url ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.put("/api/admin/router", { url: url.trim(), ...(password ? { password } : {}) });
      toast(url.trim() ? "The router is connected" : "The router is disconnected");
      setPassword("");
      setOpen(false);
      await qc.invalidateQueries({ queryKey: KEY });
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  };
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Router</h2>
          <p className="mt-0.5 text-[13.5px] text-muted">
            {!r?.configured
              ? "A GL.iNet router (firmware 4) says what's plugged into it, what's on each Wi-Fi band, and its mesh nodes: the network map. Hearth signs in with its admin password and only reads."
              : r.ok
                ? "Connected: the map is up to date."
                : (r.error ?? "Not reachable.")}
          </p>
        </div>
        {r?.configured && !open ? (
          <Button size="sm" onClick={() => setOpen(true)}>
            Change
          </Button>
        ) : null}
      </div>
      {open ? (
        <form onSubmit={save} className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Address" hint="Its admin page, like http://192.168.1.1">
            {(id) => (
              <Input
                id={id}
                value={url}
                placeholder="http://192.168.1.1"
                onChange={(e) => setUrl(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Admin password"
            hint={
              r?.passwordSaved
                ? "Saved. Type a new one to replace it."
                : "Kept encrypted. Hearth only reads."
            }
          >
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="new-password"
                value={password}
                placeholder={r?.passwordSaved ? "••••••••" : ""}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button type="submit" variant="primary" busy={busy}>
              Check and save
            </Button>
            {r?.configured ? (
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            ) : null}
          </div>
          <div className="sm:col-span-2">
            <ErrorNote error={error} />
          </div>
        </form>
      ) : null}
    </div>
  );
}
