/**
 * The inspector's inputs. Formula and template inputs remember being the last one focused, so a
 * click on a source's field or a function in the palette lands in them at the cursor.
 */
import { Plus, Trash2 } from "lucide-react";
import { createContext, type ReactNode, useContext, useId, useRef } from "react";
import { CARD_COLORS, CARD_MARKS } from "../../../../shared/cardkit/result";
import { cx } from "../../../lib/format";
import { IconButton, Input, Select, Toggle } from "../../ui";
import type { Rec } from "./model";
import type { FieldSpec } from "./spec";

interface Target {
  el: HTMLInputElement | HTMLTextAreaElement;
  template: boolean;
  set: (v: string) => void;
}

/** Where palette clicks go: the formula or template input focused last. */
export class Inserter {
  private target: Target | null = null;
  focus(t: Target) {
    this.target = t;
  }
  blurred(el: Target["el"]) {
    // Keep it while the click that blurred it is on the palette; forget it once it's gone.
    if (this.target?.el === el && !el.isConnected) this.target = null;
  }
  /** Put a reference (`$nas.cpu`) or a call (`round()`) in at the cursor. */
  insert(text: string, kind: "path" | "call" = "path"): boolean {
    const t = this.target;
    if (!t?.el.isConnected) return false;
    const el = t.el;
    const piece = t.template && kind === "path" ? `{{ ${text} }}` : text;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const next = el.value.slice(0, start) + piece + el.value.slice(end);
    t.set(next);
    // Leave the cursor inside a call's brackets, or after what went in.
    const at = start + (kind === "call" ? piece.length - 1 : piece.length);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(at, at);
    });
    return true;
  }
}

export const InserterContext = createContext<Inserter>(new Inserter());

const mono = "font-mono text-[13px]";

export function FormulaInput({
  value,
  onChange,
  template,
  placeholder,
  id,
  multiline,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  template?: boolean;
  placeholder?: string;
  id?: string;
  multiline?: boolean;
  "aria-label"?: string;
}) {
  const inserter = useContext(InserterContext);
  const latest = useRef(onChange);
  latest.current = onChange;
  const common = {
    id,
    value,
    placeholder,
    spellCheck: false,
    "aria-label": ariaLabel,
    onFocus: (e: { currentTarget: HTMLInputElement | HTMLTextAreaElement }) =>
      inserter.focus({
        el: e.currentTarget,
        template: Boolean(template),
        set: (v) => latest.current(v),
      }),
    onBlur: (e: { currentTarget: HTMLInputElement | HTMLTextAreaElement }) =>
      inserter.blurred(e.currentTarget),
  };
  if (multiline)
    return (
      <textarea
        {...common}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
        className={cx(
          "w-full resize-y rounded-xl border border-line bg-page px-3 py-2 focus:border-accent focus:outline-none",
          template ? "text-[14px]" : mono,
        )}
      />
    );
  return (
    <Input
      {...common}
      onChange={(e) => onChange(e.target.value)}
      className={cx("h-9", template ? "text-[14px]" : mono)}
    />
  );
}

function Labelled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-[12.5px] font-semibold text-ink">
        {label}
      </label>
      {children(id)}
      {hint ? <p className="text-[11.5px] text-muted">{hint}</p> : null}
    </div>
  );
}

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

/** One property of a block. Empty optional values are left out of the JSON. */
export function FieldEditor({
  spec,
  value,
  onChange,
}: {
  spec: FieldSpec;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const setText = (v: string) => onChange(v === "" ? undefined : v);
  switch (spec.type) {
    case "formula":
    case "template":
      return (
        <Labelled label={spec.label} hint={spec.hint}>
          {(id) => (
            <FormulaInput
              id={id}
              value={str(value)}
              onChange={setText}
              template={spec.type === "template"}
              multiline={spec.type === "template" && spec.key === "text"}
              placeholder={spec.type === "template" ? "Words, and {{ formulas }}" : "A formula"}
            />
          )}
        </Labelled>
      );
    case "text":
      return (
        <Labelled label={spec.label} hint={spec.hint}>
          {(id) => (
            <Input
              id={id}
              className="h-9 text-[14px]"
              value={str(value)}
              onChange={(e) => setText(e.target.value)}
            />
          )}
        </Labelled>
      );
    case "number":
      return (
        <Labelled label={spec.label} hint={spec.hint}>
          {(id) => (
            <Input
              id={id}
              type="number"
              className="h-9 text-[14px]"
              value={str(value)}
              onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
            />
          )}
        </Labelled>
      );
    case "numOrFormula":
      return (
        <Labelled label={spec.label} hint="A number, or a formula">
          {(id) => (
            <FormulaInput
              id={id}
              value={str(value)}
              onChange={(v) => {
                const n = Number(v);
                onChange(v.trim() === "" ? undefined : Number.isFinite(n) ? n : v);
              }}
            />
          )}
        </Labelled>
      );
    case "bool":
      return <Toggle checked={value === true} onChange={(v) => onChange(v)} label={spec.label} />;
    case "select":
      return (
        <Labelled label={spec.label}>
          {(id) => (
            <Select
              id={id}
              className="h-9 text-[14px]"
              value={str(value)}
              onChange={(e) => setText(e.target.value)}
            >
              <option value="">Usual</option>
              {spec.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Labelled>
      );
    case "series":
      return (
        <RowList
          label={spec.label}
          hint={spec.hint ?? "Each a number from $item"}
          rows={(value as Rec[]) ?? []}
          onChange={onChange}
          blank={{ label: "Value", value: "$item.value" }}
          max={8}
          render={(r, set) => (
            <>
              <div className="grid grid-cols-[1fr_1.4fr] gap-1.5">
                <Input
                  aria-label="Name"
                  className="h-8 text-[13px]"
                  value={str(r.label)}
                  onChange={(e) => set({ label: e.target.value })}
                />
                <FormulaInput
                  aria-label="Number"
                  value={str(r.value)}
                  onChange={(v) => set({ value: v })}
                />
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <MiniSelect
                  label="Color"
                  value={r.color}
                  options={CARD_COLORS.filter((c) => c !== "auto")}
                  onChange={(v) => set({ color: v })}
                />
                <MiniSelect
                  label="Drawn as"
                  value={r.mark}
                  options={CARD_MARKS.filter((c) => c !== "auto")}
                  onChange={(v) => set({ mark: v })}
                />
                <MiniSelect
                  label="Reads as"
                  value={r.format}
                  options={["number", "money", "percent"]}
                  onChange={(v) => set({ format: v })}
                />
              </div>
            </>
          )}
        />
      );
    case "columns":
      return (
        <RowList
          label={spec.label}
          hint="Each a formula over $item"
          rows={(value as Rec[]) ?? []}
          onChange={onChange}
          blank={{ label: "Column", value: "$item.name", align: "left" }}
          max={8}
          render={(r, set) => (
            <div className="grid grid-cols-[1fr_1.4fr_auto] gap-1.5">
              <Input
                aria-label="Heading"
                className="h-8 text-[13px]"
                value={str(r.label)}
                onChange={(e) => set({ label: e.target.value })}
              />
              <FormulaInput
                aria-label="Value"
                value={str(r.value)}
                onChange={(v) => set({ value: v })}
              />
              <Select
                aria-label="Align"
                className="h-8 w-auto text-[12.5px]"
                value={str(r.align) || "left"}
                onChange={(e) => set({ align: e.target.value })}
              >
                <option value="left">Left</option>
                <option value="right">Right</option>
              </Select>
            </div>
          )}
        />
      );
    case "pairs":
      return (
        <RowList
          label={spec.label}
          hint="Values are words with {{ formulas }}"
          rows={(value as Rec[]) ?? []}
          onChange={onChange}
          blank={{ label: "Label", value: "{{ 0 }}" }}
          max={12}
          render={(r, set) => (
            <div className="grid grid-cols-[1fr_1.4fr] gap-1.5">
              <Input
                aria-label="Label"
                className="h-8 text-[13px]"
                value={str(r.label)}
                onChange={(e) => set({ label: e.target.value })}
              />
              <FormulaInput
                aria-label="Value"
                template
                value={str(r.value)}
                onChange={(v) => set({ value: v })}
              />
            </div>
          )}
        />
      );
  }
}

function MiniSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: unknown;
  options: readonly string[];
  onChange: (v: string | undefined) => void;
}) {
  return (
    <Select
      aria-label={label}
      title={label}
      className="h-8 px-2 text-[12px]"
      value={str(value)}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o.replace(/^series/, "Color ")}
        </option>
      ))}
    </Select>
  );
}

function RowList({
  label,
  hint,
  rows,
  onChange,
  blank,
  max,
  render,
}: {
  label: string;
  hint?: string;
  rows: Rec[];
  onChange: (v: Rec[]) => void;
  blank: Rec;
  max: number;
  render: (row: Rec, set: (patch: Rec) => void) => ReactNode;
}) {
  const clean = (r: Rec) =>
    Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined && v !== ""));
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-semibold">{label}</span>
        <button
          type="button"
          disabled={rows.length >= max}
          onClick={() => onChange([...rows, blank])}
          className="flex items-center gap-1 text-[12.5px] font-semibold text-accent disabled:opacity-40"
        >
          <Plus className="size-3.5" /> Add
        </button>
      </div>
      {hint ? <p className="-mt-1 text-[11.5px] text-muted">{hint}</p> : null}
      {rows.map((r, i) => (
        <div key={i} className="flex items-start gap-1 rounded-xl bg-(--c-surface-2) p-1.5">
          <div className="grid grow gap-1.5">
            {render(r, (patch) =>
              onChange(rows.map((x, j) => (j === i ? clean({ ...x, ...patch }) : x))),
            )}
          </div>
          <IconButton
            label="Remove"
            className="size-8"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            <Trash2 className="size-3.5" />
          </IconButton>
        </div>
      ))}
    </div>
  );
}
