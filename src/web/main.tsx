import "./index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { router } from "./App";
import { ToastProvider } from "./components/ui";
import { api } from "./lib/api";
import { applyCachedLook } from "./lib/look";

applyCachedLook();

// start.home/?profile=kids sets this device up for one person (a bookmark on a child's tablet).
const asked = new URL(location.href).searchParams.get("profile");
if (asked !== null) {
  const url = new URL(location.href);
  url.searchParams.delete("profile");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
  try {
    localStorage.setItem("hearth.visited", "true");
  } catch {
    // Fine.
  }
  await api.post("/api/profile", { id: asked || null }).catch(() => {});
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: true } },
});

createRoot(document.getElementById("app") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
