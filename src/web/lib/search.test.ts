import { describe, expect, it } from "vitest";
import type { ViewTile } from "../../shared/api";
import { pickWebSearch, webSearchUrl } from "../../shared/web-search";
import { addressIn, search } from "./search";

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

describe("searching the web", () => {
  it("knows an address when it sees one", () => {
    expect(addressIn("nas.home:5000")).toBe("http://nas.home:5000");
    expect(addressIn("192.168.1.20/admin")).toBe("http://192.168.1.20/admin");
    expect(addressIn("example.com/news")).toBe("https://example.com/news");
    expect(addressIn("https://example.com")).toBe("https://example.com");
    expect(addressIn("3.14")).toBeNull();
    expect(addressIn("weather tomorrow")).toBeNull();
    expect(addressIn("plex")).toBeNull();
  });

  it("uses the person's engine, else the home's, and keeps the search intact", () => {
    const home = { engine: "google" as const };
    expect(pickWebSearch(home, "home")?.name).toBe("Google");
    expect(pickWebSearch(home, "duckduckgo")?.name).toBe("DuckDuckGo");
    expect(pickWebSearch(home, "off")).toBeUndefined();
    expect(pickWebSearch({ engine: "off" }, "home")).toBeUndefined();
    const own = { engine: "custom" as const, name: "SearXNG", url: "http://search.home/?q=%s" };
    const engine = pickWebSearch(own, "home");
    expect(engine?.name).toBe("SearXNG");
    expect(webSearchUrl(engine ?? { name: "", url: "" }, " cats & dogs ")).toBe(
      "http://search.home/?q=cats%20%26%20dogs",
    );
    // Your own engine needs a real address with %s; without one there's no web search.
    expect(
      pickWebSearch({ engine: "custom", url: "javascript:alert(1)//%s" }, "home"),
    ).toBeUndefined();
  });
});
