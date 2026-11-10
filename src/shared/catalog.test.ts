import { describe, expect, it } from "vitest";
import { APPS, CATEGORIES, fillTemplate, findApp, GENERAL_TEMPLATES } from "./catalog";
import { checkDoc } from "./widget-doc";

const defaults = (params: { key: string; default?: string }[] = []) =>
  Object.fromEntries(
    params.map((p) => [
      p.key,
      // Address params start as "https://" in the form; the person finishes them.
      /^(feed|snapshot)$/.test(p.key) ? "http://news.home/feed" : (p.default ?? "x"),
    ]),
  );

describe("the app catalog", () => {
  it("has unique ids, known categories and patterns that compile", () => {
    const ids = APPS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of APPS) {
      expect(CATEGORIES).toContain(a.category);
      for (const re of [a.match.title, a.match.body, a.match.header].filter(Boolean))
        expect(() => new RegExp(re as string, "i"), `${a.id}: ${re}`).not.toThrow();
      expect(a.ports.every((p) => p > 0 && p < 65536)).toBe(true);
    }
  });

  it("fills every app widget into a valid widget document", () => {
    for (const a of APPS)
      for (const w of a.widgets ?? []) {
        const doc = fillTemplate(w.doc, {
          base: "http://192.168.1.20:8080/",
          secretName: w.secret ? "widget:test" : undefined,
          params: defaults(w.params),
        });
        const { issues } = checkDoc(doc);
        expect(issues, `${a.id}/${w.id}`).toEqual([]);
        expect(JSON.stringify(doc)).not.toMatch(/\{\{(base|param:|secret:key)/);
      }
  });

  it("fills every general template into a valid widget document", () => {
    for (const t of GENERAL_TEMPLATES) {
      const { issues } = checkDoc(fillTemplate(t.doc, { params: defaults(t.params) }));
      expect(issues, t.id).toEqual([]);
    }
  });

  it("fills placeholders safely", () => {
    const doc = fillTemplate(
      {
        v: 1,
        sources: [
          {
            id: "s",
            kind: "http",
            url: "{{base}}/api?x={{param:q}}",
            headers: { A: "{{secret:key}}" },
          },
        ],
        blocks: [{ id: "t", kind: "text", text: "{{param:q}}" }],
      },
      { base: "http://a.home/", secretName: "widget:w1", params: { q: 'say "hi"' } },
    );
    const src = doc.sources?.[0] as { url: string; headers: Record<string, string> };
    expect(src.url).toBe('http://a.home/api?x=say "hi"');
    expect(src.headers.A).toBe("{{secret:widget:w1}}");
  });

  it("finds apps by id, including extra ones", () => {
    expect(findApp("sonarr")?.name).toBe("Sonarr");
    expect(findApp("nope")).toBeUndefined();
    expect(findApp("mine", [{ ...(APPS[0] as (typeof APPS)[0]), id: "mine" }])?.id).toBe("mine");
  });
});
