import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import type { WidgetUpdate } from "../../shared/api";
import type { HearthConfig } from "../../shared/config";
import { AiMonitor } from "../ai/monitor";
import { SecretStore } from "../secrets";
import { fixture } from "../test-fixtures";
import { upcoming, WidgetHub } from "./runtime";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

async function hub(opts: { cfg?: HearthConfig; fetch?: typeof fetch } = {}) {
  const cfg = opts.cfg ?? fixture();
  const secrets = new SecretStore(await mkdtemp(join(tmpdir(), "hearth-rt-")), randomBytes(32));
  await secrets.set("token", "s3cr3t-token");
  const ai = new AiMonitor({ servers: () => [], keyFor: () => undefined });
  const h = new WidgetHub({
    config: () => cfg,
    status: () => ({
      muny: { state: "up", ms: 20 },
      gg: { state: "down" },
      nas: { state: "up", ms: 5 },
    }),
    ai,
    secrets,
    fetch: opts.fetch,
    idleMs: 10,
  });
  cleanups.push(() => h.stopAll());
  return h;
}

const jsonFetch = (handler: (url: string, init: RequestInit) => unknown) =>
  (async (url: URL | string, init: RequestInit) =>
    new Response(JSON.stringify(handler(String(url), init)), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

describe("preview", () => {
  it("runs HTTP sources once, fills secrets in on the server, and returns samples", async () => {
    let seen: RequestInit | undefined;
    const h = await hub({
      fetch: jsonFetch((_u, init) => {
        seen = init;
        return { data: { temp: 51, disks: [1, 2, 3, 4, 5] } };
      }),
    });
    const r = await h.preview({
      v: 1,
      sources: [
        {
          id: "nas",
          kind: "http",
          url: "http://nas.home/api",
          headers: { authorization: "Bearer {{secret:token}}" },
          path: "data",
        },
      ],
      blocks: [{ id: "t", kind: "stat", value: "$nas.temp", unit: "°C" }],
    });
    expect(r.issues).toEqual([]);
    expect(r.frame?.blocks[0]).toMatchObject({ value: "51", unit: "°C" });
    expect((seen?.headers as Record<string, string> | undefined)?.authorization).toBe(
      "Bearer s3cr3t-token",
    );
    expect(r.samples.nas).toMatchObject({
      ok: true,
      sample: { temp: 51, disks: [1, 2, 3, "…2 more"] },
    });
    expect(JSON.stringify(r)).not.toContain("s3cr3t");
  });

  it("refuses internet sources unless the admin allowed them", async () => {
    const h = await hub({ fetch: jsonFetch(() => ({})) });
    const r = await h.preview({
      v: 1,
      sources: [{ id: "w", kind: "http", url: "https://api.example.com/x" }],
      blocks: [{ id: "d", kind: "divider" }],
    });
    expect(r.samples.w).toMatchObject({ ok: false, error: expect.stringContaining("internet") });
  });

  it("reports a missing secret by name", async () => {
    const h = await hub({ fetch: jsonFetch(() => ({})) });
    const r = await h.preview({
      v: 1,
      sources: [{ id: "w", kind: "http", url: "http://x.home/?k={{secret:nope}}" }],
      blocks: [{ id: "d", kind: "divider" }],
    });
    expect(r.samples.w?.error).toMatch(/No secret called nope/);
  });

  it("reads Hearth's own status", async () => {
    const h = await hub();
    const r = await h.preview({
      v: 1,
      sources: [{ id: "home", kind: "hearth", what: "status" }],
      blocks: [{ id: "n", kind: "stat", value: "$home.up", sub: "{{ $home.down }} down" }],
    });
    expect(r.frame?.blocks[0]).toMatchObject({ value: "2", sub: "1 down" });
  });

  it("returns the problems of a broken document without running it", async () => {
    let called = false;
    const h = await hub({
      fetch: jsonFetch(() => {
        called = true;
        return {};
      }),
    });
    const r = await h.preview({
      v: 1,
      sources: [{ id: "a", kind: "http", url: "http://a.home" }],
      blocks: [{ id: "x", kind: "stat", value: "(((" }],
    });
    expect(r.frame).toBeNull();
    expect(r.issues[0]?.path).toBe("blocks.0.value");
    expect(called).toBe(false);
  });
});

describe("live widgets", () => {
  it("push a WebSocket source's messages as they arrive, and keep a history", async () => {
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    cleanups.push(() => wss.close());
    await new Promise((r) => wss.once("listening", r));
    const port = (wss.address() as AddressInfo).port;
    wss.on("connection", (ws) => {
      ws.on("message", (m) => {
        if (String(m) === "subscribe") {
          ws.send(JSON.stringify({ value: 1, unit: "W" }));
          setTimeout(() => ws.send(JSON.stringify({ value: 2 })), 50);
        }
      });
    });
    const cfg = fixture({
      widgets: [
        {
          id: "power",
          type: "custom",
          doc: {
            v: 1,
            sources: [
              {
                id: "feed",
                kind: "websocket",
                url: `ws://127.0.0.1:${port}`,
                send: "subscribe",
                mode: "merge",
              },
            ],
            blocks: [{ id: "now", kind: "stat", value: "$feed.value", sub: "{{ $feed.unit }}" }],
          },
        },
      ],
      profiles: [],
      settings: {},
    });
    const h = await hub({ cfg });
    const updates: WidgetUpdate[] = [];
    const stop = h.subscribe("power", null, (u) => updates.push(u));
    cleanups.push(stop);
    await waitFor(() =>
      updates.some(
        (u) =>
          u.type === "custom" &&
          u.data.blocks[0]?.kind === "stat" &&
          u.data.blocks[0].value === "2",
      ),
    );
    const last = updates.at(-1) as Extract<WidgetUpdate, { type: "custom" }>;
    // Merged: the unit from the first message stays.
    expect(last.data.blocks[0]).toMatchObject({ value: "2", sub: "W" });
    expect(last.data.sources.feed?.ok).toBe(true);
  });

  it("won't let a viewer watch a widget their role can't see", async () => {
    const h = await hub();
    const got: WidgetUpdate[] = [];
    h.subscribe("secret", "child", (u) => got.push(u));
    await new Promise((r) => setTimeout(r, 30));
    expect(got).toEqual([]);
  });

  it("work out the built-in status widget per role", async () => {
    const h = await hub();
    const cfg = fixture();
    const health = cfg.widgets.find((w) => w.id === "health") as HearthConfig["widgets"][number];
    const asAdmin = await h.current(health, "admin");
    const asGuest = await h.current(health, null);
    expect(asAdmin.data).toMatchObject({ total: 3, up: 2, down: 1, downNames: ["Gaseous Games"] });
    expect(asGuest.data).toMatchObject({ total: 1, down: 1 });
  });
});

describe("countdown", () => {
  const now = new Date(2026, 10, 10, 20, 0);
  it("counts days, rolls yearly events over, drops past ones, and sorts", () => {
    const out = upcoming(
      [
        { name: "Christmas", date: "2025-12-25", yearly: true },
        { name: "Trip", date: "2026-11-11", yearly: false },
        { name: "Old", date: "2026-01-01", yearly: false },
        { name: "Birthday", date: "2000-03-02", yearly: true },
        { name: "Today", date: "2026-11-10", yearly: false },
      ],
      now,
      5,
    );
    expect(out.map((e) => [e.name, e.days])).toEqual([
      ["Today", 0],
      ["Trip", 1],
      ["Christmas", 45],
      ["Birthday", 112],
    ]);
  });
});

async function waitFor(test: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!test()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
}
