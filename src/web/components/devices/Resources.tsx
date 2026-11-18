/**
 * The router's and the NAS's resources: processor, memory, temperature, storage, disks and
 * traffic, in the device's panel; and the NAS's SNMP settings in Setup.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
import { useState } from "react";
import type { DeviceView } from "../../../shared/devices";
import type { Resources, ResourcesView } from "../../../shared/resources";
import { api } from "../../lib/api";
import { bytes, cx } from "../../lib/format";
import { Button, ErrorNote, Field, Input, Segmented, Select, useToast } from "../ui";
import { Spark } from "../widgets/Blocks";

export const RESOURCES_KEY = ["admin", "resources"];

export function useResources(enabled = true) {
  return useQuery({
    queryKey: RESOURCES_KEY,
    queryFn: () => api.get<ResourcesView>("/api/admin/resources"),
    enabled,
    refetchInterval: 30_000,
  });
}

/** The readings for this device, if Hearth reads it: the router, the NAS, an added machine. */
export function resourcesFor(view: ResourcesView | undefined, row: DeviceView) {
  if (!view) return undefined;
  return [view.nas, view.router, ...(view.machines ?? [])].find(
    (r) => r?.ip && row.ips.includes(r.ip),
  );
}

const FROM: Record<Resources["source"], string> = {
  router: "From the router",
  ap: "From its admin page",
  nas: "From SNMP",
  glances: "From Glances",
};

/** Warm and too hot, °C: a NAS's system sensor reads far lower than a processor. */
const HEAT: Record<Resources["source"], [number, number]> = {
  router: [80, 90],
  ap: [80, 90],
  nas: [55, 65],
  glances: [80, 90],
};

const pct = (used?: number, total?: number) =>
  used !== undefined && total ? Math.round((100 * used) / total) : undefined;

const rate = (n?: number) => (n === undefined ? "—" : n < 1024 ? `${n} B/s` : `${bytes(n)}/s`);

export function uptime(s?: number) {
  if (s === undefined) return undefined;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}

const tone = (p: number | undefined, warn: number, bad: number) =>
  p === undefined ? "text-muted" : p >= bad ? "text-bad" : p >= warn ? "text-warn" : "text-good";
const bar = (p: number | undefined, warn: number, bad: number) =>
  p === undefined ? "bg-muted" : p >= bad ? "bg-bad" : p >= warn ? "bg-warn" : "bg-good";

function Meter({
  label,
  value,
  detail,
  p,
  warn = 80,
  bad = 92,
}: {
  label: string;
  value: string;
  detail?: string;
  p?: number;
  warn?: number;
  bad?: number;
}) {
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className="text-muted">{label}</span>
        <span className="font-semibold">
          {value}
          {detail ? <span className="ml-1.5 font-normal text-muted">{detail}</span> : null}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-(--c-surface)" aria-hidden>
        <div
          className={cx("h-full rounded-full", bar(p, warn, bad))}
          style={{ width: `${Math.min(100, p ?? 0)}%` }}
        />
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  className,
  points,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  className?: string;
  points?: number[];
  color?: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl bg-(--c-surface) px-3 py-2.5">
      <div className="text-[12px] text-muted">{label}</div>
      <div className={cx("text-lg font-bold tabular-nums", className)}>{value}</div>
      {sub ? <div className="text-[12px] text-muted">{sub}</div> : null}
      {points && points.length > 2 && color ? (
        <Spark
          points={points}
          color={color}
          className="pointer-events-none absolute inset-x-0 bottom-0 h-8 w-full opacity-70"
        />
      ) : null}
    </div>
  );
}

/** In the device's panel. */
export function ResourcesSection({ r }: { r: Resources }) {
  const mem = pct(r.memUsed, r.memTotal);
  const cpuText =
    r.cpu !== undefined ? `${Math.round(r.cpu)}%` : r.load ? r.load[0].toFixed(2) : "—";
  const cpuSub =
    r.cpu !== undefined
      ? r.load
        ? `load ${r.load[0].toFixed(2)}`
        : undefined
      : `load${r.cores ? ` · ${r.cores} cores` : ""}`;
  const busy = r.cpu ?? (r.load && r.cores ? (100 * r.load[0]) / r.cores : undefined);
  const facts: [string, string | undefined][] = [
    ["Model", [r.model, r.version].filter(Boolean).join(" · ") || undefined],
    ["Up for", uptime(r.uptime)],
    ["Internet", r.internet === undefined ? undefined : r.internet ? "Reachable" : "Not reachable"],
    ["Fans and power", r.fans],
    ["Update", r.update ? "A DSM update is waiting" : undefined],
  ];
  return (
    <section className="rounded-2xl bg-(--c-surface-2) p-4">
      <h3 className="mb-1 flex items-center gap-2 font-bold">
        <Gauge className="size-4.5 text-accent" /> How it's doing
      </h3>
      <p
        className={cx(
          "mb-3 text-[13.5px]",
          !r.ok ? "text-bad" : r.problems.length ? "text-warn" : "text-good",
        )}
      >
        {!r.ok
          ? (r.error ?? "Couldn't read it.")
          : r.problems.length
            ? r.problems.join(" ")
            : "All good."}
        <span className="ml-1.5 text-muted">{FROM[r.source]}, every 30 s.</span>
      </p>
      {r.ok || r.at ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile
              label="Processor"
              value={cpuText}
              sub={cpuSub}
              className={tone(busy, 70, 90)}
              points={r.history.cpu}
              color="var(--c-chart1)"
            />
            <Tile
              label="Memory"
              value={mem === undefined ? "—" : `${mem}%`}
              sub={r.memTotal ? `of ${bytes(r.memTotal)}` : undefined}
              className={tone(mem, 85, 95)}
              points={r.history.mem}
              color="var(--c-chart2)"
            />
            <Tile
              label="Temperature"
              value={r.temp === undefined ? "—" : `${r.temp} °C`}
              className={tone(r.temp, HEAT[r.source][0], HEAT[r.source][1])}
              points={r.history.temp}
              color="var(--c-chart3)"
            />
            <Tile
              label="Traffic"
              value={`↓ ${rate(r.rx)}`}
              sub={`↑ ${rate(r.tx)}`}
              points={r.history.rx}
              color="var(--c-chart4)"
            />
          </div>
          {r.volumes.length ? (
            <div className="mt-4 grid gap-3">
              {r.volumes.map((v) => {
                const p = pct(v.used, v.total);
                return (
                  <Meter
                    key={v.name}
                    label={v.status && v.status !== "Normal" ? `${v.name} · ${v.status}` : v.name}
                    value={`${bytes(v.used)} of ${bytes(v.total)}`}
                    detail={p === undefined ? undefined : `${p}%`}
                    p={p}
                  />
                );
              })}
            </div>
          ) : null}
          {r.disks.length ? (
            <ul className="mt-4 grid gap-1.5 text-[13px] sm:grid-cols-2">
              {r.disks.map((d) => (
                <li
                  key={d.name}
                  className="flex items-center justify-between gap-2 rounded-lg bg-(--c-surface) px-3 py-1.5"
                >
                  <span className="min-w-0 truncate">
                    <span
                      className={cx(
                        "mr-2 inline-block size-2 rounded-full",
                        d.ok ? "bg-good" : "bg-bad",
                      )}
                    />
                    <span className="font-semibold">{d.name}</span>
                    {d.model ? <span className="ml-1.5 text-muted">{d.model}</span> : null}
                  </span>
                  <span className={cx("shrink-0", d.ok ? "text-muted" : "font-semibold text-bad")}>
                    {d.ok ? (d.temp !== undefined ? `${d.temp} °C` : d.status) : d.status}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <dl className="mt-4 grid gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-[auto_1fr]">
            {facts
              .filter(([, value]) => value)
              .map(([k, value]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{k}</dt>
                  <dd className="font-semibold">{value}</dd>
                </div>
              ))}
          </dl>
        </>
      ) : null}
    </section>
  );
}

/** Setup: the NAS over SNMP. */
export function NasCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useResources();
  const n = data?.setup.nas;
  const nas = data?.nas;
  const configured = Boolean(n?.host);
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState<string | null>(null);
  const [version, setVersion] = useState<"2c" | "3" | null>(null);
  const [user, setUser] = useState<string | null>(null);
  const [auth, setAuth] = useState<"sha" | "md5" | null>(null);
  const [priv, setPriv] = useState<"aes" | "des" | "none" | null>(null);
  const [secret, setSecret] = useState("");
  const [privSecret, setPrivSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const v = version ?? n?.version ?? "3";
  const showForm = open || (data !== undefined && !configured);
  const save = async (e: React.FormEvent, disconnect = false) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.put("/api/admin/nas", {
        host: disconnect ? "" : (host ?? n?.host ?? "").trim(),
        version: v,
        user: (user ?? n?.user ?? "").trim() || undefined,
        auth: auth ?? n?.auth ?? "sha",
        priv: priv ?? n?.priv ?? "aes",
        ...(secret ? { secret } : {}),
        ...(privSecret ? { privSecret } : {}),
      });
      toast(disconnect ? "The NAS is disconnected" : "The NAS is connected");
      setSecret("");
      setPrivSecret("");
      setOpen(false);
      await qc.invalidateQueries({ queryKey: RESOURCES_KEY });
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  };
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">NAS</h2>
          <p className="mt-0.5 text-[13.5px] text-muted">
            {!configured
              ? "Its processor, memory, temperature, disks and volumes, over SNMP: nothing to install. Turn SNMP on in DSM (Control Panel → Terminal & SNMP), then give the same settings here. Hearth only reads."
              : nas?.ok
                ? `Connected: ${[nas.model, nas.version].filter(Boolean).join(" · ") || n?.host}.`
                : (nas?.error ?? "Reading it…")}
          </p>
        </div>
        {configured && !open ? (
          <Button size="sm" onClick={() => setOpen(true)}>
            Change
          </Button>
        ) : null}
      </div>
      {showForm ? (
        <form onSubmit={(e) => save(e)} className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Address" hint="The NAS on the network, like 192.168.1.20 or nas.home">
            {(id) => (
              <Input
                id={id}
                value={host ?? n?.host ?? ""}
                placeholder="192.168.1.20"
                onChange={(e) => setHost(e.target.value)}
              />
            )}
          </Field>
          <Field label="SNMP version" hint="v3 is encrypted; v2c only has a community name">
            {() => (
              <Segmented
                label="SNMP version"
                value={v}
                onChange={(x) => setVersion(x)}
                options={[
                  { value: "3", label: "v3" },
                  { value: "2c", label: "v2c" },
                ]}
              />
            )}
          </Field>
          {v === "3" ? (
            <>
              <Field label="User" hint="The SNMPv3 user set in DSM">
                {(id) => (
                  <Input
                    id={id}
                    value={user ?? n?.user ?? ""}
                    autoComplete="off"
                    onChange={(e) => setUser(e.target.value)}
                  />
                )}
              </Field>
              <Field
                label="Password"
                hint={n?.secretSaved ? "Saved. Type a new one to replace it." : "Kept encrypted."}
              >
                {(id) => (
                  <Input
                    id={id}
                    type="password"
                    autoComplete="new-password"
                    value={secret}
                    placeholder={n?.secretSaved ? "••••••••" : ""}
                    onChange={(e) => setSecret(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Sign-in check" hint="DSM calls it the protocol (SHA is the default)">
                {(id) => (
                  <Select
                    id={id}
                    value={auth ?? n?.auth ?? "sha"}
                    onChange={(e) => setAuth(e.target.value as "sha" | "md5")}
                  >
                    <option value="sha">SHA</option>
                    <option value="md5">MD5</option>
                  </Select>
                )}
              </Field>
              <Field label="Encryption" hint="DSM's Privacy protocol (AES is the default)">
                {(id) => (
                  <Select
                    id={id}
                    value={priv ?? n?.priv ?? "aes"}
                    onChange={(e) => setPriv(e.target.value as "aes" | "des" | "none")}
                  >
                    <option value="aes">AES</option>
                    <option value="des">DES</option>
                    <option value="none">None</option>
                  </Select>
                )}
              </Field>
              {(priv ?? n?.priv ?? "aes") !== "none" ? (
                <Field
                  label="Encryption password"
                  hint={
                    n?.privSaved
                      ? "Saved. Type a new one to replace it."
                      : "Leave empty if it's the same as the password."
                  }
                >
                  {(id) => (
                    <Input
                      id={id}
                      type="password"
                      autoComplete="new-password"
                      value={privSecret}
                      placeholder={n?.privSaved ? "••••••••" : ""}
                      onChange={(e) => setPrivSecret(e.target.value)}
                    />
                  )}
                </Field>
              ) : null}
            </>
          ) : (
            <Field
              label="Community"
              hint={
                n?.secretSaved
                  ? "Saved. Type a new one to replace it."
                  : "Like a password: pick your own, not “public”"
              }
            >
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="new-password"
                  value={secret}
                  placeholder={n?.secretSaved ? "••••••••" : ""}
                  onChange={(e) => setSecret(e.target.value)}
                />
              )}
            </Field>
          )}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button type="submit" variant="primary" busy={busy}>
              Check and save
            </Button>
            {configured ? (
              <>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button variant="ghost" onClick={(e) => save(e, true)}>
                  Disconnect
                </Button>
              </>
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
