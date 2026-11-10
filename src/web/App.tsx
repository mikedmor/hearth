import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import {
  Bot,
  CalendarDays,
  Cpu,
  House,
  LayoutGrid,
  LogIn,
  LogOut,
  MessageSquare,
  Settings,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AdminSignIn } from "./components/AdminSignIn";
import { Avatar, Picker } from "./components/Picker";
import { Spinner } from "./components/ui";
import { api, local } from "./lib/api";
import { cx } from "./lib/format";
import { applyLook } from "./lib/look";
import { useHome, useLiveRefresh, useRefresh } from "./lib/queries";
import { CalendarPage } from "./pages/CalendarPage";
import { ChatPage } from "./pages/ChatPage";
import { ComputePage } from "./pages/ComputePage";
import { HomePage } from "./pages/HomePage";
import { SettingsPage } from "./pages/SettingsPage";
import { WidgetEditorPage } from "./pages/WidgetEditorPage";
import { WidgetsPage } from "./pages/WidgetsPage";

const VISITED = "hearth.visited";

function Shell() {
  const home = useHome();
  const refresh = useRefresh();
  useLiveRefresh();
  const [picker, setPicker] = useState(false);
  const [signIn, setSignIn] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });

  // Apply this person's look, and their own CSS.
  const view = home.data;
  useEffect(() => {
    if (!view) return;
    applyLook(document.documentElement, view.look, view.themes);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyLook(document.documentElement, view.look, view.themes);
    mq.addEventListener("change", onChange);
    let link = document.getElementById("look-css") as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = "look-css";
      link.rel = "stylesheet";
      document.head.append(link);
    }
    link.href = `/api/look.css?v=${encodeURIComponent(view.look.css.length + view.look.css.slice(0, 40) + (view.profile?.id ?? "guest"))}`;
    document.title = view.title;
    return () => mq.removeEventListener("change", onChange);
  }, [view]);

  // A device's first visit: ask who's here.
  useEffect(() => {
    if (!view || view.profile || view.profiles.length === 0) return;
    if (!local.get(VISITED, false)) setPicker(true);
  }, [view]);

  if (home.isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner />
      </div>
    );
  }
  if (!view) {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        <div className="card max-w-sm p-6">
          <p className="font-semibold">Hearth can't reach its server.</p>
          <p className="mt-1 text-sm text-muted">{(home.error as Error)?.message}</p>
          <button
            type="button"
            className="mt-4 font-semibold text-accent"
            onClick={() => location.reload()}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const admin = view.session.admin;
  const nav = [
    { to: "/", label: "Home", icon: House, show: true },
    { to: "/calendar", label: "Calendar", icon: CalendarDays, show: Boolean(view.profile) },
    { to: "/chat", label: "Chat", icon: MessageSquare, show: view.canChat },
    { to: "/compute", label: "AI computers", icon: Cpu, show: view.canChat || admin },
    { to: "/widgets", label: "Widgets", icon: LayoutGrid, show: admin },
    { to: "/settings", label: "Settings", icon: Settings, show: admin },
  ].filter((n) => n.show);

  return (
    <>
      <div className="backdrop" />
      <header
        className={cx(
          "shell flex items-center justify-between gap-3 pt-[max(14px,env(safe-area-inset-top))] pb-2",
          (path === "/" || path === "/setup") && view.look.layout === "command" && "command-head",
        )}
      >
        <Link
          to="/"
          className="flex items-center gap-2.5 font-heading text-[17px] font-bold tracking-tight"
          aria-label={view.title}
        >
          <Logo />
          <span className="hidden sm:inline">{view.title}</span>
        </Link>
        {nav.length > 1 ? (
          <nav
            aria-label="Pages"
            className="flex items-center gap-0.5 rounded-full border border-line bg-[color-mix(in_oklab,var(--c-surface)_70%,transparent)] p-1 backdrop-blur"
          >
            {nav.map((n) => {
              const active = n.to === "/" ? path === "/" : path.startsWith(n.to);
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  aria-label={n.label}
                  title={n.label}
                  className={cx(
                    "flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold transition",
                    active ? "bg-accent text-white" : "text-muted hover:text-ink",
                  )}
                >
                  <n.icon className="size-4" aria-hidden />
                  <span className="hidden md:inline">{n.label}</span>
                </Link>
              );
            })}
          </nav>
        ) : null}
        <div className="flex items-center gap-1.5">
          {admin ? (
            <button
              type="button"
              title="Sign out of admin"
              aria-label="Sign out of admin"
              onClick={async () => {
                await api.post("/api/logout");
                await refresh();
              }}
              className="hidden h-9 items-center gap-1.5 rounded-full px-3 text-[12px] font-bold uppercase tracking-wider text-accent hover:bg-accent/10 sm:flex"
            >
              <Bot className="size-4" /> Admin <LogOut className="size-3.5" />
            </button>
          ) : (
            <button
              type="button"
              title="Admin"
              aria-label="Sign in as the admin"
              onClick={() => setSignIn(true)}
              className="grid size-9 place-items-center rounded-full text-muted hover:bg-[var(--c-surface-2)] hover:text-ink"
            >
              <LogIn className="size-4" />
            </button>
          )}
          {view.profiles.length ? (
            <button
              type="button"
              onClick={() => setPicker(true)}
              className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pr-3 pl-1 shadow-sm transition hover:border-[var(--c-line-strong)]"
              aria-label={
                view.profile ? `${view.profile.name}. Switch person` : "Choose who's here"
              }
            >
              {view.profile ? (
                <Avatar p={view.profile} />
              ) : (
                <span className="grid size-8 place-items-center rounded-full bg-[var(--c-surface-2)]">
                  <UserRound className="size-4 text-muted" />
                </span>
              )}
              <span className="text-[13.5px] font-semibold">
                {view.profile?.name ?? "Who's here?"}
              </span>
            </button>
          ) : null}
        </div>
      </header>
      <Outlet />
      {picker ? (
        <Picker
          profiles={view.profiles}
          current={view.profile?.id ?? null}
          dismissable={local.get(VISITED, false) || Boolean(view.profile)}
          onClose={() => {
            local.set(VISITED, true);
            setPicker(false);
          }}
        />
      ) : null}
      <AdminSignIn
        open={signIn || (path === "/setup" && view.session.needsSetup)}
        needsSetup={view.session.needsSetup}
        onClose={() => setSignIn(false)}
      />
    </>
  );
}

export function Logo({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <path
        fill="var(--c-accent)"
        d="M16 3c1.2 4.3 6.8 7.3 7.9 12.6C25 21 21.4 28 16 28S7 21.7 8.2 16.4c.6-2.6 2.4-4.2 3.5-5.6.3 2.2 1.2 3.5 2.5 4.2C13.5 10.6 14.6 6.5 16 3Z"
      />
      <path
        fill="#ffd48f"
        d="M16.4 15.5c.6 2.4 3.6 3.8 3.6 6.7 0 2.7-1.8 4.3-4 4.3s-4-1.6-4-4.1c0-1.9 1.3-3 2.1-3.8.2 1.2.7 1.8 1.4 2.2-.2-2 .2-3.8.9-5.3Z"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Routes

const rootRoute = createRootRoute({ component: Shell });
const routes = [
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomePage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/setup", component: HomePage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/chat",
    validateSearch: (s: Record<string, unknown>): { q?: string } => ({
      q: typeof s.q === "string" ? s.q : undefined,
    }),
    component: ChatPage,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/compute", component: ComputePage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/calendar", component: CalendarPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/widgets", component: WidgetsPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/widgets/$id",
    component: WidgetEditorPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    validateSearch: (s: Record<string, unknown>): { tab?: string } => ({
      tab: typeof s.tab === "string" ? s.tab : undefined,
    }),
    component: SettingsPage,
  }),
];

export const router = createRouter({
  routeTree: rootRoute.addChildren(routes),
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
