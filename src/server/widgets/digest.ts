/**
 * HTTP Digest sign-in (RFC 7616), for devices that ask for it (PrusaLink, some cameras): the
 * password never crosses the network, only a hash with the device's one-time nonce.
 */
import { createHash, randomBytes } from "node:crypto";

/** The challenge's parts: realm, nonce, qop, opaque, algorithm. */
export function parseChallenge(header: string): Record<string, string> | null {
  if (!/^\s*digest\s/i.test(header)) return null;
  const out: Record<string, string> = {};
  for (const m of header.replace(/^\s*digest\s+/i, "").matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g))
    out[(m[1] as string).toLowerCase()] = m[2] ?? m[3] ?? "";
  return out.nonce && out.realm !== undefined ? out : null;
}

/** The Authorization header answering a Digest challenge. */
export function digestAuthorization(
  challenge: Record<string, string>,
  method: string,
  uri: string,
  user: string,
  password: string,
  cnonce = randomBytes(8).toString("hex"),
): string {
  const algorithm = (challenge.algorithm ?? "MD5").toUpperCase();
  const hashName = algorithm.startsWith("SHA-256") ? "sha256" : "md5";
  const h = (s: string) => createHash(hashName).update(s).digest("hex");
  const realm = challenge.realm ?? "";
  const nonce = challenge.nonce ?? "";
  const qop = (challenge.qop ?? "")
    .split(",")
    .map((x) => x.trim())
    .find((x) => x === "auth");
  const nc = "00000001";
  let ha1 = h(`${user}:${realm}:${password}`);
  if (algorithm.endsWith("-SESS")) ha1 = h(`${ha1}:${nonce}:${cnonce}`);
  const ha2 = h(`${method}:${uri}`);
  const response = qop
    ? h(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : h(`${ha1}:${nonce}:${ha2}`);
  const parts = [
    `username="${user.replace(/"/g, "")}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
    `algorithm=${challenge.algorithm ?? "MD5"}`,
    ...(challenge.opaque !== undefined ? [`opaque="${challenge.opaque}"`] : []),
    ...(qop ? [`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`] : []),
  ];
  return `Digest ${parts.join(", ")}`;
}
