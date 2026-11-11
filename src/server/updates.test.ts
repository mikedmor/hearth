import { describe, expect, it } from "vitest";
import { isNewer, parseVersion, Updates } from "./updates";

const release = (tag: string, extra: Record<string, unknown> = {}) =>
  (async () =>
    new Response(
      JSON.stringify({
        tag_name: tag,
        name: `Hearth ${tag}`,
        html_url: `https://github.com/mikedmor/hearth/releases/tag/${tag}`,
        body: "### Added\n\n- Something new",
        published_at: "2026-11-11T12:00:00Z",
        ...extra,
      }),
      { headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;

describe("versions", () => {
  it("reads release and build versions, and not dev builds", () => {
    expect(parseVersion("v1.2.3")?.n).toEqual([1, 2, 3]);
    expect(parseVersion("1.0.0+8e791c3.local")?.n).toEqual([1, 0, 0]);
    expect(parseVersion("1.1.0-beta.2")?.pre).toBe("beta.2");
    expect(parseVersion("dev")).toBeNull();
    expect(parseVersion("8e791c3+local")).toBeNull();
  });

  it("knows which is newer", () => {
    expect(isNewer("v1.0.1", "1.0.0")).toBe(true);
    expect(isNewer("v1.10.0", "1.9.9")).toBe(true);
    expect(isNewer("v1.0.0", "1.0.0+abc")).toBe(false);
    expect(isNewer("v1.0.0", "1.1.0")).toBe(false);
    expect(isNewer("v1.0.0", "1.0.0-beta.1")).toBe(true);
    expect(isNewer("v1.0.0-beta.2", "1.0.0-beta.10")).toBe(false);
    expect(isNewer("v1.0.0", "dev")).toBe(false);
  });
});

describe("the update check", () => {
  it("finds a newer release and says so once", async () => {
    const found: string[] = [];
    const u = new Updates({
      current: "1.0.0",
      enabled: () => true,
      fetch: release("v1.1.0"),
      onFound: (v) => found.push(v),
    });
    expect(u.status().available).toBeUndefined();
    await u.check();
    expect(u.status().available).toMatchObject({ version: "1.1.0", notes: expect.any(String) });
    await u.check();
    expect(found).toEqual(["1.1.0"]);
  });

  it("is quiet when up to date, and on a dev build", async () => {
    const same = new Updates({ current: "1.1.0", enabled: () => true, fetch: release("v1.1.0") });
    await same.check();
    expect(same.status()).toMatchObject({ latest: "1.1.0", available: undefined });
    const dev = new Updates({ current: "dev", enabled: () => true, fetch: release("v1.1.0") });
    await dev.check();
    expect(dev.status()).toMatchObject({ devBuild: true, available: undefined });
  });

  it("links only to GitHub's own page, and says plainly what went wrong", async () => {
    const odd = new Updates({
      current: "1.0.0",
      enabled: () => true,
      fetch: release("v2.0.0", { html_url: "https://evil.example/x" }),
    });
    await odd.check();
    expect(odd.status().available?.url).toBe("https://github.com/mikedmor/hearth/releases");
    const none = new Updates({
      current: "1.0.0",
      enabled: () => true,
      fetch: (async () => new Response("", { status: 404 })) as unknown as typeof fetch,
    });
    await none.check();
    expect(none.status().error).toMatch(/no releases/);
  });
});
