/** Setup: the Sense energy monitor, through Sense's servers. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import { useState } from "react";
import type { EnergyView } from "../../../shared/energy";
import { api } from "../../lib/api";
import { cx } from "../../lib/format";
import { Button, ErrorNote, Field, Input, useToast } from "../ui";
import { Spark } from "../widgets/Blocks";

const KEY = ["admin", "sense"];

const kw = (w?: number) =>
  w === undefined ? "—" : Math.abs(w) < 1000 ? `${w} W` : `${(w / 1000).toFixed(1)} kW`;

export function SenseCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({
    queryKey: KEY,
    queryFn: () => api.get<EnergyView>("/api/admin/sense"),
    refetchInterval: 60_000,
  });
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const connected = data?.connected ?? false;
  const showForm = open || asking || (data !== undefined && (!connected || data.needsSignIn));
  const n = data?.now;

  const settle = async (msg: string) => {
    toast(msg);
    setPassword("");
    setCode("");
    setAsking(false);
    setOpen(false);
    await qc.invalidateQueries({ queryKey: KEY });
  };
  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (asking) {
        await api.post("/api/admin/sense/code", { code: code.trim() });
        await settle("Sense is connected");
      } else {
        const r = await api.put<{ ok: true; code: boolean }>("/api/admin/sense", {
          email: email.trim() || data?.email || "",
          password,
        });
        if (r.code) {
          setAsking(true);
          setPassword("");
        } else await settle("Sense is connected");
      }
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  };
  const disconnect = async () => {
    setBusy(true);
    try {
      await api.del("/api/admin/sense");
      await settle("Sense is disconnected");
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  };

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Zap className="size-4.5 text-accent" /> Sense energy monitor
          </h2>
          <p className="mt-0.5 text-[13.5px] text-muted">
            {!connected
              ? "The home's power now, today's use and what's on, for the Sense energy widget. Sense keeps its readings on its own servers, so connecting it lets Hearth reach Sense on the internet (only Sense, about once a minute while someone is looking). Your password goes to Sense once and isn't kept."
              : data?.needsSignIn
                ? "Sense signed Hearth out. Sign in again to keep reading it."
                : `Connected as ${data?.email ?? "your account"}.`}
          </p>
        </div>
        {connected && !showForm ? (
          <Button size="sm" onClick={() => setOpen(true)}>
            Change
          </Button>
        ) : null}
      </div>
      {connected && n && !showForm ? (
        n.ok ? (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Reading label="Using now" value={kw(n.watts)} points={n.history.watts} />
            {n.solar ? (
              <Reading label="Solar now" value={kw(n.solarWatts)} points={n.history.solar} />
            ) : null}
            <Reading
              label="Today"
              value={n.today ? `${n.today.kwh} kWh` : "—"}
              sub={
                [
                  n.cost?.today !== undefined ? money(n.cost.today) : null,
                  n.today?.solarKwh ? `solar ${n.today.solarKwh} kWh` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || undefined
              }
            />
            {n.cost ? (
              <Reading
                label={`This bill · since ${shortDate(n.cost.period.start)}`}
                value={money(n.cost.period.cost)}
                sub={
                  n.cost.period.projectedCost !== undefined
                    ? `on track for ${money(n.cost.period.projectedCost)}`
                    : `${n.cost.period.kwh} kWh so far`
                }
              />
            ) : (
              <Reading
                label="On now"
                value={String(n.devices.length)}
                sub={n.devices
                  .slice(0, 2)
                  .map((d) => d.name)
                  .join(", ")}
              />
            )}
          </div>
        ) : (
          <p className="mt-3 text-[13.5px] text-bad">{n.error}</p>
        )
      ) : null}
      {connected && data && !showForm ? <CostSettingsForm view={data} /> : null}
      {showForm ? (
        <form onSubmit={signIn} className="mt-4 grid gap-3 sm:grid-cols-2">
          {asking ? (
            <Field
              label="Code"
              hint="Your Sense account asks for a code from your authenticator app"
            >
              {(id) => (
                <Input
                  id={id}
                  value={code}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  onChange={(e) => setCode(e.target.value)}
                />
              )}
            </Field>
          ) : (
            <>
              <Field label="Email" hint="The one you sign in to the Sense app with">
                {(id) => (
                  <Input
                    id={id}
                    type="email"
                    value={email || data?.email || ""}
                    required
                    autoComplete="off"
                    onChange={(e) => setEmail(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Password" hint="Sent to Sense to sign in, never kept">
                {(id) => (
                  <Input
                    id={id}
                    type="password"
                    value={password}
                    required
                    autoComplete="new-password"
                    onChange={(e) => setPassword(e.target.value)}
                  />
                )}
              </Field>
            </>
          )}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button type="submit" variant="primary" busy={busy}>
              {asking ? "Check the code" : "Connect"}
            </Button>
            {open || asking ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  setAsking(false);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            ) : null}
            {connected ? (
              <Button variant="ghost" onClick={disconnect} disabled={busy}>
                Disconnect
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

const money = (n: number) => `$${n.toFixed(2)}`;

/** "Nov 13" from "2026-11-13". */
const shortDate = (ymd: string) =>
  new Date(`${ymd}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

const ordinal = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

/** The rate, billing day and fixed charge: Sense's unless set here. */
function CostSettingsForm({ view }: { view: EnergyView }) {
  const qc = useQueryClient();
  const toast = useToast();
  const s = view.costSettings ?? {};
  const sc = view.senseCost;
  const c = view.now?.cost;
  const [open, setOpen] = useState(false);
  const [rate, setRate] = useState(s.rate?.toString() ?? "");
  const [cycle, setCycle] = useState(s.cycleStart?.toString() ?? "");
  const [fixed, setFixed] = useState(s.fixed?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const from = !c
    ? "Waiting for Sense's rate…"
    : c.rateFrom === "hearth"
      ? "set here"
      : c.rateFrom === "sense"
        ? "from your Sense app"
        : `${c.area ?? "your area"}'s average, from Sense`;
  const senseRate = sc?.rateSetByUser
    ? `${sc.rate} ¢ from your Sense app`
    : sc?.areaRate
      ? `${sc.areaRate} ¢, ${sc.area ?? "your area"}'s average`
      : "Sense's";
  const toNum = (v: string) => (v.trim() === "" ? null : Number(v));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.put("/api/admin/sense/cost", {
        rate: toNum(rate),
        cycleStart: toNum(cycle),
        fixed: toNum(fixed),
      });
      toast("Saved");
      setOpen(false);
      await qc.invalidateQueries({ queryKey: KEY });
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  };
  return (
    <div className="mt-4 rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[13.5px]">
        <span>
          <span className="font-semibold">Cost</span>
          <span className="ml-2 text-muted">
            {c
              ? `${c.rate} ¢/kWh (${from}) · bills start on the ${ordinal(Number(c.period.start.slice(8)))}${c.fixed ? ` · ${money(c.fixed)} fixed` : ""}`
              : from}
          </span>
        </span>
        {!open ? (
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
            Change
          </Button>
        ) : null}
      </div>
      {open ? (
        <form onSubmit={save} className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="Rate (¢ a kWh)" hint={`Empty: ${senseRate}`}>
            {(id) => (
              <Input
                id={id}
                type="number"
                inputMode="decimal"
                step="0.001"
                min="0"
                value={rate}
                placeholder={String(sc?.rateSetByUser ? (sc.rate ?? "") : (sc?.areaRate ?? ""))}
                onChange={(e) => setRate(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Bill starts on day"
            hint={`Empty: ${sc?.cycleStart ? `the ${ordinal(sc.cycleStart)}, from Sense` : "the 1st"}`}
          >
            {(id) => (
              <Input
                id={id}
                type="number"
                inputMode="numeric"
                min="1"
                max="31"
                value={cycle}
                placeholder={String(sc?.cycleStart ?? 1)}
                onChange={(e) => setCycle(e.target.value)}
              />
            )}
          </Field>
          <Field label="Fixed charge ($ a bill)" hint="The base fee on every bill, if any">
            {(id) => (
              <Input
                id={id}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={fixed}
                placeholder="0"
                onChange={(e) => setFixed(e.target.value)}
              />
            )}
          </Field>
          <p className="text-[12.5px] text-muted sm:col-span-3">
            Leave a box empty to use Sense's. With solar, what's sold back is taken off at Sense's
            sell-back rate. It's an estimate: taxes, tiers and time-of-use prices aren't counted.
          </p>
          <div className="flex flex-wrap gap-2 sm:col-span-3">
            <Button type="submit" variant="primary" busy={busy}>
              Save
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          <div className="sm:col-span-3">
            <ErrorNote error={error} />
          </div>
        </form>
      ) : null}
    </div>
  );
}

function Reading({
  label,
  value,
  sub,
  points,
}: {
  label: string;
  value: string;
  sub?: string;
  points?: number[];
}) {
  return (
    <div className="relative overflow-hidden rounded-xl bg-(--c-surface-2) px-3 py-2.5">
      <div className="text-[12px] text-muted">{label}</div>
      <div className={cx("text-lg font-bold tabular-nums")}>{value}</div>
      {sub ? <div className="truncate text-[12px] text-muted">{sub}</div> : null}
      {points && points.length > 2 ? (
        <Spark
          points={points}
          color="var(--c-chart1)"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-8 w-full opacity-70"
        />
      ) : null}
    </div>
  );
}
