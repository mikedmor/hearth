import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadExtraApps } from "./catalog-extra";

describe("the admin's own catalog files", () => {
  it("reads good entries, skips bad ones and drops patterns that don't compile", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hearth-catalog-"));
    await writeFile(
      join(dir, "mine.json"),
      JSON.stringify([
        {
          id: "grocy",
          name: "Grocy",
          icon: "lucide:shopping-basket",
          category: "Home",
          ports: [9283],
          match: { title: "Grocy", body: "(unclosed" },
        },
        { id: "Bad Id", name: "Nope", icon: "", category: "Home", match: {} },
      ]),
    );
    await writeFile(join(dir, "broken.json"), "{ nope");
    const log: string[] = [];
    const apps = loadExtraApps(dir, (m) => log.push(m));
    expect(apps.map((a) => a.id)).toEqual(["grocy"]);
    expect(apps[0]?.match).toEqual({ title: "Grocy" });
    expect(log.some((l) => l.includes("broken.json"))).toBe(true);
    expect(log.some((l) => l.includes("skipped an entry"))).toBe(true);
    expect(log.some((l) => l.includes("match.body"))).toBe(true);
  });

  it("is fine with no folder", () => {
    expect(loadExtraApps(join(tmpdir(), "hearth-no-such-folder"))).toEqual([]);
  });
});
