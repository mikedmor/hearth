/**
 * The AI servers widget: each server, and for one that shares work across the home's computers,
 * each computer as a card: its graphics card and memory, what it's doing, and how much it's done.
 */
import { useNavigate } from "@tanstack/react-router";
import { Cpu, Monitor } from "lucide-react";
import type { AiWidgetData } from "../../../shared/api";
import { cx } from "../../lib/format";
import { useHome } from "../../lib/queries";

type Machine = NonNullable<AiWidgetData["servers"][number]["machines"]>[number];

const gb = (mib?: number) =>
  mib ? `${mib >= 10_240 ? Math.round(mib / 1024) : (mib / 1024).toFixed(1)} GB` : undefined;
const secs = (ms?: number) =>
  ms === undefined ? undefined : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;

/** "windows" → "Windows". */
const osName = (os?: string) =>
  !os
    ? undefined
    : /^win/i.test(os)
      ? "Windows"
      : /^mac|darwin/i.test(os)
        ? "macOS"
        : /^linux/i.test(os)
          ? "Linux"
          : os;

function machineState(m: Machine): { text: string; tone: "good" | "warn" | "off" | "muted" } {
  if (!m.online) return { text: "Asleep", tone: "off" };
  if (m.busy) return { text: `Answering${m.loaded ? ` · ${m.loaded}` : ""}`, tone: "warn" };
  if (!m.available) return { text: m.reason ?? "Not lending now", tone: "muted" };
  return { text: m.loaded ? `Ready · ${m.loaded}` : "Ready", tone: "good" };
}

const DOT = {
  good: "bg-good",
  warn: "bg-warn animate-pulse",
  off: "bg-(--c-line-strong)",
  muted: "bg-(--c-line-strong)",
};

export function AiBody({ d }: { d: AiWidgetData }) {
  const navigate = useNavigate();
  // The admin can open Devices, where each AI server and its computers are.
  const admin = Boolean(useHome().data?.session.admin);
  if (!d.servers.length)
    return (
      <p className="text-sm text-muted">No AI servers yet. The admin adds them in Settings → AI.</p>
    );
  return (
    <div className="grid gap-4">
      {d.servers.map((s) => {
        const ms = s.machines ?? [];
        const online = ms.filter((m) => m.online);
        const vram = online.reduce((n, m) => n + (m.vramMib ?? 0), 0);
        const served = ms.reduce((n, m) => n + (m.served ?? 0), 0);
        return (
          <section key={s.id} className="grid gap-2.5">
            <button
              type="button"
              onClick={() => (admin ? navigate({ to: "/devices" }) : undefined)}
              className={cx(
                "flex w-full items-center gap-3 rounded-xl text-left",
                admin ? "hover:bg-(--c-surface-2)" : "cursor-default",
              )}
            >
              <span
                className={cx(
                  "grid size-10 flex-none place-items-center rounded-xl",
                  s.state === "up"
                    ? "bg-good/15 text-good"
                    : s.state === "busy"
                      ? "bg-warn/15 text-warn"
                      : "bg-bad/15 text-bad",
                )}
              >
                <Cpu className="size-5" />
              </span>
              <span className="grid min-w-0 grow">
                <span className="truncate text-[15px] font-semibold">{s.name}</span>
                <span className="truncate text-[12.5px] text-muted">
                  {s.state === "up"
                    ? `${s.models} model${s.models === 1 ? "" : "s"}${s.loaded.length ? ` · ${s.loaded.join(", ")} loaded` : ""}`
                    : s.state === "busy"
                      ? "Busy right now"
                      : s.state === "down"
                        ? "Not answering"
                        : "Checking…"}
                </span>
              </span>
              {s.ms ? <span className="text-[12px] tabular-nums text-muted">{s.ms} ms</span> : null}
            </button>

            {ms.length ? (
              <div className="grid gap-1 border-t border-line pt-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted">
                  {[
                    `${online.length} of ${ms.length} computer${ms.length === 1 ? "" : "s"} sharing`,
                    vram ? `${gb(vram)} graphics memory` : null,
                    served ? `${served.toLocaleString()} answers` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <ul className="grid">
                  {ms.map((m) => {
                    const st = machineState(m);
                    const what = [m.gpu, gb(m.vramMib)].filter(Boolean).join(" · ") || osName(m.os);
                    // A long state ("… is using the graphics card") gets its own line, wrapped.
                    const long = st.text.length > 16;
                    const tone = st.tone === "warn" ? "font-semibold text-warn" : "text-ink";
                    return (
                      <li
                        key={m.name}
                        className={cx("flex items-start gap-2.5 py-1.5", !m.online && "opacity-60")}
                      >
                        <span className="relative flex-none">
                          <span className="grid size-8 place-items-center rounded-lg bg-(--c-surface-2) text-muted">
                            <Monitor className="size-4" />
                          </span>
                          <span
                            className={cx(
                              "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-(--c-surface)",
                              DOT[st.tone],
                            )}
                          />
                        </span>
                        <span className="grid min-w-0 grow">
                          <span className="truncate text-[13.5px] font-semibold">{m.name}</span>
                          {what ? (
                            <span className="truncate text-[11.5px] text-muted" title={m.gpu}>
                              {what}
                            </span>
                          ) : null}
                          {long ? (
                            <span className={cx("text-[12px] leading-snug", tone)}>{st.text}</span>
                          ) : null}
                        </span>
                        <span className="grid min-w-0 max-w-[45%] flex-none grid-cols-[minmax(0,auto)] justify-items-end text-right">
                          {long ? null : (
                            <span className={cx("truncate text-[12.5px]", tone)}>{st.text}</span>
                          )}
                          {m.served ? (
                            <span className="text-[11px] tabular-nums text-muted">
                              {m.served.toLocaleString()} answer{m.served === 1 ? "" : "s"}
                              {m.avgMs ? ` · ${secs(m.avgMs)} each` : ""}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
