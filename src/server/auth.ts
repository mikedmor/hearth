/**
 * Who may do what.
 *
 * - The admin has a password, set on the first visit with a one-time code from Hearth's log (so
 *   nobody else on the Wi-Fi can claim it first).
 * - A profile can have a PIN. Opening it then needs the PIN; without one, anyone can open it.
 * - Both are hashed with scrypt in `auth.json`. Sessions are signed cookies that name the password
 *   or PIN they were made with, so changing one signs everyone out of it.
 * - Wrong tries slow down: after five, each lock doubles, up to 15 minutes.
 */
import { createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { deriveKey } from "./secrets";

const scryptAsync = promisify(scrypt) as (
  pw: string,
  salt: Buffer,
  len: number,
  opts: object,
) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const ADMIN_COOKIE = "hearth_admin";
export const PROFILE_COOKIE = "hearth_profile";
const ADMIN_DAYS = 30;
const PROFILE_DAYS = 365;

interface AuthFile {
  v: 1;
  admin?: string;
  pins: Record<string, string>;
}

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(secret, salt, 32, SCRYPT);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [kind, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64");
  const got = await scryptAsync(secret, Buffer.from(salt, "base64"), want.length, SCRYPT);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** A short fingerprint of a stored hash, put in cookies so a new password ends old sessions. */
const stamp = (stored: string | undefined) => (stored ? stored.slice(-10) : "none");

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 429 = 401,
  ) {
    super(message);
  }
}

export class AuthStore {
  private file: AuthFile = { v: 1, pins: {} };
  private readonly key: Buffer;
  /** One-time code for the first visit, shown in the log. */
  readonly setupCode = String(randomInt(100000, 1000000));
  private tries = new Map<string, { fails: number; until: number }>();

  constructor(
    private readonly dataDir: string,
    master: Buffer,
    private readonly now: () => number = Date.now,
  ) {
    this.key = deriveKey(master, "sessions");
  }

  private get path() {
    return join(this.dataDir, "auth.json");
  }

  async load(): Promise<void> {
    if (existsSync(this.path))
      this.file = { pins: {}, ...JSON.parse(await readFile(this.path, "utf8")) };
  }

  private async save(): Promise<void> {
    const tmp = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(this.file, null, 2), { mode: 0o600 });
    await rename(tmp, this.path);
  }

  get needsSetup(): boolean {
    return !this.file.admin;
  }

  hasPin(profile: string): boolean {
    return Boolean(this.file.pins[profile]);
  }

  // -------------------------------------------------------------------------
  // Slowing down guesses

  private guard(key: string) {
    const t = this.tries.get(key);
    if (t && t.until > this.now()) {
      const secs = Math.ceil((t.until - this.now()) / 1000);
      throw new AuthError(`Too many tries. Wait ${secs} seconds.`, 429);
    }
  }

  private failed(key: string) {
    const t = this.tries.get(key) ?? { fails: 0, until: 0 };
    t.fails++;
    if (t.fails >= 5) t.until = this.now() + Math.min(15 * 60_000, 30_000 * 2 ** (t.fails - 5));
    this.tries.set(key, t);
  }

  // -------------------------------------------------------------------------
  // Admin

  async setup(code: string, password: string): Promise<string> {
    if (!this.needsSetup) throw new AuthError("The admin password is already set.", 403);
    this.guard("setup");
    if (code.trim() !== this.setupCode) {
      this.failed("setup");
      throw new AuthError("That setup code isn't right. It's in Hearth's log.");
    }
    checkPassword(password);
    this.file.admin = await hashSecret(password);
    await this.save();
    return this.adminCookie();
  }

  async login(password: string): Promise<string> {
    if (!this.file.admin) throw new AuthError("Set the admin password first.", 403);
    this.guard("admin");
    if (!(await verifySecret(password, this.file.admin))) {
      this.failed("admin");
      throw new AuthError("That password isn't right.");
    }
    this.tries.delete("admin");
    return this.adminCookie();
  }

  async changePassword(password: string): Promise<string> {
    checkPassword(password);
    this.file.admin = await hashSecret(password);
    await this.save();
    return this.adminCookie();
  }

  private adminCookie(): string {
    return this.sign({
      k: "a",
      s: stamp(this.file.admin),
      exp: this.now() + ADMIN_DAYS * 86_400_000,
    });
  }

  isAdmin(cookie: string | undefined): boolean {
    const p = this.verify(cookie);
    return p?.k === "a" && p.s === stamp(this.file.admin) && Boolean(this.file.admin);
  }

  // -------------------------------------------------------------------------
  // Profiles

  /** Open a profile on this device. With a PIN set, the PIN must match (the admin skips it). */
  async openProfile(profile: string, pin: string | undefined, isAdmin: boolean): Promise<string> {
    const stored = this.file.pins[profile];
    if (stored && !isAdmin) {
      const key = `pin:${profile}`;
      this.guard(key);
      if (!pin || !(await verifySecret(pin, stored))) {
        this.failed(key);
        throw new AuthError("That PIN isn't right.");
      }
      this.tries.delete(key);
    }
    return this.sign({
      k: "p",
      id: profile,
      s: stamp(stored),
      exp: this.now() + PROFILE_DAYS * 86_400_000,
    });
  }

  /** The profile a cookie opens, if it's still valid for that profile's current PIN. */
  profileOf(cookie: string | undefined): string | null {
    const p = this.verify(cookie);
    if (p?.k !== "p" || typeof p.id !== "string") return null;
    return p.s === stamp(this.file.pins[p.id]) ? p.id : null;
  }

  async setPin(profile: string, pin: string | null): Promise<void> {
    if (pin === null) delete this.file.pins[profile];
    else {
      if (!/^\d{4,8}$/.test(pin)) throw new AuthError("A PIN is 4 to 8 digits.", 400);
      this.file.pins[profile] = await hashSecret(pin);
    }
    await this.save();
  }

  async forgetProfile(profile: string): Promise<void> {
    if (this.file.pins[profile]) {
      delete this.file.pins[profile];
      await this.save();
    }
  }

  // -------------------------------------------------------------------------
  // Signed values

  private sign(payload: Record<string, unknown>): string {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const mac = createHmac("sha256", this.key).update(body).digest("base64url");
    return `${body}.${mac}`;
  }

  private verify(token: string | undefined): Record<string, unknown> | null {
    if (!token) return null;
    const [body, mac] = token.split(".");
    if (!body || !mac) return null;
    const want = createHmac("sha256", this.key).update(body).digest();
    const got = Buffer.from(mac, "base64url");
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    try {
      const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<
        string,
        unknown
      >;
      return typeof p.exp === "number" && p.exp > this.now() ? p : null;
    } catch {
      return null;
    }
  }
}

function checkPassword(pw: string) {
  if (pw.length < 8) throw new AuthError("Use at least 8 characters.", 400);
  if (pw.length > 200) throw new AuthError("That's too long.", 400);
}
