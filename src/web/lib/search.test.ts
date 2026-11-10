import { describe, expect, it } from "vitest";
import type { ViewTile } from "../../shared/api";
import { search } from "./search";

const t = (id: string, name: string, extra: Partial<ViewTile> = {}) => ({
  tile: {
    id,
    name,
    url: `https://${id}.home`,
    iconKind: "monogram",
    checked: true,
    keywords: [],
    short: id,
    newTab: false,
    group: "everyday",
    access: { kind: "audience", audience: "everyone" } as const,
    canManage: false,
    ...extra,
  } satisfies ViewTile,
  group: "Everyday",
});

describe("search", () => {
  const tiles = [
    t("muny", "Muny", { keywords: ["budget"] }),
    t("gg", "Gaseous Games", { description: "The family's game library" }),
    t("ai", "Home AI Hub"),
    t("nas", "NAS", { description: "Synology DSM" }),
  ];
  const ids = (q: string) => search(tiles, q).map((x) => x.id);

  it("puts exact short names and name starts first", () => {
    expect(ids("gg")[0]).toBe("gg");
    expect(ids("mu")).toEqual(["muny"]);
    expect(ids("hub")).toEqual(["ai"]);
  });

  it("matches keywords, descriptions and addresses", () => {
    expect(ids("budget")).toEqual(["muny"]);
    expect(ids("synology")).toEqual(["nas"]);
    expect(ids("library")).toEqual(["gg"]);
  });

  it("ignores case and accents, and returns nothing for no match", () => {
    expect(ids("MÚNY")).toEqual(["muny"]);
    expect(ids("zzz")).toEqual([]);
    expect(ids("  ")).toEqual([]);
  });
});
