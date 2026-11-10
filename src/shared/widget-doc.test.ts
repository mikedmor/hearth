import { describe, expect, it } from "vitest";
import { checkDoc, EXAMPLE_DOC } from "./widget-doc";
import { resolveDoc } from "./widget-eval";

describe("checkDoc", () => {
  it("accepts the example and fills in defaults", () => {
    const { doc, issues } = checkDoc(EXAMPLE_DOC);
    expect(issues).toEqual([]);
    expect(doc?.sources[0]).toMatchObject({ method: "GET", every: 30, headers: {} });
  });

  it("finds broken formulas and templates, with where they are", () => {
    const { doc, issues } = checkDoc({
      v: 1,
      sources: [{ id: "a", kind: "hearth", what: "status" }],
      blocks: [
        { id: "x", kind: "stat", value: "round($a.up" },
        { id: "y", kind: "text", text: "Hi {{ nosuch() }}" },
        {
          id: "z",
          kind: "table",
          rows: "$a.tiles",
          columns: [{ label: "Name", value: "$item.name +" }],
        },
      ],
    });
    expect(doc).toBeNull();
    expect(issues.map((i) => i.path)).toEqual([
      "blocks.0.value",
      "blocks.1.text",
      "blocks.2.columns.0.value",
    ]);
  });

  it("refuses duplicate ids and reserved names", () => {
    const { issues } = checkDoc({
      v: 1,
      sources: [
        { id: "item", kind: "hearth", what: "time" },
        { id: "a", kind: "hearth", what: "time" },
        { id: "a", kind: "hearth", what: "ai" },
      ],
      blocks: [{ id: "d", kind: "divider" }],
    });
    expect(issues.some((i) => i.message.includes("reserved"))).toBe(true);
    expect(issues.some((i) => i.message.includes('two sources are called "a"'))).toBe(true);
  });

  it("only allows websocket sources on ws:// addresses", () => {
    const { issues } = checkDoc({
      v: 1,
      sources: [{ id: "s", kind: "websocket", url: "http://x.home" }],
      blocks: [{ id: "d", kind: "divider" }],
    });
    expect(issues[0]?.message).toMatch(/ws:\/\//);
  });
});

describe("resolveDoc", () => {
  const { doc } = checkDoc({
    v: 1,
    sources: [{ id: "nas", kind: "http", url: "http://nas.home/stats" }],
    values: [{ id: "pct", expr: "pct($nas.used, $nas.total)" }],
    blocks: [
      {
        id: "s",
        kind: "stat",
        value: "$nas.temp",
        unit: "°C",
        spark: "$history.nas",
        tone: '$nas.temp > 60 ? "negative" : "positive"',
      },
      {
        id: "p",
        kind: "progress",
        value: "$pct",
        label: "Disk",
        detail: "{{ round($pct) }}%",
        warnAt: 70,
        badAt: 90,
      },
      {
        id: "l",
        kind: "lights",
        items: "$nas.disks",
        itemLabel: "$item.name",
        itemState: "$item.status",
      },
      {
        id: "t",
        kind: "list",
        items: "$nas.disks",
        itemTitle: "$item.name",
        itemValue: "$index + 1",
      },
      { id: "broken", kind: "stat", value: 'count(filter($nas.disks, "name", "~", 1))' },
      { id: "img", kind: "image", src: "http://cam.home/{{ $nas.cam }}.jpg" },
    ],
  });

  it("works every block out from the data", () => {
    const blocks = resolveDoc(doc as NonNullable<typeof doc>, {
      sources: {
        nas: {
          temp: 48,
          used: 75,
          total: 100,
          cam: "front",
          disks: [
            { name: "Disk 1", status: "healthy" },
            { name: "Disk 2", status: "failing" },
          ],
        },
      },
      history: { nas: [40, 44, 48] },
    });
    expect(blocks[0]).toMatchObject({
      kind: "stat",
      value: "48",
      unit: "°C",
      spark: [40, 44, 48],
      tone: "positive",
    });
    expect(blocks[1]).toMatchObject({
      kind: "progress",
      value: 75,
      max: 100,
      detail: "75%",
      tone: "warning",
    });
    expect(blocks[2]).toMatchObject({
      kind: "lights",
      items: [
        { label: "Disk 1", state: "up" },
        { label: "Disk 2", state: "down" },
      ],
    });
    expect(blocks[3]).toMatchObject({
      kind: "list",
      items: [
        { title: "Disk 1", value: "1" },
        { title: "Disk 2", value: "2" },
      ],
    });
    expect(blocks[4]).toMatchObject({ kind: "text", error: expect.stringContaining("operator") });
    expect(blocks[5]).toMatchObject({ kind: "image", src: "http://cam.home/front.jpg" });
  });

  it("shows dashes, not crashes, before any data arrives", () => {
    const blocks = resolveDoc(doc as NonNullable<typeof doc>, {
      sources: { nas: null },
      history: {},
    });
    expect(blocks[0]).toMatchObject({ value: "—" });
    expect(blocks[2]).toMatchObject({ items: [] });
    expect(blocks[5]).toMatchObject({ src: null });
  });
});
