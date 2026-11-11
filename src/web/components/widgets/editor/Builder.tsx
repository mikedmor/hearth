/**
 * Build a widget by hand, like Muny's "Create a card": blocks on the left (click or drag them on),
 * the live card in the middle (click a block to pick it, drag to reorder), and the picked block's
 * settings on the right. Sources and their fields sit on the left too; a click on a field puts it
 * in the formula box you were last in. Everything edits the same JSON the other tabs do.
 */
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Blocks as BlocksIcon,
  ChevronDown,
  Copy,
  Database,
  FunctionSquare,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
  Variable,
} from "lucide-react";
import { useContext, useMemo, useState } from "react";
import type { PreviewResult } from "../../../../shared/api";
import { FUNCTIONS } from "../../../../shared/expr";
import { type BlockKind, type ResolvedBlock, TONES } from "../../../../shared/widget-doc";
import { api } from "../../../lib/api";
import { cx } from "../../../lib/format";
import { Button, IconButton, Input, Segmented, Select, TextArea, useToast } from "../../ui";
import { BlockView } from "../Blocks";
import { FieldEditor, FormulaInput, Inserter, InserterContext } from "./fields";
import {
  type Draft,
  type FieldPath,
  fieldPaths,
  freeId,
  fromDraft,
  issueBlock,
  newBlock,
  type Rec,
  rootList,
  toDraft,
} from "./model";
import { BLOCK_SPECS, GROUPS, WIDTHS } from "./spec";

const NEW = "new:";
const ID_RE = /^[a-z][a-z0-9_]{0,29}$/;
const BLOCK_ID_RE = /^[a-z0-9_-]{1,30}$/;

/** Point every `$old` reference at `$new` (a renamed source or value). */
function renameRefs(d: Draft, from: string, to: string): Draft {
  if (!from || !ID_RE.test(to)) return d;
  const re = new RegExp(`\\$${from}(?![A-Za-z0-9_])`, "g");
  return JSON.parse(JSON.stringify(d).replace(re, `$$${to}`)) as Draft;
}

export function Builder({
  doc,
  onDoc,
  preview,
  previewing,
  onRerun,
  title,
}: {
  doc: unknown;
  onDoc: (doc: unknown) => void;
  preview: PreviewResult | null;
  previewing: boolean;
  onRerun: () => void;
  title: string;
}) {
  const draft = useMemo(() => toDraft(doc), [doc]);
  const set = (d: Draft) => onDoc(fromDraft(d));
  const [selected, setSelected] = useState<string | null>(null);
  const [left, setLeft] = useState<"blocks" | "data" | "formulas">("blocks");
  const [right, setRight] = useState<"block" | "values">("block");
  const [dragging, setDragging] = useState<BlockKind | null>(null);
  const inserter = useMemo(() => new Inserter(), []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = draft.blocks.map((b) => String(b.id));
  const selIndex = selected ? ids.indexOf(selected) : -1;

  const add = (kind: BlockKind, at = selIndex >= 0 ? selIndex + 1 : draft.blocks.length) => {
    const b = newBlock(kind, draft);
    const blocks = [...draft.blocks];
    blocks.splice(at, 0, b);
    set({ ...draft, blocks });
    setSelected(String(b.id));
    setRight("block");
  };

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    setDragging(id.startsWith(NEW) ? (id.slice(NEW.length) as BlockKind) : null);
  };
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const id = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    if (id.startsWith(NEW)) {
      if (!over) return;
      const at = ids.includes(over) ? ids.indexOf(over) : draft.blocks.length;
      add(id.slice(NEW.length) as BlockKind, at);
      return;
    }
    if (!over || over === id || !ids.includes(over)) return;
    set({ ...draft, blocks: arrayMove(draft.blocks, ids.indexOf(id), ids.indexOf(over)) });
  };

  const issues = preview?.issues ?? [];
  const blockIssues = (i: number) => issues.filter((x) => issueBlock(x.path) === i);
  const otherIssues = issues.filter((x) => issueBlock(x.path) === null);
  const frameBlock = (id: string) => preview?.frame?.blocks.find((b) => b.id === id);

  return (
    <InserterContext.Provider value={inserter}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="grid items-start gap-4 lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_340px]">
          {/* Palette */}
          <section className="card flex max-h-[calc(100dvh-8rem)] flex-col overflow-hidden lg:sticky lg:top-20">
            <Tabs
              value={left}
              onChange={setLeft}
              tabs={[
                ["blocks", "Blocks", BlocksIcon],
                ["data", "Data", Database],
                ["formulas", "Formulas", FunctionSquare],
              ]}
            />
            <div className="grow overflow-y-auto p-3">
              {left === "blocks" ? <Palette onAdd={(k) => add(k)} /> : null}
              {left === "data" ? <DataPanel draft={draft} set={set} preview={preview} /> : null}
              {left === "formulas" ? <FormulasPanel /> : null}
            </div>
          </section>

          {/* The card */}
          <section className="grid min-w-0 content-start gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[13px] font-bold uppercase tracking-wider text-muted">
                The card, live
              </h2>
              <Button size="sm" variant="ghost" onClick={onRerun} busy={previewing}>
                <RefreshCw className="size-4" /> Run again
              </Button>
            </div>
            <Canvas
              title={title}
              blocks={draft.blocks}
              selected={selected}
              onSelect={(id) => {
                setSelected(id);
                if (id) setRight("block");
              }}
              frameBlock={frameBlock}
              hasIssues={(i) => blockIssues(i).length > 0}
              previewing={previewing}
            />
            {otherIssues.length ? (
              <div className="rounded-xl border border-bad/30 bg-bad/10 p-3 text-[13px]">
                <p className="mb-1 flex items-center gap-1.5 font-semibold text-bad">
                  <TriangleAlert className="size-4" /> Fix these before saving
                </p>
                <ul className="list-disc pl-5">
                  {otherIssues.map((i) => (
                    <li key={`${i.path}${i.message}`}>
                      <code className="text-[12px]">{i.path}</code>: {i.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {issues.length > otherIssues.length ? (
              <p className="text-[12.5px] text-bad">
                Blocks with a red outline have something to fix; pick one to see what.
              </p>
            ) : null}
          </section>

          {/* Inspector */}
          <section className="card flex max-h-[calc(100dvh-8rem)] flex-col overflow-hidden lg:col-span-2 xl:sticky xl:top-20 xl:col-span-1">
            <Tabs
              value={right}
              onChange={setRight}
              tabs={[
                ["block", selIndex >= 0 ? "Block" : "Block", BlocksIcon],
                [
                  "values",
                  `Named values${draft.values.length ? ` (${draft.values.length})` : ""}`,
                  Variable,
                ],
              ]}
            />
            <div className="grow overflow-y-auto p-3">
              {right === "values" ? (
                <ValuesPanel draft={draft} set={set} />
              ) : selIndex >= 0 ? (
                <Inspector
                  key={selected}
                  draft={draft}
                  index={selIndex}
                  set={set}
                  issues={blockIssues(selIndex)}
                  runError={frameBlock(String(selected))?.error}
                  onSelect={setSelected}
                />
              ) : (
                <div className="grid gap-2 p-2 text-[13.5px] text-muted">
                  <p className="font-semibold text-ink">Pick a block on the card to change it.</p>
                  <p>
                    Or add one from <b>Blocks</b>: click it, or drag it to where it should go. Drag
                    blocks on the card to put them in order.
                  </p>
                  <p>
                    Blocks read from your sources: add one under <b>Data</b>, and once it's run, its
                    fields are there to click into any formula.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
        <DragOverlay>{dragging ? <PaletteChip kind={dragging} floating /> : null}</DragOverlay>
      </DndContext>
    </InserterContext.Provider>
  );
}

function Tabs<T extends string>({
  value,
  onChange,
  tabs,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: [T, string, typeof Plus][];
}) {
  return (
    <div className="flex gap-1 border-b border-line p-2" role="tablist">
      {tabs.map(([key, label, Icon]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={cx(
            "flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[12.5px] font-semibold",
            value === key ? "bg-accent text-white" : "text-muted hover:text-ink",
          )}
        >
          <Icon className="size-3.5" /> {label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Palette

function Palette({ onAdd }: { onAdd: (k: BlockKind) => void }) {
  const kinds = Object.keys(BLOCK_SPECS) as BlockKind[];
  return (
    <div className="grid gap-3">
      {GROUPS.map((g) => (
        <div key={g}>
          <h3 className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wider text-muted">
            {g}
          </h3>
          <div className="grid grid-cols-2 gap-1.5">
            {kinds
              .filter((k) => BLOCK_SPECS[k].group === g)
              .map((k) => (
                <PaletteItem key={k} kind={k} onAdd={() => onAdd(k)} />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PaletteItem({ kind, onAdd }: { kind: BlockKind; onAdd: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `${NEW}${kind}` });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={onAdd}
      title={`Add a ${BLOCK_SPECS[kind].label.toLowerCase()} (or drag it onto the card)`}
      className={cx("text-left", isDragging && "opacity-40")}
    >
      <PaletteChip kind={kind} />
    </button>
  );
}

function PaletteChip({ kind, floating }: { kind: BlockKind; floating?: boolean }) {
  const s = BLOCK_SPECS[kind];
  const Icon = s.icon;
  return (
    <span
      className={cx(
        "flex items-center gap-1.5 rounded-xl border border-line bg-page px-2 py-1.5 text-[12.5px] font-semibold hover:border-accent",
        floating && "cursor-grabbing border-accent shadow-xl",
      )}
    >
      <Icon className="size-4 flex-none text-accent" />
      <span className="truncate">{s.label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// The card

function Canvas({
  title,
  blocks,
  selected,
  onSelect,
  frameBlock,
  hasIssues,
  previewing,
}: {
  title: string;
  blocks: Rec[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  frameBlock: (id: string) => ResolvedBlock | undefined;
  hasIssues: (i: number) => boolean;
  previewing: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "canvas" });
  const ids = blocks.map((b) => String(b.id));
  return (
    <article
      ref={setNodeRef}
      onClick={(e) => {
        if (e.target === e.currentTarget) onSelect(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onSelect(null);
      }}
      className={cx("card min-h-60 p-4 sm:p-4.5", isOver && "ring-2 ring-accent")}
    >
      <h3 className="mb-2.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
        {title || "Widget"}
      </h3>
      {blocks.length ? (
        <SortableContext items={ids} strategy={rectSortingStrategy}>
          <div className="block-grid">
            {blocks.map((b, i) => (
              <CanvasBlock
                key={String(b.id)}
                block={b}
                resolved={frameBlock(String(b.id))}
                selected={selected === b.id}
                bad={hasIssues(i)}
                previewing={previewing}
                onSelect={() => onSelect(String(b.id))}
              />
            ))}
          </div>
        </SortableContext>
      ) : (
        <p className="grid h-40 place-items-center rounded-xl border-2 border-dashed border-line text-sm text-muted">
          Drag a block here, or click one on the left.
        </p>
      )}
    </article>
  );
}

function CanvasBlock({
  block,
  resolved,
  selected,
  bad,
  previewing,
  onSelect,
}: {
  block: Rec;
  resolved: ResolvedBlock | undefined;
  selected: boolean;
  bad: boolean;
  previewing: boolean;
  onSelect: () => void;
}) {
  const id = String(block.id);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const kind = block.kind as BlockKind;
  const spec = BLOCK_SPECS[kind];
  const Icon = spec?.icon ?? BlocksIcon;
  const w = Number(block.w ?? 12);
  return (
    <div
      ref={setNodeRef}
      style={{
        gridColumn: `span ${Math.min(12, Math.max(1, w))}`,
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={cx("relative", isDragging && "z-20 opacity-70")}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={onSelect}
        aria-label={`${spec?.label ?? kind} ${id}`}
        aria-pressed={selected}
        className={cx(
          "block w-full cursor-grab rounded-xl p-1.5 text-left ring-1 transition active:cursor-grabbing",
          selected
            ? "ring-2 ring-accent"
            : bad
              ? "ring-2 ring-bad/70"
              : resolved?.error
                ? "ring-warn/60"
                : "ring-transparent hover:ring-line",
        )}
      >
        {selected || bad ? (
          <span
            className={cx(
              "absolute -top-2.5 left-2 z-10 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold text-white",
              selected ? "bg-accent" : "bg-bad",
            )}
          >
            <Icon className="size-3" /> {id}
          </span>
        ) : null}
        {/* The card's own blocks never get focus or clicks while editing. */}
        <div className="pointer-events-none">
          {resolved && resolved.kind === kind ? (
            <>
              {resolved.title && resolved.kind !== "heading" ? (
                <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wider text-muted">
                  {resolved.title}
                </p>
              ) : null}
              <BlockView b={{ ...resolved, w }} />
            </>
          ) : (
            <span
              className={cx(
                "flex h-16 items-center justify-center gap-2 rounded-lg bg-(--c-surface-2) text-[13px] text-muted",
                previewing && "animate-pulse",
              )}
            >
              <Icon className="size-4" /> {spec?.label ?? kind}
            </span>
          )}
        </div>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The picked block

function Inspector({
  draft,
  index,
  set,
  issues,
  runError,
  onSelect,
}: {
  draft: Draft;
  index: number;
  set: (d: Draft) => void;
  issues: { path: string; message: string }[];
  runError?: string;
  onSelect: (id: string | null) => void;
}) {
  const block = draft.blocks[index] as Rec;
  const kind = block.kind as BlockKind;
  const spec = BLOCK_SPECS[kind];
  const [idText, setIdText] = useState(String(block.id));
  const others = draft.blocks.filter((_, i) => i !== index).map((b) => String(b.id));
  const idProblem = !BLOCK_ID_RE.test(idText)
    ? "Lowercase letters, digits, - and _"
    : others.includes(idText)
      ? "Another block has that id"
      : null;

  const patch = (p: Rec) => {
    const next = { ...block, ...p };
    for (const [k, v] of Object.entries(p)) if (v === undefined) delete next[k];
    set({ ...draft, blocks: draft.blocks.map((b, i) => (i === index ? next : b)) });
  };
  const move = (by: number) => {
    const to = index + by;
    if (to < 0 || to >= draft.blocks.length) return;
    set({ ...draft, blocks: arrayMove(draft.blocks, index, to) });
  };
  const tone = typeof block.tone === "string" ? block.tone : "";
  const toneIsFormula = tone !== "" && !(TONES as readonly string[]).includes(tone);
  const Icon = spec?.icon ?? BlocksIcon;

  if (!spec)
    return <p className="text-sm text-muted">This kind of block (“{kind}”) isn't known.</p>;

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg bg-(--c-accent-soft) text-accent">
          <Icon className="size-4" />
        </span>
        <div className="grow">
          <p className="text-[14px] font-bold leading-tight">{spec.label}</p>
          <p className="text-[11.5px] text-muted">{kind}</p>
        </div>
        <IconButton
          label="Move earlier"
          className="size-8"
          disabled={index === 0}
          onClick={() => move(-1)}
        >
          <ArrowUp className="size-4" />
        </IconButton>
        <IconButton
          label="Move later"
          className="size-8"
          disabled={index === draft.blocks.length - 1}
          onClick={() => move(1)}
        >
          <ArrowDown className="size-4" />
        </IconButton>
      </div>

      {issues.length || runError ? (
        <div className="grid gap-1 rounded-xl border border-bad/30 bg-bad/10 p-2.5 text-[12.5px]">
          {issues.map((i) => (
            <p key={i.path + i.message}>
              <b>{i.path.split(".").slice(2).join(".") || "Block"}</b>: {i.message}
            </p>
          ))}
          {runError ? <p>When it ran: {runError}</p> : null}
        </div>
      ) : null}

      <div className="grid gap-1">
        <span className="text-[12.5px] font-semibold">Width</span>
        <Segmented
          label="Width"
          value={Number(block.w ?? 12)}
          onChange={(w) => patch({ w })}
          options={WIDTHS}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-[12.5px] font-semibold">
          Title
          <Input
            className="h-9 text-[14px] font-normal"
            value={String(block.title ?? "")}
            placeholder="None"
            onChange={(e) => patch({ title: e.target.value || undefined })}
          />
        </label>
        <label className="grid gap-1 text-[12.5px] font-semibold">
          Id
          <Input
            className="h-9 font-mono text-[13px] font-normal"
            value={idText}
            onChange={(e) => {
              const v = e.target.value;
              setIdText(v);
              if (BLOCK_ID_RE.test(v) && !others.includes(v)) {
                patch({ id: v });
                onSelect(v);
              }
            }}
          />
          {idProblem ? <span className="font-normal text-bad">{idProblem}</span> : null}
        </label>
      </div>

      {kind !== "divider" ? (
        <div className="grid gap-1">
          <label className="grid gap-1 text-[12.5px] font-semibold">
            Tone
            <Select
              className="h-9 text-[14px] font-normal"
              value={toneIsFormula ? "(formula)" : tone}
              onChange={(e) =>
                patch({
                  tone:
                    e.target.value === "(formula)"
                      ? '$item.ok ? "positive" : "negative"'
                      : e.target.value || undefined,
                })
              }
            >
              <option value="">Usual</option>
              {TONES.filter((t) => t !== "normal").map((t) => (
                <option key={t} value={t}>
                  {t[0]?.toUpperCase() + t.slice(1)}
                </option>
              ))}
              <option value="(formula)">From a formula…</option>
            </Select>
          </label>
          {toneIsFormula ? (
            <FormulaInput
              aria-label="Tone formula"
              value={tone}
              onChange={(v) => patch({ tone: v || undefined })}
            />
          ) : null}
        </div>
      ) : null}

      <hr className="border-line" />
      {spec.fields.map((f) => (
        <FieldEditor
          key={f.key}
          spec={f}
          value={block[f.key]}
          onChange={(v) => patch({ [f.key]: v })}
        />
      ))}
      {spec.fields.length ? <hr className="border-line" /> : null}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => {
            const copy = {
              ...structuredClone(block),
              id: freeId(
                String(block.id),
                draft.blocks.map((b) => String(b.id)),
                /[^a-z0-9_-]/g,
              ),
            };
            const blocks = [...draft.blocks];
            blocks.splice(index + 1, 0, copy);
            set({ ...draft, blocks });
            onSelect(String(copy.id));
          }}
        >
          <Copy className="size-4" /> Duplicate
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() => {
            set({ ...draft, blocks: draft.blocks.filter((_, i) => i !== index) });
            onSelect(null);
          }}
        >
          <Trash2 className="size-4" /> Remove
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sources and their fields

const SOURCE_KINDS = [
  { kind: "http", label: "A web address (JSON)" },
  { kind: "websocket", label: "A WebSocket" },
] as const;

function blankSource(kind: string, d: Draft): Rec {
  const id = freeId(
    kind === "hearth" ? "home" : "api",
    [...d.sources, ...d.values].map((x) => String(x.id)),
  );
  if (kind === "hearth") return { id, kind, what: "status" };
  if (kind === "websocket") return { id, kind, url: "ws://192.168.1.20:8080/ws" };
  return { id, kind, url: "http://192.168.1.20:8080/api", every: 60 };
}

function DataPanel({
  draft,
  set,
  preview,
}: {
  draft: Draft;
  set: (d: Draft) => void;
  preview: PreviewResult | null;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="grid gap-3">
      <p className="text-[12px] text-muted">
        Click a field to put it in the formula box you were last in.
      </p>
      {draft.sources.map((s, i) => {
        const id = String(s.id);
        const sample = preview?.samples[id];
        return (
          <div key={i} className="rounded-xl border border-line">
            <button
              type="button"
              onClick={() => setOpen(open === id ? null : id)}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
            >
              <span
                className={cx(
                  "size-2 flex-none rounded-full",
                  !sample ? "bg-muted/50" : sample.ok ? "bg-good" : "bg-bad",
                )}
              />
              <span className="grow truncate">
                <span className="font-mono text-[13px] font-semibold">${id}</span>{" "}
                <span className="text-[11.5px] text-muted">
                  {s.kind === "hearth"
                    ? String(s.what)
                    : s.kind === "connection"
                      ? `${String(s.to)} ${String(s.get ?? "")}`
                      : String(s.kind)}
                </span>
              </span>
              <ChevronDown
                className={cx("size-4 text-muted transition", open === id && "rotate-180")}
              />
            </button>
            {open === id ? (
              <SourceEditor
                source={s}
                taken={[...draft.sources, ...draft.values]
                  .map((x) => String(x.id))
                  .filter((x) => x !== id)}
                onChange={(next) => {
                  let d: Draft = {
                    ...draft,
                    sources: draft.sources.map((x, j) => (j === i ? next : x)),
                  };
                  if (next.id !== s.id) {
                    d = renameRefs(d, id, String(next.id));
                    setOpen(String(next.id));
                  }
                  set(d);
                }}
                onRemove={() => set({ ...draft, sources: draft.sources.filter((_, j) => j !== i) })}
              />
            ) : null}
            <div className="border-t border-line px-2.5 py-2">
              {!sample ? (
                <p className="text-[12px] text-muted">Not run yet.</p>
              ) : !sample.ok ? (
                <p className="text-[12px] text-bad">{sample.error}</p>
              ) : (
                <SampleFields id={id} sample={sample.sample} tracked={Boolean(s.track)} />
              )}
            </div>
          </div>
        );
      })}
      <SourceCatalog
        draft={draft}
        onAdd={(s) => {
          set({ ...draft, sources: [...draft.sources, s] });
          setOpen(null);
        }}
      />
      <div className="grid gap-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted">
          Somewhere else
        </span>
        {SOURCE_KINDS.map((k) => (
          <Button
            key={k.kind}
            size="sm"
            className="justify-start"
            disabled={draft.sources.length >= 8}
            onClick={() => {
              const s = blankSource(k.kind, draft);
              set({ ...draft, sources: [...draft.sources, s] });
              setOpen(String(s.id));
            }}
          >
            <Plus className="size-4" /> {k.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

interface Catalog {
  hearth: { what: string; name: string; hint: string; ready: boolean }[];
  connections: {
    to: string;
    name: string;
    base: string;
    signedIn: boolean;
    paths: { get: string; label: string }[];
  }[];
}

/** Hearth's own data and the systems connected in Settings: one click, no address or key. */
function SourceCatalog({ draft, onAdd }: { draft: Draft; onAdd: (s: Rec) => void }) {
  const cat = useConnections();
  const [open, setOpen] = useState<string | null>(null);
  const taken = [...draft.sources, ...draft.values].map((x) => String(x.id));
  const full = draft.sources.length >= 8;
  const has = (pred: (s: Rec) => boolean) => draft.sources.some(pred);
  if (cat.error) return <p className="text-[12px] text-bad">{(cat.error as Error).message}</p>;
  if (!cat.data) return <div className="skeleton h-24" />;
  const heading = "text-[11px] font-bold uppercase tracking-wider text-muted";
  return (
    <>
      <div className="grid gap-1">
        <span className={heading}>From your home</span>
        {cat.data.hearth.map((h) => {
          const added = has((s) => s.kind === "hearth" && s.what === h.what);
          return (
            <button
              key={h.what}
              type="button"
              disabled={full || added}
              onClick={() => onAdd({ id: freeId(h.what, taken), kind: "hearth", what: h.what })}
              className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-(--c-surface-2) disabled:opacity-50"
            >
              <Plus className="mt-0.5 size-3.5 flex-none text-accent" />
              <span className="grid min-w-0">
                <span className="text-[13px] font-semibold">
                  {h.name}
                  {added ? <span className="font-normal text-muted"> · added</span> : null}
                  {!h.ready ? <span className="font-normal text-muted"> · not set up</span> : null}
                </span>
                <span className="text-[11.5px] text-muted">{h.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="grid gap-1">
        <span className={heading}>Connected systems</span>
        {cat.data.connections.length ? null : (
          <p className="px-2 text-[12px] text-muted">
            Connect AdGuard Home, Home Assistant, openHAB or an AI server in Settings, and they show
            up here, signed in.
          </p>
        )}
        {cat.data.connections.map((c) => (
          <div key={c.to} className="rounded-lg border border-line">
            <button
              type="button"
              onClick={() => setOpen(open === c.to ? null : c.to)}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
            >
              <span className="grid min-w-0 grow">
                <span className="truncate text-[13px] font-semibold">{c.name}</span>
                <span className="truncate text-[11px] text-muted">
                  {c.signedIn ? "Signed in" : "No sign-in saved"} · {c.base}
                </span>
              </span>
              <ChevronDown
                className={cx("size-4 text-muted transition", open === c.to && "rotate-180")}
              />
            </button>
            {open === c.to ? (
              <div className="grid gap-0.5 border-t border-line p-1">
                {c.paths.map((p) => (
                  <button
                    key={p.get}
                    type="button"
                    disabled={full}
                    onClick={() =>
                      onAdd({
                        id: freeId(c.to.replace(/^ai:/, ""), taken),
                        kind: "connection",
                        to: c.to,
                        get: p.get,
                        every: 60,
                      })
                    }
                    className="flex items-start gap-2 rounded-md px-1.5 py-1 text-left hover:bg-(--c-surface-2) disabled:opacity-50"
                  >
                    <Plus className="mt-0.5 size-3.5 flex-none text-accent" />
                    <span className="grid min-w-0">
                      <code className="truncate text-[12px]">{p.get}</code>
                      <span className="text-[11px] text-muted">{p.label}</span>
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  disabled={full}
                  onClick={() =>
                    onAdd({
                      id: freeId(c.to.replace(/^ai:/, ""), taken),
                      kind: "connection",
                      to: c.to,
                      get: "/",
                      every: 60,
                    })
                  }
                  className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12px] text-muted hover:bg-(--c-surface-2)"
                >
                  <Plus className="size-3.5 flex-none text-accent" /> Another path…
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}

function useConnections() {
  return useQuery({
    queryKey: ["widget-connections"],
    queryFn: () => api.get<Catalog>("/api/admin/widgets/connections"),
    staleTime: 60_000,
  });
}

function Chip({ path, example }: { path: string; example?: string }) {
  const inserter = useContext(InserterContext);
  const toast = useToast();
  return (
    <button
      type="button"
      // Keep the formula box focused, so the field lands where its cursor is.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        if (!inserter.insert(path)) {
          void navigator.clipboard?.writeText(path).catch(() => {});
          toast(`Copied ${path}. Click in a formula box first to put it there.`);
        }
      }}
      title={example ? `${path} = ${example}` : path}
      className="flex max-w-full items-baseline gap-1.5 rounded-lg bg-(--c-surface-2) px-1.5 py-0.5 text-left hover:bg-(--c-accent-soft)"
    >
      <code className="truncate text-[12px] text-accent">{path}</code>
      {example ? <span className="truncate text-[11px] text-muted">{example}</span> : null}
    </button>
  );
}

function FieldList({ fields }: { fields: FieldPath[] }) {
  return (
    <div className="grid gap-1">
      {fields.map((f) => (
        <div key={f.path} className="grid gap-1">
          <Chip path={f.path} example={f.example} />
          {f.list?.length ? (
            <div className="ml-3 grid gap-1 border-l border-line pl-2">
              <span className="text-[10.5px] uppercase tracking-wider text-muted">
                each item (in a list block)
              </span>
              {f.list.map((x) => (
                <Chip key={x.path} path={x.path} example={x.example} />
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function SampleFields({ id, sample, tracked }: { id: string; sample: unknown; tracked: boolean }) {
  const root = rootList(sample);
  const fields = root ? null : fieldPaths(sample, `$${id}`);
  return (
    <div className="grid gap-1">
      <Chip
        path={`$${id}`}
        example={Array.isArray(sample) ? `${sample.length} items` : "all of it"}
      />
      {tracked ? <Chip path={`$history.${id}`} example="its history" /> : null}
      {root?.length ? (
        <div className="ml-3 grid gap-1 border-l border-line pl-2">
          <span className="text-[10.5px] uppercase tracking-wider text-muted">each item</span>
          {root.map((x) => (
            <Chip key={x.path} path={x.path} example={x.example} />
          ))}
        </div>
      ) : null}
      {fields ? <FieldList fields={fields} /> : null}
      <details className="mt-1">
        <summary className="cursor-pointer text-[11.5px] text-muted">What it returned</summary>
        <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-page p-2 text-[11px] ring-1 ring-line">
          {JSON.stringify(sample, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function SourceEditor({
  source,
  taken,
  onChange,
  onRemove,
}: {
  source: Rec;
  taken: string[];
  onChange: (s: Rec) => void;
  onRemove: () => void;
}) {
  const [idText, setIdText] = useState(String(source.id));
  const cat = useConnections();
  const kind = String(source.kind);
  const patch = (p: Rec) => {
    const next = { ...source, ...p };
    for (const [k, v] of Object.entries(p)) if (v === undefined || v === "") delete next[k];
    onChange(next);
  };
  const text = (
    key: string,
    label: string,
    opts: { mono?: boolean; placeholder?: string } = {},
  ) => (
    <label className="grid gap-1 text-[12px] font-semibold">
      {label}
      <Input
        className={cx("h-8 font-normal", opts.mono ? "font-mono text-[12.5px]" : "text-[13px]")}
        value={String(source[key] ?? "")}
        placeholder={opts.placeholder}
        onChange={(e) => patch({ [key]: e.target.value })}
      />
    </label>
  );
  const num = (key: string, label: string) => (
    <label className="grid gap-1 text-[12px] font-semibold">
      {label}
      <Input
        type="number"
        className="h-8 text-[13px] font-normal"
        value={String(source[key] ?? "")}
        onChange={(e) =>
          patch({ [key]: e.target.value === "" ? undefined : Number(e.target.value) })
        }
      />
    </label>
  );
  const headers = (source.headers ?? {}) as Record<string, string>;
  const idBad = !ID_RE.test(idText)
    ? "Lowercase, start with a letter"
    : taken.includes(idText)
      ? "Taken"
      : null;

  return (
    <div className="grid gap-2 border-t border-line p-2.5">
      <label className="grid gap-1 text-[12px] font-semibold">
        Name in formulas
        <Input
          className="h-8 font-mono text-[12.5px] font-normal"
          value={idText}
          onChange={(e) => {
            setIdText(e.target.value);
            if (ID_RE.test(e.target.value) && !taken.includes(e.target.value))
              patch({ id: e.target.value });
          }}
        />
        {idBad ? <span className="font-normal text-bad">{idBad}</span> : null}
      </label>
      {kind === "hearth" ? (
        <label className="grid gap-1 text-[12px] font-semibold">
          What
          <Select
            className="h-8 text-[13px] font-normal"
            value={String(source.what ?? "status")}
            onChange={(e) => patch({ what: e.target.value })}
          >
            {(cat.data?.hearth ?? [{ what: "status", name: "Services" }]).map((h) => (
              <option key={h.what} value={h.what}>
                {h.name}
              </option>
            ))}
          </Select>
        </label>
      ) : kind === "connection" ? (
        <>
          <label className="grid gap-1 text-[12px] font-semibold">
            System
            <Select
              className="h-8 text-[13px] font-normal"
              value={String(source.to ?? "")}
              onChange={(e) => patch({ to: e.target.value })}
            >
              {cat.data?.connections.some((c) => c.to === source.to) ? null : (
                <option value={String(source.to ?? "")}>
                  {String(source.to ?? "")} (not connected)
                </option>
              )}
              {(cat.data?.connections ?? []).map((c) => (
                <option key={c.to} value={c.to}>
                  {c.name}
                </option>
              ))}
            </Select>
          </label>
          {text("get", "Path on it", { mono: true, placeholder: "/api/states" })}
          <div className="grid grid-cols-2 gap-2">
            {num("every", "Every (s)")}
            {text("path", "Only this part", { mono: true, placeholder: "data" })}
          </div>
          <p className="text-[11px] text-muted">Hearth signs in for it; only reading is allowed.</p>
          <div className="grid grid-cols-[1.6fr_1fr] gap-2">
            <label className="grid gap-1 text-[12px] font-semibold">
              Keep a history of
              <FormulaInput
                aria-label="Track"
                value={String(source.track ?? "")}
                placeholder={`$${String(source.id)}.value`}
                onChange={(v) => patch({ track: v })}
              />
            </label>
            {num("keep", "How many")}
          </div>
        </>
      ) : (
        <>
          {text("url", "Address", { mono: true })}
          {kind === "http" ? (
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-[12px] font-semibold">
                Method
                <Select
                  className="h-8 text-[13px] font-normal"
                  value={String(source.method ?? "GET")}
                  onChange={(e) =>
                    patch({ method: e.target.value === "GET" ? undefined : e.target.value })
                  }
                >
                  <option>GET</option>
                  <option>POST</option>
                </Select>
              </label>
              {num("every", "Every (s)")}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-[12px] font-semibold">
                Each message
                <Select
                  className="h-8 text-[13px] font-normal"
                  value={String(source.mode ?? "replace")}
                  onChange={(e) =>
                    patch({ mode: e.target.value === "replace" ? undefined : e.target.value })
                  }
                >
                  <option value="replace">Replaces</option>
                  <option value="merge">Merges in</option>
                </Select>
              </label>
              {text("path", "Only this part", { mono: true, placeholder: "data" })}
            </div>
          )}
          {kind === "http"
            ? text("path", "Only this part of the answer", {
                mono: true,
                placeholder: "data.items",
              })
            : null}
          {kind === "websocket" ? (
            <label className="grid gap-1 text-[12px] font-semibold">
              Send when it opens
              <TextArea
                rows={2}
                className="font-mono text-[12px] font-normal"
                value={String(source.send ?? "")}
                onChange={(e) => patch({ send: e.target.value })}
              />
            </label>
          ) : null}
          {kind === "http" ? (
            <>
              <div className="grid gap-1">
                <div className="flex items-center justify-between text-[12px] font-semibold">
                  Headers
                  <button
                    type="button"
                    className="flex items-center gap-1 text-accent"
                    onClick={() =>
                      patch({
                        headers: {
                          ...headers,
                          [`X-Header-${Object.keys(headers).length + 1}`]: "",
                        },
                      })
                    }
                  >
                    <Plus className="size-3.5" /> Add
                  </button>
                </div>
                {Object.entries(headers).map(([k, v], i) => (
                  <div key={i} className="grid grid-cols-[1fr_1.3fr_auto] gap-1">
                    <Input
                      aria-label="Header"
                      className="h-8 font-mono text-[12px]"
                      value={k}
                      onChange={(e) => {
                        const entries = Object.entries(headers);
                        entries[i] = [e.target.value, v];
                        patch({ headers: Object.fromEntries(entries) });
                      }}
                    />
                    <Input
                      aria-label="Value"
                      className="h-8 font-mono text-[12px]"
                      value={v}
                      placeholder="{{secret:name}}"
                      onChange={(e) => patch({ headers: { ...headers, [k]: e.target.value } })}
                    />
                    <IconButton
                      label="Remove header"
                      className="size-8"
                      onClick={() => {
                        const { [k]: _, ...rest } = headers;
                        patch({ headers: Object.keys(rest).length ? rest : undefined });
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </div>
                ))}
              </div>
              {source.method === "POST" ? (
                <label className="grid gap-1 text-[12px] font-semibold">
                  Body
                  <TextArea
                    rows={2}
                    className="font-mono text-[12px] font-normal"
                    value={String(source.body ?? "")}
                    onChange={(e) => patch({ body: e.target.value })}
                  />
                </label>
              ) : null}
              {text("digest", "Digest sign-in (user:password)", {
                mono: true,
                placeholder: "{{secret:name}}",
              })}
            </>
          ) : null}
          <p className="text-[11px] text-muted">
            Keys and passwords: save them in Settings → Secrets and write {"{{secret:name}}"}.
          </p>
          <div className="grid grid-cols-[1.6fr_1fr] gap-2">
            <label className="grid gap-1 text-[12px] font-semibold">
              Keep a history of
              <FormulaInput
                aria-label="Track"
                value={String(source.track ?? "")}
                placeholder={`$${String(source.id)}.value`}
                onChange={(v) => patch({ track: v })}
              />
            </label>
            {num("keep", "How many")}
          </div>
        </>
      )}
      <Button size="sm" variant="danger" onClick={onRemove} className="justify-self-start">
        <Trash2 className="size-4" /> Remove source
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Named values and functions

function ValuesPanel({ draft, set }: { draft: Draft; set: (d: Draft) => void }) {
  const taken = (i: number) =>
    [...draft.sources, ...draft.values.filter((_, j) => j !== i)].map((x) => String(x.id));
  return (
    <div className="grid gap-2.5">
      <p className="text-[12.5px] text-muted">
        A formula worked out once and used anywhere by its name, like{" "}
        <code className="text-accent">$free</code> for <code>$nas.total - $nas.used</code>.
      </p>
      {draft.values.map((v, i) => (
        <ValueRow
          key={i}
          value={v}
          taken={taken(i)}
          onChange={(next) => {
            let d: Draft = { ...draft, values: draft.values.map((x, j) => (j === i ? next : x)) };
            if (next.id !== v.id) d = renameRefs(d, String(v.id), String(next.id));
            set(d);
          }}
          onRemove={() => set({ ...draft, values: draft.values.filter((_, j) => j !== i) })}
        />
      ))}
      <Button
        size="sm"
        className="justify-self-start"
        disabled={draft.values.length >= 30}
        onClick={() =>
          set({
            ...draft,
            values: [
              ...draft.values,
              {
                id: freeId(
                  "value",
                  [...draft.sources, ...draft.values].map((x) => String(x.id)),
                ),
                expr: "1 + 1",
              },
            ],
          })
        }
      >
        <Plus className="size-4" /> Add a value
      </Button>
    </div>
  );
}

function ValueRow({
  value,
  taken,
  onChange,
  onRemove,
}: {
  value: Rec;
  taken: string[];
  onChange: (v: Rec) => void;
  onRemove: () => void;
}) {
  const [idText, setIdText] = useState(String(value.id));
  const bad = !ID_RE.test(idText)
    ? "Lowercase, start with a letter"
    : taken.includes(idText)
      ? "Taken"
      : null;
  return (
    <div className="grid gap-1.5 rounded-xl border border-line p-2">
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[13px] text-accent">$</span>
        <Input
          aria-label="Name"
          className="h-8 font-mono text-[12.5px]"
          value={idText}
          onChange={(e) => {
            setIdText(e.target.value);
            if (ID_RE.test(e.target.value) && !taken.includes(e.target.value))
              onChange({ ...value, id: e.target.value });
          }}
        />
        <Chip path={`$${String(value.id)}`} />
        <IconButton label="Remove value" className="size-8" onClick={onRemove}>
          <Trash2 className="size-3.5" />
        </IconButton>
      </div>
      {bad ? <span className="text-[12px] text-bad">{bad}</span> : null}
      <FormulaInput
        aria-label="Formula"
        value={String(value.expr ?? "")}
        onChange={(v) => onChange({ ...value, expr: v })}
      />
    </div>
  );
}

function FormulasPanel() {
  const inserter = useContext(InserterContext);
  const toast = useToast();
  const [q, setQ] = useState("");
  const list = Object.entries(FUNCTIONS).filter(
    ([name, f]) =>
      !q || name.includes(q.toLowerCase()) || f.doc.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <div className="grid gap-2">
      <Input
        className="h-8 text-[13px]"
        placeholder="Find a function"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="grid gap-1 rounded-xl bg-(--c-surface-2) p-2 text-[11.5px] text-muted">
        <p>
          <code className="text-accent">$item</code>, <code className="text-accent">$index</code>{" "}
          each item in a list block · <code className="text-accent">$now</code> the time
        </p>
        <p>
          <code>+ - * / %</code> · <code>{"== != < > <= >="}</code> · <code>{"&& || !"}</code> ·{" "}
          <code>a ? b : c</code> · <code>"text"</code> · <code>[1, 2]</code>
        </p>
        <p>
          In words (labels, text): <code>{"{{ formula }}"}</code>
        </p>
      </div>
      {list.map(([name, f]) => (
        <button
          key={name}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (!inserter.insert(`${name}()`, "call")) toast("Click in a formula box first.");
          }}
          className="rounded-lg px-2 py-1 text-left hover:bg-(--c-surface-2)"
        >
          <code className="text-[12.5px] text-accent">
            {name}({f.args})
          </code>
          <span className="block text-[11.5px] text-muted">{f.doc}</span>
        </button>
      ))}
    </div>
  );
}
