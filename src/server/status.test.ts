import { describe, expect, it } from "vitest";
import type { Tile } from "../shared/config";
import { StatusChecker } from "./status";

const tile = (id: string, extra: Partial<Tile> = {}): Tile => ({
  id,
  name: id,
  url: `http://${id}.home`,
  group: "g",
  audience: "everyone",
  check: true,
  keywords: [],
  newTab: false,
  ...extra,
});

type Answer = { status?: number; ms?: number; fail?: boolean };

function harness(answers: Record<string, () => Answer>) {
  let clock = 0;
  const fakeFetch = (async (url: string) => {
    const name = new URL(url).hostname.split(".")[0] as string;
    const a = answers[name]?.() ?? {};
    clock += a.ms ?? 10;
    if (a.fail) throw new Error("ECONNREFUSED");
    return new Response(null, { status: a.status ?? 200 });
  }) as unknown as typeof fetch;
  return new StatusChecker({
    intervalMs: 1000,
    timeoutMs: 500,
    slowMs: 100,
    fetch: fakeFetch,
    now: () => clock,
  });
}

describe("StatusChecker", () => {
  it("marks fast answers up and slow answers slow", async () => {
    // One tile per checker: the fake clock is shared, and checks run in parallel.
    const fast = harness({ a: () => ({ ms: 20 }) });
    fast.setTiles([tile("a")]);
    await fast.checkAll();
    expect(fast.snapshot().a).toMatchObject({ state: "up", ms: 20 });
    const slow = harness({ b: () => ({ ms: 400 }) });
    slow.setTiles([tile("b")]);
    await slow.checkAll();
    expect(slow.snapshot().b?.state).toBe("slow");
  });

  it("counts a login page or 401 as up, and a 5xx as a failure", async () => {
    const c = harness({ a: () => ({ status: 401 }), b: () => ({ status: 503 }) });
    c.setTiles([tile("a"), tile("b")]);
    await c.checkAll();
    await c.checkAll();
    expect(c.snapshot().a?.state).toBe("up");
    expect(c.snapshot().b?.state).toBe("down");
  });

  it("needs two failures in a row before showing down", async () => {
    let failing = false;
    const c = harness({ a: () => ({ fail: failing }) });
    c.setTiles([tile("a")]);
    await c.checkAll();
    failing = true;
    await c.checkAll();
    expect(c.snapshot().a?.state).toBe("up");
    await c.checkAll();
    expect(c.snapshot().a?.state).toBe("down");
    failing = false;
    await c.checkAll();
    expect(c.snapshot().a?.state).toBe("up");
  });

  it("skips tiles with check off, uses checkUrl, and starts unknown", () => {
    const c = harness({});
    c.setTiles([tile("a"), tile("b", { check: false }), tile("c", { checkUrl: "http://x.home" })]);
    expect(Object.keys(c.snapshot())).toEqual(["a", "c"]);
    expect(c.snapshot().a?.state).toBe("unknown");
  });

  it("forgets a result when the tile's address changes", async () => {
    const c = harness({});
    c.setTiles([tile("a")]);
    await c.checkAll();
    expect(c.snapshot().a?.state).toBe("up");
    c.setTiles([tile("a", { url: "http://other.home" })]);
    expect(c.snapshot().a?.state).toBe("unknown");
  });
});
