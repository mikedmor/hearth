/**
 * Access on the Devices page: every app Hearth found on the network, whether it can read it, and
 * a button to give it a sign-in (an API key, a user and password, a token), checked before it's
 * kept. Widgets and the designer then read the app through Hearth, with no key of their own.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, KeyRound, LockKeyhole, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import type { AccessItem, AuthWay } from "../../../shared/access";
import { api } from "../../lib/api";
import { cx } from "../../lib/format";
import { SvgIcon } from "../Tile";
import { Button, ErrorNote, Field, Input, Modal, Segmented, useToast } from "../ui";

export function useAccess() {
  return useQuery({
    queryKey: ["access"],
    queryFn: () => api.get<{ items: AccessItem[] }>("/api/admin/access"),
    staleTime: 30_000,
  });
}

/** The access for a service's address, if Hearth knows the app there. */
export function accessForUrl(items: AccessItem[] | undefined, url?: string) {
  if (!items || !url) return undefined;
  try {
    const origin = new URL(url).origin;
    return items.find((i) => i.base === origin);
  } catch {
    return undefined;
  }
}

const STATUS: Record<AccessItem["status"], { text: string; tone: string }> = {
  connected: { text: "Hearth can read it", tone: "text-good" },
  needed: { text: "Needs a sign-in", tone: "text-warn" },
  open: { text: "No sign-in needed", tone: "text-muted" },
  settings: { text: "Connect it in Setup", tone: "text-warn" },
};

const host = (base: string) => {
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
};

function AppIcon({ item }: { item: AccessItem }) {
  return (
    <span className="grid size-9 flex-none place-items-center rounded-lg bg-(--c-surface-2) text-ink">
      {item.svg ? <SvgIcon svg={item.svg} className="size-5" /> : <KeyRound className="size-4.5" />}
    </span>
  );
}

/** The Services tab: every service Hearth knows on the network, with what it can read. */
export function AccessCard() {
  const q = useAccess();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState<AccessItem | null>(null);
  const [adding, setAdding] = useState(false);
  const items = q.data?.items ?? [];
  const needed = items.filter((i) => i.status === "needed" || i.status === "settings").length;
  const remove = async (i: AccessItem) => {
    try {
      await api.del(
        `/api/admin/services?app=${encodeURIComponent(i.app)}&url=${encodeURIComponent(i.base)}`,
      );
      toast(`${i.name} is off the list`);
      await qc.invalidateQueries({ queryKey: ["access"] });
    } catch (e) {
      toast((e as Error).message, "bad");
    }
  };
  return (
    <section className="card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-bold">
            <ShieldCheck className="size-4.5 text-accent" /> Services on your network
          </h2>
          <p className="text-[13px] text-muted">
            What Hearth can read, for widgets and the designer. A sign-in given here stays on
            Hearth: widgets use it without ever holding the key.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {items.length ? (
            <span className={cx("text-[13px] font-semibold", needed ? "text-warn" : "text-good")}>
              {needed
                ? `${needed} need${needed === 1 ? "s" : ""} access`
                : "Hearth can read them all"}
            </span>
          ) : null}
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add a service
          </Button>
        </div>
      </div>
      {q.error ? <ErrorNote error={q.error} /> : null}
      {!q.data ? (
        <div className="skeleton h-24" />
      ) : !items.length ? (
        <p className="text-[13.5px] text-muted">
          No services Hearth knows yet. Links to an app, services the port checks find, and ones you
          add here show up.
        </p>
      ) : (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {items.map((i) => (
            <li
              key={i.key}
              className="flex items-center gap-3 rounded-xl border border-line px-3 py-2"
            >
              <AppIcon item={i} />
              <span className="grid min-w-0 grow">
                <span className="truncate text-[14px] font-semibold">{i.name}</span>
                <span className="truncate text-[12px] text-muted">
                  <span className={STATUS[i.status].tone}>{STATUS[i.status].text}</span>
                  {" · "}
                  {host(i.base)}
                  {i.manual ? " · added by hand" : ""}
                </span>
              </span>
              {i.status === "open" ? null : (
                <Button
                  size="sm"
                  variant={i.status === "needed" ? "primary" : "secondary"}
                  onClick={() => setOpen(i)}
                >
                  {i.status === "needed" ? (
                    <>
                      <LockKeyhole className="size-4" /> Give access
                    </>
                  ) : (
                    "Change"
                  )}
                </Button>
              )}
              {i.manual ? (
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label={`Take ${i.name} off the list`}
                  title="Take it off the list"
                  className="grid size-8 flex-none place-items-center rounded-lg text-muted hover:bg-(--c-surface-2) hover:text-bad"
                >
                  <Trash2 className="size-4" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {open ? <AccessDialog item={open} onClose={() => setOpen(null)} /> : null}
      {adding ? <AddService onClose={() => setAdding(false)} /> : null}
    </section>
  );
}

interface CatalogApp {
  id: string;
  name: string;
  category: string;
  description?: string;
  svg?: AccessItem["svg"];
}

/** Every app Hearth knows, to search by name, kind or what it does, with its logo. */
function AppPicker({
  apps,
  value,
  onChange,
  id,
}: {
  apps: CatalogApp[];
  value: string;
  onChange: (id: string) => void;
  id: string;
}) {
  const [q, setQ] = useState("");
  const picked = apps.find((a) => a.id === value);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = apps
    .filter((a) =>
      words.every((w) =>
        `${a.name} ${a.category} ${a.description ?? ""}`.toLowerCase().includes(w),
      ),
    )
    .slice(0, 60);
  return (
    <div className="grid gap-1.5">
      {picked ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-accent bg-accent/8 px-3 py-2">
          <span className="grid size-8 flex-none place-items-center rounded-lg bg-(--c-surface-2)">
            {picked.svg ? <SvgIcon svg={picked.svg} className="size-5" /> : null}
          </span>
          <span className="grid min-w-0 grow">
            <span className="truncate text-[14px] font-semibold">{picked.name}</span>
            <span className="truncate text-[12px] text-muted">{picked.category}</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => onChange("")}>
            Change
          </Button>
        </div>
      ) : (
        <>
          <Input
            id={id}
            value={q}
            placeholder={`Search ${apps.length} apps: name, or what it does (printer, media…)`}
            onChange={(e) => setQ(e.target.value)}
          />
          <ul className="grid max-h-64 gap-0.5 overflow-y-auto rounded-xl border border-line p-1">
            {shown.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => onChange(a.id)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-(--c-surface-2)"
                >
                  <span className="grid size-7 flex-none place-items-center rounded-md bg-(--c-surface-2)">
                    {a.svg ? <SvgIcon svg={a.svg} className="size-4.5" /> : null}
                  </span>
                  <span className="grid min-w-0 grow">
                    <span className="truncate text-[13.5px] font-semibold">{a.name}</span>
                    <span className="truncate text-[11.5px] text-muted">
                      {a.category}
                      {a.description ? ` · ${a.description}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {shown.length ? null : (
              <li className="px-2 py-2 text-[13px] text-muted">No app called that.</li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * Add a service by hand: its address (Hearth looks at it to say which app it is) and the app,
 * picked from the ones Hearth knows.
 */
function AddService({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const catalog = useQuery({
    queryKey: ["catalog"],
    queryFn: () => api.get<{ apps: CatalogApp[] }>("/api/admin/catalog"),
  });
  const [url, setUrl] = useState("http://");
  const [app, setApp] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<"look" | "save" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const valid = /^https?:\/\/[^/\s]+/.test(url.trim());
  const apps = [...(catalog.data?.apps ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  const look = async () => {
    setBusy("look");
    setError(null);
    try {
      const r = await api.post<{
        reachable: boolean;
        title: string;
        app: { id: string; name: string } | null;
      }>("/api/admin/recognize", { url: url.trim() });
      if (r.app) {
        setApp(r.app.id);
        setNote(`It's ${r.app.name}.`);
      } else
        setNote(
          r.reachable
            ? `It answered${r.title ? ` ("${r.title}")` : ""}, but Hearth doesn't know which app it is: pick it below.`
            : "Hearth couldn't reach it. Check the address and port, or pick the app anyway.",
        );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      await api.post("/api/admin/services", {
        app,
        url: url.trim(),
        name: name.trim() || undefined,
      });
      toast("Added. Give Hearth access if it needs a sign-in.");
      await qc.invalidateQueries({ queryKey: ["access"] });
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add a service"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} busy={busy === "save"} disabled={!valid || !app}>
            <Check className="size-4" /> Add it
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <p className="text-[13.5px] text-muted">
          For a service the port checks didn't find (an unusual port, or a device that was off).
        </p>
        <Field label="Where it is" hint="Its address and port, like http://192.168.1.30:8989">
          {(id) => (
            <div className="flex gap-2">
              <Input
                id={id}
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setNote(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && valid) void look();
                }}
              />
              <Button onClick={look} busy={busy === "look"} disabled={!valid}>
                What is it?
              </Button>
            </div>
          )}
        </Field>
        {note ? <p className="text-[13px] font-semibold">{note}</p> : null}
        <Field label="Which app">
          {(id) => <AppPicker id={id} apps={apps} value={app} onChange={setApp} />}
        </Field>
        <Field label="Name (if you like)">
          {(id) => (
            <Input
              id={id}
              value={name}
              maxLength={60}
              placeholder={apps.find((a) => a.id === app)?.name ?? "Sonarr"}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}

/** A small "Give access" next to a service whose app needs a sign-in. */
export function AccessButton({ item }: { item: AccessItem }) {
  const [open, setOpen] = useState(false);
  if (item.status === "open") return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={
          item.status === "connected"
            ? "Hearth can read it: change its access"
            : "Give Hearth access"
        }
        className={cx(
          "grid size-8 flex-none place-items-center rounded-lg hover:bg-(--c-surface-2)",
          item.status === "connected" ? "text-good" : "text-warn",
        )}
        aria-label={
          item.status === "connected" ? `Access to ${item.name}` : `Give access to ${item.name}`
        }
      >
        {item.status === "connected" ? (
          <ShieldCheck className="size-4" />
        ) : (
          <LockKeyhole className="size-4" />
        )}
      </button>
      {open ? <AccessDialog item={item} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const wayKey = (w: AuthWay) => `${w.kind}:${w.header ?? w.param ?? ""}`;
const KIND_NAME: Record<AuthWay["kind"], string> = {
  header: "API key",
  bearer: "Token",
  basic: "User and password",
  digest: "User and password",
  query: "API key",
};

function AccessDialog({ item, onClose }: { item: AccessItem; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const savedWay = item.access
    ? item.ways.find(
        (w) =>
          w.kind === item.access?.kind &&
          (w.header ?? "") === (item.access?.header ?? w.header ?? "") &&
          (w.param ?? "") === (item.access?.param ?? w.param ?? ""),
      )
    : undefined;
  const [way, setWay] = useState(wayKey(savedWay ?? (item.ways[0] as AuthWay)));
  const w = item.ways.find((x) => wayKey(x) === way) ?? (item.ways[0] as AuthWay);
  const pair = w.kind === "basic" || w.kind === "digest";
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [key, setKey] = useState("");
  const [result, setResult] = useState<{ ok: boolean; note: string } | null>(null);
  const [busy, setBusy] = useState<"check" | "save" | "remove" | null>(null);
  const [error, setError] = useState<unknown>(null);

  const secret = pair ? (user || pass ? `${user}:${pass}` : "") : key;
  const payload = () => ({
    app: item.app,
    base: item.base,
    kind: w.kind,
    header: w.header,
    param: w.param,
    secret: secret || undefined,
  });
  const run = async (what: "check" | "save" | "remove") => {
    setBusy(what);
    setError(null);
    try {
      if (what === "check")
        setResult(
          await api.post<{ ok: boolean; note: string }>("/api/admin/access/check", payload()),
        );
      else if (what === "save") {
        if (item.setup === "adguard")
          await api.put("/api/admin/adguard", {
            url: item.base,
            username: user,
            password: pass,
          });
        else if (item.setup)
          await api.put(`/api/admin/smarthome/${item.setup}`, { url: item.base, token: key });
        else await api.put("/api/admin/access", payload());
        toast(`Hearth can read ${item.appName} now.`);
        await qc.invalidateQueries();
        onClose();
      } else if (item.access) {
        await api.del(`/api/admin/access/${encodeURIComponent(item.access.id)}`);
        toast(`Hearth forgot its access to ${item.appName}.`);
        await qc.invalidateQueries();
        onClose();
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Access to ${item.name}`}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          {item.access ? (
            <Button
              variant="danger"
              size="sm"
              onClick={() => run("remove")}
              busy={busy === "remove"}
            >
              <Trash2 className="size-4" /> Forget it
            </Button>
          ) : null}
          <span className="grow" />
          <Button
            onClick={() => run("check")}
            busy={busy === "check"}
            disabled={!secret && !item.access}
          >
            Check
          </Button>
          <Button
            variant="primary"
            onClick={() => run("save")}
            busy={busy === "save"}
            disabled={!secret && !item.access}
          >
            <Check className="size-4" /> Save
          </Button>
        </div>
      }
    >
      <div className="grid gap-3">
        <p className="text-[13.5px] text-muted">
          {item.appName} at <b className="text-ink">{host(item.base)}</b>. Hearth keeps the sign-in
          encrypted, uses it only to read, and never shows it again.
        </p>
        {item.ways.length > 1 ? (
          <Segmented
            label="How to sign in"
            value={way}
            onChange={(v) => {
              setWay(v);
              setResult(null);
            }}
            options={item.ways.map((x) => ({
              value: wayKey(x),
              label: x.label || KIND_NAME[x.kind],
            }))}
          />
        ) : null}
        {w.hint ? <p className="text-[12.5px] text-muted">{w.hint}</p> : null}
        {pair ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="User name">
              {(id) => (
                <Input
                  id={id}
                  value={user}
                  autoComplete="off"
                  onChange={(e) => setUser(e.target.value)}
                />
              )}
            </Field>
            <Field label="Password">
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  value={pass}
                  autoComplete="new-password"
                  onChange={(e) => setPass(e.target.value)}
                />
              )}
            </Field>
          </div>
        ) : (
          <Field
            label={w.label || KIND_NAME[w.kind]}
            hint={
              w.kind === "header"
                ? `Sent as the ${w.header} header.`
                : w.kind === "query"
                  ? `Added to the address as ${w.param}=….`
                  : "Sent as a bearer token."
            }
          >
            {(id) => (
              <Input
                id={id}
                type="password"
                value={key}
                autoComplete="new-password"
                onChange={(e) => setKey(e.target.value)}
              />
            )}
          </Field>
        )}
        {item.access && !secret ? (
          <p className="text-[12.5px] text-muted">
            Saved {item.access.at ? new Date(item.access.at).toLocaleDateString() : ""}. Leave it
            empty and press Check to try the saved one.
          </p>
        ) : null}
        {result ? (
          <p className={cx("text-[13px] font-semibold", result.ok ? "text-good" : "text-bad")}>
            {result.ok ? "It worked. " : "That didn't work. "}
            <span className="font-normal">{result.note}</span>
          </p>
        ) : null}
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}
