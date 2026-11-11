import { describe, expect, it } from "vitest";
import type { Session } from "../shared/api";
import { canSee, isChecked, statusFor, type Tile } from "../shared/config";
import type { ConfigError } from "./config-store";
import { fixture } from "./test-fixtures";
import { buildHomeView, findProfile, toViewTile } from "./view";

const session = (s: Partial<Session> = {}): Session => ({
  needsSetup: false,
  admin: false,
  profile: null,
  ...s,
});
const view = (cfg: ReturnType<typeof fixture>, id: string | null, s: Partial<Session> = {}) =>
  buildHomeView(cfg, {
    profile: findProfile(cfg, id),
    session: session({ profile: id, ...s }),
    hasPin: (p) => p === "alex",
  });
const tileIds = (v: ReturnType<typeof buildHomeView>) =>
  v.groups.flatMap((g) => g.tiles.map((t) => t.id));

describe("what people can use", () => {
  it("is by role, the admin always may, and Files starts off for children", () => {
    const cfg = fixture();
    const kid = cfg.profiles.find((p) => p.role === "child");
    const adult = cfg.profiles.find((p) => p.role === "adult");
    if (!kid || !adult) throw new Error("the fixture needs a child and an adult");
    const kidView = view(cfg, kid.id);
    expect(kidView).toMatchObject({ canFiles: false, canCalendar: true });
    expect(view(cfg, adult.id)).toMatchObject({ canFiles: true, canCalendar: true });
    expect(view(cfg, kid.id, { admin: true }).canFiles).toBe(true);
    expect(view(cfg, null)).toMatchObject({ canFiles: false, canCalendar: false });
    cfg.settings.features.calendar = ["admin", "adult"];
    expect(view(cfg, kid.id).canCalendar).toBe(false);
  });
});

describe("audiences", () => {
  it("match roles", () => {
    expect(canSee("everyone", null)).toBe(true);
    expect(canSee("adults", null)).toBe(false);
    expect(canSee("adults", "child")).toBe(false);
    expect(canSee("adults", "adult")).toBe(true);
    expect(canSee("admin", "adult")).toBe(false);
    expect(canSee("admin", "admin")).toBe(true);
  });
});

describe("buildHomeView", () => {
  const cfg = fixture();

  it("shows a guest only everyone-tiles and the guest page's widgets, and no editing", () => {
    const v = view(cfg, null);
    expect(v.profile).toBeNull();
    expect(tileIds(v)).toEqual(["gg", "printer"]);
    expect(v.widgets).toEqual([{ id: "note", type: "note", title: undefined, w: 8 }]);
    expect(v.canEdit).toBe(false);
    expect(v.canChat).toBe(false);
    expect(v.profiles.find((p) => p.id === "alex")?.hasPin).toBe(true);
  });

  it("shows the admin everything, with favourites, chat and editing", () => {
    const v = view(cfg, "alex");
    expect(tileIds(v)).toEqual(["muny", "gg", "printer", "nas"]);
    expect(v.favorites.map((t) => t.id)).toEqual(["nas"]);
    expect(v.widgets.map((w) => w.id)).toEqual(["health", "secret"]);
    expect(v.canEdit).toBe(true);
    expect(v.canChat).toBe(true);
    expect(v.library.map((w) => w.id)).toEqual(["note", "lights"]);
  });

  it("hides adult tiles, admin groups and admin widgets from a child, whose locked page can't be edited", () => {
    const v = view(cfg, "kid");
    expect(tileIds(v)).toEqual(["printer"]);
    expect(v.groups.map((g) => g.id)).toEqual(["everyday"]);
    expect(v.widgets.map((w) => w.id)).toEqual(["note"]);
    expect(v.hiddenTiles).toEqual(["gg"]);
    expect(v.canEdit).toBe(false);
    expect(v.canChat).toBe(false);
    // The admin, signed in on the child's device, can arrange it.
    expect(view(cfg, "kid", { admin: true }).canEdit).toBe(true);
  });

  it("follows a profile's group order", () => {
    const c = fixture({ profiles: [{ id: "a", name: "A", role: "admin", groupOrder: ["admin"] }] });
    expect(view(c, "a").groups.map((g) => g.id)).toEqual(["admin", "everyday"]);
  });

  it("never sends check addresses or owners", () => {
    const json = JSON.stringify(view(cfg, "alex"));
    expect(json).not.toContain("checkUrl");
    expect(json).not.toContain("owner");
  });

  it("keeps empty sections, for edit mode", () => {
    const c = fixture({
      groups: [
        { id: "everyday", name: "Everyday" },
        { id: "admin", name: "Admin", audience: "admin" },
        { id: "empty", name: "Empty" },
      ],
    });
    expect(view(c, "sam").groups.map((g) => g.id)).toEqual(["everyday", "empty"]);
  });
});

describe("sections and links of one's own, and for some people", () => {
  const cfg = fixture({
    groups: [
      { id: "everyday", name: "Everyday" },
      { id: "admin", name: "Admin", audience: "admin" },
      { id: "sams", name: "Sam's", owner: "sam" },
      { id: "kids", name: "Kids", people: ["kid"] },
    ],
    tiles: [
      { id: "muny", name: "Muny", url: "https://muny.home", group: "everyday" },
      { id: "bank", name: "Bank", url: "https://bank.example", group: "sams", owner: "sam" },
      { id: "news", name: "News", url: "https://news.example", group: "everyday", owner: "sam" },
      { id: "lego", name: "Lego", url: "https://lego.example", group: "kids" },
      { id: "secret", name: "Hm", url: "https://hm.example", group: "everyday", people: ["kid"] },
    ],
    profiles: [
      { id: "alex", name: "Alex", role: "admin" },
      { id: "kid", name: "Kid", role: "child", locked: true },
      { id: "sam", name: "Sam", role: "adult" },
    ],
  });

  it("shows someone's own only to them, even to the admin", () => {
    const sam = view(cfg, "sam");
    expect(tileIds(sam)).toEqual(["muny", "news", "bank"]);
    const g = sam.groups.find((x) => x.id === "sams");
    expect(g?.access).toEqual({ kind: "mine" });
    expect(g?.canManage).toBe(true);
    expect(sam.groups.find((x) => x.id === "everyday")?.tiles[1]?.canManage).toBe(true);
    expect(sam.groups.find((x) => x.id === "everyday")?.tiles[0]?.canManage).toBe(false);
    expect(tileIds(view(cfg, "alex", { admin: true }))).not.toContain("bank");
  });

  it("shows a people-only section to those people and the admin", () => {
    expect(tileIds(view(cfg, "kid"))).toEqual(["muny", "secret", "lego"]);
    expect(tileIds(view(cfg, "sam"))).not.toContain("lego");
    expect(tileIds(view(cfg, "alex"))).toContain("lego");
    expect(view(cfg, "kid").groups.find((x) => x.id === "kids")?.access).toEqual({
      kind: "people",
      people: ["kid"],
    });
  });

  it("lets people add their own links to the house's sections, unless their page is locked", () => {
    const sam = view(cfg, "sam");
    expect(sam.canAddOwn).toBe(true);
    expect(sam.groups.find((x) => x.id === "everyday")?.canAdd).toBe(true);
    expect(sam.groups.find((x) => x.id === "everyday")?.canManage).toBe(false);
    const kid = view(cfg, "kid");
    expect(kid.canAddOwn).toBe(false);
    expect(kid.groups.every((x) => !x.canAdd)).toBe(true);
  });

  it("refuses the house's links in someone's own section", () => {
    let issues: string[] = [];
    try {
      fixture({
        groups: [{ id: "sams", name: "Sam's", owner: "sam" }],
        tiles: [{ id: "x", name: "X", url: "https://x.home", group: "sams" }],
        profiles: [{ id: "sam", name: "Sam" }],
      });
    } catch (e) {
      issues = (e as ConfigError).issues;
    }
    expect(issues.some((i) => i.includes("own section"))).toBe(true);
  });
});

describe("toViewTile", () => {
  const base: Tile = {
    id: "a",
    name: "A",
    url: "http://a.home",
    group: "g",
    audience: "everyone",
    check: true,
    keywords: [],
    newTab: false,
  };
  it("tells emoji, image files and monograms apart", () => {
    expect(toViewTile({ ...base, icon: "💰" }).iconKind).toBe("emoji");
    expect(toViewTile({ ...base, icon: "muny.png" })).toMatchObject({
      iconKind: "image",
      icon: "/icons/muny.png",
    });
    expect(toViewTile(base).iconKind).toBe("monogram");
  });

  it("doesn't check internet addresses", () => {
    expect(toViewTile({ ...base, url: "https://www.google.com" }).checked).toBe(false);
    expect(toViewTile(base).checked).toBe(true);
  });
});

describe("status of people's own links", () => {
  it("checks them, and gives their status only to their owner", () => {
    expect(isChecked({ check: true, url: "http://192.168.1.30" })).toBe(true);
    const status = { house: "up", mine: "down", theirs: "up" };
    const tiles = [{ id: "house" }, { id: "mine", owner: "alex" }, { id: "theirs", owner: "sam" }];
    expect(statusFor(status, tiles, "alex")).toEqual({ house: "up", mine: "down" });
    expect(statusFor(status, tiles, null)).toEqual({ house: "up" });
  });
});
