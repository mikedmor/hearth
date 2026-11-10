/** The AI computers on the network: up or busy, how fast, which models, what's loaded now. */
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Cpu, MemoryStick, RefreshCw, Settings } from "lucide-react";
import { useState } from "react";
import type { AiServerStatus } from "../../shared/api";
import { Button } from "../components/ui";
import { api } from "../lib/api";
import { bytes, cx } from "../lib/format";
import { keys, useHome, useServers } from "../lib/queries";

export function ComputePage() {
  const { data: view } = useHome();
  const allowed = Boolean(view?.canChat || view?.session.admin);
  const servers = useServers(allowed);
  const qc = useQueryClient();
  const [checking, setChecking] = useState(false);

  const recheck = async () => {
    setChecking(true);
    try {
      qc.setQueryData(keys.servers, await api.post<AiServerStatus[]>("/api/ai/servers/check"));
    } finally {
      setChecking(false);
    }
  };

  if (view && !allowed)
    return (
      <main className="shell py-16 text-center text-muted">
        AI isn't turned on for this profile.
      </main>
    );

  const list = servers.data ?? [];
  const up = list.filter((s) => s.state === "up").length;
  const loaded = list.flatMap((s) => s.loaded);

  return (
    <main className="shell pt-6 pb-16">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">AI computers</h1>
          <p className="mt-1 text-muted">
            {list.length
              ? `${up} of ${list.length} answering · ${loaded.length} model${loaded.length === 1 ? "" : "s"} loaded right now`
              : "No AI servers yet."}
          </p>
        </div>
        <div className="flex gap-2">
          {view?.session.admin ? (
            <Link to="/settings" search={{ tab: "ai" }}>
              <Button size="sm">
                <Settings className="size-4" /> Servers
              </Button>
            </Link>
          ) : null}
          <Button size="sm" onClick={recheck} busy={checking}>
            <RefreshCw className="size-4" /> Check now
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {list.map((s) => (
          <ServerCard key={s.id} s={s} />
        ))}
      </div>
      {!list.length && view?.session.admin ? (
        <div className="card p-8 text-center">
          <p className="font-semibold">Add the home's AI server</p>
          <p className="mt-1 text-sm text-muted">
            Any Ollama or OpenAI-compatible server works, on this network or (if you choose) the
            internet.
          </p>
          <Link
            to="/settings"
            search={{ tab: "ai" }}
            className="mt-4 inline-block font-semibold text-accent"
          >
            Settings → AI
          </Link>
        </div>
      ) : null}
    </main>
  );
}

function ServerCard({ s }: { s: AiServerStatus }) {
  const tone =
    s.state === "up" ? "good" : s.state === "busy" ? "warn" : s.state === "down" ? "bad" : "muted";
  return (
    <article className="card overflow-hidden">
      <header className="flex items-center gap-3 border-b border-line px-5 py-4">
        <span
          className={cx(
            "grid size-11 place-items-center rounded-2xl",
            `bg-${tone}/15 text-${tone}`,
          )}
          style={{
            background: `color-mix(in oklab, var(--c-${toneVar(tone)}) 15%, transparent)`,
            color: `var(--c-${toneVar(tone)})`,
          }}
        >
          <Cpu className="size-6" />
        </span>
        <div className="min-w-0 grow">
          <h2 className="truncate text-lg font-bold">{s.name}</h2>
          <p className="truncate text-[12.5px] text-muted">
            {s.kind === "ollama" ? "Ollama API" : "OpenAI-compatible"}
            {s.version ? ` · v${s.version}` : ""}
            {s.url ? ` · ${s.url}` : ""}
          </p>
        </div>
        <span
          className="rounded-full px-2.5 py-1 text-[12px] font-bold"
          style={{
            background: `color-mix(in oklab, var(--c-${toneVar(tone)}) 15%, transparent)`,
            color: `var(--c-${toneVar(tone)})`,
          }}
        >
          {{ up: "Answering", busy: "Busy", down: "Not answering", unknown: "Checking" }[s.state]}
          {s.ms ? ` · ${s.ms} ms` : ""}
        </span>
      </header>
      <div className="grid gap-4 px-5 py-4">
        {s.note ? (
          <p className={cx("text-[13.5px]", s.state === "up" ? "text-muted" : "text-ink")}>
            {s.note}
          </p>
        ) : null}
        {s.loaded.length ? (
          <section>
            <h3 className="mb-2 text-[12px] font-bold uppercase tracking-wider text-muted">
              Loaded now
            </h3>
            <ul className="grid gap-2">
              {s.loaded.map((m) => (
                <li
                  key={m.name}
                  className="flex items-center gap-3 rounded-xl bg-accent/10 px-3 py-2"
                >
                  <MemoryStick className="size-4 text-accent" />
                  <span className="grow font-semibold">{m.name}</span>
                  <span className="text-[12.5px] text-muted tabular-nums">
                    {m.vram ? `${bytes(m.vram)} on GPU` : bytes(m.size)}
                    {m.until
                      ? ` · until ${new Date(m.until).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {s.models.length ? (
          <section>
            <h3 className="mb-2 text-[12px] font-bold uppercase tracking-wider text-muted">
              Models ({s.models.length})
            </h3>
            <ul className="flex flex-wrap gap-1.5">
              {s.models.map((m) => (
                <li
                  key={m.name}
                  className={cx(
                    "rounded-full border px-2.5 py-1 text-[12.5px]",
                    m.name === s.defaultModel ? "border-accent font-semibold" : "border-line",
                  )}
                  title={
                    [m.family, m.parameters, m.quantization, m.size ? bytes(m.size) : ""]
                      .filter(Boolean)
                      .join(" · ") || undefined
                  }
                >
                  {m.name}
                  {m.parameters ? <span className="ml-1 text-muted">{m.parameters}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {s.checkedAt ? (
          <p className="text-[11.5px] text-muted">
            Checked {new Date(s.checkedAt).toLocaleTimeString()}
          </p>
        ) : null}
      </div>
    </article>
  );
}

const toneVar = (t: string) =>
  ({ good: "positive", warn: "warning", bad: "negative", muted: "muted" })[t] ?? "muted";
