/**
 * Notifications on phones and computers: standard web push. A device turns them on in the page
 * (that's the opt-in); its browser hands back an address at its push service (Google's for Chrome
 * on Android, Mozilla's for Firefox…). Hearth sends each alert there, encrypted end to end: the
 * push service sees only that something was sent, never what. Only parents and the admin can turn
 * them on, and they get what the alerts address gets.
 *
 * The keys Hearth signs with (VAPID) are made once and kept as the secret "push:vapid". Devices
 * are kept in data/push.json; one that's gone (the push service says 404 or 410) is dropped.
 */
import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import webpush from "web-push";
import { FcmGone, type FcmRoute, isFcmEndpoint, sendFcm } from "./fcm";
import { guardedFetch, NetError } from "./net";
import type { SecretStore } from "./secrets";

export const VAPID_SECRET = "push:vapid";
/** Push services expect a way to reach whoever runs the sender: the project's page. */
const SUBJECT = "https://github.com/mikedmor/hearth";

export class PushError extends Error {}

export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushDevice extends PushSubscriptionJson {
  /** "admin", or the parent's profile id. */
  who: string;
  /** "Chrome on Android", for the list. */
  label: string;
  added: string;
  lastOk?: string;
  lastError?: string;
}

export interface PushMessage {
  title: string;
  text: string;
  /** Where tapping it goes, like "/family". */
  url?: string;
  /** Same tag replaces an older notification instead of stacking. */
  tag?: string;
}

export interface PushDeps {
  dataDir: string;
  secrets: SecretStore;
  /** Whether this subscriber may still get the house's alerts (a parent who's still a parent). */
  allowed?: (who: string) => boolean;
  fetch?: typeof fetch;
  log?: (msg: string) => void;
  /**
   * How notifications reach the Hearth Android app, which registers like a browser with an
   * `fcm:<token>` endpoint (see fcm.ts); null when they're turned off (HEARTH_PUSH_RELAY=off).
   */
  fcm?: FcmRoute | null;
}

/** Push services live on the internet: only theirs are allowed, and only over https. */
export function pushHostOk(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !/^(localhost|[\d.]+|\[.*\])$/.test(u.hostname);
  } catch {
    return false;
  }
}

export class PushService {
  private devices: PushDevice[] = [];
  private loaded = false;

  constructor(private readonly deps: PushDeps) {}

  private get path() {
    return join(this.deps.dataDir, "push.json");
  }

  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.path)) return;
    try {
      const raw = JSON.parse(await readFile(this.path, "utf8")) as { devices?: PushDevice[] };
      this.devices = Array.isArray(raw.devices) ? raw.devices : [];
    } catch {
      this.devices = [];
    }
  }

  private async save() {
    const tmp = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ v: 1, devices: this.devices }, null, 2), { mode: 0o600 });
    await rename(tmp, this.path);
  }

  /** The signing keys, made on first use. */
  private async vapid(): Promise<{ publicKey: string; privateKey: string }> {
    const saved = this.deps.secrets.get(VAPID_SECRET);
    if (saved) {
      try {
        const k = JSON.parse(saved);
        if (k.publicKey && k.privateKey) return k;
      } catch {}
    }
    const made = webpush.generateVAPIDKeys();
    await this.deps.secrets.set(VAPID_SECRET, JSON.stringify(made));
    return made;
  }

  /** The public key a browser subscribes with. */
  async publicKey(): Promise<string> {
    return (await this.vapid()).publicKey;
  }

  async has(endpoint: string): Promise<boolean> {
    await this.load();
    return this.devices.some((d) => d.endpoint === endpoint);
  }

  /** Read the device list once at start, so `on()` can answer straight away. */
  init(): Promise<void> {
    return this.load();
  }

  /** Whether any device would get an alert (so alerts are worth making). */
  on(): boolean {
    return this.devices.some((d) => this.deps.allowed?.(d.who) ?? true);
  }

  /** Devices for the Settings list (no keys). */
  async list(): Promise<
    { id: string; who: string; label: string; added: string; lastOk?: string; lastError?: string }[]
  > {
    await this.load();
    return this.devices.map((d) => ({
      id: idOf(d.endpoint),
      who: d.who,
      label: d.label,
      added: d.added,
      lastOk: d.lastOk,
      lastError: d.lastError,
    }));
  }

  /** Whether the Android app's notifications can be sent from here. */
  appOn(): boolean {
    return Boolean(this.deps.fcm);
  }

  async subscribe(sub: PushSubscriptionJson, who: string, label: string): Promise<void> {
    if (isFcmEndpoint(sub.endpoint)) {
      if (!this.deps.fcm)
        throw new PushError("Notifications to the Android app are turned off on this Hearth.");
    } else if (!pushHostOk(sub.endpoint)) {
      throw new PushError("That isn't a push service's address.");
    }
    await this.load();
    this.devices = this.devices.filter((d) => d.endpoint !== sub.endpoint);
    this.devices.push({
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      who,
      label: label.slice(0, 60),
      added: new Date().toISOString(),
    });
    if (this.devices.length > 50) this.devices.splice(0, this.devices.length - 50);
    await this.save();
  }

  /** Forget a device, by its endpoint or its list id. */
  async remove(endpointOrId: string): Promise<boolean> {
    await this.load();
    const before = this.devices.length;
    this.devices = this.devices.filter(
      (d) => d.endpoint !== endpointOrId && idOf(d.endpoint) !== endpointOrId,
    );
    if (this.devices.length === before) return false;
    await this.save();
    return true;
  }

  /** Send to every device allowed to get it, or to one. Returns how many it reached. */
  async send(msg: PushMessage, only?: string): Promise<number> {
    await this.load();
    const targets = this.devices.filter(
      (d) => (only ? d.endpoint === only : true) && (this.deps.allowed?.(d.who) ?? true),
    );
    if (!targets.length) return 0;
    const keys = await this.vapid();
    const payload = JSON.stringify({
      title: msg.title.slice(0, 120),
      body: msg.text.slice(0, 500),
      url: msg.url ?? "/",
      tag: msg.tag,
    });
    let reached = 0;
    let changed = false;
    await Promise.all(
      targets.map(async (d) => {
        if (isFcmEndpoint(d.endpoint)) {
          // The Android app: through Firebase, encrypted to the phone like any other.
          const route = this.deps.fcm;
          try {
            if (!route) throw new Error("Notifications to the Android app are turned off here.");
            await sendFcm(d, payload, route, this.deps.fetch ?? fetch);
            d.lastOk = new Date().toISOString();
            d.lastError = undefined;
            reached++;
          } catch (e) {
            if (e instanceof FcmGone) this.devices = this.devices.filter((x) => x !== d);
            else d.lastError = e instanceof Error ? e.message : "Couldn't send it.";
          }
          changed = true;
          return;
        }
        try {
          const req = webpush.generateRequestDetails(
            { endpoint: d.endpoint, keys: d.keys },
            payload,
            {
              vapidDetails: { subject: SUBJECT, ...keys },
              TTL: 6 * 3600,
              urgency: "high",
              contentEncoding: "aes128gcm",
            },
          );
          const r = await guardedFetch(req.endpoint, {
            method: "POST",
            headers: Object.fromEntries(
              Object.entries(req.headers).map(([k, v]) => [k, String(v)]),
            ),
            body: req.body ? new Uint8Array(req.body) : undefined,
            // Turning notifications on for a device is the opt-in to its push service.
            policy: { allowInternet: true },
            fetch: this.deps.fetch,
            timeoutMs: 10_000,
            maxBytes: 64 * 1024,
          });
          if (r.status === 404 || r.status === 410) {
            // The browser dropped it (notifications turned off, app removed).
            this.devices = this.devices.filter((x) => x !== d);
          } else if (r.status >= 400) {
            d.lastError = `The push service answered ${r.status}.`;
          } else {
            d.lastOk = new Date().toISOString();
            d.lastError = undefined;
            reached++;
          }
        } catch (e) {
          d.lastError = e instanceof NetError ? e.message : "Couldn't reach the push service.";
        }
        changed = true;
      }),
    );
    if (changed) await this.save();
    return reached;
  }
}

/** A short, stable id for a device in the list, so its endpoint never reaches the page. */
export function idOf(endpoint: string): string {
  let h = 0;
  for (let i = 0; i < endpoint.length; i++) h = (Math.imul(31, h) + endpoint.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Where an alert's tag leads when it's tapped. */
export function urlForTag(tag?: string): string {
  if (!tag) return "/";
  if (/no_entry|raising_hand|door/i.test(tag)) return "/family";
  return "/devices";
}
