import { describe, expect, it } from "vitest";
import { display, ExprError, fillTemplate, parse, run } from "./expr";

const vars = {
  nas: {
    cpu: 12.345,
    temp: 48,
    disk: { used: 3.2e12, total: 8e12 },
    items: [
      { n: "a", v: 3 },
      { n: "b", v: 9 },
      { n: "c", v: 1 },
    ],
    up: "true",
  },
  list: [1, 2, 3, 4],
  name: "Hearth",
};
const ev = (src: string, extra: Record<string, unknown> = {}) =>
  run(src, { vars: { ...vars, ...extra }, locale: "en-US", now: () => Date.UTC(2026, 10, 10, 12) });

describe("formulas", () => {
  it("read values and do arithmetic with the usual precedence", () => {
    expect(ev("$nas.temp")).toBe(48);
    expect(ev("$nas.disk.used / $nas.disk.total * 100")).toBe(40);
    expect(ev("1 + 2 * 3 - 4 / 2")).toBe(5);
    expect(ev("(1 + 2) * 3")).toBe(9);
    expect(ev("-$nas.temp + 50")).toBe(2);
    expect(ev("$list[1]")).toBe(2);
    expect(ev("$list[-1]")).toBe(4);
    expect(ev("$nas.items[1].n")).toBe("b");
    expect(ev('$nas["temp"]')).toBe(48);
    expect(ev("$list.length")).toBe(4);
  });

  it("compare, combine and choose", () => {
    expect(ev("$nas.temp > 40 && $nas.temp <= 48")).toBe(true);
    expect(ev('$nas.temp > 50 ? "hot" : "fine"')).toBe("fine");
    expect(ev("$missing ?? 7")).toBe(7);
    expect(ev("$missing.deep.path")).toBeUndefined();
    expect(ev("$nas.up == true")).toBe(false);
    expect(ev('"5" == 5')).toBe(true);
    expect(ev('"a" + 1')).toBe("a1");
    expect(ev("1 / 0")).toBeNull();
  });

  it("have useful functions", () => {
    expect(ev("round($nas.cpu, 1)")).toBe(12.3);
    expect(ev("sum($list)")).toBe(10);
    expect(ev('avg($nas.items, "v")')).toBeCloseTo(13 / 3);
    expect(ev('max($nas.items, "v")')).toBeNull(); // max takes numbers or a list of numbers
    expect(ev('max(pluck($nas.items, "v"))')).toBe(9);
    expect(ev('pluck(sort($nas.items, "v", "desc"), "n")')).toEqual(["b", "a", "c"]);
    expect(ev('count(filter($nas.items, "v", ">", 2))')).toBe(2);
    expect(ev('find($nas.items, "n", "c").v')).toBe(1);
    expect(ev("bytes($nas.disk.used)")).toBe("2.9 TB");
    expect(ev("duration(3725)")).toBe("1h 2m");
    expect(ev("pct(1, 4)")).toBe(25);
    expect(ev("fmt(12345.678, 1)")).toBe("12,345.7");
    expect(ev("join(keys($nas.disk))")).toBe("used, total");
    expect(ev("upper($name)")).toBe("HEARTH");
    expect(ev('default("", "none")')).toBe("none");
    expect(ev("ago(now() - 300000)")).toBe("5 min. ago");
    expect(ev("[1, 2][0] + take($list, -2)[1]")).toBe(5);
  });

  it("refuse unknown functions and names with a clear message", () => {
    expect(() => parse("eval(1)")).toThrow(/no function called eval/);
    expect(() => parse("nas.cpu")).toThrow(/Values start with \$/);
    expect(() => parse("1 +")).toThrow(ExprError);
    expect(() => parse('"open')).toThrow(/closing quote/);
  });

  it("can't reach prototypes or constructors", () => {
    expect(ev("$nas.__proto__")).toBeUndefined();
    expect(ev("$nas.constructor")).toBeUndefined();
    expect(ev('$nas["constructor"]["prototype"]')).toBeUndefined();
    expect(ev("keys($nas)")).not.toContain("__proto__");
  });

  it("stop runaway work", () => {
    const big = Array.from({ length: 20_000 }, (_, i) => i);
    expect(ev("count($big)", { big })).toBe(10_000);
    expect(() => parse(`${"(".repeat(60)}1${")".repeat(60)}`)).toThrow(/nested too deeply/);
  });
});

describe("templates", () => {
  it("fill values in, and show a dash for anything that fails", () => {
    const ctx = { vars, locale: "en-US" };
    expect(fillTemplate("{{ round($nas.cpu) }}% busy, {{ $nas.temp }} °C", ctx)).toBe(
      "12% busy, 48 °C",
    );
    expect(fillTemplate("{{ nope( }}", ctx)).toBe("—");
    expect(display(1234.5678)).toBe("1,234.6");
    expect(display(null)).toBe("—");
    expect(display(true)).toBe("Yes");
  });
});

describe("functions for app widgets", () => {
  it("read JSON in text, flatten lists, show money and weather", () => {
    expect(ev("json($t).a", { t: '{"a": 2}' })).toBe(2);
    expect(ev("json($t)", { t: "nope" })).toBeNull();
    expect(ev("flat($l)", { l: [[1, 2], [3], 4] })).toEqual([1, 2, 3, 4]);
    expect(ev("money(1234.5)")).toBe("$1,234.50");
    expect(ev('money(5, "EUR")')).toBe("€5.00");
    expect(ev("wmo(0)")).toBe("☀️ Clear");
    expect(ev("wmoIcon(63)")).toBe("🌧️");
  });
});
