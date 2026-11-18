/**
 * Hearth as an app on a phone: the service worker (offline copy, notifications), the browser's
 * offer to install it, whether what's on screen is a kept copy from earlier, and turning
 * notifications on and off for this device. Installing and offline need https (a phone that
 * trusts the home's certificate); plain http still works as a web page.
 */

import { useSyncExternalStore } from "react";
import { api } from "./api";
import {
  type AppSubscription,
  appHello,
  appPushError,
  appSubscribe,
  appUnsubscribe,
  inAndroidApp,
  rememberAppPush,
  syncAppPush,
} from "./appShell";

type Listener = () => void;

/** A tiny store: subscribe, read, change. */
function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => value,
    set(next: T) {
      if (Object.is(next, value)) return;
      value = next;
      for (const fn of listeners) fn();
    },
    subscribe(fn: Listener) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

// ---------------------------------------------------------------------------
// The service worker

export const swSupported = () =>
  typeof navigator !== "undefined" && "serviceWorker" in navigator && window.isSecureContext;

/** Start it (the built page only: in development it would keep stale files). */
export function registerServiceWorker(): void {
  if (!swSupported() || !import.meta.env.PROD) return;
  // The page may already have loaded (main awaits before rendering), so register now.
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Installing

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const installOffer = store<InstallPrompt | null>(null);

/** Already running as an installed app. */
export const installed = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    // Keep it for our own button, instead of the browser's own little bar.
    e.preventDefault();
    installOffer.set(e as InstallPrompt);
  });
  window.addEventListener("appinstalled", () => installOffer.set(null));
}

export function useInstall() {
  const offer = useSyncExternalStore(installOffer.subscribe, installOffer.get);
  return {
    /** The browser offers to install (Chrome on Android, Edge, desktop Chrome). */
    can: Boolean(offer) && !installed(),
    async install(): Promise<boolean> {
      if (!offer) return false;
      await offer.prompt();
      const { outcome } = await offer.userChoice;
      installOffer.set(null);
      return outcome === "accepted";
    },
  };
}

// ---------------------------------------------------------------------------
// A kept copy on screen

/** When the data on screen was saved, if it's a kept copy (home can't be reached). */
export const kept = store<string | null>(null);

export function useKeptCopy(): string | null {
  return useSyncExternalStore(kept.subscribe, kept.get);
}

/** The number on the app's icon (family requests waiting), where the phone shows one. */
export function setBadge(n: number | undefined): void {
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  if (!installed()) return;
  if (n) nav.setAppBadge?.(n).catch(() => {});
  else nav.clearAppBadge?.().catch(() => {});
}

// ---------------------------------------------------------------------------
// Notifications on this device

export type PushState = "unsupported" | "needs-https" | "blocked" | "off" | "on";

/** Inside the Android app: notifications come through the app, not a browser's push service. */
const APP_LABEL = "Hearth app on Android";

async function appPushState(): Promise<PushState> {
  const hello = await appHello().catch(() => null);
  if (!hello?.push?.available) return "unsupported";
  const sub = hello.push.subscription;
  if (!sub) return "off";
  const { on } = await api.post<{ on: boolean }>("/api/push/state", { endpoint: sub.endpoint });
  return on ? "on" : "off";
}

async function registerApp(sub: AppSubscription): Promise<void> {
  await api.post("/api/push/subscribe", { subscription: sub, label: APP_LABEL });
  rememberAppPush(sub.endpoint);
}

/** In the app, at startup: keep the server's copy of this phone's endpoint current. */
export const keepAppPushCurrent = () => syncAppPush(registerApp).catch(() => {});

export async function pushState(): Promise<PushState> {
  if (inAndroidApp()) return appPushState();
  if (!("Notification" in window) || !("PushManager" in window)) return "unsupported";
  if (!swSupported()) return "needs-https";
  if (Notification.permission === "denied") return "blocked";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return "off";
  const { on } = await api.post<{ on: boolean }>("/api/push/state", { endpoint: sub.endpoint });
  return on ? "on" : "off";
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** "Chrome on Android": a name for this device in the admin's list. */
function deviceLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /SamsungBrowser/.test(ua)
        ? "Samsung Internet"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "A browser";
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad/.test(ua)
      ? "iOS"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "a computer";
  return `${browser} on ${os}`;
}

export async function turnPushOn(): Promise<void> {
  if (inAndroidApp()) {
    const { key } = await api.get<{ key: string }>("/api/push/key");
    const r = await appSubscribe(key);
    if (!r.ok || !r.subscription) throw new Error(appPushError(r.error));
    await registerApp(r.subscription);
    return;
  }
  const reg =
    (await navigator.serviceWorker.getRegistration()) ??
    (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
  await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error("Notifications aren't allowed for Hearth in this browser's settings.");
  const { key } = await api.get<{ key: string }>("/api/push/key");
  let sub = await reg.pushManager.getSubscription();
  if (!sub)
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(key),
    });
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api.post("/api/push/subscribe", { subscription: json, label: deviceLabel() });
}

export async function turnPushOff(): Promise<void> {
  if (inAndroidApp()) {
    const sub = (await appHello()).push?.subscription;
    if (sub) await api.post("/api/push/unsubscribe", { endpoint: sub.endpoint });
    await appUnsubscribe();
    rememberAppPush(null);
    return;
  }
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api.post("/api/push/unsubscribe", { endpoint: sub.endpoint });
  await sub.unsubscribe().catch(() => {});
}

export async function testPush(): Promise<void> {
  if (inAndroidApp()) {
    const sub = (await appHello()).push?.subscription;
    if (!sub) throw new Error("Turn notifications on first.");
    await api.post("/api/push/test", { endpoint: sub.endpoint });
    return;
  }
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) throw new Error("Turn notifications on first.");
  await api.post("/api/push/test", { endpoint: sub.endpoint });
}
