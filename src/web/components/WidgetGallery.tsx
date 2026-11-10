/**
 * Adding a widget: widgets that already exist (anyone), and for the admin, ready-made ones
 * for the apps the home runs, general ones (clock, weather, news, this server), or a new one.
 * A ready-made widget asks only for what it needs: the app's address, its key, a setting or two.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Plus, Search, Sparkles, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import type { HomeView, IconSvg } from "../../shared/api";
import type { Audience } from "../../shared/config";
import { api } from "../lib/api";
import { cx } from "../lib/format";
import { TileIcon } from "./Tile";
import { Button, ErrorNote, Field, Input, Modal, Select, useToast } from "./ui";
import { DEFAULT_TITLES } from "./widgets/WidgetCard";

interface Secret {
  label: string;
  hint: string;
  kind?: "key" | "basic" | "bearer";
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
  yours: { tile: string; name: string; url: string; app: string }[];
  allowInternet: boolean;
}

type Choice =
  | { kind: "app"; app: AppSummary; widget: AppSummary["widgets"][number]; base?: string }
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
      return app ? app.widgets.map((w) => ({ app, widget: w, base: y.url, tile: y.name })) : [];
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

  const tabs = [
    { id: "list" as const, label: "On your list", show: true },
    {
      id: "yours" as const,
      label: `Your apps${yours.length ? ` (${yours.length})` : ""}`,
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

          {tab === "list" ? (
            view.library.length ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {view.library.map((w) => (
                  <li key={w.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onAdd(w.id);
                        onClose();
                      }}
                      className="card flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:border-accent"
                    >
                      <span className="grid">
                        <span className="font-semibold">{w.title ?? DEFAULT_TITLES[w.type]}</span>
                        <span className="text-[12.5px] text-muted">
                          {w.type === "custom"
                            ? "Custom widget"
                            : `Built in: ${DEFAULT_TITLES[w.type].toLowerCase()}`}
                        </span>
                      </span>
                      <Plus className="size-5 text-accent" />
                    </button>
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
            )
          ) : null}

          {tab === "yours" ? (
            yours.length ? (
              <Cards
                items={yours.map((y) => ({
                  key: `${y.app.id}/${y.widget.id}/${y.base}`,
                  name: y.widget.name,
                  detail: `${y.widget.description} From your tile “${y.tile}”.`,
                  svg: y.app.svg,
                  color: y.app.color,
                  onPick: () =>
                    setChoice({ kind: "app", app: y.app, widget: y.widget, base: y.base }),
                }))}
              />
            ) : (
              <p className="text-sm text-muted">
                None of your tiles is linked to an app with widgets yet. Edit a tile: when Hearth
                recognises its address, choose “Use its name and icon”. Or pick from All apps.
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
  const secret = isApp ? choice.widget.secret : undefined;
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
      : secret.kind === "bearer"
        ? `Bearer ${key.trim()}`
        : key.trim();
  const ready =
    (!isApp || /^https?:\/\/[^/\s]+/.test(base)) &&
    (!secret || (secret.kind === "basic" ? user && pass : key.trim())) &&
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
      {secret ? (
        secret.kind === "basic" ? (
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
