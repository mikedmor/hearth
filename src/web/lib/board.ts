/**
 * The mixed board: link sections and widgets in one order, so widgets sit among the sections
 * instead of in a rail of their own. The order is the person's (`board`: "g:<section>" and
 * "w:<widget>"); anything not in it yet is spread in evenly.
 */
import type { ViewGroup, ViewWidget } from "../../shared/api";
import type { WidgetType } from "../../shared/config";

export type BoardItem =
  | { key: string; kind: "group"; group: ViewGroup }
  | { key: string; kind: "widget"; widget: ViewWidget };

export const groupKey = (id: string) => `g:${id}`;
export const widgetKey = (id: string) => `w:${id}`;

/** Sections (in their order) and widgets, in the board's order, new ones spread evenly. */
export function boardItems(
  groups: ViewGroup[],
  widgets: ViewWidget[],
  board: string[],
): BoardItem[] {
  const all = new Map<string, BoardItem>([
    ...groups.map((g): [string, BoardItem] => [
      groupKey(g.id),
      { key: groupKey(g.id), kind: "group", group: g },
    ]),
    ...widgets.map((w): [string, BoardItem] => [
      widgetKey(w.id),
      { key: widgetKey(w.id), kind: "widget", widget: w },
    ]),
  ]);
  const placed = board.map((k) => all.get(k)).filter((x): x is BoardItem => !!x);
  const seen = new Set(placed.map((x) => x.key));
  const newGroups = groups.map((g) => groupKey(g.id)).filter((k) => !seen.has(k));
  const newWidgets = widgets.map((w) => widgetKey(w.id)).filter((k) => !seen.has(k));
  // New sections go after the placed ones; new widgets are spread among the sections.
  const out = [...placed, ...newGroups.map((k) => all.get(k) as BoardItem)];
  newWidgets.forEach((k, i) => {
    const at = Math.round(((i + 1) * out.length) / (newWidgets.length + 1)) + i;
    out.splice(Math.min(at, out.length), 0, all.get(k) as BoardItem);
  });
  return out;
}

/** About how tall a widget is, in section rows, for packing columns. */
const WIDGET_ROWS: Record<WidgetType, number> = {
  status: 6,
  note: 3,
  countdown: 5,
  clock: 3.5,
  ai: 5,
  pinball: 8,
  ask: 3,
  agenda: 8,
  custom: 8,
};

export function itemWeight(item: BoardItem, groupWeight: (g: ViewGroup) => number): number {
  return item.kind === "group" ? groupWeight(item.group) : (WIDGET_ROWS[item.widget.type] ?? 6);
}

// ---------------------------------------------------------------------------
// Linked runs: items kept together

/**
 * The board cut into runs: an item whose key is in `joined` stays with the one before it, so a
 * run moves as one and is drawn as one (in a single column, on a phone too).
 */
export function boardRuns<T extends { key: string }>(items: T[], joined: string[]): T[][] {
  const glued = new Set(joined);
  const runs: T[][] = [];
  for (const item of items) {
    const last = runs.at(-1);
    if (last && glued.has(item.key)) last.push(item);
    else runs.push([item]);
  }
  return runs;
}

/** The run holding a key, as [first index, end index) in the order. */
function runAt(order: string[], joined: Set<string>, key: string): [number, number] {
  let start = order.indexOf(key);
  if (start === -1) return [-1, -1];
  while (start > 0 && joined.has(order[start] as string)) start--;
  let end = start + 1;
  while (end < order.length && joined.has(order[end] as string)) end++;
  return [start, end];
}

/** The keys of the run holding `key`, in order. */
export function runOf(order: string[], joined: string[], key: string): string[] {
  const [a, b] = runAt(order, new Set(joined), key);
  return a === -1 ? [] : order.slice(a, b);
}

export type Place = "before" | "after" | "join";

/**
 * Put `moving` (one item, or a whole run) before or after `target`, or join it (right after
 * it, linked). Landing between two linked items joins their run; the run it left keeps the rest
 * together.
 */
export function placeAt(
  order: string[],
  joined: string[],
  moving: string[],
  target: string,
  where: Place,
): { order: string[]; joined: string[] } {
  if (!moving.length || moving.includes(target) || !order.includes(target))
    return { order, joined };
  const glued = new Set(joined);
  // Which run each item was in, so what stays behind stays linked only to its own run.
  const runOfKey = new Map<string, number>();
  let run = -1;
  for (const k of order) {
    if (!glued.has(k) || run === -1) run++;
    runOfKey.set(k, run);
  }
  const rest = order.filter((k) => !moving.includes(k));
  const next = new Set<string>();
  rest.forEach((k, i) => {
    const prev = rest[i - 1];
    if (glued.has(k) && prev !== undefined && runOfKey.get(prev) === runOfKey.get(k)) next.add(k);
  });
  const t = rest.indexOf(target);
  const at = where === "before" ? t : t + 1;
  const after = rest[at];
  // Inside a run (between two of its items) means joining it.
  const inside =
    where === "join" ||
    (where === "before" && next.has(target)) ||
    (where === "after" && after !== undefined && next.has(after));
  moving.forEach((k, i) => {
    if (i === 0 ? inside : glued.has(k) && runOfKey.get(k) === runOfKey.get(moving[0] as string))
      next.add(k);
  });
  return { order: [...rest.slice(0, at), ...moving, ...rest.slice(at)], joined: [...next] };
}

/**
 * Keep `key` next to `target`: it leaves its own run (the others stay together) and goes at the
 * end of the target's run, linked.
 */
export function linkTo(
  order: string[],
  joined: string[],
  key: string,
  target: string,
): { order: string[]; joined: string[] } {
  if (key === target || !order.includes(key) || !order.includes(target)) return { order, joined };
  const glued = new Set(joined);
  const i = order.indexOf(key);
  const next = order[i + 1];
  // Whatever followed it now follows its place, unless it started a run of its own.
  if (next && glued.has(next) && !glued.has(key)) glued.delete(next);
  glued.delete(key);
  const rest = order.filter((k) => k !== key);
  const [, end] = runAt(rest, glued, target);
  glued.add(key);
  return { order: [...rest.slice(0, end), key, ...rest.slice(end)], joined: [...glued] };
}

/** Let `key` go its own way: it and everything after it in its run split off. */
export function unlink(joined: string[], key: string): string[] {
  return joined.filter((k) => k !== key);
}
