/**
 * Notifications to the Hearth Android app, through Firebase Cloud Messaging (HTTP v1). The app
 * registers like a browser does, with an endpoint of `fcm:<token>` and its own P-256 key and auth
 * secret; each notification is encrypted to those keys exactly like Web Push (RFC 8291, aes128gcm)
 * and sent as one data field, so Google (and the relay) only ever carry ciphertext.
 *
 * Two routes, like Muny's: the app's push relay (HEARTH_PUSH_RELAY, by default the published
 * app's), or straight to Firebase with your own key (HEARTH_FCM_CREDENTIALS) for an app you built
 * yourself. HEARTH_PUSH_RELAY=off turns notifications to the app off. Nothing is sent until a
 * parent or the admin turns notifications on in the app: that's the opt-in.
 */
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import webpush from "web-push";

export const FCM_PREFIX = "fcm:";

/** The push relay for the published Android apps (app-shell's relay). */
export const DEFAULT_PUSH_RELAY = "https://app-shell-push.mikedmor.workers.dev";

export interface FcmCredentials {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

/** How notifications reach the app: your own Firebase key, or a push relay. */
export type FcmRoute = { credentials: FcmCredentials } | { relay: string };

/** The app install is gone (uninstalled, or its token replaced): forget it. */
export class FcmGone extends Error {}

/** An app's endpoint: `fcm:` and a token as Firebase gives it. */
export const isFcmEndpoint = (endpoint: string) => /^fcm:[A-Za-z0-9_:-]{20,4096}$/.test(endpoint);

/**
 * The route from the environment: HEARTH_FCM_CREDENTIALS (a key file) wins; otherwise
 * HEARTH_PUSH_RELAY ("off" for none, an https address for your own relay), by default the
 * published app's relay. Throws a readable error for a bad setting.
 */
export function fcmRouteFromEnv(env: NodeJS.ProcessEnv): FcmRoute | null {
  const keyFile = env.HEARTH_FCM_CREDENTIALS?.trim();
  if (keyFile) return { credentials: loadFcmCredentials(keyFile) };
  const relay = env.HEARTH_PUSH_RELAY?.trim();
  if (relay === "off") return null;
  if (!relay) return { relay: DEFAULT_PUSH_RELAY };
  if (!/^https:\/\/[^\s/]+/.test(relay))
    throw new Error("HEARTH_PUSH_RELAY must be off or an https:// address");
  return { relay: relay.replace(/\/+$/, "") };
}

/** Reads a service-account key file from the Firebase console; throws a readable error. */
export function loadFcmCredentials(path: string): FcmCredentials {
  let json: { type?: string; project_id?: string; client_email?: string; private_key?: string };
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`HEARTH_FCM_CREDENTIALS: couldn't read a JSON key file at ${path}`);
  }
  if (
    json.type !== "service_account" ||
    !json.project_id ||
    !json.client_email ||
    !json.private_key
  )
    throw new Error(
      "HEARTH_FCM_CREDENTIALS must be a Firebase service-account key (Project settings → Service accounts → Generate new private key)",
    );
  return {
    projectId: json.project_id,
    clientEmail: json.client_email,
    privateKey: json.private_key,
  };
}

/** The notification encrypted to the app's keys, as Web Push would send it (aes128gcm). */
export function encryptFor(p256dh: string, auth: string, payload: string): Buffer {
  return webpush.encrypt(p256dh, auth, payload, "aes128gcm").cipherText;
}

const b64u = (b: Buffer) => b.toString("base64url");
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

let cached: { email: string; token: string; until: number } | null = null;

/** An OAuth access token for FCM (a signed JWT exchanged with Google), reused for ~55 minutes. */
async function accessToken(c: FcmCredentials, f: typeof fetch, now = Date.now()) {
  if (cached && cached.email === c.clientEmail && cached.until > now) return cached.token;
  const iat = Math.floor(now / 1000);
  const head = b64u(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64u(
    Buffer.from(
      JSON.stringify({ iss: c.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }),
    ),
  );
  const sig = sign("RSA-SHA256", Buffer.from(`${head}.${claims}`), createPrivateKey(c.privateKey));
  const res = await f(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${head}.${claims}.${b64u(sig)}`,
    }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Google sign-in answered ${res.status}`);
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("Google sign-in gave no token");
  cached = {
    email: c.clientEmail,
    token: body.access_token,
    until: now + Math.max(60, (body.expires_in ?? 3600) - 300) * 1000,
  };
  return body.access_token;
}

/** For tests: forget the cached access token. */
export function resetFcmToken() {
  cached = null;
}

/** Sends one encrypted notification to an app install. Throws FcmGone when it's no longer there. */
export async function sendFcm(
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  route: FcmRoute,
  f: typeof fetch = fetch,
): Promise<void> {
  const token = sub.endpoint.slice(FCM_PREFIX.length);
  const p = b64u(encryptFor(sub.keys.p256dh, sub.keys.auth, payload));
  if ("relay" in route) {
    // The relay only ever gets the phone's token and the ciphertext.
    const res = await f(`${route.relay}/v1/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, p }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return;
    if (res.status === 410) throw new FcmGone("gone");
    throw new Error(`The push relay answered ${res.status}.`);
  }
  const c = route.credentials;
  const res = await f(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(c.projectId)}/messages:send`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${await accessToken(c, f)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: { token, data: { p }, android: { priority: "HIGH", ttl: "21600s" } },
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (res.ok) return;
  if (res.status === 401) cached = null;
  const text = await res.text().catch(() => "");
  if (res.status === 404 || /UNREGISTERED|registration token is not a valid/i.test(text))
    throw new FcmGone("gone");
  throw new Error(`Firebase answered ${res.status}.`);
}
