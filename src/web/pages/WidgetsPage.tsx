/** The widget library (admin): every widget, where it's used, and making new ones. */
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Audience, Widget, WidgetType } from "../../shared/config";
import {
  Button,
  ErrorNote,
  Field,
  IconButton,
  Input,
  Modal,
  Select,
  TextArea,
  useToast,
} from "../components/ui";
import { DEFAULT_TITLES } from "../components/widgets/WidgetCard";
import { api } from "../lib/api";
import { slugify } from "../lib/format";
import { keys, useAdminConfig, useHome } from "../lib/queries";

const BUILTIN_HELP: Record<Exclude<WidgetType, "custom">, string> = {
  status: "How many services are up, from Hearth's own checks.",
  note: "A line for the family, like “Plex is down tonight”.",
  countdown: "Days to birthdays, holidays and trips.",
  ai: "The AI computers: up, busy, what's loaded.",
  ask: "A box to ask the AI, which opens the chat.",
  clock: "The time here, and in other time zones.",
  agenda: "What's on today and this week, from each person's own calendar.",
};

export function WidgetsPage() {
  const { data: view } = useHome();
  const admin = useAdminConfig(Boolean(view?.session.admin));
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Widget | null>(null);
  const [adding, setAdding] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();

  if (view && !view.session.admin)
    return (
      <main className="shell py-16 text-center text-muted">
        Sign in as the admin to manage widgets.
      </main>
    );
  const cfg = admin.data?.config;
  if (!cfg) return null;

  const usedBy = (id: string) => {
    const names = cfg.profiles
      .filter((p) => p.layout.widgets.some((w) => w.id === id))
      .map((p) => p.name);
    if (cfg.settings.guest.layout.widgets.some((w) => w.id === id)) names.push("guests");
    return names;
  };

  const remove = async (w: Widget) => {
    if (!window.confirm(`Delete “${w.title ?? w.id}”? It comes off everyone's page.`)) return;
    try {
      await api.del(`/api/admin/widgets/${w.id}`);
      toast("Widget deleted");
      await qc.invalidateQueries();
    } catch (e) {
      toast((e as Error).message, "bad");
    }
  };

  return (
    <main className="shell pt-6 pb-16">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">Widgets</h1>
          <p className="mt-1 text-muted">Everyone adds these to their own page with Arrange.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Built-in widget
          </Button>
          <Button
            variant="primary"
            onClick={() => navigate({ to: "/widgets/$id", params: { id: "new" } })}
          >
            <Sparkles className="size-4" /> New custom widget
          </Button>
        </div>
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {cfg.widgets.map((w) => {
          const used = usedBy(w.id);
          return (
            <li key={w.id} className="card flex items-start gap-4 p-4">
              <div className="min-w-0 grow">
                <div className="flex items-center gap-2">
                  <h2 className="truncate font-bold">{w.title ?? DEFAULT_TITLES[w.type]}</h2>
                  <span className="rounded-full bg-[var(--c-surface-2)] px-2 py-0.5 text-[11px] font-semibold text-muted">
                    {w.type === "custom"
                      ? `${w.doc.sources.length} source${w.doc.sources.length === 1 ? "" : "s"}`
                      : "built in"}
                  </span>
                  {w.audience !== "everyone" ? (
                    <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">
                      {w.audience}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-[13px] text-muted">
                  {w.type === "custom" ? (w.description ?? "Custom widget") : BUILTIN_HELP[w.type]}
                </p>
                <p className="mt-1.5 text-[12px] text-muted">
                  {used.length ? `On ${used.join(", ")}'s page` : "Not on any page yet"}
                </p>
              </div>
              <div className="flex gap-1">
                {w.type === "custom" ? (
                  <Link to="/widgets/$id" params={{ id: w.id }}>
                    <Button size="sm">Edit</Button>
                  </Link>
                ) : (
                  <Button size="sm" onClick={() => setEditing(w)}>
                    Edit
                  </Button>
                )}
                <IconButton label="Delete" onClick={() => remove(w)}>
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
            </li>
          );
        })}
      </ul>
      {editing ? (
        <BuiltinEditor
          widget={editing}
          onClose={() => setEditing(null)}
          taken={cfg.widgets.map((w) => w.id)}
        />
      ) : null}
      {adding ? (
        <AddBuiltin
          onClose={() => setAdding(false)}
          taken={cfg.widgets.map((w) => w.id)}
          onMade={(w) => {
            setAdding(false);
            setEditing(w);
            void qc.invalidateQueries({ queryKey: keys.admin });
          }}
        />
      ) : null}
    </main>
  );
}

function AddBuiltin({
  onClose,
  taken,
  onMade,
}: {
  onClose: () => void;
  taken: string[];
  onMade: (w: Widget) => void;
}) {
  const [error, setError] = useState<unknown>(null);
  const make = async (type: Exclude<WidgetType, "custom">) => {
    let id = type as string;
    for (let n = 2; taken.includes(id); n++) id = `${type}-${n}`;
    const base = { id, audience: "everyone" as Audience, title: DEFAULT_TITLES[type] };
    const w: Widget =
      type === "note"
        ? { ...base, type, options: { text: "Hello from the admin!", tone: "info" } }
        : type === "countdown"
          ? { ...base, type, options: { events: [], show: 3 } }
          : ({ ...base, type } as Widget);
    try {
      await api.put(`/api/admin/widgets/${id}`, w);
      onMade(w);
    } catch (e) {
      setError(e);
    }
  };
  return (
    <Modal open onClose={onClose} title="Add a built-in widget">
      <ul className="grid gap-2">
        {(Object.keys(BUILTIN_HELP) as Exclude<WidgetType, "custom">[]).map((t) => (
          <li key={t}>
            <button
              type="button"
              onClick={() => make(t)}
              className="card flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:border-accent"
            >
              <span className="grid">
                <span className="font-semibold">{DEFAULT_TITLES[t]}</span>
                <span className="text-[12.5px] text-muted">{BUILTIN_HELP[t]}</span>
              </span>
              <Plus className="size-5 text-accent" />
            </button>
          </li>
        ))}
      </ul>
      <ErrorNote error={error} />
    </Modal>
  );
}

function BuiltinEditor({
  widget,
  onClose,
  taken,
}: {
  widget: Widget;
  onClose: () => void;
  taken: string[];
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [w, setW] = useState<Widget>(widget);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/api/admin/widgets/${widget.id}`, w);
      toast("Saved");
      await qc.invalidateQueries();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const idTaken = w.id !== widget.id && taken.includes(w.id);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${widget.title ?? DEFAULT_TITLES[widget.type]}`}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} busy={busy} disabled={idTaken}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Title">
            {(id) => (
              <Input
                id={id}
                value={w.title ?? ""}
                onChange={(e) => setW({ ...w, title: e.target.value || undefined })}
              />
            )}
          </Field>
          <Field label="Id" error={idTaken ? "Already taken." : undefined}>
            {(id) => (
              <Input
                id={id}
                value={w.id}
                onChange={(e) => setW({ ...w, id: slugify(e.target.value) })}
              />
            )}
          </Field>
          <Field label="Who can see it">
            {(id) => (
              <Select
                id={id}
                value={w.audience}
                onChange={(e) => setW({ ...w, audience: e.target.value as Audience })}
              >
                <option value="everyone">Everyone</option>
                <option value="adults">Adults</option>
                <option value="admin">Admin only</option>
              </Select>
            )}
          </Field>
        </div>
        {w.type === "note" ? (
          <>
            <Field label="Note">
              {(id) => (
                <TextArea
                  id={id}
                  className="font-sans text-[15px]"
                  value={w.options.text}
                  onChange={(e) => setW({ ...w, options: { ...w.options, text: e.target.value } })}
                />
              )}
            </Field>
            <Field label="Feel">
              {(id) => (
                <Select
                  id={id}
                  value={w.options.tone}
                  onChange={(e) =>
                    setW({ ...w, options: { ...w.options, tone: e.target.value as "info" } })
                  }
                >
                  <option value="info">📌 Information</option>
                  <option value="warning">⚠️ Warning</option>
                  <option value="celebrate">🎉 Celebration</option>
                </Select>
              )}
            </Field>
          </>
        ) : null}
        {w.type === "countdown" ? (
          <div className="grid gap-2">
            <p className="text-[13px] font-semibold">Events</p>
            {w.options.events.map((e, i) => (
              <div
                key={i}
                className="grid grid-cols-[3.5rem_1fr_9.5rem_auto_auto] items-center gap-2"
              >
                <Input
                  aria-label="Emoji"
                  value={e.emoji ?? ""}
                  onChange={(ev) =>
                    setW({
                      ...w,
                      options: {
                        ...w.options,
                        events: w.options.events.map((x, j) =>
                          j === i ? { ...x, emoji: ev.target.value || undefined } : x,
                        ),
                      },
                    })
                  }
                />
                <Input
                  aria-label="Name"
                  value={e.name}
                  onChange={(ev) =>
                    setW({
                      ...w,
                      options: {
                        ...w.options,
                        events: w.options.events.map((x, j) =>
                          j === i ? { ...x, name: ev.target.value } : x,
                        ),
                      },
                    })
                  }
                />
                <Input
                  aria-label="Date"
                  type="date"
                  value={e.date}
                  onChange={(ev) =>
                    setW({
                      ...w,
                      options: {
                        ...w.options,
                        events: w.options.events.map((x, j) =>
                          j === i ? { ...x, date: ev.target.value } : x,
                        ),
                      },
                    })
                  }
                />
                <label className="flex items-center gap-1 text-[12.5px]">
                  <input
                    type="checkbox"
                    checked={e.yearly}
                    onChange={(ev) =>
                      setW({
                        ...w,
                        options: {
                          ...w.options,
                          events: w.options.events.map((x, j) =>
                            j === i ? { ...x, yearly: ev.target.checked } : x,
                          ),
                        },
                      })
                    }
                  />{" "}
                  Yearly
                </label>
                <IconButton
                  label="Remove"
                  onClick={() =>
                    setW({
                      ...w,
                      options: { ...w.options, events: w.options.events.filter((_, j) => j !== i) },
                    })
                  }
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
            ))}
            <Button
              size="sm"
              className="justify-self-start"
              onClick={() =>
                setW({
                  ...w,
                  options: {
                    ...w.options,
                    events: [
                      ...w.options.events,
                      { name: "", date: new Date().toISOString().slice(0, 10), yearly: false },
                    ],
                  },
                })
              }
            >
              <Plus className="size-4" /> Add an event
            </Button>
          </div>
        ) : null}
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}
