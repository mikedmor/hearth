/** Settings (admin): the house's shared things, in plain forms. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { LinkSuggestion } from "../../shared/access";
import type { Access } from "../../shared/api";
import {
  type AiServer,
  type Group,
  type HearthConfig,
  isLocked,
  type Profile,
  type Role,
} from "../../shared/config";
import { BUILTIN_THEMES, THEME_KEYS, THEME_LABELS, type Theme } from "../../shared/themes";
import type { UpdateStatus } from "../../shared/updates";
import { ENGINE_IDS, SEARCH_ENGINES } from "../../shared/web-search";
import { CalendarAdminPanel } from "../components/calendar/AdminPanel";
import { RefIcon } from "../components/IconPicker";
import { InternetPanel } from "../components/internet/InternetPanel";
import { Markdown } from "../components/Markdown";
import { Avatar } from "../components/Picker";
import { SsoCard } from "../components/SsoCard";
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
  ["internet", "Internet"],
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
        {tab === "profiles" ? (
          <div className="grid gap-5">
            <People a={a} />
            <WhatPeopleUse a={a} />
            <SsoCard
              profiles={a.config.profiles.map((p) => ({
                id: p.id,
                name: p.name,
                avatar: p.avatar,
                color: p.color,
                role: p.role,
                hasPin: false,
              }))}
            />
          </div>
        ) : null}
        {tab === "internet" ? <InternetPanel /> : null}
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

/** Which version this is, and whether a newer release is out (from GitHub, when allowed). */
function UpdatesPanel({ check, onCheck }: { check: boolean; onCheck: (v: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const status = useQuery({
    queryKey: ["updates"],
    queryFn: () => api.get<UpdateStatus>("/api/admin/updates"),
    retry: false,
  });
  const [busy, setBusy] = useState(false);
  const u = status.data;
  const checkNow = async () => {
    setBusy(true);
    try {
      const next = await api.post<UpdateStatus>("/api/admin/updates/check");
      qc.setQueryData(["updates"], next);
      await qc.invalidateQueries({ queryKey: keys.home });
      if (next.error) toast(next.error, "bad");
      else if (!next.available) toast("Hearth is up to date");
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel
      title="Updates"
      intro={
        u ? (
          u.devBuild ? (
            <>
              This is a build from source (<code>{u.current}</code>), so there's no version to
              compare.
            </>
          ) : (
            <>
              You're running Hearth <b>{u.current}</b>.
            </>
          )
        ) : (
          "Which version this is, and whether there's a newer one."
        )
      }
      action={
        <Button onClick={() => void checkNow()} disabled={busy}>
          <RefreshCw className={cx("size-4", busy && "animate-spin")} /> Check now
        </Button>
      }
    >
      <Toggle
        label="Check for a new version once a day"
        hint="Asks GitHub for Hearth's newest release: a plain request that sends nothing about your home. Saved with the settings below. Hearth never updates itself."
        checked={check}
        onChange={onCheck}
      />
      {u?.available ? (
        <div className="mt-4 grid gap-3 rounded-xl border border-accent/40 bg-accent/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">
              Hearth {u.available.version} is out
              {u.available.publishedAt
                ? ` (${new Date(u.available.publishedAt).toLocaleDateString()})`
                : ""}
              .
            </p>
            <a
              href={u.available.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-semibold text-accent"
            >
              The release on GitHub <ExternalLink className="size-3.5" />
            </a>
          </div>
          {u.available.notes ? (
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold">What's new</summary>
              <div className="mt-2 max-h-80 overflow-auto">
                <Markdown text={u.available.notes} />
              </div>
            </details>
          ) : null}
          <div className="grid gap-1.5 text-sm">
            <p className="font-semibold">To update</p>
            <p className="text-muted">
              Your settings and everything in the data folder stay as they are.
            </p>
            <ul className="grid gap-1.5">
              <li>
                <b>Docker Compose:</b> in Hearth's folder,{" "}
                <code>docker compose pull &amp;&amp; docker compose up -d</code>
              </li>
              <li>
                <b>Synology Container Manager:</b> Project → hearth → <b>Action → Build</b> (it
                pulls the newest image).
              </li>
              <li>
                <b>Built from source:</b> <code>git -C src pull</code>, then{" "}
                <code>docker compose up -d --build</code>
              </li>
            </ul>
          </div>
        </div>
      ) : u?.checkedAt ? (
        <p className="mt-3 text-sm text-muted">
          {u.error
            ? `Couldn't check: ${u.error}`
            : u.devBuild
              ? `The newest release is ${u.latest}.`
              : "Up to date."}{" "}
          Checked {new Date(u.checkedAt).toLocaleString()}.{" "}
          <a
            href={u.releasesUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-accent"
          >
            All releases
          </a>
        </p>
      ) : null}
    </Panel>
  );
}

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
      <UpdatesPanel
        check={s.updates.check}
        onCheck={(v) => setS({ ...s, updates: { ...s.updates, check: v } })}
      />
      <Panel title="Network" intro="What Hearth itself may call.">
        <Toggle
          label="Let widgets reach the internet"
          hint="Off: widget sources and the designer only reach the home network (.home, .local, private addresses). Turn on for weather or public APIs."
          checked={s.network.allowInternet}
          onChange={(v) => setS({ ...s, network: { ...s.network, allowInternet: v } })}
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
      <Panel
        title="Search the web"
        intro="The search box offers a web search when what someone types isn't one of the home's links. The browser goes to the search engine itself; Hearth never calls it. Each person can pick their own in Look."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Search engine">
            {(id) => (
              <Select
                id={id}
                value={s.webSearch.engine}
                onChange={(e) =>
                  setS({
                    ...s,
                    webSearch: {
                      ...s.webSearch,
                      engine: e.target.value as typeof s.webSearch.engine,
                    },
                  })
                }
              >
                {ENGINE_IDS.map((e) => (
                  <option key={e} value={e}>
                    {SEARCH_ENGINES[e].name}
                  </option>
                ))}
                <option value="custom">Your own (SearXNG, Whoogle…)</option>
                <option value="off">Off: the home's links only</option>
              </Select>
            )}
          </Field>
          {s.webSearch.engine === "custom" ? (
            <>
              <Field label="Its name" hint="The box says “Search … for”.">
                {(id) => (
                  <Input
                    id={id}
                    value={s.webSearch.name ?? ""}
                    placeholder="SearXNG"
                    onChange={(e) =>
                      setS({
                        ...s,
                        webSearch: { ...s.webSearch, name: e.target.value || undefined },
                      })
                    }
                  />
                )}
              </Field>
              <Field
                label="Its address"
                hint="With %s where the search goes, like http://search.home/search?q=%s."
                className="sm:col-span-2"
              >
                {(id) => (
                  <Input
                    id={id}
                    value={s.webSearch.url ?? ""}
                    placeholder="http://search.home/search?q=%s"
                    onChange={(e) =>
                      setS({
                        ...s,
                        webSearch: { ...s.webSearch, url: e.target.value || undefined },
                      })
                    }
                  />
                )}
              </Field>
            </>
          ) : null}
        </div>
      </Panel>
      <Panel
        title="Files"
        intro="The NAS's shared folders, on the Files page. Each person connects their own NAS account, so the NAS decides what they see. Synology (DSM) for now."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="The NAS's address"
            hint="DSM's, like https://nas.home or http://192.168.1.20:5000."
          >
            {(id) => (
              <div className="flex gap-2">
                <Input
                  id={id}
                  value={s.files.url ?? ""}
                  placeholder="https://nas.home"
                  onChange={(e) =>
                    setS({ ...s, files: { ...s.files, url: e.target.value || undefined } })
                  }
                />
                <Button
                  disabled={!s.files.url}
                  onClick={() =>
                    act(async () => {
                      const r = await api.post<{ ok: boolean; message: string }>(
                        "/api/admin/files/check",
                        { url: s.files.url },
                      );
                      if (!r.ok) throw new Error(r.message);
                      return r;
                    }, "That's a Synology NAS with File Station")
                  }
                >
                  Check
                </Button>
              </div>
            )}
          </Field>
          <Field
            label="Name for mapping shares"
            hint="What devices use (\\nas.home\photos). Empty: the address's own name."
          >
            {(id) => (
              <Input
                id={id}
                value={s.files.smbHost ?? ""}
                placeholder="nas.home"
                onChange={(e) =>
                  setS({ ...s, files: { ...s.files, smbHost: e.target.value || undefined } })
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
  const [editing, setEditing] = useState<{ id: string | null; from?: LinkSuggestion } | null>(null);
  const suggestions = useQuery({
    queryKey: ["link-suggestions"],
    queryFn: () => api.get<{ suggestions: LinkSuggestion[] }>("/api/admin/link-suggestions"),
    staleTime: 30_000,
  });
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
      {suggestions.data?.suggestions.length ? (
        <div className="mb-3 grid gap-1.5 rounded-xl border border-dashed border-line p-3">
          <p className="text-[13px] font-semibold">Services on your network with no link yet</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.data.suggestions.map((s) => (
              <button
                key={s.url}
                type="button"
                onClick={() => setEditing({ id: null, from: s })}
                title={`Add a link to ${s.url}`}
                className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[13px] font-semibold hover:border-accent"
              >
                <Plus className="size-3.5 text-accent" />
                {s.name}
                <span className="font-normal text-muted">{new URL(s.url).host}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
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
      {editing ? (
        <LinkForm id={editing.id} from={editing.from} ctx={ctx} onClose={() => setEditing(null)} />
      ) : null}
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

/** Which roles may use Files, the calendar and chat: one grid, the admin always may. */
function WhatPeopleUse({ a }: { a: AdminConfig }) {
  const act = useAct();
  const settings = a.config.settings;
  const [files, setFiles] = useState(settings.features.files);
  const [calendar, setCalendar] = useState(settings.features.calendar);
  const [chat, setChat] = useState(settings.ai.chatRoles);
  useEffect(() => {
    setFiles(settings.features.files);
    setCalendar(settings.features.calendar);
    setChat(settings.ai.chatRoles);
  }, [settings]);
  const rows: { label: string; hint: string; roles: Role[]; set: (r: Role[]) => void }[] = [
    {
      label: "Files",
      hint: "The NAS's shared folders. Each person also needs a PIN and their own NAS account.",
      roles: files,
      set: setFiles,
    },
    {
      label: "Calendar",
      hint: "Their own calendar and the Coming up widget.",
      roles: calendar,
      set: setCalendar,
    },
    {
      label: "Chat",
      hint: settings.ai.servers.length
        ? "Asking the home's AI."
        : "Needs an AI server first (AI tab).",
      roles: chat,
      set: setChat,
    },
  ];
  const changed =
    JSON.stringify([files, calendar, chat]) !==
    JSON.stringify([settings.features.files, settings.features.calendar, settings.ai.chatRoles]);
  return (
    <Panel
      title="What people can use"
      intro="By role. The admin, signed in, can always use everything."
      action={
        <Button
          variant="primary"
          disabled={!changed}
          onClick={() =>
            act(
              () =>
                api.put("/api/admin/settings", {
                  ...settings,
                  features: { ...settings.features, files, calendar },
                  ai: { ...settings.ai, chatRoles: chat },
                }),
              "Saved",
            )
          }
        >
          Save
        </Button>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-[14px]">
          <thead>
            <tr className="text-left text-[12px] text-muted">
              <th className="py-2 font-semibold">Feature</th>
              {(["admin", "adult", "child"] as Role[]).map((r) => (
                <th key={r} className="w-24 py-2 text-center font-semibold">
                  {{ admin: "Admin", adult: "Adults", child: "Children" }[r]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.label}>
                <td className="py-2.5 pr-3">
                  <div className="font-semibold">{row.label}</div>
                  <div className="text-[12.5px] text-muted">{row.hint}</div>
                </td>
                {(["admin", "adult", "child"] as Role[]).map((r) => (
                  <td key={r} className="py-2.5 text-center">
                    <input
                      type="checkbox"
                      aria-label={`${row.label} for ${{ admin: "the admin's profile", adult: "adults", child: "children" }[r]}`}
                      className="size-4 accent-(--c-accent)"
                      checked={row.roles.includes(r)}
                      onChange={(e) =>
                        row.set(
                          e.target.checked ? [...row.roles, r] : row.roles.filter((x) => x !== r),
                        )
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

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
                {isLocked(p) ? " · locked" : ""}
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
                hint={
                  editing.p.role === "child"
                    ? "A child's page is always locked: you set up their links, widgets and look."
                    : "Only the admin can change this page's links, layout and look."
                }
                checked={isLocked(editing.p)}
                disabled={editing.p.role === "child"}
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
        className="min-h-120"
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
