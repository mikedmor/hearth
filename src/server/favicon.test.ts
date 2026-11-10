import { describe, expect, it } from "vitest";
import { iconLinks, pictureType } from "./favicon";

describe("favicons", () => {
  it("ranks a page's icons: SVG, then big, Safari's mask last", () => {
    const html = `
      <link rel="icon" href="/favicon-16.png" sizes="16x16">
      <link rel="apple-touch-icon" href="/apple.png">
      <link rel="mask-icon" href="/mask.svg">
      <link rel="icon" type="image/svg+xml" href="/logo.svg">
      <link rel="icon" href="data:image/png;base64,AAAA">
      <link rel="stylesheet" href="/a.css">`;
    const links = iconLinks(html, "http://app.home/sub/");
    expect(links.slice(0, 3)).toEqual([
      "http://app.home/logo.svg",
      "http://app.home/apple.png",
      "http://app.home/favicon-16.png",
    ]);
    expect(links).not.toContain("http://app.home/a.css");
    expect(links.some((l) => l.startsWith("data:"))).toBe(false);
  });

  it("tells a picture's type by its bytes, not its name", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
    expect(pictureType(png)).toBe(".png");
    expect(pictureType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(".jpg");
    expect(pictureType(Buffer.from([0, 0, 1, 0, 1]))).toBe(".ico");
    expect(pictureType(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="x"></svg>'))).toBe(".svg");
    expect(pictureType(Buffer.from("<html><svg></svg></html>"))).toBeNull();
    expect(pictureType(Buffer.from("not a picture"))).toBeNull();
  });
});
