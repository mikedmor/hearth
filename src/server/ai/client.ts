/**
 * Talking to AI servers on the network: Ollama's API (`/api/*`) and OpenAI-compatible ones
 * (`/v1/*`). Any server that speaks either works.
 *
 * A server shared by several computers can say why it can't answer yet: everyone's busy, no
 * computer is connected, or the model is still downloading. It says so with a `code`, a
 * Retry-After header and `retry_after`. Hearth acts on those (never on message text): it waits and
 * tries again for a short while, telling the page why, and otherwise says how long to wait.
 */
import type { AiLoadedModel, AiMachine, AiModel, ChatMessage } from "../../shared/api";
import type { AiServer } from "../../shared/config";

export interface Conn {
  server: AiServer;
  key?: string;
  fetch?: typeof fetch;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly retryAfter: number | null = null,
    readonly code: string | null = null,
    readonly status?: number,
  ) {
    super(message);
  }
}

const RETRYABLE = new Set(["busy", "no_machines", "model_downloading", "retry", "overloaded"]);
/** Someone is waiting on the page: wait out short delays only. */
const WAIT = { longest: 20, total: 45 };

const base = (s: AiServer) => s.url.replace(/\/+$/, "");
const headers = (c: Conn, json = true): Record<string, string> => ({
  ...(json ? { "content-type": "application/json" } : {}),
  accept: "application/json, text/event-stream, application/x-ndjson",
  ...(c.key ? { authorization: `Bearer ${c.key}` } : {}),
});

function plainProblem(status: number, body: unknown, retryAfterHeader: string | null): AiError {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const errObj = (b.error && typeof b.error === "object" ? b.error : {}) as Record<string, unknown>;
  const code =
    typeof b.code === "string"
      ? b.code
      : typeof errObj.code === "string"
        ? errObj.code
        : status === 429 || status === 503
          ? "retry"
          : null;
  const header =
    retryAfterHeader && /^\d+$/.test(retryAfterHeader.trim()) ? Number(retryAfterHeader) : null;
  const after = typeof b.retry_after === "number" ? b.retry_after : header;
  const words: Record<string, string> = {
    busy: "Every computer on the AI server is busy.",
    no_machines: "No computer is connected to the AI server right now.",
    model_downloading: "The AI server is still downloading that model.",
    retry: "The AI server asked to try again shortly.",
    overloaded: "The AI server is overloaded.",
    model_not_found: "The AI server doesn't have that model.",
  };
  const fromServer =
    typeof b.error === "string"
      ? b.error
      : typeof errObj.message === "string"
        ? errObj.message
        : "";
  const msg =
    (code && words[code]) ||
    (status === 401 || status === 403
      ? "The AI server refused the key (check it in Settings)."
      : "") ||
    (status === 404 && /model/i.test(fromServer) ? words.model_not_found : "") ||
    (fromServer
      ? `The AI server said: ${fromServer.replace(/[\p{Cc}<>]/gu, "").slice(0, 160)}`
      : `The AI server answered ${status}.`);
  return new AiError(
    msg as string,
    code && RETRYABLE.has(code) ? (after ?? 5) : null,
    code,
    status,
  );
}

async function readError(res: Response): Promise<AiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON.
  }
  return plainProblem(res.status, body, res.headers.get("retry-after"));
}

async function call(
  c: Conn,
  path: string,
  init: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const doFetch = c.fetch ?? fetch;
  try {
    const res = await doFetch(`${base(c.server)}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(init.timeoutMs ?? 10_000),
    });
    if (!res.ok) throw await readError(res);
    return res;
  } catch (e) {
    if (e instanceof AiError) throw e;
    const err = e as Error & { cause?: { code?: string } };
    if (err.name === "TimeoutError") throw new AiError(`${c.server.name} didn't answer in time.`);
    if (err.name === "AbortError") throw new AiError("Stopped.");
    throw new AiError(
      `Couldn't reach ${c.server.name}${err.cause?.code ? ` (${err.cause.code})` : ""}.`,
    );
  }
}

/** Retry the short waits a shared server asks for. `onWait` tells the page why it's waiting. */
export async function withRetries<T>(
  fn: () => Promise<T>,
  onWait?: (reason: string, seconds: number) => void,
  sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000)),
): Promise<T> {
  let waited = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof AiError) || e.retryAfter === null) throw e;
      const secs = Math.max(1, Math.ceil(e.retryAfter));
      if (secs > WAIT.longest || waited + secs > WAIT.total) {
        throw new AiError(
          `${e.message} Try again in ${secs < 90 ? `${secs} seconds` : `${Math.round(secs / 60)} minutes`}.`,
          e.retryAfter,
          e.code,
          e.status,
        );
      }
      onWait?.(e.message, secs);
      await sleep(secs);
      waited += secs;
    }
  }
}

// ---------------------------------------------------------------------------
// What a server has

export async function listModels(c: Conn): Promise<AiModel[]> {
  if (c.server.kind === "ollama") {
    const res = await call(c, "/api/tags", { headers: headers(c, false) });
    const body = (await res.json()) as {
      models?: {
        name: string;
        size?: number;
        details?: { family?: string; parameter_size?: string; quantization_level?: string };
      }[];
    };
    return (body.models ?? []).map((m) => ({
      name: m.name,
      size: m.size || undefined,
      family: m.details?.family || undefined,
      parameters: m.details?.parameter_size || undefined,
      quantization: m.details?.quantization_level || undefined,
    }));
  }
  const res = await call(c, "/models", { headers: headers(c, false) });
  const body = (await res.json()) as { data?: { id: string }[] };
  return (body.data ?? []).map((m) => ({ name: m.id }));
}

/** Models loaded in memory right now (Ollama's /api/ps). Empty when the server can't say. */
export async function listLoaded(c: Conn): Promise<AiLoadedModel[]> {
  if (c.server.kind !== "ollama") return [];
  try {
    const res = await call(c, "/api/ps", { headers: headers(c, false), timeoutMs: 5000 });
    const body = (await res.json()) as {
      models?: { name: string; size?: number; size_vram?: number; expires_at?: string }[];
    };
    return (body.models ?? []).map((m) => ({
      name: m.name,
      size: m.size,
      vram: m.size_vram,
      until: m.expires_at,
    }));
  } catch {
    return [];
  }
}

export async function serverVersion(c: Conn): Promise<string | undefined> {
  if (c.server.kind !== "ollama") return undefined;
  try {
    const res = await call(c, "/api/version", { headers: headers(c, false), timeoutMs: 4000 });
    return ((await res.json()) as { version?: string }).version;
  } catch {
    return undefined;
  }
}

/**
 * The computers a shared AI server lends work to, when it lists them for apps (`/api/machines`,
 * or `/machines` under an OpenAI-compatible base). `null` when it doesn't: plain Ollama and most
 * servers are one machine and have no such list.
 */
export async function listMachines(c: Conn): Promise<AiMachine[] | null> {
  const path = c.server.kind === "ollama" ? "/api/machines" : "/machines";
  let res: Response;
  try {
    res = await call(c, path, { headers: headers(c, false), timeoutMs: 5000 });
  } catch (e) {
    if (e instanceof AiError && (e.status === 404 || e.status === 405)) return null;
    throw e;
  }
  const body = (await res.json().catch(() => null)) as { machines?: unknown } | null;
  if (!body || !Array.isArray(body.machines)) return null;
  return body.machines.flatMap((raw): AiMachine[] => {
    const m = raw as Record<string, unknown>;
    if (typeof m.id !== "string" || typeof m.name !== "string") return [];
    const str = (v: unknown, n = 120) => (typeof v === "string" && v ? v.slice(0, n) : undefined);
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    const hw = m.hardware as Record<string, unknown> | null | undefined;
    const fetching = m.fetching as Record<string, unknown> | null | undefined;
    return [
      {
        id: m.id.slice(0, 80),
        name: m.name.slice(0, 80),
        online: m.online === true,
        available: m.available === true,
        reason: str(m.reason, 200),
        busy: m.busy === true,
        jobs: num(m.jobs) ?? 0,
        served: num(m.served) ?? 0,
        avgMs: num(m.avgMs),
        connectedSecs: num(m.connectedSecs),
        version: str(m.version, 40),
        os: str(m.os, 20),
        models: Array.isArray(m.models)
          ? m.models.filter((x): x is string => typeof x === "string").slice(0, 50)
          : [],
        loaded: str(m.loaded),
        fetching:
          fetching && typeof fetching.model === "string"
            ? { model: fetching.model.slice(0, 120), percent: num(fetching.percent) ?? 0 }
            : undefined,
        address: str(m.address, 45),
        mac: str(m.mac, 17)?.toLowerCase(),
        canWake: m.canWake === true,
        hardware:
          hw && typeof hw.cpu === "string"
            ? {
                cpu: hw.cpu.slice(0, 120),
                cores: num(hw.cores) ?? 0,
                memoryMib: num(hw.memoryMib) ?? 0,
                gpus: Array.isArray(hw.gpus)
                  ? hw.gpus.flatMap((g: Record<string, unknown>) =>
                      typeof g?.name === "string"
                        ? [{ name: g.name.slice(0, 120), vramMib: num(g.vramMib) ?? 0 }]
                        : [],
                    )
                  : [],
              }
            : undefined,
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// Chat

export interface StreamResult {
  text: string;
  tokens?: number;
}

/** Stream a reply; `onText` gets each piece as it comes. */
export async function chatStream(
  c: Conn,
  model: string,
  messages: ChatMessage[],
  onText: (t: string) => void,
  signal?: AbortSignal,
): Promise<StreamResult> {
  const ollama = c.server.kind === "ollama";
  const res = await call(c, ollama ? "/api/chat" : "/chat/completions", {
    method: "POST",
    headers: headers(c),
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
    timeoutMs: 300_000,
  });
  if (!res.body) throw new AiError("The AI server sent nothing back.");
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let tokens: number | undefined;
  const reader = res.body.getReader();
  const handle = (line: string) => {
    const l = line.trim();
    if (!l) return;
    if (ollama) {
      const m = JSON.parse(l) as {
        message?: { content?: string };
        error?: string;
        eval_count?: number;
        done?: boolean;
      };
      if (m.error) throw new AiError(`The AI server said: ${m.error.slice(0, 160)}`);
      if (m.message?.content) {
        text += m.message.content;
        onText(m.message.content);
      }
      if (m.done && m.eval_count) tokens = m.eval_count;
      return;
    }
    if (!l.startsWith("data:")) return;
    const data = l.slice(5).trim();
    if (data === "[DONE]") return;
    const m = JSON.parse(data) as {
      choices?: { delta?: { content?: string } }[];
      usage?: { completion_tokens?: number };
      error?: { message?: string };
    };
    if (m.error) throw new AiError(`The AI server said: ${(m.error.message ?? "").slice(0, 160)}`);
    const piece = m.choices?.[0]?.delta?.content;
    if (piece) {
      text += piece;
      onText(piece);
    }
    if (m.usage?.completion_tokens) tokens = m.usage.completion_tokens;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      try {
        handle(line);
      } catch (e) {
        if (e instanceof AiError) throw e;
        // A line that isn't JSON (keep-alive comments): skip it.
      }
    }
  }
  if (buffer.trim()) {
    try {
      handle(buffer);
    } catch (e) {
      if (e instanceof AiError) throw e;
    }
  }
  return { text, tokens };
}

/** One reply that should be JSON. Asks the server for JSON mode, and falls back when it refuses. */
export async function chatJson(
  c: Conn,
  model: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  const ollama = c.server.kind === "ollama";
  const send = async (jsonMode: boolean) => {
    const body = ollama
      ? {
          model,
          messages,
          stream: false,
          ...(jsonMode ? { format: "json" } : {}),
          // Thinking models (qwen3, deepseek-r1) answer JSON better, and sooner, without thinking.
          think: false,
          options: { temperature: 0.2 },
        }
      : {
          model,
          messages,
          stream: false,
          temperature: 0.2,
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        };
    const res = await call(c, ollama ? "/api/chat" : "/chat/completions", {
      method: "POST",
      headers: headers(c),
      body: JSON.stringify(body),
      signal,
      timeoutMs: 300_000,
    });
    const out = (await res.json()) as {
      message?: { content?: string };
      choices?: { message?: { content?: string } }[];
    };
    return (ollama ? out.message?.content : out.choices?.[0]?.message?.content) ?? "";
  };
  let out: string;
  try {
    out = await send(true);
  } catch (e) {
    if (e instanceof AiError && e.status === 400) return send(false);
    throw e;
  }
  // Some thinking models answer nothing at all in JSON mode: ask again without it.
  return stripThinking(out).trim() ? out : send(false);
}

/** A thinking model's reasoning (`<think>…</think>`) taken out; an unfinished one takes the rest. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*$/i, "");
}

/** The first JSON object in a model's answer (models sometimes wrap it in prose or ``` fences). */
export function extractJson(raw: string): unknown {
  const text = stripThinking(raw);
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate?.indexOf("{") ?? -1;
  if (start === -1) throw new Error("no JSON object");
  let depth = 0;
  let inString = false;
  for (let i = start; i < (candidate as string).length; i++) {
    const ch = (candidate as string)[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0)
      return JSON.parse((candidate as string).slice(start, i + 1));
  }
  throw new Error("unfinished JSON object");
}
