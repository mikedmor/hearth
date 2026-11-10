import type { HearthConfig } from "../shared/config";
import { validateConfig } from "./config-store";

/** A small valid config; pass overrides to bend it for a test. */
export function fixtureInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 3,
    settings: {
      title: "Hearth",
      guest: { layout: { widgets: [{ id: "note", w: 8 }] } },
      ai: {
        servers: [
          {
            id: "home-ai",
            name: "Home AI",
            kind: "ollama",
            url: "http://192.168.1.20:11434",
            model: "llama3.1",
          },
        ],
        chatRoles: ["admin", "adult"],
      },
    },
    groups: [
      { id: "everyday", name: "Everyday" },
      { id: "admin", name: "Admin", audience: "admin" },
    ],
    tiles: [
      { id: "muny", name: "Muny", url: "https://muny.home", group: "everyday", audience: "adults" },
      {
        id: "gg",
        name: "Gaseous Games",
        url: "https://gg.home",
        group: "everyday",
        keywords: ["roms"],
      },
      { id: "nas", name: "NAS", url: "https://nas.home", group: "admin" },
      {
        id: "printer",
        name: "Printer",
        url: "http://192.168.1.50",
        group: "everyday",
        check: false,
        short: false,
      },
    ],
    widgets: [
      { id: "health", type: "status" },
      { id: "note", type: "note", options: { text: "Hello" } },
      { id: "secret", type: "note", audience: "admin", options: { text: "admin only" } },
      {
        id: "lights",
        type: "custom",
        doc: {
          v: 1,
          sources: [{ id: "home", kind: "hearth", what: "status" }],
          blocks: [{ id: "n", kind: "stat", value: "$home.up", label: "Up" }],
        },
      },
    ],
    profiles: [
      {
        id: "alex",
        name: "Alex",
        role: "admin",
        layout: {
          widgets: [
            { id: "health", w: 4 },
            { id: "secret", w: 4 },
          ],
        },
        favorites: ["nas"],
      },
      {
        id: "kid",
        name: "Kid",
        role: "child",
        locked: true,
        layout: {
          widgets: [
            { id: "note", w: 6 },
            { id: "secret", w: 6 },
          ],
        },
        hiddenTiles: ["gg"],
      },
      { id: "sam", name: "Sam", role: "adult" },
    ],
    ...overrides,
  };
}

export function fixture(overrides: Record<string, unknown> = {}): HearthConfig {
  return validateConfig(fixtureInput(overrides));
}
