/**
 * What the widget editor knows about each kind of block: its name, where it sits in the palette,
 * the fields the inspector shows, and what a new one starts as. Mirrors widget-doc's schema.
 */
import {
  CalendarDays,
  ChartArea,
  ChartBarBig,
  ChartColumn,
  ChartColumnStacked,
  ChartLine,
  ChartPie,
  ChartScatter,
  CircleDot,
  Gauge,
  Grid3x3,
  Hash,
  Heading,
  Image,
  LayoutGrid,
  List,
  type LucideIcon,
  Minus,
  Rows3,
  SlidersHorizontal,
  Table,
  Type,
} from "lucide-react";
import type { BlockKind } from "../../../../shared/widget-doc";

export type FieldType =
  | "formula"
  | "template"
  | "text"
  | "number"
  | "numOrFormula"
  | "bool"
  | "select"
  | "series"
  | "columns"
  | "pairs";

export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  hint?: string;
  options?: { value: string; label: string }[];
}

export type Group = "Numbers" | "Charts" | "Lists" | "Layout";

export interface BlockSpec {
  label: string;
  group: Group;
  icon: LucideIcon;
  /** Columns wide (out of 12) a new one starts at. */
  w: number;
  fields: FieldSpec[];
  /** A new one's fields, reading from the first source when there is one. */
  starter: (src: string) => Record<string, unknown>;
}

const sizes = (list: string[]) => list.map((v) => ({ value: v, label: v.toUpperCase() }));
const f = (key: string, label: string, type: FieldType, hint?: string): FieldSpec => ({
  key,
  label,
  type,
  hint,
});
const ITEMS = f("items", "Items", "formula", "A list, like $nas.disks");
const X = f(
  "x",
  "Each item is called",
  "formula",
  "A date (YYYY-MM-DD), a month, or a name: $item.name",
);
const SERIES = f("series", "Series", "series");
const HEIGHT = f("height", "Height (px)", "number");
const chartStarter = (src: string) => ({
  items: src ? `$${src}` : "$data",
  x: "$item.name",
  series: [{ label: "Value", value: "$item.value" }],
});

export const BLOCK_SPECS: Record<BlockKind, BlockSpec> = {
  stat: {
    label: "Big number",
    group: "Numbers",
    icon: Hash,
    w: 6,
    fields: [
      f("value", "Value", "formula"),
      f("label", "Label", "template"),
      f("unit", "Unit", "text"),
      f("sub", "A line under it", "template"),
      f("spark", "Small line (a list of numbers)", "formula", "Like $history.nas"),
      { key: "size", label: "Size", type: "select", options: sizes(["sm", "md", "lg", "xl"]) },
    ],
    starter: (src) => ({ value: src ? `count($${src})` : "42", label: "A number", size: "lg" }),
  },
  gauge: {
    label: "Gauge",
    group: "Numbers",
    icon: Gauge,
    w: 4,
    fields: [
      f("value", "Value", "formula"),
      f("min", "Lowest", "number"),
      f("max", "Highest", "numOrFormula"),
      f("label", "Label", "template"),
      f("unit", "Unit", "text"),
      f("warnAt", "Warning at", "number"),
      f("badAt", "Bad at", "number"),
    ],
    starter: () => ({ value: "50", max: 100, label: "Gauge", unit: "%" }),
  },
  progress: {
    label: "Progress bar",
    group: "Numbers",
    icon: SlidersHorizontal,
    w: 12,
    fields: [
      f("value", "Value", "formula"),
      f("max", "Out of", "numOrFormula"),
      f("label", "Label", "template"),
      f("detail", "What it says", "template", "{{ bytes($used) }} of {{ bytes($total) }}"),
      f("warnAt", "Warning at (%)", "number"),
      f("badAt", "Bad at (%)", "number"),
    ],
    starter: () => ({ value: "40", max: 100, label: "Progress" }),
  },
  line: {
    label: "Line",
    group: "Charts",
    icon: ChartLine,
    w: 12,
    fields: [
      f("points", "Points", "formula", "A list of numbers, or items with a field"),
      f("field", "Field in each item", "text"),
      f("label", "Label", "template"),
      f("value", "Big number", "formula"),
      f("unit", "Unit", "text"),
      f("fill", "Filled", "bool"),
      HEIGHT,
    ],
    starter: (src) => ({ points: src ? `$history.${src}` : "[]", label: "Over time" }),
  },
  bars: {
    label: "Ranked bars",
    group: "Charts",
    icon: ChartBarBig,
    w: 12,
    fields: [
      ITEMS,
      f("label", "Name field", "text", "The field in each item, like name"),
      f("value", "Number field", "text", "The field in each item, like size"),
      f("display", "How it reads", "formula", "bytes($item.size)"),
      f("limit", "How many", "number"),
    ],
    starter: (src) => ({ items: src ? `$${src}` : "$data", label: "name", value: "value" }),
  },
  columns: {
    label: "Columns",
    group: "Charts",
    icon: ChartColumn,
    w: 12,
    fields: [
      ITEMS,
      X,
      f("xLabel", "What they are", "text"),
      SERIES,
      f("stacked", "Stacked", "bool"),
      HEIGHT,
      f("limit", "How many", "number"),
    ],
    starter: chartStarter,
  },
  area: {
    label: "Area",
    group: "Charts",
    icon: ChartArea,
    w: 12,
    fields: [
      ITEMS,
      X,
      f("xLabel", "What they are", "text"),
      SERIES,
      f("stacked", "Stacked", "bool"),
      HEIGHT,
      f("limit", "How many", "number"),
    ],
    starter: chartStarter,
  },
  pie: {
    label: "Donut",
    group: "Charts",
    icon: ChartPie,
    w: 6,
    fields: [
      ITEMS,
      f("x", "Each slice is called", "formula"),
      SERIES,
      f("donut", "A ring (not a full pie)", "bool"),
      f("center", "In the middle", "template"),
    ],
    starter: chartStarter,
  },
  treemap: {
    label: "Treemap",
    group: "Charts",
    icon: LayoutGrid,
    w: 12,
    fields: [ITEMS, f("x", "Each box is called", "formula"), SERIES, HEIGHT],
    starter: chartStarter,
  },
  heatmap: {
    label: "Heat map",
    group: "Charts",
    icon: Grid3x3,
    w: 12,
    fields: [
      ITEMS,
      f("x", "Across", "formula"),
      f("y", "Down", "formula"),
      f("yLabel", "What down is", "text"),
      SERIES,
    ],
    starter: (src) => ({ ...chartStarter(src), y: "$item.group" }),
  },
  scatter: {
    label: "Scatter",
    group: "Charts",
    icon: ChartScatter,
    w: 12,
    fields: [
      ITEMS,
      f("x", "Each dot is called", "formula"),
      { ...SERIES, hint: "Two: across, then up" },
      HEIGHT,
    ],
    starter: (src) => ({
      ...chartStarter(src),
      series: [
        { label: "Across", value: "$item.a" },
        { label: "Up", value: "$item.b" },
      ],
    }),
  },
  waterfall: {
    label: "Waterfall",
    group: "Charts",
    icon: ChartColumnStacked,
    w: 12,
    fields: [ITEMS, f("x", "Each step is called", "formula"), SERIES, HEIGHT],
    starter: chartStarter,
  },
  calendar: {
    label: "Calendar",
    group: "Lists",
    icon: CalendarDays,
    w: 12,
    fields: [
      ITEMS,
      f("x", "Each entry's date", "formula", "YYYY-MM-DD"),
      f("name", "What it says", "formula"),
      SERIES,
    ],
    starter: (src) => ({
      items: src ? `$${src}` : "$data",
      x: "$item.date",
      name: "$item.name",
      series: [],
    }),
  },
  list: {
    label: "List",
    group: "Lists",
    icon: List,
    w: 12,
    fields: [
      ITEMS,
      f("itemTitle", "Each row's title", "formula", "$item.name"),
      f("itemDetail", "Under it", "formula"),
      f("itemValue", "On the right", "formula"),
      f("itemIcon", "Icon (an emoji)", "formula"),
      f("itemTone", "Tone", "formula", '$item.ok ? "positive" : "negative"'),
      f("limit", "How many", "number"),
      f("empty", "When there are none", "text"),
    ],
    starter: (src) => ({ items: src ? `$${src}` : "$data", itemTitle: "$item.name" }),
  },
  table: {
    label: "Table",
    group: "Lists",
    icon: Table,
    w: 12,
    fields: [
      f("rows", "Rows", "formula"),
      f("columns", "Columns", "columns"),
      f("limit", "How many", "number"),
    ],
    starter: (src) => ({
      rows: src ? `$${src}` : "$data",
      columns: [{ label: "Name", value: "$item.name", align: "left" }],
    }),
  },
  lights: {
    label: "Status lights",
    group: "Lists",
    icon: CircleDot,
    w: 12,
    fields: [
      ITEMS,
      f("itemLabel", "Each light's name", "formula"),
      f("itemState", "Its state", "formula", '"up", "down", "warn", "off", or true/false'),
      f("itemDetail", "Detail", "formula"),
      f("limit", "How many", "number"),
    ],
    starter: (src) => ({
      items: src ? `$${src}` : "$data",
      itemLabel: "$item.name",
      itemState: "$item.ok",
    }),
  },
  pairs: {
    label: "Label and value",
    group: "Lists",
    icon: Rows3,
    w: 12,
    fields: [f("items", "Pairs", "pairs")],
    starter: () => ({ items: [{ label: "Label", value: "{{ 1 + 1 }}" }] }),
  },
  heading: {
    label: "Heading",
    group: "Layout",
    icon: Heading,
    w: 12,
    fields: [f("text", "Text", "template")],
    starter: () => ({ text: "A heading" }),
  },
  text: {
    label: "Text",
    group: "Layout",
    icon: Type,
    w: 12,
    fields: [
      f("text", "Text", "template", "Live values in {{ }}"),
      { key: "size", label: "Size", type: "select", options: sizes(["sm", "md", "lg"]) },
    ],
    starter: () => ({ text: "Some words, and {{ round(2.5) }} live." }),
  },
  image: {
    label: "Camera picture",
    group: "Layout",
    icon: Image,
    w: 12,
    fields: [
      f("src", "Picture address", "template", "A snapshot on the home network"),
      f("alt", "Description", "text"),
      {
        key: "fit",
        label: "Fit",
        type: "select",
        options: [
          { value: "cover", label: "Fill" },
          { value: "contain", label: "Whole picture" },
        ],
      },
      f("every", "Refresh every (s)", "number"),
      f("height", "Height (px)", "number"),
    ],
    starter: () => ({ src: "http://", every: 30 }),
  },
  divider: {
    label: "Divider",
    group: "Layout",
    icon: Minus,
    w: 12,
    fields: [],
    starter: () => ({}),
  },
};

export const GROUPS: Group[] = ["Numbers", "Charts", "Lists", "Layout"];
export const WIDTHS = [
  { value: 3, label: "¼" },
  { value: 4, label: "⅓" },
  { value: 6, label: "½" },
  { value: 8, label: "⅔" },
  { value: 12, label: "Full" },
];
