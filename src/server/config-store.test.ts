import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import example from "../../config/hearth.example.json" with { type: "json" };
import { migrate } from "../shared/migrate";
import { ConfigError, ConfigStore, parseConfig } from "./config-store";
import { fixture, fixtureInput } from "./test-fixtures";

const issuesOf = (text: string): string[] => {
  try {
    parseConfig(text);
  } catch (err) {
    if (err instanceof ConfigError) return err.issues.length ? err.issues : [err.message];
    throw err;
  }
  return [];
};

// biome-ignore lint/suspicious/noExplicitAny: tests break the config on purpose
const copy = (): any => fixtureInput();

describe("parseConfig", () => {
  it("accepts the bundled example", () => {
    expect(issuesOf(JSON.stringify(example))).toEqual([]);
  });

  it("fills in defaults, including a full look and every section", () => {
    const cfg = fixture();
    expect(cfg.settings.status.intervalSeconds).toBe(30);
    expect(cfg.settings.network.allowInternet).toBe(false);
    expect(cfg.tiles[0]?.check).toBe(true);
    expect(cfg.profiles[2]?.look.theme).toBe("system");
    expect(cfg.profiles[2]?.layout.sections.map((s) => s.kind)).toEqual([
      "hero",
      "search",
      "widgets",
      "favorites",
      "groups",
    ]);
  });

  it("keeps a chosen section order and adds missing sections at the end", () => {
    const cfg = fixture({
      profiles: [
        {
          id: "a",
          name: "A",
          layout: {
            sections: [{ kind: "groups" }, { kind: "hero", hidden: true }, { kind: "groups" }],
          },
        },
      ],
    });
    expect(cfg.profiles[0]?.layout.sections).toEqual([
      { kind: "groups", hidden: false },
      { kind: "hero", hidden: true },
      { kind: "search", hidden: false },
      { kind: "widgets", hidden: false },
      { kind: "favorites", hidden: false },
    ]);
  });

  it("explains bad references with a path", () => {
    const cfg = copy();
    cfg.tiles[0].group = "nope";
    cfg.profiles[0].favorites.push("ghost");
    cfg.profiles[0].layout.widgets.push({ id: "missing", w: 4 });
    const issues = issuesOf(JSON.stringify(cfg));
    expect(issues).toContain('tiles.0.group: no group "nope"');
    expect(issues.some((i) => i.startsWith("profiles.0.favorites") && i.includes('"ghost"'))).toBe(
      true,
    );
    expect(
      issues.some((i) => i.startsWith("profiles.0.layout.widgets") && i.includes('"missing"')),
    ).toBe(true);
  });

  it("refuses duplicate ids, reserved and clashing short links", () => {
    const cfg = copy();
    cfg.tiles.push({ ...cfg.tiles[0] });
    cfg.tiles.push({ id: "x", name: "X", url: "http://x.home", group: "everyday", short: "chat" });
    const issues = issuesOf(JSON.stringify(cfg));
    expect(issues.some((i) => i.includes('duplicate tile id "muny"'))).toBe(true);
    expect(issues.some((i) => i.includes('short link "muny" is already used'))).toBe(true);
    expect(issues.some((i) => i.includes('"chat" is reserved'))).toBe(true);
  });

  it("refuses addresses that aren't http or https, and broken widget documents", () => {
    const cfg = copy();
    cfg.tiles[0].url = "javascript:alert(1)";
    cfg.widgets.push({ id: "bad", type: "custom", doc: { v: 1, blocks: [] } });
    const issues = issuesOf(JSON.stringify(cfg));
    expect(issues.some((i) => i.startsWith("tiles.0.url"))).toBe(true);
    expect(issues.some((i) => i.includes("doc.blocks"))).toBe(true);
  });

  it("reports broken JSON plainly", () => {
    expect(issuesOf("{ nope")[0]).toMatch(/not valid JSON/);
  });
});

describe("upgrading a version 1 file", () => {
  const v1 = {
    version: 1,
    settings: { title: "Home", guestWidgets: ["note"] },
    groups: [{ id: "g", name: "G" }],
    tiles: [{ id: "a", name: "A", url: "http://a.home", group: "g" }],
    widgets: [
      { id: "note", type: "note", size: "wide", options: { text: "hi" } },
      { id: "health", type: "status" },
    ],
    profiles: [
      { id: "p", name: "P", theme: "dark", widgets: ["health", "note"], favorites: ["a"] },
    ],
  };

  it("moves widgets into layouts and themes into looks", () => {
    const { config, from } = migrate(v1);
    expect(from).toBe(1);
    const cfg = parseConfig(JSON.stringify(config));
    expect(cfg.settings.guest.layout.widgets).toEqual([{ id: "note", w: 8 }]);
    expect(cfg.profiles[0]?.layout.widgets).toEqual([
      { id: "health", w: 4 },
      { id: "note", w: 8 },
    ]);
    expect(cfg.profiles[0]?.look.theme).toBe("ember");
    expect(cfg.profiles[0]?.favorites).toEqual(["a"]);
  });

  it("keeps the old file next to the new one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hearth-"));
    await writeFile(join(dir, "hearth.json"), JSON.stringify(v1));
    await new ConfigStore(dir).load();
    expect(JSON.parse(await readFile(join(dir, "hearth.json.v1"), "utf8")).version).toBe(1);
    expect(JSON.parse(await readFile(join(dir, "hearth.json"), "utf8")).version).toBe(3);
  });
});

describe("upgrading a version 2 file", () => {
  const v2 = {
    version: 2,
    groups: [{ id: "g", name: "G" }],
    tiles: [{ id: "news", name: "News", url: "http://news.home", group: "g" }],
    profiles: [
      {
        id: "p",
        name: "P",
        favorites: ["news", "link:news", "link:mail"],
        groupOrder: ["my-links", "g"],
        hiddenGroups: [],
        links: [
          { id: "news", name: "My news", url: "https://news.example" },
          { id: "mail", name: "Mail", url: "https://mail.example" },
        ],
      },
      { id: "q", name: "Q", groupOrder: ["my-links"], links: [] },
    ],
  };

  it("makes people's links their own links in a section they can see, keeping favourites", () => {
    const { config, from } = migrate(v2);
    expect(from).toBe(2);
    const cfg = parseConfig(JSON.stringify(config));
    // No "My links" section: they go in the house's section.
    expect(cfg.groups.map((g) => [g.id, g.owner])).toEqual([["g", undefined]]);
    expect(cfg.tiles.map((t) => [t.id, t.group, t.owner])).toEqual([
      ["news", "g", undefined],
      ["p-news", "g", "p"],
      ["mail", "g", "p"],
    ]);
    const p = cfg.profiles[0];
    expect(p?.favorites).toEqual(["news", "p-news", "mail"]);
    expect(p?.groupOrder).toEqual(["g"]);
    expect(cfg.profiles[1]?.groupOrder).toEqual([]);
  });

  it("gives someone who can see no section one of their own", () => {
    const kid = {
      ...v2,
      groups: [{ id: "g", name: "G", audience: "adults" }],
      profiles: [{ ...v2.profiles[0], role: "child", groupOrder: ["my-links", "g"] }],
    };
    const cfg = parseConfig(JSON.stringify(migrate(kid).config));
    expect(cfg.groups.map((g) => [g.id, g.name, g.owner])).toEqual([
      ["g", "G", undefined],
      ["p-links", "Links", "p"],
    ]);
    expect(cfg.tiles.filter((t) => t.owner).every((t) => t.group === "p-links")).toBe(true);
    expect(cfg.profiles[0]?.groupOrder).toEqual(["p-links", "g"]);
  });
});

describe("ConfigStore", () => {
  it("seeds the example on first run and saves", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hearth-"));
    const store = new ConfigStore(dir);
    const cfg = await store.load();
    expect(cfg.tiles.length).toBe(example.tiles.length);
    expect(cfg.widgets.length).toBe(example.widgets.length);
    await store.update((d) => {
      d.settings.title = "Our home";
    });
    const saved = JSON.parse(await readFile(join(dir, "hearth.json"), "utf8"));
    expect(saved.settings.title).toBe("Our home");
  });

  it("refuses an update that would break the config, and keeps the file as it was", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hearth-"));
    await writeFile(join(dir, "hearth.json"), JSON.stringify(fixtureInput()));
    const store = new ConfigStore(dir);
    await store.load();
    await expect(
      store.update((d) => {
        d.tiles[0] = { ...(d.tiles[0] as (typeof d.tiles)[0]), group: "nowhere" };
      }),
    ).rejects.toBeInstanceOf(ConfigError);
    expect(store.get().tiles[0]?.group).toBe("everyday");
  });

  it("runs updates one after another, so none is lost", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hearth-"));
    const store = new ConfigStore(dir);
    await store.load();
    await Promise.all(
      ["a", "b", "c"].map((id) =>
        store.update((d) => {
          d.groups.push({ id, name: id.toUpperCase(), audience: "everyone" });
        }),
      ),
    );
    expect(store.get().groups.map((g) => g.id)).toEqual(expect.arrayContaining(["a", "b", "c"]));
  });

  it("keeps the last good config when the file breaks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hearth-"));
    const store = new ConfigStore(dir);
    await store.load();
    await writeFile(join(dir, "hearth.json"), "{ broken");
    await expect(store.load()).rejects.toBeInstanceOf(ConfigError);
    expect(store.get().settings.title).toBe("Hearth");
    expect(store.error?.message).toMatch(/not valid JSON/);
  });
});
