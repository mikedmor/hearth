/**
 * Themes and looks.
 *
 * A theme is a small set of colours (like Muny's). Everything else (soft fills, strong borders,
 * glows) is mixed from them in CSS, so widgets and tiles follow any theme without knowing it.
 * Colours are validated hex values, never free text, so a pasted theme can't inject anything.
 *
 * A look is how one person's page is laid out and styled: which theme, the background, corner
 * radius, density, tile and icon style, fonts, and their own CSS.
 */
import { z } from "zod";

export const HEX = /^#[0-9a-fA-F]{6}$/;
const hex = z.string().regex(HEX, "use a colour like #e8743b");

export const CHART_KEYS = ["chart1", "chart2", "chart3", "chart4", "chart5", "chart6"] as const;
export const THEME_KEYS = [
  "background",
  "surface",
  "border",
  "text",
  "muted",
  "accent",
  "positive",
  "negative",
  "warning",
  ...CHART_KEYS,
] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];

export const THEME_LABELS: Record<ThemeKey, { label: string; hint: string }> = {
  background: { label: "Page", hint: "Behind everything." },
  surface: { label: "Cards", hint: "Tiles, widgets and menus." },
  border: { label: "Lines", hint: "Outlines and dividers." },
  text: { label: "Text", hint: "Names and headings." },
  muted: { label: "Quiet text", hint: "Labels and details." },
  accent: { label: "Accent", hint: "Buttons, focus and the glow." },
  positive: { label: "Good", hint: "Up, healthy, done." },
  negative: { label: "Bad", hint: "Down, errors." },
  warning: { label: "Warning", hint: "Slow, nearly full." },
  chart1: { label: "Chart 1", hint: "First line or bar." },
  chart2: { label: "Chart 2", hint: "" },
  chart3: { label: "Chart 3", hint: "" },
  chart4: { label: "Chart 4", hint: "" },
  chart5: { label: "Chart 5", hint: "" },
  chart6: { label: "Chart 6", hint: "" },
};

export const ThemeSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().min(1).max(40),
  mode: z.enum(["light", "dark"]),
  colors: z.object(
    Object.fromEntries(THEME_KEYS.map((k) => [k, hex])) as Record<ThemeKey, typeof hex>,
  ),
});
export type Theme = z.infer<typeof ThemeSchema>;

const darkCharts = {
  chart1: "#f08a4b",
  chart2: "#5aa9e6",
  chart3: "#4cd384",
  chart4: "#c792ea",
  chart5: "#f2c14e",
  chart6: "#ef6f8f",
};
const lightCharts = {
  chart1: "#d9622b",
  chart2: "#2a78d6",
  chart3: "#1a9a5c",
  chart4: "#7c5cdb",
  chart5: "#c48a00",
  chart6: "#d4456b",
};

export const BUILTIN_THEMES: Theme[] = [
  {
    id: "ember",
    name: "Ember",
    mode: "dark",
    colors: {
      background: "#14100e",
      surface: "#1d1815",
      border: "#2d2520",
      text: "#f4ece3",
      muted: "#ab9e92",
      accent: "#e8743b",
      positive: "#4cd384",
      negative: "#ff6b5e",
      warning: "#f2b648",
      ...darkCharts,
    },
  },
  {
    id: "hearth",
    name: "Hearth",
    mode: "light",
    colors: {
      background: "#f6f1ea",
      surface: "#fffdfa",
      border: "#e7ddd1",
      text: "#2a211b",
      muted: "#7b6d61",
      accent: "#d9622b",
      positive: "#24a35a",
      negative: "#db4a3f",
      warning: "#c98700",
      ...lightCharts,
    },
  },
  {
    id: "midnight",
    name: "Midnight",
    mode: "dark",
    colors: {
      background: "#0b1020",
      surface: "#131a2e",
      border: "#252f4a",
      text: "#e8ecf8",
      muted: "#8b97b5",
      accent: "#6b7cff",
      positive: "#34c38f",
      negative: "#f0616d",
      warning: "#f0b429",
      ...darkCharts,
      chart1: "#6b7cff",
    },
  },
  {
    id: "forest",
    name: "Forest",
    mode: "dark",
    colors: {
      background: "#0a130f",
      surface: "#121e18",
      border: "#223329",
      text: "#e6f0ea",
      muted: "#86a093",
      accent: "#3fbf80",
      positive: "#4cc38a",
      negative: "#e5674f",
      warning: "#d9a53a",
      ...darkCharts,
      chart1: "#3fbf80",
    },
  },
  {
    id: "ocean",
    name: "Ocean",
    mode: "light",
    colors: {
      background: "#eef5fb",
      surface: "#ffffff",
      border: "#d4e3f0",
      text: "#0f2a3f",
      muted: "#526a7e",
      accent: "#1670c2",
      positive: "#0f8a6a",
      negative: "#d43f3f",
      warning: "#c77f12",
      ...lightCharts,
      chart1: "#1670c2",
    },
  },
  {
    id: "graphite",
    name: "Graphite",
    mode: "dark",
    colors: {
      background: "#0e0e10",
      surface: "#18181b",
      border: "#2a2a2e",
      text: "#f4f4f5",
      muted: "#8e8e96",
      accent: "#a78bfa",
      positive: "#3fb97c",
      negative: "#ee5d5d",
      warning: "#e3a22e",
      ...darkCharts,
      chart1: "#a78bfa",
    },
  },
  {
    id: "meadow",
    name: "Meadow",
    mode: "light",
    colors: {
      background: "#f3f7ee",
      surface: "#ffffff",
      border: "#dbe6d0",
      text: "#1f2b17",
      muted: "#5f7052",
      accent: "#4f9a2f",
      positive: "#2f9e57",
      negative: "#cf4a3c",
      warning: "#c08a12",
      ...lightCharts,
      chart1: "#4f9a2f",
    },
  },
  {
    id: "candy",
    name: "Candy",
    mode: "light",
    colors: {
      background: "#fff4fa",
      surface: "#ffffff",
      border: "#f6d5e6",
      text: "#3a1730",
      muted: "#8a5d7b",
      accent: "#e0408a",
      positive: "#22a06b",
      negative: "#e0443e",
      warning: "#e09a10",
      ...lightCharts,
      chart1: "#e0408a",
    },
  },
  {
    id: "high-contrast",
    name: "High contrast",
    mode: "dark",
    colors: {
      background: "#000000",
      surface: "#0a0a0a",
      border: "#6b6b6b",
      text: "#ffffff",
      muted: "#c8c8c8",
      accent: "#ffd23f",
      positive: "#3ddc84",
      negative: "#ff6b6b",
      warning: "#ffc53d",
      ...darkCharts,
    },
  },
];

export const SYSTEM_THEME = "system";
export const DEFAULT_DARK = "ember";
export const DEFAULT_LIGHT = "hearth";

export function findTheme(id: string, custom: Theme[] = []): Theme | null {
  return BUILTIN_THEMES.find((t) => t.id === id) ?? custom.find((t) => t.id === id) ?? null;
}

/** The theme to show. "system" (or a deleted theme) follows the device's light or dark setting. */
export function resolveTheme(selected: string, custom: Theme[], prefersDark: boolean): Theme {
  const found = selected === SYSTEM_THEME ? null : findTheme(selected, custom);
  return found ?? (findTheme(prefersDark ? DEFAULT_DARK : DEFAULT_LIGHT) as Theme);
}

/** CSS variables for a theme. */
export function themeVariables(t: Theme): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of THEME_KEYS) out[`--c-${k}`] = t.colors[k];
  return out;
}

// ---------------------------------------------------------------------------
// Looks

export const BACKGROUNDS = ["glow", "solid", "gradient", "aurora", "image"] as const;
export const TILE_STYLES = ["card", "glass", "flat", "outline", "minimal"] as const;
export const ICON_STYLES = ["tinted", "solid", "plain", "circle"] as const;
export const FONTS = ["system", "rounded", "serif", "mono", "condensed"] as const;
export const DENSITIES = ["compact", "cozy", "roomy"] as const;
export const TILE_SIZES = ["sm", "md", "lg"] as const;
export const CLOCKS = ["big", "small", "off"] as const;
export const WIDTHS = ["narrow", "normal", "wide", "full"] as const;
export const LAYOUTS = ["command", "classic"] as const;
export const RAILS = ["right", "left", "off"] as const;
export const RAIL_WIDTHS = ["narrow", "wide"] as const;
export const LAUNCHERS = ["rows", "icons", "cards"] as const;

export const FONT_STACKS: Record<(typeof FONTS)[number], string> = {
  system:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI Variable Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  rounded:
    'ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", "Segoe UI Variable Display", system-ui, sans-serif',
  serif: 'ui-serif, "New York", "Iowan Old Style", "Palatino Linotype", Georgia, Cambria, serif',
  mono: 'ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, Menlo, monospace',
  condensed:
    '"Bahnschrift", "Arial Narrow", "Roboto Condensed", "Helvetica Neue", system-ui, sans-serif',
};

export const LookSchema = z.object({
  /**
   * command: everything on one screen (launcher in the middle, widgets in a side rail, a favourites
   * dock); classic: one long page of sections.
   */
  layout: z.enum(LAYOUTS).default("command"),
  /** Where the widget rail goes in the command layout. */
  rail: z.enum(RAILS).default("right"),
  railWidth: z.enum(RAIL_WIDTHS).default("narrow"),
  /** How groups of tiles look in the command layout: one-line rows, an icon grid, or cards. */
  launcher: z.enum(LAUNCHERS).default("rows"),
  /** Phones: favourites in a dock at the bottom of the screen. */
  dock: z.boolean().default(true),
  theme: z.string().max(40).default(SYSTEM_THEME),
  background: z.enum(BACKGROUNDS).default("glow"),
  /** A file in data/backgrounds, for background "image". */
  backgroundImage: z
    .string()
    .regex(/^[\w-]+\.(png|jpe?g|webp|gif|avif)$/i)
    .optional(),
  /** Darken (dark themes) or lighten the image so text stays readable, 0-90. */
  backgroundDim: z.number().int().min(0).max(90).default(35),
  backgroundBlur: z.number().int().min(0).max(40).default(0),
  /** How strong the glow and gradients are, 0-100. */
  glow: z.number().int().min(0).max(100).default(60),
  radius: z.number().int().min(0).max(32).default(18),
  density: z.enum(DENSITIES).default("cozy"),
  width: z.enum(WIDTHS).default("normal"),
  tileStyle: z.enum(TILE_STYLES).default("card"),
  tileSize: z.enum(TILE_SIZES).default("md"),
  iconStyle: z.enum(ICON_STYLES).default("tinted"),
  /** Show tile descriptions. */
  descriptions: z.boolean().default(true),
  font: z.enum(FONTS).default("system"),
  headingFont: z.enum(FONTS).default("system"),
  clock: z.enum(CLOCKS).default("big"),
  greeting: z.boolean().default(true),
  align: z.enum(["left", "center"]).default("left"),
  /** Extra CSS for this page, served as a stylesheet (no scripts, no outside requests: CSP). */
  css: z.string().max(20_000).default(""),
});
export type Look = z.infer<typeof LookSchema>;
export const DEFAULT_LOOK: Look = LookSchema.parse({});
