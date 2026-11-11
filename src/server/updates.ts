/**
 * Update check: asks GitHub for Hearth's newest release, so the admin knows when there's one.
 *
 * It's the one call Hearth makes to the internet on its own, so it's off until the admin turns it
 * on (or presses Check now) in Settings → General → Updates. It sends nothing about the home: a
 * plain GET of the public releases list, with "Hearth/<version>" as the User-Agent (GitHub's API
 * requires one). It never installs anything: updating is the admin's step, so a bad release
 * can't replace a working start page by itself, and Hearth needs no access to Docker.
 */
import type { Context, Hono } from "hono";
import type { UpdateStatus } from "../shared/updates";
import { guardedFetch, NetError, parseBody } from "./net";

export const RELEASES_REPO = process.env.HEARTH_UPDATE_REPO ?? "mikedmor/hearth";
const DAY = 24 * 60 * 60 * 1000;

/** "v1.2.3", "1.2.3+abc1234", "1.2.3-beta.1" → [1, 2, 3, pre]; anything else (dev builds) → null. */
export function parseVersion(v: string): { n: [number, number, number]; pre: string } | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?(?:\+[\w.-]+)?$/.exec(v.trim());
  if (!m) return null;
  return { n: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? "" };
}

/** Whether `latest` is newer than `current`. A pre-release sorts before its release. */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    const d = (a.n[i] ?? 0) - (b.n[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  if (a.pre === b.pre) return false;
  if (!a.pre) return true;
  if (!b.pre) return false;
  return a.pre.localeCompare(b.pre, "en", { numeric: true }) > 0;
}

interface Latest {
  version: string;
  name: string;
  url: string;
  notes: string;
  publishedAt: string;
}

export class Updates {
  private latest: Latest | null = null;
  private checkedAt: string | null = null;
  private error: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly opts: {
      current: string;
      /** The admin's choice: check by itself once a day. */
      enabled: () => boolean;
      fetch?: typeof fetch;
      onFound?: (version: string) => void;
    },
  ) {}

  /** Checks once a day while the admin has it on (the first a minute after start). */
  start(): void {
    const tick = () => {
      if (this.opts.enabled()) void this.check();
    };
    setTimeout(tick, 60_000).unref?.();
    this.timer = setInterval(tick, DAY);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  status(): UpdateStatus {
    const current = this.opts.current;
    const known = parseVersion(current) !== null;
    return {
      current,
      checking: this.opts.enabled(),
      checkedAt: this.checkedAt ?? undefined,
      error: this.error ?? undefined,
      devBuild: !known,
      available:
        this.latest && known && isNewer(this.latest.version, current) ? this.latest : undefined,
      latest: this.latest?.version,
      releasesUrl: `https://github.com/${RELEASES_REPO}/releases`,
    };
  }

  /** Asks GitHub now (one request at a time). */
  check(): Promise<void> {
    this.running ??= this.ask().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async ask(): Promise<void> {
    const before = this.status().available?.version;
    try {
      // Through the network guard like every other call, allowed out because the admin asked.
      const res = await guardedFetch(
        `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`,
        {
          headers: {
            accept: "application/vnd.github+json",
            "user-agent": `Hearth/${this.opts.current}`,
          },
          timeoutMs: 10_000,
          maxBytes: 1_000_000,
          policy: { allowInternet: true },
          fetch: this.opts.fetch,
        },
      );
      if (res.status === 404) throw new Error("There are no releases yet.");
      if (res.status < 200 || res.status >= 300) throw new Error(`GitHub answered ${res.status}.`);
      const r = (parseBody(res) ?? {}) as {
        tag_name?: unknown;
        name?: unknown;
        html_url?: unknown;
        body?: unknown;
        published_at?: unknown;
      };
      const tag = typeof r.tag_name === "string" ? r.tag_name : "";
      const parsed = parseVersion(tag);
      if (!parsed) throw new Error(`The newest release has an odd version (${tag.slice(0, 40)}).`);
      const url = typeof r.html_url === "string" ? r.html_url : "";
      this.latest = {
        version: parsed.n.join(".") + (parsed.pre ? `-${parsed.pre}` : ""),
        name: typeof r.name === "string" && r.name ? r.name.slice(0, 120) : tag,
        // Only GitHub's own page for it: the page links to it.
        url: url.startsWith(`https://github.com/${RELEASES_REPO}/`)
          ? url
          : `https://github.com/${RELEASES_REPO}/releases`,
        notes: typeof r.body === "string" ? r.body.slice(0, 20_000) : "",
        publishedAt: typeof r.published_at === "string" ? r.published_at : "",
      };
      this.error = null;
    } catch (e) {
      this.error =
        e instanceof NetError && /in time/.test(e.message)
          ? "GitHub didn't answer. Is the NAS online?"
          : e instanceof Error
            ? e.message
            : String(e);
    }
    this.checkedAt = new Date().toISOString();
    const found = this.status().available?.version;
    if (found && found !== before) this.opts.onFound?.(found);
  }
}

export function updateRoutes(
  app: Hono,
  d: { updates: Updates; requireAdmin: (c: Context) => void },
): void {
  app.get("/api/admin/updates", (c) => {
    d.requireAdmin(c);
    return c.json(d.updates.status());
  });
  app.post("/api/admin/updates/check", async (c) => {
    d.requireAdmin(c);
    await d.updates.check();
    return c.json(d.updates.status());
  });
}
