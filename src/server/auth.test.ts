import { randomBytes } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuthError, AuthStore } from "./auth";
import { loadMasterKey, SecretStore } from "./secrets";

async function auth(now = () => Date.now()) {
  const dir = await mkdtemp(join(tmpdir(), "hearth-auth-"));
  const a = new AuthStore(dir, randomBytes(32), now);
  await a.load();
  return { a, dir };
}

describe("admin", () => {
  it("is set up once, with the code from the log", async () => {
    const { a } = await auth();
    expect(a.needsSetup).toBe(true);
    await expect(a.setup("000000", "long enough")).rejects.toThrow(/setup code/);
    await expect(a.setup(a.setupCode, "short")).rejects.toThrow(/8 characters/);
    const cookie = await a.setup(a.setupCode, "long enough");
    expect(a.isAdmin(cookie)).toBe(true);
    await expect(a.setup(a.setupCode, "another one")).rejects.toThrow(/already set/);
  });

  it("signs in, refuses wrong passwords, and slows down guessing", async () => {
    let t = 1_000_000;
    const { a } = await auth(() => t);
    await a.setup(a.setupCode, "correct horse");
    expect(a.isAdmin(await a.login("correct horse"))).toBe(true);
    for (let i = 0; i < 5; i++) await expect(a.login("wrong")).rejects.toBeInstanceOf(AuthError);
    await expect(a.login("correct horse")).rejects.toThrow(/Too many tries/);
    t += 31_000;
    expect(a.isAdmin(await a.login("correct horse"))).toBe(true);
  });

  it("ends old sessions when the password changes, and refuses tampered cookies", async () => {
    const { a } = await auth();
    const old = await a.setup(a.setupCode, "first password");
    const fresh = await a.changePassword("second password");
    expect(a.isAdmin(old)).toBe(false);
    expect(a.isAdmin(fresh)).toBe(true);
    const [body, mac] = fresh.split(".");
    const forged = `${Buffer.from(JSON.stringify({ k: "a", s: "x", exp: 9e15 })).toString("base64url")}.${mac}`;
    expect(a.isAdmin(forged)).toBe(false);
    expect(a.isAdmin(`${body}.AAAA`)).toBe(false);
  });

  it("stores only hashes", async () => {
    const { a, dir } = await auth();
    await a.setup(a.setupCode, "my secret password");
    await a.setPin("kid", "1234");
    const file = await readFile(join(dir, "auth.json"), "utf8");
    expect(file).not.toContain("my secret password");
    expect(file).not.toContain('1234"');
    expect(file).toContain("scrypt$");
  });
});

describe("profile PINs", () => {
  it("open freely without a PIN, and need it once one is set", async () => {
    const { a } = await auth();
    const open = await a.openProfile("kid", undefined, false);
    expect(a.profileOf(open)).toBe("kid");
    await a.setPin("kid", "4321");
    // The old cookie was made before the PIN: it no longer opens the profile.
    expect(a.profileOf(open)).toBeNull();
    await expect(a.openProfile("kid", "0000", false)).rejects.toThrow(/PIN/);
    expect(a.profileOf(await a.openProfile("kid", "4321", false))).toBe("kid");
    // The admin can open any profile.
    expect(a.profileOf(await a.openProfile("kid", undefined, true))).toBe("kid");
  });

  it("are 4 to 8 digits", async () => {
    const { a } = await auth();
    await expect(a.setPin("kid", "12a4")).rejects.toThrow(/4 to 8 digits/);
    await expect(a.setPin("kid", "123")).rejects.toThrow(/4 to 8 digits/);
  });
});

describe("secrets", () => {
  it("are encrypted at rest, filled into text, and redacted from messages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hearth-sec-"));
    const { key, fromFile } = await loadMasterKey(dir, "");
    expect(fromFile).toBe(true);
    const s = new SecretStore(dir, key);
    await s.set("nas_token", "abc123-very-secret");
    expect(await readFile(join(dir, "secrets.json"), "utf8")).not.toContain("very-secret");

    const again = new SecretStore(dir, (await loadMasterKey(dir, "")).key);
    await again.load();
    expect(again.fill("Bearer {{secret:nas_token}}")).toEqual({
      text: "Bearer abc123-very-secret",
      missing: [],
    });
    expect(again.fill("{{ secret:nope }}").missing).toEqual(["nope"]);
    expect(again.redact("failed: token abc123-very-secret refused")).toBe(
      "failed: token ••• refused",
    );
    expect(again.names()).toEqual(["nas_token"]);
  });

  it("can't be read with another key", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hearth-sec-"));
    const s = new SecretStore(dir, (await loadMasterKey(dir, "one")).key);
    await s.set("x", "value");
    const other = new SecretStore(dir, (await loadMasterKey(dir, "two")).key);
    await expect(other.load()).rejects.toThrow();
  });
});
