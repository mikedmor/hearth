/** Setup: more machines to read, like a mesh access point or a computer running Glances. */
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { MachineKind, MachineSetup, Resources } from "../../../shared/resources";
import { api } from "../../lib/api";
import { cx } from "../../lib/format";
import { Button, ErrorNote, Field, Input, Select, useToast } from "../ui";
import { RESOURCES_KEY, useResources } from "./Resources";

const KIND_NAMES: Record<MachineKind, string> = {
  glinet: "GL.iNet access point",
  glances: "Computer running Glances",
};

const pct = (used?: number, total?: number) =>
  used !== undefined && total ? Math.round((100 * used) / total) : undefined;

export function MachinesCard() {
  const { data } = useResources();
  const list = data?.setup.machines ?? [];
  const [editing, setEditing] = useState<string | null>(null);
  const reading = (id: string) => data?.machines?.find((r) => r.key === `m:${id}`);
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Other machines</h2>
          <p className="mt-0.5 text-[13.5px] text-muted">
            How more of the home's machines are doing. A GL.iNet access point (a mesh node) is read
            through its own admin page, with its admin password. A computer is read through{" "}
            <a
              className="font-semibold text-accent"
              href="https://nicolargo.github.io/glances/"
              target="_blank"
              rel="noreferrer"
            >
              Glances
            </a>{" "}
            running in web mode (<code>glances -w</code>), on port 61208.
          </p>
        </div>
        {editing === null ? (
          <Button size="sm" onClick={() => setEditing("new")}>
            Add a machine
          </Button>
        ) : null}
      </div>
      {list.length ? (
        <ul className="mt-4 grid gap-2">
          {list.map((m) =>
            editing === m.id ? (
              <li key={m.id}>
                <MachineForm m={m} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-(--c-surface-2) px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="font-semibold">{m.name}</span>
                  <span className="ml-2 text-[12.5px] text-muted">
                    {KIND_NAMES[m.kind]} · {m.url}
                  </span>
                  <MachineState r={reading(m.id)} />
                </span>
                <Button size="sm" variant="ghost" onClick={() => setEditing(m.id)}>
                  Change
                </Button>
              </li>
            ),
          )}
        </ul>
      ) : null}
      {editing === "new" ? (
        <div className="mt-4">
          <MachineForm onDone={() => setEditing(null)} />
        </div>
      ) : null}
    </div>
  );
}

function MachineState({ r }: { r?: Resources }) {
  if (!r) return <span className="block text-[12.5px] text-muted">Reading it…</span>;
  if (!r.ok) return <span className="block text-[12.5px] text-bad">{r.error}</span>;
  const mem = pct(r.memUsed, r.memTotal);
  const bits = [
    r.model,
    r.cpu !== undefined
      ? `processor ${Math.round(r.cpu)}%`
      : r.load
        ? `load ${r.load[0].toFixed(2)}`
        : null,
    mem !== undefined ? `memory ${mem}%` : null,
    r.temp !== undefined ? `${r.temp} °C` : null,
  ].filter(Boolean);
  return (
    <span className={cx("block text-[12.5px]", r.problems.length ? "text-warn" : "text-good")}>
      {r.problems.length ? r.problems.join(" ") : bits.join(" · ") || "All good."}
    </span>
  );
}

function MachineForm({ m, onDone }: { m?: MachineSetup; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<MachineKind>(m?.kind ?? "glinet");
  const [name, setName] = useState(m?.name ?? "");
  const [url, setUrl] = useState(m?.url ?? "");
  const [user, setUser] = useState(m?.user ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const finish = async (msg: string) => {
    toast(msg);
    await qc.invalidateQueries({ queryKey: RESOURCES_KEY });
    onDone();
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.put(`/api/admin/machines/${m ? encodeURIComponent(m.id) : "new"}`, {
        kind,
        name: name.trim(),
        url: url.trim(),
        user: kind === "glances" ? user.trim() || undefined : undefined,
        ...(password ? { password } : {}),
      });
      await finish(`${name.trim()} is connected`);
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  };
  const remove = async () => {
    if (!m) return;
    setBusy(true);
    try {
      await api.del(`/api/admin/machines/${encodeURIComponent(m.id)}`);
      await finish(`${m.name} is taken off`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-2">
      <Field label="What it is">
        {(id) => (
          <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as MachineKind)}>
            <option value="glinet">{KIND_NAMES.glinet}</option>
            <option value="glances">{KIND_NAMES.glances}</option>
          </Select>
        )}
      </Field>
      <Field label="Name">
        {(id) => (
          <Input
            id={id}
            value={name}
            required
            maxLength={60}
            placeholder={kind === "glinet" ? "Upstairs access point" : "Sam's PC"}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      <Field
        label="Address"
        hint={
          kind === "glinet"
            ? "Its admin page, like http://192.168.1.2"
            : "Like 192.168.1.30 (port 61208 unless you give another)"
        }
      >
        {(id) => (
          <Input
            id={id}
            value={url}
            required
            placeholder={kind === "glinet" ? "http://192.168.1.2" : "192.168.1.30"}
            onChange={(e) => setUrl(e.target.value)}
          />
        )}
      </Field>
      {kind === "glances" ? (
        <Field label="User" hint="Only if Glances asks for a password (glances by default)">
          {(id) => (
            <Input
              id={id}
              value={user}
              autoComplete="off"
              placeholder="glances"
              onChange={(e) => setUser(e.target.value)}
            />
          )}
        </Field>
      ) : null}
      <Field
        label={kind === "glinet" ? "Admin password" : "Password"}
        hint={
          m?.secretSaved
            ? "Saved. Type a new one to replace it."
            : kind === "glinet"
              ? "The one its admin page asks for. Kept encrypted."
              : "Leave empty if Glances has none."
        }
      >
        {(id) => (
          <Input
            id={id}
            type="password"
            autoComplete="new-password"
            value={password}
            placeholder={m?.secretSaved ? "••••••••" : ""}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button type="submit" variant="primary" busy={busy}>
          Check and save
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {m ? (
          <Button variant="ghost" onClick={remove} disabled={busy}>
            Take it off
          </Button>
        ) : null}
      </div>
      <div className="sm:col-span-2">
        <ErrorNote error={error} />
      </div>
    </form>
  );
}
