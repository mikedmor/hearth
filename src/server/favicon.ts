/**
 * Fetching a site's own icon for a tile. Only when someone presses "Use the site's icon":
 * the page's declared icons are read (apple-touch-icon and the largest icon first), then
 * /favicon.ico. The picture is checked by its bytes and saved in data/icons.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { join } from "node:path";

const MAX = 512 * 1024;

/** May Hearth call this address? (The network policy: the internet only when allowed.) */
export type Allowed = (url: string) => boolean;

function get(
  url: string,
  allowed: Allowed,
  hops = 3,
): Promise<{ type: string; body: Buffer; url: string } | null> {
  return new Promise((resolve) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      resolve(null);
      return;
    }
    // Checked on every hop, so a redirect can't lead somewhere the policy forbids.
    if ((u.protocol !== "http:" && u.protocol !== "https:") || !allowed(u.href)) {
      resolve(null);
      return;
    }
    const req = (u.protocol === "https:" ? httpsRequest : httpRequest)(
      u,
      {
        timeout: 6000,
        rejectUnauthorized: false,
        headers: { "user-agent": "Mozilla/5.0 (Hearth)", accept: "*/*" },
      },
      (res) => {
        const loc = res.headers.location;
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc && hops > 0) {
          res.resume();
          void get(new URL(loc, u).href, allowed, hops - 1).then(resolve);
          return;
        }
        if ((res.statusCode ?? 500) >= 400) {
          res.resume();
          resolve(null);
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX) res.destroy();
          else chunks.push(c);
        });
        res.on("end", () =>
          resolve({
            type: String(res.headers["content-type"] ?? ""),
            body: Buffer.concat(chunks),
            url: u.href,
          }),
        );
        res.on("error", () => resolve(null));
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
    req.end();
  });
}

/** The picture's real type from its first bytes; SVG only when it really is one. */
export function pictureType(buf: Buffer): string | null {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return ".png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ".jpg";
  if (buf.subarray(0, 4).toString("ascii") === "GIF8") return ".gif";
  if (
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return ".webp";
  if (buf.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))) return ".ico";
  const head = buf.subarray(0, 600).toString("utf8").trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head))
    return ".svg";
  return null;
}

/** Icon links a page declares, best first. */
export function iconLinks(html: string, base: string): string[] {
  const found: { href: string; score: number }[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase() ?? "";
    if (!/\bicon\b|apple-touch-icon/.test(rel)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href || href.startsWith("data:")) continue;
    const sizes = /\bsizes\s*=\s*["'](\d+)x\d+/i.exec(tag)?.[1];
    const svg = /\.svg(\?|$)/i.test(href) || /image\/svg/i.test(tag);
    let score = sizes ? Math.min(Number(sizes), 512) : 32;
    if (rel.includes("apple-touch-icon")) score = Math.max(score, 180);
    if (svg) score = 400;
    if (rel.includes("mask-icon")) score = 0; // Single-colour outlines meant for Safari tabs.
    try {
      found.push({ href: new URL(href, base).href, score });
    } catch {
      // A broken address.
    }
  }
  return found.sort((a, b) => b.score - a.score).map((f) => f.href);
}

/** Find, check and save a site's icon. Returns the file name in data/icons, or null. */
export async function fetchFavicon(
  siteUrl: string,
  iconsDir: string,
  allowed: Allowed,
): Promise<string | null> {
  const page = await get(siteUrl, allowed);
  const base = page?.url ?? siteUrl;
  const candidates = [
    ...(page && /html/i.test(page.type) ? iconLinks(page.body.toString("utf8"), base) : []),
    new URL("/favicon.ico", base).href,
  ];
  for (const c of candidates.slice(0, 6)) {
    const pic = await get(c, allowed);
    if (!pic || pic.body.length < 16) continue;
    const ext = pictureType(pic.body);
    if (!ext) continue;
    await mkdir(iconsDir, { recursive: true });
    const name = `site-${createHash("sha256").update(pic.body).digest("hex").slice(0, 16)}${ext}`;
    await writeFile(join(iconsDir, name), pic.body);
    return name;
  }
  return null;
}
