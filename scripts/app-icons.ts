/**
 * The app's icons for installing on a phone, drawn from the logo (src/web/public/favicon.svg):
 * icon-192.png and icon-512.png (the rounded square, as on the page) and icon-maskable-512.png
 * (the flame on a full square, inside the circle Android may cut it to). Run after changing the
 * logo: `npx tsx scripts/app-icons.ts`. Needs nothing but pngjs: the logo is a rounded square
 * and two paths, filled here with smooth edges.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

const dir = join(import.meta.dirname, "..", "src", "web", "public");
const svg = readFileSync(join(dir, "favicon.svg"), "utf8");

type Pt = [number, number];
type Rgb = [number, number, number];
const hex = (h: string): Rgb => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as Rgb;

/** SVG path data (M L H V C S Z, upper and lower case) as closed polygons. */
export function polygons(d: string): Pt[][] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+\.?)(?:e-?\d+)?/g) ?? [];
  const out: Pt[][] = [];
  let poly: Pt[] = [];
  let cur: Pt = [0, 0];
  let start: Pt = [0, 0];
  let ctrl: Pt | null = null;
  let cmd = "";
  let i = 0;
  const n = () => Number(tokens[i++]);
  const curve = (p1: Pt, p2: Pt, p: Pt) => {
    for (let t = 1; t <= 24; t++) {
      const s = t / 24;
      const u = 1 - s;
      poly.push([
        u * u * u * cur[0] + 3 * u * u * s * p1[0] + 3 * u * s * s * p2[0] + s * s * s * p[0],
        u * u * u * cur[1] + 3 * u * u * s * p1[1] + 3 * u * s * s * p2[1] + s * s * s * p[1],
      ]);
    }
    ctrl = p2;
    cur = p;
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i] ?? "")) cmd = tokens[i++] as string;
    const rel = cmd === cmd.toLowerCase();
    const at = (x: number, y: number): Pt => (rel ? [cur[0] + x, cur[1] + y] : [x, y]);
    switch (cmd.toUpperCase()) {
      case "M": {
        if (poly.length) out.push(poly);
        cur = at(n(), n());
        start = cur;
        poly = [cur];
        ctrl = null;
        cmd = rel ? "l" : "L";
        break;
      }
      case "L":
        cur = at(n(), n());
        poly.push(cur);
        ctrl = null;
        break;
      case "H":
        cur = [rel ? cur[0] + n() : n(), cur[1]];
        poly.push(cur);
        ctrl = null;
        break;
      case "V":
        cur = [cur[0], rel ? cur[1] + n() : n()];
        poly.push(cur);
        ctrl = null;
        break;
      case "C": {
        const p1 = at(n(), n());
        const p2 = at(n(), n());
        curve(p1, p2, at(n(), n()));
        break;
      }
      case "S": {
        const c = ctrl as Pt | null;
        const p1: Pt = c ? [2 * cur[0] - c[0], 2 * cur[1] - c[1]] : cur;
        const p2 = at(n(), n());
        curve(p1, p2, at(n(), n()));
        break;
      }
      case "Z":
        if (poly.length) out.push(poly);
        poly = [];
        cur = start;
        ctrl = null;
        break;
      default:
        throw new Error(`Path command ${cmd} isn't supported here.`);
    }
  }
  if (poly.length) out.push(poly);
  return out;
}

/** A rounded rectangle as a polygon. */
function roundRect(x: number, y: number, w: number, h: number, r: number): Pt[] {
  const pts: Pt[] = [];
  const corners: [number, number, number][] = [
    [x + w - r, y + r, -90],
    [x + w - r, y + h - r, 0],
    [x + r, y + h - r, 90],
    [x + r, y + r, 180],
  ];
  for (const [cx, cy, a0] of corners)
    for (let k = 0; k <= 12; k++) {
      const a = ((a0 + (90 * k) / 12) * Math.PI) / 180;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  return pts;
}

/** How much of each pixel the shape covers (non-zero winding), 0–1. */
function coverage(polys: Pt[][], size: number): Float32Array {
  const cov = new Float32Array(size * size);
  const SUB = 8;
  const edges = polys.flatMap((p) =>
    p.map((a, k) => [a, p[(k + 1) % p.length] as Pt] as const).filter(([a, b]) => a[1] !== b[1]),
  );
  for (let row = 0; row < size; row++)
    for (let s = 0; s < SUB; s++) {
      const y = row + (s + 0.5) / SUB;
      const xs: [number, number][] = [];
      for (const [a, b] of edges) {
        const [lo, hi] = a[1] < b[1] ? [a, b] : [b, a];
        if (y < lo[1] || y >= hi[1]) continue;
        xs.push([a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), a[1] < b[1] ? 1 : -1]);
      }
      xs.sort((p, q) => p[0] - q[0]);
      let wind = 0;
      for (let k = 0; k < xs.length - 1; k++) {
        wind += (xs[k] as [number, number])[1];
        if (!wind) continue;
        const x0 = Math.max(0, (xs[k] as [number, number])[0]);
        const x1 = Math.min(size, (xs[k + 1] as [number, number])[0]);
        for (let px = Math.floor(x0); px < Math.ceil(x1); px++) {
          const c = Math.min(px + 1, x1) - Math.max(px, x0);
          if (c > 0) (cov[row * size + px] as number) += c / SUB;
        }
      }
    }
  return cov;
}

const scale = (polys: Pt[][], k: number, around: Pt, to: Pt): Pt[][] =>
  polys.map((p) => p.map(([x, y]) => [to[0] + (x - around[0]) * k, to[1] + (y - around[1]) * k]));

/** The small white flame Android shows in the status bar (only its shape counts). */
function badge(size: number): Buffer {
  const png = new PNG({ width: size, height: size });
  const flame = /<path[^>]*?fill="url\([^"]+\)"[^>]*?d="([^"]+)"/.exec(svg)?.[1] ?? "";
  const cov = coverage(
    scale(polygons(flame), (size / 32) * 1.05, [16, 15.5], [size / 2, size / 2]),
    size,
  );
  for (let k = 0; k < size * size; k++) {
    png.data[k * 4] = 255;
    png.data[k * 4 + 1] = 255;
    png.data[k * 4 + 2] = 255;
    png.data[k * 4 + 3] = Math.round(Math.min(1, cov[k] as number) * 255);
  }
  return PNG.sync.write(png);
}

function draw(size: number, maskable: boolean): Buffer {
  const png = new PNG({ width: size, height: size });
  const px = new Float32Array(size * size * 4);
  const paint = (polys: Pt[][], color: (y: number) => Rgb) => {
    const cov = coverage(polys, size);
    for (let k = 0; k < size * size; k++) {
      const a = Math.min(1, cov[k] as number);
      if (!a) continue;
      const c = color(Math.floor(k / size));
      for (let ch = 0; ch < 3; ch++)
        px[k * 4 + ch] = (px[k * 4 + ch] as number) * (1 - a) + (c[ch] as number) * a;
      px[k * 4 + 3] = (px[k * 4 + 3] as number) * (1 - a) + 255 * a;
    }
  };
  const u = size / 32;
  const bg = hex(/<rect[^>]*fill="(#[0-9a-f]{6})"/i.exec(svg)?.[1] ?? "#1b1512");
  const [stop0, stop1] = [...svg.matchAll(/stop-color="(#[0-9a-f]{6})"/gi)].map((m) =>
    hex(m[1] as string),
  );
  const paths = [...svg.matchAll(/<path[^>]*?fill="([^"]+)"[^>]*?d="([^"]+)"/g)].map((m) => ({
    fill: m[1] as string,
    d: m[2] as string,
  }));
  // A full square for the maskable icon; the logo's own rounded square otherwise.
  paint([maskable ? roundRect(0, 0, size, size, 0) : roundRect(0, 0, size, size, 8 * u)], () => bg);
  // The maskable flame sits well inside the circle a launcher may cut the icon to.
  const k = maskable ? u * 0.72 : u;
  for (const p of paths) {
    const polys = scale(polygons(p.d), k, [16, 16], [size / 2, size / 2]);
    if (p.fill.startsWith("url(")) {
      // The gradient runs top to bottom over the shape's own height.
      const ys = polys.flat().map((q) => q[1]);
      const top = Math.min(...ys);
      const h = Math.max(...ys) - top || 1;
      paint(polys, (y) => {
        const t = Math.min(1, Math.max(0, (y + 0.5 - top) / h));
        return [0, 1, 2].map((ch) => (stop0?.[ch] ?? 0) * (1 - t) + (stop1?.[ch] ?? 0) * t) as Rgb;
      });
    } else paint(polys, () => hex(p.fill));
  }
  for (let k2 = 0; k2 < px.length; k2++) png.data[k2] = Math.round(px[k2] as number);
  return PNG.sync.write(png);
}

if (process.argv[1]?.endsWith("app-icons.ts")) {
  for (const [name, size, maskable] of [
    ["icon-192.png", 192, false],
    ["icon-512.png", 512, false],
    ["icon-maskable-512.png", 512, true],
  ] as const) {
    writeFileSync(join(dir, name), draw(size, maskable));
    console.log(`wrote src/web/public/${name}`);
  }
  writeFileSync(join(dir, "badge-96.png"), badge(96));
  console.log("wrote src/web/public/badge-96.png");
}
