import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DesignEvent } from "../../shared/api";
import type { AiServer } from "../../shared/config";
import { SecretStore } from "../secrets";
import { fixture } from "../test-fixtures";
import { WidgetHub } from "../widgets/runtime";
import {
  AiError,
  chatJson,
  chatStream,
  extractJson,
  listLoaded,
  listModels,
  withRetries,
} from "./client";
import { design } from "./designer";
import { AiMonitor } from "./monitor";

const ollama: AiServer = { id: "o", name: "Home AI", kind: "ollama", url: "http://ai.home:11434" };
const openai: AiServer = { id: "p", name: "Shared", kind: "openai", url: "http://ai.home/v1" };

type Route = (url: string, init: RequestInit) => Response | Promise<Response>;
const fakeFetch = (route: Route) =>
  (async (url: string, init: RequestInit) => route(String(url), init)) as unknown as typeof fetch;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
const streamOf = (lines: string[]) =>
  new Response(
    new ReadableStream({
      start(c) {
        // Split across chunks to prove lines are put back together.
        for (const l of lines)
          for (const part of [l.slice(0, 5), `${l.slice(5)}\n`])
            c.enqueue(new TextEncoder().encode(part));
        c.close();
      },
    }),
  );

describe("AI client", () => {
  it("lists models and what's loaded from Ollama, sending the key", async () => {
    let auth = "";
    const f = fakeFetch((url, init) => {
      auth = (init.headers as Record<string, string>).authorization ?? "";
      if (url.endsWith("/api/tags"))
        return json({
          models: [
            {
              name: "llama3.1:8b",
              size: 4.9e9,
              details: { family: "llama", parameter_size: "8B", quantization_level: "Q4_K_M" },
            },
          ],
        });
      if (url.endsWith("/api/ps"))
        return json({
          models: [{ name: "llama3.1:8b", size_vram: 5.5e9, expires_at: "2026-11-10T12:00:00Z" }],
        });
      return json({}, 404);
    });
    const c = { server: ollama, key: "k1", fetch: f };
    expect(await listModels(c)).toEqual([
      {
        name: "llama3.1:8b",
        size: 4.9e9,
        family: "llama",
        parameters: "8B",
        quantization: "Q4_K_M",
      },
    ]);
    expect(await listLoaded(c)).toEqual([
      { name: "llama3.1:8b", vram: 5.5e9, size: undefined, until: "2026-11-10T12:00:00Z" },
    ]);
    expect(auth).toBe("Bearer k1");
  });

  it("lists models from an OpenAI-compatible server", async () => {
    const f = fakeFetch((url) =>
      url === "http://ai.home/v1/models"
        ? json({ data: [{ id: "auto" }, { id: "qwen" }] })
        : json({}, 404),
    );
    expect(await listModels({ server: openai, fetch: f })).toEqual([
      { name: "auto" },
      { name: "qwen" },
    ]);
  });

  it("streams Ollama and OpenAI replies piece by piece", async () => {
    const pieces: string[] = [];
    const o = await chatStream(
      {
        server: ollama,
        fetch: fakeFetch(() =>
          streamOf([
            JSON.stringify({ message: { content: "Hel" } }),
            JSON.stringify({ message: { content: "lo" } }),
            JSON.stringify({ done: true, eval_count: 7 }),
          ]),
        ),
      },
      "m",
      [{ role: "user", content: "hi" }],
      (t) => pieces.push(t),
    );
    expect(o).toEqual({ text: "Hello", tokens: 7 });
    expect(pieces).toEqual(["Hel", "lo"]);
    const p = await chatStream(
      {
        server: openai,
        fetch: fakeFetch(() =>
          streamOf([
            `data: ${JSON.stringify({ choices: [{ delta: { content: "Hi " } }] })}`,
            ": keep-alive",
            `data: ${JSON.stringify({ choices: [{ delta: { content: "there" } }] })}`,
            "data: [DONE]",
          ]),
        ),
      },
      "m",
      [{ role: "user", content: "hi" }],
      () => {},
    );
    expect(p.text).toBe("Hi there");
  });

  it("reads a shared server's codes into plain words, and waits out short waits", async () => {
    let calls = 0;
    const waits: string[] = [];
    const f = fakeFetch(() =>
      ++calls === 1
        ? json({ error: "all busy", code: "busy", retry_after: 2 }, 503)
        : json({ message: { content: '{"ok":true}' } }),
    );
    const out = await withRetries(
      () => chatJson({ server: ollama, fetch: f }, "m", []),
      (r, s) => waits.push(`${r} ${s}`),
      async () => {},
    );
    expect(out).toBe('{"ok":true}');
    expect(waits).toEqual(["Every computer on the AI server is busy. 2"]);
  });

  it("says how long to wait instead of waiting too long", async () => {
    const f = fakeFetch(() => json({ code: "model_downloading", retry_after: 600 }, 503));
    await expect(
      withRetries(
        () => chatJson({ server: ollama, fetch: f }, "m", []),
        undefined,
        async () => {},
      ),
    ).rejects.toThrow(/still downloading that model\. Try again in 10 minutes/);
  });

  it("explains a refused key and an unreachable server", async () => {
    await expect(
      listModels({ server: ollama, fetch: fakeFetch(() => json({ error: "no" }, 401)) }),
    ).rejects.toThrow(/refused the key/);
    await expect(
      listModels({
        server: ollama,
        fetch: fakeFetch(() => {
          throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
        }),
      }),
    ).rejects.toThrow(/Couldn't reach Home AI \(ECONNREFUSED\)/);
  });

  it("finds the JSON in an answer wrapped in prose or fences", () => {
    expect(extractJson('Sure! ```json\n{"say":"hi","doc":{"v":1}}\n```')).toEqual({
      say: "hi",
      doc: { v: 1 },
    });
    expect(extractJson('Here: {"a": "brace } inside", "b": {"c": 1}} done')).toEqual({
      a: "brace } inside",
      b: { c: 1 },
    });
    expect(() => extractJson("no json here")).toThrow();
  });

  it("monitor marks busy and down servers", async () => {
    const m = new AiMonitor({
      servers: () => [ollama, openai],
      keyFor: () => undefined,
      fetch: fakeFetch((url) =>
        url.includes("/v1/")
          ? json({ code: "no_machines", retry_after: 30 }, 503)
          : json({ models: [] }),
      ),
    });
    await m.checkAll();
    const [a, b] = m.list();
    expect(a).toMatchObject({ state: "up", note: expect.stringContaining("no models") });
    expect(b).toMatchObject({
      state: "busy",
      note: expect.stringContaining("No computer is connected"),
    });
    expect(new AiError("x").retryAfter).toBeNull();
  });
});

describe("AI designer", () => {
  it("looks at the data, drafts a widget, fixes what Hearth finds, and hands back a checked draft", async () => {
    const replies = [
      { say: "Let me look.", fetch: [{ url: "http://nas.home/stats" }] },
      {
        say: "Here it is.",
        doc: {
          v: 1,
          sources: [{ id: "nas", kind: "http", url: "http://nas.home/stats" }],
          blocks: [{ id: "t", kind: "stat", value: "round($nas.temp" }],
        },
      },
      {
        say: "Fixed.",
        doc: {
          v: 1,
          sources: [{ id: "nas", kind: "http", url: "http://nas.home/stats" }],
          blocks: [{ id: "t", kind: "stat", value: "round($nas.temp)", unit: "°C" }],
        },
      },
    ];
    const prompts: string[] = [];
    let turn = 0;
    const f = fakeFetch((url, init) => {
      if (url.startsWith("http://ai.home")) {
        const body = JSON.parse(String(init.body)) as { messages: { content: string }[] };
        prompts.push(body.messages.at(-1)?.content ?? "");
        return json({ message: { content: `Reply: ${JSON.stringify(replies[turn++])}` } });
      }
      return json({ temp: 47.6, fan: 1200 });
    });
    const secrets = new SecretStore(await mkdtemp(join(tmpdir(), "hearth-ds-")), randomBytes(32));
    const hub = new WidgetHub({
      config: () => fixture(),
      status: () => ({}),
      ai: new AiMonitor({ servers: () => [], keyFor: () => undefined }),
      secrets,
      fetch: f,
    });
    const events: DesignEvent[] = [];
    await design(
      {
        conn: { server: ollama, fetch: f },
        model: "m",
        hub,
        secrets,
        allowInternet: false,
        fetch: f,
      },
      [{ role: "user", content: "NAS temperature from http://nas.home/stats" }],
      undefined,
      (e) => events.push(e),
    );

    expect(events.find((e) => e.type === "fetched")).toMatchObject({
      ok: true,
      url: "http://nas.home/stats",
    });
    expect(prompts[1]).toContain('"temp":47.6'); // it saw the data
    expect(prompts[2]).toContain("blocks.0.value"); // it was told what to fix
    const draft = events.find((e) => e.type === "draft") as Extract<DesignEvent, { type: "draft" }>;
    expect(draft.issues).toEqual([]);
    expect(JSON.stringify(draft.doc)).toContain("round($nas.temp)");
    expect(events.at(-1)).toEqual({ type: "done" });
  });
});

describe("thinking models", () => {
  it("strip <think> before reading JSON, and ask again without JSON mode after an empty answer", async () => {
    expect(extractJson('<think>maybe {"a":1}?</think>\n{"say":"hi"}')).toEqual({ say: "hi" });
    const bodies: Record<string, unknown>[] = [];
    const f = fakeFetch((_url, init) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      bodies.push(body);
      return json({
        message: { content: body.format === "json" ? "" : '<think>hmm</think>{"say":"ok"}' },
      });
    });
    const out = await chatJson({ server: ollama, fetch: f }, "qwen3", []);
    expect(extractJson(out)).toEqual({ say: "ok" });
    expect(bodies.map((b) => b.format ?? null)).toEqual(["json", null]);
    expect(bodies[0]?.think).toBe(false);
  });

  it("the designer never answers with nothing", async () => {
    const f = fakeFetch(() => json({ message: { content: "" } }));
    const secrets = new SecretStore(await mkdtemp(join(tmpdir(), "hearth-ds-")), randomBytes(32));
    const hub = new WidgetHub({
      config: () => fixture(),
      status: () => ({}),
      ai: new AiMonitor({ servers: () => [], keyFor: () => undefined }),
      secrets,
      fetch: f,
    });
    const events: DesignEvent[] = [];
    await design(
      { conn: { server: ollama, fetch: f }, model: "qwen3", hub, secrets, allowInternet: false },
      [{ role: "user", content: "anything" }],
      undefined,
      (e) => events.push(e),
    );
    expect(events.some((e) => e.type === "error" && e.message.includes("empty answers"))).toBe(
      true,
    );
  });

  it("tells the model the home's real addresses and not to guess", async () => {
    let system = "";
    const f = fakeFetch((_u, init) => {
      system =
        (JSON.parse(String(init.body)) as { messages: { content: string }[] }).messages[0]
          ?.content ?? "";
      return json({ message: { content: '{"say":"Where does the data come from?"}' } });
    });
    const secrets = new SecretStore(await mkdtemp(join(tmpdir(), "hearth-ds-")), randomBytes(32));
    const hub = new WidgetHub({
      config: () => fixture(),
      status: () => ({}),
      ai: new AiMonitor({ servers: () => [], keyFor: () => undefined }),
      secrets,
      fetch: f,
    });
    const events: DesignEvent[] = [];
    await design(
      {
        conn: { server: ollama, fetch: f },
        model: "m",
        hub,
        secrets,
        allowInternet: false,
        services: [{ name: "Muny", url: "https://muny.home" }],
      },
      [{ role: "user", content: "docker" }],
      undefined,
      (e) => events.push(e),
    );
    expect(system).toContain("- Muny: https://muny.home");
    expect(system).toContain("never invent or guess");
    expect(events).toContainEqual({ type: "say", text: "Where does the data come from?" });
  });
});

describe("the designer doesn't guess addresses", () => {
  it("fetches only what the person gave (and paths under it), and stops looking after two rounds", async () => {
    const replies = [
      {
        say: "Checking",
        fetch: [
          { url: "http://192.168.1.200:5000/api/containers" },
          { url: "http://glances.home:61208/api/4/all" },
        ],
      },
      { say: "More", fetch: [{ url: "http://192.168.1.200:5000/api/system" }] },
      { say: "Which address does Container Manager use?" },
    ];
    const fetched: string[] = [];
    const prompts: string[] = [];
    let turn = 0;
    const f = fakeFetch((url, init) => {
      if (url.startsWith("http://ai.home")) {
        const body = JSON.parse(String(init.body)) as { messages: { content: string }[] };
        prompts.push(body.messages.at(-1)?.content ?? "");
        return json({ message: { content: JSON.stringify(replies[turn++]) } });
      }
      fetched.push(url);
      return json({ containers: [] });
    });
    const secrets = new SecretStore(await mkdtemp(join(tmpdir(), "hearth-ds-")), randomBytes(32));
    const hub = new WidgetHub({
      config: () => fixture(),
      status: () => ({}),
      ai: new AiMonitor({ servers: () => [], keyFor: () => undefined }),
      secrets,
      fetch: f,
    });
    const events: DesignEvent[] = [];
    await design(
      {
        conn: { server: ollama, fetch: f },
        model: "m",
        hub,
        secrets,
        allowInternet: false,
        fetch: f,
      },
      [{ role: "user", content: "My containers, from Glances at http://glances.home:61208." }],
      undefined,
      (e) => events.push(e),
    );
    expect(fetched).toEqual(["http://glances.home:61208/api/4/all"]);
    expect(prompts[1]).toContain("not fetched: nobody gave this address");
    expect(prompts[2]).toContain("You've looked enough");
    expect(events).toContainEqual({
      type: "say",
      text: "Which address does Container Manager use?",
    });
  });

  it("puts Hearth's own status checks first for 'is it up?' widgets", async () => {
    let system = "";
    const f = fakeFetch((_u, init) => {
      system =
        (JSON.parse(String(init.body)) as { messages: { content: string }[] }).messages[0]
          ?.content ?? "";
      return json({ message: { content: '{"say":"ok"}' } });
    });
    const secrets = new SecretStore(await mkdtemp(join(tmpdir(), "hearth-ds-")), randomBytes(32));
    const hub = new WidgetHub({
      config: () => fixture(),
      status: () => ({}),
      ai: new AiMonitor({ servers: () => [], keyFor: () => undefined }),
      secrets,
      fetch: f,
    });
    await design(
      { conn: { server: ollama, fetch: f }, model: "m", hub, secrets, allowInternet: false },
      [{ role: "user", content: "are my apps up?" }],
      undefined,
      () => {},
    );
    expect(system).toContain('{"kind":"hearth","what":"status"}');
  });
});
