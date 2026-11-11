/** The widget library (admin): every widget, where it's used, and making new ones. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Audience, Widget, WidgetType } from "../../shared/config";
import type { DevicesView } from "../../shared/devices";
import { KEY as DEVICES_KEY, title as deviceTitle } from "../components/devices/parts";
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
import { DEFAULT_TITLES } from "../components/widgets/WidgetCard";
import { api } from "../lib/api";
import { slugify } from "../lib/format";
import { keys, useAdminConfig, useHome } from "../lib/queries";

const BUILTIN_HELP: Record<Exclude<WidgetType, "custom">, string> = {
  status: "How many services are up, from Hearth's own checks.",
  note: "A line for the family, like “Plex is down tonight”.",
  countdown: "Days to birthdays, holidays and trips.",
  ai: "The AI servers: up, busy, what's loaded.",
  pinball: "A pinball table running VPin Studio: what's being played, high scores, players.",
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
                  <span className="rounded-full bg-(--c-surface-2) px-2 py-0.5 text-[11px] font-semibold text-muted">
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
        <WidgetSettings
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
          ? { ...base, type, options: { events: [], show: 3, calendar: true } }
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

/**
 * A widget's settings, like a section's: its name and who sees it, a built-in one's options, and
 * for a custom one the way to its designer. Delete takes it off everyone's page.
 */
export function WidgetSettings({
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
  const navigate = useNavigate();
  const remove = async () => {
    if (
      !window.confirm(
        `Delete “${widget.title ?? DEFAULT_TITLES[widget.type]}” for good? It comes off everyone's page.`,
      )
    )
      return;
    try {
      await api.del(`/api/admin/widgets/${widget.id}`);
      toast("Widget deleted");
      await qc.invalidateQueries();
      onClose();
    } catch (e) {
      setError(e);
    }
  };
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
      title={`${widget.title ?? DEFAULT_TITLES[widget.type]}: settings`}
      wide
      footer={
        <>
          <Button variant="ghost" className="mr-auto text-bad" onClick={() => void remove()}>
            <Trash2 className="size-4" /> Delete
          </Button>
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
          {w.type === "custom" ? (
            <Field label="Description" hint="Shown in the widget list.">
              {(id) => (
                <Input
                  id={id}
                  value={w.description ?? ""}
                  onChange={(e) => setW({ ...w, description: e.target.value || undefined })}
                />
              )}
            </Field>
          ) : (
            <Field label="Id" error={idTaken ? "Already taken." : undefined}>
              {(id) => (
                <Input
                  id={id}
                  value={w.id}
                  onChange={(e) => setW({ ...w, id: slugify(e.target.value) })}
                />
              )}
            </Field>
          )}
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
        {w.type === "custom" ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-3">
            <div className="grid">
              <span className="font-semibold">What it shows</span>
              <span className="text-[13px] text-muted">
                {w.doc.sources.length} source{w.doc.sources.length === 1 ? "" : "s"},{" "}
                {w.doc.blocks.length} block{w.doc.blocks.length === 1 ? "" : "s"}. Change them in
                the designer.
              </span>
            </div>
            <Button
              onClick={() => {
                onClose();
                void navigate({ to: "/widgets/$id", params: { id: widget.id } });
              }}
            >
              <Sparkles className="size-4" /> Open the designer
            </Button>
          </div>
        ) : null}
        {w.type === "pinball" ? (
          <PinballTable
            value={w.options.device}
            onChange={(device) => setW({ ...w, options: { ...w.options, device } })}
          />
        ) : null}
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
            <Toggle
              label="Also what's next on each person's calendar"
              hint="Everyone sees their own calendar's next events among these."
              checked={w.options.calendar}
              onChange={(calendar) => setW({ ...w, options: { ...w.options, calendar } })}
            />
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

/** Which pinball table the widget shows: the devices where VPin Studio was found. */
function PinballTable({
  value,
  onChange,
}: {
  value?: string;
  onChange: (device: string | undefined) => void;
}) {
  const q = useQuery({
    queryKey: DEVICES_KEY,
    queryFn: () => api.get<DevicesView>("/api/admin/devices"),
  });
  const tables = (q.data?.devices ?? []).filter((d) => d.vpin && d.device);
  return (
    <Field
      label="Table"
      hint={
        tables.length
          ? "A device running VPin Studio."
          : "None found yet. On the Devices page, open the table and Look for services."
      }
    >
      {(id) => (
        <Select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">The first one found</option>
          {tables.map((d) => (
            <option key={d.key} value={d.device?.id}>
              {deviceTitle(d)}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
