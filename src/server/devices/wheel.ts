/**
 * A pinball table's wheel art (its round logo in the frontend), small enough for a widget. VPin
 * Studio keeps them as big PNGs (often over a megabyte), so Hearth shrinks each one once and keeps
 * it in memory.
 */
import { PNG } from "pngjs";

/** Shrink a PNG so its longer side is at most `max` pixels, keeping its transparency. */
export function shrinkPng(input: Buffer, max = 160): Buffer {
  const src = PNG.sync.read(input);
  const scale = Math.min(1, max / Math.max(src.width, src.height));
  if (scale === 1) return input;
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const out = new PNG({ width: w, height: h });
  const sx = src.width / w;
  const sy = src.height / h;
  // Average each box of source pixels, weighting colour by alpha so edges don't go dark.
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * src.width + xx) * 4;
          const al = src.data[i + 3] ?? 0;
          r += (src.data[i] ?? 0) * al;
          g += (src.data[i + 1] ?? 0) * al;
          b += (src.data[i + 2] ?? 0) * al;
          a += al;
          n++;
        }
      }
      const o = (y * w + x) * 4;
      out.data[o] = a ? Math.round(r / a) : 0;
      out.data[o + 1] = a ? Math.round(g / a) : 0;
      out.data[o + 2] = a ? Math.round(b / a) : 0;
      out.data[o + 3] = Math.round(a / n);
    }
  }
  return PNG.sync.write(out, { colorType: 6 });
}

/** Shrunk wheels, newest kept, by table address and game. */
export class WheelCache {
  private map = new Map<string, Buffer | null>();
  constructor(private readonly limit = 300) {}

  async get(key: string, load: () => Promise<Buffer | null>): Promise<Buffer | null> {
    if (this.map.has(key)) {
      const hit = this.map.get(key) ?? null;
      // Most recently used goes to the back.
      this.map.delete(key);
      this.map.set(key, hit);
      return hit;
    }
    // The table not answering isn't remembered (it may be off); "it has no wheel" is.
    let raw: Buffer | null;
    try {
      raw = await load();
    } catch {
      return null;
    }
    let png: Buffer | null = null;
    if (raw) {
      try {
        png = shrinkPng(raw);
      } catch {
        // Not a PNG: small enough as it is, or not shown.
        png = raw.length < 300_000 ? raw : null;
      }
    }
    this.map.set(key, png);
    while (this.map.size > this.limit) {
      const first = this.map.keys().next().value;
      if (first === undefined) break;
      this.map.delete(first);
    }
    return png;
  }
}
