import { createECDH, randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_PUSH_RELAY, encryptFor, fcmRouteFromEnv, isFcmEndpoint } from "./fcm";
import { PushService } from "./push";

/** web-push's own decryptor (its dependency): what the phone does with what it's sent. */
const ece = createRequire(import.meta.url)("http_ece") as {
  decrypt(
    body: Buffer,
    opts: { version: string; privateKey: ReturnType<typeof createECDH>; authSecret: Buffer },
  ): Buffer;
};

/** The app's keys, as it hands them over: its P-256 public key and auth secret. */
function appKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    ecdh,
    auth,
    keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") },
  };
}

const TOKEN = `fcm:${"a".repeat(40)}:APA91b${"x".repeat(30)}`;

function secrets() {
  const m = new Map<string, string>();
  return {
    get: (k: string) => m.get(k),
    has: (k: string) => m.has(k),
    set: async (k: string, v: string | null) => {
      if (v === null) m.delete(k);
      else m.set(k, v);
    },
  };
}

async function service(relayStatus: number, fcm: "relay" | null = "relay") {
  const sent: { url: string; body: { token: string; p: string } }[] = [];
  const push = new PushService({
    dataDir: await mkdtemp(join(tmpdir(), "hearth-fcm-")),
    secrets: secrets() as never,
    fcm: fcm ? { relay: "https://relay.example" } : null,
    fetch: (async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(null, { status: relayStatus });
    }) as typeof fetch,
  });
  return { push, sent };
}

describe("notifications to the Android app", () => {
  it("tells the app's endpoints from a browser's", () => {
    expect(isFcmEndpoint(TOKEN)).toBe(true);
    expect(isFcmEndpoint("fcm:short")).toBe(false);
    expect(isFcmEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(false);
  });

  it("encrypts so only the phone can read it", () => {
    const { ecdh, auth, keys } = appKeys();
    const sealed = encryptFor(keys.p256dh, keys.auth, '{"title":"Hi"}');
    const opened = ece.decrypt(sealed, {
      version: "aes128gcm",
      privateKey: ecdh,
      authSecret: auth,
    });
    expect(opened.toString()).toBe('{"title":"Hi"}');
  });

  it("sends through the relay: just the token and the ciphertext", async () => {
    const { ecdh, auth, keys } = appKeys();
    const { push, sent } = await service(200);
    await push.subscribe({ endpoint: TOKEN, keys }, "admin", "Hearth app on Android");
    expect(await push.send({ title: "At the door", text: "Someone rang", url: "/family" })).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe("https://relay.example/v1/send");
    expect(sent[0]?.body.token).toBe(TOKEN.slice(4));
    expect(JSON.stringify(sent[0]?.body)).not.toContain("door");
    const opened = ece.decrypt(Buffer.from(sent[0]?.body.p ?? "", "base64url"), {
      version: "aes128gcm",
      privateKey: ecdh,
      authSecret: auth,
    });
    expect(JSON.parse(opened.toString())).toMatchObject({
      title: "At the door",
      body: "Someone rang",
      url: "/family",
    });
  });

  it("forgets an app install the relay says is gone", async () => {
    const { push } = await service(410);
    await push.subscribe({ endpoint: TOKEN, keys: appKeys().keys }, "admin", "Phone");
    expect(await push.send({ title: "t", text: "x" })).toBe(0);
    expect(await push.has(TOKEN)).toBe(false);
  });

  it("won't take the app's endpoint when app notifications are off", async () => {
    const { push } = await service(200, null);
    await expect(
      push.subscribe({ endpoint: TOKEN, keys: appKeys().keys }, "admin", "Phone"),
    ).rejects.toThrow(/turned off/);
  });

  it("reads the route from the environment", () => {
    expect(fcmRouteFromEnv({})).toEqual({ relay: DEFAULT_PUSH_RELAY });
    expect(fcmRouteFromEnv({ HEARTH_PUSH_RELAY: "off" })).toBeNull();
    expect(fcmRouteFromEnv({ HEARTH_PUSH_RELAY: "https://push.example.org/" })).toEqual({
      relay: "https://push.example.org",
    });
    expect(() => fcmRouteFromEnv({ HEARTH_PUSH_RELAY: "http://plain.example" })).toThrow(/https/);
    expect(() => fcmRouteFromEnv({ HEARTH_FCM_CREDENTIALS: "/nowhere/key.json" })).toThrow(
      /couldn't read/,
    );
  });
});
