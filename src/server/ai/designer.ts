/**
 * The AI widget designer. The person says what they want ("my NAS's temperature and disk
 * space from my NAS"); the model looks at the data, writes a widget document, and
 * Hearth checks and runs it before showing the draft.
 *
 * It works by a small JSON protocol instead of native tool calls, so any model on any Ollama or
 * OpenAI-compatible server can do it. Each turn the model answers with one JSON object:
 *   {"say": "...", "fetch": [{"url": "...", "kind": "http"}]}   look at data first
 *   {"say": "...", "doc": {...}}                                 a widget draft
 *   {"say": "..."}                                               a question for the person
 * Hearth fetches (through the same network guard as widgets), validates drafts, runs them once,
 * and sends back what went wrong, a few rounds at most.
 */
import type { ChatMessage, DesignEvent } from "../../shared/api";
import { FUNCTIONS } from "../../shared/expr";
import { BLOCK_HELP, EXAMPLE_DOC, MAX_BLOCKS, MAX_SOURCES } from "../../shared/widget-doc";
import { guardedFetch, NetError, parseBody, pick, sample } from "../net";
import type { SecretStore } from "../secrets";
import type { WidgetHub } from "../widgets/runtime";
import { AiError, type Conn, chatJson, extractJson, stripThinking, withRetries } from "./client";

const MAX_ROUNDS = 6;
/** Rounds of looking at APIs before the model must propose something or ask. */
const MAX_LOOK_ROUNDS = 2;
const SAMPLE_CHARS = 6000;

export interface DesignDeps {
  conn: Conn;
  model: string;
  hub: WidgetHub;
  secrets: SecretStore;
  allowInternet: boolean;
  homeName?: string;
  /** The home's services (the tiles), so the model knows real addresses instead of guessing. */
  services?: { name: string; url: string; checkUrl?: string }[];
  fetch?: typeof fetch;
  /** Each step, for the server's log. */
  log?: (msg: string) => void;
  /** How often to say "still thinking" while the model works (ms). */
  heartbeatMs?: number;
}

/** Instructions for any assistant: the built-in designer, or one the person pastes this into. */
export function widgetGuide(opts: { secrets: string[]; allowInternet: boolean }): string {
  const blocks = Object.entries(BLOCK_HELP)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  const fns = Object.entries(FUNCTIONS)
    .map(([k, f]) => `${k}(${f.args})`)
    .join(", ");
  return `A Hearth widget is a JSON document, not code:
{ "v": 1, "sources": [...], "values": [...], "blocks": [...] }

SOURCES (at most ${MAX_SOURCES}), where data comes from. Each has an id (lowercase, like "nas"):
- {"id","kind":"http","url","method":"GET"|"POST","headers":{},"body","every": seconds (min 5),"path": "data.items" (optional part of the answer),"track": formula giving a number to keep a history of,"keep": how many}
- {"id","kind":"websocket","url":"ws://…","send": first message to send,"mode":"replace"|"merge","path","track","keep"}
- {"id","kind":"hearth","what":"status"|"ai"|"time"}: Hearth's own data. status = {tiles:[{id,name,state,ms}],up,down,total}; ai = {servers:[{id,name,state,models,loaded}]}; time = {now,hour,minute,weekday,date}.
${opts.allowInternet ? "Sources may use the internet." : "Sources must be on the home network (.home, .local, private IPs); the internet is turned off."}
Secrets (API keys) are never written into the widget. Use {{secret:name}} in a url, header, body or send. Secrets that exist: ${opts.secrets.length ? opts.secrets.join(", ") : "none yet (ask the person to add one in Settings → Secrets)"}.

FORMULAS read data with $: $nas is the source's latest data, $nas.cpu.load a field, $nas.items[0] an item, $history.nas the tracked numbers. Operators: + - * / % == != < <= > >= && || ! ?: ?? and [lists].
Functions: ${fns}.
Inside list, table, lights and bars item formulas, $item is the current item and $index its position.
TEMPLATES are text with formulas in {{ }}: "{{ round($nas.temp) }} °C".

VALUES (optional): [{"id","expr"}] named formulas, used as $id.

BLOCKS (1 to ${MAX_BLOCKS}) on a 12-column grid: each {"id","kind","w": 1-12,"title"?, "tone"?} plus:
${blocks}
Tones: normal, muted, accent, positive, negative, warning (or a formula giving one). Colours come from the person's theme: never set colours.

Example (its address is made up; never copy it):
${JSON.stringify(EXAMPLE_DOC)}`;
}

function servicesList(deps: DesignDeps): string {
  const list = deps.services ?? [];
  if (!list.length) return "No services are listed yet.";
  return list
    .map(
      (s) =>
        `- ${s.name}: ${s.url}${s.checkUrl && s.checkUrl !== s.url ? ` (also reachable at ${s.checkUrl})` : ""}`,
    )
    .join("\n");
}

function systemPrompt(deps: DesignDeps): string {
  return `You design widgets for Hearth, the start page of a home network${deps.homeName ? ` (${deps.homeName})` : ""}.

${widgetGuide({ secrets: deps.secrets.names(), allowInternet: deps.allowInternet })}

FIRST: Hearth already checks every service in the list below, all the time. If the person wants to
know whether services, apps or containers are up or running, use a {"kind":"hearth","what":"status"}
source (no fetching needed): its tiles list has each service's name, state (up, slow, down,
unknown) and response time. A lights block over $home.tiles with a count of how many are up is a
good start. Only reach for other APIs when the person wants something Hearth doesn't know.

THE HOME'S SERVICES (Hearth checks each; these are their real addresses):
${servicesList(deps)}

ADDRESSES: never invent or guess an API address, port or path. Use only an address the person gave
you, or one from the list above exactly as written. Hearth refuses to fetch anything else. If you don't know
where the data can come from, ask, and suggest what would provide it (for example, for a NAS's
containers: its management API, or a small monitoring service like Glances). If an address fails,
don't try others at random: say what failed and ask.

HOW TO ANSWER: always reply with exactly one JSON object and nothing else.
- To look at an API before designing: {"say": "what you're checking", "fetch": [{"url": "...", "kind": "http"|"websocket", "headers": {}, "send": "..."}]} (at most 3). You'll get back what each returned. Always look before binding to fields you haven't seen.
- To propose the widget: {"say": "a short note on what it shows", "doc": { the full widget document }}. Hearth checks it and runs it; if something's wrong you'll be told, so fix it and send the whole document again.
- To ask the person something (an address, which values matter): {"say": "your question"}.
Keep "say" short and friendly. Prefer few, well-chosen blocks that read well on a phone.`;
}

interface Turn {
  say?: string;
  fetch?: {
    url: string;
    kind?: "http" | "websocket";
    headers?: Record<string, string>;
    send?: string;
  }[];
  doc?: unknown;
}

export async function design(
  deps: DesignDeps,
  conversation: ChatMessage[],
  draft: unknown,
  emit: (e: DesignEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt(deps) }];
  if (draft)
    messages.push({
      role: "user",
      content: `The widget in the editor right now:\n${JSON.stringify(draft)}`,
    });
  for (const m of conversation.slice(-20)) if (m.role !== "system") messages.push(m);

  // The model may only look at addresses the person gave, or a tile's own address. Anything else is
  // a guess, and guesses at a NAS's API paths just fail one after another.
  const given = conversation
    .filter((m) => m.role === "user")
    .flatMap((m) => m.content.match(/\b(?:https?|wss?):\/\/[^\s"'<>)]+/gi) ?? [])
    .map((u) => u.replace(/[.,;:!?]+$/, ""));
  const known = (deps.services ?? []).flatMap((s) =>
    [s.url, s.checkUrl].filter((u): u is string => Boolean(u)),
  );
  const trim = (u: string) => u.replace(/\/+$/, "").toLowerCase();
  const mayLook = (url: string) =>
    given.some((g) => trim(url).startsWith(trim(g))) || known.some((k) => trim(k) === trim(url));
  const log = (msg: string) => deps.log?.(`[designer] ${msg}`);

  let repairs = 0;
  let lookRounds = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (signal?.aborted) {
      emit({ type: "error", message: "Stopped." });
      return;
    }
    const label = round === 0 ? "Thinking" : "Working on it";
    emit({ type: "status", text: `${label}…` });
    // A slow model can take minutes: keep saying so, which also keeps proxies from closing the stream.
    const started = Date.now();
    const beat = setInterval(
      () =>
        emit({ type: "status", text: `${label}… ${Math.round((Date.now() - started) / 1000)}s` }),
      deps.heartbeatMs ?? 10_000,
    );
    let raw: string;
    try {
      raw = await withRetries(
        () => chatJson(deps.conn, deps.model, messages, signal),
        (reason, seconds) => emit({ type: "wait", reason, seconds }),
      );
    } catch (e) {
      emit({
        type: "error",
        message: e instanceof AiError ? e.message : "The AI server didn't answer.",
      });
      return;
    } finally {
      clearInterval(beat);
    }
    messages.push({ role: "assistant", content: raw });

    let turn: Turn;
    try {
      turn = extractJson(raw) as Turn;
    } catch {
      const prose = stripThinking(raw).trim();
      if (repairs++ >= 2) {
        if (prose) emit({ type: "say", text: prose.slice(0, 2000) });
        else
          emit({
            type: "error",
            message: `${deps.model} kept sending empty answers. Try again, or pick another model.`,
          });
        emit({ type: "done" });
        return;
      }
      messages.push({
        role: "user",
        content: prose
          ? "Reply with one JSON object only, as described."
          : "Your answer was empty. Reply with one JSON object, as described.",
      });
      continue;
    }

    if (Array.isArray(turn.fetch) && turn.fetch.length > 0) {
      lookRounds++;
      log(`round ${round + 1}: wants to look at ${turn.fetch.map((f) => f?.url).join(", ")}`);
      if (turn.say) emit({ type: "status", text: turn.say });
      const results: string[] = [];
      let refused = 0;
      for (const f of turn.fetch.slice(0, 3)) {
        if (typeof f?.url !== "string") continue;
        if (!mayLook(f.url)) {
          refused++;
          results.push(`${f.url}\nnot fetched: nobody gave this address, so it's a guess.`);
          continue;
        }
        const r = await look(deps, f);
        emit({ type: "fetched", url: redactUrl(f.url), ok: r.ok, note: r.note });
        results.push(`${f.url}\n${r.ok ? "returned" : "failed"}: ${r.text}`);
      }
      const failed = results.some((r) => r.includes("\nfailed:"));
      const tooMany = lookRounds >= MAX_LOOK_ROUNDS;
      messages.push({
        role: "user",
        content: `Here's what came back:\n\n${results.join("\n\n")}${
          refused
            ? "\n\nAddresses nobody gave you aren't fetched. Use Hearth's own sources, an address from the services list, or ask the person."
            : ""
        }${failed ? "\n\nAn address failed. Don't guess another: tell the person what failed and ask for the right address (or how the data can be reached)." : ""}${
          tooMany
            ? "\n\nYou've looked enough. Now either propose the widget (doc) or ask the person a question (say). Don't fetch again."
            : ""
        }`,
      });
      continue;
    }

    if (turn.doc !== undefined) {
      const preview = await deps.hub.preview(turn.doc);
      // A source that can't be reached isn't the model's to fix: guessing another address won't help.
      const unreachable = Object.entries(preview.samples).filter(
        ([, s]) => !s.ok && /reach|in time|internet|No secret/i.test(s.error ?? ""),
      );
      const problems = [
        ...preview.issues.map((i) => `${i.path}: ${i.message}`),
        ...Object.entries(preview.samples)
          .filter(([id, s]) => !s.ok && !unreachable.some(([u]) => u === id))
          .map(([id, s]) => `source ${id}: ${s.error}`),
        ...(unreachable.length
          ? []
          : (preview.frame?.blocks ?? [])
              .filter((b) => b.error)
              .map((b) => `block ${b.id}: ${b.error}`)),
      ];
      if (!problems.length && unreachable.length) {
        emit({ type: "draft", doc: turn.doc as never, issues: preview.issues });
        emit({
          type: "say",
          text: `${turn.say ? `${turn.say}\n\n` : ""}I couldn't check it, though: ${unreachable.map(([id, s]) => `**${id}**: ${s.error}`).join(" ")} Is that the right address, and is the service running?`,
        });
        emit({ type: "done" });
        return;
      }
      if (problems.length && repairs < 3) {
        repairs++;
        emit({
          type: "status",
          text: `Fixing ${problems.length} problem${problems.length === 1 ? "" : "s"}…`,
        });
        const seen = Object.entries(preview.samples)
          .filter(([, s]) => s.ok)
          .map(([id, s]) => `$${id} is: ${clip(JSON.stringify(s.sample))}`)
          .join("\n");
        messages.push({
          role: "user",
          content: `Hearth found problems:\n- ${problems.join("\n- ")}${seen ? `\n\nWhat the sources returned:\n${seen}` : ""}\n\nFix them and send the whole document again.`,
        });
        continue;
      }
      emit({ type: "draft", doc: turn.doc as never, issues: preview.issues });
      if (turn.say) emit({ type: "say", text: turn.say });
      emit({ type: "done" });
      return;
    }

    emit({
      type: "say",
      text: turn.say?.trim() || "I'm not sure what to make. Tell me a bit more?",
    });
    emit({ type: "done" });
    return;
  }
  log("gave up after the last round");
  emit({
    type: "say",
    text: "I couldn't get it right in a few tries. Tell me more about the data, or adjust the draft by hand.",
  });
  emit({ type: "done" });
}

async function look(
  deps: DesignDeps,
  f: NonNullable<Turn["fetch"]>[number],
): Promise<{ ok: boolean; text: string; note: string }> {
  const fill = (t: string) => deps.secrets.fill(t).text;
  try {
    if (f.kind === "websocket") {
      const r = await deps.hub.preview({
        v: 1,
        sources: [{ id: "probe", kind: "websocket", url: f.url, send: f.send }],
        blocks: [{ id: "x", kind: "divider" }],
      });
      const s = r.samples.probe;
      if (!s?.ok)
        return {
          ok: false,
          text: s?.error ?? "nothing arrived",
          note: s?.error ?? "Nothing arrived.",
        };
      return { ok: true, text: clip(JSON.stringify(s.sample)), note: "Got a message." };
    }
    const headers = Object.fromEntries(
      Object.entries(f.headers ?? {}).map(([k, v]) => [k, fill(String(v))]),
    );
    const res = await guardedFetch(fill(f.url), {
      headers,
      policy: { allowInternet: deps.allowInternet },
      fetch: deps.fetch,
      maxBytes: 1024 * 1024,
    });
    const body = sample(pick(parseBody(res), undefined));
    const text = deps.secrets.redact(clip(JSON.stringify(body)));
    if (res.status >= 400)
      return {
        ok: false,
        text: `status ${res.status}: ${text}`,
        note: `It answered ${res.status}.`,
      };
    return { ok: true, text, note: `${res.status}, ${Math.round(res.body.length / 1024)} KB` };
  } catch (e) {
    const msg = e instanceof NetError ? e.message : "Couldn't fetch it.";
    return { ok: false, text: msg, note: msg };
  }
}

const clip = (s: string) => (s.length > SAMPLE_CHARS ? `${s.slice(0, SAMPLE_CHARS)}…(cut)` : s);

function redactUrl(u: string): string {
  try {
    const url = new URL(u);
    url.username = "";
    url.password = "";
    for (const k of url.searchParams.keys())
      if (/key|token|pass|secret|auth/i.test(k)) url.searchParams.set(k, "•••");
    return url.href;
  } catch {
    return u.slice(0, 200);
  }
}
