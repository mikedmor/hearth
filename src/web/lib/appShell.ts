/**
 * The Hearth Android app (a WebView, from the app-shell project). On Hearth's own address it gives
 * the page a `window.AppShell` message port: requests are JSON with an `id`, and answers come back
 * as `message` events with that `id`. A browser's push service isn't there, so notifications go
 * through the app instead: it hands over a subscription like a browser's (an `fcm:<token>`
 * endpoint and its own encryption keys, or a UnifiedPush address), which the server registers
 * and encrypts to like any other.
 */

interface Port {
  postMessage(message: string): void;
  addEventListener(type: "message", cb: (e: MessageEvent) => void): void;
}

export interface AppSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface Reply {
  id?: string;
  ok: boolean;
  error?: string;
}

interface AppHello extends Reply {
  app: string;
  version: string;
  push: {
    method?: "firebase" | "unifiedpush";
    available: boolean;
    permission: boolean;
    subscription?: AppSubscription;
  };
}

const port = (): Port | undefined => (window as Window & { AppShell?: Port }).AppShell;

/** Running inside the Hearth Android app (not its off-screen widget pictures). */
export const inAndroidApp = (): boolean => typeof window !== "undefined" && !!port();

let seq = 0;
let listening = false;
const waiting = new Map<string, (r: Reply) => void>();

function ask<T extends Reply>(msg: Record<string, unknown>, timeoutMs: number): Promise<T> {
  const p = port();
  if (!p) return Promise.reject(new Error("Not running in the Hearth app."));
  if (!listening) {
    listening = true;
    p.addEventListener("message", (e) => {
      let r: Reply;
      try {
        r = JSON.parse(String(e.data)) as Reply;
      } catch {
        return;
      }
      const done = r.id ? waiting.get(r.id) : undefined;
      if (r.id && done) {
        waiting.delete(r.id);
        done(r);
      }
    });
  }
  seq += 1;
  const id = String(seq);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error("The app didn't answer."));
    }, timeoutMs);
    waiting.set(id, (r) => {
      clearTimeout(timer);
      resolve(r as T);
    });
    p.postMessage(JSON.stringify({ ...msg, id }));
  });
}

export const appHello = () => ask<AppHello>({ type: "hello" }, 5_000);

/** Asks for notification permission (and the push app), then an endpoint: can take a while. */
export const appSubscribe = (vapid: string) =>
  ask<Reply & { subscription?: AppSubscription }>({ type: "push.subscribe", vapid }, 90_000);

/** The app drops its push token and keys. */
export const appUnsubscribe = () => ask({ type: "push.unsubscribe" }, 10_000).catch(() => {});

/** What to tell someone when the app couldn't turn notifications on. */
export function appPushError(error: string | undefined): string {
  switch (error) {
    case "no-distributor":
      return "This phone is set to get notifications through a UnifiedPush app, but none is installed. Install one such as ntfy, or switch back to Google in the app's Server and lock settings.";
    case "not-configured":
      return "This copy of the app was built without notifications.";
    case "denied":
      return "Notifications are off for Hearth in Android. Turn them on in Settings › Apps › Hearth › Notifications, then try again.";
    case "failed:IOException":
      return "Couldn't reach Google to set up notifications. Check you're online and that Google Play services is up to date, then try again.";
    default:
      return `Couldn't turn them on${error ? ` (${error})` : ""}.`;
  }
}

// ---------------------------------------------------------------------------
// Keeping the server's copy of this phone's endpoint current

const REGISTERED = "hearth.appPush";

export function rememberAppPush(endpoint: string | null): void {
  try {
    if (endpoint) localStorage.setItem(REGISTERED, endpoint);
    else localStorage.removeItem(REGISTERED);
  } catch {
    // Storage blocked: it's checked again next time.
  }
}

/**
 * At startup in the app: Google can change this phone's push token (after a reinstall or a
 * restore). If notifications were turned on here and the endpoint moved, register the new one.
 */
export async function syncAppPush(register: (sub: AppSubscription) => Promise<void>) {
  let registered: string | null = null;
  try {
    registered = localStorage.getItem(REGISTERED);
  } catch {
    return;
  }
  if (!registered || !port()) return;
  const sub = (await appHello()).push?.subscription;
  if (sub && sub.endpoint !== registered) await register(sub);
}
