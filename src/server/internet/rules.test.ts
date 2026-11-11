import { describe, expect, it } from "vitest";
import { ProfileSchema } from "../../shared/config";
import { PersonRulesSchema } from "../../shared/internet";
import { fixture } from "../test-fixtures";
import {
  allowedSites,
  buildRules,
  FENCE_END,
  FENCE_START,
  localClock,
  modeNow,
  oursIn,
  pageSites,
  siteOf,
  withOurs,
} from "./rules";

const rules = (o: Record<string, unknown> = {}) => PersonRulesSchema.parse(o);

describe("the sites a person may reach", () => {
  it("turns links into sites, leaving out the home network", () => {
    expect(siteOf("https://www.pbskids.org/games")).toBe("pbskids.org");
    expect(siteOf("https://kids.youtube.com/")).toBe("youtube.com");
    expect(siteOf("https://www.bbc.co.uk/cbeebies")).toBe("bbc.co.uk");
    for (const local of ["https://muny.home", "http://192.168.1.50", "http://nas", "not a url"])
      expect(siteOf(local), local).toBeNull();
  });

  it("takes the internet links on their page, with what those sites need", () => {
    const cfg = fixture();
    cfg.tiles.push(
      { ...cfg.tiles[1], id: "pbs", name: "PBS Kids", url: "https://pbskids.org" } as never,
      { ...cfg.tiles[1], id: "yt", name: "YouTube", url: "https://www.youtube.com" } as never,
      {
        ...cfg.tiles[1],
        id: "secret",
        name: "Grown-ups",
        url: "https://news.example.com",
        audience: "adults",
      } as never,
    );
    const ava = ProfileSchema.parse({ id: "ava", name: "Ava", role: "child" });
    const page = pageSites(cfg, ava);
    expect(page).toEqual(["pbskids.org", "youtube.com"]);
    // Hidden from her page: not hers.
    expect(pageSites(cfg, { ...ava, hiddenTiles: ["yt"] })).toEqual(["pbskids.org"]);

    const all = allowedSites(rules({ extra: ["khanacademy.org"] }), page);
    expect(all).toEqual(
      expect.arrayContaining(["pbskids.org", "pbs.org", "googlevideo.com", "kastatic.org"]),
    );
    expect(all).toEqual(expect.arrayContaining(["captive.apple.com", "home", "icloud.com"]));
    // Search isn't a device service.
    expect(all).not.toContain("google.com");
    expect(allowedSites(rules({ essentials: "basic" }), [])).not.toContain("icloud.com");
    expect(allowedSites(rules({ usePage: false }), page)).not.toContain("pbskids.org");
  });
});

describe("the mode right now", () => {
  // Tuesday 10 November 2026, in UTC.
  const at = (hhmm: string, day = "2026-11-10") => Date.parse(`${day}T${hhmm}:00Z`);
  const bedtime = {
    id: "bed",
    name: "Bedtime",
    days: [0, 1, 2, 3, 4],
    from: "21:00",
    to: "07:00",
    mode: "paused",
  };

  it("reads the clock in the home's time zone", () => {
    expect(localClock(at("23:30"), "UTC")).toEqual({ day: 2, minutes: 23 * 60 + 30 });
    expect(localClock(at("02:30"), "America/New_York")).toEqual({ day: 1, minutes: 21 * 60 + 30 });
  });

  it("follows schedules, past midnight too, and a pause over everything", () => {
    const r = rules({ mode: "sites", schedule: [bedtime] });
    expect(modeNow(r, undefined, at("15:00"), "UTC")).toEqual({ mode: "sites", because: "usual" });
    expect(modeNow(r, undefined, at("22:00"), "UTC")).toMatchObject({
      mode: "paused",
      because: "schedule",
      schedule: "Bedtime",
      untilTime: "07:00",
    });
    // Wednesday 06:00 is still Tuesday night's bedtime.
    expect(modeNow(r, undefined, at("06:00", "2026-11-11"), "UTC").mode).toBe("paused");
    // Saturday 06:00: Friday (5) isn't a bedtime night.
    expect(modeNow(r, undefined, at("06:00", "2026-11-14"), "UTC").mode).toBe("sites");

    const pause = { by: "admin", at: "2026-11-10T14:00:00Z", until: "2026-11-10T16:00:00Z" };
    expect(modeNow(r, pause, at("15:00"), "UTC")).toMatchObject({
      mode: "paused",
      because: "pause",
    });
    expect(modeNow(r, pause, at("16:30"), "UTC").mode).toBe("sites");
    expect(modeNow(r, { by: "admin", at: "x" }, at("16:30"), "UTC").mode).toBe("paused");
  });
});

describe("AdGuard Home rules", () => {
  it("blocks everything for a person's devices but their sites, or everything when paused", () => {
    const lines = buildRules([
      {
        label: "Ava: only their sites",
        clients: ["192.168.1.41", "192.168.1.42"],
        mode: "sites",
        sites: ["pbskids.org"],
      },
      { label: "Sam: paused", clients: ["192.168.1.43"], mode: "paused", sites: ["ignored.org"] },
      { label: "Nobody's devices", clients: [], mode: "paused", sites: [] },
    ]);
    expect(lines).toEqual([
      FENCE_START,
      "! Ava: only their sites",
      "||*^$client=192.168.1.41|192.168.1.42,important",
      "@@||pbskids.org^$client=192.168.1.41|192.168.1.42,important",
      "! Sam: paused",
      "||*^$client=192.168.1.43,important",
      FENCE_END,
    ]);
    expect(buildRules([])).toEqual([]);
  });

  it("swaps only Hearth's own lines, keeping everyone else's", () => {
    const mine = ["||ads.example^", "@@||ok.example^"];
    const ours = buildRules([
      { label: "Ava", clients: ["192.168.1.41"], mode: "paused", sites: [] },
    ]);
    const first = withOurs(mine, ours);
    expect(first).toEqual([...mine, ...ours]);
    expect(oursIn(first)).toEqual(ours);
    // Someone adds a rule after Hearth's block; changing ours keeps theirs.
    const later = [...first, "||more.example^"];
    expect(withOurs(later, [])).toEqual([...mine, "||more.example^"]);
    expect(oursIn(withOurs(later, ours))).toEqual(ours);
  });
});
