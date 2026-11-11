/**
 * What a chart block is worked out into, before it's drawn: named columns and rows of plain
 * values, as Muny's card kit has it. The server fills it from a source's items; the page draws
 * it (src/web/components/widgets/cardkit).
 */

export type FieldType = "money" | "number" | "percent" | "text" | "date" | "month" | "boolean";

export type DateBucket =
  | "day"
  | "week"
  | "month"
  | "quarter"
  | "year"
  | "weekday"
  | "day_of_month"
  | "month_of_year";

export type CardCell = string | number | boolean | null;

/** Colors are roles the theme fills in, so a chart follows the theme. */
export const CARD_COLORS = [
  "auto",
  "series1",
  "series2",
  "series3",
  "series4",
  "series5",
  "series6",
  "series7",
  "series8",
  "positive",
  "negative",
  "warning",
  "muted",
] as const;
export type CardColor = (typeof CARD_COLORS)[number];

export const CARD_MARKS = ["auto", "line", "dashed", "area", "column"] as const;
export type CardMark = (typeof CARD_MARKS)[number];

export interface ResultColumn {
  id: string;
  label: string;
  type: FieldType;
  role: "dimension" | "measure";
  bucket?: DateBucket;
  color?: CardColor;
  mark?: CardMark;
  hidden?: boolean;
}

export interface QueryResult {
  columns: ResultColumn[];
  rows: CardCell[][];
  /** There was more than fits. */
  truncated?: boolean;
}

/** How a chart is drawn. */
export interface ChartOptions {
  stacked?: boolean;
  height?: number;
  legend?: boolean;
  /** pie: a ring (the default) or a full pie; and what the middle says. */
  donut?: boolean;
  center?: string;
  /** Flat lines across a chart. */
  references?: { label: string; value: number | null; color?: CardColor; type: FieldType }[];
}
