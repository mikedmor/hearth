/** Settings (admin): the house's shared things, in plain forms. */
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Access } from "../../shared/api";
import type { AiServer, Group, HearthConfig, Profile, Role } from "../../shared/config";
import { BUILTIN_THEMES, THEME_KEYS, THEME_LABELS, type Theme } from "../../shared/themes";
import { CalendarAdminPanel } from "../components/calendar/AdminPanel";
import { RefIcon } from "../components/IconPicker";
import { Avatar } from "../components/Picker";
import { AccessBadge, type EditContext, LinkForm, SectionForm } from "../components/TileEditors";
import {
  Button,
  ErrorNote,
  Field,
  IconButton,
  Input,
  Modal,
  Select,
  TextArea,
  Toggle,
  useToast,
} from "../components/ui";
import { api } from "../lib/api";
import { cx, slugify } from "../lib/format";
import { type AdminConfig, keys, useAdminConfig, useHome } from "../lib/queries";

const TABS = [
  ["general", "General"],
  ["tiles", "Links"],
  ["groups", "Sections"],
  ["profiles", "People"],
  ["calendars", "Calendars"],
  ["ai", "AI"],
  ["secrets", "Secrets"],
  ["themes", "Themes"],
  ["advanced", "Advanced"],
] as const;

function useAct() {
  const qc = useQueryClient();
  const toast = useToast();
  return async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) toast(done);
      await qc.invalidateQueries();
      return true;
    } catch (e) {
      toast((e as Error).message, "bad");
      return false;
    }
  };
}

export function SettingsPage() {
  const { data: view } = useHome();
  const admin = useAdminConfig(Boolean(view?.session.admin));
  const { tab = "general" } = useSearch({ from: "/settings" });
  const navigate = useNavigate();
  if (view && !view.session.admin)
    return (
      <main className="shell py-16 text-center text-muted">
        Sign in as the admin to change settings.
      </main>
    );
  if (!admin.data) return null;
  const a = admin.data;
  return (
    <main className="shell grid gap-6 pt-6 pb-16 md:grid-cols-[200px_1fr]">
      <nav aria-label="Settings" className="flex gap-1 overflow-x-auto md:flex-col">
        <h1 className="mb-2 hidden font-heading text-2xl font-bold md:block">Settings</h1>
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => navigate({ to: "/settings", search: { tab: key } })}
            className={cx(
              "rounded-xl px-3 py-2 text-left text-[14px] font-semibold whitespace-nowrap",
              tab === key ? "bg-surface text-ink ring-1 ring-line" : "text-muted hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </nav>
      <section className="min-w-0">
        {tab === "general" ? <General a={a} /> : null}
        {tab === "tiles" ? <Tiles cfg={a.config} /> : null}
        {tab === "groups" ? <Groups cfg={a.config} /> : null}
        {tab === "profiles" ? <People a={a} /> : null}
        {tab === "calendars" ? <CalendarAdminPanel /> : null}
        {tab === "ai" ? <Ai a={a} /> : null}
        {tab === "secrets" ? <Secrets a={a} /> : null}
        {tab === "themes" ? <Themes cfg={a.config} /> : null}
        {tab === "advanced" ? <Advanced cfg={a.config} /> : null}
      </section>
    </main>
  );
}

function Panel({
  title,
  intro,
  children,
  action,
}: {
  title: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="card mb-5 p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          {intro ? <p className="mt-0.5 text-[13.5px] text-muted">{intro}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------

function General({ a }: { a: AdminConfig }) {
  const act = useAct();
  const [s, setS] = useState(a.config.settings);
  useEffect(() => setS(a.config.settings), [a.config.settings]);
  const [pw, setPw] = useState("");
  return (
    <>
      <Panel title="The home">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Page title">
            {(id) => (
              <Input
                id={id}
                value={s.title}
                onChange={(e) => setS({ ...s, title: e.target.value })}
              />
            )}
          </Field>
          <Field label="Home's name" hint="Shown under the greeting.">
            {(id) => (
              <Input
                id={id}
                value={s.homeName ?? ""}
                onChange={(e) => setS({ ...s, homeName: e.target.value || undefined })}
              />
            )}
          </Field>
          <Field label="Number and date style" hint="Like en-US or en-GB.">
            {(id) => (
              <Input
                id={id}
                value={s.locale}
                onChange={(e) => setS({ ...s, locale: e.target.value })}
              />
            )}
          </Field>
          <Field label="Time zone" hint="Like America/New_York. Empty: the NAS's.">
            {(id) => (
              <Input
                id={id}
                value={s.timeZone ?? ""}
                onChange={(e) => setS({ ...s, timeZone: e.target.value || undefined })}
              />
            )}
          </Field>
        </div>
      </Panel>
      <Panel title="Network" intro="What Hearth itself may call.">
        <Toggle
          label="Let widgets reach the internet"
          hint="Off: widget sources and the designer only reach the home network (.home, .local, private addresses). Turn on for weather or public APIs."
          checked={s.network.allowInternet}
          onChange={(v) => setS({ ...s, network: { allowInternet: v } })}
        />
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Check services every (s)">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={10}
                value={s.status.intervalSeconds}
                onChange={(e) =>
                  setS({ ...s, status: { ...s.status, intervalSeconds: Number(e.target.value) } })
                }
              />
            )}
          </Field>
          <Field label="Give up after (ms)">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={500}
                value={s.status.timeoutMs}
                onChange={(e) =>
                  setS({ ...s, status: { ...s.status, timeoutMs: Number(e.target.value) } })
                }
              />
            )}
          </Field>
          <Field label="Slow above (ms)">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={100}
                value={s.status.slowMs}
                onChange={(e) =>
                  setS({ ...s, status: { ...s.status, slowMs: Number(e.target.value) } })
                }
              />
            )}
          </Field>
        </div>
      </Panel>
      <div className="mb-5 flex justify-end">
        <Button
          variant="primary"
          onClick={() => act(() => api.put("/api/admin/settings", s), "Settings saved")}
        >
          Save settings
        </Button>
      </div>
      <Panel title="Admin password">
        <div className="flex flex-wrap items-end gap-2">
          <Field
            label="New password"
            hint="At least 8 characters. Other devices signed in as admin are signed out."
            className="grow"
          >
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="new-password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
              />
            )}
          </Field>
          <Button
            disabled={pw.length < 8}
            onClick={async () =>
              (await act(
                () => api.post("/api/admin/password", { password: pw }),
                "Password changed",
              )) && setPw("")
            }
          >
            Change
          </Button>
        </div>
        {a.keyInDataDir ? (
          <p className="mt-4 rounded-xl bg-warn/10 p-3 text-[13px]">
            <b>Tip:</b> secrets are encrypted with a key kept in Hearth's data folder, so a backup
            of that folder holds both. Set <code>HEARTH_SECRET_KEY</code> in the container's
            environment to keep them apart.
          </p>
        ) : null}
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------

function useOrder(collection: string) {
  const act = useAct();
  return (ids: string[], i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[i], next[j]] = [next[j] as string, next[i] as string];
    void act(() => api.put(`/api/admin/order/${collection}`, { ids: next }));
  };
}

/** The forms' view of the house, from the admin's config: the house's sections and the admin's own. */
function useEditContext(cfg: HearthConfig): EditContext {
  const home = useHome();
  const me = home.data?.profile?.id ?? null;
  return {
    admin: true,
    me,
    sections: cfg.groups
      .filter((g) => !g.owner || g.owner === me)
      .map((g) => ({
        id: g.id,
        name: g.name,
        access: g.owner
          ? { kind: "mine" as const }
          : g.people?.length
            ? { kind: "people" as const, people: g.people }
            : { kind: "audience" as const, audience: g.audience },
        canAdd: true,
        count: cfg.tiles.filter((t) => t.group === g.id).length,
      })),
    people: home.data?.profiles ?? [],
  };
}

const accessOf = (x: Pick<Group, "audience" | "people" | "owner">): Access =>
  x.owner
    ? { kind: "mine" }
    : x.people?.length
      ? { kind: "people", people: x.people }
      : { kind: "audience", audience: x.audience };

function Tiles({ cfg }: { cfg: HearthConfig }) {
  const move = useOrder("tiles");
  const ctx = useEditContext(cfg);
  const people = ctx.people;
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  // People's own links are theirs: only the admin's own appear here.
  const tiles = cfg.tiles.filter((t) => !t.owner || t.owner === ctx.me);
  const ids = cfg.tiles.map((t) => t.id);
  return (
    <Panel
      title="Links"
      intro={
        <>
          Every service and bookmark on the start page. People star, hide and arrange them on their
          own page, and keep their own links, which only they see. To bring in Heimdall's list, run{" "}
          <code>npm run import:heimdall</code>.
        </>
      }
      action={
        <Button variant="primary" onClick={() => setEditing({ id: null })}>
          <Plus className="size-4" /> Add a link
        </Button>
      }
    >
      <ul className="divide-y divide-line">
        {tiles.map((t) => {
          const i = ids.indexOf(t.id);
          return (
            <li key={t.id} className="flex items-center gap-3 py-2.5">
              <RefIcon name={t.name} icon={t.icon} color={t.color} />
              <div className="min-w-0 grow">
                <p className="flex items-center gap-2 truncate font-semibold">
                  {t.name} <AccessBadge access={accessOf(t)} people={people} />
                </p>
                <p className="truncate text-[12.5px] text-muted">
                  {t.url} · {cfg.groups.find((g) => g.id === t.group)?.name}
                </p>
              </div>
              <IconButton label="Move up" onClick={() => move(ids, i, -1)} disabled={i === 0}>
                <ArrowUp className="size-4" />
              </IconButton>
              <IconButton
                label="Move down"
                onClick={() => move(ids, i, 1)}
                disabled={i === ids.length - 1}
              >
                <ArrowDown className="size-4" />
              </IconButton>
              <IconButton label="Edit" onClick={() => setEditing({ id: t.id })}>
                <Pencil className="size-4" />
              </IconButton>
            </li>
          );
        })}
      </ul>
      {editing ? <LinkForm id={editing.id} ctx={ctx} onClose={() => setEditing(null)} /> : null}
    </Panel>
  );
}

// ---------------------------------------------------------------------------

function Groups({ cfg }: { cfg: HearthConfig }) {
  const move = useOrder("groups");
  const ctx = useEditContext(cfg);
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const ids = cfg.groups.map((g) => g.id);
  return (
    <Panel
      title="Sections"
      intro="Links are shown in these sections, in this order unless someone drags their own. Each section can be for everyone, adults, only the admin, or only some people. People's own sections aren't listed."
      action={
        <Button variant="primary" onClick={() => setEditing({ id: null })}>
          <Plus className="size-4" /> Add a section
        </Button>
      }
    >
      <ul className="divide-y divide-line">
        {ctx.sections.map((s) => {
          const i = ids.indexOf(s.id);
          return (
            <li key={s.id} className="flex items-center gap-3 py-2.5">
              <div className="grow">
                <p className="flex items-center gap-2 font-semibold">
                  {s.name} <AccessBadge access={s.access} people={ctx.people} />
                </p>
                <p className="text-[12.5px] text-muted">
                  {s.count} link{s.count === 1 ? "" : "s"}
                </p>
              </div>
              <IconButton label="Move up" onClick={() => move(ids, i, -1)} disabled={i === 0}>
                <ArrowUp className="size-4" />
              </IconButton>
              <IconButton
                label="Move down"
                onClick={() => move(ids, i, 1)}
                disabled={i === ids.length - 1}
              >
                <ArrowDown className="size-4" />
              </IconButton>
              <IconButton label="Edit" onClick={() => setEditing({ id: s.id })}>
                <Pencil className="size-4" />
              </IconButton>
            </li>
          );
        })}
      </ul>
      {editing ? <SectionForm id={editing.id} ctx={ctx} onClose={() => setEditing(null)} /> : null}
    </Panel>
  );
}

// ---------------------------------------------------------------------------

function People({ a }: { a: AdminConfig }) {
  const act = useAct();
  const [editing, setEditing] = useState<{ old: string; p: Profile } | null>(null);
  const [pinFor, setPinFor] = useState<Profile | null>(null);
  const [pin, setPin] = useState("");
  const blank = {
    ...structuredClone(a.config.profiles[0] ?? ({} as Profile)),
    id: "",
    name: "",
    avatar: "🙂",
    role: "adult" as Role,
    locked: false,
    favorites: [],
    hiddenTiles: [],
    hiddenGroups: [],
    groupOrder: [],
  } as Profile;
  return (
    <Panel
      title="People"
      intro="Each person has their own page. A PIN keeps a page theirs; a locked page can only be changed by the admin (good for children)."
      action={
        <Button variant="primary" onClick={() => setEditing({ old: "", p: blank })}>
          <Plus className="size-4" /> Add someone
        </Button>
      }
    >
      <ul className="divide-y divide-line">
        {a.config.profiles.map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-3">
            <Avatar p={p} />
            <div className="grow">
              <p className="font-semibold">{p.name}</p>
              <p className="text-[12.5px] text-muted">
                {{ admin: "Admin", adult: "Adult", child: "Child" }[p.role]}
                {a.pins[p.id] ? " · PIN" : ""}
                {p.locked ? " · locked" : ""}
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => {
                setPinFor(p);
                setPin("");
              }}
            >
              <KeyRound className="size-4" /> PIN
            </Button>
            <IconButton label="Edit" onClick={() => setEditing({ old: p.id, p })}>
              <Pencil className="size-4" />
            </IconButton>
            <IconButton
              label="Delete"
              onClick={() =>
                window.confirm(`Delete ${p.name}'s page?`) &&
                act(() => api.del(`/api/admin/profiles/${p.id}`), "Deleted")
              }
            >
              <Trash2 className="size-4" />
            </IconButton>
          </li>
        ))}
      </ul>
      {editing ? (
        <Modal
          open
          onClose={() => setEditing(null)}
          title={editing.old ? `Edit ${editing.p.name}` : "Add someone"}
          footer={
            <Button
              variant="primary"
              onClick={async () => {
                const id = editing.p.id || slugify(editing.p.name);
                (await act(
                  () => api.put(`/api/admin/profiles/${editing.old || id}`, { ...editing.p, id }),
                  "Saved",
                )) && setEditing(null);
              }}
            >
              Save
            </Button>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              {(id) => (
                <Input
                  id={id}
                  value={editing.p.name}
                  onChange={(e) =>
                    setEditing({ ...editing, p: { ...editing.p, name: e.target.value } })
                  }
                />
              )}
            </Field>
            <Field label="Avatar" hint="An emoji.">
              {(id) => (
                <Input
                  id={id}
                  value={editing.p.avatar ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      p: { ...editing.p, avatar: e.target.value || undefined },
                    })
                  }
                />
              )}
            </Field>
            <Field label="Colour">
              {(id) => (
                <Input
                  id={id}
                  type="color"
                  className="p-1"
                  value={editing.p.color}
                  onChange={(e) =>
                    setEditing({ ...editing, p: { ...editing.p, color: e.target.value } })
                  }
                />
              )}
            </Field>
            <Field label="Role">
              {(id) => (
                <Select
                  id={id}
                  value={editing.p.role}
                  onChange={(e) =>
                    setEditing({ ...editing, p: { ...editing.p, role: e.target.value as Role } })
                  }
                >
                  <option value="admin">Admin: sees everything</option>
                  <option value="adult">Adult</option>
                  <option value="child">Child</option>
                </Select>
              )}
            </Field>
            <div className="sm:col-span-2">
              <Toggle
                label="Locked"
                hint="Only the admin can change this page's layout and look."
                checked={editing.p.locked}
                onChange={(v) => setEditing({ ...editing, p: { ...editing.p, locked: v } })}
              />
            </div>
          </div>
        </Modal>
      ) : null}
      {pinFor ? (
        <Modal
          open
          onClose={() => setPinFor(null)}
          title={`${pinFor.name}'s PIN`}
          footer={
            <>
              {a.pins[pinFor.id] ? (
                <Button
                  variant="danger"
                  onClick={async () =>
                    (await act(
                      () => api.put(`/api/admin/pins/${pinFor.id}`, { pin: null }),
                      "PIN removed",
                    )) && setPinFor(null)
                  }
                >
                  Remove PIN
                </Button>
              ) : null}
              <Button
                variant="primary"
                disabled={pin.length < 4}
                onClick={async () =>
                  (await act(() => api.put(`/api/admin/pins/${pinFor.id}`, { pin }), "PIN set")) &&
                  setPinFor(null)
                }
              >
                Set PIN
              </Button>
            </>
          }
        >
          <Field
            label="New PIN"
            hint="4 to 8 digits. Devices that have this page open will need it again."
          >
            {(id) => (
              <Input
                id={id}
                inputMode="numeric"
                maxLength={8}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              />
            )}
          </Field>
        </Modal>
      ) : null}
    </Panel>
  );
}

// ---------------------------------------------------------------------------

function Ai({ a }: { a: AdminConfig }) {
  const act = useAct();
  const ai = a.config.settings.ai;
  const [editing, setEditing] = useState<{
    old: string;
    s: AiServer;
    key: string | null | undefined;
  } | null>(null);
  const [prompt, setPrompt] = useState(ai.systemPrompt);
  const [roles, setRoles] = useState<Role[]>(ai.chatRoles);
  const saveSettings = (patch: Partial<HearthConfig["settings"]["ai"]>) =>
    act(
      () => api.put("/api/admin/settings", { ...a.config.settings, ai: { ...ai, ...patch } }),
      "Saved",
    );
  return (
    <>
      <Panel
        title="AI servers"
        intro="Any Ollama or OpenAI-compatible server: one on this network, a shared one several computers serve, or (if you choose) a service on the internet. Keys are stored encrypted and never reach a browser."
        action={
          <Button
            variant="primary"
            onClick={() =>
              setEditing({
                old: "",
                s: { id: "", name: "", kind: "ollama", url: "http://192.168.1.20:11434" },
                key: undefined,
              })
            }
          >
            <Plus className="size-4" /> Add a server
          </Button>
        }
      >
        <ul className="divide-y divide-line">
          {ai.servers.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 grow">
                <p className="font-semibold">
                  {s.name}{" "}
                  {ai.defaultServer === s.id ? (
                    <span className="ml-1 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] text-accent">
                      default
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-[12.5px] text-muted">
                  {s.kind === "ollama" ? "Ollama" : "OpenAI-compatible"} · {s.url}
                  {s.model ? ` · ${s.model}` : ""}
                  {a.secrets.includes(`ai:${s.id}`) ? " · key stored" : ""}
                </p>
              </div>
              {ai.defaultServer !== s.id ? (
                <Button size="sm" onClick={() => saveSettings({ defaultServer: s.id })}>
                  Make default
                </Button>
              ) : null}
              <IconButton label="Edit" onClick={() => setEditing({ old: s.id, s, key: undefined })}>
                <Pencil className="size-4" />
              </IconButton>
              <IconButton
                label="Delete"
                onClick={() => act(() => api.del(`/api/admin/ai/servers/${s.id}`), "Removed")}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Who can chat">
        <div className="grid gap-3">
          {(["admin", "adult", "child"] as Role[]).map((r) => (
            <Toggle
              key={r}
              label={{ admin: "Admin", adult: "Adults", child: "Children" }[r]}
              hint={
                r === "child"
                  ? "Answers are asked to be kind, simple and safe, but no AI is perfect: stay nearby."
                  : undefined
              }
              checked={roles.includes(r)}
              onChange={(v) => setRoles(v ? [...roles, r] : roles.filter((x) => x !== r))}
            />
          ))}
          <Field
            label="Told to every chat"
            hint="Like: Answer briefly. We live in Ohio. Use metric units."
          >
            {(id) => (
              <TextArea
                id={id}
                className="font-sans text-[14px]"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            )}
          </Field>
          <Button
            variant="primary"
            className="justify-self-end"
            onClick={() => saveSettings({ chatRoles: roles, systemPrompt: prompt })}
          >
            Save
          </Button>
        </div>
      </Panel>
      {editing ? (
        <Modal
          open
          onClose={() => setEditing(null)}
          title={editing.old ? `Edit ${editing.s.name}` : "Add an AI server"}
          wide
          footer={
            <Button
              variant="primary"
              onClick={async () => {
                const id = editing.s.id || slugify(editing.s.name);
                (await act(
                  () =>
                    api.put(`/api/admin/ai/servers/${editing.old || id}`, {
                      ...editing.s,
                      id,
                      model: editing.s.model || undefined,
                      ...(editing.key !== undefined ? { key: editing.key } : {}),
                    }),
                  "Server saved",
                )) && setEditing(null);
              }}
            >
              Save
            </Button>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              {(id) => (
                <Input
                  id={id}
                  value={editing.s.name}
                  placeholder="Home AI"
                  onChange={(e) =>
                    setEditing({ ...editing, s: { ...editing.s, name: e.target.value } })
                  }
                />
              )}
            </Field>
            <Field label="Speaks">
              {(id) => (
                <Select
                  id={id}
                  value={editing.s.kind}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      s: { ...editing.s, kind: e.target.value as AiServer["kind"] },
                    })
                  }
                >
                  <option value="ollama">Ollama's API (/api/…)</option>
                  <option value="openai">OpenAI-compatible (/v1/…)</option>
                </Select>
              )}
            </Field>
            <Field
              label="Address"
              className="sm:col-span-2"
              hint={
                editing.s.kind === "ollama"
                  ? "Like http://192.168.1.20:11434"
                  : "The base, usually ending in /v1, like http://192.168.1.20:11434/v1"
              }
            >
              {(id) => (
                <Input
                  id={id}
                  value={editing.s.url}
                  onChange={(e) =>
                    setEditing({ ...editing, s: { ...editing.s, url: e.target.value } })
                  }
                />
              )}
            </Field>
            <Field label="Default model" hint="Empty: the first one it has.">
              {(id) => (
                <Input
                  id={id}
                  value={editing.s.model ?? ""}
                  placeholder="llama3.1"
                  onChange={(e) =>
                    setEditing({ ...editing, s: { ...editing.s, model: e.target.value } })
                  }
                />
              )}
            </Field>
            <Field
              label="Key"
              hint={
                a.secrets.includes(`ai:${editing.old}`)
                  ? "A key is stored. Type a new one to replace it."
                  : "If the server needs one (Bearer)."
              }
            >
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="off"
                  value={editing.key ?? ""}
                  onChange={(e) => setEditing({ ...editing, key: e.target.value || undefined })}
                />
              )}
            </Field>
            {editing.old && a.secrets.includes(`ai:${editing.old}`) ? (
              <Button
                variant="danger"
                size="sm"
                className="justify-self-start"
                onClick={() => setEditing({ ...editing, key: null })}
              >
                {editing.key === null ? "Key will be removed" : "Remove the stored key"}
              </Button>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------

function Secrets({ a }: { a: AdminConfig }) {
  const act = useAct();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const own = a.secrets.filter((s) => !s.startsWith("ai:"));
  return (
    <Panel
      title="Secrets"
      intro={
        <>
          API keys and passwords for widget sources. Widgets use them as{" "}
          <code>{"{{secret:name}}"}</code> in an address, header or message; the value is filled in
          on the server and never shown again.
        </>
      }
    >
      <ul className="mb-4 divide-y divide-line">
        {own.length === 0 ? <li className="py-2 text-sm text-muted">None yet.</li> : null}
        {own.map((s) => (
          <li key={s} className="flex items-center gap-3 py-2">
            <code className="grow text-[13.5px]">{`{{secret:${s}}}`}</code>
            <IconButton
              label="Delete"
              onClick={() =>
                act(() => api.put(`/api/admin/secrets/${s}`, { value: null }), "Deleted")
              }
            >
              <Trash2 className="size-4" />
            </IconButton>
          </li>
        ))}
      </ul>
      <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
        <Field label="Name">
          {(id) => (
            <Input
              id={id}
              value={name}
              placeholder="nas_token"
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_:.-]/g, ""))}
            />
          )}
        </Field>
        <Field label="Value">
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="off"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </Field>
        <Button
          variant="primary"
          disabled={!name || !value}
          onClick={async () => {
            if (await act(() => api.put(`/api/admin/secrets/${name}`, { value }), "Secret saved")) {
              setName("");
              setValue("");
            }
          }}
        >
          Save
        </Button>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

function Themes({ cfg }: { cfg: HearthConfig }) {
  const act = useAct();
  const [editing, setEditing] = useState<{ old: string; t: Theme } | null>(null);
  return (
    <Panel
      title="Themes"
      intro="Colour sets anyone can pick in Look. Start from a built-in one and change what you like."
      action={
        <Select
          aria-label="Start from"
          value=""
          onChange={(e) => {
            const base = BUILTIN_THEMES.find((t) => t.id === e.target.value);
            if (base)
              setEditing({
                old: "",
                t: { ...structuredClone(base), id: "", name: `My ${base.name}` },
              });
          }}
          className="w-auto"
        >
          <option value="">New theme from…</option>
          {BUILTIN_THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      }
    >
      <ul className="grid gap-3 sm:grid-cols-2">
        {cfg.themes.length === 0 ? (
          <li className="text-sm text-muted">No custom themes yet.</li>
        ) : null}
        {cfg.themes.map((t) => (
          <li key={t.id} className="flex items-center gap-3 rounded-2xl border border-line p-3">
            <span className="flex h-10 w-16 overflow-hidden rounded-lg">
              {[t.colors.background, t.colors.surface, t.colors.accent].map((c) => (
                <span key={c} className="grow" style={{ background: c }} />
              ))}
            </span>
            <span className="grow font-semibold">{t.name}</span>
            <IconButton label="Edit" onClick={() => setEditing({ old: t.id, t })}>
              <Pencil className="size-4" />
            </IconButton>
            <IconButton
              label="Delete"
              onClick={() => act(() => api.del(`/api/admin/themes/${t.id}`), "Deleted")}
            >
              <Trash2 className="size-4" />
            </IconButton>
          </li>
        ))}
      </ul>
      {editing ? (
        <Modal
          open
          wide
          onClose={() => setEditing(null)}
          title={editing.old ? `Edit ${editing.t.name}` : "New theme"}
          footer={
            <Button
              variant="primary"
              onClick={async () => {
                const id = editing.t.id || slugify(editing.t.name);
                (await act(
                  () => api.put(`/api/admin/themes/${editing.old || id}`, { ...editing.t, id }),
                  "Theme saved",
                )) && setEditing(null);
              }}
            >
              Save
            </Button>
          }
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Name">
                  {(id) => (
                    <Input
                      id={id}
                      value={editing.t.name}
                      onChange={(e) =>
                        setEditing({ ...editing, t: { ...editing.t, name: e.target.value } })
                      }
                    />
                  )}
                </Field>
                <Field label="Light or dark">
                  {(id) => (
                    <Select
                      id={id}
                      value={editing.t.mode}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          t: { ...editing.t, mode: e.target.value as "light" },
                        })
                      }
                    >
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </Select>
                  )}
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {THEME_KEYS.map((k) => (
                  <label
                    key={k}
                    className="flex items-center gap-2 text-[13px]"
                    title={THEME_LABELS[k].hint}
                  >
                    <input
                      type="color"
                      value={editing.t.colors[k]}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          t: { ...editing.t, colors: { ...editing.t.colors, [k]: e.target.value } },
                        })
                      }
                      className="h-8 w-10 cursor-pointer rounded border border-line bg-transparent"
                    />
                    {THEME_LABELS[k].label}
                  </label>
                ))}
              </div>
            </div>
            <ThemePreview t={editing.t} />
          </div>
        </Modal>
      ) : null}
    </Panel>
  );
}

function ThemePreview({ t }: { t: Theme }) {
  const c = t.colors;
  return (
    <div
      className="rounded-2xl p-3"
      style={{ background: c.background, color: c.text, border: `1px solid ${c.border}` }}
    >
      <p className="mb-2 text-lg font-bold">Good evening</p>
      <div
        className="mb-2 rounded-xl p-3"
        style={{ background: c.surface, border: `1px solid ${c.border}` }}
      >
        <p className="text-[11px] font-bold uppercase" style={{ color: c.muted }}>
          Services
        </p>
        <p className="font-bold" style={{ color: c.positive }}>
          All 6 are up
        </p>
        <div className="mt-1.5 flex gap-1">
          {[c.positive, c.positive, c.warning, c.negative].map((x, i) => (
            <span key={`${x}${i}`} className="h-1.5 grow rounded-full" style={{ background: x }} />
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <span
          className="grow rounded-xl p-2 text-[12px] font-semibold"
          style={{ background: c.surface, border: `1px solid ${c.border}` }}
        >
          🎮 Games
        </span>
        <span
          className="rounded-full px-3 py-2 text-[12px] font-bold text-white"
          style={{ background: c.accent }}
        >
          Button
        </span>
      </div>
      <div className="mt-2 flex h-8 items-end gap-1">
        {[c.chart1, c.chart2, c.chart3, c.chart4, c.chart5, c.chart6].map((x, i) => (
          <span
            key={x + String(i)}
            className="grow rounded-t"
            style={{ background: x, height: `${30 + i * 12}%` }}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Advanced({ cfg }: { cfg: HearthConfig }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState(JSON.stringify(cfg, null, 2));
  const [error, setError] = useState<unknown>(null);
  useEffect(() => setText(JSON.stringify(cfg, null, 2)), [cfg]);
  const save = async () => {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setError(new Error(`Not valid JSON: ${(e as Error).message}`));
      return;
    }
    try {
      await api.put("/api/admin/config", { config: parsed });
      toast("Config saved");
      await qc.invalidateQueries({ queryKey: keys.admin });
    } catch (e) {
      setError(e);
    }
  };
  return (
    <Panel
      title="The whole config"
      intro="Everything above, as hearth.json. Hearth checks it before saving and refuses anything that would break the page. Secrets, PINs and the password aren't in it."
    >
      <TextArea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        className="min-h-[480px]"
        aria-label="hearth.json"
      />
      <div className="mt-3 grid gap-3">
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setText(JSON.stringify(cfg, null, 2))}>
            Undo changes
          </Button>
          <Button variant="primary" onClick={save}>
            Save config
          </Button>
        </div>
      </div>
    </Panel>
  );
}
