/** Chat with the home's AI servers. Conversations stay in this browser, per person. */
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowUp, Cpu, MessageSquarePlus, Square, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatEvent, ChatMessage } from "../../shared/api";
import { Answer } from "../components/Markdown";
import { ModelPicker } from "../components/ModelPicker";
import { Button, IconButton, Select } from "../components/ui";
import { local, streamEvents } from "../lib/api";
import { cx } from "../lib/format";
import { useHome, useServers } from "../lib/queries";

interface Turn extends ChatMessage {
  meta?: string;
  error?: boolean;
}
interface Conversation {
  id: string;
  title: string;
  server?: string;
  model?: string;
  turns: Turn[];
  at: number;
}

export function ChatPage() {
  const { data: view } = useHome();
  const servers = useServers(Boolean(view?.canChat));
  const search = useSearch({ from: "/chat" });
  const navigate = useNavigate();
  const storeKey = `hearth.chats.${view?.profile?.id ?? "guest"}`;
  const [chats, setChats] = useState<Conversation[]>(() => local.get(storeKey, []));
  const [activeId, setActiveId] = useState<string | null>(chats[0]?.id ?? null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const active = chats.find((c) => c.id === activeId) ?? null;
  const upServers = (servers.data ?? []).filter((s) => s.state !== "down");
  const [server, setServer] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const serverInfo = (servers.data ?? []).find((s) => s.id === server);

  useEffect(() => {
    if (!server && servers.data?.length) {
      const first = active?.server
        ? servers.data.find((s) => s.id === active.server)
        : (upServers[0] ?? servers.data[0]);
      if (first) setServer(first.id);
    }
  }, [servers.data, server, active?.server, upServers]);
  // Fill in a model when the server changes; never override one being typed.
  const filledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!serverInfo || filledFor.current === serverInfo.id) return;
    filledFor.current = serverInfo.id;
    const names = serverInfo.models.map((m) => m.name);
    setModel(
      active?.model && (names.includes(active.model) || !names.length)
        ? active.model
        : (serverInfo.defaultModel ?? names[0] ?? ""),
    );
  }, [serverInfo, active?.model]);

  const persist = (next: Conversation[]) => {
    setChats(next);
    local.set(storeKey, next.slice(0, 50));
  };

  // Started from the Ask widget: send its question straight away.
  const asked = useRef(false);
  useEffect(() => {
    if (search.q && !asked.current && server && model) {
      asked.current = true;
      void send(search.q, true);
      void navigate({ to: "/chat", search: {}, replace: true });
    }
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when a turn is added or finishes
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [active?.turns.length, busy]);

  const send = async (text: string, fresh = false) => {
    if (!text.trim() || busy || !server) return;
    let conv: Conversation =
      !fresh && active
        ? active
        : { id: crypto.randomUUID(), title: text.slice(0, 60), turns: [], at: Date.now() };
    conv = {
      ...conv,
      server,
      model,
      at: Date.now(),
      turns: [
        ...conv.turns,
        { role: "user", content: text.trim() },
        { role: "assistant", content: "" },
      ],
    };
    let list = [conv, ...chats.filter((c) => c.id !== conv.id)];
    persist(list);
    setActiveId(conv.id);
    setInput("");
    setBusy(true);
    setWaiting(null);
    const controller = new AbortController();
    abort.current = controller;
    const update = (fn: (t: Turn) => Turn) => {
      conv = { ...conv, turns: [...conv.turns.slice(0, -1), fn(conv.turns.at(-1) as Turn)] };
      list = [conv, ...list.filter((c) => c.id !== conv.id)];
      setChats(list);
    };
    try {
      await streamEvents<ChatEvent>(
        "/api/ai/chat",
        {
          server,
          model,
          messages: conv.turns
            .slice(0, -1)
            .filter((t) => !t.error)
            .map(({ role, content }) => ({ role, content })),
        },
        (e) => {
          if (e.type === "text") {
            setWaiting(null);
            update((t) => ({ ...t, content: t.content + e.text }));
          } else if (e.type === "wait") setWaiting(`${e.reason} Trying again in ${e.seconds}s…`);
          else if (e.type === "error") update((t) => ({ ...t, content: e.message, error: true }));
          else if (e.type === "done")
            update((t) => ({
              ...t,
              meta: `${model} · ${(e.ms / 1000).toFixed(1)}s${e.tokens ? ` · ${e.tokens} tokens` : ""}`,
            }));
        },
        controller.signal,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError")
        update((t) => ({ ...t, content: (e as Error).message, error: true }));
    } finally {
      setBusy(false);
      setWaiting(null);
      abort.current = null;
      persist(list);
    }
  };

  const sorted = useMemo(() => [...chats].sort((a, b) => b.at - a.at), [chats]);

  if (view && !view.canChat) {
    return (
      <main className="shell py-16 text-center">
        <p className="font-semibold">
          Chat isn't turned on for {view.profile ? view.profile.name : "guests"}.
        </p>
        <p className="mt-1 text-sm text-muted">The admin chooses who can chat in Settings → AI.</p>
      </main>
    );
  }

  return (
    <main className="shell grid gap-4 pt-4 pb-6 md:grid-cols-[240px_1fr]">
      <aside className="hidden md:block">
        <Button variant="primary" className="mb-3 w-full" onClick={() => setActiveId(null)}>
          <MessageSquarePlus className="size-4" /> New chat
        </Button>
        <ul className="grid gap-1">
          {sorted.map((c) => (
            <li key={c.id} className="group flex items-center">
              <button
                type="button"
                onClick={() => setActiveId(c.id)}
                className={cx(
                  "min-w-0 grow truncate rounded-xl px-3 py-2 text-left text-[13.5px]",
                  c.id === activeId
                    ? "bg-surface font-semibold ring-1 ring-line"
                    : "text-muted hover:text-ink",
                )}
              >
                {c.title}
              </button>
              <IconButton
                label="Delete chat"
                className="size-8 opacity-0 group-hover:opacity-100"
                onClick={() => {
                  persist(chats.filter((x) => x.id !== c.id));
                  if (activeId === c.id) setActiveId(null);
                }}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      </aside>

      <section className="card flex min-h-[calc(100dvh-120px)] flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <Select
            aria-label="AI server"
            value={server}
            onChange={(e) => {
              setServer(e.target.value);
              setModel("");
            }}
            className="h-9 w-auto max-w-[45%]"
          >
            {(servers.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {s.state === "up" ? "" : `(${s.state})`}
              </option>
            ))}
          </Select>
          <ModelPicker
            value={model}
            onChange={setModel}
            models={serverInfo?.models ?? []}
            className="h-9 w-44 text-[14px]"
          />
          <Link
            to="/compute"
            className="ml-auto flex items-center gap-1 text-[12.5px] font-semibold text-muted hover:text-ink"
          >
            <Cpu className="size-4" /> Computers
          </Link>
          <Button size="sm" className="md:hidden" onClick={() => setActiveId(null)}>
            New
          </Button>
        </div>

        <div className="grow overflow-y-auto px-4 py-5 sm:px-6">
          {!active?.turns.length ? (
            <div className="grid h-full place-items-center text-center">
              <div>
                <p className="font-heading text-2xl font-bold">What would you like to know?</p>
                <p className="mt-1 text-sm text-muted">
                  Answers come from {serverInfo?.name ?? "the home's AI"}, on your own network.
                </p>
              </div>
            </div>
          ) : (
            <div className="mx-auto grid max-w-3xl gap-4">
              {active.turns.map((t, i) => (
                <div
                  key={i}
                  className={cx("flex", t.role === "user" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cx(
                      "max-w-[88%] rounded-2xl px-4 py-2.5",
                      t.role === "user"
                        ? "bg-accent text-white"
                        : t.error
                          ? "border border-bad/30 bg-bad/10"
                          : "bg-[var(--c-surface-2)]",
                    )}
                  >
                    {t.role === "assistant" &&
                    !t.content &&
                    busy &&
                    i === active.turns.length - 1 ? (
                      <span className="flex gap-1 py-2" role="status" aria-label="Thinking">
                        {[0, 1, 2].map((n) => (
                          <span
                            key={n}
                            className="size-2 animate-bounce rounded-full bg-muted"
                            style={{ animationDelay: `${n * 120}ms` }}
                          />
                        ))}
                      </span>
                    ) : t.role === "assistant" ? (
                      <Answer text={t.content} />
                    ) : (
                      <p className="whitespace-pre-wrap text-[15px]">{t.content}</p>
                    )}
                    {t.meta ? <p className="mt-1 text-[11px] text-muted">{t.meta}</p> : null}
                  </div>
                </div>
              ))}
              {waiting ? <p className="text-center text-[13px] text-warn">{waiting}</p> : null}
              <div ref={bottom} />
            </div>
          )}
        </div>

        <form
          className="flex items-end gap-2 border-t border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            placeholder={servers.data?.length ? "Message…" : "No AI servers yet"}
            aria-label="Message"
            className="max-h-48 min-h-11 grow resize-none rounded-xl border border-line bg-[var(--c-background)] px-3 py-2.5 text-[15px] focus:border-accent focus:outline-none [field-sizing:content]"
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
              disabled={!input.trim() || !server}
              className="grid size-11 place-items-center rounded-xl bg-accent text-white disabled:opacity-40"
            >
              <ArrowUp className="size-5" />
            </button>
          )}
        </form>
      </section>
    </main>
  );
}
