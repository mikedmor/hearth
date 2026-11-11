/**
 * Secrets: API keys for widget sources and AI servers. Kept in `secrets.json`, encrypted
 * with AES-256-GCM, and never sent to a browser: the page only learns that a secret exists.
 *
 * The key comes from HEARTH_SECRET_KEY. Without it, Hearth makes one and keeps it in
 * `data/secret.key`. That still keeps secrets out of `hearth.json`, but a backup of the data folder
 * then holds both, so setting HEARTH_SECRET_KEY on the NAS is better (the page says so).
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const SECRET_NAME = /^[a-z0-9][a-z0-9_:.-]{0,63}$/;
/**
 * Kept out of widgets and the Secrets list: calendar sign-ins and links belong to one person
 * (Google's client is the admin's); the front door's house password and the sign-on client's
 * secret are only for those.
 */
const PERSONAL = /^(calendar:(?!google-client$)|door:|sso:|smarthome:|router:|files:)/;
export const isPersonalSecret = (name: string) => PERSONAL.test(name);

export async function loadMasterKey(
  dataDir: string,
  fromEnv = process.env.HEARTH_SECRET_KEY,
): Promise<{ key: Buffer; fromFile: boolean }> {
  if (fromEnv?.trim())
    return { key: createHash("sha256").update(fromEnv.trim()).digest(), fromFile: false };
  const path = join(dataDir, "secret.key");
  if (existsSync(path)) {
    const text = (await readFile(path, "utf8")).trim();
    return { key: createHash("sha256").update(text).digest(), fromFile: true };
  }
  const made = randomBytes(32).toString("base64");
  await writeFile(path, `${made}\n`, { mode: 0o600 });
  await chmod(path, 0o600).catch(() => {});
  return { key: createHash("sha256").update(made).digest(), fromFile: true };
}

export function deriveKey(master: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), `hearth:${purpose}`, 32));
}

export class SecretStore {
  private values = new Map<string, string>();
  private readonly key: Buffer;

  constructor(
    private readonly dataDir: string,
    master: Buffer,
  ) {
    this.key = deriveKey(master, "secrets");
  }

  private get path() {
    return join(this.dataDir, "secrets.json");
  }

  async load(): Promise<void> {
    if (!existsSync(this.path)) return;
    const raw = JSON.parse(await readFile(this.path, "utf8")) as { v: 1; data: string };
    const buf = Buffer.from(raw.data, "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    const plain = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString(
      "utf8",
    );
    this.values = new Map(Object.entries(JSON.parse(plain) as Record<string, string>));
  }

  has(name: string): boolean {
    return this.values.has(name);
  }

  get(name: string): string | undefined {
    return this.values.get(name);
  }

  /** Names only, for the admin's list. People's own calendar sign-ins aren't the admin's. */
  names(): string[] {
    return [...this.values.keys()].filter((n) => !PERSONAL.test(n)).sort();
  }

  async set(name: string, value: string | null): Promise<void> {
    if (!SECRET_NAME.test(name))
      throw new Error("Secret names use lowercase letters, digits, _ : . and -");
    if (value === null) this.values.delete(name);
    else this.values.set(name, value);
    await this.save();
  }

  private async save(): Promise<void> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const plain = Buffer.from(JSON.stringify(Object.fromEntries(this.values)), "utf8");
    const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
    const data = Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
    const tmp = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ v: 1, data }), { mode: 0o600 });
    await rename(tmp, this.path);
  }

  /**
   * Fill `{{secret:name}}` in a header, body or address. Unknown names stay empty and are reported,
   * so a typo is visible without ever showing a value.
   */
  fill(text: string): { text: string; missing: string[] } {
    const missing: string[] = [];
    const out = text.replace(/\{\{\s*secret:([a-z0-9_:.-]+)\s*\}\}/g, (_m, name: string) => {
      // A widget can't send someone's calendar password or token anywhere.
      const v = PERSONAL.test(name) ? undefined : this.values.get(name);
      if (v === undefined) missing.push(name);
      return v ?? "";
    });
    return { text: out, missing };
  }

  /** Every place a secret's value appears in `text` is replaced, for error messages and samples. */
  redact(text: string): string {
    let out = text;
    for (const v of this.values.values()) if (v.length >= 4) out = out.split(v).join("•••");
    return out;
  }
}
