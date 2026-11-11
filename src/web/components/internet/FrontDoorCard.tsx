/**
 * Settings → Internet → Guest pass: on the family network, a device Hearth doesn't know gets no
 * internet until it's let in (the house password on the welcome page, or a parent).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DoorOpen, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { DevicesView } from "../../../shared/devices";
import type { DoorPatch, DoorView } from "../../../shared/internet";
import { api } from "../../lib/api";
import { keys } from "../../lib/queries";
import { Button, ErrorNote, Field, Input, Modal, Select, Toggle, useToast } from "../ui";

const KEY = ["admin-door"] as const;

const when = (iso: string) =>
  new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

export function FrontDoorCard({ adguard }: { adguard: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: KEY,
    queryFn: () => api.get<DoorView>("/api/admin/door"),
    refetchInterval: 30_000,
  });
  const devices = useQuery({
    queryKey: ["admin-devices"],
    queryFn: () => api.get<DevicesView>("/api/admin/devices"),
    staleTime: 60_000,
  });
  const [net, setNet] = useState("");
  const [password, setPassword] = useState("");
  const [welcome, setWelcome] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const v = q.data;
  useEffect(() => setWelcome(v?.door.welcomeAddress ?? ""), [v?.door.welcomeAddress]);
  if (!v) return q.error ? <ErrorNote error={q.error} /> : <div className="skeleton h-40" />;
  const door = v.door;

  const put = async (body: DoorPatch & { password?: string | null }, done?: string) => {
    setError(null);
    try {
      const r = await api.put<{ ok: true; letIn: number }>("/api/admin/door", body);
      await qc.invalidateQueries({ queryKey: KEY });
      await qc.invalidateQueries({ queryKey: keys.home });
      if (body.enabled && r.letIn)
        toast(
          `Guest passes are on. ${r.letIn} device${r.letIn === 1 ? " was" : "s were"} already here and got one.`,
        );
      else if (done) toast(done);
      return true;
    } catch (e) {
      setError(e);
      return false;
    }
  };
  const seen = (devices.data?.networks ?? []).filter((n) => !door.networks.includes(n));

  return (
    <div className="card grid gap-4 p-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <DoorOpen className="size-5 text-accent" /> Guest pass
        </h2>
        <p className="mt-0.5 text-[13.5px] text-muted">
          On the family network, a device Hearth doesn't know gets no internet until it has a guest
          pass: the house password on the welcome page (start.home/welcome), or a parent's OK from
          the Family page. Saved devices never need one, and the guest Wi-Fi is left alone. Set it
          all up first; nothing changes until you turn it on.
        </p>
      </div>

      <Toggle
        label="New devices need a guest pass"
        hint={
          door.enabled
            ? `${v.admitted.length} device${v.admitted.length === 1 ? "" : "s"} let in, ${v.visitors.length} waiting.`
            : !adguard
              ? "Connect AdGuard Home first, in Devices → Setup."
              : !door.networks.length
                ? "Say which network it guards first (below)."
                : "When it opens, every device already on the network is let in, so nobody is cut off."
        }
        checked={door.enabled}
        disabled={!adguard || (!door.enabled && !door.networks.length)}
        onChange={(on) => (on ? setConfirm(true) : put({ enabled: false }, "Guest passes are off"))}
      />

      <div className="grid gap-2">
        <span className="text-[14px] font-semibold">The family network that needs them</span>
        {door.networks.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {door.networks.map((n) => (
              <li
                key={n}
                className="flex items-center gap-1 rounded-full bg-(--c-surface-2) py-1 pr-1.5 pl-3 text-[12.5px] font-semibold"
              >
                {n}
                <button
                  type="button"
                  aria-label={`Stop asking for passes on ${n}`}
                  onClick={() => put({ networks: door.networks.filter((x) => x !== n) })}
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
          onSubmit={async (e) => {
            e.preventDefault();
            if (await put({ networks: [...door.networks, net.trim()] })) setNet("");
          }}
        >
          <Input
            aria-label="A network"
            placeholder="192.168.1.0/24"
            className="max-w-56"
            value={net}
            onChange={(e) => setNet(e.target.value)}
          />
          <Button type="submit" variant="secondary" disabled={!net.trim()}>
            Add
          </Button>
        </form>
        {seen.length ? (
          <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
            Networks seen:
            {seen.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => put({ networks: [...door.networks, n] })}
                className="rounded-full border border-line px-2.5 py-0.5 font-semibold hover:border-accent hover:text-ink"
              >
                {n}
              </button>
            ))}
          </p>
        ) : null}
      </div>

      <form
        className="grid gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await put({ password }, "The house password is saved")) setPassword("");
        }}
      >
        <Field
          label="House password"
          hint={
            v.passwordSet
              ? "Set. Type a new one to change it. Anyone who knows it can let a device in, so share it like the Wi-Fi password."
              : "Not set: only a parent can let devices in."
          }
        >
          {(id) => (
            <div className="flex flex-wrap gap-2">
              <Input
                id={id}
                type="password"
                autoComplete="new-password"
                className="max-w-64"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button type="submit" variant="secondary" disabled={password.trim().length < 4}>
                Save
              </Button>
              {v.passwordSet ? (
                <Button
                  variant="ghost"
                  onClick={() => put({ password: null }, "No house password")}
                >
                  Remove it
                </Button>
              ) : null}
            </div>
          )}
        </Field>
      </form>

      <Field label="A guest pass lasts">
        {(id) => (
          <Select
            id={id}
            className="max-w-64"
            value={door.stayDays}
            onChange={(e) => put({ stayDays: Number(e.target.value) })}
          >
            <option value={0}>Until someone removes it</option>
            <option value={1}>For a day</option>
            <option value={7}>For a week</option>
            <option value={30}>For a month</option>
          </Select>
        )}
      </Field>

      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void put({ welcomeAddress: welcome.trim() || null }, "Saved");
        }}
      >
        <Field
          label="Open the welcome page by itself (optional)"
          hint="Hearth's address on port 80 (the NAS's, like 192.168.1.20). A stopped phone's &quot;is there internet?&quot; check goes there, so its &quot;Sign in to network&quot; page opens by itself. Needs the NAS's web server to pass those names to Hearth; see the guide."
        >
          {(id) => (
            <div className="flex flex-wrap gap-2">
              <Input
                id={id}
                placeholder="192.168.1.20"
                className="max-w-56"
                value={welcome}
                onChange={(e) => setWelcome(e.target.value)}
              />
              <Button
                type="submit"
                variant="secondary"
                disabled={welcome === (door.welcomeAddress ?? "")}
              >
                Save
              </Button>
            </div>
          )}
        </Field>
      </form>

      {v.admitted.length ? (
        <details className="rounded-xl border border-line px-3 py-2">
          <summary className="cursor-pointer text-[13px] font-semibold">
            With a guest pass ({v.admitted.length})
          </summary>
          <p className="mt-2 text-[12.5px] text-muted">
            Devices with a guest pass that aren't saved. Saving one on the Devices page keeps it
            known for good.
          </p>
          <ul className="mt-2 grid gap-1">
            {v.admitted.map((a) => (
              <li key={a.ip} className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="grow">
                  <b>{a.name ?? a.ip}</b>{" "}
                  <span className="text-muted">
                    {a.name ? `${a.ip} · ` : ""}
                    {a.by === "start"
                      ? "was here when guest passes started"
                      : a.by === "password"
                        ? `house password, ${when(a.at)}`
                        : `let in ${when(a.at)}`}
                    {a.until ? ` · until ${when(a.until)}` : ""}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`Take ${a.name ?? a.ip} out`}
                  onClick={() =>
                    api
                      .del(`/api/admin/door/admitted/${a.ip}`)
                      .then(() => qc.invalidateQueries({ queryKey: KEY }))
                  }
                  className="grid size-7 place-items-center rounded-full text-muted hover:text-bad"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <ErrorNote error={error} />

      {confirm ? (
        <Modal
          open
          onClose={() => setConfirm(false)}
          title="Turn on guest passes?"
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={async () => {
                  if (await put({ enabled: true })) setConfirm(false);
                }}
              >
                Turn it on
              </Button>
            </>
          }
        >
          <div className="grid gap-3 text-[14px]">
            <p>
              Every device already on {door.networks.join(", ")} is let in now, and this one too, so
              nobody is cut off. From then on, a new device on the family network has no internet
              until it gets a guest pass.
            </p>
            <p className="text-muted">
              If something goes wrong, turn it off here: its rules come out of AdGuard Home within a
              second.
            </p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
