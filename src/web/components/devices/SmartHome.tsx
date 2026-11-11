/**
 * Smart-home hubs on the Devices page: connecting openHAB and Home Assistant (Setup), and a
 * device's readings and switches from them (its panel).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { House, Power } from "lucide-react";
import { useState } from "react";
import type { DeviceView } from "../../../shared/devices";
import {
  HUB_NAMES,
  type HubKind,
  type HubState,
  type SmartHomeView,
  type SmartThing,
} from "../../../shared/smarthome";
import { api } from "../../lib/api";
import { cx } from "../../lib/format";
import { Button, ErrorNote, Field, Input, Select, useToast } from "../ui";
import { KEY } from "./parts";

export const SMART_KEY = ["admin-smarthome"] as const;

const HOW_TO: Record<HubKind, { placeholder: string; token: string }> = {
  openhab: {
    placeholder: "http://192.168.1.20:8080",
    token: "In openHAB: your profile (bottom left) → API tokens → Create new API token.",
  },
  homeassistant: {
    placeholder: "http://192.168.1.21:8123",
    token: "In Home Assistant: your profile → Security → Long-lived access tokens → Create token.",
  },
};

export function useSmartHome(enabled = true) {
  return useQuery({
    queryKey: SMART_KEY,
    queryFn: () => api.get<SmartHomeView>("/api/admin/smarthome"),
    enabled,
    refetchInterval: 60_000,
  });
}

/** Setup: connect the home's hubs. */
export function SmartHomeCard() {
  const q = useSmartHome();
  return (
    <div className="card grid gap-4 p-5 lg:col-span-2">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <House className="size-5 text-accent" /> Smart home
        </h2>
        <p className="mt-0.5 text-[13.5px] text-muted">
          Connect the hub that runs your smart home, and each device it knows shows its readings
          (leak sensor dry, the thermostat's temperature, the vacuum's state) and switches on the
          Devices page. Hearth talks to the hub on your network with a token you make in it, and to
          nothing on the internet.
        </p>
      </div>
      {q.data ? (
        <div className="grid gap-4 md:grid-cols-2">
          {q.data.hubs.map((h) => (
            <HubForm key={h.kind} hub={h} />
          ))}
        </div>
      ) : q.error ? (
        <ErrorNote error={q.error} />
      ) : (
        <div className="skeleton h-24" />
      )}
    </div>
  );
}

function HubForm({ hub }: { hub: HubState }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(!hub.configured);
  const [url, setUrl] = useState(hub.url ?? "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const name = HUB_NAMES[hub.kind];
  const save = async (e: React.FormEvent, off = false) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.put(`/api/admin/smarthome/${hub.kind}`, {
        url: off ? "" : url.trim(),
        ...(token ? { token } : {}),
        ...(off ? { token: null } : {}),
      });
      toast(off ? `${name} is disconnected` : `${name} is connected`);
      setToken("");
      setOpen(off);
      await qc.invalidateQueries({ queryKey: SMART_KEY });
      await qc.invalidateQueries({ queryKey: KEY });
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  };
  return (
    <form onSubmit={save} className="grid content-start gap-3 rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold">{name}</span>
        <span
          className={cx(
            "text-[12.5px] font-semibold",
            !hub.configured ? "text-muted" : hub.ok ? "text-good" : "text-bad",
          )}
        >
          {!hub.configured
            ? "Not connected"
            : hub.ok
              ? `Connected${hub.version ? `, ${hub.version}` : ""} · ${hub.things} device${hub.things === 1 ? "" : "s"}`
              : (hub.error ?? "Not reachable")}
        </span>
      </div>
      {open ? (
        <>
          <Field label="Address">
            {(id) => (
              <Input
                id={id}
                value={url}
                placeholder={HOW_TO[hub.kind].placeholder}
                onChange={(e) => setUrl(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Token"
            hint={`${HOW_TO[hub.kind].token}${hub.tokenSaved ? " One is saved; paste a new one to replace it." : " Kept encrypted."}`}
          >
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="off"
                value={token}
                placeholder={hub.tokenSaved ? "••••••••" : ""}
                onChange={(e) => setToken(e.target.value)}
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" busy={busy} disabled={!url.trim()}>
              Check and save
            </Button>
            {hub.configured ? (
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            ) : null}
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setOpen(true)}>
            Change
          </Button>
          <Button size="sm" variant="ghost" busy={busy} onClick={(e) => save(e as never, true)}>
            Disconnect
          </Button>
        </div>
      )}
      <ErrorNote error={error} />
    </form>
  );
}

/** The few words a tile shows: the first reading ("Leak: Dry"), else a switch ("Power: On"). */
export function smartLine(d: DeviceView): string | undefined {
  const points = (d.smart ?? []).flatMap((t) => t.points);
  const p =
    points.find((x) => !x.canControl && x.state !== "—") ?? points.find((x) => x.state !== "—");
  return p ? `${p.label}: ${p.state}` : undefined;
}

/** A device's panel: what its hub says, its switches, and linking it to a hub's device by hand. */
export function SmartSection({ row }: { row: DeviceView }) {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useSmartHome();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const connected = list.data?.hubs.some((h) => h.configured);
  if (!connected && !row.smart?.length) return null;
  const toggle = async (t: SmartThing, point: string, on: boolean) => {
    setBusy(point);
    setError(null);
    try {
      await api.post("/api/admin/smarthome/switch", { thing: t.key, point, on });
      await qc.invalidateQueries({ queryKey: KEY });
    } catch (e) {
      setError(e);
    }
    setBusy(null);
  };
  const link = async (thing: string) => {
    if (!row.device) return;
    setError(null);
    try {
      await api.put(`/api/admin/devices/${encodeURIComponent(row.device.id)}/smart`, {
        thing: thing || null,
      });
      toast(thing ? "Linked" : "Unlinked");
      await qc.invalidateQueries({ queryKey: KEY });
      await qc.invalidateQueries({ queryKey: SMART_KEY });
    } catch (e) {
      setError(e);
    }
  };
  const linked = list.data?.things.find((t) => t.device === row.device?.id);
  return (
    <section className="rounded-2xl bg-(--c-surface-2) p-4">
      <h3 className="mb-2 flex items-center gap-2 font-bold">
        <House className="size-4.5 text-accent" /> Smart home
      </h3>
      {(row.smart ?? []).map((t) => (
        <div key={t.key} className="mb-3">
          <p className="mb-1.5 text-[13px] text-muted">
            <b className="text-ink">{t.name}</b> in {HUB_NAMES[t.hub]}
            {t.status ? ` · ${t.status.toLowerCase()}` : ""}
            {t.maker || t.model ? ` · ${[t.maker, t.model].filter(Boolean).join(" ")}` : ""}
          </p>
          {t.points.length ? (
            <ul className="grid gap-1">
              {t.points.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-[13.5px]">
                  <span className="min-w-0 grow truncate">{p.label}</span>
                  <span className="font-semibold tabular-nums">{p.state}</span>
                  {p.canControl ? (
                    <Button
                      size="sm"
                      variant={p.on ? "primary" : "secondary"}
                      busy={busy === p.id}
                      onClick={() => toggle(t, p.id, !p.on)}
                      aria-label={`Turn ${p.label} ${p.on ? "off" : "on"}`}
                    >
                      <Power className="size-4" /> {p.on ? "Turn off" : "Turn on"}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">No readings linked to it in the hub yet.</p>
          )}
        </div>
      ))}
      {row.device && list.data?.things.length ? (
        <Field
          label={row.smart?.length ? "It's this one in the hub" : "Which one is it in the hub?"}
          hint="Found by its address when the hub knows it; otherwise say which it is."
        >
          {(id) => (
            <Select id={id} value={linked?.key ?? ""} onChange={(e) => link(e.target.value)}>
              <option value="">{linked ? "Not linked by hand" : "Choose…"}</option>
              {list.data?.things
                .filter((t) => !t.device || t.device === row.device?.id)
                .map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name} ({HUB_NAMES[t.hub]})
                  </option>
                ))}
            </Select>
          )}
        </Field>
      ) : null}
      <ErrorNote error={error} />
    </section>
  );
}
