import { createECDH, randomBytes } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { idOf, PushService, pushHostOk, urlForTag, VAPID_SECRET } from "./push";

/** A browser's subscription: its own P-256 key and auth secret, as base64url. */
function browserKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  };
}

function secrets() {
  const m = new Map<string, string>();
  return {
    get: (k: string) => m.get(k),
    has: (k: string) => m.has(k),
    set: async (k: string, v: string | null) => {
      if (v === null) m.delete(k);
      else m.set(k, v);
    },
    m,
  };
}

async function setup(status: (endpoint: string) => number = () => 201) {
  const dir = await mkdtemp(join(tmpdir(), "hearth-push-"));
  const s = secrets();
  const sent: { url: string; headers: Record<string, string>; body: Uint8Array }[] = [];
  const allowed = new Set(["admin", "sam"]);
  const push = new PushService({
    dataDir: dir,
    secrets: s as never,
    allowed: (who) => allowed.has(who),
    fetch: (async (url: string, init: RequestInit) => {
      sent.push({
        url,
        headers: init.headers as Record<string, string>,
        body: init.body as Uint8Array,
      });
      return new Response(null, { status: status(url) });
    }) as unknown as typeof fetch,
  });
  await push.init();
  return { push, dir, s, sent, allowed };
}

const FCM = "https://fcm.googleapis.com/fcm/send/abc123";
const MOZ = "https://updates.push.services.mozilla.com/wpush/v2/xyz";

describe("notifications (web push)", () => {
  it("only takes a push service's https address", () => {
    expect(pushHostOk(FCM)).toBe(true);
    expect(pushHostOk("http://fcm.googleapis.com/x")).toBe(false);
    expect(pushHostOk("https://192.168.1.20/x")).toBe(false);
    expect(pushHostOk("https://localhost/x")).toBe(false);
    expect(pushHostOk("not a url")).toBe(false);
  });

  it("makes its keys once, and sends each device an encrypted, signed message", async () => {
    const { push, s, sent, dir } = await setup();
    const key = await push.publicKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(await push.publicKey()).toBe(key);
    expect(JSON.parse(s.m.get(VAPID_SECRET) as string).privateKey).toBeTruthy();

    await push.subscribe({ endpoint: FCM, keys: browserKeys() }, "admin", "Chrome on Android");
    await push.subscribe({ endpoint: MOZ, keys: browserKeys() }, "sam", "Firefox on Windows");
    expect(push.on()).toBe(true);
    const n = await push.send({ title: "Sam is asking", text: "30 more minutes", url: "/family" });
    expect(n).toBe(2);
    expect(sent.map((x) => x.url).sort()).toEqual([FCM, MOZ].sort());
    const h = sent[0]?.headers ?? {};
    expect(h["Content-Encoding"]).toBe("aes128gcm");
    expect(h.TTL).toBe("21600");
    expect(h.Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
    // Encrypted: the words never travel in the clear.
    const body = Buffer.from(sent[0]?.body ?? []);
    expect(body.length).toBeGreaterThan(40);
    expect(body.toString("utf8")).not.toContain("more minutes");
    // The list shows no keys or addresses.
    const list = await push.list();
    expect(list.map((d) => d.label).sort()).toEqual(["Chrome on Android", "Firefox on Windows"]);
    expect(JSON.stringify(list)).not.toContain("fcm.googleapis");
    expect(list.every((d) => d.lastOk)).toBe(true);
    // Kept on disk for the next start.
    expect(JSON.parse(await readFile(join(dir, "push.json"), "utf8")).devices).toHaveLength(2);
  });

  it("drops a device the push service says is gone, and skips one who's no longer a parent", async () => {
    const { push, sent, allowed } = await setup((url) => (url === MOZ ? 410 : 201));
    await push.subscribe({ endpoint: FCM, keys: browserKeys() }, "admin", "A");
    await push.subscribe({ endpoint: MOZ, keys: browserKeys() }, "sam", "B");
    expect(await push.send({ title: "x", text: "y" })).toBe(1);
    expect(await push.has(MOZ)).toBe(false);
    allowed.delete("admin");
    sent.length = 0;
    expect(await push.send({ title: "x", text: "y" })).toBe(0);
    expect(sent).toHaveLength(0);
    expect(push.on()).toBe(false);
  });

  it("refuses an address that isn't a push service, and forgets by list id", async () => {
    const { push } = await setup();
    await expect(
      push.subscribe({ endpoint: "http://192.168.1.20/steal", keys: browserKeys() }, "admin", ""),
    ).rejects.toThrow(/push service/);
    await push.subscribe({ endpoint: FCM, keys: browserKeys() }, "admin", "A");
    expect(await push.remove(idOf(FCM))).toBe(true);
    expect(await push.has(FCM)).toBe(false);
  });

  it("opens the Family page for family alerts, Devices for the rest", () => {
    expect(urlForTag("raising_hand")).toBe("/family");
    expect(urlForTag("door")).toBe("/family");
    expect(urlForTag("no_entry")).toBe("/family");
    expect(urlForTag("warning")).toBe("/devices");
    expect(urlForTag()).toBe("/");
  });
});
