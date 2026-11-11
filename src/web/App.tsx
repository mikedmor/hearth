import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import {
  Bot,
  CalendarDays,
  FolderOpen,
  HeartHandshake,
  House,
  LayoutGrid,
  LogIn,
  LogOut,
  MessageSquare,
  MonitorSmartphone,
  Settings,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PublicProfile } from "../shared/api";
import { AdminSignIn } from "./components/AdminSignIn";
import { FamilyAlerts, HereBanner } from "./components/internet/HereBanner";
import { Avatar, NOT_OWNER, Picker } from "./components/Picker";
import { TrustNudge } from "./components/TrustNudge";
import { Spinner, useToast } from "./components/ui";
import { api, local } from "./lib/api";
import { cx } from "./lib/format";
import { live } from "./lib/live";
import { applyLook } from "./lib/look";
import { useHome, useLiveRefresh, useRefresh } from "./lib/queries";
import { useReportTrust } from "./lib/trust";
import { CalendarPage } from "./pages/CalendarPage";
import { ChatPage } from "./pages/ChatPage";
import { DevicesPage } from "./pages/DevicesPage";
import { ChildPage, FamilyPage } from "./pages/FamilyPage";
import { FilesPage } from "./pages/FilesPage";
import { HomePage } from "./pages/HomePage";
import { SettingsPage } from "./pages/SettingsPage";
import { TrustPage } from "./pages/TrustPage";
import { WelcomePage } from "./pages/WelcomePage";
import { WidgetEditorPage } from "./pages/WidgetEditorPage";
import { WidgetsPage } from "./pages/WidgetsPage";

const VISITED = "hearth.visited";

function Shell() {
  const home = useHome();
  const refresh = useRefresh();
  useLiveRefresh();
  useReportTrust(home.data?.trustKnown);
  // A new person on this page: the live socket reconnects as them (their own links' status).
  const who = home.data ? (home.data.profile?.id ?? null) : undefined;
  useEffect(() => {
    if (who !== undefined) live.reconnectAs(who);
  }, [who]);
  const [picker, setPicker] = useState(false);
  const [startWith, setStartWith] = useState<PublicProfile | undefined>(undefined);
  const toast = useToast();
  const tried = useRef(false);
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
    // Only when it changes: setting it again reloads the stylesheet, and while it reloads the page
    // loses its styles for a moment (and the place it was scrolled to).
    const href = `/api/look.css?v=${encodeURIComponent(view.look.css.length + view.look.css.slice(0, 40) + (view.profile?.id ?? "guest"))}`;
    if (link.getAttribute("href") !== href) link.href = href;
    document.title = view.title;
    return () => mq.removeEventListener("change", onChange);
  }, [view]);

  // A device's first visit: ask who's here. Not on the pages a stranger's device opens (the
  // front door's welcome, the trust page): there the question is in the way.
  const visitorPage = path.startsWith("/welcome") || path.startsWith("/trust");
  useEffect(() => {
    if (!view || view.profile || view.profiles.length === 0 || visitorPage) return;
    // Someone's own device opens their page: straight away, or at their PIN pad. Once per visit,
    // and not after they said it isn't them.
    const owner = view.deviceOwner && view.profiles.find((p) => p.id === view.deviceOwner);
    if (owner && !tried.current && local.get(NOT_OWNER, "") !== owner.id) {
      tried.current = true;
      if (owner.hasPin) {
        setStartWith(owner);
        setPicker(true);
      } else
        void api
          .post("/api/profile", { id: owner.id })
          .then(() => refresh())
          .catch(() => setPicker(true));
      return;
    }
    if (!local.get(VISITED, false)) setPicker(true);
  }, [view, visitorPage, refresh]);

  // Back from signing in with the home's identity provider: say how it went.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const sso = q.get("sso");
    if (!sso) return;
    const who = q.get("who");
    const why = q.get("why");
    const said: Record<string, string> = {
      ok: "Signed in",
      admin: "Signed in as the admin",
      linked: "Linked: that account opens this page from now on",
      unlinked: `${who ? `${who} isn't` : "That account isn't"} linked to anyone here yet. The admin links accounts in Settings → People.`,
      error: `Signing in didn't work${why ? `: ${why}` : "."}`,
      off: "Single sign-on isn't set up.",
    };
    if (said[sso]) toast(said[sso]);
    for (const k of ["sso", "who", "why"]) q.delete(k);
    const rest = q.toString();
    history.replaceState(null, "", `${location.pathname}${rest ? `?${rest}` : ""}${location.hash}`);
  }, [toast]);

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
    { to: "/calendar", label: "Calendar", icon: CalendarDays, show: view.canCalendar },
    { to: "/files", label: "Files", icon: FolderOpen, show: view.canFiles },
    {
      to: "/family",
      label: "Family",
      icon: HeartHandshake,
      show: Boolean(view.family),
      badge: view.familyPending,
    },
    { to: "/chat", label: "Chat", icon: MessageSquare, show: view.canChat },
    { to: "/devices", label: "Devices", icon: MonitorSmartphone, show: admin },
    { to: "/widgets", label: "Widgets", icon: LayoutGrid, show: admin },
    {
      to: "/settings",
      label: "Settings",
      icon: Settings,
      show: admin,
      note: view.update ? `Hearth ${view.update} is out` : undefined,
    },
  ].filter((n) => n.show) as {
    to: string;
    label: string;
    icon: typeof House;
    show: boolean;
    badge?: number;
    /** A dot, and what it means. */
    note?: string;
  }[];

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
                  aria-label={
                    n.badge
                      ? `${n.label}, ${n.badge} waiting`
                      : n.note
                        ? `${n.label}: ${n.note}`
                        : n.label
                  }
                  title={n.note ?? n.label}
                  className={cx(
                    "flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold transition",
                    active ? "bg-accent text-white" : "text-muted hover:text-ink",
                  )}
                >
                  <n.icon className="size-4" aria-hidden />
                  <span className="hidden md:inline">{n.label}</span>
                  {n.badge ? (
                    <span
                      aria-hidden
                      className={cx(
                        "grid h-4.5 min-w-4.5 place-items-center rounded-full px-1 text-[11px] font-bold",
                        active ? "bg-white text-accent" : "bg-accent text-white",
                      )}
                    >
                      {n.badge}
                    </span>
                  ) : n.note ? (
                    <span
                      aria-hidden
                      className={cx("size-2 rounded-full", active ? "bg-white" : "bg-accent")}
                    />
                  ) : null}
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
          ) : // Only the admin's own page offers the sign-in: adults, children and guests don't see
          // it. A new install, with nobody set up yet, offers it to whoever is there.
          view.profile?.role === "admin" || !view.profiles.length || view.session.needsSetup ? (
            <button
              type="button"
              title="Admin"
              aria-label="Sign in as the admin"
              onClick={() => setSignIn(true)}
              className="grid size-9 place-items-center rounded-full text-muted hover:bg-(--c-surface-2) hover:text-ink"
            >
              <LogIn className="size-4" />
            </button>
          ) : null}
          {view.profiles.length ? (
            <button
              type="button"
              onClick={() => setPicker(true)}
              className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pr-3 pl-1 shadow-sm transition hover:border-(--c-line-strong)"
              aria-label={
                view.profile ? `${view.profile.name}. Switch person` : "Choose who's here"
              }
            >
              {view.profile ? (
                <Avatar p={view.profile} />
              ) : (
                <span className="grid size-8 place-items-center rounded-full bg-(--c-surface-2)">
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
      <TrustNudge />
      <HereBanner />
      <FamilyAlerts pending={view.familyPending} />
      <Outlet />
      <UpdateNotice build={view.build} />
      {picker ? (
        <Picker
          profiles={view.profiles}
          current={view.profile?.id ?? null}
          owner={view.deviceOwner}
          startWith={startWith}
          dismissable={local.get(VISITED, false) || Boolean(view.profile) || Boolean(startWith)}
          onClose={() => {
            local.set(VISITED, true);
            setStartWith(undefined);
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

/** This tab's page is older than the one Hearth serves now: offer to load the new one. */
function UpdateNotice({ build }: { build?: string }) {
  const mine = useMemo(
    () =>
      document
        .querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')
        ?.src.split("/")
        .pop(),
    [],
  );
  if (!build || !mine || build === mine) return null;
  return (
    <button
      type="button"
      onClick={() => location.reload()}
      className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-[13.5px] font-semibold text-page shadow-xl"
    >
      Hearth was updated · Reload
    </button>
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
  createRoute({ getParentRoute: () => rootRoute, path: "/devices", component: DevicesPage }),
  // The AI computers page became part of Devices.
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/compute",
    beforeLoad: () => {
      throw redirect({ to: "/devices" });
    },
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/calendar", component: CalendarPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/files", component: FilesPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/family", component: FamilyPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/trust", component: TrustPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/welcome", component: WelcomePage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/family/$id", component: ChildPage }),
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
