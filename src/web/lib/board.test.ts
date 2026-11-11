import { describe, expect, it } from "vitest";
import { boardRuns, linkTo, placeAt, runOf, unlink } from "./board";

const k = (...keys: string[]) => keys.map((key) => ({ key }));
const keysOf = (runs: { key: string }[][]) => runs.map((r) => r.map((i) => i.key));

describe("linked runs", () => {
  it("cuts the board into runs", () => {
    expect(keysOf(boardRuns(k("g:a", "w:cam1", "w:cam2", "g:b"), ["w:cam1", "w:cam2"]))).toEqual([
      ["g:a", "w:cam1", "w:cam2"],
      ["g:b"],
    ]);
    // A link on the very first item has nothing to hold on to.
    expect(keysOf(boardRuns(k("w:x", "g:a"), ["w:x"]))).toEqual([["w:x"], ["g:a"]]);
  });

  it("puts an item before or after another, wherever it comes from", () => {
    const order = ["g:a", "g:b", "g:c"];
    expect(placeAt(order, [], ["g:c"], "g:b", "before").order).toEqual(["g:a", "g:c", "g:b"]);
    expect(placeAt(order, [], ["g:a"], "g:b", "before").order).toEqual(["g:a", "g:b", "g:c"]);
    expect(placeAt(order, [], ["g:a"], "g:c", "before").order).toEqual(["g:b", "g:a", "g:c"]);
    expect(placeAt(order, [], ["g:c"], "g:a", "after").order).toEqual(["g:a", "g:c", "g:b"]);
  });

  it("reorders inside a run, and keeps it whole", () => {
    // The cameras: side view, then top view; top view goes above side view.
    const order = ["w:prusa", "w:side", "w:top", "g:x"];
    const joined = ["w:side", "w:top"];
    const r = placeAt(order, joined, ["w:top"], "w:side", "before");
    expect(r.order).toEqual(["w:prusa", "w:top", "w:side", "g:x"]);
    expect(keysOf(boardRuns(k(...r.order), r.joined))).toEqual([
      ["w:prusa", "w:top", "w:side"],
      ["g:x"],
    ]);
  });

  it("dropping on an item groups them; between two linked ones joins their run", () => {
    const r = placeAt(["g:net", "w:svc", "w:ai"], [], ["w:ai"], "g:net", "join");
    expect(keysOf(boardRuns(k(...r.order), r.joined))).toEqual([["g:net", "w:ai"], ["w:svc"]]);
    const s = placeAt(["g:a", "w:1", "g:b"], ["w:1"], ["g:b"], "g:a", "after");
    expect(keysOf(boardRuns(k(...s.order), s.joined))).toEqual([["g:a", "g:b", "w:1"]]);
  });

  it("before a run or after its end stays outside it", () => {
    const order = ["g:a", "w:1", "g:b", "g:c"];
    const joined = ["w:1"];
    const before = placeAt(order, joined, ["g:c"], "g:a", "before");
    expect(keysOf(boardRuns(k(...before.order), before.joined))).toEqual([
      ["g:c"],
      ["g:a", "w:1"],
      ["g:b"],
    ]);
    const after = placeAt(order, joined, ["g:c"], "w:1", "after");
    expect(keysOf(boardRuns(k(...after.order), after.joined))).toEqual([
      ["g:a", "w:1"],
      ["g:c"],
      ["g:b"],
    ]);
  });

  it("moves a whole run, and what it leaves keeps its own links", () => {
    const order = ["g:a", "w:1", "w:2", "g:b", "w:3"];
    const joined = ["w:1", "w:2", "w:3"];
    const run = runOf(order, joined, "w:1");
    expect(run).toEqual(["g:a", "w:1", "w:2"]);
    const r = placeAt(order, joined, run, "w:3", "after");
    expect(keysOf(boardRuns(k(...r.order), r.joined))).toEqual([
      ["g:b", "w:3"],
      ["g:a", "w:1", "w:2"],
    ]);
    // Taking the head out of a run leaves the others linked to each other.
    const h = placeAt(order, joined, ["g:a"], "w:3", "after");
    expect(keysOf(boardRuns(k(...h.order), h.joined))).toEqual([
      ["w:1", "w:2"],
      ["g:b", "w:3"],
      ["g:a"],
    ]);
  });

  it("links an item to the end of another's run", () => {
    const r = linkTo(["w:cam", "g:a", "w:prusa", "g:b"], ["w:prusa"], "w:cam", "g:a");
    expect(r.order).toEqual(["g:a", "w:prusa", "w:cam", "g:b"]);
    expect(new Set(r.joined)).toEqual(new Set(["w:prusa", "w:cam"]));
  });

  it("taking the start of a run away leaves the rest together", () => {
    const r = linkTo(["g:a", "w:1", "w:2", "g:b"], ["w:1", "w:2"], "g:a", "g:b");
    expect(r.order).toEqual(["w:1", "w:2", "g:b", "g:a"]);
    expect(keysOf(boardRuns(k(...r.order), r.joined))).toEqual([
      ["w:1", "w:2"],
      ["g:b", "g:a"],
    ]);
  });

  it("unlinking splits the run there", () => {
    const joined = unlink(["w:1", "w:2"], "w:2");
    expect(keysOf(boardRuns(k("g:a", "w:1", "w:2"), joined))).toEqual([["g:a", "w:1"], ["w:2"]]);
  });
});
