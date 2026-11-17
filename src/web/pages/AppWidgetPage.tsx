/**
 * One widget on its own, for a home-screen widget in the Android app (app-shell's widget
 * contract; listed by GET /api/app-widgets). The app draws this page off screen at the widget's
 * size and keeps the picture, so it must fill the window, be transparent around the card, fit the
 * card in, and say when it's done once nothing is still loading.
 */
import { useIsFetching } from "@tanstack/react-query";
import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import { WidgetCard } from "../components/widgets/WidgetCard";
import { applyLook } from "../lib/look";
import { useHome } from "../lib/queries";

/** Narrower than this, a widget is laid out at this width and scaled down. */
const MIN_WIDTH = 260;
/** Shrinking the widget below this drops one more part instead. */
const KEEP_SCALE = 0.85;
/** What fitting can drop, in order of preference within each kind: last first. */
const DROPPABLE = "[data-widget-optional]";
/** Then list and table rows, keeping each list's first. */
const ROWS = "li:not(:first-child), tbody > tr:not(:first-child)";

declare global {
  interface Window {
    __appWidgetReady?: boolean;
  }
}

/** The widget id in an /app-widget/<id> address, if this is one. */
export function appWidgetId(path: string): string | null {
  const m = /^\/app-widget\/([^/]+)\/?$/.exec(path);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

export function AppWidgetPage({ id }: { id: string }) {
  const home = useHome();
  const view = home.data;
  const widget = view?.widgets.find((w) => w.id === id);

  // This person's look, as on their page.
  useEffect(() => {
    if (view) applyLook(document.documentElement, view.look, view.themes);
  }, [view]);

  if (home.isError) return <Message text="Can't reach Hearth." />;
  if (view && !widget) return <Message text="This widget isn't on your page any more." />;
  return (
    <Fitted>
      {widget ? <WidgetCard widget={widget} /> : <div />}
      <Ready />
    </Fitted>
  );
}

/**
 * Says the picture can be taken: nothing loading, no placeholder left, every image in. Checked
 * a few times a second, since a widget's parts load on their own.
 */
function Ready() {
  const fetching = useIsFetching();
  useEffect(() => {
    if (fetching > 0) return;
    const timer = setInterval(() => {
      const waiting =
        document.querySelector(".skeleton") || [...document.images].some((img) => !img.complete);
      if (waiting || !document.querySelector(".widget-card")) return;
      clearInterval(timer);
      // Two frames: the last layout and paint land first.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          window.__appWidgetReady = true;
        }),
      );
    }, 150);
    return () => clearInterval(timer);
  }, [fetching]);
  return null;
}

function Message({ text }: { text: string }) {
  useEffect(() => {
    window.__appWidgetReady = true;
  }, []);
  return (
    <div className="flex h-dvh items-center justify-center p-4">
      <div className="card px-4 py-3 text-center text-sm text-muted">{text}</div>
    </div>
  );
}

/**
 * Fits the widget to the home-screen widget, filling it:
 * 1. Lay it out at the window's width (text keeps its size), stretched to the height.
 * 2. While it would have to shrink below KEEP_SCALE, drop a part: first those marked
 *    `data-widget-optional`, then list and table rows, each last first.
 * 3. If it still doesn't fit, lay it out wider until it does and scale it all down, so it fills
 *    the widget both ways instead of a narrow column.
 */
function Fitted({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);

  // Nothing behind the card: the home screen shows around it.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add("app-widget");
    return () => root.classList.remove("app-widget");
  }, []);

  // Measured and set directly: each step needs the layout of the one before. Runs again
  // whenever the card changes size (data arriving).
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const fitCard = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // How many times too tall the card is, laid out w wide (1: it fits).
      const over = (w: number) => {
        const room = (vh * w) / vw;
        el.style.width = `${w}px`;
        el.style.minHeight = `${room}px`;
        return el.offsetHeight / room;
      };
      for (const h of el.querySelectorAll("[data-widget-hidden]"))
        h.removeAttribute("data-widget-hidden");
      let width = Math.max(vw, MIN_WIDTH);
      let ratio = over(width);
      for (const selector of [DROPPABLE, ROWS]) {
        const parts = [...el.querySelectorAll(selector)];
        while (ratio > 1 / KEEP_SCALE && parts.length > 0) {
          const part = parts.pop();
          if (!part || part.closest("[data-widget-hidden]")) continue;
          part.setAttribute("data-widget-hidden", "");
          ratio = over(width);
        }
      }
      if (ratio > 1.005) {
        // Wider until it fits, then narrowed back down (a few halvings) to the snuggest fit.
        let lo = width;
        let hi = width * ratio;
        for (let i = 0; i < 4 && over(hi) > 1.005; i++) hi *= over(hi);
        for (let i = 0; i < 6; i++) {
          const mid = (lo + hi) / 2;
          if (over(mid) > 1.005) lo = mid;
          else hi = mid;
        }
        width = hi;
        over(width);
      }
      el.style.transform = `scale(${vw / width})`;
    };
    fitCard();
    // The box only changes size when the card does: then it's time to fit again.
    const ro = new ResizeObserver(fitCard);
    ro.observe(el);
    window.addEventListener("resize", fitCard);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fitCard);
    };
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden">
      <div
        ref={inner}
        className="app-widget-fill"
        style={{ position: "absolute", top: 0, left: 0, transformOrigin: "top left" }}
      >
        {children}
      </div>
    </div>
  );
}
