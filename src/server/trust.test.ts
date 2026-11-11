import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mobileconfig, parseRoot, rootPaths, TrustStore } from "./trust";

// Throwaway test certificates (public halves only; their keys were never kept).
const CA = `-----BEGIN CERTIFICATE-----
MIIBgzCCASmgAwIBAgIUfOCf0iNdsMBlIDiGqnNcs4Z6tkUwCgYIKoZIzj0EAwIw
FzEVMBMGA1UEAwwMVGVzdCBSb290IENBMB4XDTI2MTExMDIzMDQxN1oXDTM2MTEw
NzIzMDQxN1owFzEVMBMGA1UEAwwMVGVzdCBSb290IENBMFkwEwYHKoZIzj0CAQYI
KoZIzj0DAQcDQgAEWTS051xjB0Q8F2mfhrBciLECOkZa/yOrhS9z3m4LoWuFKcuj
f7q4CHViI5eByTkzlAgm8S2jRigLRPqpWQ5jpKNTMFEwHQYDVR0OBBYEFMGSKMSo
mgAAqAQ88fBy0xmW0verMB8GA1UdIwQYMBaAFMGSKMSomgAAqAQ88fBy0xmW0ver
MA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDSAAwRQIgGXZeSECnOCQ8qZS0
YtL+ptqely+sTtTFnx42DWesJ+oCIQCtveRTqnmOZ80/S+XeQSbz9rlKzer8+xc4
tvV5T32l1A==
-----END CERTIFICATE-----`;

const LEAF = `-----BEGIN CERTIFICATE-----
MIIBgDCCASagAwIBAgIUHpymoVhNc52wylwA1RkZ+NYNmOkwCgYIKoZIzj0EAwIw
FzEVMBMGA1UEAwwMbGVhZi5leGFtcGxlMB4XDTI2MTExMDIzMDQxOFoXDTM2MTEw
NzIzMDQxOFowFzEVMBMGA1UEAwwMbGVhZi5leGFtcGxlMFkwEwYHKoZIzj0CAQYI
KoZIzj0DAQcDQgAEEJ/v43rbebwv2MFK4AtiS9GcuBXauOKhXtRrJfTiOK6sgBJY
cCh7YZcieXJ0wqQrT7Tjv2JRQlLYb7UQtpZdcaNQME4wHQYDVR0OBBYEFLEONFvi
4uKNXGC7nPMnDa7tTfGuMB8GA1UdIwQYMBaAFLEONFvi4uKNXGC7nPMnDa7tTfGu
MAwGA1UdEwEB/wQCMAAwCgYIKoZIzj0EAwIDSAAwRQIhALVL/qC2OoddEQmPhL/u
wpkXqyqOVpkYt0AwreDWByZcAiA5hxZSthKQFZalQHrYNHV8ucXGWmBVtRMvMxM2
zi6sdg==
-----END CERTIFICATE-----`;

describe("the trust page's certificate", () => {
  it("looks in the mount, then the data folder", () => {
    expect(rootPaths("/data", { HEARTH_ROOT_CA: "/x/ca.crt" })).toEqual([
      "/x/ca.crt",
      "/certs/root_ca.crt",
      join("/data", "certs", "root_ca.crt"),
    ]);
    expect(rootPaths("/data", {})).toHaveLength(2);
  });

  it("reads a CA's root: its name, fingerprint and end date", () => {
    const r = parseRoot(`some text before\n${CA}\n`);
    expect(r.name).toBe("Test Root CA");
    expect(r.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(r.validTo).toBe("2036-11-07T23:04:17.000Z");
    expect(r.pem.startsWith("-----BEGIN CERTIFICATE-----")).toBe(true);
  });

  it("refuses a private key, a certificate that isn't a CA's, and no certificate", () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const key = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(() => parseRoot(`${CA}\n${key}`)).toThrow(/private key/);
    expect(() => parseRoot(LEAF)).toThrow(/isn't a certificate authority/);
    expect(() => parseRoot("hello")).toThrow(/no certificate/);
  });

  it("offers nothing when no file is mounted, and says why a bad one isn't offered", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hearth-trust-"));
    expect(new TrustStore([join(dir, "missing.crt")]).info(true)).toEqual({
      available: false,
      redirect: true,
    });
    await writeFile(join(dir, "bad.crt"), `${CA}\n-----BEGIN EC PRIVATE KEY-----\nxx\n`);
    expect(new TrustStore([join(dir, "bad.crt")]).info(false)).toMatchObject({
      available: false,
      error: expect.stringMatching(/private key/),
    });
    await writeFile(join(dir, "ok.crt"), CA);
    const ok = new TrustStore([join(dir, "missing.crt"), join(dir, "ok.crt")]);
    expect(ok.info(true, Date.parse("2026-11-10T00:00:00Z"))).toMatchObject({
      available: true,
      name: "Test Root CA",
      expiresSoon: false,
    });
    expect(ok.info(true, Date.parse("2036-08-01T00:00:00Z")).expiresSoon).toBe(true);
  });

  it("makes an iPhone profile holding the root, the same each time", () => {
    const r = parseRoot(CA);
    const a = mobileconfig(r, "The <Morgan> home");
    expect(a).toContain("<string>com.apple.security.root</string>");
    expect(a).toContain(r.der.toString("base64").slice(0, 64));
    expect(a).toContain("The &lt;Morgan&gt; home certificate");
    expect(a).toBe(mobileconfig(r, "The <Morgan> home"));
  });
});
