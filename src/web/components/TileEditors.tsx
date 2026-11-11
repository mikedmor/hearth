/**
 * Adding and changing sections and links, on the start page and in Settings. One model for
 * everything: the admin manages the house's, everyone manages their own ("Just me"). One hook gives
 * a page an `edit()` and the dialog to render.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Lock, User, Users } from "lucide-react";
import { useEffect, useState } from "react";
import type { LinkSuggestion } from "../../shared/access";
import type { Access, HomeView, PublicProfile } from "../../shared/api";
import type { Audience, Tile } from "../../shared/config";
import { api } from "../lib/api";
import { cx, slugify } from "../lib/format";
import { IconPicker } from "./IconPicker";
import { Avatar } from "./Picker";
import { SvgIcon } from "./Tile";
import { Button, ErrorNote, Field, Input, Modal, Select, Spinner, Toggle, useToast } from "./ui";

export type EditTarget =
  /** A link; id null makes a new one, in `group` when given. */
  | { kind: "link"; id: string | null; group?: string }
  /** A section; id null makes a new one. */
  | { kind: "section"; id: string | null };

/** A section a link may go in, as the forms need it. */
export interface SectionOption {
  id: string;
  name: string;
  access: Access;
  /** This person may put a link here. */
  canAdd: boolean;
  /** How many links it holds (for deleting). */
  count: number;
}

/** What the forms need to know about where they're used. */
export interface EditContext {
  admin: boolean;
  /** The open profile, whose own things "Just me" makes. */
  me: string | null;
  sections: SectionOption[];
  people: PublicProfile[];
}

export function contextFromView(view: HomeView): EditContext {
  return {
    admin: view.session.admin,
    me: view.profile && view.canAddOwn ? view.profile.id : null,
    sections: view.groups.map((g) => ({
      id: g.id,
      name: g.name,
      access: g.access,
      canAdd: g.canAdd,
      count: g.tiles.length,
    })),
    people: view.profiles,
  };
}

export function useTileEditors(ctx: EditContext) {
  const [target, setTarget] = useState<EditTarget | null>(null);
  const close = () => setTarget(null);
  const modal = target ? (
    target.kind === "link" ? (
      <LinkForm id={target.id} group={target.group} ctx={ctx} onClose={close} />
    ) : (
      <SectionForm id={target.id} ctx={ctx} onClose={close} />
    )
  ) : null;
  return { edit: setTarget, modal };
}

function useDone() {
  const qc = useQueryClient();
  const toast = useToast();
  return async (msg: string) => {
    toast(msg);
    await qc.invalidateQueries();
  };
}

// ---------------------------------------------------------------------------
// Who can see it

/** Who sees a section or link, as the forms edit it. */
export interface Visibility {
  audience: Audience;
  people?: string[];
  owner?: string;
}

type Choice = "everyone" | "adults" | "admin" | "people" | "mine";

const choiceOf = (v: Visibility): Choice =>
  v.owner ? "mine" : v.people?.length ? "people" : v.audience;

export const ACCESS_WORDS: Record<Choice, string> = {
  everyone: "Everyone",
  adults: "Adults",
  admin: "Only the admin",
  people: "Only some people",
  mine: "Just me",
};

export function visibilityFromAccess(a: Access, me: string | null): Visibility {
  if (a.kind === "mine") return { audience: "everyone", owner: me ?? undefined };
  if (a.kind === "people") return { audience: "everyone", people: a.people };
  return { audience: a.audience };
}

/** A small badge for anything not shown to everyone; `compact` keeps just the icon (and a count). */
export function AccessBadge({
  access,
  people,
  compact,
  className,
}: {
  access: Access;
  people: PublicProfile[];
  compact?: boolean;
  className?: string;
}) {
  if (access.kind === "audience" && access.audience === "everyone") return null;
  const [Icon, text, title] =
    access.kind === "mine"
      ? [User, "Only you", "Only you see this"]
      : access.kind === "people"
        ? [
            Users,
            `${access.people.length}`,
            `Only ${access.people.map((id) => people.find((p) => p.id === id)?.name ?? id).join(", ")} (and the admin)`,
          ]
        : access.audience === "adults"
          ? [Users, "Adults", "Adults and the admin"]
          : [Lock, "Admin", "Only the admin"];
  return (
    <span
      title={title}
      role="img"
      aria-label={title}
      className={cx(
        "inline-flex h-5 flex-none items-center gap-1 rounded-full bg-(--c-surface-2) px-1.5 text-[10.5px] font-semibold tracking-normal text-muted normal-case",
        className,
      )}
    >
      <Icon className="size-3" />
      {compact && access.kind !== "people" ? null : text}
    </span>
  );
}

function VisibilityField({
  value,
  onChange,
  ctx,
  locked,
}: {
  value: Visibility;
  onChange: (v: Visibility) => void;
  ctx: EditContext;
  /** Forced to "Just me" (a link in someone's own section). */
  locked?: boolean;
}) {
  const choice = choiceOf(value);
  if (!ctx.admin || locked) {
    return (
      <div className="grid gap-1.5">
        <p className="text-[13px] font-semibold">Who can see it</p>
        <p className="flex items-center gap-1.5 text-[13.5px] text-muted">
          <User className="size-4" /> Just you.{" "}
          {locked
            ? "It's in your own section."
            : "Your own sections and links are only on your page."}
        </p>
      </div>
    );
  }
  const set = (c: Choice) => {
    if (c === "mine") onChange({ audience: "everyone", owner: ctx.me ?? undefined });
    else if (c === "people")
      onChange({
        audience: "everyone",
        people: value.people?.length ? value.people : ctx.people.slice(0, 1).map((p) => p.id),
      });
    else onChange({ audience: c });
  };
  return (
    <div className="grid gap-2">
      <Field
        label="Who can see it"
        hint={
          choice === "people"
            ? "The admin sees it too."
            : choice === "mine"
              ? "On your page only."
              : choice === "adults"
                ? "Adults and the admin; not children or guests."
                : undefined
        }
      >
        {(id) => (
          <Select id={id} value={choice} onChange={(e) => set(e.target.value as Choice)}>
            {(["everyone", "adults", "admin", "people", "mine"] as const)
              .filter((c) => c !== "mine" || ctx.me)
              .filter((c) => c !== "people" || ctx.people.length > 0)
              .map((c) => (
                <option key={c} value={c}>
                  {ACCESS_WORDS[c]}
                </option>
              ))}
          </Select>
        )}
      </Field>
      {choice === "people" ? (
        <div className="flex flex-wrap gap-1.5">
          {ctx.people.map((p) => {
            const on = value.people?.includes(p.id) ?? false;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = on
                    ? (value.people ?? []).filter((x) => x !== p.id)
                    : [...(value.people ?? []), p.id];
                  onChange({ audience: "everyone", people: next });
                }}
                className={cx(
                  "flex h-8 items-center gap-1.5 rounded-full border pr-3 pl-1 text-[13px] font-semibold",
                  on ? "border-accent bg-accent/15" : "border-line text-muted",
                )}
              >
                <Avatar p={p} size="xs" /> {p.name}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Links

interface Recognised {
  /** False when the address is on the internet and Hearth may not call it. */
  checked: boolean;
  reachable: boolean;
  title: string;
  app: {
    id: string;
    name: string;
    icon: string;
    color?: string;
    category: string;
    description: string;
    widgets: { id: string; name: string }[];
  } | null;
}

/** Add or change a link: the house's (admin) or your own. */
export function LinkForm({
  id,
  group,
  ctx,
  onClose,
  from,
}: {
  id: string | null;
  group?: string;
  ctx: EditContext;
  onClose: () => void;
  /** A new link to a suggested service, filled in. */
  from?: LinkSuggestion;
}) {
  const existing = useQuery({
    queryKey: ["tile", id],
    queryFn: () => api.get<Tile>(`/api/tiles/${encodeURIComponent(id ?? "")}`),
    enabled: id !== null,
    staleTime: 0,
    gcTime: 0,
  });
  if (id !== null && !existing.data) {
    return (
      <Modal open onClose={onClose} title="Link">
        {existing.error ? <ErrorNote error={existing.error} /> : <Spinner />}
      </Modal>
    );
  }
  const start = (): Tile => {
    const sections = ctx.sections.filter((s) => s.canAdd);
    // A service on the network is the house's: for the admin, it starts in a house section.
    const chosen =
      sections.find((s) => s.id === group) ??
      (from && ctx.admin ? sections.find((s) => s.access.kind !== "mine") : undefined) ??
      sections[0];
    // A link starts as the section's: your own in your own section, the house's otherwise (admin).
    const own = !ctx.admin || chosen?.access.kind === "mine";
    return {
      id: "",
      name: "",
      url: "https://",
      group: chosen?.id ?? "",
      audience: "everyone",
      owner: own ? (ctx.me ?? undefined) : undefined,
      check: true,
      keywords: [],
      newTab: false,
      ...(from
        ? {
            name: from.name,
            url: from.url,
            icon: from.icon,
            color: from.color,
            app: from.app,
            description: from.description,
          }
        : {}),
    };
  };
  return (
    <LinkFormBody tile={existing.data ?? start()} isNew={id === null} ctx={ctx} onClose={onClose} />
  );
}

function LinkFormBody({
  tile,
  isNew,
  ctx,
  onClose,
}: {
  tile: Tile;
  isNew: boolean;
  ctx: EditContext;
  onClose: () => void;
}) {
  const done = useDone();
  const [t, setT] = useState<Tile>(tile);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [seen, setSeen] = useState<Recognised | null>(null);
  const own = Boolean(t.owner);
  const section = ctx.sections.find((s) => s.id === t.group);
  const inOwnSection = section?.access.kind === "mine";

  // Name the app at this address (the admin's recognition).
  useEffect(() => {
    const url = t.url.trim();
    if (!ctx.admin || !/^https?:\/\/[^/\s]+/.test(url)) return;
    const timer = setTimeout(async () => {
      try {
        setSeen(await api.post<Recognised>("/api/admin/recognize", { url }));
      } catch {
        setSeen(null);
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [t.url, ctx.admin]);

  // Services the home has that no link leads to yet (the admin's, for a new link).
  const suggestions = useQuery({
    queryKey: ["link-suggestions"],
    queryFn: () => api.get<{ suggestions: LinkSuggestion[] }>("/api/admin/link-suggestions"),
    enabled: ctx.admin && isNew,
    staleTime: 30_000,
  });
  const suggest = (s: LinkSuggestion) => {
    setT({
      ...t,
      name: s.name,
      url: s.url,
      icon: s.icon,
      color: s.color ?? t.color,
      app: s.app,
      description: t.description ?? s.description,
    });
  };

  const applyApp = (app: NonNullable<Recognised["app"]>) =>
    setT({
      ...t,
      name: t.name.trim() ? t.name : app.name,
      icon: app.icon,
      color: app.color ?? t.color,
      app: app.id,
      description: t.description ?? app.description,
    });

  // Sections this link may go in: your own links go in any you can add to; the house's links
  // only in the house's sections.
  const sections = ctx.sections.filter(
    (s) => (s.canAdd && (own || s.access.kind !== "mine")) || s.id === t.group,
  );

  const setVisibility = (v: Visibility) => {
    const next = { ...t, audience: v.audience, people: v.people, owner: v.owner };
    // The house's links can't stay in someone's own section.
    if (!v.owner && inOwnSection) {
      const house = ctx.sections.find((s) => s.canAdd && s.access.kind !== "mine");
      if (house) next.group = house.id;
    }
    setT(next);
  };
  const setSection = (gid: string) => {
    const s = ctx.sections.find((x) => x.id === gid);
    // Someone's own section takes only their own links.
    if (s?.access.kind === "mine")
      setT({
        ...t,
        group: gid,
        owner: ctx.me ?? undefined,
        people: undefined,
        audience: "everyone",
      });
    else setT({ ...t, group: gid });
  };

  const valid = t.name.trim() && /^https?:\/\/[^\s/]+/.test(t.url.trim()) && t.group;
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const path = isNew ? slugify(t.name) || "link" : tile.id;
      await api.put(`/api/tiles/${encodeURIComponent(path)}`, {
        ...t,
        id: isNew ? path : tile.id,
        name: t.name.trim(),
        url: t.url.trim(),
        keywords: t.keywords.filter(Boolean),
      });
      await done(isNew ? "Link added" : "Link saved");
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm(own ? `Delete ${tile.name}?` : `Delete ${tile.name} for everyone?`)) return;
    setBusy(true);
    try {
      await api.del(`/api/tiles/${encodeURIComponent(tile.id)}`);
      await done("Link deleted");
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? "Add a link" : `Edit ${tile.name}`}
      wide
      footer={
        <>
          {!isNew ? (
            <Button variant="danger" className="mr-auto" onClick={remove} busy={busy}>
              Delete
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} busy={busy} disabled={!valid}>
            Save
          </Button>
        </>
      }
    >
      {isNew && suggestions.data?.suggestions.length ? (
        <div className="mb-4 grid gap-1.5">
          <p className="text-[12.5px] font-semibold text-muted">
            Services on your network with no link yet
          </p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.data.suggestions.map((s) => (
              <button
                key={s.url}
                type="button"
                onClick={() => suggest(s)}
                title={s.url}
                className={cx(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] font-semibold hover:border-accent",
                  t.url === s.url ? "border-accent bg-accent/10" : "border-line",
                )}
              >
                {s.svg ? <SvgIcon svg={s.svg} className="size-4" /> : null}
                {s.name}
                <span className="font-normal text-muted">{hostOf(s.url)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {seen?.app ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-[13.5px]">
          <span className="grow">
            This looks like <b>{seen.app.name}</b> ({seen.app.category}).{" "}
            {seen.app.widgets.length
              ? `It has ${seen.app.widgets.length} ready-made widget${seen.app.widgets.length === 1 ? "" : "s"}: add ${seen.app.widgets.length === 1 ? "it" : "them"} with Edit → Add a widget.`
              : ""}
          </span>
          {t.app !== seen.app.id ? (
            <Button size="sm" variant="primary" onClick={() => seen.app && applyApp(seen.app)}>
              Use its name and icon
            </Button>
          ) : (
            <span className="text-[12px] font-semibold text-accent">Linked</span>
          )}
        </div>
      ) : seen?.checked && !seen.reachable ? (
        <p className="mb-4 text-[12.5px] text-muted">
          Hearth can't reach that address from where it runs. That's fine for a link; it just won't
          show as up.
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          {(fid) => (
            <Input
              id={fid}
              value={t.name}
              maxLength={40}
              placeholder="Plex"
              onChange={(e) => setT({ ...t, name: e.target.value })}
            />
          )}
        </Field>
        <Field label="Address">
          {(fid) => (
            <Input
              id={fid}
              value={t.url}
              inputMode="url"
              onChange={(e) => setT({ ...t, url: e.target.value })}
            />
          )}
        </Field>
        <Field label="Section">
          {(fid) => (
            <Select id={fid} value={t.group} onChange={(e) => setSection(e.target.value)}>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.access.kind === "mine" ? " (yours)" : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <VisibilityField
          value={{ audience: t.audience, people: t.people, owner: t.owner }}
          onChange={setVisibility}
          ctx={ctx}
          locked={inOwnSection}
        />
        <div className="sm:col-span-2">
          <IconPicker
            value={t.icon}
            onChange={(icon) => setT({ ...t, icon })}
            name={t.name}
            url={t.url}
            color={t.color}
            canUpload={ctx.admin}
          />
        </div>
        <Field label="Colour">
          {(fid) => (
            <Input
              id={fid}
              type="color"
              value={t.color ?? "#e8743b"}
              onChange={(e) => setT({ ...t, color: e.target.value })}
              className="p-1"
            />
          )}
        </Field>
        <div className="flex items-end">
          <Toggle
            label="Open in a new tab"
            checked={t.newTab}
            onChange={(v) => setT({ ...t, newTab: v })}
          />
        </div>
      </div>
      <button
        type="button"
        onClick={() => setMore(!more)}
        aria-expanded={more}
        className="mt-4 flex items-center gap-1 text-[13px] font-semibold text-muted hover:text-ink"
      >
        <ChevronDown className={cx("size-4 transition", more && "rotate-180")} /> More options
      </button>
      {more ? (
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label="Description" className="sm:col-span-2" hint="Shown on cards and in search.">
            {(fid) => (
              <Input
                id={fid}
                value={t.description ?? ""}
                maxLength={80}
                onChange={(e) => setT({ ...t, description: e.target.value || undefined })}
              />
            )}
          </Field>
          <Field label="Search words" hint="Separated by commas.">
            {(fid) => (
              <Input
                id={fid}
                value={t.keywords.join(", ")}
                onChange={(e) =>
                  setT({
                    ...t,
                    keywords: e.target.value
                      .split(",")
                      .map((k) => k.trim())
                      .slice(0, 10),
                  })
                }
              />
            )}
          </Field>
          {!own ? (
            <Field
              label="Short link"
              hint={`start.home/${t.short === false ? "…" : (t.short ?? (t.id || slugify(t.name)))}`}
            >
              {(fid) => (
                <Input
                  id={fid}
                  value={t.short === false ? "" : (t.short ?? "")}
                  placeholder={t.id || slugify(t.name)}
                  onChange={(e) =>
                    setT({ ...t, short: e.target.value ? slugify(e.target.value) : undefined })
                  }
                />
              )}
            </Field>
          ) : null}
          {!own ? (
            <div className="grid gap-3 sm:col-span-2">
              <Toggle
                label="Check if it's up"
                hint="Turn off for things that wake up or log every visit."
                checked={t.check}
                onChange={(v) => setT({ ...t, check: v })}
              />
              {t.check ? (
                <Field
                  label="Check this address instead (optional)"
                  hint="Like the service's own port: http://192.168.1.20:8420"
                >
                  {(fid) => (
                    <Input
                      id={fid}
                      value={t.checkUrl ?? ""}
                      onChange={(e) => setT({ ...t, checkUrl: e.target.value || undefined })}
                    />
                  )}
                </Field>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="mt-4">
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Sections

export function SectionForm({
  id,
  ctx,
  onClose,
}: {
  id: string | null;
  ctx: EditContext;
  onClose: () => void;
}) {
  const done = useDone();
  const old = id ? ctx.sections.find((s) => s.id === id) : undefined;
  const [name, setName] = useState(old?.name ?? "");
  const [vis, setVis] = useState<Visibility>(
    old
      ? visibilityFromAccess(old.access, ctx.me)
      : ctx.admin
        ? { audience: "everyone" }
        : { audience: "everyone", owner: ctx.me ?? undefined },
  );
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const path = id ?? (slugify(name) || "section");
      await api.put(`/api/groups/${encodeURIComponent(path)}`, {
        id: path,
        name: name.trim(),
        ...vis,
      });
      await done(id ? "Section saved" : "Section added");
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!id || !old) return;
    const n = old.count;
    if (
      !window.confirm(
        n
          ? `Delete "${old.name}" and the ${n} link${n === 1 ? "" : "s"} in it?`
          : `Delete "${old.name}"?`,
      )
    )
      return;
    setBusy(true);
    try {
      await api.del(`/api/groups/${encodeURIComponent(id)}${n ? "?withLinks=1" : ""}`);
      await done("Section deleted");
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={old ? `Edit ${old.name}` : "New section"}
      footer={
        <>
          {old ? (
            <Button variant="danger" className="mr-auto" onClick={remove} busy={busy}>
              Delete
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} busy={busy} disabled={!name.trim()}>
            {old ? "Save" : "Add section"}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void save();
        }}
      >
        <Field label="Name">
          {(fid) => (
            <Input
              id={fid}
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              placeholder="Media"
            />
          )}
        </Field>
        <VisibilityField value={vis} onChange={setVis} ctx={ctx} />
        {old?.access.kind !== "mine" && vis.owner && old?.count ? (
          <p className="text-[12.5px] text-muted">
            Only your own links can be in a section that's just yours: move the house's links out
            first.
          </p>
        ) : null}
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

const hostOf = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};
