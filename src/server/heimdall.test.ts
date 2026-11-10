import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { isLocalUrl } from "../shared/config";
import { parseConfig } from "./config-store";
import { planImport, readHeimdall, uniqueSlug } from "./heimdall";
import { fixture } from "./test-fixtures";

/** A database shaped like Heimdall 2.x's app.sqlite. */
async function fakeHeimdall(): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), "heimdall-")), "app.sqlite");
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT, colour TEXT, icon TEXT, url TEXT,
      description TEXT, pinned INTEGER, "order" INTEGER, deleted_at TEXT, type INTEGER,
      class TEXT, appid TEXT, appdescription TEXT, user_id INTEGER);
    CREATE TABLE item_tag (item_id INTEGER, tag_id INTEGER);
    INSERT INTO items (id, title, type, url) VALUES (0, 'app.dashboard', 1, '');
    INSERT INTO items (id, title, type, url) VALUES (10, 'Media', 1, 'media');
    INSERT INTO items (id, title, colour, icon, url, description, pinned, "order", type) VALUES
      (1, 'Plex', '#e5a00d', 'icons/plex.png', 'http://192.168.1.200:32400/web', '{"apikey":"SECRET"}', 1, 2, 0),
      (2, 'Muny again', '#161b1f', NULL, 'https://muny.home/', NULL, 1, 1, 0),
      (3, 'Google', NULL, NULL, 'https://www.google.com', NULL, 1, 3, 0),
      (4, 'Old one', NULL, NULL, 'http://old.home', NULL, 1, 4, 0),
      (5, 'Weird', NULL, NULL, 'ftp://files.home', NULL, 1, 5, 0),
      (6, 'API', NULL, NULL, 'http://api.home', NULL, 1, 6, 0);
    UPDATE items SET deleted_at = '2025-01-01' WHERE id = 4;
    INSERT INTO item_tag VALUES (1, 0), (1, 10), (2, 0), (3, 0);
  `);
  db.close();
  return path;
}

describe("Heimdall import", () => {
  it("reads apps in order, with tags, and skips deleted ones", async () => {
    const data = readHeimdall(await fakeHeimdall());
    expect(data.apps.map((a) => a.title)).toEqual(["Muny again", "Plex", "Google", "Weird", "API"]);
    expect(data.tags).toEqual([{ id: 10, title: "Media" }]);
    expect(data.apps.find((a) => a.title === "Plex")?.tagIds).toEqual([0, 10]);
  });

  it("plans tiles and groups without touching the original config", async () => {
    const cfg = fixture();
    const plan = planImport(cfg, readHeimdall(await fakeHeimdall()));
    expect(cfg.tiles).toHaveLength(4);

    const names = plan.added.map((a) => a.tile.name);
    expect(names).toEqual(["Plex", "Google", "API"]);
    expect(plan.skipped.map((s) => s.title)).toEqual(["Muny again", "Weird"]);
    expect(plan.newGroups).toEqual(["Media", "From Heimdall"]);

    const plex = plan.added[0]?.tile;
    expect(plex).toMatchObject({ id: "plex", color: "#e5a00d", icon: "plex.png", check: true });
    expect(plan.icons).toEqual([{ from: "icons/plex.png", to: "plex.png" }]);
    // Internet sites aren't checked; reserved words don't become ids or short links.
    expect(plan.added[1]?.tile.check).toBe(false);
    expect(plan.added[2]?.tile.id).toBe("api-2");

    // The result is a valid config, and Heimdall's settings (API keys) never came along.
    expect(() => parseConfig(JSON.stringify(plan.config))).not.toThrow();
    expect(JSON.stringify(plan.config)).not.toContain("SECRET");
  });

  it("adds nothing the second time", async () => {
    const data = readHeimdall(await fakeHeimdall());
    const once = planImport(fixture(), data);
    expect(planImport(once.config, data).added).toEqual([]);
  });

  it("makes unique slugs", () => {
    expect(uniqueSlug("Plex Media Server!", new Set(), "tile")).toBe("plex-media-server");
    expect(uniqueSlug("Café", new Set(["cafe"]), "tile")).toBe("cafe-2");
    expect(uniqueSlug("!!!", new Set(), "tile")).toBe("tile");
  });
});

describe("isLocalUrl", () => {
  it("knows the home network from the internet", () => {
    for (const u of [
      "https://muny.home",
      "http://192.168.1.200:8420",
      "http://10.0.0.5",
      "http://172.20.1.1",
      "http://nas",
      "http://printer.local",
      "http://localhost:3000",
      "http://[::1]:8080",
      "http://100.100.1.2",
    ]) {
      expect(isLocalUrl(u), u).toBe(true);
    }
    for (const u of [
      "https://www.google.com",
      "http://8.8.8.8",
      "http://172.32.0.1",
      "https://home.example.com",
      "http://[2001:db8::1]",
      "not a url",
    ]) {
      expect(isLocalUrl(u), u).toBe(false);
    }
  });
});
