/**
 * Making a custom widget: describe it to the AI designer, start from a template, or
 * write the JSON. The preview runs the real sources on the server, so what you see is what the
 * family will see, and what each source returned is right there to bind to.
 */
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowUp,
  Bot,
  Braces,
  Check,
  ClipboardCopy,
  LayoutTemplate,
  Loader2,
  RefreshCw,
  Square,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DesignEvent, PreviewResult } from "../../shared/api";
import type { Audience, Widget } from "../../shared/config";
import type { WidgetDocInput } from "../../shared/widget-doc";
import { Markdown } from "../components/Markdown";
import { ModelPicker } from "../components/ModelPicker";
import { Button, ErrorNote, Field, Input, Select, TextArea, useToast } from "../components/ui";
import { Blocks } from "../components/widgets/Blocks";
import { api, streamEvents } from "../lib/api";
import { cx, slugify } from "../lib/format";
import { useAdminConfig, useHome, useServers } from "../lib/queries";

const TEMPLATES: { name: string; hint: string; doc: WidgetDocInput }[] = [
  {
    name: "Services as lights",
    hint: "From Hearth's own checks. Works right away.",
    doc: {
      v: 1,
      sources: [{ id: "home", kind: "hearth", what: "status" }],
      blocks: [
        {
          id: "count",
          kind: "stat",
          w: 5,
          label: "Answering",
          value: "$home.up",
          sub: "of {{ $home.total }} services",
          tone: '$home.down > 0 ? "warning" : "positive"',
        },
        {
          id: "lights",
          kind: "lights",
          w: 7,
          items: "$home.tiles",
          itemLabel: "$item.name",
          itemState: "$item.state",
        },
      ],
    },
  },
  {
    name: "A number from an API",
    hint: "Poll a JSON address and show one value with a history line.",
    doc: {
      v: 1,
      sources: [
        {
          id: "api",
          kind: "http",
          url: "http://192.168.1.20:8080/api/stats",
          every: 30,
          track: "$api.value",
          keep: 60,
        },
      ],
      blocks: [
        {
          id: "value",
          kind: "stat",
          w: 12,
          label: "Value",
          value: "round($api.value, 1)",
          spark: "$history.api",
        },
      ],
    },
  },
  {
    name: "Camera snapshot",
    hint: "A picture that refreshes; Hearth fetches it, so the camera's address stays private.",
    doc: {
      v: 1,
      sources: [],
      blocks: [
        {
          id: "cam",
          kind: "image",
          w: 12,
          src: "http://192.168.1.60/snapshot.jpg",
          every: 10,
          height: 220,
        },
      ],
    },
  },
  {
    name: "Live WebSocket feed",
    hint: "Stay connected and show the newest message's fields.",
    doc: {
      v: 1,
      sources: [
        {
          id: "feed",
          kind: "websocket",
          url: "ws://192.168.1.20:8080/ws",
          mode: "merge",
          track: "$feed.value",
          keep: 120,
        },
      ],
      blocks: [
        {
          id: "now",
          kind: "stat",
          w: 6,
          label: "Now",
          value: "$feed.value",
          spark: "$history.feed",
        },
        { id: "line", kind: "line", w: 6, label: "Last two minutes", points: "$history.feed" },
      ],
    },
  },
];

const EMPTY: WidgetDocInput = TEMPLATES[0]?.doc as WidgetDocInput;

interface DesignTurn {
  role: "user" | "assistant";
  content: string;
  notes?: string[];
  error?: boolean;
}

export function WidgetEditorPage() {
  const { id } = useParams({ from: "/widgets/$id" });
  const { data: view } = useHome();
  const admin = useAdminConfig(Boolean(view?.session.admin));
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const isNew = id === "new";
  const existing = admin.data?.config.widgets.find(
    (w): w is Extract<Widget, { type: "custom" }> => w.id === id && w.type === "custom",
  );

  const [meta, setMeta] = useState({
    id: "",
    title: "",
    description: "",
    audience: "everyone" as Audience,
  });
  const [text, setText] = useState(JSON.stringify(EMPTY, null, 2));
  const [tab, setTab] = useState<"designer" | "json" | "templates">("designer");
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loaded || !admin.data) return;
    if (existing) {
      setMeta({
        id: existing.id,
        title: existing.title ?? "",
        description: existing.description ?? "",
        audience: existing.audience,
      });
      setText(JSON.stringify(existing.doc, null, 2));
    }
    setLoaded(true);
  }, [admin.data, existing, loaded]);

  const parsed = useMemo(() => {
    try {
      return { doc: JSON.parse(text) as WidgetDocInput, error: null };
    } catch (e) {
      return { doc: null, error: (e as Error).message };
    }
  }, [text]);

  // Run the draft on the server a moment after it stops changing.
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const runPreview = async (doc: unknown) => {
    setPreviewing(true);
    try {
      setPreview(await api.post<PreviewResult>("/api/widgets/preview", { doc }));
    } catch (e) {
      setPreview({
        issues: [{ path: "(preview)", message: (e as Error).message }],
        frame: null,
        samples: {},
      });
    } finally {
      setPreviewing(false);
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: run when the draft changes, not when the function is recreated
  useEffect(() => {
    if (!parsed.doc) return;
    const t = setTimeout(() => void runPreview(parsed.doc), 700);
    return () => clearTimeout(t);
  }, [parsed.doc]);

  if (view && !view.session.admin)
    return (
      <main className="shell py-16 text-center text-muted">
        Sign in as the admin to make widgets.
      </main>
    );
  if (!admin.data) return null;
  if (!isNew && !existing)
    return (
      <main className="shell py-16 text-center text-muted">
        There's no custom widget called “{id}”.
      </main>
    );

  const taken = admin.data.config.widgets.map((w) => w.id).filter((x) => x !== id);
  const widgetId = meta.id || slugify(meta.title || "widget");
  const idTaken = taken.includes(widgetId);

  const save = async () => {
    if (!parsed.doc) return;
    setSaving(true);
    setSaveError(null);
    try {
      const w = {
        id: widgetId,
        type: "custom",
        title: meta.title || undefined,
        description: meta.description || undefined,
        audience: meta.audience,
        doc: parsed.doc,
      };
      await api.put(`/api/admin/widgets/${isNew ? widgetId : id}`, w);
      toast("Widget saved. Add it to a page with Arrange.");
      await qc.invalidateQueries();
      if (isNew || widgetId !== id)
        void navigate({ to: "/widgets/$id", params: { id: widgetId }, replace: true });
    } catch (e) {
      setSaveError(e);
    } finally {
      setSaving(false);
    }
  };

  const setDoc = (doc: unknown) => setText(JSON.stringify(doc, null, 2));

  return (
    <main className="shell pt-4 pb-16">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/widgets"
          className="flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"
        >
          <ArrowLeft className="size-4" /> Widgets
        </Link>
        <div className="flex gap-2">
          <CopyPrompt />
          <Button
            variant="primary"
            onClick={save}
            busy={saving}
            disabled={!parsed.doc || idTaken || Boolean(preview?.issues.length)}
          >
            <Check className="size-4" /> Save widget
          </Button>
        </div>
      </div>

      <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-[2fr_1fr_1fr]">
        <Field label="Title">
          {(fid) => (
            <Input
              id={fid}
              value={meta.title}
              placeholder="NAS health"
              onChange={(e) =>
                setMeta({ ...meta, title: e.target.value, id: isNew && !meta.id ? "" : meta.id })
              }
            />
          )}
        </Field>
        <Field label="Id" error={idTaken ? "Already taken." : undefined}>
          {(fid) => (
            <Input
              id={fid}
              value={meta.id || (isNew ? slugify(meta.title || "") : "")}
              placeholder="nas-health"
              onChange={(e) => setMeta({ ...meta, id: slugify(e.target.value) })}
            />
          )}
        </Field>
        <Field label="Who can see it">
          {(fid) => (
            <Select
              id={fid}
              value={meta.audience}
              onChange={(e) => setMeta({ ...meta, audience: e.target.value as Audience })}
            >
              <option value="everyone">Everyone</option>
              <option value="adults">Adults</option>
              <option value="admin">Admin only</option>
            </Select>
          )}
        </Field>
        <Field label="What it shows" className="sm:col-span-3">
          {(fid) => (
            <Input
              id={fid}
              value={meta.description}
              placeholder="Temperature, CPU and free space on the NAS"
              onChange={(e) => setMeta({ ...meta, description: e.target.value })}
            />
          )}
        </Field>
      </div>
      <ErrorNote error={saveError} />

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="card flex min-h-[560px] flex-col overflow-hidden">
          <div className="flex gap-1 border-b border-line p-2" role="tablist">
            {(
              [
                ["designer", "AI designer", Bot],
                ["templates", "Templates", LayoutTemplate],
                ["json", "JSON", Braces],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cx(
                  "flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[13px] font-semibold",
                  tab === key ? "bg-accent text-white" : "text-muted hover:text-ink",
                )}
              >
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>
          {tab === "designer" ? <Designer draft={parsed.doc} onDraft={setDoc} /> : null}
          {tab === "templates" ? (
            <ul className="grid gap-2 p-4">
              {TEMPLATES.map((t) => (
                <li key={t.name}>
                  <button
                    type="button"
                    onClick={() => {
                      setDoc(t.doc);
                      setTab("json");
                    }}
                    className="card w-full px-4 py-3 text-left hover:border-accent"
                  >
                    <span className="block font-semibold">{t.name}</span>
                    <span className="text-[12.5px] text-muted">{t.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {tab === "json" ? (
            <div className="flex grow flex-col gap-2 p-3">
              <TextArea
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
                className="grow resize-none"
                aria-label="Widget JSON"
              />
              {parsed.error ? (
                <p className="text-[12.5px] text-bad">Not valid JSON yet: {parsed.error}</p>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="grid content-start gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-bold uppercase tracking-wider text-muted">Preview</h2>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => parsed.doc && runPreview(parsed.doc)}
              busy={previewing}
            >
              <RefreshCw className="size-4" /> Run again
            </Button>
          </div>
          <article className="card p-4 sm:p-[18px]">
            <h3 className="mb-2.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
              {meta.title || "Widget"}
            </h3>
            {preview?.frame ? (
              <Blocks blocks={preview.frame.blocks} />
            ) : previewing ? (
              <div className="skeleton h-20" />
            ) : (
              <p className="text-sm text-muted">Nothing to show yet.</p>
            )}
          </article>
          {preview?.issues.length ? (
            <div className="rounded-xl border border-bad/30 bg-bad/10 p-3 text-[13px]">
              <p className="mb-1 flex items-center gap-1.5 font-semibold text-bad">
                <TriangleAlert className="size-4" /> Fix these before saving
              </p>
              <ul className="list-disc pl-5">
                {preview.issues.map((i) => (
                  <li key={`${i.path}${i.message}`}>
                    <code className="text-[12px]">{i.path}</code>: {i.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {preview?.frame?.blocks.some((b) => b.error) ? (
            <div className="rounded-xl border border-warn/30 bg-warn/10 p-3 text-[13px]">
              {preview.frame.blocks
                .filter((b) => b.error)
                .map((b) => (
                  <p key={b.id}>
                    <b>{b.id}</b>: {b.error}
                  </p>
                ))}
            </div>
          ) : null}
          {preview && Object.keys(preview.samples).length ? (
            <div className="card p-4">
              <h3 className="mb-2 text-[13px] font-bold uppercase tracking-wider text-muted">
                What the sources returned
              </h3>
              {Object.entries(preview.samples).map(([sid, s]) => (
                <details key={sid} open className="mb-2">
                  <summary className="cursor-pointer text-[13.5px] font-semibold">
                    ${sid}{" "}
                    {s.ok ? (
                      <span className="text-good">ok</span>
                    ) : (
                      <span className="text-bad">· {s.error}</span>
                    )}
                  </summary>
                  {s.ok ? (
                    <pre className="mt-1.5 max-h-64 overflow-auto rounded-lg bg-[var(--c-background)] p-2 text-[11.5px] ring-1 ring-line">
                      {JSON.stringify(s.sample, null, 2)}
                    </pre>
                  ) : null}
                </details>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function CopyPrompt() {
  const toast = useToast();
  return (
    <Button
      onClick={async () => {
        try {
          const text = await api.text("/api/widgets-guide");
          await navigator.clipboard.writeText(text);
          toast("Copied. Paste it into any AI assistant, then paste its answer into JSON.");
        } catch (e) {
          toast((e as Error).message, "bad");
        }
      }}
    >
      <ClipboardCopy className="size-4" /> Prompt for any assistant
    </Button>
  );
}

function Designer({ draft, onDraft }: { draft: unknown; onDraft: (doc: unknown) => void }) {
  const servers = useServers();
  const [server, setServer] = useState("");
  const [model, setModel] = useState("");
  const [turns, setTurns] = useState<DesignTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const info = servers.data?.find((s) => s.id === server);

  useEffect(() => {
    if (!server && servers.data?.length)
      setServer((servers.data.find((s) => s.state === "up") ?? servers.data[0])?.id ?? "");
  }, [servers.data, server]);
  useEffect(() => {
    if (info && !model) setModel(info.defaultModel ?? info.models[0]?.name ?? "");
  }, [info, model]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const history = [...turns, { role: "user" as const, content: text }];
    setTurns([...history, { role: "assistant", content: "", notes: [] }]);
    setInput("");
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    const patch = (fn: (t: DesignTurn) => DesignTurn) =>
      setTurns((all) => [...all.slice(0, -1), fn(all.at(-1) as DesignTurn)]);
    try {
      await streamEvents<DesignEvent>(
        "/api/ai/design",
        {
          server,
          model,
          draft,
          messages: history
            .filter((t) => !t.error)
            .map((t) => ({ role: t.role, content: t.content })),
        },
        (e) => {
          if (e.type === "status") setStatus(e.text);
          else if (e.type === "wait") setStatus(`${e.reason} Waiting ${e.seconds}s…`);
          else if (e.type === "fetched")
            patch((t) => ({
              ...t,
              notes: [
                ...(t.notes ?? []),
                `${e.ok ? "Looked at" : "Couldn't read"} ${e.url} (${e.note})`,
              ],
            }));
          else if (e.type === "draft") {
            onDraft(e.doc);
            patch((t) => ({
              ...t,
              notes: [
                ...(t.notes ?? []),
                e.issues.length
                  ? `Draft has ${e.issues.length} problem(s) left; see the preview.`
                  : "Draft is in the editor. Check the preview.",
              ],
            }));
          } else if (e.type === "say")
            patch((t) => ({ ...t, content: t.content ? `${t.content}\n\n${e.text}` : e.text }));
          else if (e.type === "error") patch((t) => ({ ...t, content: e.message, error: true }));
        },
        controller.signal,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError")
        patch((t) => ({ ...t, content: (e as Error).message, error: true }));
    } finally {
      // Never leave an empty answer: say the stream ended without one.
      patch((t) =>
        t.content || t.notes?.some((n) => n.startsWith("Draft")) || controller.signal.aborted
          ? t
          : {
              ...t,
              content: "The designer stopped without an answer. Try again, or pick another model.",
              error: true,
            },
      );
      setBusy(false);
      setStatus(null);
    }
  };

  if (servers.data && !servers.data.length) {
    return (
      <div className="grid grow place-items-center p-6 text-center">
        <div>
          <p className="font-semibold">The designer needs an AI server.</p>
          <p className="mt-1 text-sm text-muted">
            Add one in Settings → AI, or use Templates, JSON, or “Prompt for any assistant”.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex grow flex-col">
      <div className="flex flex-wrap gap-2 border-b border-line px-3 py-2">
        <Select
          aria-label="AI server"
          value={server}
          onChange={(e) => {
            setServer(e.target.value);
            setModel("");
          }}
          className="h-8 w-auto text-[13px]"
        >
          {(servers.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <ModelPicker
          value={model}
          onChange={setModel}
          models={info?.models ?? []}
          className="h-8 w-44 text-[13px]"
        />
      </div>
      <div className="grid grow content-start gap-3 overflow-y-auto p-4">
        {turns.length === 0 ? (
          <div className="text-[14px] text-muted">
            <p className="font-semibold text-ink">Describe the widget you want.</p>
            <p className="mt-1">
              For example: “A widget with every service as a light”, or “Show the CPU and containers
              from Glances at http://&lt;NAS address&gt;:61208/api/4/all”. It knows your tiles'
              addresses; for anything else, give it the API's address and it looks at what comes
              back before building. It won't guess addresses.
            </p>
            <p className="mt-2">
              API keys go in Settings → Secrets, and widgets use them as {"{{secret:name}}"}, so
              they never appear here.
            </p>
          </div>
        ) : null}
        {turns.map((t, i) => (
          <div
            key={i}
            className={cx(
              "rounded-2xl px-3.5 py-2.5",
              t.role === "user"
                ? "ml-8 bg-accent text-white"
                : t.error
                  ? "mr-8 border border-bad/30 bg-bad/10"
                  : "mr-8 bg-[var(--c-surface-2)]",
            )}
          >
            {t.notes?.length ? (
              <ul className="mb-1 grid gap-0.5 text-[12px] text-muted">
                {t.notes.map((n) => (
                  <li key={n}>· {n}</li>
                ))}
              </ul>
            ) : null}
            {t.content ? (
              t.role === "assistant" ? (
                <Markdown text={t.content} />
              ) : (
                <p className="whitespace-pre-wrap text-[14.5px]">{t.content}</p>
              )
            ) : null}
            {!t.content && busy && i === turns.length - 1 ? (
              <p className="flex items-center gap-2 text-[13px] text-muted">
                <Loader2 className="size-4 animate-spin" /> {status ?? "Thinking…"}
              </p>
            ) : null}
          </div>
        ))}
      </div>
      <form
        className="flex items-end gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          placeholder="What should it show?"
          aria-label="Describe the widget"
          className="max-h-40 min-h-11 grow resize-none rounded-xl border border-line bg-[var(--c-background)] px-3 py-2 text-[14.5px] focus:border-accent focus:outline-none"
        />
        {busy ? (
          <button
            type="button"
            onClick={() => abort.current?.abort()}
            aria-label="Stop"
            className="grid size-11 place-items-center rounded-xl bg-ink text-[var(--c-background)]"
          >
            <Square className="size-4 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            aria-label="Send"
            disabled={!input.trim() || !model}
            className="grid size-11 place-items-center rounded-xl bg-accent text-white disabled:opacity-40"
          >
            <ArrowUp className="size-5" />
          </button>
        )}
      </form>
    </div>
  );
}
