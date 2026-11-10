/**
 * Applies a look (theme colours plus layout and style choices) to the page as CSS variables and
 * data attributes. Everything else in the CSS reads those, so a look changes the whole page at
 * once, and a preview panel can apply one to itself only.
 */
import {
  DEFAULT_LOOK,
  FONT_STACKS,
  type Look,
  resolveTheme,
  type Theme,
  themeVariables,
} from "../../shared/themes";
import { local } from "./api";

const CACHE = "hearth.look";

const prefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

export function applyLook(el: HTMLElement, look: Look, custom: Theme[], isRoot = true): Theme {
  const theme = resolveTheme(look.theme, custom, prefersDark());
  for (const [k, v] of Object.entries(themeVariables(theme))) el.style.setProperty(k, v);
  el.dataset.mode = theme.mode;
  el.dataset.bg = look.background;
  el.dataset.tile = look.tileStyle;
  el.dataset.tileSize = look.tileSize;
  el.dataset.icon = look.iconStyle;
  el.dataset.density = look.density;
  el.dataset.width = look.width;
  el.dataset.align = look.align;
  el.dataset.descriptions = String(look.descriptions);
  el.style.setProperty("--radius", `${look.radius}px`);
  el.style.setProperty("--glow", String(look.glow / 100));
  el.style.setProperty("--font", FONT_STACKS[look.font]);
  el.style.setProperty("--font-heading", FONT_STACKS[look.headingFont]);
  el.style.setProperty("--bg-dim", String(look.backgroundDim / 100));
  el.style.setProperty("--bg-blur", `${look.backgroundBlur}px`);
  el.style.setProperty(
    "--bg-image",
    look.background === "image" && look.backgroundImage
      ? `url("/media/backgrounds/${look.backgroundImage}")`
      : "none",
  );
  if (isRoot) {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme.colors.background);
    local.set(CACHE, { look, theme });
  }
  return theme;
}

/** Before the first render, so the page never flashes in the wrong colours. */
export function applyCachedLook(): void {
  const cached = local.get<{ look: Look; theme: Theme } | null>(CACHE, null);
  const look = cached?.look ?? DEFAULT_LOOK;
  applyLook(document.documentElement, look, cached?.theme ? [cached.theme] : [], false);
}
