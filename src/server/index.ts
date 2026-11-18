/**
 * Starts Hearth: config, secrets, sign-in, status checks, widgets, AI servers, calendars, the live
 * socket.
 */
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { type HearthConfig, statusFor } from "../shared/config";
import { AiMonitor } from "./ai/monitor";
import { createApp } from "./app";
import { ADMIN_COOKIE, AuthStore, PROFILE_COOKIE } from "./auth";
import { CalendarService } from "./calendar/service";
import { CalendarStore } from "./calendar/store";
import { loadExtraApps } from "./catalog-extra";
import { inCidr } from "./client-ip";
import { ConfigError, ConfigStore } from "./config-store";
import { dockerNets } from "./devices/clues";
import { GlInet } from "./devices/glinet";
import { identify } from "./devices/identify";
import { DeviceMonitor } from "./devices/monitor";
import { ResourceMonitor } from "./devices/resources";
import { machineSpecs, nasSnmp, ROUTER_SECRET } from "./devices/routes";
import { DeviceService } from "./devices/service";
import { DeviceStore } from "./devices/store";
import { SenseService } from "./energy/sense";
import { fcmRouteFromEnv } from "./fcm";
import { FileStation } from "./files/filestation";
import { InternetService } from "./internet/service";
import { HistoryStore, InternetStore } from "./internet/store";
import { Live, parseCookies } from "./live";
import { LocalNames } from "./mdns";
import { setLocalResolver } from "./net";
import { PushService, urlForTag } from "./push";
import { loadMasterKey, SecretStore } from "./secrets";
import { SmartHomeService } from "./smarthome/service";
import { Sso } from "./sso";
import { StatusChecker } from "./status";
import { rootPaths, TrustStore } from "./trust";
import { Updates } from "./updates";
import { findProfile } from "./view";
import { connections } from "./widgets/connections";
import { WidgetHub } from "./widgets/runtime";

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.HEARTH_PORT ?? 8082);
const host = process.env.HEARTH_HOST ?? "0.0.0.0";
const dataDir = resolve(process.env.HEARTH_DATA_DIR ?? "data");
// Built layout: dist/server/index.js next to dist/web. In dev (tsx) this lands on src/web, the
// page's source, which a browser can't run: only a built page (with assets/) is served.
const webDir = resolve(process.env.HEARTH_WEB_DIR ?? join(here, "..", "web"));
const isBuiltPage = existsSync(join(webDir, "index.html")) && existsSync(join(webDir, "assets"));
const version = process.env.HEARTH_VERSION ?? "dev";

const log = (msg: string) => console.log(`[hearth] ${msg}`);

const config = new ConfigStore(dataDir);
let cfg: HearthConfig;
try {
  cfg = await config.load();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`[hearth] ${err.message}\n  ${err.issues.join("\n  ")}`);
    console.error(`[hearth] Fix ${config.path} and start again.`);
    process.exit(1);
  }
  throw err;
}

const master = await loadMasterKey(dataDir);
const secrets = new SecretStore(dataDir, master.key);
await secrets.load();
const auth = new AuthStore(dataDir, master.key);
await auth.load();

const calendarStore = new CalendarStore(dataDir);
try {
  await calendarStore.load();
} catch (err) {
  // Calendars stay readable as far as they go, and nothing is saved over the file until it's fixed.
  const e = err as Error & { issues?: string[] };
  const issues = e.issues?.length ? `\n  ${e.issues.join("\n  ")}` : "";
  console.error(`[hearth] ${e.message}${issues}`);
}
const calendar = new CalendarService({
  store: calendarStore,
  secrets,
  settings: () => config.get().settings,
  profiles: () => config.get().profiles,
  log,
});

const deviceStore = new DeviceStore(dataDir);
try {
  await deviceStore.load();
} catch (err) {
  const e = err as Error & { issues?: string[] };
  const issues = e.issues?.length ? `\n  ${e.issues.join("\n  ")}` : "";
  console.error(`[hearth] ${e.message}${issues}`);
}
const devices = new DeviceService({
  store: deviceStore,
  secrets,
  settings: () => config.get().settings,
  profiles: () => config.get().profiles,
  identify,
});

const internetStore = new InternetStore(dataDir);
try {
  await internetStore.load();
} catch (err) {
  // The rules already in AdGuard Home stay as they are; nothing is saved over the file.
  const e = err as Error & { issues?: string[] };
  const issues = e.issues?.length ? `\n  ${e.issues.join("\n  ")}` : "";
  console.error(`[hearth] ${e.message}${issues}`);
}
// Notifications on phones: a parent's device keeps getting them while they're still a parent.
const push = new PushService({
  dataDir,
  secrets,
  // The Android app's notifications: the app's push relay unless HEARTH_PUSH_RELAY or
  // HEARTH_FCM_CREDENTIALS says otherwise (see fcm.ts).
  fcm: fcmRouteFromEnv(process.env),
  allowed: (who) => {
    if (who === "admin") return true;
    const p = findProfile(config.get(), who);
    return Boolean(p && internet.isParent({ admin: false, profile: p }));
  },
  log,
});
await push.init();
const internet = new InternetService({
  secrets,
  store: internetStore,
  history: new HistoryStore(dataDir),
  config: () => config.get(),
  devices: () => deviceStore.get(),
  adguard: () => devices.adguard(),
  hasPin: (p) => auth.hasPin(p),
  push: (title, text, tag) => push.send({ title, text, url: urlForTag(tag) }),
  pushOn: () => push.on(),
});

const statusOpts = (c: HearthConfig) => ({
  intervalMs: c.settings.status.intervalSeconds * 1000,
  timeoutMs: c.settings.status.timeoutMs,
  slowMs: c.settings.status.slowMs,
});
const checker = new StatusChecker(statusOpts(cfg));
checker.setTiles(cfg.tiles);

const ai = new AiMonitor({
  servers: () => config.get().settings.ai.servers,
  keyFor: (id) => secrets.get(`ai:${id}`),
});
const smart = new SmartHomeService({
  settings: () => config.get().settings,
  secrets,
  links: () => deviceStore.get().smartLinks,
});
let router: GlInet | null = null;
let routerKey = "";
/** The names browsers reach Hearth by (the app fills it; the monitor leaves those tiles out). */
const ownHosts = new Set<string>();
const routerClient = () => {
  const url = config.get().settings.router.url;
  const password = secrets.get(ROUTER_SECRET);
  if (!url || !password) return null;
  // One per address and password, so its session is kept between rounds.
  const key = `${url}|${password}`;
  if (routerKey !== key) {
    routerKey = key;
    router = new GlInet({ url, password });
  }
  return router;
};
const monitor = new DeviceMonitor({
  store: deviceStore,
  ownHosts: () => ownHosts,
  smart,
  router: routerClient,
  routerSettings: () => ({
    url: config.get().settings.router.url,
    passwordSaved: secrets.has(ROUTER_SECRET),
  }),
  ask: (ips) => devices.ask(ips),
  view: () => devices.view({}, { ask: false }),
  config: () => config.get(),
  tileStatus: () => checker.snapshot(),
  ai,
  tell: (title, text, tag) => internet.tell(title, text, tag),
  alertsOn: () => internet.alertsOn(),
  log,
});
// `.local` names (a webcam at motioneye.local): the container can't use mDNS, so Hearth asks
// the home network's devices directly, on the ranges the network check found.
const localNames = new LocalNames({
  networks: () =>
    (monitor.latest()?.networks ?? []).filter(
      (n) => !dockerNets().some((d) => inCidr(n.split("/")[0] ?? "", d)),
    ),
});
setLocalResolver((host) => localNames.resolve(host));

// The router's and the NAS's resources, while someone is looking.
const resources = new ResourceMonitor({
  router: routerClient,
  routerUrl: () => config.get().settings.router.url,
  nas: () => nasSnmp(config.get(), secrets),
  machines: () => machineSpecs(config.get(), secrets),
  onChange: () => hub.resourcesChanged(),
});

// The Sense energy monitor: through Sense's servers, only once the admin connects it.
const sense = new SenseService({
  settings: () => config.get().settings.sense,
  token: (name) => secrets.get(`sense:${name}`),
  save: async (s, tokens) => {
    if (s) {
      await config.update((draft) => {
        draft.settings.sense = s;
      });
    }
    for (const [k, v] of Object.entries(tokens))
      if (v !== undefined) await secrets.set(`sense:${k}`, v);
  },
  costSettings: () => config.get().settings.energy,
  onChange: () => hub.resourcesChanged(),
  log,
});

const hub = new WidgetHub({
  config: () => config.get(),
  status: () => checker.snapshot(),
  ai,
  pinball: (device) => monitor.pinball(device),
  machines: () => monitor.aiMachines(),
  hearth: (what) =>
    what === "devices" || what === "network" || what === "smarthome"
      ? monitor.widgetData(what)
      : what === "resources"
        ? resources.widgetData()
        : what === "energy"
          ? sense.widgetData()
          : null,
  connection: (to) => connections(config.get(), secrets).find((c) => c.to === to) ?? null,
  secrets,
  log,
  dataDir,
});

let live: Live | null = null;
checker.onChecked(() => {
  hub.statusChanged();
  live?.broadcastStatus();
});
ai.onChange(() => hub.aiChanged());
monitor.onChange(() => {
  hub.pinballChanged();
  hub.aiChanged();
  live?.broadcast({ type: "changed", what: "devices" });
});
config.onChange((next) => {
  checker.setOptions(statusOpts(next));
  checker.setTiles(next.tiles);
  void checker.checkAll();
  hub.configChanged();
});

checker.start();
ai.start();
internet.start();
devices.start();
monitor.start();
const stopWatching = config.watch((msg) => {
  log(msg);
  live?.broadcast({ type: "changed", what: "config" });
});

const extraApps = loadExtraApps(join(dataDir, "catalog"), log);
if (extraApps.length) log(`catalog: ${extraApps.length} app(s) from data/catalog`);

// Newer releases on GitHub, once a day, only when the admin has turned it on.
const updates = new Updates({
  current: version,
  enabled: () => config.get().settings.updates.check,
  onFound: (v) => {
    log(`Hearth ${v} is out. See Settings → General → Updates.`);
    live?.broadcast({ type: "changed", what: "config" });
  },
});
updates.start();

const app = createApp({
  config,
  auth,
  secrets,
  hub,
  ai,
  calendar,
  devices,
  monitor,
  smart,
  resources,
  sense,
  push,
  files: new FileStation({ url: () => config.get().settings.files.url }),
  updates,
  ownHosts,
  internet,
  trust: new TrustStore(rootPaths(dataDir)),
  sso: new Sso({
    settings: () => {
      const s = config.get().settings.sso;
      return s.issuer && s.clientId
        ? { issuer: s.issuer, clientId: s.clientId, clientSecret: secrets.get("sso:client-secret") }
        : null;
    },
  }),
  status: () => checker.snapshot(),
  dataDir,
  webDir: isBuiltPage ? webDir : undefined,
  keyInDataDir: master.fromFile,
  extraApps: () => extraApps,
  version,
  onChange: (what) => live?.broadcast({ type: "changed", what }),
});

// One stray promise must never take the whole start page down.
process.on("unhandledRejection", (err) => console.error("[hearth] unhandled:", err));

const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  log(`version ${version}, data in ${dataDir}`);
  log(
    `listening on http://${host}:${info.port}${isBuiltPage ? "" : " (API only: in dev, open http://localhost:5173)"}`,
  );
  if (auth.needsSetup) log(`First visit: set the admin password with setup code ${auth.setupCode}`);
  if (master.fromFile)
    log(
      "Secrets are encrypted with data/secret.key. Set HEARTH_SECRET_KEY to keep the key out of the data folder.",
    );
});

live = new Live({
  hub,
  status: (profile) => statusFor(checker.snapshot(), config.get().tiles, profile),
  profileOf: (req) => {
    const cookies = parseCookies(req.headers.cookie);
    return findProfile(config.get(), auth.profileOf(cookies[PROFILE_COOKIE]))?.id ?? null;
  },
  roleOf: (req) => {
    const cookies = parseCookies(req.headers.cookie);
    const profile = findProfile(config.get(), auth.profileOf(cookies[PROFILE_COOKIE]));
    return profile?.role ?? (auth.isAdmin(cookies[ADMIN_COOKIE]) ? "admin" : null);
  },
  log,
});
live.attach(server as Server);
// Chat and the AI designer stream for minutes; Node's 5-minute request limit mustn't cut them off.
(server as Server).requestTimeout = 0;

const shutdown = () => {
  checker.stop();
  ai.stop();
  internet.stop();
  devices.stop();
  resources.stop();
  sense.stop();
  hub.stopAll();
  live?.close();
  stopWatching();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
