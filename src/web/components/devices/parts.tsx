/**
 * The devices page's pieces: what each type of device looks like, naming a device (the form), and
 * the two setup cards (AdGuard Home, and what happens to new devices).
 */
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Box,
  Cctv,
  CircleHelp,
  Gamepad2,
  Laptop,
  type LucideIcon,
  Monitor,
  Plug,
  Printer,
  Router,
  Server,
  Smartphone,
  Speaker,
  Tablet,
  Thermometer,
  Tv,
  WashingMachine,
} from "lucide-react";
import { createContext, useContext, useState } from "react";
import type { PublicProfile } from "../../../shared/api";
import {
  DEVICE_TYPES,
  type DeviceKindId,
  type DevicesView,
  type DeviceType,
  type DeviceView,
  isCustomKind,
  PLACES,
  type Place,
  type Treatment,
} from "../../../shared/devices";
import { api } from "../../lib/api";
import { cx } from "../../lib/format";
import { IconPicker } from "../IconPicker";
import { SvgIcon } from "../Tile";
import { Button, ErrorNote, Field, Input, Segmented, Select, useToast } from "../ui";

export const KEY = ["admin-devices"] as const;

export const TYPE: Record<
  DeviceType,
  { label: string; icon: LucideIcon; ref: string; place: Place }
> = {
  phone: { label: "Phone", icon: Smartphone, ref: "lucide:smartphone", place: "computers" },
  tablet: { label: "Tablet", icon: Tablet, ref: "lucide:tablet", place: "computers" },
  laptop: { label: "Laptop", icon: Laptop, ref: "lucide:laptop", place: "computers" },
  desktop: { label: "Computer", icon: Monitor, ref: "lucide:monitor", place: "computers" },
  tv: { label: "TV", icon: Tv, ref: "lucide:tv", place: "entertainment" },
  console: {
    label: "Games console",
    icon: Gamepad2,
    ref: "lucide:gamepad-2",
    place: "entertainment",
  },
  speaker: { label: "Speaker", icon: Speaker, ref: "lucide:speaker", place: "entertainment" },
  camera: { label: "Camera", icon: Cctv, ref: "lucide:cctv", place: "smart" },
  printer: { label: "Printer", icon: Printer, ref: "lucide:printer", place: "computers" },
  printer3d: { label: "3D printer", icon: Box, ref: "lucide:box", place: "computers" },
  plug: { label: "Smart plug, switch or light", icon: Plug, ref: "lucide:plug", place: "smart" },
  thermostat: { label: "Thermostat", icon: Thermometer, ref: "lucide:thermometer", place: "smart" },
  appliance: {
    label: "Smart appliance (vacuum, washer, fridge…)",
    icon: WashingMachine,
    ref: "lucide:washing-machine",
    place: "smart",
  },
  sensor: {
    label: "Sensor or detector (leak, smoke, energy…)",
    icon: Activity,
    ref: "lucide:activity",
    place: "smart",
  },
  network: {
    label: "Router or access point",
    icon: Router,
    ref: "lucide:router",
    place: "network",
  },
  server: { label: "Server or NAS", icon: Server, ref: "lucide:server", place: "network" },
  unknown: { label: "Not sure yet", icon: CircleHelp, ref: "lucide:circle-help", place: "unknown" },
};

/** The kinds of device the admin made, for every icon and label on the page. */
export type Kinds = DevicesView["kinds"];
export const KindsContext = createContext<Kinds>([]);

/** The admin's version of a kind: one they made, or a built-in one they changed. */
export const ownKind = (type: string, kinds: Kinds) =>
  kinds.find((k) => k.id === type && !k.hidden);

/** A kind's name: the admin's, or the built-in one's. */
export function kindLabel(type: DeviceKindId, kinds: Kinds): string {
  const own = ownKind(type, kinds);
  if (own) return own.label;
  if (isCustomKind(type)) return "Not sure yet";
  return TYPE[type]?.label ?? "Not sure yet";
}

/** Every kind to choose from: the built-in ones (as the admin left them), then their own. */
export function allKinds(kinds: Kinds): { id: DeviceKindId; label: string; builtin: boolean }[] {
  const hidden = new Set(kinds.filter((k) => k.hidden).map((k) => k.id));
  return [
    ...DEVICE_TYPES.filter((t) => !hidden.has(t)).map((t) => ({
      id: t as DeviceKindId,
      label: kindLabel(t, kinds),
      builtin: true,
    })),
    ...kinds
      .filter((k) => isCustomKind(k.id))
      .map((k) => ({ id: k.id as DeviceKindId, label: k.label, builtin: false })),
  ];
}

/** A kind's icon, at any size: a built-in one's symbol, or the admin's icon from the library. */
export function KindIcon({ type, className }: { type: DeviceKindId; className?: string }) {
  const kinds = useContext(KindsContext);
  const own = ownKind(type, kinds);
  // A built-in kind keeps its own symbol until the admin picks another icon for it.
  if (own && (isCustomKind(type) || own.iconRef !== TYPE[type as DeviceType]?.ref)) {
    const k = own;
    if (k?.iconKind === "svg" && k.svg) return <SvgIcon svg={k.svg} className={className} />;
    if (k?.iconKind === "emoji")
      return (
        <span className={cx("grid place-items-center leading-none", className)} aria-hidden>
          <span className="text-[0.9em]">{k.icon}</span>
        </span>
      );
    if (k?.iconKind === "image")
      return <img src={k.icon} alt="" className={cx("object-contain", className)} />;
    if (k)
      return (
        <span className={cx("grid place-items-center font-bold", className)}>{k.label[0]}</span>
      );
  }
  const Icon = TYPE[isCustomKind(type) ? "unknown" : type]?.icon ?? CircleHelp;
  return <Icon className={className} />;
}

export const PLACE_NAMES: Record<Place, string> = {
  network: "The network",
  entertainment: "Entertainment",
  computers: "Computers and printers",
  smart: "Smart home",
  unknown: "Not sure yet",
};

/** A first guess at what it is, from its name and browser. */
export function guessType(v: DeviceView): DeviceType {
  const s = `${v.networkName ?? ""} ${v.agent ?? ""} ${v.maker ?? ""}`.toLowerCase();
  if (/iphone|android phone|pixel|galaxy/.test(s)) return "phone";
  if (/ipad|tablet|kindle|fire/.test(s)) return "tablet";
  if (/macbook|laptop|chromebook/.test(s)) return "laptop";
  if (/windows|mac|linux|desktop|pc/.test(s)) return "desktop";
  if (/tv|roku|chromecast|shield|firestick|appletv/.test(s)) return "tv";
  if (/xbox|playstation|ps5|switch|nintendo/.test(s)) return "console";
  if (/sonos|echo|homepod|speaker|nest-?mini/.test(s)) return "speaker";
  if (/cam|doorbell/.test(s)) return "camera";
  if (/prusa|bambu|creality|octoprint|klipper|3d ?print/.test(s)) return "printer3d";
  if (/thermostat|ecobee|honeywell/.test(s)) return "thermostat";
  if (/roborock|roomba|vacuum|washer|dryer|fridge|dishwasher|gemodule|appliance/.test(s))
    return "appliance";
  if (/leak|smoke|sensor|dch-s|sense-/.test(s)) return "sensor";
  if (/print|epson|brother|canon|hp-?/.test(s)) return "printer";
  if (/plug|shelly|tasmota|wled|kasa|tuya|esp/.test(s)) return "plug";
  if (/nas|synology|server/.test(s)) return "server";
  if (/router|gl-|ap-|mesh/.test(s)) return "network";
  return "unknown";
}

/** What it is, in words: its own ("Google Nest Hub") when it said, else a guess ("probably …"). */
export function what(d: DeviceView): string | undefined {
  if (!d.maker) return undefined;
  return d.identity?.model || d.identity?.maker ? d.maker : `probably ${d.maker}`;
}

/** The name to show for a row: its saved name, what it calls itself, what the network calls it. */
export function title(d: DeviceView): string {
  const w = what(d);
  return (
    d.device?.name ??
    d.suggest.name ??
    d.agent ??
    (w ? w.charAt(0).toUpperCase() + w.slice(1) : "Unknown device")
  );
}

export function ago(iso?: string): string {
  if (!iso) return "not seen yet";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 2) return "active now";
  if (min < 60) return `${min} minutes ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** A device's details, to name it and say whose it is: inline, in the device's panel. */
export function DeviceEditor({
  row,
  people,
  onDone,
}: {
  row: DeviceView;
  people: PublicProfile[];
  /** Saved or forgotten. */
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const d = row.device;
  // A browser that opened Hearth as one person is probably theirs.
  const likely = row.profiles.length === 1 ? row.profiles[0] : undefined;
  // A first name: what the network calls it, or whose it seems to be and what it is ("Sam's iPhone").
  const suggested = (() => {
    if (row.suggest.name) return row.suggest.name;
    const what = row.agent?.split(" · ")[0];
    const who = people.find((p) => p.id === likely)?.name;
    return what ? (who ? `${who}'s ${what}` : what) : "";
  })();
  const [name, setName] = useState(d?.name ?? suggested);
  const kinds = useContext(KindsContext);
  const [type, setType] = useState<DeviceKindId>(d?.type ?? row.suggest.type ?? guessType(row));
  const [making, setMaking] = useState(false);
  const [treatment, setTreatment] = useState<Treatment>(d?.treatment ?? "person");
  const [person, setPerson] = useState(d?.person ?? likely ?? "");
  const [sharedBy, setSharedBy] = useState<string[]>(d?.people ?? []);
  const [ips, setIps] = useState(row.ips.join(", "));
  const [macs, setMacs] = useState(row.macs.join(", "));
  const [notes, setNotes] = useState(d?.notes ?? "");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const list = (s: string) =>
    s
      .split(/[\s,]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.put(`/api/admin/devices/${encodeURIComponent(row.key)}`, {
        name: name.trim(),
        type,
        treatment,
        person: treatment === "person" ? person || undefined : undefined,
        people: treatment === "shared" ? sharedBy : undefined,
        ips: list(ips),
        macs: list(macs),
        notes: notes.trim() || undefined,
      });
      toast("Saved");
      await qc.invalidateQueries({ queryKey: KEY });
      setBusy(false);
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!d) return;
    setBusy(true);
    try {
      await api.del(`/api/admin/devices/${encodeURIComponent(d.id)}`);
      toast(`${d.name} is forgotten`);
      await qc.invalidateQueries({ queryKey: KEY });
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
      {row.identity || (!d && (row.maker || row.lookups.length || row.agent)) ? (
        <p className="rounded-xl bg-(--c-surface-2) px-3 py-2 text-[13px] sm:col-span-2">
          <b>Clues:</b>{" "}
          {[
            row.identity?.name ? `it calls itself “${row.identity.name}”` : null,
            what(row) ? (row.identity?.model ? `it says it's ${what(row)}` : what(row)) : null,
            row.identity?.via ? `(asked by ${row.identity.via})` : null,
            row.networkName && row.networkName !== row.identity?.name
              ? `the network calls it “${row.networkName}”`
              : null,
            row.agent ? `its browser says ${row.agent}` : null,
            row.lookups.length ? `it looks up ${row.lookups.join(", ")}` : null,
          ]
            .filter(Boolean)
            .join("; ")}
          .
        </p>
      ) : null}
      <Field label="Name">
        {(id) => (
          <Input
            id={id}
            value={name}
            required
            maxLength={60}
            placeholder="Ava's iPad"
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      <Field label="What it is">
        {(id) => (
          <Select
            id={id}
            value={making ? "new" : type}
            onChange={(e) => {
              if (e.target.value === "new") setMaking(true);
              else {
                setMaking(false);
                setType(e.target.value as DeviceKindId);
              }
            }}
          >
            {allKinds(kinds).map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
            <option value="new">New kind…</option>
          </Select>
        )}
      </Field>
      {making ? (
        <div className="sm:col-span-2">
          <KindForm
            onMade={(id) => {
              setType(id);
              setMaking(false);
            }}
            onCancel={() => setMaking(false)}
          />
        </div>
      ) : null}
      <Field label="It's">
        {() => (
          <Segmented
            label="How it's treated"
            value={treatment}
            onChange={setTreatment}
            options={[
              { value: "person", label: "Someone's" },
              { value: "shared", label: "Shared" },
              { value: "always", label: "Part of the house" },
            ]}
          />
        )}
      </Field>
      {treatment === "person" ? (
        <Field
          label="Whose"
          hint={
            likely && !d
              ? "Guessed from who opened Hearth on it."
              : "A child's devices will follow that child's rules."
          }
        >
          {(id) => (
            <Select id={id} value={person} onChange={(e) => setPerson(e.target.value)}>
              <option value="">Nobody yet</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : treatment === "shared" ? (
        <Field
          label="Who uses it"
          hint="With a child among them, it follows the strictest of their rules, and its sites go in each child's history."
        >
          {() => (
            <div className="flex flex-wrap gap-1.5">
              {people.map((p) => {
                const on = sharedBy.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setSharedBy((x) => (on ? x.filter((y) => y !== p.id) : [...x, p.id]))
                    }
                    className={cx(
                      "rounded-full border px-3 py-1 text-[13px] font-semibold",
                      on ? "border-accent bg-accent/12 text-ink" : "border-line text-muted",
                    )}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
          )}
        </Field>
      ) : (
        <p className="self-end text-[12.5px] text-muted">
          Part of the house: never limited by the internet controls, and never asked for a guest
          pass. Smart plugs, TVs, cameras, printers, the NAS and the router.
        </p>
      )}
      <Field label="Addresses" hint="Its address on the network. Separate several with commas.">
        {(id) => <Input id={id} value={ips} onChange={(e) => setIps(e.target.value)} />}
      </Field>
      <Field
        label="Hardware addresses (MAC)"
        hint="Optional, from the router's device list. Phones should keep a fixed Wi-Fi address on this network."
      >
        {(id) => (
          <Input
            id={id}
            value={macs}
            placeholder="3c:22:fb:12:34:56"
            onChange={(e) => setMacs(e.target.value)}
          />
        )}
      </Field>
      <Field label="Notes" hint="Optional" className="sm:col-span-2">
        {(id) => (
          <Input id={id} value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} />
        )}
      </Field>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <Button variant="primary" type="submit" busy={busy}>
          {d ? "Save" : "Save this device"}
        </Button>
        {d ? (
          <Button variant="ghost" className="ml-auto text-bad" busy={busy} onClick={remove}>
            Forget it
          </Button>
        ) : null}
      </div>
      <div className="sm:col-span-2">
        <ErrorNote error={error} />
      </div>
    </form>
  );
}

export function AdGuardCard({ view }: { view: DevicesView }) {
  const qc = useQueryClient();
  const toast = useToast();
  const a = view.adguard;
  const [open, setOpen] = useState(!a.configured);
  const [url, setUrl] = useState(a.url ?? "");
  const [username, setUsername] = useState(a.username ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.put("/api/admin/adguard", {
        url: url.trim(),
        username: username.trim() || undefined,
        ...(password ? { password } : {}),
      });
      toast(url.trim() ? "AdGuard Home is connected" : "AdGuard Home is disconnected");
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
          <h2 className="text-lg font-bold">AdGuard Home</h2>
          <p className="mt-0.5 text-[13.5px] text-muted">
            {!a.configured
              ? "On the router, it sees every device's lookups, so Hearth can list them. Hearth reads from it, and writes its own rules once the internet controls are on."
              : a.ok
                ? `Connected, ${a.version ?? ""}${a.protection === false ? ", but its protection is paused" : ""}.`
                : (a.error ?? "Not reachable.")}
          </p>
        </div>
        {a.configured && !open ? (
          <Button size="sm" onClick={() => setOpen(true)}>
            Change
          </Button>
        ) : null}
      </div>
      {open ? (
        <form onSubmit={save} className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field
            label="Address"
            hint="Its own page: the router's address and port 3000, usually."
            className="sm:col-span-3"
          >
            {(id) => (
              <Input
                id={id}
                value={url}
                placeholder="http://192.168.1.1:3000"
                onChange={(e) => setUrl(e.target.value)}
              />
            )}
          </Field>
          <Field label="Username" hint="If it asks for one">
            {(id) => (
              <Input
                id={id}
                value={username}
                autoComplete="off"
                onChange={(e) => setUsername(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Password"
            hint={a.passwordSaved ? "Saved. Type a new one to replace it." : "Kept encrypted."}
            className="sm:col-span-2"
          >
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="new-password"
                value={password}
                placeholder={a.passwordSaved ? "••••••••" : ""}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-2 sm:col-span-3">
            <Button type="submit" variant="primary" busy={busy}>
              Check and save
            </Button>
            {a.configured ? (
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            ) : null}
          </div>
          <div className="sm:col-span-3">
            <ErrorNote error={error} />
          </div>
        </form>
      ) : null}
    </div>
  );
}

/** What happens to a device Hearth hasn't seen before. */
export function NewDevicesCard({ view }: { view: DevicesView }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [net, setNet] = useState("");
  const [error, setError] = useState<unknown>(null);
  const r = view.rules;
  const save = async (next: DevicesView["rules"], done?: string) => {
    setError(null);
    try {
      await api.put("/api/admin/devices/rules", next);
      if (done) toast(done);
      await qc.invalidateQueries({ queryKey: KEY });
      return true;
    } catch (err) {
      setError(err);
      return false;
    }
  };
  const add = async (n: string) => {
    const cidr = n.trim();
    if (!cidr || r.alwaysNetworks.includes(cidr)) return;
    if (
      await save(
        { ...r, alwaysNetworks: [...r.alwaysNetworks, cidr] },
        `Everything on ${cidr} is always allowed`,
      )
    )
      setNet("");
  };
  const offered = view.networks.filter((n) => !r.alwaysNetworks.includes(n));
  return (
    <div className="card grid gap-4 p-5">
      <div>
        <h2 className="text-lg font-bold">New devices</h2>
        <p className="mt-0.5 text-[13.5px] text-muted">
          What happens to a device Hearth hasn't seen before. A device that's saved as always
          allowed is never limited by the internet controls; you can still change it any time.
        </p>
      </div>
      <Segmented
        label="When a new device joins"
        value={r.newDevices}
        onChange={(newDevices) =>
          save(
            { ...r, newDevices },
            newDevices === "always"
              ? "New devices are saved as always allowed"
              : "New devices wait for you to set them up",
          )
        }
        options={[
          { value: "leave", label: "Leave it for me to set up" },
          { value: "always", label: "Save it as always allowed" },
        ]}
      />
      <p className="text-[12.5px] text-muted">
        {r.newDevices === "always"
          ? "Each new device is saved by itself, named from what it says it is. One that's opened Hearth as someone is left for you, since it's probably theirs."
          : "New devices show as Not set up until you say whose they are."}
      </p>
      <div className="grid gap-2">
        <span className="text-[14px] font-semibold">
          Networks where every device is always allowed
        </span>
        <p className="text-[12.5px] text-muted">
          A separate Wi-Fi for smart plugs, cameras and TVs, say. Devices on it are saved as always
          allowed by themselves, whatever's chosen above.
        </p>
        {r.alwaysNetworks.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {r.alwaysNetworks.map((n) => (
              <li
                key={n}
                className="flex items-center gap-1 rounded-full bg-(--c-surface-2) py-1 pr-1.5 pl-3 text-[12.5px] font-semibold"
              >
                {n}
                <button
                  type="button"
                  aria-label={`Stop always allowing ${n}`}
                  onClick={() =>
                    save({ ...r, alwaysNetworks: r.alwaysNetworks.filter((x) => x !== n) })
                  }
                  className="grid size-5 place-items-center rounded-full text-muted hover:text-ink"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add(net);
          }}
        >
          <Input
            aria-label="A network"
            placeholder="192.168.2.0/24"
            className="max-w-56"
            value={net}
            onChange={(e) => setNet(e.target.value)}
          />
          <Button type="submit" variant="secondary" disabled={!net.trim()}>
            Add
          </Button>
        </form>
        {offered.length ? (
          <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
            Networks seen:
            {offered.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => add(n)}
                className="rounded-full border border-line px-2.5 py-0.5 font-semibold hover:border-accent hover:text-ink"
              >
                {n}
              </button>
            ))}
          </p>
        ) : null}
      </div>
      <ErrorNote error={error} />
    </div>
  );
}

/** Make or change a kind of device: its name, its icon, and where it goes on the page. */
export function KindForm({
  kind,
  onMade,
  onCancel,
}: {
  kind?: Kinds[number];
  onMade: (id: DeviceKindId) => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [label, setLabel] = useState(kind?.label ?? "");
  const [icon, setIcon] = useState<string | undefined>(kind?.iconRef ?? "lucide:joystick");
  const [place, setPlace] = useState<Place>(kind?.place ?? "entertainment");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { label: label.trim(), icon: icon ?? "lucide:circle-help", place };
      let id: DeviceKindId;
      if (kind) {
        await api.put(`/api/admin/device-kinds/${kind.id}`, body);
        id = kind.id as DeviceKindId;
      } else id = (await api.post<{ id: DeviceKindId }>("/api/admin/device-kinds", body)).id;
      toast(kind ? "Saved" : `“${body.label}” is a kind of device now`);
      await qc.invalidateQueries({ queryKey: KEY });
      onMade(id);
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  };
  return (
    <div className="grid gap-3 rounded-xl border border-line p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          {(id) => (
            <Input
              id={id}
              value={label}
              maxLength={40}
              placeholder="Pinball table"
              onChange={(e) => setLabel(e.target.value)}
            />
          )}
        </Field>
        <Field label="Shows under">
          {(id) => (
            <Select id={id} value={place} onChange={(e) => setPlace(e.target.value as Place)}>
              {PLACES.map((x) => (
                <option key={x} value={x}>
                  {PLACE_NAMES[x]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Icon">
        {() => <IconPicker value={icon} onChange={setIcon} name={label || "device"} url="" />}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" type="button" busy={busy} disabled={!label.trim()} onClick={save}>
          {kind ? "Save" : "Make it"}
        </Button>
        <Button variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <ErrorNote error={error} />
    </div>
  );
}

/**
 * Setup: every kind of device, the built-in ones and the admin's own, each with its name, icon
 * and the part of the page it shows under. Built-in ones can be changed, reset or deleted (and
 * brought back); deleting any kind makes its devices "Not sure yet".
 */
export function KindsCard() {
  const kinds = useContext(KindsContext);
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const call = async (run: () => Promise<unknown>, done: string) => {
    try {
      await run();
      toast(done);
      await qc.invalidateQueries({ queryKey: KEY });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't do that.", "bad");
    }
  };
  /** A kind as the form edits it: the admin's version, or a built-in one as it comes. */
  const asKind = (id: string): Kinds[number] => {
    const own = ownKind(id, kinds);
    if (own) return own;
    const t = TYPE[id as DeviceType];
    return {
      id,
      label: t?.label ?? id,
      icon: t?.ref ?? "lucide:circle-help",
      iconRef: t?.ref ?? "lucide:circle-help",
      iconKind: "svg",
      place: t?.place ?? "unknown",
    } as Kinds[number];
  };
  const deleted = kinds.filter((k) => k.hidden);
  const list = allKinds(kinds);
  return (
    <div className="card grid gap-3 p-5 lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Kinds of device</h2>
          <p className="mt-0.5 text-[13.5px] text-muted">
            Every kind a device can be, with its icon and the part of the page it shows under.
            Change any of them, make your own (a pinball table, a weather station), or delete the
            ones you don't need.
          </p>
        </div>
        {editing ? null : (
          <Button size="sm" onClick={() => setEditing("new")}>
            New kind
          </Button>
        )}
      </div>
      {editing === "new" ? (
        <KindForm onMade={() => setEditing(null)} onCancel={() => setEditing(null)} />
      ) : null}
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {list.map((k) => {
          const kind = asKind(k.id);
          const changed = k.builtin && Boolean(ownKind(k.id, kinds));
          return editing === k.id ? (
            <li key={k.id} className="sm:col-span-2">
              <KindForm
                kind={kind}
                onMade={() => setEditing(null)}
                onCancel={() => setEditing(null)}
              />
            </li>
          ) : (
            <li
              key={k.id}
              className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-2"
            >
              <span className="grid size-8 flex-none place-items-center rounded-lg bg-accent/12 text-accent">
                <KindIcon type={k.id} className="size-4.5" />
              </span>
              <span className="grid min-w-0 grow">
                <span className="truncate font-semibold">{k.label}</span>
                <span className="truncate text-[12px] text-muted">
                  {PLACE_NAMES[kind.place]}
                  {k.builtin ? (changed ? " · changed" : " · built in") : " · your own"}
                </span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => setEditing(k.id)}>
                Change
              </Button>
              {changed ? (
                <Button
                  size="sm"
                  variant="ghost"
                  title="Back to its own name, icon and place"
                  onClick={() =>
                    call(
                      () => api.post(`/api/admin/device-kinds/${k.id}/restore`, {}),
                      `“${TYPE[k.id as DeviceType]?.label}” is as it came`,
                    )
                  }
                >
                  Reset
                </Button>
              ) : null}
              {k.id === "unknown" ? null : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-bad"
                  onClick={() =>
                    call(
                      () => api.del(`/api/admin/device-kinds/${k.id}`),
                      `“${k.label}” is gone; its devices are “Not sure yet”`,
                    )
                  }
                >
                  Delete
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {deleted.length ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
          Deleted:
          {deleted.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() =>
                call(
                  () => api.post(`/api/admin/device-kinds/${k.id}/restore`, {}),
                  `“${TYPE[k.id as DeviceType]?.label ?? k.label}” is back`,
                )
              }
              className="rounded-full border border-line px-2.5 py-0.5 font-semibold text-ink hover:border-accent"
              title="Bring it back"
            >
              {TYPE[k.id as DeviceType]?.label ?? k.label} ↺
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
