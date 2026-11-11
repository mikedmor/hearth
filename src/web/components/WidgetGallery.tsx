/**
 * Adding a widget: widgets that already exist (anyone), and for the admin, ready-made ones
 * for the apps the home runs, general ones (clock, weather, news, this server), or a new one.
 * A ready-made widget asks only for what it needs: the app's address, its key, a setting or two.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Minus,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { HomeView, IconSvg } from "../../shared/api";
import type { Audience, Widget } from "../../shared/config";
import { api } from "../lib/api";
import { cx } from "../lib/format";
import { keys, useAdminConfig } from "../lib/queries";
import { WidgetSettings } from "../pages/WidgetsPage";
import { TileIcon } from "./Tile";
import { Button, ErrorNote, Field, IconButton, Input, Modal, Select, useToast } from "./ui";
import { DEFAULT_TITLES } from "./widgets/WidgetCard";

interface Secret {
  label: string;
  hint: string;
  kind?: "key" | "basic" | "bearer" | "digest";
}
interface Param {
  key: string;
  label: string;
  hint?: string;
  default?: string;
}
interface AppSummary {
  id: string;
  name: string;
  icon: string;
  svg?: IconSvg;
  color?: string;
  category: string;
  description: string;
  widgets: {
    id: string;
    name: string;
    description: string;
    secret?: Secret;
    params?: Param[];
    private: boolean;
  }[];
}
interface General {
  id: string;
  name: string;
  description: string;
  icon: string;
  svg?: IconSvg;
  needsInternet: boolean;
  params: Param[];
}
interface Catalog {
  apps: AppSummary[];
  general: General[];
  /** Apps this home has (from tiles and port checks), and whether Hearth has their sign-in. */
  yours: { tile?: string; name: string; url: string; app: string; known: boolean }[];
  /** Built-in widgets this home can use (the pinball table, the AI servers). */
  builtins: {
    type: "pinball" | "ai";
    name: string;
    description: string;
    options?: { device?: string };
  }[];
  allowInternet: boolean;
}

type Choice =
  | {
      kind: "app";
      app: AppSummary;
      widget: AppSummary["widgets"][number];
      base?: string;
      /** Hearth already keeps the sign-in for this app at this address. */
      known?: boolean;
    }
  | { kind: "general"; template: General };

export function WidgetGallery({
  view,
  onAdd,
  onClose,
}: {
  view: HomeView;
  onAdd: (id: string) => void;
  onClose: () => void;
}) {
  const admin = view.session.admin;
  const [tab, setTab] = useState<"list" | "yours" | "apps" | "general">("list");
  const [choice, setChoice] = useState<Choice | null>(null);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Widget | null>(null);
  const adminConfig = useAdminConfig(admin);
  const catalog = useQuery({
    queryKey: ["catalog"],
    queryFn: () => api.get<Catalog>("/api/admin/catalog"),
    enabled: admin,
  });

  const yours = useMemo(() => {
    const c = catalog.data;
    if (!c) return [];
    return c.yours.flatMap((y) => {
      const app = c.apps.find((a) => a.id === y.app);
      return app
        ? app.widgets.map((w) => ({
            app,
            widget: w,
            base: y.url,
            tile: y.name,
            known: y.known,
            fromTile: Boolean(y.tile),
          }))
        : [];
    });
  }, [catalog.data]);
  const apps = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (catalog.data?.apps ?? []).filter(
      (a) =>
        a.widgets.length &&
        (!needle ||
          a.name.toLowerCase().includes(needle) ||
          a.category.toLowerCase().includes(needle)),
    );
  }, [catalog.data, q]);

  const qc = useQueryClient();
  const toast = useToast();
  const addBuiltin = async (b: Catalog["builtins"][number]) => {
    try {
      await api.post("/api/admin/widgets/builtin", {
        type: b.type,
        options: b.options,
        page: view.profile?.id ?? "guest",
      });
      toast(`${b.name} is on your page`);
      await qc.invalidateQueries();
      onClose();
    } catch (e) {
      toast((e as Error).message, "bad");
    }
  };

  const takeOff = async (id: string, name: string) => {
    try {
      await api.put("/api/me/layout", {
        sections: view.sections,
        widgets: view.widgets.filter((w) => w.id !== id).map((w) => ({ id: w.id, w: w.w })),
        board: view.board.filter((k) => k !== `w:${id}`),
      });
      toast(`${name} is off this page`);
    } catch (e) {
      toast((e as Error).message, "bad");
    }
    await qc.invalidateQueries({ queryKey: keys.home });
  };
  const editWidget = (id: string) => {
    const w = adminConfig.data?.config.widgets.find((x) => x.id === id);
    if (w) setEditing(w);
  };

  if (editing)
    return (
      <WidgetSettings
        widget={editing}
        onClose={() => setEditing(null)}
        taken={(adminConfig.data?.config.widgets ?? []).map((w) => w.id)}
      />
    );

  const tabs = [
    { id: "list" as const, label: "On your list", show: true },
    {
      id: "yours" as const,
      label: `Your apps${yours.length + (catalog.data?.builtins.length ?? 0) ? ` (${yours.length + (catalog.data?.builtins.length ?? 0)})` : ""}`,
      show: admin,
    },
    { id: "apps" as const, label: "All apps", show: admin },
    { id: "general" as const, label: "General", show: admin },
  ].filter((t) => t.show);

  return (
    <Modal open wide onClose={onClose} title={choice ? "Add a widget" : "Add a widget"}>
      {choice ? (
        <Install
          choice={choice}
          view={view}
          catalog={catalog.data}
          onBack={() => setChoice(null)}
          onDone={() => onClose()}
        />
      ) : (
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-1.5">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-pressed={tab === t.id}
                className={cx(
                  "h-8 rounded-full px-3 text-[13px] font-semibold",
                  tab === t.id
                    ? "bg-accent text-white"
                    : "border border-line text-muted hover:text-ink",
                )}
              >
                {t.label}
              </button>
            ))}
            {admin ? (
              <Link
                to="/widgets/$id"
                params={{ id: "new" }}
                className="ml-auto flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] font-semibold text-muted hover:text-ink"
                onClick={onClose}
              >
                <Sparkles className="size-4" /> Make your own
              </Link>
            ) : null}
          </div>

          {admin ? null : (
            <p className="-mt-1 text-[12.5px] text-muted">
              Signed in as the admin, you can also add widgets for your apps and general ones, and
              edit widgets.
            </p>
          )}

          {tab === "list" ? (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <h3 className="text-[12px] font-bold uppercase tracking-[0.08em] text-muted">
                  On this page
                </h3>
                {view.widgets.length ? (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {view.widgets.map((w) => {
                      const name = w.title ?? DEFAULT_TITLES[w.type];
                      return (
                        <li key={w.id} className="card flex items-center gap-1 py-1 pr-2 pl-4">
                          <span className="grid min-w-0 grow py-2">
                            <span className="truncate font-semibold">{name}</span>
                            <span className="truncate text-[12.5px] text-muted">{kindOf(w)}</span>
                          </span>
                          {admin ? (
                            <IconButton
                              label={`${name}: settings`}
                              onClick={() => editWidget(w.id)}
                              disabled={!adminConfig.data}
                            >
                              <Pencil className="size-4" />
                            </IconButton>
                          ) : null}
                          {view.canEdit ? (
                            <IconButton
                              label={`Take ${name} off this page`}
                              onClick={() => void takeOff(w.id, name)}
                            >
                              <Minus className="size-4" />
                            </IconButton>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No widgets on this page yet.</p>
                )}
              </div>

              <div className="grid gap-2">
                <h3 className="text-[12px] font-bold uppercase tracking-[0.08em] text-muted">
                  Add to this page
                </h3>
                {view.library.length ? (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {view.library.map((w) => (
                      <li
                        key={w.id}
                        className="card flex items-center gap-1 pr-2 hover:border-accent"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onAdd(w.id);
                            onClose();
                          }}
                          className="flex min-w-0 grow items-center justify-between gap-3 px-4 py-3 text-left"
                        >
                          <span className="grid min-w-0">
                            <span className="truncate font-semibold">
                              {w.title ?? DEFAULT_TITLES[w.type]}
                            </span>
                            <span className="truncate text-[12.5px] text-muted">{kindOf(w)}</span>
                          </span>
                          <Plus className="size-5 flex-none text-accent" />
                        </button>
                        {admin ? (
                          <DeleteWidget id={w.id} name={w.title ?? DEFAULT_TITLES[w.type]} />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">
                    Every widget on the list is already on this page.
                    {admin
                      ? " Make more from Your apps, All apps or General."
                      : " The admin can make more."}
                  </p>
                )}
              </div>
            </div>
          ) : null}

          {tab === "yours" ? (
            yours.length || catalog.data?.builtins.length ? (
              <div className="grid gap-3">
                {catalog.data?.builtins.length ? (
                  <Cards
                    items={catalog.data.builtins.map((b) => ({
                      key: `builtin/${b.type}/${b.options?.device ?? ""}`,
                      name: b.name,
                      detail: `${b.description} Built into Hearth: nothing to fill in.`,
                      onPick: () => addBuiltin(b),
                    }))}
                  />
                ) : null}
                <Cards
                  items={yours.map((y) => ({
                    key: `${y.app.id}/${y.widget.id}/${y.base}`,
                    name: y.widget.name,
                    detail: `${y.widget.description} ${y.fromTile ? `From your tile “${y.tile}”` : `Found: ${y.tile}`}${y.known ? ", and Hearth already has its sign-in" : ""}.`,
                    svg: y.app.svg,
                    color: y.app.color,
                    onPick: () =>
                      setChoice({
                        kind: "app",
                        app: y.app,
                        widget: y.widget,
                        base: y.base,
                        known: y.known,
                      }),
                  }))}
                />
              </div>
            ) : (
              <p className="text-sm text-muted">
                Hearth hasn't found an app with widgets among your tiles or on your network yet.
                Pick from All apps, and fill in where it is.
              </p>
            )
          ) : null}

          {tab === "apps" ? (
            <>
              <label className="relative flex items-center">
                <Search className="pointer-events-none absolute left-3 size-4 text-muted" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search apps: plex, sonarr, docker…"
                  className="h-10 w-full rounded-xl border border-line bg-page pl-9 text-[14px] focus:border-accent focus:outline-none"
                />
              </label>
              <Cards
                items={apps.flatMap((a) =>
                  a.widgets.map((w) => ({
                    key: `${a.id}/${w.id}`,
                    name: w.name,
                    detail: w.description,
                    svg: a.svg,
                    color: a.color,
                    onPick: () => setChoice({ kind: "app", app: a, widget: w }),
                  })),
                )}
              />
            </>
          ) : null}

          {tab === "general" ? (
            <Cards
              items={(catalog.data?.general ?? []).map((g) => ({
                key: g.id,
                name: g.name,
                detail: g.description,
                svg: g.svg,
                onPick: () => setChoice({ kind: "general", template: g }),
              }))}
            />
          ) : null}
          {catalog.error ? <ErrorNote error={catalog.error} /> : null}
        </div>
      )}
    </Modal>
  );
}

function kindOf(w: { id: string; type: keyof typeof DEFAULT_TITLES }): string {
  return w.type === "custom"
    ? `Custom widget · ${w.id}`
    : `Built in: ${DEFAULT_TITLES[w.type].toLowerCase()}`;
}

function Cards({
  items,
}: {
  items: {
    key: string;
    name: string;
    detail: string;
    svg?: IconSvg;
    color?: string;
    onPick: () => void;
  }[];
}) {
  return (
    <ul className="grid max-h-[52vh] gap-2 overflow-y-auto sm:grid-cols-2">
      {items.map((i) => (
        <li key={i.key}>
          <button
            type="button"
            onClick={i.onPick}
            className="card flex h-full w-full items-start gap-3 px-3 py-3 text-left hover:border-accent"
            style={i.color ? ({ "--tile": i.color } as React.CSSProperties) : undefined}
          >
            <span className="scale-75">
              <TileIcon
                tile={
                  i.svg
                    ? { name: i.name, iconKind: "svg", svg: i.svg }
                    : { name: i.name, iconKind: "monogram" }
                }
              />
            </span>
            <span className="grid min-w-0 gap-0.5">
              <span className="font-semibold">{i.name}</span>
              <span className="text-[12.5px] text-muted">{i.detail}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Install({
  choice,
  view,
  catalog,
  onBack,
  onDone,
}: {
  choice: Choice;
  view: HomeView;
  catalog?: Catalog;
  onBack: () => void;
  onDone: (id: string) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const isApp = choice.kind === "app";
  const known = isApp ? Boolean(choice.known) : false;
  const [useKnown, setUseKnown] = useState(known);
  const secret = isApp && !useKnown ? choice.widget.secret : undefined;
  const params = isApp ? (choice.widget.params ?? []) : choice.template.params;
  const tilesForApp = isApp ? (catalog?.yours ?? []).filter((y) => y.app === choice.app.id) : [];
  const [base, setBase] = useState(isApp ? (choice.base ?? tilesForApp[0]?.url ?? "http://") : "");
  const [key, setKey] = useState("");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(params.map((p) => [p.key, p.default ?? ""])),
  );
  const name = isApp ? choice.widget.name : choice.template.name;
  const [title, setTitle] = useState(isApp ? `${choice.app.name}` : choice.template.name);
  const [audience, setAudience] = useState<Audience>(
    isApp && choice.widget.private ? "admin" : "everyone",
  );
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const secretValue = !secret
    ? undefined
    : secret.kind === "basic"
      ? `Basic ${btoa(`${user}:${pass}`)}`
      : secret.kind === "digest"
        ? `${user}:${pass}`
        : secret.kind === "bearer"
          ? `Bearer ${key.trim()}`
          : key.trim();
  const ready =
    (!isApp || /^https?:\/\/[^/\s]+/.test(base)) &&
    (!secret ||
      (secret.kind === "basic" || secret.kind === "digest" ? user && pass : key.trim())) &&
    params.every((p) => values[p.key]?.trim());

  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ id: string }>("/api/admin/widgets/install", {
        ...(isApp
          ? { app: choice.app.id, widget: choice.widget.id, base: base.trim() }
          : { general: choice.template.id }),
        secret: secretValue,
        useKnown: useKnown || undefined,
        params: values,
        title,
        audience,
        page: view.profile?.id ?? "guest",
      });
      toast("Widget added");
      await qc.invalidateQueries();
      onDone(r.id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 justify-self-start text-[13px] font-semibold text-muted hover:text-ink"
      >
        <ArrowLeft className="size-4" /> All widgets
      </button>
      <div>
        <h3 className="text-lg font-bold">{name}</h3>
        <p className="text-[13.5px] text-muted">
          {isApp ? choice.widget.description : choice.template.description}
        </p>
      </div>
      {!isApp && choice.template.needsInternet && !catalog?.allowInternet ? (
        <p className="flex items-start gap-2 rounded-xl bg-warn/10 p-3 text-[13px]">
          <TriangleAlert className="mt-0.5 size-4 flex-none text-warn" /> This reaches the internet,
          which Hearth doesn't by default. Turn it on in Settings → General → Network, or the widget
          will say so instead of showing data.
        </p>
      ) : null}
      {isApp ? (
        <Field
          label={`Where is ${choice.app.name}?`}
          hint={
            tilesForApp.length
              ? "From your tiles, or type another address."
              : "Its address on your network, with the port: http://192.168.1.20:8989"
          }
        >
          {(id) => (
            <>
              <Input
                id={id}
                list={`${id}-tiles`}
                value={base}
                onChange={(e) => setBase(e.target.value)}
              />
              <datalist id={`${id}-tiles`}>
                {tilesForApp.map((t) => (
                  <option key={t.tile} value={t.url}>
                    {t.name}
                  </option>
                ))}
              </datalist>
            </>
          )}
        </Field>
      ) : null}
      {known ? (
        <label className="flex items-center gap-2 text-[13.5px]">
          <input
            type="checkbox"
            checked={useKnown}
            onChange={(e) => setUseKnown(e.target.checked)}
            className="size-4 accent-accent"
          />
          Use the sign-in Hearth already has for {isApp ? choice.app.name : "it"} (from Devices →
          Setup)
        </label>
      ) : null}
      {secret ? (
        secret.kind === "basic" || secret.kind === "digest" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="User name" hint={secret.hint}>
              {(id) => (
                <Input
                  id={id}
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  autoComplete="off"
                />
              )}
            </Field>
            <Field label="Password">
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  autoComplete="off"
                />
              )}
            </Field>
          </div>
        ) : (
          <Field
            label={secret.label}
            hint={`${secret.hint} Kept encrypted on Hearth; never shown again.`}
          >
            {(id) => (
              <Input
                id={id}
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoComplete="off"
              />
            )}
          </Field>
        )
      ) : null}
      {params.map((p) => (
        <Field key={p.key} label={p.label} hint={p.hint}>
          {(id) => (
            <Input
              id={id}
              value={values[p.key] ?? ""}
              onChange={(e) => setValues({ ...values, [p.key]: e.target.value })}
            />
          )}
        </Field>
      ))}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title">
          {(id) => (
            <Input
              id={id}
              value={title}
              maxLength={40}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Who can see it"
          hint={isApp && choice.widget.private ? "It shows something private." : undefined}
        >
          {(id) => (
            <Select
              id={id}
              value={audience}
              onChange={(e) => setAudience(e.target.value as Audience)}
            >
              <option value="everyone">Everyone</option>
              <option value="adults">Adults</option>
              <option value="admin">Admin only</option>
            </Select>
          )}
        </Field>
      </div>
      <ErrorNote error={error} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" onClick={install} busy={busy} disabled={!ready}>
          Add to {view.profile ? "my page" : "the guest page"}
        </Button>
      </div>
    </div>
  );
}

/** Delete a widget for good (the admin's): off every page, and its key with it. Asks twice. */
function DeleteWidget({ id, name }: { id: string; name: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [sure, setSure] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        if (!sure) {
          setSure(true);
          return;
        }
        try {
          await api.del(`/api/admin/widgets/${id}`);
          toast(`${name} is deleted`);
          await qc.invalidateQueries({ queryKey: keys.home });
        } catch (e) {
          toast((e as Error).message, "bad");
        }
        setSure(false);
      }}
      onBlur={() => setSure(false)}
      aria-label={sure ? `Really delete ${name}?` : `Delete ${name} for good`}
      title={sure ? "Press again to delete it from every page" : "Delete it for good"}
      className={cx(
        "flex h-8 flex-none items-center gap-1 rounded-lg px-2 text-[12.5px] font-semibold",
        sure ? "bg-bad/15 text-bad" : "text-muted hover:text-bad",
      )}
    >
      <Trash2 className="size-4" />
      {sure ? "Delete?" : null}
    </button>
  );
}
