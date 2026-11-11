import { gzipSync } from "node:zlib";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { unpack } from "../discover";
import { scoreText } from "./vpin";
import { shrinkPng, WheelCache } from "./wheel";

describe("pinball scores", () => {
  it("reads the number, not VPin Studio's text", () => {
    expect(scoreText("5) DAD      431,740", 431740, "DAD")).toBe("431,740");
  });
  it("cleans the text when there's no number", () => {
    expect(scoreText("5) DAD      431,740", undefined, "DAD")).toBe("431,740");
    expect(scoreText("PML   4,000,000", 0, "PML")).toBe("4,000,000");
  });
});

describe("wheel art", () => {
  const png = (w: number, h: number) => {
    const p = new PNG({ width: w, height: h });
    p.data.fill(255);
    return PNG.sync.write(p);
  };
  it("shrinks a big PNG and keeps a small one", () => {
    const out = PNG.sync.read(shrinkPng(png(800, 400), 160));
    expect([out.width, out.height]).toEqual([160, 80]);
    const small = png(40, 40);
    expect(shrinkPng(small, 160)).toBe(small);
  });
  it("remembers a table with no wheel, but not one that didn't answer", async () => {
    const cache = new WheelCache();
    let calls = 0;
    await cache.get("a", async () => {
      calls++;
      return null;
    });
    await cache.get("a", async () => {
      calls++;
      return null;
    });
    expect(calls).toBe(1);
    await cache.get("b", async () => {
      calls++;
      throw new Error("off");
    });
    await cache.get("b", async () => {
      calls++;
      return null;
    });
    expect(calls).toBe(3);
  });
});

describe("probing pages", () => {
  it("unpacks a gzipped page, even one that wasn't asked for", () => {
    const page = gzipSync("<title>PrusaLink</title>");
    expect(unpack(page, "")).toContain("PrusaLink");
    expect(unpack(Buffer.from("plain"), "gzip")).toBe("plain");
  });
});
