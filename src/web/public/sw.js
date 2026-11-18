// Hearth's service worker. Two jobs:
// 1. Away from home, open Hearth as it was last time: the app is kept, and the answers the server
//    marks "X-Hearth-Offline: keep" (never the admin's, never a page with a PIN). Home is always
//    asked first; a kept copy is only used when home can't be reached, and says when it's from.
// 2. Show the house's alerts as notifications (web push), and open the right page when tapped.

const SHELL = "hearth-shell-v1";
const DATA = "hearth-data-v1";
const SAVED = "x-hearth-saved";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(["/", "/favicon.svg", "/icon-192.png"]))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith("hearth-") && name !== SHELL && name !== DATA)
          await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

/** Home, but not for ever: a phone on the edge of the Wi-Fi shouldn't hang. */
function fromHome(request, ms) {
  return Promise.race([
    fetch(request),
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

async function keep(cacheName, key, response) {
  const headers = new Headers(response.headers);
  headers.set(SAVED, new Date().toISOString());
  const body = await response.clone().blob();
  const cache = await caches.open(cacheName);
  await cache.put(key, new Response(body, { status: response.status, headers }));
}

/** The page itself: home first, else the kept copy (every route is the same page). */
async function page(request) {
  try {
    const res = await fromHome(request, 5000);
    if (res.ok) await keep(SHELL, "/", res);
    return res;
  } catch {
    const kept = await caches.match("/", { cacheName: SHELL });
    if (kept) return kept;
    throw new Error("offline");
  }
}

/** Scripts, styles, icons and logos: their names change when they do, so a kept one is good. */
async function asset(request) {
  const kept = await caches.match(request, { cacheName: SHELL });
  if (kept) return kept;
  const res = await fetch(request);
  if (res.ok) (await caches.open(SHELL)).put(request, res.clone());
  return res;
}

/** Data: home first; kept only when the server says so; the kept copy only when home is away. */
async function data(request) {
  const url = new URL(request.url);
  try {
    const res = await fromHome(request, 6000);
    if (res.ok && res.headers.get("x-hearth-offline") === "keep") {
      await keep(DATA, request, res);
    } else if (res.ok && url.pathname === "/api/home") {
      // The admin, or a page with a PIN: keep nothing at all from now on.
      await caches.delete(DATA);
    }
    return res;
  } catch (err) {
    const cache = await caches.open(DATA);
    const kept =
      (await cache.match(request)) ?? (await cache.match(request, { ignoreSearch: true }));
    if (kept) return kept;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(page(request));
    return;
  }
  const p = url.pathname;
  if (
    p.startsWith("/assets/") ||
    p.startsWith("/icons/") ||
    /^\/(favicon\.svg|icon-[\w-]+\.png|badge-\d+\.png)$/.test(p)
  ) {
    event.respondWith(asset(request));
    return;
  }
  // Admin answers are never kept; the live socket isn't a fetch.
  if (p.startsWith("/api/") && !p.startsWith("/api/admin/") && p !== "/api/live") {
    event.respondWith(data(request));
  }
});

self.addEventListener("message", (event) => {
  // Signing out, or the admin signing in: forget what was kept.
  if (event.data?.type === "forget") event.waitUntil(caches.delete(DATA));
});

self.addEventListener("push", (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(msg.title || "Hearth", {
      body: msg.body || "",
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      tag: msg.tag,
      data: { url: msg.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of open) {
        if (new URL(c.url).origin === self.location.origin) {
          await c.focus();
          if ("navigate" in c) await c.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
