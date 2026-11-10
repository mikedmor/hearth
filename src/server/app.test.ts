import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { HomeView } from "../shared/api";
import { AiMonitor } from "./ai/monitor";
import { createApp } from "./app";
import { AuthStore } from "./auth";
import { CalendarService } from "./calendar/service";
import { CalendarStore } from "./calendar/store";
import { ConfigStore } from "./config-store";
import { SecretStore } from "./secrets";
import { fixtureInput } from "./test-fixtures";
import { WidgetHub } from "./widgets/runtime";

async function makeApp(opts: { built?: boolean } = { built: true }) {
  const dir = await mkdtemp(join(tmpdir(), "hearth-app-"));
  await writeFile(join(dir, "hearth.json"), JSON.stringify(fixtureInput()));
  const config = new ConfigStore(dir);
  await config.load();
  const master = randomBytes(32);
  const auth = new AuthStore(dir, master);
  await auth.load();
  const secrets = new SecretStore(dir, master);
  const ai = new AiMonitor({
    servers: () => config.get().settings.ai.servers,
    keyFor: (id) => secrets.get(`ai:${id}`),
  });
  const status = () => ({
    muny: { state: "down" as const },
    gg: { state: "up" as const, ms: 12 },
    nas: { state: "up" as const },
  });
  const hub = new WidgetHub({ config: () => config.get(), status, ai, secrets });
  let webDir: string | undefined;
  if (opts.built) {
    webDir = join(dir, "web");
    await mkdir(join(webDir, "assets"), { recursive: true });
    await writeFile(join(webDir, "index.html"), "<!doctype html><title>Hearth</title>");
    await writeFile(join(webDir, "assets", "app.js"), "console.log(1)");
  }
  const calendar = new CalendarService({
    store: new CalendarStore(dir),
    secrets,
    settings: () => config.get().settings,
    profiles: () => config.get().profiles,
  });
  const app = createApp({ config, auth, secrets, hub, ai, calendar, status, dataDir: dir, webDir });
  const jar = new Map<string, string>();
  const req = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await app.request(path, {
      method,
      headers: {
        cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
        ...(method !== "GET" ? { "x-hearth": "1", "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const [k, v] = (pair as string).split("=");
      if (v) jar.set(k as string, decodeURIComponent(v));
      else jar.delete(k as string);
    }
    return res;
  };
  const signInAdmin = async () => {
    expect(
      (await req("POST", "/api/setup", { code: auth.setupCode, password: "a good password" }))
        .status,
    ).toBe(200);
  };
  return { app, req, jar, auth, config, secrets, signInAdmin };
}

const home = async (req: Awaited<ReturnType<typeof makeApp>>["req"]) =>
  (await (await req("GET", "/api/home")).json()) as HomeView;

describe("sessions", () => {
  it("starts as a guest, and opens a profile on this device", async () => {
    const { req } = await makeApp();
    expect((await home(req)).profile).toBeNull();
    expect((await req("POST", "/api/profile", { id: "sam" })).status).toBe(200);
    expect((await home(req)).profile?.name).toBe("Sam");
    await req("POST", "/api/profile", { id: null });
    expect((await home(req)).profile).toBeNull();
  });

  it("needs the PIN for a profile that has one", async () => {
    const { req, auth } = await makeApp();
    await auth.setPin("sam", "2468");
    expect((await req("POST", "/api/profile", { id: "sam" })).status).toBe(401);
    expect((await req("POST", "/api/profile", { id: "sam", pin: "2468" })).status).toBe(200);
    expect((await home(req)).profile?.hasPin).toBe(true);
  });

  it("sets up the admin with the log code, then signs in and out", async () => {
    const { req, signInAdmin } = await makeApp();
    expect((await home(req)).session.needsSetup).toBe(true);
    await signInAdmin();
    expect((await home(req)).session).toMatchObject({ admin: true, needsSetup: false });
    await req("POST", "/api/logout");
    expect((await home(req)).session.admin).toBe(false);
    expect((await req("POST", "/api/login", { password: "a good password" })).status).toBe(200);
  });

  it("refuses changes that don't come from Hearth's page", async () => {
    const { req } = await makeApp();
    const noHeader = await req("POST", "/api/profile", { id: "sam" }, { "x-hearth": "" });
    expect(noHeader.status).toBe(403);
    const otherSite = await req(
      "POST",
      "/api/profile",
      { id: "sam" },
      { origin: "http://evil.example", host: "start.home" },
    );
    expect(otherSite.status).toBe(403);
  });
});

describe("your own page", () => {
  it("lets someone change their look and layout, but not someone else's", async () => {
    const { req } = await makeApp();
    await req("POST", "/api/profile", { id: "sam" });
    expect(
      (await req("PUT", "/api/me/look", { theme: "forest", tileStyle: "glass", radius: 8 })).status,
    ).toBe(200);
    expect((await req("PUT", "/api/me/layout", { widgets: [{ id: "note", w: 12 }] })).status).toBe(
      200,
    );
    const v = await home(req);
    expect(v.look).toMatchObject({ theme: "forest", tileStyle: "glass", radius: 8 });
    expect(v.widgets).toEqual([{ id: "note", type: "note", title: undefined, w: 12 }]);
    expect((await req("PUT", "/api/me/look?profile=alex", { theme: "ember" })).status).toBe(403);
  });

  it("refuses widgets this person may not see, and edits to a locked page", async () => {
    const { req } = await makeApp();
    await req("POST", "/api/profile", { id: "sam" });
    expect((await req("PUT", "/api/me/layout", { widgets: [{ id: "secret", w: 4 }] })).status).toBe(
      400,
    );
    await req("POST", "/api/profile", { id: "kid" });
    expect((await req("PUT", "/api/me/look", { theme: "candy" })).status).toBe(403);
  });

  it("serves this person's CSS as a stylesheet", async () => {
    const { req } = await makeApp();
    await req("POST", "/api/profile", { id: "sam" });
    await req("PUT", "/api/me/look", { css: ".tile { border-width: 2px }</style><script>" });
    const res = await req("GET", "/api/look.css");
    expect(res.headers.get("content-type")).toContain("text/css");
    expect(await res.text()).not.toMatch(/<\/?style/i);
  });

  it("lets someone set their own PIN", async () => {
    const { req, auth } = await makeApp();
    await req("POST", "/api/profile", { id: "sam" });
    expect((await req("PUT", "/api/me/pin", { pin: "1357" })).status).toBe(200);
    expect(auth.hasPin("sam")).toBe(true);
    // Still open on this device.
    expect((await home(req)).profile?.id).toBe("sam");
  });
});

describe("the admin", () => {
  it("is required for shared changes", async () => {
    const { req } = await makeApp();
    expect((await req("GET", "/api/admin/config")).status).toBe(403);
    expect(
      (
        await req("PUT", "/api/admin/tiles/new", {
          id: "new",
          name: "New",
          url: "http://new.home",
          group: "everyday",
        })
      ).status,
    ).toBe(403);
  });

  it("adds, renames and deletes tiles, keeping everyone's favourites right", async () => {
    const { req, config, signInAdmin } = await makeApp();
    await signInAdmin();
    expect(
      (
        await req("PUT", "/api/admin/tiles/plex", {
          id: "plex",
          name: "Plex",
          url: "http://plex.home",
          group: "everyday",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await req("PUT", "/api/admin/tiles/nas", {
          id: "dsm",
          name: "DSM",
          url: "https://nas.home",
          group: "admin",
        })
      ).status,
    ).toBe(200);
    expect(config.get().profiles.find((p) => p.id === "alex")?.favorites).toEqual(["dsm"]);
    expect((await req("DELETE", "/api/admin/tiles/dsm")).status).toBe(200);
    expect(config.get().profiles.find((p) => p.id === "alex")?.favorites).toEqual([]);
  });

  it("explains a change that would break the config", async () => {
    const { req, signInAdmin } = await makeApp();
    await signInAdmin();
    const res = await req("PUT", "/api/admin/tiles/x", {
      id: "x",
      name: "X",
      url: "http://x.home",
      group: "nope",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { issues: string[] }).issues.join()).toContain('no group "nope"');
  });

  it("keeps AI keys as secrets, out of the config", async () => {
    const { req, config, secrets, signInAdmin } = await makeApp();
    await signInAdmin();
    await req("PUT", "/api/admin/ai/servers/cloud", {
      id: "cloud",
      name: "Cloud",
      kind: "openai",
      url: "https://api.example.com/v1",
      key: "sk-test-123456",
    });
    expect(JSON.stringify(config.get())).not.toContain("sk-test");
    expect(secrets.get("ai:cloud")).toBe("sk-test-123456");
    const admin = (await (await req("GET", "/api/admin/config")).json()) as { secrets: string[] };
    expect(JSON.stringify(admin)).not.toContain("sk-test");
    expect(admin.secrets).toContain("ai:cloud");
  });

  it("previews a widget and hands out the assistant prompt", async () => {
    const { req, signInAdmin } = await makeApp();
    await signInAdmin();
    const r = await req("POST", "/api/widgets/preview", {
      doc: {
        v: 1,
        sources: [{ id: "h", kind: "hearth", what: "status" }],
        blocks: [{ id: "a", kind: "stat", value: "$h.up" }],
      },
    });
    expect(
      ((await r.json()) as { frame: { blocks: { value: string }[] } }).frame.blocks[0]?.value,
    ).toBe("2");
    expect(await (await req("GET", "/api/widgets-guide")).text()).toContain(
      "A Hearth widget is a JSON document",
    );
  });
});

describe("chat", () => {
  it("is only for the roles the admin chose", async () => {
    const { req } = await makeApp();
    expect(
      (await req("POST", "/api/ai/chat", { messages: [{ role: "user", content: "hi" }] })).status,
    ).toBe(403);
    await req("POST", "/api/profile", { id: "kid" });
    expect((await req("GET", "/api/ai/servers")).status).toBe(403);
    await req("POST", "/api/profile", { id: "sam" });
    const servers = (await (await req("GET", "/api/ai/servers")).json()) as { url?: string }[];
    expect(servers).toHaveLength(1);
    expect(servers[0]?.url).toBeUndefined(); // only the admin sees addresses
  });
});

describe("widgets and the page", () => {
  it("serves widget data only to those who may see it", async () => {
    const { req } = await makeApp();
    expect((await req("GET", "/api/widgets/secret")).status).toBe(404);
    const health = (await (await req("GET", "/api/widgets/health")).json()) as {
      data: { total: number };
    };
    expect(health.data.total).toBe(1); // a guest only sees the everyone-tiles
  });

  it("redirects short links, but not reserved or turned-off ones", async () => {
    const { req } = await makeApp();
    const res = await req("GET", "/muny");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://muny.home");
    expect((await req("GET", "/printer")).status).toBe(404);
    expect((await req("GET", "/nope")).status).toBe(404);
  });

  it("serves the page and its routes with a strict CSP, and refuses path tricks", async () => {
    const { req } = await makeApp();
    for (const path of ["/", "/chat", "/widgets/abc", "/settings"]) {
      const page = await req("GET", path);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-security-policy")).toContain("default-src 'self'");
      expect(page.headers.get("content-security-policy")).not.toContain("unsafe-inline");
    }
    expect((await req("GET", "/assets/app.js")).status).toBe(200);
    expect((await req("GET", "/assets/..%2f..%2fhearth.json")).status).toBe(404);
    expect((await req("GET", "/icons/..%2fhearth.json")).status).toBe(404);
    expect((await req("GET", "/media/backgrounds/..%2fauth.json")).status).toBe(404);
  });

  it("points to the dev page when there's no built page", async () => {
    const { req } = await makeApp({ built: false });
    expect(await (await req("GET", "/")).text()).toContain("localhost:5173");
  });
});

describe("behind a proxy", () => {
  it("accepts the page's changes when the proxy rewrote Host but says where it came from", async () => {
    const { req } = await makeApp();
    const ok = await req(
      "POST",
      "/api/profile",
      { id: "sam" },
      { origin: "http://start.home", host: "192.168.1.200:8082", "x-forwarded-host": "start.home" },
    );
    expect(ok.status).toBe(200);
    const dev = await req(
      "POST",
      "/api/profile",
      { id: "sam" },
      { origin: "http://localhost:5173", host: "localhost:5173" },
    );
    expect(dev.status).toBe(200);
    const other = await req(
      "POST",
      "/api/profile",
      { id: "sam" },
      {
        origin: "http://evil.example",
        host: "192.168.1.200:8082",
        "x-forwarded-host": "start.home",
      },
    );
    expect(other.status).toBe(403);
  });
});

describe("admin routes that sit beside the general one", () => {
  it("sets and clears a profile's PIN", async () => {
    const { req, auth, signInAdmin } = await makeApp();
    await signInAdmin();
    expect((await req("PUT", "/api/admin/pins/alex", { pin: "2468" })).status).toBe(200);
    expect(auth.hasPin("alex")).toBe(true);
    expect((await req("PUT", "/api/admin/pins/alex", { pin: null })).status).toBe(200);
    expect(auth.hasPin("alex")).toBe(false);
    expect((await req("PUT", "/api/admin/pins/nobody", { pin: "2468" })).status).toBe(404);
  });

  it("reorders tiles and groups", async () => {
    const { req, config, signInAdmin } = await makeApp();
    await signInAdmin();
    expect(
      (await req("PUT", "/api/admin/order/tiles", { ids: ["printer", "nas", "gg", "muny"] }))
        .status,
    ).toBe(200);
    expect(config.get().tiles.map((t) => t.id)).toEqual(["printer", "nas", "gg", "muny"]);
    const g = await req("PUT", "/api/admin/order/groups", { ids: ["admin", "everyday"] });
    expect(g.status, await g.clone().text()).toBe(200);
    expect(config.get().groups.map((g) => g.id)).toEqual(["admin", "everyday"]);
  });

  it("saves and removes secrets", async () => {
    const { req, secrets, signInAdmin } = await makeApp();
    await signInAdmin();
    const res = await req("PUT", "/api/admin/secrets/nas_token", { value: "abc123" });
    expect(res.status).toBe(200);
    expect(secrets.get("nas_token")).toBe("abc123");
    expect(JSON.stringify(await res.json())).not.toContain("abc123");
    await req("PUT", "/api/admin/secrets/nas_token", { value: null });
    expect(secrets.has("nas_token")).toBe(false);
  });

  it("still refuses unknown kinds", async () => {
    const { req, signInAdmin } = await makeApp();
    await signInAdmin();
    expect((await req("PUT", "/api/admin/things/x", { id: "x" })).status).toBe(404);
  });
});

describe("sections and links of your own", () => {
  it("can be added to the house's sections or your own, starred, changed and deleted", async () => {
    const { req, config } = await makeApp();
    await req("POST", "/api/profile", { id: "sam" });
    const link = { id: "bank", name: "Bank", url: "https://bank.example", group: "everyday" };
    const add = await req("PUT", "/api/tiles/bank", link);
    expect(add.status).toBe(200);
    const { id } = (await add.json()) as { id: string };
    const saved = config.get().tiles.find((t) => t.id === id);
    // Whatever was sent, it's Sam's own and has no short link.
    expect(saved?.owner).toBe("sam");
    expect(
      (await home(req)).groups.find((g) => g.id === "everyday")?.tiles.map((t) => t.id),
    ).toContain(id);
    expect(((await (await req("GET", "/api/tiles/bank")).json()) as { owner: string }).owner).toBe(
      "sam",
    );
    expect((await req("GET", "/bank")).status).not.toBe(302);

    // A section of Sam's own, and the link moved into it by dragging.
    const sec = await req("PUT", "/api/groups/money", { id: "money", name: "Money" });
    expect(sec.status).toBe(200);
    expect(config.get().groups.find((g) => g.id === "money")?.owner).toBe("sam");
    expect(
      (await req("PUT", "/api/tiles-layout", { groups: { money: ["bank"], everyday: ["muny"] } }))
        .status,
    ).toBe(200);
    expect(config.get().tiles.find((t) => t.id === "bank")?.group).toBe("money");
    // Sam can't move the house's Muny: it stays where it was.
    expect(config.get().tiles.find((t) => t.id === "muny")?.group).toBe("everyday");

    expect((await req("PUT", "/api/me/tiles", { favorites: ["bank"] })).status).toBe(200);
    expect((await home(req)).favorites.map((t) => t.id)).toEqual(["bank"]);

    // Nobody else sees it, not even the admin's page.
    await req("POST", "/api/profile", { id: null });
    expect(JSON.stringify(await home(req))).not.toContain("Bank");

    await req("POST", "/api/profile", { id: "sam" });
    expect((await req("DELETE", "/api/groups/money")).status).toBe(409);
    expect((await req("DELETE", "/api/groups/money?withLinks=1")).status).toBe(200);
    expect(config.get().tiles.some((t) => t.id === "bank")).toBe(false);
    expect((await home(req)).favorites).toEqual([]);
  });

  it("can't touch the house's sections and links, or anyone else's", async () => {
    const { req, config, signInAdmin } = await makeApp();
    await req("POST", "/api/profile", { id: "sam" });
    const muny = config.get().tiles.find((t) => t.id === "muny");
    expect((await req("PUT", "/api/tiles/muny", { ...muny, name: "Mine" })).status).toBe(403);
    expect((await req("DELETE", "/api/tiles/muny")).status).toBe(404);
    expect((await req("GET", "/api/tiles/muny")).status).toBe(404);
    expect((await req("PUT", "/api/groups/everyday", { id: "everyday", name: "X" })).status).toBe(
      403,
    );
    // An admin-only section isn't Sam's to put things in.
    expect(
      (
        await req("PUT", "/api/tiles/x", {
          id: "x",
          name: "X",
          url: "https://x.example",
          group: "admin",
        })
      ).status,
    ).toBe(400);
    // A locked page can't add anything.
    await req("POST", "/api/profile", { id: "kid" });
    expect(
      (
        await req("PUT", "/api/tiles/y", {
          id: "y",
          name: "Y",
          url: "https://y.example",
          group: "everyday",
        })
      ).status,
    ).toBe(403);
    // The admin can't put the house's links in Sam's own section.
    await req("POST", "/api/profile", { id: "sam" });
    await req("PUT", "/api/groups/sams", { id: "sams", name: "Sam's" });
    await req("POST", "/api/profile", { id: null });
    await signInAdmin();
    expect((await req("PUT", "/api/tiles-layout", { groups: { sams: ["muny"] } })).status).toBe(
      400,
    );
  });

  it("lets the admin set who sees a section: some people, or just them", async () => {
    const { req, config, signInAdmin } = await makeApp();
    await signInAdmin();
    await req("POST", "/api/profile", { id: "alex" });
    const r = await req("PUT", "/api/groups/games", {
      id: "games",
      name: "Games",
      people: ["kid"],
    });
    expect(r.status).toBe(200);
    expect(config.get().groups.find((g) => g.id === "games")?.people).toEqual(["kid"]);
    await req("PUT", "/api/groups/mine", { id: "mine", name: "Mine", owner: "alex" });
    expect(config.get().groups.find((g) => g.id === "mine")?.owner).toBe("alex");
    // A section full of the house's links can't become just the admin's.
    expect(
      (await req("PUT", "/api/groups/everyday", { id: "everyday", name: "E", owner: "alex" }))
        .status,
    ).toBe(409);
    // Deleting a person takes their own things with them and drops them from lists.
    expect((await req("DELETE", "/api/admin/profiles/kid")).status).toBe(200);
    const games = config.get().groups.find((g) => g.id === "games");
    expect(games?.people).toBeUndefined();
    expect(games?.audience).toBe("admin");
  });

  it("are upgraded from the old personal links", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hearth-app-"));
    const old = fixtureInput({ version: 2 }) as { profiles: Record<string, unknown>[] };
    (old.profiles[2] as Record<string, unknown>).links = [
      { id: "news", name: "News", url: "https://news.example" },
    ];
    await writeFile(join(dir, "hearth.json"), JSON.stringify(old));
    const store = new ConfigStore(dir);
    await store.load();
    expect(store.get().tiles.find((t) => t.id === "news")?.owner).toBe("sam");
  });
});

describe("edit mode and the catalog", () => {
  it("moves tiles between groups by dragging", async () => {
    const { req, config, signInAdmin } = await makeApp();
    await signInAdmin();
    const r = await req("PUT", "/api/tiles-layout", {
      groups: { everyday: ["gg", "nas"], admin: ["muny"] },
    });
    expect(r.status).toBe(200);
    const tiles = config.get().tiles;
    expect(tiles.find((t) => t.id === "nas")?.group).toBe("everyday");
    expect(tiles.find((t) => t.id === "muny")?.group).toBe("admin");
    // The printer wasn't on the page that was dragged; it stays, after the rest.
    expect(tiles.map((t) => t.id)).toEqual(["gg", "nas", "muny", "printer"]);
  });

  it("adds found services, making their groups and keeping ids unique", async () => {
    const { req, config, signInAdmin } = await makeApp();
    await signInAdmin();
    const r = await req("POST", "/api/admin/tiles/add-many", {
      items: [
        { name: "Sonarr", url: "http://192.168.1.5:8989", group: "Downloads", icon: "si:sonarr" },
        { name: "Muny", url: "http://192.168.1.5:9999", group: "everyday" },
        { name: "Chat", url: "http://192.168.1.5:3000", group: "Downloads" },
      ],
    });
    expect(r.status).toBe(200);
    const { added } = (await r.json()) as { added: string[] };
    expect(added).toEqual(["sonarr", "muny-2", "chat-2"]);
    const cfg = config.get();
    const downloads = cfg.groups.find((g) => g.name === "Downloads");
    expect(cfg.tiles.find((t) => t.id === "sonarr")?.group).toBe(downloads?.id);
    expect(cfg.tiles.find((t) => t.id === "muny-2")?.group).toBe("everyday");
  });

  it("installs an app widget with its key kept as a secret", async () => {
    const { req, config, secrets, signInAdmin } = await makeApp();
    await signInAdmin();
    expect(
      (
        await req("POST", "/api/admin/widgets/install", {
          app: "sonarr",
          widget: "overview",
          base: "http://192.168.1.5:8989",
        })
      ).status,
    ).toBe(400);
    const r = await req("POST", "/api/admin/widgets/install", {
      app: "sonarr",
      widget: "overview",
      base: "http://192.168.1.5:8989/",
      secret: "abc123",
      page: "alex",
    });
    expect(r.status).toBe(200);
    const { id } = (await r.json()) as { id: string };
    const cfg = config.get();
    const w = cfg.widgets.find((x) => x.id === id);
    const text = JSON.stringify(w);
    expect(text).toContain("http://192.168.1.5:8989/api/v3/queue");
    expect(text).toContain(`{{secret:widget:${id}}}`);
    expect(text).not.toContain("abc123");
    expect(secrets.get(`widget:${id}`)).toBe("abc123");
    expect(cfg.profiles.find((p) => p.id === "alex")?.layout.widgets.map((x) => x.id)).toContain(
      id,
    );
  });

  it("installs a general widget on the guest page, and only for the admin", async () => {
    const { req, config, signInAdmin } = await makeApp();
    expect((await req("POST", "/api/admin/widgets/install", { general: "server" })).status).toBe(
      403,
    );
    await signInAdmin();
    const r = await req("POST", "/api/admin/widgets/install", { general: "server", page: "guest" });
    expect(r.status).toBe(200);
    const { id } = (await r.json()) as { id: string };
    expect(config.get().settings.guest.layout.widgets.map((x) => x.id)).toContain(id);
  });

  it("doesn't call the internet to recognise an app or fetch its icon unless allowed", async () => {
    const { req, signInAdmin } = await makeApp();
    await signInAdmin();
    const r = await req("POST", "/api/admin/recognize", { url: "https://sonarr.example.com" });
    expect(r.status).toBe(200);
    const seen = (await r.json()) as { checked: boolean; app: { id: string } | null };
    expect(seen.checked).toBe(false);
    expect(seen.app?.id).toBe("sonarr");
    const f = await req("POST", "/api/icons/fetch", { url: "https://example.com" });
    expect(f.status).toBe(400);
    expect(((await f.json()) as { error: string }).error).toMatch(/internet/);
  });

  it("ends a scan's stream with done, so the page doesn't think it was stopped", async () => {
    const { req, signInAdmin } = await makeApp();
    await signInAdmin();
    const r = await req("POST", "/api/admin/discover", { targets: "127.0.0.1" });
    const events = (await r.text())
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => JSON.parse(l.slice(5)) as { type: string });
    expect(events[0]?.type).toBe("start");
    expect(events.at(-1)?.type).toBe("done");
  }, 30_000);
});

describe("calendars", () => {
  const range = "from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z";

  it("are each person's own: a guest or the admin alone sees none", async () => {
    const { req, signInAdmin } = await makeApp();
    expect((await req("GET", `/api/calendar?${range}`)).status).toBe(403);
    await signInAdmin();
    expect((await req("GET", `/api/calendar?${range}`)).status).toBe(403);
  });

  it("lets a person add an event and share it with someone by tagging them", async () => {
    const { req } = await makeApp();
    await req("POST", "/api/profile", { id: "alex" });
    const v = await (await req("GET", `/api/calendar?${range}`)).json();
    const own = v.calendars[0].id;
    const made = await req("POST", "/api/calendar/events", {
      calendar: own,
      title: "School play",
      start: "2026-11-20T23:00:00.000Z",
      end: "2026-11-21T00:30:00.000Z",
      people: ["sam"],
    });
    expect(made.status).toBe(200);
    const bad = await req("POST", "/api/calendar/events", {
      calendar: own,
      title: "Backwards",
      start: "2026-11-21T00:00:00.000Z",
      end: "2026-11-20T00:00:00.000Z",
    });
    expect(bad.status).toBe(400);

    await req("POST", "/api/profile", { id: "sam" });
    const sam = await (await req("GET", `/api/calendar?${range}`)).json();
    expect(
      sam.events.map((e: { title: string; canEdit: boolean }) => [e.title, e.canEdit]),
    ).toEqual([["School play", false]]);
    // Sam can't change Alex's calendar or tag people on it: to Sam it isn't there.
    const tag = await req("PUT", "/api/calendar/tags", {
      calendar: own,
      series: sam.events[0].series,
      people: ["sam"],
    });
    expect(tag.status).toBe(404);
  });

  it("keeps people's calendar sign-ins away from the admin's secrets", async () => {
    const { req, secrets, signInAdmin } = await makeApp();
    await secrets.set("calendar:alex-1234", JSON.stringify({ password: "pw" }));
    await signInAdmin();
    const cfg = await (await req("GET", "/api/admin/config")).json();
    expect(cfg.secrets).not.toContain("calendar:alex-1234");
    const put = await req("PUT", "/api/admin/secrets/calendar:alex-1234", { value: "x" });
    expect(put.status).toBe(403);
    expect(secrets.fill("{{secret:calendar:alex-1234}}").text).toBe("");
  });

  it("lets the admin set up Google and the internet for calendars", async () => {
    const { req, signInAdmin, config, secrets } = await makeApp();
    expect((await req("PUT", "/api/admin/calendar", { allowInternet: true })).status).toBe(403);
    await signInAdmin();
    const wrong = await req("PUT", "/api/admin/calendar", { googleClientId: "nope" });
    expect(wrong.status).toBe(400);
    const ok = await req("PUT", "/api/admin/calendar", {
      allowInternet: true,
      googleClientId: "1-abc.apps.googleusercontent.com",
      googleSecret: "shh",
    });
    expect(ok.status).toBe(200);
    expect(config.get().settings.calendar).toMatchObject({
      allowInternet: true,
      googleClientId: "1-abc.apps.googleusercontent.com",
    });
    expect(secrets.get("calendar:google-client")).toBe("shh");
    const got = await (await req("GET", "/api/admin/calendar")).json();
    expect(got).toEqual({
      allowInternet: true,
      googleClientId: "1-abc.apps.googleusercontent.com",
      googleSecret: true,
      googleReturnPage: "",
    });
    const local = await req("PUT", "/api/admin/calendar", {
      googleReturnPage: "https://start.home/x",
    });
    expect(local.status).toBe(400);
    const page = await req("PUT", "/api/admin/calendar", {
      googleReturnPage: "https://you.github.io/hearth-public/google/",
    });
    expect(page.status).toBe(200);
  });
});
