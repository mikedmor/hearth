/**
 * The home's root certificate, for `start.home/trust`: only its public half, from a file mounted
 * read-only (step-ca's `root_ca.crt`). Hearth refuses a file that holds a private key, so a
 * mistake in the mount can't put one on a page anyone on the network can open.
 */
import { createHash, X509Certificate } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { TrustInfo } from "../shared/api";

export interface RootCert {
  pem: string;
  der: Buffer;
  name: string;
  fingerprint: string;
  validTo: string;
}

/** Where the root is looked for: HEARTH_ROOT_CA, the container's /certs, then data/certs. */
export function rootPaths(dataDir: string, env = process.env): string[] {
  return [env.HEARTH_ROOT_CA, "/certs/root_ca.crt", join(dataDir, "certs", "root_ca.crt")].filter(
    (p): p is string => Boolean(p),
  );
}

/** Read a root certificate from PEM text. Throws on a private key or a certificate that isn't a CA. */
export function parseRoot(text: string): RootCert {
  if (/PRIVATE KEY/.test(text))
    throw new Error("That file holds a private key. Mount only the public root_ca.crt.");
  const block = text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
  if (!block) throw new Error("That file has no certificate in it.");
  const cert = new X509Certificate(block[0]);
  if (!cert.ca) throw new Error("That certificate isn't a certificate authority's root.");
  const cn = /CN=([^\n,]+)/.exec(cert.subject)?.[1]?.trim();
  return {
    pem: `${block[0].trim()}\n`,
    der: cert.raw,
    name: cn ?? cert.subject.replace(/\n/g, ", "),
    fingerprint: cert.fingerprint256,
    validTo: new Date(cert.validTo).toISOString(),
  };
}

/** The root, read again whenever its file changes. */
export class TrustStore {
  private cached?: { path: string; mtime: number; cert: RootCert | null; error?: string };

  constructor(private readonly paths: string[]) {}

  get(): { cert: RootCert | null; error?: string } {
    const path = this.paths.find((p) => existsSync(p));
    if (!path) return { cert: null };
    const mtime = statSync(path).mtimeMs;
    if (this.cached?.path === path && this.cached.mtime === mtime) return this.cached;
    try {
      this.cached = { path, mtime, cert: parseRoot(readFileSync(path, "utf8")) };
    } catch (e) {
      this.cached = { path, mtime, cert: null, error: (e as Error).message };
    }
    return this.cached;
  }

  info(redirect: boolean, now = Date.now()): TrustInfo {
    const { cert, error } = this.get();
    if (!cert) return { available: false, error, redirect };
    return {
      available: true,
      name: cert.name,
      fingerprint: cert.fingerprint,
      validTo: cert.validTo,
      expiresSoon: Date.parse(cert.validTo) - now < 180 * 86_400_000,
      redirect,
    };
  }
}

/** A UUID made from text, so the same root always gives the same profile (reinstalls replace it). */
function uuidFrom(text: string): string {
  const h = createHash("sha256").update(text).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`.toUpperCase();
}

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * An iPhone/iPad/Mac configuration profile holding the root: installing it is one step instead
 * of three. It isn't signed, so the device says "Not Verified"; that's expected for a home's own.
 */
export function mobileconfig(cert: RootCert, home = "Home"): string {
  const id = cert.fingerprint.replace(/:/g, "").slice(0, 16).toLowerCase();
  const b64 = cert.der.toString("base64").replace(/.{1,64}/g, "$&\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadCertificateFileName</key>
      <string>home-root-ca.cer</string>
      <key>PayloadContent</key>
      <data>
${b64}      </data>
      <key>PayloadDescription</key>
      <string>Lets this device trust ${xml(home)}'s own websites.</string>
      <key>PayloadDisplayName</key>
      <string>${xml(cert.name)}</string>
      <key>PayloadIdentifier</key>
      <string>home.hearth.trust.root.${id}</string>
      <key>PayloadType</key>
      <string>com.apple.security.root</string>
      <key>PayloadUUID</key>
      <string>${uuidFrom(`root:${cert.fingerprint}`)}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
    </dict>
  </array>
  <key>PayloadDescription</key>
  <string>The certificate for ${xml(home)}'s own websites, from its own certificate authority.</string>
  <key>PayloadDisplayName</key>
  <string>${xml(home)} certificate</string>
  <key>PayloadIdentifier</key>
  <string>home.hearth.trust.${id}</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${uuidFrom(`profile:${cert.fingerprint}`)}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
`;
}
