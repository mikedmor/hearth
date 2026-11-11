/**
 * Colors for things shown side by side in charts (from Muny's card kit). Slots are handed out in
 * a stable order, never by size rank, so a change in values doesn't repaint anything.
 */
export const SERIES_SLOTS = 8;
export const OTHER_COLOR = "var(--viz-other)";
export const seriesColor = (i: number) =>
  i < SERIES_SLOTS ? `var(--viz-series-${i + 1})` : OTHER_COLOR;
