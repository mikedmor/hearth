/**
 * Starts Hearth: config, secrets, sign-in, status checks, widgets, AI servers, calendars, the live
 * socket.
 */
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import type { HearthConfig } from "../shared/config";
import { AiMonitor } from "./ai/monitor";
import { createApp } from "./app";
import { ADMIN_COOKIE, AuthStore, PROFILE_COOKIE } from "./auth";
import { CalendarService } from "./calendar/service";
import { CalendarStore } from "./calendar/store";
import { loadExtraApps } from "./catalog-extra";
import { ConfigError, ConfigStore } from "./config-store";
import { Live, parseCookies } from "./live";
import { loadMasterKey, SecretStore } from "./secrets";
import { StatusChecker } from "./status";
import { findProfile } from "./view";
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
const hub = new WidgetHub({
  config: () => config.get(),
  status: () => checker.snapshot(),
  ai,
  secrets,
  log,
  dataDir,
});

let live: Live | null = null;
checker.onChecked(() => {
  hub.statusChanged();
  live?.broadcast({ type: "status", data: checker.snapshot() });
});
ai.onChange(() => hub.aiChanged());
config.onChange((next) => {
  checker.setOptions(statusOpts(next));
  checker.setTiles(next.tiles);
  void checker.checkAll();
  hub.configChanged();
});

checker.start();
ai.start();
const stopWatching = config.watch((msg) => {
  log(msg);
  live?.broadcast({ type: "changed", what: "config" });
});

const extraApps = loadExtraApps(join(dataDir, "catalog"), log);
if (extraApps.length) log(`catalog: ${extraApps.length} app(s) from data/catalog`);

const app = createApp({
  config,
  auth,
  secrets,
  hub,
  ai,
  calendar,
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
  status: () => checker.snapshot(),
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
  hub.stopAll();
  live?.close();
  stopWatching();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
