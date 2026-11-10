import { describe, expect, it } from "vitest";
import { APPS, GENERAL_TEMPLATES } from "../shared/catalog";
import { appFor, iconColor, resolveIcon, searchIcons, suggestIcons } from "./icons";

describe("icons", () => {
  it("resolves logos, symbols, emoji, pictures and nothing", () => {
    const plex = resolveIcon("si:plex");
    expect(plex.iconKind).toBe("svg");
    expect(plex.svg?.kind).toBe("brand");
    expect(resolveIcon("lucide:house").svg?.kind).toBe("symbol");
    expect(resolveIcon("🎬")).toEqual({ iconKind: "emoji", icon: "🎬" });
    expect(resolveIcon("plex.png")).toEqual({ iconKind: "image", icon: "/icons/plex.png" });
    expect(resolveIcon("si:no-such-logo")).toEqual({ iconKind: "monogram" });
    expect(resolveIcon("")).toEqual({ iconKind: "monogram" });
    expect(resolveIcon("../secret.png").iconKind).not.toBe("image");
  });

  it("has every icon the catalog names (library updates rename things)", () => {
    const missing = [...APPS, ...GENERAL_TEMPLATES]
      .filter((a) => resolveIcon(a.icon).iconKind === "monogram")
      .map((a) => `${a.id}: ${a.icon}`);
    expect(missing).toEqual([]);
  });

  it("knows a logo's colour", () => {
    expect(iconColor("si:plex")).toMatch(/^#[0-9A-F]{6}$/i);
    expect(iconColor("lucide:house")).toBeUndefined();
    // Black and white logos would vanish on one theme or the other.
    expect(iconColor("si:ollama")).toBeUndefined();
    expect(iconColor("si:github")).toBeUndefined();
  });

  it("searches the library, best match first, by kind", () => {
    expect(searchIcons("jellyfin")[0]?.ref).toBe("si:jellyfin");
    const symbols = searchIcons("house", "symbol");
    expect(symbols.length).toBeGreaterThan(0);
    expect(symbols.every((r) => r.ref.startsWith("lucide:"))).toBe(true);
    expect(searchIcons("pizza", "emoji").some((r) => r.ref === "🍕")).toBe(true);
    expect(searchIcons("a", "all", 5).length).toBeLessThanOrEqual(5);
  });

  it("recognises an app by name, host or a port only it uses", () => {
    expect(appFor("Sonarr")?.id).toBe("sonarr");
    expect(appFor("TV", "http://sonarr.home")?.id).toBe("sonarr");
    expect(appFor("TV", "http://192.168.1.5:8989")?.id).toBe("sonarr");
    expect(appFor("Something", "http://192.168.1.5:8080")).toBeUndefined();
  });

  it("suggests the app's logo first", () => {
    expect(suggestIcons("Movies", "http://192.168.1.5:7878")[0]?.ref).toBe("si:radarr");
  });
});
