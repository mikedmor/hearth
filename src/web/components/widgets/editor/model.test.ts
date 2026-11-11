import { describe, expect, it } from "vitest";
import { WidgetDocSchema } from "../../../../shared/widget-doc";
import { fieldPaths, freeId, fromDraft, issueBlock, newBlock, rootList, toDraft } from "./model";
import { BLOCK_SPECS } from "./spec";

describe("widget editor model", () => {
  it("gives each new block a free id", () => {
    expect(freeId("stat", [])).toBe("stat");
    expect(freeId("stat", ["stat", "stat2"])).toBe("stat3");
  });

  it("starts every kind of block as a valid widget", () => {
    const d = toDraft({ v: 1, sources: [{ id: "nas", kind: "hearth", what: "status" }] });
    for (const kind of Object.keys(BLOCK_SPECS) as (keyof typeof BLOCK_SPECS)[]) {
      const doc = fromDraft({ ...d, blocks: [newBlock(kind, d)] });
      const r = WidgetDocSchema.safeParse(doc);
      expect(r.success, `${kind}: ${r.error?.message}`).toBe(true);
    }
  });

  it("leaves empty lists out of the JSON", () => {
    expect(fromDraft(toDraft({ v: 1, blocks: [] }))).toEqual({ v: 1, blocks: [] });
  });

  it("lists a sample's fields, and a list's item fields", () => {
    const f = fieldPaths(
      { cpu: { load: 12 }, disks: [{ name: "a", "bad-key": 1 }], ok: true },
      "$nas",
    );
    expect(f.map((x) => x.path)).toEqual(["$nas.cpu.load", "$nas.disks", "$nas.ok"]);
    expect(f[1]?.list?.map((x) => x.path)).toEqual(["$item.name"]);
    expect(rootList([{ id: 1 }])?.map((x) => x.path)).toEqual(["$item.id"]);
    expect(rootList({})).toBeNull();
  });

  it("finds the block an issue belongs to", () => {
    expect(issueBlock("blocks.3.value")).toBe(3);
    expect(issueBlock("sources.0.url")).toBeNull();
  });
});
